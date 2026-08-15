import { describe, expect, it } from 'vitest'
import {
  buildClientTemplate,
  buildIntrospectTemplate,
  classifyStatement,
  metadataQuery,
  parseColumns,
  parseListing,
  parseTableListing,
  sanitizeIdentifier,
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

describe('buildClientTemplate', () => {
  it('builds the mysql argv with connection flags and the password only in env', () => {
    const template = buildClientTemplate('mysql', mysqlConnection)
    expect(template.command).toBe('mysql')
    expect(template.args).toEqual([
      '--batch', '--raw',
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
    expect(template.args).toEqual(['--batch', '--raw', '-h', '127.0.0.1', '-P', '3306', '-u', 'root', '-D', 'd'])
  })

  it('honors deployment overrides for command and extra args', () => {
    const template = buildClientTemplate('mysql', mysqlConnection, {
      command: '/usr/local/bin/mysql-client',
      args: ['--protocol=tcp'],
    })
    expect(template.command).toBe('/usr/local/bin/mysql-client')
    expect(template.args[0]).toBe('--protocol=tcp')
  })

  it('never puts SQL into argv (the runner owns stdin)', () => {
    const template = buildClientTemplate('mysql', mysqlConnection)
    expect(template.args.join(' ')).not.toMatch(/SELECT|SHOW|DROP|DELETE/i)
  })
})

describe('buildIntrospectTemplate', () => {
  it('uses machine-readable flags for each type', () => {
    expect(buildIntrospectTemplate('mysql', mysqlConnection).args).toEqual([
      '--batch', '--raw', '-h', 'db.internal', '-P', '3307', '-u', 'app', '-D', 'orders',
    ])
    expect(buildIntrospectTemplate('postgres', postgresConnection).args).toEqual([
      '-t', '-A', '-h', 'pg.internal', '-p', '5433', '-U', 'owner', '-d', 'analytics',
    ])
    expect(buildIntrospectTemplate('sqlite', sqliteConnection).args).toEqual([
      '-noheader', '-list', '/tmp/orders.db',
    ])
    // Credentials still travel in env only.
    expect(buildIntrospectTemplate('mysql', mysqlConnection).env).toEqual({ MYSQL_PWD: 'hunter2' })
  })
})

describe('tableListingSql', () => {
  it('produces a listing statement per type', () => {
    expect(tableListingSql('mysql', mysqlConnection)).toBe('SHOW TABLES FROM `orders`;')
    expect(tableListingSql('postgres')).toContain('pg_tables')
    expect(tableListingSql('sqlite')).toContain('sqlite_master')
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
  })

  it('builds the tables query per type with the schema identifier', () => {
    expect(metadataQuery('tables', 'mysql', 'orders')).toBe('SHOW TABLES FROM `orders`;')
    expect(metadataQuery('tables', 'postgres', 'public')).toContain("schemaname='public'")
    expect(metadataQuery('tables', 'sqlite')).toContain('sqlite_master')
    expect(metadataQuery('tables', 'oracle', 'SCOTT')).toContain("owner='SCOTT'")
    expect(metadataQuery('tables', 'hive', 'default')).toBe('SHOW TABLES IN `default`;')
  })

  it('builds the describe query per type', () => {
    expect(metadataQuery('describe', 'mysql', 'orders', 'line_items')).toBe('DESCRIBE `orders`.`line_items`;')
    expect(metadataQuery('describe', 'postgres', 'public', 'orders')).toContain("table_schema='public'")
    expect(metadataQuery('describe', 'sqlite', undefined, 'orders')).toBe('PRAGMA table_info("orders");')
    expect(metadataQuery('describe', 'oracle', 'SCOTT', 'EMP')).toContain("owner='SCOTT' AND table_name='EMP'")
    expect(metadataQuery('describe', 'impala', 'analytics', 'orders')).toBe('DESCRIBE `analytics`.`orders`;')
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

  it('treats PRAGMA as read only for sqlite', () => {
    expect(classifyStatement('PRAGMA table_info("orders")', 'sqlite')).toBe('read')
    expect(classifyStatement('PRAGMA user_version', 'mysql')).toBe('write')
  })

  it('returns write for empty or token-less input', () => {
    expect(classifyStatement('', 'mysql')).toBe('write')
    expect(classifyStatement('   ', 'postgres')).toBe('write')
    expect(classifyStatement('-- only a comment', 'mysql')).toBe('write')
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

  it('allows $ and _ but rejects injection-shaped characters', () => {
    expect(sanitizeIdentifier('postgres', 'a$b_c')).toBe('"a$b_c"')
    for (const bad of ['a#b', 'a--b', 'a;b', "a'b", 'a`b', 'a"b', 'a.b', 'a-b', '']) {
      expect(() => sanitizeIdentifier('mysql', bad)).toThrow()
    }
  })
})

describe('buildClientTemplate — clickhouse/doris/sqlserver', () => {
  it('builds the clickhouse argv and keeps the password in CLICKHOUSE_PASSWORD', () => {
    const template = buildClientTemplate('clickhouse', {
      type: 'clickhouse', host: 'ch01', port: 9000, user: 'default',
      database: 'analytics', password: 's3cret',
    })
    expect(template.command).toBe('clickhouse-client')
    expect(template.args).toEqual([
      '--multiquery', '--format', 'TSV',
      '--host', 'ch01', '--port', '9000', '--user', 'default', '--database', 'analytics',
    ])
    expect(template.env).toEqual({ CLICKHOUSE_PASSWORD: 's3cret' })
    expect(JSON.stringify(template.args)).not.toContain('s3cret')
  })

  it('builds the doris template on the mysql client with port 9030', () => {
    const template = buildClientTemplate('doris', {
      type: 'doris', host: 'fe01', database: 'dwd', password: 'pw',
    })
    expect(template.command).toBe('mysql')
    expect(template.args).toEqual(['--batch', '--raw', '-h', 'fe01', '-P', '9030', '-u', 'root', '-D', 'dwd'])
    expect(template.env).toEqual({ MYSQL_PWD: 'pw' })
  })

  it('builds the sqlserver template with -S/-U/-d and SQLCMDPASSWORD env', () => {
    const template = buildClientTemplate('sqlserver', {
      type: 'sqlserver', host: 'db01', port: 1433, user: 'sa', database: 'sales', password: 'pw',
    })
    expect(template.command).toBe('sqlcmd')
    expect(template.args).toEqual(['-W', '-s', '|', '-h', '-1', '-C', '-S', 'db01,1433', '-U', 'sa', '-d', 'sales'])
    expect(template.env).toEqual({ SQLCMDPASSWORD: 'pw' })
    expect(JSON.stringify(template.args)).not.toContain('pw')
  })

  it('uses -E integrated auth for sqlserver without a user', () => {
    const template = buildClientTemplate('sqlserver', { type: 'sqlserver', database: 'sales' })
    expect(template.args).toEqual(['-W', '-s', '|', '-h', '-1', '-C', '-S', '127.0.0.1,1433', '-E', '-d', 'sales'])
    expect(template.env).toEqual({})
  })

  it('uses machine-readable introspect flags for the three new types', () => {
    expect(buildIntrospectTemplate('clickhouse', { type: 'clickhouse', database: 'a' }).args.slice(0, 3))
      .toEqual(['--multiquery', '--format', 'TSV'])
    expect(buildIntrospectTemplate('doris', { type: 'doris', database: 'a' }).args.slice(0, 2))
      .toEqual(['--batch', '--raw'])
    expect(buildIntrospectTemplate('sqlserver', { type: 'sqlserver', database: 'a' }).args.slice(0, 5))
      .toEqual(['-W', '-s', '|', '-h', '-1'])
  })
})

describe('tableListingSql / metadataQuery — clickhouse/doris/sqlserver', () => {
  it('builds the connectivity listing per type', () => {
    expect(tableListingSql('clickhouse', { type: 'clickhouse', database: 'analytics' })).toBe('SHOW TABLES;')
    expect(tableListingSql('doris', { type: 'doris', database: 'dwd' })).toBe('SHOW TABLES FROM `dwd`;')
    expect(tableListingSql('sqlserver', { type: 'sqlserver', database: 'sales' }))
      .toBe('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES ORDER BY 1;')
  })

  it('builds the schemas query per type', () => {
    expect(metadataQuery('schemas', 'clickhouse')).toBe('SHOW DATABASES;')
    expect(metadataQuery('schemas', 'doris')).toBe('SHOW DATABASES;')
    expect(metadataQuery('schemas', 'sqlserver')).toBe('SELECT name FROM sys.schemas ORDER BY 1;')
  })

  it('builds the tables query per type', () => {
    expect(metadataQuery('tables', 'clickhouse', 'analytics')).toBe('SHOW TABLES FROM `analytics`;')
    expect(metadataQuery('tables', 'doris', 'dwd')).toBe('SHOW TABLES FROM `dwd`;')
    expect(metadataQuery('tables', 'sqlserver', 'dbo'))
      .toBe("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='dbo' ORDER BY 1;")
  })

  it('builds the describe query per type', () => {
    expect(metadataQuery('describe', 'clickhouse', 'analytics', 'orders'))
      .toBe('DESCRIBE TABLE `analytics`.`orders`;')
    expect(metadataQuery('describe', 'doris', 'dwd', 'orders')).toBe('DESCRIBE `dwd`.`orders`;')
    expect(metadataQuery('describe', 'sqlserver', 'dbo', 'orders'))
      .toContain("TABLE_SCHEMA='dbo' AND TABLE_NAME='orders'")
  })
})

describe('parseColumns / parseListing — clickhouse/doris/sqlserver', () => {
  it('parses clickhouse TSV describe output without nullability', () => {
    const out = 'id\tUInt64\t\nname\tString\t\n'
    expect(parseColumns('clickhouse', out)).toEqual([
      { name: 'id', type: 'UInt64' },
      { name: 'name', type: 'String' },
    ])
  })

  it('parses doris describe output skipping the header like mysql', () => {
    const out = 'Field\tType\tNull\tKey\nid\tint\tNO\tPRI\n'
    expect(parseColumns('doris', out)).toEqual([{ name: 'id', type: 'int', nullable: false }])
  })

  it('parses sqlserver pipe-separated columns with YES/NO nullability', () => {
    const out = 'id|int|NO\nname|nvarchar|YES\n'
    expect(parseColumns('sqlserver', out)).toEqual([
      { name: 'id', type: 'int', nullable: false },
      { name: 'name', type: 'nvarchar', nullable: true },
    ])
  })

  it('parses clickhouse/doris/sqlserver listings without surprises', () => {
    expect(parseListing('clickhouse', 'orders\nusers\n')).toEqual(['orders', 'users'])
    expect(parseListing('doris', 'Tables_in_dwd\norders\nusers\n')).toEqual(['orders', 'users'])
    expect(parseListing('sqlserver', 'orders\nusers\n')).toEqual(['orders', 'users'])
  })
})

describe('sanitizeIdentifier — new types', () => {
  it('wraps clickhouse and doris identifiers in backticks', () => {
    expect(sanitizeIdentifier('clickhouse', 'orders')).toBe('`orders`')
    expect(sanitizeIdentifier('doris', 'dwd')).toBe('`dwd`')
  })

  it('wraps sqlserver identifiers in brackets', () => {
    expect(sanitizeIdentifier('sqlserver', 'OrderDetails')).toBe('[OrderDetails]')
  })
})
