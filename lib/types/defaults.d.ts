/**
 * Package-wide defaults shared by the server half (`src/index.ts`) and the
 * database tool half (`src/tool.ts`). Loader schemas carry these as their
 * defaults so a deployment may override every one of them in cordis.yml.
 * @module @yejiming/dsh-data-agent/defaults
 */
/** Preset directory name installed into `$DSH_HOME/.agent-presets/`. */
export declare const DEFAULT_PRESET_ID = "data-agent";
/** End-to-end deadline for one `/connect` connectivity check, milliseconds. */
export declare const DEFAULT_CONNECT_TIMEOUT_MS = 10000;
/** Cap on the table list returned by `/connect` and `/status`. */
export declare const DEFAULT_INTROSPECT_MAX_TABLES = 500;
/** End-to-end deadline for one database-tool query, milliseconds. */
export declare const DEFAULT_QUERY_TIMEOUT_MS = 30000;
/** In-memory cap on database-tool captured output (stdout and stderr each). */
export declare const DEFAULT_MAX_RESULT_CHARS = 20000;
/** Maximum structured rows returned by one database read tool call. */
export declare const DEFAULT_MAX_ROWS = 100;
/** Hard row cap for one structured Web workbench result/export. */
export declare const WORKBENCH_MAX_EXPORT_ROWS = 50000;
/** Bounded capture size for the larger structured Web workbench result. */
export declare const WORKBENCH_MAX_RESULT_CHARS: number;
/** Cap on one /query SQL text length (abuse guard; the wire body stays small). */
export declare const DEFAULT_MAX_QUERY_CHARS = 65536;
/** Grace period for the subprocess terminate escalation. */
export declare const DEFAULT_GRACE_MS = 5000;
/** Catalog metadata query deadline. Kept separate from user SQL execution. */
export declare const DEFAULT_CATALOG_QUERY_TIMEOUT_MS = 30000;
/**
 * Per-stream capture budget for one system-catalog query. Catalog metadata is
 * intentionally independent from the much smaller model/interactive SQL
 * result budget because a schema snapshot can contain thousands of objects.
 */
export declare const DEFAULT_CATALOG_MAX_RESULT_CHARS: number;
/** Maximum schemas inspected concurrently by one Catalog scan. */
export declare const DEFAULT_CATALOG_SCHEMA_CONCURRENCY = 2;
/** Maximum tables/views inspected concurrently by one Catalog scan. */
export declare const DEFAULT_CATALOG_ASSET_CONCURRENCY = 4;
/** Hard bound on technical assets (including columns) staged by one run. */
export declare const DEFAULT_CATALOG_MAX_ASSETS = 50000;
/** Maximum normalized length of one database or human-authored text field. */
export declare const DEFAULT_CATALOG_MAX_TEXT_CHARS = 4096;
/** Default and maximum page sizes for Catalog list/detail reads. */
export declare const DEFAULT_CATALOG_PAGE_SIZE = 50;
export declare const MAX_CATALOG_PAGE_SIZE = 200;
/** Default and maximum result counts exposed to the model. */
export declare const DEFAULT_CATALOG_TOOL_TOP_K = 10;
export declare const MAX_CATALOG_TOOL_TOP_K = 25;
