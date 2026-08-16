import { describe, expect, it } from 'vitest'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { contentText, decodeAnalysisBlock, isSimpleChartReport, reportCounts } from '../src/client/analysis-view-model.ts'

function runningBlock(): ToolCallBlock {
  return {
    callId: 'call-1',
    name: 'render-analysis',
    argsRaw: '{}',
    turn: 1,
    step: 1,
    time: 0,
    callView: null,
    subCalls: [],
  }
}

function settledBlock(overrides: Record<string, unknown> = {}): ToolCallBlock {
  return {
    kind: 'tool-result',
    seq: 2,
    time: 1,
    callId: 'call-1',
    call: { name: 'render-analysis', argsRaw: '{}' },
    callTime: 0,
    content: [{ type: 'text', text: '已生成分析报告《测试》' }],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    ...overrides,
  } as unknown as ToolCallBlock
}

const REPORT = {
  version: 1,
  title: '测试报告',
  datasets: [{ id: 'd1', columns: ['x', 'y'], rows: [['a', '1']] }],
  views: [{ id: 'v1', kind: 'line', datasetId: 'd1', x: { field: 'x', type: 'category' }, y: ['y'] }],
}

describe('decodeAnalysisBlock', () => {
  it('reports running while the result has not settled', () => {
    expect(decodeAnalysisBlock(runningBlock())).toEqual({ state: 'running' })
  })

  it('distinguishes error from interrupted outcomes', () => {
    expect(decodeAnalysisBlock(settledBlock({ isError: true, content: [{ type: 'text', text: 'boom' }] })).state).toBe('error')
    const interrupted = decodeAnalysisBlock(settledBlock({ isError: true, error: { name: 'AbortError', code: 'interrupted' }, content: [{ type: 'text', text: '已中止' }] }))
    expect(interrupted).toMatchObject({ state: 'interrupted', errorText: '已中止' })
  })

  it('decodes a valid version-1 meta into a report', () => {
    const model = decodeAnalysisBlock(settledBlock({ meta: REPORT }))
    expect(model.state).toBe('report')
    expect(model.report?.title).toBe('测试报告')
    expect(reportCounts(model.report!)).toEqual({ datasets: 1, views: 1 })
  })

  it('decodes a string-encoded JSON meta (session round-trip)', () => {
    const model = decodeAnalysisBlock(settledBlock({ meta: JSON.stringify(REPORT) }))
    expect(model.state).toBe('report')
    expect(model.report?.views[0]?.kind).toBe('line')
  })

  it('falls back safely on missing meta', () => {
    const model = decodeAnalysisBlock(settledBlock({}))
    expect(model.state).toBe('fallback')
    expect(model.fallbackText).toContain('已生成分析报告')
  })

  it('falls back on malformed meta without guessing', () => {
    expect(decodeAnalysisBlock(settledBlock({ meta: { version: 1, title: 'x' } })).state).toBe('fallback')
    expect(decodeAnalysisBlock(settledBlock({ meta: { version: 1, title: 'x', datasets: 'bad' } })).state).toBe('fallback')
    expect(decodeAnalysisBlock(settledBlock({ meta: 42 })).state).toBe('fallback')
  })

  it('falls back on unknown versions instead of rendering v1', () => {
    expect(decodeAnalysisBlock(settledBlock({ meta: { ...REPORT, version: 2 } })).state).toBe('fallback')
  })

  it('never throws on hostile meta shapes', () => {
    expect(() => decodeAnalysisBlock(settledBlock({ meta: { get version() { throw new Error('evil') } } }))).not.toThrow()
    expect(() => decodeAnalysisBlock(settledBlock({ meta: '{not json' }))).not.toThrow()
  })
})

describe('contentText / isSimpleChartReport', () => {
  it('joins text blocks and skips non-text blocks', () => {
    expect(contentText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toBe('a\nb')
  })

  it('only treats a single chart view as the inline-preview case', () => {
    const report = REPORT as never
    expect(isSimpleChartReport({ ...report, views: [REPORT.views[0]] })).toBe(true)
    expect(isSimpleChartReport({ ...report, views: [REPORT.views[0], REPORT.views[0]] })).toBe(false)
    expect(isSimpleChartReport({ ...report, views: [{ ...REPORT.views[0], kind: 'metric' }] })).toBe(false)
    expect(isSimpleChartReport({ ...report, views: [{ ...REPORT.views[0], kind: 'table' }] })).toBe(false)
  })
})
