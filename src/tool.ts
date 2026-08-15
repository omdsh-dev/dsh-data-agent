/**
 * The sqlcmd tool half (`@yejiming/dsh-data-agent/tool`): mounted ONLY by
 * the data-agent agent preset (`preset/data-agent/agent.cordis.yml`), never
 * by the host composition. It consumes the host's `subprocess` service and
 * the host-provided `dataAgentConnections` connection store, so it needs no
 * realm and satisfies the preset guard (a preset row that only consumes).
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
import type { DatabaseType } from './connections.ts'
import { clientsSchema, type ClientConfig } from './clients.ts'
import { classifyStatement } from './clients.ts'
import {
  DEFAULT_MAX_RESULT_CHARS,
  DEFAULT_QUERY_TIMEOUT_MS,
} from './defaults.ts'
import { runClientQuery, type QueryResult } from './query.ts'

/** Cordis plugin name (diagnostics only). */
export const name = 'data-agent-tool'

/** Services required before the tool can register. */
export const inject = ['tools', 'subprocess', 'dataAgentConnections']

/** Tool-half configuration (loader schema with the same defaults as the host). */
export interface Config {
  /** Deadline for one sqlcmd query, milliseconds. */
  queryTimeoutMs: number
  /** In-memory cap on captured output. */
  maxResultChars: number
  /** Row-count guidance injected into the tool description. */
  maxRows: number
  /** Read-only guard: true rejects write statements. */
  readonly: boolean
  /** CLI client overrides keyed by database type. */
  clients: Partial<Record<DatabaseType, ClientConfig>>
}

/** Loader schema with deployment defaults (no library defaults). */
export const Config = z.object({
  queryTimeoutMs: z.number().step(1).min(1000).default(DEFAULT_QUERY_TIMEOUT_MS),
  maxResultChars: z.number().step(1).min(1024).default(DEFAULT_MAX_RESULT_CHARS),
  maxRows: z.number().step(1).min(1).default(100),
  readonly: z.boolean().default(false),
  clients: clientsSchema,
})

/** One-line sqlcmd label for the terminal card (newlines collapsed). */
function oneLine(sql: string): string {
  const line = sql.replace(/\s+/g, ' ').trim()
  return line.length > 80 ? `${line.slice(0, 77)}...` : line
}

/** Format the canonical result as a monospace text block. */
function formatResult(value: QueryResult): string {
  const parts: string[] = []
  if (value.stdout.length > 0) parts.push(value.stdout)
  if (value.stderr.length > 0) parts.push(`[stderr]\n${value.stderr}`)
  if (value.truncated) parts.push('… 输出超过上限，已截断（可缩小查询或增加 maxResultChars）')
  if (value.exitCode !== 0) parts.push(`[exit code: ${value.exitCode ?? 'signal'}]`)
  return parts.join('\n')
}

/**
 * Mount the sqlcmd tool: register it into the current agent's tool registry.
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
    name: 'sqlcmd',
    description:
      '在已连接的数据库上执行 SQL 或客户端命令（如 SHOW TABLES、DESCRIBE users、'
      + `SELECT * FROM orders LIMIT ${resolved.maxRows}）。`
      + '需要先在「数据库」标签页连接数据库；SQL 经 stdin 传给客户端'
      + '（mysql/psql/sqlite3/sqlplus/beeline/impala-shell/clickhouse-client/sqlcmd 等），'
      + '无 shell 层。结果包含 exitCode 与 stdout/stderr 文本。',
    parameters: {
      sql: {
        type: 'string',
        required: true,
        description: '要执行的 SQL 文本（或客户端命令），如 "SHOW TABLES;"、"DESCRIBE users;"、"SELECT * FROM orders LIMIT 5;"',
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
      render: (_args, value) => [{ type: 'text', text: formatResult(value) }],
    },
    presentCall: (args) => ({
      card: 'terminal',
      title: `sqlcmd ${oneLine(args.sql)}`,
      description: '在数据库客户端执行 SQL',
    }),
    presentResult: (args, result) => ({
      card: 'terminal',
      title: `sqlcmd ${oneLine(args.sql)}`,
      content: result.content,
    }),
    async execute(args, exec) {
      const sessionId = exec.agent?.id
      if (sessionId === undefined) {
        throw new Error('sqlcmd: 缺少会话上下文（agent loop 未注入）')
      }
      const connection = ctx.dataAgentConnections.getWithSecret(sessionId)
      if (connection === undefined) {
        throw new Error('请先在「数据库」标签页连接数据库，再使用 sqlcmd（未找到当前会话的连接）')
      }
      const readonly = connection.readonly ?? resolved.readonly
      if (readonly && classifyStatement(args.sql, connection.type) === 'write') {
        throw new Error('当前连接为只读模式，sqlcmd 拒绝执行非读语句（仅放行 SELECT/SHOW/DESCRIBE/EXPLAIN/PRAGMA 等）')
      }
      return runClientQuery(ctx, connection, args.sql, {
        clients: resolved.clients,
        timeoutMs: resolved.queryTimeoutMs,
        maxResultChars: resolved.maxResultChars,
      }, exec.signal)
    },
  }))
}
