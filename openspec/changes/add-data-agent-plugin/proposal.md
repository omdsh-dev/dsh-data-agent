## Why

DSH（test-yejiming）会话默认携带完整编码 Agent 工具面（bash、grep、skill、web、subagent 等），但缺少面向「数据工程师」的垂直场景：用户想在浏览器里连接数据库、让 AI 用自然语言写 SQL、执行并核对结果，同时不希望 AI 拿到 Shell 等无关能力。本项目（dsh-data-agent）以 DSH 标准「bundle 插件 + agent 预设」机制交付一个【数据Agent】插件：不改动 test-yejiming 任何代码，安装后即可在 Web GUI 获得「数据库」标签页（连接 MySQL/PostgreSQL/SQLite）+ 一个工具面恰好为 `sqlcmd`/`read`/`write`/`edit` 的专属会话预设。

## What Changes

- 新建 npm 包 `@deepseek-ai/dsh-data-agent`（本目录 dsh-data-agent），三个可装载面：
  - **服务端半体**（`src/index.ts`）：`/plugins/data-agent/*` HTTP 路由（连接/断开/状态/连通性验证）、按 session 隔离的连接存储服务 `dataAgentConnections`（密码仅内存）、预设自安装（复制 `preset/data-agent/` 到 `$DSH_HOME/.agent-presets/`）、loader 配置（CLI 客户端映射、超时、上限）。
  - **工具半体**（`src/tool.ts`，exports 子路径 `./tool`）：`sqlcmd` 工具，经 `ctx.subprocess`（无 shell 层）调用数据库 CLI 客户端（mysql / psql / sqlite3），密码经环境变量传递。
  - **浏览器半体**（`src/client/`，package.json `dsh.client` 声明）：在 Trajectory（order 10）右侧注册「数据库」会话视图标签页（order 15），含连接表单、连接状态与表清单。
- 新增 agent 预设 `data-agent`（`preset/data-agent/`）：仅组合 `persona` + `@deepseek-ai/dsh-tool-fs`（read/write/edit）+ `@deepseek-ai/dsh-data-agent/tool`（sqlcmd）。**其他项目工具（bash、fs-search、str-replace-editor、skill、todo、goal、plan、web、subagent、workflow 等）全部缺席即禁用** —— 由 preset 组合语义天然满足，不修改宿主组成。
- agent loop 完全复用：data-agent 会话即标准 DSH 会话，模型在 Chat 标签页写 SQL 需求，由 `dsh-agent-loop` 驱动 sqlcmd/read/write/edit 完成「探查 schema → 写 SQL 文件 → 执行 → 看结果」闭环。
- 配套：单元测试（连接存储、CLI 模板、工具执行 mock）、SQLite 端到端冒烟、README（安装/架构/配置/安全）。

## Capabilities

### New Capabilities

- `database-connections`: 服务端连接管理 —— 按 session 隔离的内存连接存储（密码剥离）、`/connect` `/disconnect` `/status` 路由、连通性验证（列出表）、CLI 客户端模板（mysql/psql/sqlite3）与预设自安装。
- `sqlcmd-tool`: 模型面工具 `sqlcmd` —— 经无 shell 层的 `ctx.subprocess` 在数据库客户端执行 SQL/命令，密码走环境变量，超时/输出截断/取消，未连接时明确报错。
- `data-agent-preset`: `data-agent` agent 预设 —— 组合 persona + dsh-tool-fs + sqlcmd，工具面恰为 4 个工具，其余全部缺席即禁用。
- `database-view`: 浏览器「数据库」会话视图标签页 —— 连接表单、状态与表清单、非 data-agent 会话引导卡、i18n（zh/en）。

### Modified Capabilities

<!-- 无：test-yejiming 自身没有任何 spec 变化，本项目 openspec/specs/ 为空 -->

## Impact

- **代码**：全部落在本目录 `/Users/yejiming/Desktop/OpenSource/dsh-data-agent`（package.json / cordis.patch.yml / tsdown.config.ts / preset/ / src/ / tests/）；**不修改** test-yejiming 任何文件。
- **依赖**：`@deepseek-ai/dsh-client-*`（locale/runtime/ui-conversation/ui-primitives/ui-slots）、`@deepseek-ai/dsh-host-webserver`、`@deepseek-ai/dsh-invariants`、`cordis`、`react`（peer）；`schemastery`（loader schema）；dev：tsdown / lightningcss / vitest / typescript。运行时数据库 CLI（mysql/psql/sqlite3）由部署方提供，命令名可配置。
- **宿主机制（复用，不修改）**：bundle 插件安装（`dsh.bundle.patch` + `cordis.patch.yml`）、客户端模块装载（`pkg.dsh.client`）、agent 预设装载（系统根 + `$DSH_HOME/.agent-presets/`）、`conversation.view` 会话视图槽、`ctx.subprocess`、`ctx.httpServer.register`、`ctx.tools.register(defineTool(...))`、`ToolExecutionInput.agent`。
- **风险**：sqlcmd 直接执行 DDL/DML（审批策略为 never 时无拦截）；密码仅内存不落盘；连接按 session 隔离。
