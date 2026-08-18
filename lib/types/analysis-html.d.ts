/**
 * Offline HTML artifact for one validated AnalysisReportV1.
 *
 * The generated page has no network/runtime dependencies. Untrusted report
 * strings stay inside escaped JSON and are projected with textContent only;
 * chart geometry is derived from already-validated finite numeric fields.
 * @module @yejiming/dsh-data-agent/analysis-html
 */
import type { AnalysisReportV1 } from './analysis.ts';
export declare const ANALYSIS_REPORT_DIRECTORY = "analysis-reports";
/** Convert a report title/output name into a bounded, readable filename segment. */
export declare function analysisFileSegment(value: string, fallback: string): string;
/** Relative path shared by the writer and DSH's mutation presentation. */
export declare function analysisArtifactRelativePath(title: string, outputName?: string): string;
/** Escape JSON so data cannot close its application/json script element. */
export declare function escapeJsonForHtmlScript(value: unknown): string;
/** Render one complete, offline Dashboard document. */
export declare function renderAnalysisHtml(report: AnalysisReportV1, generatedAt?: string): string;
export interface WriteAnalysisHtmlOptions {
    cwd: string;
    outputName?: string;
    generatedAt?: string;
}
/** Atomically persist one report and return the report enriched with htmlPath. */
export declare function writeAnalysisHtml(report: AnalysisReportV1, options: WriteAnalysisHtmlOptions): Promise<AnalysisReportV1 & {
    htmlPath: string;
}>;
