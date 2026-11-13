#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 推荐模式：只提供 INSTANCE_NAME，自动解析域名、service key、地域和 PG 地址。
RESOLVED_FILE=""
INIT_CONTROL_DB="${INIT_CONTROL_DB:-true}"
if [ -n "${INSTANCE_NAME:-}" ]; then
  POOL_ADMIN_USER="${POOL_ADMIN_USER:-pool_admin}"
  POOL_CONTROL_DB="${POOL_CONTROL_DB:-pool_control}"
  RESOLVED_FILE="$(mktemp)"
  chmod 600 "$RESOLVED_FILE"
  RESOLVE_ARGS=(--instance "$INSTANCE_NAME" --output "$RESOLVED_FILE")
  if [ -n "${REGION:-}" ]; then
    RESOLVE_ARGS+=(--region "$REGION")
  fi
  if [ "${INIT_CONTROL_DB}" != "false" ] && [ -z "${CONTROL_DB_URL:-}" ]; then
    : "${POOL_ADMIN_PASSWORD:?初始化 pool_admin / pool_control 需要 POOL_ADMIN_PASSWORD}"
    RESOLVE_ARGS+=(
      --init-control-db
      --admin-user "$POOL_ADMIN_USER"
      --admin-password "$POOL_ADMIN_PASSWORD"
      --control-db "$POOL_CONTROL_DB"
    )
  fi
  python3 "$ROOT/edge/resolve_instance.py" "${RESOLVE_ARGS[@]}"

  eval "$(python3 -c '
import json, shlex, sys
data = json.load(open(sys.argv[1]))
for key, variable in {
    "supabase_url": "RESOLVED_SUPABASE_URL",
    "service_key": "RESOLVED_SERVICE_KEY",
    "region": "RESOLVED_REGION",
    "pg_host": "RESOLVED_PG_HOST",
    "pg_port": "RESOLVED_PG_PORT",
    "pg_sslmode": "RESOLVED_PG_SSLMODE",
    "access_key_id": "RESOLVED_AK",
    "access_key_secret": "RESOLVED_SK",
    "security_token": "RESOLVED_TOKEN",
}.items():
    if data.get(key):
        print(f"{variable}={shlex.quote(str(data[key]))}")
' "$RESOLVED_FILE")"

  SUPABASE_URL="${SUPABASE_URL:-$RESOLVED_SUPABASE_URL}"
  SUPABASE_SERVICE_KEY="${SUPABASE_SERVICE_KEY:-$RESOLVED_SERVICE_KEY}"
  DEFAULT_REGION="${DEFAULT_REGION:-$RESOLVED_REGION}"
  ALIBABA_CLOUD_ACCESS_KEY_ID="${ALIBABA_CLOUD_ACCESS_KEY_ID:-$RESOLVED_AK}"
  ALIBABA_CLOUD_ACCESS_KEY_SECRET="${ALIBABA_CLOUD_ACCESS_KEY_SECRET:-$RESOLVED_SK}"
  ALIBABA_CLOUD_SECURITY_TOKEN="${ALIBABA_CLOUD_SECURITY_TOKEN:-${RESOLVED_TOKEN:-}}"

  if [ -z "${CONTROL_DB_URL:-}" ]; then
    : "${POOL_ADMIN_PASSWORD:?自动模式需要 POOL_ADMIN_PASSWORD}"
    CONTROL_DB_URL="$(python3 -c '
import sys, urllib.parse
user, password, host, port, database, sslmode = sys.argv[1:7]
user_enc = urllib.parse.quote(user, safe="")
password_enc = urllib.parse.quote(password, safe="")
print("postgres://" + user_enc + ":" + password_enc + "@" + host + ":" + port + "/" + database + "?sslmode=" + sslmode)
' "$POOL_ADMIN_USER" "$POOL_ADMIN_PASSWORD" "$RESOLVED_PG_HOST" "$RESOLVED_PG_PORT" "$POOL_CONTROL_DB" "${RESOLVED_PG_SSLMODE:-require}")"
  fi
fi

: "${SUPABASE_URL:?请设置 INSTANCE_NAME（推荐）或 SUPABASE_URL}"
: "${SUPABASE_SERVICE_KEY:?请设置 INSTANCE_NAME（推荐）或 SUPABASE_SERVICE_KEY}"
: "${CONTROL_DB_URL:?请设置 INSTANCE_NAME + POOL_ADMIN_PASSWORD（推荐）或 CONTROL_DB_URL}"
: "${ALIBABA_CLOUD_ACCESS_KEY_ID:?请设置 ALIBABA_CLOUD_ACCESS_KEY_ID 或 ALIBABA_CLOUD_PROFILE}"
: "${ALIBABA_CLOUD_ACCESS_KEY_SECRET:?请设置 ALIBABA_CLOUD_ACCESS_KEY_SECRET 或 ALIBABA_CLOUD_PROFILE}"
: "${DEFAULT_REGION:?请设置 INSTANCE_NAME（推荐）或 DEFAULT_REGION}"

SUPABASE_URL="${SUPABASE_URL%/}"
case "$CONTROL_DB_URL" in
  */supabase_db*)
    echo "CONTROL_DB_URL 不能指向 supabase_db；请使用独立的 pool_control 数据库。" >&2
    exit 1
    ;;
esac
CLOUD_MODE="${CLOUD_MODE:-mock}"
if [ "$CLOUD_MODE" = "real" ]; then
  echo "警告：CLOUD_MODE=real 会创建真实云资源并产生费用；请确认使用测试账号并已配置预算告警。" >&2
fi
AUTO_WHITELIST="${AUTO_WHITELIST:-true}"
DEPLOY_UI="${DEPLOY_UI:-1}"

WORKER_TOKEN="${WORKER_TOKEN:-$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')}"
PLATFORM_JWT_SECRET="${PLATFORM_JWT_SECRET:-$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')}"
SUPABASE_DASHBOARD_PASSWORD="${SUPABASE_DASHBOARD_PASSWORD:-$(python3 -c 'import secrets; print(secrets.token_urlsafe(18))')}"
SUPABASE_DATABASE_PASSWORD="${SUPABASE_DATABASE_PASSWORD:-$(python3 -c 'import secrets; print(secrets.token_urlsafe(18))')}"

for command in curl python3; do
  command -v "$command" >/dev/null 2>&1 || { echo "缺少命令：$command"; exit 1; }
done
if [ "$DEPLOY_UI" = "1" ]; then
  for command in node npm; do
    command -v "$command" >/dev/null 2>&1 || { echo "缺少命令：$command（构建 UI 需要 Node.js）"; exit 1; }
  done
fi

SECRETS_FILE="$(mktemp)"
RESPONSE_FILE="$(mktemp)"
CLEANUP_FILES=("$SECRETS_FILE" "$RESPONSE_FILE")
if [ -n "$RESOLVED_FILE" ]; then
  CLEANUP_FILES+=("$RESOLVED_FILE")
fi
trap 'rm -f "${CLEANUP_FILES[@]}"' EXIT
chmod 600 "$SECRETS_FILE"

WORKER_TOKEN="$WORKER_TOKEN" \
PLATFORM_JWT_SECRET="$PLATFORM_JWT_SECRET" \
SUPABASE_DASHBOARD_PASSWORD="$SUPABASE_DASHBOARD_PASSWORD" \
SUPABASE_DATABASE_PASSWORD="$SUPABASE_DATABASE_PASSWORD" \
CLOUD_MODE="$CLOUD_MODE" \
AUTO_WHITELIST="$AUTO_WHITELIST" \
DEFAULT_REGION="$DEFAULT_REGION" \
CONTROL_DB_URL="$CONTROL_DB_URL" \
ALIBABA_CLOUD_ACCESS_KEY_ID="$ALIBABA_CLOUD_ACCESS_KEY_ID" \
ALIBABA_CLOUD_ACCESS_KEY_SECRET="$ALIBABA_CLOUD_ACCESS_KEY_SECRET" \
ALIBABA_CLOUD_SECURITY_TOKEN="${ALIBABA_CLOUD_SECURITY_TOKEN:-}" \
python3 - "$SECRETS_FILE" <<'PY'
import json
import os
import sys

names = [
    "CONTROL_DB_URL",
    "PLATFORM_JWT_SECRET",
    "WORKER_TOKEN",
    "CLOUD_MODE",
    "AUTO_WHITELIST",
    "DEFAULT_REGION",
    "ALIBABA_CLOUD_ACCESS_KEY_ID",
    "ALIBABA_CLOUD_ACCESS_KEY_SECRET",
    "ALIBABA_CLOUD_SECURITY_TOKEN",
    "SUPABASE_DASHBOARD_PASSWORD",
    "SUPABASE_DATABASE_PASSWORD",
]
payload = [{"name": name, "value": os.environ[name]} for name in names if os.environ.get(name)]
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(payload, handle)
PY

echo "==> 写入 Edge Secrets"
HTTP_CODE=$(curl -sS -o "$RESPONSE_FILE" -w '%{http_code}' -m 120 \
  -X POST "$SUPABASE_URL/secrets/v1" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @"$SECRETS_FILE")
if [ "${HTTP_CODE:0:1}" != "2" ]; then
  HTTP_CODE=$(curl -sS -o "$RESPONSE_FILE" -w '%{http_code}' -m 120 \
    -X PUT "$SUPABASE_URL/secrets/v1" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
    -H "Content-Type: application/json" \
    --data-binary @"$SECRETS_FILE")
fi
if [ "${HTTP_CODE:0:1}" != "2" ]; then
  echo "Secret 写入失败（HTTP $HTTP_CODE）："
  cat "$RESPONSE_FILE"
  exit 1
fi
echo "Secrets 已写入"

umask 077
BOOTSTRAP_ENV="$ROOT/edge/.bootstrap.env"
printf '%s\n' \
  "# generated by edge/bootstrap.sh; keep this file private" \
  "export WORKER_TOKEN='$WORKER_TOKEN'" \
  "export SUPABASE_URL='$SUPABASE_URL'" \
  "export SUPABASE_SERVICE_KEY='$SUPABASE_SERVICE_KEY'" \
  "export DEPLOY_UI='$DEPLOY_UI'" \
  > "$BOOTSTRAP_ENV"
chmod 600 "$BOOTSTRAP_ENV"

echo "==> 部署 pool-api / pool-ui 并重挂调度"
SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY" \
WORKER_TOKEN="$WORKER_TOKEN" \
DEPLOY_UI="$DEPLOY_UI" \
"$ROOT/edge/deploy.sh"

echo "==> 健康检查"
HEALTH_URL="$SUPABASE_URL/functions/v1/pool-api/api/health"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS -m 15 "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"'; then
    ok=1
    break
  fi
  sleep 2
done
if [ "$ok" != "1" ]; then
  echo "健康检查未通过：$HEALTH_URL"
  echo "请检查 CONTROL_DB_URL、PG 白名单和 Edge Secrets。"
  exit 1
fi

echo
echo "部署完成："
echo "  管理台：$SUPABASE_URL/functions/v1/pool-ui/"
echo "  使用者门户：$SUPABASE_URL/functions/v1/pool-ui/portal"
echo "  API：$SUPABASE_URL/functions/v1/pool-api/api"
echo
echo "下一步："
echo "  1. 打开管理台，首次进入创建管理员账号"
echo "  2. 设置与预检 → 确认真实模式和预检"
echo "  3. 地域与资源池 → 新增地域（VPC / VSwitch）"
echo "  4. 共享池添加 Running 的真实 PG，或对单租池执行预热"
echo
echo "worker token 已保存到 edge/.bootstrap.env（请备份）。"
echo "后续重新部署只需要："
echo "  export SUPABASE_URL=... SUPABASE_SERVICE_KEY=..."
echo "  ./edge/deploy.sh"
echo "deploy.sh 会自动读取 edge/.bootstrap.env 中的 worker token。"
