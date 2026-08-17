/**
 * Web adapter for the shared data-agent connection service.
 *
 * This entry owns only HTTP parsing/serialization. Connection validation,
 * credentials, persistence, metadata, query safety, and error semantics live
 * in `DataAgentConnections`, which is also consumed by TUI commands/tools.
 * @module @yejiming/dsh-data-agent/routes
 */
import type { Context } from '@deepseek-ai/cordis';
import z from 'schemastery';
import type { DatabaseConnectionInput } from './connections.ts';
export declare const name = "data-agent-routes";
/** Headless profiles activate this row without waiting forever for webServer. */
export declare const inject: string[];
export declare const DATA_AGENT_PATH = "/plugins/data-agent";
/** Retained loader surface for backward compatibility; domain options live on the host row. */
export interface Config {
    connectTimeoutMs: number;
    introspectMaxTables: number;
    maxResultChars: number;
    queryTimeoutMs: number;
    maxQueryChars: number;
    readonly: boolean;
}
export declare const Config: z<Schemastery.ObjectS<{
    connectTimeoutMs: z<number, number>;
    introspectMaxTables: z<number, number>;
    maxResultChars: z<number, number>;
    queryTimeoutMs: z<number, number>;
    maxQueryChars: z<number, number>;
    readonly: z<boolean, boolean>;
}>, Schemastery.ObjectT<{
    connectTimeoutMs: z<number, number>;
    introspectMaxTables: z<number, number>;
    maxResultChars: z<number, number>;
    queryTimeoutMs: z<number, number>;
    maxQueryChars: z<number, number>;
    readonly: z<boolean, boolean>;
}>>;
export interface ConnectRequestBody extends DatabaseConnectionInput {
    sessionId: string;
}
/** Validate the Web wire shape while retaining temporary-password compatibility. */
export declare function validateConnectBody(value: unknown, cwd?: string): ConnectRequestBody;
/** Register Web routes only when both the webserver and shared service exist. */
export declare function apply(ctx: Context, _config: Config): void;
