import { describe, expect, it } from 'vitest'
import {
  DATABASE_COMMAND_USAGE,
  DATA_AGENT_TOOL_NAMES,
  apply,
  executeDatabaseCommand,
  parseConnectArguments,
} from '../src/command.ts'
import type { ConnectionFormDraft, ConnectionFormInitial } from '../src/connections.ts'

function invocation(rawInput: string, id = 'agent-a') {
  return {
    commandId: 'test-command',
    agent: { id },
    rawInput,
    signal: new AbortController().signal,
  } as never
}

function commandContext(options?: { questions?: { ask(request: { questions: { id: string }[] }): Promise<unknown> } }) {
  let registered: Record<string, unknown> | undefined
  let catalogRegistered: Record<string, unknown> | undefined
  let restriction: Record<string, unknown> | undefined
  const emitted: string[] = []
  const calls: { method: string; sessionId?: string; input?: unknown }[] = []
  const drafts = new Map<string, ConnectionFormInitial>()
  const summary = {
    type: 'mysql' as const, host: 'db', port: 3306, user: 'app', database: 'orders',
    passwordRef: 'DB_PASSWORD', credential: { configured: true, source: 'env' },
  }
  const service = {
    getFormDraft(sessionId: string) { return drafts.get(sessionId) },
    async saveFormDraft(sessionId: string, draft: ConnectionFormDraft) {
      drafts.set(sessionId, draft)
    },
    async status(sessionId: string) { calls.push({ method: 'status', sessionId }); return summary },
    async connect(sessionId: string, input: unknown) { calls.push({ method: 'connect', sessionId, input }); return { tables: ['users'], summary } },
    async test(sessionId: string) { calls.push({ method: 'test', sessionId }); return { tables: ['users'], summary } },
    async disconnect(sessionId: string) { calls.push({ method: 'disconnect', sessionId }) },
  }
  const ctx = {
    commands: { register(definition: Record<string, unknown>) {
      if (definition.name === 'catalog') catalogRegistered = definition
      else registered = definition
      return () => {}
    } },
    tools: {
      restrict(filter: Record<string, unknown>) { restriction = filter; return () => {} },
      schemas() {
        return [
          'describe_image',
          ...DATA_AGENT_TOOL_NAMES,
          'render-analysis',
          'ssh_exec',
        ].map(name => ({ name }))
      },
    },
    dataAgentConnections: service,
    get(name: string) { return name === 'userQuestions' ? options?.questions : undefined },
    emit(event: string) { emitted.push(event) },
    effect() {},
  }
  return {
    ctx: ctx as never,
    calls,
    drafts,
    emitted,
    get registered() { return registered },
    get catalogRegistered() { return catalogRegistered },
    get restriction() { return restriction },
  }
}

describe('/database command', () => {
  it('registers an agent-scoped human command with recordInput disabled', async () => {
    const fixture = commandContext()
    await apply(fixture.ctx, { isDshTuiPluginLoaded: () => true })
    expect(fixture.registered).toMatchObject({
      name: 'database',
      recordInput: false,
    })
    expect(fixture.registered?.handler).toBeTypeOf('function')
    expect(fixture.catalogRegistered).toMatchObject({ name: 'catalog', recordInput: false })
    expect(fixture.restriction).toEqual({ deny: ['describe_image', 'ssh_exec'] })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fixture.emitted).toContain('commands/change')
  })

  it('keeps the data-agent tool restriction but registers no human commands without dsh-tui', async () => {
    const fixture = commandContext()
    await apply(fixture.ctx, { isDshTuiPluginLoaded: () => false })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(fixture.registered).toBeUndefined()
    expect(fixture.catalogRegistered).toBeUndefined()
    expect(fixture.emitted).not.toContain('commands/change')
    expect(fixture.restriction).toEqual({ deny: ['describe_image', 'ssh_exec'] })
  })

  it('returns a redacted status and usage for an empty command', async () => {
    const fixture = commandContext()
    const result = await executeDatabaseCommand(fixture.ctx, invocation(''))
    expect(result.kind).toBe('success')
    expect(result.text).toContain('DB_PASSWORD')
    expect(result.text).toContain(DATABASE_COMMAND_USAGE)
    expect(result.text).not.toContain('secret-value')
    expect(fixture.calls[0]).toEqual({ method: 'status', sessionId: 'agent-a' })
  })

  it('parses every database type and safe non-interactive arguments', () => {
    for (const type of ['mysql', 'postgres', 'sqlite', 'oracle', 'hive', 'impala', 'clickhouse', 'doris', 'sqlserver']) {
      const parsed = parseConnectArguments(['--type', type, '--database', 'db', '--password-ref', 'DB_PASSWORD', '--readonly'])
      expect(parsed).toMatchObject({ type, database: 'db', passwordRef: 'DB_PASSWORD', readonly: true })
    }
    expect(parseConnectArguments([
      '--type', 'clickhouse', '--database', 'db', '--secure',
    ])).toMatchObject({ type: 'clickhouse', secure: true })
    expect(DATABASE_COMMAND_USAGE).toContain('clickhouse|doris|sqlserver')
  })

  it('rejects plaintext password syntax before calling the service', async () => {
    const fixture = commandContext()
    const result = await executeDatabaseCommand(fixture.ctx, invocation(' connect --type mysql --database app --password plain-secret'))
    expect(result).toEqual({
      kind: 'error',
      text: '安全限制：/database 不接受明文密码参数；请改用 --password-ref <REF>。',
    })
    expect(fixture.calls).toHaveLength(0)
    expect(JSON.stringify(result)).not.toContain('plain-secret')
  })

  it('returns non-interactive usage instead of waiting without a question provider', async () => {
    const fixture = commandContext()
    const result = await executeDatabaseCommand(fixture.ctx, invocation(' connect'))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('没有可用的问答 provider')
    expect(result.text).toContain('--password-ref')
  })

  it('collects interactive answers and delegates with the exact agent id', async () => {
    let turn = 0
    const questions = {
      async ask(request: { questions: { id: string }[] }) {
        turn += 1
        if (turn === 1) return { answers: [{ id: 'type', selected: ['mysql'] }] }
        expect(request.questions.map(item => item.id)).toContain('passwordRef')
        return {
          answers: [
            { id: 'host', selected: [], custom: 'db.internal' },
            { id: 'port', selected: [], custom: '3306' },
            { id: 'user', selected: [], custom: 'app' },
            { id: 'database', selected: [], custom: 'orders' },
            { id: 'passwordRef', selected: [], custom: 'ORDERS_PASSWORD' },
            { id: 'readonly', selected: ['是'] },
          ],
        }
      },
    }
    const fixture = commandContext({ questions })
    const result = await executeDatabaseCommand(fixture.ctx, invocation(' connect', 'exact-agent'))
    expect(result.kind).toBe('success')
    expect(fixture.calls[0]).toEqual({
      method: 'connect',
      sessionId: 'exact-agent',
      input: {
        type: 'mysql', host: 'db.internal', port: 3306, user: 'app', database: 'orders',
        passwordRef: 'ORDERS_PASSWORD', readonly: true,
      },
    })
  })

  it('uses the dsh-tui form interaction and never returns its direct password', async () => {
    const secret = 'tui-only-secret'
    const fixture = commandContext()
    fixture.drafts.set('tui-agent', {
      type: 'mysql', host: 'old-host', port: '', user: '', database: 'old-db', readonly: false,
      passwordRef: 'OLD_PASSWORD',
    })
    const result = await executeDatabaseCommand(fixture.ctx, invocation(' connect', 'tui-agent'), {
      isTuiFormAvailable: () => true,
      async collectTuiConnection(_signal, options) {
        expect(options.initialDraft?.host).toBe('old-host')
        expect(options.initialDraft?.passwordRef).toBe('OLD_PASSWORD')
        await options.persistDraft({
          type: 'mysql', host: '127.0.0.1', port: '3306', user: 'root', database: 'orders', readonly: false,
        })
        return {
          type: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', database: 'orders',
          password: secret, readonly: false,
        }
      },
    })
    expect(result.kind).toBe('success')
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(fixture.calls[0]).toEqual({
      method: 'connect',
      sessionId: 'tui-agent',
      input: {
        type: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', database: 'orders',
        password: secret, readonly: false,
      },
    })
    expect(fixture.drafts.get('tui-agent')?.database).toBe('orders')
  })

  it('reports dsh-tui form cancellation without calling the service', async () => {
    const fixture = commandContext()
    const result = await executeDatabaseCommand(fixture.ctx, invocation(' connect'), {
      isTuiFormAvailable: () => true,
      async collectTuiConnection() { return undefined },
    })
    expect(result).toEqual({ kind: 'error', text: '已取消数据库连接。' })
    expect(fixture.calls).toHaveLength(0)
  })

  it('delegates test/disconnect to the exact invocation agent', async () => {
    const fixture = commandContext()
    expect((await executeDatabaseCommand(fixture.ctx, invocation(' test', 'a'))).kind).toBe('success')
    expect((await executeDatabaseCommand(fixture.ctx, invocation(' disconnect', 'b'))).kind).toBe('success')
    expect(fixture.calls).toEqual([
      { method: 'test', sessionId: 'a' },
      { method: 'disconnect', sessionId: 'b' },
    ])
  })
})
