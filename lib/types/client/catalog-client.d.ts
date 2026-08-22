/** Browser-only Catalog route client and wire contracts. */
import type { CatalogAssetDetail, CatalogDiffPage, CatalogRun, CatalogScope, CatalogSearchItem, CatalogSearchPage, CatalogSemanticRevision, CatalogSource, SemanticDefinition } from '../catalog-types.ts';
export interface CatalogStatusWire {
    source: CatalogSource;
    activeRun?: CatalogRun;
    latestRun?: CatalogRun;
    latestSuccessfulRun?: CatalogRun;
    counts: {
        assets: number;
        fields: number;
        needsReview: number;
    };
}
export type { CatalogAssetDetail, CatalogDiffPage, CatalogRun, CatalogScope, CatalogSearchItem, CatalogSearchPage, CatalogSemanticRevision, CatalogSource, SemanticDefinition, };
export declare function listCatalogSources(signal?: AbortSignal): Promise<CatalogSource[]>;
export declare function getCatalogStatus(sourceId: string, signal?: AbortSignal): Promise<CatalogStatusWire | null>;
export declare function listCatalogRuns(sourceId: string, signal?: AbortSignal): Promise<CatalogRun[]>;
export declare function searchCatalog(input: {
    sourceId: string;
    query: string;
    schema?: string;
    assetKinds?: string[];
    semanticKinds?: string[];
    assetStatuses?: string[];
    semanticStatuses?: string[];
    includeInferred?: boolean;
    cursor?: string;
    pageSize?: number;
}, signal?: AbortSignal): Promise<CatalogSearchPage>;
export declare function getCatalogAsset(sourceId: string, assetId: string, cursor?: string, signal?: AbortSignal): Promise<CatalogAssetDetail>;
export declare function getCatalogSemantic(sourceId: string, semanticId: string, version?: number, signal?: AbortSignal): Promise<CatalogSemanticRevision>;
export declare function startCatalogScan(sessionId: string, scope: CatalogScope): Promise<CatalogRun>;
export declare function cancelCatalogScan(sourceId: string, runId?: string): Promise<CatalogRun>;
export declare function getCatalogDiff(sourceId: string, from?: string, to?: string, cursor?: string): Promise<CatalogDiffPage>;
export declare function saveCatalogCandidate(input: {
    sourceId: string;
    semanticId?: string;
    expectedVersion?: number;
    definition: SemanticDefinition;
}): Promise<CatalogSemanticRevision>;
export declare function verifyCatalogSemantic(input: {
    sourceId: string;
    semanticId: string;
    expectedVersion: number;
    definition: SemanticDefinition;
}): Promise<CatalogSemanticRevision>;
export declare function retireCatalogSemantic(input: {
    sourceId: string;
    semanticId: string;
    expectedVersion: number;
    revisionNote: string;
}): Promise<CatalogSemanticRevision>;
export declare function dismissCatalogMeaning(input: {
    sourceId: string;
    semanticId: string;
    expectedVersion: number;
}): Promise<CatalogSemanticRevision>;
