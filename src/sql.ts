/**
 * Lightweight SQL-text scanning helpers shared by the sql-cmd tool half and
 * the /query route. This is intentionally NOT a SQL parser: the scanner only
 * understands lexical boundaries (strings, quoted identifiers, comments and
 * parenthesis depth) well enough to make the two agent-loop guarantees from
 * docs/optimization-opportunities.md:
 *
 * - a single tool call carries at most ONE SQL statement;
 * - `maxRows` can be enforced with a real dialect-level row bound, not just a prompt.
 *
 * @module @yejiming/dsh-data-agent/sql
 */

const IDENT_CHAR = /[A-Za-z0-9_$]/

function isWhitespace(char: string): boolean {
  return /\s/.test(char)
}

function isIdentChar(char: string): boolean {
  return IDENT_CHAR.test(char)
}

function skipQuoted(sql: string, start: number): number {
  const quote = sql[start]!
  let index = start + 1
  while (index < sql.length) {
    const char = sql[index]!
    if (char === '\\' && index + 1 < sql.length && quote !== '`') {
      index += 2
      continue
    }
    if (char === quote) {
      if (sql[index + 1] === quote) {
        index += 2
        continue
      }
      return index + 1
    }
    index += 1
  }
  return sql.length
}

function skipDollarQuoted(sql: string, start: number): number {
  const match = sql.slice(start).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)
  if (match === null) return -1
  const delimiter = match[0]
  const end = sql.indexOf(delimiter, start + delimiter.length)
  return end === -1 ? sql.length : end + delimiter.length
}

function skipOracleQuoted(sql: string, start: number): number {
  // Oracle alternative quoting: q'[ ... ]', q'{ ... }', q'( ... )', q'< ... >'.
  if (!/^q'/i.test(sql.slice(start, start + 2))) return -1
  const open = sql[start + 2]
  if (open === undefined) return sql.length
  const pairs: Record<string, string> = { '[': ']', '{': '}', '(': ')', '<': '>' }
  const close = pairs[open] ?? open
  let index = start + 3
  while (index < sql.length) {
    if (sql[index] === close && sql[index + 1] === "'") return index + 2
    index += 1
  }
  return sql.length
}

function skipBlockComment(sql: string, start: number): number {
  let depth = 1
  let index = start + 2
  while (index < sql.length) {
    if (sql.startsWith('/*', index)) {
      depth += 1
      index += 2
      continue
    }
    if (sql.startsWith('*/', index)) {
      depth -= 1
      index += 2
      if (depth === 0) return index
      continue
    }
    index += 1
  }
  return sql.length
}

function skipLineComment(sql: string, start: number): number {
  const newline = sql.indexOf('\n', start)
  return newline === -1 ? sql.length : newline + 1
}

/**
 * Walk the SQL text, invoking `onSemicolon` for every top-level statement
 * separator (parenthesis depth zero, outside strings, quoted identifiers and
 * comments).
 */
function scanTopLevelSemicolons(sql: string, onSemicolon: (index: number) => void): void {
  let depth = 0
  let index = 0
  while (index < sql.length) {
    const char = sql[index]!
    if (isWhitespace(char)) { index += 1; continue }
    if (sql.startsWith('--', index)) { index = skipLineComment(sql, index + 2); continue }
    if (sql.startsWith('/*', index)) { index = skipBlockComment(sql, index); continue }
    if (char === "'" || char === '"' || char === '`') { index = skipQuoted(sql, index); continue }
    if (char === '$') {
      const dollarEnd = skipDollarQuoted(sql, index)
      if (dollarEnd !== -1) { index = dollarEnd; continue }
    }
    const oracleEnd = skipOracleQuoted(sql, index)
    if (oracleEnd !== -1) { index = oracleEnd; continue }
    if (char === '(') { depth += 1; index += 1; continue }
    if (char === ')') { depth = Math.max(0, depth - 1); index += 1; continue }
    if (char === ';' && depth === 0) onSemicolon(index)
    index += 1
  }
}

/** Whether meaningful SQL content exists after `index` (trailing `;`/comments ignored). */
function hasContentAfter(sql: string, index: number): boolean {
  let cursor = index
  while (cursor < sql.length) {
    const char = sql[cursor]!
    if (isWhitespace(char)) { cursor += 1; continue }
    if (char === ';') { cursor += 1; continue }
    if (sql.startsWith('--', cursor)) { cursor = skipLineComment(sql, cursor + 2); continue }
    if (sql.startsWith('/*', cursor)) { cursor = skipBlockComment(sql, cursor); continue }
    return true
  }
  return false
}

/**
 * Throw unless `sql` contains at most one statement. A single trailing
 * semicolon (and any number of repeated trailing semicolons / comments) is
 * accepted; a semicolon followed by real content is rejected.
 */
export function assertSingleStatement(sql: string, label = 'SQL'): void {
  if (stripTrailingTerminator(sql).trim().length === 0) {
    throw new Error(`${label}: SQL 不能为空`)
  }
  const semicolons: number[] = []
  scanTopLevelSemicolons(sql, (index) => { semicolons.push(index) })
  const offending = semicolons.find((index) => hasContentAfter(sql, index + 1))
  if (offending === undefined) return
  throw new Error(
    `${label}: 一次只允许执行一条 SQL 语句（第 ${offending + 1} 个字符后的分号不是末尾分号）。`
    + '多条语句请拆成多次调用；客户端进程独立、自动提交，不支持在多次调用间保持事务。',
  )
}

/** Whether `keyword` appears at top level as a whole word in `sql`. */
export function hasTopLevelKeyword(sql: string, keyword: string): boolean {
  const needle = keyword.toLowerCase()
  let depth = 0
  let index = 0
  while (index < sql.length) {
    const char = sql[index]!
    if (isWhitespace(char)) { index += 1; continue }
    if (sql.startsWith('--', index)) { index = skipLineComment(sql, index + 2); continue }
    if (sql.startsWith('/*', index)) { index = skipBlockComment(sql, index); continue }
    if (char === "'" || char === '"' || char === '`') { index = skipQuoted(sql, index); continue }
    if (char === '$') {
      const dollarEnd = skipDollarQuoted(sql, index)
      if (dollarEnd !== -1) { index = dollarEnd; continue }
    }
    const oracleEnd = skipOracleQuoted(sql, index)
    if (oracleEnd !== -1) { index = oracleEnd; continue }
    if (char === '(') { depth += 1; index += 1; continue }
    if (char === ')') { depth = Math.max(0, depth - 1); index += 1; continue }

    if (depth === 0
      && sql.slice(index, index + needle.length).toLowerCase() === needle
      && (index === 0 || !isIdentChar(sql[index - 1]!))
      && (index + needle.length >= sql.length || !isIdentChar(sql[index + needle.length]!))) {
      return true
    }
    index += 1
  }
  return false
}

/**
 * Preserve executable SQL text while replacing strings, quoted identifiers,
 * dollar/Oracle quoted bodies, and comments with spaces. Newlines are kept so
 * line-oriented client directives can be checked without false positives.
 */
export function maskSqlLiteralsAndComments(sql: string): string {
  // Preserve the UTF-16 indices used by the scanner. `[...sql]` would
  // collapse astral characters and shift every following mask range.
  const chars = sql.split('')
  const mask = (start: number, end: number): void => {
    for (let index = start; index < end; index += 1) {
      if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' '
    }
  }
  let index = 0
  while (index < sql.length) {
    const char = sql[index]!
    if (sql.startsWith('--', index)) {
      const end = skipLineComment(sql, index + 2)
      mask(index, end)
      index = end
      continue
    }
    if (sql.startsWith('/*', index)) {
      const end = skipBlockComment(sql, index)
      mask(index, end)
      index = end
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      const end = skipQuoted(sql, index)
      mask(index, end)
      index = end
      continue
    }
    if (char === '[') {
      let end = index + 1
      while (end < sql.length) {
        if (sql[end] === ']' && sql[end + 1] === ']') { end += 2; continue }
        if (sql[end] === ']') { end += 1; break }
        end += 1
      }
      mask(index, end)
      index = end
      continue
    }
    if (char === '$') {
      const end = skipDollarQuoted(sql, index)
      if (end !== -1) {
        mask(index, end)
        index = end
        continue
      }
    }
    const oracleEnd = skipOracleQuoted(sql, index)
    if (oracleEnd !== -1) {
      mask(index, oracleEnd)
      index = oracleEnd
      continue
    }
    index += 1
  }
  return chars.join('')
}

/** Reject commands interpreted by sqlcmd itself rather than by SQL Server. */
export function assertSqlServerSafeInput(sql: string, label = 'SQL Server SQL'): void {
  const executable = maskSqlLiteralsAndComments(sql)
  if (/\$\([^\r\n)]*\)/.test(executable)) {
    throw new Error(`${label}: 禁止 sqlcmd 变量替换 $(...)`)
  }
  for (const line of executable.split(/\r?\n/)) {
    const command = line.trimStart()
    if (command === '') continue
    if (/^!!/.test(command) || /^:/.test(command)
      || /^(?:reset|ed|exit|quit)\b/i.test(command)
      || /^go(?:\s+\d+)?\s*;?\s*$/i.test(command)) {
      throw new Error(`${label}: 禁止 sqlcmd 元命令、GO 批次分隔符与客户端脚本指令`)
    }
  }
}

function trailingLineCommentStart(sql: string, end: number): number {
  const lineStart = sql.lastIndexOf('\n', end - 1) + 1
  let index = lineStart
  while (index < end) {
    const char = sql[index]!
    if (char === "'" || char === '"' || char === '`') {
      index = skipQuoted(sql, index)
      continue
    }
    if (sql.startsWith('--', index)) {
      const tail = sql.slice(index + 2, end)
      return tail.length === 0 || isWhitespace(tail[0]!) ? index : -1
    }
    index += 1
  }
  return -1
}

function blockCommentEndingAt(sql: string, end: number): number {
  let depth = 0
  let candidate = -1
  let index = 0
  while (index < end) {
    const char = sql[index]!
    if (isWhitespace(char)) { index += 1; continue }
    if (char === "'" || char === '"' || char === '`') { index = skipQuoted(sql, index); continue }
    if (sql.startsWith('--', index)) { index = skipLineComment(sql, index + 2); continue }
    if (sql.startsWith('/*', index)) {
      const start = index
      let commentDepth = 1
      index += 2
      while (index < end && commentDepth > 0) {
        if (sql.startsWith('/*', index)) { commentDepth += 1; index += 2; continue }
        if (sql.startsWith('*/', index)) {
          commentDepth -= 1
          index += 2
          if (commentDepth === 0) {
            if (index === end) candidate = start
            break
          }
          continue
        }
        index += 1
      }
      continue
    }
    index += 1
  }
  return candidate
}

/**
 * Strip trailing whitespace, statement terminators and trailing comments so a
 * limit clause can be appended to the actual statement text. Only comments
 * that occupy the whole tail are removed; the preceding statement is kept.
 */
export function stripTrailingTerminator(sql: string): string {
  let end = sql.length
  for (;;) {
    while (end > 0 && isWhitespace(sql[end - 1]!)) end -= 1
    if (end > 0 && sql[end - 1] === ';') {
      end -= 1
      continue
    }
    if (end >= 2 && sql.slice(end - 2, end) === '*/') {
      const start = blockCommentEndingAt(sql, end)
      if (start !== -1) {
        end = start
        continue
      }
    }
    const lineComment = trailingLineCommentStart(sql, end)
    if (lineComment !== -1) {
      end = lineComment
      continue
    }
    return sql.slice(0, end)
  }
}
