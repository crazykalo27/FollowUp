"""Run selected providers and rank person-level email guesses."""

from __future__ import annotations

from typing import Any

from .models import EmailCandidate, EmailHit, EnrichResult, PersonRequest, VerificationResult
from .patterns import generate_candidates, infer_pattern
from .providers import harvester as harvester_mod
from .providers import site_crawl as site_crawl_mod
from .verify import best_verification


PROVIDER_NAMES = ("site_crawl", "harvester", "pattern_mx", "pattern_smtp")


def enrich_domain(
    domain: str,
    people: list[PersonRequest] | None = None,
    *,
    providers: list[str] | None = None,
    smtp: bool = False,
) -> EnrichResult:
    people = people or []
    active = providers or ["site_crawl", "pattern_mx"]
    result = EnrichResult(domain=domain)
    hits: list[EmailHit] = []

    if "site_crawl" in active:
        try:
            hits.extend(site_crawl_mod.crawl_domain(domain))
        except Exception as e:
            result.errors.append(f"site_crawl: {e}")

    if "harvester" in active:
        h, errs = harvester_mod.harvest_domain(domain)
        hits.extend(h)
        result.errors.extend(errs)

    result.hits = hits
    seed_emails = [h.email for h in hits]
    pattern = infer_pattern(seed_emails, domain)

    use_smtp = smtp or "pattern_smtp" in active
    use_pattern = "pattern_mx" in active or "pattern_smtp" in active

    for person in people:
        row: dict[str, Any] = {
            "first_name": person.first_name,
            "last_name": person.last_name,
            "email": None,
            "verification_status": None,
            "sources": [],
            "source_details": {},
            "candidates": [],
        }
        if not use_pattern:
            result.people.append(row)
            continue

        candidates = generate_candidates(
            person.first_name, person.last_name, domain, pattern
        )
        best: tuple[str, VerificationResult, float] | None = None
        for email in candidates:
            ver = best_verification(email, smtp=use_smtp)
            conf = 0.3
            if ver.status == "valid":
                conf = 0.85
            elif ver.status == "accept_all":
                conf = 0.55
            elif ver.detail.get("mx"):
                conf = 0.45
            row["candidates"].append(
                {"email": email, "status": ver.status, "confidence": conf}
            )
            if ver.status in ("valid", "accept_all") and (
                best is None or conf > best[2]
            ):
                best = (email, ver, conf)

        if best:
            email, ver, conf = best
            row["email"] = email
            row["verification_status"] = ver.status
            row["sources"] = ["pattern", "verify_smtp" if use_smtp else "verify_mx"]
            row["source_details"] = {
                "pattern": {"inferred": pattern, "confidence": conf},
                "verify": ver.detail,
            }
        result.people.append(row)

    return result
