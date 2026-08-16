/**
 * Surface-independent database connection service shared by Web routes,
 * agent tools, and human commands.
 *
 * Runtime records may contain one temporary Web password. Durable records
 * never do: they contain a non-secret profile plus an optional credential
 * reference that is resolved again at the start of every database operation.
 * @module @yejiming/dsh-data-agent/connections
 */
import type { Context } from '@deepseek-ai/cordis';
import { type ClientConfig, type ColumnInfo } from './clients.ts';
import { type QueryResult } from './query.ts';
/** Key of the wildcard connection applied to sessions without an exact entry. */
export declare const WILDCARD_SESSION = "*";
/** Supported database client kinds. */
export type DatabaseType = 'mysql' | 'postgres' | 'sqlite' | 'oracle' | 'hive' | 'impala';
/** Safe credential facts returned to UI/command surfaces. */
export interface CredentialSummary {
    configured: boolean;
    source?: string;
}
/** One connect request accepted by every surface. */
export interface DatabaseConnectionInput {
    type: DatabaseType;
    host?: string;
    port?: number;
    user?: string;
    database: string;
    /** Temporary Web-only secret, retained in this process only. */
    password?: string;
    /** Non-secret DSH credential reference, mutually exclusive with password. */
    passwordRef?: string;
    readonly?: boolean;
    /** Optional stable durable profile id. */
    profileId?: string;
    /** Optional human-readable profile label. */
    name?: string;
}
/** Runtime connection. `tables` and temporary `password` are never durable. */
export interface DatabaseConnection extends DatabaseConnectionInput {
    tables?: string[];
}
/** Password-free public connection view. */
export interface ConnectionSummary {
    type: DatabaseType;
    host?: string;
    port?: number;
    user?: string;
    database: string;
    passwordRef?: string;
    readonly?: boolean;
    profileId?: string;
    name?: string;
    tables?: string[];
    credential?: CredentialSummary;
}
/** Value stored in the `profiles` domain table. Never add secrets here. */
export interface PersistedConnectionProfile {
    name?: string;
    type: DatabaseType;
    host?: string;
    port?: number;
    user?: string;
    database: string;
    readonly?: boolean;
    passwordRef?: string;
    updatedAt: string;
}
/** Value stored in the `bindings` domain table. */
export interface SessionConnectionBinding {
    profileId: string;
    updatedAt: string;
}
/** Non-secret values restored when a session reopens an interactive form. */
export interface ConnectionFormDraft {
    type: DatabaseType;
    host: string;
    port: string;
    user: string;
    database: string;
    readonly: boolean;
}
/** Durable draft record. Passwords and credential references are forbidden. */
export interface PersistedConnectionFormDraft extends ConnectionFormDraft {
    updatedAt: string;
}
/** Minimal durable seam; backed by a DSH storage domain in production. */
export interface ConnectionPersistence {
    getProfile(profileId: string): PersistedConnectionProfile | undefined;
    putProfile(profileId: string, profile: PersistedConnectionProfile): Promise<void>;
    deleteProfile(profileId: string): Promise<boolean>;
    getBinding(sessionId: string): SessionConnectionBinding | undefined;
    putBinding(sessionId: string, binding: SessionConnectionBinding): Promise<void>;
    deleteBinding(sessionId: string): Promise<boolean>;
    getDraft?(sessionId: string): PersistedConnectionFormDraft | undefined;
    putDraft?(sessionId: string, draft: PersistedConnectionFormDraft): Promise<void>;
}
/** Shared service configuration supplied by the host plugin. */
export interface ConnectionServiceOptions {
    connectTimeoutMs: number;
    queryTimeoutMs: number;
    maxResultChars: number;
    maxQueryChars?: number;
    introspectMaxTables: number;
    readonly: boolean;
    clients: Partial<Record<string, ClientConfig>>;
    cwd?: string;
}
export interface ConnectResult {
    tables: string[];
    summary: ConnectionSummary;
}
/** Host-plane service (`ctx.dataAgentConnections`). */
export interface DataAgentConnections {
    /** Compatibility setter for config seeds/tests; does not persist. */
    set(sessionId: string, connection: DatabaseConnection): void;
    /** Password-free synchronous status (runtime/binding/wildcard resolution). */
    get(sessionId: string): ConnectionSummary | undefined;
    /** Compatibility internal read; credential references remain unresolved. */
    getWithSecret(sessionId: string): DatabaseConnection | undefined;
    has(sessionId: string): boolean;
    /** Compatibility runtime-only clear. Use disconnect() for durable bindings. */
    clear(sessionId: string): void;
    /** Restore the latest non-secret interactive form values for this session. */
    getFormDraft(sessionId: string): ConnectionFormDraft | undefined;
    /** Save non-secret form values; the implementation never accepts a password. */
    saveFormDraft(sessionId: string, draft: ConnectionFormDraft): Promise<void>;
    status(sessionId: string): Promise<ConnectionSummary | undefined>;
    connect(sessionId: string, input: DatabaseConnectionInput, signal: AbortSignal): Promise<ConnectResult>;
    disconnect(sessionId: string): Promise<void>;
    test(sessionId: string, signal: AbortSignal): Promise<ConnectResult>;
    resolveForExecution(sessionId: string): Promise<DatabaseConnection>;
    listSchemas(sessionId: string, signal: AbortSignal): Promise<string[]>;
    listTables(sessionId: string, schema: string | undefined, signal: AbortSignal): Promise<string[]>;
    describe(sessionId: string, schema: string | undefined, table: string, signal: AbortSignal): Promise<ColumnInfo[]>;
    query(sessionId: string, sql: string, signal: AbortSignal): Promise<QueryResult>;
}
/** Build a password-stripped copy of one connection. */
export declare function summarize(connection: DatabaseConnection): ConnectionSummary;
/** Replace every occurrence of a resolved secret before crossing a public seam. */
export declare function redactSecretText(text: string, secrets: readonly (string | undefined)[]): string;
/** Redact a client result without mutating the runner-owned object. */
export declare function redactQueryResult(result: QueryResult, connection: DatabaseConnection): QueryResult;
/** Validate/normalize a shared connect input before any I/O. */
export declare function normalizeConnectionInput(input: DatabaseConnectionInput, cwd?: string): DatabaseConnection;
/** Create the surface-independent service. */
export declare function createConnectionService(ctx?: Context, options?: ConnectionServiceOptions, persistence?: ConnectionPersistence): DataAgentConnections;
/** Backward-compatible in-memory store factory used by embedders/tests. */
export declare function createConnectionStore(): DataAgentConnections;
