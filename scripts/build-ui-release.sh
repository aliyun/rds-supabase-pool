#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${1:-}"
if [ -z "$TAG" ]; then
  echo "用法：$0 <release-tag> [output-dir]" >&2
  echo "例如：$0 v0.1.0" >&2
  exit 1
fi
case "$TAG" in
  *[!A-Za-z0-9._-]*)
    echo "release tag 含有不支持的字符：$TAG" >&2
    exit 1
    ;;
esac

OUT_DIR="${2:-$ROOT/edge/.build/release}"
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "==> 安装前端依赖"
  (cd "$ROOT/frontend" && npm ci)
fi

echo "==> 构建前端"
(cd "$ROOT/frontend" && VITE_BASE_PATH=/functions/v1/pool-ui/ npm run build >/dev/null)

echo "==> 生成 pool-ui Edge Function"
node "$ROOT/edge/build-ui.mjs"

mkdir -p "$OUT_DIR"
ARTIFACT="$OUT_DIR/pool-ui-${TAG}.ts"
cp "$ROOT/edge/.build/pool-ui.ts" "$ARTIFACT"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUT_DIR" && sha256sum "pool-ui-${TAG}.ts" > "pool-ui-${TAG}.ts.sha256")
elif command -v shasum >/dev/null 2>&1; then
  (cd "$OUT_DIR" && shasum -a 256 "pool-ui-${TAG}.ts" > "pool-ui-${TAG}.ts.sha256")
else
  echo "缺少 sha256sum 或 shasum，无法生成校验文件" >&2
  exit 1
fi

echo
echo "Release 产物："
echo "  $ARTIFACT"
echo "  $ARTIFACT.sha256"
echo
echo "将这两个文件上传到 GitHub Release："
echo "  https://github.com/aliyun/rds-supabase-pool/releases/new?tag=${TAG}"
