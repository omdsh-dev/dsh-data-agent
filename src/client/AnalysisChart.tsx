/**
 * Reusable chart container (task 3.3): owns one ECharts instance per mount,
 * resizes it through a ResizeObserver, disposes it on unmount, and exposes an
 * accessible image role + short text summary. Options arrive pre-built by
 * chartOptionFor (token theme, non-HTML tooltips, reduced-motion included).
 * @module @yejiming/dsh-data-agent/client/AnalysisChart
 */

import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import type { EChartsCoreOption } from 'echarts/core'
import css from './AnalysisDashboard.module.css'

/** Chart container props. */
export interface AnalysisChartProps {
  /** Safe pre-built option (pure mapping of the constrained report). */
  option: EChartsCoreOption
  /** Accessible name of the chart image. */
  ariaLabel: string
  /** Short plain-text summary announced to assistive tech. */
  summary: string
  /** Chart canvas height in px (the container always spans full width). */
  height?: number
}

/**
 * One chart instance: init on mount, setOption on every option change (theme
 * switches rebuild the option), resize on container changes, dispose on
 * unmount. Null data points render as gaps because numericOrNull never
 * converts null to zero.
 */
export function AnalysisChart({ option, ariaLabel, summary, height = 280 }: AnalysisChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    const element = containerRef.current
    if (element === null) return
    const chart = echarts.init(element)
    chartRef.current = chart
    // Guarded for jsdom/legacy runtimes: charts still render, they just
    // don't track container resizes without a ResizeObserver.
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          chart.resize()
        })
      : null
    observer?.observe(element)
    return () => {
      observer?.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true })
  }, [option])

  return (
    <div className={css.chart} role="img" aria-label={ariaLabel}>
      <div ref={containerRef} className={css.chartCanvas} style={{ height }} />
      <span className={css.visuallyHidden}>{summary}</span>
    </div>
  )
}
