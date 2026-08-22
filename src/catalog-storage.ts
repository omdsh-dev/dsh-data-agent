/** Durable versioned Catalog storage-domain and persistence adapter. */

import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  catalogAssetHeadSchema,
  catalogAssetRevisionSchema,
  catalogDateTimeSchema,
  catalogObservationSchema,
  catalogRelationSchema,
  catalogRunSchema,
  catalogSearchItemSchema,
  catalogSemanticEntrySchema,
  catalogSemanticRevisionSchema,
  catalogSourceSchema,
  type CatalogAssetHead,
  type CatalogAssetRevision,
  type CatalogIndexRecord,
  type CatalogIndexState,
  type CatalogObservation,
  type CatalogRelation,
  type CatalogRun,
  type CatalogSemanticEntry,
  type CatalogSemanticRevision,
  type CatalogSource,
} from './catalog-types.ts'

export const CATALOG_STORAGE_DOMAIN = 'data_agent_catalog'
export const CATALOG_STORAGE_VERSION = 1

const catalogIndexRecordSchema: z.ZodType<CatalogIndexRecord> = z.strictObject({
  id: z.string().min(1).max(512),
  sourceId: z.string().min(1).max(256),
  resultType: z.enum(['asset', 'semantic']),
  searchText: z.string().max(32_768),
  searchItem: catalogSearchItemSchema,
  updatedAt: catalogDateTimeSchema,
})

const catalogIndexStateSchema: z.ZodType<CatalogIndexState> = z.strictObject({
  version: z.literal(1),
  rebuiltAt: catalogDateTimeSchema.optional(),
})

/** Strict schemas reject secret-shaped or raw-result fields at the durable boundary. */
export const catalogStorageSpec = defineDomain({
  name: CATALOG_STORAGE_DOMAIN,
  version: CATALOG_STORAGE_VERSION,
  tables: {
    sources: domainTable<string, CatalogSource>(catalogSourceSchema),
    scan_runs: domainTable<string, CatalogRun>(catalogRunSchema),
    observations: domainTable<string, CatalogObservation>(catalogObservationSchema),
    asset_revisions: domainTable<string, CatalogAssetRevision>(catalogAssetRevisionSchema),
    asset_heads: domainTable<string, CatalogAssetHead>(catalogAssetHeadSchema),
    relations: domainTable<string, CatalogRelation>(catalogRelationSchema),
    semantic_entries: domainTable<string, CatalogSemanticEntry>(catalogSemanticEntrySchema),
    semantic_revisions: domainTable<string, CatalogSemanticRevision>(catalogSemanticRevisionSchema),
    search_index: domainTable<string, CatalogIndexRecord>(catalogIndexRecordSchema),
    index_state: domainTable<string, CatalogIndexState>(catalogIndexStateSchema),
  },
})

export type CatalogStorageDomain = Domain<typeof catalogStorageSpec>

export interface CatalogPersistence {
  getSource(id: string): CatalogSource | undefined
  listSources(): CatalogSource[]
  putSource(source: CatalogSource): Promise<void>
  getRun(id: string): CatalogRun | undefined
  listRuns(sourceId?: string): CatalogRun[]
  putRun(run: CatalogRun): Promise<void>
  putObservation(observation: CatalogObservation): Promise<void>
  listObservations(runId: string): CatalogObservation[]
  deleteObservations(runId: string): Promise<void>
  getAssetHead(assetId: string): CatalogAssetHead | undefined
  listAssetHeads(sourceId?: string): CatalogAssetHead[]
  putAssetHead(head: CatalogAssetHead): Promise<void>
  getAssetRevision(id: string): CatalogAssetRevision | undefined
  listAssetRevisions(assetId?: string): CatalogAssetRevision[]
  putAssetRevision(revision: CatalogAssetRevision): Promise<void>
  listRelations(sourceId?: string): CatalogRelation[]
  putRelation(relation: CatalogRelation): Promise<void>
  getSemanticEntry(id: string): CatalogSemanticEntry | undefined
  listSemanticEntries(sourceId?: string): CatalogSemanticEntry[]
  putSemanticEntry(entry: CatalogSemanticEntry): Promise<void>
  getSemanticRevision(id: string): CatalogSemanticRevision | undefined
  listSemanticRevisions(semanticId?: string): CatalogSemanticRevision[]
  putSemanticRevision(revision: CatalogSemanticRevision): Promise<void>
  listIndex(sourceId?: string): CatalogIndexRecord[]
  putIndex(record: CatalogIndexRecord): Promise<void>
  clearIndex(sourceId?: string): Promise<void>
  getIndexState(): CatalogIndexState | undefined
  putIndexState(state: CatalogIndexState): Promise<void>
}

export function createDomainCatalogPersistence(domain: CatalogStorageDomain): CatalogPersistence {
  const sources = domain.table('sources')
  const runs = domain.table('scan_runs')
  const observations = domain.table('observations')
  const revisions = domain.table('asset_revisions')
  const heads = domain.table('asset_heads')
  const relations = domain.table('relations')
  const semanticEntries = domain.table('semantic_entries')
  const semanticRevisions = domain.table('semantic_revisions')
  const searchIndex = domain.table('search_index')
  const indexState = domain.table('index_state')
  return {
    getSource: id => sources.get(id),
    listSources: () => sortedValues(sources.entries(), value => value.id),
    putSource: source => sources.put(source.id, catalogSourceSchema.parse(source)),
    getRun: id => runs.get(id),
    listRuns: sourceId => sortedValues(runs.entries(), value => value.createdAt)
      .filter(value => sourceId === undefined || value.sourceId === sourceId),
    putRun: run => runs.put(run.id, catalogRunSchema.parse(run)),
    putObservation: observation => observations.put(
      `${observation.runId}:${observation.assetId}`,
      catalogObservationSchema.parse(observation),
    ),
    listObservations: runId => sortedValues(observations.entries(), value => value.assetId)
      .filter(value => value.runId === runId),
    async deleteObservations(runId) {
      const keys = [...observations.entries()]
        .filter(([, value]) => value.runId === runId)
        .map(([key]) => key)
      for (const key of keys) await observations.delete(key)
    },
    getAssetHead: assetId => heads.get(assetId),
    listAssetHeads: sourceId => sortedValues(heads.entries(), value => value.assetId)
      .filter(value => sourceId === undefined || value.sourceId === sourceId),
    putAssetHead: head => heads.put(head.assetId, catalogAssetHeadSchema.parse(head)),
    getAssetRevision: id => revisions.get(id),
    listAssetRevisions: assetId => sortedValues(revisions.entries(), value => value.id)
      .filter(value => assetId === undefined || value.assetId === assetId),
    putAssetRevision: revision => revisions.put(revision.id, catalogAssetRevisionSchema.parse(revision)),
    listRelations: sourceId => sortedValues(relations.entries(), value => value.id)
      .filter(value => sourceId === undefined || value.sourceId === sourceId),
    putRelation: relation => relations.put(`${relation.runId}:${relation.id}`, catalogRelationSchema.parse(relation)),
    getSemanticEntry: id => semanticEntries.get(id),
    listSemanticEntries: sourceId => sortedValues(semanticEntries.entries(), value => value.id)
      .filter(value => sourceId === undefined || value.sourceId === sourceId),
    putSemanticEntry: entry => semanticEntries.put(entry.id, catalogSemanticEntrySchema.parse(entry)),
    getSemanticRevision: id => semanticRevisions.get(id),
    listSemanticRevisions: semanticId => sortedValues(semanticRevisions.entries(), value => value.id)
      .filter(value => semanticId === undefined || value.semanticId === semanticId),
    putSemanticRevision: revision => semanticRevisions.put(
      revision.id,
      catalogSemanticRevisionSchema.parse(revision),
    ),
    listIndex: sourceId => sortedValues(searchIndex.entries(), value => value.id)
      .filter(value => sourceId === undefined || value.sourceId === sourceId),
    putIndex: record => searchIndex.put(record.id, catalogIndexRecordSchema.parse(record)),
    async clearIndex(sourceId) {
      const keys = [...searchIndex.entries()]
        .filter(([, value]) => sourceId === undefined || value.sourceId === sourceId)
        .map(([key]) => key)
      for (const key of keys) await searchIndex.delete(key)
    },
    getIndexState: () => indexState.get('current'),
    putIndexState: state => indexState.put('current', catalogIndexStateSchema.parse(state)),
  }
}

/** In-memory adapter used when Catalog persistence is explicitly disabled and by focused tests. */
export function createMemoryCatalogPersistence(): CatalogPersistence {
  const map = <T>() => new Map<string, T>()
  const sources = map<CatalogSource>()
  const runs = map<CatalogRun>()
  const observations = map<CatalogObservation>()
  const heads = map<CatalogAssetHead>()
  const revisions = map<CatalogAssetRevision>()
  const relations = map<CatalogRelation>()
  const entries = map<CatalogSemanticEntry>()
  const semanticRevisions = map<CatalogSemanticRevision>()
  const index = map<CatalogIndexRecord>()
  let state: CatalogIndexState | undefined
  const persistence: CatalogPersistence = {
    getSource: id => sources.get(id),
    listSources: () => [...sources.values()].sort((a, b) => a.id.localeCompare(b.id)),
    async putSource(source) { sources.set(source.id, catalogSourceSchema.parse(source)) },
    getRun: id => runs.get(id),
    listRuns: sourceId => [...runs.values()].filter(value => sourceId === undefined || value.sourceId === sourceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    async putRun(run) { runs.set(run.id, catalogRunSchema.parse(run)) },
    async putObservation(value) { observations.set(`${value.runId}:${value.assetId}`, catalogObservationSchema.parse(value)) },
    listObservations: runId => [...observations.values()].filter(value => value.runId === runId),
    async deleteObservations(runId) {
      for (const [key, value] of observations) if (value.runId === runId) observations.delete(key)
    },
    getAssetHead: id => heads.get(id),
    listAssetHeads: sourceId => [...heads.values()].filter(value => sourceId === undefined || value.sourceId === sourceId),
    async putAssetHead(value) { heads.set(value.assetId, catalogAssetHeadSchema.parse(value)) },
    getAssetRevision: id => revisions.get(id),
    listAssetRevisions: assetId => [...revisions.values()].filter(value => assetId === undefined || value.assetId === assetId),
    async putAssetRevision(value) { revisions.set(value.id, catalogAssetRevisionSchema.parse(value)) },
    listRelations: sourceId => [...relations.values()].filter(value => sourceId === undefined || value.sourceId === sourceId),
    async putRelation(value) { relations.set(`${value.runId}:${value.id}`, catalogRelationSchema.parse(value)) },
    getSemanticEntry: id => entries.get(id),
    listSemanticEntries: sourceId => [...entries.values()].filter(value => sourceId === undefined || value.sourceId === sourceId),
    async putSemanticEntry(value) { entries.set(value.id, catalogSemanticEntrySchema.parse(value)) },
    getSemanticRevision: id => semanticRevisions.get(id),
    listSemanticRevisions: semanticId => [...semanticRevisions.values()]
      .filter(value => semanticId === undefined || value.semanticId === semanticId),
    async putSemanticRevision(value) { semanticRevisions.set(value.id, catalogSemanticRevisionSchema.parse(value)) },
    listIndex: sourceId => [...index.values()].filter(value => sourceId === undefined || value.sourceId === sourceId),
    async putIndex(value) { index.set(value.id, catalogIndexRecordSchema.parse(value)) },
    async clearIndex(sourceId) {
      for (const [key, value] of index) if (sourceId === undefined || value.sourceId === sourceId) index.delete(key)
    },
    getIndexState: () => state,
    async putIndexState(value) { state = catalogIndexStateSchema.parse(value) },
  }
  return persistence
}

function sortedValues<T>(entries: Iterable<[string, T]>, by: (value: T) => string): T[] {
  return [...entries].map(([, value]) => value).sort((a, b) => by(a).localeCompare(by(b)))
}
