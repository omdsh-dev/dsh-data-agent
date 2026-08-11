# 数据Agent（Data Agent）· 让 AI 帮你连数据库、写 SQL

`@deepseek-ai/dsh-data-agent` 给 DSH 加了一个数据工程师场景：在浏览器「数据库」标签页连接 MySQL / PostgreSQL / SQLite，然后新建一个「数据Agent」会话——AI 的工具面只有 4 个（`sqlcmd` / `read` / `write` / `edit`），在 Chat 标签页用自然语言说需求，agent loop 会驱动它探查表结构、把 SQL 写进 `.sql` 文件、执行并核对结果。

## 主要功能

- **数据库连接管理**：按会话连接 MySQL / PostgreSQL / SQLite（SQLite 走文件路径），连接状态驻留服务端内存，标签页切换不丢；密码仅内存、经环境变量传给客户端，绝不落盘。
- **sqlcmd 工具**：在数据库客户端（mysql / psql / sqlite3）执行 SQL/命令；无 shell 层（argv 数组化 + SQL 走 stdin），超时自动终止进程树，输出有界截断。
- **数据Agent 预设**：新建会话可选「数据Agent」——工具面恰好是 `sqlcmd`/`read`/`write`/`edit` 四个，项目其他工具（bash、grep、skill、todo、goal、web、subagent 等）全部缺席即禁用。
- **标准 agent loop**：data-agent 会话就是普通 DSH 会话，走标准 turn/step、流式输出、工具调度与持久化，零宿主改动。

## 快速安装

```sh
# 在插件目录内执行（构建产物为 lib/）
pnpm install 或按下方「本地开发」准备 node_modules
pnpm build

# 安装进 profile（首次使用会初始化该 profile）
dsh plugin --profile demo add .
```

安装后验证：

```sh
dsh --profile demo --dump-config   # 输出中应出现 data-agent 层
ls $DSH_HOME/.agent-presets/data-agent/   # 应有 agent.cordis.yml + preset.yml（由插件自动安装）
```

启动 Web GUI：

```sh
dsh --profile demo
```

在 Web GUI 中：新建会话 → 选择「数据Agent」预设 → 切到「数据库」标签页（Trajectory 右侧）→ 填写连接信息（SQLite 填数据库文件路径）→ 连接成功后回到 Chat 标签页，让 AI「列出所有表并统计行数」或「写一条 SQL 查出近 30 天订单，保存到 orders.sql 并执行」。

> 数据库客户端二进制要求：sqlite3 一般系统自带（macOS/Linux）；mysql / psql 需部署方安装，且可在插件配置 `clients` 中覆盖命令名或绝对路径。

## 架构

```text
浏览器 (apps/web)                         宿主进程 (dsh --profile demo)
┌─────────────────────────────┐          ┌──────────────────────────────────────┐
│ 数据库标签页 (order 15)      │  fetch   │ @deepseek-ai/dsh-data-agent (宿主行)   │
│  · 连接表单 (type/host/port) │ ───────▶ │  · /plugins/data-agent/* 路由          │
│  · 连接状态 + 表清单         │          │  · 连接存储服务 dataAgentConnections   │
│  · Chat = 数据Agent 对话     │          │  · 预设自安装 → $DSH_HOME/.agent-presets│
└─────────────────────────────┘          └──────────────┬───────────────────────┘
                                                       │ 同一进程
        data-agent 会话 (agent loop 全复用)              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ agent.cordis.yml (预设层，仅 3 行)                                        │
│  · persona             → 数据工程师系统提示词                             │
│  · dsh-tool-fs         → read / write / edit（项目自带）                  │
│  · dsh-data-agent/tool → sqlcmd（本包工具半体）                           │
└──────────────────────────────────────────────────────────────────────────┘
```

一个 npm 包三个装载面、宿主两条行：

| 面 | 入口 | 装载位置 |
|---|---|---|
| 服务端半体（连接存储/预设自安装） | `lib/index.js`（宿主行 `data-agent`） | 宿主组合：提供 `dataAgentConnections` 服务、预置连接、自安装预设；headless 也可用 |
| 服务端半体（HTTP 路由） | `lib/routes.js`（宿主行 `data-agent-routes`，exports 子路径 `./routes`） | 宿主组合：仅在 webserver 存在时经嵌套 inject 注册路由（headless 无 webserver 时自动跳过） |
| 工具半体 | `lib/tool.js`（exports 子路径 `./tool`） | 仅 data-agent 预设装载（`tool-sqlcmd` 行） |
| 浏览器半体 | `lib/client.js`（package.json `dsh.client` 声明） | 浏览器：数据库标签页 |

工具半体只消费宿主服务（`subprocess`、`dataAgentConnections`），不提供服务，因此预设守卫无需 `isolate` realm。

## 配置

所有字段都有 loader 默认值；无库级默认值。宿主行 `data-agent`：

| 键 | 说明 |
|---|---|
| `presetId` | 自安装的预设目录名（默认 `data-agent`） |
| `installPreset` | 是否在启动时自安装预设（默认 true；已存在则跳过，保留用户编辑） |
| `connectTimeoutMs` | /connect 连通性检查的端到端超时（默认 10000 毫秒） |
| `introspectMaxTables` | 表清单上限（默认 500） |
| `queryTimeoutMs` | sqlcmd 单次查询超时（默认 30000 毫秒） |
| `maxResultChars` | sqlcmd 捕获输出上限（stdout/stderr 各自，默认 20000 字符） |
| `clients` | 各数据库类型 CLI 客户端覆盖：`{ command?, args? }`，键为 `mysql` / `postgres` / `sqlite`（内置默认 mysql/psql/sqlite3） |
| `connections` | 配置预置连接，键为 sessionId（`'*'` = 通配符默认，任何无自有连接的会话回落它；headless/keyless 运行与部署固定默认库场景）。**不含 password 字段**——密码只允许经 /connect 路由进入内存 |

工具行 `tool-sqlcmd`（data-agent 预设内）另有 `maxRows`（默认 100，注入工具描述的 LIMIT 引导），`queryTimeoutMs` / `maxResultChars` / `clients` 与宿主行同名可配。

```yaml
# cordis.patch.yml 或 profile 层覆盖示例
- id: data-agent
  name: '@deepseek-ai/dsh-data-agent'
  config:
    clients:
      mysql:
        command: /usr/local/bin/mysql-client
    # 通配符默认连接：任何未显式 /connect 的会话回落到该库（仅限无密码场景）
    connections:
      '*':
        type: sqlite
        database: /tmp/analytics.db
```

> 路由行 `data-agent-routes` 无独立配置项；`connectTimeoutMs` / `introspectMaxTables` / `maxResultChars` 与主行同名同默认，可在该行 config 中覆盖。

## Headless / 一次性运行

`dsh run`（headless bundle）不装载 agent-presets roster，也不会为会话挂载预设——预设机制属于 web 面（apiproxy 在会话创建时 mount）。在 headless 中验证 data-agent 需要：插入 roster 行、像 web-app 一样禁用 base 的模型面工具行、预置通配符连接。示例 patch：

```yaml
- insert:
    - id: agent-presets
      name: '@deepseek-ai/dsh-agent-presets'
      config:
        default: data-agent
- id: tool-bash
  disabled: true
- id: tool-fs
  disabled: true
# ...（其余 base 模型面工具行同样 disabled，见 web-app bundle 的 cordis.patch.yml）
- id: data-agent
  config:
    connections:
      '*':
        type: sqlite
        database: /tmp/analytics.db
```

```sh
dsh run --profile <profile> --patch ./data-agent-run.yml "列出所有表并统计 orders 行数"
```

`data-agent-routes` 行在无 webserver 的 profile 中经嵌套 inject 自动跳过，无需处理。

## HTTP 接口

前缀 `/plugins/data-agent`（浏览器半体同源调用）：

| 方法/路径 | 说明 |
|---|---|
| `POST /connect` | body `{ sessionId, type, host?, port?, user?, database, password? }`；校验 → 连通性验证（列出所有表）→ 成功才保存连接，返回 `{ ok, tables }`，失败返回 `{ ok: false, error }` 且不保存 |
| `POST /disconnect` | body `{ sessionId }`；清除该会话连接 |
| `GET /status?sessionId=` | `{ connected, summary? }`；summary 为脱敏连接概要（无密码）+ 表清单 |

## 安全说明

- **密码**：仅存内存，经 `MYSQL_PWD` / `PGPASSWORD` 环境变量传给客户端，绝不出现在 argv、日志、配置或磁盘；`/status` 与连接存储的公开读取面均剥离密码。
- **无 shell 层**：`ctx.subprocess.spawn` 参数数组化，SQL 经 stdin 传入，不存在 shell 拼接注入面。
- **SQL 执行权**：审批策略为 never 时，sqlcmd 的 DDL/DML 会直接执行——连接按 session 隔离，请自行评估数据面风险（只读模式 `readonly` 列为后续版本）。
- **超时与上限**：查询超时、输出截断、表清单上限均为配置项，无硬编码 tunables。

## 卸载与回滚

```sh
dsh plugin --profile demo remove @deepseek-ai/dsh-data-agent   # 移除依赖与对应层
rm -rf $DSH_HOME/.agent-presets/data-agent                      # 手动删除自安装的预设
```

连接为内存态，无持久化数据需要清理。

## 本地开发

构建与测试：

```sh
pnpm build   # tsdown（lib/index.js、lib/tool.js、lib/invariant.js、lib/client.js）+ tsc 声明
pnpm test    # vitest：连接存储 / CLI 模板 / sqlcmd 执行（mock subprocess）
```

node_modules 按 dsh-gomoku 同款方式准备：`@deepseek-ai/*`、`cordis`、`schemastery` 等以符号链接指向本地 DSH checkout（`~/.dsh/source/current/...`），构建工具（typescript / tsdown / lightningcss / vitest）亦来自该 checkout；`pnpm-workspace.yaml` 关闭 `verifyDepsBeforeRun` 以避免 pnpm 尝试从 registry 安装未发布的 `@deepseek-ai/*` 包。

## 许可

MIT
