#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/edge/.bootstrap.env"
TMP_DIR="$(mktemp -d)"
chmod 700 "$TMP_DIR"
ENV_TMP=""
trap 'rm -rf "$TMP_DIR"; if [ -n "${ENV_TMP:-}" ]; then rm -f "$ENV_TMP"; fi' EXIT

for command in curl python3; do
  command -v "$command" >/dev/null 2>&1 || { echo "缺少命令：$command" >&2; exit 1; }
done

CALLER_SUPABASE_URL="${SUPABASE_URL:-}"
CALLER_SUPABASE_SERVICE_KEY="${SUPABASE_SERVICE_KEY:-}"
CALLER_WORKER_TOKEN="${WORKER_TOKEN:-}"
CALLER_RESET_WORKER_TOKEN="${RESET_WORKER_TOKEN:-0}"
CALLER_DEPLOY_UI="${DEPLOY_UI:-}"
CALLER_UI_TAG="${POOL_UI_RELEASE_TAG:-}"
CALLER_UI_REPO="${POOL_UI_RELEASE_REPO:-}"
CALLER_UI_URL="${POOL_UI_RELEASE_URL:-}"
CALLER_UI_CHECKSUM_URL="${POOL_UI_RELEASE_CHECKSUM_URL:-}"
CALLER_DINGTALK_WEBHOOK="${DINGTALK_WEBHOOK:-}"
CALLER_DINGTALK_SECRET="${DINGTALK_SECRET:-}"
HAD_ENV_FILE=0

if [ -f "$ENV_FILE" ]; then
  HAD_ENV_FILE=1
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

[ -n "$CALLER_SUPABASE_URL" ] && SUPABASE_URL="$CALLER_SUPABASE_URL"
[ -n "$CALLER_SUPABASE_SERVICE_KEY" ] && SUPABASE_SERVICE_KEY="$CALLER_SUPABASE_SERVICE_KEY"
[ -n "$CALLER_WORKER_TOKEN" ] && WORKER_TOKEN="$CALLER_WORKER_TOKEN"
[ -n "$CALLER_DEPLOY_UI" ] && DEPLOY_UI="$CALLER_DEPLOY_UI"
[ -n "$CALLER_UI_TAG" ] && POOL_UI_RELEASE_TAG="$CALLER_UI_TAG"
[ -n "$CALLER_UI_REPO" ] && POOL_UI_RELEASE_REPO="$CALLER_UI_REPO"
[ -n "$CALLER_UI_URL" ] && POOL_UI_RELEASE_URL="$CALLER_UI_URL"
[ -n "$CALLER_UI_CHECKSUM_URL" ] && POOL_UI_RELEASE_CHECKSUM_URL="$CALLER_UI_CHECKSUM_URL"
[ -n "$CALLER_DINGTALK_WEBHOOK" ] && DINGTALK_WEBHOOK="$CALLER_DINGTALK_WEBHOOK"
[ -n "$CALLER_DINGTALK_SECRET" ] && DINGTALK_SECRET="$CALLER_DINGTALK_SECRET"
RESET_WORKER_TOKEN="$CALLER_RESET_WORKER_TOKEN"

case "$RESET_WORKER_TOKEN" in
  0|1) ;;
  *)
    echo "RESET_WORKER_TOKEN 仅支持 0 或 1，当前值：$RESET_WORKER_TOKEN" >&2
    exit 1
    ;;
esac

if [ "$RESET_WORKER_TOKEN" != "1" ] && [ -z "${WORKER_TOKEN:-}" ]; then
  echo "缺少 WORKER_TOKEN。" >&2
  echo "请提供原 WORKER_TOKEN，或设置 RESET_WORKER_TOKEN=1 生成新 token。" >&2
  exit 1
fi

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_KEY:-}" ]; then
  if [ -z "${INSTANCE_NAME:-}" ]; then
    echo "未找到 $ENV_FILE，且缺少 SUPABASE_URL / SUPABASE_SERVICE_KEY。" >&2
    echo "请提供 INSTANCE_NAME + REGION + AK/SK，或显式提供 SUPABASE_URL 和 SUPABASE_SERVICE_KEY。" >&2
    exit 1
  fi
  RESOLVED_FILE="$TMP_DIR/resolved.json"
  RESOLVE_ARGS=(--instance "$INSTANCE_NAME" --output "$RESOLVED_FILE")
  if [ -n "${REGION:-}" ]; then
    RESOLVE_ARGS+=(--region "$REGION")
  fi
  echo "==> resolve control-plane instance: $INSTANCE_NAME"
  python3 "$ROOT/edge/resolve_instance.py" "${RESOLVE_ARGS[@]}" >/dev/null
  RESOLVED_SUPABASE_URL="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("supabase_url", ""))' "$RESOLVED_FILE")"
  RESOLVED_SERVICE_KEY="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("service_key", ""))' "$RESOLVED_FILE")"
  [ -z "${SUPABASE_URL:-}" ] && SUPABASE_URL="$RESOLVED_SUPABASE_URL"
  [ -z "${SUPABASE_SERVICE_KEY:-}" ] && SUPABASE_SERVICE_KEY="$RESOLVED_SERVICE_KEY"
  rm -f "$RESOLVED_FILE"
fi

if [ -z "${SUPABASE_URL:-}" ]; then
  echo "无法确定 SUPABASE_URL。" >&2
  exit 1
fi
if [ -z "${SUPABASE_SERVICE_KEY:-}" ]; then
  echo "无法确定 SUPABASE_SERVICE_KEY。" >&2
  exit 1
fi
SUPABASE_URL="${SUPABASE_URL%/}"
BASE="$SUPABASE_URL"

if [ "$RESET_WORKER_TOKEN" = "1" ]; then
  if [ -n "$CALLER_WORKER_TOKEN" ]; then
    WORKER_TOKEN="$CALLER_WORKER_TOKEN"
    echo "==> reset WORKER_TOKEN using the caller-provided token"
  else
    WORKER_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
    echo "==> generated a new WORKER_TOKEN"
  fi
fi

# Existing installations should get the release UI by default, but keep the
# tag saved by the initial deployment. Caller overrides still win.
export SUPABASE_URL SUPABASE_SERVICE_KEY WORKER_TOKEN
export DEPLOY_UI="${CALLER_DEPLOY_UI:-release}"
export POOL_UI_RELEASE_TAG="${CALLER_UI_TAG:-${POOL_UI_RELEASE_TAG:-v0.1.2}}"
[ -n "${POOL_UI_RELEASE_REPO:-}" ] && export POOL_UI_RELEASE_REPO
[ -n "${POOL_UI_RELEASE_URL:-}" ] && export POOL_UI_RELEASE_URL
[ -n "${POOL_UI_RELEASE_CHECKSUM_URL:-}" ] && export POOL_UI_RELEASE_CHECKSUM_URL
[ -n "${DINGTALK_WEBHOOK:-}" ] && export DINGTALK_WEBHOOK
[ -n "${DINGTALK_SECRET:-}" ] && export DINGTALK_SECRET

PERSIST_ENV=0
if [ "$HAD_ENV_FILE" -eq 0 ] || [ "$RESET_WORKER_TOKEN" = "1" ]; then
  PERSIST_ENV=1
fi
if [ "$PERSIST_ENV" = "1" ] && [ ! -w "$(dirname "$ENV_FILE")" ]; then
  echo "无法写入部署配置：$(dirname "$ENV_FILE") 不可写。" >&2
  exit 1
fi

update_worker_token_secret() {
  local secret_file="$TMP_DIR/worker-token.json"
  local response_file="$TMP_DIR/secrets-response.json"
  local http_code

  WORKER_TOKEN="$WORKER_TOKEN" python3 - "$secret_file" <<'PY'
import json
import os
import sys

payload = [{"name": "WORKER_TOKEN", "value": os.environ["WORKER_TOKEN"]}]
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(payload, handle)
PY
  chmod 600 "$secret_file"

  http_code="$(curl -sS -o "$response_file" -w '%{http_code}' -m 120 \
    -X POST "$BASE/secrets/v1" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
    -H 'Content-Type: application/json' \
    --data-binary @"$secret_file")"
  if [ "${http_code:0:1}" != "2" ]; then
    http_code="$(curl -sS -o "$response_file" -w '%{http_code}' -m 120 \
      -X PUT "$BASE/secrets/v1" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
      -H 'Content-Type: application/json' \
      --data-binary @"$secret_file")"
  fi
  if [ "${http_code:0:1}" != "2" ]; then
    echo "WORKER_TOKEN Edge Secret 写入失败（HTTP $http_code）：" >&2
    cat "$response_file" >&2 || true
    exit 1
  fi
}

persist_deploy_env() {
  ENV_TMP="$(mktemp "$ENV_FILE.XXXXXX")"
  WORKER_TOKEN="$WORKER_TOKEN" \
  SUPABASE_URL="$SUPABASE_URL" \
  SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY" \
  DEPLOY_UI="$DEPLOY_UI" \
  POOL_UI_RELEASE_TAG="${POOL_UI_RELEASE_TAG:-}" \
  POOL_UI_RELEASE_REPO="${POOL_UI_RELEASE_REPO:-}" \
  POOL_UI_RELEASE_URL="${POOL_UI_RELEASE_URL:-}" \
  POOL_UI_RELEASE_CHECKSUM_URL="${POOL_UI_RELEASE_CHECKSUM_URL:-}" \
  python3 - "$ENV_TMP" <<'PY'
import os
import shlex
import sys

lines = [
    "# generated by edge/upgrade.sh; keep this file private",
    f"export WORKER_TOKEN={shlex.quote(os.environ['WORKER_TOKEN'])}",
    f"export SUPABASE_URL={shlex.quote(os.environ['SUPABASE_URL'])}",
    f"export SUPABASE_SERVICE_KEY={shlex.quote(os.environ['SUPABASE_SERVICE_KEY'])}",
    f"export DEPLOY_UI={shlex.quote(os.environ['DEPLOY_UI'])}",
]
for key in (
    "POOL_UI_RELEASE_TAG",
    "POOL_UI_RELEASE_REPO",
    "POOL_UI_RELEASE_URL",
    "POOL_UI_RELEASE_CHECKSUM_URL",
):
    value = os.environ.get(key, "")
    if value:
        lines.append(f"export {key}={shlex.quote(value)}")
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    handle.write("\n".join(lines) + "\n")
PY
  chmod 600 "$ENV_TMP"
  mv "$ENV_TMP" "$ENV_FILE"
  ENV_TMP=""
}

if [ "$RESET_WORKER_TOKEN" = "1" ]; then
  echo "==> update WORKER_TOKEN Edge Secret"
  update_worker_token_secret
fi

if [ "$PERSIST_ENV" = "1" ]; then
  persist_deploy_env
  echo "==> deployment config saved to $ENV_FILE"
fi

echo "==> upgrade existing deployment"
"$ROOT/edge/deploy.sh"

echo "==> health check"
HEALTH_OK=0
for _ in $(seq 1 30); do
  if curl -fsS -m 15 "$BASE/functions/v1/pool-api/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done

if [ "$HEALTH_OK" -ne 1 ]; then
  echo "部署已完成，但健康检查未通过：$BASE/functions/v1/pool-api/api/health" >&2
  exit 1
fi

TICK_FILE="$TMP_DIR/tick.json"
STATUS_FILE="$TMP_DIR/scheduler-status.json"

echo "==> worker tick check"
TICK_HTTP="$(curl -sS -m 75 -o "$TICK_FILE" -w '%{http_code}' \
  -X POST "$BASE/functions/v1/pool-api/api/internal/worker/tick" \
  -H "X-Worker-Token: $WORKER_TOKEN" || true)"
if [ "${TICK_HTTP:0:1}" != "2" ]; then
  echo "worker tick 调用失败（HTTP ${TICK_HTTP:-000}）：" >&2
  cat "$TICK_FILE" >&2 || true
  exit 1
fi
python3 - "$TICK_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
print(f"worker tick: ok (processed={data.get('processed', 0)})")
PY

echo "==> scheduler check"
SCHED_HTTP="$(curl -sS -m 30 -o "$STATUS_FILE" -w '%{http_code}' \
  "$BASE/functions/v1/pool-api/api/internal/scheduler/status" \
  -H "X-Worker-Token: $WORKER_TOKEN" || true)"
if [ "${SCHED_HTTP:0:1}" != "2" ]; then
  echo "scheduler status 调用失败（HTTP ${SCHED_HTTP:-000}）：" >&2
  cat "$STATUS_FILE" >&2 || true
  exit 1
fi
python3 - "$STATUS_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
jobs = {job.get("jobname"): job for job in data.get("jobs", []) if isinstance(job, dict)}
heartbeats = {item.get("component"): item for item in data.get("heartbeat", []) if isinstance(item, dict)}
problems = []
for name in ("pool-worker-tick", "pool-health-watchdog"):
    job = jobs.get(name)
    if not job:
        problems.append(f"{name} 缺失")
    elif not job.get("active"):
        problems.append(f"{name} 未启用")
for component in ("pool-api", "pool-worker"):
    if component not in heartbeats:
        problems.append(f"{component} heartbeat 缺失")
if problems:
    print("scheduler check failed: " + "; ".join(problems), file=sys.stderr)
    sys.exit(1)
print("scheduler: pool-worker-tick active, pool-health-watchdog active")
print("heartbeat: pool-api and pool-worker present")
PY

echo "upgrade completed: $BASE/functions/v1/pool-ui/"
