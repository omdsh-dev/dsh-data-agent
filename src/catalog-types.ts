/**
 * Surface-neutral Catalog contracts. This module contains no Node or browser
 * runtime dependencies beyond Zod and can therefore be imported type-only by
 * the Web bundle.
 * @module @yejiming/dsh-data-agent/catalog-types
 */

import { z } from 'zod'
import { DATABASE_TYPES } from './database-types.ts'

export const catalogDateTimeSchema = z.iso.datetime()

export const CATALOG_RUN_STATUSES = [
  'queued', 'running', 'applying', 'succeeded', 'failed', 'cancelled', 'interrupted',
] as const
export const catalogRunStatusSchema = z.enum(CATALOG_RUN_STATUSES)
export type CatalogRunStatus = z.infer<typeof catalogRunStatusSchema>

export const CATALOG_ASSET_STATUSES = ['observed', 'missing', 'unavailable'] as const
export const catalogAssetStatusSchema = z.enum(CATALOG_ASSET_STATUSES)
export type CatalogAssetStatus = z.infer<typeof catalogAssetStatusSchema>

export const CATALOG_ASSET_KINDS = [
  'schema', 'table', 'view', 'column', 'primary_key', 'foreign_key', 'index',
] as const
export const catalogAssetKindSchema = z.enum(CATALOG_ASSET_KINDS)
export type CatalogAssetKind = z.infer<typeof catalogAssetKindSchema>

export const CATALOG_ENRICHMENT_STATUSES = [
  'queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled',
] as const
export const catalogEnrichmentStatusSchema = z.enum(CATALOG_ENRICHMENT_STATUSES)
export type CatalogEnrichmentStatus = z.infer<typeof catalogEnrichmentStatusSchema>

export const CATALOG_SEMANTIC_KINDS = ['meaning', 'term', 'metric'] as const
export const catalogSemanticKindSchema = z.enum(CATALOG_SEMANTIC_KINDS)
export type CatalogSemanticKind = z.infer<typeof catalogSemanticKindSchema>

export const CATALOG_SEMANTIC_STATUSES = ['inferred', 'verified', 'needs_review', 'retired'] as const
export const catalogSemanticStatusSchema = z.enum(CATALOG_SEMANTIC_STATUSES)
export type CatalogSemanticStatus = z.infer<typeof catalogSemanticStatusSchema>

export const CATALOG_DIFF_KINDS = ['added', 'changed', 'missing', 'restored', 'unavailable'] as const
export const catalogDiffKindSchema = z.enum(CATALOG_DIFF_KINDS)
export type CatalogDiffKind = z.infer<typeof catalogDiffKindSchema>

export const catalogScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('source') }),
  z.strictObject({ kind: z.literal('schema'), schema: z.string().min(1).max(256) }),
  z.strictObject({
    kind: z.literal('table'),
    schema: z.string().min(1).max(256),
    table: z.string().min(1).max(256),
  }),
])
export type CatalogScope = z.infer<typeof catalogScopeSchema>

export const catalogSourceSchema = z.strictObject({
  id: z.string().min(1).max(256),
  profileId: z.string().min(1).max(256),
  type: z.enum(DATABASE_TYPES),
  name: z.string().min(1).max(256),
  host: z.string().max(512).optional(),
  database: z.string().min(1).max(512),
  credentialConfigured: z.boolean(),
  createdAt: catalogDateTimeSchema,
  updatedAt: catalogDateTimeSchema,
  lastFullScanAt: catalogDateTimeSchema.optional(),
  lastPartialScanAt: catalogDateTimeSchema.optional(),
})
export type CatalogSource = z.infer<typeof catalogSourceSchema>

export const catalogProgressSchema = z.strictObject({
  schemas: z.number().int().nonnegative(),
  relations: z.number().int().nonnegative(),
  fields: z.number().int().nonnegative(),
  assets: z.number().int().nonnegative(),
})
export type CatalogProgress = z.infer<typeof catalogProgressSchema>

export const catalogEnrichmentSchema = z.strictObject({
  status: catalogEnrichmentStatusSchema,
  provider: z.string().min(1).max(256),
  model: z.string().min(1).max(512),
  reasoningEffort: z.string().min(1).max(64).optional(),
  tablesTotal: z.number().int().nonnegative(),
  tablesCompleted: z.number().int().nonnegative(),
  tablesFailed: z.number().int().nonnegative(),
  candidatesGenerated: z.number().int().nonnegative(),
  startedAt: catalogDateTimeSchema.optional(),
  completedAt: catalogDateTimeSchema.optional(),
  error: z.string().max(4_096).optional(),
})
export type CatalogEnrichment = z.infer<typeof catalogEnrichmentSchema>

export const catalogRunSchema = z.strictObject({
  id: z.string().min(1).max(256),
  sourceId: z.string().min(1).max(256),
  sessionId: z.string().min(1).max(256),
  scope: catalogScopeSchema,
  status: catalogRunStatusSchema,
  coverageComplete: z.boolean(),
  progress: catalogProgressSchema,
  createdAt: catalogDateTimeSchema,
  startedAt: catalogDateTimeSchema.optional(),
  completedAt: catalogDateTimeSchema.optional(),
  error: z.string().max(4_096).optional(),
  enrichment: catalogEnrichmentSchema.optional(),
})
export type CatalogRun = z.infer<typeof catalogRunSchema>

export const startCatalogScanInputSchema = z.strictObject({
  sessionId: z.string().min(1).max(256),
  scope: catalogScopeSchema,
})
export type StartCatalogScanInput = z.infer<typeof startCatalogScanInputSchema>

export const catalogStatusSummarySchema = z.strictObject({
  source: catalogSourceSchema,
  activeRun: catalogRunSchema.optional(),
  latestRun: catalogRunSchema.optional(),
  latestSuccessfulRun: catalogRunSchema.optional(),
  counts: z.strictObject({
    assets: z.number().int().nonnegative(),
    fields: z.number().int().nonnegative(),
    needsReview: z.number().int().nonnegative(),
  }),
})
export type CatalogStatusSummary = z.infer<typeof catalogStatusSummarySchema>

export const catalogIdentitySchema = z.strictObject({
  sourceId: z.string().min(1).max(256),
  database: z.string().min(1).max(512),
  schema: z.string().min(1).max(256),
  kind: catalogAssetKindSchema,
  relation: z.string().max(256).optional(),
  name: z.string().min(1).max(256),
})
export type CatalogIdentity = z.infer<typeof catalogIdentitySchema>

export const catalogCapabilitySchema = z.enum(['supported', 'unsupported', 'unavailable'])
export type CatalogCapability = z.infer<typeof catalogCapabilitySchema>

export const catalogTechnicalPayloadSchema = z.strictObject({
  identity: catalogIdentitySchema,
  name: z.string().min(1).max(256),
  path: z.string().min(1).max(1_024),
  parentId: z.string().max(256).optional(),
  objectType: z.enum(['table', 'view']).optional(),
  dataType: z.string().max(512).optional(),
  nullable: z.boolean().optional(),
  ordinal: z.number().int().positive().optional(),
  comment: z.string().max(4_096).optional(),
  referencedAssetIds: z.array(z.string().min(1).max(256)).max(512).optional(),
  attributes: z.record(z.string(), z.union([z.string().max(4_096), z.number(), z.boolean(), z.null()])).optional(),
  capabilities: z.record(z.string(), catalogCapabilitySchema).optional(),
  truncatedFields: z.array(z.string().max(128)).max(64).optional(),
  provenance: z.strictObject({
    source: z.literal('database'),
    dialect: z.enum(DATABASE_TYPES),
    runId: z.string().min(1).max(256),
  }),
})
export type CatalogTechnicalPayload = z.infer<typeof catalogTechnicalPayloadSchema>

export const catalogObservationSchema = z.strictObject({
  runId: z.string().min(1).max(256),
  sourceId: z.string().min(1).max(256),
  assetId: z.string().min(1).max(256),
  status: catalogAssetStatusSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: catalogDateTimeSchema,
  payload: catalogTechnicalPayloadSchema,
})
export type CatalogObservation = z.infer<typeof catalogObservationSchema>

export const catalogAssetRevisionSchema = z.strictObject({
  id: z.string().min(1).max(512),
  assetId: z.string().min(1).max(256),
  sourceId: z.string().min(1).max(256),
  runId: z.string().min(1).max(256),
  revision: z.number().int().positive(),
  status: catalogAssetStatusSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: catalogDateTimeSchema,
  previousRevisionId: z.string().max(512).optional(),
  changeSummary: z.array(z.string().max(256)).max(64),
  payload: catalogTechnicalPayloadSchema,
})
export type CatalogAssetRevision = z.infer<typeof catalogAssetRevisionSchema>

export const catalogAssetHeadSchema = z.strictObject({
  assetId: z.string().min(1).max(256),
  sourceId: z.string().min(1).max(256),
  revisionIds: z.array(z.string().min(1).max(512)).max(10_000),
  firstSeenAt: catalogDateTimeSchema,
  lastSeenAt: catalogDateTimeSchema,
})
export type CatalogAssetHead = z.infer<typeof catalogAssetHeadSchema>

export const catalogRelationSchema = z.strictObject({
  id: z.string().min(1).max(256),
  sourceId: z.string().min(1).max(256),
  runId: z.string().min(1).max(256),
  kind: z.enum(['parent', 'primary_key', 'foreign_key', 'index']),
  fromAssetId: z.string().min(1).max(256),
  toAssetId: z.string().min(1).max(256).optional(),
  name: z.string().max(256).optional(),
  columnAssetIds: z.array(z.string().min(1).max(256)).max(256),
  referencedColumnAssetIds: z.array(z.string().min(1).max(256)).max(256).optional(),
  observedAt: catalogDateTimeSchema,
})
export type CatalogRelation = z.infer<typeof catalogRelationSchema>

const semanticBaseShape = {
  name: z.string().min(1).max(256),
  aliases: z.array(z.string().min(1).max(256)).max(64),
  description: z.string().max(4_096),
  owner: z.string().max(256).optional(),
  sourceAssetIds: z.array(z.string().min(1).max(256)).max(256),
  status: catalogSemanticStatusSchema,
  validFrom: catalogDateTimeSchema.optional(),
  validTo: catalogDateTimeSchema.optional(),
  revisionNote: z.string().max(4_096).optional(),
  verifiedAt: catalogDateTimeSchema.optional(),
  needsReviewReason: z.string().max(4_096).optional(),
  triggerRunId: z.string().max(256).optional(),
} as const

export const termDefinitionSchema = z.strictObject({
  kind: z.literal('term'),
  ...semanticBaseShape,
}).superRefine((definition, issue) => {
  if (definition.validFrom !== undefined && definition.validTo !== undefined
      && definition.validFrom >= definition.validTo) {
    issue.addIssue({ code: 'custom', path: ['validTo'], message: 'validTo must be later than validFrom' })
  }
})
export type TermDefinition = z.infer<typeof termDefinitionSchema>

export const metricDefinitionSchema = z.strictObject({
  kind: z.literal('metric'),
  ...semanticBaseShape,
  formula: z.string().min(1).max(8_192),
  grain: z.string().min(1).max(512),
  timeFieldAssetId: z.string().min(1).max(256).optional(),
  filters: z.array(z.string().max(2_048)).max(64),
  exclusions: z.array(z.string().max(2_048)).max(64),
}).superRefine((definition, issue) => {
  if (definition.validFrom !== undefined && definition.validTo !== undefined
      && definition.validFrom >= definition.validTo) {
    issue.addIssue({ code: 'custom', path: ['validTo'], message: 'validTo must be later than validFrom' })
  }
})
export type MetricDefinition = z.infer<typeof metricDefinitionSchema>

export const meaningDefinitionSchema = z.strictObject({
  kind: z.literal('meaning'),
  ...semanticBaseShape,
  targetAssetId: z.string().min(1).max(256),
  targetKind: z.enum(['table', 'view', 'column']),
  generatedBy: z.strictObject({
    kind: z.literal('ai'),
    provider: z.string().min(1).max(256),
    model: z.string().min(1).max(512),
    runId: z.string().min(1).max(256),
  }),
})
export type MeaningDefinition = z.infer<typeof meaningDefinitionSchema>

export const semanticDefinitionSchema = z.discriminatedUnion('kind', [meaningDefinitionSchema, termDefinitionSchema, metricDefinitionSchema])
export type SemanticDefinition = z.infer<typeof semanticDefinitionSchema>

export const catalogSemanticEntrySchema = z.strictObject({
  id: z.string().min(1).max(256),
  sourceId: z.string().min(1).max(256),
  kind: catalogSemanticKindSchema,
  currentVersion: z.number().int().positive(),
  createdAt: catalogDateTimeSchema,
  updatedAt: catalogDateTimeSchema,
})
export type CatalogSemanticEntry = z.infer<typeof catalogSemanticEntrySchema>

export const catalogSemanticRevisionSchema = z.strictObject({
  id: z.string().min(1).max(512),
  semanticId: z.string().min(1).max(256),
  sourceId: z.string().min(1).max(256),
  version: z.number().int().positive(),
  createdAt: catalogDateTimeSchema,
  definition: semanticDefinitionSchema,
})
export type CatalogSemanticRevision = z.infer<typeof catalogSemanticRevisionSchema>

export const catalogSearchFiltersSchema = z.strictObject({
  sourceId: z.string().min(1).max(256).optional(),
  schema: z.string().min(1).max(256).optional(),
  assetKinds: z.array(catalogAssetKindSchema).max(CATALOG_ASSET_KINDS.length).optional(),
  semanticKinds: z.array(catalogSemanticKindSchema).max(CATALOG_SEMANTIC_KINDS.length).optional(),
  assetStatuses: z.array(catalogAssetStatusSchema).max(CATALOG_ASSET_STATUSES.length).optional(),
  semanticStatuses: z.array(catalogSemanticStatusSchema).max(CATALOG_SEMANTIC_STATUSES.length).optional(),
  includeInferred: z.boolean().default(false),
})
export type CatalogSearchFilters = z.infer<typeof catalogSearchFiltersSchema>

export const catalogSearchRequestSchema = z.strictObject({
  query: z.string().trim().min(1).max(512),
  filters: catalogSearchFiltersSchema.default({ includeInferred: false }),
  cursor: z.string().max(512).optional(),
  pageSize: z.number().int().min(1).max(200).default(50),
})
export type CatalogSearchRequest = z.infer<typeof catalogSearchRequestSchema>

export const catalogSearchItemSchema = z.strictObject({
  id: z.string().min(1).max(256),
  sourceId: z.string().min(1).max(256),
  resultType: z.enum(['asset', 'semantic']),
  kind: z.string().min(1).max(64),
  name: z.string().min(1).max(256),
  path: z.string().max(1_024),
  summary: z.string().max(1_024),
  matchReasons: z.array(z.string().max(128)).max(16),
  status: z.string().min(1).max(64),
  version: z.number().int().positive().optional(),
  provenance: z.enum(['database', 'human', 'inferred']),
  untrusted: z.literal(true),
})
export type CatalogSearchItem = z.infer<typeof catalogSearchItemSchema>

export const catalogSearchPageSchema = z.strictObject({
  sourceId: z.string().min(1).max(256),
  query: z.string().max(512),
  items: z.array(catalogSearchItemSchema).max(200),
  nextCursor: z.string().max(512).optional(),
  truncated: z.boolean(),
  warnings: z.array(z.string().max(512)).max(16),
})
export type CatalogSearchPage = z.infer<typeof catalogSearchPageSchema>

export const catalogAssetDetailSchema = z.strictObject({
  asset: catalogAssetRevisionSchema,
  fields: z.array(catalogAssetRevisionSchema).max(200),
  relations: z.array(catalogRelationSchema).max(200),
  semantics: z.array(catalogSemanticRevisionSchema).max(200),
  history: z.array(catalogAssetRevisionSchema).max(200),
  nextCursor: z.string().max(512).optional(),
  truncated: z.boolean(),
  untrusted: z.literal(true),
})
export type CatalogAssetDetail = z.infer<typeof catalogAssetDetailSchema>

export const catalogDiffItemSchema = z.strictObject({
  kind: catalogDiffKindSchema,
  assetId: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  path: z.string().min(1).max(1_024),
  fromRevisionId: z.string().max(512).optional(),
  toRevisionId: z.string().max(512).optional(),
  summary: z.array(z.string().max(256)).max(64),
})
export type CatalogDiffItem = z.infer<typeof catalogDiffItemSchema>

export const catalogDiffPageSchema = z.strictObject({
  sourceId: z.string().min(1).max(256),
  fromRunId: z.string().min(1).max(256),
  toRunId: z.string().min(1).max(256),
  scope: catalogScopeSchema,
  items: z.array(catalogDiffItemSchema).max(200),
  nextCursor: z.string().max(512).optional(),
  truncated: z.boolean(),
})
export type CatalogDiffPage = z.infer<typeof catalogDiffPageSchema>

export interface CatalogIndexRecord {
  id: string
  sourceId: string
  resultType: 'asset' | 'semantic'
  searchText: string
  searchItem: CatalogSearchItem
  updatedAt: string
}

export interface CatalogIndexState {
  version: 1
  rebuiltAt?: string
}
