/**
 * The shared client-process runner used by both halves: the /connect
 * connectivity check (server half) and the sqlcmd tool (tool half). All
 * execution goes through `ctx.subprocess` — no shell layer, argv arrays only,
 * SQL on stdin, credentials in env entries — with a caller-owned timeout
 * (AbortController → process-tree terminate escalation) and bounded captured
 * output.
 * @module @yejiming/dsh-data-agent/query
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
// Type-only: pulls the ctx.subprocess merge (the subprocess host plugin).
import type {} from '@deepseek-ai/dsh-subprocess'
import type { DatabaseConnection, DatabaseType } from './connections.ts'
import { buildClientTemplate, buildIntrospectTemplate, type ClientConfig } from './clients.ts'
import { DEFAULT_GRACE_MS } from './defaults.ts'

/** One bounded captured-output read (the tail when truncated). */
export interface CapturedOutput {
  text: string
  truncated: boolean
}

/** The canonical sqlcmd / connectivity-check result. */
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

/** Runner options: client overrides, deadlines, output caps. */
export interface QueryOptions {
  /** Deployment client overrides keyed by database type. */
  clients: Readonly<Partial<Record<DatabaseType, ClientConfig>>>
  /** End-to-end deadline in milliseconds (timeout → terminate the tree). */
  timeoutMs: number
  /** In-memory cap per captured stream. */
  maxResultChars: number
  /** Grace period for the terminate escalation; defaults to 5s. */
  graceMs?: number
}

/** Read one collected stream from offset 0. */
function readCaptured(reader: { readFrom(fromByte: number): { text: string; lossy: boolean } } | undefined): CapturedOutput {
  if (reader === undefined) return { text: '', truncated: false }
  const read = reader.readFrom(0)
  return { text: read.text, truncated: read.lossy }
}

/**
 * Run one SQL text through the type's CLI client. The SQL is written to the
 * child's stdin (`{ data }` batch disposition) so it never appears in argv;
 * passwords travel in the env entries built by the template.
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
  const template = introspect
    ? buildIntrospectTemplate(connection.type, connection, options.clients[connection.type])
    : buildClientTemplate(connection.type, connection, options.clients[connection.type])

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
    let executable: string
    try {
      executable = await ctx.subprocess.resolveExecutable(template.command, template.env, controller.signal)
    } catch (error) {
      controller.signal.throwIfAborted()
      throw new Error(
        `无法解析数据库客户端 "${template.command}"（${error instanceof Error ? error.message : String(error)}）；`
        + '请确认客户端已安装，或在 data-agent 插件配置的 clients 中覆盖命令名/路径',
      )
    }

    const handle = ctx.subprocess.spawn({
      argv: [executable, ...template.args],
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
      env: template.env,
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
    return {
      exitCode: outcome.exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      truncated: stdout.truncated || stderr.truncated,
    }
  } finally {
    clearTimeout(timer)
    externalSignal.removeEventListener('abort', onExternalAbort)
  }
}
