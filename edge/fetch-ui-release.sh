#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${POOL_UI_RELEASE_TAG:-}"
if [ -z "$TAG" ]; then
  echo "DEPLOY_UI=release 需要设置 POOL_UI_RELEASE_TAG，例如 v0.1.0" >&2
  exit 1
fi
case "$TAG" in
  *[!A-Za-z0-9._-]*)
    echo "POOL_UI_RELEASE_TAG 含有不支持的字符：$TAG" >&2
    exit 1
    ;;
esac

REPO="${POOL_UI_RELEASE_REPO:-aliyun/rds-supabase-pool}"
ARTIFACT_NAME="pool-ui-${TAG}.ts"
URL="${POOL_UI_RELEASE_URL:-https://github.com/${REPO}/releases/download/${TAG}/${ARTIFACT_NAME}}"
CHECKSUM_URL="${POOL_UI_RELEASE_CHECKSUM_URL:-${URL}.sha256}"
OUT="${1:-$ROOT/edge/.build/pool-ui.ts}"
TMP_CHECK="$(mktemp)"
trap 'rm -f "$TMP_CHECK"' EXIT

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"

case "$URL" in
  https://*) ;;
  *) echo "警告：UI 产物不是 HTTPS URL：$URL" >&2 ;;
esac

echo "==> 下载 UI Release 产物"
echo "    $URL"
curl -fsSL --retry 3 --connect-timeout 15 --max-time 300 -o "$OUT" "$URL"
curl -fsSL --retry 3 --connect-timeout 15 --max-time 60 -o "$TMP_CHECK" "$CHECKSUM_URL"

EXPECTED="$(awk 'NR == 1 { print $1 }' "$TMP_CHECK")"
if [ -z "$EXPECTED" ]; then
  echo "SHA256 校验文件为空：$CHECKSUM_URL" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$OUT" | awk '{ print $1 }')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "$OUT" | awk '{ print $1 }')"
else
  echo "缺少 sha256sum 或 shasum，无法校验 UI 产物" >&2
  exit 1
fi

if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "SHA256 校验失败" >&2
  echo "expected: $EXPECTED" >&2
  echo "actual:   $ACTUAL" >&2
  rm -f "$OUT"
  exit 1
fi

echo "SHA256 校验通过：$ACTUAL"
printf '%s\n' "$OUT"
