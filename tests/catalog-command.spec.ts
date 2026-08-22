import { describe, expect, it } from 'vitest'
import {
  CATALOG_COMMAND_USAGE,
  executeCatalogCommand,
  parseCatalogAction,
} from '../src/catalog-command.ts'

function invocation(rawInput: string) {
  return {
    commandId: 'catalog', agent: { id: 'session-a' }, rawInput, signal: new AbortController().signal,
  } as never
}

function fixture(questions?: { ask(request: any): Promise<any> }) {
  const calls: { method: string; value?: unknown }[] = []
  const source = {
    id: 'profile-a', profileId: 'profile-a', type: 'mysql', name: 'Orders', database: 'orders',
    credentialConfigured: true, createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
  }
  const run = {
    id: 'run-a', sourceId: 'profile-a', sessionId: 'session-a', scope: { kind: 'source' }, status: 'queued',
    coverageComplete: false, progress: { schemas: 0, relations: 0, fields: 0, assets: 0 },
    createdAt: '2026-08-21T00:00:00.000Z',
  }
  const ctx = {
    dataAgentConnections: { get: () => ({ profileId: 'profile-a' }) },
    dataAgentCatalog: {
      listSources: () => [source],
      listRuns: () => [run],
      status: () => ({ source, latestRun: run, counts: { assets: 0, fields: 0, needsReview: 0 } }),
      diff: () => ({
        sourceId: 'profile-a', fromRunId: 'run-0', toRunId: 'run-a', scope: { kind: 'source' },
        items: [], truncated: false,
      }),
    },
    dataAgentCatalogScanner: {
      async start(value: unknown) { calls.push({ method: 'start', value }); return run },
      async cancel(_sourceId: string, runId?: string) { calls.push({ method: 'cancel', value: runId }); return run },
    },
    get(name: string) { return name === 'userQuestions' ? questions : undefined },
  }
  return { ctx: ctx as never, calls }
}

describe('/catalog command', () => {
  it('parses explicit scan scopes and rejects unsafe or ambiguous combinations', () => {
    expect(parseCatalogAction('scan --all')).toEqual({ kind: 'scan', scope: { kind: 'source' } })
    expect(parseCatalogAction('scan --schema sales')).toEqual({ kind: 'scan', scope: { kind: 'schema', schema: 'sales' } })
    expect(parseCatalogAction('scan --schema sales --table orders')).toEqual({
      kind: 'scan', scope: { kind: 'table', schema: 'sales', table: 'orders' },
    })
    expect(() => parseCatalogAction('scan --table orders')).toThrow(/--schema/)
    expect(() => parseCatalogAction('scan --all --schema sales')).toThrow(/不能/)
    expect(() => parseCatalogAction('scan --password secret')).toThrow(/secret/)
    expect(() => parseCatalogAction('scan --future x')).toThrow(/未知/)
    expect(parseCatalogAction('status --run run-a')).toEqual({ kind: 'status', runId: 'run-a' })
    expect(parseCatalogAction('view')).toEqual({ kind: 'view' })
    expect(() => parseCatalogAction('view --run run-a')).toThrow(/不接受额外参数/)
    expect(() => parseCatalogAction('status --from run-a')).toThrow(/未知/)
    expect(CATALOG_COMMAND_USAGE).toContain('/catalog diff')
    expect(CATALOG_COMMAND_USAGE).toContain('/catalog view')
  })

  it('does not silently turn a non-interactive empty scan into full-source coverage', async () => {
    const value = fixture()
    const result = await executeCatalogCommand(value.ctx, invocation('scan'))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('未开始扫描')
    expect(value.calls).toHaveLength(0)
  })

  it('starts explicit scans and returns a stable run id immediately', async () => {
    const value = fixture()
    const result = await executeCatalogCommand(value.ctx, invocation('scan --schema sales --table orders'))
    expect(result).toMatchObject({ kind: 'success' })
    expect(result.text).toContain('run-a')
    expect(value.calls[0]).toEqual({
      method: 'start',
      value: { sessionId: 'session-a', scope: { kind: 'table', schema: 'sales', table: 'orders' } },
    })
  })

  it('starts persistent TUI presentation and opens the read-only Catalog scene', async () => {
    const value = fixture()
    const watched: string[] = []
    const opened: string[] = []
    const presentation = {
      watch(run: { id: string }) { watched.push(run.id) },
      open(sessionId: string) { opened.push(sessionId); return true },
    } as never
    expect((await executeCatalogCommand(value.ctx, invocation('scan --all'), presentation)).kind).toBe('success')
    expect(watched).toEqual(['run-a'])
    expect(await executeCatalogCommand(value.ctx, invocation('view'), presentation)).toEqual({ kind: 'success' })
    expect(opened).toEqual(['session-a'])
  })

  it('reports an actionable view fallback when the loaded TUI lacks scene support', async () => {
    const value = fixture()
    const result = await executeCatalogCommand(value.ctx, invocation('view'))
    expect(result.kind).toBe('error')
    expect(result.text).toContain('升级dsh-tui')
  })

  it('requires a second confirmation for an interactive full scan', async () => {
    let turn = 0
    const value = fixture({
      async ask() {
        turn += 1
        return turn === 1
          ? { answers: [{ id: 'scope', selected: ['全库'] }] }
          : { answers: [{ id: 'confirm', selected: ['确认'] }] }
      },
    })
    expect((await executeCatalogCommand(value.ctx, invocation('scan'))).kind).toBe('success')
    expect(value.calls[0]?.value).toMatchObject({ scope: { kind: 'source' } })
  })

  it('returns bounded status/cancel/diff summaries through the shared service', async () => {
    const value = fixture()
    expect((await executeCatalogCommand(value.ctx, invocation('status'))).text).toContain('run-a')
    expect((await executeCatalogCommand(value.ctx, invocation('status --run run-a'))).text).toContain('run-a')
    expect((await executeCatalogCommand(value.ctx, invocation('status --run missing'))).kind).toBe('error')
    expect((await executeCatalogCommand(value.ctx, invocation('cancel --run run-a'))).kind).toBe('success')
    expect((await executeCatalogCommand(value.ctx, invocation('diff --from run-0 --to run-a'))).text).toContain('run-0 → run-a')
  })
})
