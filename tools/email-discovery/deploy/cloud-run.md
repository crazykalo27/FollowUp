# Host the OSINT worker on Google Cloud Run (FollowUp)

This deploys `tools/email-discovery` for project **FollowUp** / Supabase **`czakwfzjkhsaysvqeswc`**.

Cloud Run gives you HTTPS. Supabase Edge (`run-search`) calls:

- `OSINT_WORKER_URL` → `https://…run.app` (no trailing slash)
- `OSINT_WORKER_SECRET` → same bearer token on Cloud Run and Supabase

**Billing:** Cloud Run needs a billing account on the Google project. Personal volume usually stays on the [free tier](https://cloud.google.com/run/pricing).

---

## 1. Install and log in to gcloud

https://cloud.google.com/sdk/docs/install

```bash
gcloud auth login
gcloud auth application-default login
```

---

## 2. Create the Google Cloud project

Project id must be **globally unique**. If `followup-crazykalo27` is taken, pick another id (letters, numbers, hyphens only) and use it everywhere below.

```bash
gcloud projects create followup-crazykalo27 --name="FollowUp OSINT"
gcloud config set project followup-crazykalo27
```

Link billing (required once): https://console.cloud.google.com/billing?project=followup-crazykalo27

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
```

---

## 3. Create the shared secret (one value, two places)

```bash
export OSINT_WORKER_SECRET=$(openssl rand -hex 32)
echo "Copy and save this secret:"
echo "$OSINT_WORKER_SECRET"
```

You will paste this into Cloud Run (step 4) and Supabase (step 5).

---

## 4. Deploy the worker

### Option A — Google Cloud Shell (recommended)

You are already in project `followup-crazykalo27` in the browser terminal. **Do not** use Mac paths like `/Users/kallenselby/...` — clone the repo here:

```bash
cd ~
git clone https://github.com/crazykalo27/FollowUp.git
cd FollowUp/tools/email-discovery

export OSINT_WORKER_SECRET=$(openssl rand -hex 32)
echo "Save this secret:"
echo "$OSINT_WORKER_SECRET"

export GCP_PROJECT=followup-crazykalo27
export REGION=us-west1

chmod +x deploy/cloud-run.sh
./deploy/cloud-run.sh
```

Copy the `SERVICE_URL=...` line and run the three `npx supabase` commands **on your Mac** (or anywhere you have the Supabase CLI linked), using that URL and the same `OSINT_WORKER_SECRET`.

### Option B — Your Mac (local gcloud)

```bash
cd ~/Documents/Documents\ -\ Kallen\'s\ MacBook\ Air/FollowUp/tools/email-discovery
```

Or open the `FollowUp` folder in Finder → drag into Terminal after `cd `.

```bash
export OSINT_WORKER_SECRET=$(openssl rand -hex 32)
export GCP_PROJECT=followup-crazykalo27
export REGION=us-west1

./deploy/cloud-run.sh
```

### Manual deploy (same flags as the script)

```bash
gcloud run deploy followup-osint \
  --source . \
  --project followup-crazykalo27 \
  --region us-west1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "OSINT_WORKER_SECRET=${OSINT_WORKER_SECRET}" \
  --timeout 60 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 5 \
  --port 8080
```

**Your service URL** (run after deploy):

```bash
export SERVICE_URL=$(gcloud run services describe followup-osint \
  --project followup-crazykalo27 \
  --region us-west1 \
  --format='value(status.url)')
echo "$SERVICE_URL"
```

Test:

```bash
curl -s "$SERVICE_URL/health"

curl -s -X POST "$SERVICE_URL/v1/enrich" \
  -H "Authorization: Bearer $OSINT_WORKER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"domain":"github.com","people":[{"first_name":"Octocat","last_name":"Demo"}],"providers":["site_crawl","pattern_mx"]}'
```

---

## 5. Point Supabase at Cloud Run

From the FollowUp repo root on your **Mac** (or any machine with Supabase CLI):

```bash
cd ~/FollowUp
# or wherever you cloned FollowUp locally

npx supabase secrets set OSINT_WORKER_URL="$SERVICE_URL"
npx supabase secrets set OSINT_WORKER_SECRET="$OSINT_WORKER_SECRET"
npx supabase functions deploy run-search --project-ref czakwfzjkhsaysvqeswc
```

If you only deployed from Cloud Shell, paste `SERVICE_URL` and `OSINT_WORKER_SECRET` from that session into the commands above (export them first on the Mac).

Supabase project dashboard: https://supabase.com/dashboard/project/czakwfzjkhsaysvqeswc/settings/functions

---

## 6. Redeploy after code changes

```bash
cd "/Users/kallenselby/Documents/Documents - Kallen’s MacBook Air/FollowUp/tools/email-discovery"
gcloud run deploy followup-osint --source . --project followup-crazykalo27 --region us-west1
```

Supabase secrets stay until you change them; you only need `functions deploy run-search` again if you change Edge code.

---

## Security

- Cloud Run is deployed with `--allow-unauthenticated` so Supabase can `fetch` the URL. **`OSINT_WORKER_SECRET`** is required on `POST /v1/enrich` when set on the service (always set it).
- Do not commit `OSINT_WORKER_SECRET` to git.

---

## Troubleshooting

| Issue | What to do |
|--------|------------|
| Project id already exists | Use e.g. `followup-crazykalo27-2` and replace in all commands |
| Deploy permission errors | `gcloud auth login` and confirm billing on `followup-crazykalo27` |
| Worker 401 | `Authorization: Bearer` must match `OSINT_WORKER_SECRET` on Cloud Run and Supabase |
| Search still skips worker | Redeploy `run-search`; confirm secrets in Supabase dashboard |
| Build fails locally | `cd tools/email-discovery && docker build -t followup-osint-test .` |

---

## Optional: theHarvester

Uncomment the `theHarvester` line in `tools/email-discovery/Dockerfile`, redeploy. Edge already does site crawl if the worker is unavailable.
