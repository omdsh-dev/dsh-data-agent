/**
 * Frozen-session decoder for render-analysis tool results (task 3.1). The
 * component owns NO database state: everything derives from the frozen
 * ToolCallBlock the slot owner supplies, so history replay is a pure function
 * of the persisted meta and never touches the database, HTTP routes, or any
 * storage domain.
 *
 * States:
 * - running: tool/call seen, tool/result not yet;
 * - error / interrupted: settled with an error outcome (interrupted carries
 *   the host's interrupted error code);
 * - report: settled with a valid AnalysisReportV1 meta;
 * - fallback: missing, malformed, string-encoded or unknown-version meta —
 *   degrade to the safe model content text, never guess or re-query.
 * @module @yejiming/dsh-data-agent/client/analysis-view-model
 */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { type AnalysisReportV1 } from '../analysis.ts';
/** The five display states of one render-analysis call. */
export type AnalysisBlockState = 'running' | 'error' | 'interrupted' | 'report' | 'fallback';
/** Decoded view model for one frozen block. */
export interface AnalysisViewModel {
    state: AnalysisBlockState;
    /** Valid version-1 report (state=report only). */
    report?: AnalysisReportV1;
    /** Safe error text (state=error/interrupted). */
    errorText?: string;
    /** Safe model content text (state=fallback). */
    fallbackText?: string;
}
/** Join the text blocks of a settled result into one safe plain string. */
export declare function contentText(content: readonly unknown[]): string;
/**
 * Decode one frozen ToolCallBlock into the display view model. The block is
 * treated as immutable input; no lookups, no queries, no throws.
 */
export declare function decodeAnalysisBlock(block: ToolCallBlock): AnalysisViewModel;
/** Whether a report is the simple single-chart case deserving an inline preview. */
export declare function isSimpleChartReport(report: AnalysisReportV1): boolean;
/** Human-facing dataset/view counts for the summary line. */
export declare function reportCounts(report: AnalysisReportV1): {
    datasets: number;
    views: number;
};
