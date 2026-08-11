/**
 * The database conversation view: connection form + status + table list.
 *
 * The view reads the current session's `agentPreset` from the sessions list
 * (recorded by the ui-agent-preset surface): only a session running the
 * `data-agent` preset renders the connection form; every other session gets a
 * guide card and issues no requests.
 *
 * Connection state lives on the server (the dataAgentConnections store), so
 * tab switches never lose it — this component mirrors `/status` on mount.
 */
import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation view-slot declaration (register name)
// and the framework-standard view props (ConvViewProps) into this program.
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './Database.module.css'

/** The plugin's preset id, matching the installed agent preset directory. */
const DATA_AGENT_PRESET = 'data-agent'

/** Database kinds offered by the connection form. */
export type DatabaseType = 'mysql' | 'postgres' | 'sqlite'

/** The sessions-list slice the view needs (structural; avoids a runtime import). */
export interface SessionListLike {
  byId: Record<string, { agentPreset?: string }>
}

/** Wire shape of the /connect and /status responses. */
interface ConnectResponse {
  ok: boolean
  tables?: string[]
  error?: string
}
interface StatusResponse {
  connected: boolean
  summary?: {
    type: DatabaseType
    host?: string
    port?: number
    user?: string
    database: string
    tables?: string[]
  }
}

/** Registration-side business face: the sessions-list observable becomes `useSessions`. */
export interface DatabaseViewInjected {
  hooks: {
    sessions: {
      getSnapshot(): SessionListLike
      subscribe(fn: () => void): () => void
    }
  }
}

/** The database tab's full component props: the framework view seat + the locale seat + the injected sessions hook. */
export type DatabaseViewProps =
  ConvViewProps
  & PropsLocale<'data-agent'>
  & InjectFace<DatabaseViewInjected>

/** The database tab body. */
export function DatabaseView({ sessionId, useSessions, t }: DatabaseViewProps) {
  const list = useSessions(snapshot => snapshot)
  const summary = list.byId[sessionId as never]
  const isDataAgent = summary?.agentPreset === DATA_AGENT_PRESET

  const [type, setType] = useState<DatabaseType>('mysql')
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('3306')
  const [user, setUser] = useState('root')
  const [password, setPassword] = useState('')
  const [database, setDatabase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [tables, setTables] = useState<string[]>([])

  // Mirror the server-side connection on mount (tab switches remount this
  // view; the store outlives them).
  useEffect(() => {
    let cancelled = false
    setBusy(true)
    fetch(`/plugins/data-agent/status?sessionId=${encodeURIComponent(sessionId)}`)
      .then(response => response.json() as Promise<StatusResponse>)
      .then((body) => {
        if (cancelled) return
        if (body.connected) {
          setConnected(true)
          setTables(body.summary?.tables ?? [])
          if (body.summary !== undefined) {
            setType(body.summary.type)
            setHost(body.summary.host ?? '')
            setPort(body.summary.port !== undefined ? String(body.summary.port) : '')
            setUser(body.summary.user ?? '')
            setDatabase(body.summary.database)
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
    const body: Record<string, unknown> = { sessionId, type }
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
      const response = await fetch('/plugins/data-agent/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await response.json() as ConnectResponse
      if (result.ok) {
        setConnected(true)
        setTables(result.tables ?? [])
        // Never echo the password back into the field after a successful connect.
        setPassword('')
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
      setTables([])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  // A session not running the data-agent preset: guide card, no requests.
  if (!isDataAgent) {
    return (
      <div className={css.view}>
        <div className={css.guideCard}>
          <div className={css.guideTitle}>{t('guide.title')}</div>
          <div className={css.guideText}>{t('guide.text')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className={css.view}>
      <div className={css.inner}>
        <div className={css.formColumn}>
          <div className={css.formTitle}>{t('form.title')}</div>

          <label className={css.field}>
            <span className={css.label}>{t('form.type')}</span>
            <select
              className={css.input}
              value={type}
              disabled={busy || connected}
              onChange={(event) => {
                const next = event.target.value as DatabaseType
                setType(next)
                setPort(next === 'postgres' ? '5432' : next === 'mysql' ? '3306' : '')
              }}
            >
              <option value="mysql">{t('type.mysql')}</option>
              <option value="postgres">{t('type.postgres')}</option>
              <option value="sqlite">{t('type.sqlite')}</option>
            </select>
          </label>

          {!sqlite && (
            <label className={css.field}>
              <span className={css.label}>{t('form.host')}</span>
              <input
                className={css.input}
                type="text"
                value={host}
                disabled={busy || connected}
                onChange={(event) => setHost(event.target.value)}
              />
            </label>
          )}

          {!sqlite && (
            <label className={css.field}>
              <span className={css.label}>{t('form.port')}</span>
              <input
                className={css.input}
                type="number"
                min={1}
                max={65535}
                value={port}
                disabled={busy || connected}
                onChange={(event) => setPort(event.target.value)}
              />
            </label>
          )}

          {!sqlite && (
            <label className={css.field}>
              <span className={css.label}>{t('form.user')}</span>
              <input
                className={css.input}
                type="text"
                value={user}
                disabled={busy || connected}
                onChange={(event) => setUser(event.target.value)}
              />
            </label>
          )}

          {!sqlite && (
            <label className={css.field}>
              <span className={css.label}>{t('form.password')}</span>
              <input
                className={css.input}
                type="password"
                value={password}
                autoComplete="new-password"
                disabled={busy || connected}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}

          <label className={css.field}>
            <span className={css.label}>{sqlite ? t('form.database.sqlite') : t('form.database')}</span>
            <input
              className={css.input}
              type="text"
              value={database}
              placeholder={sqlite ? t('form.database.sqlite.placeholder') : undefined}
              disabled={busy || connected}
              onChange={(event) => setDatabase(event.target.value)}
            />
          </label>

          <div className={css.actions}>
            {!connected ? (
              <button
                type="button"
                className={css.primary}
                disabled={busy || database === '' || (!sqlite && host === '')}
                onClick={() => { void connect() }}
              >
                {busy ? t('state.checking') : t('action.connect')}
              </button>
            ) : (
              <button
                type="button"
                className={css.ghost}
                disabled={busy}
                onClick={() => { void disconnect() }}
              >
                {t('action.disconnect')}
              </button>
            )}
          </div>

          {connected && <div className={css.statusOk}>{t('state.connected')}</div>}
          {error !== null && (
            <div className={css.statusError}>
              <div className={css.errorTitle}>{t('error.title')}</div>
              <div className={css.errorText}>{error}</div>
            </div>
          )}
        </div>

        <div className={css.tablesColumn}>
          <div className={css.tablesTitle}>{t('tables.title')}</div>
          {connected && tables.length === 0 && <div className={css.hint}>{t('tables.empty')}</div>}
          {connected && tables.length > 0 && (
            <ul className={css.tables}>
              {tables.map(table => <li key={table} className={css.table}>{table}</li>)}
            </ul>
          )}
          {!connected && <div className={css.hint}>{t('state.disconnected')}</div>}
          {connected && <div className={css.chatHint}>{t('hint.chat')}</div>}
        </div>
      </div>
    </div>
  )
}
