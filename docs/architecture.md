# 架构说明

## 1. 总体架构

```text
管理员 / 使用者 / CLI
        │ HTTPS
        ▼
RDS Supabase 控制面实例
  ├─ pool-api（Edge Function）
  │    ├─ 认证与权限
  │    ├─ 地域 / 资源池 / 实例 / 任务
  │    ├─ 使用者门户 API、PAT
  │    ├─ 云适配层（Real / Mock）
  │    └─ worker tick
  ├─ pool-ui（Edge Function）
  │    └─ 管理台 + 使用者门户静态资源
  ├─ PostgreSQL 控制库（默认 pool_control）
  │    ├─ 业务表
  │    └─ platform_config / 运行配置
  └─ supabase_db
       ├─ pg_cron + pg_net
       ├─ pool_control_config（当前控制库指针）
       └─ setup_jobs（元数据库创建任务）
        │
        ▼
目标地域资源
  ├─ RDS PostgreSQL：单租 PG / 多租共享 PG
  └─ RDS AI Supabase：单租 / 共享实例
```

控制面不需要 ECS、容器或负载均衡；一台开启 Agent Runtime 的 RDS Supabase 实例即可承载函数、控制库和调度。

## 2. 组件职责

### pool-api

单文件 Deno Edge Function，按路径分发：

- `auth`：平台用户登录、JWT、Cookie、密码、bootstrap
- `admin`：用户管理、平台配置、预检
- `regions/pools/shared-pgs`：地域、单租池、共享池、共享 PG
- `instances`：预热、分配、归还、启停、删除、端点、密钥、规格、数据库大小
- `tasks`：任务列表、详情、重试、自愈
- `portal`：使用者总览、申请、归还、实例、端点、密钥
- `tokens`：个人 API Token（PAT）
- `billing/capacity`：池成本、共享 PG 容量
- `internal`：worker tick、调度、云只读检查、运行时诊断

生产环境使用 `pool-api` 和 `pool-ui` 两个函数，平台上限为 5 个。

### pool-ui

将 Vite 构建产物嵌入 Edge Function，按路径返回 HTML/JS/CSS/字体。`build-ui.mjs` 负责：

- 读取 `frontend/dist`
- 注入 `window.__POOL_API_BASE__` / `window.__POOL_UI_BASE__`
- 生成自包含的 `pool-ui.ts`

### 控制面数据库

独立数据库（推荐 `pool_control`），保存：

- `regions` / `pools` / `shared_pgs`
- `pool_instances`
- `tasks`
- `platform_users` / `platform_tokens`
- `audit_events` / `api_call_logs`
- `platform_config`

`supabase_db` 只保存调度基础设施：

- `pg_cron` / `pg_net` 扩展
- `pool_control_config`：当前控制库指针
- `setup_jobs`：元数据库自动创建任务

不把业务表放进 `supabase_db`，避免和平台内部对象、升级和权限混在一起。

## 3. 任务与调度

任务是持久化状态机：

```text
pending → running → succeeded
                 └→ failed → 自动重试 / 手动重试
```

关键字段：

- `step`：当前步骤
- `attempts`：重试次数
- `next_run_at`：下一次允许执行时间
- `locked_at`：worker 锁定时间

调度链路：

```text
pg_cron（每分钟）
  → pg_net.http_post
  → pool-api /api/internal/worker/tick
  → drainWorker
  → 处理到期任务 / setup_jobs
```

调度优先使用 Edge 内部的 `SUPABASE_URL`（VPC 地址），避免依赖会变化的 sandbox 域名。`deploy.sh` 每次部署后会自动重挂 cron。

## 4. 资源池模型

### 地域与池

- 一个地域包含一个单租户池和一个多租共享池。
- 单租池：每个实例独享 PG 和 Supabase。
- 共享池：多个 Supabase 租户复用一台或多台共享 PG。共享 PG 可以选择已有实例，也可以通过控制台创建新的 PG（后台任务 `shared_pg_create`）。

### 水位与自动补货

- `target` 是池内“可分配空闲实例”的目标数量，不是实例总数。
- 可分配空闲实例需同时满足：`InCold`、未保留给原应用、无 owner；池开放 Studio 时还要求 Studio 凭据已初始化。
- 自动补货按 `available < target` 触发，同时受 `max` 总实例数上限约束。
- 共享池还受已启用且 Running 的共享 PG 聚合容量上限约束，避免补货超过共享 PG 可承载租户数。

### 共享 PG 调度

共享池创建实例时，按以下条件选择 PG：

- 已启用且 Running
- 根据容量（active ratio、租户数、权重）选择负载最低的 PG
- 不在租户间迁移已有实例

容量接口来自 RdsAi `DescribeDBInstanceCapacity` / `ModifyDBInstanceCapacity`。

### 实例生命周期

```text
预热 Creating → wait_running → [enable_agent_runtime → wait_agent_runtime] → close_network → stop → InCold
申请：InCold/Available → start（如需要）→ wait_running → apply_network → InUse
归还：InUse → reset_network（Cover 127.0.0.1）→ [enable_agent_runtime → wait_agent_runtime] → [初始化/校验 Studio 凭据] → stop → InCold（保留给同名应用）
删除：InCold/InUse → delete_supabase → delete_pg → 删除 Studio 凭据 → Deleted
```

Supabase 实例网络白名单由任务状态机维护：

- 冷池统一 `127.0.0.1`。
- 分配时按使用者选择的 `restricted`/`public` 模式 Cover `pool_white` 分组。
- 归还时先 Cover `pool_white` 回 `127.0.0.1` 并读取校验，再停止实例。
- `pool_white` 与实例 `default` 分组隔离，后者中的 VPC 网段保持不变。
- Stopped 状态不能修改白名单，因此所有写入都必须在 Running 窗口完成。
- 详细状态和失败处理见 `docs/api.md`。

真实模式下由 RealAdapter 调用 RDS / RdsAi；Mock 模式只写控制库并返回模拟资源。

## 5. PG 标签与 Studio 访问

- 单租 PG 默认标签保存在 `pools.config.single_pg_tags`；新 PG 通过 `CreateDBInstance.Tag` 写入。
- 存量单租 PG 和共享 PG 的标签按 PG 维度全量同步，实际状态以 `ListTagResources` 为准。
- 共享 PG 标签保存在 `shared_pgs.tags`；单租 PG 实际标签保存在 `pool_instances.pg_tags`。
- 每个 Supabase 实例有独立 Studio 密码，密文保存在 `instance_credentials`，密钥由 `PLATFORM_JWT_SECRET` 通过 HKDF 派生。
- Studio 和 Agent Runtime 地址由实例公网 443 Domain 派生：
  - Studio: `https://<domain>/`
  - Agent Runtime: `https://<domain>/agent-runtime`
- Studio 凭据初始化、查看、归还处理都有审计；没有有效凭据的 InCold 实例禁止分配。
- 池实例默认保留给同名应用，因此正常归还不会轮换仍有效的 Studio 密码；无凭据的存量实例会在归还时初始化一次。

## 6. 认证与权限

- 平台用户：`admin` / `user`
- 浏览器使用 JWT Cookie
- 使用者 API / CLI 使用 PAT（`pctl_...`）
- PAT 有 scope：`instances:read/apply/release`、`credentials:read`、`network:read/write`
- 管理端接口要求 JWT 管理员，PAT 不能访问
- 使用者只能申请/归还，不能删除实例
- 所有真实云写操作由管理员或任务 worker 执行

## 7. 控制面配置

`platform_config` 保存运行时配置：

- `cloud_mode`：real / mock
- `settings`：默认地域、网络、共享 PG
- `metadata_pg`：当前控制库信息
- `public_url`：可选公网域名

`pool_control_config` 在 `supabase_db` 保存当前控制库 URL（加密），支持控制库切换。

## 8. 部署与环境

- Edge Secrets：`CONTROL_DB_URL`、`PLATFORM_JWT_SECRET`、`WORKER_TOKEN`、云凭证、Supabase 应用密码等
- `pool-api` 直连 PostgreSQL（`npm:postgres`）
- 控制面数据库由 `pool_admin` 访问；`pool_admin` 同时需要访问 `supabase_db` 安装/运行调度扩展
- 建议控制面实例与目标 PG/资源同地域、同 VPC，减少网络与延迟
- 详细部署步骤见 [deployment.md](deployment.md)

## 9. 设计取舍

- **Edge 优先**：控制面不需要额外服务器；适合作为部署者侧轻量控制面。
- **独立控制库**：与 `supabase_db` 解耦，升级、备份、切换更安全。
- **数据库任务表**：Edge 函数不依赖常驻进程，任务可重试、可恢复。
- **内部 URL 调度**：避免公网域名/证书和 sandbox 域名变化影响 worker。
- **真实/Mock 双适配**：同一套 API 支持演示和真实资源。
