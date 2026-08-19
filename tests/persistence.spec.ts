import { describe, expect, it } from 'vitest'
import {
  CONNECTION_STORAGE_KEY,
  clearConnection,
  loadConnection,
  saveConnection,
  type StorageLike,
} from '../src/client/persistence.ts'

/** In-memory StorageLike double. */
function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem(key) { return map.get(key) ?? null },
    setItem(key, value) { map.set(key, value) },
    removeItem(key) { map.delete(key) },
  }
}

const fullConnection = {
  type: 'mysql' as const,
  host: '127.0.0.1',
  port: 3306,
  user: 'dsh_demo',
  database: 'dsh_data_agent_demo',
  password: 'dsh_demo_pw',
  savedAt: '2026-08-12T00:00:00.000Z',
}

describe('persistence', () => {
  it('does not persist the password by default (opt-in)', () => {
    const storage = memoryStorage()
    saveConnection(fullConnection, storage)
    expect(storage.map.get(CONNECTION_STORAGE_KEY)).not.toContain('"password"')
    const loaded = loadConnection(storage)!
    expect(loaded.password).toBeUndefined()
    expect(loaded.host).toBe('127.0.0.1')
    expect(loaded.user).toBe('dsh_demo')
    expect(loaded.database).toBe('dsh_data_agent_demo')
  })

  it('persists the password only when persistPassword is true', () => {
    const storage = memoryStorage()
    saveConnection({ ...fullConnection, persistPassword: true }, storage)
    expect(storage.map.get(CONNECTION_STORAGE_KEY)).toContain('"password":"dsh_demo_pw"')
    expect(loadConnection(storage)!.password).toBe('dsh_demo_pw')
  })

  it('strips the password from legacy records on load', () => {
    const storage = memoryStorage()
    storage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(fullConnection))
    const loaded = loadConnection(storage)!
    expect(loaded.password).toBeUndefined()
    expect(loaded.persistPassword).toBeUndefined()
  })

  it('keeps the password on load only when persistPassword is true', () => {
    const storage = memoryStorage()
    storage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify({ ...fullConnection, persistPassword: true }))
    const loaded = loadConnection(storage)!
    expect(loaded.password).toBe('dsh_demo_pw')
    expect(loaded.persistPassword).toBe(true)
  })

  it('persists a credential reference without any plaintext password', () => {
    const storage = memoryStorage()
    saveConnection({
      ...fullConnection,
      credentialMode: 'reference',
      passwordRef: 'ORDERS_DB_PASSWORD',
      persistPassword: true,
    }, storage)
    const raw = storage.map.get(CONNECTION_STORAGE_KEY)!
    expect(raw).toContain('ORDERS_DB_PASSWORD')
    expect(raw).not.toContain('dsh_demo_pw')
    expect(loadConnection(storage)).toMatchObject({
      credentialMode: 'reference',
      passwordRef: 'ORDERS_DB_PASSWORD',
    })
  })

  it('round-trips an explicit passwordless mode without any secret fields', () => {
    const storage = memoryStorage()
    saveConnection({
      ...fullConnection,
      credentialMode: 'none',
      persistPassword: true,
    }, storage)
    const raw = storage.map.get(CONNECTION_STORAGE_KEY)!
    expect(raw).toContain('"credentialMode":"none"')
    expect(raw).not.toContain('"password"')
    expect(raw).not.toContain('persistPassword')
    expect(loadConnection(storage)?.credentialMode).toBe('none')
  })

  it('round-trips readonly and infers reference mode from a v1-shaped record', () => {
    const storage = memoryStorage()
    storage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify({
      type: 'postgres', database: 'analytics', passwordRef: 'DB_PASSWORD', readonly: true, savedAt: 'x',
    }))
    expect(loadConnection(storage)).toEqual({
      type: 'postgres', database: 'analytics', passwordRef: 'DB_PASSWORD',
      credentialMode: 'reference', readonly: true, savedAt: 'x',
    })
  })

  it('round-trips a sqlite-shaped connection (no host/port/user)', () => {
    const storage = memoryStorage()
    const sqlite = { type: 'sqlite' as const, database: '/tmp/orders.db', savedAt: 'x' }
    saveConnection(sqlite, storage)
    expect(loadConnection(storage)).toEqual(sqlite)
  })

  it('round-trips all new type identities and ClickHouse transport without secrets', () => {
    for (const connection of [
      { type: 'clickhouse' as const, host: 'ch', port: 8443, user: 'default', database: 'analytics', secure: true, passwordRef: 'CH_PASSWORD', savedAt: 'x' },
      { type: 'doris' as const, host: 'doris', port: 9030, user: 'root', database: 'analytics', passwordRef: 'DORIS_PASSWORD', savedAt: 'x' },
      { type: 'sqlserver' as const, host: 'sql', port: 1433, user: 'sa', database: 'warehouse', passwordRef: 'SQL_PASSWORD', savedAt: 'x' },
    ]) {
      const storage = memoryStorage()
      saveConnection(connection, storage)
      expect(loadConnection(storage)).toMatchObject(connection)
      expect(storage.map.get(CONNECTION_STORAGE_KEY)).not.toContain('resolved-secret')
    }
  })

  it('ignores secure on non-ClickHouse records and still rejects unknown types', () => {
    const storage = memoryStorage()
    storage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify({
      type: 'doris', database: 'analytics', secure: true, savedAt: 'x',
    }))
    expect(loadConnection(storage)).toEqual({ type: 'doris', database: 'analytics', savedAt: 'x' })
    storage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify({ type: 'future-db', database: 'x', savedAt: 'x' }))
    expect(loadConnection(storage)).toBeNull()
  })

  it('returns null for absent data', () => {
    expect(loadConnection(memoryStorage())).toBeNull()
  })

  it('round-trips a partial draft (empty database, user typed only)', () => {
    const storage = memoryStorage()
    const draft = { type: 'mysql' as const, host: '127.0.0.1', port: 3306, user: 'abc', database: '', savedAt: 'x' }
    saveConnection(draft, storage)
    expect(loadConnection(storage)).toEqual(draft)
  })

  it('tolerates corrupted JSON', () => {
    const storage = memoryStorage()
    storage.setItem(CONNECTION_STORAGE_KEY, '{not json!!')
    expect(loadConnection(storage)).toBeNull()
  })

  it('rejects malformed shapes (bad type / missing database)', () => {
    const storage = memoryStorage()
    storage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify({ type: 'oracle', savedAt: 'x' }))
    expect(loadConnection(storage)).toBeNull()
    storage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify({ type: 'postgres', database: 'd', savedAt: 'x', port: '3306' }))
    expect(loadConnection(storage)).toEqual({ type: 'postgres', database: 'd', savedAt: 'x' })
  })

  it('clears the saved connection', () => {
    const storage = memoryStorage()
    saveConnection(fullConnection, storage)
    clearConnection(storage)
    expect(loadConnection(storage)).toBeNull()
  })

  it('degrades silently when storage throws', () => {
    const broken: StorageLike = {
      getItem() { throw new Error('denied') },
      setItem() { throw new Error('denied') },
      removeItem() { throw new Error('denied') },
    }
    expect(() => saveConnection(fullConnection, broken)).not.toThrow()
    expect(loadConnection(broken)).toBeNull()
    expect(() => clearConnection(broken)).not.toThrow()
  })
})
