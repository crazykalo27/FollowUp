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

# npm ci can fail on macOS (ENOTEMPTY under node_modules/@rolldown); install is enough here.
if [[ ! -d node_modules ]]; then
  npm install --no-audit --no-fund
else
  npm install --no-audit --no-fund --prefer-offline
fi
npm run build
cp dist/index.html dist/404.html

CACHE_DIR="${ROOT}/.cache"
mkdir -p "$CACHE_DIR"
export CACHE_DIR

REPO_URL="$(git -C "$ROOT" config --get remote.origin.url || true)"
GH_PAGES_ARGS=(-d dist -b gh-pages -m "Deploy from local build")
if [[ -n "$REPO_URL" ]]; then
  GH_PAGES_ARGS+=(-r "$REPO_URL")
fi

npx --yes gh-pages@6.3.0 "${GH_PAGES_ARGS[@]}"

echo "Done. In GitHub: Settings → Pages → Deploy from branch → gh-pages → / (root)"
