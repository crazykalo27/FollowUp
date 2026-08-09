#!/usr/bin/env bash
# Deploy every Edge Function in supabase/functions to the linked Supabase project.
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-czakwfzjkhsaysvqeswc}"

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "Set SUPABASE_ACCESS_TOKEN (supabase login or dashboard access token)." >&2
  exit 1
fi

cd "$(dirname "$0")/.."
npx supabase functions deploy --project-ref "$PROJECT_REF"

echo "Deployed all functions to project $PROJECT_REF"
