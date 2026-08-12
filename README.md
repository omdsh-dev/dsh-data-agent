# 数据Agent（Data Agent）· 让 AI 帮你连数据库、写 SQL

[English](README.en.md) | **中文**

![数据Agent 会话](assets/session.png)

`@deepseek-ai/dsh-data-agent` 给 DSH 加了一个数据工程师场景：新建「数据Agent」会话后，数据库工作台（连接配置、库表浏览、SQL 命令框）直接内嵌在会话里——新建会话时位于输入框上方，开始对话后居左、对话记录居右。AI 的工具面只有 4 个（`sqlcmd` / `read` / `write` / `edit`），在 Chat 里用自然语言说需求，agent loop 会驱动它探查表结构、把 SQL 写进 `.sql` 文件、执行并核对结果。

## 主要功能

- **数据库连接管理**：按会话连接 MySQL / PostgreSQL / SQLite / Oracle / Hive / Impala（SQLite 走文件路径，Oracle 填服务名/SID，Hive/Impala 填默认库），连接状态驻留服务端内存，布局切换不丢；密码仅内存、经环境变量或 stdin 连接前缀传给客户端，绝不落盘。

  ![数据库连接](assets/connection.png)
- **数据库工作台**（内嵌于会话输入框上方）：连接配置卡（连接成功后折叠为摘要行，可展开查看）；库表浏览（点击「库表」按钮弹出 Modal：单击库展开表列表，表列表单页 5 条可滚动，点击表查看结构）；SQL 命令框（编辑并运行 SQL，非 agent 通道，结果等宽展示）。连接配置持久化到浏览器 localStorage，切换页面/重启自动回填并重连。开始对话后工作台自动变为左侧栏，对话记录与输入框在右侧。
- **sqlcmd 工具**：在数据库客户端（mysql / psql / sqlite3 / sqlplus / beeline / impala-shell）执行 SQL/命令；无 shell 层（argv 数组化 + SQL 走 stdin），超时自动终止进程树，输出有界截断。
- **数据Agent 预设**：新建会话可选「数据Agent」——工具面恰好是 `sqlcmd`/`read`/`write`/`edit` 四个，项目其他工具（bash、grep、skill、todo、goal、web、subagent 等）全部缺席即禁用；非数据Agent 会话不渲染工作台，零影响。

  ![数据Agent 预设](assets/settings.png)
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

在 Web GUI 中：新建会话 → 选择「数据Agent」预设 → 输入框上方出现数据库工作台 → 填写连接信息（类型/主机/端口/用户/密码/库名；SQLite 填文件路径）→ 连接成功后浏览库表（双击库看表、点击表看结构），或在 SQL 命令框直接运行 SQL → 开始对话后工作台移到左侧，在 Chat 让 AI「列出所有表并统计行数」或「写一条 SQL 查出近 30 天订单，保存到 orders.sql 并执行」。

> 数据库客户端二进制要求：sqlite3 一般系统自带（macOS/Linux）；mysql / psql / sqlplus / beeline / impala-shell 需部署方安装，且可在插件配置 `clients` 中覆盖命令名或绝对路径（缺失时连接报错会点名缺失的命令）。

## 架构

```text
浏览器 (apps/web)                         宿主进程 (dsh --profile demo)
┌─────────────────────────────┐          ┌──────────────────────────────────────┐
│ 数据库工作台 (input.dock)    │  fetch   │ @deepseek-ai/dsh-data-agent (宿主行)   │
│  · 连接配置 (6 类型)         │ ───────▶ │  · /plugins/data-agent/* 路由          │
│  · 库表浏览 + SQL 命令框     │          │  · 连接存储服务 dataAgentConnections   │
│  · hero 堆叠 / active 左栏   │          │  · 预设自安装 → $DSH_HOME/.agent-presets│
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
| 浏览器半体 | `lib/client.js`（package.json `dsh.client` 声明） | 浏览器：输入条带内嵌数据库工作台（`conversation.input.dock`） |

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
| `clients` | 各数据库类型 CLI 客户端覆盖：`{ command?, args? }`，键为 `mysql` / `postgres` / `sqlite` / `oracle` / `hive` / `impala`（内置默认 mysql/psql/sqlite3/sqlplus/beeline/impala-shell） |
| `connections` | 配置预置连接，键为 sessionId（`'*'` = 通配符默认，任何无自有连接的会话回落它；headless/keyless 运行与部署固定默认库场景）。**不含 password 字段**——密码只允许经 /connect 路由进入内存 |

工具行 `tool-sqlcmd`（data-agent 预设内）另有 `maxRows`（默认 100，注入工具描述的 LIMIT 引导），`queryTimeoutMs` / `maxResultChars` / `clients` 与宿主行同名可配。

路由行 `data-agent-routes` 独立配置：`connectTimeoutMs` / `introspectMaxTables` / `maxResultChars` 与主行同名同默认；另有 `queryTimeoutMs`（/query 与元数据查询超时，默认 30000）与 `maxQueryChars`（/query 单条 SQL 长度上限，默认 65536）。

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

## Headless / 一次性运行

**重要**：`dsh run`（headless bundle）不装载 agent-presets roster，也不会为会话挂载预设——预设机制属于 web 面（apiproxy 在会话创建时 mount）。因此 **headless 会话无法使用 sqlcmd/read/write/edit 四工具面**，sqlcmd 的验证与使用都在 web 面完成；headless 中如需数据库能力，只能靠宿主 base 自带工具（如 bash 直接调用客户端）。

（注：插入 roster 行 + 禁用 base 工具行的 patch 组合无法在 headless 中复现预设工具面——agent 会得到一个零工具的空组合，模型无工具可调。如需 headless 冒烟，仅验证「连接配置预置 + 宿主工具可用」即可。）

`data-agent-routes` 行在无 webserver 的 profile 中经嵌套 inject 自动跳过，无需处理。

## HTTP 接口

前缀 `/plugins/data-agent`（浏览器半体同源调用）：

| 方法/路径 | 说明 |
|---|---|
| `POST /connect` | body `{ sessionId, type, host?, port?, user?, database, password? }`；校验 → 连通性验证（列出所有表）→ 成功才保存连接，返回 `{ ok, tables }`，失败返回 `{ ok: false, error }` 且不保存 |
| `POST /disconnect` | body `{ sessionId }`；清除该会话连接 |
| `GET /status?sessionId=` | `{ connected, summary? }`；summary 为脱敏连接概要（无密码）+ 表清单 |
| `GET /schemas?sessionId=` | `{ ok, schemas: string[] }`；库/数据库列表（sqlite 为 `['main']`） |
| `GET /tables?sessionId=&schema=` | `{ ok, tables: string[] }`；某库的表列表（sqlite 忽略 schema 参数） |
| `GET /describe?sessionId=&schema=&table=` | `{ ok, columns: [{ name, type, nullable? }] }`；表结构（sqlite 忽略 schema） |
| `POST /query` | body `{ sessionId, sql }`；运行任意 SQL（工作台命令框，非 agent 通道），返回 `{ ok, result: { exitCode, stdout, stderr, truncated } }`；`sql` 长度上限 `maxQueryChars` |

schema/table 标识符仅允许 `[A-Za-z0-9_$#.-]`（服务端白名单校验，拒绝注入形字符）。

## 安全说明

- **密码**：服务端仅存内存，传递通道按类型：mysql 经 `MYSQL_PWD`、postgres 经 `PGPASSWORD` 环境变量；oracle 经 sqlplus `connect user/pass@...` stdin 前缀、hive 经 beeline `!connect` stdin 前缀（均不进 argv）；impala 默认不传密码（LDAP/kerberos 由部署侧 `clients` 覆盖）。`/status` 与连接存储的公开读取面均剥离密码。
- **连接配置持久化**：工作台在连接成功后把连接配置（**含密码**，明文）保存到浏览器 localStorage（键 `dsh-data-agent.connection.v1`，用户确认的本机单用户场景），用于切换页面/重启后回填表单并自动重连一次；断开不清除。如需清除：浏览器控制台执行 `localStorage.removeItem('dsh-data-agent.connection.v1')`。
- **无 shell 层**：`ctx.subprocess.spawn` 参数数组化，SQL 与连接前缀经 stdin 传入，不存在 shell 拼接注入面；元数据路由的 schema/table 标识符过白名单校验。
- **SQL 执行权**：审批策略为 never 时，sqlcmd 与 `/query` 的 DDL/DML 会直接执行——连接按 session 隔离，请自行评估数据面风险（只读模式 `readonly` 列为后续版本）。
- **超时与上限**：查询超时、输出截断、表清单上限、/query 单条 SQL 长度均为配置项，无硬编码 tunables。

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
