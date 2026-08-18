import { describe, expect, it } from 'vitest'
import {
  ANALYSIS_REPORT_VERSION,
  MAX_ANALYSIS_DATASETS,
  MAX_ANALYSIS_VIEWS,
  MAX_REPORT_BYTES,
  formatAnalysisSummary,
  isChartKind,
  parseAnalysisReport,
  parseAnalysisRequest,
  reportJsonBytes,
  rowsToArrays,
  validateViewSemantics,
  type AnalysisReportV1,
  type AnalysisRequestV1,
} from '../src/analysis.ts'

function baseRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: '月度经营分析',
    datasets: [{ id: 'ds1', sql: 'SELECT month, revenue, orders, region FROM t ORDER BY month' }],
    views: [{ id: 'v1', kind: 'line', datasetId: 'ds1', x: { field: 'month', type: 'time' }, y: ['revenue'] }],
    ...overrides,
  }
}

describe('parseAnalysisRequest', () => {
  it('accepts every one of the six view kinds', () => {
    const views = [
      { id: 'm', kind: 'metric', datasetId: 'ds1', field: 'revenue', label: '营收' },
      { id: 'l', kind: 'line', datasetId: 'ds1', x: { field: 'month', type: 'time' }, y: ['revenue'] },
      { id: 'b', kind: 'bar', datasetId: 'ds1', x: { field: 'region', type: 'category' }, y: ['orders'], seriesField: 'region2' },
      { id: 'p', kind: 'pie', datasetId: 'ds1', categoryField: 'region', valueField: 'orders' },
      { id: 's', kind: 'scatter', datasetId: 'ds1', xField: 'orders', yField: 'revenue' },
      { id: 't', kind: 'table', datasetId: 'ds1', columns: ['month', 'revenue'] },
    ]
    const request = parseAnalysisRequest(baseRequest({ views }))
    expect(request.views.map((view) => view.kind)).toEqual(['metric', 'line', 'bar', 'pie', 'scatter', 'table'])
    expect(request.title).toBe('月度经营分析')
  })

  it('parses optional summary, labels, width and format', () => {
    const request = parseAnalysisRequest(baseRequest({
      outputName: '月度经营分析-2026-08',
      summary: '结论：营收环比上升',
      views: [{
        id: 'v1', kind: 'metric', datasetId: 'ds1', field: 'revenue', label: '营收', format: 'percent',
      }, {
        id: 'v2', kind: 'line', datasetId: 'ds1', label: '趋势', width: 'half',
        x: { field: 'month', type: 'category', label: '月份' }, y: ['revenue'],
      }],
    }))
    expect(request.outputName).toBe('月度经营分析-2026-08')
    expect(request.summary).toBe('结论：营收环比上升')
    expect(request.views[0]).toMatchObject({ kind: 'metric', format: 'percent' })
    expect(request.views[1]).toMatchObject({ label: '趋势', width: 'half', x: { label: '月份' } })
  })

  it('rejects unknown top-level fields (additionalProperties=false)', () => {
    expect(() => parseAnalysisRequest(baseRequest({ evil: 'option' }))).toThrow(/不支持的字段 "evil"/)
    expect(() => parseAnalysisRequest(baseRequest({ outputName: '   ' }))).toThrow(/outputName: 必须是非空字符串/)
  })

  it('rejects unknown dataset and view fields', () => {
    expect(() => parseAnalysisRequest(baseRequest({
      datasets: [{ id: 'ds1', sql: 'SELECT 1', url: 'http://evil' }],
    }))).toThrow(/不支持的字段 "url"/)
    expect(() => parseAnalysisRequest(baseRequest({
      views: [{ id: 'v1', kind: 'line', datasetId: 'ds1', x: { field: 'm', type: 'time' }, y: ['r'], formatter: 'js' }],
    }))).toThrow(/不支持的字段 "formatter"/)
  })

  it('rejects duplicate dataset and view ids', () => {
    expect(() => parseAnalysisRequest(baseRequest({
      datasets: [
        { id: 'ds1', sql: 'SELECT 1' },
        { id: 'ds1', sql: 'SELECT 2' },
      ],
    }))).toThrow(/dataset id "ds1" 重复/)
    expect(() => parseAnalysisRequest(baseRequest({
      views: [
        { id: 'v1', kind: 'metric', datasetId: 'ds1', field: 'a', label: 'a' },
        { id: 'v1', kind: 'metric', datasetId: 'ds1', field: 'b', label: 'b' },
      ],
    }))).toThrow(/view id "v1" 重复/)
  })

  it('rejects views referencing a dataset outside the request', () => {
    expect(() => parseAnalysisRequest(baseRequest({
      views: [{ id: 'v1', kind: 'metric', datasetId: 'ghost', field: 'a', label: 'a' }],
    }))).toThrow(/引用了不存在的 dataset id "ghost"/)
  })

  it('rejects empty title and dataset count bounds', () => {
    expect(() => parseAnalysisRequest(baseRequest({ title: '  ' }))).toThrow(/title: 必须是非空字符串/)
    expect(() => parseAnalysisRequest(baseRequest({ datasets: [] }))).toThrow(/datasets 必须是 1-6 个/)
    const many = Array.from({ length: MAX_ANALYSIS_DATASETS + 1 }, (_, index) => ({ id: 'd' + index, sql: 'SELECT ' + index }))
    expect(() => parseAnalysisRequest(baseRequest({ datasets: many }))).toThrow(/datasets 必须是 1-6 个/)
  })

  it('rejects empty views and view count bounds', () => {
    expect(() => parseAnalysisRequest(baseRequest({ views: [] }))).toThrow(/views 必须是 1-8 个/)
    const many = Array.from({ length: MAX_ANALYSIS_VIEWS + 1 }, (_, index) => ({
      id: 'v' + index, kind: 'metric', datasetId: 'ds1', field: 'a', label: 'l' + index,
    }))
    expect(() => parseAnalysisRequest(baseRequest({ views: many }))).toThrow(/views 必须是 1-8 个/)
  })

  it('rejects seriesField combined with multiple y fields', () => {
    expect(() => parseAnalysisRequest(baseRequest({
      views: [{
        id: 'v1', kind: 'bar', datasetId: 'ds1',
        x: { field: 'month', type: 'category' }, y: ['revenue', 'orders'], seriesField: 'region',
      }],
    }))).toThrow(/views\[0\]: seriesField 与多个 y 字段互斥/)
  })

  it('rejects invalid kind, width, format and x type', () => {
    expect(() => parseAnalysisRequest(baseRequest({ views: [{ id: 'v1', kind: 'gauge', datasetId: 'ds1' }] })))
      .toThrow(/kind 必须是 metric\/line\/bar\/pie\/scatter\/table 之一/)
    expect(() => parseAnalysisRequest(baseRequest({
      views: [{ id: 'v1', kind: 'pie', datasetId: 'ds1', categoryField: 'a', valueField: 'b', width: 'third' }],
    }))).toThrow(/width: 必须是 full\/half 之一/)
    expect(() => parseAnalysisRequest(baseRequest({
      views: [{ id: 'v1', kind: 'metric', datasetId: 'ds1', field: 'a', label: 'a', format: 'money' }],
    }))).toThrow(/format: 必须是 number\/percent 之一/)
    expect(() => parseAnalysisRequest(baseRequest({
      views: [{ id: 'v1', kind: 'line', datasetId: 'ds1', x: { field: 'm', type: 'log' }, y: ['r'] }],
    }))).toThrow(/x\.type: 必须是 category\/time 之一/)
  })

  it('rejects metric width and missing required fields', () => {
    expect(() => parseAnalysisRequest(baseRequest({
      views: [{ id: 'v1', kind: 'metric', datasetId: 'ds1', field: 'a', label: 'a', width: 'half' }],
    }))).toThrow(/不支持的字段 "width"/)
    expect(() => parseAnalysisRequest(baseRequest({
      views: [{ id: 'v1', kind: 'metric', datasetId: 'ds1', label: 'a' }],
    }))).toThrow(/field: 必须是非空字符串/)
    expect(() => parseAnalysisRequest(baseRequest({
      views: [{ id: 'v1', kind: 'pie', datasetId: 'ds1', valueField: 'b' }],
    }))).toThrow(/categoryField: 必须是非空字符串/)
  })
})

describe('parseAnalysisReport / rowsToArrays / size bound', () => {
  function buildReport(): AnalysisReportV1 {
    const request = parseAnalysisRequest(baseRequest({
      datasets: [
        { id: 'ds1', sql: 'SELECT month, revenue, orders FROM t ORDER BY month' },
        { id: 'ds2', sql: 'SELECT region, total FROM t2' },
      ],
      views: [
        { id: 'v1', kind: 'metric', datasetId: 'ds1', field: 'revenue', label: '营收' },
        { id: 'v2', kind: 'pie', datasetId: 'ds2', categoryField: 'region', valueField: 'total' },
      ],
    }))
    const data1 = { columns: ['month', 'revenue', 'orders'], rows: [{ month: '1月', revenue: '10', orders: '2' }] }
    const data2 = { columns: ['region', 'total'], rows: [{ region: '东', total: '5' }, { region: '西', total: null }] }
    const datasets = new Map([['ds1', data1], ['ds2', data2]])
    validateViewSemantics(request.views, datasets)
    return {
      version: ANALYSIS_REPORT_VERSION,
      title: request.title,
      datasets: [
        { id: 'ds1', columns: data1.columns, rows: rowsToArrays(data1.columns, data1.rows) },
        { id: 'ds2', columns: data2.columns, rows: rowsToArrays(data2.columns, data2.rows) },
      ],
      views: request.views,
    }
  }

  it('round-trips a normalized report through the strict parser', () => {
    const report = buildReport()
    const parsed = parseAnalysisReport(report)
    expect(parsed.datasets[0]!.rows).toEqual([['1月', '10', '2']])
    // SQL column/row order preserved; null stays null (never zero).
    expect(parsed.datasets[1]!.rows).toEqual([['东', '5'], ['西', null]])
    expect(parsed.views.map((view) => view.id)).toEqual(['v1', 'v2'])
  })

  it('accepts new htmlPath meta while keeping legacy version 1 reports valid', () => {
    const legacy = buildReport()
    expect(parseAnalysisReport(legacy).htmlPath).toBeUndefined()
    const current = { ...legacy, htmlPath: '/workspace/analysis-reports/report.html' }
    expect(parseAnalysisReport(current).htmlPath).toBe('/workspace/analysis-reports/report.html')
    expect(reportJsonBytes(current)).toBe(reportJsonBytes(legacy))
  })

  it('rejects reports with misaligned rows or wrong cells', () => {
    const report = buildReport() as unknown as Record<string, unknown>
    const datasets = report.datasets as Record<string, unknown>[]
    datasets[0]!.rows = [['only-one-cell']]
    expect(() => parseAnalysisReport(report)).toThrow(/必须与 columns 对齐/)
    datasets[0]!.rows = [[1, 2, 3]]
    expect(() => parseAnalysisReport(report)).toThrow(/只含 string\/null/)
  })

  it('rejects unknown report versions', () => {
    const report = buildReport() as unknown as Record<string, unknown>
    report.version = 2
    expect(() => parseAnalysisReport(report)).toThrow(/不支持的报告版本/)
  })

  it('measures the JSON size and rejects reports over 512 KiB without deletion', () => {
    const small = buildReport()
    expect(reportJsonBytes(small)).toBeLessThan(MAX_REPORT_BYTES)
    const big = buildReport()
    const filler = 'x'.repeat(600 * 1024)
    big.datasets[0]!.rows = [[filler, '10', '2']]
    expect(reportJsonBytes(big)).toBeGreaterThan(MAX_REPORT_BYTES)
    // The bytes helper never truncates: the full content is measured.
    expect(big.datasets[0]!.rows[0]![0]!.length).toBe(600 * 1024)
  })

  it('summarizes counts, version and empty datasets without re-injecting rows', () => {
    const report = { ...buildReport(), htmlPath: '/workspace/analysis-reports/report.html' }
    const text = formatAnalysisSummary(report)
    expect(text).toContain('月度经营分析')
    expect(text).toContain('2 个数据集、2 个视图')
    expect(text).toContain('version 1')
    expect(text).not.toContain('1月')
    expect(text).toContain(report.htmlPath)
    const empty = { ...report, datasets: report.datasets.map((d) => ({ ...d, rows: [] })) }
    const emptyText = formatAnalysisSummary(empty)
    expect(emptyText).toContain('无数据')
    expect(emptyText).toContain('ds1、ds2')
  })
})

describe('validateViewSemantics', () => {
  const data = {
    columns: ['month', 'revenue', 'region', 'ratio'],
    rows: [
      { month: '2026-01', revenue: '10.5', region: '东', ratio: '0.25' },
      { month: '2026-02', revenue: null, region: '西', ratio: '-0.1' },
    ],
  }
  const datasets = new Map([['ds1', data]])

  it('accepts valid views including null gaps and empty datasets', () => {
    const request = parseAnalysisRequest(baseRequest({
      views: [
        { id: 'v1', kind: 'metric', datasetId: 'ds1', field: 'revenue', label: '营收' },
        { id: 'v2', kind: 'line', datasetId: 'ds1', x: { field: 'month', type: 'time' }, y: ['revenue'] },
      ],
    }))
    expect(() => validateViewSemantics(request.views, datasets)).not.toThrow()
    const empty = { columns: ['month'], rows: [] }
    const emptyRequest = parseAnalysisRequest(baseRequest({
      datasets: [{ id: 'ds1', sql: 'SELECT 1' }],
      views: [{ id: 'v1', kind: 'table', datasetId: 'ds1' }],
    }))
    expect(() => validateViewSemantics(emptyRequest.views, new Map([['ds1', empty]]))).not.toThrow()
  })

  it('rejects missing columns naming the view, dataset and field', () => {
    const request = parseAnalysisRequest(baseRequest({
      views: [{ id: 'v1', kind: 'metric', datasetId: 'ds1', field: 'ghost', label: 'x' }],
    }))
    expect(() => validateViewSemantics(request.views, datasets)).toThrow(/view "v1".*dataset "ds1".*字段 "ghost"/)
  })

  it('rejects non-finite numerics instead of treating them as zero', () => {
    const request = parseAnalysisRequest(baseRequest({
      views: [{ id: 'v1', kind: 'metric', datasetId: 'ds1', field: 'revenue', label: 'x' }],
    }))
    const bad = { columns: data.columns, rows: [{ month: 'm', revenue: 'abc', region: '东', ratio: '0' }] }
    expect(() => validateViewSemantics(request.views, new Map([['ds1', bad]]))).toThrow(/含有非数值 "abc"/)
  })

  it('rejects negative pie values', () => {
    const request = parseAnalysisRequest(baseRequest({
      views: [{ id: 'v1', kind: 'pie', datasetId: 'ds1', categoryField: 'region', valueField: 'ratio' }],
    }))
    expect(() => validateViewSemantics(request.views, datasets)).toThrow(/含负数 "-0\.1"（饼图值必须非负）/)
  })

  it('rejects unparseable time values for time axes', () => {
    const request = parseAnalysisRequest(baseRequest({
      views: [{ id: 'v1', kind: 'line', datasetId: 'ds1', x: { field: 'month', type: 'time' }, y: ['revenue'] }],
    }))
    const bad = { columns: data.columns, rows: [{ month: 'not-a-date', revenue: '1', region: '东', ratio: '0' }] }
    expect(() => validateViewSemantics(request.views, new Map([['ds1', bad]]))).toThrow(/不可解析的时间值 "not-a-date"/)
  })

  it('validates table whitelist columns exist', () => {
    const request = parseAnalysisRequest(baseRequest({
      views: [{ id: 'v1', kind: 'table', datasetId: 'ds1', columns: ['month', 'ghost'] }],
    }))
    expect(() => validateViewSemantics(request.views, datasets)).toThrow(/不存在的字段 "ghost"/)
  })
})

describe('view kind helpers', () => {
  it('classifies chart kinds', () => {
    expect(isChartKind('line')).toBe(true)
    expect(isChartKind('bar')).toBe(true)
    expect(isChartKind('pie')).toBe(true)
    expect(isChartKind('scatter')).toBe(true)
    expect(isChartKind('metric')).toBe(false)
    expect(isChartKind('table')).toBe(false)
  })
})
