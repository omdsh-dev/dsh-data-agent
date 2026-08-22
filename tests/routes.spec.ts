import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { apply, validateConnectBody, type Config } from '../src/routes.ts'

const config: Config = {
  connectTimeoutMs: 5_000,
  introspectMaxTables: 100,
  maxResultChars: 20_000,
  queryTimeoutMs: 5_000,
  maxQueryChars: 10_000,
  readonly: false,
}

function routeFixture(ready = true) {
  let handler: ((req: any, res: any) => Promise<void>) | undefined
  const calls: { method: string; args: unknown[] }[] = []
  const summary = {
    type: 'mysql' as const, host: 'db', database: 'orders', passwordRef: 'DB_PASSWORD',
    credentialMode: 'reference' as const,
    credential: { configured: ready, source: 'env' },
    ready,
    reconnectRequired: !ready,
  }
  const service = {
    async connect(...args: unknown[]) { calls.push({ method: 'connect', args }); return { tables: ['users'], summary } },
    async disconnect(...args: unknown[]) { calls.push({ method: 'disconnect', args }) },
    async status(...args: unknown[]) { calls.push({ method: 'status', args }); return summary },
    async listSchemas(...args: unknown[]) { calls.push({ method: 'listSchemas', args }); return ['public'] },
    async listTables(...args: unknown[]) { calls.push({ method: 'listTables', args }); return ['users'] },
    async describe(...args: unknown[]) { calls.push({ method: 'describe', args }); return [{ name: 'id', type: 'int' }] },
    async query(...args: unknown[]) { calls.push({ method: 'query', args }); return { exitCode: 0, stdout: '1\n', stderr: '', truncated: false } },
    async executeInteractive(...args: unknown[]) {
      calls.push({ method: 'executeInteractive', args })
      return { kind: 'table', columns: ['id'], rows: [{ id: '1' }], elapsedMs: 3, truncated: false, maxRows: 50_000 }
    },
  }
  const source = {
    id: 'profile-a', profileId: 'profile-a', type: 'mysql' as const, name: 'Orders', database: 'orders',
    credentialConfigured: true, createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
  }
  const catalogRun = {
    id: 'run-a', sourceId: 'profile-a', sessionId: 's', scope: { kind: 'source' as const }, status: 'queued' as const,
    coverageComplete: false, progress: { schemas: 0, relations: 0, fields: 0, assets: 0 }, createdAt: '2026-08-21T00:00:00.000Z',
  }
  const catalog = {
    listSources() { calls.push({ method: 'catalog.listSources', args: [] }); return [source] },
    listRuns(...args: unknown[]) { calls.push({ method: 'catalog.listRuns', args }); return [catalogRun] },
    status(...args: unknown[]) {
      calls.push({ method: 'catalog.status', args })
      return { source, latestRun: catalogRun, counts: { assets: 1, fields: 0, needsReview: 0 } }
    },
    async search(...args: unknown[]) {
      calls.push({ method: 'catalog.search', args })
      return { sourceId: 'profile-a', query: 'orders', items: [], truncated: false, warnings: [] }
    },
    getAsset(...args: unknown[]) {
      calls.push({ method: 'catalog.getAsset', args })
      return { asset: { assetId: 'asset-a' }, fields: [], relations: [], semantics: [], truncated: false, untrusted: true }
    },
    diff(...args: unknown[]) {
      calls.push({ method: 'catalog.diff', args })
      return { sourceId: 'profile-a', fromRunId: 'a', toRunId: 'b', scope: { kind: 'source' }, items: [], truncated: false }
    },
    getSemantic(...args: unknown[]) {
      calls.push({ method: 'catalog.getSemantic', args })
      return { semanticId: 'metric-a', version: 1 }
    },
  }
  const scanner = {
    async start(...args: unknown[]) { calls.push({ method: 'catalog.start', args }); return catalogRun },
    async cancel(...args: unknown[]) { calls.push({ method: 'catalog.cancel', args }); return catalogRun },
  }
  const review = {
    async saveCandidate(...args: unknown[]) { calls.push({ method: 'catalog.saveCandidate', args }); return { semanticId: 'metric-a', version: 1 } },
    async verify(...args: unknown[]) { calls.push({ method: 'catalog.verify', args }); return { semanticId: 'metric-a', version: 2 } },
    async retire(...args: unknown[]) { calls.push({ method: 'catalog.retire', args }); return { semanticId: 'metric-a', version: 3 } },
    async dismissMeaning(...args: unknown[]) { calls.push({ method: 'catalog.dismissMeaning', args }); return { semanticId: 'meaning-a', version: 2 } },
  }
  const ctx: any = {
    dataAgentConnections: service,
    dataAgentCatalog: catalog,
    dataAgentCatalogScanner: scanner,
    dataAgentCatalogReview: review,
    webServer: {
      register(route: { handler: typeof handler }) { handler = route.handler; return () => {} },
    },
    inject(_deps: string[], callback: (scope: any) => void) { callback(ctx) },
    effect(callback: () => unknown) { callback() },
  }
  apply(ctx, config)
  return { calls, get handler() { return handler! } }
}

function request(method: string, url: string, body?: unknown) {
  const source = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = Readable.from(source) as any
  req.method = method
  req.url = url
  return req
}

async function dispatch(handler: (req: any, res: any) => Promise<void>, method: string, url: string, body?: unknown) {
  let status = 0
  let text = ''
  await handler(request(method, url, body), {
    writeHead(next: number) { status = next },
    end(value: string) { text = value },
  })
  return { status, body: JSON.parse(text) as Record<string, unknown> }
}

describe('Web route adapter', () => {
  it('validates passwordRef/profile fields and rejects two secret sources', () => {
    expect(validateConnectBody({
      sessionId: 's', type: 'mysql', database: 'orders', passwordRef: 'DB_PASSWORD',
      profileId: 'analytics', name: 'Analytics', readonly: true,
    })).toMatchObject({ passwordRef: 'DB_PASSWORD', profileId: 'analytics', name: 'Analytics', readonly: true })
    expect(() => validateConnectBody({
      sessionId: 's', type: 'mysql', database: 'orders', password: 'plain', passwordRef: 'DB_PASSWORD',
    })).toThrow(/不能同时提供/)
    expect(validateConnectBody({
      sessionId: 's', type: 'clickhouse', database: 'analytics', secure: true,
    })).toMatchObject({ type: 'clickhouse', secure: true })
    expect(validateConnectBody({ sessionId: 's', type: 'doris', database: 'analytics' }).type).toBe('doris')
    expect(validateConnectBody({ sessionId: 's', type: 'sqlserver', database: 'warehouse' }).type).toBe('sqlserver')
    expect(() => validateConnectBody({ sessionId: 's', type: 'future-db', database: 'x' })).toThrow(/受支持/)
  })

  it('keeps the connect path/response and delegates to the shared service', async () => {
    const fixture = routeFixture()
    const response = await dispatch(fixture.handler, 'POST', '/plugins/data-agent/connect', {
      sessionId: 's', type: 'mysql', host: 'db', database: 'orders', passwordRef: 'DB_PASSWORD',
    })
    expect(response).toMatchObject({ status: 200, body: { ok: true, tables: ['users'] } })
    expect(fixture.calls[0]!.method).toBe('connect')
    expect(fixture.calls[0]!.args[0]).toBe('s')
    expect(fixture.calls[0]!.args[1]).toMatchObject({ type: 'mysql', passwordRef: 'DB_PASSWORD' })
  })

  it('delegates status, metadata, query, and disconnect without private state', async () => {
    const fixture = routeFixture()
    expect((await dispatch(fixture.handler, 'GET', '/plugins/data-agent/status?sessionId=s')).body).toMatchObject({ connected: true })
    expect((await dispatch(fixture.handler, 'GET', '/plugins/data-agent/schemas?sessionId=s')).body).toEqual({ ok: true, schemas: ['public'] })
    expect((await dispatch(fixture.handler, 'GET', '/plugins/data-agent/tables?sessionId=s&schema=public')).body).toEqual({ ok: true, tables: ['users'] })
    expect((await dispatch(fixture.handler, 'GET', '/plugins/data-agent/describe?sessionId=s&schema=public&table=users')).body).toMatchObject({ ok: true })
    expect((await dispatch(fixture.handler, 'POST', '/plugins/data-agent/query', { sessionId: 's', sql: 'SELECT 1;' })).body).toMatchObject({ ok: true })
    expect((await dispatch(fixture.handler, 'POST', '/plugins/data-agent/disconnect', { sessionId: 's' })).body).toEqual({ ok: true })
    expect(fixture.calls.map(call => call.method)).toEqual([
      'status', 'listSchemas', 'listTables', 'describe', 'executeInteractive', 'disconnect',
    ])
  })

  it('does not report a durable profile as connected when credentials need restoring', async () => {
    const fixture = routeFixture(false)
    expect((await dispatch(fixture.handler, 'GET', '/plugins/data-agent/status?sessionId=s')).body).toMatchObject({
      connected: false,
      reconnectRequired: true,
      summary: { ready: false, reconnectRequired: true },
    })
  })

  it('serves bounded Catalog reads and scan control through the shared faces', async () => {
    const fixture = routeFixture()
    expect((await dispatch(fixture.handler, 'GET', '/plugins/data-agent/catalog/sources')).body).toMatchObject({
      ok: true, sources: [{ id: 'profile-a' }],
    })
    expect((await dispatch(fixture.handler, 'GET', '/plugins/data-agent/catalog/status?sourceId=profile-a')).body)
      .toMatchObject({ ok: true, status: { counts: { assets: 1 } } })
    expect((await dispatch(fixture.handler, 'GET', '/plugins/data-agent/catalog/search?sourceId=profile-a&query=orders&pageSize=25')).body)
      .toMatchObject({ ok: true, page: { sourceId: 'profile-a' } })
    expect((await dispatch(fixture.handler, 'GET', '/plugins/data-agent/catalog/assets/asset-a?sourceId=profile-a&pageSize=25')).body)
      .toMatchObject({ ok: true, detail: { truncated: false } })
    const scan = await dispatch(fixture.handler, 'POST', '/plugins/data-agent/catalog/scan', {
      sessionId: 's', scope: { kind: 'schema', schema: 'sales' },
    })
    expect(scan).toMatchObject({ status: 202, body: { ok: true, run: { id: 'run-a' } } })
    expect(fixture.calls.find(call => call.method === 'catalog.start')?.args[0]).toEqual({
      sessionId: 's', scope: { kind: 'schema', schema: 'sales' },
    })
  })

  it('strictly rejects malformed Catalog scope, unknown fields, and oversized pages before mutation', async () => {
    const fixture = routeFixture()
    expect((await dispatch(fixture.handler, 'POST', '/plugins/data-agent/catalog/scan', {
      sessionId: 's', scope: { kind: 'source', table: 'orders' },
    })).status).toBe(400)
    expect((await dispatch(fixture.handler, 'POST', '/plugins/data-agent/catalog/scan', {
      sessionId: 's', scope: { kind: 'source' }, password: 'forbidden',
    })).status).toBe(400)
    expect((await dispatch(fixture.handler, 'GET', '/plugins/data-agent/catalog/search?sourceId=profile-a&query=x&pageSize=201')).status).toBe(400)
    expect((await dispatch(fixture.handler, 'GET', '/plugins/data-agent/catalog/search?sourceId=profile-a&query=x&includeInferred=yes')).status).toBe(400)
    expect((await dispatch(fixture.handler, 'GET', '/plugins/data-agent/catalog/search?sourceId=profile-a&query=x&unknown=true')).status).toBe(400)
    expect((await dispatch(fixture.handler, 'GET', '/plugins/data-agent/catalog/search?sourceId=profile-a&query=x&query=y')).status).toBe(400)
    expect(fixture.calls.some(call => call.method === 'catalog.start')).toBe(false)
  })

  it('keeps human semantic mutations on review routes rather than the read face', async () => {
    const fixture = routeFixture()
    const definition = {
      kind: 'metric', name: 'GMV', aliases: [], description: 'GMV', sourceAssetIds: ['asset-a'],
      status: 'inferred', formula: 'SUM(amount)', grain: 'day', filters: [], exclusions: [], revisionNote: 'draft',
    }
    expect((await dispatch(fixture.handler, 'POST', '/plugins/data-agent/catalog/semantics', {
      sourceId: 'profile-a', expectedVersion: 0, definition,
    })).body).toMatchObject({ ok: true, semantic: { version: 1 } })
    expect((await dispatch(fixture.handler, 'POST', '/plugins/data-agent/catalog/semantics/metric-a/verify', {
      sourceId: 'profile-a', expectedVersion: 1, definition: { ...definition, status: 'verified', revisionNote: 'approved' },
    })).body).toMatchObject({ ok: true, semantic: { version: 2 } })
    expect((await dispatch(fixture.handler, 'POST', '/plugins/data-agent/catalog/semantics/meaning-a/dismiss', {
      sourceId: 'profile-a', expectedVersion: 1,
    })).body).toMatchObject({ ok: true, semantic: { version: 2 } })
    expect(fixture.calls.map(call => call.method)).toEqual(['catalog.saveCandidate', 'catalog.verify', 'catalog.dismissMeaning'])
  })
})
