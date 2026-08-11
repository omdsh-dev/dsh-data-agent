## ADDED Requirements

### Requirement: sqlcmd 工具注册与参数

工具半体（`@deepseek-ai/dsh-data-agent/tool`）SHALL 经 `ctx.tools.register(defineTool(...))` 注册名为 `sqlcmd` 的工具，参数为 `{ sql: string }`（数据库客户端命令/SQL 文本，如 `SHOW TABLES`、`DESCRIBE users`、`SELECT * FROM orders LIMIT 5`）。工具 SHALL 在装载它的 data-agent 预设会话中可见，其他预设会话不可见。

#### Scenario: 工具注册

- **WHEN** data-agent 预设装载完成
- **THEN** 该 agent 的工具注册表包含名为 `sqlcmd` 的工具，其参数 schema 含必填字符串字段 `sql`

#### Scenario: 参数校验

- **WHEN** 模型调用 `sqlcmd` 且缺少 `sql` 字段或 `sql` 非字符串
- **THEN** 调用被参数校验拒绝，不执行任何客户端进程

### Requirement: 未连接时报错明确

工具执行时 SHALL 以 `exec.agent.id` 查连接存储；无连接 SHALL 返回明确错误「请先在数据库标签页连接」，不执行任何客户端进程。

#### Scenario: 未连接调用

- **WHEN** 会话未建立数据库连接时模型调用 `sqlcmd`
- **THEN** 工具返回错误，消息明确指出需要先在数据库标签页连接

### Requirement: 无 shell 层执行

工具 SHALL 经 `ctx.subprocess.resolveExecutable` 解析客户端二进制，`ctx.subprocess.spawn` 以参数数组执行（argv 只含客户端标志，SQL 经 stdin 传入），绝不经过 shell 解释，杜绝注入面。

#### Scenario: 执行 SQL

- **WHEN** 会话已连接 sqlite 且模型调用 `sqlcmd` 传入 `SELECT * FROM orders LIMIT 5`
- **THEN** spawn 的 argv 为 `[sqlite3, '-header', '-column', '<database-file>']`，SQL 文本经 stdin 写入，stdout/stderr 以收集模式读取

#### Scenario: 客户端不存在

- **WHEN** `resolveExecutable` 无法解析配置的客户端命令
- **THEN** 工具返回明确错误（含命令名与解析失败原因），不执行任何进程

### Requirement: 密码仅经环境变量传递

MySQL 密码 SHALL 经 `MYSQL_PWD` 环境变量、PostgreSQL 密码 SHALL 经 `PGPASSWORD` 环境变量传给客户端，绝不出现在 argv、日志或返回值中。

#### Scenario: 密码通道

- **WHEN** 会话已连接 mysql（含密码）且模型调用 `sqlcmd`
- **THEN** spawn 的 env 含 `MYSQL_PWD: <password>`，argv 与任何日志文本不含密码

### Requirement: 超时、取消与有界输出

工具 SHALL 以配置 `queryTimeoutMs`（默认 30000）施加超时，AbortController 的 signal 同时作为 spawn 的 signal（终止进程树）并响应 `exec.signal` 取消。输出 SHALL 以 `maxResultChars`（默认 20000）截断并返回 `truncated` 标记。返回结构 SHALL 为 `{ exitCode, stdout, stderr, truncated }`，渲染为等宽文本块（render intent `terminal`）。

#### Scenario: 输出截断

- **WHEN** 查询输出超过 `maxResultChars`
- **THEN** 返回的 `stdout` 被截断至上限且 `truncated` 为 true，渲染文本追加截断提示

#### Scenario: 查询超时

- **WHEN** 查询在 `queryTimeoutMs` 内未完成
- **THEN** 工具返回超时错误，且子进程树被终止

#### Scenario: 非零退出码

- **WHEN** 客户端进程以非零退出码结束
- **THEN** 工具返回 `{ exitCode, stdout, stderr, truncated }`，stderr 作为错误信息呈现给模型
