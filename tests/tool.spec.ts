import { describe, expect, it } from 'vitest'
import { createConnectionStore } from '../src/connections.ts'
import { apply, type Config } from '../src/tool.ts'

/** A fake subprocess service capturing the last spawn spec. */
interface FakeHandle {
  done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
  collected: {
    stdout?: { readFrom(): { text: string; lossy: boolean } }
    stderr?: { readFrom(): { text: string; lossy: boolean } }
  }
}

interface SpawnSpec {
  argv: readonly string[]
  stdio: { stdin: unknown; stdout: unknown; stderr: unknown }
  signal: AbortSignal
  env?: Record<string, string>
  cwd: string
  graceMs: number
}

function makeContext(overrides: {
  resolveExecutable?: (command: string) => Promise<string>
  spawn?: (spec: SpawnSpec) => FakeHandle
}, configOverrides?: Partial<Config>) {
  const store = createConnectionStore()
  let definition: { name?: string, execute?: (args: { sql: string }, exec: { agent?: { id: string }, signal: AbortSignal }) => Promise<unknown> } = {}
  const definitions: Record<string, typeof definition> = {}
  const ctx = {
    tools: {
      register(def: typeof definition) {
        definition = def
        if (def.name !== undefined) definitions[def.name] = def
      },
    },
    subprocess: {
      resolveExecutable: overrides.resolveExecutable ?? (async (command: string) => `/usr/bin/${command}`),
      spawn: overrides.spawn ?? ((spec: SpawnSpec) => ({
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: {
          stdout: { readFrom: () => ({ text: 'id\n1\n2\n', nextOffset: 0, lossy: false }) },
          stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
        },
      })),
    },
    dataAgentConnections: store,
    get(): unknown {
      return undefined
    },
  } as never
  const config: Config = {
    queryTimeoutMs: 5000,
    maxResultChars: 20000,
    maxRows: 100,
    readonly: false,
    clients: {},
    ...configOverrides,
  }
  apply(ctx as never, config)
  return { ctx, definition, definitions, store, config }
}

/** A done promise that settles when the spawn spec's signal fires (pre-aborted included). */
function abortingDone(spec: SpawnSpec): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    if (spec.signal.aborted) reject(new Error('aborted before spawn settled'))
    else spec.signal.addEventListener('abort', () => reject(new Error('aborted by signal')), { once: true })
  })
}

function execOf(sessionId: string) {
  return { agent: { id: sessionId }, signal: new AbortController().signal }
}

describe('sqlcmd tool', () => {
  it('registers the tool named sqlcmd with a required sql parameter', () => {
    const { definition } = makeContext({})
    // The registry wraps the definition; the tool half registers via
    // ctx.tools.register with defineTool — assert the execute face exists.
    expect(definition.execute).toBeTypeOf('function')
  })

  it('fails loud when the session has no connection', async () => {
    const { definition } = makeContext({})
    await expect(definition.execute!({ sql: 'SHOW TABLES;' }, execOf('unknown-session')))
      .rejects.toThrow(/请先在.*「数据库」标签页连接数据库/)
  })

  it('runs the SQL through the client with argv flags and SQL on stdin', async () => {
    let captured: SpawnSpec | undefined
    const { definition, store } = makeContext({
      spawn(spec) {
        captured = spec
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: {
            stdout: { readFrom: () => ({ text: 'orders\nusers\n', nextOffset: 0, lossy: false }) },
            stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
          },
        }
      },
    })
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db' })
    const result = await definition.execute!({ sql: 'SELECT * FROM orders LIMIT 5;' }, execOf('session-a'))
    expect(captured).toBeDefined()
    expect(captured!.argv).toEqual(['/usr/bin/sqlite3', '-header', '-column', '/tmp/orders.db'])
    expect(captured!.stdio.stdin).toEqual({ data: 'SELECT * FROM orders LIMIT 5;\n' })
    expect(result).toEqual({ exitCode: 0, stdout: 'orders\nusers\n', stderr: '', truncated: false })
  })

  it('passes the password through env only, never argv', async () => {
    let captured: SpawnSpec | undefined
    const { definition, store } = makeContext({
      spawn(spec) {
        captured = spec
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: {
            stdout: { readFrom: () => ({ text: 'ok\n', nextOffset: 0, lossy: false }) },
            stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
          },
        }
      },
    })
    store.set('session-a', { type: 'mysql', host: 'h', port: 3306, user: 'u', database: 'd', password: 'p@ss' })
    await definition.execute!({ sql: 'SELECT 1;' }, execOf('session-a'))
    expect(captured!.env).toEqual({ MYSQL_PWD: 'p@ss' })
    expect(captured!.argv.join(' ')).not.toContain('p@ss')
  })

  it('reports a non-zero exit code as a successful outcome with stderr', async () => {
    const { definition, store } = makeContext({
      spawn() {
        return {
          done: Promise.resolve({ exitCode: 1, signal: null }),
          collected: {
            stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
            stderr: { readFrom: () => ({ text: 'no such table: nope\n', nextOffset: 0, lossy: false }) },
          },
        }
      },
    })
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db' })
    const result = await definition.execute!({ sql: 'SELECT * FROM nope;' }, execOf('session-a'))
    expect(result).toEqual({ exitCode: 1, stdout: '', stderr: 'no such table: nope\n', truncated: false })
  })

  it('marks output as truncated when the collect reader reports lossy', async () => {
    const { definition, store } = makeContext({
      spawn() {
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: {
            stdout: { readFrom: () => ({ text: 'tail-of-output', nextOffset: 0, lossy: true }) },
            stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
          },
        }
      },
    })
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db' })
    const result = await definition.execute!({ sql: 'SELECT * FROM big;' }, execOf('session-a'))
    expect(result).toEqual({ exitCode: 0, stdout: 'tail-of-output', stderr: '', truncated: true })
  })

  it('surfaces a missing client binary with a clear error', async () => {
    const { definition, store } = makeContext({
      resolveExecutable: async () => {
        throw new Error('command not found: mysql')
      },
    })
    store.set('session-a', { type: 'mysql', host: 'h', port: 3306, user: 'u', database: 'd' })
    await expect(definition.execute!({ sql: 'SELECT 1;' }, execOf('session-a')))
      .rejects.toThrow(/无法解析数据库客户端 "mysql"/)
  })

  it('aborts the process tree when the query deadline fires', async () => {
    const { definition, store } = makeContext({
      spawn(spec) {
        return {
          done: abortingDone(spec),
          collected: {},
        }
      },
    }, { queryTimeoutMs: 100 })
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db' })
    await expect(definition.execute!({ sql: 'SELECT 1;' }, execOf('session-a')))
      .rejects.toThrow(/查询超过 100ms/)
  })

  it('propagates the caller signal abort instead of the internal deadline', async () => {
    const { definition, store } = makeContext({
      spawn(spec) {
        return {
          done: abortingDone(spec),
          collected: {},
        }
      },
    }, { queryTimeoutMs: 10_000 })
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db' })
    const controller = new AbortController()
    const pending = definition.execute!({ sql: 'SELECT 1;' }, { agent: { id: 'session-a' }, signal: controller.signal })
    controller.abort(new Error('caller cancelled'))
    await expect(pending).rejects.toThrow('caller cancelled')
  })

  it('rejects write statements when the connection is readonly', async () => {
    let spawned = false
    const { definition, store } = makeContext({
      spawn() {
        spawned = true
        return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: {} }
      },
    })
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db', readonly: true })
    await expect(definition.execute!({ sql: 'DELETE FROM orders;' }, execOf('session-a')))
      .rejects.toThrow(/只读模式/)
    expect(spawned).toBe(false)
  })

  it('rejects write statements when the config readonly is true', async () => {
    let spawned = false
    const { definition, store } = makeContext({
      spawn() {
        spawned = true
        return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: {} }
      },
    }, { readonly: true })
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db' })
    await expect(definition.execute!({ sql: 'DROP TABLE orders;' }, execOf('session-a')))
      .rejects.toThrow(/只读模式/)
    expect(spawned).toBe(false)
  })

  it('allows read statements when readonly is active', async () => {
    let captured: SpawnSpec | undefined
    const { definition, store } = makeContext({
      spawn(spec) {
        captured = spec
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: { stdout: { readFrom: () => ({ text: 'ok\n', nextOffset: 0, lossy: false }) }, stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } },
        }
      },
    }, { readonly: true })
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db' })
    const result = await definition.execute!({ sql: 'SELECT * FROM orders;' }, execOf('session-a'))
    expect(result.exitCode).toBe(0)
    expect(captured).toBeDefined()
  })
})

describe('sql-query / sql-write / sqlcmd hardening', () => {
  it('registers all three database tools with sqlcmd registered last', () => {
    const { definitions } = makeContext({})
    expect(definitions['sql-query']).toBeDefined()
    expect(definitions['sql-write']).toBeDefined()
    expect(definitions['sqlcmd']).toBeDefined()
  })

  it('sql-query returns structured rows and truncates at maxRows', async () => {
    const { definitions, store } = makeContext({
      spawn() {
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: {
            stdout: { readFrom: () => ({ text: 'id\tname\n1\ta\n2\tb\n3\tc\n', nextOffset: 0, lossy: false }) },
            stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
          },
        }
      },
    }, { maxRows: 2 })
    store.set('session-a', { type: 'mysql', host: 'h', port: 3306, user: 'u', database: 'd' })
    const result = await definitions['sql-query']!.execute!({ sql: 'SELECT id, name FROM orders;' }, execOf('session-a'))
    expect(result).toMatchObject({
      columns: ['id', 'name'],
      rows: [
        { id: '1', name: 'a' },
        { id: '2', name: 'b' },
      ],
      affectedRows: 0,
      truncated: true,
    })
    expect(result.elapsedMs).toBeTypeOf('number')
  })

  it('sql-query forces LIMIT for unbounded SELECT and uses the structured sqlite template', async () => {
    let captured: SpawnSpec | undefined
    const { definitions, store } = makeContext({
      spawn(spec) {
        captured = spec
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: {
            stdout: { readFrom: () => ({ text: 'id\n1\n', nextOffset: 0, lossy: false }) },
            stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
          },
        }
      },
    }, { maxRows: 25 })
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db' })
    await definitions['sql-query']!.execute!({ sql: 'SELECT * FROM orders' }, execOf('session-a'))
    expect(captured!.argv).toEqual(['/usr/bin/sqlite3', '-header', '-csv', '/tmp/orders.db'])
    expect(captured!.stdio.stdin).toEqual({ data: 'SELECT * FROM orders LIMIT 25\n' })
  })

  it('sql-query rejects write statements', async () => {
    let spawned = false
    const { definitions, store } = makeContext({
      spawn() {
        spawned = true
        return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: {} }
      },
    })
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db' })
    await expect(definitions['sql-query']!.execute!({ sql: 'DELETE FROM orders;' }, execOf('session-a')))
      .rejects.toThrow(/只执行读语句/)
    expect(spawned).toBe(false)
  })

  it('sql-write rejects read statements and rejects writes when readonly', async () => {
    let spawned = 0
    const { definitions, store } = makeContext({
      spawn() {
        spawned += 1
        return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: {} }
      },
    })
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db' })
    await expect(definitions['sql-write']!.execute!({ sql: 'SELECT * FROM orders;' }, execOf('session-a')))
      .rejects.toThrow(/sql-write 只执行写/)
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db', readonly: true })
    await expect(definitions['sql-write']!.execute!({ sql: 'INSERT INTO orders VALUES (1);' }, execOf('session-a')))
      .rejects.toThrow(/只读模式/)
    expect(spawned).toBe(0)
  })

  it('rejects multiple statements in every database tool', async () => {
    let spawned = 0
    const { definitions, store } = makeContext({
      spawn() {
        spawned += 1
        return { done: Promise.resolve({ exitCode: 0, signal: null }), collected: {} }
      },
    })
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db' })
    for (const tool of ['sql-query', 'sql-write', 'sqlcmd']) {
      await expect(definitions[tool]!.execute!({ sql: 'SELECT 1; SELECT 2;' }, execOf('session-a')))
        .rejects.toThrow(/一次只允许执行一条 SQL 语句/)
    }
    expect(spawned).toBe(0)
  })
})
