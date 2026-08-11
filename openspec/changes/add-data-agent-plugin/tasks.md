## 1. P0 项目骨架（仿 dsh-gomoku）

- [x] 1.1 创建 `package.json`：name `@deepseek-ai/dsh-data-agent`、type module、exports 映射 `.` / `./tool` / `./client` / `./invariant` / `./cordis.patch.yml`、`dsh.bundle.patch`、`dsh.client`（platform web + inject 列表）、peer/dev 依赖（cordis、schemastery、dsh-client-*、dsh-host-webserver、dsh-invariants、dsh-llm、react、tsdown、lightningcss、vitest、typescript）
- [x] 1.2 创建 `cordis.patch.yml`：`- insert: [{ id: data-agent, name: '@deepseek-ai/dsh-data-agent' }]`
- [x] 1.3 创建 `tsconfig.json` / `tsconfig.build.json`（仿 gomoku）
- [x] 1.4 创建 `tsdown.config.ts`：三入口 node 库（index/tool）+ 浏览器 CJS closure-factory（`window.__ModuleLoader__.load`，平台模块 external，CSS Module 经 lightningcss 内联），含 bundle purity gate
- [x] 1.5 创建 `src/index.ts` / `src/tool.ts` / `src/client/index.ts` 空实现与 `src/css-modules.d.ts`，`pnpm build` 通过
- [x] 1.6 创建 `preset/data-agent/agent.cordis.yml`（3 行组合）与 `preset/data-agent/preset.yml`（name/description/order）

## 2. P1 服务端半体：连接存储与路由

- [x] 2.1 实现 `src/connections.ts`：`dataAgentConnections` 连接存储（set/get/clear/has，session 隔离，get 剥离密码）
- [x] 2.2 实现 `src/clients.ts`：CLI 客户端模板纯函数（mysql/psql/sqlite3 的 argv 构造、env 密码通道、表清单 SQL）
- [x] 2.3 实现 `src/index.ts` 主体：`Config`（schemastery schema：presetId/installPreset/clients/connectTimeoutMs/introspectMaxTables/queryTimeoutMs/maxResultChars）、`ctx.provide('dataAgentConnections', ...)`、`ctx.httpServer.register` 前缀路由 `/plugins/data-agent`（POST /connect 校验+连通性验证+表清单、POST /disconnect、GET /status 脱敏）
- [x] 2.4 实现预设自安装：apply 时复制 `preset/data-agent/` 到 `$DSH_HOME/.agent-presets/<presetId>/`（幂等、已存在跳过、installPreset=false 关闭）
- [x] 2.5 实现 `src/invariant.ts`：仿 gomoku 的 invariant 伴生（包名注册；连接存储不变式由单测断言）
- [x] 2.6 `pnpm build` + `dsh --profile demo --dump-config` 验证 data-agent 层出现

## 3. P2 工具半体：sqlcmd

- [x] 3.1 实现 `src/tool.ts`：`inject: ['tools', 'subprocess', 'dataAgentConnections']`，`ctx.tools.register(defineTool({ name: 'sqlcmd', parameters: { sql: { type: 'string', required: true } }, output: { schema: { type: 'object', ... }, render: terminal 等宽文本块 } }))`
- [x] 3.2 执行流程：`exec.agent.id` 查连接存储 → 未连接明确报错 → `resolveExecutable` 解析客户端 → `spawn`（argv 数组、SQL 经 stdin、env 传 MYSQL_PWD/PGPASSWORD、stdio collect、graceMs、合并 signal）
- [x] 3.3 超时与输出上限：`queryTimeoutMs` AbortController 级联终止进程树；`maxResultChars` 截断 + `truncated` 标记；返回 `{ exitCode, stdout, stderr, truncated }`
- [x] 3.4 `pnpm build` 通过；单元测试 mock subprocess 覆盖正常/超时/客户端不存在/未连接/截断（见 5.x）

## 4. P3 预设装配与验证

- [x] 4.1 确认 `preset/data-agent/agent.cordis.yml` 三行（persona 数据工程师提示词含 `{{cwd}}` 与 4 工具工作流；tool-fs；tool-sqlcmd）与 `preset.yml`（数据Agent，order 4）
- [x] 4.2 安装插件并启动 `dsh --profile demo`，确认 `$DSH_HOME/.agent-presets/data-agent/` 生成、roster 可见「数据Agent」
- [x] 4.3 验证工具面：新建 data-agent 会话，模型工具目录恰为 sqlcmd/read/write/edit（headless 断言或 /tools 检查）
- [x] 4.4 验证非 data-agent 会话（如 standard）无 sqlcmd 工具

## 5. P3 单元测试

- [x] 5.1 `tests/connections.spec.ts`：session 隔离、密码剥离、sqlite 形态、clear
- [x] 5.2 `tests/clients.spec.ts`：各类型 argv 顺序、密码只走 env、无 shell 拼接、表清单 SQL
- [x] 5.3 `tests/tool.spec.ts`：mock `ctx.subprocess` 的 resolveExecutable/spawn——正常执行、超时终止、客户端不存在、未连接报错、输出截断标记
- [x] 5.4 `vitest run` 全绿

## 6. P4 浏览器半体：数据库标签页

- [x] 6.1 实现 `src/client/index.ts`：`inject: ['locale', 'slots']`，注册 `conversation.view` 槽位（id `data-agent`、order 15、label 经 i18n）+ `data-agent` locale namespace（zh/en）
- [x] 6.2 实现 `src/client/DatabaseView.tsx` + `Database.module.css`：读会话 summary `agentPreset` 分流（data-agent → 连接表单+状态+表清单+引导；其他 → 引导卡不发请求）
- [x] 6.3 连接表单：类型下拉（SQLite 模式隐藏 host/port/user）、host/port/user/password（不回显）/database、连接/断开按钮、`POST /connect`/`/disconnect`（带 sessionId）、错误展示
- [x] 6.4 实现 `src/client/locales.ts`：zh/en 文案（标签、表单、状态、引导）
- [x] 6.5 `pnpm build` 通过；浏览器手工验证：Trajectory 右侧出现「数据库」标签、连接 SQLite 成功展示表清单、非 data-agent 会话显示引导卡、标签页切换状态不丢

## 7. P5 端到端验证（keyless）

- [x] 7.1 `sqlite3` 创建临时库（含 orders 表与近 30 天数据）→ `dsh run`（data-agent 预设）执行「列出所有表并统计行数」类任务 → 断言工具面与结果
- [x] 7.2 手工回归（web）：data-agent 会话中让 AI「写一条 SQL 查出近 30 天订单，保存到 orders.sql 并执行」，检查 read/write/edit/sqlcmd 轨迹与结果
- [x] 7.3 负面用例：未连接时 sqlcmd 报错明确；错误 host/port 连接报错友好；预设缺失时 roster 显示 broken 卡片

## 8. P6 文档与收尾

- [x] 8.1 编写 `README.md`（仿 gomoku）：功能、快速安装（`dsh plugin add`）、架构（三半体 + 预设）、配置表、安全说明（密码仅内存、无 shell 层、DDL/DML 风险、session 隔离）、卸载与回滚
- [x] 8.2 补充 LICENSE / .gitignore（node_modules、lib、dist）
- [x] 8.3 全量回归：`pnpm build` + `pnpm test` + 安装/卸载/重装冒烟
