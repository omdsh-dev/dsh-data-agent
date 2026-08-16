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
import type { EChartsCoreOption } from 'echarts/core';
import { type AnalysisDatasetResultV1, type AnalysisViewV1 } from '../analysis.ts';
/** Colorblind-safe, finite series palette (Tableau 10 order). */
export declare const ANALYSIS_PALETTE: readonly ["#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#76b7b2", "#edc948", "#b07aa1", "#9c755f"];
/** Stable color per series NAME: same name → same color in every view. */
export declare function seriesColor(name: string): string;
/** DSH token values the charts need (fallback constants for non-DOM tests). */
export interface ChartThemeTokens {
    fontFamily: string;
    text: string;
    textSecondary: string;
    border: string;
    background: string;
    tooltipBorder: string;
    grid: string;
}
/** Read the host's DSH tokens once per render (falls back off-DOM). */
export declare function readChartThemeTokens(): ChartThemeTokens;
/** Whether the environment asks for reduced motion. */
export declare function prefersReducedMotion(): boolean;
/**
 * Map one constrained view + dataset pair to a safe ECharts option. Returns an
 * empty option for metric/table views (they never reach the chart component).
 */
export declare function chartOptionFor(view: AnalysisViewV1, dataset: AnalysisDatasetResultV1, tokens: ChartThemeTokens, ariaLabel: string): EChartsCoreOption;
/** Short plain-text summary of one chart (the accessible text description). */
export declare function chartTextSummary(view: AnalysisViewV1, dataset: AnalysisDatasetResultV1, kindLabel: string): string;
