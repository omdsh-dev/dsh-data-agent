/**
 * Data Agent routes half (`@deepseek-ai/dsh-data-agent/routes`): the
 * `/plugins/data-agent` HTTP surface. A separate row from the main `data-agent`
 * row so the plugin keeps working in headless profiles (no webserver): the
 * connection store, preset self-install, and config-seeded connections all
 * live on the main row, and this row simply never activates where
 * `httpServer` is absent.
 *
 * Routes:
 * - `POST /plugins/data-agent/connect`    — validate and store one session's
 *   database connection, verify connectivity by listing all tables, and
 *   return `{ ok, tables }` (or `{ ok: false, error }` without saving).
 * - `POST /plugins/data-agent/disconnect` — drop one session's connection.
 * - `GET  /plugins/data-agent/status`     — the current connection's
 *   password-stripped summary plus the table list.
 * @module @deepseek-ai/dsh-data-agent/routes
 */

import type { IncomingMessage } from 'node:http'
import { resolve } from 'node:path'
import type { Context } from 'cordis'
import z from 'schemastery'
// Type-only: pulls the ctx.httpServer merge (the webserver host plugin) and
// the ctx.dataAgentConnections merge (the main data-agent row).
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from './index.ts'
import type {
  ConnectionSummary,
  DataAgentConnections,
  DatabaseConnection,
  DatabaseType,
} from './connections.ts'
import { parseTableListing, tableListingSql } from './clients.ts'
import { DEFAULT_CONNECT_TIMEOUT_MS, DEFAULT_INTROSPECT_MAX_TABLES, DEFAULT_MAX_RESULT_CHARS } from './defaults.ts'
import { runClientQuery } from './query.ts'

/** Cordis plugin name (diagnostics only). */
export const name = 'data-agent-routes'

/**
 * No top-level `inject` export: the row must ACTIVATE even in headless
 * profiles where `httpServer` never exists (a permanently pending entry
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
  /** Cap on the table list returned by /connect and /status. */
  introspectMaxTables: number
  /** In-memory cap on captured output. */
  maxResultChars: number
}

/** Loader schema with deployment defaults (no library defaults). */
export const Config = z.object({
  connectTimeoutMs: z.number().step(1).min(1000).default(DEFAULT_CONNECT_TIMEOUT_MS),
  introspectMaxTables: z.number().step(1).min(1).default(DEFAULT_INTROSPECT_MAX_TABLES),
  maxResultChars: z.number().step(1).min(1024).default(DEFAULT_MAX_RESULT_CHARS),
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
 * it at connect time).
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
  if (type !== 'mysql' && type !== 'postgres' && type !== 'sqlite') {
    throw new Error('type 必须是 "mysql"、"postgres" 或 "sqlite"')
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

/**
 * Mount the data-agent routes against the host webserver, when one exists.
 * The registration rides a nested inject fiber so this row activates in every
 * profile; headless profiles simply never get routes.
 * @param ctx - host cordis context.
 * @param config - validated loader configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['httpServer', 'subprocess', 'dataAgentConnections'], (scope) => {
    const store: DataAgentConnections = scope.dataAgentConnections
    const queryOptions = {
      clients: {},
      timeoutMs: config.connectTimeoutMs,
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

    scope.effect(() => {
      const dispose = scope.httpServer.register({
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
                tableListingSql(connection.type),
                queryOptions,
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
