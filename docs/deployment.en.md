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
export POOL_UI_RELEASE_TAG="v0.1.4"

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
Node/npm. The corresponding release must contain `pool-ui-v0.1.4.ts` and its
`.sha256`; the script verifies the checksum and aborts on mismatch.

For source development or release building, use `DEPLOY_UI=source` (requires
Node 20.19+):

```bash
DEPLOY_UI=source ./edge/bootstrap.sh
```

To update only the API, use `DEPLOY_UI=0`. Build release assets with:

```bash
./scripts/build-ui-release.sh v0.1.4
```

Then upload `edge/.build/release/pool-ui-v0.1.4.ts` and `.sha256` to the
corresponding GitHub Release. `POOL_UI_RELEASE_REPO` and
`POOL_UI_RELEASE_URL` can override the default download location.

## 4. Initialize

1. Open the admin console and create the first admin.
2. Run Settings -> Preflight.
3. Add a region with its VPC and VSwitch.
4. Attach a Running shared PG or prewarm a single-tenant instance.
5. Create platform users.

## 5. Upgrade

### 5.1 With edge/.bootstrap.env

```bash
DEPLOY_UI="release" \
POOL_UI_RELEASE_TAG="v0.1.4" \
./edge/upgrade.sh
```

`upgrade.sh` loads the saved deployment coordinates, updates `pool-api`,
`pool-ui`, `pool-notifier` and the worker/watchdog schedules, then runs a
health check. `deploy.sh` is an internal implementation detail and does not
need to be invoked by customers.

To keep the UI settings saved in `.bootstrap.env`, you can also run
`./edge/upgrade.sh` directly, or change `POOL_UI_RELEASE_TAG` in that file to
`v0.1.4`.

### 5.2 Without edge/.bootstrap.env

If the upgrade host has no `.bootstrap.env`, provide the instance name, region
and AK/SK:

```bash
DEPLOY_UI="release" \
POOL_UI_RELEASE_TAG="v0.1.4" \
INSTANCE_NAME="ra-xxxxxxxx" \
REGION="cn-shanghai" \
ALIBABA_CLOUD_ACCESS_KEY_ID="<AK>" \
ALIBABA_CLOUD_ACCESS_KEY_SECRET="<SK>" \
WORKER_TOKEN="<existing worker token>" \
./edge/upgrade.sh
```

`upgrade.sh` resolves `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` through RdsAi;
the `pool_admin` password is not required. The AK/SK is used only for this
lookup and is not written to the local deployment file.

If the control-plane URL and service key are already known, you can skip the
instance lookup:

```bash
DEPLOY_UI="release" \
POOL_UI_RELEASE_TAG="v0.1.4" \
SUPABASE_URL="https://<domain>" \
SUPABASE_SERVICE_KEY="<service-key>" \
WORKER_TOKEN="<existing worker token>" \
./edge/upgrade.sh
```

After a successful upgrade, the script saves the URL, service key, worker token
and UI settings to `edge/.bootstrap.env` (mode 0600, ignored by Git).

### 5.3 Lost WORKER_TOKEN

Set `RESET_WORKER_TOKEN=1` when the old token is unavailable. The script
generates a new token, updates the Edge Secret, redeploys the functions and
re-hooks the scheduler:

```bash
DEPLOY_UI="release" \
POOL_UI_RELEASE_TAG="v0.1.4" \
INSTANCE_NAME="ra-xxxxxxxx" \
REGION="cn-shanghai" \
ALIBABA_CLOUD_ACCESS_KEY_ID="<AK>" \
ALIBABA_CLOUD_ACCESS_KEY_SECRET="<SK>" \
RESET_WORKER_TOKEN=1 \
./edge/upgrade.sh
```

You can also pass a new `WORKER_TOKEN="<new token>"`; the script then uses that
value instead of generating one.

Reset impact:

- The old token stops working after the upgrade. External scripts that call the
  worker tick endpoint must be updated.
- The two pg_cron jobs may return 401 until they are re-hooked. Background
  tasks can pause for about a minute, but task records are stored in the
  database and are not lost.
- JWT secrets, database passwords, PATs and pool data are not changed.
- The new token is saved to `edge/.bootstrap.env`; do not commit that file.

Do not use `bootstrap.sh` to upgrade or recover an existing instance. It
rewrites the JWT secret, database passwords and the full set of Edge Secrets.

### PostgreSQL tags and Studio access

PostgreSQL tag management requires `rds:TagResources`, `rds:ListTagResources`
and `rds:UntagResources`. Studio credential initialization and rotation require
`rdsai:ResetInstancePassword`.

Pool settings `allow_user_studio` and `allow_user_agent_runtime` default to
`true`. Users can open:

```text
Studio:        https://<instance-public-domain>/
Agent Runtime: https://<instance-public-domain>/agent-runtime
```

Studio uses username `supabase` and an independent encrypted password per
instance. The current RDS Supabase Studio entry uses HTTP Basic authentication,
so the browser prompts for these credentials. Existing InCold instances can be initialized from the admin console
in batches of up to five; existing InUse instances are initialized when
returned if no credential exists. An InCold instance without an initialized
credential is not allocatable while Studio access is enabled.

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
environment. Except for an explicit `RESET_WORKER_TOKEN=1`, `upgrade.sh` does
not update Edge Secrets. To add or replace the webhook on an existing
instance, run:

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
