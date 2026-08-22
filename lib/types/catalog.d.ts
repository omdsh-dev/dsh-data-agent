/** Shared Catalog service: scan lifecycle, version projections, search, and review. */
import { type DataAgentConnections } from './connections.ts';
import { type CatalogAssetDetail, type CatalogDiffPage, type CatalogRun, type CatalogSearchPage, type CatalogSearchRequest, type CatalogSemanticRevision, type CatalogSource, type CatalogStatusSummary, type MetricDefinition, type SemanticDefinition, type StartCatalogScanInput } from './catalog-types.ts';
import type { CatalogMeaningGenerator } from './catalog-ai.ts';
import type { CatalogAdapter } from './catalog-adapters.ts';
import type { CatalogPersistence } from './catalog-storage.ts';
export interface CatalogServiceOptions {
    maxAssetsPerRun: number;
    maxTextChars: number;
    pageSize: number;
    maxPageSize: number;
    schemaConcurrency: number;
    assetConcurrency: number;
    now?: () => Date;
    randomId?: () => string;
    adapters?: Readonly<Record<string, CatalogAdapter>>;
    meaningGenerator?: CatalogMeaningGenerator;
    logger?: {
        warn(message: string, ...args: unknown[]): void;
    };
}
export type { CatalogStatusSummary, StartCatalogScanInput } from './catalog-types.ts';
/** Read-only face injected into model tools and all surface adapters. */
export interface DataAgentCatalog {
    listSources(): CatalogSource[];
    listRuns(sourceId: string, limit?: number): CatalogRun[];
    resolveSource(sessionId: string, requestedSourceId?: string): Promise<CatalogSource>;
    status(sourceId: string): CatalogStatusSummary | undefined;
    search(request: CatalogSearchRequest): Promise<CatalogSearchPage>;
    getAsset(sourceId: string, assetId: string, cursor?: string, pageSize?: number): CatalogAssetDetail;
    getSemantic(sourceId: string, semanticId: string, version?: number): CatalogSemanticRevision;
    getMetric(sourceId: string, metricId: string, version?: number): CatalogSemanticRevision & {
        definition: MetricDefinition;
    };
    diff(sourceId: string, fromRunId?: string, toRunId?: string, cursor?: string, pageSize?: number): CatalogDiffPage;
}
/** Mutation face used only by the dsh-tui `/catalog` command and Web routes. */
export interface DataAgentCatalogScanner {
    start(input: StartCatalogScanInput): Promise<CatalogRun>;
    cancel(sourceId: string, runId?: string): Promise<CatalogRun>;
    interruptActiveRuns(): Promise<void>;
}
/** Human review face; never injected into the model-tool plugin. */
export interface DataAgentCatalogReview {
    saveCandidate(sourceId: string, definition: SemanticDefinition, semanticId?: string, expectedVersion?: number): Promise<CatalogSemanticRevision>;
    verify(sourceId: string, semanticId: string, expectedVersion: number, definition: SemanticDefinition): Promise<CatalogSemanticRevision>;
    retire(sourceId: string, semanticId: string, expectedVersion: number, revisionNote: string): Promise<CatalogSemanticRevision>;
    dismissMeaning(sourceId: string, semanticId: string, expectedVersion: number): Promise<CatalogSemanticRevision>;
}
export interface CatalogServiceBundle {
    read: DataAgentCatalog;
    scanner: DataAgentCatalogScanner;
    review: DataAgentCatalogReview;
}
export declare class CatalogVersionConflictError extends Error {
    readonly current: CatalogSemanticRevision;
    constructor(current: CatalogSemanticRevision);
}
export declare function createCatalogService(connections: DataAgentConnections, persistence: CatalogPersistence, options: CatalogServiceOptions): Promise<CatalogServiceBundle>;
