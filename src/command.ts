/**
 * Agent-scoped `/database` human command. The preset mounts this entry below
 * the agent context, so the command registry scopes it to data-agent without
 * importing dsh-tui, React, or Ink.
 * @module @yejiming/dsh-data-agent/command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-questions'
import {
  redactSecretText,
  type ConnectionFormDraft,
  type ConnectionFormInitial,
  type ConnectionSummary,
  type DatabaseConnectionInput,
} from './connections.ts'
import { DATABASE_TYPES, defaultDatabasePort, isDatabaseType } from './database-types.ts'
import {
  isDshTuiTerminal,
  runTuiConnectionForm,
} from './tui-connection-form.ts'
import type {} from './index.ts'
import { registerCatalogCommand } from './catalog-command.ts'
import { createCatalogTuiAdapter } from './catalog-tui.ts'

export const name = 'data-agent-database-command'
export const inject = ['commands', 'dataAgentConnections', 'dataAgentCatalog', 'dataAgentCatalogScanner', 'tools']

export const DATABASE_COMMAND_USAGE = [
  '用法：',
  '  /database status',
  `  /database connect --type <${DATABASE_TYPES.join('|')}> --database <name|path> [--host <host>] [--port <port>] [--user <user>] [--password-ref <REF>] [--readonly] [--secure]`,
  '  /database test',
  '  /database disconnect',
  '安全提示：TUI 无参数 connect 可输入掩码临时密码；命令参数不接受 --password，请使用 --password-ref。',
].join('\n')

type DatabaseAction =
  | { kind: 'status' }
  | { kind: 'connect'; input?: DatabaseConnectionInput }
  | { kind: 'test' }
  | { kind: 'disconnect' }

export const DATA_AGENT_TOOL_NAMES = [
  'str_replace_editor', 'sql-query', 'sql-write', 'sql-cmd',
  'catalog-search', 'catalog-get', 'metric-get',
] as const
const DATA_AGENT_OWN_TOOL_NAMES = new Set<string>([
  ...DATA_AGENT_TOOL_NAMES,
  'render-analysis',
  RUN_CODE_NAME,
])

export interface DatabaseCommandInteraction {
  isTuiFormAvailable(): boolean
  collectTuiConnection(
    signal: AbortSignal,
    options: {
      initialDraft?: ConnectionFormInitial
      persistDraft(draft: ConnectionFormDraft): Promise<void>
    },
  ): Promise<DatabaseConnectionInput | undefined>
}

const defaultInteraction: DatabaseCommandInteraction = {
  isTuiFormAvailable: () => isDshTuiTerminal(),
  collectTuiConnection: (signal, options) => runTuiConnectionForm({
    signal,
    ...options.initialDraft !== undefined ? { initialDraft: options.initialDraft } : {},
    persistDraft: options.persistDraft,
  }),
}

export interface DataAgentCommandAdapterOptions {
  /** Override only for focused runtime-boundary tests. */
  isDshTuiPluginLoaded?: (ctx: Context) => boolean
}

/** Official Cordis runtime name exported by `@deepseek-harness-tui/dsh-tui`. */
export const DSH_TUI_PLUGIN_RUNTIME_NAME = 'dsh-tui'

/**
 * Detect actual plugin usage from Cordis' live registry. Package installation,
 * argv and profile labels are deliberately irrelevant.
 */
export function isDshTuiPluginLoaded(ctx: Context): boolean {
  for (const runtime of ctx.registry.values()) {
    if (runtime.name !== DSH_TUI_PLUGIN_RUNTIME_NAME) continue
    for (const fiber of runtime.fibers) {
      if (fiber.uid !== null) return true
    }
  }
  return false
}

/** Mount both human commands and return one symmetric disposer. */
function registerDshTuiCommands(ctx: Context): () => void {
  const catalogTui = createCatalogTuiAdapter(ctx)
  const disposeDatabase = ctx.commands.register({
    name: 'database',
    description: '查看、连接、测试或断开 data-agent 数据库连接',
    input: { hint: 'status | connect | test | disconnect' },
    recordInput: false,
    handler: async (invocation) => executeDatabaseCommand(ctx, invocation),
  })
  const disposeCatalog = registerCatalogCommand(ctx, catalogTui)

  // dsh-tui rebuilds its command list when `commands/change` fires. During a
  // blank-session preset switch the registry's first notification happens
  // while the standing preset is still being mounted, before the agent scope
  // is parented to that standing scope. Notify once more on the next task so
  // the just-joined agent can discover this scoped command immediately.
  const refreshTimer = setTimeout(() => ctx.emit('commands/change'), 0)
  return () => {
    clearTimeout(refreshTimer)
    disposeCatalog()
    catalogTui.dispose()
    disposeDatabase()
  }
}

/** Keep the tool boundary everywhere; follow the actual dsh-tui runtime lifecycle for commands. */
export function apply(ctx: Context, options: DataAgentCommandAdapterOptions = {}): void {
  // This entry is the final row mounted in the data-agent standing preset
  // scope. Deny every currently visible host tool except this preset's own
  // registrations. An allowlist cannot be used here: when an existing agent is
  // rebound below this scope, an ancestor allowlist also filters the preset's
  // local tools. Keeping the restriction in the standing scope handles blank-
  // session preset switches without depending on a one-shot agent/created
  // event.
  const inheritedToolNames = ctx.tools.schemas()
    .map(schema => schema.name)
    .filter(toolName => !DATA_AGENT_OWN_TOOL_NAMES.has(toolName))
  ctx.tools.restrict({ deny: inheritedToolNames })

  const detect = options.isDshTuiPluginLoaded ?? isDshTuiPluginLoaded
  let disposeCommands: (() => void) | undefined
  const reconcile = () => {
    const shouldRegister = detect(ctx)
    if (shouldRegister && disposeCommands === undefined) {
      disposeCommands = registerDshTuiCommands(ctx)
    } else if (!shouldRegister && disposeCommands !== undefined) {
      disposeCommands()
      disposeCommands = undefined
    }
  }

  reconcile()
  if (options.isDshTuiPluginLoaded === undefined) {
    // `internal/plugin` fires for both creation and disposal. Global delivery
    // makes this independent of whether dsh-tui loads before or after the
    // data-agent standing scope.
    ctx.on('internal/plugin', reconcile, { global: true })
  }
  ctx.effect(() => () => {
    disposeCommands?.()
    disposeCommands = undefined
  }, 'data-agent: dsh-tui human command adapters')
}

/** Public for focused command tests and alternate command adapters. */
export async function executeDatabaseCommand(
  ctx: Context,
  invocation: CommandInvocation,
  interaction: DatabaseCommandInteraction = defaultInteraction,
): Promise<CommandResult> {
  let transientPassword: string | undefined
  try {
    const action = parseDatabaseAction(invocation.rawInput)
    const sessionId = String(invocation.agent.id)
    switch (action.kind) {
      case 'status': {
        const summary = await ctx.dataAgentConnections.status(sessionId)
        const tools = ctx.tools.schemas(invocation.agent).map(schema => schema.name).sort()
        return { kind: 'success', text: `${formatConnectionStatus(summary)}\n模型工具：${tools.join(', ') || '（无）'}\n\n${DATABASE_COMMAND_USAGE}` }
      }
      case 'connect': {
        const input = action.input ?? await askForConnection(ctx, invocation, interaction)
        if (input === undefined) return { kind: 'error', text: `当前界面没有可用的问答 provider。\n\n${DATABASE_COMMAND_USAGE}` }
        transientPassword = input.password
        const result = await ctx.dataAgentConnections.connect(sessionId, input, invocation.signal)
        return { kind: 'success', text: `数据库连接成功。\n${formatConnectionStatus(result.summary)}` }
      }
      case 'test': {
        const result = await ctx.dataAgentConnections.test(sessionId, invocation.signal)
        return { kind: 'success', text: `数据库连接测试成功，发现 ${result.tables.length} 张表。\n${formatConnectionStatus(result.summary)}` }
      }
      case 'disconnect':
        await ctx.dataAgentConnections.disconnect(sessionId)
        return { kind: 'success', text: '当前会话已断开数据库连接；可复用的非敏感 connection profile 已保留。' }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'error', text: redactSecretText(message, [transientPassword]) }
  } finally {
    transientPassword = undefined
  }
}

/** Parse one command's raw input without ever accepting a plaintext password. */
export function parseDatabaseAction(rawInput: string): DatabaseAction {
  const tokens = splitCommandLine(rawInput.trim())
  if (tokens.length === 0 || tokens[0] === 'status') {
    if (tokens.length > 1) throw new Error(`status 不接受额外参数。\n\n${DATABASE_COMMAND_USAGE}`)
    return { kind: 'status' }
  }
  const subcommand = tokens[0]
  if (subcommand === 'test' || subcommand === 'disconnect') {
    if (tokens.length > 1) throw new Error(`${subcommand} 不接受额外参数。\n\n${DATABASE_COMMAND_USAGE}`)
    return { kind: subcommand }
  }
  if (subcommand !== 'connect') {
    throw new Error(`未知 database 子命令：${subcommand}\n\n${DATABASE_COMMAND_USAGE}`)
  }
  if (tokens.length === 1) return { kind: 'connect' }
  return { kind: 'connect', input: parseConnectArguments(tokens.slice(1)) }
}

/** Non-interactive `connect` argument grammar. */
export function parseConnectArguments(tokens: readonly string[]): DatabaseConnectionInput {
  const values = new Map<string, string>()
  let readonly: boolean | undefined
  let secure: boolean | undefined
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (token === '--password' || token.startsWith('--password=') || token.startsWith('password=')) {
      throw new Error('安全限制：/database 不接受明文密码参数；请改用 --password-ref <REF>。')
    }
    if (token === '--readonly') {
      readonly = true
      continue
    }
    if (token === '--readwrite') {
      readonly = false
      continue
    }
    if (token === '--secure') {
      secure = true
      continue
    }
    if (token === '--insecure') {
      secure = false
      continue
    }
    const assignment = token.startsWith('--') ? token.slice(2).split('=', 2) : token.split('=', 2)
    let key: string
    let value: string
    if (assignment.length === 2) {
      key = normalizeArgumentName(assignment[0]!)
      value = assignment[1]!
    } else {
      if (!token.startsWith('--')) throw new Error(`无法解析参数：${token}\n\n${DATABASE_COMMAND_USAGE}`)
      key = normalizeArgumentName(token.slice(2))
      const next = tokens[index + 1]
      if (next === undefined || next.startsWith('--')) throw new Error(`参数 --${key} 缺少值`)
      value = next
      index += 1
    }
    if (key === 'password') {
      throw new Error('安全限制：/database 不接受明文密码参数；请改用 --password-ref <REF>。')
    }
    if (!CONNECT_ARGUMENTS.has(key)) throw new Error(`未知连接参数：--${key}\n\n${DATABASE_COMMAND_USAGE}`)
    values.set(key, value)
  }

  const type = values.get('type')
  if (!isDatabaseType(type)) throw new Error('connect 必须提供有效的 --type')
  const database = values.get('database')
  if (database === undefined || database.length === 0) throw new Error('connect 必须提供 --database')
  const input: DatabaseConnectionInput = { type, database }
  copyNonEmpty(values, 'host', value => { input.host = value })
  copyNonEmpty(values, 'user', value => { input.user = value })
  copyNonEmpty(values, 'passwordRef', value => { input.passwordRef = value })
  copyNonEmpty(values, 'profileId', value => { input.profileId = value })
  copyNonEmpty(values, 'name', value => { input.name = value })
  const port = values.get('port')
  if (port !== undefined) {
    const number = Number(port)
    if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error('--port 必须是 1-65535 的整数')
    input.port = number
  }
  if (readonly !== undefined) input.readonly = readonly
  if (type === 'clickhouse' && secure !== undefined) input.secure = secure
  return input
}

/** Render a public summary; no password-bearing field exists in the type. */
export function formatConnectionStatus(summary: ConnectionSummary | undefined): string {
  if (summary === undefined) return '数据库状态：未连接。'
  const endpoint = summary.type === 'sqlite'
    ? summary.database
    : `${summary.host ?? 'localhost'}${summary.port !== undefined ? `:${summary.port}` : ''}`
  const lines = [
    summary.reconnectRequired === true ? '数据库状态：需要重新认证' : '数据库状态：已连接',
    `类型：${summary.type}`,
    `地址：${endpoint}`,
    `数据库：${summary.database}`,
    `只读：${summary.readonly === true ? '是' : '否'}`,
  ]
  if (summary.type === 'clickhouse') lines.push(`HTTPS：${summary.secure === true ? '是' : '否'}`)
  if (summary.user !== undefined) lines.push(`用户：${summary.user}`)
  if (summary.profileId !== undefined) lines.push(`Profile：${summary.name ?? summary.profileId}`)
  if (summary.passwordRef !== undefined) lines.push(`凭据引用：${summary.passwordRef}`)
  if (summary.credential !== undefined) {
    lines.push(`凭据：${summary.credential.configured ? `已配置${summary.credential.source !== undefined ? `（${summary.credential.source}）` : ''}` : '未配置'}`)
  }
  if (summary.tables !== undefined) lines.push(`表：${summary.tables.length} 张`)
  return lines.join('\n')
}

async function askForConnection(
  ctx: Context,
  invocation: CommandInvocation,
  interaction: DatabaseCommandInteraction,
): Promise<DatabaseConnectionInput | undefined> {
  if (interaction.isTuiFormAvailable()) {
    const sessionId = String(invocation.agent.id)
    const initialDraft = ctx.dataAgentConnections.getFormDraft?.(sessionId)
    const input = await interaction.collectTuiConnection(invocation.signal, {
      ...initialDraft !== undefined ? { initialDraft } : {},
      persistDraft: async draft => {
        await ctx.dataAgentConnections.saveFormDraft?.(sessionId, draft)
      },
    })
    if (input === undefined) throw new Error('已取消数据库连接。')
    return input
  }
  const questions = ctx.get('userQuestions')
  if (questions === undefined) return undefined
  try {
    const typeAnswer = await questions.ask({
      agent: invocation.agent,
      signal: invocation.signal,
      questions: [{
        id: 'type',
        header: '数据库类型',
        question: '选择要连接的数据库类型',
        options: DATABASE_TYPES.map(label => ({ label })),
      }],
    })
    const typeValue = answerValue(typeAnswer, 'type')
    if (!isDatabaseType(typeValue)) throw new Error('未选择有效的数据库类型')

    const detailQuestions = typeValue === 'sqlite'
      ? [
          { id: 'database', header: '文件路径', question: 'SQLite 数据库文件路径' },
          { id: 'readonly', header: '只读', question: '是否启用只读模式？', options: [{ label: '是' }, { label: '否' }] },
        ]
      : [
          { id: 'host', header: '主机', question: '数据库主机（留空使用 127.0.0.1）' },
          {
            id: 'port',
            header: '端口',
            question: typeValue === 'clickhouse'
              ? `数据库端口（留空使用HTTP ${defaultDatabasePort('clickhouse')}；HTTPS ${defaultDatabasePort('clickhouse', true)}）`
              : `数据库端口（留空使用 ${defaultDatabasePort(typeValue)}）`,
          },
          { id: 'user', header: '用户', question: '数据库用户名' },
          { id: 'database', header: '数据库', question: '数据库名 / Oracle 服务名' },
          { id: 'passwordRef', header: '凭据引用', question: 'DSH credential reference（可留空）' },
          ...(typeValue === 'clickhouse'
            ? [{ id: 'secure', header: 'HTTPS', question: '是否使用HTTPS并验证服务器证书？', options: [{ label: '是' }, { label: '否' }] }]
            : []),
          { id: 'readonly', header: '只读', question: '是否启用只读模式？', options: [{ label: '是' }, { label: '否' }] },
        ]
    const details = await questions.ask({ agent: invocation.agent, signal: invocation.signal, questions: detailQuestions })
    const database = answerValue(details, 'database')?.trim()
    if (database === undefined || database.length === 0) throw new Error('database 不能为空')
    const input: DatabaseConnectionInput = {
      type: typeValue,
      database,
      readonly: answerValue(details, 'readonly') === '是',
    }
    if (typeValue !== 'sqlite') {
      input.host = answerValue(details, 'host')?.trim() || '127.0.0.1'
      if (typeValue === 'clickhouse') input.secure = answerValue(details, 'secure') === '是'
      const portText = answerValue(details, 'port')?.trim()
      input.port = portText === undefined || portText === ''
        ? defaultDatabasePort(typeValue, input.secure === true)
        : Number(portText)
      const user = answerValue(details, 'user')?.trim()
      if (user !== undefined && user !== '') input.user = user
      const passwordRef = answerValue(details, 'passwordRef')?.trim()
      if (passwordRef !== undefined && passwordRef !== '') input.passwordRef = passwordRef
    }
    return input
  } catch (error) {
    if ((error as { code?: string }).code === 'NO_PROVIDER') return undefined
    throw error
  }
}

const CONNECT_ARGUMENTS = new Set(['type', 'host', 'port', 'user', 'database', 'passwordRef', 'profileId', 'name'])

function normalizeArgumentName(value: string): string {
  return value.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
}

function copyNonEmpty(values: Map<string, string>, key: string, apply: (value: string) => void): void {
  const value = values.get(key)
  if (value !== undefined && value.length > 0) apply(value)
}

function answerValue(
  answer: { answers: { id: string; selected: string[]; custom?: string }[] },
  id: string,
): string | undefined {
  const item = answer.answers.find(candidate => candidate.id === id)
  return item?.custom ?? item?.selected[0]
}

/** Minimal shell-like splitter for quoted command arguments; no expansion. */
function splitCommandLine(value: string): string[] {
  const tokens: string[] = []
  let token = ''
  let quote: '"' | "'" | undefined
  let escaping = false
  for (const character of value) {
    if (escaping) {
      token += character
      escaping = false
      continue
    }
    if (character === '\\' && quote !== "'") {
      escaping = true
      continue
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      else token += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (/\s/.test(character)) {
      if (token.length > 0) {
        tokens.push(token)
        token = ''
      }
      continue
    }
    token += character
  }
  if (escaping) token += '\\'
  if (quote !== undefined) throw new Error('命令参数包含未闭合的引号')
  if (token.length > 0) tokens.push(token)
  return tokens
}
