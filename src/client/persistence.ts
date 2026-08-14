/**
 * Connection-config persistence for the database workbench. The most recent
 * successful connection (type/host/port/user/database/password) is kept in
 * localStorage under one key so remounts and restarts can restore the form
 * and auto-reconnect (the server-side connection store stays in-memory).
 *
 * Security note: the password is persisted in PLAIN TEXT by explicit user
 * decision (local single-user scenario) — see README 安全说明. The storage
 * key is versioned so a future shape change can migrate or ignore old data.
 * @module @yejiming/dsh-data-agent/persistence
 */

import type { DatabaseType } from './DataAgentWorkbench.tsx'

/** localStorage key holding the most recent connection configuration. */
export const CONNECTION_STORAGE_KEY = 'dsh-data-agent.connection.v1'

/** The persisted connection configuration. */
export interface SavedConnection {
  type: DatabaseType
  host?: string
  port?: number
  user?: string
  database: string
  /** Present only when the user explicitly opted in to persist the password. */
  password?: string
  /** Opt-in flag; when true, {@link saveConnection} may write `password`. */
  persistPassword?: boolean
  /** Diagnostic timestamp of the save. */
  savedAt: string
}

/** Runtime storage face (injectable for tests). */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** The default storage face (localStorage; unavailable → degraded no-op). */
function defaultStorage(): StorageLike | undefined {
  try {
    if (typeof localStorage !== 'undefined') {
      const probe = '__dsh_probe__'
      localStorage.setItem(probe, '1')
      localStorage.removeItem(probe)
      return localStorage
    }
  } catch {
    // localStorage disabled (privacy mode, sandboxed frame): degrade silently.
  }
  return undefined
}

/** Validate one parsed storage value into a SavedConnection (or null). */
function parseSaved(value: unknown): SavedConnection | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const type = candidate.type
  if (type !== 'mysql' && type !== 'postgres' && type !== 'sqlite'
    && type !== 'oracle' && type !== 'hive' && type !== 'impala') {
    return null
  }
  const database = candidate.database
  // 草稿语义：database 允许为空串（用户可能只填了部分字段就切换会话）。
  if (typeof database !== 'string') return null
  const saved: SavedConnection = { type, database, savedAt: typeof candidate.savedAt === 'string' ? candidate.savedAt : '' }
  if (typeof candidate.host === 'string') saved.host = candidate.host
  if (typeof candidate.port === 'number' && Number.isInteger(candidate.port)) saved.port = candidate.port
  if (typeof candidate.user === 'string') saved.user = candidate.user
  // Legacy records may carry a password; strip it unless the opt-in flag is set
  // (a persisted password only survives when persistPassword was explicitly true).
  const persistPassword = candidate.persistPassword === true
  if (persistPassword) saved.persistPassword = true
  if (persistPassword && typeof candidate.password === 'string') saved.password = candidate.password
  return saved
}

/** Save one connection configuration (best-effort; storage failures degrade silently). */
export function saveConnection(connection: SavedConnection, storage: StorageLike | undefined = defaultStorage()): void {
  if (storage === undefined) return
  try {
    const toWrite: SavedConnection = { ...connection }
    // Password is opt-in only; strip it unless persistPassword is explicitly set.
    if (toWrite.persistPassword !== true) delete toWrite.password
    storage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(toWrite))
  } catch {
    // Quota / serialization failure: degrade silently, the UI stays usable.
  }
}

/** Load the saved connection configuration; null when absent or malformed. */
export function loadConnection(storage: StorageLike | undefined = defaultStorage()): SavedConnection | null {
  if (storage === undefined) return null
  try {
    const raw = storage.getItem(CONNECTION_STORAGE_KEY)
    if (raw === null) return null
    return parseSaved(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Remove the saved connection configuration. */
export function clearConnection(storage: StorageLike | undefined = defaultStorage()): void {
  if (storage === undefined) return
  try {
    storage.removeItem(CONNECTION_STORAGE_KEY)
  } catch {
    // Degrade silently.
  }
}
