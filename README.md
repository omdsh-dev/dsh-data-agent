# 数据Agent（Data Agent）· 让 AI 帮你连数据库、写 SQL

[English](README.en.md) | **中文**

![数据Agent 会话](assets/session.png)

用AI写过SQL的同学都有这种体验，AI现在写代码能力已经很强了，但SQL逻辑老写不对。**原因是AI并没有与数据库操作形成Agent Loop**，它只能根据静态指令生成SQL，却无法感知执行结果、无法根据报错或返回数据动态调优。

这个插件就是来填这个坑的。它复用DeepSeek Harness强大的Agent主循环能力，让AI连上数据库并获得实时反馈，同时删掉所有跟数据无关的上下文和工具，让AI专注于SQL生成和业务数据分析。

我利用DeepSeek Harness的Agent预设功能，定义了专用的Data Agent预设。仅保留read、edit、write三个DSH自带的 tools，并自定义sqlcmd tool替代bash tool。

懂行的朋友一眼就能看出，这是借鉴了Pi Agent的设计，只使用最基本的工具。

用起来也很简单：在对话界面配好数据库连接，授权AI访问权限，然后就可以向AI提问，让AI帮你查询、更新、分析。

## 主要功能

- **数据库连接管理**：按会话连接 MySQL / PostgreSQL / SQLite / Oracle / Hive / Impala / ClickHouse / Doris / SQL Server（SQLite 走文件路径，Oracle 填服务名/SID，Hive/Impala 填默认库，SQL Server 浏览当前库内的 schema），连接状态驻留服务端内存，布局切换不丢；密码仅内存、经环境变量或 stdin 连接前缀传给客户端，绝不落盘。

  ![数据库连接](assets/connection.png)
- **数据库工作台**（内嵌于会话输入框上方）：连接配置卡（连接成功后折叠为摘要行，可展开查看）；库表浏览（点击「库表」按钮弹出 Modal：单击库展开表列表（可滚动），点击表查看结构）；SQL 命令框（编辑并运行 SQL，非 agent 通道，结果等宽展示）。连接配置持久化到浏览器 localStorage，切换页面/重启自动回填并重连。开始对话后工作台自动变为左侧栏，对话记录与输入框在右侧。

  ![数据库工作台](assets/tables.png)
- **sqlcmd 工具**：在数据库客户端（mysql / psql / sqlite3 / sqlplus / beeline / impala-shell / clickhouse-client / sqlcmd）执行 SQL/命令；无 shell 层（argv 数组化 + SQL 走 stdin），超时自动终止进程树，输出有界截断。
- **数据Agent 预设**：新建会话可选「数据Agent」——工具面恰好是 `sqlcmd`/`read`/`write`/`edit` 四个，项目其他工具（bash、grep、skill、todo、goal、web、subagent 等）全部缺席即禁用；非数据Agent 会话不渲染工作台，零影响。

  ![数据Agent 预设](assets/settings.png)
- **标准 agent loop**：data-agent 会话就是普通 DSH 会话，走标准 turn/step、流式输出、工具调度与持久化，零宿主改动。
- **规划中（暂不支持）**：FlinkSQL / SparkSQL——它们是计算引擎而非数据库连接，接入需文件输入通道与引擎语义改造，将在后续版本评估。

## 快速安装

支持两种安装方式，均**无需本地构建**（构建产物 `lib/` 已提交进仓库，且不设
`prepare`/`prepack` 脚本）。

### 方式一：npm 安装（推荐）

```sh
# 从 npm 安装（首次使用会初始化该 profile）
dsh plugin --profile web add @yejiming/dsh-data-agent
```

### 方式二：GitHub 源码安装

```sh
# 从 GitHub 源码安装（仓库已提交构建产物 lib/，安装时无需构建）
dsh plugin --profile web add github:omdsh-dev/dsh-data-agent
```

安装后验证：

```sh
dsh --profile web --dump-config   # 输出中应出现 data-agent 层
ls $DSH_HOME/.agent-presets/data-agent/   # 应有 agent.cordis.yml + preset.yml（由插件自动安装）
```

启动 Web GUI：

```sh
dsh --profile web
```

在 Web GUI 中：新建会话 → 选择「数据Agent」预设 → 输入框上方出现数据库工作台 → 填写连接信息（类型/主机/端口/用户/密码/库名；SQLite 填文件路径，SQL Server 的「库」列当前库内 schema，跨库走 SQL）→ 连接成功后浏览库表（单击库展开表、点击表看结构），或在 SQL 命令框直接运行 SQL → 开始对话后工作台移到左侧，在 Chat 让 AI「列出所有表并统计行数」或「写一条 SQL 查出近 30 天订单，保存到 orders.sql 并执行」。

> 数据库客户端二进制要求：sqlite3 一般系统自带（macOS/Linux）；mysql / psql / sqlplus / beeline / impala-shell / clickhouse-client / sqlcmd 需部署方安装，且可在插件配置 `clients` 中覆盖命令名或绝对路径（缺失时连接报错会点名缺失的命令）。Doris 复用 mysql 客户端（默认端口 9030）。

## 架构

```text
浏览器 (apps/web)                         宿主进程 (dsh --profile web)
┌─────────────────────────────┐          ┌──────────────────────────────────────┐
│ 数据库工作台 (input.dock)    │  fetch   │ @yejiming/dsh-data-agent (宿主行)   │
│  · 连接配置 (9 类型)         │ ───────▶ │  · /plugins/data-agent/* 路由          │
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

工具半体只消费宿主服务（`tools`、`subprocess`、`dataAgentConnections`），不提供服务，因此预设守卫无需 `isolate` realm。

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
| `readonly` | 只读护栏（默认 false）：true 时 `sqlcmd` 与 `/query` 仅放行读语句（SELECT/SHOW/DESCRIBE/EXPLAIN/PRAGMA 等），写语句直接拒绝 |
| `clients` | 各数据库类型 CLI 客户端覆盖：`{ command?, args? }`，键为 `mysql` / `postgres` / `sqlite` / `oracle` / `hive` / `impala` / `clickhouse` / `doris` / `sqlserver`（内置默认 mysql/psql/sqlite3/sqlplus/beeline/impala-shell/clickhouse-client/mysql/sqlcmd；sqlserver 默认参数含 `-C` 信任服务器证书，可用 `args` 覆盖） |
| `connections` | 配置预置连接，键为 sessionId（`'*'` = 通配符默认，任何无自有连接的会话回落它；headless/keyless 运行与部署固定默认库场景）。**不含 password 字段**——密码只允许经 /connect 路由进入内存；可选 `readonly` 字段按连接锁定只读 |

工具行 `tool-sqlcmd`（data-agent 预设内）另有 `maxRows`（默认 100，注入工具描述的 LIMIT 引导）与 `readonly`，`queryTimeoutMs` / `maxResultChars` / `clients` 与宿主行同名可配。

路由行 `data-agent-routes` 独立配置：`connectTimeoutMs` / `introspectMaxTables` / `maxResultChars` / `readonly` / `clients` 与主行同名同默认；另有 `queryTimeoutMs`（/query 与元数据查询超时，默认 30000）与 `maxQueryChars`（/query 单条 SQL 长度上限，默认 65536）。

```yaml
# cordis.patch.yml 或 profile 层覆盖示例
- id: data-agent
  name: '@yejiming/dsh-data-agent'
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
| `POST /connect` | body `{ sessionId, type, host?, port?, user?, database, password?, readonly? }`；校验 → 连通性验证（列出所有表）→ 成功才保存连接，返回 `{ ok, tables }`，失败返回 `{ ok: false, error }` 且不保存 |
| `POST /disconnect` | body `{ sessionId }`；清除该会话连接 |
| `GET /status?sessionId=` | `{ connected, summary? }`；summary 为脱敏连接概要（无密码，含 `readonly` 当连接显式设定时）+ 表清单 |
| `GET /schemas?sessionId=` | `{ ok, schemas: string[] }`；库/数据库列表（sqlite 为 `['main']`） |
| `GET /tables?sessionId=&schema=` | `{ ok, tables: string[] }`；某库的表列表（sqlite 忽略 schema 参数） |
| `GET /describe?sessionId=&schema=&table=` | `{ ok, columns: [{ name, type, nullable? }] }`；表结构（sqlite 忽略 schema） |
| `POST /query` | body `{ sessionId, sql }`；运行任意 SQL（工作台命令框，非 agent 通道），返回 `{ ok, result: { exitCode, stdout, stderr, truncated } }`；`sql` 长度上限 `maxQueryChars`；readonly 开启时拒绝写语句 |

schema/table 标识符仅允许 `[A-Za-z0-9_$]`（服务端白名单校验并转义引用，拒绝注入形字符）。

## 安全说明

- **密码**：服务端仅存内存，传递通道按类型：mysql/doris 经 `MYSQL_PWD`、postgres 经 `PGPASSWORD`、clickhouse 经 `CLICKHOUSE_PASSWORD`、sqlserver 经 `SQLCMDPASSWORD` 环境变量；oracle 经 sqlplus `connect user/pass@...` stdin 前缀、hive 经 beeline `!connect` stdin 前缀（均不进 argv）；impala 默认不传密码（LDAP/kerberos 由部署侧 `clients` 覆盖）。`/status` 与连接存储的公开读取面均剥离密码。
- **连接配置持久化**：工作台把连接配置（type/host/port/user/database）保存到浏览器 localStorage（键 `dsh-data-agent.connection.v1`），用于切换页面/重启后回填表单并自动重连一次。**密码默认不落盘**：仅当用户勾选「记住密码」时才持久化密码（明文 localStorage，本机单用户场景的显式 opt-in）。若需清除：浏览器控制台执行 `localStorage.removeItem('dsh-data-agent.connection.v1')`。
- **无 shell 层**：`ctx.subprocess.spawn` 参数数组化，SQL 与连接前缀经 stdin 传入，不存在 shell 拼接注入面；元数据路由的 schema/table 标识符经收紧白名单 `[A-Za-z0-9_$]` 校验并按类型转义引用（反引号/双引号），拒绝 `#`、`--`、`;`、`'` 等注入形字符。
- **SQL 执行权**：审批策略为 never 时，sqlcmd 与 `/query` 的 DDL/DML 会直接执行——连接按 session 隔离，请自行评估数据面风险。可设 `readonly: true`（宿主/工具/路由三行同名，或 `/connect` 传 `readonly: true` 按连接锁定）强制只放行读语句（SELECT/SHOW/DESCRIBE/EXPLAIN/PRAGMA 等），作为误操作防护；对更强对手防护，仍建议配合数据库侧只读账号。
- **SQL Server 证书信任**：默认客户端参数含 `-C`（信任服务器证书），便于连接本地/自签实例；如需严格校验，在 `clients.sqlserver.args` 中覆盖为不含 `-C` 的参数集。
- **超时与上限**：查询超时、输出截断、表清单上限、/query 单条 SQL 长度均为配置项，无硬编码 tunables。

## 卸载与回滚

```sh
dsh plugin --profile web remove @yejiming/dsh-data-agent   # 移除依赖与对应层
rm -rf $DSH_HOME/.agent-presets/data-agent                      # 手动删除自安装的预设
```

连接为内存态，无持久化数据需要清理。

## 本地开发

构建与测试：

```sh
pnpm build   # 清空并重建 lib/（tsdown：lib/index.js、lib/routes.js、lib/tool.js、lib/invariant.js、lib/client.js）+ tsc 声明
pnpm test    # vitest：连接存储 / CLI 模板 / sqlcmd 执行（mock subprocess）
```

可选的真实环境集成冒烟（未设置 `DSH_SMOKE_HOST` 时自动跳过；会在目标服务上临时创建并清理 `dsh_smoke` 库表）：

```sh
DSH_SMOKE_HOST=<smoke-host> \
DSH_SMOKE_CH_PASSWORD='...' DSH_SMOKE_MSSQL_PASSWORD='...' \
PATH="/path/to/clickhouse-client:/path/to/mysql:/path/to/sqlcmd:$PATH" \
pnpm vitest run tests/integration-smoke.spec.ts
```

`lib/` 已提交进仓库，安装与调试（含 `dsh plugin add .`）都不需要先构建。重新
构建产物时直接 `pnpm install` 即可：`@deepseek-ai/*` 等依赖均已发布到 npm，
无需再从本地 DSH checkout 复制/链接 node_modules。`pnpm-workspace.yaml` 采用
dsh 同款约定（`nodeLinker: hoisted`）；pnpm 11 的供应链策略会拦截「发布不久」
的包与依赖构建脚本，仓库已预置 `minimumReleaseAgeExclude`（rc.6 全家桶）与
`allowBuilds: esbuild`。

## 许可

MIT

## 友情链接

- [dshfind.com](https://dshfind.com)：DeepSeek Harness 的中文学习与分享社区。读懂论文，写出插件，看见整个生态。
- [dsh-web-ui](https://github.com/dsh-external/dsh-web-ui)：DeepSeek Harness（DSH）Web UI 的插件与皮肤集合
- [dsh-cc-tui](https://github.com/dsh-external/dsh-cc-tui)：Claude Code 风格全屏交互终端插件
