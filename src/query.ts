/**
 * The shared database runner used by both halves: the /connect connectivity
 * check (server half) and the database tools (tool half). CLI-backed adapters
 * go through `ctx.subprocess` with argv arrays, SQL on stdin, and credentials
 * in their dedicated environment/stdin channel. ClickHouse uses the official
 * Node HTTP client with explicit transport/authentication fields. Both paths
 * share caller-owned cancellation, deadlines, and bounded captured output.
 * @module @yejiming/dsh-data-agent/query
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { createClient } from '@clickhouse/client'
// Type-only: pulls the ctx.subprocess merge (the subprocess host plugin).
import type {} from '@deepseek-ai/dsh-subprocess'
import type { DatabaseConnection, DatabaseType } from './connections.ts'
import {
  buildClientTemplate,
  buildIntrospectTemplate,
  buildStructuredQueryTemplate,
  classifyStatement,
  stripSqlServerRowCountFooter,
  type ClientConfig,
} from './clients.ts'
import { resolveClientExecutable } from './client-discovery.ts'
import { defaultDatabasePort, defaultDatabaseUser } from './database-types.ts'
import { DEFAULT_GRACE_MS } from './defaults.ts'
import { assertSqlServerSafeInput } from './sql.ts'

/** One bounded captured-output read (the tail when truncated). */
export interface CapturedOutput {
  text: string
  truncated: boolean
}

/** The canonical database-tool / connectivity-check result. */
export interface QueryResult {
  /** Process exit code; null when the process died from a signal. */
  exitCode: number | null
  /** Captured stdout (tail when truncated). */
  stdout: string
  /** Captured stderr (tail when truncated). */
  stderr: string
  /** True when either stream hit the maxResultChars cap. */
  truncated: boolean
}

/** Which deterministic raw/introspection/structured output mode to use. */
export type QueryTemplateMode = 'query' | 'introspect' | 'structured'

/** Runner options: client overrides, deadlines, output caps. */
export interface QueryOptions {
  /** Deployment CLI overrides keyed by CLI-backed database type. */
  clients: Readonly<Partial<Record<DatabaseType, ClientConfig>>>
  /** End-to-end deadline in milliseconds (timeout → terminate the tree). */
  timeoutMs: number
  /** In-memory cap per captured stream. */
  maxResultChars: number
  /** Grace period for the terminate escalation; defaults to 5s. */
  graceMs?: number
  /** CLI flag set; overrides the legacy `introspect` parameter when set. */
  mode?: QueryTemplateMode
}

/** Read one collected stream from offset 0. */
function readCaptured(reader: { readFrom(fromByte: number): { text: string; lossy: boolean } } | undefined): CapturedOutput {
  if (reader === undefined) return { text: '', truncated: false }
  const read = reader.readFrom(0)
  return { text: read.text, truncated: read.lossy }
}

/** ClickHouse endpoint construction never embeds username or password. */
export function clickHouseConnectionUrl(connection: DatabaseConnection): string {
  const secure = connection.secure === true
  const url = new URL(`${secure ? 'https' : 'http'}://127.0.0.1`)
  url.hostname = connection.host ?? '127.0.0.1'
  url.port = String(connection.port ?? defaultDatabasePort('clickhouse', secure))
  return url.toString()
}

async function collectClickHouseStream(
  stream: AsyncIterable<unknown> & { destroy?: (error?: Error) => void },
  maxBytes: number,
  signal: AbortSignal,
): Promise<CapturedOutput> {
  const chunks: Buffer[] = []
  let size = 0
  let truncated = false
  for await (const chunk of stream) {
    signal.throwIfAborted()
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    const remaining = maxBytes - size
    if (remaining <= 0) {
      truncated = true
      stream.destroy?.()
      break
    }
    if (buffer.byteLength > remaining) {
      chunks.push(buffer.subarray(0, remaining))
      size += remaining
      truncated = true
      stream.destroy?.()
      break
    }
    chunks.push(buffer)
    size += buffer.byteLength
  }
  return { text: Buffer.concat(chunks, size).toString('utf8'), truncated }
}

async function runClickHouseQuery(
  connection: DatabaseConnection,
  sql: string,
  options: QueryOptions,
  signal: AbortSignal,
): Promise<QueryResult> {
  const client = createClient({
    url: clickHouseConnectionUrl(connection),
    username: connection.user ?? defaultDatabaseUser('clickhouse'),
    password: connection.password ?? '',
    database: connection.database,
    request_timeout: options.timeoutMs,
  })
  try {
    if (classifyStatement(sql, 'clickhouse') !== 'read') {
      await client.command({
        query: sql,
        abort_signal: signal,
        clickhouse_settings: { wait_end_of_query: 1 },
      })
      return { exitCode: 0, stdout: '', stderr: '', truncated: false }
    }
    const format = options.mode === 'structured'
      ? 'JSONCompactEachRowWithNamesAndTypes'
      : options.mode === 'introspect'
        ? 'TabSeparated'
        : 'TabSeparatedWithNames'
    const { stream } = await client.exec({
      query: sql,
      abort_signal: signal,
      clickhouse_settings: { default_format: format },
    })
    const stdout = await collectClickHouseStream(stream, options.maxResultChars, signal)
    return { exitCode: 0, stdout: stdout.text, stderr: '', truncated: stdout.truncated }
  } finally {
    await client.close()
  }
}

/**
 * Run one SQL text through the type's shared adapter. CLI SQL is written to
 * child stdin (`{ data }` batch disposition), while ClickHouse SQL is an HTTP
 * request body; neither path puts SQL or credentials in argv.
 *
 * Failure classification:
 * - the caller's external signal (e.g. the tool exec signal) aborts → the
 *   abort reason propagates;
 * - the internal timeout fires → an Error naming the deadline is thrown;
 * - the executable cannot be resolved → an Error naming the command is thrown;
 * - the process runs to completion → `{ exitCode, stdout, stderr, truncated }`
 *   is returned even for a non-zero exit (the caller decides what that means).
 * @param ctx - context exposing the subprocess service.
 * @param connection - the stored connection (password included).
 * @param sql - the SQL text (or client command) to run.
 * @param options - timeouts, caps, client overrides.
 * @param externalSignal - caller-owned cancellation (the tool exec signal).
 * @param introspect - use the machine-readable introspection flag set.
 * @returns the captured outcome.
 */
export async function runClientQuery(
  ctx: Context,
  connection: DatabaseConnection,
  sql: string,
  options: QueryOptions,
  externalSignal: AbortSignal,
  introspect = false,
): Promise<QueryResult> {
  // One controller owns the whole attempt: the internal deadline and the
  // caller's cancellation both abort it, and the subprocess terminate
  // escalation reacts to the same signal.
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error(`查询超过 ${options.timeoutMs}ms 未完成，已终止客户端进程`)),
    options.timeoutMs,
  )
  const onExternalAbort = (): void => { controller.abort(externalSignal.reason) }
  if (externalSignal.aborted) controller.abort(externalSignal.reason)
  else externalSignal.addEventListener('abort', onExternalAbort, { once: true })

  try {
    if (connection.type === 'clickhouse') {
      return await runClickHouseQuery(
        connection,
        sql,
        { ...options, mode: options.mode ?? (introspect ? 'introspect' : 'query') },
        controller.signal,
      )
    }
    if (connection.type === 'sqlserver') assertSqlServerSafeInput(sql)
    const template = options.mode === 'structured'
      ? buildStructuredQueryTemplate(connection.type, connection, options.clients[connection.type])
      : options.mode === 'introspect' || introspect
        ? buildIntrospectTemplate(connection.type, connection, options.clients[connection.type])
        : buildClientTemplate(connection.type, connection, options.clients[connection.type])
    const resolution = await resolveClientExecutable({
      type: connection.type,
      command: template.command,
      config: options.clients[connection.type],
      env: template.env,
      signal: controller.signal,
      resolveExecutable: ctx.subprocess.resolveExecutable.bind(ctx.subprocess),
    })

    const handle = ctx.subprocess.spawn({
      argv: [resolution.executable, ...template.args],
      cwd: process.cwd(),
      stdio: {
        // The Oracle/Hive connect prefix (template.stdinPrefix) is written
        // before the SQL, so their credentials travel on stdin, never argv.
        stdin: { data: `${template.stdinPrefix}${sql}\n` },
        stdout: { maxBytes: options.maxResultChars },
        stderr: { maxBytes: options.maxResultChars },
      },
      graceMs: options.graceMs ?? DEFAULT_GRACE_MS,
      signal: controller.signal,
      env: resolution.env,
    })

    let outcome: SubprocessOutcome
    try {
      outcome = await handle.done
    } catch (error) {
      // A spawn-level failure; classify the abort cases first.
      controller.signal.throwIfAborted()
      throw new Error(`启动数据库客户端失败：${error instanceof Error ? error.message : String(error)}`)
    }

    // The abort signal fired (deadline or caller cancellation): surface the
    // abort reason — the timeout Error for our timer, the caller's reason
    // otherwise — instead of a bare killed-process result.
    if (controller.signal.aborted) controller.signal.throwIfAborted()

    const stdout = readCaptured(handle.collected.stdout)
    const stderr = readCaptured(handle.collected.stderr)
    const result = {
      exitCode: outcome.exitCode,
      stdout: connection.type === 'sqlserver' ? stripSqlServerRowCountFooter(stdout.text) : stdout.text,
      stderr: stderr.text,
      truncated: stdout.truncated || stderr.truncated,
    }
    return result
  } finally {
    clearTimeout(timer)
    externalSignal.removeEventListener('abort', onExternalAbort)
  }
}
