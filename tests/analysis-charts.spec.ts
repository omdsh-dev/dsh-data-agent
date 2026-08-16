import { describe, expect, it } from 'vitest'
import { parseAnalysisReport, type AnalysisDatasetResultV1, type AnalysisViewV1 } from '../src/analysis.ts'
import {
  ANALYSIS_PALETTE,
  chartOptionFor,
  chartTextSummary,
  readChartThemeTokens,
  seriesColor,
} from '../src/client/analysis-charts.ts'

function dataset(rows: (string | null)[][]): AnalysisDatasetResultV1 {
  return { id: 'd1', columns: ['month', 'revenue', 'orders', 'region'], rows }
}

const FALLBACK = readChartThemeTokens()

function optionFor(view: unknown, data: AnalysisDatasetResultV1 = dataset([['1月', '10', '2', '东'], ['2月', '20', '3', '西']])) {
  return chartOptionFor(view as AnalysisViewV1, data, FALLBACK, '测试图表') as Record<string, unknown>
}

function parseView(view: unknown): AnalysisViewV1 {
  return parseAnalysisRequestLike(view)
}

function parseAnalysisRequestLike(view: unknown): AnalysisViewV1 {
  const report = {
    version: 1,
    title: 't',
    datasets: [{ id: 'd1', columns: ['month', 'revenue', 'orders', 'region'], rows: [['1月', '10', '2', '东'], ['2月', '20', '3', '西']] }],
    views: [view],
  }
  return parseAnalysisReport(report).views[0]!
}

describe('chartOptionFor mapping (safe, order-preserving)', () => {
  it('builds multi-y line series preserving row order', () => {
    const view = parseView({ id: 'v1', kind: 'line', datasetId: 'd1', x: { field: 'month', type: 'category' }, y: ['revenue', 'orders'] })
    const option = optionFor(view)
    const series = option.series as { name: string; type: string; data: (string | number | null)[][] }[]
    expect(series.map((item) => item.name)).toEqual(['revenue', 'orders'])
    expect(series[0]!.data).toEqual([['1月', 10], ['2月', 20]])
    expect(series[1]!.data).toEqual([['1月', 2], ['2月', 3]])
    const tooltip = option.tooltip as Record<string, unknown>
    expect(tooltip.renderMode).toBe('richText')
  })

  it('groups seriesField rows into stable series in first-appearance order', () => {
    const view = parseView({ id: 'v1', kind: 'bar', datasetId: 'd1', x: { field: 'month', type: 'category' }, y: ['revenue'], seriesField: 'region' })
    const option = optionFor(view)
    const series = option.series as { name: string; data: (string | number | null)[][] }[]
    expect(series.map((item) => item.name)).toEqual(['东', '西'])
    expect(series[0]!.data).toEqual([['1月', 10]])
    expect(series[1]!.data).toEqual([['2月', 20]])
  })

  it('converts time axes to timestamps and keeps null gaps as null', () => {
    const view = parseView({ id: 'v1', kind: 'line', datasetId: 'd1', x: { field: 'month', type: 'time' }, y: ['revenue'] })
    const data = dataset([['2026-01-01', '10', '2', '东'], ['2026-02-01', null, '3', '西']])
    const option = optionFor(view, data)
    const series = option.series as { data: (string | number | null)[][] }[]
    expect(series[0]!.data[0]![0]).toBe(Date.parse('2026-01-01'))
    expect(series[0]!.data[1]![1]).toBeNull() // null gap, never zero
  })

  it('maps pie values as text-safe items with stable per-name colors', () => {
    const view = parseView({ id: 'v1', kind: 'pie', datasetId: 'd1', categoryField: 'region', valueField: 'revenue' })
    const option = optionFor(view)
    const series = option.series as { type: string; data: { name: string; value: number | null; itemStyle: { color: string } }[] }[]
    expect(series[0]!.type).toBe('pie')
    expect(series[0]!.data.map((item) => item.name)).toEqual(['东', '西'])
    expect(series[0]!.data[0]!.itemStyle.color).toBe(seriesColor('东'))
    expect(series[0]!.data[0]!.itemStyle.color).toBe(seriesColor('东'))
  })

  it('maps scatter pairs with numeric conversion', () => {
    const view = parseView({ id: 'v1', kind: 'scatter', datasetId: 'd1', xField: 'revenue', yField: 'orders' })
    const option = optionFor(view)
    const series = option.series as { type: string; data: (number | null)[][] }[]
    expect(series[0]!.type).toBe('scatter')
    expect(series[0]!.data).toEqual([[10, 2], [20, 3]])
  })

  it('returns an empty option for metric/table (never reaches the chart)', () => {
    const metric = parseView({ id: 'v1', kind: 'metric', datasetId: 'd1', field: 'revenue', label: 'r' })
    const table = parseView({ id: 'v1', kind: 'table', datasetId: 'd1' })
    expect(optionFor(metric)).toEqual({})
    expect(optionFor(table)).toEqual({})
  })

  it('keeps same-series colors stable across different views', () => {
    expect(seriesColor('revenue')).toBe(seriesColor('revenue'))
    expect(ANALYSIS_PALETTE).toContain(seriesColor('revenue'))
  })

  it('produces a plain-text chart summary', () => {
    const view = parseView({ id: 'v1', kind: 'bar', datasetId: 'd1', x: { field: 'month', type: 'category' }, y: ['revenue'] })
    const summary = chartTextSummary(view, dataset([['1月', '10', '2', '东']]), '柱状图')
    expect(summary).toContain('柱状图')
    expect(summary).toContain('month 为 x 轴')
    expect(summary).toContain('1 行')
  })
})
