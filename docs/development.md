# Local development

## Frontend

```bash
cd frontend
npm ci
npm run dev
```

The Vite dev server proxies `/api` to `http://127.0.0.1:8000`. Override the
target with `VITE_API_PROXY_TARGET` when the API runs elsewhere.

## Local mock control plane

Prerequisites:

- PostgreSQL running locally;
- Deno 2.x installed (`deno --version`);
- Node.js 20.19+ and npm.

Create a database and start the mock API:

```bash
createdb pool_control_dev 2>/dev/null || true

export CONTROL_DB_URL="postgres://$(id -un)@127.0.0.1:5432/pool_control_dev?sslmode=disable"
export CONTROL_ADMIN_DB_NAME="pool_control_dev"
export PLATFORM_JWT_SECRET="local-development-secret-change-me"
export CLOUD_MODE="mock"
export AUTO_WHITELIST="false"

deno run --allow-net --allow-env --allow-read edge/index.ts
```

In another terminal start the UI:

```bash
cd frontend
npm run dev
```

Open <http://127.0.0.1:5173/> and create the first admin. The API initializes
the schema on first use. Mock resources are stored in the control database and
do not call Alibaba Cloud.

You can also use the helper script:

```bash
./scripts/dev-mock.sh
```

The script expects a local PostgreSQL database and starts the API and Vite
together. It exits both processes when Vite stops. If port 8000 is already in
use, choose another API port:

```bash
PORT=8010 VITE_API_PROXY_TARGET=http://127.0.0.1:8010 ./scripts/dev-mock.sh
```

## Docker PostgreSQL alternative

If you do not have PostgreSQL installed:

```bash
docker compose -f dev/docker-compose.yml up -d
export CONTROL_DB_URL="postgres://pool:pool@127.0.0.1:5432/pool_control_dev?sslmode=disable"
export CONTROL_ADMIN_DB_NAME="pool_control_dev"
```

Stop it with:

```bash
docker compose -f dev/docker-compose.yml down
```

## Checks

```bash
cd frontend
npm test
npm run build

cd ..
uvx ruff check cli edge
shellcheck edge/*.sh scripts/*.sh
python3 -m unittest discover -s cli/tests -v
python3 -m compileall -q cli edge
```
