/**
 * Web adapter for the shared data-agent connection service.
 *
 * This entry owns only HTTP parsing/serialization. Connection validation,
 * credentials, persistence, metadata, query safety, and error semantics live
 * in `DataAgentConnections`, which is also consumed by TUI commands/tools.
 * @module @yejiming/dsh-data-agent/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from 'schemastery'
import type {} from './index.ts'
import type { DatabaseConnectionInput } from './connections.ts'
import { DATABASE_TYPES, isDatabaseType } from './database-types.ts'
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_INTROSPECT_MAX_TABLES,
  DEFAULT_MAX_QUERY_CHARS,
  DEFAULT_MAX_RESULT_CHARS,
  DEFAULT_QUERY_TIMEOUT_MS,
} from './defaults.ts'

export const name = 'data-agent-routes'

/** Headless profiles activate this row without waiting forever for webServer. */
export const inject: string[] = []

export const DATA_AGENT_PATH = '/plugins/data-agent'

/** Retained loader surface for backward compatibility; domain options live on the host row. */
export interface Config {
  connectTimeoutMs: number
  introspectMaxTables: number
  maxResultChars: number
  queryTimeoutMs: number
  maxQueryChars: number
  readonly: boolean
}

export const Config = z.object({
  connectTimeoutMs: z.number().step(1).min(1000).default(DEFAULT_CONNECT_TIMEOUT_MS),
  introspectMaxTables: z.number().step(1).min(1).default(DEFAULT_INTROSPECT_MAX_TABLES),
  maxResultChars: z.number().step(1).min(1024).default(DEFAULT_MAX_RESULT_CHARS),
  queryTimeoutMs: z.number().step(1).min(1000).default(DEFAULT_QUERY_TIMEOUT_MS),
  maxQueryChars: z.number().step(1).min(1024).default(DEFAULT_MAX_QUERY_CHARS),
  readonly: z.boolean().default(false),
})

export interface ConnectRequestBody extends DatabaseConnectionInput {
  sessionId: string
}

/** Validate the Web wire shape while retaining temporary-password compatibility. */
export function validateConnectBody(value: unknown, cwd = process.cwd()): ConnectRequestBody {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求体必须是 JSON 对象')
  const candidate = value as Record<string, unknown>
  const sessionId = requireString(candidate.sessionId, 'sessionId')
  const type = candidate.type
  if (!isDatabaseType(type)) {
    throw new Error(`type 必须是受支持的数据库类型：${DATABASE_TYPES.join('、')}`)
  }
  const database = requireString(candidate.database, 'database')
  const password = optionalString(candidate.password, 'password')
  const passwordRef = optionalString(candidate.passwordRef, 'passwordRef')
  if (password !== undefined && passwordRef !== undefined) throw new Error('password 与 passwordRef 不能同时提供')
  const readonly = optionalBoolean(candidate.readonly, 'readonly')
  const secure = optionalBoolean(candidate.secure, 'secure')
  const profileId = optionalString(candidate.profileId, 'profileId')
  const profileName = optionalString(candidate.name, 'name')

  const request: ConnectRequestBody = {
    sessionId,
    type,
    database: type === 'sqlite' ? resolve(cwd, database) : database,
  }
  if (readonly !== undefined) request.readonly = readonly
  if (type === 'clickhouse' && secure !== undefined) request.secure = secure
  if (profileId !== undefined) request.profileId = profileId
  if (profileName !== undefined) request.name = profileName
  if (type === 'sqlite') return request

  const host = optionalString(candidate.host, 'host')
  const user = optionalString(candidate.user, 'user')
  const port = candidate.port
  if (port !== undefined && (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error('port 必须是 1-65535 的整数')
  }
  if (host !== undefined) request.host = host
  if (user !== undefined) request.user = user
  if (typeof port === 'number') request.port = port
  if (password !== undefined) request.password = password
  if (passwordRef !== undefined) request.passwordRef = passwordRef
  return request
}

/** Register Web routes only when both the webserver and shared service exist. */
export function apply(ctx: Context, _config: Config): void {
  ctx.inject(['webServer', 'dataAgentConnections'], (scope) => {
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
            const signal = requestSignal(req)

            if (req.method === 'POST' && routeIs(segments, 'connect')) {
              try {
                const request = validateConnectBody(await readJson(req))
                const { sessionId, ...input } = request
                const result = await scope.dataAgentConnections.connect(sessionId, input, signal)
                writeJson(200, { ok: true, tables: result.tables, summary: result.summary })
              } catch (error) {
                writeJson(200, { ok: false, error: error instanceof Error ? error.message : String(error) })
              }
              return
            }

            if (req.method === 'POST' && routeIs(segments, 'disconnect')) {
              const sessionId = requireString((await readJson(req) as Record<string, unknown>).sessionId, 'sessionId')
              await scope.dataAgentConnections.disconnect(sessionId)
              writeJson(200, { ok: true })
              return
            }

            if (req.method === 'GET' && routeIs(segments, 'status')) {
              const sessionId = requireString(url.searchParams.get('sessionId'), 'sessionId')
              const summary = await scope.dataAgentConnections.status(sessionId)
              writeJson(200, summary === undefined
                ? { connected: false, reconnectRequired: false }
                : {
                    connected: summary.ready === true,
                    reconnectRequired: summary.reconnectRequired === true,
                    summary,
                  })
              return
            }

            if (req.method === 'GET' && routeIs(segments, 'schemas')) {
              const sessionId = requireString(url.searchParams.get('sessionId'), 'sessionId')
              const schemas = await scope.dataAgentConnections.listSchemas(sessionId, signal)
              writeJson(200, { ok: true, schemas })
              return
            }

            if (req.method === 'GET' && routeIs(segments, 'tables')) {
              const sessionId = requireString(url.searchParams.get('sessionId'), 'sessionId')
              const schema = url.searchParams.get('schema') ?? undefined
              const tables = await scope.dataAgentConnections.listTables(sessionId, schema, signal)
              writeJson(200, { ok: true, tables })
              return
            }

            if (req.method === 'GET' && routeIs(segments, 'describe')) {
              const sessionId = requireString(url.searchParams.get('sessionId'), 'sessionId')
              const schema = url.searchParams.get('schema') ?? undefined
              const table = requireString(url.searchParams.get('table'), 'table')
              const columns = await scope.dataAgentConnections.describe(sessionId, schema, table, signal)
              writeJson(200, { ok: true, columns })
              return
            }

            if (req.method === 'POST' && routeIs(segments, 'query')) {
              const body = await readJson(req) as Record<string, unknown>
              const sessionId = requireString(body.sessionId, 'sessionId')
              const sql = requireString(body.sql, 'sql')
              const result = await scope.dataAgentConnections.executeInteractive(sessionId, sql, signal)
              writeJson(200, { ok: true, result })
              return
            }

            writeJson(404, { error: 'unknown data-agent route' })
          } catch (error) {
            writeJson(400, { error: error instanceof Error ? error.message : String(error) })
          }
        },
      })
      return () => { dispose() }
    }, 'data-agent-routes: routes')
  })
}

function routeIs(segments: string[], expected: string): boolean {
  return segments.length === 1 && segments[0] === expected
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw.length === 0 ? {} : JSON.parse(raw)
}

function requestSignal(req: IncomingMessage): AbortSignal {
  const controller = new AbortController()
  req.once('aborted', () => controller.abort(new Error('HTTP request aborted')))
  return controller.signal
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} 必须是非空字符串`)
  return value
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${label} 必须是字符串`)
  return value
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`${label} 必须是布尔值`)
  return value
}
