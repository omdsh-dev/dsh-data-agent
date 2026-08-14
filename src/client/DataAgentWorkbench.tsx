/**
 * The database workbench: connection config (collapsible after connect),
 * a browse button that opens the schema explorer Modal, and the SQL command
 * box, rendered into the composer input dock (the strip ABOVE the input bar)
 * for data-agent sessions.
 *
 * Layout is phase-driven by the conversation root's `data-phase` attribute:
 * - hero (blank session): the workbench is a full-width stacked strip above
 *   the input bar (which stays at the bottom);
 * - active (conversation started): the workbench becomes a fixed left rail
 *   (measured from the conversation column), the chat records and the input
 *   bar shift right via the `da-split` CSS rules; if measurement is
 *   unavailable the workbench falls back to a docked bottom panel.
 *
 * Interaction model:
 * - after a successful connect the connection form collapses into a summary
 *   row (click 连接配置 to expand the readonly form again);
 * - the schema explorer lives in a Modal (ui-primitives) opened by the
 *   库表 button; a single click on a database toggles its table list in a
 *   file-explorer style tree (folder rows with chevrons, indented table rows
 *   with guide lines, the whole tree scrolls inside the column);
 * - clicking a table loads its columns into the Modal's structure panel.
 *
 * Non-data-agent sessions render null — zero impact on ordinary sessions.
 * Connection state lives on the server (the dataAgentConnections store), so
 * remounts never lose it — this component mirrors `/status` on mount.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Modal, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation slot declarations (conversation.input.dock)
// and the framework-standard view props into this program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  loadConnection,
  saveConnection,
  type SavedConnection,
} from './persistence.ts'
import css from './DataAgentWorkbench.module.css'

/** The plugin's preset id, matching the installed agent preset directory. */
const DATA_AGENT_PRESET = 'data-agent'

/** 16×16 stroke icons drawn inline (the primitives package does not export icon atoms). */
function Icon({ className, children, size = 14 }: { className?: string; children: ReactNode; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {children}
    </svg>
  )
}

/** Database cylinder: section header of the connection form. */
function DatabaseIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <ellipse cx="8" cy="4" rx="5.5" ry="2.1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.5 4V12C2.5 13.16 4.96 14.1 8 14.1C11.04 14.1 13.5 13.16 13.5 12V4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.5 8C2.5 9.16 4.96 10.1 8 10.1C11.04 10.1 13.5 9.16 13.5 8" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

/** Table grid: browse row + table rows in the tree. */
function TableIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 6.5H14" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6.5 6.5V13" stroke="currentColor" strokeWidth="1.2" />
    </Icon>
  )
}

/** Folder: schema rows in the tree. */
function FolderIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path
        d="M1.8 4.6C1.8 4.05 2.25 3.6 2.8 3.6H5.9L7.1 5.1H13.2C13.75 5.1 14.2 5.55 14.2 6.1V11.4C14.2 11.95 13.75 12.4 13.2 12.4H2.8C2.25 12.4 1.8 11.95 1.8 11.4V4.6Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </Icon>
  )
}

/** Terminal prompt: section header of the SQL box. */
function TerminalIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.5 6L6.5 8L4.5 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10.5H11.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </Icon>
  )
}

/** Chevron: tree expand indicator (rotates 90° when open). */
function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Alert triangle: error bar heading. */
function AlertIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M8 2.2L14.2 13H1.8L8 2.2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 6.4V9.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="8" cy="11" r="0.9" fill="currentColor" />
    </Icon>
  )
}

/** Play triangle: SQL run button. */
function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M3.4 2.1C3.4 1.66 3.88 1.4 4.26 1.62L9.9 5.02C10.26 5.23 10.26 5.77 9.9 5.98L4.26 9.38C3.88 9.6 3.4 9.34 3.4 8.9V2.1Z" />
    </svg>
  )
}

/** Database kinds offered by the connection form. */
export type DatabaseType = 'mysql' | 'postgres' | 'sqlite' | 'oracle' | 'hive' | 'impala'

/** The sessions-list slice the workbench needs (structural; avoids a runtime import). */
export interface SessionListLike {
  byId: Record<string, { agentPreset?: string }>
}

/** One described column. */
interface ColumnInfo {
  name: string
  type: string
  nullable?: boolean
}

/** Wire shapes of the plugin routes. */
interface ConnectResponse { ok: boolean; tables?: string[]; error?: string }
interface StatusResponse {
  connected: boolean
  summary?: {
    type: DatabaseType
    host?: string
    port?: number
    user?: string
    database: string
    readonly?: boolean
    tables?: string[]
  }
}
interface SchemasResponse { ok: boolean; schemas?: string[]; error?: string }
interface TablesResponse { ok: boolean; tables?: string[]; error?: string }
interface DescribeResponse { ok: boolean; columns?: ColumnInfo[]; error?: string }
interface QueryResponse {
  ok: boolean
  result?: { exitCode: number | null; stdout: string; stderr: string; truncated: boolean }
  error?: string
}

/** Registration-side business face: the sessions-list observable becomes `useSessions`. */
export interface DataAgentWorkbenchInjected {
  hooks: {
    sessions: {
      getSnapshot(): SessionListLike
      subscribe(fn: () => void): () => void
    }
  }
}

/** The workbench's full component props: the dock seat + the locale seat + the injected sessions hook. */
export type DataAgentWorkbenchProps =
  PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'data-agent'>
  & InjectFace<DataAgentWorkbenchInjected>

/** The conversation column's phase attribute value while the session is blank. */
function isHeroPhase(element: HTMLElement | null): boolean {
  return element?.getAttribute('data-phase') === 'hero'
}

/**
 * 开始对话后（active 布局）左栏工作台相对会话列顶部的下移偏移（px）：
 * 让工作台避开会话头部区域、整体往下沉一些，顶部露出对话记录。
 */
const RAIL_TOP_OFFSET = 96

/** Default port per type (used to fill the form from a saved connection). */
function defaultPortOf(type: DatabaseType): string {
  switch (type) {
    case 'postgres': return '5432'
    case 'oracle': return '1521'
    case 'hive': return '10000'
    case 'impala': return '21050'
    case 'sqlite': return ''
    case 'mysql': return '3306'
  }
}

/** Run one /connect request (shared by the form connect and mount auto-reconnect). */
async function performConnect(sessionId: string, body: Record<string, unknown>): Promise<ConnectResponse> {
  const response = await fetch('/plugins/data-agent/connect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, ...body }),
  })
  return response.json() as Promise<ConnectResponse>
}

/** Build the /connect payload from a saved connection. */
function payloadFromSaved(saved: SavedConnection): Record<string, unknown> {
  if (saved.type === 'sqlite') return { type: saved.type, database: saved.database }
  const body: Record<string, unknown> = {
    type: saved.type,
    host: saved.host ?? '127.0.0.1',
    user: saved.user ?? '',
    database: saved.database,
  }
  if (saved.port !== undefined) body.port = saved.port
  if (saved.password !== undefined && saved.password !== '') body.password = saved.password
  return body
}

/** The database workbench body. */
export function DataAgentWorkbench({ sessionId, useSessions, t }: DataAgentWorkbenchProps) {
  const list = useSessions(snapshot => snapshot)
  const isDataAgent = list.byId[sessionId as never]?.agentPreset === DATA_AGENT_PRESET

  const rootRef = useRef<HTMLDivElement | null>(null)
  const [phase, setPhase] = useState<'hero' | 'active'>('hero')
  const [railRect, setRailRect] = useState<{ left: number; top: number; bottom: number } | null>(null)

  // 表单从已保存的连接配置（localStorage）惰性初始化：切换会话/刷新/重启后回填。
  const [initialSaved] = useState(loadConnection)
  const [type, setType] = useState<DatabaseType>(initialSaved?.type ?? 'mysql')
  const [host, setHost] = useState(initialSaved?.host ?? '127.0.0.1')
  const [port, setPort] = useState(
    initialSaved?.port !== undefined ? String(initialSaved.port) : defaultPortOf(initialSaved?.type ?? 'mysql'),
  )
  const [user, setUser] = useState(initialSaved?.user ?? '')
  const [password, setPassword] = useState(initialSaved?.password ?? '')
  const [rememberPassword, setRememberPassword] = useState(initialSaved?.persistPassword === true)
  const [readonly, setReadonly] = useState(false)
  const [database, setDatabase] = useState(initialSaved?.database ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)

  // Connection form collapsed into a summary row once connected.
  const [configOpen, setConfigOpen] = useState(false)
  // Mount-time auto-reconnect in flight (from the saved connection).
  const [restoring, setRestoring] = useState(false)
  // Schema explorer Modal.
  const [schemaModalOpen, setSchemaModalOpen] = useState(false)

  const [schemas, setSchemas] = useState<string[]>([])
  const [activeSchema, setActiveSchema] = useState<string | null>(null)
  const [tables, setTables] = useState<string[]>([])
  const [activeTable, setActiveTable] = useState<string | null>(null)
  const [columns, setColumns] = useState<ColumnInfo[] | null>(null)

  const [sql, setSql] = useState('')
  const [sqlBusy, setSqlBusy] = useState(false)
  const [sqlResult, setSqlResult] = useState<string | null>(null)

  // Track the conversation column phase and its bounds for the left-rail
  // layout; toggle the da-split class that shifts chat + input to the right.
  useEffect(() => {
    const column = rootRef.current?.closest<HTMLElement>('[data-phase]') ?? null
    if (column === null) return
    const measure = (): void => {
      const rect = column.getBoundingClientRect()
      setRailRect({ left: rect.left, top: rect.top, bottom: window.innerHeight - rect.bottom })
    }
    const refreshPhase = (): void => { setPhase(isHeroPhase(column) ? 'hero' : 'active') }
    refreshPhase()
    measure()
    const observer = new MutationObserver(refreshPhase)
    observer.observe(column, { attributes: true, attributeFilter: ['data-phase'] })
    const resizer = new ResizeObserver(measure)
    resizer.observe(column)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      resizer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // Split layout is active only for a live conversation (phase active) with
  // a measurable column; everything else stays stacked above the input.
  const split = phase === 'active' && railRect !== null
  useEffect(() => {
    const root = document.documentElement
    const splitClass = css['da-split']
    if (split && splitClass !== undefined) root.classList.add(splitClass)
    else if (splitClass !== undefined) root.classList.remove(splitClass)
    return () => { if (splitClass !== undefined) root.classList.remove(splitClass) }
  }, [split])

  // 草稿持久化：任何表单字段变化立即保存（含密码，用户已确认），
  // 使未连接的输入在切换会话/刷新后也能恢复。首轮跳过（初始化回填值
  // 无需重写，也避免从未输入时写入空配置）。
  const firstDraftRun = useRef(true)
  useEffect(() => {
    if (firstDraftRun.current) {
      firstDraftRun.current = false
      return
    }
    const draft: SavedConnection = {
      type,
      database,
      ...type !== 'sqlite' ? { host, user } : {},
      ...type !== 'sqlite' && port !== '' ? { port: Number(port) } : {},
      ...password !== '' ? { password } : {},
      ...rememberPassword ? { persistPassword: true } : {},
      savedAt: new Date().toISOString(),
    }
    saveConnection(draft)
  }, [type, host, port, user, database, password, rememberPassword])

  // Mirror the server-side connection on mount; auto-reconnect once when the
  // server store was lost (restart).
  useEffect(() => {
    let cancelled = false
    const saved = initialSaved
    setBusy(true)
    fetch(`/plugins/data-agent/status?sessionId=${encodeURIComponent(sessionId)}`)
      .then(response => response.json() as Promise<StatusResponse>)
      .then(async (body) => {
        if (cancelled) return
        if (body.connected) {
          setConnected(true)
          if (body.summary !== undefined) {
            setType(body.summary.type)
            setHost(body.summary.host ?? '')
            setPort(body.summary.port !== undefined ? String(body.summary.port) : '')
            setUser(body.summary.user ?? '')
            setDatabase(body.summary.database)
            setReadonly(body.summary.readonly === true)
          }
          const response = await fetch(`/plugins/data-agent/schemas?sessionId=${encodeURIComponent(sessionId)}`)
          const schemasBody = await response.json() as SchemasResponse
          if (!cancelled && schemasBody.ok) setSchemas(schemasBody.schemas ?? [])
          return
        }
        // Server connection lost (restart): restore with the saved config, once.
        // 草稿未完成（database 为空）时不自动重连，仅保留表单回填。
        if (saved !== null && saved.database !== '') {
          setRestoring(true)
          try {
            const result = await performConnect(sessionId, payloadFromSaved(saved))
            if (cancelled) return
            if (result.ok) {
              setConnected(true)
              setConfigOpen(false)
              const response = await fetch(`/plugins/data-agent/schemas?sessionId=${encodeURIComponent(sessionId)}`)
              const schemasBody = await response.json() as SchemasResponse
              if (!cancelled && schemasBody.ok) setSchemas(schemasBody.schemas ?? [])
            } else {
              setError(`连接恢复失败：${result.error ?? 'unknown error'}`)
            }
          } catch (cause) {
            if (!cancelled) {
              setError(`连接恢复失败：${cause instanceof Error ? cause.message : String(cause)}`)
            }
          } finally {
            if (!cancelled) setRestoring(false)
          }
        }
      })
      .catch(() => { /* the form stays usable; connect will surface errors */ })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [sessionId])

  const sqlite = type === 'sqlite'

  const connect = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const body: Record<string, unknown> = { sessionId, type, readonly }
    if (sqlite) {
      body.database = database
    } else {
      body.host = host
      if (port !== '') body.port = Number(port)
      body.user = user
      body.database = database
      if (password !== '') body.password = password
    }
    try {
      const result = await performConnect(sessionId, body)
      if (result.ok) {
        setConnected(true)
        // Collapse the form into the summary row. 密码保留在输入框（草稿已持久化）。
        setConfigOpen(false)
        const schemasResponse = await fetch(`/plugins/data-agent/schemas?sessionId=${encodeURIComponent(sessionId)}`)
        const schemasBody = await schemasResponse.json() as SchemasResponse
        if (schemasBody.ok) setSchemas(schemasBody.schemas ?? [])
      } else {
        setError(result.error ?? 'unknown error')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fetch('/plugins/data-agent/disconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      setConnected(false)
      setConfigOpen(false)
      setReadonly(false)
      setSchemaModalOpen(false)
      setSchemas([])
      setActiveSchema(null)
      setTables([])
      setActiveTable(null)
      setColumns(null)
      setSqlResult(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  /** Toggle one schema's table list (single click; only one open at a time). */
  const toggleSchema = async (schema: string): Promise<void> => {
    if (activeSchema === schema) {
      setActiveSchema(null)
      setTables([])
      setActiveTable(null)
      setColumns(null)
      return
    }
    setActiveSchema(schema)
    setActiveTable(null)
    setColumns(null)
    setTables([])
    try {
      const response = await fetch(
        `/plugins/data-agent/tables?sessionId=${encodeURIComponent(sessionId)}&schema=${encodeURIComponent(schema)}`,
      )
      const result = await response.json() as TablesResponse
      if (result.ok) setTables(result.tables ?? [])
      else setError(result.error ?? 'unknown error')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const selectTable = async (table: string): Promise<void> => {
    setActiveTable(table)
    setColumns(null)
    const params = new URLSearchParams({ sessionId, table })
    if (activeSchema !== null) params.set('schema', activeSchema)
    try {
      const response = await fetch(`/plugins/data-agent/describe?${params.toString()}`)
      const result = await response.json() as DescribeResponse
      if (result.ok) setColumns(result.columns ?? [])
      else setError(result.error ?? 'unknown error')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const runSql = async (): Promise<void> => {
    if (sql.trim() === '') return
    setSqlBusy(true)
    setSqlResult(null)
    try {
      const response = await fetch('/plugins/data-agent/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, sql }),
      })
      const result = await response.json() as QueryResponse
      if (result.ok && result.result !== undefined) {
        const parts: string[] = []
        if (result.result.stdout !== '') parts.push(result.result.stdout)
        if (result.result.stderr !== '') parts.push(`[stderr]\n${result.result.stderr}`)
        if (result.result.truncated) parts.push('… 输出超过上限，已截断')
        if (result.result.exitCode !== 0) parts.push(`[exit code: ${result.result.exitCode ?? 'signal'}]`)
        setSqlResult(parts.join('\n'))
      } else {
        setSqlResult(`Error: ${result.error ?? 'unknown error'}`)
      }
    } catch (cause) {
      setSqlResult(`Error: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setSqlBusy(false)
    }
  }

  // A session not running the data-agent preset: nothing renders at all.
  if (!isDataAgent) return null

  const databaseLabel = sqlite
    ? t('form.database.sqlite')
    : type === 'oracle'
      ? t('form.database.oracle')
      : type === 'hive' || type === 'impala'
        ? t('form.database.hive')
        : t('form.database')

  const railStyle = split
    ? {
      position: 'fixed' as const,
      left: railRect!.left,
      top: railRect!.top + RAIL_TOP_OFFSET,
      bottom: railRect!.bottom,
      width: 380,
    }
    : undefined

  // Form fields are readonly while connected (edit requires disconnecting).
  const formDisabled = busy || connected

  return (
    <div
      ref={rootRef}
      className={`${css.workbench} ${split ? css.rail : phase === 'active' ? css.docked : css.strip}`}
      style={railStyle}
    >
      <div className={css.sections}>
        {connected && !configOpen ? (
          // ── connected summary row (form collapsed) ──────────────────────
          <section className={css.card}>
            <div className={css.summaryRow}>
              <StateDot state="done" size={8} className={css.dot} />
              <span className={css.statusOk}>{t('state.connected')}</span>
              <span className={css.summaryType}>{t(`type.${type}`)}</span>
              <span className={css.summaryDb} title={database}>{database}</span>
              <span className={css.summaryActions}>
                <button type="button" className={`${css.ghost} ${css.small}`} onClick={() => setConfigOpen(true)}>
                  {t('action.config')}
                </button>
                <button type="button" className={`${css.ghost} ${css.small}`} disabled={busy} onClick={() => { void disconnect() }}>
                  {t('action.disconnect')}
                </button>
              </span>
            </div>
          </section>
        ) : (
          // ── connection form (editable when disconnected, readonly when expanded) ──
          <section className={css.card}>
            <div className={css.cardTitle}>
              <DatabaseIcon className={css.titleIcon} />
              <span>{t('form.title')}</span>
            </div>
            <div className={css.fieldGrid}>
              <label className={css.field}>
                <span className={css.label}>{t('form.type')}</span>
                <select
                  className={css.input}
                  value={type}
                  disabled={formDisabled}
                  onChange={(event) => {
                    const next = event.target.value as DatabaseType
                    setType(next)
                    setPort(next === 'postgres' ? '5432' : next === 'mysql' ? '3306' : next === 'oracle' ? '1521' : next === 'hive' ? '10000' : next === 'impala' ? '21050' : '')
                  }}
                >
                  <option value="mysql">{t('type.mysql')}</option>
                  <option value="postgres">{t('type.postgres')}</option>
                  <option value="sqlite">{t('type.sqlite')}</option>
                  <option value="oracle">{t('type.oracle')}</option>
                  <option value="hive">{t('type.hive')}</option>
                  <option value="impala">{t('type.impala')}</option>
                </select>
              </label>

              {!sqlite && (
                <div className={css.fieldRow2}>
                  <label className={css.field}>
                    <span className={css.label}>{t('form.host')}</span>
                    <input className={css.input} type="text" value={host} disabled={formDisabled} onChange={(event) => setHost(event.target.value)} />
                  </label>
                  <label className={css.field}>
                    <span className={css.label}>{t('form.port')}</span>
                    <input className={css.input} type="number" min={1} max={65535} value={port} disabled={formDisabled} onChange={(event) => setPort(event.target.value)} />
                  </label>
                </div>
              )}

              {!sqlite && (
                <div className={css.fieldRow2}>
                  <label className={css.field}>
                    <span className={css.label}>{t('form.user')}</span>
                    <input className={css.input} type="text" value={user} disabled={formDisabled} onChange={(event) => setUser(event.target.value)} />
                  </label>
                  <label className={css.field}>
                    <span className={css.label}>{t('form.password')}</span>
                    <input className={css.input} type="password" value={password} autoComplete="new-password" disabled={formDisabled} onChange={(event) => setPassword(event.target.value)} />
                  </label>
                </div>
              )}

              {!sqlite && (
                <label className={css.rememberRow}>
                  <input
                    type="checkbox"
                    checked={rememberPassword}
                    disabled={formDisabled}
                    onChange={(event) => setRememberPassword(event.target.checked)}
                  />
                  <span>{t('form.rememberPassword')}</span>
                  <span className={css.rememberHint}>{t('form.rememberPassword.hint')}</span>
                </label>
              )}

              <label className={css.rememberRow}>
                <input
                  type="checkbox"
                  checked={readonly}
                  disabled={formDisabled}
                  onChange={(event) => setReadonly(event.target.checked)}
                />
                <span>{t('form.readonly')}</span>
                <span className={css.rememberHint}>{t('form.readonly.hint')}</span>
              </label>

              <label className={css.field}>
                <span className={css.label}>{databaseLabel}</span>
                <input
                  className={css.input}
                  type="text"
                  value={database}
                  placeholder={sqlite ? t('form.database.sqlite.placeholder') : undefined}
                  disabled={formDisabled}
                  onChange={(event) => setDatabase(event.target.value)}
                />
              </label>
            </div>

            <div className={css.actions}>
              {!connected ? (
                <button
                  type="button"
                  className={css.primary}
                  disabled={busy || database === '' || (!sqlite && host === '')}
                  onClick={() => { void connect() }}
                >
                  {restoring ? t('state.reconnecting') : busy ? t('state.checking') : t('action.connect')}
                </button>
              ) : (
                <>
                  <button type="button" className={css.ghost} onClick={() => setConfigOpen(false)}>
                    {t('action.collapse')}
                  </button>
                  <button type="button" className={css.ghost} disabled={busy} onClick={() => { void disconnect() }}>
                    {t('action.disconnect')}
                  </button>
                </>
              )}
            </div>
          </section>
        )}

        {connected && (
          // ── schema explorer entry ───────────────────────────────────────
          <section className={css.card}>
            <button type="button" className={css.browseRow} onClick={() => setSchemaModalOpen(true)}>
              <TableIcon className={css.browseIcon} />
              <span>{t('action.browse')}</span>
              <ChevronIcon className={css.browseChevron} />
            </button>
          </section>
        )}

        <section className={css.card}>
          <div className={css.cardTitle}>
            <TerminalIcon className={css.titleIcon} />
            <span>{t('wb.sql')}</span>
          </div>
          <textarea
            className={css.sqlInput}
            value={sql}
            rows={8}
            spellCheck={false}
            placeholder={t('wb.sql.placeholder')}
            onChange={(event) => setSql(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void runSql()
              }
            }}
          />
          <div className={css.sqlActions}>
            <span className={css.shortcutHint}>{t('wb.sql.shortcut')}</span>
            <button
              type="button"
              className={css.primary}
              disabled={sqlBusy || !connected || sql.trim() === ''}
              onClick={() => { void runSql() }}
            >
              <PlayIcon />
              {sqlBusy ? t('wb.sql.running') : t('wb.sql.run')}
            </button>
          </div>
          <pre className={css.sqlResult}>{sqlResult ?? t('wb.sql.empty')}</pre>
        </section>
      </div>

      {error !== null && (
        <div className={css.errorBar}>
          <div className={css.errorHead}>
            <AlertIcon className={css.errorIcon} />
            <span>{t('error.title')}</span>
          </div>
          <span className={css.errorText}>{error}</span>
        </div>
      )}

      {schemaModalOpen && (
        <Modal
          open={schemaModalOpen}
          onClose={() => setSchemaModalOpen(false)}
          title={t('wb.modal.title')}
          closeLabel={t('action.close')}
          className={css.schemaModal}
        >
          <div className={css.modalBody}>
            <div className={css.modalCol}>
              <div className={css.modalColTitle}>
                <span>{t('wb.schemas')}</span>
                {schemas.length > 0 && <span className={css.colCount}>{schemas.length}</span>}
              </div>
              <div className={css.treeScroll}>
                {schemas.length === 0 && <div className={css.hint}>{t('wb.loading')}</div>}
                <ul className={css.tree}>
                  {schemas.map(schema => (
                    <li key={schema} className={css.treeNode}>
                      <button
                        type="button"
                        className={`${css.treeItem}${activeSchema === schema ? ` ${css.active}` : ''}`}
                        onClick={() => { void toggleSchema(schema) }}
                      >
                        <ChevronIcon className={`${css.treeChevron}${activeSchema === schema ? ` ${css.open}` : ''}`} />
                        <FolderIcon className={css.treeIcon} />
                        <span className={css.treeName}>{schema}</span>
                        {activeSchema === schema && tables.length > 0 && (
                          <span className={css.treeCount}>{tables.length}</span>
                        )}
                      </button>
                      {activeSchema === schema && (
                        <div className={css.treeChildren}>
                          {tables.length === 0 && <div className={css.hint}>{t('wb.empty')}</div>}
                          {tables.map(table => (
                            <button
                              key={table}
                              type="button"
                              className={`${css.treeItem}${activeTable === table ? ` ${css.active}` : ''}`}
                              onClick={() => { void selectTable(table) }}
                            >
                              <TableIcon className={css.treeIcon} />
                              <span className={css.treeName}>{table}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={css.modalHint}>{t('wb.hint.click')}</div>
            </div>

            <div className={css.modalCol}>
              <div className={css.modalColTitle}>
                <span>{t('wb.columns')}{activeTable !== null && ` · ${activeTable}`}</span>
              </div>
              {columns === null ? (
                <div className={css.emptyState}>
                  <TableIcon className={css.emptyStateIcon} />
                  <span className={css.emptyStateText}>{t('wb.hint.click')}</span>
                </div>
              ) : (
                <div className={css.colScroll}>
                  <table className={css.columnsTable}>
                    <thead>
                      <tr><th>name</th><th>type</th><th>null</th></tr>
                    </thead>
                    <tbody>
                      {columns.map(column => (
                        <tr key={column.name}>
                          <td>{column.name}</td>
                          <td className={css.typeCell}>{column.type}</td>
                          <td className={css.nullCell}>{column.nullable === undefined ? '' : column.nullable ? 'YES' : 'NO'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
