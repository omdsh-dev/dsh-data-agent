/**
 * Surface-neutral Catalog contracts. This module contains no Node or browser
 * runtime dependencies beyond Zod and can therefore be imported type-only by
 * the Web bundle.
 * @module @yejiming/dsh-data-agent/catalog-types
 */
import { z } from 'zod';
export declare const catalogDateTimeSchema: z.ZodISODateTime;
export declare const CATALOG_RUN_STATUSES: readonly ["queued", "running", "applying", "succeeded", "failed", "cancelled", "interrupted"];
export declare const catalogRunStatusSchema: z.ZodEnum<{
    running: "running";
    interrupted: "interrupted";
    queued: "queued";
    applying: "applying";
    succeeded: "succeeded";
    failed: "failed";
    cancelled: "cancelled";
}>;
export type CatalogRunStatus = z.infer<typeof catalogRunStatusSchema>;
export declare const CATALOG_ASSET_STATUSES: readonly ["observed", "missing", "unavailable"];
export declare const catalogAssetStatusSchema: z.ZodEnum<{
    observed: "observed";
    missing: "missing";
    unavailable: "unavailable";
}>;
export type CatalogAssetStatus = z.infer<typeof catalogAssetStatusSchema>;
export declare const CATALOG_ASSET_KINDS: readonly ["schema", "table", "view", "column", "primary_key", "foreign_key", "index"];
export declare const catalogAssetKindSchema: z.ZodEnum<{
    table: "table";
    view: "view";
    schema: "schema";
    column: "column";
    primary_key: "primary_key";
    foreign_key: "foreign_key";
    index: "index";
}>;
export type CatalogAssetKind = z.infer<typeof catalogAssetKindSchema>;
export declare const CATALOG_ENRICHMENT_STATUSES: readonly ["queued", "running", "succeeded", "partial", "failed", "cancelled"];
export declare const catalogEnrichmentStatusSchema: z.ZodEnum<{
    running: "running";
    queued: "queued";
    succeeded: "succeeded";
    failed: "failed";
    cancelled: "cancelled";
    partial: "partial";
}>;
export type CatalogEnrichmentStatus = z.infer<typeof catalogEnrichmentStatusSchema>;
export declare const CATALOG_SEMANTIC_KINDS: readonly ["meaning", "term", "metric"];
export declare const catalogSemanticKindSchema: z.ZodEnum<{
    term: "term";
    metric: "metric";
    meaning: "meaning";
}>;
export type CatalogSemanticKind = z.infer<typeof catalogSemanticKindSchema>;
export declare const CATALOG_SEMANTIC_STATUSES: readonly ["inferred", "verified", "needs_review", "retired"];
export declare const catalogSemanticStatusSchema: z.ZodEnum<{
    inferred: "inferred";
    verified: "verified";
    needs_review: "needs_review";
    retired: "retired";
}>;
export type CatalogSemanticStatus = z.infer<typeof catalogSemanticStatusSchema>;
export declare const CATALOG_DIFF_KINDS: readonly ["added", "changed", "missing", "restored", "unavailable"];
export declare const catalogDiffKindSchema: z.ZodEnum<{
    missing: "missing";
    unavailable: "unavailable";
    added: "added";
    changed: "changed";
    restored: "restored";
}>;
export type CatalogDiffKind = z.infer<typeof catalogDiffKindSchema>;
export declare const catalogScopeSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"source">;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"schema">;
    schema: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"table">;
    schema: z.ZodString;
    table: z.ZodString;
}, z.core.$strict>], "kind">;
export type CatalogScope = z.infer<typeof catalogScopeSchema>;
export declare const catalogSourceSchema: z.ZodObject<{
    id: z.ZodString;
    profileId: z.ZodString;
    type: z.ZodEnum<{
        mysql: "mysql";
        postgres: "postgres";
        sqlite: "sqlite";
        oracle: "oracle";
        hive: "hive";
        impala: "impala";
        clickhouse: "clickhouse";
        doris: "doris";
        sqlserver: "sqlserver";
    }>;
    name: z.ZodString;
    host: z.ZodOptional<z.ZodString>;
    database: z.ZodString;
    credentialConfigured: z.ZodBoolean;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
    lastFullScanAt: z.ZodOptional<z.ZodISODateTime>;
    lastPartialScanAt: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$strict>;
export type CatalogSource = z.infer<typeof catalogSourceSchema>;
export declare const catalogProgressSchema: z.ZodObject<{
    schemas: z.ZodNumber;
    relations: z.ZodNumber;
    fields: z.ZodNumber;
    assets: z.ZodNumber;
}, z.core.$strict>;
export type CatalogProgress = z.infer<typeof catalogProgressSchema>;
export declare const catalogEnrichmentSchema: z.ZodObject<{
    status: z.ZodEnum<{
        running: "running";
        queued: "queued";
        succeeded: "succeeded";
        failed: "failed";
        cancelled: "cancelled";
        partial: "partial";
    }>;
    provider: z.ZodString;
    model: z.ZodString;
    reasoningEffort: z.ZodOptional<z.ZodString>;
    tablesTotal: z.ZodNumber;
    tablesCompleted: z.ZodNumber;
    tablesFailed: z.ZodNumber;
    candidatesGenerated: z.ZodNumber;
    startedAt: z.ZodOptional<z.ZodISODateTime>;
    completedAt: z.ZodOptional<z.ZodISODateTime>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type CatalogEnrichment = z.infer<typeof catalogEnrichmentSchema>;
export declare const catalogRunSchema: z.ZodObject<{
    id: z.ZodString;
    sourceId: z.ZodString;
    sessionId: z.ZodString;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"source">;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"schema">;
        schema: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"table">;
        schema: z.ZodString;
        table: z.ZodString;
    }, z.core.$strict>], "kind">;
    status: z.ZodEnum<{
        running: "running";
        interrupted: "interrupted";
        queued: "queued";
        applying: "applying";
        succeeded: "succeeded";
        failed: "failed";
        cancelled: "cancelled";
    }>;
    coverageComplete: z.ZodBoolean;
    progress: z.ZodObject<{
        schemas: z.ZodNumber;
        relations: z.ZodNumber;
        fields: z.ZodNumber;
        assets: z.ZodNumber;
    }, z.core.$strict>;
    createdAt: z.ZodISODateTime;
    startedAt: z.ZodOptional<z.ZodISODateTime>;
    completedAt: z.ZodOptional<z.ZodISODateTime>;
    error: z.ZodOptional<z.ZodString>;
    enrichment: z.ZodOptional<z.ZodObject<{
        status: z.ZodEnum<{
            running: "running";
            queued: "queued";
            succeeded: "succeeded";
            failed: "failed";
            cancelled: "cancelled";
            partial: "partial";
        }>;
        provider: z.ZodString;
        model: z.ZodString;
        reasoningEffort: z.ZodOptional<z.ZodString>;
        tablesTotal: z.ZodNumber;
        tablesCompleted: z.ZodNumber;
        tablesFailed: z.ZodNumber;
        candidatesGenerated: z.ZodNumber;
        startedAt: z.ZodOptional<z.ZodISODateTime>;
        completedAt: z.ZodOptional<z.ZodISODateTime>;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type CatalogRun = z.infer<typeof catalogRunSchema>;
export declare const startCatalogScanInputSchema: z.ZodObject<{
    sessionId: z.ZodString;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"source">;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"schema">;
        schema: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"table">;
        schema: z.ZodString;
        table: z.ZodString;
    }, z.core.$strict>], "kind">;
}, z.core.$strict>;
export type StartCatalogScanInput = z.infer<typeof startCatalogScanInputSchema>;
export declare const catalogStatusSummarySchema: z.ZodObject<{
    source: z.ZodObject<{
        id: z.ZodString;
        profileId: z.ZodString;
        type: z.ZodEnum<{
            mysql: "mysql";
            postgres: "postgres";
            sqlite: "sqlite";
            oracle: "oracle";
            hive: "hive";
            impala: "impala";
            clickhouse: "clickhouse";
            doris: "doris";
            sqlserver: "sqlserver";
        }>;
        name: z.ZodString;
        host: z.ZodOptional<z.ZodString>;
        database: z.ZodString;
        credentialConfigured: z.ZodBoolean;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
        lastFullScanAt: z.ZodOptional<z.ZodISODateTime>;
        lastPartialScanAt: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$strict>;
    activeRun: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        sourceId: z.ZodString;
        sessionId: z.ZodString;
        scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"source">;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"schema">;
            schema: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"table">;
            schema: z.ZodString;
            table: z.ZodString;
        }, z.core.$strict>], "kind">;
        status: z.ZodEnum<{
            running: "running";
            interrupted: "interrupted";
            queued: "queued";
            applying: "applying";
            succeeded: "succeeded";
            failed: "failed";
            cancelled: "cancelled";
        }>;
        coverageComplete: z.ZodBoolean;
        progress: z.ZodObject<{
            schemas: z.ZodNumber;
            relations: z.ZodNumber;
            fields: z.ZodNumber;
            assets: z.ZodNumber;
        }, z.core.$strict>;
        createdAt: z.ZodISODateTime;
        startedAt: z.ZodOptional<z.ZodISODateTime>;
        completedAt: z.ZodOptional<z.ZodISODateTime>;
        error: z.ZodOptional<z.ZodString>;
        enrichment: z.ZodOptional<z.ZodObject<{
            status: z.ZodEnum<{
                running: "running";
                queued: "queued";
                succeeded: "succeeded";
                failed: "failed";
                cancelled: "cancelled";
                partial: "partial";
            }>;
            provider: z.ZodString;
            model: z.ZodString;
            reasoningEffort: z.ZodOptional<z.ZodString>;
            tablesTotal: z.ZodNumber;
            tablesCompleted: z.ZodNumber;
            tablesFailed: z.ZodNumber;
            candidatesGenerated: z.ZodNumber;
            startedAt: z.ZodOptional<z.ZodISODateTime>;
            completedAt: z.ZodOptional<z.ZodISODateTime>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    latestRun: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        sourceId: z.ZodString;
        sessionId: z.ZodString;
        scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"source">;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"schema">;
            schema: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"table">;
            schema: z.ZodString;
            table: z.ZodString;
        }, z.core.$strict>], "kind">;
        status: z.ZodEnum<{
            running: "running";
            interrupted: "interrupted";
            queued: "queued";
            applying: "applying";
            succeeded: "succeeded";
            failed: "failed";
            cancelled: "cancelled";
        }>;
        coverageComplete: z.ZodBoolean;
        progress: z.ZodObject<{
            schemas: z.ZodNumber;
            relations: z.ZodNumber;
            fields: z.ZodNumber;
            assets: z.ZodNumber;
        }, z.core.$strict>;
        createdAt: z.ZodISODateTime;
        startedAt: z.ZodOptional<z.ZodISODateTime>;
        completedAt: z.ZodOptional<z.ZodISODateTime>;
        error: z.ZodOptional<z.ZodString>;
        enrichment: z.ZodOptional<z.ZodObject<{
            status: z.ZodEnum<{
                running: "running";
                queued: "queued";
                succeeded: "succeeded";
                failed: "failed";
                cancelled: "cancelled";
                partial: "partial";
            }>;
            provider: z.ZodString;
            model: z.ZodString;
            reasoningEffort: z.ZodOptional<z.ZodString>;
            tablesTotal: z.ZodNumber;
            tablesCompleted: z.ZodNumber;
            tablesFailed: z.ZodNumber;
            candidatesGenerated: z.ZodNumber;
            startedAt: z.ZodOptional<z.ZodISODateTime>;
            completedAt: z.ZodOptional<z.ZodISODateTime>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    latestSuccessfulRun: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        sourceId: z.ZodString;
        sessionId: z.ZodString;
        scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"source">;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"schema">;
            schema: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"table">;
            schema: z.ZodString;
            table: z.ZodString;
        }, z.core.$strict>], "kind">;
        status: z.ZodEnum<{
            running: "running";
            interrupted: "interrupted";
            queued: "queued";
            applying: "applying";
            succeeded: "succeeded";
            failed: "failed";
            cancelled: "cancelled";
        }>;
        coverageComplete: z.ZodBoolean;
        progress: z.ZodObject<{
            schemas: z.ZodNumber;
            relations: z.ZodNumber;
            fields: z.ZodNumber;
            assets: z.ZodNumber;
        }, z.core.$strict>;
        createdAt: z.ZodISODateTime;
        startedAt: z.ZodOptional<z.ZodISODateTime>;
        completedAt: z.ZodOptional<z.ZodISODateTime>;
        error: z.ZodOptional<z.ZodString>;
        enrichment: z.ZodOptional<z.ZodObject<{
            status: z.ZodEnum<{
                running: "running";
                queued: "queued";
                succeeded: "succeeded";
                failed: "failed";
                cancelled: "cancelled";
                partial: "partial";
            }>;
            provider: z.ZodString;
            model: z.ZodString;
            reasoningEffort: z.ZodOptional<z.ZodString>;
            tablesTotal: z.ZodNumber;
            tablesCompleted: z.ZodNumber;
            tablesFailed: z.ZodNumber;
            candidatesGenerated: z.ZodNumber;
            startedAt: z.ZodOptional<z.ZodISODateTime>;
            completedAt: z.ZodOptional<z.ZodISODateTime>;
            error: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    counts: z.ZodObject<{
        assets: z.ZodNumber;
        fields: z.ZodNumber;
        needsReview: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>;
export type CatalogStatusSummary = z.infer<typeof catalogStatusSummarySchema>;
export declare const catalogIdentitySchema: z.ZodObject<{
    sourceId: z.ZodString;
    database: z.ZodString;
    schema: z.ZodString;
    kind: z.ZodEnum<{
        table: "table";
        view: "view";
        schema: "schema";
        column: "column";
        primary_key: "primary_key";
        foreign_key: "foreign_key";
        index: "index";
    }>;
    relation: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
}, z.core.$strict>;
export type CatalogIdentity = z.infer<typeof catalogIdentitySchema>;
export declare const catalogCapabilitySchema: z.ZodEnum<{
    unavailable: "unavailable";
    supported: "supported";
    unsupported: "unsupported";
}>;
export type CatalogCapability = z.infer<typeof catalogCapabilitySchema>;
export declare const catalogTechnicalPayloadSchema: z.ZodObject<{
    identity: z.ZodObject<{
        sourceId: z.ZodString;
        database: z.ZodString;
        schema: z.ZodString;
        kind: z.ZodEnum<{
            table: "table";
            view: "view";
            schema: "schema";
            column: "column";
            primary_key: "primary_key";
            foreign_key: "foreign_key";
            index: "index";
        }>;
        relation: z.ZodOptional<z.ZodString>;
        name: z.ZodString;
    }, z.core.$strict>;
    name: z.ZodString;
    path: z.ZodString;
    parentId: z.ZodOptional<z.ZodString>;
    objectType: z.ZodOptional<z.ZodEnum<{
        table: "table";
        view: "view";
    }>>;
    dataType: z.ZodOptional<z.ZodString>;
    nullable: z.ZodOptional<z.ZodBoolean>;
    ordinal: z.ZodOptional<z.ZodNumber>;
    comment: z.ZodOptional<z.ZodString>;
    referencedAssetIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>>;
    capabilities: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodEnum<{
        unavailable: "unavailable";
        supported: "supported";
        unsupported: "unsupported";
    }>>>;
    truncatedFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
    provenance: z.ZodObject<{
        source: z.ZodLiteral<"database">;
        dialect: z.ZodEnum<{
            mysql: "mysql";
            postgres: "postgres";
            sqlite: "sqlite";
            oracle: "oracle";
            hive: "hive";
            impala: "impala";
            clickhouse: "clickhouse";
            doris: "doris";
            sqlserver: "sqlserver";
        }>;
        runId: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export type CatalogTechnicalPayload = z.infer<typeof catalogTechnicalPayloadSchema>;
export declare const catalogObservationSchema: z.ZodObject<{
    runId: z.ZodString;
    sourceId: z.ZodString;
    assetId: z.ZodString;
    status: z.ZodEnum<{
        observed: "observed";
        missing: "missing";
        unavailable: "unavailable";
    }>;
    fingerprint: z.ZodString;
    observedAt: z.ZodISODateTime;
    payload: z.ZodObject<{
        identity: z.ZodObject<{
            sourceId: z.ZodString;
            database: z.ZodString;
            schema: z.ZodString;
            kind: z.ZodEnum<{
                table: "table";
                view: "view";
                schema: "schema";
                column: "column";
                primary_key: "primary_key";
                foreign_key: "foreign_key";
                index: "index";
            }>;
            relation: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
        }, z.core.$strict>;
        name: z.ZodString;
        path: z.ZodString;
        parentId: z.ZodOptional<z.ZodString>;
        objectType: z.ZodOptional<z.ZodEnum<{
            table: "table";
            view: "view";
        }>>;
        dataType: z.ZodOptional<z.ZodString>;
        nullable: z.ZodOptional<z.ZodBoolean>;
        ordinal: z.ZodOptional<z.ZodNumber>;
        comment: z.ZodOptional<z.ZodString>;
        referencedAssetIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
        attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>>;
        capabilities: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodEnum<{
            unavailable: "unavailable";
            supported: "supported";
            unsupported: "unsupported";
        }>>>;
        truncatedFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
        provenance: z.ZodObject<{
            source: z.ZodLiteral<"database">;
            dialect: z.ZodEnum<{
                mysql: "mysql";
                postgres: "postgres";
                sqlite: "sqlite";
                oracle: "oracle";
                hive: "hive";
                impala: "impala";
                clickhouse: "clickhouse";
                doris: "doris";
                sqlserver: "sqlserver";
            }>;
            runId: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>;
}, z.core.$strict>;
export type CatalogObservation = z.infer<typeof catalogObservationSchema>;
export declare const catalogAssetRevisionSchema: z.ZodObject<{
    id: z.ZodString;
    assetId: z.ZodString;
    sourceId: z.ZodString;
    runId: z.ZodString;
    revision: z.ZodNumber;
    status: z.ZodEnum<{
        observed: "observed";
        missing: "missing";
        unavailable: "unavailable";
    }>;
    fingerprint: z.ZodString;
    observedAt: z.ZodISODateTime;
    previousRevisionId: z.ZodOptional<z.ZodString>;
    changeSummary: z.ZodArray<z.ZodString>;
    payload: z.ZodObject<{
        identity: z.ZodObject<{
            sourceId: z.ZodString;
            database: z.ZodString;
            schema: z.ZodString;
            kind: z.ZodEnum<{
                table: "table";
                view: "view";
                schema: "schema";
                column: "column";
                primary_key: "primary_key";
                foreign_key: "foreign_key";
                index: "index";
            }>;
            relation: z.ZodOptional<z.ZodString>;
            name: z.ZodString;
        }, z.core.$strict>;
        name: z.ZodString;
        path: z.ZodString;
        parentId: z.ZodOptional<z.ZodString>;
        objectType: z.ZodOptional<z.ZodEnum<{
            table: "table";
            view: "view";
        }>>;
        dataType: z.ZodOptional<z.ZodString>;
        nullable: z.ZodOptional<z.ZodBoolean>;
        ordinal: z.ZodOptional<z.ZodNumber>;
        comment: z.ZodOptional<z.ZodString>;
        referencedAssetIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
        attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>>;
        capabilities: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodEnum<{
            unavailable: "unavailable";
            supported: "supported";
            unsupported: "unsupported";
        }>>>;
        truncatedFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
        provenance: z.ZodObject<{
            source: z.ZodLiteral<"database">;
            dialect: z.ZodEnum<{
                mysql: "mysql";
                postgres: "postgres";
                sqlite: "sqlite";
                oracle: "oracle";
                hive: "hive";
                impala: "impala";
                clickhouse: "clickhouse";
                doris: "doris";
                sqlserver: "sqlserver";
            }>;
            runId: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>;
}, z.core.$strict>;
export type CatalogAssetRevision = z.infer<typeof catalogAssetRevisionSchema>;
export declare const catalogAssetHeadSchema: z.ZodObject<{
    assetId: z.ZodString;
    sourceId: z.ZodString;
    revisionIds: z.ZodArray<z.ZodString>;
    firstSeenAt: z.ZodISODateTime;
    lastSeenAt: z.ZodISODateTime;
}, z.core.$strict>;
export type CatalogAssetHead = z.infer<typeof catalogAssetHeadSchema>;
export declare const catalogRelationSchema: z.ZodObject<{
    id: z.ZodString;
    sourceId: z.ZodString;
    runId: z.ZodString;
    kind: z.ZodEnum<{
        primary_key: "primary_key";
        foreign_key: "foreign_key";
        index: "index";
        parent: "parent";
    }>;
    fromAssetId: z.ZodString;
    toAssetId: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    columnAssetIds: z.ZodArray<z.ZodString>;
    referencedColumnAssetIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    observedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type CatalogRelation = z.infer<typeof catalogRelationSchema>;
export declare const termDefinitionSchema: z.ZodObject<{
    name: z.ZodString;
    aliases: z.ZodArray<z.ZodString>;
    description: z.ZodString;
    owner: z.ZodOptional<z.ZodString>;
    sourceAssetIds: z.ZodArray<z.ZodString>;
    status: z.ZodEnum<{
        inferred: "inferred";
        verified: "verified";
        needs_review: "needs_review";
        retired: "retired";
    }>;
    validFrom: z.ZodOptional<z.ZodISODateTime>;
    validTo: z.ZodOptional<z.ZodISODateTime>;
    revisionNote: z.ZodOptional<z.ZodString>;
    verifiedAt: z.ZodOptional<z.ZodISODateTime>;
    needsReviewReason: z.ZodOptional<z.ZodString>;
    triggerRunId: z.ZodOptional<z.ZodString>;
    kind: z.ZodLiteral<"term">;
}, z.core.$strict>;
export type TermDefinition = z.infer<typeof termDefinitionSchema>;
export declare const metricDefinitionSchema: z.ZodObject<{
    formula: z.ZodString;
    grain: z.ZodString;
    timeFieldAssetId: z.ZodOptional<z.ZodString>;
    filters: z.ZodArray<z.ZodString>;
    exclusions: z.ZodArray<z.ZodString>;
    name: z.ZodString;
    aliases: z.ZodArray<z.ZodString>;
    description: z.ZodString;
    owner: z.ZodOptional<z.ZodString>;
    sourceAssetIds: z.ZodArray<z.ZodString>;
    status: z.ZodEnum<{
        inferred: "inferred";
        verified: "verified";
        needs_review: "needs_review";
        retired: "retired";
    }>;
    validFrom: z.ZodOptional<z.ZodISODateTime>;
    validTo: z.ZodOptional<z.ZodISODateTime>;
    revisionNote: z.ZodOptional<z.ZodString>;
    verifiedAt: z.ZodOptional<z.ZodISODateTime>;
    needsReviewReason: z.ZodOptional<z.ZodString>;
    triggerRunId: z.ZodOptional<z.ZodString>;
    kind: z.ZodLiteral<"metric">;
}, z.core.$strict>;
export type MetricDefinition = z.infer<typeof metricDefinitionSchema>;
export declare const meaningDefinitionSchema: z.ZodObject<{
    targetAssetId: z.ZodString;
    targetKind: z.ZodEnum<{
        table: "table";
        view: "view";
        column: "column";
    }>;
    generatedBy: z.ZodObject<{
        kind: z.ZodLiteral<"ai">;
        provider: z.ZodString;
        model: z.ZodString;
        runId: z.ZodString;
    }, z.core.$strict>;
    name: z.ZodString;
    aliases: z.ZodArray<z.ZodString>;
    description: z.ZodString;
    owner: z.ZodOptional<z.ZodString>;
    sourceAssetIds: z.ZodArray<z.ZodString>;
    status: z.ZodEnum<{
        inferred: "inferred";
        verified: "verified";
        needs_review: "needs_review";
        retired: "retired";
    }>;
    validFrom: z.ZodOptional<z.ZodISODateTime>;
    validTo: z.ZodOptional<z.ZodISODateTime>;
    revisionNote: z.ZodOptional<z.ZodString>;
    verifiedAt: z.ZodOptional<z.ZodISODateTime>;
    needsReviewReason: z.ZodOptional<z.ZodString>;
    triggerRunId: z.ZodOptional<z.ZodString>;
    kind: z.ZodLiteral<"meaning">;
}, z.core.$strict>;
export type MeaningDefinition = z.infer<typeof meaningDefinitionSchema>;
export declare const semanticDefinitionSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    targetAssetId: z.ZodString;
    targetKind: z.ZodEnum<{
        table: "table";
        view: "view";
        column: "column";
    }>;
    generatedBy: z.ZodObject<{
        kind: z.ZodLiteral<"ai">;
        provider: z.ZodString;
        model: z.ZodString;
        runId: z.ZodString;
    }, z.core.$strict>;
    name: z.ZodString;
    aliases: z.ZodArray<z.ZodString>;
    description: z.ZodString;
    owner: z.ZodOptional<z.ZodString>;
    sourceAssetIds: z.ZodArray<z.ZodString>;
    status: z.ZodEnum<{
        inferred: "inferred";
        verified: "verified";
        needs_review: "needs_review";
        retired: "retired";
    }>;
    validFrom: z.ZodOptional<z.ZodISODateTime>;
    validTo: z.ZodOptional<z.ZodISODateTime>;
    revisionNote: z.ZodOptional<z.ZodString>;
    verifiedAt: z.ZodOptional<z.ZodISODateTime>;
    needsReviewReason: z.ZodOptional<z.ZodString>;
    triggerRunId: z.ZodOptional<z.ZodString>;
    kind: z.ZodLiteral<"meaning">;
}, z.core.$strict>, z.ZodObject<{
    name: z.ZodString;
    aliases: z.ZodArray<z.ZodString>;
    description: z.ZodString;
    owner: z.ZodOptional<z.ZodString>;
    sourceAssetIds: z.ZodArray<z.ZodString>;
    status: z.ZodEnum<{
        inferred: "inferred";
        verified: "verified";
        needs_review: "needs_review";
        retired: "retired";
    }>;
    validFrom: z.ZodOptional<z.ZodISODateTime>;
    validTo: z.ZodOptional<z.ZodISODateTime>;
    revisionNote: z.ZodOptional<z.ZodString>;
    verifiedAt: z.ZodOptional<z.ZodISODateTime>;
    needsReviewReason: z.ZodOptional<z.ZodString>;
    triggerRunId: z.ZodOptional<z.ZodString>;
    kind: z.ZodLiteral<"term">;
}, z.core.$strict>, z.ZodObject<{
    formula: z.ZodString;
    grain: z.ZodString;
    timeFieldAssetId: z.ZodOptional<z.ZodString>;
    filters: z.ZodArray<z.ZodString>;
    exclusions: z.ZodArray<z.ZodString>;
    name: z.ZodString;
    aliases: z.ZodArray<z.ZodString>;
    description: z.ZodString;
    owner: z.ZodOptional<z.ZodString>;
    sourceAssetIds: z.ZodArray<z.ZodString>;
    status: z.ZodEnum<{
        inferred: "inferred";
        verified: "verified";
        needs_review: "needs_review";
        retired: "retired";
    }>;
    validFrom: z.ZodOptional<z.ZodISODateTime>;
    validTo: z.ZodOptional<z.ZodISODateTime>;
    revisionNote: z.ZodOptional<z.ZodString>;
    verifiedAt: z.ZodOptional<z.ZodISODateTime>;
    needsReviewReason: z.ZodOptional<z.ZodString>;
    triggerRunId: z.ZodOptional<z.ZodString>;
    kind: z.ZodLiteral<"metric">;
}, z.core.$strict>], "kind">;
export type SemanticDefinition = z.infer<typeof semanticDefinitionSchema>;
export declare const catalogSemanticEntrySchema: z.ZodObject<{
    id: z.ZodString;
    sourceId: z.ZodString;
    kind: z.ZodEnum<{
        term: "term";
        metric: "metric";
        meaning: "meaning";
    }>;
    currentVersion: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export type CatalogSemanticEntry = z.infer<typeof catalogSemanticEntrySchema>;
export declare const catalogSemanticRevisionSchema: z.ZodObject<{
    id: z.ZodString;
    semanticId: z.ZodString;
    sourceId: z.ZodString;
    version: z.ZodNumber;
    createdAt: z.ZodISODateTime;
    definition: z.ZodDiscriminatedUnion<[z.ZodObject<{
        targetAssetId: z.ZodString;
        targetKind: z.ZodEnum<{
            table: "table";
            view: "view";
            column: "column";
        }>;
        generatedBy: z.ZodObject<{
            kind: z.ZodLiteral<"ai">;
            provider: z.ZodString;
            model: z.ZodString;
            runId: z.ZodString;
        }, z.core.$strict>;
        name: z.ZodString;
        aliases: z.ZodArray<z.ZodString>;
        description: z.ZodString;
        owner: z.ZodOptional<z.ZodString>;
        sourceAssetIds: z.ZodArray<z.ZodString>;
        status: z.ZodEnum<{
            inferred: "inferred";
            verified: "verified";
            needs_review: "needs_review";
            retired: "retired";
        }>;
        validFrom: z.ZodOptional<z.ZodISODateTime>;
        validTo: z.ZodOptional<z.ZodISODateTime>;
        revisionNote: z.ZodOptional<z.ZodString>;
        verifiedAt: z.ZodOptional<z.ZodISODateTime>;
        needsReviewReason: z.ZodOptional<z.ZodString>;
        triggerRunId: z.ZodOptional<z.ZodString>;
        kind: z.ZodLiteral<"meaning">;
    }, z.core.$strict>, z.ZodObject<{
        name: z.ZodString;
        aliases: z.ZodArray<z.ZodString>;
        description: z.ZodString;
        owner: z.ZodOptional<z.ZodString>;
        sourceAssetIds: z.ZodArray<z.ZodString>;
        status: z.ZodEnum<{
            inferred: "inferred";
            verified: "verified";
            needs_review: "needs_review";
            retired: "retired";
        }>;
        validFrom: z.ZodOptional<z.ZodISODateTime>;
        validTo: z.ZodOptional<z.ZodISODateTime>;
        revisionNote: z.ZodOptional<z.ZodString>;
        verifiedAt: z.ZodOptional<z.ZodISODateTime>;
        needsReviewReason: z.ZodOptional<z.ZodString>;
        triggerRunId: z.ZodOptional<z.ZodString>;
        kind: z.ZodLiteral<"term">;
    }, z.core.$strict>, z.ZodObject<{
        formula: z.ZodString;
        grain: z.ZodString;
        timeFieldAssetId: z.ZodOptional<z.ZodString>;
        filters: z.ZodArray<z.ZodString>;
        exclusions: z.ZodArray<z.ZodString>;
        name: z.ZodString;
        aliases: z.ZodArray<z.ZodString>;
        description: z.ZodString;
        owner: z.ZodOptional<z.ZodString>;
        sourceAssetIds: z.ZodArray<z.ZodString>;
        status: z.ZodEnum<{
            inferred: "inferred";
            verified: "verified";
            needs_review: "needs_review";
            retired: "retired";
        }>;
        validFrom: z.ZodOptional<z.ZodISODateTime>;
        validTo: z.ZodOptional<z.ZodISODateTime>;
        revisionNote: z.ZodOptional<z.ZodString>;
        verifiedAt: z.ZodOptional<z.ZodISODateTime>;
        needsReviewReason: z.ZodOptional<z.ZodString>;
        triggerRunId: z.ZodOptional<z.ZodString>;
        kind: z.ZodLiteral<"metric">;
    }, z.core.$strict>], "kind">;
}, z.core.$strict>;
export type CatalogSemanticRevision = z.infer<typeof catalogSemanticRevisionSchema>;
export declare const catalogSearchFiltersSchema: z.ZodObject<{
    sourceId: z.ZodOptional<z.ZodString>;
    schema: z.ZodOptional<z.ZodString>;
    assetKinds: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        table: "table";
        view: "view";
        schema: "schema";
        column: "column";
        primary_key: "primary_key";
        foreign_key: "foreign_key";
        index: "index";
    }>>>;
    semanticKinds: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        term: "term";
        metric: "metric";
        meaning: "meaning";
    }>>>;
    assetStatuses: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        observed: "observed";
        missing: "missing";
        unavailable: "unavailable";
    }>>>;
    semanticStatuses: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        inferred: "inferred";
        verified: "verified";
        needs_review: "needs_review";
        retired: "retired";
    }>>>;
    includeInferred: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
export type CatalogSearchFilters = z.infer<typeof catalogSearchFiltersSchema>;
export declare const catalogSearchRequestSchema: z.ZodObject<{
    query: z.ZodString;
    filters: z.ZodDefault<z.ZodObject<{
        sourceId: z.ZodOptional<z.ZodString>;
        schema: z.ZodOptional<z.ZodString>;
        assetKinds: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            table: "table";
            view: "view";
            schema: "schema";
            column: "column";
            primary_key: "primary_key";
            foreign_key: "foreign_key";
            index: "index";
        }>>>;
        semanticKinds: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            term: "term";
            metric: "metric";
            meaning: "meaning";
        }>>>;
        assetStatuses: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            observed: "observed";
            missing: "missing";
            unavailable: "unavailable";
        }>>>;
        semanticStatuses: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            inferred: "inferred";
            verified: "verified";
            needs_review: "needs_review";
            retired: "retired";
        }>>>;
        includeInferred: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>;
    cursor: z.ZodOptional<z.ZodString>;
    pageSize: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export type CatalogSearchRequest = z.infer<typeof catalogSearchRequestSchema>;
export declare const catalogSearchItemSchema: z.ZodObject<{
    id: z.ZodString;
    sourceId: z.ZodString;
    resultType: z.ZodEnum<{
        asset: "asset";
        semantic: "semantic";
    }>;
    kind: z.ZodString;
    name: z.ZodString;
    path: z.ZodString;
    summary: z.ZodString;
    matchReasons: z.ZodArray<z.ZodString>;
    status: z.ZodString;
    version: z.ZodOptional<z.ZodNumber>;
    provenance: z.ZodEnum<{
        inferred: "inferred";
        database: "database";
        human: "human";
    }>;
    untrusted: z.ZodLiteral<true>;
}, z.core.$strict>;
export type CatalogSearchItem = z.infer<typeof catalogSearchItemSchema>;
export declare const catalogSearchPageSchema: z.ZodObject<{
    sourceId: z.ZodString;
    query: z.ZodString;
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        sourceId: z.ZodString;
        resultType: z.ZodEnum<{
            asset: "asset";
            semantic: "semantic";
        }>;
        kind: z.ZodString;
        name: z.ZodString;
        path: z.ZodString;
        summary: z.ZodString;
        matchReasons: z.ZodArray<z.ZodString>;
        status: z.ZodString;
        version: z.ZodOptional<z.ZodNumber>;
        provenance: z.ZodEnum<{
            inferred: "inferred";
            database: "database";
            human: "human";
        }>;
        untrusted: z.ZodLiteral<true>;
    }, z.core.$strict>>;
    nextCursor: z.ZodOptional<z.ZodString>;
    truncated: z.ZodBoolean;
    warnings: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type CatalogSearchPage = z.infer<typeof catalogSearchPageSchema>;
export declare const catalogAssetDetailSchema: z.ZodObject<{
    asset: z.ZodObject<{
        id: z.ZodString;
        assetId: z.ZodString;
        sourceId: z.ZodString;
        runId: z.ZodString;
        revision: z.ZodNumber;
        status: z.ZodEnum<{
            observed: "observed";
            missing: "missing";
            unavailable: "unavailable";
        }>;
        fingerprint: z.ZodString;
        observedAt: z.ZodISODateTime;
        previousRevisionId: z.ZodOptional<z.ZodString>;
        changeSummary: z.ZodArray<z.ZodString>;
        payload: z.ZodObject<{
            identity: z.ZodObject<{
                sourceId: z.ZodString;
                database: z.ZodString;
                schema: z.ZodString;
                kind: z.ZodEnum<{
                    table: "table";
                    view: "view";
                    schema: "schema";
                    column: "column";
                    primary_key: "primary_key";
                    foreign_key: "foreign_key";
                    index: "index";
                }>;
                relation: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
            }, z.core.$strict>;
            name: z.ZodString;
            path: z.ZodString;
            parentId: z.ZodOptional<z.ZodString>;
            objectType: z.ZodOptional<z.ZodEnum<{
                table: "table";
                view: "view";
            }>>;
            dataType: z.ZodOptional<z.ZodString>;
            nullable: z.ZodOptional<z.ZodBoolean>;
            ordinal: z.ZodOptional<z.ZodNumber>;
            comment: z.ZodOptional<z.ZodString>;
            referencedAssetIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
            attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>>;
            capabilities: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodEnum<{
                unavailable: "unavailable";
                supported: "supported";
                unsupported: "unsupported";
            }>>>;
            truncatedFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
            provenance: z.ZodObject<{
                source: z.ZodLiteral<"database">;
                dialect: z.ZodEnum<{
                    mysql: "mysql";
                    postgres: "postgres";
                    sqlite: "sqlite";
                    oracle: "oracle";
                    hive: "hive";
                    impala: "impala";
                    clickhouse: "clickhouse";
                    doris: "doris";
                    sqlserver: "sqlserver";
                }>;
                runId: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>;
    }, z.core.$strict>;
    fields: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        assetId: z.ZodString;
        sourceId: z.ZodString;
        runId: z.ZodString;
        revision: z.ZodNumber;
        status: z.ZodEnum<{
            observed: "observed";
            missing: "missing";
            unavailable: "unavailable";
        }>;
        fingerprint: z.ZodString;
        observedAt: z.ZodISODateTime;
        previousRevisionId: z.ZodOptional<z.ZodString>;
        changeSummary: z.ZodArray<z.ZodString>;
        payload: z.ZodObject<{
            identity: z.ZodObject<{
                sourceId: z.ZodString;
                database: z.ZodString;
                schema: z.ZodString;
                kind: z.ZodEnum<{
                    table: "table";
                    view: "view";
                    schema: "schema";
                    column: "column";
                    primary_key: "primary_key";
                    foreign_key: "foreign_key";
                    index: "index";
                }>;
                relation: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
            }, z.core.$strict>;
            name: z.ZodString;
            path: z.ZodString;
            parentId: z.ZodOptional<z.ZodString>;
            objectType: z.ZodOptional<z.ZodEnum<{
                table: "table";
                view: "view";
            }>>;
            dataType: z.ZodOptional<z.ZodString>;
            nullable: z.ZodOptional<z.ZodBoolean>;
            ordinal: z.ZodOptional<z.ZodNumber>;
            comment: z.ZodOptional<z.ZodString>;
            referencedAssetIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
            attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>>;
            capabilities: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodEnum<{
                unavailable: "unavailable";
                supported: "supported";
                unsupported: "unsupported";
            }>>>;
            truncatedFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
            provenance: z.ZodObject<{
                source: z.ZodLiteral<"database">;
                dialect: z.ZodEnum<{
                    mysql: "mysql";
                    postgres: "postgres";
                    sqlite: "sqlite";
                    oracle: "oracle";
                    hive: "hive";
                    impala: "impala";
                    clickhouse: "clickhouse";
                    doris: "doris";
                    sqlserver: "sqlserver";
                }>;
                runId: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    relations: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        sourceId: z.ZodString;
        runId: z.ZodString;
        kind: z.ZodEnum<{
            primary_key: "primary_key";
            foreign_key: "foreign_key";
            index: "index";
            parent: "parent";
        }>;
        fromAssetId: z.ZodString;
        toAssetId: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        columnAssetIds: z.ZodArray<z.ZodString>;
        referencedColumnAssetIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
        observedAt: z.ZodISODateTime;
    }, z.core.$strict>>;
    semantics: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        semanticId: z.ZodString;
        sourceId: z.ZodString;
        version: z.ZodNumber;
        createdAt: z.ZodISODateTime;
        definition: z.ZodDiscriminatedUnion<[z.ZodObject<{
            targetAssetId: z.ZodString;
            targetKind: z.ZodEnum<{
                table: "table";
                view: "view";
                column: "column";
            }>;
            generatedBy: z.ZodObject<{
                kind: z.ZodLiteral<"ai">;
                provider: z.ZodString;
                model: z.ZodString;
                runId: z.ZodString;
            }, z.core.$strict>;
            name: z.ZodString;
            aliases: z.ZodArray<z.ZodString>;
            description: z.ZodString;
            owner: z.ZodOptional<z.ZodString>;
            sourceAssetIds: z.ZodArray<z.ZodString>;
            status: z.ZodEnum<{
                inferred: "inferred";
                verified: "verified";
                needs_review: "needs_review";
                retired: "retired";
            }>;
            validFrom: z.ZodOptional<z.ZodISODateTime>;
            validTo: z.ZodOptional<z.ZodISODateTime>;
            revisionNote: z.ZodOptional<z.ZodString>;
            verifiedAt: z.ZodOptional<z.ZodISODateTime>;
            needsReviewReason: z.ZodOptional<z.ZodString>;
            triggerRunId: z.ZodOptional<z.ZodString>;
            kind: z.ZodLiteral<"meaning">;
        }, z.core.$strict>, z.ZodObject<{
            name: z.ZodString;
            aliases: z.ZodArray<z.ZodString>;
            description: z.ZodString;
            owner: z.ZodOptional<z.ZodString>;
            sourceAssetIds: z.ZodArray<z.ZodString>;
            status: z.ZodEnum<{
                inferred: "inferred";
                verified: "verified";
                needs_review: "needs_review";
                retired: "retired";
            }>;
            validFrom: z.ZodOptional<z.ZodISODateTime>;
            validTo: z.ZodOptional<z.ZodISODateTime>;
            revisionNote: z.ZodOptional<z.ZodString>;
            verifiedAt: z.ZodOptional<z.ZodISODateTime>;
            needsReviewReason: z.ZodOptional<z.ZodString>;
            triggerRunId: z.ZodOptional<z.ZodString>;
            kind: z.ZodLiteral<"term">;
        }, z.core.$strict>, z.ZodObject<{
            formula: z.ZodString;
            grain: z.ZodString;
            timeFieldAssetId: z.ZodOptional<z.ZodString>;
            filters: z.ZodArray<z.ZodString>;
            exclusions: z.ZodArray<z.ZodString>;
            name: z.ZodString;
            aliases: z.ZodArray<z.ZodString>;
            description: z.ZodString;
            owner: z.ZodOptional<z.ZodString>;
            sourceAssetIds: z.ZodArray<z.ZodString>;
            status: z.ZodEnum<{
                inferred: "inferred";
                verified: "verified";
                needs_review: "needs_review";
                retired: "retired";
            }>;
            validFrom: z.ZodOptional<z.ZodISODateTime>;
            validTo: z.ZodOptional<z.ZodISODateTime>;
            revisionNote: z.ZodOptional<z.ZodString>;
            verifiedAt: z.ZodOptional<z.ZodISODateTime>;
            needsReviewReason: z.ZodOptional<z.ZodString>;
            triggerRunId: z.ZodOptional<z.ZodString>;
            kind: z.ZodLiteral<"metric">;
        }, z.core.$strict>], "kind">;
    }, z.core.$strict>>;
    history: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        assetId: z.ZodString;
        sourceId: z.ZodString;
        runId: z.ZodString;
        revision: z.ZodNumber;
        status: z.ZodEnum<{
            observed: "observed";
            missing: "missing";
            unavailable: "unavailable";
        }>;
        fingerprint: z.ZodString;
        observedAt: z.ZodISODateTime;
        previousRevisionId: z.ZodOptional<z.ZodString>;
        changeSummary: z.ZodArray<z.ZodString>;
        payload: z.ZodObject<{
            identity: z.ZodObject<{
                sourceId: z.ZodString;
                database: z.ZodString;
                schema: z.ZodString;
                kind: z.ZodEnum<{
                    table: "table";
                    view: "view";
                    schema: "schema";
                    column: "column";
                    primary_key: "primary_key";
                    foreign_key: "foreign_key";
                    index: "index";
                }>;
                relation: z.ZodOptional<z.ZodString>;
                name: z.ZodString;
            }, z.core.$strict>;
            name: z.ZodString;
            path: z.ZodString;
            parentId: z.ZodOptional<z.ZodString>;
            objectType: z.ZodOptional<z.ZodEnum<{
                table: "table";
                view: "view";
            }>>;
            dataType: z.ZodOptional<z.ZodString>;
            nullable: z.ZodOptional<z.ZodBoolean>;
            ordinal: z.ZodOptional<z.ZodNumber>;
            comment: z.ZodOptional<z.ZodString>;
            referencedAssetIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
            attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>>;
            capabilities: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodEnum<{
                unavailable: "unavailable";
                supported: "supported";
                unsupported: "unsupported";
            }>>>;
            truncatedFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
            provenance: z.ZodObject<{
                source: z.ZodLiteral<"database">;
                dialect: z.ZodEnum<{
                    mysql: "mysql";
                    postgres: "postgres";
                    sqlite: "sqlite";
                    oracle: "oracle";
                    hive: "hive";
                    impala: "impala";
                    clickhouse: "clickhouse";
                    doris: "doris";
                    sqlserver: "sqlserver";
                }>;
                runId: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    nextCursor: z.ZodOptional<z.ZodString>;
    truncated: z.ZodBoolean;
    untrusted: z.ZodLiteral<true>;
}, z.core.$strict>;
export type CatalogAssetDetail = z.infer<typeof catalogAssetDetailSchema>;
export declare const catalogDiffItemSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        missing: "missing";
        unavailable: "unavailable";
        added: "added";
        changed: "changed";
        restored: "restored";
    }>;
    assetId: z.ZodString;
    name: z.ZodString;
    path: z.ZodString;
    fromRevisionId: z.ZodOptional<z.ZodString>;
    toRevisionId: z.ZodOptional<z.ZodString>;
    summary: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type CatalogDiffItem = z.infer<typeof catalogDiffItemSchema>;
export declare const catalogDiffPageSchema: z.ZodObject<{
    sourceId: z.ZodString;
    fromRunId: z.ZodString;
    toRunId: z.ZodString;
    scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"source">;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"schema">;
        schema: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"table">;
        schema: z.ZodString;
        table: z.ZodString;
    }, z.core.$strict>], "kind">;
    items: z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<{
            missing: "missing";
            unavailable: "unavailable";
            added: "added";
            changed: "changed";
            restored: "restored";
        }>;
        assetId: z.ZodString;
        name: z.ZodString;
        path: z.ZodString;
        fromRevisionId: z.ZodOptional<z.ZodString>;
        toRevisionId: z.ZodOptional<z.ZodString>;
        summary: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    nextCursor: z.ZodOptional<z.ZodString>;
    truncated: z.ZodBoolean;
}, z.core.$strict>;
export type CatalogDiffPage = z.infer<typeof catalogDiffPageSchema>;
export interface CatalogIndexRecord {
    id: string;
    sourceId: string;
    resultType: 'asset' | 'semantic';
    searchText: string;
    searchItem: CatalogSearchItem;
    updatedAt: string;
}
export interface CatalogIndexState {
    version: 1;
    rebuiltAt?: string;
}
