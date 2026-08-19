/**
 * The shared database runner used by both halves: the /connect connectivity
 * check (server half) and the database tools (tool half). CLI-backed adapters
 * go through `ctx.subprocess` with argv arrays, SQL on stdin, and credentials
 * in their dedicated environment/stdin channel. ClickHouse uses the official
 * Node HTTP client with explicit transport/authentication fields. Both paths
 * share caller-owned cancellation, deadlines, and bounded captured output.
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
/** Which deterministic raw/introspection/structured output mode to use. */
export type QueryTemplateMode = 'query' | 'introspect' | 'structured';
/** Runner options: client overrides, deadlines, output caps. */
export interface QueryOptions {
    /** Deployment CLI overrides keyed by CLI-backed database type. */
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
/** ClickHouse endpoint construction never embeds username or password. */
export declare function clickHouseConnectionUrl(connection: DatabaseConnection): string;
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
export declare function runClientQuery(ctx: Context, connection: DatabaseConnection, sql: string, options: QueryOptions, externalSignal: AbortSignal, introspect?: boolean): Promise<QueryResult>;
