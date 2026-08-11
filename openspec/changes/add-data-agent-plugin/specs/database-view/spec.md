## ADDED Requirements

### Requirement: 数据库标签页注册

浏览器半体 SHALL 经 `ctx.slots.inject('conversation.view', ...)` 注册 `conversation.view` 槽位条目：id `data-agent`、order 15（位于 Trajectory=10 右侧、gomoku=20 左侧）、标签文案经 i18n 提供、组件为 DatabaseView。槽位作用域为会话（scope: session），组件 props 自带 `sessionId`。

#### Scenario: 标签页可见

- **WHEN** 浏览器装载客户端插件后打开会话视图
- **THEN** Trajectory 标签右侧出现「数据库」标签页，位于 order 10 与 order 20 条目之间

#### Scenario: 卸载即移除

- **WHEN** 客户端插件被卸载
- **THEN** 标签页从会话视图消失

### Requirement: 会话预设分流

DatabaseView SHALL 读取当前会话 summary 的 `agentPreset`：为 `data-agent` 时渲染连接表单 + 状态 + 表清单 + 「切到 Chat 标签页与数据 Agent 对话」引导文案；非 `data-agent`（含缺失）时渲染引导卡「请在新建会话时选择『数据Agent』预设」，且 SHALL 不发起任何连接请求。

#### Scenario: data-agent 会话

- **WHEN** 当前会话的 `agentPreset` 为 `data-agent`
- **THEN** 渲染连接表单（类型下拉 MySQL/PostgreSQL/SQLite、host、port、user、password、database）与连接/断开按钮

#### Scenario: 非 data-agent 会话

- **WHEN** 当前会话的 `agentPreset` 缺失或不是 `data-agent`
- **THEN** 渲染引导卡，且不产生任何网络请求

### Requirement: 连接流程与状态展示

DatabaseView 的连接表单 SHALL 支持：类型下拉（MySQL/PostgreSQL/SQLite，SQLite 模式隐藏 host/port/user 并展示文件路径输入）、host、port、user、password（密码输入框不回显）、database；「连接」按钮 SHALL `POST /plugins/data-agent/connect`（携带 sessionId），成功后展示服务端返回的表清单与连接状态；「断开」按钮 SHALL `POST /plugins/data-agent/disconnect`。连接状态 SHALL 驻留服务端内存，标签页切换不丢失。

#### Scenario: 成功连接

- **WHEN** 用户填写有效连接参数并点击连接
- **THEN** 界面显示已连接状态与表清单，密码输入框内容被清除且不回显

#### Scenario: 连接失败

- **WHEN** 服务端返回 `{ ok: false, error }`
- **THEN** 界面显示错误信息，不展示表清单

#### Scenario: 标签页切换不丢状态

- **WHEN** 连接成功后切换到其他标签页再切回「数据库」
- **THEN** 连接状态与表清单仍然显示（数据来自服务端内存存储）

### Requirement: i18n 文案

浏览器半体 SHALL 注册 `data-agent` locale namespace（zh/en），覆盖标签页标题、表单字段、按钮、状态与引导文案。

#### Scenario: 中英文切换

- **WHEN** 界面语言为中文/英文
- **THEN** 标签页与表单文案分别显示对应语言文本，无缺失 key
