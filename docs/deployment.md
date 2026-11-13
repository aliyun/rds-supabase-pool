# RDS Supabase 冷热池控制面部署指南（Edge 版）

适用于在新阿里云账号（新 UID）、新地域从零部署一套独立的冷热池系统。  
部署完成后包含：管理员控制台、使用者门户、API Token / CLI、真实云资源池编排、自动调度。

## 最短路径

1. 在控制台创建一台 RDS Supabase 控制面实例，开启 Agent Runtime。
2. 设置环境变量并执行 `./edge/bootstrap.sh`；脚本会自动创建 `pool_admin` / `pool_control`。
3. 打开管理台创建管理员 → 新增地域 → 添加共享 PG 或预热 → 创建使用者账号。

详细步骤见下文。

---

## 1. 部署架构

```text
用户浏览器
  │  HTTPS
  ▼
RDS Supabase 控制面实例（Edge Functions + PostgreSQL）
  ├─ pool-api：控制面 API、任务编排、云资源调用
  ├─ pool-ui：管理台 + 使用者门户静态页面
  ├─ pg_cron + pg_net：每分钟唤醒 worker
  └─ 控制面数据库：地域、池、实例、任务、账号、审计、日志
        │
        ▼
目标地域资源
  ├─ RDS PostgreSQL：单租 PG / 多租共享 PG
  └─ RDS AI Supabase：单租或共享实例
```

一套控制面可以管理多个地域；如果只是新增地域，不需要重新部署。

---

## 2. 资源规格建议

控制面不需要单独的 ECS、容器或负载均衡；一台 RDS Supabase 实例即可同时承载 Edge Functions、控制面数据库和调度。

| 项目           | 实验 / 小规模                                | 生产建议                        |
| -------------- | -------------------------------------------- | ------------------------------- |
| 控制面实例     | `rdsai.supabase.basic`（测试环境实测可承载） | 4C8G 或更高，按并发与日志量评估 |
| 控制面存储     | 20GB 起                                      | 50GB 起，并配置日志清理         |
| Edge Functions | 本系统 2 个（上限 5 个）                     | 同上；预留版本发布空间          |
| 部署机         | Node.js + npm（仅构建 UI 时需要）            | CI 或运维机，无需常驻           |
| 目标资源       | 单独的真实 PG / Supabase 实例                | 同左，不计入控制面规格          |

函数侧的资源画像：

- `pool-api` 源码约 200KB，常驻内存主要是 Deno 运行时和 PostgreSQL 驱动，通常为百 MB 级；冷启动约 2~5 秒。
- `pool-ui` 是内嵌静态资源，构建产物约 2.4MB；CPU 很低，主要占用为静态资源加载。
- Edge 函数没有常驻后台线程；长任务通过数据库任务表 + `pg_cron` 异步推进。
- 每个 Edge isolate 使用 1 个控制面数据库连接；高并发场景需要关注控制面 PG 连接数和日志增长。
- `api_call_logs`、`audit_events`、`tasks` 会随运行增长，生产环境建议设置保留周期或定期归档。

实测 `pool-api` 运行时（测试环境）：

- 可见 CPU：**1 vCPU**（`navigator.hardwareConcurrency = 1`）
- 常驻内存 RSS：约 **88~90MB**
- V8 heap：约 **12~15MB**
- Deno：`2.7.4`

RDS Supabase 的 Function 管理 API 没有开放单函数 CPU/内存申请字段，当前是平台按 Deno 沙箱模板分配；上面的数值是函数内部可见资源与实测占用，不代表平台承诺的硬上限。`pool-ui` 是纯静态资源函数，资源占用通常低于 `pool-api`。

> 以上为测试环境实测与部署产物估算；生产容量建议结合实际并发做一次压测。

## 3. 准备新 UID

为部署使用的 AK/SK 授予以下权限（建议先用主账号或具备同等权限的 RAM 用户）：

| 产品  | 用途                                                 |
| ----- | ---------------------------------------------------- |
| RDS   | 创建/查询/删除 PG，白名单，公网地址，账号管理        |
| RdsAi | 创建/查询/启停/删除 Supabase，容量、端点、密钥、规格 |
| VPC   | 查询 VPC / VSwitch                                   |
| BSS   | 账单只读（池成本页）                                 |
| RAM   | 只读（可选，预检服务关联角色）                       |

确认三个服务关联角色已创建：

- `AliyunServiceRoleForRds`
- `AliyunServiceRoleForRdsPgsqlOnEcs`
- `AliyunServiceRoleForRDSAISupabase`

> 如果预检提示“缺少或无权查看服务关联角色”，到 RAM 控制台补授权即可，不会阻塞核心资源操作。

---

## 4. 创建控制面实例

在目标地域创建一台 RDS Supabase 实例，作为控制面：

1. 选择目标地域、VPC、VSwitch。
2. 选择基础规格（实验环境可用 `rdsai.supabase.basic`）。
3. 开启公网连接地址。
4. 设置 **数据库密码** 和 Dashboard 密码，妥善保存。
5. 创建完成后，在实例详情中开启 **Agent Runtime**，等待实例恢复 `Running`（通常需要 2~5 分钟）。
6. 确认 HTTPS 域名可用：

```text
https://<instance-name>-pb.rds.<region>.apsaradb.com
```

7. 在实例详情/API Keys 中获取 `service_key`（部署和 Secret 管理需要）。

> 控制面实例和后续管理的 PG / Supabase 建议在同一地域，减少网络与权限配置。

---

## 5. 控制面数据库（脚本自动创建）

控制面使用独立的数据库和高权限账号：

- 数据库：`pool_control`
- 账号：`pool_admin`
- 不使用 `supabase_db` 承载业务表；它只用于 `pg_cron`、控制库指针和建库任务。

`bootstrap.sh` 会通过 RDS API 自动创建：

1. `CreateAccount`：创建 `pool_admin`（`AccountType=Super`）。
2. `CreateDatabase`：创建 `pool_control`，owner 为 `pool_admin`。
3. 如果账号已存在，会重置为 `POOL_ADMIN_PASSWORD`。
4. 如果数据库已存在，会确保 `pool_admin` 拥有 DBOwner 权限。
5. 自动生成 `CONTROL_DB_URL` 并在 `pool_control` 中建业务表。

需要 RDS 权限：

- `rds:CreateAccount`
- `rds:CreateDatabase`
- `rds:ResetAccountPassword`
- `rds:GrantAccountPrivilege`
- `rds:DescribeDBInstanceNetInfo`

如果平台不允许创建第二个 Super 账号，或 API 权限不足，可以关闭自动创建并手工执行一次：

```bash
export INIT_CONTROL_DB=false
```

```sql
-- 用实例的 postgres 超级用户执行
CREATE ROLE pool_admin LOGIN PASSWORD '<pool_admin密码>' SUPERUSER;
CREATE DATABASE pool_control OWNER pool_admin;
```

`pool_admin` 需要能够访问 `supabase_db` 并创建扩展，因此建议使用 SUPERUSER。

控制面连接串由脚本自动生成，不需要手工填写。脚本会根据 PG 网络类型选择 SSL：

- VPC 地址：`sslmode=disable`
- 公网地址：`sslmode=require`

```text
postgres://pool_admin:<pool_admin密码>@<PG连接地址>:5432/pool_control?sslmode=...
```

**PG 白名单：**

- 部署脚本默认 `AUTO_WHITELIST=true`。Edge 首次连接控制面数据库失败时，会自动检测自身出口 IP，并调用 `ModifySecurityIps` 追加白名单（需要 RDS 白名单权限）。
- 如果部署账号没有白名单权限，请手动将 Edge 出口 IP 加入控制面 PG 白名单；不建议放开 `0.0.0.0/0`。如确需临时验证，请限定来源并尽快收紧。
- 如需关闭自动白名单：

```bash
export AUTO_WHITELIST=false
```

---

## 6. 一条命令部署

全部通过环境变量传入。推荐只设置这 5 个：

```bash
export INSTANCE_NAME="ra-supabase-xxxxxxxx"
export POOL_ADMIN_PASSWORD="<8~32 位，至少含大写/小写/数字/特殊字符中的三类>"
export ALIBABA_CLOUD_ACCESS_KEY_ID="<RAM 用户 AK>"
export ALIBABA_CLOUD_ACCESS_KEY_SECRET="<RAM 用户 SK>"
export REGION="cn-chengdu"
export CLOUD_MODE="mock"

./edge/bootstrap.sh
```

`bootstrap.sh` 默认使用 `mock`，不会创建 PG / Supabase 业务实例。确认使用测试账号并接受费用风险后，再显式设置 `CLOUD_MODE=real`；真实模式会创建计费资源。

脚本会调用 RdsAi/RDS API 自动解析：

- `SUPABASE_URL`（来自 `DescribeInstanceEndpoints` 的公网 `Domain` 字段）
- `SUPABASE_SERVICE_KEY`
- `DEFAULT_REGION`
- 控制面 PG 地址
- `CONTROL_DB_URL`（pool_admin / pool_control）

也支持完全显式模式：直接设置 `SUPABASE_URL`、`SUPABASE_SERVICE_KEY`、`CONTROL_DB_URL`、AK/SK、`DEFAULT_REGION` 后执行脚本。

脚本会自动完成：

0. 首次构建 UI 时执行 `npm ci` 安装前端依赖
1. 生成并写入 Edge Secrets（JWT 密钥、worker token、Supabase 应用密码等）。
2. 部署 `pool-api`。
3. 安装 `pg_cron` / `pg_net`，并按每分钟调度 worker。
4. 构建并部署 `pool-ui`。
5. 执行健康检查。

首次部署会把 worker token、实例地址和 service key 保存到 `edge/.bootstrap.env`（权限 0600，已加入 .gitignore），用于后续重新部署；请备份并妥善保管。

成功后输出：

```text
管理台：https://<domain>/functions/v1/pool-ui/
使用者门户：https://<domain>/functions/v1/pool-ui/portal
API：https://<domain>/functions/v1/pool-api/api
```

如果实例暂时没有 `*-pb` HTTPS 域名，脚本会回退到实例公网连接地址 `http://<public-ip>:80`，便于先完成验证；正式对外使用前建议在控制台开通并确认 HTTPS 域名。

---

## 7. 初始化平台

### 7.1 创建管理员

打开管理台，首次进入按页面提示创建管理员账号。系统不提供默认密码。

### 7.2 确认真实模式与预检

进入 `设置与预检`：

- 确认真实模式。
- 点击 `运行预检`，正常情况下只有“服务关联角色”一条警告。

### 7.3 添加地域与资源池

进入 `地域与资源池` → 新增地域：

- 地域 ID，例如 `cn-shanghai`
- 该地域的 VPC / VSwitch
- 系统会自动创建单租户池和多租共享池

### 7.4 准备真实资源

二选一：

- **共享池**：添加一台 Running 的真实 PG 到共享池，然后对共享池执行预热。
- **单租池**：直接对单租池执行预热，系统会自动创建 PG 和 Supabase 实例。

预热完成后，实例会进入冷池（`InCold` / `Stopped`）。

### 7.5 创建使用者

进入 `平台账号` 创建 `user` 角色账号。使用者登录后自动进入门户，可以：

- 申请 / 归还实例
- 查看端点与 API 密钥
- 创建个人 API Token
- 使用 `poolctl` CLI

CLI Base URL：

```text
https://<domain>/functions/v1/pool-api
```

---

## 8. 新增地域（UID 不变）

不需要重新部署控制面：

1. 准备新地域的 VPC / VSwitch。
2. 管理员进入 `地域与资源池` → 新增地域。
3. 添加该地域的共享 PG，或对单租池预热。
4. 使用者即可在门户选择新地域。

共享 PG 请使用 `HighAvailability` 多租规格（例如 `pg.n2.2c.2m` / PostgreSQL `18.0`）。`Basic` 规格不支持容量灰度接口；如果当前地域尚未开通该灰度接口，容量页会提示服务暂不可用（HTTP 503）。

所有地域共用同一套控制面、账号和调度。

---

## 9. 升级 / 重新部署

代码更新后，直接重新部署即可：

```bash
./edge/deploy.sh
```

`deploy.sh` 会自动读取 `edge/.bootstrap.env` 中的 `SUPABASE_URL`、`SUPABASE_SERVICE_KEY`、`WORKER_TOKEN` 和 `DEPLOY_UI`，不需要再 export。

如果该文件丢失，重新设置这几个变量（`WORKER_TOKEN` 可重新生成）后执行部署，调度会自动使用新 token 重新挂载。

说明：

- `deploy.sh` 会重新部署 API、重挂调度、构建并部署 UI。
- 调度使用 Edge 内部 `SUPABASE_URL`（VPC 地址），不会因为重新部署而变化。
- Secrets 接口不会回显明文，`WORKER_TOKEN` 以本地 `.bootstrap.env` 为准；丢失时只能重新生成并重新部署。

---

## 10. 验收清单

```bash
# 1. 健康检查
curl https://<domain>/functions/v1/pool-api/api/health

# 2. 管理台
open https://<domain>/functions/v1/pool-ui/

# 3. 调度（需要 worker token）
curl -H "X-Worker-Token: <WORKER_TOKEN>" \
  https://<domain>/functions/v1/pool-api/api/internal/scheduler/status
```

预期：

- `health` 返回 `status: ok`，`cloud_mode: real`
- 调度 `jobs.active = true`，`runs.status = succeeded`
- 预热任务从 `pending` 自动推进到 `succeeded`
- 使用者申请后实例进入 `InUse / Running`
- 归还后实例回到 `InCold / Stopped`

---

## 11. 常见问题

| 现象                             | 处理                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 健康检查 500 / 连接超时          | 检查 `CONTROL_DB_URL`、数据库密码、PG 白名单是否包含 Edge 出口 IP；不建议放开 `0.0.0.0/0`                           |
| 自动白名单失败                   | 给部署账号 `ModifySecurityIps` 权限，或手动加白名单                                                                 |
| 调度 `ok=false` 或 worker 不执行 | 查看 `deploy.sh` 输出的 `tick_url`；正常应为内网 `http://172.x.x.x:80/...`，若为 sandbox 域名请重新执行 `deploy.sh` |
| 预检服务关联角色警告             | 到 RAM 补授权，不影响核心流程                                                                                       |
| 账单权限警告                     | 给账号 BSS 只读权限                                                                                                 |
| UI 静态资源 404                  | 使用 `DEPLOY_UI=1 ./edge/deploy.sh` 重新构建部署                                                                    |
| 域名证书异常                     | 域名以 `DescribeInstanceEndpoints` 返回的 `Domain` 为准，不要手工拼接；没有公网 Domain 时才回退公网 IP              |

---

## 12. RAM 用户权限（新 UID 使用 RAM 账号时）

如果部署使用 RAM 用户而不是主账号，有两种授权方式。

### 方式一：系统策略（最快）

| 系统策略                  | 是否必需 | 用途                                           |
| ------------------------- | -------- | ---------------------------------------------- |
| `AliyunRDSFullAccess`     | 必需     | PG 创建/查询/删除、白名单、公网地址、账号管理  |
| `AliyunRDSAIFullAccess`   | 必需     | Supabase 创建/查询/启停/删除、容量、端点、密钥 |
| `AliyunVPCReadOnlyAccess` | 必需     | 查询 VPC / VSwitch                             |
| `AliyunBSSReadOnlyAccess` | 可选     | 池成本页和账单预检                             |
| `AliyunRAMReadOnlyAccess` | 可选     | 预检读取服务关联角色                           |

说明：

- 系统策略范围较宽，`AliyunRDSFullAccess` / `AliyunRDSAIFullAccess` 包含删除权限；实验环境可以接受，生产建议使用下面的最小权限策略。
- `AliyunRAMReadOnlyAccess` 只包含 `GetRole`，不包含创建服务关联角色。三个服务关联角色建议由主账号先在 RAM 中创建，或额外添加自定义 `ram:CreateServiceLinkedRole`。
- `sts:GetCallerIdentity` 通常无需额外授权；如果账号策略做了严格限制，再补充自定义 Action。

### 方式二：最小权限自定义策略

以下是最小权限集合：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "rds:CreateDBInstance",
        "rds:DeleteDBInstance",
        "rds:DescribeDBInstances",
        "rds:DescribeDBInstanceAttribute",
        "rds:DescribeDBInstanceNetInfo",
        "rds:DescribeDBInstanceIPArrayList",
        "rds:ModifySecurityIps",
        "rds:AllocateInstancePublicConnection",
        "rds:CreateAccount",
        "rds:CreateDatabase",
        "rds:ResetAccountPassword",
        "rds:GrantAccountPrivilege"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "rdsai:CreateAppInstance",
        "rdsai:DescribeAppInstances",
        "rdsai:DescribeAppInstanceAttribute",
        "rdsai:StartInstance",
        "rdsai:StopInstance",
        "rdsai:RestartInstance",
        "rdsai:DeleteAppInstance",
        "rdsai:DescribeAppInstanceResource",
        "rdsai:ModifyAppInstanceResource",
        "rdsai:DescribeInstanceEndpoints",
        "rdsai:DescribeInstanceAuthInfo",
        "rdsai:DescribeInstanceDatabaseSize",
        "rdsai:DescribeDBInstanceCapacity",
        "rdsai:ModifyDBInstanceCapacity",
        "rdsai:EnableAgentRuntime"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["vpc:DescribeVpcs", "vpc:DescribeVSwitches"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["bssapi:DescribeInstanceBill"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["ram:GetRole", "ram:CreateServiceLinkedRole"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["sts:GetCallerIdentity"],
      "Resource": "*"
    }
  ]
}
```

说明：

- `rds:DeleteDBInstance` 只在使用单租池并删除真实 PG 时需要；可先不授予，后续按需添加。
- `bssapi:DescribeInstanceBill` 仅影响池成本页；不授予时预检会提示账单权限警告。
- `ram:CreateServiceLinkedRole` 用于首次创建三个服务关联角色；如果主账号已经创建好，可以只保留 `ram:GetRole`。
- `rdsai:EnableAgentRuntime` 仅创建控制面实例时需要；如果控制面由主账号创建，RAM 用户可以不授予。
- Edge 的自动白名单依赖 `rds:ModifySecurityIps`；不授予时设置 `AUTO_WHITELIST=false` 并手动加白。
- 使用 RAM 用户的 AK/SK 填入 `ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET`，不需要使用主账号 AK。
- 如果账号已有 RDS / RdsAi 的系统策略，也可以直接附加对应系统策略；上面的 JSON 适合做最小权限收敛。
- 所有资源创建在所属阿里云账号下，RAM 用户只是操作者；账单仍归属主账号。

## 13. 安全与清理

- 控制面数据库使用高权限账号，请仅授予部署与运维人员。
- 生产环境不要长期放开 PG 白名单 `0.0.0.0/0`。
- 自动白名单可通过 `AUTO_WHITELIST=false` 关闭。
- 管理员可以删除实例；使用者只能申请和归还，不能删除。
- 删除真实实例会删除云端 Supabase 实例（共享池不会删除底层 PG）。
- 单实例最多部署 5 个 Edge Function，本系统使用 2 个（pool-api / pool-ui）。
