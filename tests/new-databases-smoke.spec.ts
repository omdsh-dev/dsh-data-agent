/**
 * Opt-in real-database smoke coverage. A suite runs only when its explicit
 * `DSH_SMOKE_<TYPE>_ENABLED=1` gate is present; ordinary CI skips it and must
 * not treat the adapter as real-server verified.
 */
import { Context } from '@deepseek-ai/cordis'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import { describe, expect, it } from 'vitest'
import { createConnectionService, type DatabaseConnectionInput } from '../src/connections.ts'
import { enforceReadRowLimit } from '../src/clients.ts'
import { runClientQuery } from '../src/query.ts'
import { parseStructuredQueryOutput } from '../src/structured.ts'

const serviceOptions = {
  connectTimeoutMs: 15_000,
  queryTimeoutMs: 15_000,
  maxResultChars: 200_000,
  maxQueryChars: 65_536,
  introspectMaxTables: 500,
  readonly: false,
  clients: {},
}

function networkInput(
  type: 'clickhouse' | 'doris' | 'sqlserver',
  prefix: 'CLICKHOUSE' | 'DORIS' | 'SQLSERVER',
): DatabaseConnectionInput {
  const port = process.env[`DSH_SMOKE_${prefix}_PORT`]
  const password = process.env[`DSH_SMOKE_${prefix}_PASSWORD`]
  return {
    type,
    host: process.env[`DSH_SMOKE_${prefix}_HOST`] ?? '127.0.0.1',
    ...(port === undefined ? {} : { port: Number(port) }),
    ...(process.env[`DSH_SMOKE_${prefix}_USER`] === undefined
      ? {}
      : { user: process.env[`DSH_SMOKE_${prefix}_USER`] }),
    database: process.env[`DSH_SMOKE_${prefix}_DATABASE`] ?? (type === 'sqlserver' ? 'master' : 'default'),
    ...(password === undefined ? {} : { password }),
    ...(type === 'clickhouse'
      ? { secure: process.env.DSH_SMOKE_CLICKHOUSE_SECURE === '1' }
      : {}),
  }
}

async function realContext(): Promise<{ runtime: Context; ctx: Context }> {
  const runtime = new Context()
  await runtime.plugin(SubprocessLocal)
  return { runtime, ctx: runtime }
}

async function structuredRead(
  ctx: Context,
  connection: Awaited<ReturnType<ReturnType<typeof createConnectionService>['resolveForExecution']>>,
  sql: string,
) {
  const limited = enforceReadRowLimit(sql, connection.type, 10)
  const result = await runClientQuery(
    ctx,
    connection,
    limited,
    { ...serviceOptions, mode: 'structured' },
    new AbortController().signal,
  )
  expect(result.exitCode).toBe(0)
  return parseStructuredQueryOutput(connection.type, result.stdout, 10)
}

describe.skipIf(process.env.DSH_SMOKE_CLICKHOUSE_ENABLED !== '1')('real ClickHouse adapter smoke', () => {
  it('connects, creates disposable data, browses metadata, and parses a structured query', async () => {
    const { runtime, ctx } = await realContext()
    const service = createConnectionService(ctx, serviceOptions)
    const input = networkInput('clickhouse', 'CLICKHOUSE')
    const table = `dsh_smoke_${process.pid}_${Date.now()}`
    try {
      await service.connect('smoke-clickhouse', input, new AbortController().signal)
      await service.query('smoke-clickhouse', `CREATE TABLE ${table} (id UInt32, note Nullable(String)) ENGINE=Memory`, new AbortController().signal)
      await service.query('smoke-clickhouse', `INSERT INTO ${table} VALUES (1, '数据'), (2, NULL)`, new AbortController().signal)
      expect(await service.listTables('smoke-clickhouse', input.database, new AbortController().signal)).toContain(table)
      const connection = await service.resolveForExecution('smoke-clickhouse', new AbortController().signal)
      const parsed = await structuredRead(ctx, connection, `SELECT id, note FROM ${table} ORDER BY id`)
      expect(parsed.rows).toEqual([{ id: '1', note: '数据' }, { id: '2', note: null }])
    } finally {
      try { await service.query('smoke-clickhouse', `DROP TABLE IF EXISTS ${table}`, new AbortController().signal) } catch {}
      await runtime.dispose()
    }
  }, 60_000)
})

describe.skipIf(process.env.DSH_SMOKE_DORIS_ENABLED !== '1')('real Doris adapter smoke', () => {
  it('connects, creates disposable data, browses metadata, and parses a structured query', async () => {
    const { runtime, ctx } = await realContext()
    const service = createConnectionService(ctx, serviceOptions)
    const input = networkInput('doris', 'DORIS')
    const table = `dsh_smoke_${process.pid}_${Date.now()}`
    try {
      await service.connect('smoke-doris', input, new AbortController().signal)
      await service.query('smoke-doris', `CREATE TABLE ${table} (id INT, note VARCHAR(64)) DUPLICATE KEY(id) DISTRIBUTED BY HASH(id) BUCKETS 1 PROPERTIES ('replication_num'='1')`, new AbortController().signal)
      await service.query('smoke-doris', `INSERT INTO ${table} VALUES (1, '数据'), (2, NULL)`, new AbortController().signal)
      expect(await service.listTables('smoke-doris', input.database, new AbortController().signal)).toContain(table)
      const connection = await service.resolveForExecution('smoke-doris', new AbortController().signal)
      const parsed = await structuredRead(ctx, connection, `SELECT id, note FROM ${table} ORDER BY id`)
      expect(parsed.rows[0]).toMatchObject({ id: '1', note: '数据' })
    } finally {
      try { await service.query('smoke-doris', `DROP TABLE IF EXISTS ${table}`, new AbortController().signal) } catch {}
      await runtime.dispose()
    }
  }, 60_000)
})

describe.skipIf(process.env.DSH_SMOKE_SQLSERVER_ENABLED !== '1')('real SQL Server adapter smoke', () => {
  it('connects, creates disposable data, browses metadata, and parses a structured query', async () => {
    const { runtime, ctx } = await realContext()
    const service = createConnectionService(ctx, serviceOptions)
    const input = networkInput('sqlserver', 'SQLSERVER')
    const schema = process.env.DSH_SMOKE_SQLSERVER_SCHEMA ?? 'dbo'
    const table = `dsh_smoke_${process.pid}_${Date.now()}`
    const qualified = `[${schema}].[${table}]`
    try {
      await service.connect('smoke-sqlserver', input, new AbortController().signal)
      await service.query('smoke-sqlserver', `CREATE TABLE ${qualified} (id INT, note NVARCHAR(64) NULL)`, new AbortController().signal)
      await service.query('smoke-sqlserver', `INSERT INTO ${qualified} VALUES (1, N'数据'), (2, NULL)`, new AbortController().signal)
      expect(await service.listTables('smoke-sqlserver', schema, new AbortController().signal)).toContain(table)
      const connection = await service.resolveForExecution('smoke-sqlserver', new AbortController().signal)
      const parsed = await structuredRead(ctx, connection, `SELECT id, note FROM ${qualified} ORDER BY id`)
      expect(parsed.rows).toEqual([{ id: '1', note: '数据' }, { id: '2', note: null }])
    } finally {
      try { await service.query('smoke-sqlserver', `DROP TABLE IF EXISTS ${qualified}`, new AbortController().signal) } catch {}
      await runtime.dispose()
    }
  }, 60_000)
})
