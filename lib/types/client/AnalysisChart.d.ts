/**
 * Reusable chart container (task 3.3): owns one ECharts instance per mount,
 * resizes it through a ResizeObserver, disposes it on unmount, and exposes an
 * accessible image role + short text summary. Options arrive pre-built by
 * chartOptionFor (token theme, non-HTML tooltips, reduced-motion included).
 * @module @yejiming/dsh-data-agent/client/AnalysisChart
 */
import type { EChartsCoreOption } from 'echarts/core';
/** Chart container props. */
export interface AnalysisChartProps {
    /** Safe pre-built option (pure mapping of the constrained report). */
    option: EChartsCoreOption;
    /** Accessible name of the chart image. */
    ariaLabel: string;
    /** Short plain-text summary announced to assistive tech. */
    summary: string;
    /** Chart canvas height in px (the container always spans full width). */
    height?: number;
}
/**
 * One chart instance: init on mount, setOption on every option change (theme
 * switches rebuild the option), resize on container changes, dispose on
 * unmount. Null data points render as gaps because numericOrNull never
 * converts null to zero.
 */
export declare function AnalysisChart({ option, ariaLabel, summary, height }: AnalysisChartProps): import("react").JSX.Element;
