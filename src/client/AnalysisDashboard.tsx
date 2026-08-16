/**
 * render-analysis tool result row + Dashboard Modal (tasks 3.4, 4.x).
 *
 * The row is registered for the keyed tool.call.toolview slot under
 * key: render-analysis. It is a pure function of the frozen ToolCallBlock
 * owner payload (decoded by analysis-view-model): running/error/interrupted
 * statuses, a compact summary for complex reports, a bounded inline preview
 * for the simple single-chart report, and a native "查看分析" button that
 * opens THIS call's own Dashboard Modal (local state — one session may hold
 * many independent reports).
 *
 * The Modal reuses the host primitives Modal (Escape/mask close) headless,
 * keeps its own header fixed, scrolls the body independently, and returns
 * focus to the trigger button on close. All interactive elements are native
 * buttons; every chart carries an aria-label plus a plain-text summary; all
 * cell/label/axis values render as text (React escaping + ECharts richText),
 * so no report field can become executable DOM.
 * @module @yejiming/dsh-data-agent/client/AnalysisDashboard
 */

import { useEffect, useRef, useState } from 'react'
import { Modal, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import {
  isChartKind,
  type AnalysisDatasetResultV1,
  type AnalysisReportV1,
  type AnalysisViewKind,
  type AnalysisViewV1,
  type AnalysisViewWidth,
} from '../analysis.ts'
import { chartOptionFor, chartTextSummary, readChartThemeTokens } from './analysis-charts.ts'
import { AnalysisChart } from './AnalysisChart.tsx'
import { decodeAnalysisBlock, isSimpleChartReport, reportCounts } from './analysis-view-model.ts'
import css from './AnalysisDashboard.module.css'

/** Locale key of one view kind (typed key domain for the t seat). */
function analysisKindKey(kind: AnalysisViewKind): 'analysis.kind.metric' | 'analysis.kind.line' | 'analysis.kind.bar' | 'analysis.kind.pie' | 'analysis.kind.scatter' | 'analysis.kind.table' {
  switch (kind) {
    case 'metric': return 'analysis.kind.metric'
    case 'line': return 'analysis.kind.line'
    case 'bar': return 'analysis.kind.bar'
    case 'pie': return 'analysis.kind.pie'
    case 'scatter': return 'analysis.kind.scatter'
    case 'table': return 'analysis.kind.table'
  }
}

/** Full row props: the toolview runtime share + the data-agent locale seat. */
export type RenderAnalysisRowProps = ToolCallViewProps & PropsLocale<'data-agent'>

/** Effective grid width per view id: tables and the first chart default full. */
export function computeViewWidths(views: readonly AnalysisViewV1[]): Map<string, AnalysisViewWidth> {
  const widths = new Map<string, AnalysisViewWidth>()
  let firstChartPlaced = false
  for (const view of views) {
    if (view.kind === 'metric') continue
    if (view.width !== undefined) {
      widths.set(view.id, view.width)
      if (isChartKind(view.kind)) firstChartPlaced = true
      continue
    }
    const effective: AnalysisViewWidth = view.kind === 'table' || !firstChartPlaced ? 'full' : 'half'
    widths.set(view.id, effective)
    if (isChartKind(view.kind)) firstChartPlaced = true
  }
  return widths
}

/** Format one metric value without ever inventing data. */
export function formatMetricValue(value: string | null, format: 'number' | 'percent' | undefined, empty: string): string {
  if (value === null) return empty
  const number = Number(value)
  if (!Number.isFinite(number)) return value
  if (format === 'percent') return number * 100 + '%'
  return number.toLocaleString()
}

/** The registered render-analysis tool result row. */
export function RenderAnalysisRow({ toolName, block, t }: RenderAnalysisRowProps) {
  const model = decodeAnalysisBlock(block)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const closeModal = (): void => {
    setOpen(false)
    // Focus returns to the trigger button after Escape/mask/close (4.1).
    triggerRef.current?.focus()
  }

  if (model.state === 'running') {
    return (
      <div className={css.row}>
        <div className={css.rowHead}>
          <StateDot state="ongoing" size={10} />
          <p className={css.rowTitle}>{toolName}</p>
        </div>
        <p className={css.rowSummary}>{t('analysis.running')}</p>
      </div>
    )
  }

  if (model.state === 'error' || model.state === 'interrupted') {
    return (
      <div className={css.row}>
        <div className={css.rowHead}>
          <StateDot state={model.state === 'error' ? 'error' : 'warning'} size={10} />
          <p className={css.rowTitle}>{toolName}</p>
        </div>
        <p className={model.state === 'error' ? css.rowError : css.rowInterrupted}>
          {model.state === 'error' ? t('analysis.failed') : t('analysis.interrupted')}
          {model.errorText !== undefined && model.errorText !== '' ? '：' + model.errorText : ''}
        </p>
      </div>
    )
  }

  if (model.state === 'fallback' || model.report === undefined) {
    return (
      <div className={css.row}>
        <div className={css.rowHead}>
          <StateDot state="done" size={10} />
          <p className={css.rowTitle}>{toolName}</p>
        </div>
        <p className={css.rowSummary}>{model.fallbackText ?? t('analysis.fallback')}</p>
      </div>
    )
  }

  const report = model.report
  const counts = reportCounts(report)
  const simple = isSimpleChartReport(report)
  const tokens = readChartThemeTokens()

  return (
    <div className={css.row}>
      <div className={css.rowHead}>
        <StateDot state="done" size={10} />
        <p className={css.rowTitle}>{report.title}</p>
      </div>
      <p className={css.rowSummary}>{t('analysis.summary', { datasets: counts.datasets, views: counts.views })}</p>
      {simple && (() => {
        const view = report.views[0]!
        const dataset = report.datasets.find((candidate) => candidate.id === view.datasetId)
        if (dataset === undefined || dataset.rows.length === 0) return null
        return (
          <div className={css.preview}>
            <AnalysisChart
              option={chartOptionFor(view, dataset, tokens, view.label ?? t(analysisKindKey(view.kind)))}
              ariaLabel={view.label ?? t(analysisKindKey(view.kind))}
              summary={chartTextSummary(view, dataset, t(analysisKindKey(view.kind)))}
              height={200}
            />
          </div>
        )
      })()}
      <div className={css.rowActions}>
        <button
          ref={triggerRef}
          type="button"
          className={css.rowButton}
          onClick={() => { setOpen(true) }}
        >
          {t('analysis.view')}
        </button>
      </div>
      <ReportModal report={report} t={t} open={open} onClose={closeModal} />
    </div>
  )
}

/** The headless-hosted full-report Modal with its own fixed header. */
function ReportModal({ report, t, open, onClose }: {
  report: AnalysisReportV1
  t: TranslateNS<'data-agent'>
  open: boolean
  onClose: () => void
}) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const counts = reportCounts(report)

  useEffect(() => {
    if (open) shellRef.current?.focus()
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={report.title}
      closeLabel={t('analysis.close')}
      className={css.modal}
      headless
    >
      <div ref={shellRef} className={css.modalShell} tabIndex={-1} role="document">
        <header className={css.modalHeader}>
          <div className={css.modalTitleWrap}>
            <h2 className={css.modalTitle}>{report.title}</h2>
            {report.summary !== undefined && report.summary !== '' && (
              <p className={css.modalSummary}>{report.summary}</p>
            )}
            <p className={css.modalCount}>{t('analysis.summary', { datasets: counts.datasets, views: counts.views })}</p>
          </div>
          <button type="button" className={css.modalClose} onClick={onClose} aria-label={t('analysis.close')}>
            {t('analysis.close')}
          </button>
        </header>
        <div className={css.modalBody}>
          <DashboardBody report={report} t={t} />
        </div>
      </div>
    </Modal>
  )
}

/** The semantic, asymmetric dashboard body: metric band + full/half grid. */
function DashboardBody({ report, t }: { report: AnalysisReportV1; t: TranslateNS<'data-agent'> }) {
  const tokens = readChartThemeTokens()
  const datasets = new Map(report.datasets.map((dataset) => [dataset.id, dataset]))
  const widths = computeViewWidths(report.views)
  const metrics = report.views.filter((view) => view.kind === 'metric')

  return (
    <div>
      {metrics.length > 0 && (
        <div className={css.metricBand}>
          {metrics.map((view) => (
            <MetricCard key={view.id} view={view} dataset={datasets.get(view.datasetId)} t={t} />
          ))}
        </div>
      )}
      <div className={css.grid}>
        {report.views.filter((view) => view.kind !== 'metric').map((view) => {
          const dataset = datasets.get(view.datasetId)
          const label = view.label ?? t(analysisKindKey(view.kind))
          const widthClass = widths.get(view.id) === 'half' ? css.viewHalf : css.viewFull
          return (
            <section key={view.id} className={css.view + ' ' + widthClass}>
              <h3 className={css.viewTitle}>{label}</h3>
              {dataset === undefined || dataset.rows.length === 0 ? (
                <div className={css.empty}>
                  <p className={css.emptyText}>{t('analysis.empty')}</p>
                </div>
              ) : view.kind === 'table' ? (
                <TableView view={view} dataset={dataset} />
              ) : (
                <AnalysisChart
                  option={chartOptionFor(view, dataset, tokens, label)}
                  ariaLabel={label}
                  summary={chartTextSummary(view, dataset, t(analysisKindKey(view.kind)))}
                />
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** One compact metric (first row of the referenced dataset; no hero styling). */
function MetricCard({ view, dataset, t }: {
  view: Extract<AnalysisViewV1, { kind: 'metric' }>
  dataset: AnalysisDatasetResultV1 | undefined
  t: TranslateNS<'data-agent'>
}) {
  const value = dataset !== undefined && dataset.rows.length > 0
    ? dataset.rows[0]![dataset.columns.indexOf(view.field)] ?? null
    : null
  return (
    <div className={css.metric}>
      <p className={css.metricLabel}>{view.label}</p>
      <p className={css.metricValue}>{formatMetricValue(value, view.format, t('analysis.metric.null'))}</p>
    </div>
  )
}

/** Semantic table with sticky header and local horizontal scroll. */
function TableView({ view, dataset }: {
  view: Extract<AnalysisViewV1, { kind: 'table' }>
  dataset: AnalysisDatasetResultV1
}) {
  const columns = view.columns ?? dataset.columns
  const indexes = columns.map((column) => dataset.columns.indexOf(column))
  return (
    <div className={css.tableWrap}>
      <table className={css.table}>
        <thead>
          <tr>
            {columns.map((column) => <th key={column} scope="col">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {dataset.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {indexes.map((columnIndex) => (
                <td key={columnIndex}>{row[columnIndex] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}