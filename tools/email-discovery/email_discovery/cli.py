"""CLI: discover / eval / serve worker."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

from .orchestrator import enrich_domain
from .models import PersonRequest


def cmd_discover(args: argparse.Namespace) -> int:
    people = []
    if args.first and args.last:
        people.append(PersonRequest(first_name=args.first, last_name=args.last))
    providers = [p.strip() for p in args.providers.split(",") if p.strip()]
    result = enrich_domain(
        args.domain,
        people,
        providers=providers,
        smtp=args.smtp,
    )
    print(json.dumps(result, default=lambda o: o.__dict__, indent=2))
    return 0


def cmd_eval(args: argparse.Namespace) -> int:
    path = Path(args.csv)
    if not path.is_file():
        print(f"Missing CSV: {path}", file=sys.stderr)
        return 1
    providers = [p.strip() for p in args.providers.split(",") if p.strip()]
    rows = list(csv.DictReader(path.open()))
    hits = 0
    labeled = 0
    for row in rows:
        domain = (row.get("domain") or "").strip()
        first = (row.get("first_name") or "").strip()
        last = (row.get("last_name") or "").strip()
        expected = (row.get("expected_email") or "").strip().lower()
        if not domain:
            continue
        if expected:
            labeled += 1
        result = enrich_domain(
            domain,
            [PersonRequest(first_name=first, last_name=last)] if first else [],
            providers=providers,
            smtp=args.smtp,
        )
        found = {h.email.lower() for h in result.hits}
        for p in result.people:
            if p.get("email"):
                found.add(p["email"].lower())
        if expected and expected in found:
            hits += 1
        print(
            f"{domain}\t{first} {last}\texpected={expected or '-'}\t"
            f"found={len(found)}\thit={expected in found if expected else 'n/a'}"
        )
    if labeled:
        print(f"\nLabeled hit rate: {hits}/{labeled} ({100 * hits / labeled:.1f}%)")
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    try:
        from .worker import create_app
        import uvicorn
    except ImportError as e:
        print(f"Install worker deps: pip install fastapi uvicorn ({e})", file=sys.stderr)
        return 1
    app = create_app()
    uvicorn.run(app, host=args.host, port=args.port)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="email_discovery")
    sub = parser.add_subparsers(dest="command", required=True)

    p_disc = sub.add_parser("discover", help="Run providers for one domain")
    p_disc.add_argument("--domain", required=True)
    p_disc.add_argument("--first")
    p_disc.add_argument("--last")
    p_disc.add_argument(
        "--providers",
        default="site_crawl,pattern_mx",
        help="Comma-separated: site_crawl,harvester,pattern_mx,pattern_smtp",
    )
    p_disc.add_argument("--smtp", action="store_true")
    p_disc.set_defaults(func=cmd_discover)

    p_eval = sub.add_parser("eval", help="Batch eval from CSV")
    p_eval.add_argument("--csv", required=True)
    p_eval.add_argument("--providers", default="site_crawl,pattern_mx")
    p_eval.add_argument("--smtp", action="store_true")
    p_eval.set_defaults(func=cmd_eval)

    p_srv = sub.add_parser("serve", help="HTTP worker for run-search integration")
    p_srv.add_argument("--host", default="127.0.0.1")
    p_srv.add_argument("--port", type=int, default=8787)
    p_srv.set_defaults(func=cmd_serve)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
