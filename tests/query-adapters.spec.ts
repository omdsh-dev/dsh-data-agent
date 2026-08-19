import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clickHouseMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}))

vi.mock('@clickhouse/client', () => ({ createClient: clickHouseMocks.createClient }))

import { clickHouseConnectionUrl, runClientQuery } from '../src/query.ts'

const options = {
  clients: {},
  timeoutMs: 1_000,
  maxResultChars: 1_024,
}

function clickHouseClient(stdout = '') {
  return {
    command: vi.fn(async () => undefined),
    exec: vi.fn(async () => ({ stream: Readable.from([Buffer.from(stdout)]) })),
    close: vi.fn(async () => undefined),
  }
}

function sqlServerContext(stdout = '') {
  const calls: { resolved: unknown[]; spawn?: Record<string, unknown> } = { resolved: [] }
  const ctx = {
    subprocess: {
      async resolveExecutable(...args: unknown[]) {
        calls.resolved.push(args)
        return '/opt/mssql-tools18/bin/sqlcmd'
      },
      spawn(input: Record<string, unknown>) {
        calls.spawn = input
        return {
          done: Promise.resolve({ exitCode: 0 }),
          collected: {
            stdout: { readFrom: () => ({ text: stdout, lossy: false }) },
            stderr: { readFrom: () => ({ text: '', lossy: false }) },
          },
        }
      },
    },
  }
  return { ctx: ctx as never, calls }
}

describe('ClickHouse HTTP query adapter', () => {
  beforeEach(() => { clickHouseMocks.createClient.mockReset() })

  it('constructs explicit HTTP/HTTPS endpoints without credentials', () => {
    expect(clickHouseConnectionUrl({
      type: 'clickhouse', host: 'clickhouse.internal', database: 'analytics',
    })).toBe('http://clickhouse.internal:8123/')
    const url = clickHouseConnectionUrl({
      type: 'clickhouse', host: 'clickhouse.internal', database: 'analytics', secure: true,
      user: 'default', password: 'click-secret',
    })
    expect(url).toBe('https://clickhouse.internal:8443/')
    expect(url).not.toContain('default')
    expect(url).not.toContain('click-secret')
  })

  it('passes credentials only through dedicated client fields and uses stable structured output', async () => {
    const client = clickHouseClient('["id"]\n["UInt64"]\n[1]\n')
    clickHouseMocks.createClient.mockReturnValue(client)
    const result = await runClientQuery(
      {} as never,
      {
        type: 'clickhouse', host: 'ch', port: 8443, secure: true, user: 'reader', database: 'analytics',
        password: 'click-secret',
      },
      'SELECT id FROM events',
      { ...options, mode: 'structured' },
      new AbortController().signal,
    )
    expect(clickHouseMocks.createClient).toHaveBeenCalledWith({
      url: 'https://ch:8443/',
      username: 'reader',
      password: 'click-secret',
      database: 'analytics',
      request_timeout: 1_000,
    })
    expect(client.exec).toHaveBeenCalledWith(expect.objectContaining({
      query: 'SELECT id FROM events',
      clickhouse_settings: { default_format: 'JSONCompactEachRowWithNamesAndTypes' },
    }))
    expect(result).toEqual({
      exitCode: 0, stdout: '["id"]\n["UInt64"]\n[1]\n', stderr: '', truncated: false,
    })
    expect(client.close).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain('click-secret')
  })

  it('uses command for writes, bounds output, and always closes the client', async () => {
    const writeClient = clickHouseClient()
    clickHouseMocks.createClient.mockReturnValue(writeClient)
    await expect(runClientQuery(
      {} as never,
      { type: 'clickhouse', database: 'analytics' },
      'INSERT INTO events VALUES (1)',
      options,
      new AbortController().signal,
    )).resolves.toMatchObject({ exitCode: 0, stdout: '' })
    expect(writeClient.command).toHaveBeenCalledWith(expect.objectContaining({
      query: 'INSERT INTO events VALUES (1)',
    }))
    expect(writeClient.close).toHaveBeenCalledOnce()

    const readClient = clickHouseClient('123456')
    clickHouseMocks.createClient.mockReturnValue(readClient)
    await expect(runClientQuery(
      {} as never,
      { type: 'clickhouse', database: 'analytics' },
      'SELECT 1',
      { ...options, maxResultChars: 4 },
      new AbortController().signal,
    )).resolves.toEqual({ exitCode: 0, stdout: '1234', stderr: '', truncated: true })
    expect(readClient.close).toHaveBeenCalledOnce()
  })
})

describe('SQL Server subprocess adapter', () => {
  it('uses SQLCMDPASSWORD, stdin SQL, NOCOUNT, and narrow footer filtering', async () => {
    const { ctx, calls } = sqlServerContext('id\n1\n(1 rows affected)\n')
    const result = await runClientQuery(
      ctx,
      {
        type: 'sqlserver', host: 'sql', port: 1433, user: 'sa', database: 'warehouse',
        password: 'sql-secret',
      },
      'SELECT TOP (1) id FROM orders',
      options,
      new AbortController().signal,
    )
    const spawn = calls.spawn as {
      argv: string[]
      env: Record<string, string>
      stdio: { stdin: { data: string } }
    }
    expect(spawn.argv[0]).toBe('/opt/mssql-tools18/bin/sqlcmd')
    expect(spawn.argv).not.toContain('-C')
    expect(spawn.argv.join(' ')).not.toContain('sql-secret')
    expect(spawn.env.SQLCMDPASSWORD).toBe('sql-secret')
    expect(spawn.stdio.stdin.data).toBe('SET NOCOUNT ON;\nSELECT TOP (1) id FROM orders\n')
    expect(result.stdout).toBe('id\n1')
    expect(JSON.stringify(result)).not.toContain('sql-secret')
  })

  it('rejects sqlcmd scripting before executable resolution or spawn', async () => {
    const { ctx, calls } = sqlServerContext()
    await expect(runClientQuery(
      ctx,
      { type: 'sqlserver', database: 'warehouse' },
      ':r unsafe.sql',
      options,
      new AbortController().signal,
    )).rejects.toThrow(/禁止 sqlcmd/)
    expect(calls.resolved).toHaveLength(0)
    expect(calls.spawn).toBeUndefined()
  })
})
