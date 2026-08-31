// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataAgentHeroControls } from '../src/client/DataAgentHeroControls.tsx'
import { zh } from '../src/client/locales.ts'
import type { AgentPresetSeatState } from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import type { WorkbenchOpenSnapshot } from '../src/client/workbench-open.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconDataOutline16: () => React.createElement('span', { 'data-testid': 'database-icon' }),
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const dictionary = zh as Record<string, string>
const dataAgentT = (key: string): string => dictionary[key] ?? key
const presetT = (key: string): string => key
const OriginalSeat = () => <button type="button">数据模式</button>

function usePreset(current: string) {
  const state: AgentPresetSeatState = {
    options: [], current, error: null, busy: false, introduce: false,
  }
  return <T,>(selector: (snapshot: AgentPresetSeatState) => T): T => selector(state)
}

function useOpen(snapshot: WorkbenchOpenSnapshot) {
  return <T,>(selector: (value: WorkbenchOpenSnapshot) => T): T => selector(snapshot)
}

function renderHero(
  current: string,
  snapshot: WorkbenchOpenSnapshot,
  requestWorkbench = vi.fn(),
  currentSessionId?: string,
) {
  const useSessions = <T,>(selector: (value: { current?: string }) => T): T => selector({ current: currentSessionId })
  render(
    <div data-testid="composer-scope">
      <div>
        <DataAgentHeroControls {...{
          originalSeat: OriginalSeat,
          dataAgentT,
          requestWorkbench,
          useHeroWorkbench: useOpen(snapshot),
          useAgentPresetSeat: usePreset(current),
          useSessions,
          load: vi.fn(),
          select: vi.fn(),
          introduced: vi.fn(),
          t: presetT,
        } as never} />
      </div>
      <div data-composer-card>
        <div role="textbox" aria-label="宿主输入框" contentEditable data-placeholder="宿主占位文案" />
        <div data-composer-placeholder="true">宿主占位文案</div>
      </div>
    </div>,
  )
  return requestWorkbench
}

describe('DataAgentHeroControls', () => {
  it('preserves the host preset seat and only adds the database action for data-agent', () => {
    renderHero('standard', { pending: false, revision: 0 })
    expect(screen.getByRole('button', { name: '数据模式' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '数据库工作台：未连接' })).toBeNull()

    cleanup()
    const request = renderHero('data-agent', { pending: false, revision: 0 })
    fireEvent.click(screen.getByRole('button', { name: '数据库工作台：未连接' }))
    expect(request).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox').getAttribute('data-placeholder')).toBe('数据库未连接，请点击输入框右上角的配置按钮')
    expect(screen.getByRole('textbox').getAttribute('aria-label')).toBe('宿主输入框')
    expect(screen.getByTestId('composer-scope').querySelector('[data-composer-placeholder="true"]')?.textContent)
      .toBe('数据库未连接，请点击输入框右上角的配置按钮')
  })

  it('leaves blank active Sessions to the session-scoped workbench entry', () => {
    renderHero('data-agent', { pending: false, revision: 0 }, vi.fn(), 'session-1')
    expect(screen.queryByRole('button', { name: '数据库工作台：未连接' })).toBeNull()
    expect(screen.getByRole('textbox').getAttribute('data-placeholder')).toBe('宿主占位文案')
    expect(screen.getByTestId('composer-scope').querySelector('[data-composer-placeholder="true"]')?.textContent)
      .toBe('宿主占位文案')
  })

  it('disables the hero action while the host creates the Session', () => {
    renderHero('data-agent', { pending: true, revision: 0 })
    const trigger = screen.getByRole('button', { name: '数据库工作台：未连接' }) as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
    expect(trigger.textContent).toContain('正在检查连接…')
  })
})
