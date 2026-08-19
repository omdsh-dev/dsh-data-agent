/**
 * Pure CLI-client template construction for the supported database types.
 * Everything here is a function of (type, connection, optional overrides) —
 * no process, no I/O — so the CLI injection-safety surface is unit-testable:
 * argv stays an array (never shell-interpreted), the SQL itself always
 * travels on stdin, and passwords only ever appear in the environment
 * entries (`MYSQL_PWD` / `PGPASSWORD` / `SQLCMDPASSWORD`) or in a stdin
 * connect prefix (Oracle `connect`, Hive `!connect`) — never in argv, logs,
 * or returns. ClickHouse HTTP authentication lives in the shared runner.
 *
 * Metadata (schemas / tables / describe) queries and their per-type output
 * parsers live here too, so the /schemas /tables /describe routes stay thin.
 * @module @yejiming/dsh-data-agent/clients
 */

import type { DatabaseConnection, DatabaseType } from './connections.ts'
import { defaultDatabasePort, defaultDatabaseUser } from './database-types.ts'
import z from 'schemastery'
import {
  assertSingleStatement,
  assertSqlServerSafeInput,
  hasTopLevelKeyword,
  maskSqlLiteralsAndComments,
  stripTrailingTerminator,
} from './sql.ts'
export { assertSingleStatement, assertSqlServerSafeInput, hasTopLevelKeyword, stripTrailingTerminator }

/**
 * Whitespace / comment stripping for {@link classifyStatement}: remove
 * leading whitespace, `--` line comments, and nested `/* ... *​/` block
 * comments so the first meaningful token can be read reliably.
 */
function stripLeadingComments(sql: string): string {
  let rest = sql
  for (;;) {
    let changed = false
    // Leading whitespace.
    const trimmed = rest.replace(/^\s+/, '')
    if (trimmed !== rest) { rest = trimmed; changed = true }
    // `--` line comment (to end of line).
    if (rest.startsWith('--')) {
      const newline = rest.indexOf('\n')
      rest = newline === -1 ? '' : rest.slice(newline + 1)
      changed = true
      continue
    }
    // Nested `/* ... */` block comment.
    if (rest.startsWith('/*')) {
      const end = scanBlockCommentEnd(rest, 2)
      rest = end === -1 ? '' : rest.slice(end)
      changed = true
      continue
    }
    // Nothing stripped this pass; also re-trim if the above left whitespace.
    if (!changed) {
      const retrim = rest.replace(/^\s+/, '')
      if (retrim !== rest) { rest = retrim; continue }
      break
    }
  }
  return rest
}

/** Find the index just past a `/* ... *​/` block starting at `start` (nesting-aware). */
function scanBlockCommentEnd(sql: string, start: number): number {
  let depth = 1
  let i = start
  while (i < sql.length) {
    if (sql.startsWith('/*', i)) { depth += 1; i += 2; continue }
    if (sql.startsWith('*/', i)) {
      depth -= 1
      i += 2
      if (depth === 0) return i
      continue
    }
    i += 1
  }
  return -1
}

/**
 * Strip a `WITH` prefix down to the main query: remove `WITH [RECURSIVE]`,
 * then consume successive `name [ (cols) ] AS ( ... )` clauses (comma
 * separated, parenthesis-aware) until the leading keyword of the main
 * statement. Falls back to the whole (comment-stripped) input when the CTE
 * shape does not parse cleanly, in which case {@link classifyStatement} treats
 * it as a write (conservative).
 */
function stripWithBody(sql: string): string {
  let rest = stripLeadingComments(sql).replace(/^[A-Za-z_]+/, '') // drop WITH
  rest = stripLeadingComments(rest)
  if (/^RECURSIVE\b/i.test(rest)) rest = stripLeadingComments(rest.replace(/^[A-Za-z_]+/, ''))
  for (;;) {
    rest = stripLeadingComments(rest)
    if (rest === '' || !/^[A-Za-z_][A-Za-z0-9_$]*/.test(rest)) break
    // consume the CTE name and its optional column list
    rest = stripLeadingComments(rest.replace(/^[A-Za-z_][A-Za-z0-9_$]*/, ''))
    rest = stripLeadingComments(rest)
    if (rest.startsWith('(')) {
      const afterCols = skipParens(rest, 0)
      rest = stripLeadingComments(afterCols === -1 ? rest : rest.slice(afterCols))
    }
    rest = stripLeadingComments(rest)
    if (!/^AS\b/i.test(rest)) break
    rest = stripLeadingComments(rest.replace(/^[A-Za-z_]+/, ''))
    rest = stripLeadingComments(rest)
    if (!rest.startsWith('(')) break
    const afterBody = skipParens(rest, 0)
    if (afterBody === -1) return sql // malformed: conservative write
    rest = stripLeadingComments(rest.slice(afterBody))
    rest = stripLeadingComments(rest)
    if (rest.startsWith(',')) { rest = stripLeadingComments(rest.slice(1)); continue }
    break
  }
  return stripLeadingComments(rest)
}

/** Index just past a balanced parenthesis group starting at `start` (0-based). */
function skipParens(sql: string, start: number): number {
  let depth = 0
  let i = start
  while (i < sql.length) {
    const ch = sql[i]!
    if (ch === '(') { depth += 1; i += 1; continue }
    if (ch === ')') {
      depth -= 1
      i += 1
      if (depth === 0) return i
      continue
    }
    i += 1
  }
  return -1
}

/**
 * Classify a SQL text as a read or write statement by its FIRST effective
 * token (a conservative read whitelist, not a parser). `with` is read only
 * when its body's first token is `select`. SQLite `pragma` is read in its
 * query form and write when a value is assigned.
 */
export function classifyStatement(sql: string, type: DatabaseType): 'read' | 'write' {
  const rest = stripLeadingComments(sql)
  const tokenMatch = rest.match(/^[A-Za-z_]+/)
  if (tokenMatch === null) return 'write'
  const token = tokenMatch[0].toLowerCase()
  const executable = maskSqlLiteralsAndComments(rest)
  if (type === 'sqlserver' && /\binto\b/i.test(executable)) return 'write'
  if ((type === 'mysql' || type === 'doris' || type === 'clickhouse')
    && /\binto\s+(?:out|dump)file\b/i.test(executable)) return 'write'
  switch (token) {
    case 'select':
    case 'show':
    case 'describe':
    case 'desc':
    case 'explain':
      return 'read'
    case 'pragma': {
      if (type !== 'sqlite') return 'write'
      // SQLite PRAGMA is read-only in its query form (name or name(args))
      // but becomes a write when a value is assigned (`PRAGMA name = value`).
      const afterPragma = rest.replace(/^pragma\b/i, '').trimStart()
      return /^(?:[A-Za-z_][A-Za-z0-9_$]*(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_$]*)?|"[^"]+"|`[^`]+`)\s*=/.test(afterPragma)
        ? 'write'
        : 'read'
    }
    case 'with': {
      // `WITH <name> [ (cols) ] AS ( ... ) [, ...] <main>`: strip the CTE
      // definitions, then classify the remaining main query's first token.
      const body = stripWithBody(rest)
      const bodyToken = body.match(/^[A-Za-z_]+/)?.[0]?.toLowerCase()
      return bodyToken === 'select' ? 'read' : 'write'
    }
    default:
      return 'write'
  }
}

/**
 * Enforce the configured `maxRows` on a read query instead of relying on the
 * prompt. SELECT/CTE-read statements get a real top-level LIMIT (Oracle uses
 * a ROWNUM wrapper because it has no LIMIT); SHOW/DESCRIBE/EXPLAIN/PRAGMA are
 * left untouched here and are capped while parsing structured output.
 *
 * An existing numeric top-level LIMIT is rewritten when it is larger than
 * `maxRows`; a smaller existing LIMIT is preserved, and a non-numeric or
 * unparseable LIMIT is left for the client (structured tools still truncate).
 */
export function enforceReadRowLimit(sql: string, type: DatabaseType, maxRows: number): string {
  if (classifyStatement(sql, type) !== 'read') return sql
  const first = stripLeadingComments(sql).match(/^[A-Za-z_]+/)?.[0]?.toLowerCase()
  if (first !== 'select' && first !== 'with') return sql
  if (type === 'sqlserver') return enforceSqlServerRowLimit(sql, maxRows)
  const hadTrailingSemicolon = /;\s*$/.test(sql)
  if (!hasTopLevelKeyword(sql, 'limit') && type !== 'oracle') {
    const body = stripTrailingTerminator(sql)
    return `${body} LIMIT ${maxRows}${hadTrailingSemicolon ? ';' : ''}`
  }
  if (type === 'oracle') {
    return `SELECT * FROM (${stripTrailingTerminator(sql)}) dsh_limit WHERE ROWNUM <= ${maxRows}${hadTrailingSemicolon ? ';' : ''}`
  }
  if (!hasTopLevelKeyword(sql, 'limit')) return sql
  return rewriteTopLevelLimit(sql, maxRows)
}

/** Rare control separator keeps ordinary tabs/pipes inside sqlcmd values intact. */
export const SQLSERVER_COLUMN_SEPARATOR = '\u001f'

function findTopLevelKeywordIndex(sql: string, keyword: string): number {
  const masked = maskSqlLiteralsAndComments(sql)
  const needle = keyword.toLowerCase()
  let depth = 0
  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index]!
    if (char === '(') { depth += 1; continue }
    if (char === ')') { depth = Math.max(0, depth - 1); continue }
    if (depth !== 0) continue
    if (masked.slice(index, index + needle.length).toLowerCase() !== needle) continue
    const before = index === 0 ? '' : masked[index - 1]!
    const after = masked[index + needle.length] ?? ''
    if ((before === '' || !/[A-Za-z0-9_$]/.test(before))
      && (after === '' || !/[A-Za-z0-9_$]/.test(after))) return index
  }
  return -1
}

/** Add or tighten a T-SQL row limit without ever emitting MySQL LIMIT. */
function enforceSqlServerRowLimit(sql: string, maxRows: number): string {
  const hadTrailingSemicolon = /;\s*$/.test(sql)
  const body = stripTrailingTerminator(sql)
  for (const keyword of ['union', 'intersect', 'except']) {
    if (hasTopLevelKeyword(body, keyword)) {
      throw new Error('SQL Server compound query 无法安全自动限行，请显式包装查询并使用 TOP')
    }
  }

  const selectIndex = findTopLevelKeywordIndex(body, 'select')
  if (selectIndex === -1) throw new Error('SQL Server 查询无法定位顶层 SELECT，无法安全自动限行')
  const offsetIndex = findTopLevelKeywordIndex(body, 'offset')
  const fetchIndex = findTopLevelKeywordIndex(body, 'fetch')
  if (offsetIndex !== -1 || fetchIndex !== -1) {
    if (offsetIndex === -1 || fetchIndex === -1 || fetchIndex < offsetIndex) {
      throw new Error('SQL Server OFFSET/FETCH 查询无法安全自动改写，请使用完整的 OFFSET ... FETCH NEXT n ROWS ONLY')
    }
    const fetch = body.slice(fetchIndex).match(/^fetch\s+next\s+(\d+)\s+rows?\s+only\b/i)
    if (fetch === null) {
      throw new Error('SQL Server OFFSET/FETCH 查询无法安全自动改写，请显式设置数字 FETCH NEXT')
    }
    const current = Number(fetch[1])
    if (current <= maxRows) return sql
    const replacement = fetch[0].replace(fetch[1]!, String(maxRows))
    return `${body.slice(0, fetchIndex)}${replacement}${body.slice(fetchIndex + fetch[0].length)}${hadTrailingSemicolon ? ';' : ''}`
  }
  const tail = body.slice(selectIndex + 'select'.length)
  const prefixMatch = tail.match(/^(\s+(?:all\s+|distinct\s+)?)(?:top\s*(?:\(\s*(\d+)\s*\)|(\d+))(\s+percent)?(\s+with\s+ties)?\s*)?/i)
  if (prefixMatch === null) throw new Error('SQL Server SELECT 形态无法安全自动限行')
  const existing = prefixMatch[2] ?? prefixMatch[3]
  if (prefixMatch[4] !== undefined || prefixMatch[5] !== undefined) {
    throw new Error('SQL Server TOP PERCENT/WITH TIES 无法安全自动限行，请改用显式 TOP (n)')
  }
  if (existing !== undefined) {
    const current = Number(existing)
    if (current <= maxRows) return sql
    const topStart = selectIndex + 'select'.length + prefixMatch[1]!.length
    const topLength = prefixMatch[0].length - prefixMatch[1]!.length
    return `${body.slice(0, topStart)}TOP (${maxRows}) ${body.slice(topStart + topLength)}${hadTrailingSemicolon ? ';' : ''}`
  }

  const insertAt = selectIndex + 'select'.length + prefixMatch[1]!.length
  return `${body.slice(0, insertAt)}TOP (${maxRows}) ${body.slice(insertAt)}${hadTrailingSemicolon ? ';' : ''}`
}

/** Rewrite the first top-level `LIMIT n` / `LIMIT n, m` with a capped row count. */
function rewriteTopLevelLimit(sql: string, maxRows: number): string {
  let depth = 0
  let index = 0
  while (index < sql.length) {
    const char = sql[index]!
    if (/\s/.test(char)) { index += 1; continue }
    if (sql.startsWith('--', index)) {
      const newline = sql.indexOf('\n', index + 2)
      index = newline === -1 ? sql.length : newline + 1
      continue
    }
    if (sql.startsWith('/*', index)) {
      // Reuse the public scanner: `hasTopLevelKeyword` already proved there is
      // a top-level LIMIT; this branch only needs to skip comments. Nested
      // block comments are handled with the same depth loop.
      let depthComment = 1
      index += 2
      while (index < sql.length && depthComment > 0) {
        if (sql.startsWith('/*', index)) { depthComment += 1; index += 2; continue }
        if (sql.startsWith('*/', index)) { depthComment -= 1; index += 2; continue }
        index += 1
      }
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      index += 1
      while (index < sql.length) {
        if (sql[index] === '\\' && index + 1 < sql.length && quote !== '`') {
          index += 2
          continue
        }
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) { index += 2; continue }
          index += 1
          break
        }
        index += 1
      }
      continue
    }
    if (char === '(') { depth += 1; index += 1; continue }
    if (char === ')') { depth = Math.max(0, depth - 1); index += 1; continue }

    if (depth === 0 && sql.slice(index, index + 5).toLowerCase() === 'limit'
      && (index === 0 || !/[A-Za-z0-9_$]/.test(sql[index - 1]!))
      && (index + 5 >= sql.length || !/[A-Za-z0-9_$]/.test(sql[index + 5]!))) {
      const match = sql.slice(index).match(/^LIMIT\s+(ALL|\d+)(\s*,\s*\d+)?/i)
      if (match === null) return sql
      const firstValue = match[1]!
      const hasOffsetPart = match[2] !== undefined
      let replacement = ''
      if (hasOffsetPart) {
        const rowCount = Number(match[2]!.match(/\d+/)![0])
        replacement = `LIMIT ${firstValue === 'ALL' ? '0' : firstValue}, ${Math.min(rowCount, maxRows)}`
      } else if (/^\d+$/.test(firstValue)) {
        replacement = `LIMIT ${Math.min(Number(firstValue), maxRows)}`
      } else {
        replacement = `LIMIT ${maxRows}`
      }
      return sql.slice(0, index) + replacement + sql.slice(index + match[0].length)
    }
    index += 1
  }
  return sql
}

/**
 * Validate and quote one schema/table identifier for a safe metadata query.
 * Identifiers are restricted to `[A-Za-z0-9_$]+` and then wrapped per type:
 * backticks (mysql/hive/impala) or double quotes (postgres/oracle/sqlite),
 * with the wrapping quote doubled for any interior occurrence. Rejects any
 * input that could cross the identifier boundary (`#`, `--`, `;`, `'`, `` ` ``,
 * `"`, `.`, `-` are all refused).
 */
export function sanitizeIdentifier(type: DatabaseType, identifier: string): string {
  if (!/^[A-Za-z0-9_$]+$/.test(identifier)) {
    throw new Error(`标识符含非法字符（仅允许字母、数字与 _ $）：${identifier}`)
  }
  switch (type) {
    case 'mysql':
    case 'doris':
    case 'clickhouse':
    case 'hive':
    case 'impala':
      return '`' + identifier.replace(/`/g, '``') + '`'
    case 'postgres':
    case 'oracle':
    case 'sqlite':
      return '"' + identifier.replace(/"/g, '""') + '"'
    case 'sqlserver':
      return '[' + identifier.replace(/]/g, ']]') + ']'
  }
}

/**
 * Quote one identifier-shaped value as a SQL string literal (single quotes,
 * interior `'` doubled). postgres/oracle metadata queries filter system
 * catalogs by NAME (a string value), not by identifier, so those positions
 * need a quoted literal — not {@link sanitizeIdentifier}'s identifier quoting.
 * The whitelist already excludes `'`, so doubling is a defense-in-depth no-op
 * here but keeps the helper correct for any future widened charset.
 */
function quoteStringLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'"
}

/** One deployment override for a database type's CLI client. */
export interface ClientConfig {
  /** Executable name (resolved through PATH) or absolute path. */
  command?: string
  /** Extra flag arguments prepended before the built-in flags. */
  args?: readonly string[]
  /** Absolute directories searched after the current subprocess PATH. */
  searchPaths?: readonly string[]
}

/** Database types backed by a locally resolved CLI executable. */
export type CliDatabaseType = Exclude<DatabaseType, 'clickhouse'>

/** Loader schema for one client override (all fields optional at input). */
export const clientConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()),
  searchPaths: z.array(z.string()),
})

/** Loader schema for CLI overrides; ClickHouse has connection-level HTTP transport instead. */
const cliDatabaseTypeSchema = z.union([
  z.const('mysql'), z.const('postgres'), z.const('sqlite'), z.const('oracle'),
  z.const('hive'), z.const('impala'), z.const('doris'), z.const('sqlserver'),
])
export const clientsSchema = z.dict(clientConfigSchema, cliDatabaseTypeSchema)
  // Schemastery's Dict type models a finite key union as required at the type
  // level even though the runtime validator accepts a sparse dictionary.
  .default({} as never)

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

/**
 * MySQL output must match the subprocess collector's UTF-8 decoder instead of
 * inheriting a platform locale such as a legacy Windows code page.
 */
const MYSQL_COMMON_ARGS = ['--default-character-set=utf8mb4', '--batch', '--raw'] as const

/** Query-mode flag arguments per type (plain/human output). */
const QUERY_ARGS: Readonly<Record<DatabaseType, readonly string[]>> = {
  mysql: MYSQL_COMMON_ARGS,
  doris: MYSQL_COMMON_ARGS,
  postgres: ['-A'],
  sqlite: ['-header', '-column'],
  oracle: ['-S', '/nolog'],
  hive: ['--silent=true', '--outputformat=tsv2'],
  impala: ['-B'],
  sqlserver: ['-b', '-V', '11', '-r', '1', '-x', '-W', '-w', '65535', '-s', SQLSERVER_COLUMN_SEPARATOR],
  clickhouse: [],
}

/** Introspection-mode flag arguments per type (machine-readable listing). */
const INTROSPECT_ARGS: Readonly<Record<DatabaseType, readonly string[]>> = {
  mysql: MYSQL_COMMON_ARGS,
  doris: MYSQL_COMMON_ARGS,
  postgres: ['-t', '-A'],
  sqlite: ['-noheader', '-list'],
  oracle: ['-S', '/nolog'],
  hive: ['--silent=true', '--outputformat=tsv2'],
  impala: ['-B'],
  sqlserver: ['-b', '-V', '11', '-r', '1', '-x', '-W', '-w', '65535', '-s', SQLSERVER_COLUMN_SEPARATOR, '-h', '-1'],
  clickhouse: [],
}

/** Structured `sql-query` flag arguments: header + one row per line. */
const STRUCTURED_QUERY_ARGS: Readonly<Record<DatabaseType, readonly string[]>> = {
  mysql: MYSQL_COMMON_ARGS,
  doris: MYSQL_COMMON_ARGS,
  postgres: ['-A'],
  sqlite: ['-header', '-csv'],
  oracle: ['-S', '/nolog'],
  hive: ['--silent=true', '--outputformat=tsv2'],
  impala: ['-B', '--print_header'],
  sqlserver: ['-b', '-V', '11', '-r', '1', '-x', '-W', '-w', '65535', '-s', SQLSERVER_COLUMN_SEPARATOR],
  clickhouse: [],
}

/** Built-in commands per type (also the loader defaults; see `src/defaults.ts`). */
const DEFAULT_CLIENTS_COMMAND: Readonly<Record<DatabaseType, string>> = {
  mysql: 'mysql',
  postgres: 'psql',
  sqlite: 'sqlite3',
  oracle: 'sqlplus',
  hive: 'beeline',
  impala: 'impala-shell',
  doris: 'mysql',
  sqlserver: 'sqlcmd',
  clickhouse: '',
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
    case 'doris':
      return [
        '-h', connection.host ?? '127.0.0.1',
        '-P', String(connection.port ?? defaultDatabasePort(type)),
        '-u', connection.user ?? defaultDatabaseUser(type),
        '-D', connection.database,
      ]
    case 'postgres':
      return [
        '-h', connection.host ?? '127.0.0.1',
        '-p', String(connection.port ?? defaultDatabasePort('postgres')),
        '-U', connection.user ?? 'postgres',
        '-d', connection.database,
      ]
    case 'sqlite':
      return [connection.database]
    case 'impala':
      return [
        '-i', `${connection.host ?? '127.0.0.1'}:${connection.port ?? defaultDatabasePort('impala')}`,
        '-d', connection.database,
      ]
    case 'sqlserver':
      return [
        '-S', `${connection.host ?? '127.0.0.1'},${connection.port ?? defaultDatabasePort('sqlserver')}`,
        '-U', connection.user ?? defaultDatabaseUser(type),
        '-d', connection.database,
      ]
    case 'oracle':
    case 'hive':
      return []
    case 'clickhouse':
      throw new Error('ClickHouse 使用官方 HTTP 客户端，不构造 CLI argv')
  }
}

/** Credential environment entries per type; absent password yields an empty env. */
function credentialEnv(type: DatabaseType, connection: DatabaseConnection): Readonly<Record<string, string>> {
  const password = connection.password
  if (password === undefined) return {}
  switch (type) {
    case 'mysql':
    case 'doris':
      return { MYSQL_PWD: password }
    case 'postgres':
      return { PGPASSWORD: password }
    case 'sqlserver':
      return { SQLCMDPASSWORD: password }
    case 'clickhouse':
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
          ? `connect ${connection.user}${connection.password !== undefined ? `/${connection.password}` : ''}@${connection.host ?? '127.0.0.1'}:${connection.port ?? defaultDatabasePort('oracle')}/${connection.database}`
          : '',
      ].filter(line => line !== '')
      return `${lines.join('\n')}\n`
    }
    case 'hive':
      return connection.user !== undefined
        ? `!connect jdbc:hive2://${connection.host ?? '127.0.0.1'}:${connection.port ?? defaultDatabasePort('hive')}/${connection.database} ${connection.user} ${connection.password ?? ''}\n`
        : ''
    case 'mysql':
    case 'doris':
    case 'postgres':
    case 'sqlite':
    case 'impala':
    case 'clickhouse':
      return ''
    case 'sqlserver':
      return 'SET NOCOUNT ON;\n'
  }
}

/**
 * Oracle structured-query prefix: same connect block as {@link stdinPrefix},
 * but with HEADING ON and UNDERLINE OFF so `sql-query` can read the column
 * names from the first output line.
 */
function structuredStdinPrefix(type: DatabaseType, connection: DatabaseConnection): string {
  if (type !== 'oracle') return stdinPrefix(type, connection)
  const lines = [
    'SET PAGESIZE 0',
    'SET FEEDBACK OFF',
    'SET HEADING ON',
    'SET UNDERLINE OFF',
    "SET COLSEP '|'",
    'SET TRIMSPOOL ON',
    connection.user !== undefined
      ? `connect ${connection.user}${connection.password !== undefined ? `/${connection.password}` : ''}@${connection.host ?? '127.0.0.1'}:${connection.port ?? defaultDatabasePort('oracle')}/${connection.database}`
      : '',
  ].filter(line => line !== '')
  return `${lines.join('\n')}\n`
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
  if (type === 'clickhouse') throw new Error('ClickHouse 使用官方 HTTP 客户端，不构造 CLI 模板')
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
  if (type === 'clickhouse') throw new Error('ClickHouse 使用官方 HTTP 客户端，不构造 CLI 模板')
  return {
    command: override?.command ?? DEFAULT_CLIENTS_COMMAND[type],
    args: [...withOverrides(INTROSPECT_ARGS[type], override), ...connectionArgs(type, connection)],
    env: credentialEnv(type, connection),
    stdinPrefix: stdinPrefix(type, connection),
  }
}

/**
 * Build one client invocation for the structured `sql-query` tool: every
 * supported client prints a header row followed by one row per line (mysql
 * tab, postgres pipe, sqlite csv, oracle pipe, hive/impala tsv).
 */
export function buildStructuredQueryTemplate(
  type: DatabaseType,
  connection: DatabaseConnection,
  override?: ClientConfig,
): ClientTemplate {
  if (type === 'clickhouse') throw new Error('ClickHouse 使用官方 HTTP 客户端，不构造 CLI 模板')
  return {
    command: override?.command ?? DEFAULT_CLIENTS_COMMAND[type],
    args: [...withOverrides(STRUCTURED_QUERY_ARGS[type], override), ...connectionArgs(type, connection)],
    env: credentialEnv(type, connection),
    stdinPrefix: structuredStdinPrefix(type, connection),
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
    case 'mysql':
    case 'doris': return `SHOW TABLES FROM \`${connection?.database ?? ''}\`;`
    case 'clickhouse': return 'SELECT name FROM system.tables WHERE database = currentDatabase() ORDER BY name;'
    case 'postgres': return "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1;"
    case 'sqlite': return "SELECT name FROM sqlite_master WHERE type='table' ORDER BY 1;"
    case 'oracle': return 'SELECT table_name FROM user_tables ORDER BY 1;'
    case 'hive':
    case 'impala': return 'SHOW TABLES;'
    case 'sqlserver': return "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME;"
  }
}

/**
 * Metadata query per kind × type. `schema`/`table` are identifier whitelist
 * validated by the caller (`[A-Za-z0-9_$]`) before they reach here.
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
        case 'mysql':
        case 'doris': return 'SHOW DATABASES;'
        case 'clickhouse': return 'SELECT name FROM system.databases ORDER BY name;'
        case 'postgres': return 'SELECT schema_name FROM information_schema.schemata ORDER BY 1;'
        case 'sqlite': return "SELECT 'main';"
        case 'oracle': return 'SELECT username FROM all_users ORDER BY 1;'
        case 'hive':
        case 'impala': return 'SHOW DATABASES;'
        case 'sqlserver': return 'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA ORDER BY SCHEMA_NAME;'
      }
    case 'tables':
      switch (type) {
        case 'mysql':
        case 'doris': return `SHOW TABLES FROM ${sanitizeIdentifier(type, schema!)};`
        case 'clickhouse': return `SELECT name FROM system.tables WHERE database=${quoteStringLiteral(schema!)} ORDER BY name;`
        case 'postgres': return `SELECT tablename FROM pg_tables WHERE schemaname=${quoteStringLiteral(schema!)} ORDER BY 1;`
        case 'sqlite': return "SELECT name FROM sqlite_master WHERE type='table' ORDER BY 1;"
        case 'oracle': return `SELECT table_name FROM all_tables WHERE owner=${quoteStringLiteral(schema!)} ORDER BY 1;`
        case 'hive':
        case 'impala': return `SHOW TABLES IN ${sanitizeIdentifier(type, schema!)};`
        case 'sqlserver': return `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=${quoteStringLiteral(schema!)} AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME;`
      }
    case 'describe':
      switch (type) {
        case 'mysql':
        case 'doris': return `DESCRIBE ${sanitizeIdentifier(type, schema!)}.${sanitizeIdentifier(type, table!)};`
        case 'clickhouse': return `SELECT name, type, if(startsWith(type, 'Nullable('), 'YES', 'NO') FROM system.columns WHERE database=${quoteStringLiteral(schema!)} AND table=${quoteStringLiteral(table!)} ORDER BY position;`
        case 'postgres': return `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema=${quoteStringLiteral(schema!)} AND table_name=${quoteStringLiteral(table!)} ORDER BY ordinal_position;`
        case 'sqlite': return `PRAGMA table_info(${sanitizeIdentifier(type, table!)});`
        case 'oracle': return `SELECT column_name, data_type, nullable FROM all_tab_columns WHERE owner=${quoteStringLiteral(schema!)} AND table_name=${quoteStringLiteral(table!)} ORDER BY column_id;`
        case 'hive':
        case 'impala': return `DESCRIBE ${sanitizeIdentifier(type, schema!)}.${sanitizeIdentifier(type, table!)};`
        case 'sqlserver': return `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=${quoteStringLiteral(schema!)} AND TABLE_NAME=${quoteStringLiteral(table!)} ORDER BY ORDINAL_POSITION;`
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
  const lines = (type === 'sqlserver' ? stripSqlServerRowCountFooter(stdout) : stdout).split('\n')
  const start = type === 'mysql' || type === 'doris' ? 1 : 0
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

const SQLSERVER_ROW_COUNT_FOOTER = /^\((?:\d+\s+rows?\s+affected|(?:共)?影响(?:了)?\s*\d+\s*行|\d+\s*行受(?:到)?影响)\)$/i

/** Remove only terminal sqlcmd row-count footer lines, never matching data in the middle. */
export function stripSqlServerRowCountFooter(stdout: string): string {
  const newline = stdout.includes('\r\n') ? '\r\n' : '\n'
  const lines = stdout.replace(/\r\n?/g, '\n').split('\n')
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop()
  while (lines.length > 0 && SQLSERVER_ROW_COUNT_FOOTER.test(lines[lines.length - 1]!.trim())) {
    lines.pop()
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop()
  }
  return lines.join(newline)
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
  const lines = (type === 'sqlserver' ? stripSqlServerRowCountFooter(stdout) : stdout).split(/\r?\n/)
  const start = type === 'mysql' || type === 'doris' ? 1 : 0
  const columns: ColumnInfo[] = []
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]!.trim()
    if (line.length === 0) continue
    const parts = type === 'sqlserver'
      ? line.split(SQLSERVER_COLUMN_SEPARATOR)
      : line.includes('\t') ? line.split('\t') : line.split('|')
    // sqlite PRAGMA table_info leads with the column id; every other client
    // reports the name first.
    const nameIndex = type === 'sqlite' ? 1 : 0
    const name = parts[nameIndex]?.trim() ?? ''
    const columnType = parts[nameIndex + 1]?.trim() ?? ''
    if (name.length === 0) continue
    const rawNullable = parts[nameIndex + 2]?.trim().toLowerCase()
    let nullable: boolean | undefined
    switch (type) {
      case 'mysql':
      case 'doris': nullable = rawNullable === 'yes'; break
      case 'clickhouse': nullable = rawNullable === 'yes'; break
      case 'postgres': nullable = rawNullable === 'yes'; break
      case 'sqlite': nullable = rawNullable !== '1'; break
      case 'oracle': nullable = rawNullable === 'y'; break
      case 'sqlserver': nullable = rawNullable === 'yes'; break
      case 'hive':
      case 'impala': nullable = undefined; break
    }
    columns.push({ name, type: columnType, ...nullable !== undefined ? { nullable } : {} })
  }
  return columns
}
