//#region src/defaults.ts
/**
* Package-wide defaults shared by the server half (`src/index.ts`) and the
* database tool half (`src/tool.ts`). Loader schemas carry these as their
* defaults so a deployment may override every one of them in cordis.yml.
* @module @yejiming/dsh-data-agent/defaults
*/
/** Preset directory name installed into `$DSH_HOME/.agent-presets/`. */
const DEFAULT_PRESET_ID = "data-agent";
/** End-to-end deadline for one `/connect` connectivity check, milliseconds. */
const DEFAULT_CONNECT_TIMEOUT_MS = 1e4;
/** End-to-end deadline for one database-tool query, milliseconds. */
const DEFAULT_QUERY_TIMEOUT_MS = 3e4;
/** In-memory cap on database-tool captured output (stdout and stderr each). */
const DEFAULT_MAX_RESULT_CHARS = 2e4;
/** Cap on one /query SQL text length (abuse guard; the wire body stays small). */
const DEFAULT_MAX_QUERY_CHARS = 65536;
/** Grace period for the subprocess terminate escalation. */
const DEFAULT_GRACE_MS = 5e3;
//#endregion
export { DEFAULT_PRESET_ID as a, DEFAULT_MAX_RESULT_CHARS as i, DEFAULT_GRACE_MS as n, DEFAULT_QUERY_TIMEOUT_MS as o, DEFAULT_MAX_QUERY_CHARS as r, DEFAULT_CONNECT_TIMEOUT_MS as t };
