// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DataAgentWorkbench, type SessionListLike } from '../src/client/DataAgentWorkbench.tsx'
import { zh } from '../src/client/locales.ts'
import { CONNECTION_STORAGE_KEY } from '../src/client/persistence.ts'
import type { WorkbenchOpenSnapshot } from '../src/client/workbench-open.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconDataOutline16: () => React.createElement('span', { 'data-testid': 'database-icon' }),
  StateDot: ({ state }: { state: string }) => React.createElement('span', { 'data-testid': 'state-dot', 'data-state': state }),
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  Modal: ({ open, onClose, title, description, children }: {
    open: boolean
    onClose: () => void
    title: string
    description?: string
    children?: React.ReactNode
  }) => {
    React.useEffect(() => {
      if (!open) return
      const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
    }, [onClose, open])
    if (!open) return null
    return React.createElement(
      'div',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      description === undefined ? null : React.createElement('p', null, description),
      children,
    )
  },
}))

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  })
})

afterEach(() => {
  cleanup()
  delete (window.navigator as { clipboard?: unknown }).clipboard
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const dictionary = zh as Record<string, string>
const t = (key: string, values?: Record<string, string | number>): string => {
  let output = dictionary[key] ?? key
  for (const [name, value] of Object.entries(values ?? {})) {
    output = output.replaceAll(`{${name}}`, String(value))
  }
  return output
}

function response(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

function useSessionsFor(agentPreset?: string) {
  const snapshot: SessionListLike = {
    byId: {
      'session-1': agentPreset === undefined
        ? {}
        : { projectionValues: { agentPreset } },
    },
  }
  return <T,>(selector: (value: SessionListLike) => T): T => selector(snapshot)
}

function useWorkbenchOpenFor(snapshot: WorkbenchOpenSnapshot = { pending: false, revision: 0 }) {
  return <T,>(selector: (value: WorkbenchOpenSnapshot) => T): T => selector(snapshot)
}

function renderWorkbench(
  agentPreset?: string,
  openSnapshot: WorkbenchOpenSnapshot = { pending: false, revision: 0 },
  acknowledgeWorkbenchOpen = vi.fn(),
) {
  return render(<DataAgentWorkbench {...{
    sessionId: 'session-1',
    useSessions: useSessionsFor(agentPreset),
    useWorkbenchOpen: useWorkbenchOpenFor(openSnapshot),
    acknowledgeWorkbenchOpen,
    t,
  } as never} />)
}

function composerWorkbenchNode(agentPreset?: string, editor: 'lexical' | 'textarea' = 'lexical') {
  return (
    <div data-composer-card>
      {editor === 'lexical'
        ? (
            <div>
              <div role="textbox" aria-label="宿主输入框" contentEditable data-placeholder="宿主占位文案" />
              <div data-composer-placeholder="true">宿主占位文案</div>
            </div>
          )
        : <textarea aria-label="宿主输入框" placeholder="宿主占位文案" />}
      <DataAgentWorkbench {...{
        sessionId: 'session-1',
        useSessions: useSessionsFor(agentPreset),
        useWorkbenchOpen: useWorkbenchOpenFor(),
        acknowledgeWorkbenchOpen: vi.fn(),
        t,
      } as never} />
    </div>
  )
}

function placeholderOf(input: HTMLElement): string | null {
  return input instanceof HTMLTextAreaElement
    ? input.getAttribute('placeholder')
    : input.getAttribute('data-placeholder')
}

describe('DataAgentWorkbench composer entry', () => {
  it('renders nothing and makes no request outside data-agent sessions', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const view = renderWorkbench('standard')
    expect(view.container.innerHTML).toBe('')
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows one top-right dialog trigger and keeps advanced tabs disabled before connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ connected: false })))
    renderWorkbench('data-agent')

    const trigger = await screen.findByRole('button', { name: '数据库工作台：未连接' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '数据库工作台' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(within(dialog).getByRole('tab', { name: '连接配置' }).getAttribute('aria-selected')).toBe('true')
    expect((within(dialog).getByRole('tab', { name: '库表' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(dialog).getByRole('tab', { name: 'SQL 命令' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.documentElement.className).not.toContain('da-split')
  })

  it('accepts the one-shot hero request for its materialized data-agent session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ connected: false })))
    const acknowledge = vi.fn()
    renderWorkbench('data-agent', {
      pending: false,
      revision: 3,
      sessionId: 'session-1',
    }, acknowledge)

    expect(await screen.findByRole('dialog', { name: '数据库工作台' })).toBeTruthy()
    expect(acknowledge).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(acknowledge).toHaveBeenCalledWith(3)
  })

  it('shows all database types and submits ClickHouse HTTPS with shared default ports', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/status')) return response({ connected: false })
      if (url.endsWith('/connect') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        expect(body).toMatchObject({
          type: 'clickhouse', port: 8443, secure: true, database: 'analytics',
        })
        return response({ ok: true, summary: { type: 'clickhouse', database: 'analytics', secure: true } })
      }
      if (url.includes('/schemas')) return response({ ok: true, schemas: [] })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWorkbench('data-agent')

    fireEvent.click(await screen.findByRole('button', { name: '数据库工作台：未连接' }))
    const dialog = screen.getByRole('dialog', { name: '数据库工作台' })
    const typeSelect = within(dialog).getByLabelText('数据库类型') as HTMLSelectElement
    expect(Array.from(typeSelect.options, option => option.text)).toEqual([
      'MySQL', 'PostgreSQL', 'SQLite', 'Oracle', 'Hive', 'Impala', 'ClickHouse', 'Apache Doris', 'SQL Server',
    ])
    fireEvent.change(typeSelect, { target: { value: 'clickhouse' } })
    expect((within(dialog).getByLabelText('端口') as HTMLInputElement).value).toBe('8123')
    const secure = within(dialog).getByLabelText(/使用HTTPS/) as HTMLInputElement
    fireEvent.click(secure)
    expect((within(dialog).getByLabelText('端口') as HTMLInputElement).value).toBe('8443')
    fireEvent.change(within(dialog).getByLabelText('数据库名'), { target: { value: 'analytics' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '连接' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
  })

  it('sets the disconnected Lexical placeholder and restores the host copy outside data-agent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ connected: false })))
    const view = render(composerWorkbenchNode('data-agent'))
    const input = screen.getByRole('textbox', { name: '宿主输入框' })

    await screen.findByRole('button', { name: '数据库工作台：未连接' })
    expect(placeholderOf(input)).toBe('数据库未连接，请点击输入框右上角的配置按钮')
    expect(input.getAttribute('aria-label')).toBe('宿主输入框')
    expect(view.container.querySelector('[data-composer-placeholder="true"]')?.textContent)
      .toBe('数据库未连接，请点击输入框右上角的配置按钮')

    view.rerender(composerWorkbenchNode('standard'))
    expect(placeholderOf(input)).toBe('宿主占位文案')
    expect(input.getAttribute('aria-label')).toBe('宿主输入框')
    expect(view.container.querySelector('[data-composer-placeholder="true"]')?.textContent).toBe('宿主占位文案')
  })

  it('keeps the legacy textarea placeholder bridge for older compatible surfaces', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ connected: false })))
    render(composerWorkbenchNode('data-agent', 'textarea'))
    const input = screen.getByRole('textbox', { name: '宿主输入框' })

    await screen.findByRole('button', { name: '数据库工作台：未连接' })
    expect(placeholderOf(input)).toBe('数据库未连接，请点击输入框右上角的配置按钮')
  })

  it('sets the connected composer placeholder after restoring server state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      connected: true,
      summary: { type: 'mysql', database: 'orders' },
    })))
    render(composerWorkbenchNode('data-agent'))
    const input = screen.getByRole('textbox', { name: '宿主输入框' })

    await screen.findByRole('button', { name: '数据库工作台：已连接' })
    expect(placeholderOf(input)).toBe('数据库连接成功，请描述分析内容')
  })

  it('shows reauthentication instead of a green connected state after a temporary password is lost', async () => {
    const fetchMock = vi.fn(async () => response({
      connected: false,
      reconnectRequired: true,
      summary: {
        type: 'mysql', host: 'localhost', port: 3306, user: 'dsh_demo', database: 'dsh_data_agent_demo',
        credentialMode: 'password', credential: { configured: false }, ready: false, reconnectRequired: true,
      },
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(composerWorkbenchNode('data-agent'))
    const input = screen.getByRole('textbox', { name: '宿主输入框' })

    const trigger = await screen.findByRole('button', { name: '数据库工作台：需要重新认证' })
    expect(placeholderOf(input)).toBe('数据库需要重新认证，请点击输入框右上角的配置按钮')
    expect(screen.getByTestId('state-dot').getAttribute('data-state')).toBe('warning')
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '数据库工作台' })
    expect(within(dialog).getByText('需要重新认证')).toBeTruthy()
    expect((within(dialog).getByLabelText('密码') as HTMLInputElement).disabled).toBe(false)
    expect((within(dialog).getByRole('tab', { name: '库表' }) as HTMLButtonElement).disabled).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('automatically restores a matching profile when the user opted to remember its password', async () => {
    localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify({
      type: 'mysql', host: 'localhost', port: 3306, user: 'dsh_demo', database: 'dsh_data_agent_demo',
      password: 'remembered-secret', credentialMode: 'password', persistPassword: true, savedAt: 'x',
    }))
    const source = {
      id: 'profile-a', profileId: 'profile-a', type: 'mysql', name: 'dsh_data_agent_demo', database: 'dsh_data_agent_demo',
      credentialConfigured: true, createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/catalog/sources')) return response({ ok: true, sources: [source] })
      if (url.includes('/catalog/status')) return response({
        ok: true, status: { source, counts: { assets: 1, fields: 1, needsReview: 0 } },
      })
      if (url.includes('/catalog/runs')) return response({ ok: true, runs: [] })
      if (url.includes('/catalog/search')) return response({
        ok: true, page: { sourceId: 'profile-a', query: '*', items: [], truncated: false, warnings: [] },
      })
      if (url.includes('/plugins/data-agent/status')) {
        return response({
          connected: false,
          reconnectRequired: true,
          summary: {
            type: 'mysql', host: 'localhost', port: 3306, user: 'dsh_demo', database: 'dsh_data_agent_demo',
            credentialMode: 'password', credential: { configured: false }, ready: false, reconnectRequired: true,
          },
        })
      }
      if (url.endsWith('/connect') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        expect(body.password).toBe('remembered-secret')
        return response({
          ok: true,
          summary: {
            type: 'mysql', database: 'dsh_data_agent_demo', credentialMode: 'password',
            credential: { configured: true, source: 'memory' }, ready: true, reconnectRequired: false,
            profileId: 'profile-a',
          },
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(composerWorkbenchNode('data-agent'))
    const input = screen.getByRole('textbox', { name: '宿主输入框' })

    const trigger = await screen.findByRole('button', { name: '数据库工作台：已连接' })
    expect(placeholderOf(input)).toBe('数据库连接成功，请描述分析内容')
    expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/connect'))).toHaveLength(1)

    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '数据库工作台' })
    const catalogTab = await within(dialog).findByRole('tab', { name: '数据治理' }) as HTMLButtonElement
    await waitFor(() => expect(catalogTab.disabled).toBe(false))
    fireEvent.click(catalogTab)
    const scan = within(dialog).getByRole('button', { name: '扫描' }) as HTMLButtonElement
    await waitFor(() => expect(scan.disabled).toBe(false))
    expect(within(dialog).queryByText('请先使用同一个连接 Profile 重新连接后再扫描。')).toBeNull()
  })

  it('loads schemas lazily on first schema-tab entry for a restored connection', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/status')) {
        return response({ connected: true, summary: { type: 'mysql', database: 'orders' } })
      }
      if (url.includes('/schemas')) return response({ ok: true, schemas: ['orders'] })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWorkbench('data-agent')

    fireEvent.click(await screen.findByRole('button', { name: '数据库工作台：已连接' }))
    const dialog = screen.getByRole('dialog', { name: '数据库工作台' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    fireEvent.click(within(dialog).getByRole('tab', { name: '库表' }))
    await waitFor(() => expect(within(dialog).getAllByText('orders')).toHaveLength(2))
    expect(fetchMock).toHaveBeenCalledTimes(3)

    fireEvent.click(within(dialog).getByRole('tab', { name: '连接配置' }))
    fireEvent.click(within(dialog).getByRole('tab', { name: '库表' }))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('selects and renders Unicode SQLite table metadata without rewriting names', async () => {
    const metadataUrls: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/status')) {
        return response({ connected: true, summary: { type: 'sqlite', database: '/tmp/中文.db' } })
      }
      if (url.includes('/schemas')) return response({ ok: true, schemas: ['main'] })
      if (url.includes('/tables')) {
        metadataUrls.push(url)
        return response({ ok: true, tables: ['中文表名'] })
      }
      if (url.includes('/describe')) {
        metadataUrls.push(url)
        return response({ ok: true, columns: [{ name: '姓名', type: 'TEXT', nullable: true }] })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWorkbench('data-agent')

    fireEvent.click(await screen.findByRole('button', { name: '数据库工作台：已连接' }))
    const dialog = screen.getByRole('dialog', { name: '数据库工作台' })
    fireEvent.click(within(dialog).getByRole('tab', { name: '库表' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: /main/ }))
    fireEvent.click(await within(dialog).findByRole('button', { name: /中文表名/ }))

    expect(await within(dialog).findByText('姓名')).toBeTruthy()
    expect(within(dialog).getByText('TEXT')).toBeTruthy()
    expect(within(dialog).getByText('表结构 · 中文表名')).toBeTruthy()
    expect(metadataUrls).toHaveLength(2)
    const tablesUrl = new URL(metadataUrls[0]!, 'http://dsh.internal')
    const describeUrl = new URL(metadataUrls[1]!, 'http://dsh.internal')
    expect(tablesUrl.searchParams.get('schema')).toBe('main')
    expect(describeUrl.searchParams.get('schema')).toBe('main')
    expect(describeUrl.searchParams.get('table')).toBe('中文表名')
    expect(metadataUrls[1]).toContain('%E4%B8%AD%E6%96%87%E8%A1%A8%E5%90%8D')
  })

  it('keeps one Modal open, switches to schema after connect, and preserves SQL across close/reopen', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/status')) return response({ connected: false })
      if (url.endsWith('/connect') && init?.method === 'POST') {
        return response({
          ok: true,
          summary: { type: 'mysql', database: 'orders', credential: { configured: true, source: 'test' } },
        })
      }
      if (url.includes('/schemas')) return response({ ok: true, schemas: ['orders'] })
      if (url.endsWith('/query') && init?.method === 'POST') {
        return response({
          ok: true,
          result: {
            kind: 'table', columns: ['answer'], rows: [{ answer: '42' }], elapsedMs: 2,
            truncated: false, maxRows: 50_000,
          },
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWorkbench('data-agent')

    fireEvent.click(await screen.findByRole('button', { name: '数据库工作台：未连接' }))
    const dialog = screen.getByRole('dialog', { name: '数据库工作台' })
    fireEvent.change(within(dialog).getByLabelText('数据库名'), { target: { value: 'orders' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '连接' }))

    await waitFor(() => {
      expect(within(dialog).getByRole('tab', { name: '库表' }).getAttribute('aria-selected')).toBe('true')
    })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(within(dialog).getAllByText('orders')).toHaveLength(2)

    fireEvent.click(within(dialog).getByRole('tab', { name: 'SQL 命令' }))
    const sqlInput = within(dialog).getByPlaceholderText(/在此输入 SQL/)
    fireEvent.change(sqlInput, { target: { value: 'SELECT 42;' } })
    fireEvent.keyDown(sqlInput, { key: 'Enter', ctrlKey: true })
    expect(await within(dialog).findByText('42')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '数据库工作台：已连接' }))
    const reopened = screen.getByRole('dialog', { name: '数据库工作台' })
    expect(within(reopened).getByDisplayValue('SELECT 42;')).toBeTruthy()
    expect(within(reopened).getByText('42')).toBeTruthy()
  })

  it('renders a paginated result table and copies every loaded row', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({ id: String(index), note: index === 0 ? null : `row-${index}` }))
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/status')) return response({ connected: true, summary: { type: 'mysql', database: 'orders' } })
      if (url.endsWith('/query') && init?.method === 'POST') {
        return response({
          ok: true,
          result: { kind: 'table', columns: ['id', 'note'], rows, elapsedMs: 12, truncated: false, maxRows: 50_000 },
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWorkbench('data-agent')

    fireEvent.click(await screen.findByRole('button', { name: '数据库工作台：已连接' }))
    const dialog = screen.getByRole('dialog', { name: '数据库工作台' })
    fireEvent.click(within(dialog).getByRole('tab', { name: 'SQL 命令' }))
    fireEvent.change(within(dialog).getByPlaceholderText(/在此输入 SQL/), { target: { value: 'SELECT id, note FROM events;' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '运行' }))

    const table = await within(dialog).findByRole('table', { name: 'SQL 查询结果' })
    expect(within(table).getByRole('columnheader', { name: 'id' })).toBeTruthy()
    expect(within(table).getByText('NULL')).toBeTruthy()
    expect(within(dialog).getByText('101 行 · 2 列 · 12 ms')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Excel' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'CSV' })).toBeTruthy()
    expect(within(table).queryByText('100')).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: '下一页' }))
    expect(within(table).getByText('100')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '复制' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    expect(String(writeText.mock.calls[0]![0]).split('\r\n')).toHaveLength(102)
    expect(await within(dialog).findByText('已复制 101 行')).toBeTruthy()
  })

  it('browses a persisted Catalog while disconnected and preserves its search across Modal reopen', async () => {
    const source = {
      id: 'profile-a', profileId: 'profile-a', type: 'mysql', name: 'Orders', database: 'orders',
      credentialConfigured: true, createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
    }
    const revision = {
      id: 'asset-orders:r00000001', assetId: 'asset-orders', sourceId: 'profile-a', runId: 'run-a', revision: 1,
      status: 'observed', fingerprint: 'a'.repeat(64), observedAt: '2026-08-21T00:00:00.000Z', changeSummary: ['added'],
      payload: {
        identity: { sourceId: 'profile-a', database: 'orders', schema: 'sales', kind: 'table', name: 'orders' },
        name: 'orders', path: 'orders.sales.orders', objectType: 'table', comment: '<script>must stay text</script>',
        provenance: { source: 'database', dialect: 'mysql', runId: 'run-a' },
      },
    }
    const catalogSearchUrls: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/catalog/sources')) return response({ ok: true, sources: [source] })
      if (url.includes('/catalog/status')) return response({
        ok: true, status: { source, counts: { assets: 1, fields: 0, needsReview: 0 } },
      })
      if (url.includes('/catalog/runs')) return response({ ok: true, runs: [] })
      if (url.includes('/catalog/search')) {
        catalogSearchUrls.push(url)
        return response({ ok: true, page: {
          sourceId: 'profile-a', query: '*', nextCursor: undefined, truncated: false, warnings: [],
          items: [{
            id: 'asset-orders', sourceId: 'profile-a', resultType: 'asset', kind: 'table', name: 'orders',
            path: 'orders.sales.orders', summary: 'Orders', matchReasons: ['browse'], status: 'observed',
            provenance: 'database', untrusted: true,
          }],
        } })
      }
      if (url.includes('/catalog/assets/asset-orders')) return response({
        ok: true, detail: { asset: revision, fields: [], relations: [], semantics: [], history: [revision], truncated: false, untrusted: true },
      })
      if (url.includes('/status')) return response({ connected: false })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWorkbench('data-agent')
    const trigger = await screen.findByRole('button', { name: '数据库工作台：未连接' })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '数据库工作台' })
    const catalogTab = await within(dialog).findByRole('tab', { name: '数据治理' }) as HTMLButtonElement
    await waitFor(() => expect(catalogTab.disabled).toBe(false))
    expect((within(dialog).getByRole('tab', { name: '库表' }) as HTMLButtonElement).disabled).toBe(true)
    const catalogPanel = document.getElementById(catalogTab.getAttribute('aria-controls')!) as HTMLElement
    expect(catalogPanel.hidden).toBe(true)
    expect(within(dialog).queryByRole('listbox', { name: '数据治理' })).toBeNull()
    fireEvent.click(catalogTab)
    expect(catalogPanel.hidden).toBe(false)
    const search = await within(dialog).findByRole('textbox', { name: '搜索表、字段、术语或指标' }) as HTMLInputElement
    const catalogList = within(dialog).getByRole('listbox', { name: '数据治理' })
    await waitFor(() => expect(within(catalogList).getByRole('option', { name: /orders/ })).toBeTruthy())
    const initialSearch = new URL(catalogSearchUrls.at(-1)!, 'http://localhost')
    expect(initialSearch.searchParams.get('schema')).toBe('orders')
    expect(initialSearch.searchParams.get('assetKinds')).toBe('table,view')
    expect(initialSearch.searchParams.get('assetStatuses')).toBe('observed')
    expect((within(dialog).getByRole('combobox', { name: '全部类型' }) as HTMLSelectElement).value).toBe('relation')
    expect(dialog.textContent).toContain('1资产')
    expect(dialog.textContent).not.toContain('{0}')
    fireEvent.click(within(catalogList).getByRole('option', { name: /orders/ }))
    await waitFor(() => expect(within(dialog).getByText('<script>must stay text</script>')).toBeTruthy())
    expect(dialog.querySelector('script')).toBeNull()
    fireEvent.click(within(dialog).getByRole('tab', { name: '业务定义' }))
    expect(within(dialog).getByText('尚无 AI 业务含义候选')).toBeTruthy()
    expect(within(dialog).getByText(/AI 结果只供参考，仍需人工确认/)).toBeTruthy()
    fireEvent.change(search, { target: { value: '成交金额' } })
    fireEvent.click(within(dialog).getByRole('tab', { name: '连接配置' }))
    expect(catalogPanel.hidden).toBe(true)
    expect(within(dialog).queryByRole('listbox', { name: '数据治理' })).toBeNull()
    fireEvent.click(catalogTab)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(trigger)
    const reopened = screen.getByRole('dialog', { name: '数据库工作台' })
    expect((within(reopened).getByRole('textbox', { name: '搜索表、字段、术语或指标' }) as HTMLInputElement).value).toBe('成交金额')
  })

  it('reviews AI table and field meanings with per-item confirm and delete actions', async () => {
    const source = {
      id: 'profile-a', profileId: 'profile-a', type: 'mysql', name: 'Orders', database: 'orders',
      credentialConfigured: true, createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
    }
    const table = {
      id: 'asset-orders:r00000001', assetId: 'asset-orders', sourceId: 'profile-a', runId: 'run-a', revision: 1,
      status: 'observed', fingerprint: 'a'.repeat(64), observedAt: '2026-08-21T00:00:00.000Z', changeSummary: ['added'],
      payload: {
        identity: { sourceId: 'profile-a', database: 'orders', schema: 'orders', kind: 'table', name: 'orders' },
        name: 'orders', path: 'orders.orders.orders', objectType: 'table',
        provenance: { source: 'database', dialect: 'mysql', runId: 'run-a' },
      },
    }
    const field = {
      ...table, id: 'asset-amount:r00000001', assetId: 'asset-amount', fingerprint: 'b'.repeat(64),
      payload: {
        identity: { sourceId: 'profile-a', database: 'orders', schema: 'orders', relation: 'orders', kind: 'column', name: 'amount' },
        name: 'amount', path: 'orders.orders.orders.amount', parentId: 'asset-orders', dataType: 'decimal(12,2)', nullable: false, ordinal: 1,
        provenance: { source: 'database', dialect: 'mysql', runId: 'run-a' },
      },
    }
    const meaning = (id: string, assetId: string, targetKind: 'table' | 'column', description: string) => ({
      id: `${id}:v00000001`, semanticId: id, sourceId: 'profile-a', version: 1, createdAt: '2026-08-21T00:01:00.000Z',
      definition: {
        kind: 'meaning', name: assetId === 'asset-orders' ? 'orders' : 'amount', aliases: [], description,
        sourceAssetIds: [assetId], status: 'inferred', targetAssetId: assetId, targetKind,
        generatedBy: { kind: 'ai', provider: 'deepseek', model: 'deepseek-chat', runId: 'run-a' },
        triggerRunId: 'run-a', revisionNote: 'AI candidate',
      },
    })
    let semantics = [
      meaning('meaning-table', 'asset-orders', 'table', '记录客户订单及其交易状态。'),
      meaning('meaning-field', 'asset-amount', 'column', '订单应付金额。'),
    ]
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/catalog/sources')) return response({ ok: true, sources: [source] })
      if (url.includes('/catalog/status')) return response({ ok: true, status: { source, counts: { assets: 2, fields: 1, needsReview: semantics.length } } })
      if (url.includes('/catalog/runs')) return response({ ok: true, runs: [] })
      if (url.includes('/catalog/search')) return response({ ok: true, page: { sourceId: 'profile-a', query: '*', truncated: false, warnings: [], items: [{
        id: 'asset-orders', sourceId: 'profile-a', resultType: 'asset', kind: 'table', name: 'orders', path: 'orders.orders.orders', summary: '',
        matchReasons: ['browse'], status: 'observed', provenance: 'database', untrusted: true,
      }] } })
      if (url.includes('/catalog/assets/asset-orders')) return response({ ok: true, detail: {
        asset: table, fields: [field], relations: [], semantics, history: [table], truncated: false, untrusted: true,
      } })
      if (url.includes('/catalog/semantics/meaning-table/verify') && init?.method === 'POST') {
        const current = semantics[0]!
        const verified = { ...current, id: 'meaning-table:v00000002', version: 2, definition: { ...current.definition, status: 'verified' } }
        semantics = [verified, semantics[1]!]
        return response({ ok: true, semantic: verified })
      }
      if (url.includes('/catalog/semantics/meaning-field/dismiss') && init?.method === 'POST') {
        const dismissed = { ...semantics[1]!, version: 2, definition: { ...semantics[1]!.definition, status: 'retired' } }
        semantics = semantics.filter(value => value.semanticId !== 'meaning-field')
        return response({ ok: true, semantic: dismissed })
      }
      if (url.includes('/status')) return response({ connected: true, summary: { type: 'mysql', database: 'orders', profileId: 'profile-a' } })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWorkbench('data-agent')
    fireEvent.click(await screen.findByRole('button', { name: '数据库工作台：已连接' }))
    const dialog = screen.getByRole('dialog', { name: '数据库工作台' })
    fireEvent.click(await within(dialog).findByRole('tab', { name: '数据治理' }))
    const list = await within(dialog).findByRole('listbox', { name: '数据治理' })
    fireEvent.click(await within(list).findByRole('option', { name: /orders/ }))
    fireEvent.click(await within(dialog).findByRole('tab', { name: '业务定义' }))
    expect(await within(dialog).findByText('记录客户订单及其交易状态。')).toBeTruthy()
    expect(within(dialog).getByText('订单应付金额。')).toBeTruthy()
    fireEvent.click(within(dialog).getAllByRole('button', { name: '确认' })[0]!)
    await waitFor(() => expect(within(dialog).getAllByText('已确认').length).toBeGreaterThan(0))
    const fieldRow = within(dialog).getByText('amount').closest('article')!
    fireEvent.click(within(fieldRow).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(within(dialog).queryByText('订单应付金额。')).toBeNull())
  })

  it('requires inline confirmation before starting a full-source Catalog scan', async () => {
    const source = {
      id: 'profile-a', profileId: 'profile-a', type: 'mysql', name: 'Orders', database: 'orders',
      credentialConfigured: true, createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
    }
    const run = {
      id: 'run-a', sourceId: 'profile-a', sessionId: 'session-1', scope: { kind: 'source' }, status: 'queued',
      coverageComplete: false, progress: { schemas: 0, relations: 0, fields: 0, assets: 0 }, createdAt: '2026-08-21T00:00:00.000Z',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/catalog/sources')) return response({ ok: true, sources: [source] })
      if (url.includes('/catalog/status')) return response({ ok: true, status: { source, counts: { assets: 0, fields: 0, needsReview: 0 } } })
      if (url.includes('/catalog/runs')) return response({ ok: true, runs: [] })
      if (url.includes('/catalog/search')) return response({ ok: true, page: { sourceId: 'profile-a', query: '*', items: [], truncated: false, warnings: [] } })
      if (url.endsWith('/catalog/scan') && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ sessionId: 'session-1', scope: { kind: 'source' } })
        return response({ ok: true, run })
      }
      if (url.includes('/status')) return response({ connected: true, summary: { type: 'mysql', database: 'orders', profileId: 'profile-a' } })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWorkbench('data-agent')
    fireEvent.click(await screen.findByRole('button', { name: '数据库工作台：已连接' }))
    const dialog = screen.getByRole('dialog', { name: '数据库工作台' })
    const catalogTab = await within(dialog).findByRole('tab', { name: '数据治理' })
    fireEvent.click(catalogTab)
    fireEvent.change(within(dialog).getByRole('combobox', { name: '扫描' }), { target: { value: 'source' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '扫描' }))
    expect(within(dialog).getByText(/确认扫描整个数据源/)).toBeTruthy()
    expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/catalog/scan'))).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: '全库' }))
    await waitFor(() => expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/catalog/scan'))).toHaveLength(1))
  })

  it('keeps a human semantic draft intact when optimistic verification conflicts', async () => {
    const source = {
      id: 'profile-a', profileId: 'profile-a', type: 'mysql', name: 'Orders', database: 'orders',
      credentialConfigured: true, createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
    }
    const semantic = {
      id: 'metric-gmv:v00000001', semanticId: 'metric-gmv', sourceId: 'profile-a', version: 1,
      createdAt: '2026-08-21T00:00:00.000Z',
      definition: {
        kind: 'metric', name: 'GMV', aliases: ['成交金额'], description: 'Paid order amount', owner: 'finance',
        sourceAssetIds: ['asset-orders'], status: 'inferred', formula: 'SUM(amount)', grain: 'day',
        filters: [], exclusions: [], revisionNote: 'candidate',
      },
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/catalog/semantics/metric-gmv/verify') && init?.method === 'POST') {
        return { ok: false, status: 409, json: async () => ({ error: 'Catalog semantic version conflict; current version is 2' }) } as Response
      }
      if (url.includes('/catalog/semantics/metric-gmv')) return response({ ok: true, semantic })
      if (url.includes('/catalog/sources')) return response({ ok: true, sources: [source] })
      if (url.includes('/catalog/status')) return response({ ok: true, status: { source, counts: { assets: 1, fields: 0, needsReview: 1 } } })
      if (url.includes('/catalog/runs')) return response({ ok: true, runs: [] })
      if (url.includes('/catalog/search')) return response({
        ok: true,
        page: {
          sourceId: 'profile-a', query: '*', items: [{
            id: 'metric-gmv', sourceId: 'profile-a', resultType: 'semantic', kind: 'metric', name: 'GMV',
            path: 'metric:GMV', summary: 'Paid order amount', matchReasons: ['browse'], status: 'inferred',
            version: 1, provenance: 'inferred', untrusted: true,
          }], truncated: false, warnings: [],
        },
      })
      if (url.includes('/status')) return response({ connected: false })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWorkbench('data-agent')
    fireEvent.click(await screen.findByRole('button', { name: '数据库工作台：未连接' }))
    const dialog = screen.getByRole('dialog', { name: '数据库工作台' })
    const catalogTab = await within(dialog).findByRole('tab', { name: '数据治理' }) as HTMLButtonElement
    await waitFor(() => expect(catalogTab.disabled).toBe(false))
    fireEvent.click(catalogTab)
    const list = within(dialog).getByRole('listbox', { name: '数据治理' })
    fireEvent.click(await within(list).findByRole('option', { name: /GMV/ }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '人工确认' }))
    const formula = within(dialog).getByLabelText('公式（仅作为不可信文本保存）') as HTMLTextAreaElement
    const note = within(dialog).getByLabelText('修订说明') as HTMLTextAreaElement
    fireEvent.change(formula, { target: { value: 'SUM(draft_amount)' } })
    fireEvent.change(note, { target: { value: 'Finance approval' } })
    const verifyButtons = within(dialog).getAllByRole('button', { name: '人工确认' })
    fireEvent.click(verifyButtons.at(-1)!)
    expect(await within(dialog).findByText(/current version is 2/)).toBeTruthy()
    expect((within(dialog).getByLabelText('公式（仅作为不可信文本保存）') as HTMLTextAreaElement).value)
      .toBe('SUM(draft_amount)')
    expect((within(dialog).getByLabelText('修订说明') as HTMLTextAreaElement).value).toBe('Finance approval')
  })

  it('loads stable Catalog search pages and renders a selected successful-run diff', async () => {
    const source = {
      id: 'profile-a', profileId: 'profile-a', type: 'mysql', name: 'Orders', database: 'orders',
      credentialConfigured: true, createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
    }
    const runs = ['run-1', 'run-2'].map((id, index) => ({
      id, sourceId: 'profile-a', sessionId: 'session-1', scope: { kind: 'source' }, status: 'succeeded',
      coverageComplete: true, progress: { schemas: 1, relations: index + 1, fields: 0, assets: index + 2 },
      createdAt: `2026-08-21T00:00:0${index}.000Z`, completedAt: `2026-08-21T00:00:0${index}.500Z`,
    }))
    const item = (id: string, name: string) => ({
      id, sourceId: 'profile-a', resultType: 'asset', kind: 'table', name, path: `orders.sales.${name}`,
      summary: name, matchReasons: ['browse'], status: 'observed', provenance: 'database', untrusted: true,
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/catalog/sources')) return response({ ok: true, sources: [source] })
      if (url.includes('/catalog/status')) return response({ ok: true, status: { source, counts: { assets: 2, fields: 0, needsReview: 0 } } })
      if (url.includes('/catalog/runs')) return response({ ok: true, runs })
      if (url.includes('/catalog/search')) {
        const cursor = new URL(url, 'http://dsh.internal').searchParams.get('cursor')
        return response({
          ok: true,
          page: cursor === 'cursor-1'
            ? { sourceId: 'profile-a', query: '*', items: [item('asset-b', 'customers')], truncated: false, warnings: [] }
            : { sourceId: 'profile-a', query: '*', items: [item('asset-a', 'orders')], nextCursor: 'cursor-1', truncated: true, warnings: [] },
        })
      }
      if (url.includes('/catalog/diff')) return response({
        ok: true,
        diff: {
          sourceId: 'profile-a', fromRunId: 'run-1', toRunId: 'run-2', scope: { kind: 'source' }, truncated: false,
          items: [{ kind: 'added', assetId: 'asset-b', name: 'customers', path: 'orders.sales.customers', summary: ['added'] }],
        },
      })
      if (url.includes('/status')) return response({ connected: false })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWorkbench('data-agent')
    fireEvent.click(await screen.findByRole('button', { name: '数据库工作台：未连接' }))
    const dialog = screen.getByRole('dialog', { name: '数据库工作台' })
    const catalogTab = await within(dialog).findByRole('tab', { name: '数据治理' }) as HTMLButtonElement
    await waitFor(() => expect(catalogTab.disabled).toBe(false))
    fireEvent.click(catalogTab)
    const list = within(dialog).getByRole('listbox', { name: '数据治理' })
    expect(await within(list).findByRole('option', { name: /orders/ })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '加载更多' }))
    expect(await within(list).findByRole('option', { name: /customers/ })).toBeTruthy()
    await waitFor(() => {
      expect((within(dialog).getByRole('combobox', { name: '起始成功扫描' }) as HTMLSelectElement).value).toBe('run-1')
      expect((within(dialog).getByRole('combobox', { name: '目标成功扫描' }) as HTMLSelectElement).value).toBe('run-2')
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '查看变更' }))
    expect(await within(dialog).findByText('新增')).toBeTruthy()
    expect(within(dialog).getAllByText('customers')).toHaveLength(2)
  })
})
