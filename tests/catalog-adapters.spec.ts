import { describe, expect, it } from 'vitest'
import {
  buildCatalogMetadataSql,
  createCatalogAdapterRegistry,
  parseCatalogMetadataRows,
} from '../src/catalog-adapters.ts'
import { SQLSERVER_COLUMN_SEPARATOR } from '../src/clients.ts'
import { assertSingleStatement } from '../src/sql.ts'

describe('Catalog dialect adapters', () => {
  it('registers all nine supported databases with explicit capability facts', () => {
    const registry = createCatalogAdapterRegistry()
    expect(Object.keys(registry).sort()).toEqual([
      'clickhouse', 'doris', 'hive', 'impala', 'mysql', 'oracle', 'postgres', 'sqlite', 'sqlserver',
    ])
    expect(registry.hive.capabilities.foreignKeys).toBe('unsupported')
    expect(registry.sqlite.capabilities.comments).toBe('unsupported')
    expect(registry.mysql.capabilities.foreignKeys).toBe('supported')
    expect(registry.postgres.capabilities.indexes).toBe('supported')
    expect(registry.clickhouse.capabilities.foreignKeys).toBe('unsupported')
  })

  it.each(['mysql', 'doris', 'postgres', 'sqlite', 'oracle', 'clickhouse', 'sqlserver'] as const)(
    'constructs bounded, system-catalog-only %s SQL',
    (type) => {
      const sql = buildCatalogMetadataSql(type, 'warehouse', 'sales', 'orders')
      expect(sql).toMatch(/information_schema|pg_catalog|sys\.|sqlite_master|all_objects|system\.tables/i)
      expect(sql).not.toMatch(/COUNT\s*\(\s*\*\s*\)/i)
      expect(sql).not.toMatch(/SELECT\s+\*\s+FROM\s+["`\[]?orders/i)
      expect(sql).not.toMatch(/\.shell|!!|^\s*GO\s*$/im)
      expect(sql).not.toMatch(/UNION ALL\s+UNION ALL/i)
      expect(sql).toContain('orders')
    },
  )

  it('escapes table filters as literals and never produces a second statement', () => {
    const sql = buildCatalogMetadataSql('postgres', 'db', 'sales', "orders'; DROP TABLE users; --")
    expect(sql).toContain("orders''; DROP TABLE users; --")
    expect(sql.trim().endsWith(';')).toBe(true)
    expect(() => assertSingleStatement(sql, 'Catalog metadata query')).not.toThrow()
  })

  it('parses each deterministic client delimiter without retaining headers', () => {
    const mysql = [
      'row_kind\tTABLE_SCHEMA\tTABLE_NAME\tTABLE_TYPE\tcomment\tcolumn\ttype\tnullable\tcolumn_comment\tordinal',
      'relation\tsales\torders\tBASE TABLE\tOrders\t\t\t\t\t0',
      'column\tsales\torders\t\t\tid\tbigint\tNO\tIdentifier\t1',
    ].join('\n')
    expect(parseCatalogMetadataRows('mysql', mysql)).toHaveLength(2)
    const sqlserver = `column${SQLSERVER_COLUMN_SEPARATOR}dbo${SQLSERVER_COLUMN_SEPARATOR}orders${SQLSERVER_COLUMN_SEPARATOR}${SQLSERVER_COLUMN_SEPARATOR}${SQLSERVER_COLUMN_SEPARATOR}id${SQLSERVER_COLUMN_SEPARATOR}bigint${SQLSERVER_COLUMN_SEPARATOR}NO${SQLSERVER_COLUMN_SEPARATOR}${SQLSERVER_COLUMN_SEPARATOR}1\n`
    expect(parseCatalogMetadataRows('sqlserver', sqlserver)[0]).toMatchObject({ column: 'id', nullable: 'NO' })
    expect(parseCatalogMetadataRows('postgres', 'relation|public|orders|BASE TABLE||||||0\n')[0]?.relation).toBe('orders')
  })

  it('normalizes primary keys, foreign keys, and indexes into navigable relations', async () => {
    const output = [
      'row_kind\tTABLE_SCHEMA\tTABLE_NAME\tdetail\tref_schema\tcolumn\tref_table\tref_column\tattribute\tordinal',
      'relation\tsales\torders\tBASE TABLE\tOrders\t\t\t\t\t0',
      'column\tsales\torders\t\t\tid\tbigint\tNO\tIdentifier\t1',
      'column\tsales\torders\t\t\tcustomer_id\tbigint\tNO\tCustomer\t2',
      'primary_key\tsales\torders\tPRIMARY\t\tid\t\t\t\t1',
      'foreign_key\tsales\torders\tfk_customer\tsales\tcustomer_id\tcustomers\tid\t\t1',
      'index\tsales\torders\tidx_customer\t\tcustomer_id\t\t\t\t1',
    ].join('\n')
    const connections = {
      listSchemas: async () => ['sales'],
      queryMetadata: async () => ({ stdout: output, stderr: '', exitCode: 0, truncated: false }),
    } as never
    const result = await createCatalogAdapterRegistry().mysql.scan({
      connections,
      connection: { type: 'mysql', database: 'warehouse' },
      sessionId: 'session-a', sourceId: 'profile-a', runId: 'run-a', scope: { kind: 'source' },
      signal: new AbortController().signal,
      options: { maxTextChars: 4_096, schemaConcurrency: 2, assetConcurrency: 2 },
    })
    expect(result.observations.map(value => value.payload.identity.kind)).toEqual(['schema', 'table', 'column', 'column'])
    expect(result.relations.map(value => value.kind).sort()).toEqual(['foreign_key', 'index', 'primary_key'])
    expect(result.relations.find(value => value.kind === 'foreign_key')).toMatchObject({
      name: 'fk_customer',
      columnAssetIds: [expect.stringMatching(/^asset_/)],
      referencedColumnAssetIds: [expect.stringMatching(/^asset_/)],
      toAssetId: expect.stringMatching(/^asset_/),
    })
  })

  it('keeps MySQL functional indexes without inventing a NULL column asset', async () => {
    const sql = buildCatalogMetadataSql('mysql', 'warehouse', 'sales')
    expect(sql).toContain("COALESCE(COLUMN_NAME,'')")

    const output = [
      'row_kind\tTABLE_SCHEMA\tTABLE_NAME\tdetail\tcomment\tcolumn\ttype\tnullable\tcolumn_comment\tordinal',
      'relation\tsales\tcustomer_addresses\tBASE TABLE\t\t\t\t\t\t0',
      'column\tsales\tcustomer_addresses\t\t\tid\tbigint\tNO\t\t1',
      'index\tsales\tcustomer_addresses\tuq_customer_default\t\t\t\t\tunique\t1',
    ].join('\n')
    const connections = {
      listSchemas: async () => ['sales'],
      queryMetadata: async () => ({ stdout: output, stderr: '', exitCode: 0, truncated: false }),
    } as never
    const result = await createCatalogAdapterRegistry().mysql.scan({
      connections,
      connection: { type: 'mysql', database: 'warehouse' },
      sessionId: 'session-a', sourceId: 'profile-a', runId: 'run-a', scope: { kind: 'source' },
      signal: new AbortController().signal,
      options: { maxTextChars: 4_096, schemaConcurrency: 1, assetConcurrency: 1 },
    })

    expect(result.relations).toEqual([
      expect.objectContaining({
        kind: 'index',
        name: 'uq_customer_default',
        columnAssetIds: [],
      }),
    ])
  })

  it('resolves a view column parent when deterministic row ordering puts columns first', async () => {
    const output = [
      'row_kind\tTABLE_SCHEMA\tTABLE_NAME\tdetail\tcomment\tcolumn\ttype\tnullable\tcolumn_comment\tordinal',
      'column\tsales\torder_summary\t\t\torder_id\tbigint\tNO\tIdentifier\t1',
      'relation\tsales\torder_summary\tVIEW\tOrder summary\t\t\t\t\t0',
    ].join('\n')
    const connections = {
      listSchemas: async () => ['sales'],
      queryMetadata: async () => ({ stdout: output, stderr: '', exitCode: 0, truncated: false }),
    } as never
    const result = await createCatalogAdapterRegistry().mysql.scan({
      connections,
      connection: { type: 'mysql', database: 'warehouse' },
      sessionId: 'session-a', sourceId: 'profile-a', runId: 'run-a', scope: { kind: 'source' },
      signal: new AbortController().signal,
      options: { maxTextChars: 4_096, schemaConcurrency: 1, assetConcurrency: 1 },
    })
    const view = result.observations.find(value => value.payload.identity.kind === 'view')
    const column = result.observations.find(value => value.payload.identity.kind === 'column')
    expect(view).toBeDefined()
    expect(column?.payload.parentId).toBe(view?.assetId)
  })

  it('bounds concurrent Hive relation descriptions', async () => {
    let active = 0
    let maximum = 0
    const connections = {
      listSchemas: async () => ['warehouse'],
      listTables: async () => ['a', 'b', 'c', 'd', 'e'],
      async describe() {
        active += 1
        maximum = Math.max(maximum, active)
        await new Promise(resolve => setTimeout(resolve, 2))
        active -= 1
        return [{ name: 'id', type: 'bigint', nullable: false }]
      },
    } as never
    const result = await createCatalogAdapterRegistry().hive.scan({
      connections,
      connection: { type: 'hive', database: 'warehouse' },
      sessionId: 'session-a', sourceId: 'profile-a', runId: 'run-a', scope: { kind: 'source' },
      signal: new AbortController().signal,
      options: { maxTextChars: 4_096, schemaConcurrency: 1, assetConcurrency: 2 },
    })
    expect(maximum).toBe(2)
    expect(result.observations.filter(value => value.payload.identity.kind === 'column')).toHaveLength(5)
  })

  it('turns a Hive table-level permission denial into unavailable coverage instead of failing the run', async () => {
    const connections = {
      listSchemas: async () => ['warehouse'],
      listTables: async () => ['visible', 'restricted'],
      async describe(_sessionId: string, _schema: string, table: string) {
        if (table === 'restricted') throw new Error('Permission denied')
        return [{ name: 'id', type: 'bigint', nullable: false }]
      },
    } as never
    const result = await createCatalogAdapterRegistry().hive.scan({
      connections,
      connection: { type: 'hive', database: 'warehouse' },
      sessionId: 'session-a', sourceId: 'profile-a', runId: 'run-a', scope: { kind: 'source' },
      signal: new AbortController().signal,
      options: { maxTextChars: 4_096, schemaConcurrency: 1, assetConcurrency: 2 },
    })
    expect(result.coverageComplete).toBe(false)
    expect(result.unavailableScopes).toEqual(['warehouse.restricted'])
    expect(result.observations.find(value => value.payload.name === 'restricted')).toMatchObject({ status: 'unavailable' })
  })

  it('uses only the SQLite file name in durable asset identity and display paths', async () => {
    const connections = {
      listSchemas: async () => ['main'],
      queryMetadata: async () => ({
        stdout: 'relation|main|orders|BASE TABLE||||||0\n', stderr: '', exitCode: 0, truncated: false,
      }),
    } as never
    const result = await createCatalogAdapterRegistry().sqlite.scan({
      connections,
      connection: { type: 'sqlite', database: '/private/company/analytics.db' },
      sessionId: 'session-a', sourceId: 'profile-a', runId: 'run-a', scope: { kind: 'source' },
      signal: new AbortController().signal,
      options: { maxTextChars: 4_096, schemaConcurrency: 1, assetConcurrency: 2 },
    })
    expect(result.observations.map(value => value.payload.identity.database)).toEqual(['analytics.db', 'analytics.db'])
    expect(result.observations.map(value => value.payload.path).join('\n')).not.toContain('/private/company')
  })
})
