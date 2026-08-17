// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DataAgentWorkbench, type SessionListLike } from '../src/client/DataAgentWorkbench.tsx'
import { zh } from '../src/client/locales.ts'
import { CONNECTION_STORAGE_KEY } from '../src/client/persistence.ts'

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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const dictionary = zh as Record<string, string>
const t = (key: string): string => dictionary[key] ?? key

function response(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

function useSessionsFor(agentPreset?: string) {
  const snapshot: SessionListLike = {
    byId: { 'session-1': agentPreset === undefined ? {} : { agentPreset } },
  }
  return <T,>(selector: (value: SessionListLike) => T): T => selector(snapshot)
}

function renderWorkbench(agentPreset?: string) {
  return render(<DataAgentWorkbench {...{
    sessionId: 'session-1',
    useSessions: useSessionsFor(agentPreset),
    t,
  } as never} />)
}

function composerWorkbenchNode(agentPreset?: string) {
  return (
    <div data-composer-card>
      <textarea aria-label="宿主输入框" placeholder="宿主占位文案" />
      <DataAgentWorkbench {...{
        sessionId: 'session-1',
        useSessions: useSessionsFor(agentPreset),
        t,
      } as never} />
    </div>
  )
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

  it('sets the disconnected composer placeholder and restores the host copy outside data-agent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ connected: false })))
    const view = render(composerWorkbenchNode('data-agent'))
    const textarea = screen.getByRole('textbox', { name: '宿主输入框' }) as HTMLTextAreaElement

    await screen.findByRole('button', { name: '数据库工作台：未连接' })
    expect(textarea.placeholder).toBe('数据库未连接，请点击输入框右上角的配置按钮')

    view.rerender(composerWorkbenchNode('standard'))
    expect(textarea.placeholder).toBe('宿主占位文案')
  })

  it('sets the connected composer placeholder after restoring server state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      connected: true,
      summary: { type: 'mysql', database: 'orders' },
    })))
    render(composerWorkbenchNode('data-agent'))
    const textarea = screen.getByRole('textbox', { name: '宿主输入框' }) as HTMLTextAreaElement

    await screen.findByRole('button', { name: '数据库工作台：已连接' })
    expect(textarea.placeholder).toBe('数据库连接成功，请描述分析内容')
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
    const textarea = screen.getByRole('textbox', { name: '宿主输入框' }) as HTMLTextAreaElement

    const trigger = await screen.findByRole('button', { name: '数据库工作台：需要重新认证' })
    expect(textarea.placeholder).toBe('数据库需要重新认证，请点击输入框右上角的配置按钮')
    expect(screen.getByTestId('state-dot').getAttribute('data-state')).toBe('warning')
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '数据库工作台' })
    expect(within(dialog).getByText('需要重新认证')).toBeTruthy()
    expect((within(dialog).getByLabelText('密码') as HTMLInputElement).disabled).toBe(false)
    expect((within(dialog).getByRole('tab', { name: '库表' }) as HTMLButtonElement).disabled).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('automatically restores a matching profile when the user opted to remember its password', async () => {
    localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify({
      type: 'mysql', host: 'localhost', port: 3306, user: 'dsh_demo', database: 'dsh_data_agent_demo',
      password: 'remembered-secret', credentialMode: 'password', persistPassword: true, savedAt: 'x',
    }))
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/status')) {
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
          },
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(composerWorkbenchNode('data-agent'))
    const textarea = screen.getByRole('textbox', { name: '宿主输入框' }) as HTMLTextAreaElement

    await screen.findByRole('button', { name: '数据库工作台：已连接' })
    expect(textarea.placeholder).toBe('数据库连接成功，请描述分析内容')
    expect(fetchMock).toHaveBeenCalledTimes(2)
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
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.click(within(dialog).getByRole('tab', { name: '库表' }))
    await waitFor(() => expect(within(dialog).getAllByText('orders')).toHaveLength(2))
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fireEvent.click(within(dialog).getByRole('tab', { name: '连接配置' }))
    fireEvent.click(within(dialog).getByRole('tab', { name: '库表' }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
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
        return response({ ok: true, result: { exitCode: 0, stdout: '42', stderr: '', truncated: false } })
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
})
