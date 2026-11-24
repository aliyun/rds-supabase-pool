#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/edge/.bootstrap.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "未找到 $ENV_FILE。" >&2
  echo "请先完成首次部署；如文件已丢失，需要按部署文档恢复部署配置。" >&2
  exit 1
fi

CALLER_DEPLOY_UI="${DEPLOY_UI:-}"
CALLER_UI_TAG="${POOL_UI_RELEASE_TAG:-}"

# Existing installations should get the release UI by default, but keep the
# tag saved by the initial deployment. Caller overrides still win.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
export DEPLOY_UI="${CALLER_DEPLOY_UI:-release}"
export POOL_UI_RELEASE_TAG="${CALLER_UI_TAG:-${POOL_UI_RELEASE_TAG:-v0.1.1}}"

echo "==> upgrade existing deployment"
"$ROOT/edge/deploy.sh"

# Reuse the endpoint loaded above for the smoke check.
BASE="${SUPABASE_URL%/}"

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

TICK_FILE="$(mktemp)"
STATUS_FILE="$(mktemp)"
trap 'rm -f "$TICK_FILE" "$STATUS_FILE"' EXIT

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
