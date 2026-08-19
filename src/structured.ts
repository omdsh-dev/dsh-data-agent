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

import type { DatabaseType } from './connections.ts'
import { SQLSERVER_COLUMN_SEPARATOR, stripSqlServerRowCountFooter } from './clients.ts'

/** Canonical parsed query output before elapsed/affected metadata is added. */
export interface ParsedQueryOutput {
  columns: string[]
  rows: Record<string, string | null>[]
  /** True when the output contained more rows than `maxRows` and was capped. */
  rowLimitExceeded: boolean
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

function splitLine(line: string, delimiter: '\t' | '|'): string[] {
  return line.split(delimiter)
}

/** Make column names valid unique JSON object keys. */
function uniqueColumns(columns: string[]): string[] {
  const used = new Set<string>()
  return columns.map((raw, index) => {
    let name = raw.trim()
    if (name.length === 0) name = `column_${index + 1}`
    if (used.has(name)) {
      let suffix = 2
      while (used.has(`${name}_${suffix}`)) suffix += 1
      name = `${name}_${suffix}`
    }
    used.add(name)
    return name
  })
}

function rowObject(columns: string[], fields: (string | null)[]): Record<string, string | null> {
  const row: Record<string, string | null> = {}
  for (let index = 0; index < columns.length; index += 1) {
    row[columns[index]!] = fields[index] ?? null
  }
  return row
}

function emptyOutput(): ParsedQueryOutput {
  return { columns: [], rows: [], rowLimitExceeded: false }
}

function skipLeadingBlank(lines: string[]): number {
  let index = 0
  while (index < lines.length && lines[index]!.trim().length === 0) index += 1
  return index
}

/** PostgreSQL `-A` appends a `(N rows)` / `(N row)` footer after SELECT output. */
function isPostgresFooter(line: string): boolean {
  return /^\(\d+ rows?\)$/.test(line.trim())
}

function parseDelimited(
  stdout: string,
  delimiter: '\t' | '|',
  maxRows: number,
  skipFooter = false,
): ParsedQueryOutput {
  const text = normalizeNewlines(stdout)
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  const headerIndex = skipLeadingBlank(lines)
  if (headerIndex >= lines.length) return emptyOutput()

  const columns = uniqueColumns(splitLine(lines[headerIndex]!, delimiter))
  const rows: Record<string, string | null>[] = []
  let rowLimitExceeded = false

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!
    if (skipFooter && isPostgresFooter(line)) continue
    if (rows.length >= maxRows) {
      rowLimitExceeded = true
      break
    }
    rows.push(rowObject(columns, splitLine(line, delimiter)))
  }
  return { columns, rows, rowLimitExceeded }
}

/** Minimal RFC-4180-style parser for sqlite3 `-csv` output. */
function parseCsv(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  let index = 0

  const pushField = (): void => { record.push(field); field = '' }
  const pushRecord = (): void => { pushField(); records.push(record); record = [] }

  while (index < text.length) {
    const char = text[index]!
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        quoted = false
        index += 1
        continue
      }
      field += char
      index += 1
      continue
    }
    if (char === '"' && field.length === 0) {
      quoted = true
      index += 1
      continue
    }
    if (char === ',') {
      pushField()
      index += 1
      continue
    }
    if (char === '\n') {
      pushRecord()
      index += 1
      continue
    }
    if (char === '\r') {
      if (text[index + 1] === '\n') index += 1
      pushRecord()
      index += 1
      continue
    }
    field += char
    index += 1
  }
  if (field.length > 0 || record.length > 0) pushRecord()
  return records
}

function parseCsvOutput(stdout: string, maxRows: number): ParsedQueryOutput {
  const records = parseCsv(normalizeNewlines(stdout)).filter((record) =>
    !(record.length === 1 && record[0] === ''),
  )
  if (records.length === 0) return emptyOutput()
  const columns = uniqueColumns(records[0]!)
  const rows: Record<string, string | null>[] = []
  let rowLimitExceeded = false
  for (let index = 1; index < records.length; index += 1) {
    if (rows.length >= maxRows) {
      rowLimitExceeded = true
      break
    }
    rows.push(rowObject(columns, records[index]!))
  }
  return { columns, rows, rowLimitExceeded }
}

function parseClickHouseOutput(stdout: string, maxRows: number): ParsedQueryOutput {
  const lines = normalizeNewlines(stdout).split('\n').filter(line => line.trim() !== '')
  if (lines.length === 0) return emptyOutput()
  const parsed = lines.map((line) => JSON.parse(line) as unknown)
  if (!Array.isArray(parsed[0])) throw new Error('ClickHouse结构化输出缺少列名行')
  const columns = uniqueColumns(parsed[0].map(value => String(value)))
  const firstDataIndex = parsed.length > 1 && Array.isArray(parsed[1]) ? 2 : 1
  const rows: Record<string, string | null>[] = []
  let rowLimitExceeded = false
  for (let index = firstDataIndex; index < parsed.length; index += 1) {
    if (rows.length >= maxRows) { rowLimitExceeded = true; break }
    const record = parsed[index]
    if (!Array.isArray(record)) throw new Error('ClickHouse结构化输出包含非数组数据行')
    rows.push(rowObject(columns, record.map((value): string | null => {
      if (value === null || value === undefined) return null
      return typeof value === 'object' ? JSON.stringify(value) : String(value)
    })))
  }
  return { columns, rows, rowLimitExceeded }
}

function parseSqlServerOutput(stdout: string, maxRows: number): ParsedQueryOutput {
  const text = normalizeNewlines(stripSqlServerRowCountFooter(stdout))
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const headerIndex = skipLeadingBlank(lines)
  if (headerIndex >= lines.length) return emptyOutput()
  const columns = uniqueColumns(lines[headerIndex]!.split(SQLSERVER_COLUMN_SEPARATOR))
  let dataIndex = headerIndex + 1
  const divider = lines[dataIndex]?.split(SQLSERVER_COLUMN_SEPARATOR)
  if (divider !== undefined && divider.length === columns.length
    && divider.every(field => /^-+$/.test(field.trim()))) dataIndex += 1
  const rows: Record<string, string | null>[] = []
  let rowLimitExceeded = false
  for (let index = dataIndex; index < lines.length; index += 1) {
    if (lines[index]!.trim() === '') continue
    if (rows.length >= maxRows) { rowLimitExceeded = true; break }
    const fields = lines[index]!.split(SQLSERVER_COLUMN_SEPARATOR)
    const row: Record<string, string | null> = {}
    for (let column = 0; column < columns.length; column += 1) {
      const value = fields[column]
      row[columns[column]!] = value === undefined || value === 'NULL' ? null : value
    }
    rows.push(row)
  }
  return { columns, rows, rowLimitExceeded }
}

/**
 * Parse one database type's structured-query stdout. The matching template is
 * `buildStructuredQueryTemplate`: mysql tab-separated with a header, postgres
 * pipe-separated with a header and row-count footer, sqlite CSV with a header,
 * oracle pipe-separated with heading on, hive/impala tsv with a header.
 */
export function parseStructuredQueryOutput(
  type: DatabaseType,
  stdout: string,
  maxRows: number,
): ParsedQueryOutput {
  switch (type) {
    case 'mysql':
      return parseDelimited(stdout, '\t', maxRows)
    case 'doris':
      return parseDelimited(stdout, '\t', maxRows)
    case 'clickhouse':
      return parseClickHouseOutput(stdout, maxRows)
    case 'postgres':
      return parseDelimited(stdout, '|', maxRows, true)
    case 'sqlite':
      return parseCsvOutput(stdout, maxRows)
    case 'oracle':
      return parseDelimited(stdout, '|', maxRows)
    case 'hive':
    case 'impala':
      return parseDelimited(stdout, '\t', maxRows)
    case 'sqlserver':
      return parseSqlServerOutput(stdout, maxRows)
  }
}
