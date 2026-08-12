/**
 * Pure CLI-client template construction for the supported database types.
 * Everything here is a function of (type, connection, optional overrides) —
 * no process, no I/O — so the injection-safety surface is unit-testable:
 * argv stays an array (never shell-interpreted), the SQL itself always
 * travels on stdin, and passwords only ever appear in the environment
 * entries (`MYSQL_PWD` / `PGPASSWORD`) or in a stdin connect prefix
 * (Oracle `connect`, Hive `!connect`) — never in argv, logs, or returns.
 *
 * Metadata (schemas / tables / describe) queries and their per-type output
 * parsers live here too, so the /schemas /tables /describe routes stay thin.
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
 * A fully constructed client invocation: argv (command + flags, no SQL),
 * the credential env entries, and the stdin prefix (Oracle/Hive connect
 * lines) the runner writes before the SQL text.
 */
export interface ClientTemplate {
  /** Executable to resolve through {@link SubprocessService.resolveExecutable}. */
  command: string
  /** Flag arguments only; the SQL text is written to stdin by the runner. */
  args: readonly string[]
  /** Credential env entries (e.g. `{ MYSQL_PWD }`), never argv. */
  env: Readonly<Record<string, string>>
  /** stdin text written BEFORE the SQL (Oracle SET/connect, Hive !connect); '' otherwise. */
  stdinPrefix: string
}

/** Query-mode flag arguments per type (plain/human output). */
const QUERY_ARGS: Readonly<Record<DatabaseType, readonly string[]>> = {
  mysql: ['--batch', '--raw'],
  postgres: ['-A'],
  sqlite: ['-header', '-column'],
  oracle: ['-S', '/nolog'],
  hive: ['--silent=true', '--outputformat=tsv2'],
  impala: ['-B'],
}

/** Introspection-mode flag arguments per type (machine-readable listing). */
const INTROSPECT_ARGS: Readonly<Record<DatabaseType, readonly string[]>> = {
  mysql: ['--batch', '--raw'],
  postgres: ['-t', '-A'],
  sqlite: ['-noheader', '-list'],
  oracle: ['-S', '/nolog'],
  hive: ['--silent=true', '--outputformat=tsv2'],
  impala: ['-B'],
}

/** Default ports when the connection does not carry one. */
const DEFAULT_PORTS: Readonly<Record<DatabaseType, number>> = {
  mysql: 3306,
  postgres: 5432,
  sqlite: 0,
  oracle: 1521,
  hive: 10000,
  impala: 21050,
}

/** Built-in commands per type (also the loader defaults; see `src/defaults.ts`). */
const DEFAULT_CLIENTS_COMMAND: Readonly<Record<DatabaseType, string>> = {
  mysql: 'mysql',
  postgres: 'psql',
  sqlite: 'sqlite3',
  oracle: 'sqlplus',
  hive: 'beeline',
  impala: 'impala-shell',
}

/**
 * Connection flags for one type. Oracle and Hive carry NO connection flags:
 * their endpoint + credentials travel in the stdin prefix; Impala takes
 * `-i host:port -d db` on the argv. SQLite's `database` file is positional
 * and must come AFTER the flags.
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
    case 'impala':
      return [
        '-i', `${connection.host ?? '127.0.0.1'}:${connection.port ?? DEFAULT_PORTS.impala}`,
        '-d', connection.database,
      ]
    case 'oracle':
    case 'hive':
      return []
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
    case 'oracle':
    case 'hive':
    case 'impala':
      return {}
  }
}

/**
 * The stdin prefix per type: Oracle and Hive establish the session here, so
 * their credentials never appear in argv. Oracle also silences sqlplus
 * decoration (PAGESIZE/FEEDBACK/HEADING) and pins the column separator to
 * `|` for the describe parser; Hive connects through beeline's `!connect`.
 */
function stdinPrefix(type: DatabaseType, connection: DatabaseConnection): string {
  switch (type) {
    case 'oracle': {
      const lines = [
        'SET PAGESIZE 0',
        'SET FEEDBACK OFF',
        'SET HEADING OFF',
        "SET COLSEP '|'",
        'SET TRIMSPOOL ON',
        connection.user !== undefined
          ? `connect ${connection.user}${connection.password !== undefined ? `/${connection.password}` : ''}@${connection.host ?? '127.0.0.1'}:${connection.port ?? DEFAULT_PORTS.oracle}/${connection.database}`
          : '',
      ].filter(line => line !== '')
      return `${lines.join('\n')}\n`
    }
    case 'hive':
      return connection.user !== undefined
        ? `!connect jdbc:hive2://${connection.host ?? '127.0.0.1'}:${connection.port ?? DEFAULT_PORTS.hive}/${connection.database} ${connection.user} ${connection.password ?? ''}\n`
        : ''
    case 'mysql':
    case 'postgres':
    case 'sqlite':
    case 'impala':
      return ''
  }
}

/** Apply one deployment override's extra args in front of the built-in flags. */
function withOverrides(flags: readonly string[], override?: ClientConfig): readonly string[] {
  if (override === undefined || override.args === undefined) return flags
  return [...override.args, ...flags]
}

/**
 * Build one client invocation for a query execution (plain output). Flags
 * come BEFORE the connection arguments everywhere: sqlite3 takes
 * `[options] <database>`, and putting flags first is harmless for the others.
 */
export function buildClientTemplate(
  type: DatabaseType,
  connection: DatabaseConnection,
  override?: ClientConfig,
): ClientTemplate {
  return {
    command: override?.command ?? DEFAULT_CLIENTS_COMMAND[type],
    args: [...withOverrides(QUERY_ARGS[type], override), ...connectionArgs(type, connection)],
    env: credentialEnv(type, connection),
    stdinPrefix: stdinPrefix(type, connection),
  }
}

/** Build one client invocation for metadata runs (machine-readable flags). */
export function buildIntrospectTemplate(
  type: DatabaseType,
  connection: DatabaseConnection,
  override?: ClientConfig,
): ClientTemplate {
  return {
    command: override?.command ?? DEFAULT_CLIENTS_COMMAND[type],
    args: [...withOverrides(INTROSPECT_ARGS[type], override), ...connectionArgs(type, connection)],
    env: credentialEnv(type, connection),
    stdinPrefix: stdinPrefix(type, connection),
  }
}

/**
 * The table-listing SQL per type, run at /connect time to verify
 * connectivity: the connected database's own tables (mysql uses the
 * connection's database as the schema; postgres lists `public`; oracle lists
 * the connected user's tables; hive/impala list the default database).
 */
export function tableListingSql(type: DatabaseType, connection?: DatabaseConnection): string {
  switch (type) {
    case 'mysql': return `SHOW TABLES FROM \`${connection?.database ?? ''}\`;`
    case 'postgres': return "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1;"
    case 'sqlite': return "SELECT name FROM sqlite_master WHERE type='table' ORDER BY 1;"
    case 'oracle': return 'SELECT table_name FROM user_tables ORDER BY 1;'
    case 'hive':
    case 'impala': return 'SHOW TABLES;'
  }
}

/**
 * Metadata query per kind × type. `schema`/`table` are identifier whitelist
 * validated by the caller (`[A-Za-z0-9_$#.-]`) before they reach here.
 */
export function metadataQuery(
  kind: 'schemas' | 'tables' | 'describe',
  type: DatabaseType,
  schema?: string,
  table?: string,
): string {
  switch (kind) {
    case 'schemas':
      switch (type) {
        case 'mysql': return 'SHOW DATABASES;'
        case 'postgres': return 'SELECT schema_name FROM information_schema.schemata ORDER BY 1;'
        case 'sqlite': return "SELECT 'main';"
        case 'oracle': return 'SELECT username FROM all_users ORDER BY 1;'
        case 'hive':
        case 'impala': return 'SHOW DATABASES;'
      }
    case 'tables':
      switch (type) {
        case 'mysql': return `SHOW TABLES FROM \`${schema}\`;`
        case 'postgres': return `SELECT tablename FROM pg_tables WHERE schemaname='${schema}' ORDER BY 1;`
        case 'sqlite': return "SELECT name FROM sqlite_master WHERE type='table' ORDER BY 1;"
        case 'oracle': return `SELECT table_name FROM all_tables WHERE owner='${schema}' ORDER BY 1;`
        case 'hive':
        case 'impala': return `SHOW TABLES IN ${schema};`
      }
    case 'describe':
      switch (type) {
        case 'mysql': return `DESCRIBE \`${schema}\`.\`${table}\`;`
        case 'postgres': return `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='${schema}' AND table_name='${table}' ORDER BY ordinal_position;`
        case 'sqlite': return `PRAGMA table_info("${table}");`
        case 'oracle': return `SELECT column_name, data_type, nullable FROM all_tab_columns WHERE owner='${schema}' AND table_name='${table}' ORDER BY column_id;`
        case 'hive':
        case 'impala': return `DESCRIBE ${schema}.${table};`
      }
  }
}

/**
 * Split one type's machine-readable listing output into trimmed lines.
 * Header lines are stripped per type: mysql `--batch` prints a header row
 * (skip 1); postgres `-t`, sqlite `-noheader`, oracle `SET HEADING OFF`,
 * hive/impala batch modes print none (skip 0).
 */
export function parseListing(type: DatabaseType, stdout: string): string[] {
  const lines = stdout.split('\n')
  const start = type === 'mysql' ? 1 : 0
  const items: string[] = []
  for (let index = start; index < lines.length; index += 1) {
    const name = lines[index]!.trim()
    if (name.length > 0) items.push(name)
  }
  return items
}

/** Parse one type's table-listing output (the /connect connectivity check). */
export function parseTableListing(type: DatabaseType, stdout: string): string[] {
  return parseListing(type, stdout)
}

/** One described column (nullable absent when the client reports none). */
export interface ColumnInfo {
  name: string
  type: string
  nullable?: boolean
}

/**
 * Parse one type's describe output into columns. Formats:
 * - mysql `--batch`: `Field\tType\tNull\tKey\t...` (skip header);
 * - postgres `-t -A`: `name|type|is_nullable`;
 * - sqlite `-noheader -list`: `cid|name|type|notnull|dflt|pk` (name is part 1);
 * - oracle (`SET COLSEP '|'`, heading off): `NAME|TYPE|NULLABLE`;
 * - hive/impala batch: `name\ttype\tcomment`.
 */
export function parseColumns(type: DatabaseType, stdout: string): ColumnInfo[] {
  const lines = stdout.split('\n')
  const start = type === 'mysql' ? 1 : 0
  const columns: ColumnInfo[] = []
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]!.trim()
    if (line.length === 0) continue
    const parts = line.includes('\t') ? line.split('\t') : line.split('|')
    // sqlite PRAGMA table_info leads with the column id; every other client
    // reports the name first.
    const nameIndex = type === 'sqlite' ? 1 : 0
    const name = parts[nameIndex]?.trim() ?? ''
    const columnType = parts[nameIndex + 1]?.trim() ?? ''
    if (name.length === 0) continue
    const rawNullable = parts[nameIndex + 2]?.trim().toLowerCase()
    let nullable: boolean | undefined
    switch (type) {
      case 'mysql': nullable = rawNullable === 'yes'; break
      case 'postgres': nullable = rawNullable === 'yes'; break
      case 'sqlite': nullable = rawNullable !== '1'; break
      case 'oracle': nullable = rawNullable === 'y'; break
      case 'hive':
      case 'impala': nullable = undefined; break
    }
    columns.push({ name, type: columnType, ...nullable !== undefined ? { nullable } : {} })
  }
  return columns
}
