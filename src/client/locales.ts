/** `data-agent` namespace dictionaries for the database tab. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'data-agent'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'tab.label': '数据库',
  'form.title': '数据库连接',
  'form.type': '数据库类型',
  'type.mysql': 'MySQL',
  'type.postgres': 'PostgreSQL',
  'type.sqlite': 'SQLite',
  'form.host': '主机',
  'form.port': '端口',
  'form.user': '用户名',
  'form.password': '密码',
  'form.database': '数据库名',
  'form.database.sqlite': '数据库文件路径',
  'form.database.sqlite.placeholder': '/path/to/orders.db',
  'action.connect': '连接',
  'action.disconnect': '断开',
  'state.connected': '已连接',
  'state.disconnected': '未连接',
  'state.checking': '正在检查连接…',
  'tables.title': '表清单',
  'tables.empty': '（空库，无表）',
  'error.title': '连接失败',
  'guide.title': '「数据库」页需要数据Agent 会话',
  'guide.text': '请在新建会话时选择「数据Agent」预设。连接数据库后，切到 Chat 标签页，用自然语言让数据 Agent 探查表结构、编写并执行 SQL。',
  'hint.chat': '已连接！切到 Chat 标签页，让数据 Agent 写 SQL（也可在本页断开连接）。',
  'field.required': '必填',
} satisfies Record<string, string>

/** The data-agent namespace key union. */
export type DataAgentKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'tab.label': 'Database',
  'form.title': 'Database connection',
  'form.type': 'Database type',
  'type.mysql': 'MySQL',
  'type.postgres': 'PostgreSQL',
  'type.sqlite': 'SQLite',
  'form.host': 'Host',
  'form.port': 'Port',
  'form.user': 'User',
  'form.password': 'Password',
  'form.database': 'Database',
  'form.database.sqlite': 'Database file path',
  'form.database.sqlite.placeholder': '/path/to/orders.db',
  'action.connect': 'Connect',
  'action.disconnect': 'Disconnect',
  'state.connected': 'Connected',
  'state.disconnected': 'Not connected',
  'state.checking': 'Checking connection…',
  'tables.title': 'Tables',
  'tables.empty': '(empty database, no tables)',
  'error.title': 'Connection failed',
  'guide.title': 'The Database tab needs a Data Agent session',
  'guide.text': 'Create a new session with the "Data Agent" preset. After connecting, switch to the Chat tab and ask the data agent to explore the schema, write and run SQL.',
  'hint.chat': 'Connected! Switch to the Chat tab and ask the data agent for SQL (or disconnect here).',
  'field.required': 'required',
} satisfies Record<DataAgentKey, string>
