/**
 * Lightweight SQL-text scanning helpers shared by the sqlcmd tool half and
 * the /query route. This is intentionally NOT a SQL parser: the scanner only
 * understands lexical boundaries (strings, quoted identifiers, comments and
 * parenthesis depth) well enough to make the two agent-loop guarantees from
 * docs/optimization-opportunities.md:
 *
 * - a single tool call carries at most ONE SQL statement;
 * - `maxRows` can be enforced with a real top-level LIMIT, not just a prompt.
 *
 * @module @yejiming/dsh-data-agent/sql
 */
/**
 * Throw unless `sql` contains at most one statement. A single trailing
 * semicolon (and any number of repeated trailing semicolons / comments) is
 * accepted; a semicolon followed by real content is rejected.
 */
export declare function assertSingleStatement(sql: string, label?: string): void;
/** Whether `keyword` appears at top level as a whole word in `sql`. */
export declare function hasTopLevelKeyword(sql: string, keyword: string): boolean;
/**
 * Strip trailing whitespace, statement terminators and trailing comments so a
 * limit clause can be appended to the actual statement text. Only comments
 * that occupy the whole tail are removed; the preceding statement is kept.
 */
export declare function stripTrailingTerminator(sql: string): string;
