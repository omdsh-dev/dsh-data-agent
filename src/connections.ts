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
  metadataQuery,
  parseColumns,
  parseListing,
  parseTableListing,
  sanitizeIdentifier,
  tableListingSql,
  type ClientConfig,
  type ColumnInfo,
} from './clients.ts'
import { DEFAULT_MAX_QUERY_CHARS } from './defaults.ts'
import { runClientQuery, type QueryOptions, type QueryResult } from './query.ts'
import { assertSingleStatement } from './sql.ts'

/** Key of the wildcard connection applied to sessions without an exact entry. */
export const WILDCARD_SESSION = '*'

/** Supported database client kinds. */
export type DatabaseType = 'mysql' | 'postgres' | 'sqlite' | 'oracle' | 'hive' | 'impala'

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
  /** Optional stable durable profile id. */
  profileId?: string
  /** Optional human-readable profile label. */
  name?: string
}

/** Runtime connection. `tables` and temporary `password` are never durable. */
export interface DatabaseConnection extends DatabaseConnectionInput {
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
  profileId?: string
  name?: string
  tables?: string[]
  credential?: CredentialSummary
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
  passwordRef?: string
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
}

/** Durable draft record. Passwords and credential references are forbidden. */
export interface PersistedConnectionFormDraft extends ConnectionFormDraft {
  updatedAt: string
}

/** Minimal durable seam; backed by a DSH storage domain in production. */
export interface ConnectionPersistence {
  getProfile(profileId: string): PersistedConnectionProfile | undefined
  putProfile(profileId: string, profile: PersistedConnectionProfile): Promise<void>
  deleteProfile(profileId: string): Promise<boolean>
  getBinding(sessionId: string): SessionConnectionBinding | undefined
  putBinding(sessionId: string, binding: SessionConnectionBinding): Promise<void>
  deleteBinding(sessionId: string): Promise<boolean>
  getDraft?(sessionId: string): PersistedConnectionFormDraft | undefined
  putDraft?(sessionId: string, draft: PersistedConnectionFormDraft): Promise<void>
}

/** Shared service configuration supplied by the host plugin. */
export interface ConnectionServiceOptions {
  connectTimeoutMs: number
  queryTimeoutMs: number
  maxResultChars: number
  maxQueryChars?: number
  introspectMaxTables: number
  readonly: boolean
  clients: Partial<Record<string, ClientConfig>>
  cwd?: string
}

export interface ConnectResult {
  tables: string[]
  summary: ConnectionSummary
}

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
  /** Restore the latest non-secret interactive form values for this session. */
  getFormDraft(sessionId: string): ConnectionFormDraft | undefined
  /** Save non-secret form values; the implementation never accepts a password. */
  saveFormDraft(sessionId: string, draft: ConnectionFormDraft): Promise<void>
  status(sessionId: string): Promise<ConnectionSummary | undefined>
  connect(sessionId: string, input: DatabaseConnectionInput, signal: AbortSignal): Promise<ConnectResult>
  disconnect(sessionId: string): Promise<void>
  test(sessionId: string, signal: AbortSignal): Promise<ConnectResult>
  resolveForExecution(sessionId: string): Promise<DatabaseConnection>
  listSchemas(sessionId: string, signal: AbortSignal): Promise<string[]>
  listTables(sessionId: string, schema: string | undefined, signal: AbortSignal): Promise<string[]>
  describe(sessionId: string, schema: string | undefined, table: string, signal: AbortSignal): Promise<ColumnInfo[]>
  query(sessionId: string, sql: string, signal: AbortSignal): Promise<QueryResult>
}

/** Build a password-stripped copy of one connection. */
export function summarize(connection: DatabaseConnection): ConnectionSummary {
  const summary: ConnectionSummary = { type: connection.type, database: connection.database }
  if (connection.host !== undefined) summary.host = connection.host
  if (connection.port !== undefined) summary.port = connection.port
  if (connection.user !== undefined) summary.user = connection.user
  if (connection.passwordRef !== undefined) summary.passwordRef = connection.passwordRef
  if (connection.readonly !== undefined) summary.readonly = connection.readonly
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

  const connection: DatabaseConnection = {
    type: input.type,
    database: input.type === 'sqlite' ? resolve(cwd, input.database) : input.database,
  }
  if (input.type !== 'sqlite') {
    if (input.host !== undefined && input.host.length > 0) connection.host = input.host
    if (input.port !== undefined) connection.port = input.port
    if (input.user !== undefined && input.user.length > 0) connection.user = input.user
    if (input.password !== undefined && input.password.length > 0) connection.password = input.password
    if (input.passwordRef !== undefined) connection.passwordRef = input.passwordRef
  }
  if (input.readonly !== undefined) connection.readonly = input.readonly
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
    if (connection.passwordRef === undefined) return { ...connection, tables: copyTables(connection.tables) }
    const ref = validatedCredentialRef(connection.passwordRef)
    const hit = await requireContext().credentials.resolve(ref)
    if (hit === undefined || hit.value.length === 0) {
      throw new Error(`凭据引用 "${connection.passwordRef}" 未配置`)
    }
    return { ...connection, password: hit.value, tables: copyTables(connection.tables) }
  }

  const queryOptions = (mode?: QueryOptions['mode'], connect = false): QueryOptions => ({
    clients: resolvedOptions.clients,
    timeoutMs: connect ? resolvedOptions.connectTimeoutMs : resolvedOptions.queryTimeoutMs,
    maxResultChars: resolvedOptions.maxResultChars,
    ...mode !== undefined ? { mode } : {},
  })

  const run = async (
    connection: DatabaseConnection,
    sql: string,
    signal: AbortSignal,
    introspection = false,
    connect = false,
  ): Promise<QueryResult> => {
    try {
      const result = await runClientQuery(
        requireContext(),
        connection,
        sql,
        queryOptions(undefined, connect),
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

  const persistAtomically = async (
    sessionId: string,
    profileId: string,
    profile: PersistedConnectionProfile,
  ): Promise<void> => {
    if (persistence === undefined) return
    const previousProfile = persistence.getProfile(profileId)
    const previousBinding = persistence.getBinding(sessionId)
    await persistence.putProfile(profileId, profile)
    try {
      await persistence.putBinding(sessionId, { profileId, updatedAt: profile.updatedAt })
    } catch (error) {
      // Best-effort rollback keeps a failed connect from replacing durable state.
      if (previousProfile === undefined) await persistence.deleteProfile(profileId)
      else await persistence.putProfile(profileId, previousProfile)
      if (previousBinding === undefined) await persistence.deleteBinding(sessionId)
      else await persistence.putBinding(sessionId, previousBinding)
      throw error
    }
  }

  const credentialSummary = async (connection: DatabaseConnection): Promise<CredentialSummary | undefined> => {
    if (connection.type === 'sqlite') return undefined
    if (connection.password !== undefined) return { configured: true, source: 'memory' }
    if (connection.passwordRef === undefined) return { configured: false }
    const info = await requireContext().credentials.describe(validatedCredentialRef(connection.passwordRef))
    return {
      configured: info.configured,
      ...info.source !== undefined ? { source: info.source } : {},
    }
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
      return draft === undefined ? undefined : copyFormDraft(draft)
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
      const summary = summarize(connection)
      summary.credential = await credentialSummary(connection)
      return summary
    },
    async connect(sessionId, input, signal) {
      if (sessionId.length === 0) throw new Error('sessionId 必须是非空字符串')
      const normalized = normalizeConnectionInput(input, resolvedOptions.cwd)
      const execution = await resolveCredential(normalized)
      const tables = await verify(execution, signal, true)
      const profileId = normalized.profileId ?? `session:${sessionId}`
      const updatedAt = new Date().toISOString()
      await persistAtomically(sessionId, profileId, profileFromConnection(normalized, updatedAt))
      const published: DatabaseConnection = { ...normalized, profileId, tables }
      runtime.set(sessionId, published)
      const summary = summarize(published)
      summary.credential = await credentialSummary(published)
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
      const summary = summarize(published)
      summary.credential = await credentialSummary(published)
      return { tables, summary }
    },
    async resolveForExecution(sessionId) {
      const connection = rawConnection(sessionId)
      if (connection === undefined) {
        throw new Error('请先在 Web「数据库」标签页连接数据库，或在 TUI 运行 /database connect（未找到当前会话的连接）')
      }
      return resolveCredential(connection)
    },
    async listSchemas(sessionId, signal) {
      const connection = await service.resolveForExecution(sessionId)
      const stdout = await runMetadata(connection, 'schemas', signal)
      return parseListing(connection.type, stdout).slice(0, resolvedOptions.introspectMaxTables)
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
    || typeof draft.readonly !== 'boolean') {
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
  }
}

function isDatabaseType(value: unknown): value is DatabaseType {
  return value === 'mysql' || value === 'postgres' || value === 'sqlite'
    || value === 'oracle' || value === 'hive' || value === 'impala'
}

function validatePasswordRef(value: string): void {
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
    ...profile.passwordRef !== undefined ? { passwordRef: profile.passwordRef } : {},
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
    ...connection.passwordRef !== undefined ? { passwordRef: connection.passwordRef } : {},
  }
}

function requireIdentifier(type: DatabaseType, value: string | undefined, label: string): string {
  if (value === undefined || value.length === 0) throw new Error(`${label} 不能为空`)
  sanitizeIdentifier(type, value)
  return value
}
