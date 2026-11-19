# Deployment quick start (English)

For the full Chinese guide, including RAM policy examples and troubleshooting,
see [deployment.md](deployment.md).

## 1. Create the control-plane instance

Create one RDS Supabase instance in the target region, enable Agent Runtime,
wait for `Running`, and note:

- `INSTANCE_NAME`
- a strong `POOL_ADMIN_PASSWORD`
- a reachable HTTPS domain
- RAM AK/SK with RDS, RdsAi, VPC and BSS permissions

The deployment script does not create the control-plane instance.

## 2. Set environment variables

```bash
export DEPLOY_UI="release"
export POOL_UI_RELEASE_TAG="v0.1.0"

export INSTANCE_NAME="ra-supabase-xxxxxxxx"
export POOL_ADMIN_PASSWORD="<strong-password>"
export ALIBABA_CLOUD_ACCESS_KEY_ID="<ram-access-key-id>"
export ALIBABA_CLOUD_ACCESS_KEY_SECRET="<ram-access-key-secret>"
export REGION="cn-hangzhou"
export CLOUD_MODE="mock"

# Optional: enable DingTalk alerts. Leave unset to keep alerts internal only.
export DINGTALK_WEBHOOK="https://oapi.dingtalk.com/robot/send?access_token=..."
export DINGTALK_SECRET="SEC..."   # required only for a signed robot
```

`mock` is the safe default and does not create business PG or Supabase
instances. Use `CLOUD_MODE=real` only with a dedicated test account and budget
alerts.

## 3. Deploy

```bash
./edge/bootstrap.sh
```

The script resolves the instance endpoint and service key, creates
`pool_admin` and `pool_control`, writes Edge Secrets, deploys `pool-api`,
`pool-ui` and `pool-notifier`, installs the worker/watchdog schedule and
performs a health check.

### UI deployment modes

Customer deployments use a prebuilt GitHub Release artifact and do not require
Node/npm. The corresponding release must contain `pool-ui-v0.1.0.ts` and its
`.sha256`; the script verifies the checksum and aborts on mismatch.

For source development or release building, use `DEPLOY_UI=source` (requires
Node 20.19+):

```bash
DEPLOY_UI=source ./edge/bootstrap.sh
```

To update only the API, use `DEPLOY_UI=0`. Build release assets with:

```bash
./scripts/build-ui-release.sh v0.1.0
```

Then upload `edge/.build/release/pool-ui-v0.1.0.ts` and `.sha256` to the
corresponding GitHub Release. `POOL_UI_RELEASE_REPO` and
`POOL_UI_RELEASE_URL` can override the default download location.

## 4. Initialize

1. Open the admin console and create the first admin.
2. Run Settings -> Preflight.
3. Add a region with its VPC and VSwitch.
4. Attach a Running shared PG or prewarm a single-tenant instance.
5. Create platform users.

## 5. Upgrade

```bash
./edge/upgrade.sh
```

`upgrade.sh` loads `edge/.bootstrap.env`, updates `pool-api`, `pool-ui`,
`pool-notifier` and the worker/watchdog schedules, then runs a health check.
`deploy.sh` is an internal implementation detail and does not need to be
invoked by customers.

If `.bootstrap.env` is missing, restore the deployment configuration first.
Do not use `bootstrap.sh` to upgrade an existing instance; it may reset
`pool_admin`, the JWT secret, worker token and other configuration.

## 6. Monitoring and alerts

The control plane records heartbeats for `pool-api` (HTTP request layer) and
`pool-worker` (background tasks and auto-refill). A `pg_cron` watchdog writes
stale events to `alert_outbox`; `pool-notifier` sends DingTalk alerts and
recovery notices.

### Webhook switch

- Setting `DINGTALK_WEBHOOK` enables external DingTalk delivery.
- Leaving it unset keeps heartbeats, the watchdog and the outbox active, but
  does not call the notifier and does not affect the main service.
- `DINGTALK_SECRET` is only needed when the robot uses signing; a keyword-based
  robot does not need it.

`bootstrap.sh` writes these optional secrets when they are provided in the
environment. `upgrade.sh` does not update Edge Secrets by default. To add or
replace the webhook on an existing instance, run:

```bash
DINGTALK_WEBHOOK="https://..." DINGTALK_SECRET="SEC..." ./edge/upgrade.sh
```

The optional secrets are updated only when `DINGTALK_WEBHOOK` is explicitly
provided; otherwise the existing configuration is preserved.

### After redeploying

`upgrade.sh` redeploys the functions and scheduler setup refreshes
`monitor_config.notifications_enabled` from the current
`DINGTALK_WEBHOOK`. The worker and watchdog jobs are re-hooked. Old versions,
or instances that were not redeployed, do not have this monitoring path.

Use the scheduler status endpoint to verify heartbeats:

```bash
curl -H "X-Worker-Token: <WORKER_TOKEN>" \
  https://<domain>/functions/v1/pool-api/api/internal/scheduler/status
```

When no webhook is configured, alerts remain in `alert_outbox` for inspection
and are not sent externally.

## Security notes

- Use a dedicated RAM user with the least permissions required.
- Do not keep PostgreSQL whitelist entries open to `0.0.0.0/0`.
- Keep `edge/.bootstrap.env` private and `0600`.
- Delete test cloud resources after validation.
