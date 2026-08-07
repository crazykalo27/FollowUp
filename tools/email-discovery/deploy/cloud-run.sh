#!/usr/bin/env bash
# Deploy FollowUp OSINT worker to Google Cloud Run.
#
# Defaults match FollowUp / Supabase project czakwfzjkhsaysvqeswc.
# Override only if you used a different GCP project id:
#   export GCP_PROJECT=followup-crazykalo27
#   export OSINT_WORKER_SECRET=$(openssl rand -hex 32)

set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-followup-osint}"
GCP_PROJECT="${GCP_PROJECT:-followup-crazykalo27}"
REGION="${REGION:-us-west1}"
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-czakwfzjkhsaysvqeswc}"

if [[ -z "${OSINT_WORKER_SECRET:-}" ]]; then
  echo "Set OSINT_WORKER_SECRET first, e.g.:" >&2
  echo '  export OSINT_WORKER_SECRET=$(openssl rand -hex 32)' >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

gcloud config set project "$GCP_PROJECT"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com

cd "$ROOT_DIR"

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --project "$GCP_PROJECT" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "OSINT_WORKER_SECRET=${OSINT_WORKER_SECRET}" \
  --timeout 60 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 5 \
  --port 8080

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" \
  --project "$GCP_PROJECT" \
  --region "$REGION" \
  --format='value(status.url)')"

echo ""
echo "SERVICE_URL=$SERVICE_URL"
echo ""
echo "Supabase (from FollowUp repo root):"
echo "  cd \"$(cd "$ROOT_DIR/../.." && pwd)\""
echo "  npx supabase secrets set OSINT_WORKER_URL=\"$SERVICE_URL\""
echo "  npx supabase secrets set OSINT_WORKER_SECRET=\"$OSINT_WORKER_SECRET\""
echo "  npx supabase functions deploy run-search --project-ref $SUPABASE_PROJECT_REF"
