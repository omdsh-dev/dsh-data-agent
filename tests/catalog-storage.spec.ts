import { describe, expect, it } from 'vitest'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { catalogAssetId, catalogTechnicalFingerprint, canonicalCatalogIdentity } from '../src/catalog-identity.ts'
import { catalogStorageSpec, createDomainCatalogPersistence, createMemoryCatalogPersistence } from '../src/catalog-storage.ts'
import { metricDefinitionSchema, termDefinitionSchema, type CatalogTechnicalPayload } from '../src/catalog-types.ts'
import { connectionStorageSpec } from '../src/storage.ts'

const observedAt = '2026-08-21T00:00:00.000Z'

function payload(runId = 'run-1'): CatalogTechnicalPayload {
  return {
    identity: {
      sourceId: 'profile-a', database: 'warehouse', schema: 'sales', kind: 'table', name: 'orders',
    },
    name: 'orders',
    path: 'warehouse.sales.orders',
    objectType: 'table',
    comment: 'Business orders',
    provenance: { source: 'database', dialect: 'postgres', runId },
  }
}

describe('Catalog storage and identity', () => {
  it('declares a separate strict version 1 domain and rejects secret/raw-output fields', () => {
    expect(catalogStorageSpec.name).toBe('data_agent_catalog')
    expect(catalogStorageSpec.version).toBe(1)
    expect(Object.keys(catalogStorageSpec.tables).sort()).toEqual([
      'asset_heads', 'asset_revisions', 'index_state', 'observations', 'relations', 'scan_runs',
      'search_index', 'semantic_entries', 'semantic_revisions', 'sources',
    ])
    const source = {
      id: 'p', profileId: 'p', type: 'mysql', name: 'db', database: 'db', credentialConfigured: true,
      createdAt: observedAt, updatedAt: observedAt,
    }
    expect(catalogStorageSpec.tables.sources.valueSchema.safeParse({ ...source, password: 'secret' }).success).toBe(false)
    expect(catalogStorageSpec.tables.scan_runs.valueSchema.safeParse({
      id: 'r', sourceId: 'p', sessionId: 's', scope: { kind: 'source' }, status: 'failed',
      coverageComplete: false, progress: { schemas: 0, relations: 0, fields: 0, assets: 0 },
      createdAt: observedAt, stdout: 'raw business rows',
    }).success).toBe(false)
  })

  it('keeps source/schema identity structured and dialect-aware', () => {
    const base = { sourceId: 'profile-a', database: 'warehouse', schema: 'Sales', kind: 'table' as const, name: 'Orders' }
    expect(catalogAssetId('mysql', base)).toBe(catalogAssetId('mysql', { ...base, schema: 'sales', name: 'orders' }))
    expect(catalogAssetId('postgres', base)).not.toBe(catalogAssetId('postgres', { ...base, schema: 'Archive' }))
    expect(catalogAssetId('postgres', base)).not.toBe(catalogAssetId('postgres', { ...base, sourceId: 'profile-b' }))
    expect(canonicalCatalogIdentity('oracle', base)).toMatchObject({ schema: 'SALES', name: 'ORDERS' })
    const child = { ...base, kind: 'column' as const, relation: 'Orders', name: 'ID' }
    expect(catalogAssetId('mysql', child)).not.toBe(catalogAssetId('mysql', base))
    expect(catalogAssetId('mysql', child)).toBe(catalogAssetId('mysql', { ...child, relation: 'orders', name: 'id' }))
  })

  it('excludes run provenance from unchanged technical fingerprints', () => {
    expect(catalogTechnicalFingerprint(payload('run-1'))).toBe(catalogTechnicalFingerprint(payload('run-2')))
    expect(catalogTechnicalFingerprint({ ...payload(), path: 'a.changed.display.path' })).toBe(catalogTechnicalFingerprint(payload()))
    expect(catalogTechnicalFingerprint({ ...payload(), dataType: 'changed' })).not.toBe(catalogTechnicalFingerprint(payload()))
  })

  it('strictly validates semantic validity windows and metric-specific fields', () => {
    const base = {
      name: 'GMV', aliases: [], description: 'Gross merchandise value', sourceAssetIds: [], status: 'inferred' as const,
      validFrom: '2026-08-22T00:00:00.000Z', validTo: '2026-08-21T00:00:00.000Z',
    }
    expect(termDefinitionSchema.safeParse({ kind: 'term', ...base }).success).toBe(false)
    expect(metricDefinitionSchema.safeParse({ kind: 'metric', ...base, formula: '', grain: '', filters: [], exclusions: [] }).success).toBe(false)
  })

  it('provides a strict process-local persistence seam for focused service tests', async () => {
    const persistence = createMemoryCatalogPersistence()
    await persistence.putSource({
      id: 'p', profileId: 'p', type: 'sqlite', name: 'fixture', database: '/tmp/fixture.db',
      credentialConfigured: true, createdAt: observedAt, updatedAt: observedAt,
    })
    expect(persistence.listSources()).toHaveLength(1)
    await expect(persistence.putSource({
      id: 'p', profileId: 'p', type: 'sqlite', name: 'fixture', database: '/tmp/fixture.db',
      credentialConfigured: true, createdAt: observedAt, updatedAt: observedAt,
      password: 'forbidden',
    } as never)).rejects.toThrow()
  })

  it('creates an empty v1 domain without migrating connections and survives an old-package rollback cycle', async () => {
    const media = new Map<string, { version: number; tables: Record<string, Record<string, unknown>>; global: unknown }>()
    const opened = new Set<string>()
    const backend = {
      kv: {
        async open(descriptor: { name: string; version: number; tables: readonly string[] }) {
          if (opened.has(descriptor.name)) throw new Error('already open')
          opened.add(descriptor.name)
          const existing = media.get(descriptor.name)
          if (existing !== undefined && existing.version !== descriptor.version) throw new Error('version mismatch')
          const state = existing ?? {
            version: descriptor.version,
            tables: Object.fromEntries(descriptor.tables.map(table => [table, {}])),
            global: null,
          }
          media.set(descriptor.name, state)
          return {
            async loadAll() { return { tables: state.tables, global: state.global } },
            async putRecord(table: string, key: string, value: unknown) { state.tables[table]![key] = value },
            async deleteRecord(table: string, key: string) { delete state.tables[table]![key] },
            async setGlobal(value: unknown) { state.global = value },
            async close() { opened.delete(descriptor.name) },
          }
        },
      },
      async close() {},
    }
    const facility = new DomainFacility({
      storage: { backend: { get: () => backend } },
      emit() {},
      logger: { warn() {} },
    } as never, { backend: 'fixture' })

    const connections = await facility.open(connectionStorageSpec)
    await connections.table('profiles').put('profile-a', {
      type: 'sqlite', database: '/tmp/catalog-fixture.db', credentialMode: 'none', updatedAt: observedAt,
    })
    const firstCatalog = await facility.open(catalogStorageSpec)
    const catalog = createDomainCatalogPersistence(firstCatalog)
    expect(catalog.listSources()).toEqual([])
    expect(connections.table('profiles').get('profile-a')?.database).toBe('/tmp/catalog-fixture.db')
    await catalog.putSource({
      id: 'profile-a', profileId: 'profile-a', type: 'sqlite', name: 'Fixture', database: 'catalog-fixture.db',
      credentialConfigured: true, createdAt: observedAt, updatedAt: observedAt,
    })
    await firstCatalog.close()
    await connections.close()

    const rollbackConnections = await facility.open(connectionStorageSpec)
    expect(rollbackConnections.table('profiles').get('profile-a')?.database).toBe('/tmp/catalog-fixture.db')
    await rollbackConnections.close()

    const upgradedCatalog = await facility.open(catalogStorageSpec)
    expect(createDomainCatalogPersistence(upgradedCatalog).listSources()).toEqual([
      expect.objectContaining({ id: 'profile-a', database: 'catalog-fixture.db' }),
    ])
    await upgradedCatalog.close()
  })
})
