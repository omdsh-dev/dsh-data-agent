## Context

DSH（test-yejiming）是一套「宿主 cordis 组合 + agent 预设」的 Harness：宿主组合（base/web cordis.yml）持有注册表、沙箱、审批、持久化与模型路由；agent 预设（`agent.cordis.yml` + `preset.yml`）组合一个会话拥有什么工具与提示词。预设由 `dsh-agent-presets` 装载：系统根（shipped 预设）+ `$DSH_HOME/.agent-presets/`（用户根，trust=user）两个 root，会话创建时固定预设、不可中途更换（`agent-preset-locked`）。

本项目（dsh-data-agent）要交付一个数据工程师垂直场景插件：浏览器「数据库」标签页连接 MySQL/PostgreSQL/SQLite，data-agent 预设会话让 AI 用自然语言写 SQL，经 `sqlcmd` 工具在数据库客户端执行。参考项目 dsh-gomoku 已验证整套外部插件路径：bundle（`cordis.patch.yml` 插入行）→ `dsh plugin --profile demo add .` → 宿主行 + 浏览器半体（`dsh.client` 声明 + `/plugins/<id>/client.js`）+ `conversation.view` 标签页。本设计在 gomoku 模式上新增「工具半体 + agent 预设」两块，均已被 test-yejiming 源码确认存在对应机制（预设行 `name` 支持包子路径，如 `@deepseek-ai/dsh-tool-subagent-control/list-agents`）。

已核实的关键事实（测试于 test-yejiming 源码/docs）：

- 预设 roots：`apps/cli/src/profile-boot.ts` 固定 `SHIPPED_PRESET_ROOT` + `dshHomePath('.agent-presets')`，`DSH_HOME` 按 boot 时环境变量解析。
- 预设组合语义：「preset 组合一个 agent 拥有什么，而不是从共享默认里做减法」——缺席即禁用（`minimal` 预设即证明）。
- 工具行：`ctx.tools.register(defineTool({...}))`，`inject: ['tools']`；`execute(args, exec)` 中 `exec.agent.id` 即 `SessionId`（与 `exec.agent.session.id` 相同）。
- 无 shell 子进程：`ctx.subprocess.resolveExecutable(command, env?, signal?)` + `ctx.subprocess.spawn(spec)`；`SubprocessSpawnSpec` 的 `env` 显式条目合并到 scrubbed 父环境之上，字符串值属「deliberate caller opt-in」，凭据形条目（MYSQL_PWD/PGPASSWORD）可幸存 scrub；`stdio` 支持 `SubprocessCollect` 收集模式（offset reader + spill file）。
- 路由：`ctx.httpServer.register({ kind: 'prefix', path, handler })` 返回 disposer。
- 客户端模块装载：`packages/client/modules/src/index.ts` 当前读 **`pkg.dsh.client`**（gomoku package.json 里的 `dshClient` 拼写已过时——新代码必须用 `dsh.client`）。
- 会话视图槽：`conversation.view` 是 `{ kind: 'list', scope: 'session' }` 槽，`order` 决定标签顺序（Trajectory=10，gomoku=20），`ConvViewProps` 经 `SessionStandardProps` 自带 `sessionId`；会话 summary 携带 `agentPreset`（`ui-agent-preset` 的 `noteAgentPreset`）。
- 预设守卫：preset 内**提供**服务的行必须进 `isolate` realm；只**消费**宿主服务的行无需 realm。sqlcmd 工具半体只消费（`subprocess` + `dataAgentConnections`），故无需 realm。
- 浏览器构建：CJS closure-factory + `window.__ModuleLoader__.load({id, factory})`，平台模块 external，CSS Module 经 lightningcss 内联为 `<style data-plugin-css>`（gomoku tsdown.config.ts 同款）。

## Goals / Non-Goals

**Goals:**

- 在 dsh-data-agent 目录交付一个可安装的 DSH 插件包 `@deepseek-ai/dsh-data-agent`：服务端半体（连接存储 + HTTP 路由 + 预设自安装）、工具半体（sqlcmd）、浏览器半体（数据库标签页）、data-agent 预设。
- 安装后：Web GUI 新建会话可选「数据Agent」预设；数据库标签页连接 MySQL/PostgreSQL/SQLite（SQLite 走文件路径）；Chat 标签页即标准 agent loop 会话，AI 的工具面恰为 `sqlcmd`/`read`/`write`/`edit`，能完成「探查 schema → 写 .sql 文件 → 执行 → 核对结果」闭环。
- 安全基线：密码仅内存、仅经环境变量进客户端、绝不出现在 argv/日志/配置；无 shell 层执行；输出有界；连接按 session 隔离。
- 不修改 test-yejiming 任何代码；验证通过单元测试 + SQLite 端到端冒烟 + 手工回归。

**Non-Goals:**

- 不实现 v1.1 项：连接持久化到重启后（内存 + 手动重连）、`readonly` 强制只读模式、`/query` 非 agent 通道、表数据预览。
- 不把 bash/grep/skill 等工具「逐个禁用」——preset 缺席即禁用，不在宿主做减法。
- 不做 SQL 方言翻译/查询优化器；sqlcmd 只透传 SQL 文本给客户端。
- 不修改 DSH 宿主组合、沙箱、审批、模型路由。

## Decisions

### D1 包结构与装载面（三入口一包）

`package.json` 声明 `main: lib/index.js` + exports 映射 `.`、`./tool`、`./client`、`./invariant`、`./cordis.patch.yml`；`dsh.bundle.patch: ./cordis.patch.yml`（插入一行 `{ id: data-agent, name: '@deepseek-ai/dsh-data-agent' }`）；`dsh.client`（见 D3）；tsdown 三入口：`index` / `tool` / `client`（node ESM ×2 + browser CJS closure-factory）。

- 备选：像 gomoku 一样只有两入口（index + client），工具行直接复用 `index` 入口。否决：工具半体要求 `inject: ['subprocess', 'dataAgentConnections']` 且只在预设装载，独立 `./tool` 子路径让「服务端半体」与「工具半体」依赖面彻底分离（服务端不需要 subprocess；工具不需要 httpServer），也符合 `@deepseek-ai/dsh-tool-subagent-control/list-agents` 的既有子路径行模式。

### D2 激活方式：bundle patch + 预设自安装

- 宿主激活走标准 bundle：`dsh plugin --profile demo add .` → `cordis.patch.yml` 插入 `data-agent` 行（宿主组合），行内 `inject: ['httpServer']`。
- 预设激活走自安装：服务端半体 `apply()` 时把包内 `preset/data-agent/{agent.cordis.yml,preset.yml}` 复制到 `$DSH_HOME/.agent-presets/data-agent/`。**已存在则跳过**（保留用户编辑；幂等）；`DSH_HOME` 按环境变量解析（与 profile-boot 一致）。配置 `installPreset`（默认 true）可关闭，`presetId` 可改名。
- 备选：把预设文件直接放进 shipped 预设目录——不可行，会修改 test-yejiming 安装；`$DSH_HOME/.agent-presets` 是唯一不改宿主的用户根。

### D3 浏览器声明用 `dsh.client`（不是 gomoku 的 `dshClient`）

`packages/client/modules/src/index.ts` 当前解析 `pkg.dsh.client`（platform/inject 校验），gomoku 包里的 `dshClient` 拼写已过时。本包一律用 `dsh.client: { inject: [...], platform: 'web' }`，客户端装载路径 `/plugins/data-agent/client.js`。

### D4 连接存储：宿主行提供服务，按 session 隔离，密码不出内存

- `dataAgentConnections`（`ctx.provide`）由服务端半体提供，API：`set(sessionId, conn)` / `get(sessionId)` / `clear(sessionId)` / `has(sessionId)`。
- 连接结构 `{ type: 'mysql'|'postgres'|'sqlite', host?, port?, user?, database, password? }`；SQLite 时 host/port/user 为空，`database` 为文件路径。
- `get` 返回**剥离密码**的副本（UI/工具只拿到脱敏视图）；密码仅存内存 Map，绝不写入 session 日志、settings、配置或磁盘。
- 会话隔离：key 为 `Agent.id`（SessionId）；工具执行时经 `exec.agent.id` 查存储，A 会话连接对 B 会话不可见。
- 工具半体在预设里 `inject: ['subprocess', 'dataAgentConnections']` —— 只消费宿主服务，无 `isolate` 需求，过 preset 守卫。

### D5 sqlcmd 执行：无 shell 层 + 密码走 env + 有界输出

- 客户端解析：`ctx.subprocess.resolveExecutable(command, env?)`（裸命令名走 scrubbed PATH；配置可覆盖命令名/绝对路径）。
- 调用：`ctx.subprocess.spawn({ argv, cwd, stdio: { stdin: 'pipe', stdout: collect, stderr: collect }, graceMs, signal, env })`。**SQL 经 stdin 传入**（argv 只含客户端标志），无 shell 层、无拼接注入面；密码经 `env` 显式条目（`MYSQL_PWD` / `PGPASSWORD`，字符串值在 spawn 合并时是 opt-in，幸存父环境 scrub），绝不出现在 argv。
- 模板（纯函数，`clients.ts`，可单测）：
  - mysql：`mysql -h <host> -P <port> -u <user> -D <database> --batch --raw`，env `MYSQL_PWD`；
  - postgres：`psql -h <host> -p <port> -U <user> -d <database> -t -A`，env `PGPASSWORD`；
  - sqlite：`sqlite3 -header -column <database-file>`（无 host/port/user）。
- 超时/取消：`queryTimeoutMs`（默认 30000）驱动 AbortController，其 signal 同时作为 spawn 的 `signal`（进程树终止级联）与 `exec.signal` 的合并信号；客户端退出码非 0 视为查询失败（stderr 作错误信息）。
- 输出有界：collect 模式下 `maxResultChars`（默认 20000）截断 + `truncated` 标记（渲染时追加截断提示）。
- 返回值：`{ exitCode, stdout, stderr, truncated }`，render 为等宽文本块（render intent `terminal`）。
- 未连接：查存储为空时直接报「请先在数据库标签页连接」（错误消息清晰，不做猜测）。

### D6 连通性验证 = 列出所有表

`/connect` 保存连接后立即运行类型对应的表清单 SQL（`SHOW TABLES` / `SELECT tablename FROM pg_tables WHERE schemaname='public'` / `SELECT name FROM sqlite_master WHERE type='table'`），成功即返回 `{ ok: true, tables }`；失败返回 `{ ok: false, error }` 且**不保存连接**。表清单上限 `introspectMaxTables`（默认 500）。

### D7 预设组合（agent.cordis.yml 仅 3 行）

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config: { text: >- 数据工程师 Agent 系统提示词（见 spec），含 {{cwd}} 与 4 工具工作流 }
- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'          # 项目自带 read / write / edit
- id: tool-sqlcmd
  name: '@deepseek-ai/dsh-data-agent/tool'  # 本包工具半体 sqlcmd
```

`preset.yml`：`name: 数据Agent`、`description`、`order: 4`（在标准/代码/极简之后）。要点：不装载任何其他工具行 → 模型可见工具面恰好 4 个；三行都只消费宿主服务 → 无需 realm；宿主组合（沙箱/审批/持久化/模型路由）与普通会话一致。

### D8 浏览器半体：数据库标签页（order 15）

- `ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: 'data-agent', order: 15, label: () => t('tab.label'), locale: NS }, DatabaseView))`；order 15 位于 Trajectory（10）与 gomoku（20）之间。
- DatabaseView（会话作用域，props 自带 `sessionId`）：读取会话 summary 的 `agentPreset`——
  - 是 `data-agent` 预设：渲染连接表单（类型下拉 MySQL/PostgreSQL/SQLite、host、port、user、password、database）+ 连接/断开 + 状态 + 表清单 + 「切到 Chat 标签页与数据 Agent 对话」引导；密码框不回显；
  - 不是：渲染引导卡「请在新建会话时选择『数据Agent』预设」，不发请求。
- 状态驻留服务端内存（连接存储），标签页切换不丢（同 gomoku 的 store 外置思路）；i18n 注册 `data-agent` namespace（zh/en）。
- 客户端构建遵守 bundle purity gate：平台模块（react、ui-slots、ui-primitives 等）external，其余 `@deepseek-ai/*` 值导入即构建错误——跨插件协作走 cordis 服务/HTTP。

### D9 测试策略

- 单元：`connections.spec.ts`（session 隔离、密码剥离、sqlite 形态）、`clients.spec.ts`（各类型 argv/env 构造、无 shell 拼接、密码只走 env）、`tool.spec.ts`（mock `ctx.subprocess`：正常/超时/客户端不存在/未连接/输出截断）。
- 端到端（keyless）：`sqlite3` 建临时库 → `dsh run --profile demo`（或 headless 预设）以 data-agent 预设执行「列出所有表并统计行数」任务 → 断言工具面与结果。
- 手工（web）：安装 → 新建 data-agent 会话 → 数据库标签页连接 SQLite/MySQL → Chat 对话「写一条 SQL 查出近 30 天订单，保存到 orders.sql 并执行」→ 检查 read/write/edit/sqlcmd 轨迹；对照非 data-agent 会话无 sqlcmd。

## Risks / Trade-offs

- **审批策略为 never 时 sqlcmd 的 DDL/DML 直接执行** → README 明示风险；连接按 session 隔离；v1.1 提供 `readonly: true` 强制只放行 SELECT/SHOW/DESCRIBE（本变更不做，列为后续）。
- **密码进入子进程环境变量**（同用户进程可见）→ mysql/psql 官方支持的环境变量通道，业界标准做法；不落盘、不进 argv/日志，风险最低化。
- **客户端二进制缺失**（mysql/psql 非自带；sqlite3 macOS 自带）→ `resolveExecutable` 失败给出明确错误；`clients` 配置可覆盖命令名/路径；README 说明部署要求。
- **输出截断可能切断数据行** → 返回 `truncated` 标记 + 渲染追加提示，模型可缩小查询重试。
- **长查询/挂起客户端** → `queryTimeoutMs` 默认 30s + spawn signal 级联终止进程树（SIGTERM → grace → SIGKILL）。
- **gomoku 的 `dshClient` 拼写过时** → 本包用 `dsh.client`（D3），避免新包带旧拼写；如遇不兼容由构建/装载时报错暴露。
- **预设目录被用户删除/改名** → 自安装幂等（存在即跳过）；删除后下次进程启动重建；用户编辑过的预设不会被覆盖。
- **浏览器客户端依赖会话 summary 的 `agentPreset` 字段** → 该字段由 `ui-agent-preset` 提供（`noteAgentPreset`），缺省（undefined）时按「非 data-agent」渲染引导卡，不崩溃。

## Migration Plan

- **安装**：`dsh plugin --profile demo add .`（或 github:/tarball）→ 宿主插入 `data-agent` 行；插件 apply 时自安装预设到 `$DSH_HOME/.agent-presets/data-agent/`；浏览器半体经 `dsh.client` 自动装载。首次使用 `dsh plugin` 会初始化 profile。
- **验证**：`dsh --profile demo --dump-config` 应出现 data-agent 层；`ls $DSH_HOME/.agent-presets/data-agent/` 应有 agent.cordis.yml + preset.yml。
- **回滚**：`dsh plugin --profile demo remove @deepseek-ai/dsh-data-agent`（移除依赖与层）；手动删除 `$DSH_HOME/.agent-presets/data-agent/` 目录；重启进程后预设从 roster 消失。无持久化状态需清理（连接为内存态）。
- **升级**：重新 `add` 新版本包；预设文件已存在时保留用户编辑（如需升级预设内容，由用户删除目录后重启触发重建，或手工覆盖）。

## Open Questions

1. 是否纳入 `dsh-tool-str-replace-editor`？默认**不加**（需求只列 read/write/edit）；如用户需要可在预设文件里自行加行。
2. sqlite3 CLI 作为 SQLite 依赖是否可接受？macOS 自带；Windows 需部署方提供（README 注明）。MySQL/PostgreSQL 客户端二进制由部署方提供，`clients` 配置可覆盖命令名。
3. 连接是否需要在进程重启后保留？v1 内存 + 手动重连；如需持久化走 settings 命名空间并过 apiproxy allowlist，列为 v1.1。
4. 标签页文案「数据库」/「数据Agent」与 i18n key 命名空间 `data-agent` 是否 OK？（默认采用）
