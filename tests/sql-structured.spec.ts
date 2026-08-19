import { describe, expect, it } from 'vitest'
import { SQLSERVER_COLUMN_SEPARATOR } from '../src/clients.ts'
import { assertSingleStatement, assertSqlServerSafeInput, hasTopLevelKeyword } from '../src/sql.ts'
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

describe('assertSqlServerSafeInput', () => {
  it('rejects sqlcmd scripting, variables, and batch separators', () => {
    for (const sql of [
      '!! dir',
      ':r file.sql',
      ':connect other-server',
      ':out results.txt',
      ':setvar name value',
      ':on error exit',
      'SELECT $(SECRET)',
      'SELECT 1\nGO',
      'reset',
      'exit',
      'quit',
    ]) expect(() => assertSqlServerSafeInput(sql)).toThrow(/禁止/)
  })

  it('ignores directive-shaped text inside strings, comments, and quoted identifiers', () => {
    expect(() => assertSqlServerSafeInput("SELECT ':r', 'GO', '$(SECRET)', N'😀!!'")) .not.toThrow()
    expect(() => assertSqlServerSafeInput('SELECT [GO] FROM [!!table] -- :connect x')).not.toThrow()
    expect(() => assertSqlServerSafeInput('/* :out x\nGO */ SELECT 1')).not.toThrow()
  })

  it('keeps UTF-16 masking aligned before a real directive', () => {
    expect(() => assertSqlServerSafeInput("SELECT N'😀'\n:r file.sql")).toThrow(/禁止/)
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

  it('parses ClickHouse names/types rows with Unicode, NULL, objects, and delimiters', () => {
    const stdout = [
      JSON.stringify(['id', '名称', 'note']),
      JSON.stringify(['UInt64', 'Nullable(String)', 'Object']),
      JSON.stringify([1, '数据\t|值', { nested: true }]),
      JSON.stringify([2, null, null]),
      '',
    ].join('\n')
    expect(parseStructuredQueryOutput('clickhouse', stdout, 10)).toEqual({
      columns: ['id', '名称', 'note'],
      rows: [
        { id: '1', 名称: '数据\t|值', note: '{"nested":true}' },
        { id: '2', 名称: null, note: null },
      ],
      rowLimitExceeded: false,
    })
    expect(parseStructuredQueryOutput('clickhouse', '', 10)).toEqual({
      columns: [], rows: [], rowLimitExceeded: false,
    })
  })

  it('parses Doris as its own MySQL-family type', () => {
    expect(parseStructuredQueryOutput('doris', 'id\t名称\n1\t订单\n', 10)).toEqual({
      columns: ['id', '名称'],
      rows: [{ id: '1', 名称: '订单' }],
      rowLimitExceeded: false,
    })
  })

  it('parses SQL Server unit-separated output and removes only a terminal footer', () => {
    const row = (...values: string[]): string => values.join(SQLSERVER_COLUMN_SEPARATOR)
    const stdout = [
      row('id', 'note', 'nullable'),
      row('--', '----', '--------'),
      row('1', 'tab\tand|pipe', 'NULL'),
      row('2', '(2 rows affected)', '文字'),
      '',
      '(2 行受影响)',
      '',
    ].join('\n')
    expect(parseStructuredQueryOutput('sqlserver', stdout, 10)).toEqual({
      columns: ['id', 'note', 'nullable'],
      rows: [
        { id: '1', note: 'tab\tand|pipe', nullable: null },
        { id: '2', note: '(2 rows affected)', nullable: '文字' },
      ],
      rowLimitExceeded: false,
    })
  })
})
