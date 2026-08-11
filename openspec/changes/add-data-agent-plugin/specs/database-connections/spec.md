## ADDED Requirements

### Requirement: 连接存储按 session 隔离

`dataAgentConnections` 服务 SHALL 按会话 id（`Agent.id` / `SessionId`）存储数据库连接，并提供 `set(sessionId, connection)`、`get(sessionId)`、`clear(sessionId)`、`has(sessionId)`。连接结构 SHALL 为 `{ type: 'mysql'|'postgres'|'sqlite', host?, port?, user?, database, password? }`；SQLite 类型 SHALL 忽略 host/port/user 而以 `database` 为文件路径。`get` SHALL 返回剥离密码的副本，密码绝不写入 session 日志、settings、配置或磁盘。

#### Scenario: 保存并读取连接

- **WHEN** 对 session A 调用 `set('A', { type: 'mysql', host: 'h', port: 3306, user: 'u', database: 'd', password: 'p' })`
- **THEN** `get('A')` 返回 `{ type: 'mysql', host: 'h', port: 3306, user: 'u', database: 'd' }`，其中不含 `password` 字段

#### Scenario: 会话隔离

- **WHEN** session A 保存了连接而 session B 未保存
- **THEN** `has('B')` 为 false，`get('B')` 返回 undefined

#### Scenario: 清除连接

- **WHEN** 对已保存连接的 session A 调用 `clear('A')`
- **THEN** `has('A')` 为 false，后续 `get('A')` 返回 undefined

### Requirement: 连接路由与连通性验证

服务端半体 SHALL 在 `/plugins/data-agent` 前缀下注册 `POST /connect`、`POST /disconnect`、`GET /status` 路由。`/connect` SHALL 校验请求体（sessionId、type、必填字段），保存连接后立即运行该类型对应的「列出所有表」命令验证连通性；验证成功 SHALL 返回 `{ ok: true, tables }`（表清单受 `introspectMaxTables` 上限约束），失败 SHALL 返回 `{ ok: false, error }` 且不保存连接。`/status` SHALL 返回当前连接的脱敏概要（类型/host/port/database，密码掩码）。

#### Scenario: 成功连接

- **WHEN** `POST /plugins/data-agent/connect` 携带有效 body（如 sqlite 文件路径）
- **THEN** 返回 200 与 `{ ok: true, tables: [...] }`，且该 session 的连接已保存

#### Scenario: 连通性失败不保存

- **WHEN** `POST /connect` 的 host/port/凭证错误导致表清单命令失败
- **THEN** 返回 `{ ok: false, error }`，且 `has(sessionId)` 为 false

#### Scenario: 断开连接

- **WHEN** `POST /plugins/data-agent/disconnect` 携带已连接的 sessionId
- **THEN** 返回成功且该 session 的连接被清除

#### Scenario: 状态脱敏

- **WHEN** `GET /plugins/data-agent/status?sessionId=A` 且 A 已连接 mysql
- **THEN** 返回 `{ type: 'mysql', host, port, database }`，不含密码

### Requirement: CLI 客户端模板可配置

服务端半体 SHALL 提供 loader 配置 `clients`：按数据库类型映射 CLI 客户端 `{ command, argsTemplate }`，内置默认（mysql→`mysql`、postgres→`psql`、sqlite→`sqlite3`），部署可覆盖命令名与参数模板。命令构造 SHALL 是纯函数、参数数组化，SQL 绝不与 shell 拼接。

#### Scenario: 默认模板

- **WHEN** 未配置 `clients` 且连接类型为 mysql
- **THEN** 构造的 argv 以 `mysql` 开头并携带 host/port/user/database 标志，SQL 经 stdin 传入

#### Scenario: 覆盖命令名

- **WHEN** 部署配置 `clients.mysql.command` 为 `/usr/local/bin/mysql-client`
- **THEN** 构造的 argv 以该绝对路径开头

### Requirement: 配置预置连接（含通配符）

服务端半体 SHALL 提供 loader 配置 `connections`：按 sessionId 预置连接（结构同连接存储，但**不含 password 字段**——密码只允许经 /connect 路由进入内存）。键 `'*'` SHALL 预置通配符默认连接：任何没有自有连接的会话都 SHALL 回落到它（headless/keyless 运行与部署固定默认库的场景）；会话自有连接优先于通配符，`/disconnect` SHALL 只清除会话自有条目并恢复通配符回落。SQLite 路径 SHALL 在装载时解析为绝对路径。

#### Scenario: 通配符回落

- **WHEN** 配置 `connections: { '*': { type: 'sqlite', database: '/tmp/default.db' } }` 且会话 B 无自有连接
- **THEN** `get('B')` 返回该通配符连接

#### Scenario: 自有连接优先

- **WHEN** 会话 A 既命中通配符又被 /connect 保存了自有连接
- **THEN** `get('A')` 返回自有连接，断开后回落通配符

#### Scenario: 预置连接不含密码

- **WHEN** 部署在 `connections` 中填写密码字段
- **THEN** 该字段不被接受（schema 无此字段），预置连接不携带任何密码

### Requirement: 预设自安装

服务端半体启动时 SHALL 将包内 `preset/data-agent/`（`agent.cordis.yml` + `preset.yml`）复制到 `$DSH_HOME/.agent-presets/data-agent/`（`DSH_HOME` 按环境变量解析，未设置时按 DSH 约定取默认 Harness home）。目录已存在 SHALL 跳过（幂等，保留用户编辑）。配置 `installPreset`（默认 true）为 false 时 SHALL 跳过安装；`presetId` 可配置安装目录名。

#### Scenario: 首次启动安装

- **WHEN** 进程启动且 `$DSH_HOME/.agent-presets/data-agent/` 不存在
- **THEN** 创建该目录并写入 `agent.cordis.yml` 与 `preset.yml`

#### Scenario: 已存在则跳过

- **WHEN** 进程启动且该目录已存在（含用户编辑过的文件）
- **THEN** 不覆盖目录内任何文件

#### Scenario: 关闭自安装

- **WHEN** 配置 `installPreset: false`
- **THEN** 启动时不做任何复制操作
