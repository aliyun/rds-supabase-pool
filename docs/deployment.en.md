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
export INSTANCE_NAME="ra-supabase-xxxxxxxx"
export POOL_ADMIN_PASSWORD="<strong-password>"
export ALIBABA_CLOUD_ACCESS_KEY_ID="<ram-access-key-id>"
export ALIBABA_CLOUD_ACCESS_KEY_SECRET="<ram-access-key-secret>"
export REGION="cn-hangzhou"
export CLOUD_MODE="mock"
```

`mock` is the safe default and does not create business PG or Supabase
instances. Use `CLOUD_MODE=real` only with a dedicated test account and budget
alerts.

## 3. Deploy

```bash
./edge/bootstrap.sh
```

The script resolves the instance endpoint and service key, creates
`pool_admin` and `pool_control`, writes Edge Secrets, deploys the two Edge
Functions, installs the scheduler and performs a health check.

## 4. Initialize

1. Open the admin console and create the first admin.
2. Run Settings -> Preflight.
3. Add a region with its VPC and VSwitch.
4. Attach a Running shared PG or prewarm a single-tenant instance.
5. Create platform users.

## 5. Upgrade

```bash
./edge/deploy.sh
```

`deploy.sh` reuses `edge/.bootstrap.env` when present.

## Security notes

- Use a dedicated RAM user with the least permissions required.
- Do not keep PostgreSQL whitelist entries open to `0.0.0.0/0`.
- Keep `edge/.bootstrap.env` private and `0600`.
- Delete test cloud resources after validation.
