// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach } from 'vitest'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { RenderAnalysisRow, computeViewWidths, formatMetricValue } from '../src/client/AnalysisDashboard.tsx'
import { zh } from '../src/client/locales.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const React = await import('react')
  return {
    StateDot: () => React.createElement('span', { 'data-testid': 'state-dot' }),
    Modal: ({ open, onClose, title, children }: { open: boolean, onClose: () => void, title: string, children?: React.ReactNode }) => {
      React.useEffect(() => {
        if (!open) return
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [open, onClose])
      if (!open) return null
      return React.createElement('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, children)
    },
  }
})

vi.mock('echarts/core', () => ({
  init: vi.fn(() => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() })),
  use: vi.fn(),
}))
vi.mock('echarts/charts', () => ({ LineChart: {}, BarChart: {}, PieChart: {}, ScatterChart: {} }))
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {}, AriaComponent: {} }))
vi.mock('echarts/renderers', () => ({ SVGRenderer: {} }))

afterEach(cleanup)

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= TestResizeObserver as unknown as typeof ResizeObserver

const dictionary = zh as Record<string, string>
const t = (key: string, params?: Record<string, unknown>): string => {
  let text = dictionary[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) text = text.replace('{' + name + '}', String(value))
  return text
}

function runningBlock(): ToolCallBlock {
  return {
    callId: 'call-1', name: 'render-analysis', argsRaw: '{}', turn: 1, step: 1, time: 0,
    callView: null, subCalls: [],
  }
}

function settledBlock(overrides: Record<string, unknown> = {}): ToolCallBlock {
  return {
    kind: 'tool-result', seq: 2, time: 1, callId: 'call-1',
    call: { name: 'render-analysis', argsRaw: '{}' }, callTime: 0,
    content: [{ type: 'text', text: '已生成分析报告' }],
    isError: false, callView: null, resultView: null, subCalls: [],
    ...overrides,
  } as unknown as ToolCallBlock
}

function report(views: unknown[], title = '月度经营分析', summary?: string) {
  return {
    version: 1,
    title,
    ...summary !== undefined ? { summary } : {},
    datasets: [
      { id: 'd1', columns: ['month', 'revenue'], rows: [['1月', '10'], ['2月', '20']] },
      { id: 'd2', columns: ['region', 'total'], rows: [['东', '5'], ['西', '3']] },
      { id: 'd3', columns: ['x'], rows: [] },
    ],
    views,
  }
}

function renderRow(block: ToolCallBlock) {
  return render(<RenderAnalysisRow {...{ toolName: 'render-analysis', block, t } as never} />)
}

const LINE_VIEW = { id: 'v1', kind: 'line', datasetId: 'd1', label: '营收趋势', x: { field: 'month', type: 'category' }, y: ['revenue'] }

describe('RenderAnalysisRow states', () => {
  it('shows the running status without a view button', () => {
    renderRow(runningBlock())
    expect(screen.getByText('正在生成分析')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows error and interrupted outcomes without a view button', () => {
    const error = renderRow(settledBlock({ isError: true, content: [{ type: 'text', text: 'boom' }] }))
    expect(screen.getByText(/分析生成失败/)).toBeTruthy()
    expect(error.queryByRole('button')).toBeNull()
    error.unmount()
    renderRow(settledBlock({ isError: true, error: { name: 'AbortError', code: 'interrupted' }, content: [{ type: 'text', text: 'stop' }] }))
    expect(screen.getByText(/分析已中止/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps complex reports compact: title, counts and a button, no inline preview', () => {
    const block = settledBlock({ meta: report([LINE_VIEW, { id: 'v2', kind: 'pie', datasetId: 'd2', categoryField: 'region', valueField: 'total' }]) })
    renderRow(block)
    expect(screen.getByText('月度经营分析')).toBeTruthy()
    expect(screen.getByText('3 个数据集 · 2 个视图')).toBeTruthy()
    expect(screen.getByRole('button', { name: '查看分析' })).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('inlines a bounded preview only for the simple single-chart report', () => {
    const block = settledBlock({ meta: report([LINE_VIEW]) })
    renderRow(block)
    expect(screen.getByRole('img', { name: '营收趋势' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '查看分析' })).toBeTruthy()
  })

  it('falls back to the raw model text for malformed/unknown meta, no button', () => {
    renderRow(settledBlock({ meta: { version: 2, title: 'x' } }))
    expect(screen.getByText('已生成分析报告')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('Dashboard Modal', () => {
  it('opens only THIS call report, in persisted view order, and closes on Escape with focus return', () => {
    const block = settledBlock({
      meta: report([
        { id: 'm1', kind: 'metric', datasetId: 'd1', field: 'revenue', label: '总营收' },
        LINE_VIEW,
        { id: 'v3', kind: 'table', datasetId: 'd2', columns: ['region', 'total'] },
      ], '月度经营分析', '结论：环比上升'),
    })
    renderRow(block)
    const button = screen.getByRole('button', { name: '查看分析' })
    fireEvent.click(button)
    const dialog = screen.getByRole('dialog', { name: '月度经营分析' })
    expect(within(dialog).getByText('结论：环比上升')).toBeTruthy()
    expect(within(dialog).getByText('总营收')).toBeTruthy()
    expect(within(dialog).getByText('10')).toBeTruthy()
    const images = within(dialog).getAllByRole('img')
    expect(images.map((node) => node.getAttribute('aria-label'))).toEqual(['营收趋势'])
    // Table view renders a semantic table with its columns in order.
    const table = within(dialog).getByRole('table')
    const headers = within(table).getAllByRole('columnheader').map((node) => node.textContent)
    expect(headers).toEqual(['region', 'total'])
    // Escape closes and focus returns to the trigger button.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('isolates multiple reports in one session: each modal shows its own call only', () => {
    const first = settledBlock({ callId: 'call-1', meta: report([LINE_VIEW], '第一份报告') })
    const second = settledBlock({ callId: 'call-2', meta: report([{ ...LINE_VIEW, id: 'v2', label: '第二份趋势' }], '第二份报告') })
    renderRow(first)
    renderRow(second)
    const buttons = screen.getAllByRole('button', { name: '查看分析' })
    fireEvent.click(buttons[1]!)
    const dialog = screen.getByRole('dialog', { name: '第二份报告' })
    expect(within(dialog).getAllByRole('img').map((node) => node.getAttribute('aria-label'))).toEqual(['第二份趋势'])
    expect(within(dialog).queryByText('第一份报告')).toBeNull()
  })

  it('shows a per-view empty state while other views keep rendering', () => {
    const block = settledBlock({
      meta: report([
        LINE_VIEW,
        { id: 'v4', kind: 'bar', datasetId: 'd3', label: '空数据集图', x: { field: 'x', type: 'category' }, y: ['x'] },
      ]),
    })
    renderRow(block)
    fireEvent.click(screen.getByRole('button', { name: '查看分析' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('无数据')).toBeTruthy()
    // The non-empty chart still renders.
    expect(within(dialog).getByRole('img', { name: '营收趋势' })).toBeTruthy()
  })
})

describe('computeViewWidths / metric formatting', () => {
  it('defaults tables and the first chart to full, later charts to half', () => {
    const views = [
      { id: 'm', kind: 'metric', datasetId: 'd', field: 'f', label: 'l' },
      { id: 'c1', kind: 'line', datasetId: 'd', x: { field: 'x', type: 'category' }, y: ['y'] },
      { id: 'c2', kind: 'pie', datasetId: 'd', categoryField: 'a', valueField: 'b' },
      { id: 't', kind: 'table', datasetId: 'd' },
      { id: 'c3', kind: 'scatter', datasetId: 'd', xField: 'a', yField: 'b', width: 'half' },
    ] as never[]
    const widths = computeViewWidths(views)
    expect(widths.get('c1')).toBe('full')
    expect(widths.get('c2')).toBe('half')
    expect(widths.get('t')).toBe('full')
    expect(widths.get('c3')).toBe('half')
  })

  it('respects explicit widths including full charts between charts', () => {
    const views = [
      { id: 'c1', kind: 'line', datasetId: 'd', x: { field: 'x', type: 'category' }, y: ['y'], width: 'half' },
      { id: 'c2', kind: 'pie', datasetId: 'd', categoryField: 'a', valueField: 'b' },
    ] as never[]
    const widths = computeViewWidths(views)
    expect(widths.get('c1')).toBe('half')
    expect(widths.get('c2')).toBe('half') // explicit width consumed the first-chart default
  })

  it('formats metric values without inventing numbers', () => {
    expect(formatMetricValue(null, 'number', '—')).toBe('—')
    expect(formatMetricValue('12.5', 'percent', '—')).toBe('1250%')
    expect(formatMetricValue('1200', undefined, '—')).toBe('1,200')
    expect(formatMetricValue('abc', undefined, '—')).toBe('abc')
  })
})
