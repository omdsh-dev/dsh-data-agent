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
import type { Context } from '@deepseek-ai/cordis';
import { type ClientConfig } from './clients.ts';
import { type DatabaseConnection } from './connections.ts';
import { type QueryOptions, type QueryResult } from './query.ts';
/** Tool-run context face used by the helpers. */
export interface ToolExecLike {
    agent?: {
        id: string;
    };
    signal: AbortSignal;
}
/** Resolved runner options shared by the database tools. */
export interface ResolvedRunnerConfig {
    queryTimeoutMs: number;
    maxResultChars: number;
    maxRows: number;
    maxQueryChars: number;
    /** Read-only guard: true rejects write statements. */
    readonly: boolean;
    clients: Readonly<Partial<Record<string, ClientConfig>>>;
}
/** Canonical structured read result (elapsed/truncation metadata included). */
export interface StructuredReadResult {
    columns: string[];
    rows: Record<string, string | null>[];
    elapsedMs: number;
    truncated: boolean;
}
/** Look up the session connection, failing with the same message for every tool. */
export declare function requireToolConnection(ctx: Context, exec: ToolExecLike, toolName: string): Promise<DatabaseConnection>;
/** Run and redact a client result/error before it reaches tool/session output. */
export declare function runRedactedClientQuery(ctx: Context, connection: DatabaseConnection, sql: string, options: QueryOptions, signal: AbortSignal): Promise<QueryResult>;
/** Query runner options with the deployment overrides applied. */
export declare function runnerOptions(resolved: Pick<ResolvedRunnerConfig, 'queryTimeoutMs' | 'maxResultChars' | 'clients'>, mode?: QueryOptions['mode']): QueryOptions;
/**
 * Execute one read-only SQL through the structured client template and parse
 * it into the canonical { columns, rows } shape, with maxRows enforced at both
 * the SQL level (dialect rewrite) and the parse level.
 */
export declare function runStructuredReadQuery(ctx: Context, connection: DatabaseConnection, sql: string, resolved: ResolvedRunnerConfig, toolName: string, signal: AbortSignal): Promise<StructuredReadResult>;
