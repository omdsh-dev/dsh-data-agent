/**
 * Structured result parsing for the `sql-query` tool half. Each supported
 * database type has a machine-readable query template (see
 * {@link buildStructuredQueryTemplate} in `src/clients.ts`); this module turns
 * that captured stdout into the canonical `{ columns, rows }` shape and
 * enforces the row cap a second time (first line of defense is the SQL-level
 * dialect-aware SQL rewriting, second is truncation while parsing).
 *
 * The parsers are deliberately output-shape based, not grammar based. Values
 * stay as strings because every client renders SQL values as text (NULL
 * rendering differs per client), and duplicate column names are made unique
 * so the row objects are valid lossless JSON maps.
 * @module @yejiming/dsh-data-agent/structured
 */
import type { DatabaseType } from './connections.ts';
/** Canonical parsed query output before elapsed/affected metadata is added. */
export interface ParsedQueryOutput {
    columns: string[];
    rows: Record<string, string | null>[];
    /** True when the output contained more rows than `maxRows` and was capped. */
    rowLimitExceeded: boolean;
}
/**
 * Parse one database type's structured-query stdout. The matching template is
 * `buildStructuredQueryTemplate`: mysql tab-separated with a header, postgres
 * pipe-separated with a header and row-count footer, sqlite CSV with a header,
 * oracle pipe-separated with heading on, hive/impala tsv with a header.
 */
export declare function parseStructuredQueryOutput(type: DatabaseType, stdout: string, maxRows: number): ParsedQueryOutput;
