/**
 * Pure CLI-client template construction for the supported database types.
 * Everything here is a function of (type, connection, optional overrides) —
 * no process, no I/O — so the injection-safety surface is unit-testable:
 * argv stays an array (never shell-interpreted), the SQL itself always
 * travels on stdin, and passwords only ever appear in the environment
 * entries (`MYSQL_PWD` / `PGPASSWORD`), never in argv.
 * @module @deepseek-ai/dsh-data-agent/clients
 */

import type { DatabaseConnection, DatabaseType } from './connections.ts'
import z from 'schemastery'

/** One deployment override for a database type's CLI client. */
export interface ClientConfig {
  /** Executable name (resolved through PATH) or absolute path. */
  command: string
  /** Extra flag arguments prepended before the built-in flags. */
  args?: readonly string[]
}

/** Loader schema for one client override (all fields optional at input). */
export const clientConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()),
})

/** Loader schema for the whole `clients` config object (any type key). */
export const clientsSchema = z.dict(clientConfigSchema).default({})

/**
 * A fully constructed client invocation: argv (command + flags, no SQL) plus
 * the credential environment entries merged onto the scrubbed parent env.
 */
export interface ClientTemplate {
  /** Executable to resolve through {@link SubprocessService.resolveExecutable}. */
  command: string
  /** Flag arguments only; the SQL text is written to stdin by the runner. */
  args: readonly string[]
  /** Credential env entries (e.g. `{ MYSQL_PWD }`), never argv. */
  env: Readonly<Record<string, string>>
}

/** Built-in flag arguments per type (SQL always travels on stdin). */
const DEFAULT_ARGS: Readonly<Record<DatabaseType, readonly string[]>> = {
  mysql: ['--batch', '--raw'],
  postgres: ['-A'],
  sqlite: ['-header', '-column'],
}

/** Introspection flag arguments per type (machine-readable table listing). */
const INTROSPECT_ARGS: Readonly<Record<DatabaseType, readonly string[]>> = {
  mysql: ['--batch', '--raw'],
  postgres: ['-t', '-A'],
  sqlite: ['-noheader', '-list'],
}

/** Default ports when the connection does not carry one. */
const DEFAULT_PORTS: Readonly<Record<DatabaseType, number>> = {
  mysql: 3306,
  postgres: 5432,
  sqlite: 0,
}

/**
 * Connection flags for one type. `host`/`port`/`user` are empty for SQLite —
 * its `database` file path is the only positional argument.
 */
function connectionArgs(type: DatabaseType, connection: DatabaseConnection): readonly string[] {
  switch (type) {
    case 'mysql':
      return [
        '-h', connection.host ?? '127.0.0.1',
        '-P', String(connection.port ?? DEFAULT_PORTS.mysql),
        '-u', connection.user ?? 'root',
        '-D', connection.database,
      ]
    case 'postgres':
      return [
        '-h', connection.host ?? '127.0.0.1',
        '-p', String(connection.port ?? DEFAULT_PORTS.postgres),
        '-U', connection.user ?? 'postgres',
        '-d', connection.database,
      ]
    case 'sqlite':
      return [connection.database]
  }
}

/** Credential environment entries per type; absent password yields an empty env. */
function credentialEnv(type: DatabaseType, connection: DatabaseConnection): Readonly<Record<string, string>> {
  const password = connection.password
  if (password === undefined) return {}
  switch (type) {
    case 'mysql':
      return { MYSQL_PWD: password }
    case 'postgres':
      return { PGPASSWORD: password }
    case 'sqlite':
      return {}
  }
}

/**
 * Build one client invocation for a query execution. Flags come BEFORE the
 * connection arguments everywhere: sqlite3 takes `[options] <database>`, and
 * putting flags first is harmless for mysql/psql, whose options accept any
 * order.
 * @param type - database type.
 * @param connection - the stored connection (host/port/user/password/database).
 * @param override - optional deployment override for this type.
 * @returns argv (no SQL) plus credential env entries.
 */
export function buildClientTemplate(
  type: DatabaseType,
  connection: DatabaseConnection,
  override?: ClientConfig,
): ClientTemplate {
  const flags = [...DEFAULT_ARGS[type]]
  if (override !== undefined) {
    if (override.args !== undefined) flags.unshift(...override.args)
  }
  return {
    command: override?.command ?? DEFAULT_CLIENTS_COMMAND[type],
    args: [...flags, ...connectionArgs(type, connection)],
    env: credentialEnv(type, connection),
  }
}

/** Built-in commands per type (also the loader defaults; see `src/defaults.ts`). */
const DEFAULT_CLIENTS_COMMAND: Readonly<Record<DatabaseType, string>> = {
  mysql: 'mysql',
  postgres: 'psql',
  sqlite: 'sqlite3',
}

/**
 * Build one client invocation for the /connect connectivity check (table
 * listing): machine-readable flags, same credential env.
 */
export function buildIntrospectTemplate(
  type: DatabaseType,
  connection: DatabaseConnection,
  override?: ClientConfig,
): ClientTemplate {
  const flags = [...INTROSPECT_ARGS[type]]
  if (override !== undefined) {
    if (override.args !== undefined) flags.unshift(...override.args)
  }
  return {
    command: override?.command ?? DEFAULT_CLIENTS_COMMAND[type],
    args: [...flags, ...connectionArgs(type, connection)],
    env: credentialEnv(type, connection),
  }
}

/**
 * The table-listing SQL per type, run at /connect time to verify
 * connectivity and produce the table list.
 */
export function tableListingSql(type: DatabaseType): string {
  switch (type) {
    case 'mysql':
      return 'SHOW TABLES;'
    case 'postgres':
      return "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
    case 'sqlite':
      return "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;"
  }
}

/**
 * Parse one type's machine-readable table-listing output into a name list.
 * Header lines are stripped per type: mysql `--batch` prints a header row
 * (skip 1); postgres `-t` and sqlite `-noheader` print none (skip 0).
 */
export function parseTableListing(type: DatabaseType, stdout: string): string[] {
  const lines = stdout.split('\n')
  const start = type === 'mysql' ? 1 : 0
  const tables: string[] = []
  for (let index = start; index < lines.length; index += 1) {
    const name = lines[index].trim()
    if (name.length > 0) tables.push(name)
  }
  return tables
}
