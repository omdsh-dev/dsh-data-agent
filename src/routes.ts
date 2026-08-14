/**
 * Data Agent routes half (`@yejiming/dsh-data-agent/routes`): the
 * `/plugins/data-agent` HTTP surface. A separate row from the main `data-agent`
 * row so the plugin keeps working in headless profiles (no webserver): the
 * connection store, preset self-install, and config-seeded connections all
 * live on the main row, and this row simply never activates where
 * `webServer` is absent.
 *
 * Routes:
 * - `POST /plugins/data-agent/connect`    — validate and store one session's
 *   database connection, verify connectivity by listing all tables, and
 *   return `{ ok, tables }` (or `{ ok: false, error }` without saving).
 * - `POST /plugins/data-agent/disconnect` — drop one session's connection.
 * - `GET  /plugins/data-agent/status`     — the current connection's
 *   password-stripped summary plus the table list.
 * - `GET  /plugins/data-agent/schemas`    — schema/database list.
 * - `GET  /plugins/data-agent/tables`     — table list of one schema.
 * - `GET  /plugins/data-agent/describe`   — column structure of one table.
 * - `POST /plugins/data-agent/query`      — run one SQL text (the workbench
 *   command box; non-agent channel, same trust as sqlcmd).
 * @module @yejiming/dsh-data-agent/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from 'schemastery'
// Type-only: pulls the ctx.dataAgentConnections merge (the main data-agent
// row). The webserver service face is declared locally below (instead of
// importing from @deepseek-ai/dsh-host-webserver) so this row type-checks
// against any installed dsh-host-webserver generation.
import type {} from './index.ts'

/**
 * Minimal face of the host webserver service used by this row.
 * The service was renamed from `httpServer` to `webServer` in
 * dsh 0.1.0-rc.6; the nested inject below waits on `webServer`.
 */
interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: WebServerLike
  }
}
import type {
  ConnectionSummary,
  DataAgentConnections,
  DatabaseConnection,
  DatabaseType,
} from './connections.ts'
import { metadataQuery, parseColumns, parseListing, parseTableListing, tableListingSql } from './clients.ts'
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_INTROSPECT_MAX_TABLES,
  DEFAULT_MAX_QUERY_CHARS,
  DEFAULT_MAX_RESULT_CHARS,
  DEFAULT_QUERY_TIMEOUT_MS,
} from './defaults.ts'
import { runClientQuery, type QueryResult } from './query.ts'

/** Cordis plugin name (diagnostics only). */
export const name = 'data-agent-routes'

/**
 * No top-level `inject` export: the row must ACTIVATE even in headless
 * profiles where `webServer` never exists (a permanently pending entry
 * breaks one-shot runs). The routes register through a nested inject fiber
 * the moment the webserver and the connection store are both available.
 */
export const inject: string[] = []

/** Route prefix owned by this plugin (the browser half calls under it). */
export const DATA_AGENT_PATH = '/plugins/data-agent'

/** Routes-half configuration (defaults mirror the main row). */
export interface Config {
  /** Deadline for one /connect connectivity check, milliseconds. */
  connectTimeoutMs: number
  /** Cap on metadata lists returned by /connect /status /schemas /tables. */
  introspectMaxTables: number
  /** In-memory cap on captured output. */
  maxResultChars: number
  /** Deadline for one /query or metadata query, milliseconds. */
  queryTimeoutMs: number
  /** Cap on one /query SQL text length. */
  maxQueryChars: number
}

/** Loader schema with deployment defaults (no library defaults). */
export const Config = z.object({
  connectTimeoutMs: z.number().step(1).min(1000).default(DEFAULT_CONNECT_TIMEOUT_MS),
  introspectMaxTables: z.number().step(1).min(1).default(DEFAULT_INTROSPECT_MAX_TABLES),
  maxResultChars: z.number().step(1).min(1024).default(DEFAULT_MAX_RESULT_CHARS),
  queryTimeoutMs: z.number().step(1).min(1000).default(DEFAULT_QUERY_TIMEOUT_MS),
  maxQueryChars: z.number().step(1).min(1024).default(DEFAULT_MAX_QUERY_CHARS),
})

/** The connection request wire body (validated in the /connect handler). */
export interface ConnectRequestBody {
  sessionId: string
  type: DatabaseType
  host?: string
  port?: number
  user?: string
  database: string
  password?: string
}

/**
 * Validate an untrusted /connect body; sqlite paths resolve to absolute
 * (the client resolves the path relative to its own cwd, so the server pins
 * it at connect time). Oracle/Hive/Impala follow the mysql/postgres shape:
 * host/port/user/database (Oracle database = service name/SID, Hive/Impala
 * database = default schema).
 */
export function validateConnectBody(value: unknown, cwd = process.cwd()): ConnectRequestBody {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('请求体必须是 JSON 对象')
  }
  const candidate = value as Record<string, unknown>
  const sessionId = candidate.sessionId
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('sessionId 必须是非空字符串')
  }
  const type = candidate.type
  if (type !== 'mysql' && type !== 'postgres' && type !== 'sqlite'
    && type !== 'oracle' && type !== 'hive' && type !== 'impala') {
    throw new Error('type 必须是 "mysql"、"postgres"、"sqlite"、"oracle"、"hive" 或 "impala"')
  }
  const database = candidate.database
  if (typeof database !== 'string' || database.length === 0) {
    throw new Error('database 必须是非空字符串' + (type === 'sqlite' ? '（SQLite 为数据库文件路径）' : ''))
  }
  if (type === 'sqlite') {
    return { sessionId, type, database: resolve(cwd, database) }
  }
  const host = candidate.host
  if (host !== undefined && typeof host !== 'string') throw new Error('host 必须是字符串')
  const port = candidate.port
  if (port !== undefined && (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error('port 必须是 1-65535 的整数')
  }
  const user = candidate.user
  if (user !== undefined && typeof user !== 'string') throw new Error('user 必须是字符串')
  const password = candidate.password
  if (password !== undefined && typeof password !== 'string') throw new Error('password 必须是字符串')
  const connection: DatabaseConnection = { type, database }
  if (typeof host === 'string' && host.length > 0) connection.host = host
  if (port !== undefined) connection.port = port
  if (typeof user === 'string' && user.length > 0) connection.user = user
  if (typeof password === 'string' && password.length > 0) connection.password = password
  return { sessionId, type, database, ...connection.host !== undefined ? { host: connection.host } : {}, ...connection.port !== undefined ? { port: connection.port } : {}, ...connection.user !== undefined ? { user: connection.user } : {}, ...connection.password !== undefined ? { password: connection.password } : {} }
}

/** Identifier whitelist for schema/table names in metadata queries. */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_$#.-]+$/

/** Validate one schema/table identifier (rejects any injection-shaped input). */
function requireIdentifier(value: string | null, label: string): string {
  if (value === null || value.length === 0) throw new Error(`${label} 不能为空`)
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label} 含非法字符（仅允许字母、数字与 _ $ # . -）`)
  }
  return value
}

/**
 * Mount the data-agent routes against the host webserver, when one exists.
 * The registration rides a nested inject fiber so this row activates in every
 * profile; headless profiles simply never get routes.
 * @param ctx - host cordis context.
 * @param config - validated loader configuration.
 */
export function apply(ctx: Context, config: Config): void {
  // `webServer` since dsh 0.1.0-rc.6 (the service was previously `httpServer`).
  ctx.inject(['webServer', 'subprocess', 'dataAgentConnections'], (scope) => {
    const store: DataAgentConnections = scope.dataAgentConnections
    const connectOptions = {
      clients: {},
      timeoutMs: config.connectTimeoutMs,
      maxResultChars: config.maxResultChars,
    }
    const queryOptions = {
      clients: {},
      timeoutMs: config.queryTimeoutMs,
      maxResultChars: config.maxResultChars,
    }
    const introspectMaxTables = config.introspectMaxTables

    /** Collect the request body into a parsed JSON value. */
    const readJson = async (req: IncomingMessage): Promise<unknown> => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.length === 0) return {}
      return JSON.parse(raw)
    }

    /** The stored connection for one session, failing loud when absent. */
    const requireConnection = (sessionId: string): DatabaseConnection => {
      const connection = store.getWithSecret(sessionId)
      if (connection === undefined) {
        throw new Error('请先连接数据库（未找到当前会话的连接），再执行该操作')
      }
      return connection
    }

    /**
     * Run one metadata query in machine-readable mode and return its stdout;
     * a non-zero exit throws with the client's stderr as the message.
     */
    const runMetadata = async (
      connection: DatabaseConnection,
      kind: 'schemas' | 'tables' | 'describe',
      schema?: string,
      table?: string,
    ): Promise<string> => {
      const result = await runClientQuery(
        scope,
        connection,
        metadataQuery(kind, connection.type, schema, table),
        queryOptions,
        new AbortController().signal,
        true,
      )
      if (result.exitCode !== 0) {
        const detail = result.stderr.trim() !== '' ? result.stderr.trim() : result.stdout.trim()
        throw new Error(`元数据查询失败（exit ${result.exitCode}）：${detail}`)
      }
      return result.stdout
    }

    scope.effect(() => {
      const dispose = scope.webServer.register({
        kind: 'prefix',
        path: DATA_AGENT_PATH,
        handler: async (req, res) => {
          const writeJson = (status: number, body: unknown): void => {
            res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(body))
          }
          try {
            const url = new URL(req.url ?? '/', 'http://dsh.internal')
            const segments = url.pathname.slice(DATA_AGENT_PATH.length).split('/').filter(Boolean)

            if (req.method === 'POST' && segments.length === 1 && segments[0] === 'connect') {
              const request = validateConnectBody(await readJson(req))
              const connection: DatabaseConnection = {
                type: request.type,
                database: request.database,
                ...request.host !== undefined ? { host: request.host } : {},
                ...request.port !== undefined ? { port: request.port } : {},
                ...request.user !== undefined ? { user: request.user } : {},
                ...request.password !== undefined ? { password: request.password } : {},
              }
              // Connectivity proof FIRST: a failed check must not leave a
              // stored connection behind.
              const listing = await runClientQuery(
                scope,
                connection,
                tableListingSql(connection.type, connection),
                connectOptions,
                new AbortController().signal,
                true,
              )
              if (listing.exitCode !== 0) {
                const detail = listing.stderr.trim() !== '' ? listing.stderr.trim() : listing.stdout.trim()
                writeJson(200, { ok: false, error: `数据库连接验证失败（exit ${listing.exitCode}）：${detail}` })
                return
              }
              const tables = parseTableListing(connection.type, listing.stdout).slice(0, introspectMaxTables)
              connection.tables = tables
              store.set(request.sessionId, connection)
              writeJson(200, { ok: true, tables })
              return
            }

            if (req.method === 'POST' && segments.length === 1 && segments[0] === 'disconnect') {
              const body = (await readJson(req)) as Record<string, unknown>
              const sessionId = body.sessionId
              if (typeof sessionId !== 'string' || sessionId.length === 0) {
                throw new Error('sessionId 必须是非空字符串')
              }
              store.clear(sessionId)
              writeJson(200, { ok: true })
              return
            }

            if (req.method === 'GET' && segments.length === 1 && segments[0] === 'status') {
              const sessionId = url.searchParams.get('sessionId') ?? ''
              const summary: ConnectionSummary | undefined = store.get(sessionId)
              writeJson(200, summary === undefined
                ? { connected: false }
                : { connected: true, summary })
              return
            }

            if (req.method === 'GET' && segments.length === 1 && segments[0] === 'schemas') {
              const sessionId = url.searchParams.get('sessionId') ?? ''
              if (sessionId.length === 0) throw new Error('sessionId 不能为空')
              const connection = requireConnection(sessionId)
              const stdout = await runMetadata(connection, 'schemas')
              const schemas = parseListing(connection.type, stdout).slice(0, introspectMaxTables)
              writeJson(200, { ok: true, schemas })
              return
            }

            if (req.method === 'GET' && segments.length === 1 && segments[0] === 'tables') {
              const sessionId = url.searchParams.get('sessionId') ?? ''
              if (sessionId.length === 0) throw new Error('sessionId 不能为空')
              const connection = requireConnection(sessionId)
              const schema = connection.type === 'sqlite'
                ? undefined
                : requireIdentifier(url.searchParams.get('schema'), 'schema')
              const stdout = await runMetadata(connection, 'tables', schema)
              const tables = parseListing(connection.type, stdout).slice(0, introspectMaxTables)
              writeJson(200, { ok: true, tables })
              return
            }

            if (req.method === 'GET' && segments.length === 1 && segments[0] === 'describe') {
              const sessionId = url.searchParams.get('sessionId') ?? ''
              if (sessionId.length === 0) throw new Error('sessionId 不能为空')
              const connection = requireConnection(sessionId)
              const schema = connection.type === 'sqlite'
                ? undefined
                : requireIdentifier(url.searchParams.get('schema'), 'schema')
              const table = requireIdentifier(url.searchParams.get('table'), 'table')
              const stdout = await runMetadata(connection, 'describe', schema, table)
              const columns = parseColumns(connection.type, stdout)
              writeJson(200, { ok: true, columns })
              return
            }

            if (req.method === 'POST' && segments.length === 1 && segments[0] === 'query') {
              const body = (await readJson(req)) as Record<string, unknown>
              const sessionId = body.sessionId
              if (typeof sessionId !== 'string' || sessionId.length === 0) {
                throw new Error('sessionId 必须是非空字符串')
              }
              const sql = body.sql
              if (typeof sql !== 'string' || sql.trim().length === 0) {
                throw new Error('sql 必须是非空字符串')
              }
              if (sql.length > config.maxQueryChars) {
                throw new Error(`sql 超过长度上限（${config.maxQueryChars} 字符）`)
              }
              const connection = requireConnection(sessionId)
              const result: QueryResult = await runClientQuery(
                scope,
                connection,
                sql,
                queryOptions,
                new AbortController().signal,
              )
              writeJson(200, { ok: true, result })
              return
            }

            writeJson(404, { error: 'unknown data-agent route' })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            writeJson(400, { error: message })
          }
        },
      })
      return () => { dispose() }
    }, 'data-agent-routes: routes')
  })
}
