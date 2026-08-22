/** Durable versioned Catalog storage-domain and persistence adapter. */
import { type Domain } from '@deepseek-ai/dsh-storage-domain';
import { type CatalogAssetHead, type CatalogAssetRevision, type CatalogIndexRecord, type CatalogIndexState, type CatalogObservation, type CatalogRelation, type CatalogRun, type CatalogSemanticEntry, type CatalogSemanticRevision, type CatalogSource } from './catalog-types.ts';
export declare const CATALOG_STORAGE_DOMAIN = "data_agent_catalog";
export declare const CATALOG_STORAGE_VERSION = 1;
/** Strict schemas reject secret-shaped or raw-result fields at the durable boundary. */
export declare const catalogStorageSpec: {
    name: string;
    version: number;
    tables: {
        sources: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            id: string;
            profileId: string;
            type: "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "clickhouse" | "doris" | "sqlserver";
            name: string;
            database: string;
            credentialConfigured: boolean;
            createdAt: string;
            updatedAt: string;
            host?: string | undefined;
            lastFullScanAt?: string | undefined;
            lastPartialScanAt?: string | undefined;
        }>;
        scan_runs: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            id: string;
            sourceId: string;
            sessionId: string;
            scope: {
                kind: "source";
            } | {
                kind: "schema";
                schema: string;
            } | {
                kind: "table";
                schema: string;
                table: string;
            };
            status: "queued" | "running" | "applying" | "succeeded" | "failed" | "cancelled" | "interrupted";
            coverageComplete: boolean;
            progress: {
                schemas: number;
                relations: number;
                fields: number;
                assets: number;
            };
            createdAt: string;
            startedAt?: string | undefined;
            completedAt?: string | undefined;
            error?: string | undefined;
            enrichment?: {
                status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "partial";
                provider: string;
                model: string;
                tablesTotal: number;
                tablesCompleted: number;
                tablesFailed: number;
                candidatesGenerated: number;
                reasoningEffort?: string | undefined;
                startedAt?: string | undefined;
                completedAt?: string | undefined;
                error?: string | undefined;
            } | undefined;
        }>;
        observations: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            runId: string;
            sourceId: string;
            assetId: string;
            status: "observed" | "missing" | "unavailable";
            fingerprint: string;
            observedAt: string;
            payload: {
                identity: {
                    sourceId: string;
                    database: string;
                    schema: string;
                    kind: "table" | "schema" | "view" | "column" | "primary_key" | "foreign_key" | "index";
                    name: string;
                    relation?: string | undefined;
                };
                name: string;
                path: string;
                provenance: {
                    source: "database";
                    dialect: "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "clickhouse" | "doris" | "sqlserver";
                    runId: string;
                };
                parentId?: string | undefined;
                objectType?: "table" | "view" | undefined;
                dataType?: string | undefined;
                nullable?: boolean | undefined;
                ordinal?: number | undefined;
                comment?: string | undefined;
                referencedAssetIds?: string[] | undefined;
                attributes?: Record<string, string | number | boolean | null> | undefined;
                capabilities?: Record<string, "unavailable" | "supported" | "unsupported"> | undefined;
                truncatedFields?: string[] | undefined;
            };
        }>;
        asset_revisions: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            id: string;
            assetId: string;
            sourceId: string;
            runId: string;
            revision: number;
            status: "observed" | "missing" | "unavailable";
            fingerprint: string;
            observedAt: string;
            changeSummary: string[];
            payload: {
                identity: {
                    sourceId: string;
                    database: string;
                    schema: string;
                    kind: "table" | "schema" | "view" | "column" | "primary_key" | "foreign_key" | "index";
                    name: string;
                    relation?: string | undefined;
                };
                name: string;
                path: string;
                provenance: {
                    source: "database";
                    dialect: "mysql" | "postgres" | "sqlite" | "oracle" | "hive" | "impala" | "clickhouse" | "doris" | "sqlserver";
                    runId: string;
                };
                parentId?: string | undefined;
                objectType?: "table" | "view" | undefined;
                dataType?: string | undefined;
                nullable?: boolean | undefined;
                ordinal?: number | undefined;
                comment?: string | undefined;
                referencedAssetIds?: string[] | undefined;
                attributes?: Record<string, string | number | boolean | null> | undefined;
                capabilities?: Record<string, "unavailable" | "supported" | "unsupported"> | undefined;
                truncatedFields?: string[] | undefined;
            };
            previousRevisionId?: string | undefined;
        }>;
        asset_heads: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            assetId: string;
            sourceId: string;
            revisionIds: string[];
            firstSeenAt: string;
            lastSeenAt: string;
        }>;
        relations: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            id: string;
            sourceId: string;
            runId: string;
            kind: "primary_key" | "foreign_key" | "index" | "parent";
            fromAssetId: string;
            columnAssetIds: string[];
            observedAt: string;
            toAssetId?: string | undefined;
            name?: string | undefined;
            referencedColumnAssetIds?: string[] | undefined;
        }>;
        semantic_entries: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            id: string;
            sourceId: string;
            kind: "metric" | "meaning" | "term";
            currentVersion: number;
            createdAt: string;
            updatedAt: string;
        }>;
        semantic_revisions: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            id: string;
            semanticId: string;
            sourceId: string;
            version: number;
            createdAt: string;
            definition: {
                name: string;
                aliases: string[];
                description: string;
                sourceAssetIds: string[];
                status: "inferred" | "verified" | "needs_review" | "retired";
                kind: "term";
                owner?: string | undefined;
                validFrom?: string | undefined;
                validTo?: string | undefined;
                revisionNote?: string | undefined;
                verifiedAt?: string | undefined;
                needsReviewReason?: string | undefined;
                triggerRunId?: string | undefined;
            } | {
                formula: string;
                grain: string;
                filters: string[];
                exclusions: string[];
                name: string;
                aliases: string[];
                description: string;
                sourceAssetIds: string[];
                status: "inferred" | "verified" | "needs_review" | "retired";
                kind: "metric";
                timeFieldAssetId?: string | undefined;
                owner?: string | undefined;
                validFrom?: string | undefined;
                validTo?: string | undefined;
                revisionNote?: string | undefined;
                verifiedAt?: string | undefined;
                needsReviewReason?: string | undefined;
                triggerRunId?: string | undefined;
            } | {
                targetAssetId: string;
                targetKind: "table" | "view" | "column";
                generatedBy: {
                    kind: "ai";
                    provider: string;
                    model: string;
                    runId: string;
                };
                name: string;
                aliases: string[];
                description: string;
                sourceAssetIds: string[];
                status: "inferred" | "verified" | "needs_review" | "retired";
                kind: "meaning";
                owner?: string | undefined;
                validFrom?: string | undefined;
                validTo?: string | undefined;
                revisionNote?: string | undefined;
                verifiedAt?: string | undefined;
                needsReviewReason?: string | undefined;
                triggerRunId?: string | undefined;
            };
        }>;
        search_index: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, CatalogIndexRecord>;
        index_state: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, CatalogIndexState>;
    };
};
export type CatalogStorageDomain = Domain<typeof catalogStorageSpec>;
export interface CatalogPersistence {
    getSource(id: string): CatalogSource | undefined;
    listSources(): CatalogSource[];
    putSource(source: CatalogSource): Promise<void>;
    getRun(id: string): CatalogRun | undefined;
    listRuns(sourceId?: string): CatalogRun[];
    putRun(run: CatalogRun): Promise<void>;
    putObservation(observation: CatalogObservation): Promise<void>;
    listObservations(runId: string): CatalogObservation[];
    deleteObservations(runId: string): Promise<void>;
    getAssetHead(assetId: string): CatalogAssetHead | undefined;
    listAssetHeads(sourceId?: string): CatalogAssetHead[];
    putAssetHead(head: CatalogAssetHead): Promise<void>;
    getAssetRevision(id: string): CatalogAssetRevision | undefined;
    listAssetRevisions(assetId?: string): CatalogAssetRevision[];
    putAssetRevision(revision: CatalogAssetRevision): Promise<void>;
    listRelations(sourceId?: string): CatalogRelation[];
    putRelation(relation: CatalogRelation): Promise<void>;
    getSemanticEntry(id: string): CatalogSemanticEntry | undefined;
    listSemanticEntries(sourceId?: string): CatalogSemanticEntry[];
    putSemanticEntry(entry: CatalogSemanticEntry): Promise<void>;
    getSemanticRevision(id: string): CatalogSemanticRevision | undefined;
    listSemanticRevisions(semanticId?: string): CatalogSemanticRevision[];
    putSemanticRevision(revision: CatalogSemanticRevision): Promise<void>;
    listIndex(sourceId?: string): CatalogIndexRecord[];
    putIndex(record: CatalogIndexRecord): Promise<void>;
    clearIndex(sourceId?: string): Promise<void>;
    getIndexState(): CatalogIndexState | undefined;
    putIndexState(state: CatalogIndexState): Promise<void>;
}
export declare function createDomainCatalogPersistence(domain: CatalogStorageDomain): CatalogPersistence;
/** In-memory adapter used when Catalog persistence is explicitly disabled and by focused tests. */
export declare function createMemoryCatalogPersistence(): CatalogPersistence;
