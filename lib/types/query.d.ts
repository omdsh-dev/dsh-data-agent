/**
 * The shared client-process runner used by both halves: the /connect
 * connectivity check (server half) and the database tools (tool half). All
 * execution goes through `ctx.subprocess` — no shell layer, argv arrays only,
 * SQL on stdin, credentials in env entries — with a caller-owned timeout
 * (AbortController → process-tree terminate escalation) and bounded captured
 * output.
 * @module @yejiming/dsh-data-agent/query
 */
import type { Context } from '@deepseek-ai/cordis';
import type { DatabaseConnection, DatabaseType } from './connections.ts';
import { type ClientConfig } from './clients.ts';
/** One bounded captured-output read (the tail when truncated). */
export interface CapturedOutput {
    text: string;
    truncated: boolean;
}
/** The canonical database-tool / connectivity-check result. */
export interface QueryResult {
    /** Process exit code; null when the process died from a signal. */
    exitCode: number | null;
    /** Captured stdout (tail when truncated). */
    stdout: string;
    /** Captured stderr (tail when truncated). */
    stderr: string;
    /** True when either stream hit the maxResultChars cap. */
    truncated: boolean;
}
/** Which CLI flag set to use for one run. */
export type QueryTemplateMode = 'query' | 'introspect' | 'structured';
/** Runner options: client overrides, deadlines, output caps. */
export interface QueryOptions {
    /** Deployment client overrides keyed by database type. */
    clients: Readonly<Partial<Record<DatabaseType, ClientConfig>>>;
    /** End-to-end deadline in milliseconds (timeout → terminate the tree). */
    timeoutMs: number;
    /** In-memory cap per captured stream. */
    maxResultChars: number;
    /** Grace period for the terminate escalation; defaults to 5s. */
    graceMs?: number;
    /** CLI flag set; overrides the legacy `introspect` parameter when set. */
    mode?: QueryTemplateMode;
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
export declare function runClientQuery(ctx: Context, connection: DatabaseConnection, sql: string, options: QueryOptions, externalSignal: AbortSignal, introspect?: boolean): Promise<QueryResult>;
