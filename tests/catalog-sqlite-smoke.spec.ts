/** Real SQLite Catalog smoke through the shared connection, scan, review, and model-tool faces. */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import { describe, expect, it } from 'vitest'
import { createCatalogService } from '../src/catalog.ts'
import { createMemoryCatalogPersistence } from '../src/catalog-storage.ts'
import { applyCatalogTools } from '../src/catalog-tools.ts'
import { createConnectionService } from '../src/connections.ts'

interface ToolFace {
  name?: string
  execute?: (args: Record<string, unknown>, exec: {
    agent?: { id: string }
    signal: AbortSignal
  }) => Promise<Record<string, unknown>>
}

async function waitForRun(service: Awaited<ReturnType<typeof createCatalogService>>, sourceId: string) {
  for (let index = 0; index < 500; index += 1) {
    const run = service.read.status(sourceId)?.latestRun
    if (run !== undefined && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.status)) return run
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error('Catalog SQLite smoke run did not finish')
}

describe('real SQLite Catalog smoke', () => {
  it('scans full and table scopes, diffs, survives disconnect, and serves all three model tools', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-catalog-smoke-'))
    const database = join(directory, 'catalog.db')
    const sessionId = 'catalog-sqlite-smoke'
    const profileId = 'fixture-sqlite'
    try {
      execFileSync('sqlite3', [database, [
        'PRAGMA foreign_keys=ON;',
        'CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL);',
        'CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL, amount INTEGER,',
        '  FOREIGN KEY(customer_id) REFERENCES customers(id));',
        'CREATE INDEX idx_orders_customer ON orders(customer_id);',
      ].join('\n')])

      const runtime = new Context()
      await runtime.plugin(SubprocessLocal)
      const connections = createConnectionService(runtime, {
        connectTimeoutMs: 10_000,
        queryTimeoutMs: 10_000,
        catalogQueryTimeoutMs: 10_000,
        maxResultChars: 1_000_000,
        maxQueryChars: 100_000,
        introspectMaxTables: 10_000,
        readonly: false,
        clients: {},
      })
      await connections.connect(sessionId, {
        type: 'sqlite', database, profileId, name: 'SQLite fixture',
      }, new AbortController().signal)

      let id = 0
      const catalog = await createCatalogService(connections, createMemoryCatalogPersistence(), {
        maxAssetsPerRun: 10_000,
        maxTextChars: 4_096,
        pageSize: 50,
        maxPageSize: 200,
        schemaConcurrency: 2,
        assetConcurrency: 4,
        randomId: () => String(++id),
      })
      const full = await catalog.scanner.start({ sessionId, scope: { kind: 'source' } })
      expect((await waitForRun(catalog, profileId)).status).toBe('succeeded')
      expect(catalog.read.status(profileId)?.counts).toMatchObject({ assets: 8, fields: 5 })

      const page = await catalog.read.search({
        query: 'orders', filters: { sourceId: profileId, includeInferred: false }, pageSize: 25,
      })
      const orders = page.items.find(item => item.kind === 'table')
      expect(orders).toBeDefined()
      const detail = catalog.read.getAsset(profileId, orders!.id)
      expect(detail.fields.map(field => field.payload.name)).toEqual(['id', 'customer_id', 'amount'])
      expect(detail.relations.map(relation => relation.kind).sort()).toEqual(['foreign_key', 'index', 'primary_key'])

      const candidate = await catalog.review.saveCandidate(profileId, {
        kind: 'metric', name: 'GMV', aliases: ['成交金额'], description: 'Order amount',
        sourceAssetIds: [orders!.id], status: 'inferred', formula: 'SUM(amount)', grain: 'day',
        filters: [], exclusions: [], revisionNote: 'fixture candidate',
      })
      await catalog.review.verify(profileId, candidate.semanticId, candidate.version, {
        ...candidate.definition, status: 'verified', revisionNote: 'fixture approved',
      })

      execFileSync('sqlite3', [database, 'ALTER TABLE orders ADD COLUMN ordered_at TEXT;'])
      const partial = await catalog.scanner.start({
        sessionId, scope: { kind: 'table', schema: 'main', table: 'orders' },
      })
      expect((await waitForRun(catalog, profileId)).status).toBe('succeeded')
      expect(catalog.read.status(profileId)?.source.lastFullScanAt).toBeDefined()
      expect(catalog.read.diff(profileId, full.id, partial.id).items).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'added', name: 'ordered_at' }),
      ]))

      await connections.disconnect(sessionId)
      expect(catalog.read.getAsset(profileId, orders!.id).fields.map(field => field.payload.name)).toContain('ordered_at')

      const definitions = new Map<string, ToolFace>()
      applyCatalogTools({
        dataAgentCatalog: catalog.read,
        tools: { register(definition: ToolFace) { definitions.set(definition.name!, definition) } },
      } as never)
      expect([...definitions.keys()].sort()).toEqual(['catalog-get', 'catalog-search', 'metric-get'])
      const exec = { agent: { id: sessionId }, signal: new AbortController().signal }
      const search = await definitions.get('catalog-search')!.execute!({ query: 'orders', sourceId: profileId }, exec)
      expect(search.items).toBeInstanceOf(Array)
      const asset = await definitions.get('catalog-get')!.execute!({ assetId: orders!.id, sourceId: profileId }, exec)
      expect((asset.detail as Record<string, unknown>).asset).toBeDefined()
      const metric = await definitions.get('metric-get')!.execute!({ metricId: candidate.semanticId, sourceId: profileId }, exec)
      expect(metric.definition).toMatchObject({ status: 'verified', formula: 'SUM(amount)' })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 30_000)
})
