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
 * @module @yejiming/dsh-data-agent/clients
 */
import type { DatabaseConnection, DatabaseType } from './connections.ts';
import z from 'schemastery';
import { assertSingleStatement, hasTopLevelKeyword, stripTrailingTerminator } from './sql.ts';
export { assertSingleStatement, hasTopLevelKeyword, stripTrailingTerminator };
/**
 * Classify a SQL text as a read or write statement by its FIRST effective
 * token (a conservative read whitelist, not a parser). `with` is read only
 * when its body's first token is `select`. SQLite `pragma` is read in its
 * query form and write when a value is assigned.
 */
export declare function classifyStatement(sql: string, type: DatabaseType): 'read' | 'write';
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
export declare function enforceReadRowLimit(sql: string, type: DatabaseType, maxRows: number): string;
/**
 * Validate and quote one schema/table identifier for a safe metadata query.
 * Identifiers are restricted to `[A-Za-z0-9_$]+` and then wrapped per type:
 * backticks (mysql/hive/impala) or double quotes (postgres/oracle/sqlite),
 * with the wrapping quote doubled for any interior occurrence. Rejects any
 * input that could cross the identifier boundary (`#`, `--`, `;`, `'`, `` ` ``,
 * `"`, `.`, `-` are all refused).
 */
export declare function sanitizeIdentifier(type: DatabaseType, identifier: string): string;
/** One deployment override for a database type's CLI client. */
export interface ClientConfig {
    /** Executable name (resolved through PATH) or absolute path. */
    command: string;
    /** Extra flag arguments prepended before the built-in flags. */
    args?: readonly string[];
}
/** Loader schema for one client override (all fields optional at input). */
export declare const clientConfigSchema: z<Schemastery.ObjectS<{
    command: z<string, string>;
    args: z<string[], string[]>;
}>, Schemastery.ObjectT<{
    command: z<string, string>;
    args: z<string[], string[]>;
}>>;
/** Loader schema for the whole `clients` config object (any type key). */
export declare const clientsSchema: z<import("cosmokit").Dict<{
    command?: string | null | undefined;
    args?: string[] | null | undefined;
} & import("@deepseek-ai/cosmokit").Dict, string>, import("cosmokit").Dict<Schemastery.ObjectT<{
    command: z<string, string>;
    args: z<string[], string[]>;
}>, string>>;
/**
 * A fully constructed client invocation: argv (command + flags, no SQL),
 * the credential env entries, and the stdin prefix (Oracle/Hive connect
 * lines) the runner writes before the SQL text.
 */
export interface ClientTemplate {
    /** Executable to resolve through {@link SubprocessService.resolveExecutable}. */
    command: string;
    /** Flag arguments only; the SQL text is written to stdin by the runner. */
    args: readonly string[];
    /** Credential env entries (e.g. `{ MYSQL_PWD }`), never argv. */
    env: Readonly<Record<string, string>>;
    /** stdin text written BEFORE the SQL (Oracle SET/connect, Hive !connect); '' otherwise. */
    stdinPrefix: string;
}
/**
 * Build one client invocation for a query execution (plain output). Flags
 * come BEFORE the connection arguments everywhere: sqlite3 takes
 * `[options] <database>`, and putting flags first is harmless for the others.
 */
export declare function buildClientTemplate(type: DatabaseType, connection: DatabaseConnection, override?: ClientConfig): ClientTemplate;
/** Build one client invocation for metadata runs (machine-readable flags). */
export declare function buildIntrospectTemplate(type: DatabaseType, connection: DatabaseConnection, override?: ClientConfig): ClientTemplate;
/**
 * Build one client invocation for the structured `sql-query` tool: every
 * supported client prints a header row followed by one row per line (mysql
 * tab, postgres pipe, sqlite csv, oracle pipe, hive/impala tsv).
 */
export declare function buildStructuredQueryTemplate(type: DatabaseType, connection: DatabaseConnection, override?: ClientConfig): ClientTemplate;
/**
 * The table-listing SQL per type, run at /connect time to verify
 * connectivity: the connected database's own tables (mysql uses the
 * connection's database as the schema; postgres lists `public`; oracle lists
 * the connected user's tables; hive/impala list the default database).
 */
export declare function tableListingSql(type: DatabaseType, connection?: DatabaseConnection): string;
/**
 * Metadata query per kind × type. `schema`/`table` are identifier whitelist
 * validated by the caller (`[A-Za-z0-9_$]`) before they reach here.
 */
export declare function metadataQuery(kind: 'schemas' | 'tables' | 'describe', type: DatabaseType, schema?: string, table?: string): string;
/**
 * Split one type's machine-readable listing output into trimmed lines.
 * Header lines are stripped per type: mysql `--batch` prints a header row
 * (skip 1); postgres `-t`, sqlite `-noheader`, oracle `SET HEADING OFF`,
 * hive/impala batch modes print none (skip 0).
 */
export declare function parseListing(type: DatabaseType, stdout: string): string[];
/** Parse one type's table-listing output (the /connect connectivity check). */
export declare function parseTableListing(type: DatabaseType, stdout: string): string[];
/** One described column (nullable absent when the client reports none). */
export interface ColumnInfo {
    name: string;
    type: string;
    nullable?: boolean;
}
/**
 * Parse one type's describe output into columns. Formats:
 * - mysql `--batch`: `Field\tType\tNull\tKey\t...` (skip header);
 * - postgres `-t -A`: `name|type|is_nullable`;
 * - sqlite `-noheader -list`: `cid|name|type|notnull|dflt|pk` (name is part 1);
 * - oracle (`SET COLSEP '|'`, heading off): `NAME|TYPE|NULLABLE`;
 * - hive/impala batch: `name\ttype\tcomment`.
 */
export declare function parseColumns(type: DatabaseType, stdout: string): ColumnInfo[];
