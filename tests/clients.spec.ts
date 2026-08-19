import { describe, expect, it } from 'vitest'
import {
  buildClientTemplate,
  buildIntrospectTemplate,
  buildStructuredQueryTemplate,
  classifyStatement,
  enforceReadRowLimit,
  metadataQuery,
  parseColumns,
  parseListing,
  parseTableListing,
  sanitizeIdentifier,
  SQLSERVER_COLUMN_SEPARATOR,
  stripSqlServerRowCountFooter,
  tableListingSql,
} from '../src/clients.ts'

const mysqlConnection = {
  type: 'mysql' as const,
  host: 'db.internal',
  port: 3307,
  user: 'app',
  database: 'orders',
  password: 'hunter2',
}

const postgresConnection = {
  type: 'postgres' as const,
  host: 'pg.internal',
  port: 5433,
  user: 'owner',
  database: 'analytics',
  password: 'secret',
}

const sqliteConnection = { type: 'sqlite' as const, database: '/tmp/orders.db' }

const dorisConnection = {
  type: 'doris' as const,
  host: 'doris.internal',
  port: 9030,
  user: 'root',
  database: 'analytics',
  password: 'doris-secret',
}

const sqlServerConnection = {
  type: 'sqlserver' as const,
  host: 'sql.internal',
  port: 1433,
  user: 'sa',
  database: 'warehouse',
  password: 'sql-secret',
}

describe('buildClientTemplate', () => {
  it('builds the mysql argv with connection flags and the password only in env', () => {
    const template = buildClientTemplate('mysql', mysqlConnection)
    expect(template.command).toBe('mysql')
    expect(template.args).toEqual([
      '--default-character-set=utf8mb4', '--batch', '--raw',
      '-h', 'db.internal', '-P', '3307', '-u', 'app', '-D', 'orders',
    ])
    expect(template.env).toEqual({ MYSQL_PWD: 'hunter2' })
    // The password never appears in argv.
    expect(template.args.join(' ')).not.toContain('hunter2')
  })

  it('builds the postgres argv with connection flags and PGPASSWORD env', () => {
    const template = buildClientTemplate('postgres', postgresConnection)
    expect(template.command).toBe('psql')
    expect(template.args).toEqual([
      '-A',
      '-h', 'pg.internal', '-p', '5433', '-U', 'owner', '-d', 'analytics',
    ])
    expect(template.env).toEqual({ PGPASSWORD: 'secret' })
  })

  it('builds the sqlite argv with the file path last and no credentials', () => {
    const template = buildClientTemplate('sqlite', sqliteConnection)
    expect(template.command).toBe('sqlite3')
    expect(template.args).toEqual(['-header', '-column', '/tmp/orders.db'])
    expect(template.env).toEqual({})
  })

  it('applies defaults for missing host/port/user', () => {
    const template = buildClientTemplate('mysql', { type: 'mysql', database: 'd' })
    expect(template.args).toEqual([
      '--default-character-set=utf8mb4', '--batch', '--raw',
      '-h', '127.0.0.1', '-P', '3306', '-u', 'root', '-D', 'd',
    ])
  })

  it('honors deployment overrides for command and extra args', () => {
    const template = buildClientTemplate('mysql', mysqlConnection, {
      command: '/usr/local/bin/mysql-client',
      args: ['--protocol=tcp'],
    })
    expect(template.command).toBe('/usr/local/bin/mysql-client')
    expect(template.args).toEqual([
      '--protocol=tcp', '--default-character-set=utf8mb4', '--batch', '--raw',
      '-h', 'db.internal', '-P', '3307', '-u', 'app', '-D', 'orders',
    ])
  })

  it('never puts SQL into argv (the runner owns stdin)', () => {
    const template = buildClientTemplate('mysql', mysqlConnection)
    expect(template.args.join(' ')).not.toMatch(/SELECT|SHOW|DROP|DELETE/i)
  })

  it('keeps Doris first-class while reusing the MySQL protocol adapter', () => {
    const template = buildClientTemplate('doris', dorisConnection)
    expect(template.command).toBe('mysql')
    expect(template.args).toEqual([
      '--default-character-set=utf8mb4', '--batch', '--raw',
      '-h', 'doris.internal', '-P', '9030', '-u', 'root', '-D', 'analytics',
    ])
    expect(template.env).toEqual({ MYSQL_PWD: 'doris-secret' })
    expect(template.args.join(' ')).not.toContain('doris-secret')
  })

  it('builds the Microsoft ODBC sqlcmd invocation without weakening certificate trust', () => {
    const template = buildClientTemplate('sqlserver', sqlServerConnection)
    expect(template.command).toBe('sqlcmd')
    expect(template.args).toEqual([
      '-b', '-V', '11', '-r', '1', '-x', '-W', '-w', '65535', '-s', SQLSERVER_COLUMN_SEPARATOR,
      '-S', 'sql.internal,1433', '-U', 'sa', '-d', 'warehouse',
    ])
    expect(template.env).toEqual({ SQLCMDPASSWORD: 'sql-secret' })
    expect(template.stdinPrefix).toBe('SET NOCOUNT ON;\n')
    expect(template.args).not.toContain('-C')
    expect(template.args.join(' ')).not.toContain('sql-secret')
  })

  it('never builds a CLI template for the ClickHouse HTTP adapter', () => {
    expect(() => buildClientTemplate('clickhouse', {
      type: 'clickhouse', database: 'default', password: 'click-secret',
    })).toThrow(/HTTP/)
  })
})

describe('buildIntrospectTemplate', () => {
  it('uses machine-readable flags for each type', () => {
    expect(buildIntrospectTemplate('mysql', mysqlConnection).args).toEqual([
      '--default-character-set=utf8mb4', '--batch', '--raw',
      '-h', 'db.internal', '-P', '3307', '-u', 'app', '-D', 'orders',
    ])
    expect(buildIntrospectTemplate('postgres', postgresConnection).args).toEqual([
      '-t', '-A', '-h', 'pg.internal', '-p', '5433', '-U', 'owner', '-d', 'analytics',
    ])
    expect(buildIntrospectTemplate('sqlite', sqliteConnection).args).toEqual([
      '-noheader', '-list', '/tmp/orders.db',
    ])
    // Credentials still travel in env only.
    expect(buildIntrospectTemplate('mysql', mysqlConnection).env).toEqual({ MYSQL_PWD: 'hunter2' })
    expect(buildIntrospectTemplate('sqlserver', sqlServerConnection).args).toContain('-h')
    const structured = buildStructuredQueryTemplate('sqlserver', sqlServerConnection).args
    expect(structured).toEqual(expect.arrayContaining(['-s', SQLSERVER_COLUMN_SEPARATOR, '-x']))
    expect(structured).not.toContain('-h')
  })
})

describe('tableListingSql', () => {
  it('produces a listing statement per type', () => {
    expect(tableListingSql('mysql', mysqlConnection)).toBe('SHOW TABLES FROM `orders`;')
    expect(tableListingSql('postgres')).toContain('pg_tables')
    expect(tableListingSql('sqlite')).toContain('sqlite_master')
    expect(tableListingSql('clickhouse')).toContain('system.tables')
    expect(tableListingSql('doris', dorisConnection)).toBe('SHOW TABLES FROM `analytics`;')
    expect(tableListingSql('sqlserver')).toContain('INFORMATION_SCHEMA.TABLES')
  })
})

describe('parseTableListing', () => {
  it('parses mysql output skipping its header row', () => {
    const out = 'Tables_in_orders\ncustomers\norders\nusers\n'
    expect(parseTableListing('mysql', out)).toEqual(['customers', 'orders', 'users'])
  })

  it('parses postgres output without headers', () => {
    const out = 'customers\norders\n'
    expect(parseTableListing('postgres', out)).toEqual(['customers', 'orders'])
  })

  it('parses sqlite -noheader output without headers', () => {
    const out = 'customers\norders\n'
    expect(parseTableListing('sqlite', out)).toEqual(['customers', 'orders'])
  })

  it('ignores blank lines and trims whitespace', () => {
    expect(parseTableListing('mysql', 'Tables_in_orders\n\n  orders  \n')).toEqual(['orders'])
  })
})

const oracleConnection = {
  type: 'oracle' as const,
  host: 'ora.internal',
  port: 1522,
  user: 'scott',
  database: 'ORCLPDB1',
  password: 'tiger',
}

const hiveConnection = {
  type: 'hive' as const,
  host: 'hive.internal',
  port: 10001,
  user: 'hiveuser',
  database: 'default',
  password: 'hivepass',
}

const impalaConnection = {
  type: 'impala' as const,
  host: 'impala.internal',
  port: 21051,
  user: 'impalauser',
  database: 'analytics',
}

describe('buildClientTemplate — new types', () => {
  it('builds the oracle argv with /nolog and the connect line on stdin only', () => {
    const template = buildClientTemplate('oracle', oracleConnection)
    expect(template.command).toBe('sqlplus')
    expect(template.args).toEqual(['-S', '/nolog'])
    expect(template.env).toEqual({})
    expect(template.stdinPrefix).toContain('connect scott/tiger@ora.internal:1522/ORCLPDB1')
    // The password never appears in argv.
    expect(template.args.join(' ')).not.toContain('tiger')
  })

  it('silences sqlplus decoration and pins the column separator', () => {
    const template = buildClientTemplate('oracle', oracleConnection)
    expect(template.stdinPrefix).toContain('SET PAGESIZE 0')
    expect(template.stdinPrefix).toContain('SET HEADING OFF')
    expect(template.stdinPrefix).toContain("SET COLSEP '|'")
  })

  it('builds the hive argv with beeline flags and !connect on stdin', () => {
    const template = buildClientTemplate('hive', hiveConnection)
    expect(template.command).toBe('beeline')
    expect(template.args).toEqual(['--silent=true', '--outputformat=tsv2'])
    expect(template.env).toEqual({})
    expect(template.stdinPrefix).toBe(
      '!connect jdbc:hive2://hive.internal:10001/default hiveuser hivepass\n',
    )
    expect(template.args.join(' ')).not.toContain('hivepass')
  })

  it('builds the impala argv with -B -i and -d and never a password', () => {
    const template = buildClientTemplate('impala', impalaConnection)
    expect(template.command).toBe('impala-shell')
    expect(template.args).toEqual(['-B', '-i', 'impala.internal:21051', '-d', 'analytics'])
    expect(template.env).toEqual({})
    expect(template.stdinPrefix).toBe('')
  })

  it('applies deployment overrides for the new types', () => {
    const template = buildClientTemplate('hive', hiveConnection, {
      command: '/opt/hive/bin/beeline',
      args: ['--showHeader=false'],
    })
    expect(template.command).toBe('/opt/hive/bin/beeline')
    expect(template.args[0]).toBe('--showHeader=false')
  })

  it('introspect templates use the machine-readable flags per new type', () => {
    expect(buildIntrospectTemplate('oracle', oracleConnection).args).toEqual(['-S', '/nolog'])
    expect(buildIntrospectTemplate('hive', hiveConnection).args).toEqual(['--silent=true', '--outputformat=tsv2'])
    expect(buildIntrospectTemplate('impala', impalaConnection).args).toEqual([
      '-B', '-i', 'impala.internal:21051', '-d', 'analytics',
    ])
  })
})

describe('tableListingSql — new types', () => {
  it('lists the connected database/schema per type', () => {
    expect(tableListingSql('oracle')).toContain('user_tables')
    expect(tableListingSql('hive')).toBe('SHOW TABLES;')
    expect(tableListingSql('impala')).toBe('SHOW TABLES;')
    expect(tableListingSql('mysql', { type: 'mysql', database: 'orders' })).toBe('SHOW TABLES FROM `orders`;')
  })
})

describe('metadataQuery', () => {
  it('builds the schemas query per type', () => {
    expect(metadataQuery('schemas', 'mysql')).toBe('SHOW DATABASES;')
    expect(metadataQuery('schemas', 'postgres')).toContain('information_schema.schemata')
    expect(metadataQuery('schemas', 'sqlite')).toBe("SELECT 'main';")
    expect(metadataQuery('schemas', 'oracle')).toContain('all_users')
    expect(metadataQuery('schemas', 'hive')).toBe('SHOW DATABASES;')
    expect(metadataQuery('schemas', 'impala')).toBe('SHOW DATABASES;')
    expect(metadataQuery('schemas', 'clickhouse')).toContain('system.databases')
    expect(metadataQuery('schemas', 'doris')).toBe('SHOW DATABASES;')
    expect(metadataQuery('schemas', 'sqlserver')).toContain('INFORMATION_SCHEMA.SCHEMATA')
  })

  it('builds the tables query per type with the schema identifier', () => {
    expect(metadataQuery('tables', 'mysql', 'orders')).toBe('SHOW TABLES FROM `orders`;')
    expect(metadataQuery('tables', 'postgres', 'public')).toContain("schemaname='public'")
    expect(metadataQuery('tables', 'sqlite')).toContain('sqlite_master')
    expect(metadataQuery('tables', 'oracle', 'SCOTT')).toContain("owner='SCOTT'")
    expect(metadataQuery('tables', 'hive', 'default')).toBe('SHOW TABLES IN `default`;')
    expect(metadataQuery('tables', 'clickhouse', 'analytics')).toContain("database='analytics'")
    expect(metadataQuery('tables', 'doris', 'analytics')).toBe('SHOW TABLES FROM `analytics`;')
    expect(metadataQuery('tables', 'sqlserver', 'dbo')).toContain("TABLE_SCHEMA='dbo'")
  })

  it('builds the describe query per type', () => {
    expect(metadataQuery('describe', 'mysql', 'orders', 'line_items')).toBe('DESCRIBE `orders`.`line_items`;')
    expect(metadataQuery('describe', 'postgres', 'public', 'orders')).toContain("table_schema='public'")
    expect(metadataQuery('describe', 'sqlite', undefined, 'orders')).toBe('PRAGMA table_info("orders");')
    expect(metadataQuery('describe', 'oracle', 'SCOTT', 'EMP')).toContain("owner='SCOTT' AND table_name='EMP'")
    expect(metadataQuery('describe', 'impala', 'analytics', 'orders')).toBe('DESCRIBE `analytics`.`orders`;')
    expect(metadataQuery('describe', 'clickhouse', 'analytics', 'orders')).toContain('system.columns')
    expect(metadataQuery('describe', 'doris', 'analytics', 'orders')).toBe('DESCRIBE `analytics`.`orders`;')
    expect(metadataQuery('describe', 'sqlserver', 'dbo', 'orders')).toContain("TABLE_NAME='orders'")
  })
})

describe('parseColumns', () => {
  it('parses mysql describe output skipping the header', () => {
    const out = 'Field\tType\tNull\tKey\tDefault\tExtra\nid\tint\tNO\tPRI\tNULL\t\nname\tvarchar(64)\tYES\t\tNULL\t\n'
    expect(parseColumns('mysql', out)).toEqual([
      { name: 'id', type: 'int', nullable: false },
      { name: 'name', type: 'varchar(64)', nullable: true },
    ])
  })

  it('parses postgres output with | separators', () => {
    const out = 'id|integer|NO\namount|numeric|YES\n'
    expect(parseColumns('postgres', out)).toEqual([
      { name: 'id', type: 'integer', nullable: false },
      { name: 'amount', type: 'numeric', nullable: true },
    ])
  })

  it('parses sqlite PRAGMA output (cid|name|type|notnull|dflt|pk)', () => {
    const out = '0|id|INTEGER|1||1\n1|name|TEXT|0||0\n'
    expect(parseColumns('sqlite', out)).toEqual([
      { name: 'id', type: 'INTEGER', nullable: false },
      { name: 'name', type: 'TEXT', nullable: true },
    ])
  })

  it('parses oracle output with | separators and Y/N nullability', () => {
    const out = 'EMPNO|NUMBER|N\nENAME|VARCHAR2(10)|Y\n'
    expect(parseColumns('oracle', out)).toEqual([
      { name: 'EMPNO', type: 'NUMBER', nullable: false },
      { name: 'ENAME', type: 'VARCHAR2(10)', nullable: true },
    ])
  })

  it('parses hive/impala tsv output without nullability', () => {
    const out = 'id\tint\nname\tstring\n'
    expect(parseColumns('hive', out)).toEqual([
      { name: 'id', type: 'int' },
      { name: 'name', type: 'string' },
    ])
  })

  it('parses ClickHouse, Doris, and SQL Server describe output', () => {
    expect(parseColumns('clickhouse', 'id\tUInt64\tNO\nnote\tNullable(String)\tYES\n')).toEqual([
      { name: 'id', type: 'UInt64', nullable: false },
      { name: 'note', type: 'Nullable(String)', nullable: true },
    ])
    expect(parseColumns('doris', 'Field\tType\tNull\tKey\tDefault\tExtra\nid\tBIGINT\tNO\t\tNULL\t\n')).toEqual([
      { name: 'id', type: 'BIGINT', nullable: false },
    ])
    expect(parseColumns('sqlserver', [
      ['id', 'bigint', 'NO'].join(SQLSERVER_COLUMN_SEPARATOR),
      ['名称', 'nvarchar', 'YES'].join(SQLSERVER_COLUMN_SEPARATOR),
      '',
    ].join('\n'))).toEqual([
      { name: 'id', type: 'bigint', nullable: false },
      { name: '名称', type: 'nvarchar', nullable: true },
    ])
  })
})

describe('parseListing — new types', () => {
  it('parses oracle heading-off output', () => {
    expect(parseListing('oracle', 'SCOTT\nSYS\nSYSTEM\n')).toEqual(['SCOTT', 'SYS', 'SYSTEM'])
  })

  it('parses hive and impala batch output', () => {
    expect(parseListing('hive', 'default\nanalytics\n')).toEqual(['default', 'analytics'])
    expect(parseListing('impala', 'default\nanalytics\n')).toEqual(['default', 'analytics'])
  })
})

describe('classifyStatement', () => {
  it('classifies plain read statements', () => {
    expect(classifyStatement('SELECT * FROM orders', 'mysql')).toBe('read')
    expect(classifyStatement('  SHOW TABLES;', 'mysql')).toBe('read')
    expect(classifyStatement('describe users', 'postgres')).toBe('read')
    expect(classifyStatement('DESC users', 'postgres')).toBe('read')
    expect(classifyStatement('EXPLAIN SELECT 1', 'mysql')).toBe('read')
  })

  it('classifies read statements after line and block comments', () => {
    expect(classifyStatement('-- 注释\n  SELECT 1', 'postgres')).toBe('read')
    expect(classifyStatement('/* multi\nline */ SELECT 1', 'mysql')).toBe('read')
    expect(classifyStatement('/* nested /* x */ y */ SELECT 1', 'sqlite')).toBe('read')
  })

  it('classifies write statements', () => {
    expect(classifyStatement('DELETE FROM orders', 'mysql')).toBe('write')
    expect(classifyStatement('DROP TABLE t', 'postgres')).toBe('write')
    expect(classifyStatement('UPDATE orders SET x=1', 'sqlite')).toBe('write')
    expect(classifyStatement('INSERT INTO t VALUES (1)', 'mysql')).toBe('write')
    expect(classifyStatement('ALTER TABLE t ADD c int', 'postgres')).toBe('write')
  })

  it('classifies a SELECT-leading CTE as read', () => {
    expect(classifyStatement('WITH recent AS (SELECT * FROM orders) SELECT * FROM recent', 'sqlite')).toBe('read')
  })

  it('classifies a write-bodied CTE as write', () => {
    expect(classifyStatement('WITH d AS (SELECT 1) DELETE FROM orders', 'postgres')).toBe('write')
  })

  it('treats query PRAGMA as read and assigned PRAGMA as write for sqlite', () => {
    expect(classifyStatement('PRAGMA table_info("orders")', 'sqlite')).toBe('read')
    expect(classifyStatement('PRAGMA journal_mode = DELETE', 'sqlite')).toBe('write')
    expect(classifyStatement('PRAGMA main.cache_size = -1', 'sqlite')).toBe('write')
    expect(classifyStatement('PRAGMA user_version', 'mysql')).toBe('write')
  })

  it('returns write for empty or token-less input', () => {
    expect(classifyStatement('', 'mysql')).toBe('write')
    expect(classifyStatement('   ', 'postgres')).toBe('write')
    expect(classifyStatement('-- only a comment', 'mysql')).toBe('write')
  })

  it('classifies dialect-specific SELECT write forms without string/comment false positives', () => {
    expect(classifyStatement('SELECT * INTO archive FROM orders', 'sqlserver')).toBe('write')
    expect(classifyStatement("SELECT 'INTO archive' AS note FROM orders", 'sqlserver')).toBe('read')
    expect(classifyStatement('SELECT * FROM orders -- INTO archive', 'sqlserver')).toBe('read')
    expect(classifyStatement("SELECT * FROM orders INTO OUTFILE '/tmp/x'", 'mysql')).toBe('write')
    expect(classifyStatement("SELECT 'INTO OUTFILE' AS note", 'doris')).toBe('read')
    expect(classifyStatement('SELECT * FROM orders INTO DUMPFILE \'x\'', 'clickhouse')).toBe('write')
  })
})

describe('sanitizeIdentifier', () => {
  it('wraps mysql identifiers in backticks', () => {
    expect(sanitizeIdentifier('mysql', 'orders')).toBe('`orders`')
  })

  it('wraps hive and impala identifiers in backticks', () => {
    expect(sanitizeIdentifier('hive', 'default')).toBe('`default`')
    expect(sanitizeIdentifier('impala', 'analytics')).toBe('`analytics`')
  })

  it('wraps postgres/oracle/sqlite identifiers in double quotes', () => {
    expect(sanitizeIdentifier('postgres', 'orders')).toBe('"orders"')
    expect(sanitizeIdentifier('oracle', 'SCOTT')).toBe('"SCOTT"')
    expect(sanitizeIdentifier('sqlite', 'orders')).toBe('"orders"')
  })

  it('uses product-specific quoting for the new types', () => {
    expect(sanitizeIdentifier('clickhouse', 'events')).toBe('`events`')
    expect(sanitizeIdentifier('doris', 'events')).toBe('`events`')
    expect(sanitizeIdentifier('sqlserver', 'events')).toBe('[events]')
  })

  it('allows $ and _ but rejects injection-shaped characters', () => {
    expect(sanitizeIdentifier('postgres', 'a$b_c')).toBe('"a$b_c"')
    for (const bad of ['a#b', 'a--b', 'a;b', "a'b", 'a`b', 'a"b', 'a.b', 'a-b', '']) {
      expect(() => sanitizeIdentifier('mysql', bad)).toThrow()
    }
  })
})

describe('structured query template and read row limit', () => {
  it('builds the structured template with headers for the structured parser', () => {
    expect(buildStructuredQueryTemplate('mysql', mysqlConnection).args).toEqual([
      '--default-character-set=utf8mb4', '--batch', '--raw',
      '-h', 'db.internal', '-P', '3307', '-u', 'app', '-D', 'orders',
    ])
    expect(buildStructuredQueryTemplate('sqlite', sqliteConnection).args).toEqual([
      '-header', '-csv', '/tmp/orders.db',
    ])
    expect(buildStructuredQueryTemplate('postgres', postgresConnection).args).toEqual([
      '-A', '-h', 'pg.internal', '-p', '5433', '-U', 'owner', '-d', 'analytics',
    ])
  })

  it('appends a top-level LIMIT to an unbounded SELECT', () => {
    expect(enforceReadRowLimit('SELECT * FROM orders', 'sqlite', 25)).toBe('SELECT * FROM orders LIMIT 25')
    expect(enforceReadRowLimit('SELECT * FROM orders;', 'mysql', 50)).toBe('SELECT * FROM orders LIMIT 50;')
    expect(enforceReadRowLimit('WITH x AS (SELECT 1) SELECT * FROM x', 'postgres', 10))
      .toBe('WITH x AS (SELECT 1) SELECT * FROM x LIMIT 10')
  })

  it('inserts LIMIT before trailing terminators and comments', () => {
    expect(enforceReadRowLimit('SELECT * FROM orders; -- keep', 'mysql', 50))
      .toBe('SELECT * FROM orders LIMIT 50')
    expect(enforceReadRowLimit('SELECT * FROM orders /* keep */', 'sqlite', 50))
      .toBe('SELECT * FROM orders LIMIT 50')
  })

  it('caps an existing top-level LIMIT but leaves smaller limits alone', () => {
    expect(enforceReadRowLimit('SELECT * FROM orders LIMIT 500', 'sqlite', 100))
      .toBe('SELECT * FROM orders LIMIT 100')
    expect(enforceReadRowLimit('SELECT * FROM orders LIMIT 5', 'sqlite', 100))
      .toBe('SELECT * FROM orders LIMIT 5')
    expect(enforceReadRowLimit('SELECT * FROM orders LIMIT 20, 500', 'mysql', 100))
      .toBe('SELECT * FROM orders LIMIT 20, 100')
  })

  it('does not add LIMIT to SHOW/DESCRIBE or write statements', () => {
    expect(enforceReadRowLimit('SHOW TABLES;', 'mysql', 10)).toBe('SHOW TABLES;')
    expect(enforceReadRowLimit('DELETE FROM orders;', 'sqlite', 10)).toBe('DELETE FROM orders;')
  })

  it('wraps Oracle read queries with ROWNUM instead of LIMIT', () => {
    expect(enforceReadRowLimit('SELECT * FROM orders ORDER BY id;', 'oracle', 10))
      .toBe('SELECT * FROM (SELECT * FROM orders ORDER BY id) dsh_limit WHERE ROWNUM <= 10;')
  })

  it('uses LIMIT for ClickHouse and Doris', () => {
    expect(enforceReadRowLimit('SELECT * FROM events', 'clickhouse', 20)).toBe('SELECT * FROM events LIMIT 20')
    expect(enforceReadRowLimit('SELECT * FROM events LIMIT 50', 'doris', 20)).toBe('SELECT * FROM events LIMIT 20')
  })

  it('adds or tightens SQL Server TOP without ever emitting LIMIT', () => {
    expect(enforceReadRowLimit('SELECT * FROM orders', 'sqlserver', 25)).toBe('SELECT TOP (25) * FROM orders')
    expect(enforceReadRowLimit('SELECT DISTINCT customer_id FROM orders;', 'sqlserver', 10))
      .toBe('SELECT DISTINCT TOP (10) customer_id FROM orders;')
    expect(enforceReadRowLimit('WITH x AS (SELECT * FROM orders) SELECT * FROM x', 'sqlserver', 5))
      .toBe('WITH x AS (SELECT * FROM orders) SELECT TOP (5) * FROM x')
    expect(enforceReadRowLimit('SELECT TOP (3) * FROM orders', 'sqlserver', 10))
      .toBe('SELECT TOP (3) * FROM orders')
    expect(enforceReadRowLimit('SELECT TOP 300 * FROM orders', 'sqlserver', 10))
      .toBe('SELECT TOP (10) * FROM orders')
  })

  it('tightens SQL Server FETCH and fails closed for unsafe compound shapes', () => {
    expect(enforceReadRowLimit(
      'SELECT * FROM orders ORDER BY id OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY;',
      'sqlserver',
      10,
    )).toBe('SELECT * FROM orders ORDER BY id OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY;')
    expect(enforceReadRowLimit(
      'SELECT * FROM orders ORDER BY id OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY',
      'sqlserver',
      10,
    )).toContain('FETCH NEXT 5 ROWS ONLY')
    expect(() => enforceReadRowLimit('SELECT 1 UNION SELECT 2', 'sqlserver', 10)).toThrow(/compound query/)
    expect(() => enforceReadRowLimit('SELECT TOP 10 PERCENT * FROM orders', 'sqlserver', 5)).toThrow(/PERCENT/)
  })

  it('removes only terminal English and localized SQL Server row-count footers', () => {
    expect(stripSqlServerRowCountFooter('value\n(2 rows affected)\n')).toBe('value')
    expect(stripSqlServerRowCountFooter('value\n(2 行受影响)\n')).toBe('value')
    expect(stripSqlServerRowCountFooter('(2 rows affected)\nvalue\n')).toBe('(2 rows affected)\nvalue')
  })
})
