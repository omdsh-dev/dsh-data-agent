/**
 * Dialect-aware technical metadata adapters. Every statement is package-owned,
 * read-only, bounded by the shared connection runner, and returns normalized
 * observations rather than CLI text.
 */
import type { DataAgentConnections, DatabaseConnection, DatabaseType } from './connections.ts';
import type { CatalogObservation, CatalogRelation, CatalogScope } from './catalog-types.ts';
export interface CatalogAdapterOptions {
    maxTextChars: number;
    schemaConcurrency: number;
    assetConcurrency: number;
}
export interface CatalogAdapterContext {
    connections: DataAgentConnections;
    connection: DatabaseConnection;
    sessionId: string;
    sourceId: string;
    runId: string;
    scope: CatalogScope;
    signal: AbortSignal;
    options: CatalogAdapterOptions;
    onProgress?(kind: 'schema' | 'relation' | 'field'): void;
}
export interface CatalogAdapterResult {
    observations: CatalogObservation[];
    relations: CatalogRelation[];
    coverageComplete: boolean;
    unavailableScopes: string[];
}
export interface CatalogAdapter {
    readonly type: DatabaseType;
    readonly capabilities: Readonly<Record<string, 'supported' | 'unsupported' | 'unavailable'>>;
    scan(context: CatalogAdapterContext): Promise<CatalogAdapterResult>;
}
interface RawMetadataRow {
    rowKind: 'relation' | 'column' | 'primary_key' | 'foreign_key' | 'index';
    schema: string;
    relation: string;
    relationType: string;
    relationComment: string;
    column: string;
    dataType: string;
    nullable: string;
    columnComment: string;
    ordinal: string;
}
/** Registry contains an explicit adapter entry for every supported dialect. */
export declare function createCatalogAdapterRegistry(): Readonly<Record<DatabaseType, CatalogAdapter>>;
/** Pure SQL constructor used by fixture tests; values are SQL literals, never identifiers. */
export declare function buildCatalogMetadataSql(type: Exclude<DatabaseType, 'hive' | 'impala'>, database: string, schema: string, table?: string): string;
export declare function parseCatalogMetadataRows(type: DatabaseType, stdout: string): RawMetadataRow[];
export {};
