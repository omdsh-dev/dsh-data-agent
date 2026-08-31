/**
 * The database workbench entry for data-agent sessions.
 *
 * Only a compact database button remains mounted from the composer slot and
 * is visually lifted into the context row above the composer card.
 * Clicking it opens one Modal containing connection settings, the schema
 * explorer, data Catalog, and SQL runner as four tabs. Hero and active conversations share
 * this exact surface; the plugin never measures or shifts host layout.
 *
 * Non-data-agent sessions render null before any effect or request runs.
 * Connection state lives on the server and is mirrored from `/status`.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconDataOutline16, Modal, StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation slot declarations (conversation.input.right)
// and the framework-standard view props into this program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: contributes the alpha.2 sessionId/useSessions slot props.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import {
  DATABASE_TYPES,
  databaseTypeDescriptor,
  defaultDatabasePort,
  type DatabaseType,
} from '../database-types.ts'
import {
  loadConnection,
  saveConnection,
  type SavedConnection,
} from './persistence.ts'
import { QueryResultTable, type StructuredWorkbenchResult } from './QueryResultTable.tsx'
import { CatalogPanel } from './CatalogPanel.tsx'
import { DATA_AGENT_PRESET, type ObservableSnapshot, type WorkbenchOpenSnapshot } from './workbench-open.ts'
import { overrideComposerPlaceholder } from './workbench-placeholder.ts'
import css from './DataAgentWorkbench.module.css'

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

export type { DatabaseType } from '../database-types.ts'

/** The sessions-list slice the workbench needs (structural; avoids a runtime import). */
export interface SessionListLike {
  current?: string
  byId: Record<string, {
    projectionValues?: {
      agentPreset?: string | null
    }
  }>
}

/** One described column. */
interface ColumnInfo {
  name: string
  type: string
  nullable?: boolean
}

/** Wire shapes of the plugin routes. */
interface ConnectionWireSummary {
  type: DatabaseType
  host?: string
  port?: number
  user?: string
  database: string
  passwordRef?: string
  readonly?: boolean
  secure?: boolean
  tables?: string[]
  credential?: { configured: boolean; source?: string }
  credentialMode?: 'none' | 'password' | 'reference'
  ready?: boolean
  reconnectRequired?: boolean
  profileId?: string
}
interface ConnectResponse { ok: boolean; tables?: string[]; summary?: ConnectionWireSummary; error?: string }
interface StatusResponse { connected: boolean; reconnectRequired?: boolean; summary?: ConnectionWireSummary }
interface SchemasResponse { ok: boolean; schemas?: string[]; error?: string }
interface TablesResponse { ok: boolean; tables?: string[]; error?: string }
interface DescribeResponse { ok: boolean; columns?: ColumnInfo[]; error?: string }
type InteractiveQueryWireResult = StructuredWorkbenchResult | {
  kind: 'message'
  exitCode: number | null
  stdout: string
  stderr: string
  truncated: boolean
}
type SqlResultState = InteractiveQueryWireResult | { kind: 'error'; message: string }
interface QueryResponse {
  ok: boolean
  result?: InteractiveQueryWireResult
  error?: string
}
interface DisconnectResponse { ok: boolean; error?: string }

/** Registration-side business face: the sessions-list observable becomes `useSessions`. */
export interface DataAgentWorkbenchInjected {
  hooks: {
    sessions: {
      getSnapshot(): SessionListLike
      subscribe(fn: () => void): () => void
    }
    workbenchOpen: ObservableSnapshot<WorkbenchOpenSnapshot>
  }
  acknowledgeWorkbenchOpen(revision: number): void
}

/** The workbench's full component props: the composer-right seat + locale + sessions hook. */
export type DataAgentWorkbenchProps =
  PropsRuntime<'conversation.input.right'>
  & PropsLocale<'data-agent'>
  & InjectFace<DataAgentWorkbenchInjected>

type WorkbenchTab = 'connection' | 'schema' | 'catalog' | 'sql'

/** Default port per type (used to fill the form from a saved connection). */
function defaultPortOf(type: DatabaseType, secure = false): string {
  return type === 'sqlite' ? '' : String(defaultDatabasePort(type, secure))
}

/** Parse one JSON route response without silently accepting an HTTP failure. */
async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const body = await response.json() as { error?: unknown }
      if (typeof body.error === 'string' && body.error !== '') message = body.error
    } catch {
      // Keep the status-only message when the host returned a non-JSON error.
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

/** Run one /connect request (shared by the form connect and mount auto-reconnect). */
async function performConnect(
  sessionId: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ConnectResponse> {
  const response = await fetch('/plugins/data-agent/connect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, ...body }),
    signal,
  })
  return parseJsonResponse<ConnectResponse>(response)
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
  if (saved.readonly !== undefined) body.readonly = saved.readonly
  if (saved.type === 'clickhouse') body.secure = saved.secure === true
  if (saved.passwordRef !== undefined && saved.passwordRef !== '') body.passwordRef = saved.passwordRef
  else if (saved.password !== undefined && saved.password !== '') body.password = saved.password
  return body
}

/** Whether localStorage contains enough information for a safe automatic retry. */
function canAutoReconnect(saved: SavedConnection): boolean {
  if (saved.type === 'sqlite' || saved.credentialMode === 'none') return true
  if (saved.passwordRef !== undefined && saved.passwordRef !== '') return true
  return saved.persistPassword === true && saved.password !== undefined && saved.password !== ''
}

/** Avoid replaying the last browser credential into a different server-side profile. */
function savedMatchesSummary(saved: SavedConnection, summary: ConnectionWireSummary): boolean {
  if (saved.type !== summary.type || saved.database !== summary.database) return false
  if (saved.type === 'sqlite') return true
  return (saved.host ?? '') === (summary.host ?? '')
    && (saved.port ?? undefined) === (summary.port ?? undefined)
    && (saved.user ?? '') === (summary.user ?? '')
    && (saved.type !== 'clickhouse' || (saved.secure === true) === (summary.secure === true))
}

/** The database workbench body. */
export function DataAgentWorkbench({
  sessionId,
  useSessions,
  useWorkbenchOpen,
  acknowledgeWorkbenchOpen,
  t,
}: DataAgentWorkbenchProps) {
  const list = useSessions((snapshot: SessionListLike) => snapshot)
  const isDataAgent = list.byId[sessionId as never]?.projectionValues?.agentPreset === DATA_AGENT_PRESET
  const openRequest = useWorkbenchOpen((snapshot: WorkbenchOpenSnapshot) => snapshot)
  const requestedFromHero = openRequest.sessionId === sessionId && openRequest.revision > 0
  const tabsId = useId()

  // 表单从已保存的连接配置（localStorage）惰性初始化：切换会话/刷新/重启后回填。
  const [initialSaved] = useState(loadConnection)
  const [type, setType] = useState<DatabaseType>(initialSaved?.type ?? 'mysql')
  const [host, setHost] = useState(initialSaved?.host ?? '127.0.0.1')
  const [secure, setSecure] = useState(initialSaved?.type === 'clickhouse' && initialSaved.secure === true)
  const [port, setPort] = useState(
    initialSaved?.port !== undefined
      ? String(initialSaved.port)
      : defaultPortOf(initialSaved?.type ?? 'mysql', initialSaved?.secure === true),
  )
  const [user, setUser] = useState(initialSaved?.user ?? '')
  const [password, setPassword] = useState(initialSaved?.password ?? '')
  const [passwordRef, setPasswordRef] = useState(initialSaved?.passwordRef ?? '')
  const [credentialMode, setCredentialMode] = useState<'password' | 'reference'>(
    initialSaved?.credentialMode === 'reference' || initialSaved?.passwordRef !== undefined ? 'reference' : 'password',
  )
  const [credentialStatus, setCredentialStatus] = useState<{ configured: boolean; source?: string } | undefined>()
  const [rememberPassword, setRememberPassword] = useState(initialSaved?.persistPassword === true)
  const [readonly, setReadonly] = useState(initialSaved?.readonly === true)
  const [database, setDatabase] = useState(initialSaved?.database ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [reconnectRequired, setReconnectRequired] = useState(false)
  const [connectionProfileId, setConnectionProfileId] = useState<string | undefined>()
  const [catalogAvailable, setCatalogAvailable] = useState(false)

  // One workbench Modal owns connection, schema, and SQL as tabs.
  // The hero bridge publishes before the newly materialized Session renders,
  // so its scoped workbench can take the request as initial local state. The
  // request is acknowledged when the user dismisses this Modal.
  const [workbenchOpen, setWorkbenchOpen] = useState(requestedFromHero)
  const [activeTab, setActiveTab] = useState<WorkbenchTab>('connection')
  // Mount-time auto-reconnect in flight (from the saved connection).
  const [restoring, setRestoring] = useState(false)

  const [schemas, setSchemas] = useState<string[]>([])
  const schemasLoaded = useRef(false)
  const [schemaBusy, setSchemaBusy] = useState(false)
  const [activeSchema, setActiveSchema] = useState<string | null>(null)
  const [tables, setTables] = useState<string[]>([])
  const [activeTable, setActiveTable] = useState<string | null>(null)
  const [columns, setColumns] = useState<ColumnInfo[] | null>(null)

  const [sql, setSql] = useState('')
  const [sqlBusy, setSqlBusy] = useState(false)
  const [sqlResult, setSqlResult] = useState<SqlResultState | null>(null)
  const sqlResultId = useRef(0)
  const triggerSlotRef = useRef<HTMLDivElement>(null)
  const catalogStateKey = useRef({}).current

  // 草稿持久化：任何表单字段变化立即保存；密码仅在用户勾选后保存，
  // 使未连接的输入在切换会话/刷新后也能恢复。首轮跳过（初始化回填值
  // 无需重写，也避免从未输入时写入空配置）。
  const firstDraftRun = useRef(true)
  useEffect(() => {
    if (!isDataAgent) return
    if (firstDraftRun.current) {
      firstDraftRun.current = false
      return
    }
    const draft: SavedConnection = {
      type,
      database,
      readonly,
      credentialMode,
      ...type === 'clickhouse' ? { secure } : {},
      ...type !== 'sqlite' ? { host, user } : {},
      ...type !== 'sqlite' && port !== '' ? { port: Number(port) } : {},
      ...type !== 'sqlite' && credentialMode === 'reference' && passwordRef !== '' ? { passwordRef } : {},
      ...type !== 'sqlite' && credentialMode === 'password' && password !== '' ? { password } : {},
      ...type !== 'sqlite' && credentialMode === 'password' && rememberPassword ? { persistPassword: true } : {},
      savedAt: new Date().toISOString(),
    }
    saveConnection(draft)
  }, [isDataAgent, type, host, port, user, database, password, passwordRef, credentialMode, rememberPassword, readonly, secure])

  // Mirror the server-side connection on mount; auto-reconnect once when the
  // server store was lost (restart).
  useEffect(() => {
    if (!isDataAgent) return
    let cancelled = false
    const controller = new AbortController()
    const saved = initialSaved
    setBusy(true)
    fetch(`/plugins/data-agent/status?sessionId=${encodeURIComponent(sessionId)}`, { signal: controller.signal })
      .then(response => parseJsonResponse<StatusResponse>(response))
      .then(async (body) => {
        if (cancelled) return
        const summary = body.summary
        const matchesSaved = saved !== null && summary !== undefined && savedMatchesSummary(saved, summary)
        if (summary !== undefined) {
          setType(summary.type)
          setSecure(summary.type === 'clickhouse' && summary.secure === true)
          setHost(summary.host ?? '')
          setPort(summary.port !== undefined ? String(summary.port) : '')
          setUser(summary.user ?? '')
          setDatabase(summary.database)
          setReadonly(summary.readonly === true)
          setPasswordRef(summary.passwordRef ?? '')
          setCredentialMode(summary.credentialMode === 'reference' || summary.passwordRef !== undefined
            ? 'reference'
            : 'password')
          setCredentialStatus(summary.credential)
          setConnectionProfileId(summary.profileId)
          if (!matchesSaved) {
            setPassword('')
            setRememberPassword(false)
          }
        }
        setConnected(body.connected)
        setReconnectRequired(body.reconnectRequired === true)
        if (body.connected) {
          return
        }
        // Restore only when a reusable secret (or explicit passwordless mode)
        // is available and belongs to this exact durable profile.
        const referenceUnavailable = summary?.credentialMode === 'reference'
          && summary.credential?.configured === false
        if (saved !== null && saved.database !== '' && canAutoReconnect(saved)
          && (summary === undefined || matchesSaved) && !referenceUnavailable) {
          setRestoring(true)
          try {
            const result = await performConnect(sessionId, payloadFromSaved(saved), controller.signal)
            if (cancelled) return
            if (result.ok) {
              setConnected(true)
              setReconnectRequired(false)
              setCredentialStatus(result.summary?.credential)
              setConnectionProfileId(result.summary?.profileId)
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
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [initialSaved, isDataAgent, sessionId])

  const sqlite = type === 'sqlite'

  /** Load schemas on first entry to the schema tab; cache successful empty results too. */
  const loadSchemas = async (force = false): Promise<void> => {
    if (schemaBusy || (schemasLoaded.current && !force)) return
    setSchemaBusy(true)
    setError(null)
    try {
      const response = await fetch(`/plugins/data-agent/schemas?sessionId=${encodeURIComponent(sessionId)}`)
      const result = await parseJsonResponse<SchemasResponse>(response)
      if (result.ok) {
        setSchemas(result.schemas ?? [])
        schemasLoaded.current = true
      } else {
        setError(result.error ?? 'unknown error')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSchemaBusy(false)
    }
  }

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
      if (type === 'clickhouse') body.secure = secure
      if (credentialMode === 'reference') {
        if (passwordRef !== '') body.passwordRef = passwordRef
      } else if (password !== '') {
        body.password = password
      }
    }
    try {
      const result = await performConnect(sessionId, body)
      if (result.ok) {
        setConnected(true)
        setReconnectRequired(false)
        setCredentialStatus(result.summary?.credential)
        setConnectionProfileId(result.summary?.profileId)
        if (result.summary?.credentialMode === 'none' && !sqlite) {
          saveConnection({
            type,
            host,
            ...port !== '' ? { port: Number(port) } : {},
            user,
            database,
            readonly,
            ...type === 'clickhouse' ? { secure } : {},
            credentialMode: 'none',
            savedAt: new Date().toISOString(),
          })
        }
        setActiveTab('schema')
        schemasLoaded.current = false
        await loadSchemas(true)
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
      const response = await fetch('/plugins/data-agent/disconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      await parseJsonResponse<DisconnectResponse>(response)
      setConnected(false)
      setReconnectRequired(false)
      setCredentialStatus(undefined)
      setConnectionProfileId(undefined)
      setReadonly(false)
      if (activeTab !== 'catalog') setActiveTab('connection')
      setSchemas([])
      schemasLoaded.current = false
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
      const result = await parseJsonResponse<TablesResponse>(response)
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
      const result = await parseJsonResponse<DescribeResponse>(response)
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
      const result = await parseJsonResponse<QueryResponse>(response)
      if (result.ok && result.result !== undefined) {
        sqlResultId.current += 1
        setSqlResult(result.result)
      } else {
        setSqlResult({ kind: 'error', message: result.error ?? 'unknown error' })
      }
    } catch (cause) {
      setSqlResult({ kind: 'error', message: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setSqlBusy(false)
    }
  }

  const tableResult = sqlResult?.kind === 'table' ? sqlResult : null
  let messageResult = ''
  if (sqlResult?.kind === 'message') {
    const parts: string[] = []
    if (sqlResult.stdout !== '') parts.push(sqlResult.stdout)
    if (sqlResult.stderr !== '') parts.push(`[stderr]\n${sqlResult.stderr}`)
    if (sqlResult.truncated) parts.push(t('wb.sql.result.outputTruncated'))
    if (sqlResult.exitCode !== 0) parts.push(`[exit code: ${sqlResult.exitCode ?? 'signal'}]`)
    messageResult = parts.join('\n') || t('wb.sql.command.done')
  } else if (sqlResult?.kind === 'error') {
    messageResult = sqlResult.message
  }

  const composerPlaceholder = connected
    ? t('composer.placeholder.connected')
    : reconnectRequired
      ? t('composer.placeholder.reconnectRequired')
      : t('composer.placeholder.disconnected')

  // input.right does not expose a placeholder setter. Bridge only to the
  // alpha.2 Lexical editor (with the legacy textarea fallback), and restore
  // the host value on every cleanup. Disabled host states keep their more
  // important reason.
  useLayoutEffect(() => {
    if (!isDataAgent) return
    const card = triggerSlotRef.current?.closest('[data-composer-card]')
    return overrideComposerPlaceholder(card, composerPlaceholder)
  })

  // A session not running the data-agent preset: nothing renders at all.
  if (!isDataAgent) return null

  const databaseLabel = sqlite
    ? t('form.database.sqlite')
    : type === 'oracle'
      ? t('form.database.oracle')
      : type === 'hive' || type === 'impala'
        ? t('form.database.hive')
        : t('form.database')

  // Form fields are readonly while connected (edit requires disconnecting).
  const formDisabled = busy || connected
  const triggerState = error !== null
    ? 'error'
    : busy || restoring
      ? 'ongoing'
      : connected
        ? 'done'
        : 'warning'
  const triggerLabel = error !== null
    ? t('workbench.open.error')
    : busy || restoring
      ? t('workbench.open.checking')
      : connected
        ? t('workbench.open.connected')
        : reconnectRequired
          ? t('workbench.open.reconnectRequired')
          : t('workbench.open.disconnected')

  const tabs: ReadonlyArray<{ id: WorkbenchTab; label: string; icon: ReactNode }> = [
    { id: 'connection', label: t('action.config'), icon: <DatabaseIcon /> },
    { id: 'schema', label: t('action.browse'), icon: <TableIcon /> },
    { id: 'catalog', label: t('action.catalog'), icon: <FolderIcon /> },
    { id: 'sql', label: t('wb.sql'), icon: <TerminalIcon /> },
  ]

  return (
    <>
      <div ref={triggerSlotRef} className={css.triggerSlot}>
        <Tooltip label={triggerLabel} side="top" delayMs={400}>
          <button
            type="button"
            className={`${css.trigger}${workbenchOpen ? ` ${css.triggerActive}` : ''}`}
            aria-label={triggerLabel}
            aria-haspopup="dialog"
            aria-expanded={workbenchOpen}
            onClick={() => setWorkbenchOpen(true)}
          >
            <IconDataOutline16 size={17} />
            <StateDot state={triggerState} size={7} className={css.triggerDot} />
          </button>
        </Tooltip>
      </div>

      <Modal
        open={workbenchOpen}
        onClose={() => {
          setWorkbenchOpen(false)
          if (requestedFromHero) acknowledgeWorkbenchOpen(openRequest.revision)
        }}
        title={t('wb.workbench.title')}
        description={t('wb.workbench.description')}
        closeLabel={t('action.close')}
        className={css.workbenchModal}
        contentClassName={css.workbenchModalContent}
      >
        <div className={css.workbench}>
          <div className={css.connectionSummary} role="status">
            <StateDot state={triggerState} size={8} />
            <span className={css.connectionState}>
              {error !== null
                ? t('error.title')
                : restoring
                  ? t('state.reconnecting')
                  : busy
                    ? t('state.checking')
                    : connected
                      ? t('state.connected')
                      : reconnectRequired
                        ? t('state.reconnectRequired')
                        : t('state.disconnected')}
            </span>
            {(connected || reconnectRequired) && (
              <>
                <span className={css.summaryType}>{t(databaseTypeDescriptor(type).localeKey)}</span>
                <span className={css.summaryDb} title={database}>{database}</span>
                {credentialStatus !== undefined && (
                  <span className={css.summaryType} title={credentialStatus.source}>
                    {credentialStatus.configured ? t('credential.configured') : t('credential.unconfigured')}
                  </span>
                )}
              </>
            )}
          </div>

          <div className={css.tabs} role="tablist" aria-label={t('wb.workbench.tabs')}>
            {tabs.map(tab => {
              const disabled = tab.id === 'catalog'
                ? !connected && !catalogAvailable
                : tab.id !== 'connection' && !connected
              return (
                <button
                  key={tab.id}
                  id={`${tabsId}-${tab.id}-tab`}
                  type="button"
                  role="tab"
                  className={`${css.tab}${activeTab === tab.id ? ` ${css.tabActive}` : ''}`}
                  aria-selected={activeTab === tab.id}
                  aria-controls={`${tabsId}-${tab.id}-panel`}
                  disabled={disabled}
                  onClick={() => {
                    setActiveTab(tab.id)
                    if (tab.id === 'schema') void loadSchemas()
                  }}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </div>

          {activeTab === 'connection' && (
          <section
            id={`${tabsId}-connection-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-connection-tab`}
            className={css.tabPanel}
          >
            <div className={css.fieldGrid}>
              <label className={css.field}>
                <span className={css.label}>{t('form.type')}</span>
                <select
                  className={css.input}
                  value={type}
                  disabled={formDisabled}
                  onChange={(event) => {
                    const next = event.target.value as DatabaseType
                    const previousDefault = defaultPortOf(type, secure)
                    const nextSecure = next === 'clickhouse' && secure
                    if (port === '' || port === previousDefault) setPort(defaultPortOf(next, nextSecure))
                    setType(next)
                    if (next !== 'clickhouse') setSecure(false)
                  }}
                >
                  {DATABASE_TYPES.map(databaseType => (
                    <option key={databaseType} value={databaseType}>
                      {t(databaseTypeDescriptor(databaseType).localeKey)}
                    </option>
                  ))}
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

              {type === 'clickhouse' && (
                <label className={css.rememberRow}>
                  <input
                    type="checkbox"
                    checked={secure}
                    disabled={formDisabled}
                    onChange={(event) => {
                      const next = event.target.checked
                      const previousDefault = defaultPortOf('clickhouse', secure)
                      if (port === '' || port === previousDefault) setPort(defaultPortOf('clickhouse', next))
                      setSecure(next)
                    }}
                  />
                  <span>{t('form.secure')}</span>
                  <span className={css.rememberHint}>{t('form.secure.hint')}</span>
                </label>
              )}

              {!sqlite && (
                <div className={css.fieldRow2}>
                  <label className={css.field}>
                    <span className={css.label}>{t('form.user')}</span>
                    <input className={css.input} type="text" value={user} disabled={formDisabled} onChange={(event) => setUser(event.target.value)} />
                  </label>
                  <label className={css.field}>
                    <span className={css.label}>{t('form.credentialMode')}</span>
                    <select
                      className={css.input}
                      value={credentialMode}
                      disabled={formDisabled}
                      onChange={(event) => {
                        const next = event.target.value as 'password' | 'reference'
                        setCredentialMode(next)
                        setCredentialStatus(undefined)
                      }}
                    >
                      <option value="password">{t('form.credentialMode.password')}</option>
                      <option value="reference">{t('form.credentialMode.reference')}</option>
                    </select>
                  </label>
                </div>
              )}

              {!sqlite && credentialMode === 'password' && (
                <label className={css.field}>
                  <span className={css.label}>{t('form.password')}</span>
                  <input className={css.input} type="password" value={password} autoComplete="new-password" disabled={formDisabled} onChange={(event) => setPassword(event.target.value)} />
                </label>
              )}

              {!sqlite && credentialMode === 'password' && (
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

              {!sqlite && credentialMode === 'reference' && (
                <label className={css.field}>
                  <span className={css.label}>{t('form.passwordRef')}</span>
                  <input
                    className={css.input}
                    type="text"
                    value={passwordRef}
                    placeholder="ANALYTICS_DB_PASSWORD"
                    disabled={formDisabled}
                    onChange={(event) => {
                      setPasswordRef(event.target.value)
                      setCredentialStatus(undefined)
                    }}
                  />
                  <span className={css.rememberHint}>
                    {credentialStatus === undefined
                      ? t('form.passwordRef.hint')
                      : credentialStatus.configured
                        ? `${t('credential.configured')}${credentialStatus.source !== undefined ? ` · ${credentialStatus.source}` : ''}`
                        : t('credential.unconfigured')}
                  </span>
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
                <button type="button" className={css.ghost} disabled={busy} onClick={() => { void disconnect() }}>
                  {t('action.disconnect')}
                </button>
              )}
            </div>
          </section>
          )}

          {activeTab === 'schema' && connected && (
          <section
            id={`${tabsId}-schema-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-schema-tab`}
            className={`${css.tabPanel} ${css.schemaPanel}`}
          >
            <div className={css.modalCol}>
              <div className={css.modalColTitle}>
                <span>{t('wb.schemas')}</span>
                {schemas.length > 0 && <span className={css.colCount}>{schemas.length}</span>}
              </div>
              <div className={css.treeScroll}>
                {schemas.length === 0 && (
                  <div className={css.hint}>{schemaBusy ? t('wb.loading') : t('wb.empty')}</div>
                )}
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
          </section>
          )}

          {activeTab === 'sql' && connected && (
          <section
            id={`${tabsId}-sql-panel`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-sql-tab`}
            className={`${css.tabPanel} ${css.sqlPanel}`}
          >
            <textarea
              className={css.sqlInput}
              value={sql}
              rows={9}
              spellCheck={false}
              placeholder={t(type === 'sqlserver' ? 'wb.sql.placeholder.sqlserver' : 'wb.sql.placeholder')}
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
                disabled={sqlBusy || sql.trim() === ''}
                onClick={() => { void runSql() }}
              >
                <PlayIcon />
                {sqlBusy ? t('wb.sql.running') : t('wb.sql.run')}
              </button>
            </div>
            {sqlResult === null ? (
              <div className={css.sqlResultEmpty}>{t('wb.sql.empty')}</div>
            ) : tableResult !== null ? (
              <QueryResultTable key={sqlResultId.current} result={tableResult} t={t} />
            ) : (
              <pre className={`${css.sqlMessage} ${sqlResult.kind === 'error' ? css.sqlMessageError : ''}`}>
                {messageResult}
              </pre>
            )}
          </section>
          )}

          <CatalogPanel
            id={`${tabsId}-catalog-panel`}
            labelledBy={`${tabsId}-catalog-tab`}
            active={activeTab === 'catalog'}
            sessionId={sessionId}
            connected={connected}
            connectionProfileId={connectionProfileId}
            stateKey={catalogStateKey}
            t={t}
            onAvailabilityChange={setCatalogAvailable}
          />

          {error !== null && (
            <div className={css.errorBar} role="alert">
              <div className={css.errorHead}>
                <AlertIcon className={css.errorIcon} />
                <span>{t('error.title')}</span>
              </div>
              <span className={css.errorText}>{error}</span>
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
