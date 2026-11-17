#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SAVED_URL="${SUPABASE_URL:-}"
SAVED_KEY="${SUPABASE_SERVICE_KEY:-}"
SAVED_TOKEN="${WORKER_TOKEN:-}"
SAVED_DEPLOY_UI="${DEPLOY_UI:-}"
SAVED_UI_TAG="${POOL_UI_RELEASE_TAG:-}"
SAVED_UI_REPO="${POOL_UI_RELEASE_REPO:-}"
SAVED_UI_URL="${POOL_UI_RELEASE_URL:-}"
SAVED_UI_CHECKSUM_URL="${POOL_UI_RELEASE_CHECKSUM_URL:-}"
if [ -f "$ROOT/edge/.bootstrap.env" ]; then
  # shellcheck disable=SC1091
  . "$ROOT/edge/.bootstrap.env"
fi
[ -n "$SAVED_URL" ] && SUPABASE_URL="$SAVED_URL"
[ -n "$SAVED_KEY" ] && SUPABASE_SERVICE_KEY="$SAVED_KEY"
[ -n "$SAVED_TOKEN" ] && WORKER_TOKEN="$SAVED_TOKEN"
[ -n "$SAVED_DEPLOY_UI" ] && DEPLOY_UI="$SAVED_DEPLOY_UI"
[ -n "$SAVED_UI_TAG" ] && POOL_UI_RELEASE_TAG="$SAVED_UI_TAG"
[ -n "$SAVED_UI_REPO" ] && POOL_UI_RELEASE_REPO="$SAVED_UI_REPO"
[ -n "$SAVED_UI_URL" ] && POOL_UI_RELEASE_URL="$SAVED_UI_URL"
[ -n "$SAVED_UI_CHECKSUM_URL" ] && POOL_UI_RELEASE_CHECKSUM_URL="$SAVED_UI_CHECKSUM_URL"
: "${SUPABASE_URL:?请设置 SUPABASE_URL，例如 http://<edge-host>}"
: "${SUPABASE_SERVICE_KEY:?请设置 SUPABASE_SERVICE_KEY}"
: "${WORKER_TOKEN:?请设置 WORKER_TOKEN}"
BASE="${SUPABASE_URL%/}"

UI_MODE="${DEPLOY_UI:-0}"
case "$UI_MODE" in
  1|source) UI_MODE=source ;;
  0|release) ;;
  *)
    echo "DEPLOY_UI 仅支持 source、release 或 0，当前值：$UI_MODE" >&2
    exit 1
    ;;
esac

deploy() {
  local slug="$1"
  local file="$2"
  local response
  response=$(curl -fsS -m 180 -X POST "$BASE/functions/v1/manage/deploy?slug=$slug" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
    -F 'metadata={"verify_jwt":false,"entrypoint_path":"index.ts"};type=application/json' \
    -F "file=@${file};filename=index.ts")
  printf '%s\n' "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"deployed {d.get('slug')} v{d.get('version')} {d.get('status')}\")"
}

echo "==> pool-api"
deploy pool-api "$ROOT/edge/index.ts"

echo "==> scheduler"
curl -fsS -m 120 -X POST "$BASE/functions/v1/pool-api/api/internal/scheduler/setup" \
  -H "X-Worker-Token: $WORKER_TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('scheduler', d.get('ok'), d.get('tick_url'), d.get('job'))"

if [ "$UI_MODE" = "source" ]; then
  echo "==> build ui"
  if [ ! -d "$ROOT/frontend/node_modules" ]; then
    echo "==> 安装前端依赖"
    (cd "$ROOT/frontend" && npm ci >/dev/null)
  fi
  (cd "$ROOT/frontend" && VITE_BASE_PATH=/functions/v1/pool-ui/ npm run build >/dev/null)
  node "$ROOT/edge/build-ui.mjs"
  echo "==> pool-ui"
  deploy pool-ui "$ROOT/edge/.build/pool-ui.ts"
elif [ "$UI_MODE" = "release" ]; then
  echo "==> fetch ui release"
  "$ROOT/edge/fetch-ui-release.sh" "$ROOT/edge/.build/pool-ui.ts"
  echo "==> pool-ui"
  deploy pool-ui "$ROOT/edge/.build/pool-ui.ts"
fi
