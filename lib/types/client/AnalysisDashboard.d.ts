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
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client';
import { type AnalysisViewV1, type AnalysisViewWidth } from '../analysis.ts';
/** Full row props: the toolview runtime share + the data-agent locale seat. */
export type RenderAnalysisRowProps = ToolCallViewProps & PropsLocale<'data-agent'>;
/** Effective grid width per view id: tables and the first chart default full. */
export declare function computeViewWidths(views: readonly AnalysisViewV1[]): Map<string, AnalysisViewWidth>;
/** Format one metric value without ever inventing data. */
export declare function formatMetricValue(value: string | null, format: 'number' | 'percent' | undefined, empty: string): string;
/** The registered render-analysis tool result row. */
export declare function RenderAnalysisRow({ toolName, block, t }: RenderAnalysisRowProps): import("react").JSX.Element;
