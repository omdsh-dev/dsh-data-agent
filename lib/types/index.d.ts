/**
 * Data Agent profile entry. The host row provides the
 * `dataAgentConnections` service (shared non-secret profile/binding storage;
 * temporary passwords stay process-local), seeds config connections (`connections`, `'*'` =
 * wildcard default), provides a separate versioned governance Catalog, installs the `data-agent` agent preset into
 * `$DSH_HOME/.agent-presets/`, and preloads the preset-scoped database tools
 * on every surface, while registering `/database` and `/catalog` only while
 * the current Cordis composition actually loads the dsh-tui plugin.
 *
 * The HTTP routes live in the separate `./routes` entry
 * (`@yejiming/dsh-data-agent/routes`, cordis row `data-agent-routes`) so
 * this row keeps working in headless profiles without a webserver. The
 * database implementations still have public `./tool` and `./command`
 * exports, but the shipped preset does not dynamically import those package
 * subpaths. Loading them here keeps Desktop on the same profile-startup path
 * as other UI bundles and avoids Electron ASAR package-resolution drift.
 * @module @yejiming/dsh-data-agent
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ScopeKey } from '@deepseek-ai/dsh-scope';
/** The `dataAgentConnections` service face on the cordis context. */
declare module '@deepseek-ai/cordis' {
    interface Context {
        dataAgentConnections: DataAgentConnections;
        dataAgentCatalog: DataAgentCatalog;
        dataAgentCatalogScanner: DataAgentCatalogScanner;
        dataAgentCatalogReview: DataAgentCatalogReview;
    }
}
import z from 'schemastery';
import { type DataAgentConnections, type DatabaseType } from './connections.ts';
import { type CliDatabaseType, type ClientConfig } from './clients.ts';
import { type DataAgentCatalog, type DataAgentCatalogReview, type DataAgentCatalogScanner } from './catalog.ts';
import { type DataAgentCommandAdapterOptions } from './command.ts';
import { type Config as ToolConfig } from './tool.ts';
export type { CatalogServiceBundle, CatalogServiceOptions, CatalogStatusSummary, DataAgentCatalog, DataAgentCatalogReview, DataAgentCatalogScanner, StartCatalogScanInput, } from './catalog.ts';
export type { CatalogAssetDetail, CatalogAssetHead, CatalogAssetKind, CatalogAssetRevision, CatalogAssetStatus, CatalogCapability, CatalogDiffItem, CatalogDiffKind, CatalogDiffPage, CatalogEnrichment, CatalogEnrichmentStatus, CatalogIdentity, CatalogObservation, CatalogProgress, CatalogRelation, CatalogRun, CatalogRunStatus, CatalogScope, CatalogSearchFilters, CatalogSearchItem, CatalogSearchPage, CatalogSearchRequest, CatalogSemanticEntry, CatalogSemanticKind, CatalogSemanticRevision, CatalogSemanticStatus, CatalogSource, CatalogTechnicalPayload, MetricDefinition, MeaningDefinition, SemanticDefinition, TermDefinition, } from './catalog-types.ts';
/** Cordis plugin name (diagnostics only). */
export declare const name = "data-agent";
/** Services required before the profile entry can mount its preset layer. */
export declare const inject: string[];
/** Deployment overrides for one database type's CLI client. */
export type ClientsConfig = Partial<Record<CliDatabaseType, ClientConfig>>;
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
    /** ClickHouse only: use HTTPS with certificate verification. */
    secure?: boolean;
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
    /** Deadline for one package-owned system-catalog metadata query. */
    catalogQueryTimeoutMs: number;
    /** Per-stream capture budget for one package-owned system-catalog query. */
    catalogMaxResultChars: number;
    /** Maximum schemas and table/view details processed concurrently. */
    catalogSchemaConcurrency: number;
    catalogAssetConcurrency: number;
    /** Hard technical asset bound for one scan. */
    catalogMaxAssetsPerRun: number;
    /** Maximum normalized database/human text field length. */
    catalogMaxTextChars: number;
    /** Default and maximum Catalog list/detail page sizes. */
    catalogPageSize: number;
    catalogMaxPageSize: number;
    /** In-memory cap on database-tool captured output. */
    maxResultChars: number;
    /** Maximum structured rows returned by one database read tool call. */
    maxRows: number;
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
export declare const Config: z<Schemastery.ObjectS<{
    presetId: z<string, string>;
    installPreset: z<boolean, boolean>;
    connectTimeoutMs: z<number, number>;
    introspectMaxTables: z<number, number>;
    queryTimeoutMs: z<number, number>;
    catalogQueryTimeoutMs: z<number, number>;
    catalogMaxResultChars: z<number, number>;
    catalogSchemaConcurrency: z<number, number>;
    catalogAssetConcurrency: z<number, number>;
    catalogMaxAssetsPerRun: z<number, number>;
    catalogMaxTextChars: z<number, number>;
    catalogPageSize: z<number, number>;
    catalogMaxPageSize: z<number, number>;
    maxResultChars: z<number, number>;
    maxRows: z<number, number>;
    maxQueryChars: z<number, number>;
    readonly: z<boolean, boolean>;
    persistConnections: z<boolean, boolean>;
    clients: z<import("cosmokit").Dict<{
        command?: string | null | undefined;
        args?: string[] | null | undefined;
        searchPaths?: string[] | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "doris" | "sqlserver">, import("cosmokit").Dict<Schemastery.ObjectT<{
        command: z<string, string>;
        args: z<string[], string[]>;
        searchPaths: z<string[], string[]>;
    }>, "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "doris" | "sqlserver">>;
    connections: z<import("cosmokit").Dict<{
        type?: "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "clickhouse" | "doris" | "sqlserver" | null | undefined;
        host?: string | null | undefined;
        port?: number | null | undefined;
        user?: string | null | undefined;
        database?: string | null | undefined;
        readonly?: boolean | null | undefined;
        secure?: boolean | null | undefined;
        passwordRef?: string | null | undefined;
        password?: null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>, import("cosmokit").Dict<Schemastery.ObjectT<{
        type: z<"mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "clickhouse" | "doris" | "sqlserver", "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "clickhouse" | "doris" | "sqlserver">;
        host: z<string, string>;
        port: z<number, number>;
        user: z<string, string>;
        database: z<string, string>;
        readonly: z<boolean, boolean>;
        secure: z<boolean, boolean>;
        passwordRef: z<string, string>;
        password: z<never, never>;
    }>, string>>;
}>, Schemastery.ObjectT<{
    presetId: z<string, string>;
    installPreset: z<boolean, boolean>;
    connectTimeoutMs: z<number, number>;
    introspectMaxTables: z<number, number>;
    queryTimeoutMs: z<number, number>;
    catalogQueryTimeoutMs: z<number, number>;
    catalogMaxResultChars: z<number, number>;
    catalogSchemaConcurrency: z<number, number>;
    catalogAssetConcurrency: z<number, number>;
    catalogMaxAssetsPerRun: z<number, number>;
    catalogMaxTextChars: z<number, number>;
    catalogPageSize: z<number, number>;
    catalogMaxPageSize: z<number, number>;
    maxResultChars: z<number, number>;
    maxRows: z<number, number>;
    maxQueryChars: z<number, number>;
    readonly: z<boolean, boolean>;
    persistConnections: z<boolean, boolean>;
    clients: z<import("cosmokit").Dict<{
        command?: string | null | undefined;
        args?: string[] | null | undefined;
        searchPaths?: string[] | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "doris" | "sqlserver">, import("cosmokit").Dict<Schemastery.ObjectT<{
        command: z<string, string>;
        args: z<string[], string[]>;
        searchPaths: z<string[], string[]>;
    }>, "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "doris" | "sqlserver">>;
    connections: z<import("cosmokit").Dict<{
        type?: "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "clickhouse" | "doris" | "sqlserver" | null | undefined;
        host?: string | null | undefined;
        port?: number | null | undefined;
        user?: string | null | undefined;
        database?: string | null | undefined;
        readonly?: boolean | null | undefined;
        secure?: boolean | null | undefined;
        passwordRef?: string | null | undefined;
        password?: null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>, import("cosmokit").Dict<Schemastery.ObjectT<{
        type: z<"mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "clickhouse" | "doris" | "sqlserver", "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "clickhouse" | "doris" | "sqlserver">;
        host: z<string, string>;
        port: z<number, number>;
        user: z<string, string>;
        database: z<string, string>;
        readonly: z<boolean, boolean>;
        secure: z<boolean, boolean>;
        passwordRef: z<string, string>;
        password: z<never, never>;
    }>, string>>;
}>>;
/**
 * Resolve the harness home the same way `@deepseek-ai/dsh-paths` does:
 * `$DSH_HOME` (non-blank) else `~/.dsh`, normalized absolute.
 */
export declare function resolveDshHome(env?: Record<string, string | undefined>): string;
/**
 * Install the packaged `preset/data-agent/` directory into
 * `$DSH_HOME/.agent-presets/<presetId>/`. Idempotent: an existing target is
 * normally left untouched. Exact package-owned legacy compositions are
 * migrated once when their runtime contract changes; user-edited compositions
 * are never overwritten. `installPreset: false` never calls this. Best-effort
 * — a failure logs a warning with manual install instructions instead of
 * failing the boot.
 */
export declare function installPreset(ctx: Context, presetId: string): Promise<boolean>;
/** Public for regression tests of the non-destructive preset migration gate. */
export declare function isLegacyManagedPreset(source: string): boolean;
/** Exact profile-local package installation command used by diagnostics/docs. */
export declare function profileInstallCommand(profile: string): string;
/** Actionable diagnostic for a roster-visible preset whose profile lacks this package. */
export declare function missingProfileDependencyMessage(profile: string): string;
/** Tool configuration inherited by the profile-preloaded preset capabilities. */
type PresetCapabilitiesConfig = Pick<ToolConfig, 'queryTimeoutMs' | 'maxResultChars' | 'maxRows' | 'maxQueryChars' | 'readonly' | 'clients'>;
/**
 * Register the statically imported database tools and surface adapters under the exact
 * standing key owned by the data-agent preset. Selecting the preset performs
 * no package import and only links the agent scope to this key.
 */
export declare function mountPresetCapabilities(ctx: Context, key: ScopeKey, scopeTag: symbol, config: PresetCapabilitiesConfig, commandOptions?: DataAgentCommandAdapterOptions): Promise<void>;
/**
 * Mount the data-agent profile row: connection store, config-seeded
 * connections, preset installation, and profile-preloaded preset capabilities.
 * HTTP routes are the sibling `data-agent-routes` row (`./routes`).
 * @param ctx - host cordis context.
 * @param config - validated loader configuration.
 */
export declare function apply(ctx: Context, config: Config): Promise<void>;
