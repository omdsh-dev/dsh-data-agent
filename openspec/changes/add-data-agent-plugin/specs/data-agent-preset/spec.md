## ADDED Requirements

### Requirement: data-agent 预设组合

`preset/data-agent/agent.cordis.yml` SHALL 是仅含三行的顶层插件列表：`persona`（`@deepseek-ai/dsh-persona`，数据工程师系统提示词，含 `{{cwd}}` 变量与 sqlcmd/read/write/edit 四工具工作流说明）、`tool-fs`（`@deepseek-ai/dsh-tool-fs`，提供 read/write/edit）、`tool-sqlcmd`（`@deepseek-ai/dsh-data-agent/tool`，提供 sqlcmd）。三行 SHALL 只消费宿主服务（tools、subprocess、dataAgentConnections），不提供任何服务，因此无需 `isolate` realm。`preset.yml` SHALL 声明 `name: 数据Agent`、`description` 与 `order`。

#### Scenario: 预设装载成功

- **WHEN** `dsh-agent-presets` 解析用户根下的 `data-agent` 预设并装载
- **THEN** 装载成功，agent 的工具注册表恰好包含 `sqlcmd`、`read`、`write`、`edit` 四个工具

#### Scenario: 预设元数据

- **WHEN** roster 列出预设
- **THEN** 显示名称「数据Agent」与描述，排序位置由 `order` 决定

### Requirement: 其他项目工具缺席即禁用

data-agent 预设 SHALL 不装载 `tool-bash`、`tool-fs-search`、`tool-str-replace-editor`、`tool-skill`、`tool-todo`、`tool-goal`、`tool-plan`、`tool-web`、`tool-subagent`、`tool-workflow`、`tool-pty`、`tool-tasks` 等任何其他工具行；模型可见工具面 SHALL 恰好是 sqlcmd/read/write/edit 四个工具，且 SHALL 通过组合语义（缺席）实现，不修改宿主组合。

#### Scenario: 工具面断言

- **WHEN** 检查 data-agent 预设会话的模型工具目录
- **THEN** 目录恰为 `[sqlcmd, read, write, edit]`，无 bash、grep、skill、todo、goal、web、subagent 等任何其他工具

#### Scenario: 宿主组合不变

- **WHEN** 对比启用插件前后的宿主组成
- **THEN** 沙箱、审批、持久化、模型路由等宿主行不变，仅新增插件自身行

### Requirement: 标准 agent loop 会话

data-agent 预设会话 SHALL 是普通 DSH 会话：走标准 `dsh-agent-loop`（turn/step、streaming、工具调度、session 日志、持久化），用户在 Chat 标签页以自然语言提出 SQL 需求，由 agent loop 驱动模型调用 sqlcmd/read/write/edit 完成「探查 schema → 写 SQL 文件 → 执行 → 看结果」闭环。预设 SHALL 在会话创建时固定，不可中途更换（`agent-preset-locked`）。

#### Scenario: 会话创建

- **WHEN** 用户在 Web GUI 新建会话并选择「数据Agent」预设
- **THEN** 会话以 data-agent 预设组合装载，Chat 标签页正常对话，模型可调用四个工具

#### Scenario: 预设锁定

- **WHEN** 会话已产生内容后尝试更换预设
- **THEN** 网关返回 `agent-preset-locked`，预设不变

### Requirement: 预设安装到用户预设根

包内 `preset/data-agent/` SHALL 由服务端半体安装到 `$DSH_HOME/.agent-presets/data-agent/`（用户根，trust=user），使 roster 能发现它；安装幂等且不覆盖已存在目录。

#### Scenario: 安装后可发现

- **WHEN** 插件已安装且进程启动（或 roster 重新读取）
- **THEN** `agentPresets.list()` 包含 id 为 `data-agent`、trust 为 `user` 的预设

#### Scenario: 用户编辑保留

- **WHEN** 用户已编辑 `$DSH_HOME/.agent-presets/data-agent/agent.cordis.yml` 后进程重启
- **THEN** 编辑内容原样保留，不被插件覆盖
