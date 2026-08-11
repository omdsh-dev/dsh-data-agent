/**
 * Package-wide defaults shared by the server half (`src/index.ts`) and the
 * sqlcmd tool half (`src/tool.ts`). Loader schemas carry these as their
 * defaults so a deployment may override every one of them in cordis.yml.
 * @module @deepseek-ai/dsh-data-agent/defaults
 */

import type { DatabaseType } from './connections.ts'

/** Preset directory name installed into `$DSH_HOME/.agent-presets/`. */
export const DEFAULT_PRESET_ID = 'data-agent'

/** End-to-end deadline for one `/connect` connectivity check, milliseconds. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000

/** Cap on the table list returned by `/connect` and `/status`. */
export const DEFAULT_INTROSPECT_MAX_TABLES = 500

/** End-to-end deadline for one sqlcmd query, milliseconds. */
export const DEFAULT_QUERY_TIMEOUT_MS = 30_000

/** In-memory cap on sqlcmd captured output (stdout and stderr each). */
export const DEFAULT_MAX_RESULT_CHARS = 20_000

/** Grace period for the subprocess terminate escalation. */
export const DEFAULT_GRACE_MS = 5_000
