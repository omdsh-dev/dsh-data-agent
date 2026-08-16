/**
 * Data Agent server half for the dsh web GUI. The host row provides the
 * `dataAgentConnections` service (shared non-secret profile/binding storage;
 * temporary passwords stay process-local), seeds config connections (`connections`, `'*'` =
 * wildcard default), and installs the `data-agent` agent preset into
 * `$DSH_HOME/.agent-presets/` (idempotent, never overwrites a user-edited
 * directory).
 *
 * The HTTP routes live in the separate `./routes` entry
 * (`@yejiming/dsh-data-agent/routes`, cordis row `data-agent-routes`) so
 * this row keeps working in headless profiles without a webserver; the
 * database tools themselves live in the `./tool` entry and are mounted only
 * by the data-agent preset.
 * @module @yejiming/dsh-data-agent
 */
import type { Context } from '@deepseek-ai/cordis';
/** The `dataAgentConnections` service face on the cordis context. */
declare module '@deepseek-ai/cordis' {
    interface Context {
        dataAgentConnections: DataAgentConnections;
    }
}
import { type DataAgentConnections, type DatabaseType } from './connections.ts';
import { type ClientConfig } from './clients.ts';
/** Cordis plugin name (diagnostics only). */
export declare const name = "data-agent";
/** Services required before the store can serve. */
export declare const inject: string[];
/** Deployment overrides for one database type's CLI client. */
export type ClientsConfig = Partial<Record<DatabaseType, ClientConfig>>;
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
    /** Optional per-seed read-only guard. */
    readonly?: boolean;
    /** Safe credential reference. Real passwords are rejected by the schema. */
    passwordRef?: string;
    password?: never;
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
    /** Deadline for one database-tool query, milliseconds. */
    queryTimeoutMs: number;
    /** In-memory cap on database-tool captured output. */
    maxResultChars: number;
    /** Maximum SQL text accepted by the shared Web query adapter. */
    maxQueryChars: number;
    /** Default read-only guard: true rejects write statements in database tools and /query. */
    readonly: boolean;
    /** Persist non-secret profiles/bindings through DSH storage-domain. */
    persistConnections: boolean;
    /** CLI client overrides keyed by database type. */
    clients: ClientsConfig;
    /** Config-seeded connections keyed by session id (`'*'` = wildcard default). */
    connections: Record<string, SeededConnectionConfig>;
}
/** Loader schema with deployment defaults (no library defaults). */
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
    presetId: import("@deepseek-ai/schemastery").default<string, string>;
    installPreset: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    connectTimeoutMs: import("@deepseek-ai/schemastery").default<number, number>;
    introspectMaxTables: import("@deepseek-ai/schemastery").default<number, number>;
    queryTimeoutMs: import("@deepseek-ai/schemastery").default<number, number>;
    maxResultChars: import("@deepseek-ai/schemastery").default<number, number>;
    maxQueryChars: import("@deepseek-ai/schemastery").default<number, number>;
    readonly: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    persistConnections: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    clients: import("@deepseek-ai/schemastery").default<import("@deepseek-ai/cosmokit").Dict<{
        command?: string | null | undefined;
        args?: string[] | null | undefined;
    } & import("cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<{
        command: import("@deepseek-ai/schemastery").default<string, string>;
        args: import("@deepseek-ai/schemastery").default<string[], string[]>;
    }>, string>>;
    connections: import("@deepseek-ai/schemastery").default<import("@deepseek-ai/cosmokit").Dict<{
        type?: "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | null | undefined;
        host?: string | null | undefined;
        port?: number | null | undefined;
        user?: string | null | undefined;
        database?: string | null | undefined;
        readonly?: boolean | null | undefined;
        passwordRef?: string | null | undefined;
        password?: null | undefined;
    } & import("cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<{
        type: import("@deepseek-ai/schemastery").default<"mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala", "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala">;
        host: import("@deepseek-ai/schemastery").default<string, string>;
        port: import("@deepseek-ai/schemastery").default<number, number>;
        user: import("@deepseek-ai/schemastery").default<string, string>;
        database: import("@deepseek-ai/schemastery").default<string, string>;
        readonly: import("@deepseek-ai/schemastery").default<boolean, boolean>;
        passwordRef: import("@deepseek-ai/schemastery").default<string, string>;
        password: import("@deepseek-ai/schemastery").default<never, never>;
    }>, string>>;
}>, Schemastery.ObjectT<{
    presetId: import("@deepseek-ai/schemastery").default<string, string>;
    installPreset: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    connectTimeoutMs: import("@deepseek-ai/schemastery").default<number, number>;
    introspectMaxTables: import("@deepseek-ai/schemastery").default<number, number>;
    queryTimeoutMs: import("@deepseek-ai/schemastery").default<number, number>;
    maxResultChars: import("@deepseek-ai/schemastery").default<number, number>;
    maxQueryChars: import("@deepseek-ai/schemastery").default<number, number>;
    readonly: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    persistConnections: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    clients: import("@deepseek-ai/schemastery").default<import("@deepseek-ai/cosmokit").Dict<{
        command?: string | null | undefined;
        args?: string[] | null | undefined;
    } & import("cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<{
        command: import("@deepseek-ai/schemastery").default<string, string>;
        args: import("@deepseek-ai/schemastery").default<string[], string[]>;
    }>, string>>;
    connections: import("@deepseek-ai/schemastery").default<import("@deepseek-ai/cosmokit").Dict<{
        type?: "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | null | undefined;
        host?: string | null | undefined;
        port?: number | null | undefined;
        user?: string | null | undefined;
        database?: string | null | undefined;
        readonly?: boolean | null | undefined;
        passwordRef?: string | null | undefined;
        password?: null | undefined;
    } & import("cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<{
        type: import("@deepseek-ai/schemastery").default<"mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala", "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala">;
        host: import("@deepseek-ai/schemastery").default<string, string>;
        port: import("@deepseek-ai/schemastery").default<number, number>;
        user: import("@deepseek-ai/schemastery").default<string, string>;
        database: import("@deepseek-ai/schemastery").default<string, string>;
        readonly: import("@deepseek-ai/schemastery").default<boolean, boolean>;
        passwordRef: import("@deepseek-ai/schemastery").default<string, string>;
        password: import("@deepseek-ai/schemastery").default<never, never>;
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
/** Exact profile-local package installation command used by diagnostics/docs. */
export declare function profileInstallCommand(profile: string): string;
/** Actionable diagnostic for a roster-visible preset whose profile lacks this package. */
export declare function missingProfileDependencyMessage(profile: string): string;
/**
 * Mount the data-agent host row: connection store, config-seeded
 * connections, and preset self-install. HTTP routes are the sibling
 * `data-agent-routes` row (`./routes`).
 * @param ctx - host cordis context.
 * @param config - validated loader configuration.
 */
export declare function apply(ctx: Context, config: Config): Promise<void>;
