/**
 * Optional dsh-tui presentation adapter for Catalog progress and read-only
 * browsing. It only consumes the public `tuiStatus`/`tuiScenes` service
 * shapes and deliberately has no runtime import from dsh-tui or React.
 */

import type { Context } from '@deepseek-ai/cordis'
import type * as ReactTypes from 'react'
import type { CatalogCommandPresentation } from './catalog-command.ts'
import type {
  CatalogAssetDetail,
  CatalogRun,
  CatalogSearchItem,
  CatalogSearchPage,
  CatalogSearchRequest,
  CatalogSemanticRevision,
  CatalogSource,
  CatalogStatusSummary,
} from './catalog-types.ts'
import type {} from './index.ts'

const STATUS_KEY = 'data-agent:catalog'
const SCENE_ID = 'data-agent-catalog'
const POLL_INTERVAL_MS = 750
const SEARCH_PAGE_SIZE = 50
const DETAIL_PAGE_SIZE = 200

type HostReact = typeof ReactTypes
type HostElement = ReactTypes.ReactNode

interface HostKey {
  upArrow: boolean
  downArrow: boolean
  leftArrow: boolean
  rightArrow: boolean
  pageDown: boolean
  pageUp: boolean
  home: boolean
  end: boolean
  return: boolean
  escape: boolean
  ctrl: boolean
  shift: boolean
  tab: boolean
  backspace: boolean
  delete: boolean
  meta: boolean
  super: boolean
}

interface HostUi {
  Box: ReactTypes.ElementType
  Text: ReactTypes.ElementType
  useInput(handler: (input: string, key: HostKey) => void, options?: { isActive?: boolean }): void
  useTerminalSize(): { columns: number; rows: number }
}

interface HostSceneProps {
  React: HostReact
  ui: HostUi
  close(): void
}

interface TuiStatusLike {
  set(key: string, text: string | undefined, identity?: Context): () => void
}

interface TuiScenesLike {
  register(descriptor: {
    id: string
    title?: string
    component: (props: HostSceneProps) => HostElement
  }, identity?: Context): () => void
  open(id: string): boolean
}

interface ContextServiceLookup {
  get(name: string): unknown
}

export interface CatalogTuiAdapter extends CatalogCommandPresentation {
  dispose(): void
}

/** Create an adapter only from public optional services exposed by dsh-tui. */
export function createCatalogTuiAdapter(ctx: Context): CatalogTuiAdapter {
  let sessionId: string | undefined
  let runId: string | undefined
  let sourceId: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let clearStatus: (() => void) | undefined
  let disposed = false

  const replaceStatus = (text: string | undefined): void => {
    clearStatus?.()
    clearStatus = undefined
    if (text === undefined || disposed) return
    const statusService = optionalService<TuiStatusLike>(ctx, 'tuiStatus', value => typeof value.set === 'function')
    if (statusService === undefined) return
    try {
      clearStatus = statusService.set(STATUS_KEY, text, ctx)
    } catch (error) {
      ctx.logger.warn('data-agent: unable to update dsh-tui Catalog status: %s', error)
    }
  }

  const stopPolling = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  const poll = (): void => {
    stopPolling()
    if (disposed || runId === undefined || sourceId === undefined) return
    try {
      const current = ctx.dataAgentCatalog.listRuns(sourceId, 200).find(candidate => candidate.id === runId)
      if (current === undefined) {
        replaceStatus('Catalog · 无法找到扫描记录 · /catalog status')
        return
      }
      replaceStatus(formatCatalogTuiStatus(current))
      if (isCatalogRunSettled(current)) return
    } catch (error) {
      replaceStatus('Catalog · 状态读取失败 · /catalog status')
      ctx.logger.warn('data-agent: unable to poll dsh-tui Catalog status: %s', error)
      return
    }
    timer = setTimeout(poll, POLL_INTERVAL_MS)
    timer.unref?.()
  }

  let scenesService: TuiScenesLike | undefined
  let disposeScene: (() => void) | undefined
  const ensureScene = (): boolean => {
    if (disposeScene !== undefined) return true
    scenesService = optionalService<TuiScenesLike>(ctx, 'tuiScenes', value => (
      typeof value.register === 'function' && typeof value.open === 'function'
    ))
    if (scenesService === undefined) return false
    try {
      disposeScene = scenesService.register({
        id: SCENE_ID,
        title: 'Data Catalog',
        component: props => props.React.createElement(CatalogScene, { ...props, ctx, sessionId }),
      }, ctx)
    } catch (error) {
      ctx.logger.warn('data-agent: unable to register dsh-tui Catalog scene: %s', error)
      return false
    }
    return true
  }
  ensureScene()

  return {
    watch(run) {
      runId = run.id
      sourceId = run.sourceId
      replaceStatus(formatCatalogTuiStatus(run))
      if (!isCatalogRunSettled(run)) {
        timer = setTimeout(poll, POLL_INTERVAL_MS)
        timer.unref?.()
      }
    },
    open(nextSessionId) {
      if (!ensureScene() || scenesService === undefined) return false
      sessionId = nextSessionId
      stopPolling()
      replaceStatus(undefined)
      try {
        return scenesService.open(SCENE_ID)
      } catch (error) {
        ctx.logger.warn('data-agent: unable to open dsh-tui Catalog scene: %s', error)
        return false
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      stopPolling()
      replaceStatus(undefined)
      disposeScene?.()
      disposeScene = undefined
    },
  }
}

/** One bounded status-line projection shared by the adapter and tests. */
export function formatCatalogTuiStatus(run: CatalogRun): string {
  const progress = `${run.progress.schemas} Schema · ${run.progress.relations} 表/视图 · ${run.progress.fields} 字段`
  if (run.status === 'queued') return 'Catalog · 等待扫描 · 0 Schema · 0 表/视图 · 0 字段'
  if (run.status === 'running') return `Catalog · 正在读取技术元数据 · ${progress}`
  if (run.status === 'applying') return `Catalog · 正在发布技术目录 · ${progress}`
  if (run.status === 'failed') return 'Catalog · ✕ 技术扫描失败 · /catalog status'
  if (run.status === 'cancelled') return 'Catalog · 已取消技术扫描 · /catalog status'
  if (run.status === 'interrupted') return 'Catalog · 扫描被中断 · /catalog status'

  const enrichment = run.enrichment
  if (enrichment === undefined) return `Catalog · ✓ 技术目录完成 · ${progress} · /catalog view`
  const aiProgress = `${enrichment.tablesCompleted}/${enrichment.tablesTotal} 表 · ${enrichment.candidatesGenerated} 候选`
  if (enrichment.status === 'queued') return `Catalog · 等待生成AI业务含义 · ${aiProgress}`
  if (enrichment.status === 'running') {
    return `Catalog · 正在生成AI业务含义 · ${aiProgress}${enrichment.tablesFailed > 0 ? ` · ${enrichment.tablesFailed} 失败` : ''}`
  }
  if (enrichment.status === 'succeeded') return `Catalog · ✓ 完成 · ${aiProgress} · /catalog view`
  if (enrichment.status === 'partial') return `Catalog · ⚠ 技术目录完成，AI部分成功 · ${aiProgress} · ${enrichment.tablesFailed} 失败 · /catalog view`
  if (enrichment.status === 'cancelled') return `Catalog · 技术目录完成，AI已取消 · ${aiProgress} · /catalog view`
  return `Catalog · 技术目录完成，AI生成失败 · ${aiProgress} · /catalog view`
}

export function isCatalogRunSettled(run: CatalogRun): boolean {
  if (run.status === 'queued' || run.status === 'running' || run.status === 'applying') return false
  if (run.status !== 'succeeded') return true
  return run.enrichment === undefined || (run.enrichment.status !== 'queued' && run.enrichment.status !== 'running')
}

/** Text projection for the independently scrollable right pane. */
export function buildCatalogTuiDetailLines(detail: CatalogAssetDetail): string[] {
  const meaningByAsset = new Map<string, CatalogSemanticRevision>()
  for (const semantic of detail.semantics) {
    if (semantic.definition.kind === 'meaning') meaningByAsset.set(semantic.definition.targetAssetId, semantic)
  }
  const tableMeaning = meaningByAsset.get(detail.asset.assetId)
  const lines = [
    detail.asset.payload.name,
    detail.asset.payload.path,
    `状态 ${detail.asset.status} · ${detail.fields.length}${detail.truncated ? '+' : ''} 字段 · ${detail.relations.length} 关系`,
  ]
  if (detail.asset.payload.comment !== undefined) lines.push(`数据库注释：${detail.asset.payload.comment}`)
  lines.push('', '表业务含义')
  if (tableMeaning?.definition.kind === 'meaning') {
    lines.push(
      `[${tableMeaning.definition.status}] ${tableMeaning.definition.description}`,
      `AI来源 ${tableMeaning.definition.generatedBy.provider}/${tableMeaning.definition.generatedBy.model} · ${tableMeaning.definition.generatedBy.runId}`,
    )
  } else {
    lines.push('— 尚无表级业务含义候选')
  }
  lines.push('', '字段业务含义')
  for (const field of detail.fields) {
    const meaning = meaningByAsset.get(field.assetId)
    const type = field.payload.dataType ?? '类型未知'
    const nullable = field.payload.nullable === undefined ? '' : field.payload.nullable ? ' · 可空' : ' · 非空'
    lines.push(`${field.payload.name} · ${type}${nullable}`)
    lines.push(meaning?.definition.kind === 'meaning'
      ? `  [${meaning.definition.status}] ${meaning.definition.description}`
      : '  — 尚无AI业务含义')
  }
  if (detail.fields.length === 0) lines.push('— 没有字段')
  if (detail.truncated) lines.push('', '字段过多，当前只显示有界详情页；可在Web数据目录查看其余字段。')
  if (detail.relations.length > 0) {
    lines.push('', '关系')
    for (const relation of detail.relations) {
      lines.push(`${relation.kind}${relation.name === undefined ? '' : ` · ${relation.name}`} · ${relation.columnAssetIds.length} 字段`)
    }
  }
  return lines
}

function CatalogScene(props: HostSceneProps & { ctx: Context; sessionId?: string }): HostElement {
  const { React, ui, close, ctx, sessionId } = props
  const h = React.createElement
  const { columns, rows } = ui.useTerminalSize()
  const [source, setSource] = React.useState<CatalogSource | undefined>()
  const [status, setStatus] = React.useState<CatalogStatusSummary | undefined>()
  const [items, setItems] = React.useState<CatalogSearchItem[]>([])
  const [nextCursor, setNextCursor] = React.useState<string | undefined>()
  const [selected, setSelected] = React.useState(0)
  const [detail, setDetail] = React.useState<CatalogAssetDetail | undefined>()
  const [focus, setFocus] = React.useState<'list' | 'detail'>('list')
  const [detailScroll, setDetailScroll] = React.useState(0)
  const [query, setQuery] = React.useState('')
  const [queryDraft, setQueryDraft] = React.useState('')
  const [queryOpen, setQueryOpen] = React.useState(false)
  const [allSchemas, setAllSchemas] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | undefined>()
  const [refreshNonce, setRefreshNonce] = React.useState(0)
  const [liveNonce, setLiveNonce] = React.useState(0)

  const searchRequest = React.useCallback((selectedSource: CatalogSource, cursor?: string): CatalogSearchRequest => ({
    query: query.trim() === '' ? '*' : query.trim(),
    filters: {
      sourceId: selectedSource.id,
      ...!allSchemas && defaultBrowseSchema(selectedSource) !== ''
        ? { schema: defaultBrowseSchema(selectedSource) }
        : {},
      assetKinds: ['table', 'view'],
      assetStatuses: ['observed'],
      includeInferred: true,
    },
    ...cursor !== undefined ? { cursor } : {},
    pageSize: SEARCH_PAGE_SIZE,
  }), [query, allSchemas])

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(undefined)
    if (sessionId === undefined) {
      setError('无法确定当前data-agent会话。')
      setLoading(false)
      return () => { cancelled = true }
    }
    void ctx.dataAgentCatalog.resolveSource(sessionId).then(async (nextSource) => {
      const page = await ctx.dataAgentCatalog.search(searchRequest(nextSource))
      if (cancelled) return
      setSource(nextSource)
      setStatus(ctx.dataAgentCatalog.status(nextSource.id))
      setItems(page.items)
      setNextCursor(page.nextCursor)
      setSelected(previous => Math.min(previous, Math.max(0, page.items.length - 1)))
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [ctx, sessionId, searchRequest, refreshNonce])

  const selectedItem = items[selected]
  React.useEffect(() => {
    if (source === undefined || selectedItem === undefined) {
      setDetail(undefined)
      return
    }
    try {
      setDetail(ctx.dataAgentCatalog.getAsset(source.id, selectedItem.id, undefined, DETAIL_PAGE_SIZE))
      setError(undefined)
    } catch (cause) {
      setDetail(undefined)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [ctx, source, selectedItem?.id, refreshNonce, liveNonce])

  React.useEffect(() => setDetailScroll(0), [selectedItem?.id])

  React.useEffect(() => {
    if (source === undefined) return
    const timer = setInterval(() => {
      const next = ctx.dataAgentCatalog.status(source.id)
      setStatus(next)
      const run = next?.latestRun
      if (run !== undefined && !isCatalogRunSettled(run)) setLiveNonce(value => value + 1)
    }, 1_000)
    return () => clearInterval(timer)
  }, [ctx, source])

  const loadMore = React.useCallback(() => {
    if (source === undefined || nextCursor === undefined || loadingMore) return
    setLoadingMore(true)
    void ctx.dataAgentCatalog.search(searchRequest(source, nextCursor)).then((page: CatalogSearchPage) => {
      setItems(previous => [...previous, ...page.items])
      setNextCursor(page.nextCursor)
    }).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoadingMore(false))
  }, [ctx, source, nextCursor, loadingMore, searchRequest])

  const compact = columns < 92
  const chromeRows = 4
  const contentRows = Math.max(6, rows - chromeRows)
  const listRows = compact ? Math.max(3, Math.floor(contentRows * 0.42)) : contentRows
  const detailRows = compact ? Math.max(3, contentRows - listRows) : contentRows
  const leftWidth = compact ? columns - 2 : Math.max(30, Math.min(48, Math.floor(columns * 0.34)))
  const rightWidth = compact ? columns - 2 : Math.max(30, columns - leftWidth - 3)
  const visibleListRows = Math.max(1, listRows - 2)
  const visibleDetailRows = Math.max(1, detailRows - 2)
  const listStart = Math.max(0, Math.min(selected - Math.floor(visibleListRows / 2), items.length - visibleListRows))
  const visibleItems = items.slice(listStart, listStart + visibleListRows)
  const detailLines = detail === undefined ? [] : buildCatalogTuiDetailLines(detail)
  const maxDetailScroll = Math.max(0, detailLines.length - visibleDetailRows)
  const clampedDetailScroll = Math.min(detailScroll, maxDetailScroll)
  const visibleDetail = detailLines.slice(clampedDetailScroll, clampedDetailScroll + visibleDetailRows)

  const moveList = React.useCallback((delta: number) => {
    setSelected(previous => {
      const next = Math.max(0, Math.min(items.length - 1, previous + delta))
      if (next >= items.length - 3 && nextCursor !== undefined) loadMore()
      return next
    })
  }, [items.length, nextCursor, loadMore])

  ui.useInput((input, key) => {
    if (queryOpen) {
      if (key.escape) {
        setQueryOpen(false)
        setQueryDraft(query)
        return
      }
      if (key.return) {
        setQuery(queryDraft.trim())
        setSelected(0)
        setQueryOpen(false)
        return
      }
      if (key.backspace || key.delete) {
        setQueryDraft(previous => previous.slice(0, -1))
        return
      }
      if (input !== '' && !key.ctrl && !key.meta && !key.super) {
        setQueryDraft(previous => (previous + input.replace(/[\r\n\u0000-\u001f\u007f]/g, '')).slice(0, 120))
      }
      return
    }
    if (key.escape || input === 'q') return close()
    if (input === '/') {
      setQueryDraft(query)
      setQueryOpen(true)
      return
    }
    if (input === 'r') {
      setRefreshNonce(value => value + 1)
      return
    }
    if (input === 'a') {
      setAllSchemas(previous => !previous)
      setSelected(0)
      return
    }
    if (key.tab || (focus === 'list' && (key.rightArrow || key.return)) || (focus === 'detail' && key.leftArrow)) {
      setFocus(previous => previous === 'list' ? 'detail' : 'list')
      return
    }
    if (focus === 'list') {
      if (key.upArrow || input === 'k') return moveList(-1)
      if (key.downArrow || input === 'j') return moveList(1)
      if (key.pageUp) return moveList(-visibleListRows)
      if (key.pageDown) return moveList(visibleListRows)
      if (key.home || input === 'g') return setSelected(0)
      if (key.end || input === 'G') {
        setSelected(Math.max(0, items.length - 1))
        loadMore()
      }
      return
    }
    if (key.upArrow || input === 'k') return setDetailScroll(previous => Math.max(0, previous - 1))
    if (key.downArrow || input === 'j') return setDetailScroll(previous => Math.min(maxDetailScroll, previous + 1))
    if (key.pageUp) return setDetailScroll(previous => Math.max(0, previous - visibleDetailRows))
    if (key.pageDown) return setDetailScroll(previous => Math.min(maxDetailScroll, previous + visibleDetailRows))
    if (key.home || input === 'g') return setDetailScroll(0)
    if (key.end || input === 'G') setDetailScroll(maxDetailScroll)
  })

  const latestRun = status?.latestRun
  const headerStatus = latestRun === undefined ? '尚无扫描' : formatCatalogTuiStatus(latestRun).replace(/^Catalog · /, '')
  const sourceLabel = source === undefined ? '正在解析数据源…' : `${source.name} · ${status?.counts.assets ?? 0} 资产 · ${status?.counts.needsReview ?? 0} 待确认`
  const searchLabel = queryOpen
    ? `/ ${queryDraft}▌`
    : `${query === '' ? '全部表与视图' : `搜索：${query}`} · ${allSchemas || source === undefined || defaultBrowseSchema(source) === '' ? '全部Schema' : defaultBrowseSchema(source)}`

  const listPane = h(ui.Box, {
    flexDirection: 'column', width: compact ? '100%' : leftWidth, height: listRows,
    borderStyle: 'single', borderColor: focus === 'list' ? 'permission' : 'subtle', paddingX: 1,
  },
  h(ui.Text, { bold: true, color: focus === 'list' ? 'permission' : undefined, wrap: 'truncate' }, `表与视图 · ${items.length}${nextCursor === undefined ? '' : '+'}`),
  ...visibleItems.map((item, index) => {
    const absolute = listStart + index
    const active = absolute === selected
    return h(ui.Text, { key: item.id, inverse: active, bold: active, wrap: 'truncate' }, `${active ? '›' : ' '} ${item.name}  [${item.status}]`)
  }),
  ...items.length === 0 && !loading ? [h(ui.Text, { key: 'empty', color: 'subtle' }, '（没有匹配的表或视图）')] : [],
  ...loading || loadingMore ? [h(ui.Text, { key: 'loading', color: 'suggestion' }, loadingMore ? '继续加载…' : '加载目录…')] : [],
  )

  const rightPane = h(ui.Box, {
    flexDirection: 'column', width: compact ? '100%' : rightWidth, height: detailRows,
    borderStyle: 'single', borderColor: focus === 'detail' ? 'permission' : 'subtle', paddingX: 1,
  },
  h(ui.Text, { bold: true, color: focus === 'detail' ? 'permission' : undefined, wrap: 'truncate' }, selectedItem === undefined ? '表详情' : `${selectedItem.name} · ${clampedDetailScroll + 1}/${Math.max(1, detailLines.length)}`),
  ...visibleDetail.map((line, index) => h(ui.Text, {
    key: `${clampedDetailScroll + index}:${line}`,
    color: line.startsWith('表业务含义') || line.startsWith('字段业务含义') || line === '关系' ? 'claude' : undefined,
    bold: line === detail?.asset.payload.name || line.startsWith('表业务含义') || line.startsWith('字段业务含义') || line === '关系',
    wrap: 'truncate',
  }, line === '' ? ' ' : line)),
  ...selectedItem !== undefined && detail === undefined && !loading
    ? [h(ui.Text, { key: 'detail-loading', color: 'suggestion' }, '加载详情…')]
    : [],
  ...selectedItem === undefined && !loading
    ? [h(ui.Text, { key: 'detail-empty', color: 'subtle' }, '从左侧选择一张表查看AI业务含义。')]
    : [],
  )

  return h(ui.Box, { flexDirection: 'column', width: '100%', paddingX: 1 },
    h(ui.Text, { bold: true, color: 'claude', wrap: 'truncate' }, `✦ 数据目录  ${sourceLabel}`),
    h(ui.Text, { color: latestRun?.status === 'failed' ? 'error' : 'subtle', wrap: 'truncate' }, headerStatus),
    h(ui.Text, { color: queryOpen ? 'suggestion' : 'subtle', wrap: 'truncate' }, searchLabel),
    ...error === undefined ? [] : [h(ui.Text, { key: 'error', color: 'error', wrap: 'truncate' }, `错误：${error}`)],
    h(ui.Box, { flexDirection: compact ? 'column' : 'row', width: '100%', height: contentRows, gap: compact ? 0 : 1 }, listPane, rightPane),
    h(ui.Text, { dimColor: true, italic: true, wrap: 'truncate' }, '↑↓/jk 滚动 · Tab/←→ 切换区域 · / 搜索 · a 全部Schema · r 刷新 · Esc/q 返回 · 只读，确认/删除请使用Web'),
  )
}

function optionalService<T extends object>(
  ctx: Context,
  name: string,
  validate: (value: Record<string, unknown>) => boolean,
): T | undefined {
  const value = (ctx as unknown as ContextServiceLookup).get(name)
  if (value === undefined || value === null || typeof value !== 'object') return undefined
  return validate(value as Record<string, unknown>) ? value as T : undefined
}

function defaultBrowseSchema(source: CatalogSource): string {
  return ['mysql', 'clickhouse', 'doris', 'hive', 'impala'].includes(source.type) ? source.database : ''
}
