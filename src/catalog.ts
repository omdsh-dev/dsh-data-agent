/** Shared Catalog service: scan lifecycle, version projections, search, and review. */

import { redactSecretText, type DataAgentConnections, type DatabaseConnection, type DatabaseType } from './connections.ts'
import { basename } from 'node:path'
import {
  catalogAssetId,
  catalogRevisionId,
  catalogSemanticId,
  catalogSemanticRevisionId,
  catalogSourceId,
  catalogTechnicalFingerprint,
  normalizeCatalogIdentifier,
  normalizeCatalogText,
  stableJson,
} from './catalog-identity.ts'
import {
  catalogScopeSchema,
  catalogSearchRequestSchema,
  catalogObservationSchema,
  catalogRelationSchema,
  startCatalogScanInputSchema,
  semanticDefinitionSchema,
  type CatalogAssetDetail,
  type CatalogAssetHead,
  type CatalogAssetRevision,
  type CatalogDiffItem,
  type CatalogDiffPage,
  type CatalogEnrichment,
  type CatalogIndexRecord,
  type CatalogObservation,
  type CatalogRelation,
  type CatalogRun,
  type CatalogRunStatus,
  type CatalogScope,
  type CatalogSearchItem,
  type CatalogSearchPage,
  type CatalogSearchRequest,
  type CatalogSemanticEntry,
  type CatalogSemanticRevision,
  type CatalogSource,
  type CatalogStatusSummary,
  type MetricDefinition,
  type MeaningDefinition,
  type SemanticDefinition,
  type StartCatalogScanInput,
} from './catalog-types.ts'
import type {
  CatalogMeaningGenerator,
  CatalogMeaningTableInput,
  CatalogModelSelection,
} from './catalog-ai.ts'
import type { CatalogAdapter, CatalogAdapterResult } from './catalog-adapters.ts'
import { createCatalogAdapterRegistry } from './catalog-adapters.ts'
import type { CatalogPersistence } from './catalog-storage.ts'

const ACTIVE_RUN_STATUSES = new Set<CatalogRunStatus>(['queued', 'running', 'applying'])
const ACTIVE_ENRICHMENT_STATUSES = new Set(['queued', 'running'])

export interface CatalogServiceOptions {
  maxAssetsPerRun: number
  maxTextChars: number
  pageSize: number
  maxPageSize: number
  schemaConcurrency: number
  assetConcurrency: number
  now?: () => Date
  randomId?: () => string
  adapters?: Readonly<Record<string, CatalogAdapter>>
  meaningGenerator?: CatalogMeaningGenerator
  logger?: { warn(message: string, ...args: unknown[]): void }
}

export type { CatalogStatusSummary, StartCatalogScanInput } from './catalog-types.ts'

/** Read-only face injected into model tools and all surface adapters. */
export interface DataAgentCatalog {
  listSources(): CatalogSource[]
  listRuns(sourceId: string, limit?: number): CatalogRun[]
  resolveSource(sessionId: string, requestedSourceId?: string): Promise<CatalogSource>
  status(sourceId: string): CatalogStatusSummary | undefined
  search(request: CatalogSearchRequest): Promise<CatalogSearchPage>
  getAsset(sourceId: string, assetId: string, cursor?: string, pageSize?: number): CatalogAssetDetail
  getSemantic(sourceId: string, semanticId: string, version?: number): CatalogSemanticRevision
  getMetric(sourceId: string, metricId: string, version?: number): CatalogSemanticRevision & { definition: MetricDefinition }
  diff(sourceId: string, fromRunId?: string, toRunId?: string, cursor?: string, pageSize?: number): CatalogDiffPage
}

/** Mutation face used only by the dsh-tui `/catalog` command and Web routes. */
export interface DataAgentCatalogScanner {
  start(input: StartCatalogScanInput): Promise<CatalogRun>
  cancel(sourceId: string, runId?: string): Promise<CatalogRun>
  interruptActiveRuns(): Promise<void>
}

/** Human review face; never injected into the model-tool plugin. */
export interface DataAgentCatalogReview {
  saveCandidate(sourceId: string, definition: SemanticDefinition, semanticId?: string, expectedVersion?: number): Promise<CatalogSemanticRevision>
  verify(sourceId: string, semanticId: string, expectedVersion: number, definition: SemanticDefinition): Promise<CatalogSemanticRevision>
  retire(sourceId: string, semanticId: string, expectedVersion: number, revisionNote: string): Promise<CatalogSemanticRevision>
  dismissMeaning(sourceId: string, semanticId: string, expectedVersion: number): Promise<CatalogSemanticRevision>
}

export interface CatalogServiceBundle {
  read: DataAgentCatalog
  scanner: DataAgentCatalogScanner
  review: DataAgentCatalogReview
}

export class CatalogVersionConflictError extends Error {
  constructor(readonly current: CatalogSemanticRevision) {
    super(`Catalog semantic version conflict; current version is ${current.version}`)
    this.name = 'CatalogVersionConflictError'
  }
}

export async function createCatalogService(
  connections: DataAgentConnections,
  persistence: CatalogPersistence,
  options: CatalogServiceOptions,
): Promise<CatalogServiceBundle> {
  const now = (): string => (options.now?.() ?? new Date()).toISOString()
  const randomId = options.randomId ?? (() => crypto.randomUUID())
  const adapters = options.adapters ?? createCatalogAdapterRegistry()
  const controllers = new Map<string, AbortController>()
  const runtimeRuns = new Map<string, CatalogRun>()

  const runActive = (run: CatalogRun): boolean => ACTIVE_RUN_STATUSES.has(run.status)
    || (run.enrichment !== undefined && ACTIVE_ENRICHMENT_STATUSES.has(run.enrichment.status))

  const successfulRuns = (sourceId: string): CatalogRun[] => persistence.listRuns(sourceId)
    .filter(run => run.status === 'succeeded')
    .sort(compareRun)

  const runVisible = (runId: string): boolean => persistence.getRun(runId)?.status === 'succeeded'

  const currentRevision = (assetId: string): CatalogAssetRevision | undefined => {
    const head = persistence.getAssetHead(assetId)
    if (head === undefined) return undefined
    for (const revisionId of [...head.revisionIds].reverse()) {
      const revision = persistence.getAssetRevision(revisionId)
      if (revision !== undefined && runVisible(revision.runId)) return revision
    }
    return undefined
  }

  const revisionAtRun = (assetId: string, target: CatalogRun): CatalogAssetRevision | undefined => {
    const targetKey = runOrderKey(target)
    return persistence.listAssetRevisions(assetId)
      .filter(revision => {
        const run = persistence.getRun(revision.runId)
        return run?.status === 'succeeded' && runOrderKey(run) <= targetKey
      })
      .sort((a, b) => b.revision - a.revision)[0]
  }

  const currentSemantic = (entry: CatalogSemanticEntry): CatalogSemanticRevision => {
    const revision = persistence.getSemanticRevision(catalogSemanticRevisionId(entry.id, entry.currentVersion))
    if (revision === undefined) throw new Error(`Catalog semantic ${entry.id} has no current revision`)
    return revision
  }

  const resolvePageSize = (value?: number): number => {
    if (value === undefined) return options.pageSize
    if (!Number.isInteger(value) || value < 1 || value > options.maxPageSize) {
      throw new Error(`pageSize must be an integer between 1 and ${options.maxPageSize}`)
    }
    return value
  }

  const read: DataAgentCatalog = {
    listSources() {
      return persistence.listSources()
    },
    listRuns(sourceId, limit = 50) {
      requireKnownSource(sourceId)
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('limit must be between 1 and 200')
      return persistence.listRuns(sourceId).sort((a, b) => compareRun(b, a)).slice(0, limit)
        .map(run => runtimeRuns.get(run.id) ?? run)
    },
    async resolveSource(sessionId, requestedSourceId) {
      if (requestedSourceId !== undefined) {
        const requested = persistence.getSource(requestedSourceId)
        if (requested === undefined) throw new Error(`Unknown Catalog source: ${requestedSourceId}`)
        const summary = connections.get(sessionId)
        if (summary?.profileId !== undefined && summary.profileId !== requestedSourceId) {
          throw new Error('Requested Catalog source does not match the current session connection')
        }
        return requested
      }
      const summary = connections.get(sessionId)
      if (summary?.profileId !== undefined) {
        const connected = persistence.getSource(summary.profileId)
        if (connected !== undefined) return connected
      }
      const sources = persistence.listSources()
      if (sources.length === 1) return sources[0]!
      if (sources.length === 0) throw new Error('Catalog is empty; run /catalog scan after connecting a saved profile')
      throw new Error(`Catalog source is ambiguous; specify sourceId (${sources.map(source => `${source.id}:${source.name}`).join(', ')})`)
    },
    status(sourceId) {
      const source = persistence.getSource(sourceId)
      if (source === undefined) return undefined
      const runs = persistence.listRuns(sourceId).sort((a, b) => compareRun(b, a))
        .map(run => runtimeRuns.get(run.id) ?? run)
      const revisions = persistence.listAssetHeads(sourceId).flatMap((head) => {
        const revision = currentRevision(head.assetId)
        return revision === undefined ? [] : [revision]
      })
      const semantics = persistence.listSemanticEntries(sourceId).map(currentSemantic)
      return {
        source,
        ...runs.find(runActive) !== undefined
          ? { activeRun: runs.find(runActive)! }
          : {},
        ...runs[0] !== undefined ? { latestRun: runs[0] } : {},
        ...runs.find(run => run.status === 'succeeded') !== undefined
          ? { latestSuccessfulRun: runs.find(run => run.status === 'succeeded')! }
          : {},
        counts: {
          assets: revisions.filter(revision => revision.status !== 'missing').length,
          fields: revisions.filter(revision => revision.payload.identity.kind === 'column' && revision.status !== 'missing').length,
          needsReview: semantics.filter(revision => revision.definition.status === 'inferred' || revision.definition.status === 'needs_review').length,
        },
      }
    },
    async search(rawRequest) {
      const request = catalogSearchRequestSchema.parse(rawRequest)
      const sourceId = request.filters.sourceId
      if (sourceId === undefined) throw new Error('Catalog search requires sourceId')
      requireKnownSource(sourceId)
      await ensureIndex(sourceId)
      const normalizedQuery = normalizeCatalogText(request.query, 512).value.toLocaleLowerCase('en-US')
      const words = normalizedQuery === '*' ? [] : normalizedQuery.split(/\s+/).filter(Boolean)
      const matches = persistence.listIndex(sourceId)
        .filter(record => words.every(word => record.searchText.includes(word)))
        .map(record => ({
          ...record.searchItem,
          matchReasons: searchMatchReasons(record.searchItem, normalizedQuery),
        }))
        .filter(item => filterSearchItem(item, request))
        .sort(compareSearchItems)
      const cursorKey = stableJson({ query: normalizedQuery, filters: request.filters })
      const cursor = decodeCursor(request.cursor, sourceId, cursorKey)
      const size = resolvePageSize(request.pageSize)
      const items = matches.slice(cursor, cursor + size)
      const nextOffset = cursor + items.length
      const includeInferred = request.filters.includeInferred
      return {
        sourceId,
        query: request.query,
        items,
        ...nextOffset < matches.length ? { nextCursor: encodeCursor(nextOffset, sourceId, cursorKey) } : {},
        truncated: nextOffset < matches.length,
        warnings: includeInferred && items.some(item => item.status === 'inferred')
          ? ['Results include inferred definitions that have not been verified by a human.']
          : [],
      }
    },
    getAsset(sourceId, assetId, cursor, pageSize) {
      requireKnownSource(sourceId)
      const revision = currentRevision(assetId)
      if (revision === undefined || revision.sourceId !== sourceId) throw new Error(`Unknown Catalog asset: ${assetId}`)
      const size = resolvePageSize(pageSize)
      const offset = decodeCursor(cursor, sourceId, assetId)
      const allFields = persistence.listAssetHeads(sourceId).flatMap((head) => {
        const item = currentRevision(head.assetId)
        return item !== undefined && item.payload.parentId === assetId ? [item] : []
      })
        .sort((a, b) => (a.payload.ordinal ?? Number.MAX_SAFE_INTEGER) - (b.payload.ordinal ?? Number.MAX_SAFE_INTEGER)
          || a.payload.name.localeCompare(b.payload.name))
      const fields = allFields.slice(offset, offset + size)
      const allRelations = currentRelations(sourceId)
        .filter(relation => relation.fromAssetId === assetId || relation.toAssetId === assetId)
      const relatedAssetIds = new Set([assetId, ...allFields.map(field => field.assetId)])
      const allSemantics = persistence.listSemanticEntries(sourceId)
        .map(currentSemantic)
        .filter(item => item.definition.status !== 'retired'
          && item.definition.sourceAssetIds.some(relatedAssetId => relatedAssetIds.has(relatedAssetId)))
      const allHistory = persistence.listAssetRevisions(assetId)
        .filter(item => runVisible(item.runId))
        .sort((a, b) => b.revision - a.revision)
      const relations = allRelations.slice(offset, offset + size)
      const semantics = allSemantics.slice(offset, offset + size)
      const history = allHistory.slice(offset, offset + size)
      const nextOffset = offset + size
      const truncated = [allFields, allRelations, allSemantics, allHistory]
        .some(values => nextOffset < values.length)
      return {
        asset: revision,
        fields,
        relations,
        semantics,
        history,
        ...truncated ? { nextCursor: encodeCursor(nextOffset, sourceId, assetId) } : {},
        truncated,
        untrusted: true,
      }
    },
    getSemantic(sourceId, semanticId, version) {
      requireKnownSource(sourceId)
      const entry = persistence.getSemanticEntry(semanticId)
      if (entry === undefined || entry.sourceId !== sourceId) throw new Error(`Unknown Catalog semantic: ${semanticId}`)
      if (version === undefined) return currentSemantic(entry)
      if (!Number.isInteger(version) || version < 1) throw new Error('version must be a positive integer')
      const revision = persistence.getSemanticRevision(catalogSemanticRevisionId(semanticId, version))
      if (revision === undefined) throw new Error(`Unknown Catalog semantic version: ${semanticId}@${version}`)
      return revision
    },
    getMetric(sourceId, metricId, version) {
      const revision = read.getSemantic(sourceId, metricId, version)
      if (revision.definition.kind !== 'metric') throw new Error(`${metricId} is not a metric`)
      return revision as CatalogSemanticRevision & { definition: MetricDefinition }
    },
    diff(sourceId, fromRunId, toRunId, cursor, pageSize) {
      requireKnownSource(sourceId)
      const runs = successfulRuns(sourceId)
      let from: CatalogRun | undefined
      let to: CatalogRun | undefined
      if (fromRunId === undefined && toRunId === undefined) {
        from = runs.at(-2)
        to = runs.at(-1)
      } else {
        from = fromRunId === undefined ? undefined : persistence.getRun(fromRunId)
        to = toRunId === undefined ? undefined : persistence.getRun(toRunId)
      }
      if (from?.status !== 'succeeded' || to?.status !== 'succeeded'
          || from.sourceId !== sourceId || to.sourceId !== sourceId) {
        throw new Error('Catalog diff requires two successful runs from the same source')
      }
      const items = buildDiff(sourceId, from, to)
      const offset = decodeCursor(cursor, sourceId, `${from.id}:${to.id}`)
      const size = resolvePageSize(pageSize)
      const page = items.slice(offset, offset + size)
      const nextOffset = offset + page.length
      return {
        sourceId,
        fromRunId: from.id,
        toRunId: to.id,
        scope: to.scope,
        items: page,
        ...nextOffset < items.length ? { nextCursor: encodeCursor(nextOffset, sourceId, `${from.id}:${to.id}`) } : {},
        truncated: nextOffset < items.length,
      }
    },
  }

  const scanner: DataAgentCatalogScanner = {
    async start(rawInput) {
      const input = startCatalogScanInputSchema.parse(rawInput)
      const requestedScope = input.scope
      const sessionId = input.sessionId
      const modelSelection = options.meaningGenerator?.capture(sessionId)
      const summary = connections.get(sessionId)
      if (summary?.profileId === undefined || summary.profileId.trim().length === 0) {
        throw new Error('Catalog scan requires a connected, stable connection profile')
      }
      // Resolve before creating a run so invalid/expired credentials never leave an executable run.
      const connection = await connections.resolveForExecution(sessionId)
      if (connection.profileId !== summary.profileId) throw new Error('Session connection changed while starting Catalog scan')
      const sourceId = catalogSourceId(summary.profileId)
      if (sourceId !== summary.profileId) throw new Error('Catalog profileId contains unsupported whitespace or control characters')
      const scope = normalizeScope(connection.type, requestedScope)
      const existing = persistence.listRuns(sourceId).find(run => runActive(runtimeRuns.get(run.id) ?? run))
      if (existing !== undefined) return runtimeRuns.get(existing.id) ?? existing
      const timestamp = now()
      const source: CatalogSource = {
        id: sourceId,
        profileId: sourceId,
        type: connection.type,
        name: normalizeCatalogText(summary.name ?? summary.database, 256).value,
        ...summary.host !== undefined ? { host: normalizeCatalogText(summary.host, 512).value } : {},
        database: normalizeCatalogText(connection.type === 'sqlite' ? basename(summary.database) : summary.database, 512).value,
        credentialConfigured: true,
        createdAt: persistence.getSource(sourceId)?.createdAt ?? timestamp,
        updatedAt: timestamp,
        ...persistence.getSource(sourceId)?.lastFullScanAt !== undefined
          ? { lastFullScanAt: persistence.getSource(sourceId)!.lastFullScanAt }
          : {},
        ...persistence.getSource(sourceId)?.lastPartialScanAt !== undefined
          ? { lastPartialScanAt: persistence.getSource(sourceId)!.lastPartialScanAt }
          : {},
      }
      await persistence.putSource(source)
      const run: CatalogRun = {
        id: `run_${randomId()}`,
        sourceId,
        sessionId,
        scope,
        status: 'queued',
        coverageComplete: false,
        progress: { schemas: 0, relations: 0, fields: 0, assets: 0 },
        createdAt: timestamp,
        ...modelSelection !== undefined ? {
          enrichment: {
            status: 'queued',
            provider: modelSelection.provider,
            model: modelSelection.model,
            ...modelSelection.reasoningEffort !== undefined ? { reasoningEffort: String(modelSelection.reasoningEffort) } : {},
            tablesTotal: 0,
            tablesCompleted: 0,
            tablesFailed: 0,
            candidatesGenerated: 0,
          },
        } : {},
      }
      await persistence.putRun(run)
      runtimeRuns.set(run.id, run)
      const controller = new AbortController()
      controllers.set(run.id, controller)
      queueMicrotask(() => {
        void executeRun(run, connection.type, controller, modelSelection).catch(error => {
          options.logger?.warn('data-agent Catalog run %s failed unexpectedly: %s', run.id, error)
        })
      })
      return run
    },
    async cancel(sourceId, runId) {
      requireKnownSource(sourceId)
      const active = persistence.listRuns(sourceId)
        .map(run => runtimeRuns.get(run.id) ?? run)
        .find(run => runActive(run) && (runId === undefined || run.id === runId))
      if (active === undefined) throw new Error('No matching active Catalog run')
      controllers.get(active.id)?.abort(new Error('Catalog scan cancelled by user'))
      return active
    },
    async interruptActiveRuns() {
      for (const run of persistence.listRuns()) {
        if (!runActive(run)) continue
        const interrupted: CatalogRun = ACTIVE_RUN_STATUSES.has(run.status)
          ? { ...run, status: 'interrupted', completedAt: now(), error: 'Catalog scan interrupted by process restart' }
          : {
              ...run,
              enrichment: {
                ...run.enrichment!,
                status: 'cancelled',
                completedAt: now(),
                error: 'Catalog AI enrichment interrupted by process restart',
              },
            }
        await persistence.putRun(interrupted)
        runtimeRuns.delete(run.id)
        await persistence.deleteObservations(run.id)
      }
    },
  }

  const review: DataAgentCatalogReview = {
    async saveCandidate(sourceId, rawDefinition, semanticId, expectedVersion) {
      if (rawDefinition.kind === 'meaning') throw new Error('AI business meanings can only be created by Catalog enrichment')
      const existing = semanticId === undefined ? undefined : persistence.getSemanticEntry(semanticId)
      if (existing !== undefined && existing.sourceId !== sourceId) throw new Error('Semantic belongs to another Catalog source')
      const currentStatus = existing === undefined ? undefined : currentSemantic(existing).definition.status
      if (currentStatus === 'retired') throw new Error('Retired semantics cannot be edited')
      const definition = semanticDefinitionSchema.parse({
        ...rawDefinition,
        status: currentStatus === 'needs_review' ? 'needs_review' : 'inferred',
      })
      return appendSemantic(sourceId, definition, semanticId, expectedVersion, false)
    },
    async verify(sourceId, semanticId, expectedVersion, rawDefinition) {
      const existing = requireSemanticEntry(sourceId, semanticId)
      const currentStatus = currentSemantic(existing).definition.status
      if (currentStatus === 'retired') throw new Error('Retired semantics cannot be verified again')
      const note = rawDefinition.revisionNote?.trim()
      if (note === undefined || note.length === 0) throw new Error('Verification requires revisionNote')
      const definition = semanticDefinitionSchema.parse({
        ...rawDefinition,
        status: 'verified',
        verifiedAt: now(),
        revisionNote: note,
        needsReviewReason: undefined,
        triggerRunId: undefined,
      })
      return appendSemantic(sourceId, definition, semanticId, expectedVersion, true)
    },
    async retire(sourceId, semanticId, expectedVersion, revisionNote) {
      if (revisionNote.trim().length === 0) throw new Error('Retirement requires revisionNote')
      const entry = requireSemanticEntry(sourceId, semanticId)
      const current = currentSemantic(entry)
      if (current.definition.status !== 'verified' && current.definition.status !== 'needs_review') {
        throw new Error('Only verified or needs_review semantics can be retired')
      }
      return appendSemantic(sourceId, {
        ...current.definition,
        status: 'retired',
        revisionNote: normalizeCatalogText(revisionNote, options.maxTextChars).value,
      }, semanticId, expectedVersion, true)
    },
    async dismissMeaning(sourceId, semanticId, expectedVersion) {
      const entry = requireSemanticEntry(sourceId, semanticId)
      const current = currentSemantic(entry)
      if (current.definition.kind !== 'meaning' || current.definition.generatedBy.kind !== 'ai') {
        throw new Error('Only AI-generated business meanings can be deleted with this action')
      }
      if (current.definition.status === 'retired') throw new Error('Business meaning is already deleted')
      return appendSemantic(sourceId, {
        ...current.definition,
        status: 'retired',
        revisionNote: 'AI-generated business meaning deleted by user',
      }, semanticId, expectedVersion, true)
    },
  }

  async function executeRun(
    initial: CatalogRun,
    databaseType: string,
    controller: AbortController,
    modelSelection: CatalogModelSelection | undefined,
  ): Promise<void> {
    let run = await setRun(initial, { status: 'running', startedAt: now() })
    let resolvedConnection: DatabaseConnection | undefined
    try {
      const connection = await connections.resolveForExecution(run.sessionId)
      resolvedConnection = connection
      if (connection.profileId !== run.sourceId || connection.type !== databaseType) {
        throw new Error('Session connection no longer matches the Catalog source')
      }
      const adapter = adapters[connection.type]
      if (adapter === undefined) throw new Error(`No Catalog adapter for ${connection.type}`)
      let assets = 0
      const result = await adapter.scan({
        connections,
        connection,
        sessionId: run.sessionId,
        sourceId: run.sourceId,
        runId: run.id,
        scope: run.scope,
        signal: controller.signal,
        options: {
          maxTextChars: options.maxTextChars,
          schemaConcurrency: options.schemaConcurrency,
          assetConcurrency: options.assetConcurrency,
        },
        onProgress(kind) {
          assets += 1
          if (assets > options.maxAssetsPerRun) throw new Error(`Catalog scan exceeded maxAssetsPerRun (${options.maxAssetsPerRun})`)
          const progress = { ...run.progress, assets }
          if (kind === 'schema') progress.schemas += 1
          if (kind === 'relation') progress.relations += 1
          if (kind === 'field') progress.fields += 1
          run = { ...run, progress }
          runtimeRuns.set(run.id, run)
        },
      })
      controller.signal.throwIfAborted()
      validateAdapterResult(result, run)
      for (const observation of result.observations) await persistence.putObservation(observation)
      run = await setRun(run, { status: 'applying', coverageComplete: result.coverageComplete, progress: run.progress })
      await promote(run, result)
      const completedAt = now()
      run = await setRun(run, { status: 'succeeded', coverageComplete: result.coverageComplete, completedAt })
      const source = persistence.getSource(run.sourceId)!
      await persistence.putSource({
        ...source,
        updatedAt: completedAt,
        ...(run.scope.kind === 'source' ? { lastFullScanAt: completedAt } : { lastPartialScanAt: completedAt }),
      })
      try {
        await markImpactedSemantics(run)
        await rebuildIndex(run.sourceId)
        await persistence.deleteObservations(run.id)
      } catch (error) {
        options.logger?.warn('data-agent Catalog run %s committed, but post-commit maintenance failed: %s', run.id, error)
      }
      if (modelSelection !== undefined && options.meaningGenerator !== undefined) {
        run = await enrichBusinessMeanings(run, modelSelection, options.meaningGenerator, controller, resolvedConnection)
      }
    } catch (error) {
      const aborted = controller.signal.aborted
      const rawMessage = error instanceof Error ? error.message : String(error)
      const message = normalizeCatalogText(
        redactSecretText(rawMessage, [resolvedConnection?.password]),
        options.maxTextChars,
      ).value
      if (run.status === 'succeeded') {
        if (run.enrichment !== undefined && ACTIVE_ENRICHMENT_STATUSES.has(run.enrichment.status)) {
          run = await setRun(run, {
            enrichment: {
              ...run.enrichment,
              status: aborted ? 'cancelled' : 'failed',
              completedAt: now(),
              error: message,
            },
          })
        }
        return
      }
      run = await setRun(run, {
        status: aborted ? 'cancelled' : 'failed',
        coverageComplete: false,
        completedAt: now(),
        error: message,
      })
      await persistence.deleteObservations(run.id)
    } finally {
      controllers.delete(run.id)
      runtimeRuns.delete(run.id)
    }
  }

  async function setRun(run: CatalogRun, changes: Partial<CatalogRun>): Promise<CatalogRun> {
    const next = { ...run, ...changes }
    await persistence.putRun(next)
    runtimeRuns.set(next.id, next)
    return next
  }

  async function enrichBusinessMeanings(
    initial: CatalogRun,
    selection: CatalogModelSelection,
    generator: CatalogMeaningGenerator,
    controller: AbortController,
    connection: DatabaseConnection,
  ): Promise<CatalogRun> {
    const source = requireKnownSource(initial.sourceId)
    const relations = currentRelations(initial.sourceId)
    const tables = persistence.listAssetHeads(initial.sourceId).flatMap((head) => {
      const revision = currentRevision(head.assetId)
      if (revision === undefined || revision.status !== 'observed'
          || (revision.payload.identity.kind !== 'table' && revision.payload.identity.kind !== 'view')
          || !inScope(revision, initial.scope)
          || !isBusinessSchema(source, revision.payload.identity.schema)) return []
      return [revision]
    }).sort((a, b) => a.payload.path.localeCompare(b.payload.path))

    let run = await setRun(initial, {
      enrichment: {
        ...initial.enrichment!,
        status: 'running',
        tablesTotal: tables.length,
        startedAt: now(),
      },
    })
    let completed = 0
    let failed = 0
    let generated = 0
    const errors: string[] = []
    try {
      for (const table of tables) {
        controller.signal.throwIfAborted()
        const fields = persistence.listAssetHeads(run.sourceId).flatMap((head) => {
          const revision = currentRevision(head.assetId)
          return revision !== undefined && revision.status === 'observed' && revision.payload.parentId === table.assetId
            ? [revision]
            : []
        }).sort((a, b) => (a.payload.ordinal ?? Number.MAX_SAFE_INTEGER) - (b.payload.ordinal ?? Number.MAX_SAFE_INTEGER)
          || a.payload.name.localeCompare(b.payload.name))
        const tableRelations = relations.filter(relation => relation.fromAssetId === table.assetId || relation.toAssetId === table.assetId)
        const input: CatalogMeaningTableInput = {
          assetId: table.assetId,
          schema: table.payload.identity.schema,
          name: table.payload.name,
          objectType: table.payload.identity.kind as 'table' | 'view',
          ...table.payload.comment !== undefined ? { comment: table.payload.comment } : {},
          fields: fields.map(field => ({
            assetId: field.assetId,
            name: field.payload.name,
            ...field.payload.dataType !== undefined ? { dataType: field.payload.dataType } : {},
            ...field.payload.nullable !== undefined ? { nullable: field.payload.nullable } : {},
            ...field.payload.comment !== undefined ? { comment: field.payload.comment } : {},
            keyKinds: tableRelations.filter(relation => relation.columnAssetIds.includes(field.assetId))
              .map(relation => relation.kind),
          })),
          relations: tableRelations.map(relation => ({
            kind: relation.kind,
            ...relation.name !== undefined ? { name: relation.name } : {},
            fromAssetId: relation.fromAssetId,
            ...relation.toAssetId !== undefined ? { toAssetId: relation.toAssetId } : {},
            columnAssetIds: relation.columnAssetIds,
            ...relation.referencedColumnAssetIds !== undefined
              ? { referencedColumnAssetIds: relation.referencedColumnAssetIds }
              : {},
          })),
        }
        try {
          const result = await generator.generate(selection, input, controller.signal)
          generated += await upsertGeneratedMeaning(run, table, result.table.meaning, selection)
          const byId = new Map(fields.map(field => [field.assetId, field]))
          for (const fieldMeaning of result.fields) {
            generated += await upsertGeneratedMeaning(run, byId.get(fieldMeaning.assetId)!, fieldMeaning.meaning, selection)
          }
          completed += 1
        } catch (error) {
          if (controller.signal.aborted) throw error
          failed += 1
          const message = catalogEnrichmentError(error, connection, table.payload.path)
          errors.push(message)
          options.logger?.warn('data-agent Catalog AI enrichment failed for %s: %s', table.payload.path, message)
        }
        run = await setRun(run, {
          enrichment: {
            ...run.enrichment!,
            tablesCompleted: completed,
            tablesFailed: failed,
            candidatesGenerated: generated,
            ...errors.length > 0 ? { error: errors.slice(-3).join(' | ') } : {},
          },
        })
      }
      await rebuildIndex(run.sourceId)
      const status: CatalogEnrichment['status'] = failed === 0 ? 'succeeded' : completed === 0 ? 'failed' : 'partial'
      return setRun(run, {
        enrichment: {
          ...run.enrichment!,
          status,
          completedAt: now(),
          ...errors.length > 0 ? { error: errors.slice(-3).join(' | ') } : {},
        },
      })
    } catch (error) {
      const cancelled = controller.signal.aborted
      const message = catalogEnrichmentError(error, connection)
      return setRun(run, {
        enrichment: {
          ...run.enrichment!,
          status: cancelled ? 'cancelled' : completed === 0 ? 'failed' : 'partial',
          tablesCompleted: completed,
          tablesFailed: failed + (cancelled ? 0 : 1),
          candidatesGenerated: generated,
          completedAt: now(),
          error: message,
        },
      })
    }
  }

  async function upsertGeneratedMeaning(
    run: CatalogRun,
    asset: CatalogAssetRevision,
    description: string,
    selection: CatalogModelSelection,
  ): Promise<number> {
    const semanticId = `meaning_${asset.assetId}`
    const existing = persistence.getSemanticEntry(semanticId)
    const current = existing === undefined ? undefined : currentSemantic(existing)
    if (current !== undefined) {
      if (current.definition.kind !== 'meaning') throw new Error(`Catalog semantic id collision: ${semanticId}`)
      if (current.definition.status !== 'inferred' || current.definition.description === description) return 0
    }
    const definition: MeaningDefinition = {
      kind: 'meaning',
      name: asset.payload.name,
      aliases: [],
      description,
      sourceAssetIds: [asset.assetId],
      status: 'inferred',
      targetAssetId: asset.assetId,
      targetKind: asset.payload.identity.kind as MeaningDefinition['targetKind'],
      generatedBy: {
        kind: 'ai',
        provider: selection.provider,
        model: selection.model,
        runId: run.id,
      },
      triggerRunId: run.id,
      revisionNote: `AI business meaning candidate generated by Catalog run ${run.id}`,
    }
    await appendSemantic(run.sourceId, definition, semanticId, existing?.currentVersion, false, false)
    return 1
  }

  function catalogEnrichmentError(error: unknown, connection: DatabaseConnection, path?: string): string {
    const raw = error instanceof Error ? error.message : String(error)
    const prefix = path === undefined ? '' : `${path}: `
    return normalizeCatalogText(
      redactSecretText(`${prefix}${raw}`, [connection.password]),
      options.maxTextChars,
    ).value
  }

  function validateAdapterResult(result: CatalogAdapterResult, run: CatalogRun): void {
    if (result.observations.length > options.maxAssetsPerRun) {
      throw new Error(`Catalog scan exceeded maxAssetsPerRun (${options.maxAssetsPerRun})`)
    }
    result.observations.forEach(value => catalogObservationSchema.parse(value))
    result.relations.forEach(value => catalogRelationSchema.parse(value))
    const ids = new Set(result.observations.map(value => value.assetId))
    if (ids.size !== result.observations.length) throw new Error('Catalog adapter returned duplicate asset ids')
    for (const observation of result.observations) {
      if (observation.runId !== run.id || observation.sourceId !== run.sourceId) {
        throw new Error('Catalog adapter returned an observation for another run or source')
      }
      const parentId = observation.payload.parentId
      if (parentId !== undefined && !ids.has(parentId) && currentRevision(parentId) === undefined) {
        throw new Error(`Catalog observation has unknown parent ${parentId}`)
      }
    }
    const relationIds = new Set(result.relations.map(value => value.id))
    if (relationIds.size !== result.relations.length) throw new Error('Catalog adapter returned duplicate relation ids')
    const knownAsset = (assetId: string): boolean => ids.has(assetId) || currentRevision(assetId) !== undefined
    for (const relation of result.relations) {
      if (relation.runId !== run.id || relation.sourceId !== run.sourceId) {
        throw new Error('Catalog adapter returned a relation for another run or source')
      }
      const references = [relation.fromAssetId, relation.toAssetId, ...relation.columnAssetIds, ...relation.referencedColumnAssetIds ?? []]
        .filter((value): value is string => value !== undefined)
      const unknown = references.find(assetId => !knownAsset(assetId))
      if (unknown !== undefined) throw new Error(`Catalog relation has unknown asset reference ${unknown}`)
    }
  }

  async function promote(run: CatalogRun, result: CatalogAdapterResult): Promise<void> {
    const observations = [...result.observations]
    const observedIds = new Set(observations.map(value => value.assetId))
    if (result.coverageComplete) {
      for (const head of persistence.listAssetHeads(run.sourceId)) {
        const current = currentRevision(head.assetId)
        if (current === undefined || current.status === 'missing' || !inScope(current, run.scope) || observedIds.has(head.assetId)) continue
        const payload = {
          ...current.payload,
          provenance: { ...current.payload.provenance, runId: run.id },
        }
        observations.push({
          runId: run.id,
          sourceId: run.sourceId,
          assetId: current.assetId,
          status: 'missing',
          fingerprint: catalogTechnicalFingerprint(payload, 'missing'),
          observedAt: now(),
          payload,
        })
      }
    }
    for (const observation of observations) await promoteObservation(observation)
    for (const relation of result.relations) await persistence.putRelation(relation)
  }

  async function promoteObservation(observation: CatalogObservation): Promise<void> {
    const current = currentRevision(observation.assetId)
    const existingHead = persistence.getAssetHead(observation.assetId)
    if (current?.fingerprint === observation.fingerprint && current.status === observation.status) {
      if (existingHead !== undefined) await persistence.putAssetHead({ ...existingHead, lastSeenAt: observation.observedAt })
      return
    }
    const revisionNumber = (existingHead?.revisionIds.length ?? 0) + 1
    const revision: CatalogAssetRevision = {
      id: catalogRevisionId(observation.assetId, revisionNumber),
      assetId: observation.assetId,
      sourceId: observation.sourceId,
      runId: observation.runId,
      revision: revisionNumber,
      status: observation.status,
      fingerprint: observation.fingerprint,
      observedAt: observation.observedAt,
      ...current !== undefined ? { previousRevisionId: current.id } : {},
      changeSummary: summarizeTechnicalChange(current, observation),
      payload: observation.payload,
    }
    await persistence.putAssetRevision(revision)
    const head: CatalogAssetHead = existingHead === undefined
      ? {
          assetId: observation.assetId,
          sourceId: observation.sourceId,
          revisionIds: [revision.id],
          firstSeenAt: observation.observedAt,
          lastSeenAt: observation.observedAt,
        }
      : {
          ...existingHead,
          revisionIds: [...existingHead.revisionIds, revision.id],
          lastSeenAt: observation.observedAt,
        }
    await persistence.putAssetHead(head)
  }

  async function appendSemantic(
    sourceId: string,
    rawDefinition: SemanticDefinition,
    semanticId: string | undefined,
    expectedVersion: number | undefined,
    requireExisting: boolean,
    rebuild = true,
  ): Promise<CatalogSemanticRevision> {
    requireKnownSource(sourceId)
    const definition = semanticDefinitionSchema.parse(normalizeSemanticDefinition(rawDefinition, options.maxTextChars))
    validateSemanticReferences(sourceId, definition)
    const id = semanticId ?? (definition.kind === 'meaning'
      ? `meaning_${definition.targetAssetId}`
      : catalogSemanticId(sourceId, definition.kind, definition.name))
    const existing = persistence.getSemanticEntry(id)
    if (requireExisting && existing === undefined) throw new Error(`Unknown Catalog semantic: ${id}`)
    if (existing !== undefined && existing.sourceId !== sourceId) throw new Error('Semantic belongs to another Catalog source')
    if (existing !== undefined && expectedVersion !== existing.currentVersion) throw new CatalogVersionConflictError(currentSemantic(existing))
    if (existing === undefined && expectedVersion !== undefined && expectedVersion !== 0) {
      throw new Error('New semantic expectedVersion must be 0 or omitted')
    }
    const version = (existing?.currentVersion ?? 0) + 1
    const timestamp = now()
    const revision: CatalogSemanticRevision = {
      id: catalogSemanticRevisionId(id, version),
      semanticId: id,
      sourceId,
      version,
      createdAt: timestamp,
      definition,
    }
    await persistence.putSemanticRevision(revision)
    await persistence.putSemanticEntry({
      id,
      sourceId,
      kind: definition.kind,
      currentVersion: version,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
    if (rebuild) await rebuildIndex(sourceId)
    return revision
  }

  function validateSemanticReferences(sourceId: string, definition: SemanticDefinition): void {
    for (const assetId of definition.sourceAssetIds) {
      const revision = currentRevision(assetId)
      if (revision === undefined || revision.sourceId !== sourceId) throw new Error(`Unknown or cross-source asset reference: ${assetId}`)
    }
    if (definition.kind === 'metric' && definition.timeFieldAssetId !== undefined) {
      const field = currentRevision(definition.timeFieldAssetId)
      if (field === undefined || field.sourceId !== sourceId || field.payload.identity.kind !== 'column') {
        throw new Error(`Invalid metric time field: ${definition.timeFieldAssetId}`)
      }
    }
    if (definition.kind === 'meaning') {
      const target = currentRevision(definition.targetAssetId)
      if (target === undefined || target.sourceId !== sourceId || target.payload.identity.kind !== definition.targetKind) {
        throw new Error(`Invalid business meaning target: ${definition.targetAssetId}`)
      }
      if (definition.sourceAssetIds.length !== 1 || definition.sourceAssetIds[0] !== definition.targetAssetId) {
        throw new Error('Business meaning sourceAssetIds must contain only its target asset')
      }
      const generatedRun = persistence.getRun(definition.generatedBy.runId)
      if (generatedRun === undefined || generatedRun.sourceId !== sourceId) {
        throw new Error(`Invalid business meaning generation run: ${definition.generatedBy.runId}`)
      }
    }
  }

  async function markImpactedSemantics(run: CatalogRun): Promise<void> {
    const changed = persistence.listAssetRevisions()
      .filter(revision => revision.runId === run.id && (revision.status === 'missing' || incompatibleTypeChange(revision)))
    if (changed.length === 0) return
    const changedIds = new Set(changed.map(revision => revision.assetId))
    for (const entry of persistence.listSemanticEntries(run.sourceId)) {
      const current = currentSemantic(entry)
      if (current.definition.status === 'retired' || current.definition.status === 'needs_review') continue
      const impacted = current.definition.sourceAssetIds.filter(id => changedIds.has(id))
      if (current.definition.kind === 'metric' && current.definition.timeFieldAssetId !== undefined
          && changedIds.has(current.definition.timeFieldAssetId)) impacted.push(current.definition.timeFieldAssetId)
      if (impacted.length === 0) continue
      await appendSemantic(run.sourceId, {
        ...current.definition,
        status: 'needs_review',
        needsReviewReason: `Referenced Catalog assets changed: ${[...new Set(impacted)].join(', ')}`,
        triggerRunId: run.id,
        revisionNote: `Automatically marked needs_review after Catalog run ${run.id}`,
      }, entry.id, entry.currentVersion, true)
    }
  }

  async function ensureIndex(sourceId: string): Promise<void> {
    if (persistence.getIndexState()?.version !== 1 || persistence.listIndex(sourceId).length === 0) {
      await rebuildIndex(sourceId)
    }
  }

  async function rebuildIndex(sourceId: string): Promise<void> {
    await persistence.clearIndex(sourceId)
    const timestamp = now()
    for (const head of persistence.listAssetHeads(sourceId)) {
      const revision = currentRevision(head.assetId)
      if (revision === undefined) continue
      const payload = revision.payload
      const item: CatalogSearchItem = {
        id: revision.assetId,
        sourceId,
        resultType: 'asset',
        kind: payload.identity.kind,
        name: payload.name,
        path: payload.path,
        summary: payload.comment ?? payload.dataType ?? '',
        matchReasons: [],
        status: revision.status,
        provenance: 'database',
        untrusted: true,
      }
      await persistence.putIndex(indexRecord(item, [payload.name, payload.path, payload.comment, payload.dataType], timestamp))
    }
    for (const entry of persistence.listSemanticEntries(sourceId)) {
      const revision = currentSemantic(entry)
      const definition = revision.definition
      if (definition.status === 'retired') continue
      const item: CatalogSearchItem = {
        id: entry.id,
        sourceId,
        resultType: 'semantic',
        kind: definition.kind,
        name: definition.name,
        path: `${definition.kind}:${definition.name}`,
        summary: definition.description,
        matchReasons: [],
        status: definition.status,
        version: revision.version,
        provenance: definition.status === 'inferred' ? 'inferred' : 'human',
        untrusted: true,
      }
      await persistence.putIndex(indexRecord(item, [definition.name, ...definition.aliases, definition.description, definition.kind === 'metric' ? definition.formula : undefined], timestamp))
    }
    await persistence.putIndexState({ version: 1, rebuiltAt: timestamp })
  }

  function indexRecord(item: CatalogSearchItem, values: (string | undefined)[], timestamp: string): CatalogIndexRecord {
    const searchText = values.filter((value): value is string => value !== undefined)
      .join(' ').normalize('NFKC').toLocaleLowerCase('en-US')
    return { id: `${item.resultType}:${item.id}`, sourceId: item.sourceId, resultType: item.resultType, searchText, searchItem: item, updatedAt: timestamp }
  }

  function buildDiff(sourceId: string, from: CatalogRun, to: CatalogRun): CatalogDiffItem[] {
    const items: CatalogDiffItem[] = []
    for (const head of persistence.listAssetHeads(sourceId)) {
      const before = revisionAtRun(head.assetId, from)
      const after = revisionAtRun(head.assetId, to)
      if (before?.id === after?.id || (before === undefined && after === undefined)) continue
      const kind = diffKind(before, after)
      if (kind === undefined) continue
      const revision = after ?? before!
      items.push({
        kind,
        assetId: head.assetId,
        name: revision.payload.name,
        path: revision.payload.path,
        ...before !== undefined ? { fromRevisionId: before.id } : {},
        ...after !== undefined ? { toRevisionId: after.id } : {},
        summary: after?.changeSummary ?? ['asset removed from the target snapshot'],
      })
    }
    return items.sort((a, b) => diffOrder(a.kind) - diffOrder(b.kind) || a.path.localeCompare(b.path) || a.assetId.localeCompare(b.assetId))
  }

  function currentRelations(sourceId: string): CatalogRelation[] {
    const runs = successfulRuns(sourceId)
    const latestApplicableRun = new Map<string, string>()
    for (const head of persistence.listAssetHeads(sourceId)) {
      const revision = currentRevision(head.assetId)
      if (revision === undefined) continue
      const run = [...runs].reverse().find(candidate => inScope(revision, candidate.scope))
      if (run !== undefined) latestApplicableRun.set(head.assetId, run.id)
    }
    return persistence.listRelations(sourceId)
      .filter(relation => latestApplicableRun.get(relation.fromAssetId) === relation.runId)
      .sort((a, b) => a.kind.localeCompare(b.kind) || (a.name ?? '').localeCompare(b.name ?? '') || a.id.localeCompare(b.id))
  }

  function requireKnownSource(sourceId: string): CatalogSource {
    const source = persistence.getSource(nonEmpty(sourceId, 'sourceId'))
    if (source === undefined) throw new Error(`Unknown Catalog source: ${sourceId}`)
    return source
  }

  function requireSemanticEntry(sourceId: string, semanticId: string): CatalogSemanticEntry {
    const entry = persistence.getSemanticEntry(semanticId)
    if (entry === undefined || entry.sourceId !== sourceId) throw new Error(`Unknown Catalog semantic: ${semanticId}`)
    return entry
  }

  await scanner.interruptActiveRuns()
  return { read, scanner, review }
}

function compareRun(a: CatalogRun, b: CatalogRun): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

function runOrderKey(run: CatalogRun): string {
  return `${run.createdAt}\0${run.id}`
}

function inScope(revision: CatalogAssetRevision, scope: CatalogScope): boolean {
  const identity = revision.payload.identity
  if (scope.kind === 'source') return true
  if (identity.schema.toLocaleLowerCase('en-US') !== scope.schema.toLocaleLowerCase('en-US')) return false
  if (scope.kind === 'schema') return true
  const relation = identity.kind === 'table' || identity.kind === 'view' ? identity.name : identity.relation
  return relation?.toLocaleLowerCase('en-US') === scope.table.toLocaleLowerCase('en-US')
}

function isBusinessSchema(source: CatalogSource, schema: string): boolean {
  const normalized = schema.toLocaleLowerCase('en-US')
  if (source.type === 'mysql' || source.type === 'doris' || source.type === 'clickhouse') {
    return normalized === source.database.toLocaleLowerCase('en-US')
  }
  if (source.type === 'sqlite') return normalized === 'main'
  if (normalized === 'information_schema' || normalized === 'sys' || normalized === 'system') return false
  if (source.type === 'postgres' && (normalized === 'pg_catalog' || normalized.startsWith('pg_toast'))) return false
  if (source.type === 'oracle' && ['sys', 'system', 'xdb', 'outln'].includes(normalized)) return false
  return true
}

function normalizeScope(type: DatabaseType, scope: CatalogScope): CatalogScope {
  if (scope.kind === 'source') return scope
  const schema = normalizeCatalogIdentifier(type, scope.schema)
  if (scope.kind === 'schema') return { kind: 'schema', schema }
  return { kind: 'table', schema, table: normalizeCatalogIdentifier(type, scope.table) }
}

function summarizeTechnicalChange(current: CatalogAssetRevision | undefined, next: CatalogObservation): string[] {
  if (current === undefined) return ['added']
  if (current.status === 'missing' && next.status === 'observed') return ['restored']
  if (next.status === 'missing') return ['missing']
  if (next.status === 'unavailable') return ['unavailable']
  const fields: string[] = []
  for (const key of ['dataType', 'nullable', 'comment', 'parentId', 'objectType'] as const) {
    if (stableJson(current.payload[key]) !== stableJson(next.payload[key])) fields.push(`${key} changed`)
  }
  return fields.length > 0 ? fields : ['technical metadata changed']
}

function incompatibleTypeChange(revision: CatalogAssetRevision): boolean {
  if (revision.payload.identity.kind !== 'column' || revision.previousRevisionId === undefined) return false
  return revision.changeSummary.includes('dataType changed')
}

function diffKind(before: CatalogAssetRevision | undefined, after: CatalogAssetRevision | undefined): CatalogDiffItem['kind'] | undefined {
  if (before === undefined && after !== undefined) return 'added'
  if (after === undefined) return undefined
  if (after.status === 'missing' && before?.status !== 'missing') return 'missing'
  if (after.status === 'unavailable' && before?.status !== 'unavailable') return 'unavailable'
  if (before?.status === 'missing' && after.status === 'observed') return 'restored'
  if (before?.fingerprint !== after.fingerprint) return 'changed'
  return undefined
}

function diffOrder(kind: CatalogDiffItem['kind']): number {
  return ['added', 'changed', 'missing', 'restored', 'unavailable'].indexOf(kind)
}

function filterSearchItem(item: CatalogSearchItem, request: CatalogSearchRequest): boolean {
  const filters = request.filters
  if (item.resultType === 'asset') {
    if (filters.assetKinds !== undefined && !filters.assetKinds.some(value => value === item.kind)) return false
    if (filters.assetStatuses !== undefined && !filters.assetStatuses.some(value => value === item.status)) return false
    if (filters.schema !== undefined && !item.path.toLocaleLowerCase('en-US').includes(`.${filters.schema.toLocaleLowerCase('en-US')}.`)) return false
    return true
  }
  if (filters.semanticKinds !== undefined && !filters.semanticKinds.some(value => value === item.kind)) return false
  if (item.status === 'inferred' && !filters.includeInferred) return false
  if (filters.semanticStatuses !== undefined && !filters.semanticStatuses.some(value => value === item.status)) return false
  return true
}

function compareSearchItems(a: CatalogSearchItem, b: CatalogSearchItem): number {
  return searchRank(a) - searchRank(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
}

function searchRank(item: CatalogSearchItem): number {
  if (item.resultType === 'semantic' && item.status === 'verified') return 0
  if (item.resultType === 'asset' && item.status === 'observed') return 10
  if (item.status === 'needs_review') return 20
  if (item.status === 'inferred') return 30
  if (item.status === 'missing') return 40
  return 50
}

function searchMatchReasons(item: CatalogSearchItem, query: string): string[] {
  if (query === '*') return ['browse']
  const reasons: string[] = []
  if (item.name.toLocaleLowerCase('en-US').includes(query)) reasons.push('name')
  if (item.path.toLocaleLowerCase('en-US').includes(query)) reasons.push('path')
  if (item.summary.toLocaleLowerCase('en-US').includes(query)) reasons.push('description')
  return reasons.length > 0 ? reasons : ['definition or alias']
}

function encodeCursor(offset: number, sourceId: string, query: string): string {
  return Buffer.from(JSON.stringify({ offset, sourceId, query }), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string | undefined, sourceId: string, query: string): number {
  if (cursor === undefined) return 0
  if (cursor.length > 512) throw new Error('Invalid Catalog cursor')
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>
    if (!Number.isInteger(parsed.offset) || (parsed.offset as number) < 0 || parsed.sourceId !== sourceId || parsed.query !== query) {
      throw new Error('mismatch')
    }
    return parsed.offset as number
  } catch {
    throw new Error('Invalid Catalog cursor')
  }
}

function nonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) throw new Error(`${label} must be a non-empty bounded string`)
  return value
}

function normalizeSemanticDefinition(definition: SemanticDefinition, maxTextChars: number): SemanticDefinition {
  const text = (value: string, max = maxTextChars): string => normalizeCatalogText(value, max).value
  const common = {
    ...definition,
    name: text(definition.name, 256),
    aliases: definition.aliases.map(value => text(value, 256)),
    description: text(definition.description),
    ...definition.owner !== undefined ? { owner: text(definition.owner, 256) } : {},
    ...definition.revisionNote !== undefined ? { revisionNote: text(definition.revisionNote) } : {},
    ...definition.needsReviewReason !== undefined ? { needsReviewReason: text(definition.needsReviewReason) } : {},
  }
  if (definition.kind === 'meaning') {
    return {
      ...common,
      kind: 'meaning',
      targetAssetId: definition.targetAssetId,
      targetKind: definition.targetKind,
      generatedBy: {
        kind: 'ai',
        provider: text(definition.generatedBy.provider, 256),
        model: text(definition.generatedBy.model, 512),
        runId: definition.generatedBy.runId,
      },
    }
  }
  if (definition.kind === 'term') return { ...common, kind: 'term' }
  return {
    ...common,
    kind: 'metric',
    formula: text(definition.formula, 8_192),
    grain: text(definition.grain, 512),
    filters: definition.filters.map(value => text(value, 2_048)),
    exclusions: definition.exclusions.map(value => text(value, 2_048)),
  }
}
