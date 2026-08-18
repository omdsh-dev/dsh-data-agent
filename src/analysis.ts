/**
 * Shared version-1 analysis report contract, used by BOTH package halves:
 * the Node tool half (render-analysis) validates and builds reports with it,
 * and the Web client decodes persisted tool/result.meta with it. The module
 * is pure TypeScript (no node: imports, no DOM) so it bundles into the client
 * unchanged.
 *
 * The strict parser rejects unknown properties, duplicate ids, dangling
 * dataset references, count violations and every disallowed view shape, so a
 * model can never smuggle arbitrary chart-library options, HTML, CSS or URLs
 * through the wire contract.
 * @module @yejiming/dsh-data-agent/analysis
 */

import type { ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

/** Wire version stamped onto every request/report. */
export const ANALYSIS_REPORT_VERSION = 1 as const

/** Dataset count bounds for one report (D1). */
export const MAX_ANALYSIS_DATASETS = 6
export const MIN_ANALYSIS_DATASETS = 1

/** View count bounds for one report (D1). */
export const MAX_ANALYSIS_VIEWS = 8
export const MIN_ANALYSIS_VIEWS = 1

/** Series bounds for one line/bar view (D2). */
export const MIN_ANALYSIS_SERIES = 1
export const MAX_ANALYSIS_SERIES = 4

/** Total JSON-encoded report size bound (D4): 512 KiB. */
export const MAX_REPORT_BYTES = 512 * 1024

/** The six discriminated view kinds. */
export type AnalysisViewKind = 'metric' | 'line' | 'bar' | 'pie' | 'scatter' | 'table'

/** Grid width of one non-metric view. */
export type AnalysisViewWidth = 'full' | 'half'

/** line/bar x axis semantics. */
export type AnalysisAxisType = 'category' | 'time'

/** Supported metric number format. */
export type AnalysisMetricFormat = 'number' | 'percent'

/** Fields shared by every view. */
interface AnalysisViewBaseV1 {
  id: string
  kind: AnalysisViewKind
  datasetId: string
  label?: string
}

/** Fields shared by the non-metric views. */
interface AnalysisGridBaseV1 extends AnalysisViewBaseV1 {
  width?: AnalysisViewWidth
}

/** One metric view: a single finite number with a label. */
export interface AnalysisMetricViewV1 extends AnalysisViewBaseV1 {
  kind: 'metric'
  field: string
  label: string
  format?: AnalysisMetricFormat
}

/** One line/bar view over a shared x axis and 1-4 y fields (or one seriesField). */
export interface AnalysisLineBarViewV1 extends AnalysisGridBaseV1 {
  kind: 'line' | 'bar'
  x: { field: string; type: AnalysisAxisType; label?: string }
  y: string[]
  seriesField?: string
}

/** One pie view (category + non-negative value). */
export interface AnalysisPieViewV1 extends AnalysisGridBaseV1 {
  kind: 'pie'
  categoryField: string
  valueField: string
}

/** One scatter view (x/y numeric pairs). */
export interface AnalysisScatterViewV1 extends AnalysisGridBaseV1 {
  kind: 'scatter'
  xField: string
  yField: string
}

/** One semantic table view with an optional column whitelist. */
export interface AnalysisTableViewV1 extends AnalysisGridBaseV1 {
  kind: 'table'
  columns?: string[]
}

export type AnalysisViewV1 =
  | AnalysisMetricViewV1
  | AnalysisLineBarViewV1
  | AnalysisPieViewV1
  | AnalysisScatterViewV1
  | AnalysisTableViewV1

/** One request dataset: a unique id plus one read-only SQL statement. */
export interface AnalysisDatasetRequestV1 {
  id: string
  sql: string
}

/** The wire request accepted by the render-analysis tool. */
export interface AnalysisRequestV1 {
  title: string
  /** Semantic output basename; directory is always analysis-reports/. */
  outputName?: string
  summary?: string
  datasets: AnalysisDatasetRequestV1[]
  views: AnalysisViewV1[]
}

/** One normalized dataset inside a report: aligned two-dimensional rows. */
export interface AnalysisDatasetResultV1 {
  id: string
  columns: string[]
  rows: (string | null)[][]
}

/** The canonical version-1 report persisted into presentationMeta. */
export interface AnalysisReportV1 {
  version: typeof ANALYSIS_REPORT_VERSION
  title: string
  summary?: string
  /** Absolute path of the generated HTML artifact (absent on legacy v1 meta). */
  htmlPath?: string
  datasets: AnalysisDatasetResultV1[]
  views: AnalysisViewV1[]
}

/** Dataset rows in object form (the sql-query canonical shape). */
export interface DatasetRows {
  columns: string[]
  rows: Record<string, string | null>[]
}

const VIEW_KINDS: readonly AnalysisViewKind[] = ['metric', 'line', 'bar', 'pie', 'scatter', 'table']
const CHART_KINDS: readonly string[] = ['line', 'bar', 'pie', 'scatter']
const AXIS_TYPES: readonly AnalysisAxisType[] = ['category', 'time']
const WIDTHS: readonly AnalysisViewWidth[] = ['full', 'half']
const METRIC_FORMATS: readonly AnalysisMetricFormat[] = ['number', 'percent']

/** Whether a view kind is one of the four chart kinds. */
export function isChartKind(kind: AnalysisViewKind): boolean {
  return CHART_KINDS.includes(kind)
}

function fail(message: string): never {
  throw new Error(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reject keys outside the allowed set (additionalProperties=false semantics). */
function assertOnlyKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) fail(label + ': 不支持的字段 "' + key + '"')
  }
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(label + ': 必须是非空字符串')
  return value
}

function optionalString(record: Record<string, unknown>, key: string, label: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') fail(label + '.' + key + ': 必须是字符串')
  return value
}

function optionalEnum<T extends string>(record: Record<string, unknown>, key: string, allowed: readonly T[], label: string): T | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(label + '.' + key + ': 必须是 ' + allowed.join('/') + ' 之一')
  }
  return value as T
}

/** Read a required non-empty string field with a concrete error path. */
function requiredStringField(record: Record<string, unknown>, key: string, label: string): string {
  return requireNonEmptyString(record[key], label + '.' + key)
}

/** Read an optional array of unique non-empty strings (the table whitelist). */
function optionalStringArray(record: Record<string, unknown>, key: string, label: string): string[] | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    fail(label + '.' + key + ': 必须是非空字符串数组')
  }
  const items = value.map((item) => item as string)
  if (new Set(items).size !== items.length) fail(label + '.' + key + ': 列名不能重复')
  return items
}

function parseXAxis(value: unknown, label: string): { field: string; type: AnalysisAxisType; label?: string } {
  if (!isRecord(value)) fail(label + '.x: 必须是对象 { field, type, label? }')
  assertOnlyKeys(value, ['field', 'type', 'label'], label + '.x')
  const field = requiredStringField(value, 'field', label + '.x')
  const type = optionalEnum(value, 'type', AXIS_TYPES, label + '.x')
  if (type === undefined) fail(label + '.x.type: 必须是 category/time 之一')
  const axisLabel = optionalString(value, 'label', label + '.x')
  const axis: { field: string; type: AnalysisAxisType; label?: string } = { field, type }
  if (axisLabel !== undefined) axis.label = axisLabel
  return axis
}

function parseView(value: unknown, label: string, datasetIds: ReadonlySet<string>): AnalysisViewV1 {
  if (!isRecord(value)) fail(label + ': 必须是对象')
  const kind = value['kind']
  if (typeof kind !== 'string' || !(VIEW_KINDS as readonly string[]).includes(kind)) {
    fail(label + ': kind 必须是 metric/line/bar/pie/scatter/table 之一')
  }
  const viewKind = kind as AnalysisViewKind
  const id = requiredStringField(value, 'id', label)
  const datasetId = requiredStringField(value, 'datasetId', label)
  if (!datasetIds.has(datasetId)) {
    fail(label + ': 引用了不存在的 dataset id "' + datasetId + '"')
  }
  if (viewKind === 'metric') {
    assertOnlyKeys(value, ['id', 'kind', 'datasetId', 'field', 'label', 'format'], label)
    const metric: AnalysisMetricViewV1 = {
      id,
      kind: 'metric',
      datasetId,
      field: requiredStringField(value, 'field', label),
      label: requiredStringField(value, 'label', label),
    }
    const format = optionalEnum(value, 'format', METRIC_FORMATS, label)
    if (format !== undefined) metric.format = format
    return metric
  }
  const width = optionalEnum(value, 'width', WIDTHS, label)
  const viewLabel = optionalString(value, 'label', label)
  switch (viewKind) {
    case 'line':
    case 'bar': {
      assertOnlyKeys(value, ['id', 'kind', 'datasetId', 'label', 'width', 'x', 'y', 'seriesField'], label)
      const x = parseXAxis(value['x'], label)
      const y = value['y']
      if (!Array.isArray(y) || y.length < MIN_ANALYSIS_SERIES || y.length > MAX_ANALYSIS_SERIES
        || y.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
        fail(label + '.y: 必须是 ' + MIN_ANALYSIS_SERIES + '-' + MAX_ANALYSIS_SERIES + ' 个非空字段名')
      }
      const seriesField = optionalString(value, 'seriesField', label)
      if (seriesField !== undefined && y.length >= 2) {
        fail(label + ': seriesField 与多个 y 字段互斥，只能二选一')
      }
      const view: AnalysisLineBarViewV1 = {
        id,
        kind: viewKind,
        datasetId,
        x,
        y: (y as string[]).map((item) => item),
      }
      if (viewLabel !== undefined) view.label = viewLabel
      if (width !== undefined) view.width = width
      if (seriesField !== undefined) view.seriesField = seriesField
      return view
    }
    case 'pie': {
      assertOnlyKeys(value, ['id', 'kind', 'datasetId', 'label', 'width', 'categoryField', 'valueField'], label)
      const view: AnalysisPieViewV1 = {
        id,
        kind: 'pie',
        datasetId,
        categoryField: requiredStringField(value, 'categoryField', label),
        valueField: requiredStringField(value, 'valueField', label),
      }
      if (viewLabel !== undefined) view.label = viewLabel
      if (width !== undefined) view.width = width
      return view
    }
    case 'scatter': {
      assertOnlyKeys(value, ['id', 'kind', 'datasetId', 'label', 'width', 'xField', 'yField'], label)
      const view: AnalysisScatterViewV1 = {
        id,
        kind: 'scatter',
        datasetId,
        xField: requiredStringField(value, 'xField', label),
        yField: requiredStringField(value, 'yField', label),
      }
      if (viewLabel !== undefined) view.label = viewLabel
      if (width !== undefined) view.width = width
      return view
    }
    case 'table': {
      assertOnlyKeys(value, ['id', 'kind', 'datasetId', 'label', 'width', 'columns'], label)
      const view: AnalysisTableViewV1 = {
        id,
        kind: 'table',
        datasetId,
      }
      const columns = optionalStringArray(value, 'columns', label)
      if (viewLabel !== undefined) view.label = viewLabel
      if (width !== undefined) view.width = width
      if (columns !== undefined) view.columns = columns
      return view
    }
  }
}

/**
 * Strictly parse a model-supplied analysis request. Every structural
 * violation (unknown fields, duplicate ids, dangling references, count or
 * union constraints) throws with a message naming the offending view/dataset.
 */
export function parseAnalysisRequest(input: unknown, prefix = 'render-analysis'): AnalysisRequestV1 {
  if (!isRecord(input)) fail(prefix + ': 请求必须是对象')
  assertOnlyKeys(input, ['title', 'outputName', 'summary', 'datasets', 'views'], prefix)
  const title = requireNonEmptyString(input['title'], prefix + '.title')
  const outputName = optionalString(input, 'outputName', prefix)
  if (outputName !== undefined && outputName.trim().length === 0) fail(prefix + '.outputName: 必须是非空字符串')
  const summary = optionalString(input, 'summary', prefix)
  const datasets = input['datasets']
  if (!Array.isArray(datasets) || datasets.length < MIN_ANALYSIS_DATASETS || datasets.length > MAX_ANALYSIS_DATASETS) {
    fail(prefix + ': datasets 必须是 ' + MIN_ANALYSIS_DATASETS + '-' + MAX_ANALYSIS_DATASETS + ' 个')
  }
  const parsedDatasets: AnalysisDatasetRequestV1[] = []
  const datasetIds = new Set<string>()
  for (let index = 0; index < datasets.length; index += 1) {
    const label = prefix + '.datasets[' + index + ']'
    const item = datasets[index]
    if (!isRecord(item)) fail(label + ': 必须是对象')
    assertOnlyKeys(item, ['id', 'sql'], label)
    const id = requiredStringField(item, 'id', label)
    if (datasetIds.has(id)) fail(label + ': dataset id "' + id + '" 重复')
    datasetIds.add(id)
    parsedDatasets.push({ id, sql: requiredStringField(item, 'sql', label) })
  }
  const views = input['views']
  if (!Array.isArray(views) || views.length < MIN_ANALYSIS_VIEWS || views.length > MAX_ANALYSIS_VIEWS) {
    fail(prefix + ': views 必须是 ' + MIN_ANALYSIS_VIEWS + '-' + MAX_ANALYSIS_VIEWS + ' 个')
  }
  const parsedViews: AnalysisViewV1[] = []
  const viewIds = new Set<string>()
  for (let index = 0; index < views.length; index += 1) {
    const label = prefix + '.views[' + index + ']'
    const view = parseView(views[index], label, datasetIds)
    if (viewIds.has(view.id)) fail(label + ': view id "' + view.id + '" 重复')
    viewIds.add(view.id)
    parsedViews.push(view)
  }
  const request: AnalysisRequestV1 = { title, datasets: parsedDatasets, views: parsedViews }
  if (outputName !== undefined) request.outputName = outputName
  if (summary !== undefined) request.summary = summary
  return request
}

/** Strictly parse a persisted report meta; throws on any shape violation. */
export function parseAnalysisReport(input: unknown, prefix = 'analysis'): AnalysisReportV1 {
  if (!isRecord(input)) fail(prefix + ': 报告必须是对象')
  assertOnlyKeys(input, ['version', 'title', 'summary', 'htmlPath', 'datasets', 'views'], prefix)
  if (input['version'] !== ANALYSIS_REPORT_VERSION) {
    fail(prefix + ': 不支持的报告版本（期望 version ' + ANALYSIS_REPORT_VERSION + '）')
  }
  const title = requireNonEmptyString(input['title'], prefix + '.title')
  const summary = optionalString(input, 'summary', prefix)
  const htmlPath = optionalString(input, 'htmlPath', prefix)
  const datasets = input['datasets']
  if (!Array.isArray(datasets) || datasets.length < MIN_ANALYSIS_DATASETS || datasets.length > MAX_ANALYSIS_DATASETS) {
    fail(prefix + ': datasets 必须是 ' + MIN_ANALYSIS_DATASETS + '-' + MAX_ANALYSIS_DATASETS + ' 个')
  }
  const parsedDatasets: AnalysisDatasetResultV1[] = []
  const datasetIds = new Set<string>()
  for (let index = 0; index < datasets.length; index += 1) {
    const label = prefix + '.datasets[' + index + ']'
    const item = datasets[index]
    if (!isRecord(item)) fail(label + ': 必须是对象')
    assertOnlyKeys(item, ['id', 'columns', 'rows'], label)
    const id = requiredStringField(item, 'id', label)
    if (datasetIds.has(id)) fail(label + ': dataset id "' + id + '" 重复')
    const columns = item['columns']
    if (!Array.isArray(columns) || columns.some((column) => typeof column !== 'string' || column.trim().length === 0)) {
      fail(label + '.columns: 必须是非空字符串数组')
    }
    const columnList = columns.map((column) => column as string)
    if (new Set(columnList).size !== columnList.length) fail(label + '.columns: 列名不能重复')
    const rows = item['rows']
    if (!Array.isArray(rows)) fail(label + '.rows: 必须是数组')
    const rowList: (string | null)[][] = []
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex]
      if (!Array.isArray(row) || row.length !== columnList.length
        || row.some((cell) => cell !== null && typeof cell !== 'string')) {
        fail(label + '.rows[' + rowIndex + ']: 必须与 columns 对齐且只含 string/null')
      }
      rowList.push(row.map((cell) => cell as string | null))
    }
    datasetIds.add(id)
    parsedDatasets.push({ id, columns: columnList, rows: rowList })
  }
  const views = input['views']
  if (!Array.isArray(views) || views.length < MIN_ANALYSIS_VIEWS || views.length > MAX_ANALYSIS_VIEWS) {
    fail(prefix + ': views 必须是 ' + MIN_ANALYSIS_VIEWS + '-' + MAX_ANALYSIS_VIEWS + ' 个')
  }
  const parsedViews: AnalysisViewV1[] = []
  const viewIds = new Set<string>()
  for (let index = 0; index < views.length; index += 1) {
    const label = prefix + '.views[' + index + ']'
    const view = parseView(views[index], label, datasetIds)
    if (viewIds.has(view.id)) fail(label + ': view id "' + view.id + '" 重复')
    viewIds.add(view.id)
    parsedViews.push(view)
  }
  const report: AnalysisReportV1 = { version: ANALYSIS_REPORT_VERSION, title, datasets: parsedDatasets, views: parsedViews }
  if (summary !== undefined) report.summary = summary
  if (htmlPath !== undefined) report.htmlPath = htmlPath
  return report
}

/** Whether one string parses to a finite number. */
export function isFiniteNumberText(value: string): boolean {
  return value.trim() !== '' && Number.isFinite(Number(value))
}

/** Whether one string parses as a time value. */
export function isParseableTimeText(value: string): boolean {
  return value.trim() !== '' && !Number.isNaN(Date.parse(value))
}

/**
 * Validate view→dataset semantics AFTER all queries succeeded and BEFORE any
 * meta is built: field existence, finite numerics, pie non-negativity, time
 * parseability, and table whitelist existence. The client is never asked to
 * aggregate, sort, or treat null as zero — validation happens here.
 */
export function validateViewSemantics(
  views: readonly AnalysisViewV1[],
  datasets: ReadonlyMap<string, DatasetRows>,
  prefix = 'render-analysis',
): void {
  for (const view of views) {
    const dataset = datasets.get(view.datasetId)
    if (dataset === undefined) fail(prefix + ': view "' + view.id + '" 引用了未知 dataset "' + view.datasetId + '"')
    const columns = new Set(dataset.columns)
    const requireColumn = (field: string): void => {
      if (!columns.has(field)) {
        fail(prefix + ': view "' + view.id + '" 引用了 dataset "' + view.datasetId + '" 中不存在的字段 "' + field + '"')
      }
    }
    const requireNumeric = (field: string): void => {
      requireColumn(field)
      for (const row of dataset.rows) {
        const value = row[field] ?? null
        if (value !== null && !isFiniteNumberText(value)) {
          fail(prefix + ': view "' + view.id + '" 的字段 "' + field + '" 含有非数值 "' + value + '"（不能转换为有限数）')
        }
      }
    }
    switch (view.kind) {
      case 'metric':
        requireNumeric(view.field)
        break
      case 'line':
      case 'bar': {
        if (view.x.type === 'time') {
          requireColumn(view.x.field)
          for (const row of dataset.rows) {
            const value = row[view.x.field] ?? null
            if (value !== null && !isParseableTimeText(value)) {
              fail(prefix + ': view "' + view.id + '" 的 x 字段 "' + view.x.field + '" 含有不可解析的时间值 "' + value + '"')
            }
          }
        } else {
          requireColumn(view.x.field)
        }
        if (view.seriesField !== undefined) requireColumn(view.seriesField)
        for (const field of view.y) requireNumeric(field)
        break
      }
      case 'pie': {
        requireColumn(view.categoryField)
        requireNumeric(view.valueField)
        for (const row of dataset.rows) {
          const value = row[view.valueField] ?? null
          if (value !== null && Number(value) < 0) {
            fail(prefix + ': view "' + view.id + '" 的 valueField "' + view.valueField + '" 含负数 "' + value + '"（饼图值必须非负）')
          }
        }
        break
      }
      case 'scatter':
        requireNumeric(view.xField)
        requireNumeric(view.yField)
        break
      case 'table':
        for (const column of view.columns ?? []) requireColumn(column)
        break
    }
  }
}

/** Compress object rows into column-aligned two-dimensional arrays (D2). */
export function rowsToArrays(columns: string[], rows: readonly Record<string, string | null>[]): (string | null)[][] {
  return rows.map((row) => columns.map((column) => row[column] ?? null))
}

/** JSON-encoded UTF-8 size of the normalized report (the 512 KiB bound). */
export function reportJsonBytes(report: AnalysisReportV1): number {
  const { htmlPath: _htmlPath, ...dataReport } = report
  return new TextEncoder().encode(JSON.stringify(dataReport)).length
}

/** One-line model-facing summary; never re-injects rows into model context (D5). */
export function formatAnalysisSummary(report: Pick<AnalysisReportV1, 'title' | 'datasets' | 'views' | 'htmlPath'>): string {
  const emptyIds = report.datasets.filter((dataset) => dataset.rows.length === 0).map((dataset) => dataset.id)
  let text = '已生成分析报告《' + report.title + '》：' + report.datasets.length + ' 个数据集、' + report.views.length + ' 个视图（version ' + ANALYSIS_REPORT_VERSION + '）。'
  if (emptyIds.length > 0) text += '其中 ' + emptyIds.length + ' 个数据集无数据：' + emptyIds.join('、') + '。'
  if (report.htmlPath !== undefined) text += 'Dashboard HTML已保存：' + report.htmlPath
  return text
}

// ── Wire schema declarations shared by the tool definition ───────────────────

const BASE_VIEW_PROPERTIES = {
  id: { type: 'string', required: true, description: '视图唯一 id（本报告内不重复）' },
  kind: { type: 'string', required: true, description: '视图类型' },
  datasetId: { type: 'string', required: true, description: '引用本次请求中的一个 dataset id' },
  label: { type: 'string', description: '可选视图标题，用于图表可访问名称与空态' },
  width: { type: 'string', enum: ['full', 'half'], description: '可选宽度：full 整行 / half 半行（缺省由系统决定）' },
} as const

const METRIC_VIEW_SCHEMA = {
  type: 'object',
  properties: {
    id: BASE_VIEW_PROPERTIES.id,
    kind: { type: 'string', const: 'metric', required: true },
    datasetId: BASE_VIEW_PROPERTIES.datasetId,
    field: { type: 'string', required: true, description: '数值字段名（来自 dataset 查询结果的列）' },
    label: { type: 'string', required: true, description: '指标名称，如「本月营收」' },
    format: { type: 'string', enum: ['number', 'percent'], description: '可选数值格式：number（默认）或 percent（值×100 后加 %）' },
  },
  additionalProperties: false,
} as const satisfies ValueSchemaSpec

const LINE_BAR_VIEW_SCHEMA = (kind: 'line' | 'bar') => ({
  type: 'object',
  properties: {
    id: BASE_VIEW_PROPERTIES.id,
    kind: { type: 'string', const: kind, required: true },
    datasetId: BASE_VIEW_PROPERTIES.datasetId,
    label: BASE_VIEW_PROPERTIES.label,
    width: BASE_VIEW_PROPERTIES.width,
    x: {
      type: 'object',
      properties: {
        field: { type: 'string', required: true, description: 'x 轴字段名' },
        type: { type: 'string', enum: ['category', 'time'], required: true, description: 'category 分类轴 / time 时间轴（数据需可由 Date 解析，SQL 请 ORDER BY）' },
        label: { type: 'string', description: '可选 x 轴名称' },
      },
      additionalProperties: false,
      required: true,
    },
    y: {
      type: 'array',
      required: true,
      items: { type: 'string' },
      description: '1-4 个数值 y 字段名；声明多个 y 时不得同时声明 seriesField',
    },
    seriesField: { type: 'string', description: '可选分组字段：按该字段取值拆成多个系列（与多个 y 字段互斥）' },
  },
  additionalProperties: false,
} as const satisfies ValueSchemaSpec)

const PIE_VIEW_SCHEMA = {
  type: 'object',
  properties: {
    id: BASE_VIEW_PROPERTIES.id,
    kind: { type: 'string', const: 'pie', required: true },
    datasetId: BASE_VIEW_PROPERTIES.datasetId,
    label: BASE_VIEW_PROPERTIES.label,
    width: BASE_VIEW_PROPERTIES.width,
    categoryField: { type: 'string', required: true, description: '分类字段名' },
    valueField: { type: 'string', required: true, description: '非负数值字段名' },
  },
  additionalProperties: false,
} as const satisfies ValueSchemaSpec

const SCATTER_VIEW_SCHEMA = {
  type: 'object',
  properties: {
    id: BASE_VIEW_PROPERTIES.id,
    kind: { type: 'string', const: 'scatter', required: true },
    datasetId: BASE_VIEW_PROPERTIES.datasetId,
    label: BASE_VIEW_PROPERTIES.label,
    width: BASE_VIEW_PROPERTIES.width,
    xField: { type: 'string', required: true, description: '数值 x 字段名' },
    yField: { type: 'string', required: true, description: '数值 y 字段名' },
  },
  additionalProperties: false,
} as const satisfies ValueSchemaSpec

const TABLE_VIEW_SCHEMA = {
  type: 'object',
  properties: {
    id: BASE_VIEW_PROPERTIES.id,
    kind: { type: 'string', const: 'table', required: true },
    datasetId: BASE_VIEW_PROPERTIES.datasetId,
    label: BASE_VIEW_PROPERTIES.label,
    width: BASE_VIEW_PROPERTIES.width,
    columns: { type: 'array', items: { type: 'string' }, description: '可选列白名单；省略时按 dataset 列顺序显示' },
  },
  additionalProperties: false,
} as const satisfies ValueSchemaSpec

/** The view union: exactly the six supported kinds, nothing else. */
export const ANALYSIS_VIEWS_SCHEMA = {
  oneOf: [
    METRIC_VIEW_SCHEMA,
    LINE_BAR_VIEW_SCHEMA('line'),
    LINE_BAR_VIEW_SCHEMA('bar'),
    PIE_VIEW_SCHEMA,
    SCATTER_VIEW_SCHEMA,
    TABLE_VIEW_SCHEMA,
  ],
} as const satisfies ValueSchemaSpec

/** Wire parameter schema of the render-analysis tool. */
export const RENDER_ANALYSIS_PARAMETERS = {
  title: {
    type: 'string',
    required: true,
    description: '报告标题，如「月度经营分析」',
  },
  outputName: {
    type: 'string',
    description: '可选语义化HTML文件名（仅basename，可省略.html），如「电商经营全景分析-2023-09至2026-08」；缺省时使用title，不要使用随机ID',
  },
  summary: {
    type: 'string',
    description: '可选一句话结论/摘要，显示在报告头部',
  },
  datasets: {
    type: 'array',
    required: true,
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', required: true, description: '数据集唯一 id（供 views 引用）' },
        sql: { type: 'string', required: true, description: '一条只读 SQL（SELECT/SHOW/DESCRIBE/EXPLAIN；聚合、Top N、排序都写在 SQL 中）' },
      },
      additionalProperties: false,
    },
    description: '1-6 个数据集；每个按顺序恰好执行一次，同一数据集可被多个视图复用',
  },
  views: {
    type: 'array',
    required: true,
    items: ANALYSIS_VIEWS_SCHEMA,
    description: '1-8 个视图；每个视图必须回答一个不同子问题，多个视图可共享同一 dataset',
  },
} as const satisfies ParameterSchemaSpec

/** Canonical output schema of the render-analysis tool. */
export const ANALYSIS_REPORT_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    version: { type: 'integer', const: ANALYSIS_REPORT_VERSION, required: true },
    title: { type: 'string', required: true },
    summary: { type: 'string' },
    htmlPath: { type: 'string', required: true },
    datasets: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', required: true },
          columns: { type: 'array', required: true, items: { type: 'string' } },
          rows: {
            type: 'array',
            required: true,
            items: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'null' }] } },
          },
        },
        additionalProperties: false,
      },
    },
    views: { type: 'array', required: true, items: ANALYSIS_VIEWS_SCHEMA },
  },
  additionalProperties: false,
} as const satisfies ValueSchemaSpec
