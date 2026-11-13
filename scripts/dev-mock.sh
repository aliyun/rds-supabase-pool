#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

command -v deno >/dev/null 2>&1 || {
  echo "缺少 deno，请先安装 Deno 2.x：https://deno.com/manual/getting_started/installation" >&2
  exit 1
}

DB_NAME="${POOL_DEV_DB:-pool_control_dev}"
CONTROL_DB_URL="${CONTROL_DB_URL:-postgres://$(id -un)@127.0.0.1:5432/${DB_NAME}?sslmode=disable}"
CONTROL_ADMIN_DB_NAME="${CONTROL_ADMIN_DB_NAME:-$DB_NAME}"
PLATFORM_JWT_SECRET="${PLATFORM_JWT_SECRET:-local-development-secret-change-me}"
CLOUD_MODE="${CLOUD_MODE:-mock}"
PORT="${PORT:-8000}"
VITE_API_PROXY_TARGET="${VITE_API_PROXY_TARGET:-http://127.0.0.1:${PORT}}"

if command -v createdb >/dev/null 2>&1; then
  createdb "$DB_NAME" 2>/dev/null || true
fi

if [ ! -d "$ROOT/frontend/node_modules" ]; then
  (cd "$ROOT/frontend" && npm ci)
fi

echo "==> mock API :${PORT}"
PORT="$PORT" \
CONTROL_DB_URL="$CONTROL_DB_URL" \
CONTROL_ADMIN_DB_NAME="$CONTROL_ADMIN_DB_NAME" \
PLATFORM_JWT_SECRET="$PLATFORM_JWT_SECRET" \
CLOUD_MODE="$CLOUD_MODE" \
AUTO_WHITELIST=false \
deno run --allow-net --allow-env --allow-read "$ROOT/edge/index.ts" &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' EXIT

echo "==> UI :5173"
cd "$ROOT/frontend"
VITE_API_PROXY_TARGET="$VITE_API_PROXY_TARGET" npm run dev
