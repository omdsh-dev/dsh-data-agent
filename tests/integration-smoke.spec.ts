/**
 * Opt-in integration smoke tests against real ClickHouse / Doris / SQL Server
 * services. They exercise the exact CLI templates and parsers produced by
 * src/clients.ts — same argv shape, same credential environment entries, same
 * stdin SQL channel as the plugin's runClientQuery path.
 *
 * Run (skipped unless DSH_SMOKE_HOST is set):
 *   DSH_SMOKE_HOST=192.168.0.243 \
 *   DSH_SMOKE_CH_PASSWORD=... \
 *   DSH_SMOKE_MSSQL_PASSWORD=... \
 *   PATH="/path/to/clickhouse-client:/path/to/mysql:/path/to/sqlcmd:$PATH" \
 *   pnpm vitest run tests/integration-smoke.spec.ts
 *
 * The tests create and drop a `dsh_smoke` database/table set on each service.
 */
import { spawn } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildClientTemplate,
  buildIntrospectTemplate,
  classifyStatement,
  metadataQuery,
  parseColumns,
  parseListing,
  parseTableListing,
  tableListingSql,
  type ClientTemplate,
} from '../src/clients.ts'
import type { DatabaseConnection } from '../src/connections.ts'

const HOST = process.env.DSH_SMOKE_HOST
const CH_PASSWORD = process.env.DSH_SMOKE_CH_PASSWORD
const MSSQL_PASSWORD = process.env.DSH_SMOKE_MSSQL_PASSWORD

/** One captured client-process outcome. */
interface RunOutcome {
  exitCode: number | null
  stdout: string
  stderr: string
}

/** Run one CLI invocation exactly the way the plugin does: argv + env + stdin SQL. */
function runTemplate(template: ClientTemplate, sql: string, timeoutMs = 60_000): Promise<RunOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(template.command, [...template.args], {
      env: { ...process.env, ...template.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', chunk => stdout.push(chunk as Buffer))
    child.stderr.on('data', chunk => stderr.push(chunk as Buffer))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`smoke client timed out after ${timeoutMs}ms: ${template.command}`))
    }, timeoutMs)
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
    child.stdin.end(`${template.stdinPrefix}${sql}\n`)
  })
}

/** Run one SQL text through the query or introspect template of a type. */
async function runFor(
  connection: DatabaseConnection,
  sql: string,
  introspect = true,
): Promise<RunOutcome> {
  const template = introspect
    ? buildIntrospectTemplate(connection.type, connection)
    : buildClientTemplate(connection.type, connection)
  return runTemplate(template, sql)
}

const clickhouse: DatabaseConnection = {
  type: 'clickhouse',
  host: HOST,
  port: 9000,
  user: 'default',
  database: 'dsh_smoke',
  password: CH_PASSWORD,
}

const doris: DatabaseConnection = {
  type: 'doris',
  host: HOST,
  port: 9030,
  user: 'root',
  database: 'dsh_smoke',
}

const sqlserver: DatabaseConnection = {
  type: 'sqlserver',
  host: HOST,
  port: 1433,
  user: 'sa',
  database: 'dsh_smoke',
  password: MSSQL_PASSWORD,
}

const targets: Array<{ name: string; connection: DatabaseConnection; browseSchema: string }> = [
  { name: 'clickhouse', connection: clickhouse, browseSchema: 'dsh_smoke' },
  { name: 'doris', connection: doris, browseSchema: 'dsh_smoke' },
  { name: 'sqlserver', connection: sqlserver, browseSchema: 'dbo' },
]

/** Fail loud when one setup SQL run does not exit 0. */
async function requireSuccess(connection: DatabaseConnection, sql: string): Promise<void> {
  const result = await runFor(connection, sql)
  if (result.exitCode !== 0) {
    throw new Error(
      `setup failed for ${connection.type}: exit ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    )
  }
}

describe.skipIf(HOST === undefined || CH_PASSWORD === undefined || MSSQL_PASSWORD === undefined)(
  'integration smoke — clickhouse / doris / sqlserver',
  () => {
    beforeAll(async () => {
      // ClickHouse: fresh database + table + one row.
      await requireSuccess(
        { ...clickhouse, database: 'default' },
        'DROP DATABASE IF EXISTS dsh_smoke;\n'
        + 'CREATE DATABASE dsh_smoke;\n'
        + 'CREATE TABLE dsh_smoke.orders (id UInt64, name String, amount Decimal(10,2)) ENGINE = MergeTree ORDER BY id;\n'
        + 'INSERT INTO dsh_smoke.orders VALUES (1, \'smoke\', 9.9);\n',
      )
      // Doris: fresh database + table + one row (connect to an existing db first).
      await requireSuccess(
        { ...doris, database: 'information_schema' },
        'DROP DATABASE IF EXISTS dsh_smoke;\n'
        + 'CREATE DATABASE dsh_smoke;\n'
        + 'USE dsh_smoke;\n'
        + 'CREATE TABLE orders (id INT, name VARCHAR(32), amount DECIMAL(10,2)) '
        + 'ENGINE=OLAP DUPLICATE KEY(id) DISTRIBUTED BY HASH(id) BUCKETS 1 '
        + "PROPERTIES('replication_num'='1');\n"
        + 'INSERT INTO orders VALUES (1, \'smoke\', 9.9);\n',
      )
      // SQL Server: fresh database + table + one row (GO batches via stdin).
      await requireSuccess(
        { ...sqlserver, database: 'master' },
        'DROP DATABASE IF EXISTS dsh_smoke;\nGO\n'
        + 'CREATE DATABASE dsh_smoke;\nGO\n'
        + 'USE dsh_smoke;\nGO\n'
        + 'CREATE TABLE dbo.orders (id INT NOT NULL, name NVARCHAR(32) NULL, amount DECIMAL(10,2) NULL);\nGO\n'
        + "INSERT INTO dbo.orders VALUES (1, N'smoke', 9.9);\nGO\n",
      )
    }, 180_000)

    afterAll(async () => {
      const cleanup: Array<Promise<RunOutcome>> = []
      cleanup.push(runFor({ ...clickhouse, database: 'default' }, 'DROP DATABASE IF EXISTS dsh_smoke;\n'))
      cleanup.push(runFor({ ...doris, database: 'information_schema' }, 'DROP DATABASE IF EXISTS dsh_smoke;\n'))
      cleanup.push(runFor(
        { ...sqlserver, database: 'master' },
        'USE master;\nGO\nDROP DATABASE IF EXISTS dsh_smoke;\nGO\n',
      ))
      await Promise.allSettled(cleanup)
    }, 120_000)

    for (const { name, connection, browseSchema } of targets) {
      describe(name, () => {
        it('passes the /connect table-listing check', async () => {
          const result = await runFor(connection, tableListingSql(connection.type, connection))
          expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0)
          const tables = parseTableListing(connection.type, result.stdout)
          expect(tables).toContain('orders')
        }, 60_000)

        it('lists schemas/databases through the metadata query', async () => {
          const result = await runFor(connection, metadataQuery('schemas', connection.type))
          expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0)
          const schemas = parseListing(connection.type, result.stdout)
          expect(schemas).toContain(browseSchema)
        }, 60_000)

        it('lists tables and describes the smoke table', async () => {
          const tablesResult = await runFor(
            connection,
            metadataQuery('tables', connection.type, browseSchema),
          )
          expect(tablesResult.exitCode, `stderr: ${tablesResult.stderr}`).toBe(0)
          const tables = parseListing(connection.type, tablesResult.stdout)
          expect(tables).toContain('orders')

          const describeResult = await runFor(
            connection,
            metadataQuery('describe', connection.type, browseSchema, 'orders'),
          )
          expect(describeResult.exitCode, `stderr: ${describeResult.stderr}`).toBe(0)
          const columns = parseColumns(connection.type, describeResult.stdout)
          expect(columns.map(column => column.name)).toContain('id')
          expect(columns.find(column => column.name === 'amount')?.type).toBeTruthy()
        }, 60_000)

        it('runs a query through the non-introspect template', async () => {
          const result = await runFor(connection, 'SELECT COUNT(*) FROM orders;\n', false)
          expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0)
          expect(result.stdout).toContain('1')
        }, 60_000)

        it('classifies reads/writes for the readonly guard', () => {
          expect(classifyStatement('SELECT * FROM orders', connection.type)).toBe('read')
          expect(classifyStatement('INSERT INTO orders VALUES (2)', connection.type)).toBe('write')
        })
      })
    }
  },
)
