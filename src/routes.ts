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
import { z as zod } from 'zod'
import type {} from './index.ts'
import { CatalogVersionConflictError } from './catalog.ts'
import {
  catalogScopeSchema,
  catalogSearchRequestSchema,
  semanticDefinitionSchema,
} from './catalog-types.ts'
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
  ctx.inject([
    'webServer', 'dataAgentConnections', 'dataAgentCatalog', 'dataAgentCatalogScanner', 'dataAgentCatalogReview',
  ], (scope) => {
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

            if (req.method === 'GET' && routePathIs(segments, 'catalog', 'sources')) {
              assertOnlySearchParams(url.searchParams, [])
              writeJson(200, { ok: true, sources: scope.dataAgentCatalog.listSources() })
              return
            }

            if (req.method === 'GET' && routePathIs(segments, 'catalog', 'status')) {
              assertOnlySearchParams(url.searchParams, ['sourceId'])
              const sourceId = requireBoundedString(url.searchParams.get('sourceId'), 'sourceId')
              const status = scope.dataAgentCatalog.status(sourceId)
              writeJson(200, { ok: true, status: status ?? null })
              return
            }

            if (req.method === 'GET' && routePathIs(segments, 'catalog', 'runs')) {
              assertOnlySearchParams(url.searchParams, ['sourceId', 'limit'])
              const sourceId = requireBoundedString(url.searchParams.get('sourceId'), 'sourceId')
              const limit = optionalPositiveInteger(url.searchParams.get('limit'), 'limit', 200)
              writeJson(200, { ok: true, runs: scope.dataAgentCatalog.listRuns(sourceId, limit) })
              return
            }

            if (req.method === 'POST' && routePathIs(segments, 'catalog', 'scan')) {
              const body = catalogScanBodySchema.parse(await readJson(req))
              if (body.sourceId !== undefined) {
                const summary = scope.dataAgentConnections.get(body.sessionId)
                if (summary?.profileId !== body.sourceId) throw new Error('sourceId does not match the session connection')
              }
              const run = await scope.dataAgentCatalogScanner.start({ sessionId: body.sessionId, scope: body.scope })
              writeJson(202, { ok: true, run })
              return
            }

            if (req.method === 'POST' && routePathIs(segments, 'catalog', 'cancel')) {
              const body = catalogCancelBodySchema.parse(await readJson(req))
              const run = await scope.dataAgentCatalogScanner.cancel(body.sourceId, body.runId)
              writeJson(200, { ok: true, run })
              return
            }

            if (req.method === 'GET' && routePathIs(segments, 'catalog', 'search')) {
              assertOnlySearchParams(url.searchParams, [
                'sourceId', 'query', 'schema', 'assetKinds', 'semanticKinds', 'assetStatuses',
                'semanticStatuses', 'includeInferred', 'cursor', 'pageSize',
              ])
              const sourceId = requireBoundedString(url.searchParams.get('sourceId'), 'sourceId')
              const query = requireBoundedString(url.searchParams.get('query'), 'query', 512)
              const pageSize = optionalPositiveInteger(url.searchParams.get('pageSize'), 'pageSize', 200)
              const includeInferred = optionalBooleanQuery(url.searchParams.get('includeInferred'), 'includeInferred')
              const request = catalogSearchRequestSchema.parse({
                query,
                filters: {
                  sourceId,
                  ...url.searchParams.get('schema') !== null ? { schema: url.searchParams.get('schema') } : {},
                  ...csvParam(url.searchParams, 'assetKinds') !== undefined ? { assetKinds: csvParam(url.searchParams, 'assetKinds') } : {},
                  ...csvParam(url.searchParams, 'semanticKinds') !== undefined ? { semanticKinds: csvParam(url.searchParams, 'semanticKinds') } : {},
                  ...csvParam(url.searchParams, 'assetStatuses') !== undefined ? { assetStatuses: csvParam(url.searchParams, 'assetStatuses') } : {},
                  ...csvParam(url.searchParams, 'semanticStatuses') !== undefined ? { semanticStatuses: csvParam(url.searchParams, 'semanticStatuses') } : {},
                  includeInferred: includeInferred ?? false,
                },
                ...url.searchParams.get('cursor') !== null ? { cursor: url.searchParams.get('cursor') } : {},
                ...pageSize !== undefined ? { pageSize } : {},
              })
              writeJson(200, { ok: true, page: await scope.dataAgentCatalog.search(request) })
              return
            }

            if (req.method === 'GET' && segments.length === 3 && segments[0] === 'catalog' && segments[1] === 'assets') {
              assertOnlySearchParams(url.searchParams, ['sourceId', 'cursor', 'pageSize'])
              const sourceId = requireBoundedString(url.searchParams.get('sourceId'), 'sourceId')
              const assetId = requireBoundedString(segments[2], 'assetId')
              const pageSize = optionalPositiveInteger(url.searchParams.get('pageSize'), 'pageSize', 200)
              const cursor = optionalBoundedString(url.searchParams.get('cursor'), 'cursor', 512)
              writeJson(200, { ok: true, detail: scope.dataAgentCatalog.getAsset(sourceId, assetId, cursor, pageSize) })
              return
            }

            if (req.method === 'GET' && routePathIs(segments, 'catalog', 'diff')) {
              assertOnlySearchParams(url.searchParams, ['sourceId', 'from', 'to', 'cursor', 'pageSize'])
              const sourceId = requireBoundedString(url.searchParams.get('sourceId'), 'sourceId')
              const fromRunId = optionalBoundedString(url.searchParams.get('from'), 'from', 256)
              const toRunId = optionalBoundedString(url.searchParams.get('to'), 'to', 256)
              if ((fromRunId === undefined) !== (toRunId === undefined)) throw new Error('from and to must be supplied together')
              const cursor = optionalBoundedString(url.searchParams.get('cursor'), 'cursor', 512)
              const pageSize = optionalPositiveInteger(url.searchParams.get('pageSize'), 'pageSize', 200)
              writeJson(200, { ok: true, diff: scope.dataAgentCatalog.diff(sourceId, fromRunId, toRunId, cursor, pageSize) })
              return
            }

            if (req.method === 'GET' && segments.length === 3 && segments[0] === 'catalog' && segments[1] === 'semantics') {
              assertOnlySearchParams(url.searchParams, ['sourceId', 'version'])
              const sourceId = requireBoundedString(url.searchParams.get('sourceId'), 'sourceId')
              const semanticId = requireBoundedString(segments[2], 'semanticId')
              const version = optionalPositiveInteger(url.searchParams.get('version'), 'version', Number.MAX_SAFE_INTEGER)
              writeJson(200, { ok: true, semantic: scope.dataAgentCatalog.getSemantic(sourceId, semanticId, version) })
              return
            }

            if (req.method === 'POST' && routePathIs(segments, 'catalog', 'semantics')) {
              const body = catalogSemanticSaveBodySchema.parse(await readJson(req))
              const semantic = await scope.dataAgentCatalogReview.saveCandidate(
                body.sourceId, body.definition, body.semanticId, body.expectedVersion,
              )
              writeJson(200, { ok: true, semantic })
              return
            }

            if (req.method === 'POST' && segments.length === 4 && segments[0] === 'catalog'
                && segments[1] === 'semantics' && segments[3] === 'verify') {
              const body = catalogSemanticVerifyBodySchema.parse(await readJson(req))
              const semantic = await scope.dataAgentCatalogReview.verify(
                body.sourceId, requireBoundedString(segments[2], 'semanticId'), body.expectedVersion, body.definition,
              )
              writeJson(200, { ok: true, semantic })
              return
            }

            if (req.method === 'POST' && segments.length === 4 && segments[0] === 'catalog'
                && segments[1] === 'semantics' && segments[3] === 'retire') {
              const body = catalogSemanticRetireBodySchema.parse(await readJson(req))
              const semantic = await scope.dataAgentCatalogReview.retire(
                body.sourceId, requireBoundedString(segments[2], 'semanticId'), body.expectedVersion, body.revisionNote,
              )
              writeJson(200, { ok: true, semantic })
              return
            }

            if (req.method === 'POST' && segments.length === 4 && segments[0] === 'catalog'
                && segments[1] === 'semantics' && segments[3] === 'dismiss') {
              const body = catalogSemanticDismissBodySchema.parse(await readJson(req))
              const semantic = await scope.dataAgentCatalogReview.dismissMeaning(
                body.sourceId, requireBoundedString(segments[2], 'semanticId'), body.expectedVersion,
              )
              writeJson(200, { ok: true, semantic })
              return
            }

            writeJson(404, { error: 'unknown data-agent route' })
          } catch (error) {
            const status = error instanceof CatalogVersionConflictError ? 409 : 400
            writeJson(status, {
              error: sanitizeCatalogRouteError(error instanceof Error ? error.message : String(error)),
              ...error instanceof CatalogVersionConflictError ? { current: error.current } : {},
            })
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

function routePathIs(segments: string[], ...expected: string[]): boolean {
  return segments.length === expected.length && segments.every((value, index) => value === expected[index])
}

const catalogScanBodySchema = zod.strictObject({
  sessionId: zod.string().min(1).max(256),
  sourceId: zod.string().min(1).max(256).optional(),
  scope: catalogScopeSchema,
})

const catalogCancelBodySchema = zod.strictObject({
  sourceId: zod.string().min(1).max(256),
  runId: zod.string().min(1).max(256).optional(),
})

const catalogSemanticSaveBodySchema = zod.strictObject({
  sourceId: zod.string().min(1).max(256),
  semanticId: zod.string().min(1).max(256).optional(),
  expectedVersion: zod.number().int().nonnegative().optional(),
  definition: semanticDefinitionSchema,
})

const catalogSemanticVerifyBodySchema = zod.strictObject({
  sourceId: zod.string().min(1).max(256),
  expectedVersion: zod.number().int().positive(),
  definition: semanticDefinitionSchema,
})

const catalogSemanticRetireBodySchema = zod.strictObject({
  sourceId: zod.string().min(1).max(256),
  expectedVersion: zod.number().int().positive(),
  revisionNote: zod.string().trim().min(1).max(4_096),
})

const catalogSemanticDismissBodySchema = zod.strictObject({
  sourceId: zod.string().min(1).max(256),
  expectedVersion: zod.number().int().positive(),
})

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > 1_048_576) throw new Error('JSON request body exceeds 1 MiB')
    chunks.push(buffer)
  }
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

function requireBoundedString(value: unknown, label: string, max = 256): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new Error(`${label} must be a non-empty string of at most ${max} characters`)
  }
  return value
}

function optionalBoundedString(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireBoundedString(value, label, max)
}

function optionalPositiveInteger(value: string | null, label: string, max: number): number | undefined {
  if (value === null || value === '') return undefined
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error(`${label} must be an integer between 1 and ${max}`)
  return number
}

function optionalBooleanQuery(value: string | null, label: string): boolean | undefined {
  if (value === null || value === '') return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${label} must be true or false`)
}

function csvParam(search: URLSearchParams, name: string): string[] | undefined {
  const value = search.get(name)
  if (value === null || value === '') return undefined
  const items = value.split(',')
  if (items.some(item => item.length === 0 || item.length > 64) || items.length > 32) throw new Error(`${name} is invalid`)
  return items
}

function assertOnlySearchParams(search: URLSearchParams, allowed: readonly string[]): void {
  const accepted = new Set(allowed)
  const seen = new Set<string>()
  for (const key of search.keys()) {
    if (!accepted.has(key)) throw new Error(`Unknown query parameter: ${key}`)
    if (seen.has(key)) throw new Error(`Duplicate query parameter: ${key}`)
    seen.add(key)
  }
}

function sanitizeCatalogRouteError(message: string): string {
  return message
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/(?:\/[^\s/:]+){3,}/g, '[PATH]')
    .slice(0, 4_096)
}
