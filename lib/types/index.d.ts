/**
 * Data Agent server half for the dsh web GUI. The host row provides the
 * `dataAgentConnections` service (session-scoped in-memory store; passwords
 * never leave memory), seeds config connections (`connections`, `'*'` =
 * wildcard default), and installs the `data-agent` agent preset into
 * `$DSH_HOME/.agent-presets/` (idempotent, never overwrites a user-edited
 * directory).
 *
 * The HTTP routes live in the separate `./routes` entry
 * (`@deepseek-ai/dsh-data-agent/routes`, cordis row `data-agent-routes`) so
 * this row keeps working in headless profiles without a webserver; the sqlcmd
 * tool itself lives in the `./tool` entry and is mounted only by the
 * data-agent preset.
 * @module @deepseek-ai/dsh-data-agent
 */
import type { Context } from 'cordis';
/** The `dataAgentConnections` service face on the cordis context. */
declare module 'cordis' {
    interface Context {
        dataAgentConnections: DataAgentConnections;
    }
}
import z from 'schemastery';
import { type DataAgentConnections, type DatabaseType } from './connections.ts';
import { type ClientConfig } from './clients.ts';
/** Cordis plugin name (diagnostics only). */
export declare const name = "data-agent";
/** Services required before the store can serve. */
export declare const inject: string[];
/** Deployment overrides for one database type's CLI client. */
export interface ClientsConfig {
    mysql?: ClientConfig;
    postgres?: ClientConfig;
    sqlite?: ClientConfig;
}
/**
 * One config-seeded connection. Deliberately password-free: passwords are a
 * memory-only / connect-time value, so only the /connect route may carry one.
 * The key `'*'` seeds the wildcard default used by any session without its
 * own connection (headless/keyless runs, deployments pinning one database).
 */
export interface SeededConnectionConfig {
    type: DatabaseType;
    host?: string;
    port?: number;
    user?: string;
    database: string;
}
/** Required plugin configuration (loader schema with deployment defaults). */
export interface Config {
    /** Preset directory name installed under `$DSH_HOME/.agent-presets/`. */
    presetId: string;
    /** Whether to self-install the preset on startup (idempotent). */
    installPreset: boolean;
    /** Deadline for one /connect connectivity check, milliseconds. */
    connectTimeoutMs: number;
    /** Cap on the table list returned by /connect and /status. */
    introspectMaxTables: number;
    /** Deadline for one sqlcmd query, milliseconds. */
    queryTimeoutMs: number;
    /** In-memory cap on sqlcmd captured output. */
    maxResultChars: number;
    /** CLI client overrides keyed by database type. */
    clients: ClientsConfig;
    /** Config-seeded connections keyed by session id (`'*'` = wildcard default). */
    connections: Record<string, SeededConnectionConfig>;
}
/** Loader schema with deployment defaults (no library defaults). */
export declare const Config: z<Schemastery.ObjectS<{
    presetId: z<string, string>;
    installPreset: z<boolean, boolean>;
    connectTimeoutMs: z<number, number>;
    introspectMaxTables: z<number, number>;
    queryTimeoutMs: z<number, number>;
    maxResultChars: z<number, number>;
    clients: z<import("cosmokit").Dict<{
        command?: string | null | undefined;
        args?: string[] | null | undefined;
    } & import("cosmokit").Dict, string>, import("cosmokit").Dict<Schemastery.ObjectT<{
        command: z<string, string>;
        args: z<string[], string[]>;
    }>, string>>;
    connections: z<import("cosmokit").Dict<{
        type?: "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | null | undefined;
        host?: string | null | undefined;
        port?: number | null | undefined;
        user?: string | null | undefined;
        database?: string | null | undefined;
    } & import("cosmokit").Dict, string>, import("cosmokit").Dict<Schemastery.ObjectT<{
        type: z<"mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala", "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala">;
        host: z<string, string>;
        port: z<number, number>;
        user: z<string, string>;
        database: z<string, string>;
    }>, string>>;
}>, Schemastery.ObjectT<{
    presetId: z<string, string>;
    installPreset: z<boolean, boolean>;
    connectTimeoutMs: z<number, number>;
    introspectMaxTables: z<number, number>;
    queryTimeoutMs: z<number, number>;
    maxResultChars: z<number, number>;
    clients: z<import("cosmokit").Dict<{
        command?: string | null | undefined;
        args?: string[] | null | undefined;
    } & import("cosmokit").Dict, string>, import("cosmokit").Dict<Schemastery.ObjectT<{
        command: z<string, string>;
        args: z<string[], string[]>;
    }>, string>>;
    connections: z<import("cosmokit").Dict<{
        type?: "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | null | undefined;
        host?: string | null | undefined;
        port?: number | null | undefined;
        user?: string | null | undefined;
        database?: string | null | undefined;
    } & import("cosmokit").Dict, string>, import("cosmokit").Dict<Schemastery.ObjectT<{
        type: z<"mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala", "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala">;
        host: z<string, string>;
        port: z<number, number>;
        user: z<string, string>;
        database: z<string, string>;
    }>, string>>;
}>>;
/**
 * Resolve the harness home the same way `@deepseek-ai/dsh-paths` does:
 * `$DSH_HOME` (non-blank) else `~/.dsh`, normalized absolute.
 */
export declare function resolveDshHome(env?: Record<string, string | undefined>): string;
/**
 * Install the packaged `preset/data-agent/` directory into
 * `$DSH_HOME/.agent-presets/<presetId>/`. Idempotent: an existing target
 * directory is left untouched (user edits survive); `installPreset: false`
 * never calls this. Best-effort — a failure logs a warning with manual
 * install instructions instead of failing the boot.
 */
export declare function installPreset(ctx: Context, presetId: string): Promise<void>;
/**
 * Mount the data-agent host row: connection store, config-seeded
 * connections, and preset self-install. HTTP routes are the sibling
 * `data-agent-routes` row (`./routes`).
 * @param ctx - host cordis context.
 * @param config - validated loader configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
