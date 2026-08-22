import { describe, expect, it } from 'vitest'
import { createCatalogService, CatalogVersionConflictError } from '../src/catalog.ts'
import { catalogAssetId, catalogTechnicalFingerprint } from '../src/catalog-identity.ts'
import { createMemoryCatalogPersistence } from '../src/catalog-storage.ts'
import { createCatalogAdapterRegistry, type CatalogAdapter, type CatalogAdapterContext } from '../src/catalog-adapters.ts'
import type { CatalogAssetStatus, CatalogObservation, CatalogRelation, CatalogTechnicalPayload } from '../src/catalog-types.ts'

function connectionFixture() {
  const connection = {
    type: 'sqlite' as const,
    database: '/tmp/catalog-fixture.db',
    profileId: 'profile-fixture',
    name: 'Fixture',
  }
  return {
    get: () => connection,
    resolveForExecution: async () => connection,
  } as never
}

function tableObservation(
  context: CatalogAdapterContext,
  name = 'orders',
  comment = 'Order facts',
  schema = 'main',
): CatalogObservation {
  const identity = {
    sourceId: context.sourceId,
    database: context.connection.database,
    schema,
    kind: 'table' as const,
    name,
  }
  const payload: CatalogTechnicalPayload = {
    identity,
    name,
    path: `${context.connection.database}.${schema}.${name}`,
    objectType: 'table',
    comment,
    provenance: { source: 'database', dialect: 'sqlite', runId: context.runId },
  }
  return {
    runId: context.runId,
    sourceId: context.sourceId,
    assetId: catalogAssetId('sqlite', identity),
    status: 'observed',
    fingerprint: catalogTechnicalFingerprint(payload),
    observedAt: '2026-08-21T00:00:00.000Z',
    payload,
  }
}

function columnObservation(
  context: CatalogAdapterContext,
  table: string,
  name: string,
  dataType: string,
): CatalogObservation {
  const tableIdentity = {
    sourceId: context.sourceId,
    database: context.connection.database,
    schema: 'main',
    kind: 'table' as const,
    name: table,
  }
  const identity = {
    sourceId: context.sourceId,
    database: context.connection.database,
    schema: 'main',
    relation: table,
    kind: 'column' as const,
    name,
  }
  const payload: CatalogTechnicalPayload = {
    identity,
    name,
    path: `${context.connection.database}.main.${table}.${name}`,
    parentId: catalogAssetId('sqlite', tableIdentity),
    dataType,
    nullable: false,
    ordinal: 1,
    provenance: { source: 'database', dialect: 'sqlite', runId: context.runId },
  }
  return {
    runId: context.runId,
    sourceId: context.sourceId,
    assetId: catalogAssetId('sqlite', identity),
    status: 'observed',
    fingerprint: catalogTechnicalFingerprint(payload),
    observedAt: '2026-08-21T00:00:00.000Z',
    payload,
  }
}

function schemaObservation(
  context: CatalogAdapterContext,
  status: CatalogAssetStatus = 'observed',
  schema = 'main',
): CatalogObservation {
  const identity = {
    sourceId: context.sourceId,
    database: context.connection.database,
    schema,
    kind: 'schema' as const,
    name: schema,
  }
  const payload: CatalogTechnicalPayload = {
    identity,
    name: schema,
    path: `${context.connection.database}.${schema}`,
    provenance: { source: 'database', dialect: 'sqlite', runId: context.runId },
  }
  return {
    runId: context.runId,
    sourceId: context.sourceId,
    assetId: catalogAssetId('sqlite', identity),
    status,
    fingerprint: catalogTechnicalFingerprint(payload, status),
    observedAt: '2026-08-21T00:00:00.000Z',
    payload,
  }
}

async function waitForTerminal(service: Awaited<ReturnType<typeof createCatalogService>>, sourceId: string) {
  for (let index = 0; index < 500; index += 1) {
    const run = service.read.status(sourceId)?.latestRun
    if (run !== undefined && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.status)) return run
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('run did not finish')
}

async function waitForEnrichment(service: Awaited<ReturnType<typeof createCatalogService>>, sourceId: string) {
  for (let index = 0; index < 500; index += 1) {
    const run = service.read.status(sourceId)?.latestRun
    if (run?.enrichment !== undefined && !['queued', 'running'].includes(run.enrichment.status)) return run
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('enrichment did not finish')
}

describe('Catalog shared service', () => {
  it('generates table/field meanings, confirms or deletes them, and preserves human decisions on rescan', async () => {
    let runId = 0
    let generation = 0
    const adapter: CatalogAdapter = {
      type: 'sqlite', capabilities: {},
      async scan(context) {
        return {
          observations: [tableObservation(context), columnObservation(context, 'orders', 'amount', 'decimal(12,2)')],
          relations: [], coverageComplete: true, unavailableScopes: [],
        }
      },
    }
    const persistence = createMemoryCatalogPersistence()
    const service = await createCatalogService(connectionFixture(), persistence, {
      maxAssetsPerRun: 100, maxTextChars: 4_096, pageSize: 20, maxPageSize: 100,
      schemaConcurrency: 1, assetConcurrency: 1, adapters: { sqlite: adapter },
      randomId: () => String(++runId),
      meaningGenerator: {
        capture: () => ({ provider: 'fixture-provider', model: 'fixture-model' }),
        async generate(_selection, input) {
          generation += 1
          return {
            table: { assetId: input.assetId, meaning: `订单业务记录 ${generation}` },
            fields: input.fields.map(field => ({ assetId: field.assetId, meaning: `订单金额 ${generation}` })),
          }
        },
      },
    })

    await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    const firstRun = await waitForEnrichment(service, 'profile-fixture')
    expect(firstRun.enrichment).toMatchObject({
      status: 'succeeded', provider: 'fixture-provider', model: 'fixture-model',
      tablesTotal: 1, tablesCompleted: 1, tablesFailed: 0, candidatesGenerated: 2,
    })
    const tableId = persistence.listAssetHeads('profile-fixture')
      .map(head => service.read.getAsset('profile-fixture', head.assetId).asset)
      .find(revision => revision.payload.identity.kind === 'table')!.assetId
    const firstDetail = service.read.getAsset('profile-fixture', tableId)
    expect(firstDetail.semantics).toHaveLength(2)
    const tableMeaning = firstDetail.semantics.find(value => value.definition.kind === 'meaning'
      && value.definition.targetKind === 'table')!
    const fieldMeaning = firstDetail.semantics.find(value => value.definition.kind === 'meaning'
      && value.definition.targetKind === 'column')!
    const verified = await service.review.verify('profile-fixture', tableMeaning.semanticId, tableMeaning.version, {
      ...tableMeaning.definition, status: 'verified', revisionNote: '业务负责人确认',
    })
    await service.review.dismissMeaning('profile-fixture', fieldMeaning.semanticId, fieldMeaning.version)

    await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    await waitForEnrichment(service, 'profile-fixture')
    const secondDetail = service.read.getAsset('profile-fixture', tableId)
    expect(secondDetail.semantics).toHaveLength(1)
    expect(secondDetail.semantics[0]).toMatchObject({ semanticId: verified.semanticId, version: verified.version, definition: { status: 'verified' } })
    expect(persistence.listSemanticRevisions(fieldMeaning.semanticId)).toHaveLength(2)
  })

  it('keeps the technical snapshot visible and reports partial AI enrichment when one table fails', async () => {
    const adapter: CatalogAdapter = {
      type: 'sqlite', capabilities: {},
      async scan(context) {
        return {
          observations: [tableObservation(context, 'orders'), tableObservation(context, 'users')],
          relations: [], coverageComplete: true, unavailableScopes: [],
        }
      },
    }
    const persistence = createMemoryCatalogPersistence()
    const service = await createCatalogService(connectionFixture(), persistence, {
      maxAssetsPerRun: 100, maxTextChars: 4_096, pageSize: 20, maxPageSize: 100,
      schemaConcurrency: 1, assetConcurrency: 1, adapters: { sqlite: adapter }, randomId: () => 'partial-ai',
      meaningGenerator: {
        capture: () => ({ provider: 'fixture-provider', model: 'fixture-model' }),
        async generate(_selection, input) {
          if (input.name === 'users') throw new Error('invalid JSON from fixture model')
          return { table: { assetId: input.assetId, meaning: '订单记录' }, fields: [] }
        },
      },
    })
    await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    const run = await waitForEnrichment(service, 'profile-fixture')
    expect(run).toMatchObject({ status: 'succeeded', enrichment: {
      status: 'partial', tablesTotal: 2, tablesCompleted: 1, tablesFailed: 1, candidatesGenerated: 1,
    } })
    expect(run.enrichment?.error).toContain('users')
    const visibleTables = persistence.listAssetHeads('profile-fixture').map(head => (
      service.read.getAsset('profile-fixture', head.assetId).asset.payload.name
    ))
    expect(visibleTables.sort()).toEqual(['orders', 'users'])
  })
  it('publishes view columns whose metadata rows arrive before their parent relation', async () => {
    const connection = {
      type: 'mysql' as const,
      database: 'warehouse',
      profileId: 'profile-view-fixture',
      name: 'View fixture',
    }
    const output = [
      'row_kind\tTABLE_SCHEMA\tTABLE_NAME\tdetail\tcomment\tcolumn\ttype\tnullable\tcolumn_comment\tordinal',
      'column\tsales\torder_summary\t\t\torder_id\tbigint\tNO\tIdentifier\t1',
      'relation\tsales\torder_summary\tVIEW\tOrder summary\t\t\t\t\t0',
    ].join('\n')
    const connections = {
      get: () => connection,
      resolveForExecution: async () => connection,
      listSchemas: async () => ['sales'],
      queryMetadata: async () => ({ stdout: output, stderr: '', exitCode: 0, truncated: false }),
    } as never
    const persistence = createMemoryCatalogPersistence()
    const service = await createCatalogService(connections, persistence, {
      maxAssetsPerRun: 100, maxTextChars: 4_096, pageSize: 20, maxPageSize: 100,
      schemaConcurrency: 1, assetConcurrency: 1,
      adapters: { mysql: createCatalogAdapterRegistry().mysql }, randomId: () => 'view-order',
    })
    await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    expect(await waitForTerminal(service, connection.profileId)).toMatchObject({ status: 'succeeded' })
    const currentKinds = persistence.listAssetHeads(connection.profileId).map(head => (
      service.read.getAsset(connection.profileId, head.assetId).asset.payload.identity.kind
    ))
    expect(currentKinds.sort()).toEqual(['column', 'schema', 'view'])
  })

  it('publishes successful revisions, deduplicates fingerprints, and marks missing only after complete coverage', async () => {
    let scan = 0
    const adapter: CatalogAdapter = {
      type: 'sqlite',
      capabilities: {},
      async scan(context) {
        scan += 1
        const observations = scan < 3 ? [tableObservation(context)] : []
        observations.forEach(() => context.onProgress?.('relation'))
        return { observations, relations: [], coverageComplete: true, unavailableScopes: [] }
      },
    }
    const persistence = createMemoryCatalogPersistence()
    let id = 0
    const service = await createCatalogService(connectionFixture(), persistence, {
      maxAssetsPerRun: 100,
      maxTextChars: 4_096,
      pageSize: 20,
      maxPageSize: 100,
      schemaConcurrency: 2,
      assetConcurrency: 2,
      adapters: { sqlite: adapter },
      randomId: () => String(++id),
    })

    await service.scanner.start({ sessionId: 's', scope: { kind: 'schema', schema: 'main' } })
    expect((await waitForTerminal(service, 'profile-fixture')).status).toBe('succeeded')
    const assetId = catalogAssetId('sqlite', {
      sourceId: 'profile-fixture', database: '/tmp/catalog-fixture.db', schema: 'main', kind: 'table', name: 'orders',
    })
    expect(service.read.getAsset('profile-fixture', assetId).asset.status).toBe('observed')

    await service.scanner.start({ sessionId: 's', scope: { kind: 'schema', schema: 'main' } })
    await waitForTerminal(service, 'profile-fixture')
    expect(persistence.listAssetRevisions(assetId)).toHaveLength(1)

    await service.scanner.start({ sessionId: 's', scope: { kind: 'schema', schema: 'main' } })
    await waitForTerminal(service, 'profile-fixture')
    expect(service.read.getAsset('profile-fixture', assetId).asset.status).toBe('missing')
    expect(persistence.listAssetRevisions(assetId)).toHaveLength(2)
    const reopened = await createCatalogService(connectionFixture(), persistence, {
      maxAssetsPerRun: 100,
      maxTextChars: 4_096,
      pageSize: 20,
      maxPageSize: 100,
      schemaConcurrency: 2,
      assetConcurrency: 2,
      adapters: { sqlite: adapter },
      randomId: () => `reopened-${++id}`,
    })
    expect(reopened.read.getAsset('profile-fixture', assetId)).toMatchObject({
      asset: { status: 'missing' }, history: [{ status: 'missing' }, { status: 'observed' }],
    })
  })

  it('keeps failed staging invisible and returns the active run for concurrent scans on one source', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const adapter: CatalogAdapter = {
      type: 'sqlite', capabilities: {},
      async scan(context) {
        await gate
        return { observations: [tableObservation(context)], relations: [], coverageComplete: true, unavailableScopes: [] }
      },
    }
    const persistence = createMemoryCatalogPersistence()
    const service = await createCatalogService(connectionFixture(), persistence, {
      maxAssetsPerRun: 100, maxTextChars: 4_096, pageSize: 20, maxPageSize: 100,
      schemaConcurrency: 2, assetConcurrency: 2,
      adapters: { sqlite: adapter }, randomId: () => 'one',
    })
    const run = await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    await expect(service.scanner.start({ sessionId: 's', scope: { kind: 'table', schema: 'main', table: 'orders' } }))
      .resolves.toMatchObject({ id: run.id, scope: { kind: 'source' } })
    expect(persistence.listRuns('profile-fixture')).toHaveLength(1)
    release()
    await waitForTerminal(service, 'profile-fixture')
  })

  it('versions candidate and verified metrics with optimistic concurrency and verified-first search', async () => {
    const adapter: CatalogAdapter = {
      type: 'sqlite', capabilities: {},
      async scan(context) { return { observations: [tableObservation(context)], relations: [], coverageComplete: true, unavailableScopes: [] } },
    }
    const persistence = createMemoryCatalogPersistence()
    const service = await createCatalogService(connectionFixture(), persistence, {
      maxAssetsPerRun: 100, maxTextChars: 4_096, pageSize: 20, maxPageSize: 100,
      schemaConcurrency: 2, assetConcurrency: 2,
      adapters: { sqlite: adapter }, randomId: () => 'scan',
    })
    await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    await waitForTerminal(service, 'profile-fixture')
    const assetId = persistence.listAssetHeads('profile-fixture')[0]!.assetId
    const definition = {
      kind: 'metric' as const,
      name: 'GMV', aliases: ['成交金额'], description: 'Paid order amount', owner: 'finance',
      sourceAssetIds: [assetId], status: 'inferred' as const, formula: 'SUM(pay_amount)', grain: 'day',
      filters: ['paid only'], exclusions: ['refunds'], revisionNote: 'candidate',
    }
    const candidate = await service.review.saveCandidate('profile-fixture', definition)
    expect(candidate.version).toBe(1)
    const verified = await service.review.verify('profile-fixture', candidate.semanticId, 1, {
      ...definition, status: 'verified', revisionNote: 'Finance approved',
    })
    expect(verified).toMatchObject({ version: 2, definition: { status: 'verified' } })
    await expect(service.review.verify('profile-fixture', candidate.semanticId, 1, {
      ...definition, status: 'verified', revisionNote: 'stale edit',
    })).rejects.toBeInstanceOf(CatalogVersionConflictError)
    const page = await service.read.search({
      query: '成交金额', filters: { sourceId: 'profile-fixture', includeInferred: false }, pageSize: 10,
    })
    expect(page.items[0]).toMatchObject({ id: candidate.semanticId, status: 'verified', version: 2 })
    expect(service.read.getMetric('profile-fixture', candidate.semanticId).definition.formula).toBe('SUM(pay_amount)')
    await service.review.saveCandidate('profile-fixture', {
      kind: 'term', name: 'GMV note', aliases: ['成交金额'], description: 'Unverified glossary candidate',
      sourceAssetIds: [assetId], status: 'inferred', revisionNote: 'candidate',
    })
    const ranked = await service.read.search({
      query: '成交金额', filters: { sourceId: 'profile-fixture', includeInferred: true }, pageSize: 10,
    })
    expect(ranked.items.slice(0, 2).map(item => item.status)).toEqual(['verified', 'inferred'])
    const retired = await service.review.retire('profile-fixture', candidate.semanticId, verified.version, 'Metric replaced')
    expect(retired).toMatchObject({ version: 3, definition: { status: 'retired', revisionNote: 'Metric replaced' } })
    await expect(service.review.saveCandidate('profile-fixture', definition, candidate.semanticId, retired.version))
      .rejects.toThrow(/Retired/)
    await expect(service.review.verify('profile-fixture', candidate.semanticId, retired.version, {
      ...definition, status: 'verified', revisionNote: 'cannot restore',
    })).rejects.toThrow(/Retired/)
  })

  it('keeps partial scans inside their exact scope and reports changed, missing, and restored revisions', async () => {
    let scan = 0
    let id = 0
    const adapter: CatalogAdapter = {
      type: 'sqlite', capabilities: {},
      async scan(context) {
        scan += 1
        const orders = tableObservation(context, 'orders', context.scope.kind === 'table' ? 'Orders v2' : 'Orders')
        const users = tableObservation(context, 'users', 'Users')
        const observations = context.scope.kind === 'table'
          ? [orders]
          : scan === 3 ? [orders] : [orders, users]
        observations.forEach(() => context.onProgress?.('relation'))
        return { observations, relations: [], coverageComplete: true, unavailableScopes: [] }
      },
    }
    const persistence = createMemoryCatalogPersistence()
    const service = await createCatalogService(connectionFixture(), persistence, {
      maxAssetsPerRun: 100, maxTextChars: 4_096, pageSize: 20, maxPageSize: 100,
      schemaConcurrency: 2, assetConcurrency: 2, adapters: { sqlite: adapter }, randomId: () => String(++id),
    })
    const full1 = await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    await waitForTerminal(service, 'profile-fixture')
    const firstFullAt = service.read.status('profile-fixture')!.source.lastFullScanAt
    const partial = await service.scanner.start({ sessionId: 's', scope: { kind: 'table', schema: 'main', table: 'orders' } })
    await waitForTerminal(service, 'profile-fixture')
    const usersId = persistence.listAssetHeads('profile-fixture')
      .map(head => service.read.getAsset('profile-fixture', head.assetId).asset)
      .find(revision => revision.payload.name === 'users')!.assetId
    expect(service.read.getAsset('profile-fixture', usersId).asset.status).toBe('observed')
    expect(service.read.status('profile-fixture')!.source).toMatchObject({ lastFullScanAt: firstFullAt })
    expect(service.read.status('profile-fixture')!.source.lastPartialScanAt).toBeDefined()
    expect(service.read.diff('profile-fixture', full1.id, partial.id).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'changed', path: expect.stringContaining('.orders') }),
    ]))

    const full2 = await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    await waitForTerminal(service, 'profile-fixture')
    expect(service.read.getAsset('profile-fixture', usersId).asset.status).toBe('missing')
    expect(service.read.diff('profile-fixture', partial.id, full2.id).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'missing', path: expect.stringContaining('.users') }),
    ]))

    const full3 = await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    await waitForTerminal(service, 'profile-fixture')
    expect(service.read.getAsset('profile-fixture', usersId).asset.status).toBe('observed')
    expect(service.read.diff('profile-fixture', full2.id, full3.id).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'restored', path: expect.stringContaining('.users') }),
    ]))
  })

  it('keeps the previous successful snapshot visible after promotion failure', async () => {
    let scan = 0
    let id = 0
    const adapter: CatalogAdapter = {
      type: 'sqlite', capabilities: {},
      async scan(context) {
        scan += 1
        return {
          observations: [tableObservation(context, 'orders', scan === 1 ? 'v1' : 'v2')],
          relations: [], coverageComplete: true, unavailableScopes: [],
        }
      },
    }
    const persistence = createMemoryCatalogPersistence()
    const service = await createCatalogService(connectionFixture(), persistence, {
      maxAssetsPerRun: 100, maxTextChars: 4_096, pageSize: 20, maxPageSize: 100,
      schemaConcurrency: 2, assetConcurrency: 2, adapters: { sqlite: adapter }, randomId: () => String(++id),
    })
    await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    await waitForTerminal(service, 'profile-fixture')
    const assetId = persistence.listAssetHeads('profile-fixture')[0]!.assetId
    const originalPutHead = persistence.putAssetHead
    persistence.putAssetHead = async () => { throw new Error('injected promotion failure') }
    await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    expect((await waitForTerminal(service, 'profile-fixture')).status).toBe('failed')
    expect(service.read.getAsset('profile-fixture', assetId).asset.payload.comment).toBe('v1')
    persistence.putAssetHead = originalPutHead
  })

  it('marks verified semantics needs_review after an incompatible referenced field change', async () => {
    let scan = 0
    let id = 0
    const adapter: CatalogAdapter = {
      type: 'sqlite', capabilities: {},
      async scan(context) {
        scan += 1
        return {
          observations: [tableObservation(context), columnObservation(context, 'orders', 'amount', scan === 1 ? 'INTEGER' : 'TEXT')],
          relations: [], coverageComplete: true, unavailableScopes: [],
        }
      },
    }
    const persistence = createMemoryCatalogPersistence()
    const service = await createCatalogService(connectionFixture(), persistence, {
      maxAssetsPerRun: 100, maxTextChars: 4_096, pageSize: 20, maxPageSize: 100,
      schemaConcurrency: 2, assetConcurrency: 2, adapters: { sqlite: adapter }, randomId: () => String(++id),
    })
    await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    await waitForTerminal(service, 'profile-fixture')
    const columnId = persistence.listAssetHeads('profile-fixture')
      .map(head => service.read.getAsset('profile-fixture', head.assetId).asset)
      .find(revision => revision.payload.identity.kind === 'column')!.assetId
    const candidate = await service.review.saveCandidate('profile-fixture', {
      kind: 'metric', name: 'GMV', aliases: [], description: 'Gross merchandise value', sourceAssetIds: [columnId],
      status: 'inferred', formula: 'SUM(amount)', grain: 'day', filters: [], exclusions: [], revisionNote: 'draft',
    })
    await service.review.verify('profile-fixture', candidate.semanticId, candidate.version, {
      ...candidate.definition, status: 'verified', revisionNote: 'approved',
    })
    const impactRun = await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    await waitForTerminal(service, 'profile-fixture')
    expect(service.read.getMetric('profile-fixture', candidate.semanticId)).toMatchObject({
      version: 3,
      definition: { status: 'needs_review', triggerRunId: impactRun.id, needsReviewReason: expect.stringContaining(columnId) },
    })
  })

  it('propagates cancellation, removes staging, and keeps the last successful snapshot visible', async () => {
    let scan = 0
    let id = 0
    const adapter: CatalogAdapter = {
      type: 'sqlite', capabilities: {},
      async scan(context) {
        scan += 1
        if (scan === 1) return { observations: [tableObservation(context, 'orders', 'v1')], relations: [], coverageComplete: true, unavailableScopes: [] }
        context.signal.throwIfAborted()
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true })
        })
        throw new Error('unreachable')
      },
    }
    const persistence = createMemoryCatalogPersistence()
    const service = await createCatalogService(connectionFixture(), persistence, {
      maxAssetsPerRun: 100, maxTextChars: 4_096, pageSize: 20, maxPageSize: 100,
      schemaConcurrency: 2, assetConcurrency: 2, adapters: { sqlite: adapter }, randomId: () => String(++id),
    })
    await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    await waitForTerminal(service, 'profile-fixture')
    const assetId = persistence.listAssetHeads('profile-fixture')[0]!.assetId
    const cancelled = await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    await service.scanner.cancel('profile-fixture', cancelled.id)
    expect((await waitForTerminal(service, 'profile-fixture')).status).toBe('cancelled')
    expect(persistence.listObservations(cancelled.id)).toEqual([])
    expect(service.read.getAsset('profile-fixture', assetId).asset.payload.comment).toBe('v1')
  })

  it('marks stale active runs interrupted on startup and removes their observations', async () => {
    const persistence = createMemoryCatalogPersistence()
    const timestamp = '2026-08-21T00:00:00.000Z'
    await persistence.putSource({
      id: 'profile-fixture', profileId: 'profile-fixture', type: 'sqlite', name: 'Fixture', database: 'catalog-fixture.db',
      credentialConfigured: true, createdAt: timestamp, updatedAt: timestamp,
    })
    await persistence.putRun({
      id: 'run_stale', sourceId: 'profile-fixture', sessionId: 's', scope: { kind: 'source' }, status: 'applying',
      coverageComplete: false, progress: { schemas: 1, relations: 1, fields: 0, assets: 2 }, createdAt: timestamp,
      startedAt: timestamp,
    })
    const context = {
      connection: { type: 'sqlite', database: '/tmp/catalog-fixture.db' }, sourceId: 'profile-fixture', runId: 'run_stale',
    } as CatalogAdapterContext
    await persistence.putObservation(tableObservation(context))
    const adapter: CatalogAdapter = {
      type: 'sqlite', capabilities: {}, async scan() { return { observations: [], relations: [], coverageComplete: true, unavailableScopes: [] } },
    }
    await createCatalogService(connectionFixture(), persistence, {
      maxAssetsPerRun: 100, maxTextChars: 4_096, pageSize: 20, maxPageSize: 100,
      schemaConcurrency: 2, assetConcurrency: 2, adapters: { sqlite: adapter },
    })
    expect(persistence.getRun('run_stale')).toMatchObject({ status: 'interrupted', error: expect.stringContaining('restart') })
    expect(persistence.listObservations('run_stale')).toEqual([])
  })

  it('preserves covered assets when a scope becomes unavailable and reports an unavailable diff', async () => {
    let scan = 0
    let id = 0
    const adapter: CatalogAdapter = {
      type: 'sqlite', capabilities: {},
      async scan(context) {
        scan += 1
        return scan === 1
          ? { observations: [schemaObservation(context), tableObservation(context)], relations: [], coverageComplete: true, unavailableScopes: [] }
          : { observations: [schemaObservation(context, 'unavailable')], relations: [], coverageComplete: false, unavailableScopes: ['main'] }
      },
    }
    const persistence = createMemoryCatalogPersistence()
    const service = await createCatalogService(connectionFixture(), persistence, {
      maxAssetsPerRun: 100, maxTextChars: 4_096, pageSize: 20, maxPageSize: 100,
      schemaConcurrency: 2, assetConcurrency: 2, adapters: { sqlite: adapter }, randomId: () => String(++id),
    })
    const before = await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    await waitForTerminal(service, 'profile-fixture')
    const tableId = catalogAssetId('sqlite', {
      sourceId: 'profile-fixture', database: '/tmp/catalog-fixture.db', schema: 'main', kind: 'table', name: 'orders',
    })
    const after = await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    expect((await waitForTerminal(service, 'profile-fixture')).coverageComplete).toBe(false)
    expect(service.read.getAsset('profile-fixture', tableId).asset.status).toBe('observed')
    expect(service.read.diff('profile-fixture', before.id, after.id).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'unavailable', name: 'main' }),
    ]))
  })

  it('keeps thousands of assets and large relation sets cursor-paginated and rebuilds a lost index', async () => {
    let id = 0
    const adapter: CatalogAdapter = {
      type: 'sqlite', capabilities: {},
      async scan(context) {
        const observations = Array.from({ length: 2_001 }, (_, index) => tableObservation(
          context, `table_${String(index).padStart(4, '0')}`, `table ${index}`,
        ))
        const fromAssetId = observations[0]!.assetId
        const relations: CatalogRelation[] = Array.from({ length: 250 }, (_, index) => ({
          id: `relation_${String(index).padStart(4, '0')}`,
          sourceId: context.sourceId,
          runId: context.runId,
          kind: 'index',
          fromAssetId,
          name: `index_${index}`,
          columnAssetIds: [],
          observedAt: '2026-08-21T00:00:00.000Z',
        }))
        return { observations, relations, coverageComplete: true, unavailableScopes: [] }
      },
    }
    const persistence = createMemoryCatalogPersistence()
    const service = await createCatalogService(connectionFixture(), persistence, {
      maxAssetsPerRun: 2_100, maxTextChars: 4_096, pageSize: 100, maxPageSize: 200,
      schemaConcurrency: 2, assetConcurrency: 2, adapters: { sqlite: adapter }, randomId: () => String(++id),
    })
    await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    await waitForTerminal(service, 'profile-fixture')
    const first = await service.read.search({
      query: '*', filters: { sourceId: 'profile-fixture', includeInferred: false }, pageSize: 200,
    })
    expect(first.items).toHaveLength(200)
    expect(first.nextCursor).toBeDefined()
    const second = await service.read.search({
      query: '*', filters: { sourceId: 'profile-fixture', includeInferred: false }, cursor: first.nextCursor, pageSize: 200,
    })
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(400)
    await expect(service.read.search({
      query: 'table', filters: { sourceId: 'profile-fixture', includeInferred: false }, cursor: first.nextCursor, pageSize: 200,
    })).rejects.toThrow(/cursor/i)
    const detail1 = service.read.getAsset('profile-fixture', first.items[0]!.id, undefined, 100)
    expect(detail1.relations).toHaveLength(100)
    const detail2 = service.read.getAsset('profile-fixture', first.items[0]!.id, detail1.nextCursor, 100)
    expect(detail2.relations).toHaveLength(100)
    await persistence.clearIndex('profile-fixture')
    expect((await service.read.search({
      query: 'table_2000', filters: { sourceId: 'profile-fixture', includeInferred: false }, pageSize: 10,
    })).items).toHaveLength(1)
  })

  it('fails a run that exceeds its asset bound without publishing a snapshot', async () => {
    const adapter: CatalogAdapter = {
      type: 'sqlite', capabilities: {},
      async scan(context) {
        return {
          observations: Array.from({ length: 11 }, (_, index) => tableObservation(context, `table_${index}`)),
          relations: [], coverageComplete: true, unavailableScopes: [],
        }
      },
    }
    const persistence = createMemoryCatalogPersistence()
    const service = await createCatalogService(connectionFixture(), persistence, {
      maxAssetsPerRun: 10, maxTextChars: 4_096, pageSize: 10, maxPageSize: 100,
      schemaConcurrency: 2, assetConcurrency: 2, adapters: { sqlite: adapter }, randomId: () => 'limit',
    })
    await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    expect((await waitForTerminal(service, 'profile-fixture'))).toMatchObject({ status: 'failed', error: expect.stringContaining('maxAssetsPerRun') })
    expect(persistence.listAssetHeads('profile-fixture')).toEqual([])
  })

  it('allows different profile sources to scan in parallel while isolating results', async () => {
    const connections = new Map([
      ['a', { type: 'sqlite' as const, database: '/tmp/a.db', profileId: 'profile-a', name: 'A' }],
      ['b', { type: 'sqlite' as const, database: '/tmp/b.db', profileId: 'profile-b', name: 'B' }],
    ])
    let started = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const adapter: CatalogAdapter = {
      type: 'sqlite', capabilities: {},
      async scan(context) {
        started += 1
        if (started === 2) release()
        await gate
        return { observations: [tableObservation(context)], relations: [], coverageComplete: true, unavailableScopes: [] }
      },
    }
    let id = 0
    const service = await createCatalogService({
      get(sessionId: string) { return connections.get(sessionId) },
      async resolveForExecution(sessionId: string) {
        const connection = connections.get(sessionId)
        if (connection === undefined) throw new Error('missing fixture')
        return connection
      },
    } as never, createMemoryCatalogPersistence(), {
      maxAssetsPerRun: 100, maxTextChars: 4_096, pageSize: 20, maxPageSize: 100,
      schemaConcurrency: 2, assetConcurrency: 2, adapters: { sqlite: adapter }, randomId: () => String(++id),
    })
    const a = await service.scanner.start({ sessionId: 'a', scope: { kind: 'source' } })
    const b = await service.scanner.start({ sessionId: 'b', scope: { kind: 'source' } })
    expect(a.sourceId).toBe('profile-a')
    expect(b.sourceId).toBe('profile-b')
    expect((await waitForTerminal(service, 'profile-a')).status).toBe('succeeded')
    expect((await waitForTerminal(service, 'profile-b')).status).toBe('succeeded')
    expect(service.read.status('profile-a')?.counts.assets).toBe(1)
    expect(service.read.status('profile-b')?.counts.assets).toBe(1)
  })

  it('redacts a resolved credential from persisted run errors', async () => {
    const secret = 'catalog-secret-value'
    const connection = {
      type: 'sqlite' as const, database: '/tmp/catalog-fixture.db', profileId: 'profile-fixture', name: 'Fixture',
    }
    const adapter: CatalogAdapter = {
      type: 'sqlite', capabilities: {}, async scan() { throw new Error(`driver failed near ${secret}`) },
    }
    const service = await createCatalogService({
      get: () => connection,
      resolveForExecution: async () => ({ ...connection, password: secret }),
    } as never, createMemoryCatalogPersistence(), {
      maxAssetsPerRun: 100, maxTextChars: 4_096, pageSize: 20, maxPageSize: 100,
      schemaConcurrency: 2, assetConcurrency: 2, adapters: { sqlite: adapter }, randomId: () => 'redacted',
    })
    await service.scanner.start({ sessionId: 's', scope: { kind: 'source' } })
    const run = await waitForTerminal(service, 'profile-fixture')
    expect(run.error).toContain('[REDACTED]')
    expect(run.error).not.toContain(secret)
  })
})
