# API Reference

Base URL in a deployed environment:

```text
https://<domain>/functions/v1/pool-api/api
```

All responses are JSON except SSE and static assets. Errors use:

```json
{ "detail": "error message" }
```

## Authentication

Two authentication modes are supported:

| Mode                    | Header / cookie                      | Used by                     |
| ----------------------- | ------------------------------------ | --------------------------- |
| Admin or portal session | HttpOnly `pool_console_token` cookie | Web console and user portal |
| Personal access token   | `Authorization: Bearer pctl_...`     | `/api/v1/portal/*` and CLI  |

Admin endpoints require an admin session. Portal endpoints require either a
portal session or a PAT with the required scope. PAT scopes:

- `instances:read`
- `instances:apply`
- `instances:release`
- `credentials:read`
- `network:read`
- `network:write`

## Public endpoints

| Method | Path              | Description                                       |
| ------ | ----------------- | ------------------------------------------------- |
| GET    | `/health`         | Liveness and configured cloud mode                |
| GET    | `/auth/status`    | Whether first-admin bootstrap is required         |
| POST   | `/auth/bootstrap` | Create the first admin (only when no users exist) |
| POST   | `/auth/login`     | Username/password login; sets HttpOnly cookie     |
| POST   | `/auth/logout`    | Clear the session cookie                          |
| GET    | `/auth/me`        | Current session user                              |
| POST   | `/auth/password`  | Change the current user's password                |

## Admin endpoints

All routes below require an admin session unless noted.

### Overview and settings

| Method | Path               | Description                                   |
| ------ | ------------------ | --------------------------------------------- |
| GET    | `/overview`        | Region overview for the selected region       |
| GET    | `/overview/global` | Cross-region summary                          |
| GET    | `/settings`        | Runtime settings and masked credential status |
| PUT    | `/settings`        | Update settings and pool defaults             |
| PUT    | `/settings/mode`   | Switch `mock` / `real` mode                   |
| POST   | `/preflight`       | Run cloud, database and role preflight checks |
| GET    | `/meta`            | Task kinds, scopes and UI metadata            |
| GET    | `/stream`          | SSE stream of live status events              |

### Regions and pools

| Method | Path                                | Description                                                      |
| ------ | ----------------------------------- | ---------------------------------------------------------------- |
| GET    | `/regions`                          | List regions and their pools                                     |
| POST   | `/regions`                          | Create a region and its single/shared pools                      |
| GET    | `/regions/:region_id`               | Get one region                                                   |
| PATCH  | `/regions/:region_id`               | Update name, enabled state or portal mode                        |
| GET    | `/pools`                            | List pools, optionally filtered by `region_id`                   |
| GET    | `/pools/:pool_id`                   | Get one pool                                                     |
| PATCH  | `/pools/:pool_id`                   | Update pool network or config                                    |
| GET    | `/pools/:pool_id/shared-pgs`        | List shared PGs in a shared pool                                 |
| POST   | `/pools/:pool_id/shared-pgs`        | Attach an existing Running PG; optional tags                    |
| POST   | `/pools/:pool_id/shared-pgs/create` | Create a shared PG asynchronously; optional tags                |
| PATCH  | `/shared-pgs/:pg_id`                | Update shared PG name, weight, enabled state or tags            |
| DELETE | `/shared-pgs/:pg_id`                | Remove a shared PG; add `?delete_cloud=1` to delete the cloud PG |
| POST   | `/shared-pgs/:pg_id/sync`           | Refresh cloud status and capacity snapshot                       |

### Cloud resources

| Method | Path                                      | Description                         |
| ------ | ----------------------------------------- | ----------------------------------- |
| GET    | `/resources/vpcs?region_id=`              | Discover VPCs                       |
| GET    | `/resources/vswitches?region_id=&vpc_id=` | Discover VSwitches                  |
| GET    | `/resources/pgs?region_id=`               | Discover PostgreSQL instances       |
| GET    | `/resources/pgs/:pg_id/net`               | Public/VPC connection and whitelist |

### Instances and tasks

| Method | Path                           | Description                                                              |
| ------ | ------------------------------ | ------------------------------------------------------------------------ |
| GET    | `/instances`                   | List instances; filters include `region_id`, `mode`, `status`, `pool_id` |
| POST   | `/instances/prewarm`           | Prewarm one or more instances                                            |
| POST   | `/instances/backfill-agent-runtime` | Enable Agent Runtime on eligible InCold instances                    |
| POST   | `/instances/backfill-studio-credentials` | Initialize Studio credentials for eligible InCold instances      |
| POST   | `/instances/repair-studio-credentials` | Repair unreadable or missing Studio credentials; queue InUse repairs on return |
| POST   | `/instances/:id/studio-credential/repair` | Repair one instance credential; InUse is queued for return        |
| GET    | `/instances/:id`               | Instance detail                                                          |
| DELETE | `/instances/:id`               | Delete an instance and its cloud resources                               |
| GET    | `/instances/:id/events`        | Instance audit timeline                                                  |
| POST   | `/instances/:id/actions`       | Start, stop or restart                                                   |
| POST   | `/instances/:id/allocate`      | Allocate to an app                                                       |
| POST   | `/instances/:id/release`       | Return or destroy                                                        |
| GET    | `/instances/:id/network`       | Read the Supabase instance IP allowlist                                  |
| PATCH  | `/instances/:id/network`       | Replace the Supabase instance IP allowlist                               |
| GET    | `/instances/:id/pg-tags`       | Read PostgreSQL instance tags                                            |
| PATCH  | `/instances/:id/pg-tags`       | Fully synchronize PostgreSQL instance tags                               |
| GET    | `/instances/:id/access`        | Studio / Agent Runtime URLs and availability                             |
| POST   | `/instances/:id/access/studio-password/reveal` | Reveal the instance Studio password                     |
| GET    | `/instances/:id/endpoints`     | Supabase endpoints                                                       |
| GET    | `/instances/:id/auth-info`     | Supabase API keys (masked in UI)                                         |
| GET    | `/instances/:id/resource`      | Current resource configuration                                           |
| POST   | `/instances/:id/resource`      | Modify resource configuration                                            |
| GET    | `/instances/:id/database-size` | Database size                                                            |
| GET    | `/tasks`                       | List tasks; filters include `status`, `kind`, `region_id`, `pool_id`     |
| GET    | `/tasks/:id`                   | Task detail                                                              |
| POST   | `/tasks/:id/retry`             | Retry a failed task                                                      |
| POST   | `/tasks/selfheal`              | Run a self-healing inspection                                            |

### Capacity, cost and audit

| Method | Path                                   | Description                        |
| ------ | -------------------------------------- | ---------------------------------- |
| GET    | `/capacity?region_id=`                 | Shared PG capacity overview        |
| GET    | `/capacity?pg_id=`                     | Refresh one shared PG's capacity   |
| PUT    | `/capacity`                            | Set `active_ratio` for a shared PG |
| GET    | `/billing/pool-cost?month=&region_id=` | Pool PG cost summary               |
| GET    | `/logs?limit=&region_id=`              | Cloud API call logs                |

### Platform users

| Method | Path               | Description                            |
| ------ | ------------------ | -------------------------------------- |
| GET    | `/admin/users`     | List platform users                    |
| POST   | `/admin/users`     | Create an admin or user                |
| PATCH  | `/admin/users/:id` | Update role, enabled state or password |

### Internal worker and scheduler

These routes use the `X-Worker-Token` header and are not intended for browsers:

| Method | Path                         | Description                        |
| ------ | ---------------------------- | ---------------------------------- |
| POST   | `/internal/worker/tick`      | Process one due task               |
| POST   | `/internal/scheduler/setup`  | Install/refresh the `pg_cron` job  |
| GET    | `/internal/scheduler/status` | Scheduler status                   |
| GET    | `/internal/scheduler/diag`   | Database and scheduler diagnostics |

## Portal endpoints

Portal endpoints are available both under `/portal/*` for session cookies and
`/v1/portal/*` for PATs. Use the versioned path for external automation.

| Method   | Path                                 | Description                                     |
| -------- | ------------------------------------ | ----------------------------------------------- |
| GET      | `/v1/portal/overview`                | Regions and pools available to the current user |
| GET      | `/v1/portal/instances`               | Instances owned by the current user             |
| POST     | `/v1/portal/instances/apply`         | Apply for an instance asynchronously            |
| GET      | `/v1/portal/instances/:id`           | Owned instance detail                           |
| POST     | `/v1/portal/instances/:id/release`   | Return an owned instance                        |
| GET      | `/v1/portal/instances/:id/network`   | Read own Supabase IP allowlist (requires `network:read`) |
| PATCH    | `/v1/portal/instances/:id/network`   | Update own Supabase IP allowlist (requires `network:write`) |
| GET      | `/v1/portal/instances/:id/access`    | Studio / Agent Runtime URLs and availability    |
| POST     | `/v1/portal/instances/:id/access/studio-password/reveal` | Studio password; requires `credentials:read` |
| GET      | `/v1/portal/instances/:id/endpoints` | Connection endpoints                            |
| GET      | `/v1/portal/instances/:id/auth-info` | API keys; requires `credentials:read`           |
| GET      | `/v1/portal/tasks/:id`               | Task status                                     |
| GET/POST | `/v1/portal/tokens`                  | List or create PATs                             |
| DELETE   | `/v1/portal/tokens/:id`              | Revoke a PAT                                    |

## Supabase network allowlist

The allowlist is managed on the Supabase application instance, not on the
underlying PostgreSQL instance. It uses a dedicated RdsAi whitelist group
named `pool_white`; the instance's `default` group and its VPC rules are not
modified. All lifecycle writes happen while the instance is `Running`.

- Cold pool: `127.0.0.1`; external access is closed for `pool_white`.
- Restricted mode: `127.0.0.1` plus the requested application egress CIDRs.
- Public mode: `0.0.0.0/0`; this is an explicit opt-in and can be disabled by
  the pool's `network_policy.allow_public_access`.
- Return: reset to `127.0.0.1` before stopping the instance.
- RdsAi may report `net_maintaining` for a short time after a whitelist change;
  lifecycle tasks wait for `Running` before applying the next step.
- Instances report `network.state` as `pending`, `applying`, `applied`,
  `resetting`, `closed`, `error` or `unknown`.

Apply example:

```json
{
  "region_id": "cn-shanghai",
  "mode": "shared",
  "app_name": "my-app",
  "network": {
    "mode": "restricted",
    "cidrs": ["203.0.113.10/32"]
  }
}
```

Use `"mode": "public", "cidrs": []` for public access when allowed. A stopped
instance cannot be modified; start it first. `0.0.0.0/0` is not accepted in
restricted mode.

Existing instances that were previously managed through the `default` group
must be migrated manually: restore the platform/VPC rules in `default`, then
let the new lifecycle manage `pool_white`. The control plane never rewrites
`default`.

## Agent Runtime

Pools enable Agent Runtime by default for newly prewarmed Supabase instances; set `agent_runtime_enabled` to `false` to opt out:

```json
{
  "agent_runtime_enabled": true
}
```

When enabled, prewarm waits for Supabase to become `Running`, calls
`EnableAgentRuntime`, then waits for the `agent-runtime` component to become
active before closing the network allowlist and stopping the instance. This
adds roughly 2-5 minutes to prewarm time and may create a VPC endpoint and
security group on first use in a VPC. The setting applies to new prewarm tasks and conditional enablement during return. Existing InCold instances can be backfilled with `POST /instances/backfill-agent-runtime`; InUse instances are handled on normal return.

## PostgreSQL tags

Single-tenant PG defaults are stored in `pools.config.single_pg_tags`. New
single PGs are created with those tags; existing single PGs can be updated from
the admin instance detail. Shared PG tags are stored per PG in
`shared_pgs.tags` and can be set when creating, adding or editing a shared PG.

Tag updates use a full synchronization model: submitted tags are the desired
state, new/changed keys use `TagResources`, and omitted old keys use
`UntagResources`. Limits: at most 20 tags per PG, keys must be unique and
non-empty, values may be empty.

## Studio and Agent Runtime

Pool settings `allow_user_studio` and `allow_user_agent_runtime` default to
`true`; an administrator can disable either per pool.

- Studio URL: `https://<instance-public-domain>/`
- Agent Runtime URL: `https://<instance-public-domain>/agent-runtime`
- Studio uses HTTP Basic auth in the current RDS Supabase deployment; use username `supabase` and the instance Studio password.
- Each instance has an independent Studio password, stored encrypted in the
  control plane.
- The password is not returned by list endpoints. It is revealed explicitly by
  the owner or an administrator and the reveal is audited.
- New instances receive a credential automatically.
- Existing InCold instances can be initialized with
  `POST /instances/backfill-studio-credentials` (up to 5 per batch).
- Existing InUse instances are initialized on return if no credential exists.
- Credential metadata exposes `missing`, `pending`, `unreadable` and `ready`.
  An encrypted credential that cannot be decrypted with the current platform
  key is reported as `unreadable`, never as ready.
- `POST /instances/repair-studio-credentials` repairs missing or unreadable
  InCold credentials and queues InUse instances for repair on return.
  `POST /instances/:id/studio-credential/repair` handles one instance.
- If Studio access is enabled, allocation is rejected while an InCold
  credential is not ready.
- `repairable` instances are excluded from available-idle counts and suppress
  automatic prewarming until they are repaired.
- A failed credential rotation marks the instance as `studio_rotation_pending`
  and blocks allocation until corrected.
- The normal release flow preserves the password when the instance remains
  reserved for the same application.

## Task model

Apply, release, prewarm, delete and shared-PG creation return a task ID. Poll
the task or use `poolctl --wait`:

```json
{
  "id": "task-id",
  "kind": "allocate",
  "status": "pending",
  "step": "start",
  "progress": 0,
  "message": "等待唤醒",
  "error": null
}
```

Terminal statuses are `succeeded` and `failed`. A failed task can be retried by
an admin when the underlying cloud condition has been corrected.

## Example

```bash
# Admin login
curl -c cookie.txt -X POST https://<domain>/functions/v1/pool-api/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"<password>"}'

# Region overview
curl -b cookie.txt https://<domain>/functions/v1/pool-api/api/overview?region_id=cn-hangzhou

# PAT-based portal request
curl -H "Authorization: Bearer pctl_xxx" \
  https://<domain>/functions/v1/pool-api/api/v1/portal/instances

# Update the Supabase instance allowlist
curl -X PATCH -H "Authorization: Bearer pctl_xxx" \
  -H 'content-type: application/json' \
  -d '{"mode":"restricted","cidrs":["203.0.113.10/32"]}' \
  https://<domain>/functions/v1/pool-api/api/v1/portal/instances/<id>/network
```

Replace placeholders with your own values. Never paste real credentials into
docs, issues or screenshots.
