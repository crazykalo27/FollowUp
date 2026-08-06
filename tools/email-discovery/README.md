# Email discovery PoC

Local stack to compare **site crawl**, **theHarvester**, and **pattern + verify** before wiring into `run-search`.

See [docs/email-discovery-stack.md](../../docs/email-discovery-stack.md) for full architecture.

## Setup

```bash
cd tools/email-discovery
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# optional:
pip install theHarvester
```

## Try one company

```bash
python -m email_discovery discover --domain stripe.com --first Patrick --last Collison \
  --providers site_crawl,harvester,pattern_mx
```

SMTP probe (slow, can annoy mail servers — use sparingly):

```bash
python -m email_discovery discover --domain example.com --first Jane --last Doe \
  --providers pattern_smtp --smtp
```

## Eval CSV

Copy `fixtures/eval_set.example.csv` → `fixtures/eval_set.csv`, add known emails where you have ground truth:

```bash
python -m email_discovery eval --csv fixtures/eval_set.csv --providers site_crawl,pattern_mx
```

## Worker (for future Edge integration)

```bash
export OSINT_WORKER_SECRET=dev-secret
python -m email_discovery serve --port 8787
```

```bash
curl -s -X POST http://127.0.0.1:8787/v1/enrich \
  -H "Authorization: Bearer dev-secret" \
  -H "Content-Type: application/json" \
  -d '{"domain":"stripe.com","people":[{"first_name":"Patrick","last_name":"Collison"}],"providers":["site_crawl","pattern_mx"]}'
```

## Provider cheat sheet

| Provider | CLI flag | Needs |
|----------|----------|--------|
| `site_crawl` | default | requests, bs4 |
| `harvester` | in `--providers` | `theHarvester` on PATH |
| `pattern_mx` | default | dnspython |
| `pattern_smtp` | `--smtp` | outbound port 25 often blocked on cloud |
