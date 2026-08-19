import { describe, expect, it } from 'vitest'
import { createConnectionStore, normalizeConnectionInput, summarize } from '../src/connections.ts'

const mysqlConnection = {
  type: 'mysql' as const,
  host: 'db.internal',
  port: 3306,
  user: 'app',
  database: 'orders',
  password: 'hunter2',
  tables: ['customers', 'orders'],
}

describe('connection store', () => {
  it('stores and reads back a connection per session', () => {
    const store = createConnectionStore()
    store.set('session-a', mysqlConnection)
    expect(store.has('session-a')).toBe(true)
    expect(store.get('session-a')).toEqual({
      type: 'mysql',
      host: 'db.internal',
      port: 3306,
      user: 'app',
      database: 'orders',
      tables: ['customers', 'orders'],
    })
  })

  it('never exposes the password through get()', () => {
    const store = createConnectionStore()
    store.set('session-a', mysqlConnection)
    const read = store.get('session-a')
    expect(read).toBeDefined()
    expect('password' in read!).toBe(false)
    // The returned object is a fresh copy: mutating it cannot touch the store.
    read!.tables!.push('hacked')
    expect(store.get('session-a')!.tables).toEqual(['customers', 'orders'])
  })

  it('keeps sessions isolated from one another', () => {
    const store = createConnectionStore()
    store.set('session-a', mysqlConnection)
    expect(store.has('session-b')).toBe(false)
    expect(store.get('session-b')).toBeUndefined()
  })

  it('clears one session without touching others', () => {
    const store = createConnectionStore()
    store.set('session-a', mysqlConnection)
    store.set('session-b', { type: 'sqlite', database: '/tmp/other.db' })
    store.clear('session-a')
    expect(store.has('session-a')).toBe(false)
    expect(store.get('session-a')).toBeUndefined()
    expect(store.get('session-b')).toEqual({ type: 'sqlite', database: '/tmp/other.db' })
  })

  it('supports the sqlite shape (file path, no host/port/user)', () => {
    const store = createConnectionStore()
    store.set('session-sqlite', { type: 'sqlite', database: '/tmp/orders.db' })
    expect(store.get('session-sqlite')).toEqual({ type: 'sqlite', database: '/tmp/orders.db' })
  })

  it('getWithSecret returns the internal record including the password', () => {
    const store = createConnectionStore()
    store.set('session-a', mysqlConnection)
    expect(store.getWithSecret('session-a')).toEqual(mysqlConnection)
  })

  it('replaces a connection on a second set', () => {
    const store = createConnectionStore()
    store.set('session-a', mysqlConnection)
    store.set('session-a', { type: 'sqlite', database: '/tmp/other.db' })
    expect(store.get('session-a')).toEqual({ type: 'sqlite', database: '/tmp/other.db' })
  })

  it('falls back to the wildcard connection for sessions without their own', () => {
    const store = createConnectionStore()
    store.set('*', { type: 'sqlite', database: '/tmp/default.db' })
    expect(store.has('any-session')).toBe(true)
    expect(store.get('any-session')).toEqual({ type: 'sqlite', database: '/tmp/default.db' })
  })

  it('prefers an exact connection over the wildcard', () => {
    const store = createConnectionStore()
    store.set('*', { type: 'sqlite', database: '/tmp/default.db' })
    store.set('session-a', mysqlConnection)
    expect(store.get('session-a')).toEqual({
      type: 'mysql',
      host: 'db.internal',
      port: 3306,
      user: 'app',
      database: 'orders',
      tables: ['customers', 'orders'],
    })
  })

  it('clear drops only the exact entry, restoring the wildcard fallback', () => {
    const store = createConnectionStore()
    store.set('*', { type: 'sqlite', database: '/tmp/default.db' })
    store.set('session-a', mysqlConnection)
    store.clear('session-a')
    expect(store.get('session-a')).toEqual({ type: 'sqlite', database: '/tmp/default.db' })
  })
})

describe('summarize', () => {
  it('strips the password and copies the tables array', () => {
    const summary = summarize(mysqlConnection)
    expect(summary).toEqual({
      type: 'mysql',
      host: 'db.internal',
      port: 3306,
      user: 'app',
      database: 'orders',
      tables: ['customers', 'orders'],
    })
    summary.tables!.push('mutated')
    expect(mysqlConnection.tables).toEqual(['customers', 'orders'])
  })

  it('carries readonly only when the connection explicitly set it', () => {
    expect(summarize(mysqlConnection).readonly).toBeUndefined()
    expect(summarize({ ...mysqlConnection, readonly: true }).readonly).toBe(true)
  })

  it('keeps ClickHouse transport visible but never exposes its password', () => {
    expect(summarize({
      type: 'clickhouse', host: 'ch', port: 8443, user: 'default', database: 'analytics', secure: true,
      password: 'click-secret',
    })).toEqual({
      type: 'clickhouse', host: 'ch', port: 8443, user: 'default', database: 'analytics', secure: true,
    })
  })
})

describe('normalizeConnectionInput defaults', () => {
  it('uses shared defaults for the three new network types', () => {
    expect(normalizeConnectionInput({ type: 'clickhouse', database: 'default' })).toMatchObject({
      type: 'clickhouse', host: '127.0.0.1', port: 8123, user: 'default', database: 'default',
    })
    expect(normalizeConnectionInput({ type: 'clickhouse', database: 'default', secure: true })).toMatchObject({
      port: 8443, secure: true,
    })
    expect(normalizeConnectionInput({ type: 'doris', database: 'analytics' })).toMatchObject({
      host: '127.0.0.1', port: 9030, user: 'root',
    })
    expect(normalizeConnectionInput({ type: 'sqlserver', database: 'warehouse' })).toMatchObject({
      host: '127.0.0.1', port: 1433, user: 'sa',
    })
  })
})
