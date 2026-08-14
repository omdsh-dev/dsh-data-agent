/**
 * Package-wide defaults shared by the server half (`src/index.ts`) and the
 * sqlcmd tool half (`src/tool.ts`). Loader schemas carry these as their
 * defaults so a deployment may override every one of them in cordis.yml.
 * @module @deepseek-ai/dsh-data-agent/defaults
 */
/** Preset directory name installed into `$DSH_HOME/.agent-presets/`. */
export declare const DEFAULT_PRESET_ID = "data-agent";
/** End-to-end deadline for one `/connect` connectivity check, milliseconds. */
export declare const DEFAULT_CONNECT_TIMEOUT_MS = 10000;
/** Cap on the table list returned by `/connect` and `/status`. */
export declare const DEFAULT_INTROSPECT_MAX_TABLES = 500;
/** End-to-end deadline for one sqlcmd query, milliseconds. */
export declare const DEFAULT_QUERY_TIMEOUT_MS = 30000;
/** In-memory cap on sqlcmd captured output (stdout and stderr each). */
export declare const DEFAULT_MAX_RESULT_CHARS = 20000;
/** Cap on one /query SQL text length (abuse guard; the wire body stays small). */
export declare const DEFAULT_MAX_QUERY_CHARS = 65536;
/** Grace period for the subprocess terminate escalation. */
export declare const DEFAULT_GRACE_MS = 5000;
