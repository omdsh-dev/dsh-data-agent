/**
 * Surface-independent database connection service shared by Web routes,
 * agent tools, and human commands.
 *
 * Runtime records may contain one temporary Web password. Durable records
 * never do: they contain a non-secret profile plus an optional credential
 * reference that is resolved again at the start of every database operation.
 * @module @yejiming/dsh-data-agent/connections
 */

import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  classifyStatement,
  enforceReadRowLimit,
  metadataQuery,
  parseColumns,
  parseListing,
  parseTableListing,
  sanitizeIdentifier,
  tableListingSql,
  type ClientConfig,
  type ColumnInfo,
} from './clients.ts'
import {
  defaultDatabasePort,
  defaultDatabaseUser,
  isDatabaseType,
  type DatabaseType,
} from './database-types.ts'
import {
  DEFAULT_MAX_QUERY_CHARS,
  WORKBENCH_MAX_EXPORT_ROWS,
  WORKBENCH_MAX_RESULT_CHARS,
} from './defaults.ts'
import { runClientQuery, type QueryOptions, type QueryResult } from './query.ts'
import { assertSingleStatement } from './sql.ts'
import { parseStructuredQueryOutput } from './structured.ts'

export type { DatabaseType } from './database-types.ts'

/** Key of the wildcard connection applied to sessions without an exact entry. */
export const WILDCARD_SESSION = '*'

const MYSQL_SCHEMA_PROBE_CONCURRENCY = 4
const MYSQL_DATABASE_ACCESS_DENIED = /\bERROR\s+1044\s+\(42000\)/i

/** How a non-SQLite profile authenticates without ever persisting a secret. */
export type CredentialMode = 'none' | 'password' | 'reference'

/** Safe credential facts returned to UI/command surfaces. */
export interface CredentialSummary {
  configured: boolean
  source?: string
}

/** One connect request accepted by every surface. */
export interface DatabaseConnectionInput {
  type: DatabaseType
  host?: string
  port?: number
  user?: string
  database: string
  /** Temporary Web-only secret, retained in this process only. */
  password?: string
  /** Non-secret DSH credential reference, mutually exclusive with password. */
  passwordRef?: string
  readonly?: boolean
  /** ClickHouse HTTP transport uses HTTPS with normal certificate verification. */
  secure?: boolean
  /** Optional stable durable profile id. */
  profileId?: string
  /** Optional human-readable profile label. */
  name?: string
}

/** Runtime connection. `tables` and temporary `password` are never durable. */
export interface DatabaseConnection extends DatabaseConnectionInput {
  /** Internal authentication shape retained in the non-secret durable profile. */
  credentialMode?: CredentialMode
  tables?: string[]
}

/** Password-free public connection view. */
export interface ConnectionSummary {
  type: DatabaseType
  host?: string
  port?: number
  user?: string
  database: string
  passwordRef?: string
  readonly?: boolean
  secure?: boolean
  profileId?: string
  name?: string
  tables?: string[]
  credential?: CredentialSummary
  credentialMode?: CredentialMode
  /** True only when the current process can execute a database operation now. */
  ready?: boolean
  /** A saved profile exists, but its credential must be supplied/configured again. */
  reconnectRequired?: boolean
}

/** Value stored in the `profiles` domain table. Never add secrets here. */
export interface PersistedConnectionProfile {
  name?: string
  type: DatabaseType
  host?: string
  port?: number
  user?: string
  database: string
  readonly?: boolean
  secure?: boolean
  passwordRef?: string
  credentialMode?: CredentialMode
  updatedAt: string
}

/** Value stored in the `bindings` domain table. */
export interface SessionConnectionBinding {
  profileId: string
  updatedAt: string
}

/** Non-secret values restored when a session reopens an interactive form. */
export interface ConnectionFormDraft {
  type: DatabaseType
  host: string
  port: string
  user: string
  database: string
  readonly: boolean
  secure?: boolean
}

/** Form initial values may also restore one non-secret credential reference. */
export interface ConnectionFormInitial extends ConnectionFormDraft {
  passwordRef?: string
}

/** Durable draft record. Passwords and credential references are forbidden. */
export interface PersistedConnectionFormDraft extends ConnectionFormDraft {
  updatedAt: string
}

/** Deterministic latest-profile lookup result supplied by durable adapters. */
export interface PersistedConnectionProfileEntry {
  profileId: string
  profile: PersistedConnectionProfile
}

/** Minimal durable seam; backed by a DSH storage domain in production. */
export interface ConnectionPersistence {
  getProfile(profileId: string): PersistedConnectionProfile | undefined
  getLatestProfile?(): PersistedConnectionProfileEntry | undefined
  /** Deterministic profile enumeration used only for exact, non-secret identity reuse. */
  listProfiles?(): PersistedConnectionProfileEntry[]
  putProfile(profileId: string, profile: PersistedConnectionProfile): Promise<void>
  deleteProfile(profileId: string): Promise<boolean>
  getBinding(sessionId: string): SessionConnectionBinding | undefined
  putBinding(sessionId: string, binding: SessionConnectionBinding): Promise<void>
  deleteBinding(sessionId: string): Promise<boolean>
  getDraft?(sessionId: string): PersistedConnectionFormDraft | undefined
  putDraft?(sessionId: string, draft: PersistedConnectionFormDraft): Promise<void>
  deleteDraft?(sessionId: string): Promise<boolean>
}

/** Shared service configuration supplied by the host plugin. */
export interface ConnectionServiceOptions {
  connectTimeoutMs: number
  queryTimeoutMs: number
  catalogQueryTimeoutMs?: number
  /** Per-stream capture budget for package-owned system-catalog queries. */
  catalogMaxResultChars?: number
  maxResultChars: number
  maxQueryChars?: number
  introspectMaxTables: number
  readonly: boolean
  clients: Partial<Record<string, ClientConfig>>
  cwd?: string
  /** Profile ids already used by durable downstream data, ordered by the owner. */
  preferredProfileIds?: () => readonly string[]
}

export interface ConnectResult {
  tables: string[]
  summary: ConnectionSummary
}

/** Structured read result or raw command message returned to interactive surfaces. */
export type InteractiveQueryResult = {
  kind: 'table'
  columns: string[]
  rows: Record<string, string | null>[]
  elapsedMs: number
  truncated: boolean
  maxRows: number
} | ({ kind: 'message' } & QueryResult)

/** Host-plane service (`ctx.dataAgentConnections`). */
export interface DataAgentConnections {
  /** Compatibility setter for config seeds/tests; does not persist. */
  set(sessionId: string, connection: DatabaseConnection): void
  /** Password-free synchronous status (runtime/binding/wildcard resolution). */
  get(sessionId: string): ConnectionSummary | undefined
  /** Compatibility internal read; credential references remain unresolved. */
  getWithSecret(sessionId: string): DatabaseConnection | undefined
  has(sessionId: string): boolean
  /** Compatibility runtime-only clear. Use disconnect() for durable bindings. */
  clear(sessionId: string): void
  /** Restore exact or latest-profile non-secret interactive form values. */
  getFormDraft(sessionId: string): ConnectionFormInitial | undefined
  /** Save non-secret form values; the implementation never accepts a password. */
  saveFormDraft(sessionId: string, draft: ConnectionFormDraft): Promise<void>
  status(sessionId: string): Promise<ConnectionSummary | undefined>
  connect(sessionId: string, input: DatabaseConnectionInput, signal: AbortSignal): Promise<ConnectResult>
  disconnect(sessionId: string): Promise<void>
  test(sessionId: string, signal: AbortSignal): Promise<ConnectResult>
  resolveForExecution(sessionId: string): Promise<DatabaseConnection>
  /** Execute one package-owned, read-only system-catalog statement. Not exposed as a model tool. */
  queryMetadata(sessionId: string, sql: string, signal: AbortSignal): Promise<QueryResult>
  listSchemas(sessionId: string, signal: AbortSignal): Promise<string[]>
  listTables(sessionId: string, schema: string | undefined, signal: AbortSignal): Promise<string[]>
  describe(sessionId: string, schema: string | undefined, table: string, signal: AbortSignal): Promise<ColumnInfo[]>
  query(sessionId: string, sql: string, signal: AbortSignal): Promise<QueryResult>
  executeInteractive(sessionId: string, sql: string, signal: AbortSignal): Promise<InteractiveQueryResult>
}

/** Build a password-stripped copy of one connection. */
export function summarize(connection: DatabaseConnection): ConnectionSummary {
  const summary: ConnectionSummary = { type: connection.type, database: connection.database }
  if (connection.host !== undefined) summary.host = connection.host
  if (connection.port !== undefined) summary.port = connection.port
  if (connection.user !== undefined) summary.user = connection.user
  if (connection.passwordRef !== undefined) summary.passwordRef = connection.passwordRef
  if (connection.readonly !== undefined) summary.readonly = connection.readonly
  if (connection.secure !== undefined) summary.secure = connection.secure
  if (connection.profileId !== undefined) summary.profileId = connection.profileId
  if (connection.name !== undefined) summary.name = connection.name
  if (connection.tables !== undefined) summary.tables = [...connection.tables]
  return summary
}

/** Replace every occurrence of a resolved secret before crossing a public seam. */
export function redactSecretText(text: string, secrets: readonly (string | undefined)[]): string {
  let redacted = text
  for (const secret of secrets) {
    if (secret !== undefined && secret.length > 0) redacted = redacted.split(secret).join('[REDACTED]')
  }
  return redacted
}

/** Redact a client result without mutating the runner-owned object. */
export function redactQueryResult(result: QueryResult, connection: DatabaseConnection): QueryResult {
  const secrets = [connection.password]
  return {
    ...result,
    stdout: redactSecretText(result.stdout, secrets),
    stderr: redactSecretText(result.stderr, secrets),
  }
}

/** Validate/normalize a shared connect input before any I/O. */
export function normalizeConnectionInput(
  input: DatabaseConnectionInput,
  cwd = process.cwd(),
): DatabaseConnection {
  if (!isDatabaseType(input.type)) throw new Error('数据库类型无效')
  if (typeof input.database !== 'string' || input.database.trim().length === 0) {
    throw new Error('database 必须是非空字符串')
  }
  if (input.password !== undefined && input.passwordRef !== undefined) {
    throw new Error('password 与 passwordRef 不能同时提供')
  }
  if (input.passwordRef !== undefined) validatePasswordRef(input.passwordRef)
  if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)) {
    throw new Error('port 必须是 1-65535 的整数')
  }
  if (input.profileId !== undefined && input.profileId.trim().length === 0) throw new Error('profileId 不能为空')
  if (input.name !== undefined && input.name.trim().length === 0) throw new Error('name 不能为空')
  if (input.secure !== undefined && typeof input.secure !== 'boolean') throw new Error('secure 必须是布尔值')

  const connection: DatabaseConnection = {
    type: input.type,
    database: input.type === 'sqlite' ? resolve(cwd, input.database) : input.database,
    credentialMode: input.type === 'sqlite'
      ? 'none'
      : input.passwordRef !== undefined
        ? 'reference'
        : input.password !== undefined && input.password.length > 0
          ? 'password'
          : 'none',
  }
  if (input.type !== 'sqlite') {
    connection.host = input.host !== undefined && input.host.length > 0 ? input.host : '127.0.0.1'
    connection.port = input.port ?? defaultDatabasePort(input.type, input.type === 'clickhouse' && input.secure === true)
    const user = input.user !== undefined && input.user.length > 0 ? input.user : defaultDatabaseUser(input.type)
    if (user !== '') connection.user = user
    if (input.password !== undefined && input.password.length > 0) connection.password = input.password
    if (input.passwordRef !== undefined) connection.passwordRef = input.passwordRef
  }
  if (input.readonly !== undefined) connection.readonly = input.readonly
  if (input.type === 'clickhouse' && input.secure !== undefined) connection.secure = input.secure
  if (input.profileId !== undefined) connection.profileId = input.profileId
  if (input.name !== undefined) connection.name = input.name
  return connection
}

/** Create the surface-independent service. */
export function createConnectionService(
  ctx?: Context,
  options?: ConnectionServiceOptions,
  persistence?: ConnectionPersistence,
): DataAgentConnections {
  // Compatibility/test defaults retain the old in-memory store factory shape.
  const resolvedOptions: ConnectionServiceOptions = options ?? {
    connectTimeoutMs: 15_000,
    queryTimeoutMs: 30_000,
    maxResultChars: 200_000,
    maxQueryChars: DEFAULT_MAX_QUERY_CHARS,
    introspectMaxTables: 500,
    readonly: false,
    clients: {},
  }
  const runtime = new Map<string, DatabaseConnection>()
  const formDrafts = new Map<string, ConnectionFormDraft>()
  let latestFormInitial: ConnectionFormInitial | undefined

  const profileConnection = (sessionId: string): DatabaseConnection | undefined => {
    if (persistence === undefined) return undefined
    const binding = persistence.getBinding(sessionId)
    if (binding === undefined) return undefined
    const profile = persistence.getProfile(binding.profileId)
    return profile === undefined ? undefined : connectionFromProfile(binding.profileId, profile)
  }

  /** Required precedence: exact runtime, exact binding, wildcard runtime, wildcard binding. */
  const rawConnection = (sessionId: string): DatabaseConnection | undefined =>
    runtime.get(sessionId)
    ?? profileConnection(sessionId)
    ?? runtime.get(WILDCARD_SESSION)
    ?? profileConnection(WILDCARD_SESSION)

  const requireContext = (): Context => {
    if (ctx === undefined) throw new Error('数据库执行服务尚未配置')
    return ctx
  }

  const resolveCredential = async (connection: DatabaseConnection): Promise<DatabaseConnection> => {
    const mode = credentialModeOf(connection)
    if (mode === 'reference') {
      if (connection.passwordRef === undefined) throw new Error('数据库凭据引用缺失，请重新配置连接')
      const ref = validatedCredentialRef(connection.passwordRef)
      const hit = await requireContext().credentials.resolve(ref)
      if (hit === undefined || hit.value.length === 0) {
        throw new Error(`凭据引用 "${connection.passwordRef}" 未配置`)
      }
      return { ...connection, password: hit.value, tables: copyTables(connection.tables) }
    }
    if (mode === 'password' && connection.password === undefined) {
      throw new Error('数据库凭据需要重新输入；请打开数据库配置并重新连接')
    }
    return { ...connection, tables: copyTables(connection.tables) }
  }

  const queryOptions = (
    mode?: QueryOptions['mode'],
    connect = false,
    maxResultChars = resolvedOptions.maxResultChars,
    catalog = false,
  ): QueryOptions => ({
    clients: resolvedOptions.clients,
    timeoutMs: connect
      ? resolvedOptions.connectTimeoutMs
      : catalog ? resolvedOptions.catalogQueryTimeoutMs ?? resolvedOptions.queryTimeoutMs : resolvedOptions.queryTimeoutMs,
    maxResultChars,
    ...mode !== undefined ? { mode } : {},
  })

  const run = async (
    connection: DatabaseConnection,
    sql: string,
    signal: AbortSignal,
    introspection = false,
    connect = false,
    mode?: QueryOptions['mode'],
    maxResultChars?: number,
    catalog = false,
  ): Promise<QueryResult> => {
    try {
      const result = await runClientQuery(
        requireContext(),
        connection,
        sql,
        queryOptions(mode, connect, maxResultChars, catalog),
        signal,
        introspection,
      )
      return redactQueryResult(result, connection)
    } catch (error) {
      const message = redactSecretText(error instanceof Error ? error.message : String(error), [connection.password])
      throw new Error(message, error instanceof Error ? { cause: error } : undefined)
    }
  }

  const verify = async (connection: DatabaseConnection, signal: AbortSignal, connect = false): Promise<string[]> => {
    const result = await run(connection, tableListingSql(connection.type, connection), signal, true, connect)
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() !== '' ? result.stderr.trim() : result.stdout.trim()
      throw new Error(`数据库连接验证失败（exit ${result.exitCode}）：${detail}`)
    }
    return parseTableListing(connection.type, result.stdout).slice(0, resolvedOptions.introspectMaxTables)
  }

  const canAccessMySqlSchema = async (
    connection: DatabaseConnection,
    schema: string,
    signal: AbortSignal,
  ): Promise<boolean> => {
    if (schema === connection.database) return true
    const result = await run({ ...connection, database: schema }, 'SHOW TABLES;', signal, true)
    if (result.exitCode === 0) return true
    const detail = result.stderr.trim() !== '' ? result.stderr.trim() : result.stdout.trim()
    if (MYSQL_DATABASE_ACCESS_DENIED.test(detail)) return false
    throw new Error(`元数据查询失败（exit ${result.exitCode}）：${detail}`)
  }

  const listAccessibleMySqlSchemas = async (
    connection: DatabaseConnection,
    schemas: readonly string[],
    signal: AbortSignal,
  ): Promise<string[]> => {
    const visible: string[] = []
    for (let offset = 0;
      offset < schemas.length && visible.length < resolvedOptions.introspectMaxTables;
      offset += MYSQL_SCHEMA_PROBE_CONCURRENCY) {
      signal.throwIfAborted()
      const batch = schemas.slice(offset, offset + MYSQL_SCHEMA_PROBE_CONCURRENCY)
      const accessible = await Promise.all(batch.map(schema => canAccessMySqlSchema(connection, schema, signal)))
      for (let index = 0; index < batch.length; index += 1) {
        if (accessible[index]) visible.push(batch[index]!)
        if (visible.length === resolvedOptions.introspectMaxTables) return visible
      }
    }
    return visible
  }

  const persistAtomically = async (
    sessionId: string,
    profileId: string,
    profile: PersistedConnectionProfile,
    draft: ConnectionFormDraft,
  ): Promise<void> => {
    if (persistence === undefined) return
    const previousProfile = persistence.getProfile(profileId)
    const previousBinding = persistence.getBinding(sessionId)
    const previousDraft = persistence.getDraft?.(sessionId)
    await persistence.putProfile(profileId, profile)
    try {
      await persistence.putBinding(sessionId, { profileId, updatedAt: profile.updatedAt })
      await persistence.putDraft?.(sessionId, { ...draft, updatedAt: profile.updatedAt })
    } catch (error) {
      // Best-effort rollback keeps a failed connect from replacing durable state.
      if (previousDraft === undefined) await persistence.deleteDraft?.(sessionId)
      else await persistence.putDraft?.(sessionId, previousDraft)
      if (previousProfile === undefined) await persistence.deleteProfile(profileId)
      else await persistence.putProfile(profileId, previousProfile)
      if (previousBinding === undefined) await persistence.deleteBinding(sessionId)
      else await persistence.putBinding(sessionId, previousBinding)
      throw error
    }
  }

  const matchingProfiles = (connection: DatabaseConnection): PersistedConnectionProfileEntry[] =>
    (persistence?.listProfiles?.() ?? [])
      .filter(entry => profileMatchesConnection(entry.profile, connection, resolvedOptions.cwd))

  const preferredMatches = (
    matches: readonly PersistedConnectionProfileEntry[],
  ): PersistedConnectionProfileEntry[] => {
    const preferred = new Set(resolvedOptions.preferredProfileIds?.() ?? [])
    return matches.filter(entry => preferred.has(entry.profileId))
  }

  const reusableProfileId = (sessionId: string, connection: DatabaseConnection): string => {
    if (connection.profileId !== undefined) return connection.profileId
    const fallback = `session:${sessionId}`
    const matches = matchingProfiles(connection)
    const binding = persistence?.getBinding(sessionId)
    const boundMatch = binding === undefined
      ? undefined
      : matches.find(entry => entry.profileId === binding.profileId)
    const preferred = preferredMatches(matches)
    const stableMatches = matches.filter(entry => !entry.profileId.startsWith('session:'))

    // A profile already owning durable Catalog data is the canonical identity,
    // including legacy session-prefixed ids. Exact identity matching above
    // prevents an unrelated endpoint/principal from being adopted.
    if (boundMatch !== undefined && preferred.some(entry => entry.profileId === boundMatch.profileId)) {
      return boundMatch.profileId
    }
    if (preferred.length === 1) return preferred[0]!.profileId
    if (preferred.length > 1) return fallback

    // Keep an explicit existing stable binding when duplicate stable profiles
    // make endpoint-only matching ambiguous.
    if (boundMatch !== undefined && !boundMatch.profileId.startsWith('session:')) return boundMatch.profileId
    if (stableMatches.length === 1) return stableMatches[0]!.profileId
    if (stableMatches.length > 1) return fallback
    if (boundMatch !== undefined) return boundMatch.profileId
    return matches.length === 1 ? matches[0]!.profileId : fallback
  }

  const reconcileStableProfile = async (
    sessionId: string,
    connection: DatabaseConnection,
  ): Promise<DatabaseConnection> => {
    if (persistence === undefined || connection.profileId === undefined) return connection
    const matches = matchingProfiles(connection)
    const preferred = preferredMatches(matches)
    if (preferred.some(entry => entry.profileId === connection.profileId)) return connection
    const stableMatches = matches.filter(entry => !entry.profileId.startsWith('session:'))

    const target = preferred.length === 1
      ? preferred[0]
      : connection.profileId.startsWith('session:')
        ? stableMatches.length === 1
          ? stableMatches[0]
          : undefined
        : undefined
    if (target === undefined) return connection

    const profileId = target.profileId
    const updatedAt = new Date().toISOString()
    await persistence.putBinding(sessionId, { profileId, updatedAt })
    const reconciled = { ...connection, profileId, tables: copyTables(connection.tables) }
    runtime.set(sessionId, reconciled)
    return reconciled
  }

  const credentialSummary = async (connection: DatabaseConnection): Promise<CredentialSummary | undefined> => {
    const mode = credentialModeOf(connection)
    if (connection.type === 'sqlite' || mode === 'none') return undefined
    if (mode === 'password') {
      return connection.password === undefined
        ? { configured: false }
        : { configured: true, source: 'memory' }
    }
    if (mode !== 'reference' || connection.passwordRef === undefined) return { configured: false }
    const info = await requireContext().credentials.describe(validatedCredentialRef(connection.passwordRef))
    return {
      configured: info.configured,
      ...info.source !== undefined ? { source: info.source } : {},
    }
  }

  const statusSummary = async (connection: DatabaseConnection): Promise<ConnectionSummary> => {
    const summary = summarize(connection)
    const mode = credentialModeOf(connection)
    summary.credentialMode = mode
    summary.credential = await credentialSummary(connection)
    const ready = mode === 'none' || summary.credential?.configured === true
    summary.ready = ready
    summary.reconnectRequired = !ready
    return summary
  }

  const service: DataAgentConnections = {
    set(sessionId, connection) {
      if (connection.password !== undefined && connection.passwordRef !== undefined) {
        throw new Error('password 与 passwordRef 不能同时提供')
      }
      if (connection.passwordRef !== undefined) validatePasswordRef(connection.passwordRef)
      runtime.set(sessionId, { ...connection, tables: copyTables(connection.tables) })
    },
    get(sessionId) {
      const connection = rawConnection(sessionId)
      return connection === undefined ? undefined : summarize(connection)
    },
    getWithSecret(sessionId) {
      const connection = rawConnection(sessionId)
      return connection === undefined ? undefined : { ...connection, tables: copyTables(connection.tables) }
    },
    has(sessionId) {
      return rawConnection(sessionId) !== undefined
    },
    clear(sessionId) {
      runtime.delete(sessionId)
    },
    getFormDraft(sessionId) {
      const persisted = persistence?.getDraft?.(sessionId)
      const draft = persisted ?? formDrafts.get(sessionId)
      const exactProfile = profileConnection(sessionId)
      if (draft !== undefined) {
        return {
          ...copyFormDraft(draft),
          ...exactProfile?.passwordRef !== undefined ? { passwordRef: exactProfile.passwordRef } : {},
        }
      }
      if (exactProfile !== undefined) return formInitialFromConnection(exactProfile)
      const latestProfile = persistence?.getLatestProfile?.()
      if (latestProfile !== undefined) {
        return formInitialFromConnection(connectionFromProfile(latestProfile.profileId, latestProfile.profile))
      }
      return latestFormInitial === undefined ? undefined : copyFormInitial(latestFormInitial)
    },
    async saveFormDraft(sessionId, draft) {
      if (sessionId.length === 0) throw new Error('sessionId 必须是非空字符串')
      const safe = normalizeFormDraft(draft)
      if (persistence?.putDraft !== undefined) {
        await persistence.putDraft(sessionId, { ...safe, updatedAt: new Date().toISOString() })
      } else {
        formDrafts.set(sessionId, safe)
      }
    },
    async status(sessionId) {
      const connection = rawConnection(sessionId)
      if (connection === undefined) return undefined
      return statusSummary(await reconcileStableProfile(sessionId, connection))
    },
    async connect(sessionId, input, signal) {
      if (sessionId.length === 0) throw new Error('sessionId 必须是非空字符串')
      const normalized = normalizeConnectionInput(input, resolvedOptions.cwd)
      const execution = await resolveCredential(normalized)
      const tables = await verify(execution, signal, true)
      const profileId = reusableProfileId(sessionId, normalized)
      const updatedAt = new Date().toISOString()
      const draft = formDraftFromConnection(normalized)
      await persistAtomically(sessionId, profileId, profileFromConnection(normalized, updatedAt), draft)
      if (persistence === undefined) formDrafts.set(sessionId, draft)
      latestFormInitial = formInitialFromConnection(normalized)
      const published: DatabaseConnection = { ...normalized, profileId, tables }
      runtime.set(sessionId, published)
      const summary = await statusSummary(published)
      return { tables, summary }
    },
    async disconnect(sessionId) {
      runtime.delete(sessionId)
      if (persistence !== undefined) await persistence.deleteBinding(sessionId)
    },
    async test(sessionId, signal) {
      const connection = await service.resolveForExecution(sessionId)
      const tables = await verify(connection, signal)
      const raw = rawConnection(sessionId)!
      const published = { ...raw, tables }
      runtime.set(sessionId, published)
      const summary = await statusSummary(published)
      return { tables, summary }
    },
    async resolveForExecution(sessionId) {
      const connection = rawConnection(sessionId)
      if (connection === undefined) {
        throw new Error('请先在 Web「数据库」标签页连接数据库，或在 TUI 运行 /database connect（未找到当前会话的连接）')
      }
      return resolveCredential(connection)
    },
    async queryMetadata(sessionId, sql, signal) {
      if (sql.trim().length === 0) throw new Error('Catalog metadata SQL must not be empty')
      const maxQueryChars = resolvedOptions.maxQueryChars ?? DEFAULT_MAX_QUERY_CHARS
      if (sql.length > maxQueryChars) throw new Error(`Catalog metadata SQL exceeds ${maxQueryChars} characters`)
      assertSingleStatement(sql, 'Catalog metadata query')
      const connection = await service.resolveForExecution(sessionId)
      if (classifyStatement(sql, connection.type) !== 'read') {
        throw new Error('Catalog metadata execution accepts read-only system catalog statements only')
      }
      const result = await run(
        connection,
        sql,
        signal,
        true,
        false,
        undefined,
        resolvedOptions.catalogMaxResultChars ?? resolvedOptions.maxResultChars,
        true,
      )
      if (result.exitCode !== 0) {
        const detail = result.stderr.trim() !== '' ? result.stderr.trim() : result.stdout.trim()
        throw new Error(`Catalog metadata query failed (exit ${result.exitCode}): ${detail}`)
      }
      return result
    },
    async listSchemas(sessionId, signal) {
      const connection = await service.resolveForExecution(sessionId)
      const stdout = await runMetadata(connection, 'schemas', signal)
      const schemas = parseListing(connection.type, stdout)
      if (connection.type === 'mysql' || connection.type === 'doris') {
        return listAccessibleMySqlSchemas(connection, schemas, signal)
      }
      return schemas.slice(0, resolvedOptions.introspectMaxTables)
    },
    async listTables(sessionId, schema, signal) {
      const connection = await service.resolveForExecution(sessionId)
      if (connection.type !== 'sqlite') requireIdentifier(connection.type, schema, 'schema')
      const stdout = await runMetadata(connection, 'tables', signal, schema)
      return parseListing(connection.type, stdout).slice(0, resolvedOptions.introspectMaxTables)
    },
    async describe(sessionId, schema, table, signal) {
      const connection = await service.resolveForExecution(sessionId)
      if (connection.type !== 'sqlite') requireIdentifier(connection.type, schema, 'schema')
      requireIdentifier(connection.type, table, 'table')
      const stdout = await runMetadata(connection, 'describe', signal, schema, table)
      return parseColumns(connection.type, stdout)
    },
    async query(sessionId, sql, signal) {
      if (sql.trim().length === 0) throw new Error('sql 必须是非空字符串')
      const maxQueryChars = resolvedOptions.maxQueryChars ?? DEFAULT_MAX_QUERY_CHARS
      if (sql.length > maxQueryChars) throw new Error(`sql 超过长度上限（${maxQueryChars} 字符）`)
      assertSingleStatement(sql, '/query')
      const connection = await service.resolveForExecution(sessionId)
      if ((connection.readonly ?? resolvedOptions.readonly) && classifyStatement(sql, connection.type) === 'write') {
        throw new Error('当前连接为只读模式，拒绝执行非读语句（仅放行 SELECT/SHOW/DESCRIBE/EXPLAIN/PRAGMA 等）')
      }
      return run(connection, sql, signal)
    },
    async executeInteractive(sessionId, sql, signal) {
      if (sql.trim().length === 0) throw new Error('sql 必须是非空字符串')
      const maxQueryChars = resolvedOptions.maxQueryChars ?? DEFAULT_MAX_QUERY_CHARS
      if (sql.length > maxQueryChars) throw new Error(`sql 超过长度上限（${maxQueryChars} 字符）`)
      assertSingleStatement(sql, '/query')
      const connection = await service.resolveForExecution(sessionId)
      const statementKind = classifyStatement(sql, connection.type)
      if ((connection.readonly ?? resolvedOptions.readonly) && statementKind === 'write') {
        throw new Error('当前连接为只读模式，拒绝执行非读语句（仅放行 SELECT/SHOW/DESCRIBE/EXPLAIN/PRAGMA 等）')
      }
      if (statementKind === 'write') {
        const result = await run(connection, sql, signal)
        return { kind: 'message', ...result }
      }

      // Ask for one extra row so the parser can distinguish a complete result
      // from a result capped at the 50,000-row export boundary.
      const limitedSql = enforceReadRowLimit(sql, connection.type, WORKBENCH_MAX_EXPORT_ROWS + 1)
      const startedAt = Date.now()
      const result = await run(
        connection,
        limitedSql,
        signal,
        false,
        false,
        'structured',
        WORKBENCH_MAX_RESULT_CHARS,
      )
      if (result.exitCode !== 0) return { kind: 'message', ...result }
      if (result.truncated) {
        throw new Error('查询结果超过 Web 工作台大小上限，请减少返回列或缩小字段后重试')
      }
      const parsed = parseStructuredQueryOutput(connection.type, result.stdout, WORKBENCH_MAX_EXPORT_ROWS)
      return {
        kind: 'table',
        columns: parsed.columns,
        rows: parsed.rows,
        elapsedMs: Date.now() - startedAt,
        truncated: parsed.rowLimitExceeded,
        maxRows: WORKBENCH_MAX_EXPORT_ROWS,
      }
    },
  }

  async function runMetadata(
    connection: DatabaseConnection,
    kind: 'schemas' | 'tables' | 'describe',
    signal: AbortSignal,
    schema?: string,
    table?: string,
  ): Promise<string> {
    const result = await run(connection, metadataQuery(kind, connection.type, schema, table), signal, true)
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() !== '' ? result.stderr.trim() : result.stdout.trim()
      throw new Error(`元数据查询失败（exit ${result.exitCode}）：${detail}`)
    }
    return result.stdout
  }

  return service
}

/** Backward-compatible in-memory store factory used by embedders/tests. */
export function createConnectionStore(): DataAgentConnections {
  return createConnectionService()
}

function copyTables(tables: string[] | undefined): string[] | undefined {
  return tables === undefined ? undefined : [...tables]
}

function normalizeFormDraft(draft: ConnectionFormDraft): ConnectionFormDraft {
  if (!isDatabaseType(draft.type)) throw new Error('数据库类型无效')
  if (typeof draft.host !== 'string' || typeof draft.port !== 'string'
    || typeof draft.user !== 'string' || typeof draft.database !== 'string'
    || typeof draft.readonly !== 'boolean'
    || (draft.secure !== undefined && typeof draft.secure !== 'boolean')) {
    throw new Error('数据库表单草稿无效')
  }
  return copyFormDraft(draft)
}

function copyFormDraft(draft: ConnectionFormDraft): ConnectionFormDraft {
  return {
    type: draft.type,
    host: draft.host,
    port: draft.port,
    user: draft.user,
    database: draft.database,
    readonly: draft.readonly,
    ...draft.type === 'clickhouse' ? { secure: draft.secure ?? false } : {},
  }
}

function copyFormInitial(initial: ConnectionFormInitial): ConnectionFormInitial {
  return {
    ...copyFormDraft(initial),
    ...initial.passwordRef !== undefined ? { passwordRef: initial.passwordRef } : {},
  }
}

function formDraftFromConnection(connection: DatabaseConnection): ConnectionFormDraft {
  return {
    type: connection.type,
    host: connection.type === 'sqlite' ? '' : connection.host ?? '',
    port: connection.type === 'sqlite' || connection.port === undefined ? '' : String(connection.port),
    user: connection.type === 'sqlite' ? '' : connection.user ?? '',
    database: connection.database,
    readonly: connection.readonly ?? false,
    ...connection.type === 'clickhouse' ? { secure: connection.secure ?? false } : {},
  }
}

function formInitialFromConnection(connection: DatabaseConnection): ConnectionFormInitial {
  return {
    ...formDraftFromConnection(connection),
    ...connection.passwordRef !== undefined ? { passwordRef: connection.passwordRef } : {},
  }
}

export function validatePasswordRef(value: string): void {
  try {
    credentialRef(value)
  } catch {
    throw new Error(`passwordRef "${value}" 无效；必须是 POSIX 环境变量形式的名称`)
  }
}

function validatedCredentialRef(value: string) {
  validatePasswordRef(value)
  return credentialRef(value)
}

function connectionFromProfile(profileId: string, profile: PersistedConnectionProfile): DatabaseConnection {
  return {
    type: profile.type,
    database: profile.database,
    profileId,
    ...profile.name !== undefined ? { name: profile.name } : {},
    ...profile.host !== undefined ? { host: profile.host } : {},
    ...profile.port !== undefined ? { port: profile.port } : {},
    ...profile.user !== undefined ? { user: profile.user } : {},
    ...profile.readonly !== undefined ? { readonly: profile.readonly } : {},
    ...profile.secure !== undefined ? { secure: profile.secure } : {},
    ...profile.passwordRef !== undefined ? { passwordRef: profile.passwordRef } : {},
    credentialMode: profile.credentialMode
      ?? (profile.type === 'sqlite' ? 'none' : profile.passwordRef !== undefined ? 'reference' : 'password'),
  }
}

function profileFromConnection(connection: DatabaseConnection, updatedAt: string): PersistedConnectionProfile {
  return {
    type: connection.type,
    database: connection.database,
    updatedAt,
    ...connection.name !== undefined ? { name: connection.name } : {},
    ...connection.host !== undefined ? { host: connection.host } : {},
    ...connection.port !== undefined ? { port: connection.port } : {},
    ...connection.user !== undefined ? { user: connection.user } : {},
    ...connection.readonly !== undefined ? { readonly: connection.readonly } : {},
    ...connection.secure !== undefined ? { secure: connection.secure } : {},
    ...connection.passwordRef !== undefined ? { passwordRef: connection.passwordRef } : {},
    ...connection.credentialMode !== undefined ? { credentialMode: connection.credentialMode } : {},
  }
}

/** Match only normalized, non-secret endpoint/principal identity fields. */
function profileMatchesConnection(
  profile: PersistedConnectionProfile,
  connection: DatabaseConnection,
  cwd = process.cwd(),
): boolean {
  let candidate: DatabaseConnection
  try {
    candidate = normalizeConnectionInput({
      type: profile.type,
      database: profile.database,
      ...profile.host !== undefined ? { host: profile.host } : {},
      ...profile.port !== undefined ? { port: profile.port } : {},
      ...profile.user !== undefined ? { user: profile.user } : {},
      ...profile.secure !== undefined ? { secure: profile.secure } : {},
    }, cwd)
  } catch {
    return false
  }
  return candidate.type === connection.type
    && candidate.database === connection.database
    && candidate.host === connection.host
    && candidate.port === connection.port
    && candidate.user === connection.user
    && (candidate.secure ?? false) === (connection.secure ?? false)
}

/** Infer legacy records while leaving ambiguous secret-less SQL profiles conservative. */
function credentialModeOf(connection: DatabaseConnection): CredentialMode {
  if (connection.credentialMode !== undefined) return connection.credentialMode
  if (connection.type === 'sqlite') return 'none'
  if (connection.passwordRef !== undefined) return 'reference'
  if (connection.password !== undefined) return 'password'
  return 'none'
}

function requireIdentifier(type: DatabaseType, value: string | undefined, label: string): string {
  if (value === undefined || value.length === 0) throw new Error(`${label} 不能为空`)
  sanitizeIdentifier(type, value)
  return value
}
