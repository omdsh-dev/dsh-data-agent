import { describe, expect, it } from 'vitest'
import { assertSingleStatement, hasTopLevelKeyword } from '../src/sql.ts'
import { parseStructuredQueryOutput } from '../src/structured.ts'

describe('assertSingleStatement', () => {
  it('accepts a single statement with or without a trailing semicolon', () => {
    expect(() => assertSingleStatement('SELECT 1')).not.toThrow()
    expect(() => assertSingleStatement('SELECT 1;')).not.toThrow()
    expect(() => assertSingleStatement('SELECT 1;   ')).not.toThrow()
    expect(() => assertSingleStatement('SELECT 1;; -- trailing')).not.toThrow()
  })

  it('rejects a terminator-only input', () => {
    expect(() => assertSingleStatement(';')).toThrow(/SQL 不能为空/)
  })

  it('rejects a second statement after a top-level semicolon', () => {
    expect(() => assertSingleStatement('SELECT 1; SELECT 2')).toThrow(/一次只允许执行一条 SQL 语句/)
    expect(() => assertSingleStatement('SELECT 1; DELETE FROM t;')).toThrow(/一次只允许执行一条 SQL 语句/)
  })

  it('ignores semicolons inside strings, quoted identifiers, comments and parentheses', () => {
    expect(() => assertSingleStatement("SELECT ';' AS semi;")).not.toThrow()
    expect(() => assertSingleStatement('SELECT ";" AS semi;')).not.toThrow()
    expect(() => assertSingleStatement('SELECT `;` AS semi;')).not.toThrow()
    expect(() => assertSingleStatement('SELECT 1; -- ; SELECT 2')).not.toThrow()
    expect(() => assertSingleStatement('SELECT (1 + 2);')).not.toThrow()
  })
})

describe('hasTopLevelKeyword', () => {
  it('finds top-level keywords but not subquery/string occurrences', () => {
    expect(hasTopLevelKeyword('SELECT * FROM t LIMIT 5', 'LIMIT')).toBe(true)
    expect(hasTopLevelKeyword('SELECT * FROM (SELECT * FROM t LIMIT 5) x', 'LIMIT')).toBe(false)
    expect(hasTopLevelKeyword("SELECT 'LIMIT' AS word", 'LIMIT')).toBe(false)
  })
})

describe('parseStructuredQueryOutput', () => {
  it('parses mysql tab-separated header + rows', () => {
    expect(parseStructuredQueryOutput('mysql', 'id\tname\n1\tAlice\n2\tBob\n', 100)).toEqual({
      columns: ['id', 'name'],
      rows: [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }],
      rowLimitExceeded: false,
    })
  })

  it('parses postgres pipe output and skips its row-count footer', () => {
    expect(parseStructuredQueryOutput('postgres', 'id|name\n1|Alice\n(1 row)\n', 100)).toEqual({
      columns: ['id', 'name'],
      rows: [{ id: '1', name: 'Alice' }],
      rowLimitExceeded: false,
    })
  })

  it('parses sqlite csv output including quoted fields', () => {
    expect(parseStructuredQueryOutput('sqlite', 'id,name,note\n1,"Alice","hello, ""db"""\n', 100)).toEqual({
      columns: ['id', 'name', 'note'],
      rows: [{ id: '1', name: 'Alice', note: 'hello, "db"' }],
      rowLimitExceeded: false,
    })
  })

  it('enforces maxRows while parsing and reports the extra row', () => {
    expect(parseStructuredQueryOutput('mysql', 'id\n1\n2\n3\n', 2)).toEqual({
      columns: ['id'],
      rows: [{ id: '1' }, { id: '2' }],
      rowLimitExceeded: true,
    })
  })

  it('keeps a blank postgres line as an empty single-column row', () => {
    expect(parseStructuredQueryOutput('postgres', 'x\n\n(1 row)\n', 10)).toEqual({
      columns: ['x'],
      rows: [{ x: '' }],
      rowLimitExceeded: false,
    })
  })

  it('preserves data-field whitespace', () => {
    expect(parseStructuredQueryOutput('mysql', 'id\tname\n1\t Alice \n', 10).rows[0])
      .toEqual({ id: '1', name: ' Alice ' })
  })

  it('deduplicates repeated column names', () => {
    expect(parseStructuredQueryOutput('mysql', 'id\tid\n1\t2\n', 10)).toEqual({
      columns: ['id', 'id_2'],
      rows: [{ id: '1', id_2: '2' }],
      rowLimitExceeded: false,
    })
  })
})
