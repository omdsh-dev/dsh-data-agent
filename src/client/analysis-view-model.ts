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

import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { isChartKind, parseAnalysisReport, type AnalysisReportV1 } from '../analysis.ts'

/** The five display states of one render-analysis call. */
export type AnalysisBlockState = 'running' | 'error' | 'interrupted' | 'report' | 'fallback'

/** Decoded view model for one frozen block. */
export interface AnalysisViewModel {
  state: AnalysisBlockState
  /** Valid version-1 report (state=report only). */
  report?: AnalysisReportV1
  /** Safe error text (state=error/interrupted). */
  errorText?: string
  /** Safe model content text (state=fallback). */
  fallbackText?: string
}

/** One model content block's text fragment. */
interface TextBlockLike {
  type?: string
  text?: string
}

/** Join the text blocks of a settled result into one safe plain string. */
export function contentText(content: readonly unknown[]): string {
  const parts: string[] = []
  for (const item of content) {
    const block = item as TextBlockLike
    if (block !== null && typeof block === 'object' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n').trim()
}

/** Decode one persisted meta value: object, JSON string, or nothing. */
function decodeReportMeta(meta: unknown): AnalysisReportV1 | undefined {
  try {
    let candidate: unknown = meta
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      candidate = JSON.parse(candidate)
    }
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return undefined
    if ((candidate as { version?: unknown }).version !== 1) return undefined
    return parseAnalysisReport(candidate)
  } catch {
    return undefined
  }
}

/**
 * Decode one frozen ToolCallBlock into the display view model. The block is
 * treated as immutable input; no lookups, no queries, no throws.
 */
export function decodeAnalysisBlock(block: ToolCallBlock): AnalysisViewModel {
  const settled = (block as { kind?: string }).kind === 'tool-result' ? block as { isError: boolean; error?: { name?: string; code?: string }; content: readonly unknown[]; meta?: unknown } : undefined
  if (settled === undefined) return { state: 'running' }
  if (settled.isError) {
    const interrupted = settled.error?.code === 'interrupted'
    return {
      state: interrupted ? 'interrupted' : 'error',
      errorText: contentText(settled.content),
    }
  }
  const report = decodeReportMeta(settled.meta)
  if (report !== undefined) return { state: 'report', report }
  return { state: 'fallback', fallbackText: contentText(settled.content) }
}

/** Whether a report is the simple single-chart case deserving an inline preview. */
export function isSimpleChartReport(report: AnalysisReportV1): boolean {
  return report.views.length === 1 && isChartKind(report.views[0]!.kind)
}

/** Human-facing dataset/view counts for the summary line. */
export function reportCounts(report: AnalysisReportV1): { datasets: number; views: number } {
  return { datasets: report.datasets.length, views: report.views.length }
}
