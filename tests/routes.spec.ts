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
  }
  const ctx: any = {
    dataAgentConnections: service,
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
      'status', 'listSchemas', 'listTables', 'describe', 'query', 'disconnect',
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
})
