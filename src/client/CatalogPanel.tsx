import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { DataAgentKey } from './locales.ts'
import {
  cancelCatalogScan,
  dismissCatalogMeaning,
  getCatalogAsset,
  getCatalogDiff,
  getCatalogSemantic,
  getCatalogStatus,
  listCatalogSources,
  listCatalogRuns,
  retireCatalogSemantic,
  saveCatalogCandidate,
  searchCatalog,
  startCatalogScan,
  verifyCatalogSemantic,
  type CatalogAssetDetail,
  type CatalogDiffPage,
  type CatalogRun,
  type CatalogScope,
  type CatalogSearchItem,
  type CatalogSemanticRevision,
  type CatalogSource,
  type CatalogStatusWire,
  type SemanticDefinition,
} from './catalog-client.ts'
import css from './DataAgentWorkbench.module.css'

type T = (key: DataAgentKey, values?: Record<string, string | number>) => string

interface CatalogPanelProps {
  id: string
  labelledBy: string
  active: boolean
  sessionId: string
  connected: boolean
  connectionProfileId?: string
  stateKey: object
  t: T
  onAvailabilityChange(available: boolean): void
}

type DetailTab = 'technical' | 'business' | 'history'
type Selection = { type: 'asset'; item: CatalogSearchItem } | { type: 'semantic'; item: CatalogSearchItem }

interface MetricDraft {
  name: string
  aliases: string
  description: string
  formula: string
  grain: string
  sourceAssetIds: string
  timeFieldAssetId: string
  filters: string
  exclusions: string
  validFrom: string
  validTo: string
  owner: string
  revisionNote: string
}

const EMPTY_DRAFT: MetricDraft = {
  name: '', aliases: '', description: '', formula: '', grain: '', sourceAssetIds: '', timeFieldAssetId: '',
  filters: '', exclusions: '', validFrom: '', validTo: '', owner: '', revisionNote: '',
}

interface TermDraft {
  name: string
  aliases: string
  description: string
  sourceAssetIds: string
  validFrom: string
  validTo: string
  owner: string
  revisionNote: string
}

const EMPTY_TERM_DRAFT: TermDraft = {
  name: '', aliases: '', description: '', sourceAssetIds: '', validFrom: '', validTo: '', owner: '', revisionNote: '',
}

interface CatalogPanelMemory {
  sources: CatalogSource[]
  sourceId: string
  status: CatalogStatusWire | null
  query: string
  schema: string
  kind: string
  assetStatus: string
  semanticStatus: string
  includeInferred: boolean
  items: CatalogSearchItem[]
  nextCursor?: string
  selection: Selection | null
  assetDetail: CatalogAssetDetail | null
  semanticDetail: CatalogSemanticRevision | null
  detailTab: DetailTab
  scanKind: CatalogScope['kind']
  scanSchema: string
  scanTable: string
  diff: CatalogDiffPage | null
  runs: CatalogRun[]
  diffFrom: string
  diffTo: string
  editingMetric: boolean
  metricDraft: MetricDraft
  editingTerm: boolean
  termDraft: TermDraft
}

const catalogPanelMemory = new WeakMap<object, CatalogPanelMemory>()

export function CatalogPanel(props: CatalogPanelProps) {
  const { active, connected, connectionProfileId, sessionId, t, onAvailabilityChange } = props
  const saved = catalogPanelMemory.get(props.stateKey)
  const [sources, setSources] = useState<CatalogSource[]>(saved?.sources ?? [])
  const [sourceId, setSourceId] = useState<string>(saved?.sourceId ?? '')
  const [status, setStatus] = useState<CatalogStatusWire | null>(saved?.status ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState(saved?.query ?? '')
  const [schema, setSchema] = useState(saved?.schema ?? '')
  const [kind, setKind] = useState(saved?.kind ?? 'relation')
  const [assetStatus, setAssetStatus] = useState(saved?.assetStatus ?? 'observed')
  const [semanticStatus, setSemanticStatus] = useState(saved?.semanticStatus ?? '')
  const [includeInferred, setIncludeInferred] = useState(saved?.includeInferred ?? false)
  const [items, setItems] = useState<CatalogSearchItem[]>(saved?.items ?? [])
  const [nextCursor, setNextCursor] = useState<string | undefined>(saved?.nextCursor)
  const [selection, setSelection] = useState<Selection | null>(saved?.selection ?? null)
  const [assetDetail, setAssetDetail] = useState<CatalogAssetDetail | null>(saved?.assetDetail ?? null)
  const [semanticDetail, setSemanticDetail] = useState<CatalogSemanticRevision | null>(saved?.semanticDetail ?? null)
  const [detailTab, setDetailTab] = useState<DetailTab>(saved?.detailTab ?? 'technical')
  const [scanKind, setScanKind] = useState<CatalogScope['kind']>(saved?.scanKind ?? 'schema')
  const [scanSchema, setScanSchema] = useState(saved?.scanSchema ?? '')
  const [scanTable, setScanTable] = useState(saved?.scanTable ?? '')
  const [confirmFull, setConfirmFull] = useState(false)
  const [diff, setDiff] = useState<CatalogDiffPage | null>(saved?.diff ?? null)
  const [runs, setRuns] = useState<CatalogRun[]>(saved?.runs ?? [])
  const [diffFrom, setDiffFrom] = useState(saved?.diffFrom ?? '')
  const [diffTo, setDiffTo] = useState(saved?.diffTo ?? '')
  const [editingMetric, setEditingMetric] = useState(saved?.editingMetric ?? false)
  const [metricDraft, setMetricDraft] = useState<MetricDraft>(saved?.metricDraft ?? EMPTY_DRAFT)
  const [editingTerm, setEditingTerm] = useState(saved?.editingTerm ?? false)
  const [termDraft, setTermDraft] = useState<TermDraft>(saved?.termDraft ?? EMPTY_TERM_DRAFT)
  const detailRequestId = useRef(0)
  const detailController = useRef<AbortController | null>(null)
  const previousSourceId = useRef(sourceId)
  const searchInput = useRef({ query, schema, kind, assetStatus, semanticStatus, includeInferred })

  useEffect(() => {
    searchInput.current = { query, schema, kind, assetStatus, semanticStatus, includeInferred }
  }, [query, schema, kind, assetStatus, semanticStatus, includeInferred])

  useEffect(() => {
    catalogPanelMemory.set(props.stateKey, {
      sources, sourceId, status, query, schema, kind, assetStatus, semanticStatus, includeInferred, items,
      ...nextCursor !== undefined ? { nextCursor } : {},
      selection, assetDetail, semanticDetail, detailTab, scanKind, scanSchema, scanTable,
      diff, runs, diffFrom, diffTo, editingMetric, metricDraft, editingTerm, termDraft,
    })
  })

  const effectiveSourceId = sourceId || connectionProfileId || ''
  const scanAllowed = connected && connectionProfileId !== undefined
    && (sourceId === '' || sourceId === connectionProfileId)
  const activeRun = status?.activeRun

  const reportError = useCallback((cause: unknown): void => {
    setError(cause instanceof Error ? cause.message : String(cause))
  }, [])

  const refreshSources = useCallback(async (signal?: AbortSignal): Promise<CatalogSource[]> => {
    const response = await listCatalogSources(signal)
    if (signal?.aborted) return []
    const next = Array.isArray(response) ? response : []
    setSources(next)
    onAvailabilityChange(next.length > 0)
    setSourceId(current => {
      if (current !== '' && next.some(source => source.id === current)) return current
      if (connectionProfileId !== undefined && next.some(source => source.id === connectionProfileId)) return connectionProfileId
      return next[0]?.id ?? ''
    })
    return next
  }, [connectionProfileId, onAvailabilityChange])

  useEffect(() => {
    const controller = new AbortController()
    void refreshSources(controller.signal).catch(cause => {
      if (!controller.signal.aborted) reportError(cause)
    })
    return () => controller.abort()
  }, [refreshSources, reportError])

  useEffect(() => () => detailController.current?.abort(), [])

  const refreshStatus = useCallback(async (signal?: AbortSignal): Promise<CatalogStatusWire | null> => {
    if (sourceId === '') { setStatus(null); return null }
    const next = await getCatalogStatus(sourceId, signal)
    if (signal?.aborted) return next
    setStatus(next)
    return next
  }, [sourceId])

  const refreshRuns = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (sourceId === '') { setRuns([]); return }
    const next = await listCatalogRuns(sourceId, signal)
    if (signal?.aborted) return
    setRuns(next)
    const successful = next.filter(run => run.status === 'succeeded')
    setDiffFrom(current => successful.some(run => run.id === current) ? current : successful.at(-2)?.id ?? '')
    setDiffTo(current => successful.some(run => run.id === current) ? current : successful.at(-1)?.id ?? '')
  }, [sourceId])

  const runSearch = useCallback(async (cursor?: string, append = false, signal?: AbortSignal): Promise<void> => {
    if (sourceId === '') { setItems([]); setNextCursor(undefined); return }
    const input = searchInput.current
    const page = await searchCatalog({
      sourceId,
      query: input.query,
      ...input.schema !== '' ? { schema: input.schema } : {},
      ...input.kind === 'relation' ? { assetKinds: ['table', 'view'] } : {},
      ...input.kind !== '' && input.kind !== 'relation' && input.kind !== 'meaning' && input.kind !== 'term' && input.kind !== 'metric'
        ? { assetKinds: [input.kind] }
        : {},
      ...input.kind === 'meaning' || input.kind === 'term' || input.kind === 'metric' ? { semanticKinds: [input.kind] } : {},
      ...input.assetStatus !== '' ? { assetStatuses: [input.assetStatus] } : {},
      ...input.semanticStatus !== '' ? { semanticStatuses: [input.semanticStatus] } : {},
      includeInferred: input.includeInferred,
      ...cursor !== undefined ? { cursor } : {},
      pageSize: 50,
    }, signal)
    if (signal?.aborted) return
    setItems(current => append ? [...current, ...page.items] : page.items)
    setNextCursor(page.nextCursor)
  }, [sourceId])

  useEffect(() => {
    if (previousSourceId.current === sourceId) return
    previousSourceId.current = sourceId
    detailRequestId.current += 1
    detailController.current?.abort()
    setSelection(null)
    setAssetDetail(null)
    setSemanticDetail(null)
    setDiff(null)
    setEditingMetric(false)
    setEditingTerm(false)

    const selectedSource = sources.find(source => source.id === sourceId)
    const nextSearch = {
      query: '',
      schema: selectedSource === undefined ? '' : defaultBrowseSchema(selectedSource),
      kind: 'relation',
      assetStatus: 'observed',
      semanticStatus: '',
      includeInferred: false,
    }
    searchInput.current = nextSearch
    setQuery(nextSearch.query)
    setSchema(nextSearch.schema)
    setKind(nextSearch.kind)
    setAssetStatus(nextSearch.assetStatus)
    setSemanticStatus(nextSearch.semanticStatus)
    setIncludeInferred(nextSearch.includeInferred)
  }, [sourceId, sources])

  useEffect(() => {
    if (sourceId === '') return
    const controller = new AbortController()
    setBusy(true)
    Promise.all([refreshStatus(controller.signal), refreshRuns(controller.signal), runSearch(undefined, false, controller.signal)])
      .catch(cause => { if (!controller.signal.aborted) reportError(cause) })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [sourceId, refreshStatus, refreshRuns, runSearch, reportError])

  useEffect(() => {
    if (!active || activeRun === undefined || sourceId === '') return
    const timer = window.setInterval(() => {
      void refreshStatus().then(next => Promise.all([
        runSearch(),
        ...(next?.activeRun === undefined ? [refreshSources(), refreshRuns()] : []),
      ])).catch(reportError)
    }, 1_500)
    return () => window.clearInterval(timer)
  }, [active, activeRun, sourceId, refreshStatus, runSearch, refreshSources, refreshRuns, reportError])

  const selectItem = async (item: CatalogSearchItem): Promise<void> => {
    detailController.current?.abort()
    const controller = new AbortController()
    detailController.current = controller
    const requestId = ++detailRequestId.current
    setSelection({ type: item.resultType, item } as Selection)
    setDetailTab(item.resultType === 'asset' ? 'technical' : 'business')
    setAssetDetail(null)
    setSemanticDetail(null)
    setEditingMetric(false)
    setEditingTerm(false)
    setBusy(true)
    setError(null)
    try {
      if (item.resultType === 'asset') {
        const detail = await getCatalogAsset(sourceId, item.id, undefined, controller.signal)
        if (requestId === detailRequestId.current) setAssetDetail(detail)
      }
      else {
        const semantic = await getCatalogSemantic(sourceId, item.id, undefined, controller.signal)
        if (requestId !== detailRequestId.current) return
        setSemanticDetail(semantic)
        if (semantic.definition.kind === 'metric') setMetricDraft(draftFromSemantic(semantic))
        else if (semantic.definition.kind === 'term') setTermDraft(termDraftFromSemantic(semantic))
      }
    } catch (cause) {
      if (!controller.signal.aborted && requestId === detailRequestId.current) reportError(cause)
    } finally {
      setBusy(current => requestId === detailRequestId.current ? false : current)
    }
  }

  const loadMoreFields = async (): Promise<void> => {
    if (assetDetail?.nextCursor === undefined || sourceId === '') return
    setBusy(true)
    try {
      const next = await getCatalogAsset(sourceId, assetDetail.asset.assetId, assetDetail.nextCursor)
      setAssetDetail({
        ...next,
        fields: [...assetDetail.fields, ...next.fields],
        relations: [...new Map([...assetDetail.relations, ...next.relations].map(value => [value.id, value])).values()],
        semantics: [...new Map([...assetDetail.semantics, ...next.semantics].map(value => [value.semanticId, value])).values()],
        history: [...new Map([...assetDetail.history, ...next.history].map(value => [value.id, value])).values()],
      })
    } catch (cause) { reportError(cause) } finally { setBusy(false) }
  }

  const beginScan = async (): Promise<void> => {
    if (!scanAllowed) { setError(t('catalog.scan.reconnect')); return }
    if (scanKind === 'source' && !confirmFull) { setConfirmFull(true); return }
    let scope: CatalogScope
    if (scanKind === 'source') scope = { kind: 'source' }
    else if (scanKind === 'schema') {
      if (scanSchema.trim() === '') { setError(t('catalog.validation.schema')); return }
      scope = { kind: 'schema', schema: scanSchema.trim() }
    } else {
      if (scanSchema.trim() === '' || scanTable.trim() === '') { setError(t('catalog.validation.table')); return }
      scope = { kind: 'table', schema: scanSchema.trim(), table: scanTable.trim() }
    }
    setBusy(true)
    setError(null)
    try {
      await startCatalogScan(sessionId, scope)
      const nextSources = await refreshSources()
      const nextSourceId = connectionProfileId ?? nextSources[0]?.id
      if (nextSourceId !== undefined) {
        setSourceId(nextSourceId)
        setStatus(await getCatalogStatus(nextSourceId))
      }
      setConfirmFull(false)
    } catch (cause) {
      reportError(cause)
    } finally {
      setBusy(false)
    }
  }

  const cancelScan = async (): Promise<void> => {
    if (sourceId === '' || activeRun === undefined) return
    setBusy(true)
    try {
      await cancelCatalogScan(sourceId, activeRun.id)
      await refreshStatus()
    } catch (cause) { reportError(cause) } finally { setBusy(false) }
  }

  const loadDiff = async (cursor?: string, append = false): Promise<void> => {
    if (sourceId === '') return
    setBusy(true)
    try {
      const next = await getCatalogDiff(
        sourceId,
        diffFrom || undefined,
        diffTo || undefined,
        cursor,
      )
      setDiff(current => append && current !== null ? { ...next, items: [...current.items, ...next.items] } : next)
    } catch (cause) { reportError(cause) } finally { setBusy(false) }
  }

  const startMetric = (semantic?: CatalogSemanticRevision): void => {
    setEditingMetric(true)
    setEditingTerm(false)
    setDetailTab('business')
    setMetricDraft(semantic?.definition.kind === 'metric'
      ? draftFromSemantic(semantic)
      : { ...EMPTY_DRAFT, sourceAssetIds: selection?.type === 'asset' ? selection.item.id : '' })
  }

  const startTerm = (semantic?: CatalogSemanticRevision): void => {
    setEditingTerm(true)
    setEditingMetric(false)
    setDetailTab('business')
    setTermDraft(semantic?.definition.kind === 'term'
      ? termDraftFromSemantic(semantic)
      : { ...EMPTY_TERM_DRAFT, sourceAssetIds: selection?.type === 'asset' ? selection.item.id : '' })
  }

  const metricDefinition = (state: 'inferred' | 'verified'): SemanticDefinition => {
    return {
      kind: 'metric',
      name: metricDraft.name,
      aliases: splitList(metricDraft.aliases),
      description: metricDraft.description,
      owner: metricDraft.owner || undefined,
      sourceAssetIds: splitList(metricDraft.sourceAssetIds),
      status: state,
      formula: metricDraft.formula,
      grain: metricDraft.grain,
      timeFieldAssetId: metricDraft.timeFieldAssetId || undefined,
      filters: splitLines(metricDraft.filters),
      exclusions: splitLines(metricDraft.exclusions),
      validFrom: metricDraft.validFrom || undefined,
      validTo: metricDraft.validTo || undefined,
      revisionNote: metricDraft.revisionNote,
    }
  }

  const termDefinition = (state: 'inferred' | 'verified'): SemanticDefinition => ({
    kind: 'term',
    name: termDraft.name,
    aliases: splitList(termDraft.aliases),
    description: termDraft.description,
    owner: termDraft.owner || undefined,
    sourceAssetIds: splitList(termDraft.sourceAssetIds),
    status: state,
    validFrom: termDraft.validFrom || undefined,
    validTo: termDraft.validTo || undefined,
    revisionNote: termDraft.revisionNote,
  })

  const saveMetric = async (verify: boolean): Promise<void> => {
    if (sourceId === '' || metricDraft.name.trim() === '' || metricDraft.formula.trim() === ''
        || metricDraft.grain.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      const semantic = verify && semanticDetail !== null
        ? await verifyCatalogSemantic({
            sourceId,
            semanticId: semanticDetail.semanticId,
            expectedVersion: semanticDetail.version,
            definition: metricDefinition('verified'),
          })
        : await saveCatalogCandidate({
            sourceId,
            ...(semanticDetail !== null ? { semanticId: semanticDetail.semanticId, expectedVersion: semanticDetail.version } : {}),
            definition: metricDefinition('inferred'),
          })
      setSemanticDetail(semantic)
      setMetricDraft(draftFromSemantic(semantic))
      setEditingMetric(false)
      await runSearch()
      await refreshStatus()
    } catch (cause) { reportError(cause) } finally { setBusy(false) }
  }

  const saveTerm = async (verify: boolean): Promise<void> => {
    if (sourceId === '' || termDraft.name.trim() === '' || termDraft.description.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      const semantic = verify && semanticDetail !== null
        ? await verifyCatalogSemantic({
            sourceId,
            semanticId: semanticDetail.semanticId,
            expectedVersion: semanticDetail.version,
            definition: termDefinition('verified'),
          })
        : await saveCatalogCandidate({
            sourceId,
            ...(semanticDetail !== null ? { semanticId: semanticDetail.semanticId, expectedVersion: semanticDetail.version } : {}),
            definition: termDefinition('inferred'),
          })
      setSemanticDetail(semantic)
      setTermDraft(termDraftFromSemantic(semantic))
      setEditingTerm(false)
      await runSearch()
      await refreshStatus()
    } catch (cause) { reportError(cause) } finally { setBusy(false) }
  }

  const retireSemantic = async (revisionNote: string): Promise<void> => {
    if (sourceId === '' || semanticDetail === null || revisionNote.trim() === '') return
    setBusy(true)
    try {
      const semantic = await retireCatalogSemantic({
        sourceId, semanticId: semanticDetail.semanticId, expectedVersion: semanticDetail.version,
        revisionNote,
      })
      setSemanticDetail(semantic)
      await runSearch()
      await refreshStatus()
    } catch (cause) { reportError(cause) } finally { setBusy(false) }
  }

  const refreshSelectedAsset = async (): Promise<void> => {
    if (sourceId === '' || assetDetail === null) return
    setAssetDetail(await getCatalogAsset(sourceId, assetDetail.asset.assetId))
  }

  const confirmMeaning = async (meaning: CatalogSemanticRevision): Promise<void> => {
    if (sourceId === '' || meaning.definition.kind !== 'meaning') return
    setBusy(true)
    setError(null)
    try {
      const semantic = await verifyCatalogSemantic({
        sourceId,
        semanticId: meaning.semanticId,
        expectedVersion: meaning.version,
        definition: {
          ...meaning.definition,
          status: 'verified',
          revisionNote: 'AI-generated business meaning confirmed in Catalog UI',
        },
      })
      if (semanticDetail?.semanticId === semantic.semanticId) setSemanticDetail(semantic)
      await Promise.all([refreshSelectedAsset(), runSearch(), refreshStatus()])
    } catch (cause) { reportError(cause) } finally { setBusy(false) }
  }

  const dismissMeaning = async (meaning: CatalogSemanticRevision): Promise<void> => {
    if (sourceId === '' || meaning.definition.kind !== 'meaning') return
    setBusy(true)
    setError(null)
    try {
      await dismissCatalogMeaning({
        sourceId,
        semanticId: meaning.semanticId,
        expectedVersion: meaning.version,
      })
      if (semanticDetail?.semanticId === meaning.semanticId) setSemanticDetail(null)
      await Promise.all([refreshSelectedAsset(), runSearch(), refreshStatus()])
    } catch (cause) { reportError(cause) } finally { setBusy(false) }
  }

  const statusLabel = (value: string): string => {
    const key = `catalog.state.${value}` as DataAgentKey
    return key in STATUS_KEYS ? t(key) : value
  }

  const kindLabel = (value: string): string => {
    const key = `catalog.kind.${value}` as DataAgentKey
    return key in KIND_KEYS ? t(key) : value
  }

  const displayedSource = sources.find(source => source.id === sourceId)
  const scopeInputs = scanKind !== 'source'
  const technicalRows = assetDetail?.fields ?? []
  const businessDefinitions = assetDetail?.semantics ?? (semanticDetail ? [semanticDetail] : [])
  const meaningDefinitions = businessDefinitions.filter(value => value.definition.kind === 'meaning')
  const governedDefinitions = businessDefinitions.filter(value => value.definition.kind !== 'meaning')
  const assetKind = assetDetail?.asset.payload.identity.kind
  const relationDetail = assetKind === 'table' || assetKind === 'view'
  const fieldDetail = assetKind === 'column'
  const fieldCount = assetDetail === null ? 0 : `${technicalRows.length}${assetDetail.nextCursor === undefined ? '' : '+'}`
  const tableMeaning = assetDetail === null ? undefined : meaningDefinitions.find(value => (
    value.definition.kind === 'meaning' && value.definition.targetAssetId === assetDetail.asset.assetId
  ))
  const fieldMeanings = new Map(meaningDefinitions.flatMap(value => value.definition.kind === 'meaning'
    ? [[value.definition.targetAssetId, value] as const]
    : []))
  const canVerify = semanticDetail !== null && semanticDetail.definition.status !== 'retired'
  const canSaveMetric = metricDraft.name.trim() !== '' && metricDraft.formula.trim() !== '' && metricDraft.grain.trim() !== ''
  const canSaveTerm = termDraft.name.trim() !== '' && termDraft.description.trim() !== ''
  const canVerifyMetric = canVerify && canSaveMetric && metricDraft.revisionNote.trim() !== ''
  const canVerifyTerm = canVerify && canSaveTerm && termDraft.revisionNote.trim() !== ''
  const successfulRuns = runs.filter(run => run.status === 'succeeded')

  return (
    <section
      id={props.id}
      role="tabpanel"
      aria-labelledby={props.labelledBy}
      className={`${css.tabPanel} ${css.catalogPanel}`}
      hidden={!active}
    >
      <div className={css.catalogToolbar}>
        <div className={css.catalogOverview}>
          <label className={css.catalogControl}>
            <span>{t('catalog.source')}</span>
            <select className={css.input} value={sourceId} onChange={event => setSourceId(event.target.value)}>
              {sources.length === 0 && connectionProfileId !== undefined && (
                <option value="">{t('catalog.source.current')}</option>
              )}
              {sources.map(source => <option key={source.id} value={source.id}>{source.name} · {source.database}</option>)}
            </select>
          </label>
          <div className={css.catalogStats} role="status">
            <strong className={css.catalogSourceName}>{displayedSource?.name ?? t('catalog.status.never')}</strong>
            <div className={css.catalogCounts}>
              <span><strong>{status?.counts.assets ?? 0}</strong>{t('catalog.count.assets')}</span>
              <span><strong>{status?.counts.fields ?? 0}</strong>{t('catalog.count.fields')}</span>
              <span><strong>{status?.counts.needsReview ?? 0}</strong>{t('catalog.count.review')}</span>
            </div>
            <div className={css.catalogScanTimes}>
              <span>{t('catalog.status.full')} <time>{displayedSource?.lastFullScanAt ?? '—'}</time></span>
              <span>{t('catalog.status.partial')} <time>{displayedSource?.lastPartialScanAt ?? '—'}</time></span>
            </div>
          </div>
        </div>
        {status?.latestRun !== undefined && (
          <div className={css.catalogLatestRun} data-error={status.latestRun.status === 'failed' || status.latestRun.enrichment?.status === 'failed' || undefined}>
            <span className={css.catalogLatestLabel}>{t('catalog.status.latest')}</span>
            <span className={css.catalogBadge}>{statusLabel(status.latestRun.status)}</span>
            <code title={status.latestRun.id}>{status.latestRun.id}</code>
            {status.latestRun.error !== undefined && (
              <span className={css.catalogLatestError}>
                <strong>{t('catalog.status.failureReason')}</strong> {status.latestRun.error}
              </span>
            )}
            {status.latestRun.enrichment !== undefined && (
              <span className={css.catalogLatestError}>
                <strong>{t('catalog.enrichment.label')}</strong> {t(`catalog.enrichment.${status.latestRun.enrichment.status}` as DataAgentKey)}
                {' · '}{status.latestRun.enrichment.tablesCompleted}/{status.latestRun.enrichment.tablesTotal}
                {status.latestRun.enrichment.error !== undefined ? ` · ${status.latestRun.enrichment.error}` : ''}
              </span>
            )}
          </div>
        )}
        <div className={css.catalogActions}>
          <div className={css.catalogActionGroup}>
            <span className={css.catalogSectionLabel}>{t('catalog.section.scan')}</span>
            <div>
              <div className={css.catalogScanBar}>
                <select className={css.input} value={scanKind} disabled={activeRun !== undefined} onChange={event => {
                  setScanKind(event.target.value as CatalogScope['kind']); setConfirmFull(false)
                }} aria-label={t('catalog.scan')}>
                  <option value="source">{t('catalog.scan.all')}</option>
                  <option value="schema">{t('catalog.scan.schema')}</option>
                  <option value="table">{t('catalog.scan.table')}</option>
                </select>
                {scopeInputs && <input className={css.input} value={scanSchema} onChange={event => setScanSchema(event.target.value)} placeholder={t('catalog.schema')} aria-label={t('catalog.schema')} />}
                {scanKind === 'table' && <input className={css.input} value={scanTable} onChange={event => setScanTable(event.target.value)} placeholder={t('catalog.table')} aria-label={t('catalog.table')} />}
                {activeRun === undefined ? (
                  <button type="button" className={css.primary} disabled={busy || !scanAllowed} onClick={() => { void beginScan() }}>{t('catalog.scan')}</button>
                ) : (
                  <button type="button" className={css.ghost} disabled={busy} onClick={() => { void cancelScan() }}>{t('catalog.cancel')}</button>
                )}
              </div>
              {!scanAllowed && <div className={css.catalogInlineNotice}>{t('catalog.scan.reconnect')}</div>}
            </div>
          </div>
          <div className={css.catalogActionGroup}>
            <span className={css.catalogSectionLabel}>{t('catalog.section.diff')}</span>
            <div className={css.catalogDiffBar}>
              <select className={css.input} value={diffFrom} onChange={event => setDiffFrom(event.target.value)} aria-label={t('catalog.diff.from')}>
                <option value="">{t('catalog.diff.from')}</option>
                {successfulRuns.map(run => <option key={run.id} value={run.id}>{run.id}</option>)}
              </select>
              <select className={css.input} value={diffTo} onChange={event => setDiffTo(event.target.value)} aria-label={t('catalog.diff.to')}>
                <option value="">{t('catalog.diff.to')}</option>
                {successfulRuns.map(run => <option key={run.id} value={run.id}>{run.id}</option>)}
              </select>
              <button type="button" className={css.ghost} disabled={busy || sourceId === ''} onClick={() => { void loadDiff() }}>
                {t('catalog.diff')}
              </button>
            </div>
          </div>
        </div>
      </div>
      {confirmFull && (
        <div className={css.catalogConfirm} role="alert">
          <span>{t('catalog.scan.confirm')}</span>
          <button type="button" className={css.primary} onClick={() => { void beginScan() }}>{t('catalog.scan.all')}</button>
          <button type="button" className={css.ghost} onClick={() => setConfirmFull(false)}>{t('action.close')}</button>
        </div>
      )}
      {activeRun !== undefined && (
        <div className={css.catalogProgress} role="status">
          <strong>{activeRun.enrichment?.status === 'running'
            ? t('catalog.enrichment.running')
            : statusLabel(activeRun.status)}</strong>
          <span>{activeRun.enrichment?.status === 'running'
            ? t('catalog.enrichment.progress', {
                completed: activeRun.enrichment.tablesCompleted,
                total: activeRun.enrichment.tablesTotal,
                candidates: activeRun.enrichment.candidatesGenerated,
              })
            : t('catalog.progress', {
                schemas: activeRun.progress.schemas,
                relations: activeRun.progress.relations,
                fields: activeRun.progress.fields,
              })}</span>
          <code>{activeRun.id}</code>
        </div>
      )}

      {error !== null && <div className={css.catalogError} role="alert">{error}</div>}
      <div className={css.catalogNotice}>{t('catalog.warning.untrusted')}</div>

      {sources.length === 0 ? (
        <div className={css.emptyState}>{t('catalog.empty')}</div>
      ) : (
        <div className={css.catalogWorkspace}>
          <div className={css.catalogResults}>
            <form className={css.catalogSearch} onSubmit={event => {
              event.preventDefault(); setBusy(true); void runSearch().catch(reportError).finally(() => setBusy(false))
            }}>
              <input className={`${css.input} ${css.catalogSearchQuery}`} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('catalog.search')} aria-label={t('catalog.search')} />
              <input className={css.input} value={schema} onChange={event => setSchema(event.target.value)} placeholder={t('catalog.schema')} aria-label={t('catalog.schema.filter')} />
              <select className={css.input} value={kind} onChange={event => setKind(event.target.value)} aria-label={t('catalog.filter.all')}>
                <option value="relation">{t('catalog.filter.tables')}</option>
                <option value="">{t('catalog.filter.all')}</option>
                {['schema', 'table', 'view', 'column', 'primary_key', 'foreign_key', 'index', 'meaning', 'term', 'metric'].map(value => (
                  <option key={value} value={value}>{kindLabel(value)}</option>
                ))}
              </select>
              <select className={css.input} value={assetStatus} onChange={event => setAssetStatus(event.target.value)} aria-label={t('catalog.filter.assetStatus')}>
                <option value="">{t('catalog.filter.assetStatus')}</option>
                <option value="observed">{t('catalog.state.observed')}</option><option value="missing">{t('catalog.state.missing')}</option><option value="unavailable">{t('catalog.state.unavailable')}</option>
              </select>
              <select className={css.input} value={semanticStatus} onChange={event => setSemanticStatus(event.target.value)} aria-label={t('catalog.filter.semanticStatus')}>
                <option value="">{t('catalog.filter.semanticStatus')}</option>
                <option value="inferred">{t('catalog.state.inferred')}</option><option value="verified">{t('catalog.state.verified')}</option><option value="needs_review">{t('catalog.state.needs_review')}</option><option value="retired">{t('catalog.state.retired')}</option>
              </select>
              <div className={css.catalogSearchActions}>
                <label className={css.catalogCheck}>
                  <input type="checkbox" checked={includeInferred} onChange={event => setIncludeInferred(event.target.checked)} />
                  {t('catalog.filter.review')}
                </label>
                <button type="submit" className={css.ghost} disabled={busy}>{t('catalog.refresh')}</button>
              </div>
            </form>
            <div className={css.catalogList} role="listbox" aria-label={t('action.catalog')}>
              {items.map(item => (
                <button
                  key={`${item.resultType}:${item.id}`}
                  type="button"
                  role="option"
                  aria-selected={selection?.item.id === item.id}
                  className={`${css.catalogItem}${selection?.item.id === item.id ? ` ${css.catalogItemActive}` : ''}`}
                  onClick={() => { void selectItem(item) }}
                >
                  <span className={css.catalogItemHead}><strong>{item.name}</strong><StatusBadge value={statusLabel(item.status)} state={item.status} /></span>
                  <code title={item.path}>{parentPath(item.path, item.name)}</code>
                  <span>{kindLabel(item.kind)}{item.summary.trim() === '' ? '' : ` · ${item.summary}`}</span>
                </button>
              ))}
              {items.length === 0 && <div className={css.catalogListEmpty}>{busy ? t('wb.loading') : t('wb.empty')}</div>}
            </div>
            {nextCursor !== undefined && (
              <button type="button" className={css.ghost} disabled={busy} onClick={() => {
                setBusy(true); void runSearch(nextCursor, true).catch(reportError).finally(() => setBusy(false))
              }}>{t('catalog.loadMore')}</button>
            )}
          </div>

          <div className={css.catalogDetail}>
            {selection === null && diff === null ? (
              <div className={css.emptyState}>{t('catalog.detail.select')}</div>
            ) : diff !== null ? (
              <DiffView diff={diff} statusLabel={statusLabel} onClose={() => setDiff(null)}
                onLoadMore={() => { if (diff.nextCursor !== undefined) void loadDiff(diff.nextCursor, true) }} busy={busy} t={t} />
            ) : (
              <>
                <div className={css.catalogDetailHeader}>
                  <div className={css.catalogDetailTitle}>
                    <div>
                      <h3>{selection?.item.name}</h3>
                      <code title={selection?.item.path}>{selection?.item.path}</code>
                    </div>
                    {selection !== null && <StatusBadge value={statusLabel(selection.item.status)} state={selection.item.status} />}
                  </div>
                  {assetDetail !== null && relationDetail && (
                    <div className={css.catalogDetailCounts} aria-label={t('catalog.detail.summary')}>
                      <span><strong>{fieldCount}</strong>{t('catalog.detail.fields')}</span>
                      <span><strong>{assetDetail.relations.length}</strong>{t('catalog.detail.relationCount')}</span>
                      <span><strong>{businessDefinitions.length}</strong>{t('catalog.detail.definitionCount')}</span>
                    </div>
                  )}
                  {assetDetail?.asset.payload.comment && <p>{assetDetail.asset.payload.comment}</p>}
                </div>
                <div className={css.catalogDetailTabs} role="tablist">
                  {(['technical', 'business', 'history'] as const).map(tab => (
                    <button key={tab} type="button" role="tab" aria-selected={detailTab === tab} className={detailTab === tab ? css.catalogDetailTabActive : css.catalogDetailTab} onClick={() => setDetailTab(tab)}>
                      {t(`catalog.detail.${tab}` as DataAgentKey)}
                    </button>
                  ))}
                </div>
                {detailTab === 'technical' && (
                  <div className={css.catalogDetailScroll}>
                    {assetDetail === null ? <div className={css.hint}>{t('wb.empty')}</div> : (
                      <>
                        {fieldDetail && (
                          <dl className={css.catalogFacts}>
                            <dt>{t('catalog.detail.type')}</dt><dd>{assetDetail.asset.payload.dataType ?? '—'}</dd>
                            <dt>{t('catalog.detail.nullable')}</dt><dd>{nullableLabel(assetDetail.asset.payload.nullable, t)}</dd>
                            <dt>{t('catalog.detail.parentTable')}</dt><dd>{assetDetail.asset.payload.identity.relation ?? '—'}</dd>
                          </dl>
                        )}
                        {relationDetail && (
                          <>
                            <h4>{t('catalog.detail.fields')}</h4>
                            <table className={css.columnsTable}><thead><tr><th>{t('catalog.detail.name')}</th><th>{t('catalog.detail.type')}</th><th>{t('catalog.detail.nullable')}</th></tr></thead><tbody>
                              {technicalRows.map(field => <tr key={field.assetId}><td>{field.payload.name}</td><td>{field.payload.dataType}</td><td>{nullableLabel(field.payload.nullable, t)}</td></tr>)}
                            </tbody></table>
                            {assetDetail.nextCursor !== undefined && <button type="button" className={css.ghost} disabled={busy} onClick={() => { void loadMoreFields() }}>{t('catalog.loadMore')}</button>}
                          </>
                        )}
                        {assetDetail.relations.length > 0 && <div className={css.catalogRelations}>
                          <h4>{t('catalog.detail.relations')}</h4>
                          {assetDetail.relations.map(relation => <article key={relation.id} className={css.catalogHistoryItem}>
                            <strong>{kindLabel(relation.kind)}</strong> <span>{relation.name}</span>
                            <code>{relation.fromAssetId}{relation.toAssetId ? ` → ${relation.toAssetId}` : ''}</code>
                          </article>)}
                        </div>}
                        <details className={css.catalogScanFacts}>
                          <summary>{t('catalog.detail.scanFacts')}</summary>
                          <dl className={css.catalogFacts}>
                            <dt>{t('catalog.detail.provenance')}</dt><dd>{assetDetail.asset.payload.provenance.source} · {assetDetail.asset.payload.provenance.dialect}</dd>
                            <dt>{t('catalog.detail.run')}</dt><dd><code>{assetDetail.asset.runId}</code></dd>
                            {Object.entries(assetDetail.asset.payload.capabilities ?? {}).map(([capability, value]) => (
                              <Fragment key={capability}><dt>{capability}</dt><dd>{statusLabel(value)}</dd></Fragment>
                            ))}
                          </dl>
                        </details>
                      </>
                    )}
                  </div>
                )}
                {detailTab === 'business' && (
                  <div className={css.catalogDetailScroll}>
                    {selection?.type === 'asset' && assetDetail !== null && businessDefinitions.length === 0 && !editingMetric && !editingTerm && (
                      <div className={css.catalogBusinessEmpty}>
                        <strong>{t('catalog.detail.business.empty.title')}</strong>
                        <p>{t('catalog.detail.business.empty.body')}</p>
                      </div>
                    )}
                    {relationDetail && assetDetail !== null && (
                      <div className={css.catalogMeaningReview}>
                        <section className={css.catalogMeaningSection} aria-labelledby={`${props.id}-table-meaning`}>
                          <h4 id={`${props.id}-table-meaning`}>{t('catalog.meaning.table')}</h4>
                          {tableMeaning === undefined ? (
                            <div className={css.catalogMeaningMissing}>{t('catalog.meaning.missing')}</div>
                          ) : (
                            <MeaningCard value={tableMeaning} busy={busy} statusLabel={statusLabel}
                              onConfirm={() => { void confirmMeaning(tableMeaning) }}
                              onDismiss={() => { void dismissMeaning(tableMeaning) }} t={t} />
                          )}
                        </section>
                        <section className={css.catalogMeaningSection} aria-labelledby={`${props.id}-field-meanings`}>
                          <h4 id={`${props.id}-field-meanings`}>{t('catalog.meaning.fields')}</h4>
                          <div className={css.catalogMeaningFields}>
                            {technicalRows.map(field => {
                              const meaning = fieldMeanings.get(field.assetId)
                              return <article key={field.assetId} className={css.catalogMeaningField}>
                                <div className={css.catalogMeaningFieldMeta}>
                                  <strong>{field.payload.name}</strong>
                                  <code>{field.payload.dataType ?? '—'}</code>
                                </div>
                                {meaning === undefined ? <p className={css.catalogMeaningMissing}>{t('catalog.meaning.missing')}</p> : (
                                  <MeaningCard value={meaning} compact busy={busy} statusLabel={statusLabel}
                                    onConfirm={() => { void confirmMeaning(meaning) }}
                                    onDismiss={() => { void dismissMeaning(meaning) }} t={t} />
                                )}
                              </article>
                            })}
                          </div>
                        </section>
                      </div>
                    )}
                    {selection?.type === 'semantic' && semanticDetail?.definition.kind === 'meaning' && (
                      <MeaningCard value={semanticDetail} busy={busy} statusLabel={statusLabel}
                        onConfirm={() => { void confirmMeaning(semanticDetail) }}
                        onDismiss={() => { void dismissMeaning(semanticDetail) }} t={t} />
                    )}
                    {governedDefinitions.map(value => (
                      <article key={value.id} className={css.catalogDefinition}>
                        <div className={css.catalogItemHead}><strong>{value.definition.name}</strong><StatusBadge value={statusLabel(value.definition.status)} state={value.definition.status} /></div>
                        <p>{value.definition.description}</p><code>v{value.version}</code>
                        {value.definition.kind === 'metric' && <pre>{value.definition.formula}</pre>}
                        {value.definition.kind === 'metric' && <button type="button" className={css.ghost} onClick={() => { setSemanticDetail(value); startMetric(value) }}>{t('catalog.metric.verify')}</button>}
                        {value.definition.kind === 'term' && <button type="button" className={css.ghost} onClick={() => { setSemanticDetail(value); startTerm(value) }}>{t('catalog.metric.verify')}</button>}
                      </article>
                    ))}
                    {selection?.type === 'asset' && <div className={css.actions}>
                      <button type="button" className={css.ghost} onClick={() => startTerm()}>{t('catalog.term.new')}</button>
                      <button type="button" className={css.ghost} onClick={() => startMetric()}>{t('catalog.metric.new')}</button>
                    </div>}
                    {editingMetric && (
                      <MetricEditor draft={metricDraft} setDraft={setMetricDraft} busy={busy} canSave={canSaveMetric} canVerify={canVerifyMetric}
                        canRetire={semanticDetail?.definition.status === 'verified' || semanticDetail?.definition.status === 'needs_review'}
                        onSave={() => { void saveMetric(false) }} onVerify={() => { void saveMetric(true) }} onRetire={() => { void retireSemantic(metricDraft.revisionNote) }} t={t} />
                    )}
                    {editingTerm && (
                      <TermEditor draft={termDraft} setDraft={setTermDraft} busy={busy} canSave={canSaveTerm} canVerify={canVerifyTerm}
                        canRetire={semanticDetail?.definition.status === 'verified' || semanticDetail?.definition.status === 'needs_review'}
                        onSave={() => { void saveTerm(false) }} onVerify={() => { void saveTerm(true) }} onRetire={() => { void retireSemantic(termDraft.revisionNote) }} t={t} />
                    )}
                  </div>
                )}
                {detailTab === 'history' && (
                  <div className={css.catalogDetailScroll}>
                    {(assetDetail?.history ?? []).map(revision => (
                      <article key={revision.id} className={css.catalogHistoryItem}>
                        <div><strong>r{revision.revision}</strong> · <StatusBadge value={statusLabel(revision.status)} state={revision.status} /></div>
                        <code>{revision.runId}</code><span>{revision.observedAt}</span><p>{revision.changeSummary.join(', ')}</p>
                      </article>
                    ))}
                    {assetDetail === null && <div className={css.hint}>{t('wb.empty')}</div>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function StatusBadge({ value, state }: { value: string; state: string }) {
  return <span className={`${css.catalogBadge} ${css[`catalogBadge_${state}`] ?? ''}`}>{value}</span>
}

function MeaningCard({ value, compact = false, busy, statusLabel, onConfirm, onDismiss, t }: {
  value: CatalogSemanticRevision
  compact?: boolean
  busy: boolean
  statusLabel(value: string): string
  onConfirm(): void
  onDismiss(): void
  t: T
}) {
  if (value.definition.kind !== 'meaning') return null
  const confirmable = value.definition.status === 'inferred' || value.definition.status === 'needs_review'
  return <div className={`${css.catalogMeaningCard}${compact ? ` ${css.catalogMeaningCardCompact}` : ''}`}>
    <div className={css.catalogItemHead}>
      <StatusBadge value={statusLabel(value.definition.status)} state={value.definition.status} />
      <span className={css.catalogMeaningOrigin}>{t('catalog.meaning.ai')} · {value.definition.generatedBy.provider}/{value.definition.generatedBy.model}</span>
    </div>
    <p>{value.definition.description}</p>
    <div className={css.catalogMeaningActions}>
      {confirmable && <button type="button" className={css.primary} disabled={busy} onClick={onConfirm}>{t('catalog.meaning.confirm')}</button>}
      <button type="button" className={css.ghost} disabled={busy} onClick={onDismiss}>{t('catalog.meaning.delete')}</button>
      <code title={value.definition.generatedBy.runId}>v{value.version} · {value.definition.generatedBy.runId}</code>
    </div>
  </div>
}

function DiffView({ diff, statusLabel, onClose, onLoadMore, busy, t }: {
  diff: CatalogDiffPage
  statusLabel(value: string): string
  onClose(): void
  onLoadMore(): void
  busy: boolean
  t: T
}) {
  return <div className={css.catalogDetailScroll}>
    <div className={css.catalogItemHead}><strong>{diff.fromRunId} → {diff.toRunId}</strong><button type="button" className={css.ghost} onClick={onClose}>{t('action.close')}</button></div>
    {diff.items.map(item => <article key={`${item.kind}:${item.assetId}`} className={css.catalogHistoryItem}>
      <div><StatusBadge value={statusLabel(item.kind)} state={item.kind} /> <strong>{item.name}</strong></div>
      <code>{item.path}</code><p>{item.summary.join(', ')}</p>
    </article>)}
    {diff.nextCursor !== undefined && <button type="button" className={css.ghost} disabled={busy} onClick={onLoadMore}>{t('catalog.loadMore')}</button>}
  </div>
}

function MetricEditor(props: {
  draft: MetricDraft
  setDraft(value: MetricDraft): void
  busy: boolean
  canSave: boolean
  canVerify: boolean
  canRetire: boolean
  onSave(): void
  onVerify(): void
  onRetire(): void
  t: T
}) {
  const field = (key: keyof MetricDraft, label: DataAgentKey, area = false) => <label className={css.field}>
    <span className={css.label}>{props.t(label)}</span>
    {area
      ? <textarea className={css.catalogTextArea} value={props.draft[key]} onChange={event => props.setDraft({ ...props.draft, [key]: event.target.value })} />
      : <input className={css.input} value={props.draft[key]} onChange={event => props.setDraft({ ...props.draft, [key]: event.target.value })} />}
  </label>
  return <div className={css.catalogEditor}>
    {field('name', 'catalog.metric.name')}{field('aliases', 'catalog.semantic.aliases')}
    {field('description', 'catalog.metric.description', true)}{field('sourceAssetIds', 'catalog.semantic.sources', true)}
    {field('formula', 'catalog.metric.formula', true)}{field('grain', 'catalog.metric.grain')}
    {field('timeFieldAssetId', 'catalog.metric.timeField')}{field('filters', 'catalog.metric.filters', true)}
    {field('exclusions', 'catalog.metric.exclusions', true)}{field('validFrom', 'catalog.semantic.validFrom')}
    {field('validTo', 'catalog.semantic.validTo')}
    {field('owner', 'catalog.metric.owner')}{field('revisionNote', 'catalog.metric.note', true)}
    <div className={css.actions}>
      <button type="button" className={css.ghost} disabled={props.busy || !props.canSave} onClick={props.onSave}>{props.t('catalog.metric.save')}</button>
      <button type="button" className={css.primary} disabled={props.busy || !props.canVerify} onClick={props.onVerify}>{props.t('catalog.metric.verify')}</button>
      {props.canRetire && <button type="button" className={css.ghost} disabled={props.busy || props.draft.revisionNote.trim() === ''} onClick={props.onRetire}>{props.t('catalog.metric.retire')}</button>}
    </div>
  </div>
}

function TermEditor(props: {
  draft: TermDraft
  setDraft(value: TermDraft): void
  busy: boolean
  canSave: boolean
  canVerify: boolean
  canRetire: boolean
  onSave(): void
  onVerify(): void
  onRetire(): void
  t: T
}) {
  const field = (key: keyof TermDraft, label: DataAgentKey, area = false) => <label className={css.field}>
    <span className={css.label}>{props.t(label)}</span>
    {area
      ? <textarea className={css.catalogTextArea} value={props.draft[key]} onChange={event => props.setDraft({ ...props.draft, [key]: event.target.value })} />
      : <input className={css.input} value={props.draft[key]} onChange={event => props.setDraft({ ...props.draft, [key]: event.target.value })} />}
  </label>
  return <div className={css.catalogEditor}>
    {field('name', 'catalog.term.name')}{field('aliases', 'catalog.semantic.aliases')}
    {field('description', 'catalog.metric.description', true)}{field('sourceAssetIds', 'catalog.semantic.sources', true)}
    {field('validFrom', 'catalog.semantic.validFrom')}{field('validTo', 'catalog.semantic.validTo')}
    {field('owner', 'catalog.metric.owner')}{field('revisionNote', 'catalog.metric.note', true)}
    <div className={css.actions}>
      <button type="button" className={css.ghost} disabled={props.busy || !props.canSave} onClick={props.onSave}>{props.t('catalog.metric.save')}</button>
      <button type="button" className={css.primary} disabled={props.busy || !props.canVerify} onClick={props.onVerify}>{props.t('catalog.metric.verify')}</button>
      {props.canRetire && <button type="button" className={css.ghost} disabled={props.busy || props.draft.revisionNote.trim() === ''} onClick={props.onRetire}>{props.t('catalog.metric.retire')}</button>}
    </div>
  </div>
}

function draftFromSemantic(semantic: CatalogSemanticRevision): MetricDraft {
  if (semantic.definition.kind !== 'metric') return EMPTY_DRAFT
  return {
    name: semantic.definition.name,
    aliases: semantic.definition.aliases.join(', '),
    description: semantic.definition.description,
    formula: semantic.definition.formula,
    grain: semantic.definition.grain,
    sourceAssetIds: semantic.definition.sourceAssetIds.join('\n'),
    timeFieldAssetId: semantic.definition.timeFieldAssetId ?? '',
    filters: semantic.definition.filters.join('\n'),
    exclusions: semantic.definition.exclusions.join('\n'),
    validFrom: semantic.definition.validFrom ?? '',
    validTo: semantic.definition.validTo ?? '',
    owner: semantic.definition.owner ?? '',
    revisionNote: '',
  }
}

function termDraftFromSemantic(semantic: CatalogSemanticRevision): TermDraft {
  if (semantic.definition.kind !== 'term') return EMPTY_TERM_DRAFT
  return {
    name: semantic.definition.name,
    aliases: semantic.definition.aliases.join(', '),
    description: semantic.definition.description,
    sourceAssetIds: semantic.definition.sourceAssetIds.join('\n'),
    validFrom: semantic.definition.validFrom ?? '',
    validTo: semantic.definition.validTo ?? '',
    owner: semantic.definition.owner ?? '',
    revisionNote: '',
  }
}

function splitList(value: string): string[] {
  return value.split(/[\n,]+/).map(item => item.trim()).filter(Boolean)
}

function splitLines(value: string): string[] {
  return value.split(/\n+/).map(item => item.trim()).filter(Boolean)
}

function defaultBrowseSchema(source: CatalogSource): string {
  return ['mysql', 'clickhouse', 'doris', 'hive', 'impala'].includes(source.type) ? source.database : ''
}

function parentPath(path: string, name: string): string {
  const suffix = `.${name}`
  return path.endsWith(suffix) ? path.slice(0, -suffix.length) : path
}

function nullableLabel(value: boolean | undefined, t: T): string {
  if (value === undefined) return '—'
  return value ? t('catalog.detail.yes') : t('catalog.detail.no')
}

const STATUS_KEYS: Record<string, true> = {
  'catalog.state.observed': true,
  'catalog.state.inferred': true,
  'catalog.state.verified': true,
  'catalog.state.needs_review': true,
  'catalog.state.retired': true,
  'catalog.state.missing': true,
  'catalog.state.unavailable': true,
  'catalog.state.added': true,
  'catalog.state.changed': true,
  'catalog.state.restored': true,
  'catalog.state.queued': true,
  'catalog.state.running': true,
  'catalog.state.applying': true,
  'catalog.state.succeeded': true,
  'catalog.state.failed': true,
  'catalog.state.cancelled': true,
  'catalog.state.interrupted': true,
  'catalog.state.supported': true,
  'catalog.state.unsupported': true,
}

const KIND_KEYS: Record<string, true> = {
  'catalog.kind.schema': true,
  'catalog.kind.table': true,
  'catalog.kind.view': true,
  'catalog.kind.column': true,
  'catalog.kind.primary_key': true,
  'catalog.kind.foreign_key': true,
  'catalog.kind.index': true,
  'catalog.kind.meaning': true,
  'catalog.kind.term': true,
  'catalog.kind.metric': true,
}
