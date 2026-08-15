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
 * - `sqlcmd`: the original raw-terminal tool (kept for compatibility).
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
import { defineTool } from '@deepseek-ai/dsh-tools'
// Type-only: pulls the ctx.subprocess merge (the subprocess host plugin) and
// the ctx.dataAgentConnections merge (the main data-agent row).
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from './index.ts'
import { clientsSchema, classifyStatement, enforceReadRowLimit, type ClientConfig } from './clients.ts'
import {
  DEFAULT_MAX_RESULT_CHARS,
  DEFAULT_QUERY_TIMEOUT_MS,
} from './defaults.ts'
import { runClientQuery, type QueryOptions, type QueryResult } from './query.ts'
import { assertSingleStatement } from './sql.ts'
import { parseStructuredQueryOutput } from './structured.ts'

/** Cordis plugin name (diagnostics only). */
export const name = 'data-agent-tool'

/** Services required before the tool can register. */
export const inject = ['tools', 'subprocess', 'dataAgentConnections']

/** Tool-half configuration (loader schema with the same defaults as the host). */
export interface Config {
  /** Deadline for one sqlcmd / sql-query / sql-write query, milliseconds. */
  queryTimeoutMs: number
  /** In-memory cap on captured output. */
  maxResultChars: number
  /** Enforced read-query row cap (LIMIT injection + structured truncation). */
  maxRows: number
  /** Read-only guard: true rejects write statements. */
  readonly: boolean
  /** CLI client overrides keyed by database type. */
  clients: Partial<Record<string, ClientConfig>>
}

/** Loader schema with deployment defaults (no library defaults). */
export const Config = z.object({
  queryTimeoutMs: z.number().step(1).min(1000).default(DEFAULT_QUERY_TIMEOUT_MS),
  maxResultChars: z.number().step(1).min(1024).default(DEFAULT_MAX_RESULT_CHARS),
  maxRows: z.number().step(1).min(1).default(100),
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

/** Tool-run context face used by the helpers. */
interface ToolExecLike {
  agent?: { id: string }
  signal: AbortSignal
}

/** Look up the session connection, failing with the same message for every tool. */
function requireToolConnection(ctx: Context, exec: ToolExecLike, toolName: string) {
  const sessionId = exec.agent?.id
  if (sessionId === undefined) {
    throw new Error(`${toolName}: 缺少会话上下文（agent loop 未注入）`)
  }
  const connection = ctx.dataAgentConnections.getWithSecret(sessionId)
  if (connection === undefined) {
    throw new Error(`请先在「数据库」标签页连接数据库，再使用 ${toolName}（未找到当前会话的连接）`)
  }
  return connection
}

/** Empty and multi-statement checks shared by all three tools. */
function validateSingleSql(sql: string, toolName: string): void {
  if (sql.trim().length === 0) throw new Error(`${toolName}: sql 不能为空`)
  assertSingleStatement(sql, toolName)
}

/** Query runner options with the deployment overrides applied. */
function runnerOptions(resolved: {
  queryTimeoutMs: number
  maxResultChars: number
  clients: Config['clients']
}, mode?: QueryOptions['mode']): QueryOptions {
  return {
    clients: resolved.clients,
    timeoutMs: resolved.queryTimeoutMs,
    maxResultChars: resolved.maxResultChars,
    ...mode !== undefined ? { mode } : {},
  }
}

/**
 * Mount the data-agent database tools: `sql-query` (structured read-only),
 * `sql-write` (explicit write semantics), and `sqlcmd` (raw compatibility).
 * @param ctx - the preset-scoped agent context.
 * @param config - validated loader configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = {
    queryTimeoutMs: config.queryTimeoutMs,
    maxResultChars: config.maxResultChars,
    maxRows: config.maxRows,
    readonly: config.readonly,
    clients: config.clients,
  }

  ctx.tools.register(defineTool({
    name: 'sql-query',
    description:
      '在已连接数据库上执行一条只读 SQL（SELECT/SHOW/DESCRIBE/EXPLAIN，SQLite 还含查询型 PRAGMA），'
      + '返回结构化 JSON：{ columns, rows, affectedRows, elapsedMs, truncated }。'
      + `SELECT 未写 LIMIT 时会自动限制为最多 ${resolved.maxRows} 行；所有结果最多返回 ${resolved.maxRows} 行。`
      + '只执行单条语句；写操作请使用 sql-write，原始客户端输出请使用 sqlcmd。',
    parameters: {
      sql: {
        type: 'string',
        required: true,
        description: '一条只读 SQL，如 "SELECT * FROM orders LIMIT 5;"、"SHOW TABLES;"、"DESCRIBE users;"',
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
      const connection = requireToolConnection(ctx, exec, 'sql-query')
      validateSingleSql(args.sql, 'sql-query')
      if (classifyStatement(args.sql, connection.type) !== 'read') {
        throw new Error('sql-query 只执行读语句（SELECT/SHOW/DESCRIBE/EXPLAIN，SQLite 还含查询型 PRAGMA）；写语句请使用 sql-write')
      }
      const limitedSql = enforceReadRowLimit(args.sql, connection.type, resolved.maxRows)
      const startedAt = Date.now()
      const result = await runClientQuery(ctx, connection, limitedSql, runnerOptions(resolved, 'structured'), exec.signal)
      const elapsedMs = Date.now() - startedAt
      if (result.exitCode !== 0) {
        const detail = result.stderr.trim() !== '' ? result.stderr.trim() : result.stdout.trim()
        throw new Error(`sql-query 执行失败（exit ${result.exitCode}）：${detail}`)
      }
      const parsed = parseStructuredQueryOutput(connection.type, result.stdout, resolved.maxRows)
      return {
        columns: parsed.columns,
        rows: parsed.rows,
        affectedRows: 0,
        elapsedMs,
        truncated: result.truncated || parsed.rowLimitExceeded,
      } satisfies StructuredSqlResult
    },
  }))

  ctx.tools.register(defineTool({
    name: 'sql-write',
    description:
      '在已连接数据库上执行一条写/管理语句（INSERT/UPDATE/DELETE/DDL 等）。'
      + '每次调用都是独立客户端进程并自动提交，只接受单条语句，不支持跨调用的多语句事务；'
      + '如需原子性，请改用单条 SQL（如 INSERT ... SELECT）或数据库端脚本/存储过程。'
      + '只读查询请使用 sql-query。',
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
      const connection = requireToolConnection(ctx, exec, 'sql-write')
      validateSingleSql(args.sql, 'sql-write')
      if (classifyStatement(args.sql, connection.type) === 'read') {
        throw new Error('sql-write 只执行写/管理语句；只读查询请使用 sql-query')
      }
      const readonly = connection.readonly ?? resolved.readonly
      if (readonly) {
        throw new Error('当前连接为只读模式，sql-write 拒绝执行写/管理语句（仅放行 SELECT/SHOW/DESCRIBE/EXPLAIN/查询型 PRAGMA 等）')
      }
      return runClientQuery(ctx, connection, args.sql, runnerOptions(resolved), exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'sqlcmd',
    description:
      '在已连接数据库上执行一条 SQL 或客户端命令（如 SHOW TABLES、DESCRIBE users），'
      + '返回原始 exitCode/stdout/stderr 文本。新调用优先使用 sql-query（结构化只读结果）'
      + '和 sql-write（明确写语义）。一次只执行一条语句；读 SELECT 会自动限制最多 '
      + `${resolved.maxRows} 行；每次调用为独立客户端进程并自动提交。`,
    parameters: {
      sql: {
        type: 'string',
        required: true,
        description: '一条 SQL 文本（或客户端命令），如 "SHOW TABLES;"、"DESCRIBE users;"、"SELECT * FROM orders LIMIT 5;"',
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
      title: `sqlcmd ${oneLine(args.sql)}`,
      description: '在数据库客户端执行一条 SQL',
    }),
    presentResult: (args, result) => ({
      card: 'terminal',
      title: `sqlcmd ${oneLine(args.sql)}`,
      content: result.content,
    }),
    async execute(args, exec) {
      const connection = requireToolConnection(ctx, exec, 'sqlcmd')
      validateSingleSql(args.sql, 'sqlcmd')
      const readonly = connection.readonly ?? resolved.readonly
      if (readonly && classifyStatement(args.sql, connection.type) === 'write') {
        throw new Error('当前连接为只读模式，sqlcmd 拒绝执行非读语句（仅放行 SELECT/SHOW/DESCRIBE/EXPLAIN/查询型 PRAGMA 等）')
      }
      const sql = classifyStatement(args.sql, connection.type) === 'read'
        ? enforceReadRowLimit(args.sql, connection.type, resolved.maxRows)
        : args.sql
      return runClientQuery(ctx, connection, sql, runnerOptions(resolved), exec.signal)
    },
  }))
}
