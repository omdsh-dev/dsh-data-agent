/**
 * Browser-safe database type descriptors shared by every DSH surface.
 * Keep this module dependency-free: server-only client/process details belong
 * in the database adapters, not in Web or persistence bundles.
 */
export declare const DATABASE_TYPES: readonly ["mysql", "postgres", "sqlite", "oracle", "hive", "impala", "clickhouse", "doris", "sqlserver"];
export type DatabaseType = typeof DATABASE_TYPES[number];
export interface DatabaseTypeDescriptor {
    type: DatabaseType;
    label: string;
    localeKey: `type.${DatabaseType}`;
    defaultPort: number;
    defaultUser: string;
    fileBased: boolean;
    /** HTTPS port used when ClickHouse secure transport is selected. */
    securePort?: number;
}
export declare const DATABASE_TYPE_DESCRIPTORS: Readonly<Record<DatabaseType, DatabaseTypeDescriptor>>;
export declare function isDatabaseType(value: unknown): value is DatabaseType;
export declare function databaseTypeDescriptor(type: DatabaseType): DatabaseTypeDescriptor;
export declare function defaultDatabasePort(type: DatabaseType, secure?: boolean): number;
export declare function defaultDatabaseUser(type: DatabaseType): string;
export declare function databaseTypeLabel(type: DatabaseType): string;
