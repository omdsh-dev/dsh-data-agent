import { describe, expect, it } from 'vitest'
import { validateConnectBody } from '../src/routes.ts'

describe('validateConnectBody — clickhouse/doris/sqlserver', () => {
  it('accepts the three new database types', () => {
    expect(validateConnectBody({ sessionId: 's1', type: 'clickhouse', database: 'analytics' }))
      .toMatchObject({ type: 'clickhouse', database: 'analytics' })
    expect(validateConnectBody({ sessionId: 's1', type: 'doris', host: 'fe01', port: 9030, database: 'dwd' }))
      .toMatchObject({ type: 'doris', port: 9030 })
    expect(validateConnectBody({ sessionId: 's1', type: 'sqlserver', user: 'sa', password: 'pw', database: 'sales' }))
      .toMatchObject({ type: 'sqlserver', password: 'pw' })
  })

  it('keeps rejecting unknown types', () => {
    expect(() => validateConnectBody({ sessionId: 's1', type: 'flinksql', database: 'x' }))
      .toThrow(/type/)
  })

  it('still requires a non-empty database for the new types', () => {
    expect(() => validateConnectBody({ sessionId: 's1', type: 'clickhouse', database: '' }))
      .toThrow(/database/)
  })

  it('resolves sqlite file paths to absolute while leaving the new types intact', () => {
    const sqlite = validateConnectBody({ sessionId: 's1', type: 'sqlite', database: 'orders.db' }, '/work')
    expect(sqlite.database.startsWith('/work/')).toBe(true)
    const sqlserver = validateConnectBody({ sessionId: 's1', type: 'sqlserver', database: 'sales' })
    expect(sqlserver.database).toBe('sales')
  })
})
