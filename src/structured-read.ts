/**
 * Shared structured read-query execution extracted from the sql-query tool
 * (task 2.1). Both sql-query and render-analysis run every read dataset
 * through this helper, so connection resolution, single-statement assertion,
 * read classification, dialect-aware maxRows enforcement, client execution, secret
 * redaction, timeout/cancellation, non-zero-exit surfacing and structured
 * parsing share one code path. Existing sql-query behavior and messages stay
 * unchanged.
 * @module @yejiming/dsh-data-agent/structured-read
 */

import type { Context } from '@deepseek-ai/cordis'
import { classifyStatement, enforceReadRowLimit, type ClientConfig } from './clients.ts'
import { redactQueryResult, redactSecretText, type DatabaseConnection } from './connections.ts'
import { runClientQuery, type QueryOptions, type QueryResult } from './query.ts'
import { assertSingleStatement } from './sql.ts'
import { parseStructuredQueryOutput } from './structured.ts'

/** Tool-run context face used by the helpers. */
export interface ToolExecLike {
  agent?: { id: string }
  signal: AbortSignal
}

/** Resolved runner options shared by the database tools. */
export interface ResolvedRunnerConfig {
  queryTimeoutMs: number
  maxResultChars: number
  maxRows: number
  maxQueryChars: number
  /** Read-only guard: true rejects write statements. */
  readonly: boolean
  clients: Readonly<Partial<Record<string, ClientConfig>>>
}

/** Canonical structured read result (elapsed/truncation metadata included). */
export interface StructuredReadResult {
  columns: string[]
  rows: Record<string, string | null>[]
  elapsedMs: number
  truncated: boolean
}

/** Look up the session connection, failing with the same message for every tool. */
export async function requireToolConnection(ctx: Context, exec: ToolExecLike, toolName: string): Promise<DatabaseConnection> {
  const sessionId = exec.agent?.id
  if (sessionId === undefined) {
    throw new Error(toolName + ': 缺少会话上下文（agent loop 未注入）')
  }
  try {
    return await ctx.dataAgentConnections.resolveForExecution(sessionId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(toolName + ': ' + message)
  }
}

/** Run and redact a client result/error before it reaches tool/session output. */
export async function runRedactedClientQuery(
  ctx: Context,
  connection: DatabaseConnection,
  sql: string,
  options: QueryOptions,
  signal: AbortSignal,
): Promise<QueryResult> {
  try {
    const result = await runClientQuery(ctx, connection, sql, options, signal)
    return redactQueryResult(result, connection)
  } catch (error) {
    const message = redactSecretText(error instanceof Error ? error.message : String(error), [connection.password])
    throw new Error(message, error instanceof Error ? { cause: error } : undefined)
  }
}

/** Query runner options with the deployment overrides applied. */
export function runnerOptions(
  resolved: Pick<ResolvedRunnerConfig, 'queryTimeoutMs' | 'maxResultChars' | 'clients'>,
  mode?: QueryOptions['mode'],
): QueryOptions {
  return {
    clients: resolved.clients,
    timeoutMs: resolved.queryTimeoutMs,
    maxResultChars: resolved.maxResultChars,
    ...mode !== undefined ? { mode } : {},
  }
}

/**
 * Execute one read-only SQL through the structured client template and parse
 * it into the canonical { columns, rows } shape, with maxRows enforced at both
 * the SQL level (dialect rewrite) and the parse level.
 */
export async function runStructuredReadQuery(
  ctx: Context,
  connection: DatabaseConnection,
  sql: string,
  resolved: ResolvedRunnerConfig,
  toolName: string,
  signal: AbortSignal,
): Promise<StructuredReadResult> {
  if (sql.trim().length === 0) throw new Error(toolName + ': sql 不能为空')
  if (sql.length > resolved.maxQueryChars) {
    throw new Error(toolName + ': sql 超过长度上限（' + resolved.maxQueryChars + ' 字符）')
  }
  assertSingleStatement(sql, toolName)
  if (classifyStatement(sql, connection.type) !== 'read') {
    throw new Error(toolName + ' 只执行读语句（SELECT/SHOW/DESCRIBE/EXPLAIN，SQLite 还含查询型 PRAGMA）；写语句请使用 sql-write')
  }
  const limitedSql = enforceReadRowLimit(sql, connection.type, resolved.maxRows)
  const startedAt = Date.now()
  const result = await runRedactedClientQuery(ctx, connection, limitedSql, runnerOptions(resolved, 'structured'), signal)
  const elapsedMs = Date.now() - startedAt
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() !== '' ? result.stderr.trim() : result.stdout.trim()
    throw new Error(toolName + ' 执行失败（exit ' + result.exitCode + '）：' + detail)
  }
  const parsed = parseStructuredQueryOutput(connection.type, result.stdout, resolved.maxRows)
  return {
    columns: parsed.columns,
    rows: parsed.rows,
    elapsedMs,
    truncated: result.truncated || parsed.rowLimitExceeded,
  }
}
