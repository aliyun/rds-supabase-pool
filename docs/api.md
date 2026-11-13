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
| POST   | `/pools/:pool_id/shared-pgs`        | Attach an existing Running PG                                    |
| POST   | `/pools/:pool_id/shared-pgs/create` | Create a shared PG asynchronously                                |
| PATCH  | `/shared-pgs/:pg_id`                | Update shared PG name, weight or enabled state                   |
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
| GET    | `/instances/:id`               | Instance detail                                                          |
| DELETE | `/instances/:id`               | Delete an instance and its cloud resources                               |
| GET    | `/instances/:id/events`        | Instance audit timeline                                                  |
| POST   | `/instances/:id/actions`       | Start, stop or restart                                                   |
| POST   | `/instances/:id/allocate`      | Allocate to an app                                                       |
| POST   | `/instances/:id/release`       | Return or destroy                                                        |
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
| GET      | `/v1/portal/instances/:id/endpoints` | Connection endpoints                            |
| GET      | `/v1/portal/instances/:id/auth-info` | API keys; requires `credentials:read`           |
| GET      | `/v1/portal/tasks/:id`               | Task status                                     |
| GET/POST | `/v1/portal/tokens`                  | List or create PATs                             |
| DELETE   | `/v1/portal/tokens/:id`              | Revoke a PAT                                    |

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
```

Replace placeholders with your own values. Never paste real credentials into
docs, issues or screenshots.
