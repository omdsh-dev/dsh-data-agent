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
