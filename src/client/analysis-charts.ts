/**
 * Safe ECharts mapping for the analysis dashboard (tasks 3.2/3.3). Only the
 * four first-version chart types and their required components are registered
 * from echarts/core — line/bar/pie/scatter + grid/tooltip/legend/aria with
 * the SVG renderer — so the client bundle stays tree-shaken per chart type.
 *
 * Every option is a PURE mapping of the constrained AnalysisReportV1 (the
 * client never aggregates, sorts, or null→0 converts), tooltips use the
 * non-HTML richText render mode, all labels/values stay text, and the series
 * palette is finite, colorblind-safe, and stable by series NAME (the same
 * series name gets the same color across every view of one report).
 * @module @yejiming/dsh-data-agent/client/analysis-charts
 */

import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'
import {
  isChartKind,
  type AnalysisDatasetResultV1,
  type AnalysisViewV1,
} from '../analysis.ts'

// Register exactly the v1 surface once, module-load time.
echarts.use([
  LineChart,
  BarChart,
  PieChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,
  SVGRenderer,
])

/** Colorblind-safe, finite series palette (Tableau 10 order). */
export const ANALYSIS_PALETTE = [
  '#4e79a7',
  '#f28e2b',
  '#59a14f',
  '#e15759',
  '#76b7b2',
  '#edc948',
  '#b07aa1',
  '#9c755f',
] as const

/** Stable color per series NAME: same name → same color in every view. */
export function seriesColor(name: string): string {
  let hash = 0
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0
  }
  return ANALYSIS_PALETTE[Math.abs(hash) % ANALYSIS_PALETTE.length]!
}

/** DSH token values the charts need (fallback constants for non-DOM tests). */
export interface ChartThemeTokens {
  fontFamily: string
  text: string
  textSecondary: string
  border: string
  background: string
  tooltipBorder: string
  grid: string
}

const FALLBACK_TOKENS: ChartThemeTokens = {
  fontFamily: '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  text: '#1f2329',
  textSecondary: '#8a9099',
  border: '#e4e6eb',
  background: '#ffffff',
  tooltipBorder: '#d8dbe0',
  grid: '#e4e6eb',
}

/** Read the host's DSH tokens once per render (falls back off-DOM). */
export function readChartThemeTokens(): ChartThemeTokens {
  if (typeof window === 'undefined' || typeof document === 'undefined') return FALLBACK_TOKENS
  const styles = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(document.documentElement) : null
  const read = (name: string, fallback: string): string => {
    const value = styles?.getPropertyValue(name).trim()
    return value === undefined || value === '' ? fallback : value
  }
  return {
    fontFamily: read('--dsw-font-family', FALLBACK_TOKENS.fontFamily),
    text: read('--dsw-alias-label-primary', FALLBACK_TOKENS.text),
    textSecondary: read('--dsw-alias-label-tertiary', FALLBACK_TOKENS.textSecondary),
    border: read('--dsw-alias-border-l1', FALLBACK_TOKENS.border),
    background: read('--dsw-alias-bg-layer-1', FALLBACK_TOKENS.background),
    tooltipBorder: read('--dsw-alias-border-l2', FALLBACK_TOKENS.tooltipBorder),
    grid: read('--dsw-alias-border-l2', FALLBACK_TOKENS.grid),
  }
}

/** Whether the environment asks for reduced motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Convert one SQL text value to a finite number or null (never zero). */
function numericOrNull(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** Convert one line/bar x value per the axis type. */
function axisValue(value: string | null, type: 'category' | 'time'): string | number | null {
  if (value === null) return null
  if (type === 'time') {
    const time = Date.parse(value)
    return Number.isNaN(time) ? null : time
  }
  return value
}

function columnIndex(dataset: AnalysisDatasetResultV1, field: string): number {
  return dataset.columns.indexOf(field)
}

/** Shared base option fragment applied to every chart. */
function baseOption(tokens: ChartThemeTokens, ariaLabel: string): Record<string, unknown> {
  const motion = !prefersReducedMotion()
  return {
    animation: motion,
    animationDuration: motion ? 300 : 0,
    textStyle: { fontFamily: tokens.fontFamily, color: tokens.text },
    color: [...ANALYSIS_PALETTE],
    aria: { enabled: true, decal: { show: false }, description: ariaLabel },
    tooltip: {
      renderMode: 'richText',
      confine: true,
      backgroundColor: tokens.background,
      borderColor: tokens.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: tokens.text, fontFamily: tokens.fontFamily },
    },
  }
}

/** Legend config for multi-series charts. */
function legendFor(tokens: ChartThemeTokens): Record<string, unknown> {
  return {
    show: true,
    top: 0,
    type: 'scroll',
    icon: 'circle',
    itemWidth: 8,
    itemHeight: 8,
    textStyle: { color: tokens.textSecondary, fontFamily: tokens.fontFamily },
    pageTextStyle: { color: tokens.textSecondary },
  }
}

/** Line/bar: multi-y series or one seriesField group, preserving row order. */
function lineBarOption(view: Extract<AnalysisViewV1, { kind: 'line' | 'bar' }>, dataset: AnalysisDatasetResultV1, tokens: ChartThemeTokens, ariaLabel: string): EChartsCoreOption {
  const xIndex = columnIndex(dataset, view.x.field)
  const xValues = dataset.rows.map((row) => axisValue(row[xIndex] ?? null, view.x.type))
  const yIndexes = view.y.map((field) => columnIndex(dataset, field))
  const series: Record<string, unknown>[] = []
  if (view.seriesField !== undefined) {
    const groupIndex = columnIndex(dataset, view.seriesField)
    const groups: string[] = []
    const seen = new Set<string>()
    for (const row of dataset.rows) {
      const name = row[groupIndex] ?? ''
      if (!seen.has(name)) {
        seen.add(name)
        groups.push(name)
      }
    }
    for (const group of groups) {
      const data: (string | number | null)[][] = []
      for (let index = 0; index < dataset.rows.length; index += 1) {
        const row = dataset.rows[index]!
        if ((row[groupIndex] ?? '') !== group) continue
        data.push([xValues[index]!, numericOrNull(row[yIndexes[0]!])])
      }
      series.push({
        name: group,
        type: view.kind,
        data,
        connectNulls: false,
        showSymbol: view.kind === 'line' && dataset.rows.length < 30,
        itemStyle: { color: seriesColor(group) },
        lineStyle: view.kind === 'line' ? { color: seriesColor(group) } : undefined,
      })
    }
  } else {
    for (let seriesIndex = 0; seriesIndex < view.y.length; seriesIndex += 1) {
      const name = view.y[seriesIndex]!
      const yIndex = yIndexes[seriesIndex]!
      const data = dataset.rows.map((row, index) => [xValues[index]!, numericOrNull(row[yIndex])])
      series.push({
        name,
        type: view.kind,
        data,
        connectNulls: false,
        showSymbol: view.kind === 'line' && dataset.rows.length < 30,
        itemStyle: { color: seriesColor(name) },
        lineStyle: view.kind === 'line' ? { color: seriesColor(name) } : undefined,
      })
    }
  }
  return {
    ...baseOption(tokens, ariaLabel),
    grid: { left: 8, right: 12, top: series.length > 1 ? 36 : 24, bottom: 8, containLabel: true },
    legend: series.length > 1 ? legendFor(tokens) : { show: false },
    xAxis: {
      type: view.x.type === 'time' ? 'time' : 'category',
      name: view.x.label,
      nameTextStyle: { color: tokens.textSecondary },
      axisLine: { lineStyle: { color: tokens.border } },
      axisTick: { lineStyle: { color: tokens.border } },
      axisLabel: { color: tokens.textSecondary, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: tokens.grid } },
      axisLabel: { color: tokens.textSecondary },
    },
    series,
  }
}

/** Pie: category + non-negative values as text-safe items. */
function pieOption(view: Extract<AnalysisViewV1, { kind: 'pie' }>, dataset: AnalysisDatasetResultV1, tokens: ChartThemeTokens, ariaLabel: string): EChartsCoreOption {
  const categoryIndex = columnIndex(dataset, view.categoryField)
  const valueIndex = columnIndex(dataset, view.valueField)
  const data = dataset.rows.map((row) => ({
    name: row[categoryIndex] ?? '',
    value: numericOrNull(row[valueIndex]),
    itemStyle: { color: seriesColor(row[categoryIndex] ?? '') },
  }))
  return {
    ...baseOption(tokens, ariaLabel),
    tooltip: { ...(baseOption(tokens, ariaLabel).tooltip as Record<string, unknown>), trigger: 'item' },
    legend: legendFor(tokens),
    series: [{
      name: view.label ?? view.valueField,
      type: 'pie',
      radius: ['30%', '68%'],
      center: ['50%', '52%'],
      data,
      label: { color: tokens.textSecondary, formatter: '{b}' },
      emphasis: { scale: false },
    }],
  }
}

/** Scatter: numeric x/y pairs preserving order. */
function scatterOption(view: Extract<AnalysisViewV1, { kind: 'scatter' }>, dataset: AnalysisDatasetResultV1, tokens: ChartThemeTokens, ariaLabel: string): EChartsCoreOption {
  const xIndex = columnIndex(dataset, view.xField)
  const yIndex = columnIndex(dataset, view.yField)
  const data = dataset.rows.map((row) => [numericOrNull(row[xIndex]), numericOrNull(row[yIndex])])
  return {
    ...baseOption(tokens, ariaLabel),
    grid: { left: 8, right: 12, top: 24, bottom: 8, containLabel: true },
    legend: { show: false },
    xAxis: {
      type: 'value',
      name: view.xField,
      nameTextStyle: { color: tokens.textSecondary },
      axisLine: { lineStyle: { color: tokens.border } },
      splitLine: { lineStyle: { color: tokens.grid } },
      axisLabel: { color: tokens.textSecondary },
    },
    yAxis: {
      type: 'value',
      name: view.yField,
      nameTextStyle: { color: tokens.textSecondary },
      axisLine: { lineStyle: { color: tokens.border } },
      splitLine: { lineStyle: { color: tokens.grid } },
      axisLabel: { color: tokens.textSecondary },
    },
    series: [{
      name: view.label ?? view.yField,
      type: 'scatter',
      data,
      itemStyle: { color: ANALYSIS_PALETTE[0] },
    }],
  }
}

/**
 * Map one constrained view + dataset pair to a safe ECharts option. Returns an
 * empty option for metric/table views (they never reach the chart component).
 */
export function chartOptionFor(view: AnalysisViewV1, dataset: AnalysisDatasetResultV1, tokens: ChartThemeTokens, ariaLabel: string): EChartsCoreOption {
  if (!isChartKind(view.kind)) return {}
  switch (view.kind) {
    case 'line':
    case 'bar':
      return lineBarOption(view, dataset, tokens, ariaLabel)
    case 'pie':
      return pieOption(view, dataset, tokens, ariaLabel)
    case 'scatter':
      return scatterOption(view, dataset, tokens, ariaLabel)
    case 'metric':
    case 'table':
      return {}
  }
}

/** Short plain-text summary of one chart (the accessible text description). */
export function chartTextSummary(view: AnalysisViewV1, dataset: AnalysisDatasetResultV1, kindLabel: string): string {
  const parts = [kindLabel]
  if (view.kind === 'line' || view.kind === 'bar') {
    parts.push(view.x.field + ' 为 x 轴')
    if (view.seriesField !== undefined) parts.push(view.seriesField + ' 分组')
    else parts.push(view.y.join('、') + (view.y.length > 1 ? ' 多系列' : ''))
  }
  if (view.kind === 'pie') parts.push(view.categoryField + ' / ' + view.valueField)
  if (view.kind === 'scatter') parts.push(view.xField + ' / ' + view.yField)
  parts.push(String(dataset.rows.length) + ' 行')
  return parts.join('，')
}
