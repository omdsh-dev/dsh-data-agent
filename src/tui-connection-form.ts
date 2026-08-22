/**
 * Short-lived ANSI connection form used by `/database connect` in dsh-tui.
 *
 * dsh-tui 0.6.x exposes commands but no public custom-form/sensitive-input
 * slot. This adapter therefore owns a small terminal form and only activates
 * after the command adapter has detected an active `dsh-tui` runtime. It
 * snapshots the host's `readable` listeners, consumes input for the lifetime
 * of the form, then restores the listeners exactly. It never imports dsh-tui,
 * React, or Ink.
 * @module @yejiming/dsh-data-agent/tui-connection-form
 */

import {
  validatePasswordRef,
  type ConnectionFormDraft,
  type ConnectionFormInitial,
  type DatabaseConnectionInput,
} from './connections.ts'
import {
  DATABASE_TYPES,
  databaseTypeLabel as sharedDatabaseTypeLabel,
  defaultDatabasePort as sharedDefaultDatabasePort,
  type DatabaseType,
} from './database-types.ts'

export const TUI_DATABASE_TYPES = DATABASE_TYPES

export type TuiConnectionField =
  | 'type'
  | 'host'
  | 'port'
  | 'user'
  | 'database'
  | 'password'
  | 'passwordRef'
  | 'secure'
  | 'readonly'
  | 'confirm'
  | 'cancel'

export interface TuiConnectionFormState {
  type: DatabaseType
  host: string
  port: string
  user: string
  database: string
  password: string
  passwordRef: string
  secure: boolean
  readonly: boolean
  focus: TuiConnectionField
  cursor: number
  selector?: {
    field: 'type' | 'readonly' | 'secure'
    index: number
  }
  error?: string
}

export type TuiFormKey =
  | { name: 'text'; text: string }
  | { name: 'tab' | 'backtab' | 'enter' | 'escape' | 'backspace' | 'delete' }
  | { name: 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'space' }

export type TuiFormTransition =
  | { kind: 'editing'; state: TuiConnectionFormState }
  | { kind: 'submitted'; state: TuiConnectionFormState; input: DatabaseConnectionInput }
  | { kind: 'cancelled'; state: TuiConnectionFormState }

type StreamListener = (...args: unknown[]) => void

export interface TuiFormInput {
  isTTY?: boolean
  isRaw?: boolean
  read(): unknown
  listeners(event: string): Function[]
  on(event: string, listener: StreamListener): unknown
  emit?(event: string): unknown
  push?(value: string): unknown
  removeListener(event: string, listener: StreamListener): unknown
  setRawMode?(mode: boolean): unknown
  ref?(): unknown
}

export interface TuiFormOutput {
  isTTY?: boolean
  columns?: number
  write(value: string): unknown
  on?(event: string, listener: StreamListener): unknown
  removeListener?(event: string, listener: StreamListener): unknown
  emit?(event: string): unknown
}

export interface RunTuiConnectionFormOptions {
  input?: TuiFormInput
  output?: TuiFormOutput
  signal?: AbortSignal
  initialDraft?: ConnectionFormInitial
  persistDraft?: (draft: ConnectionFormDraft) => void | Promise<void>
}

/** Initial form intentionally leaves host/port empty so placeholders are real defaults. */
export function createTuiConnectionFormState(initialDraft?: ConnectionFormInitial): TuiConnectionFormState {
  return {
    type: initialDraft?.type ?? 'mysql',
    host: initialDraft?.host ?? '',
    port: initialDraft?.port ?? '',
    user: initialDraft?.user ?? '',
    database: initialDraft?.database ?? '',
    password: '',
    passwordRef: initialDraft?.passwordRef ?? '',
    secure: initialDraft?.secure ?? false,
    readonly: initialDraft?.readonly ?? false,
    focus: 'type',
    cursor: 0,
  }
}

/** Project form state onto the only values allowed to cross the durable seam. */
export function connectionFormDraft(state: TuiConnectionFormState): ConnectionFormDraft {
  return {
    type: state.type,
    host: state.host,
    port: state.port,
    user: state.user,
    database: state.database,
    readonly: state.readonly,
    ...state.type === 'clickhouse' ? { secure: state.secure } : {},
  }
}

/** Relevant focus order for the selected database kind. */
export function tuiConnectionFields(type: DatabaseType): readonly TuiConnectionField[] {
  if (type === 'sqlite') return ['type', 'database', 'readonly', 'confirm', 'cancel']
  const fields: TuiConnectionField[] = ['type', 'host', 'port', 'user', 'database', 'password', 'passwordRef']
  if (type === 'clickhouse') fields.push('secure')
  return [...fields, 'readonly', 'confirm', 'cancel']
}

/** Default network port shown as a placeholder and applied only at submit time. */
export function defaultDatabasePort(type: Exclude<DatabaseType, 'sqlite'>, secure = false): number {
  return sharedDefaultDatabasePort(type, secure)
}

/**
 * Check only terminal capability. The command adapter already proves that the
 * actual dsh-tui plugin is loaded before it exposes `/database`; repeating a
 * profile-name or argv heuristic here would reject custom profiles that use
 * dsh-tui and admit profiles that merely happen to be named `dsh-tui`.
 */
export function isDshTuiTerminal(
  input: Pick<TuiFormInput, 'isTTY'> = process.stdin,
  output: Pick<TuiFormOutput, 'isTTY'> = process.stdout,
): boolean {
  return input.isTTY === true && output.isTTY === true
}

/** Pure keyboard reducer, kept separate from terminal ownership for regression tests. */
export function updateTuiConnectionForm(
  current: TuiConnectionFormState,
  key: TuiFormKey,
): TuiFormTransition {
  let state: TuiConnectionFormState = { ...current, error: undefined }

  if (state.selector !== undefined) return updateOpenSelector(state, key)
  if (key.name === 'escape') return { kind: 'cancelled', state: clearPassword(state) }
  if (key.name === 'tab' || key.name === 'backtab') {
    state = moveFocus(state, key.name === 'tab' ? 1 : -1)
    return { kind: 'editing', state }
  }

  if (state.focus === 'confirm') {
    if (key.name !== 'enter') return { kind: 'editing', state }
    const validated = validateTuiConnectionForm(state)
    return validated.error !== undefined
      ? { kind: 'editing', state: { ...state, error: validated.error } }
      : { kind: 'submitted', state: clearPassword(state), input: validated.input! }
  }
  if (state.focus === 'cancel') {
    return key.name === 'enter'
      ? { kind: 'cancelled', state: clearPassword(state) }
      : { kind: 'editing', state }
  }

  if (state.focus === 'type') {
    if (key.name === 'enter' || key.name === 'space') {
      state = { ...state, selector: { field: 'type', index: TUI_DATABASE_TYPES.indexOf(state.type) } }
    }
    return { kind: 'editing', state }
  }
  if (state.focus === 'readonly' || state.focus === 'secure') {
    if (key.name === 'enter' || key.name === 'space') {
      state = { ...state, selector: { field: state.focus, index: state[state.focus] ? 1 : 0 } }
    }
    return { kind: 'editing', state }
  }

  if (key.name === 'enter' || key.name === 'up' || key.name === 'down') {
    return { kind: 'editing', state }
  }
  return { kind: 'editing', state: editTextField(state, key) }
}

/** Rendered value is masked before it reaches the ANSI string. */
export function renderTuiConnectionForm(state: TuiConnectionFormState, columns = 80): string {
  const width = Math.max(20, Math.min(72, columns - 8))
  const lines = [
    '\u001B[2J\u001B[H\u001B[?25l',
    `${bold('Data Agent · 数据库连接')}`,
    dim('Tab/Shift+Tab 切换 · Enter 展开/确认选项 · ↑/↓ 选择 · Esc 返回'),
    '',
  ]
  for (const field of tuiConnectionFields(state.type)) {
    lines.push(...renderField(state, field, width))
  }
  if (state.error !== undefined) lines.push('', red(`! ${state.error}`))
  lines.push('', dim(state.type === 'sqlite'
    ? 'SQLite 连接不收集数据库凭据。'
    : '临时密码不持久化；凭据引用可随非敏感连接 profile 恢复。'))
  return lines.join('\n')
}

/**
 * Own the terminal only for the form lifetime. `undefined` means user cancel.
 * The returned password has never crossed stdout, argv, env, or a DSH event.
 */
export function runTuiConnectionForm(options: RunTuiConnectionFormOptions = {}): Promise<DatabaseConnectionInput | undefined> {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  if (input.isTTY !== true || output.isTTY !== true) {
    return Promise.reject(new Error('数据库连接表单需要交互式 TTY'))
  }

  const originalListeners = input.listeners('readable') as StreamListener[]
  const wasRaw = input.isRaw === true
  let state = createTuiConnectionFormState(options.initialDraft)
  let settled = false

  return new Promise((resolve, reject) => {
    const redraw = () => output.write(renderTuiConnectionForm(state, output.columns ?? 80))
    const cleanup = () => {
      input.removeListener('readable', onReadable)
      output.removeListener?.('resize', redraw)
      options.signal?.removeEventListener('abort', onAbort)
      if (!wasRaw) input.setRawMode?.(false)
      output.write('\u001B[0m\u001B[?25h\u001B[2J\u001B[H')
      for (const listener of originalListeners) input.on('readable', listener)
      requestHostFullRedraw(input, output)
    }
    const finish = async (value: DatabaseConnectionInput | undefined, error?: unknown) => {
      if (settled) return
      settled = true
      const draft = connectionFormDraft(state)
      state = clearPassword(state)
      cleanup()
      try {
        await options.persistDraft?.(draft)
        if (error !== undefined) reject(error)
        else resolve(value)
      } catch (persistError) {
        reject(persistError)
      }
    }
    const onAbort = () => {
      void finish(undefined, options.signal?.reason instanceof Error ? options.signal.reason : new Error('数据库连接已取消'))
    }
    const onReadable = () => {
      if (settled) return
      try {
        let chunk: unknown
        while ((chunk = input.read()) !== null) {
          const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk as ArrayBuffer).toString('utf8')
          for (const key of decodeTuiFormInput(text)) {
            const transition = updateTuiConnectionForm(state, key)
            state = transition.state
            if (transition.kind === 'submitted') {
              void finish(transition.input)
              return
            }
            if (transition.kind === 'cancelled') {
              void finish(undefined)
              return
            }
          }
        }
        redraw()
      } catch (error) {
        void finish(undefined, error)
      }
    }

    try {
      for (const listener of originalListeners) input.removeListener('readable', listener)
      input.setRawMode?.(true)
      input.ref?.()
      input.on('readable', onReadable)
      output.on?.('resize', redraw)
      options.signal?.addEventListener('abort', onAbort, { once: true })
      if (options.signal?.aborted === true) onAbort()
      else redraw()
    } catch (error) {
      settled = true
      state = clearPassword(state)
      cleanup()
      reject(error)
    }
  })
}

/**
 * Ask dsh-tui to invalidate Ink's cached frame after our direct ANSI drawing.
 *
 * A same-size `resize` event does not invalidate Ink's physical-frame cache,
 * so unchanged rows such as the prompt remain blank after the form clears the
 * screen. Ctrl+L is dsh-tui's documented redraw shortcut and reaches the host
 * only after its original readable listener has been restored.
 */
function requestHostFullRedraw(input: TuiFormInput, output: TuiFormOutput): void {
  try {
    if (input.push !== undefined) {
      input.push('\u000C')
      input.emit?.('readable')
      return
    }
  } catch {
    // Fall through to the weaker adapter-neutral resize signal.
  }
  output.emit?.('resize')
}

/** Decode the keyboard subset owned by the form; unknown terminal reports are ignored. */
export function decodeTuiFormInput(value: string): TuiFormKey[] {
  const keys: TuiFormKey[] = []
  let index = 0
  while (index < value.length) {
    const rest = value.slice(index)
    const known = KNOWN_SEQUENCES.find(([sequence]) => rest.startsWith(sequence))
    if (known !== undefined) {
      keys.push({ name: known[1] })
      index += known[0].length
      continue
    }
    const character = value[index]!
    if (character === '\u0003' || character === '\u001B') {
      if (character === '\u001B' && value[index + 1] === '[') {
        // Ignore an unsupported CSI report/mouse event as one terminal token.
        index += 2
        while (index < value.length && !/[\x40-\x7E]/.test(value[index]!)) index += 1
        index += 1
      } else {
        keys.push({ name: 'escape' })
        index += 1
      }
      continue
    }
    if (character === '\t') keys.push({ name: 'tab' })
    else if (character === '\r' || character === '\n') keys.push({ name: 'enter' })
    else if (character === '\u007F' || character === '\b') keys.push({ name: 'backspace' })
    else if (character === ' ') keys.push({ name: 'space' })
    else if (character >= ' ') keys.push({ name: 'text', text: character })
    index += 1
  }
  return keys
}

const KNOWN_SEQUENCES: readonly [string, Exclude<TuiFormKey['name'], 'text'>][] = [
  ['\u001B[Z', 'backtab'],
  ['\u001B[A', 'up'],
  ['\u001B[B', 'down'],
  ['\u001B[C', 'right'],
  ['\u001B[D', 'left'],
  ['\u001B[H', 'home'],
  ['\u001B[F', 'end'],
  ['\u001B[1~', 'home'],
  ['\u001B[4~', 'end'],
  ['\u001B[3~', 'delete'],
]

function validateTuiConnectionForm(state: TuiConnectionFormState): { input?: DatabaseConnectionInput; error?: string } {
  const database = state.database.trim()
  if (database === '') return { error: state.type === 'sqlite' ? 'SQLite 数据库文件路径不能为空' : '数据库名不能为空' }
  if (state.type === 'sqlite') return { input: { type: 'sqlite', database, readonly: state.readonly } }

  const portText = state.port.trim()
  const port = portText === '' ? defaultDatabasePort(state.type, state.secure) : Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: '端口必须是 1–65535 的整数，或留空使用默认值' }
  const input: DatabaseConnectionInput = {
    type: state.type,
    host: state.host.trim() || '127.0.0.1',
    port,
    database,
    readonly: state.readonly,
  }
  if (state.type === 'clickhouse') input.secure = state.secure
  const user = state.user.trim()
  if (user !== '') input.user = user
  const passwordRef = state.passwordRef.trim()
  if (state.password !== '' && passwordRef !== '') return { error: '临时密码与凭据引用不能同时填写' }
  if (passwordRef !== '') {
    try {
      validatePasswordRef(passwordRef)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
    input.passwordRef = passwordRef
  } else if (state.password !== '') {
    input.password = state.password
  }
  return { input }
}

function editTextField(state: TuiConnectionFormState, key: TuiFormKey): TuiConnectionFormState {
  if (!isTextField(state.focus)) return state
  const value = state[state.focus]
  if (key.name === 'text') return replaceField(state, value.slice(0, state.cursor) + key.text + value.slice(state.cursor), state.cursor + key.text.length)
  if (key.name === 'space') return replaceField(state, value.slice(0, state.cursor) + ' ' + value.slice(state.cursor), state.cursor + 1)
  if (key.name === 'backspace' && state.cursor > 0) {
    return replaceField(state, value.slice(0, state.cursor - 1) + value.slice(state.cursor), state.cursor - 1)
  }
  if (key.name === 'delete' && state.cursor < value.length) {
    return replaceField(state, value.slice(0, state.cursor) + value.slice(state.cursor + 1), state.cursor)
  }
  if (key.name === 'left') return { ...state, cursor: Math.max(0, state.cursor - 1) }
  if (key.name === 'right') return { ...state, cursor: Math.min(value.length, state.cursor + 1) }
  if (key.name === 'home') return { ...state, cursor: 0 }
  if (key.name === 'end') return { ...state, cursor: value.length }
  return state
}

function replaceField(
  state: TuiConnectionFormState,
  value: string,
  cursor: number,
): TuiConnectionFormState {
  if (!isTextField(state.focus)) return state
  return { ...state, [state.focus]: value, cursor }
}

function isTextField(field: TuiConnectionField): field is 'host' | 'port' | 'user' | 'database' | 'password' | 'passwordRef' {
  return field === 'host' || field === 'port' || field === 'user' || field === 'database'
    || field === 'password' || field === 'passwordRef'
}

function moveFocus(state: TuiConnectionFormState, delta: number): TuiConnectionFormState {
  const fields = tuiConnectionFields(state.type)
  const current = Math.max(0, fields.indexOf(state.focus))
  const focus = fields[(current + delta + fields.length) % fields.length]!
  return { ...state, focus, cursor: isTextField(focus) ? state[focus].length : 0 }
}

function clearPassword(state: TuiConnectionFormState): TuiConnectionFormState {
  return { ...state, password: '', cursor: state.focus === 'password' ? 0 : state.cursor }
}

function updateOpenSelector(state: TuiConnectionFormState, key: TuiFormKey): TuiFormTransition {
  const selector = state.selector!
  const optionCount = selector.field === 'type' ? TUI_DATABASE_TYPES.length : 2
  if (key.name === 'escape') return { kind: 'editing', state: closeSelector(state) }
  if (key.name === 'enter') {
    let selected: TuiConnectionFormState
    if (selector.field === 'type') {
      const type = TUI_DATABASE_TYPES[selector.index]!
      const previousDefault = state.type === 'sqlite' ? '' : String(defaultDatabasePort(state.type, state.secure))
      const secure = type === 'clickhouse' && state.secure
      const port = state.port === '' || state.port === previousDefault
        ? type === 'sqlite' ? '' : String(defaultDatabasePort(type, secure))
        : state.port
      selected = { ...state, type, secure, port }
    } else if (selector.field === 'secure') {
      const secure = selector.index === 1
      const previousDefault = String(defaultDatabasePort('clickhouse', state.secure))
      const port = state.port === '' || state.port === previousDefault
        ? String(defaultDatabasePort('clickhouse', secure))
        : state.port
      selected = { ...state, secure, port }
    } else {
      selected = { ...state, readonly: selector.index === 1 }
    }
    return { kind: 'editing', state: closeSelector(selected) }
  }
  let delta = 0
  if (key.name === 'up' || key.name === 'left') delta = -1
  if (key.name === 'down' || key.name === 'right') delta = 1
  if (delta === 0 && key.name !== 'home' && key.name !== 'end') return { kind: 'editing', state }
  const index = key.name === 'home'
    ? 0
    : key.name === 'end'
      ? optionCount - 1
      : (selector.index + delta + optionCount) % optionCount
  return { kind: 'editing', state: { ...state, selector: { ...selector, index } } }
}

function closeSelector(state: TuiConnectionFormState): TuiConnectionFormState {
  const { selector: _selector, ...rest } = state
  return rest
}

function renderField(state: TuiConnectionFormState, field: TuiConnectionField, width: number): string[] {
  const focused = state.focus === field
  const pointer = focused ? cyan('›') : ' '
  if (field === 'confirm' || field === 'cancel') {
    const label = field === 'confirm' ? '确定并连接' : '取消'
    return [`${pointer} ${focused ? cyan(bold(`[ ${label} ]`)) : `[ ${label} ]`}`]
  }

  const label = fieldLabel(field, state.type)
  let value: string
  let placeholder = false
  if (field === 'type') value = databaseTypeLabel(state.type)
  else if (field === 'readonly') value = state.readonly ? '是' : '否'
  else if (field === 'secure') value = state.secure ? '是' : '否'
  else {
    const raw = state[field]
    if (field === 'password') value = '*'.repeat([...raw].length)
    else value = raw
    if (value === '') {
      placeholder = true
      value = field === 'host'
        ? '127.0.0.1（默认）'
        : field === 'port'
          ? `${defaultDatabasePort(state.type as Exclude<DatabaseType, 'sqlite'>, state.secure)}（默认）`
          : field === 'password'
            ? '可留空'
            : field === 'passwordRef'
              ? '例如 DB_PASSWORD，可留空'
            : field === 'user'
              ? '可留空'
              : '请输入'
    }
  }
  const maxValue = Math.max(8, width - 20)
  const shown = truncate(value.replace(/[\r\n\u001B]/g, ' '), maxValue)
  const content = placeholder ? dim(shown) : shown
  const expandable = field === 'type' || field === 'readonly' || field === 'secure'
  const line = `${pointer} ${label.padEnd(8, '　')} [ ${focused ? cyan(content) : content}${expandable ? ' ▾' : ''} ]`
  if (state.selector?.field !== field) return [line]
  return [line, ...renderSelectorOptions(state)]
}

function renderSelectorOptions(state: TuiConnectionFormState): string[] {
  const selector = state.selector!
  const labels = selector.field === 'type'
    ? TUI_DATABASE_TYPES.map(databaseTypeLabel)
    : ['否', '是']
  const selectedIndex = selector.field === 'type'
    ? TUI_DATABASE_TYPES.indexOf(state.type)
    : state[selector.field] ? 1 : 0
  return labels.map((label, index) => {
    const pointer = index === selector.index ? cyan('›') : ' '
    const marker = index === selectedIndex ? cyan('●') : dim('○')
    const content = index === selector.index ? cyan(bold(label)) : label
    return `    ${pointer} ${marker} ${content}`
  })
}

function databaseTypeLabel(type: DatabaseType): string {
  return sharedDatabaseTypeLabel(type)
}

function fieldLabel(field: Exclude<TuiConnectionField, 'confirm' | 'cancel'>, type: DatabaseType): string {
  switch (field) {
    case 'type': return '数据库类型'
    case 'host': return '数据库主机'
    case 'port': return '数据库端口'
    case 'user': return '数据库用户'
    case 'database': return type === 'sqlite' ? '文件路径' : '数据库名'
    case 'password': return '密码'
    case 'passwordRef': return '凭据引用'
    case 'secure': return 'HTTPS'
    case 'readonly': return '只读模式'
  }
}

function truncate(value: string, width: number): string {
  const characters = [...value]
  return characters.length <= width ? value : `…${characters.slice(-(width - 1)).join('')}`
}

function bold(value: string): string { return `\u001B[1m${value}\u001B[22m` }
function dim(value: string): string { return `\u001B[2m${value}\u001B[22m` }
function cyan(value: string): string { return `\u001B[36m${value}\u001B[39m` }
function red(value: string): string { return `\u001B[31m${value}\u001B[39m` }
