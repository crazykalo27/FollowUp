#!/usr/bin/env bash
# Build the SPA locally and push to gh-pages (no GitHub Actions runners needed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/web"

if [[ -f .env ]]; then
  set -a
  # shellcheck source=/dev/null
  source .env
  set +a
fi

export VITE_BASE_PATH="${VITE_BASE_PATH:-/FollowUp/}"
: "${VITE_SUPABASE_URL:?Set VITE_SUPABASE_URL in web/.env}"
: "${VITE_SUPABASE_ANON_KEY:?Set VITE_SUPABASE_ANON_KEY in web/.env}"

npm ci
npm run build
cp dist/index.html dist/404.html

cd "$ROOT"
npx --yes gh-pages@6.3.0 -d web/dist -b gh-pages -m "Deploy from local build"

echo "Done. In GitHub: Settings → Pages → Deploy from branch → gh-pages → / (root)"
