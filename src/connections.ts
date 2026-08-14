/**
 * The `dataAgentConnections` connection store: one in-memory connection per
 * session id, host-plane provided by the server half (`src/index.ts`) and
 * consumed by the sqlcmd tool half (`src/tool.ts`) inside the data-agent
 * preset.
 *
 * Security contract:
 * - passwords live in memory only — never written to session logs, settings,
 *   config, or disk;
 * - `get()` returns a password-stripped COPY, so UI/status consumers never
 *   see the secret;
 * - `getWithSecret()` is the process-internal read used ONLY by the sqlcmd
 *   tool half (same package), which forwards the password to the database
 *   client through an environment variable.
 *
 * Wildcard: a connection stored under the key `'*'` acts as the fallback for
 * every session without its own entry (a deployment seeding a default
 * database, or a headless/keyless run). Config-seeded entries cannot carry
 * passwords, so the wildcard is always password-free.
 * @module @yejiming/dsh-data-agent/connections
 */

/** Key of the wildcard (default) connection applied to any session without its own. */
export const WILDCARD_SESSION = '*'

/** Supported database client kinds. */
export type DatabaseType = 'mysql' | 'postgres' | 'sqlite' | 'oracle' | 'hive' | 'impala'

/**
 * One session's database connection. `host`/`port`/`user` are empty for
 * SQLite, whose `database` is a file path (resolved to absolute at connect).
 * `tables` is the connectivity check's table listing, retained so the
 * browser half can restore it after a tab switch without re-querying.
 */
export interface DatabaseConnection {
  type: DatabaseType
  host?: string
  port?: number
  user?: string
  database: string
  /** In-memory only; never exposed through {@link DataAgentConnections.get}. */
  password?: string
  tables?: string[]
}

/** Password-free view of one connection (the wire/UI face). */
export interface ConnectionSummary {
  type: DatabaseType
  host?: string
  port?: number
  user?: string
  database: string
  tables?: string[]
}

/** The host-plane connection store service (`ctx.dataAgentConnections`). */
export interface DataAgentConnections {
  /** Save (replace) one session's connection, password included. */
  set(sessionId: string, connection: DatabaseConnection): void
  /** Read one session's connection WITHOUT the password (a fresh copy). */
  get(sessionId: string): ConnectionSummary | undefined
  /**
   * Read one session's connection INCLUDING the password. Process-internal
   * only (the sqlcmd tool half); never hand this to a wire/UI consumer.
   */
  getWithSecret(sessionId: string): DatabaseConnection | undefined
  /** Whether a session currently has a connection. */
  has(sessionId: string): boolean
  /** Drop one session's connection. */
  clear(sessionId: string): void
}

/** Build the password-stripped copy of one connection. */
export function summarize(connection: DatabaseConnection): ConnectionSummary {
  const summary: ConnectionSummary = { type: connection.type, database: connection.database }
  if (connection.host !== undefined) summary.host = connection.host
  if (connection.port !== undefined) summary.port = connection.port
  if (connection.user !== undefined) summary.user = connection.user
  if (connection.tables !== undefined) summary.tables = [...connection.tables]
  return summary
}

/** Create a fresh connection store (per-process singleton, one per plugin instance). */
export function createConnectionStore(): DataAgentConnections {
  const connections = new Map<string, DatabaseConnection>()
  /** Exact entry first; the wildcard (`'*'`) entry is the fallback. */
  const exactOrWildcard = (sessionId: string): DatabaseConnection | undefined =>
    connections.get(sessionId) ?? connections.get(WILDCARD_SESSION)
  return {
    set(sessionId, connection) {
      connections.set(sessionId, connection)
    },
    get(sessionId) {
      const connection = exactOrWildcard(sessionId)
      return connection === undefined ? undefined : summarize(connection)
    },
    getWithSecret(sessionId) {
      return exactOrWildcard(sessionId)
    },
    has(sessionId) {
      return exactOrWildcard(sessionId) !== undefined
    },
    clear(sessionId) {
      // Only the exact entry: a session-specific disconnect falls back to
      // the wildcard again instead of removing the deployment seed.
      connections.delete(sessionId)
    },
  }
}
