import { describe, expect, it } from 'vitest'
import {
  createConnectionService,
  type ConnectionPersistence,
  type PersistedConnectionFormDraft,
  type ConnectionServiceOptions,
  type PersistedConnectionProfile,
  type SessionConnectionBinding,
} from '../src/connections.ts'
import {
  persistedConnectionFormDraftSchema,
  persistedConnectionProfileSchema,
  latestConnectionProfile,
  sessionConnectionBindingSchema,
} from '../src/storage.ts'

interface SpawnSpec {
  argv: readonly string[]
  stdio: { stdin: { data: string } }
  signal: AbortSignal
  env?: Record<string, string>
}

function memoryPersistence() {
  const profiles = new Map<string, PersistedConnectionProfile>()
  const bindings = new Map<string, SessionConnectionBinding>()
  const drafts = new Map<string, PersistedConnectionFormDraft>()
  let failBindingWrite = false
  let failDraftWrite = false
  const persistence: ConnectionPersistence = {
    getProfile: id => profiles.get(id),
    getLatestProfile: () => latestConnectionProfile(profiles.entries()),
    async putProfile(id, value) { profiles.set(id, value) },
    async deleteProfile(id) { return profiles.delete(id) },
    getBinding: id => bindings.get(id),
    async putBinding(id, value) {
      if (failBindingWrite) {
        failBindingWrite = false
        throw new Error('binding medium unavailable')
      }
      bindings.set(id, value)
    },
    async deleteBinding(id) { return bindings.delete(id) },
    getDraft: id => drafts.get(id),
    async putDraft(id, value) {
      if (failDraftWrite) {
        failDraftWrite = false
        throw new Error('draft medium unavailable')
      }
      drafts.set(id, value)
    },
    async deleteDraft(id) { return drafts.delete(id) },
  }
  return {
    persistence,
    profiles,
    bindings,
    drafts,
    failNextBindingWrite() { failBindingWrite = true },
    failNextDraftWrite() { failDraftWrite = true },
  }
}

function fakeContext(options?: {
  secret?: () => string | undefined
  output?: (spec: SpawnSpec) => { exitCode?: number; stdout?: string; stderr?: string }
  resolveExecutable?: (
    command: string,
    env?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ) => Promise<string>
}) {
  const spawned: SpawnSpec[] = []
  let resolveCount = 0
  const ctx = {
    credentials: {
      async resolve() {
        resolveCount += 1
        const value = options?.secret?.()
        return value === undefined ? undefined : { value, source: 'test-provider' }
      },
      async describe() {
        return { configured: options?.secret?.() !== undefined, source: 'test-provider', writable: true }
      },
    },
    subprocess: {
      async resolveExecutable(
        command: string,
        env?: Readonly<Record<string, string>>,
        signal?: AbortSignal,
      ) {
        return options?.resolveExecutable === undefined
          ? `/usr/bin/${command}`
          : await options.resolveExecutable(command, env, signal)
      },
      spawn(spec: SpawnSpec) {
        spawned.push(spec)
        const result = options?.output?.(spec) ?? { stdout: 'users\n', stderr: '', exitCode: 0 }
        return {
          done: Promise.resolve({ exitCode: result.exitCode ?? 0, signal: null }),
          collected: {
            stdout: { readFrom: () => ({ text: result.stdout ?? '', nextOffset: 0, lossy: false }) },
            stderr: { readFrom: () => ({ text: result.stderr ?? '', nextOffset: 0, lossy: false }) },
          },
        }
      },
    },
  }
  return { ctx: ctx as never, spawned, get resolveCount() { return resolveCount } }
}

const serviceOptions: ConnectionServiceOptions = {
  connectTimeoutMs: 5_000,
  queryTimeoutMs: 5_000,
  maxResultChars: 20_000,
  maxQueryChars: 10_000,
  introspectMaxTables: 100,
  readonly: false,
  clients: {},
  cwd: '/workspace',
}

const signal = () => new AbortController().signal

describe('DataAgentConnectionService', () => {
  it('uses automatic client discovery during the initial cross-surface connection check', async () => {
    const customDirectory = process.platform === 'win32' ? 'C:\\company\\mysql\\bin' : '/opt/company/mysql/bin'
    const separator = process.platform === 'win32' ? ';' : ':'
    const host = fakeContext({
      async resolveExecutable(command, env) {
        const path = Object.entries(env ?? {}).find(([name]) => name.toLowerCase() === 'path')?.[1]
        if (path?.split(separator).includes(customDirectory)) {
          return process.platform === 'win32'
            ? `${customDirectory}\\${command}.exe`
            : `${customDirectory}/${command}`
        }
        throw new Error(`${command} was not found on PATH`)
      },
    })
    const service = createConnectionService(host.ctx, {
      ...serviceOptions,
      clients: { mysql: { searchPaths: [customDirectory] } },
    })
    await service.connect('session-discovery', {
      type: 'mysql', host: 'db', port: 3306, user: 'app', database: 'orders',
    }, signal())

    expect(host.spawned).toHaveLength(1)
    expect(host.spawned[0]!.argv[0]).toContain(customDirectory)
    const spawnPath = Object.entries(host.spawned[0]!.env ?? {}).find(([name]) => name.toLowerCase() === 'path')?.[1]
    expect(spawnPath?.split(separator)[0]).toBe(customDirectory)
  })

  it('persists only non-secret profile fields after successful validation', async () => {
    const durable = memoryPersistence()
    const host = fakeContext({ secret: () => 'super-secret' })
    const service = createConnectionService(host.ctx, serviceOptions, durable.persistence)

    const result = await service.connect('session-a', {
      type: 'mysql', host: 'db', port: 3306, user: 'app', database: 'orders',
      passwordRef: 'ORDERS_DB_PASSWORD', readonly: true,
    }, signal())

    expect(result.summary.credential).toEqual({ configured: true, source: 'test-provider' })
    expect(result.summary).not.toHaveProperty('password')
    expect(durable.bindings.get('session-a')?.profileId).toBe('session:session-a')
    const stored = durable.profiles.get('session:session-a')!
    expect(stored.passwordRef).toBe('ORDERS_DB_PASSWORD')
    expect(stored.credentialMode).toBe('reference')
    expect(stored).not.toHaveProperty('password')
    expect(durable.drafts.get('session-a')).toMatchObject({
      type: 'mysql', host: 'db', port: '3306', user: 'app', database: 'orders', readonly: true,
    })
    expect(JSON.stringify([...durable.profiles, ...durable.bindings])).not.toContain('super-secret')
  })

  it('persists and restores a session form draft without a secret field', async () => {
    const durable = memoryPersistence()
    const service = createConnectionService(fakeContext().ctx, serviceOptions, durable.persistence)
    await service.saveFormDraft('session-a', {
      type: 'postgres', host: 'db', port: '5432', user: 'app', database: 'analytics', readonly: true,
    })

    expect(service.getFormDraft('session-a')).toEqual({
      type: 'postgres', host: 'db', port: '5432', user: 'app', database: 'analytics', readonly: true,
    })
    expect(durable.drafts.get('session-a')?.updatedAt).toBeTruthy()
    expect(JSON.stringify(durable.drafts.get('session-a'))).not.toContain('password')

    const restored = createConnectionService(fakeContext().ctx, serviceOptions, durable.persistence)
    expect(restored.getFormDraft('session-a')?.database).toBe('analytics')
  })

  it('merges an exact draft with its bound profile credential reference', async () => {
    const durable = memoryPersistence()
    const host = fakeContext({ secret: () => 'resolved-secret' })
    const service = createConnectionService(host.ctx, serviceOptions, durable.persistence)
    await service.connect('session-a', {
      type: 'postgres', host: 'connected-host', user: 'connected-user', database: 'connected-db',
      passwordRef: 'ANALYTICS_PASSWORD', readonly: false,
    }, signal())
    await service.saveFormDraft('session-a', {
      type: 'postgres', host: 'edited-host', port: '5433', user: 'edited-user', database: 'edited-db', readonly: true,
    })

    expect(service.getFormDraft('session-a')).toEqual({
      type: 'postgres', host: 'edited-host', port: '5433', user: 'edited-user', database: 'edited-db',
      readonly: true, passwordRef: 'ANALYTICS_PASSWORD',
    })
    expect(JSON.stringify(durable.drafts.get('session-a'))).not.toContain('ANALYTICS_PASSWORD')
    expect(JSON.stringify(durable.drafts.get('session-a'))).not.toContain('resolved-secret')
  })

  it('uses the latest successful profile as unbound form defaults without sharing the connection', async () => {
    const durable = memoryPersistence()
    const host = fakeContext({ secret: () => 'resolved-secret' })
    const service = createConnectionService(host.ctx, serviceOptions, durable.persistence)
    await service.connect('session-a', {
      type: 'mysql', host: 'db.internal', port: 3307, user: 'app', database: 'orders',
      passwordRef: 'ORDERS_PASSWORD', readonly: true,
    }, signal())

    expect(service.getFormDraft('new-session')).toEqual({
      type: 'mysql', host: 'db.internal', port: '3307', user: 'app', database: 'orders',
      readonly: true, passwordRef: 'ORDERS_PASSWORD',
    })
    expect(await service.status('new-session')).toBeUndefined()
    await expect(service.resolveForExecution('new-session')).rejects.toThrow(/未找到当前会话的连接/)
  })

  it('prefers an exact bound profile over a newer unrelated profile when no draft exists', () => {
    const durable = memoryPersistence()
    durable.profiles.set('exact-profile', {
      type: 'postgres', host: 'exact-db', port: 5432, user: 'exact-user', database: 'exact',
      passwordRef: 'EXACT_PASSWORD', updatedAt: '2026-08-19T01:00:00.000Z',
    })
    durable.profiles.set('newer-profile', {
      type: 'mysql', host: 'newer-db', port: 3306, user: 'newer-user', database: 'newer',
      passwordRef: 'NEWER_PASSWORD', updatedAt: '2026-08-19T02:00:00.000Z',
    })
    durable.bindings.set('session-a', {
      profileId: 'exact-profile', updatedAt: '2026-08-19T01:00:00.000Z',
    })
    const service = createConnectionService(fakeContext().ctx, serviceOptions, durable.persistence)

    expect(service.getFormDraft('session-a')).toMatchObject({
      type: 'postgres', host: 'exact-db', user: 'exact-user', database: 'exact', passwordRef: 'EXACT_PASSWORD',
    })
  })

  it('resolves a credential again for connect and every later operation', async () => {
    let secret = 'first-secret'
    const host = fakeContext({
      secret: () => secret,
      output: spec => spec.stdio.stdin.data.includes('SHOW TABLES')
        ? { stdout: 'users\n' }
        : { stdout: 'ok\n' },
    })
    const service = createConnectionService(host.ctx, serviceOptions, memoryPersistence().persistence)
    await service.connect('s', { type: 'postgres', host: 'db', database: 'app', passwordRef: 'DB_PASSWORD' }, signal())
    secret = 'rotated-secret'
    await service.query('s', 'SELECT 1;', signal())

    expect(host.resolveCount).toBe(2)
    expect(host.spawned[0]!.env).toEqual({ PGPASSWORD: 'first-secret' })
    expect(host.spawned[1]!.env).toEqual({ PGPASSWORD: 'rotated-secret' })
    expect(host.spawned.flatMap(item => item.argv).join(' ')).not.toContain('secret')
  })

  it('keeps accessible system schemas and hides inaccessible ordinary schemas before the limit', async () => {
    const host = fakeContext({
      output: spec => {
        if (spec.stdio.stdin.data.includes('SHOW DATABASES')) {
          return {
            stdout: ['Database', 'private_archive', 'performance_schema', 'analytics', 'orders'].join('\n'),
          }
        }
        const databaseFlag = spec.argv.indexOf('-D')
        const database = databaseFlag === -1 ? undefined : spec.argv[databaseFlag + 1]
        if (database === 'private_archive') {
          return {
            exitCode: 1,
            stderr: "ERROR 1044 (42000) at line 1: Access denied for user 'app'@'localhost' to database 'private_archive'",
          }
        }
        return { stdout: `Tables_in_${database ?? 'unknown'}\nusers\n` }
      },
    })
    const service = createConnectionService(host.ctx, {
      ...serviceOptions,
      introspectMaxTables: 3,
    })
    await service.connect('s', { type: 'mysql', database: 'orders' }, signal())

    await expect(service.listSchemas('s', signal()))
      .resolves.toEqual(['performance_schema', 'analytics', 'orders'])
    const currentDatabaseProbes = host.spawned.filter(spec => {
      const databaseFlag = spec.argv.indexOf('-D')
      return spec.argv[databaseFlag + 1] === 'orders' && spec.stdio.stdin.data.trim() === 'SHOW TABLES;'
    })
    expect(currentDatabaseProbes).toHaveLength(0)
  })

  it('propagates non-1044 MySQL schema probe failures', async () => {
    const host = fakeContext({
      output: spec => {
        if (spec.stdio.stdin.data.includes('SHOW DATABASES')) {
          return { stdout: 'Database\nanalytics\n' }
        }
        const databaseFlag = spec.argv.indexOf('-D')
        if (spec.argv[databaseFlag + 1] === 'analytics') {
          return { exitCode: 1, stderr: 'ERROR 2006 (HY000): MySQL server has gone away' }
        }
        return { stdout: 'Tables_in_orders\nusers\n' }
      },
    })
    const service = createConnectionService(host.ctx, serviceOptions)
    await service.connect('s', { type: 'mysql', database: 'orders' }, signal())

    await expect(service.listSchemas('s', signal())).rejects.toThrow(/元数据查询失败.*ERROR 2006/)
  })

  it('fails before spawning when a credential reference is not configured', async () => {
    const host = fakeContext({ secret: () => undefined })
    const service = createConnectionService(host.ctx, serviceOptions, memoryPersistence().persistence)
    await expect(service.connect('s', {
      type: 'mysql', database: 'app', passwordRef: 'MISSING_DB_PASSWORD',
    }, signal())).rejects.toThrow(/MISSING_DB_PASSWORD.*未配置/)
    expect(host.spawned).toHaveLength(0)
  })

  it('rejects password/passwordRef together before database I/O', async () => {
    const host = fakeContext({ secret: () => 'secret' })
    const service = createConnectionService(host.ctx, serviceOptions)
    await expect(service.connect('s', {
      type: 'mysql', database: 'app', password: 'plain', passwordRef: 'DB_PASSWORD',
    }, signal())).rejects.toThrow(/不能同时提供/)
    expect(host.spawned).toHaveLength(0)
  })

  it('does not replace runtime or durable state when validation/persistence fails', async () => {
    let shouldFailValidation = false
    const host = fakeContext({
      output: () => shouldFailValidation
        ? { exitCode: 1, stderr: 'access denied' }
        : { stdout: 'one\n' },
    })
    const durable = memoryPersistence()
    const service = createConnectionService(host.ctx, serviceOptions, durable.persistence)
    await service.connect('s', { type: 'sqlite', database: 'first.db' }, signal())

    shouldFailValidation = true
    await expect(service.connect('s', { type: 'sqlite', database: 'bad.db' }, signal())).rejects.toThrow(/验证失败/)
    expect(service.get('s')?.database).toBe('/workspace/first.db')
    expect(durable.profiles.get('session:s')?.database).toBe('/workspace/first.db')

    shouldFailValidation = false
    durable.failNextBindingWrite()
    await expect(service.connect('s', { type: 'sqlite', database: 'second.db' }, signal())).rejects.toThrow(/medium unavailable/)
    expect(service.get('s')?.database).toBe('/workspace/first.db')
    expect(durable.profiles.get('session:s')?.database).toBe('/workspace/first.db')
    expect(durable.drafts.get('s')?.database).toBe('/workspace/first.db')

    durable.failNextDraftWrite()
    await expect(service.connect('s', { type: 'sqlite', database: 'third.db' }, signal())).rejects.toThrow(/draft medium unavailable/)
    expect(service.get('s')?.database).toBe('/workspace/first.db')
    expect(durable.profiles.get('session:s')?.database).toBe('/workspace/first.db')
    expect(durable.bindings.get('s')?.profileId).toBe('session:s')
    expect(durable.drafts.get('s')?.database).toBe('/workspace/first.db')
  })

  it('isolates bindings and restores wildcard fallback after disconnect', async () => {
    const durable = memoryPersistence()
    durable.profiles.set('default', { type: 'sqlite', database: '/default.db', updatedAt: 'x' })
    durable.bindings.set('*', { profileId: 'default', updatedAt: 'x' })
    const service = createConnectionService(fakeContext().ctx, serviceOptions, durable.persistence)
    expect(service.get('session-b')?.database).toBe('/default.db')
    service.set('session-a', { type: 'sqlite', database: '/exact.db' })
    expect(service.get('session-a')?.database).toBe('/exact.db')
    await service.disconnect('session-a')
    expect(service.get('session-a')?.database).toBe('/default.db')
    expect(service.get('session-b')?.database).toBe('/default.db')
  })

  it('disconnect removes the binding but retains the reusable profile', async () => {
    const durable = memoryPersistence()
    const service = createConnectionService(fakeContext().ctx, serviceOptions, durable.persistence)
    await service.connect('s', { type: 'sqlite', database: 'orders.db' }, signal())
    await service.disconnect('s')
    expect(durable.bindings.has('s')).toBe(false)
    expect(durable.profiles.has('session:s')).toBe(true)
    expect(service.get('s')).toBeUndefined()
  })

  it('restores a passwordRef binding in a second surface/process', async () => {
    const durable = memoryPersistence()
    const webHost = fakeContext({ secret: () => 'web-secret' })
    const web = createConnectionService(webHost.ctx, serviceOptions, durable.persistence)
    await web.connect('shared-session', {
      type: 'postgres', host: 'db', database: 'analytics', passwordRef: 'ANALYTICS_PASSWORD',
    }, signal())

    const tuiHost = fakeContext({ secret: () => 'tui-secret', output: () => ({ stdout: '1\n' }) })
    const tui = createConnectionService(tuiHost.ctx, serviceOptions, durable.persistence)
    expect(await tui.status('shared-session')).toMatchObject({
      passwordRef: 'ANALYTICS_PASSWORD', ready: true, reconnectRequired: false,
    })
    await tui.query('shared-session', 'SELECT 1;', signal())
    expect(tuiHost.spawned[0]!.env).toEqual({ PGPASSWORD: 'tui-secret' })
  })

  it('requires reauthentication after restart when a temporary password was not persisted', async () => {
    const durable = memoryPersistence()
    const webHost = fakeContext()
    const web = createConnectionService(webHost.ctx, serviceOptions, durable.persistence)
    await web.connect('shared-session', {
      type: 'mysql', host: 'localhost', user: 'dsh_demo', database: 'dsh_data_agent_demo',
      password: 'process-only-secret',
    }, signal())

    const stored = durable.profiles.get('session:shared-session')!
    expect(stored.credentialMode).toBe('password')
    expect(stored).not.toHaveProperty('password')

    const desktopHost = fakeContext()
    const desktop = createConnectionService(desktopHost.ctx, serviceOptions, durable.persistence)
    expect(await desktop.status('shared-session')).toMatchObject({
      credentialMode: 'password',
      credential: { configured: false },
      ready: false,
      reconnectRequired: true,
    })
    await expect(desktop.listSchemas('shared-session', signal())).rejects.toThrow(/凭据需要重新输入/)
    expect(desktopHost.spawned).toHaveLength(0)
  })

  it('restores an explicitly passwordless profile without requiring reauthentication', async () => {
    const durable = memoryPersistence()
    const web = createConnectionService(fakeContext().ctx, serviceOptions, durable.persistence)
    await web.connect('shared-session', {
      type: 'mysql', host: 'localhost', user: 'local', database: 'passwordless',
    }, signal())

    expect(durable.profiles.get('session:shared-session')?.credentialMode).toBe('none')
    const desktopHost = fakeContext({ output: () => ({ stdout: '1\n' }) })
    const desktop = createConnectionService(desktopHost.ctx, serviceOptions, durable.persistence)
    expect(await desktop.status('shared-session')).toMatchObject({
      credentialMode: 'none', ready: true, reconnectRequired: false,
    })
    await desktop.query('shared-session', 'SELECT 1;', signal())
    expect(desktopHost.spawned).toHaveLength(1)
    expect(desktopHost.spawned[0]!.env).toEqual({})
  })

  it('returns structured interactive reads capped for 50,000-row exports and preserves write messages', async () => {
    const host = fakeContext({
      output: spec => {
        if (spec.stdio.stdin.data.includes('sqlite_master')) return { stdout: 'users\n' }
        if (spec.stdio.stdin.data.includes('SELECT id')) return { stdout: 'id,name\n1,Alice\n2,张三\n' }
        return { stdout: 'write ok\n' }
      },
    })
    const service = createConnectionService(host.ctx, serviceOptions)
    await service.connect('s', { type: 'sqlite', database: 'orders.db' }, signal())

    const read = await service.executeInteractive('s', 'SELECT id, name FROM users;', signal())
    expect(read).toEqual({
      kind: 'table', columns: ['id', 'name'],
      rows: [{ id: '1', name: 'Alice' }, { id: '2', name: '张三' }],
      elapsedMs: expect.any(Number), truncated: false, maxRows: 50_000,
    })
    expect(host.spawned[1]!.stdio.stdin.data).toContain('LIMIT 50001')

    const write = await service.executeInteractive('s', 'DELETE FROM users WHERE id = 99;', signal())
    expect(write).toMatchObject({ kind: 'message', exitCode: 0, stdout: 'write ok\n' })
  })

  it('redacts a resolved secret from client stdout and stderr', async () => {
    const host = fakeContext({
      secret: () => 'leaky-secret',
      output: spec => spec.stdio.stdin.data.includes('SHOW TABLES')
        ? { stdout: 'users\n' }
        : { stdout: 'leaky-secret\n', stderr: 'error leaky-secret' },
    })
    const service = createConnectionService(host.ctx, serviceOptions)
    await service.connect('s', { type: 'mysql', database: 'app', passwordRef: 'DB_PASSWORD' }, signal())
    const result = await service.query('s', 'SELECT 1;', signal())
    expect(JSON.stringify(result)).not.toContain('leaky-secret')
    expect(result.stdout).toContain('[REDACTED]')
  })
})

describe('connection storage schemas', () => {
  it('selects the latest profile deterministically without changing its record', () => {
    const first = { type: 'sqlite' as const, database: '/first.db', updatedAt: '2026-08-19T01:00:00.000Z' }
    const tied = { type: 'sqlite' as const, database: '/tied.db', updatedAt: '2026-08-19T02:00:00.000Z' }
    expect(latestConnectionProfile([
      ['profile-z', tied],
      ['profile-a', tied],
      ['profile-old', first],
    ])).toEqual({ profileId: 'profile-z', profile: tied })
    expect(latestConnectionProfile([])).toBeUndefined()
  })

  it('accepts safe records and rejects secret/unknown fields', () => {
    expect(persistedConnectionProfileSchema.safeParse({
      type: 'mysql', database: 'orders', passwordRef: 'DB_PASSWORD', credentialMode: 'reference', updatedAt: 'x',
    }).success).toBe(true)
    expect(persistedConnectionProfileSchema.safeParse({
      type: 'mysql', database: 'orders', credentialMode: 'invalid', updatedAt: 'x',
    }).success).toBe(false)
    expect(persistedConnectionProfileSchema.safeParse({
      type: 'mysql', database: 'orders', password: 'secret', updatedAt: 'x',
    }).success).toBe(false)
    expect(sessionConnectionBindingSchema.safeParse({ profileId: 'p', updatedAt: 'x' }).success).toBe(true)
    expect(persistedConnectionFormDraftSchema.safeParse({
      type: 'mysql', host: '', port: '', user: '', database: '', readonly: false, updatedAt: 'x', password: 'secret',
    }).success).toBe(false)
  })
})
