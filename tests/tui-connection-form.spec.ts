import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  connectionFormDraft,
  createTuiConnectionFormState,
  decodeTuiFormInput,
  isDshTuiTerminal,
  renderTuiConnectionForm,
  runTuiConnectionForm,
  tuiConnectionFields,
  updateTuiConnectionForm,
  type TuiConnectionFormState,
} from '../src/tui-connection-form.ts'

function submit(state: TuiConnectionFormState) {
  return updateTuiConnectionForm({ ...state, focus: 'confirm' }, { name: 'enter' })
}

class FakeInput extends EventEmitter {
  isTTY = true
  isRaw = true
  private chunks: unknown[] = []

  setRawMode(value: boolean) { this.isRaw = value }
  ref() {}
  read() { return this.chunks.shift() ?? null }
  push(value: string) {
    this.chunks.push(Buffer.from(value))
    return true
  }
  send(value: string) {
    this.chunks.push(Buffer.from(value))
    this.emit('readable')
  }
}

class FakeOutput extends EventEmitter {
  isTTY = true
  columns = 100
  writes: string[] = []

  write(value: string) {
    this.writes.push(value)
    return true
  }
}

describe('dsh-tui connection form', () => {
  it('checks terminal capability without inferring a profile from argv', () => {
    expect(isDshTuiTerminal({ isTTY: true }, { isTTY: true })).toBe(true)
    expect(isDshTuiTerminal({ isTTY: false }, { isTTY: true })).toBe(false)
    expect(isDshTuiTerminal({ isTTY: true }, { isTTY: false })).toBe(false)
  })

  it('shows all network fields together and uses Tab/Shift+Tab for focus', () => {
    expect(tuiConnectionFields('mysql')).toEqual([
      'type', 'host', 'port', 'user', 'database', 'password', 'passwordRef', 'readonly', 'confirm', 'cancel',
    ])
    let transition = updateTuiConnectionForm(createTuiConnectionFormState(), { name: 'tab' })
    expect(transition.state.focus).toBe('host')
    transition = updateTuiConnectionForm(transition.state, { name: 'backtab' })
    expect(transition.state.focus).toBe('type')
  })

  it('opens complete type and readonly option lists with Enter', () => {
    let transition = updateTuiConnectionForm(createTuiConnectionFormState(), { name: 'enter' })
    expect(transition.state.selector).toEqual({ field: 'type', index: 0 })
    const typeFrame = renderTuiConnectionForm(transition.state)
    for (const label of ['MySQL', 'PostgreSQL', 'SQLite', 'Oracle', 'Hive', 'Impala', 'ClickHouse', 'Apache Doris', 'SQL Server']) {
      expect(typeFrame).toContain(label)
    }

    transition = updateTuiConnectionForm(transition.state, { name: 'down' })
    transition = updateTuiConnectionForm(transition.state, { name: 'down' })
    expect(transition.state.type).toBe('mysql')
    transition = updateTuiConnectionForm(transition.state, { name: 'enter' })
    expect(transition.state.type).toBe('sqlite')
    expect(transition.state.selector).toBeUndefined()

    transition = updateTuiConnectionForm({ ...transition.state, focus: 'readonly' }, { name: 'enter' })
    expect(renderTuiConnectionForm(transition.state)).toContain('●')
    transition = updateTuiConnectionForm(transition.state, { name: 'down' })
    transition = updateTuiConnectionForm(transition.state, { name: 'escape' })
    expect(transition.kind).toBe('editing')
    expect(transition.state.readonly).toBe(false)
    expect(transition.state.selector).toBeUndefined()
  })

  it('accepts truly blank host and port and applies mysql defaults at submit', () => {
    const transition = submit({
      ...createTuiConnectionFormState(),
      database: 'orders',
      user: 'app',
    })
    expect(transition.kind).toBe('submitted')
    if (transition.kind !== 'submitted') throw new Error('expected submitted form')
    expect(transition.input).toEqual({
      type: 'mysql',
      host: '127.0.0.1',
      port: 3306,
      user: 'app',
      database: 'orders',
      readonly: false,
    })
  })

  it('uses the new defaults and updates an untouched ClickHouse port with HTTPS', () => {
    let transition = updateTuiConnectionForm(createTuiConnectionFormState(), { name: 'enter' })
    for (let index = 0; index < 6; index += 1) {
      transition = updateTuiConnectionForm(transition.state, { name: 'down' })
    }
    transition = updateTuiConnectionForm(transition.state, { name: 'enter' })
    expect(transition.state.type).toBe('clickhouse')
    expect(transition.state.port).toBe('8123')
    expect(tuiConnectionFields('clickhouse')).toContain('secure')

    transition = updateTuiConnectionForm({ ...transition.state, focus: 'secure' }, { name: 'enter' })
    transition = updateTuiConnectionForm(transition.state, { name: 'down' })
    transition = updateTuiConnectionForm(transition.state, { name: 'enter' })
    expect(transition.state.secure).toBe(true)
    expect(transition.state.port).toBe('8443')

    const clickhouse = submit({ ...transition.state, database: 'analytics' })
    expect(clickhouse.kind).toBe('submitted')
    if (clickhouse.kind !== 'submitted') throw new Error('expected submitted form')
    expect(clickhouse.input).toMatchObject({ type: 'clickhouse', port: 8443, secure: true })
    expect(submit({ ...createTuiConnectionFormState(), type: 'doris', database: 'analytics' })).toMatchObject({
      kind: 'submitted', input: { type: 'doris', port: 9030 },
    })
    expect(submit({ ...createTuiConnectionFormState(), type: 'sqlserver', database: 'warehouse' })).toMatchObject({
      kind: 'submitted', input: { type: 'sqlserver', port: 1433 },
    })
  })

  it('preserves a custom ClickHouse port when HTTPS changes', () => {
    let transition = updateTuiConnectionForm({
      ...createTuiConnectionFormState(), type: 'clickhouse', port: '9440', focus: 'secure',
    }, { name: 'enter' })
    transition = updateTuiConnectionForm(transition.state, { name: 'down' })
    transition = updateTuiConnectionForm(transition.state, { name: 'enter' })
    expect(transition.state).toMatchObject({ secure: true, port: '9440' })
  })

  it('masks direct passwords and only returns them in the process-local input', () => {
    const secret = 's3cret!'
    const state = {
      ...createTuiConnectionFormState(),
      database: 'orders',
      password: secret,
      focus: 'password' as const,
      cursor: secret.length,
    }
    const frame = renderTuiConnectionForm(state)
    expect(frame).toContain('*'.repeat(secret.length))
    expect(frame).not.toContain(secret)

    const transition = submit(state)
    expect(transition.kind).toBe('submitted')
    if (transition.kind !== 'submitted') throw new Error('expected submitted form')
    expect(transition.input.password).toBe(secret)
    expect(transition.state.password).toBe('')
  })

  it('restores and submits a persistent credential reference without resolving it', () => {
    const state = createTuiConnectionFormState({
      type: 'mysql', host: 'db', port: '3306', user: 'app', database: 'orders', readonly: false,
      passwordRef: 'ORDERS_PASSWORD',
    })
    expect(state.password).toBe('')
    expect(state.passwordRef).toBe('ORDERS_PASSWORD')
    expect(renderTuiConnectionForm(state)).toContain('ORDERS_PASSWORD')
    expect(submit(state)).toMatchObject({
      kind: 'submitted',
      input: { type: 'mysql', database: 'orders', passwordRef: 'ORDERS_PASSWORD' },
    })
    expect(connectionFormDraft(state)).not.toHaveProperty('passwordRef')
  })

  it('rejects simultaneous temporary password and credential reference', () => {
    const transition = submit({
      ...createTuiConnectionFormState(),
      database: 'orders',
      password: 'temporary-secret',
      passwordRef: 'ORDERS_PASSWORD',
    })
    expect(transition.kind).toBe('editing')
    expect(transition.state.error).toContain('不能同时填写')
    expect(JSON.stringify(connectionFormDraft(transition.state))).not.toContain('temporary-secret')
  })

  it('keeps invalid credential references inside the form', () => {
    const transition = submit({
      ...createTuiConnectionFormState(), database: 'orders', passwordRef: 'not-a-valid-reference',
    })
    expect(transition.kind).toBe('editing')
    expect(transition.state.error).toContain('passwordRef')
  })

  it('reduces sqlite to path, readonly, and actions', () => {
    const state = { ...createTuiConnectionFormState(), type: 'sqlite' as const }
    expect(tuiConnectionFields('sqlite')).toEqual(['type', 'database', 'readonly', 'confirm', 'cancel'])
    expect(renderTuiConnectionForm(state)).not.toContain('数据库主机')
    expect(renderTuiConnectionForm(state)).not.toContain('凭据引用')
    const transition = submit({ ...state, database: './data.db', readonly: true })
    expect(transition.kind).toBe('submitted')
    if (transition.kind !== 'submitted') throw new Error('expected submitted form')
    expect(transition.input).toEqual({ type: 'sqlite', database: './data.db', readonly: true })
  })

  it('keeps invalid port errors inside the form', () => {
    const transition = submit({ ...createTuiConnectionFormState(), database: 'orders', port: '0' })
    expect(transition.kind).toBe('editing')
    expect(transition.state.error).toContain('1–65535')
  })

  it('decodes terminal navigation and printable input', () => {
    expect(decodeTuiFormInput(`\t\u001B[Z\u001B[C a\r\u007F`)).toEqual([
      { name: 'tab' },
      { name: 'backtab' },
      { name: 'right' },
      { name: 'space' },
      { name: 'text', text: 'a' },
      { name: 'enter' },
      { name: 'backspace' },
    ])
  })

  it('restores the original readable listener and raw mode after cancellation', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()
    const recoveredInput: string[] = []
    const original = () => {
      let chunk: unknown
      while ((chunk = input.read()) !== null) recoveredInput.push(Buffer.from(chunk as ArrayBuffer).toString('utf8'))
    }
    input.on('readable', original)

    const result = runTuiConnectionForm({ input, output })
    expect(input.listeners('readable')).not.toContain(original)
    input.send('\u001B')

    await expect(result).resolves.toBeUndefined()
    expect(input.listeners('readable')).toContain(original)
    expect(input.isRaw).toBe(true)
    expect(output.writes.join('')).toContain('Data Agent · 数据库连接')
    expect(recoveredInput).toEqual(['\u000C'])
  })

  it('requests a host full-frame redraw after successful submission', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()
    const recoveredInput: string[] = []
    input.on('readable', () => {
      let chunk: unknown
      while ((chunk = input.read()) !== null) recoveredInput.push(Buffer.from(chunk as ArrayBuffer).toString('utf8'))
    })

    const result = runTuiConnectionForm({ input, output })
    input.send('\r\u001B[B\u001B[B\r\tdatabase.db\t\t\r')

    await expect(result).resolves.toEqual({
      type: 'sqlite',
      database: 'database.db',
      readonly: false,
    })
    expect(recoveredInput).toEqual(['\u000C'])
  })

  it('submits all fields from one terminal form session', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()
    const result = runTuiConnectionForm({ input, output })

    // type → host(blank) → port(blank) → user → database → password → passwordRef(blank) → readonly → confirm
    input.send('\t\t\troot\torders\ttui-secret\t\t\r\u001B[B\r\t\r')

    await expect(result).resolves.toEqual({
      type: 'mysql',
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      database: 'orders',
      password: 'tui-secret',
      readonly: true,
    })
    expect(output.writes.join('')).not.toContain('tui-secret')
  })

  it('restores and persists only non-secret form draft values', async () => {
    const input = new FakeInput()
    const output = new FakeOutput()
    const initialDraft = {
      type: 'mysql' as const,
      host: 'db.internal',
      port: '3307',
      user: 'app',
      database: 'orders',
      readonly: true,
    }
    let saved: typeof initialDraft | undefined
    const result = runTuiConnectionForm({
      input,
      output,
      initialDraft,
      persistDraft(draft) { saved = draft },
    })
    expect(output.writes.join('')).toContain('db.internal')

    // Move to password, enter a secret, then cancel the form.
    input.send('\t\t\t\t\ttemporary-secret\u001B')
    await expect(result).resolves.toBeUndefined()
    expect(saved).toEqual(initialDraft)
    expect(JSON.stringify(saved)).not.toContain('temporary-secret')

    const restored = createTuiConnectionFormState(saved)
    expect(connectionFormDraft(restored)).toEqual(initialDraft)
    expect(restored.password).toBe('')
  })
})
