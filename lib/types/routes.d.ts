/**
 * Data Agent routes half (`@yejiming/dsh-data-agent/routes`): the
 * `/plugins/data-agent` HTTP surface. A separate row from the main `data-agent`
 * row so the plugin keeps working in headless profiles (no webserver): the
 * connection store, preset self-install, and config-seeded connections all
 * live on the main row, and this row simply never activates where
 * `webServer` is absent.
 *
 * Routes:
 * - `POST /plugins/data-agent/connect`    — validate and store one session's
 *   database connection, verify connectivity by listing all tables, and
 *   return `{ ok, tables }` (or `{ ok: false, error }` without saving).
 * - `POST /plugins/data-agent/disconnect` — drop one session's connection.
 * - `GET  /plugins/data-agent/status`     — the current connection's
 *   password-stripped summary plus the table list.
 * - `GET  /plugins/data-agent/schemas`    — schema/database list.
 * - `GET  /plugins/data-agent/tables`     — table list of one schema.
 * - `GET  /plugins/data-agent/describe`   — column structure of one table.
 * - `POST /plugins/data-agent/query`      — run one SQL text (the workbench
 *   command box; non-agent channel, same trust as sqlcmd).
 * @module @yejiming/dsh-data-agent/routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
/**
 * Minimal face of the host webserver service used by this row.
 * The service was renamed from `httpServer` to `webServer` in
 * dsh 0.1.0-rc.6; the nested inject below waits on `webServer`.
 */
interface WebServerLike {
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        webServer: WebServerLike;
    }
}
import type { DatabaseType } from './connections.ts';
/** Cordis plugin name (diagnostics only). */
export declare const name = "data-agent-routes";
/**
 * No top-level `inject` export: the row must ACTIVATE even in headless
 * profiles where `webServer` never exists (a permanently pending entry
 * breaks one-shot runs). The routes register through a nested inject fiber
 * the moment the webserver and the connection store are both available.
 */
export declare const inject: string[];
/** Route prefix owned by this plugin (the browser half calls under it). */
export declare const DATA_AGENT_PATH = "/plugins/data-agent";
/** Routes-half configuration (defaults mirror the main row). */
export interface Config {
    /** Deadline for one /connect connectivity check, milliseconds. */
    connectTimeoutMs: number;
    /** Cap on metadata lists returned by /connect /status /schemas /tables. */
    introspectMaxTables: number;
    /** In-memory cap on captured output. */
    maxResultChars: number;
    /** Deadline for one /query or metadata query, milliseconds. */
    queryTimeoutMs: number;
    /** Cap on one /query SQL text length. */
    maxQueryChars: number;
}
/** Loader schema with deployment defaults (no library defaults). */
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
    connectTimeoutMs: import("@deepseek-ai/schemastery").default<number, number>;
    introspectMaxTables: import("@deepseek-ai/schemastery").default<number, number>;
    maxResultChars: import("@deepseek-ai/schemastery").default<number, number>;
    queryTimeoutMs: import("@deepseek-ai/schemastery").default<number, number>;
    maxQueryChars: import("@deepseek-ai/schemastery").default<number, number>;
}>, Schemastery.ObjectT<{
    connectTimeoutMs: import("@deepseek-ai/schemastery").default<number, number>;
    introspectMaxTables: import("@deepseek-ai/schemastery").default<number, number>;
    maxResultChars: import("@deepseek-ai/schemastery").default<number, number>;
    queryTimeoutMs: import("@deepseek-ai/schemastery").default<number, number>;
    maxQueryChars: import("@deepseek-ai/schemastery").default<number, number>;
}>>;
/** The connection request wire body (validated in the /connect handler). */
export interface ConnectRequestBody {
    sessionId: string;
    type: DatabaseType;
    host?: string;
    port?: number;
    user?: string;
    database: string;
    password?: string;
}
/**
 * Validate an untrusted /connect body; sqlite paths resolve to absolute
 * (the client resolves the path relative to its own cwd, so the server pins
 * it at connect time). Oracle/Hive/Impala follow the mysql/postgres shape:
 * host/port/user/database (Oracle database = service name/SID, Hive/Impala
 * database = default schema).
 */
export declare function validateConnectBody(value: unknown, cwd?: string): ConnectRequestBody;
/**
 * Mount the data-agent routes against the host webserver, when one exists.
 * The registration rides a nested inject fiber so this row activates in every
 * profile; headless profiles simply never get routes.
 * @param ctx - host cordis context.
 * @param config - validated loader configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
export {};
