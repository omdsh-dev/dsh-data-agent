/**
 * Browser-safe database type descriptors shared by every DSH surface.
 * Keep this module dependency-free: server-only client/process details belong
 * in the database adapters, not in Web or persistence bundles.
 */

export const DATABASE_TYPES = [
  'mysql',
  'postgres',
  'sqlite',
  'oracle',
  'hive',
  'impala',
  'clickhouse',
  'doris',
  'sqlserver',
] as const

export type DatabaseType = typeof DATABASE_TYPES[number]

export interface DatabaseTypeDescriptor {
  type: DatabaseType
  label: string
  localeKey: `type.${DatabaseType}`
  defaultPort: number
  defaultUser: string
  fileBased: boolean
  /** HTTPS port used when ClickHouse secure transport is selected. */
  securePort?: number
}

export const DATABASE_TYPE_DESCRIPTORS: Readonly<Record<DatabaseType, DatabaseTypeDescriptor>> = {
  mysql: { type: 'mysql', label: 'MySQL', localeKey: 'type.mysql', defaultPort: 3306, defaultUser: 'root', fileBased: false },
  postgres: { type: 'postgres', label: 'PostgreSQL', localeKey: 'type.postgres', defaultPort: 5432, defaultUser: 'postgres', fileBased: false },
  sqlite: { type: 'sqlite', label: 'SQLite', localeKey: 'type.sqlite', defaultPort: 0, defaultUser: '', fileBased: true },
  oracle: { type: 'oracle', label: 'Oracle', localeKey: 'type.oracle', defaultPort: 1521, defaultUser: '', fileBased: false },
  hive: { type: 'hive', label: 'Hive', localeKey: 'type.hive', defaultPort: 10000, defaultUser: '', fileBased: false },
  impala: { type: 'impala', label: 'Impala', localeKey: 'type.impala', defaultPort: 21050, defaultUser: '', fileBased: false },
  clickhouse: {
    type: 'clickhouse',
    label: 'ClickHouse',
    localeKey: 'type.clickhouse',
    defaultPort: 8123,
    securePort: 8443,
    defaultUser: 'default',
    fileBased: false,
  },
  doris: { type: 'doris', label: 'Apache Doris', localeKey: 'type.doris', defaultPort: 9030, defaultUser: 'root', fileBased: false },
  sqlserver: { type: 'sqlserver', label: 'SQL Server', localeKey: 'type.sqlserver', defaultPort: 1433, defaultUser: 'sa', fileBased: false },
}

export function isDatabaseType(value: unknown): value is DatabaseType {
  return typeof value === 'string' && (DATABASE_TYPES as readonly string[]).includes(value)
}

export function databaseTypeDescriptor(type: DatabaseType): DatabaseTypeDescriptor {
  return DATABASE_TYPE_DESCRIPTORS[type]
}

export function defaultDatabasePort(type: DatabaseType, secure = false): number {
  const descriptor = DATABASE_TYPE_DESCRIPTORS[type]
  return secure && descriptor.securePort !== undefined ? descriptor.securePort : descriptor.defaultPort
}

export function defaultDatabaseUser(type: DatabaseType): string {
  return DATABASE_TYPE_DESCRIPTORS[type].defaultUser
}

export function databaseTypeLabel(type: DatabaseType): string {
  return DATABASE_TYPE_DESCRIPTORS[type].label
}
