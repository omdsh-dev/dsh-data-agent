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
  it('saves and loads a full connection (password included)', () => {
    const storage = memoryStorage()
    saveConnection(fullConnection, storage)
    expect(loadConnection(storage)).toEqual(fullConnection)
    expect(storage.map.get(CONNECTION_STORAGE_KEY)).toContain('"password":"dsh_demo_pw"')
  })

  it('round-trips a sqlite-shaped connection (no host/port/user)', () => {
    const storage = memoryStorage()
    const sqlite = { type: 'sqlite' as const, database: '/tmp/orders.db', savedAt: 'x' }
    saveConnection(sqlite, storage)
    expect(loadConnection(storage)).toEqual(sqlite)
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
