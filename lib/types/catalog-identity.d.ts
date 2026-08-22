/** Deterministic identity, normalization, and fingerprint helpers. */
import type { DatabaseType } from './database-types.ts';
import type { CatalogIdentity, CatalogTechnicalPayload } from './catalog-types.ts';
/** Strip unsafe controls, normalize Unicode, and enforce one explicit bound. */
export declare function normalizeCatalogText(value: string, maxChars: number): {
    value: string;
    truncated: boolean;
};
/** Normalize an observed identifier according to the dialect's identity rules. */
export declare function normalizeCatalogIdentifier(type: DatabaseType, value: string): string;
/** v1 source identity is deliberately the stable connection profile id. */
export declare function catalogSourceId(profileId: string): string;
/** Build canonical structured identity without parsing display paths. */
export declare function canonicalCatalogIdentity(type: DatabaseType, identity: CatalogIdentity): CatalogIdentity;
/** Stable opaque asset id derived only from structured identity components. */
export declare function catalogAssetId(type: DatabaseType, identity: CatalogIdentity): string;
export declare function catalogSemanticId(sourceId: string, kind: 'term' | 'metric', name: string): string;
/** Technical fingerprint excludes run-specific provenance and display-only truncation facts. */
export declare function catalogTechnicalFingerprint(payload: CatalogTechnicalPayload, status?: string): string;
/** Deterministic JSON encoding for hashes and cursor order keys. */
export declare function stableJson(value: unknown): string;
export declare function catalogRevisionId(assetId: string, revision: number): string;
export declare function catalogSemanticRevisionId(semanticId: string, version: number): string;
