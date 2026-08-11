import { describe, expect, it } from 'vitest'
import {
  buildClientTemplate,
  buildIntrospectTemplate,
  parseTableListing,
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
    expect(tableListingSql('mysql')).toBe('SHOW TABLES;')
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
