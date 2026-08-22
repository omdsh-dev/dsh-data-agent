/**
 * The data-agent tool half (`@yejiming/dsh-data-agent/tool`): mounted ONLY by
 * the data-agent agent preset (`preset/data-agent/agent.cordis.yml`), never
 * by the host composition. It consumes the host's `subprocess` service and
 * the host-provided `dataAgentConnections` connection store, so it needs no
 * realm and satisfies the preset guard (a preset row that only consumes).
 *
 * Tool surface:
 * - `sql-query`: read-only statements, structured `{ columns, rows, ... }`;
 * - `sql-write`: one write/management statement per call, explicit autocommit;
 * - `sql-cmd`: the raw-terminal compatibility tool.
 *
 * Execution model (see `src/query.ts`): the SQL text travels on the client's
 * stdin, argv carries flags only, credentials go through environment entries
 * (`MYSQL_PWD` / `PGPASSWORD`), and the caller's signal plus an internal
 * deadline share one AbortController that drives the process-tree terminate
 * escalation. Output is bounded per stream and marked `truncated`.
 * @module @yejiming/dsh-data-agent/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import z from 'schemastery'
import { defineTool, type InferValue, type JsonValue } from '@deepseek-ai/dsh-tools'
// Type-only: pulls the ctx.subprocess merge (the subprocess host plugin) and
// the ctx.dataAgentConnections merge (the main data-agent row).
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from './index.ts'
import { classifyStatement, clientsSchema, enforceReadRowLimit, type ClientConfig } from './clients.ts'
import {
  DEFAULT_MAX_QUERY_CHARS,
  DEFAULT_MAX_RESULT_CHARS,
  DEFAULT_MAX_ROWS,
  DEFAULT_QUERY_TIMEOUT_MS,
} from './defaults.ts'
import type { QueryResult } from './query.ts'
import { assertSingleStatement } from './sql.ts'
import {
  ANALYSIS_REPORT_OUTPUT_SCHEMA,
  ANALYSIS_REPORT_VERSION,
  MAX_REPORT_BYTES,
  RENDER_ANALYSIS_PARAMETERS,
  formatAnalysisSummary,
  parseAnalysisRequest,
  reportJsonBytes,
  rowsToArrays,
  validateViewSemantics,
  type AnalysisReportV1,
  type DatasetRows,
} from './analysis.ts'
import {
  requireToolConnection,
  runRedactedClientQuery,
  runStructuredReadQuery,
  runnerOptions,
  type ResolvedRunnerConfig,
} from './structured-read.ts'
import { analysisArtifactRelativePath, writeAnalysisHtml } from './analysis-html.ts'
import { sanitizePresentationText } from './presentation-text.ts'
import { applyCatalogTools } from './catalog-tools.ts'

/** Cordis plugin name (diagnostics only). */
export const name = 'data-agent-tool'

/** Services required before the tool can register. */
export const inject = ['tools', 'subprocess', 'dataAgentConnections', 'dataAgentCatalog']

/** Tool-half configuration (loader schema with the same defaults as the host). */
export interface Config {
  /** Deadline for one sql-cmd / sql-query / sql-write query, milliseconds. */
  queryTimeoutMs: number
  /** In-memory cap on captured output. */
  maxResultChars: number
  /** Enforced read-query row cap (dialect rewrite + structured truncation). */
  maxRows: number
  /** Maximum SQL text length accepted per dataset statement. */
  maxQueryChars: number
  /** Read-only guard: true rejects write statements. */
  readonly: boolean
  /** CLI client overrides keyed by database type. */
  clients: Partial<Record<string, ClientConfig>>
}

/** Loader schema with deployment defaults (no library defaults). */
export const Config = z.object({
  queryTimeoutMs: z.number().step(1).min(1000).default(DEFAULT_QUERY_TIMEOUT_MS),
  maxResultChars: z.number().step(1).min(1024).default(DEFAULT_MAX_RESULT_CHARS),
  maxRows: z.number().step(1).min(1).default(DEFAULT_MAX_ROWS),
  maxQueryChars: z.number().step(1).min(1024).default(DEFAULT_MAX_QUERY_CHARS),
  readonly: z.boolean().default(false),
  clients: clientsSchema,
})

/** Canonical structured result returned by `sql-query`. */
interface StructuredSqlResult {
  columns: string[]
  rows: Record<string, string | null>[]
  affectedRows: number
  elapsedMs: number
  truncated: boolean
}

/** One-line tool-call label (newlines collapsed). */
function oneLine(sql: string): string {
  const line = sql.replace(/\s+/g, ' ').trim()
  return line.length > 80 ? `${line.slice(0, 77)}...` : line
}

/** Format the raw terminal result. */
function formatResult(value: QueryResult): string {
  const parts: string[] = []
  if (value.stdout.length > 0) parts.push(value.stdout)
  if (value.stderr.length > 0) parts.push(`[stderr]\n${value.stderr}`)
  if (value.truncated) parts.push('… 输出超过上限，已截断（可缩小查询或增加 maxResultChars）')
  if (value.exitCode !== 0) parts.push(`[exit code: ${value.exitCode ?? 'signal'}]`)
  return parts.join('\n')
}

/** Format the structured result as JSON text (the canonical value stays JSON). */
function formatStructuredResult(value: StructuredSqlResult): string {
  return '```json\n' + JSON.stringify(value, null, 2) + '\n```'
}

/** Empty and multi-statement checks shared by the write/raw tools. */
function validateSingleSql(sql: string, toolName: string): void {
  if (sql.trim().length === 0) throw new Error(toolName + ': sql 不能为空')
  assertSingleStatement(sql, toolName)
}

/** One dataset plan: pre-validated read-only SQL ready for execution. */
interface PlannedDataset {
  id: string
  sql: string
}

/**
 * The surface-neutral render-analysis tool (D1-D5): one call builds one versioned
 * analysis report from 1-6 read-only datasets and 1-8 views. The full report
 * is persisted as presentationMeta; the model only receives a short summary
 * (output.render), never the rows themselves.
 */
function defineRenderAnalysisTool(ctx: Context, resolved: ResolvedRunnerConfig) {
  return defineTool({
    name: 'render-analysis',
    description:
      'Render one versioned analysis report (v1) from 1-6 read-only datasets using 1-8 metric, line, bar, pie, '
      + 'scatter, or table views, then save an offline Dashboard HTML file under analysis-reports/ in the current '
      + 'session workspace. First use sql-query to inspect and verify data, '
      + 'then call this tool only when visualization adds value. Use one primary chart for a simple relationship '
      + 'or 3-6 complementary views for multi-metric, time-series, or segmented analysis. Put aggregation, Top N, '
      + 'and sorting in SQL, and add ORDER BY for line or time datasets. Reuse a dataset across views via datasetId; '
      + 'each dataset runs once. Arbitrary chart options, scripts, HTML, CSS, and URLs are not accepted. Empty datasets '
      + 'are valid and render as no-data states.',
    parameters: RENDER_ANALYSIS_PARAMETERS,
    output: {
      schema: ANALYSIS_REPORT_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: formatAnalysisSummary(value as unknown as AnalysisReportV1),
      }],
      presentationMeta: (_args, value) => value as unknown as JsonValue,
    },
    presentCall: (args) => ({
      card: 'generic',
      kind: 'edit',
      title: 'render-analysis《' + sanitizePresentationText(args.title) + '》',
      rawInput: sanitizePresentationText(args.title),
      locations: [{ path: analysisArtifactRelativePath(args.title, args.outputName) }],
    }),
    presentResult: (args, result) => ({
      card: 'generic',
      title: 'render-analysis《' + sanitizePresentationText(args.title) + '》',
      content: result.content.map(item => item.type === 'text'
        ? { ...item, text: sanitizePresentationText(item.text) }
        : item),
    }),
    async execute(args, exec) {
      const request = parseAnalysisRequest(args)
      const connection = await requireToolConnection(ctx, exec, 'render-analysis')
      // Pre-validate every dataset BEFORE the first query: a write statement,
      // multi-statement SQL or oversized text anywhere rejects the whole call
      // with no partial execution.
      const planned: PlannedDataset[] = request.datasets.map((dataset) => {
        const sql = dataset.sql
        if (sql.trim().length === 0) throw new Error('render-analysis: dataset "' + dataset.id + '" 的 sql 不能为空')
        if (sql.length > resolved.maxQueryChars) {
          throw new Error('render-analysis: dataset "' + dataset.id + '" 的 sql 超过长度上限（' + resolved.maxQueryChars + ' 字符）')
        }
        assertSingleStatement(sql, 'render-analysis')
        if (classifyStatement(sql, connection.type) !== 'read') {
          throw new Error('render-analysis: dataset "' + dataset.id + '" 必须是读语句（SELECT/SHOW/DESCRIBE/EXPLAIN，SQLite 还含查询型 PRAGMA）')
        }
        return { id: dataset.id, sql: enforceReadRowLimit(sql, connection.type, resolved.maxRows) }
      })
      // Sequential execution (D4): one client process at a time, request order,
      // each dataset exactly once. Any failure discards the in-memory results.
      const results = new Map<string, DatasetRows>()
      for (const item of planned) {
        let read
        try {
          read = await runStructuredReadQuery(ctx, connection, item.sql, resolved, 'render-analysis', exec.signal)
        } catch (error) {
          // Preserve cancellation semantics: an aborted exec signal must keep
          // propagating its abort reason instead of a wrapped tool error.
          if (exec.signal.aborted) throw error
          const message = error instanceof Error ? error.message : String(error)
          throw new Error('render-analysis: dataset "' + item.id + '" 执行失败：' + message)
        }
        if (read.truncated) {
          throw new Error('render-analysis: dataset "' + item.id + '" 的查询结果被截断（超过 maxRows/maxResultChars）；请缩小、聚合或拆分查询')
        }
        results.set(item.id, { columns: read.columns, rows: read.rows })
      }
      validateViewSemantics(request.views, results)
      const report: AnalysisReportV1 = {
        version: ANALYSIS_REPORT_VERSION,
        title: request.title,
        ...request.summary !== undefined ? { summary: request.summary } : {},
        datasets: request.datasets.map((dataset) => {
          const data = results.get(dataset.id)!
          return { id: dataset.id, columns: data.columns, rows: rowsToArrays(data.columns, data.rows) }
        }),
        views: request.views,
      }
      const bytes = reportJsonBytes(report)
      if (bytes > MAX_REPORT_BYTES) {
        throw new Error('render-analysis: 报告 JSON 超过 ' + MAX_REPORT_BYTES + ' 字节上限（当前 ' + bytes + ' 字节）；请聚合、筛选或拆分报告，不得静默删减数据')
      }
      const sessionCwd = (exec.agent as { session?: { header?: { cwd?: unknown } } } | undefined)?.session?.header?.cwd
      const complete = await writeAnalysisHtml(report, {
        cwd: typeof sessionCwd === 'string' && sessionCwd.length > 0 ? sessionCwd : process.cwd(),
        outputName: request.outputName,
      })
      return complete as InferValue<typeof ANALYSIS_REPORT_OUTPUT_SCHEMA>
    },
  })
}

/**
 * Mount the data-agent database tools: `sql-query` (structured read-only),
 * `sql-write` (explicit write semantics), and `sql-cmd` (raw compatibility).
 * @param ctx - the preset-scoped agent context.
 * @param config - validated loader configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedRunnerConfig = {
    queryTimeoutMs: config.queryTimeoutMs,
    maxResultChars: config.maxResultChars,
    maxRows: config.maxRows,
    maxQueryChars: config.maxQueryChars,
    readonly: config.readonly,
    clients: config.clients,
  }

  ctx.tools.register(defineTool({
    name: 'sql-query',
    description:
      'Execute exactly one read-only SQL statement (SELECT, SHOW, DESCRIBE, EXPLAIN, or a read-only SQLite PRAGMA) '
      + 'on the connected database. Returns structured JSON with columns, rows, affectedRows, elapsedMs, and truncated. '
      + `An unbounded SELECT is limited automatically, and every result is capped at ${resolved.maxRows} rows. `
      + 'Use sql-write for write operations and sql-cmd when raw database-client output is required.',
    parameters: {
      sql: {
        type: 'string',
        required: true,
        description: '一条符合当前数据库方言的只读 SQL，如 "SELECT * FROM orders;"、"SHOW TABLES;"、"DESCRIBE users;"',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          columns: {
            type: 'array',
            items: { type: 'string' },
            required: true,
          },
          rows: {
            type: 'array',
            items: {
              type: 'object',
              properties: {},
              additionalProperties: true,
            },
            required: true,
          },
          affectedRows: { type: 'integer', required: true },
          elapsedMs: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: formatStructuredResult(value as StructuredSqlResult) }],
    },
    presentCall: (args) => ({
      card: 'generic',
      kind: 'read',
      title: `sql-query ${oneLine(args.sql)}`,
      rawInput: args.sql,
    }),
    presentResult: (args, result) => ({
      card: 'generic',
      title: `sql-query ${oneLine(args.sql)}`,
      content: result.content,
    }),
    async execute(args, exec) {
      const connection = await requireToolConnection(ctx, exec, 'sql-query')
      const read = await runStructuredReadQuery(ctx, connection, args.sql, resolved, 'sql-query', exec.signal)
      return {
        columns: read.columns,
        rows: read.rows,
        affectedRows: 0,
        elapsedMs: read.elapsedMs,
        truncated: read.truncated,
      } satisfies StructuredSqlResult
    },
  }))

  ctx.tools.register(defineTool({
    name: 'sql-write',
    description:
      'Execute exactly one write or administrative SQL statement, such as INSERT, UPDATE, DELETE, or DDL, on the '
      + 'connected database. Each call starts an independent database-client process and auto-commits. Multi-statement '
      + 'transactions cannot span calls; use one atomic statement such as INSERT ... SELECT, or a database-side script '
      + 'or stored procedure. Use sql-query for read-only queries.',
    parameters: {
      sql: {
        type: 'string',
        required: true,
        description: '一条写/管理 SQL，如 "INSERT INTO t VALUES (1);"、"UPDATE t SET x=1;"、"CREATE INDEX idx_t_x ON t(x);"',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
          stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: formatResult(value as QueryResult) }],
    },
    presentCall: (args) => ({
      card: 'terminal',
      title: `sql-write ${oneLine(args.sql)}`,
      description: '执行一条写/管理 SQL（自动提交）',
    }),
    presentResult: (args, result) => ({
      card: 'terminal',
      title: `sql-write ${oneLine(args.sql)}`,
      content: result.content,
    }),
    async execute(args, exec) {
      const connection = await requireToolConnection(ctx, exec, 'sql-write')
      validateSingleSql(args.sql, 'sql-write')
      if (classifyStatement(args.sql, connection.type) === 'read') {
        throw new Error('sql-write 只执行写/管理语句；只读查询请使用 sql-query')
      }
      const readonly = connection.readonly ?? resolved.readonly
      if (readonly) {
        throw new Error('当前连接为只读模式，sql-write 拒绝执行写/管理语句（仅放行 SELECT/SHOW/DESCRIBE/EXPLAIN/查询型 PRAGMA 等）')
      }
      return runRedactedClientQuery(ctx, connection, args.sql, runnerOptions(resolved), exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'sql-cmd',
    description:
      'Execute exactly one SQL statement or database-client command, such as SHOW TABLES or DESCRIBE users, on the '
      + 'connected database and return raw exitCode, stdout, stderr, and truncated fields. Prefer sql-query for '
      + 'structured read results and sql-write for explicit write semantics. Read SELECT results are limited to '
      + `${resolved.maxRows} rows. Each call starts an independent database-client process and auto-commits.`,
    parameters: {
      sql: {
        type: 'string',
        required: true,
        description: '一条符合当前数据库方言的 SQL 文本（或数据库命令），如 "SHOW TABLES;"、"DESCRIBE users;"、"SELECT * FROM orders;"',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
          stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: formatResult(value as QueryResult) }],
    },
    presentCall: (args) => ({
      card: 'terminal',
      title: `sql-cmd ${oneLine(args.sql)}`,
      description: '在数据库客户端执行一条 SQL',
    }),
    presentResult: (args, result) => ({
      card: 'terminal',
      title: `sql-cmd ${oneLine(args.sql)}`,
      content: result.content,
    }),
    async execute(args, exec) {
      const connection = await requireToolConnection(ctx, exec, 'sql-cmd')
      validateSingleSql(args.sql, 'sql-cmd')
      const readonly = connection.readonly ?? resolved.readonly
      if (readonly && classifyStatement(args.sql, connection.type) === 'write') {
        throw new Error('当前连接为只读模式，sql-cmd 拒绝执行非读语句（仅放行 SELECT/SHOW/DESCRIBE/EXPLAIN/查询型 PRAGMA 等）')
      }
      const sql = classifyStatement(args.sql, connection.type) === 'read'
        ? enforceReadRowLimit(args.sql, connection.type, resolved.maxRows)
        : args.sql
      return runRedactedClientQuery(ctx, connection, sql, runnerOptions(resolved), exec.signal)
    },
  }))

  // Mounted in the data-agent standing preset scope: every UI gets the same
  // file-producing tool, while Web may additionally render presentationMeta.
  ctx.tools.register(defineRenderAnalysisTool(ctx, resolved))
  applyCatalogTools(ctx)
}
