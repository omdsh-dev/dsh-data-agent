import { b as DATABASE_TYPES, r as redactSecretText } from "./connections-CFXOZTHZ.js";
import { a as catalogSemanticRevisionId, c as normalizeCatalogIdentifier, i as catalogSemanticId, l as normalizeCatalogText, n as catalogAssetId, o as catalogSourceId, r as catalogRevisionId, s as catalogTechnicalFingerprint, t as canonicalCatalogIdentity, u as stableJson } from "./catalog-identity-CVftmvQL.js";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { z } from "zod";
//#region src/catalog-types.ts
/**
* Surface-neutral Catalog contracts. This module contains no Node or browser
* runtime dependencies beyond Zod and can therefore be imported type-only by
* the Web bundle.
* @module @yejiming/dsh-data-agent/catalog-types
*/
const catalogDateTimeSchema = z.iso.datetime();
const catalogRunStatusSchema = z.enum([
	"queued",
	"running",
	"applying",
	"succeeded",
	"failed",
	"cancelled",
	"interrupted"
]);
const CATALOG_ASSET_STATUSES = [
	"observed",
	"missing",
	"unavailable"
];
const catalogAssetStatusSchema = z.enum(CATALOG_ASSET_STATUSES);
const CATALOG_ASSET_KINDS = [
	"schema",
	"table",
	"view",
	"column",
	"primary_key",
	"foreign_key",
	"index"
];
const catalogAssetKindSchema = z.enum(CATALOG_ASSET_KINDS);
const catalogEnrichmentStatusSchema = z.enum([
	"queued",
	"running",
	"succeeded",
	"partial",
	"failed",
	"cancelled"
]);
const CATALOG_SEMANTIC_KINDS = [
	"meaning",
	"term",
	"metric"
];
const catalogSemanticKindSchema = z.enum(CATALOG_SEMANTIC_KINDS);
const CATALOG_SEMANTIC_STATUSES = [
	"inferred",
	"verified",
	"needs_review",
	"retired"
];
const catalogSemanticStatusSchema = z.enum(CATALOG_SEMANTIC_STATUSES);
const catalogDiffKindSchema = z.enum([
	"added",
	"changed",
	"missing",
	"restored",
	"unavailable"
]);
const catalogScopeSchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("source") }),
	z.strictObject({
		kind: z.literal("schema"),
		schema: z.string().min(1).max(256)
	}),
	z.strictObject({
		kind: z.literal("table"),
		schema: z.string().min(1).max(256),
		table: z.string().min(1).max(256)
	})
]);
const catalogSourceSchema = z.strictObject({
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
	lastPartialScanAt: catalogDateTimeSchema.optional()
});
const catalogProgressSchema = z.strictObject({
	schemas: z.number().int().nonnegative(),
	relations: z.number().int().nonnegative(),
	fields: z.number().int().nonnegative(),
	assets: z.number().int().nonnegative()
});
const catalogEnrichmentSchema = z.strictObject({
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
	error: z.string().max(4096).optional()
});
const catalogRunSchema = z.strictObject({
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
	error: z.string().max(4096).optional(),
	enrichment: catalogEnrichmentSchema.optional()
});
const startCatalogScanInputSchema = z.strictObject({
	sessionId: z.string().min(1).max(256),
	scope: catalogScopeSchema
});
z.strictObject({
	source: catalogSourceSchema,
	activeRun: catalogRunSchema.optional(),
	latestRun: catalogRunSchema.optional(),
	latestSuccessfulRun: catalogRunSchema.optional(),
	counts: z.strictObject({
		assets: z.number().int().nonnegative(),
		fields: z.number().int().nonnegative(),
		needsReview: z.number().int().nonnegative()
	})
});
const catalogIdentitySchema = z.strictObject({
	sourceId: z.string().min(1).max(256),
	database: z.string().min(1).max(512),
	schema: z.string().min(1).max(256),
	kind: catalogAssetKindSchema,
	relation: z.string().max(256).optional(),
	name: z.string().min(1).max(256)
});
const catalogCapabilitySchema = z.enum([
	"supported",
	"unsupported",
	"unavailable"
]);
const catalogTechnicalPayloadSchema = z.strictObject({
	identity: catalogIdentitySchema,
	name: z.string().min(1).max(256),
	path: z.string().min(1).max(1024),
	parentId: z.string().max(256).optional(),
	objectType: z.enum(["table", "view"]).optional(),
	dataType: z.string().max(512).optional(),
	nullable: z.boolean().optional(),
	ordinal: z.number().int().positive().optional(),
	comment: z.string().max(4096).optional(),
	referencedAssetIds: z.array(z.string().min(1).max(256)).max(512).optional(),
	attributes: z.record(z.string(), z.union([
		z.string().max(4096),
		z.number(),
		z.boolean(),
		z.null()
	])).optional(),
	capabilities: z.record(z.string(), catalogCapabilitySchema).optional(),
	truncatedFields: z.array(z.string().max(128)).max(64).optional(),
	provenance: z.strictObject({
		source: z.literal("database"),
		dialect: z.enum(DATABASE_TYPES),
		runId: z.string().min(1).max(256)
	})
});
const catalogObservationSchema = z.strictObject({
	runId: z.string().min(1).max(256),
	sourceId: z.string().min(1).max(256),
	assetId: z.string().min(1).max(256),
	status: catalogAssetStatusSchema,
	fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
	observedAt: catalogDateTimeSchema,
	payload: catalogTechnicalPayloadSchema
});
const catalogAssetRevisionSchema = z.strictObject({
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
	payload: catalogTechnicalPayloadSchema
});
const catalogAssetHeadSchema = z.strictObject({
	assetId: z.string().min(1).max(256),
	sourceId: z.string().min(1).max(256),
	revisionIds: z.array(z.string().min(1).max(512)).max(1e4),
	firstSeenAt: catalogDateTimeSchema,
	lastSeenAt: catalogDateTimeSchema
});
const catalogRelationSchema = z.strictObject({
	id: z.string().min(1).max(256),
	sourceId: z.string().min(1).max(256),
	runId: z.string().min(1).max(256),
	kind: z.enum([
		"parent",
		"primary_key",
		"foreign_key",
		"index"
	]),
	fromAssetId: z.string().min(1).max(256),
	toAssetId: z.string().min(1).max(256).optional(),
	name: z.string().max(256).optional(),
	columnAssetIds: z.array(z.string().min(1).max(256)).max(256),
	referencedColumnAssetIds: z.array(z.string().min(1).max(256)).max(256).optional(),
	observedAt: catalogDateTimeSchema
});
const semanticBaseShape = {
	name: z.string().min(1).max(256),
	aliases: z.array(z.string().min(1).max(256)).max(64),
	description: z.string().max(4096),
	owner: z.string().max(256).optional(),
	sourceAssetIds: z.array(z.string().min(1).max(256)).max(256),
	status: catalogSemanticStatusSchema,
	validFrom: catalogDateTimeSchema.optional(),
	validTo: catalogDateTimeSchema.optional(),
	revisionNote: z.string().max(4096).optional(),
	verifiedAt: catalogDateTimeSchema.optional(),
	needsReviewReason: z.string().max(4096).optional(),
	triggerRunId: z.string().max(256).optional()
};
const termDefinitionSchema = z.strictObject({
	kind: z.literal("term"),
	...semanticBaseShape
}).superRefine((definition, issue) => {
	if (definition.validFrom !== void 0 && definition.validTo !== void 0 && definition.validFrom >= definition.validTo) issue.addIssue({
		code: "custom",
		path: ["validTo"],
		message: "validTo must be later than validFrom"
	});
});
const metricDefinitionSchema = z.strictObject({
	kind: z.literal("metric"),
	...semanticBaseShape,
	formula: z.string().min(1).max(8192),
	grain: z.string().min(1).max(512),
	timeFieldAssetId: z.string().min(1).max(256).optional(),
	filters: z.array(z.string().max(2048)).max(64),
	exclusions: z.array(z.string().max(2048)).max(64)
}).superRefine((definition, issue) => {
	if (definition.validFrom !== void 0 && definition.validTo !== void 0 && definition.validFrom >= definition.validTo) issue.addIssue({
		code: "custom",
		path: ["validTo"],
		message: "validTo must be later than validFrom"
	});
});
const meaningDefinitionSchema = z.strictObject({
	kind: z.literal("meaning"),
	...semanticBaseShape,
	targetAssetId: z.string().min(1).max(256),
	targetKind: z.enum([
		"table",
		"view",
		"column"
	]),
	generatedBy: z.strictObject({
		kind: z.literal("ai"),
		provider: z.string().min(1).max(256),
		model: z.string().min(1).max(512),
		runId: z.string().min(1).max(256)
	})
});
const semanticDefinitionSchema = z.discriminatedUnion("kind", [
	meaningDefinitionSchema,
	termDefinitionSchema,
	metricDefinitionSchema
]);
const catalogSemanticEntrySchema = z.strictObject({
	id: z.string().min(1).max(256),
	sourceId: z.string().min(1).max(256),
	kind: catalogSemanticKindSchema,
	currentVersion: z.number().int().positive(),
	createdAt: catalogDateTimeSchema,
	updatedAt: catalogDateTimeSchema
});
const catalogSemanticRevisionSchema = z.strictObject({
	id: z.string().min(1).max(512),
	semanticId: z.string().min(1).max(256),
	sourceId: z.string().min(1).max(256),
	version: z.number().int().positive(),
	createdAt: catalogDateTimeSchema,
	definition: semanticDefinitionSchema
});
const catalogSearchFiltersSchema = z.strictObject({
	sourceId: z.string().min(1).max(256).optional(),
	schema: z.string().min(1).max(256).optional(),
	assetKinds: z.array(catalogAssetKindSchema).max(CATALOG_ASSET_KINDS.length).optional(),
	semanticKinds: z.array(catalogSemanticKindSchema).max(CATALOG_SEMANTIC_KINDS.length).optional(),
	assetStatuses: z.array(catalogAssetStatusSchema).max(CATALOG_ASSET_STATUSES.length).optional(),
	semanticStatuses: z.array(catalogSemanticStatusSchema).max(CATALOG_SEMANTIC_STATUSES.length).optional(),
	includeInferred: z.boolean().default(false)
});
const catalogSearchRequestSchema = z.strictObject({
	query: z.string().trim().min(1).max(512),
	filters: catalogSearchFiltersSchema.default({ includeInferred: false }),
	cursor: z.string().max(512).optional(),
	pageSize: z.number().int().min(1).max(200).default(50)
});
const catalogSearchItemSchema = z.strictObject({
	id: z.string().min(1).max(256),
	sourceId: z.string().min(1).max(256),
	resultType: z.enum(["asset", "semantic"]),
	kind: z.string().min(1).max(64),
	name: z.string().min(1).max(256),
	path: z.string().max(1024),
	summary: z.string().max(1024),
	matchReasons: z.array(z.string().max(128)).max(16),
	status: z.string().min(1).max(64),
	version: z.number().int().positive().optional(),
	provenance: z.enum([
		"database",
		"human",
		"inferred"
	]),
	untrusted: z.literal(true)
});
z.strictObject({
	sourceId: z.string().min(1).max(256),
	query: z.string().max(512),
	items: z.array(catalogSearchItemSchema).max(200),
	nextCursor: z.string().max(512).optional(),
	truncated: z.boolean(),
	warnings: z.array(z.string().max(512)).max(16)
});
z.strictObject({
	asset: catalogAssetRevisionSchema,
	fields: z.array(catalogAssetRevisionSchema).max(200),
	relations: z.array(catalogRelationSchema).max(200),
	semantics: z.array(catalogSemanticRevisionSchema).max(200),
	history: z.array(catalogAssetRevisionSchema).max(200),
	nextCursor: z.string().max(512).optional(),
	truncated: z.boolean(),
	untrusted: z.literal(true)
});
const catalogDiffItemSchema = z.strictObject({
	kind: catalogDiffKindSchema,
	assetId: z.string().min(1).max(256),
	name: z.string().min(1).max(256),
	path: z.string().min(1).max(1024),
	fromRevisionId: z.string().max(512).optional(),
	toRevisionId: z.string().max(512).optional(),
	summary: z.array(z.string().max(256)).max(64)
});
z.strictObject({
	sourceId: z.string().min(1).max(256),
	fromRunId: z.string().min(1).max(256),
	toRunId: z.string().min(1).max(256),
	scope: catalogScopeSchema,
	items: z.array(catalogDiffItemSchema).max(200),
	nextCursor: z.string().max(512).optional(),
	truncated: z.boolean()
});
//#endregion
//#region src/catalog-adapters.ts
const ACCESS_DENIED = /access denied|permission denied|not authorized|insufficient privilege|ora-01031|authorizationexception/i;
/** Registry contains an explicit adapter entry for every supported dialect. */
function createCatalogAdapterRegistry() {
	return {
		mysql: richAdapter("mysql"),
		doris: richAdapter("doris"),
		postgres: richAdapter("postgres"),
		sqlserver: richAdapter("sqlserver"),
		sqlite: richAdapter("sqlite"),
		oracle: richAdapter("oracle"),
		clickhouse: richAdapter("clickhouse"),
		hive: describeAdapter("hive"),
		impala: describeAdapter("impala")
	};
}
function richAdapter(type) {
	return {
		type,
		capabilities: {
			schemas: "supported",
			tables: "supported",
			views: "supported",
			columns: "supported",
			comments: type === "sqlite" ? "unsupported" : "supported",
			...{
				mysql: {
					primaryKeys: "supported",
					foreignKeys: "supported",
					indexes: "supported"
				},
				doris: {
					primaryKeys: "unsupported",
					foreignKeys: "unsupported",
					indexes: "unsupported"
				},
				postgres: {
					primaryKeys: "supported",
					foreignKeys: "supported",
					indexes: "supported"
				},
				sqlserver: {
					primaryKeys: "supported",
					foreignKeys: "supported",
					indexes: "supported"
				},
				sqlite: {
					primaryKeys: "supported",
					foreignKeys: "supported",
					indexes: "supported"
				},
				oracle: {
					primaryKeys: "supported",
					foreignKeys: "supported",
					indexes: "supported"
				},
				clickhouse: {
					primaryKeys: "supported",
					foreignKeys: "unsupported",
					indexes: "supported"
				}
			}[type]
		},
		async scan(context) {
			const scanned = await mapLimit(await scopedSchemas(context), context.options.schemaConcurrency, async (schema) => {
				context.signal.throwIfAborted();
				context.onProgress?.("schema");
				try {
					const sql = buildCatalogMetadataSql(type, context.connection.database, schema, tableName(context.scope));
					const result = await context.connections.queryMetadata(context.sessionId, sql, context.signal);
					if (result.truncated) throw new Error("Catalog metadata output exceeded catalogMaxResultChars; narrow the scan scope or increase the Catalog metadata limit");
					const built = observationsFromRows(context, schema, parseCatalogMetadataRows(type, result.stdout));
					return {
						observations: [observationForSchema(context, schema, "observed"), ...built.observations],
						relations: built.relations,
						unavailableScope: void 0
					};
				} catch (error) {
					if (!ACCESS_DENIED.test(error instanceof Error ? error.message : String(error))) throw error;
					return {
						observations: [observationForSchema(context, schema, "unavailable")],
						unavailableScope: schema
					};
				}
			}, context.signal);
			const observations = scanned.flatMap((value) => value.observations);
			const relations = scanned.flatMap((value) => value.relations ?? []);
			const unavailableScopes = scanned.flatMap((value) => value.unavailableScope === void 0 ? [] : [value.unavailableScope]);
			return {
				observations: dedupeObservations(observations),
				relations: dedupeRelations(relations),
				coverageComplete: unavailableScopes.length === 0,
				unavailableScopes
			};
		}
	};
}
function describeAdapter(type) {
	return {
		type,
		capabilities: {
			schemas: "supported",
			tables: "supported",
			views: "unavailable",
			columns: "supported",
			comments: "supported",
			primaryKeys: "unsupported",
			foreignKeys: "unsupported",
			indexes: "unsupported"
		},
		async scan(context) {
			const scanned = await mapLimit(await scopedSchemas(context), context.options.schemaConcurrency, async (schema) => {
				context.signal.throwIfAborted();
				context.onProgress?.("schema");
				let relations;
				try {
					relations = context.scope.kind === "table" ? [context.scope.table] : await context.connections.listTables(context.sessionId, schema, context.signal);
				} catch (error) {
					if (!ACCESS_DENIED.test(error instanceof Error ? error.message : String(error))) throw error;
					return {
						observations: [observationForSchema(context, schema, "unavailable")],
						unavailableScopes: [schema]
					};
				}
				const relationDetails = await mapLimit(relations, context.options.assetConcurrency, async (relation) => {
					context.signal.throwIfAborted();
					context.onProgress?.("relation");
					try {
						const columns = await context.connections.describe(context.sessionId, schema, relation, context.signal);
						return {
							observations: [observationForRelation(context, schema, relation, "table", "", "observed"), ...columns.map((column, index) => {
								const observation = observationForColumn(context, schema, relation, "table", column.name, column.type, column.nullable, "", index + 1);
								context.onProgress?.("field");
								return observation;
							})],
							unavailableScope: void 0
						};
					} catch (error) {
						if (!ACCESS_DENIED.test(error instanceof Error ? error.message : String(error))) throw error;
						return {
							observations: [observationForRelation(context, schema, relation, "table", "", "unavailable")],
							unavailableScope: `${schema}.${relation}`
						};
					}
				}, context.signal);
				const detailUnavailable = relationDetails.flatMap((value) => value.unavailableScope === void 0 ? [] : [value.unavailableScope]);
				return {
					observations: [observationForSchema(context, schema, "observed"), ...relationDetails.flatMap((value) => value.observations)],
					unavailableScopes: detailUnavailable
				};
			}, context.signal);
			const observations = scanned.flatMap((value) => value.observations);
			const unavailableScopes = scanned.flatMap((value) => value.unavailableScopes);
			return {
				observations: dedupeObservations(observations),
				relations: [],
				coverageComplete: unavailableScopes.length === 0,
				unavailableScopes
			};
		}
	};
}
async function scopedSchemas(context) {
	if (context.scope.kind !== "source") return [context.scope.schema];
	return context.connections.listSchemas(context.sessionId, context.signal);
}
function tableName(scope) {
	return scope.kind === "table" ? scope.table : void 0;
}
function catalogDatabase(context) {
	if (context.connection.type !== "sqlite") return context.connection.database;
	return context.connection.database.split(/[\\/]/).filter(Boolean).at(-1) ?? context.connection.database;
}
/** Pure SQL constructor used by fixture tests; values are SQL literals, never identifiers. */
function buildCatalogMetadataSql(type, database, schema, table) {
	const schemaValue = sqlLiteral(schema);
	const tableFilter = (column) => table === void 0 ? "" : ` AND ${column}=${sqlLiteral(table)}`;
	switch (type) {
		case "mysql":
		case "doris": return [
			"SELECT 'relation' AS row_kind, TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, COALESCE(TABLE_COMMENT,''), '', '', '', '', '0'",
			`FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=${schemaValue}${tableFilter("TABLE_NAME")}`,
			"UNION ALL",
			"SELECT 'column', TABLE_SCHEMA, TABLE_NAME, '', '', COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COALESCE(COLUMN_COMMENT,''), CAST(ORDINAL_POSITION AS CHAR)",
			`FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=${schemaValue}${tableFilter("TABLE_NAME")}`,
			...type === "mysql" ? [
				"UNION ALL",
				"SELECT CASE tc.CONSTRAINT_TYPE WHEN 'PRIMARY KEY' THEN 'primary_key' ELSE 'foreign_key' END, k.TABLE_SCHEMA, k.TABLE_NAME, k.CONSTRAINT_NAME, COALESCE(k.REFERENCED_TABLE_SCHEMA,''), k.COLUMN_NAME, COALESCE(k.REFERENCED_TABLE_NAME,''), COALESCE(k.REFERENCED_COLUMN_NAME,''), '', CAST(k.ORDINAL_POSITION AS CHAR)",
				"FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k ON k.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND k.TABLE_NAME=tc.TABLE_NAME AND k.CONSTRAINT_NAME=tc.CONSTRAINT_NAME",
				`WHERE k.TABLE_SCHEMA=${schemaValue} AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY','FOREIGN KEY')${tableFilter("k.TABLE_NAME")}`,
				"UNION ALL",
				"SELECT 'index', TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, '', COALESCE(COLUMN_NAME,''), '', '', CASE NON_UNIQUE WHEN 0 THEN 'unique' ELSE '' END, CAST(SEQ_IN_INDEX AS CHAR)",
				`FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=${schemaValue} AND INDEX_NAME <> 'PRIMARY'${tableFilter("TABLE_NAME")}`
			] : [],
			"ORDER BY 2,3,1,10;"
		].join(" ");
		case "postgres": return [
			"SELECT 'relation', n.nspname, c.relname, CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'VIEW' ELSE 'BASE TABLE' END, COALESCE(obj_description(c.oid),'') , '', '', '', '', '0'",
			"FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace",
			`WHERE n.nspname=${schemaValue} AND c.relkind IN ('r','p','v','m')${tableFilter("c.relname")}`,
			"UNION ALL",
			"SELECT 'column', n.nspname, c.relname, '', '', a.attname, pg_catalog.format_type(a.atttypid,a.atttypmod), CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END, COALESCE(col_description(c.oid,a.attnum),''), a.attnum::text",
			"FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace",
			`WHERE n.nspname=${schemaValue} AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped${tableFilter("c.relname")}`,
			"UNION ALL",
			"SELECT CASE con.contype WHEN 'p' THEN 'primary_key' ELSE 'foreign_key' END, n.nspname, c.relname, con.conname, COALESCE(rn.nspname,''), a.attname, COALESCE(rc.relname,''), COALESCE(ra.attname,''), '', ord.n::text",
			"FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class c ON c.oid=con.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN LATERAL unnest(con.conkey) WITH ORDINALITY ord(attnum,n) ON true JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=ord.attnum LEFT JOIN pg_catalog.pg_class rc ON rc.oid=con.confrelid LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid=rc.relnamespace LEFT JOIN pg_catalog.pg_attribute ra ON ra.attrelid=rc.oid AND ra.attnum=con.confkey[ord.n]",
			`WHERE n.nspname=${schemaValue} AND con.contype IN ('p','f')${tableFilter("c.relname")}`,
			"UNION ALL",
			"SELECT 'index', n.nspname, c.relname, i.relname, '', a.attname, '', '', CASE ix.indisunique WHEN true THEN 'unique' ELSE '' END, ord.n::text",
			"FROM pg_catalog.pg_index ix JOIN pg_catalog.pg_class c ON c.oid=ix.indrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_class i ON i.oid=ix.indexrelid JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY ord(attnum,n) ON true LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=ord.attnum",
			`WHERE n.nspname=${schemaValue} AND NOT ix.indisprimary${tableFilter("c.relname")}`,
			"ORDER BY 2,3,1,10;"
		].join(" ");
		case "sqlserver": return [
			"SELECT 'relation', s.name, o.name, CASE WHEN o.type='V' THEN 'VIEW' ELSE 'BASE TABLE' END, COALESCE(CAST(ep.value AS nvarchar(4000)),''), '', '', '', '', '0'",
			"FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id LEFT JOIN sys.extended_properties ep ON ep.major_id=o.object_id AND ep.minor_id=0 AND ep.name='MS_Description'",
			`WHERE s.name=${schemaValue} AND o.type IN ('U','V')${tableFilter("o.name")}`,
			"UNION ALL",
			"SELECT 'column', s.name, o.name, '', '', c.name, ty.name, CASE WHEN c.is_nullable=1 THEN 'YES' ELSE 'NO' END, COALESCE(CAST(ep.value AS nvarchar(4000)),''), CAST(c.column_id AS nvarchar(20))",
			"FROM sys.columns c JOIN sys.objects o ON o.object_id=c.object_id JOIN sys.schemas s ON s.schema_id=o.schema_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id LEFT JOIN sys.extended_properties ep ON ep.major_id=o.object_id AND ep.minor_id=c.column_id AND ep.name='MS_Description'",
			`WHERE s.name=${schemaValue} AND o.type IN ('U','V')${tableFilter("o.name")}`,
			"UNION ALL",
			"SELECT 'primary_key', s.name, o.name, kc.name, '', c.name, '', '', '', CAST(ic.key_ordinal AS nvarchar(20))",
			"FROM sys.key_constraints kc JOIN sys.objects o ON o.object_id=kc.parent_object_id JOIN sys.schemas s ON s.schema_id=o.schema_id JOIN sys.index_columns ic ON ic.object_id=o.object_id AND ic.index_id=kc.unique_index_id JOIN sys.columns c ON c.object_id=o.object_id AND c.column_id=ic.column_id",
			`WHERE s.name=${schemaValue} AND kc.type='PK'${tableFilter("o.name")}`,
			"UNION ALL",
			"SELECT 'foreign_key', s.name, o.name, fk.name, rs.name, c.name, ro.name, rc.name, '', CAST(fkc.constraint_column_id AS nvarchar(20))",
			"FROM sys.foreign_key_columns fkc JOIN sys.foreign_keys fk ON fk.object_id=fkc.constraint_object_id JOIN sys.objects o ON o.object_id=fkc.parent_object_id JOIN sys.schemas s ON s.schema_id=o.schema_id JOIN sys.columns c ON c.object_id=o.object_id AND c.column_id=fkc.parent_column_id JOIN sys.objects ro ON ro.object_id=fkc.referenced_object_id JOIN sys.schemas rs ON rs.schema_id=ro.schema_id JOIN sys.columns rc ON rc.object_id=fkc.referenced_object_id AND rc.column_id=fkc.referenced_column_id",
			`WHERE s.name=${schemaValue}${tableFilter("o.name")}`,
			"UNION ALL",
			"SELECT 'index', s.name, o.name, i.name, '', c.name, '', '', CASE WHEN i.is_unique=1 THEN 'unique' ELSE '' END, CAST(ic.key_ordinal AS nvarchar(20))",
			"FROM sys.indexes i JOIN sys.objects o ON o.object_id=i.object_id JOIN sys.schemas s ON s.schema_id=o.schema_id JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON c.object_id=o.object_id AND c.column_id=ic.column_id",
			`WHERE s.name=${schemaValue} AND o.type='U' AND i.is_primary_key=0 AND i.is_hypothetical=0${tableFilter("o.name")}`,
			"ORDER BY 2,3,1,10;"
		].join(" ");
		case "sqlite": return [
			"SELECT 'relation', 'main', m.name, CASE m.type WHEN 'view' THEN 'VIEW' ELSE 'BASE TABLE' END, '', '', '', '', '', '0'",
			`FROM sqlite_master m WHERE m.type IN ('table','view') AND m.name NOT LIKE 'sqlite_%'${tableFilter("m.name")}`,
			"UNION ALL",
			"SELECT 'column', 'main', m.name, '', '', p.name, p.type, CASE p.[notnull] WHEN 1 THEN 'NO' ELSE 'YES' END, '', CAST(p.cid + 1 AS TEXT)",
			`FROM sqlite_master m JOIN pragma_table_xinfo(m.name) p WHERE m.type IN ('table','view') AND m.name NOT LIKE 'sqlite_%'${tableFilter("m.name")}`,
			"UNION ALL",
			"SELECT 'primary_key', 'main', m.name, 'PRIMARY', '', p.name, '', '', '', CAST(p.pk AS TEXT)",
			`FROM sqlite_master m JOIN pragma_table_xinfo(m.name) p WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%' AND p.pk>0${tableFilter("m.name")}`,
			"UNION ALL",
			"SELECT 'foreign_key', 'main', m.name, 'fk_' || f.id, 'main', f.[from], f.[table], f.[to], '', CAST(f.seq + 1 AS TEXT)",
			`FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%'${tableFilter("m.name")}`,
			"UNION ALL",
			"SELECT 'index', 'main', m.name, il.name, '', ii.name, '', '', CASE il.[unique] WHEN 1 THEN 'unique' ELSE '' END, CAST(ii.seqno + 1 AS TEXT)",
			`FROM sqlite_master m JOIN pragma_index_list(m.name) il JOIN pragma_index_info(il.name) ii WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%' AND il.origin <> 'pk'${tableFilter("m.name")}`,
			"ORDER BY 2,3,1,10;"
		].join(" ");
		case "oracle": {
			const owner = sqlLiteral(schema.toUpperCase());
			return [
				"SELECT 'relation', o.owner, o.object_name, CASE o.object_type WHEN 'VIEW' THEN 'VIEW' ELSE 'BASE TABLE' END, NVL(tc.comments,''), '', '', '', '', '0'",
				"FROM all_objects o LEFT JOIN all_tab_comments tc ON tc.owner=o.owner AND tc.table_name=o.object_name",
				`WHERE o.owner=${owner} AND o.object_type IN ('TABLE','VIEW')${tableFilter("o.object_name")}`,
				"UNION ALL",
				"SELECT 'column', c.owner, c.table_name, '', '', c.column_name, c.data_type, c.nullable, NVL(cc.comments,''), TO_CHAR(c.column_id)",
				"FROM all_tab_columns c LEFT JOIN all_col_comments cc ON cc.owner=c.owner AND cc.table_name=c.table_name AND cc.column_name=c.column_name",
				`WHERE c.owner=${owner}${tableFilter("c.table_name")}`,
				"UNION ALL",
				"SELECT CASE ac.constraint_type WHEN 'P' THEN 'primary_key' ELSE 'foreign_key' END, ac.owner, ac.table_name, ac.constraint_name, NVL(rac.owner,''), acc.column_name, NVL(rac.table_name,''), NVL(racc.column_name,''), '', TO_CHAR(acc.position)",
				"FROM all_constraints ac JOIN all_cons_columns acc ON acc.owner=ac.owner AND acc.constraint_name=ac.constraint_name LEFT JOIN all_constraints rac ON rac.owner=ac.r_owner AND rac.constraint_name=ac.r_constraint_name LEFT JOIN all_cons_columns racc ON racc.owner=rac.owner AND racc.constraint_name=rac.constraint_name AND racc.position=acc.position",
				`WHERE ac.owner=${owner} AND ac.constraint_type IN ('P','R')${tableFilter("ac.table_name")}`,
				"UNION ALL",
				"SELECT 'index', i.table_owner, i.table_name, i.index_name, '', ic.column_name, '', '', CASE i.uniqueness WHEN 'UNIQUE' THEN 'unique' ELSE '' END, TO_CHAR(ic.column_position)",
				"FROM all_indexes i JOIN all_ind_columns ic ON ic.index_owner=i.owner AND ic.index_name=i.index_name",
				`WHERE i.table_owner=${owner} AND NOT EXISTS (SELECT 1 FROM all_constraints c WHERE c.owner=i.table_owner AND c.table_name=i.table_name AND c.index_name=i.index_name AND c.constraint_type='P')${tableFilter("i.table_name")}`,
				"ORDER BY 2,3,1,10;"
			].join(" ");
		}
		case "clickhouse": return [
			"SELECT 'relation', database, name, CASE WHEN engine='View' OR engine='MaterializedView' THEN 'VIEW' ELSE 'BASE TABLE' END, comment, '', '', '', '', '0'",
			`FROM system.tables WHERE database=${schemaValue}${tableFilter("name")}`,
			"UNION ALL",
			"SELECT 'column', database, table, '', '', name, type, if(startsWith(type,'Nullable('),'YES','NO'), comment, toString(position)",
			`FROM system.columns WHERE database=${schemaValue}${tableFilter("table")}`,
			"UNION ALL",
			"SELECT 'primary_key', database, name, concat('PRIMARY ',substring(primary_key,1,200)), '', '', '', '', '', '0'",
			`FROM system.tables WHERE database=${schemaValue} AND primary_key != ''${tableFilter("name")}`,
			"UNION ALL",
			"SELECT 'index', database, name, concat('ORDER BY ',substring(sorting_key,1,200)), '', '', '', '', '', '0'",
			`FROM system.tables WHERE database=${schemaValue} AND sorting_key != ''${tableFilter("name")}`,
			"ORDER BY 2,3,1,10;"
		].join(" ");
	}
}
function parseCatalogMetadataRows(type, stdout) {
	const delimiter = type === "sqlserver" ? "" : type === "oracle" || type === "postgres" || type === "sqlite" ? "|" : "	";
	const lines = stdout.replace(/\r\n?/g, "\n").split("\n").filter((line) => line.trim().length > 0);
	const start = type === "mysql" || type === "doris" ? 1 : 0;
	const rows = [];
	for (const line of lines.slice(start)) {
		const fields = line.split(delimiter).map((value) => value.trim());
		if (fields.length < 10 || ![
			"relation",
			"column",
			"primary_key",
			"foreign_key",
			"index"
		].includes(fields[0])) continue;
		rows.push({
			rowKind: fields[0],
			schema: fields[1] ?? "",
			relation: fields[2] ?? "",
			relationType: fields[3] ?? "",
			relationComment: fields[4] ?? "",
			column: fields[5] ?? "",
			dataType: fields[6] ?? "",
			nullable: fields[7] ?? "",
			columnComment: fields[8] ?? "",
			ordinal: fields[9] ?? ""
		});
	}
	return rows;
}
function observationsFromRows(context, fallbackSchema, rows) {
	const observations = [];
	const relationTypes = /* @__PURE__ */ new Map();
	for (const row of rows) {
		if (row.rowKind !== "relation" || row.relation.length === 0) continue;
		const schema = row.schema || fallbackSchema;
		relationTypes.set(`${schema}\0${row.relation}`, /view/i.test(row.relationType) ? "view" : "table");
	}
	for (const row of rows) {
		const schema = row.schema || fallbackSchema;
		if (row.relation.length === 0) continue;
		if (row.rowKind === "relation") {
			const objectType = relationTypes.get(`${schema}\0${row.relation}`) ?? "table";
			observations.push(observationForRelation(context, schema, row.relation, objectType, row.relationComment, "observed"));
			context.onProgress?.("relation");
			continue;
		}
		if (row.rowKind !== "column" || row.column.length === 0) continue;
		observations.push(observationForColumn(context, schema, row.relation, relationTypes.get(`${schema}\0${row.relation}`) ?? "table", row.column, row.dataType, parseNullable(row.nullable), row.columnComment, Number.parseInt(row.ordinal, 10) || void 0));
		context.onProgress?.("field");
	}
	const grouped = /* @__PURE__ */ new Map();
	for (const row of rows) {
		if (row.rowKind === "relation" || row.rowKind === "column") continue;
		const schema = row.schema || fallbackSchema;
		if (row.relation.length === 0 || row.relationType.length === 0) continue;
		const key = [
			row.rowKind,
			schema,
			row.relation,
			row.relationType,
			row.relationComment,
			row.dataType
		].join("\0");
		const values = grouped.get(key) ?? [];
		values.push(row);
		grouped.set(key, values);
	}
	return {
		observations,
		relations: [...grouped.values()].map((group) => relationFromRows(context, fallbackSchema, group))
	};
}
function relationFromRows(context, fallbackSchema, rows) {
	const first = rows[0];
	if (first.rowKind === "relation" || first.rowKind === "column") throw new Error("Catalog relation grouping received a non-relation metadata row");
	const schema = first.schema || fallbackSchema;
	const fromIdentity = {
		sourceId: context.sourceId,
		database: catalogDatabase(context),
		schema,
		kind: "table",
		name: first.relation
	};
	const fromAssetId = catalogAssetId(context.connection.type, fromIdentity);
	const sorted = [...rows].sort((a, b) => (Number.parseInt(a.ordinal, 10) || 0) - (Number.parseInt(b.ordinal, 10) || 0));
	const columnAssetIds = sorted.flatMap((row) => row.column.length === 0 ? [] : [catalogAssetId(context.connection.type, {
		...fromIdentity,
		relation: first.relation,
		kind: "column",
		name: row.column
	})]);
	const referencedSchema = first.relationComment || schema;
	const referencedRelation = first.dataType;
	const toAssetId = first.rowKind === "foreign_key" && referencedRelation.length > 0 ? catalogAssetId(context.connection.type, {
		sourceId: context.sourceId,
		database: catalogDatabase(context),
		schema: referencedSchema,
		kind: "table",
		name: referencedRelation
	}) : void 0;
	const referencedColumnAssetIds = first.rowKind === "foreign_key" && referencedRelation.length > 0 ? sorted.flatMap((row) => row.nullable.length === 0 ? [] : [catalogAssetId(context.connection.type, {
		sourceId: context.sourceId,
		database: catalogDatabase(context),
		schema: referencedSchema,
		relation: referencedRelation,
		kind: "column",
		name: row.nullable
	})]) : void 0;
	const name = normalizeCatalogText(first.relationType, 256).value;
	return {
		id: `relation_${createHash("sha256").update(stableJson({
			sourceId: context.sourceId,
			kind: first.rowKind,
			fromAssetId,
			toAssetId,
			name
		})).digest("hex").slice(0, 32)}`,
		sourceId: context.sourceId,
		runId: context.runId,
		kind: first.rowKind,
		fromAssetId,
		...toAssetId !== void 0 ? { toAssetId } : {},
		name,
		columnAssetIds,
		...referencedColumnAssetIds !== void 0 ? { referencedColumnAssetIds } : {},
		observedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
}
function observationForSchema(context, schema, status) {
	return makeObservation(context, {
		sourceId: context.sourceId,
		database: catalogDatabase(context),
		schema,
		kind: "schema",
		name: schema
	}, {
		name: schema,
		path: `${catalogDatabase(context)}.${schema}`,
		capabilities: contextCapabilities(context)
	}, status);
}
function observationForRelation(context, schema, relation, objectType, rawComment, status) {
	const schemaIdentity = {
		sourceId: context.sourceId,
		database: catalogDatabase(context),
		schema,
		kind: "schema",
		name: schema
	};
	const comment = normalizeCatalogText(rawComment, context.options.maxTextChars);
	return makeObservation(context, {
		sourceId: context.sourceId,
		database: catalogDatabase(context),
		schema,
		kind: objectType,
		name: relation
	}, {
		name: relation,
		path: `${catalogDatabase(context)}.${schema}.${relation}`,
		parentId: catalogAssetId(context.connection.type, schemaIdentity),
		objectType,
		...comment.value.length > 0 ? { comment: comment.value } : {},
		...comment.truncated ? { truncatedFields: ["comment"] } : {},
		capabilities: contextCapabilities(context)
	}, status);
}
function observationForColumn(context, schema, relation, objectType, column, rawType, nullable, rawComment, ordinal) {
	const parentIdentity = {
		sourceId: context.sourceId,
		database: catalogDatabase(context),
		schema,
		kind: objectType,
		name: relation
	};
	const type = normalizeCatalogText(rawType, 512);
	const comment = normalizeCatalogText(rawComment, context.options.maxTextChars);
	return makeObservation(context, {
		sourceId: context.sourceId,
		database: catalogDatabase(context),
		schema,
		relation,
		kind: "column",
		name: column
	}, {
		name: column,
		path: `${catalogDatabase(context)}.${schema}.${relation}.${column}`,
		parentId: catalogAssetId(context.connection.type, parentIdentity),
		...type.value.length > 0 ? { dataType: type.value } : {},
		...nullable !== void 0 ? { nullable } : {},
		...ordinal !== void 0 ? { ordinal } : {},
		...comment.value.length > 0 ? { comment: comment.value } : {},
		...type.truncated || comment.truncated ? { truncatedFields: [type.truncated ? "dataType" : "", comment.truncated ? "comment" : ""].filter(Boolean) } : {},
		capabilities: contextCapabilities(context)
	}, "observed");
}
function makeObservation(context, rawIdentity, values, status) {
	const identity = canonicalCatalogIdentity(context.connection.type, rawIdentity);
	const payload = {
		...values,
		identity,
		provenance: {
			source: "database",
			dialect: context.connection.type,
			runId: context.runId
		}
	};
	return {
		runId: context.runId,
		sourceId: context.sourceId,
		assetId: catalogAssetId(context.connection.type, identity),
		status,
		fingerprint: catalogTechnicalFingerprint(payload, status),
		observedAt: (/* @__PURE__ */ new Date()).toISOString(),
		payload
	};
}
function contextCapabilities(context) {
	return { ...createCatalogAdapterRegistry()[context.connection.type].capabilities };
}
function parseNullable(value) {
	if (/^(yes|y|true|1)$/i.test(value)) return true;
	if (/^(no|n|false|0)$/i.test(value)) return false;
}
function sqlLiteral(value) {
	return `'${normalizeCatalogText(value, 256).value.replace(/'/g, "''")}'`;
}
function dedupeObservations(values) {
	return [...new Map(values.map((value) => [value.assetId, value])).values()].sort((a, b) => a.payload.path.localeCompare(b.payload.path) || a.assetId.localeCompare(b.assetId));
}
function dedupeRelations(values) {
	return [...new Map(values.map((value) => [value.id, value])).values()].sort((a, b) => a.id.localeCompare(b.id));
}
/** Deterministic bounded worker pool that stops scheduling after the first failure. */
async function mapLimit(values, limit, task, signal) {
	if (!Number.isInteger(limit) || limit < 1) throw new Error("Catalog adapter concurrency must be a positive integer");
	const output = new Array(values.length);
	let cursor = 0;
	let failure;
	const worker = async () => {
		while (failure === void 0) {
			signal.throwIfAborted();
			const index = cursor;
			cursor += 1;
			if (index >= values.length) return;
			try {
				output[index] = await task(values[index], index);
			} catch (error) {
				failure ??= error;
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
	if (failure !== void 0) throw failure;
	return output;
}
//#endregion
//#region src/catalog.ts
/** Shared Catalog service: scan lifecycle, version projections, search, and review. */
const ACTIVE_RUN_STATUSES = /* @__PURE__ */ new Set([
	"queued",
	"running",
	"applying"
]);
const ACTIVE_ENRICHMENT_STATUSES = /* @__PURE__ */ new Set(["queued", "running"]);
var CatalogVersionConflictError = class extends Error {
	current;
	constructor(current) {
		super(`Catalog semantic version conflict; current version is ${current.version}`);
		this.current = current;
		this.name = "CatalogVersionConflictError";
	}
};
async function createCatalogService(connections, persistence, options) {
	const now = () => (options.now?.() ?? /* @__PURE__ */ new Date()).toISOString();
	const randomId = options.randomId ?? (() => crypto.randomUUID());
	const adapters = options.adapters ?? createCatalogAdapterRegistry();
	const controllers = /* @__PURE__ */ new Map();
	const runtimeRuns = /* @__PURE__ */ new Map();
	const runActive = (run) => ACTIVE_RUN_STATUSES.has(run.status) || run.enrichment !== void 0 && ACTIVE_ENRICHMENT_STATUSES.has(run.enrichment.status);
	const successfulRuns = (sourceId) => persistence.listRuns(sourceId).filter((run) => run.status === "succeeded").sort(compareRun);
	const runVisible = (runId) => persistence.getRun(runId)?.status === "succeeded";
	const currentRevision = (assetId) => {
		const head = persistence.getAssetHead(assetId);
		if (head === void 0) return void 0;
		for (const revisionId of [...head.revisionIds].reverse()) {
			const revision = persistence.getAssetRevision(revisionId);
			if (revision !== void 0 && runVisible(revision.runId)) return revision;
		}
	};
	const revisionAtRun = (assetId, target) => {
		const targetKey = runOrderKey(target);
		return persistence.listAssetRevisions(assetId).filter((revision) => {
			const run = persistence.getRun(revision.runId);
			return run?.status === "succeeded" && runOrderKey(run) <= targetKey;
		}).sort((a, b) => b.revision - a.revision)[0];
	};
	const currentSemantic = (entry) => {
		const revision = persistence.getSemanticRevision(catalogSemanticRevisionId(entry.id, entry.currentVersion));
		if (revision === void 0) throw new Error(`Catalog semantic ${entry.id} has no current revision`);
		return revision;
	};
	const resolvePageSize = (value) => {
		if (value === void 0) return options.pageSize;
		if (!Number.isInteger(value) || value < 1 || value > options.maxPageSize) throw new Error(`pageSize must be an integer between 1 and ${options.maxPageSize}`);
		return value;
	};
	const read = {
		listSources() {
			return persistence.listSources();
		},
		listRuns(sourceId, limit = 50) {
			requireKnownSource(sourceId);
			if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("limit must be between 1 and 200");
			return persistence.listRuns(sourceId).sort((a, b) => compareRun(b, a)).slice(0, limit).map((run) => runtimeRuns.get(run.id) ?? run);
		},
		async resolveSource(sessionId, requestedSourceId) {
			if (requestedSourceId !== void 0) {
				const requested = persistence.getSource(requestedSourceId);
				if (requested === void 0) throw new Error(`Unknown Catalog source: ${requestedSourceId}`);
				const summary = connections.get(sessionId);
				if (summary?.profileId !== void 0 && summary.profileId !== requestedSourceId) throw new Error("Requested Catalog source does not match the current session connection");
				return requested;
			}
			const summary = connections.get(sessionId);
			if (summary?.profileId !== void 0) {
				const connected = persistence.getSource(summary.profileId);
				if (connected !== void 0) return connected;
			}
			const sources = persistence.listSources();
			if (sources.length === 1) return sources[0];
			if (sources.length === 0) throw new Error("Catalog is empty; run /catalog scan after connecting a saved profile");
			throw new Error(`Catalog source is ambiguous; specify sourceId (${sources.map((source) => `${source.id}:${source.name}`).join(", ")})`);
		},
		status(sourceId) {
			const source = persistence.getSource(sourceId);
			if (source === void 0) return void 0;
			const runs = persistence.listRuns(sourceId).sort((a, b) => compareRun(b, a)).map((run) => runtimeRuns.get(run.id) ?? run);
			const revisions = persistence.listAssetHeads(sourceId).flatMap((head) => {
				const revision = currentRevision(head.assetId);
				return revision === void 0 ? [] : [revision];
			});
			const semantics = persistence.listSemanticEntries(sourceId).map(currentSemantic);
			return {
				source,
				...runs.find(runActive) !== void 0 ? { activeRun: runs.find(runActive) } : {},
				...runs[0] !== void 0 ? { latestRun: runs[0] } : {},
				...runs.find((run) => run.status === "succeeded") !== void 0 ? { latestSuccessfulRun: runs.find((run) => run.status === "succeeded") } : {},
				counts: {
					assets: revisions.filter((revision) => revision.status !== "missing").length,
					fields: revisions.filter((revision) => revision.payload.identity.kind === "column" && revision.status !== "missing").length,
					needsReview: semantics.filter((revision) => revision.definition.status === "inferred" || revision.definition.status === "needs_review").length
				}
			};
		},
		async search(rawRequest) {
			const request = catalogSearchRequestSchema.parse(rawRequest);
			const sourceId = request.filters.sourceId;
			if (sourceId === void 0) throw new Error("Catalog search requires sourceId");
			requireKnownSource(sourceId);
			await ensureIndex(sourceId);
			const normalizedQuery = normalizeCatalogText(request.query, 512).value.toLocaleLowerCase("en-US");
			const words = normalizedQuery === "*" ? [] : normalizedQuery.split(/\s+/).filter(Boolean);
			const matches = persistence.listIndex(sourceId).filter((record) => words.every((word) => record.searchText.includes(word))).map((record) => ({
				...record.searchItem,
				matchReasons: searchMatchReasons(record.searchItem, normalizedQuery)
			})).filter((item) => filterSearchItem(item, request)).sort(compareSearchItems);
			const cursorKey = stableJson({
				query: normalizedQuery,
				filters: request.filters
			});
			const cursor = decodeCursor(request.cursor, sourceId, cursorKey);
			const size = resolvePageSize(request.pageSize);
			const items = matches.slice(cursor, cursor + size);
			const nextOffset = cursor + items.length;
			const includeInferred = request.filters.includeInferred;
			return {
				sourceId,
				query: request.query,
				items,
				...nextOffset < matches.length ? { nextCursor: encodeCursor(nextOffset, sourceId, cursorKey) } : {},
				truncated: nextOffset < matches.length,
				warnings: includeInferred && items.some((item) => item.status === "inferred") ? ["Results include inferred definitions that have not been verified by a human."] : []
			};
		},
		getAsset(sourceId, assetId, cursor, pageSize) {
			requireKnownSource(sourceId);
			const revision = currentRevision(assetId);
			if (revision === void 0 || revision.sourceId !== sourceId) throw new Error(`Unknown Catalog asset: ${assetId}`);
			const size = resolvePageSize(pageSize);
			const offset = decodeCursor(cursor, sourceId, assetId);
			const allFields = persistence.listAssetHeads(sourceId).flatMap((head) => {
				const item = currentRevision(head.assetId);
				return item !== void 0 && item.payload.parentId === assetId ? [item] : [];
			}).sort((a, b) => (a.payload.ordinal ?? Number.MAX_SAFE_INTEGER) - (b.payload.ordinal ?? Number.MAX_SAFE_INTEGER) || a.payload.name.localeCompare(b.payload.name));
			const fields = allFields.slice(offset, offset + size);
			const allRelations = currentRelations(sourceId).filter((relation) => relation.fromAssetId === assetId || relation.toAssetId === assetId);
			const relatedAssetIds = /* @__PURE__ */ new Set([assetId, ...allFields.map((field) => field.assetId)]);
			const allSemantics = persistence.listSemanticEntries(sourceId).map(currentSemantic).filter((item) => item.definition.status !== "retired" && item.definition.sourceAssetIds.some((relatedAssetId) => relatedAssetIds.has(relatedAssetId)));
			const allHistory = persistence.listAssetRevisions(assetId).filter((item) => runVisible(item.runId)).sort((a, b) => b.revision - a.revision);
			const relations = allRelations.slice(offset, offset + size);
			const semantics = allSemantics.slice(offset, offset + size);
			const history = allHistory.slice(offset, offset + size);
			const nextOffset = offset + size;
			const truncated = [
				allFields,
				allRelations,
				allSemantics,
				allHistory
			].some((values) => nextOffset < values.length);
			return {
				asset: revision,
				fields,
				relations,
				semantics,
				history,
				...truncated ? { nextCursor: encodeCursor(nextOffset, sourceId, assetId) } : {},
				truncated,
				untrusted: true
			};
		},
		getSemantic(sourceId, semanticId, version) {
			requireKnownSource(sourceId);
			const entry = persistence.getSemanticEntry(semanticId);
			if (entry === void 0 || entry.sourceId !== sourceId) throw new Error(`Unknown Catalog semantic: ${semanticId}`);
			if (version === void 0) return currentSemantic(entry);
			if (!Number.isInteger(version) || version < 1) throw new Error("version must be a positive integer");
			const revision = persistence.getSemanticRevision(catalogSemanticRevisionId(semanticId, version));
			if (revision === void 0) throw new Error(`Unknown Catalog semantic version: ${semanticId}@${version}`);
			return revision;
		},
		getMetric(sourceId, metricId, version) {
			const revision = read.getSemantic(sourceId, metricId, version);
			if (revision.definition.kind !== "metric") throw new Error(`${metricId} is not a metric`);
			return revision;
		},
		diff(sourceId, fromRunId, toRunId, cursor, pageSize) {
			requireKnownSource(sourceId);
			const runs = successfulRuns(sourceId);
			let from;
			let to;
			if (fromRunId === void 0 && toRunId === void 0) {
				from = runs.at(-2);
				to = runs.at(-1);
			} else {
				from = fromRunId === void 0 ? void 0 : persistence.getRun(fromRunId);
				to = toRunId === void 0 ? void 0 : persistence.getRun(toRunId);
			}
			if (from?.status !== "succeeded" || to?.status !== "succeeded" || from.sourceId !== sourceId || to.sourceId !== sourceId) throw new Error("Catalog diff requires two successful runs from the same source");
			const items = buildDiff(sourceId, from, to);
			const offset = decodeCursor(cursor, sourceId, `${from.id}:${to.id}`);
			const size = resolvePageSize(pageSize);
			const page = items.slice(offset, offset + size);
			const nextOffset = offset + page.length;
			return {
				sourceId,
				fromRunId: from.id,
				toRunId: to.id,
				scope: to.scope,
				items: page,
				...nextOffset < items.length ? { nextCursor: encodeCursor(nextOffset, sourceId, `${from.id}:${to.id}`) } : {},
				truncated: nextOffset < items.length
			};
		}
	};
	const scanner = {
		async start(rawInput) {
			const input = startCatalogScanInputSchema.parse(rawInput);
			const requestedScope = input.scope;
			const sessionId = input.sessionId;
			const modelSelection = options.meaningGenerator?.capture(sessionId);
			const summary = connections.get(sessionId);
			if (summary?.profileId === void 0 || summary.profileId.trim().length === 0) throw new Error("Catalog scan requires a connected, stable connection profile");
			const connection = await connections.resolveForExecution(sessionId);
			if (connection.profileId !== summary.profileId) throw new Error("Session connection changed while starting Catalog scan");
			const sourceId = catalogSourceId(summary.profileId);
			if (sourceId !== summary.profileId) throw new Error("Catalog profileId contains unsupported whitespace or control characters");
			const scope = normalizeScope(connection.type, requestedScope);
			const existing = persistence.listRuns(sourceId).find((run) => runActive(runtimeRuns.get(run.id) ?? run));
			if (existing !== void 0) return runtimeRuns.get(existing.id) ?? existing;
			const timestamp = now();
			const source = {
				id: sourceId,
				profileId: sourceId,
				type: connection.type,
				name: normalizeCatalogText(summary.name ?? summary.database, 256).value,
				...summary.host !== void 0 ? { host: normalizeCatalogText(summary.host, 512).value } : {},
				database: normalizeCatalogText(connection.type === "sqlite" ? basename(summary.database) : summary.database, 512).value,
				credentialConfigured: true,
				createdAt: persistence.getSource(sourceId)?.createdAt ?? timestamp,
				updatedAt: timestamp,
				...persistence.getSource(sourceId)?.lastFullScanAt !== void 0 ? { lastFullScanAt: persistence.getSource(sourceId).lastFullScanAt } : {},
				...persistence.getSource(sourceId)?.lastPartialScanAt !== void 0 ? { lastPartialScanAt: persistence.getSource(sourceId).lastPartialScanAt } : {}
			};
			await persistence.putSource(source);
			const run = {
				id: `run_${randomId()}`,
				sourceId,
				sessionId,
				scope,
				status: "queued",
				coverageComplete: false,
				progress: {
					schemas: 0,
					relations: 0,
					fields: 0,
					assets: 0
				},
				createdAt: timestamp,
				...modelSelection !== void 0 ? { enrichment: {
					status: "queued",
					provider: modelSelection.provider,
					model: modelSelection.model,
					...modelSelection.reasoningEffort !== void 0 ? { reasoningEffort: String(modelSelection.reasoningEffort) } : {},
					tablesTotal: 0,
					tablesCompleted: 0,
					tablesFailed: 0,
					candidatesGenerated: 0
				} } : {}
			};
			await persistence.putRun(run);
			runtimeRuns.set(run.id, run);
			const controller = new AbortController();
			controllers.set(run.id, controller);
			queueMicrotask(() => {
				executeRun(run, connection.type, controller, modelSelection).catch((error) => {
					options.logger?.warn("data-agent Catalog run %s failed unexpectedly: %s", run.id, error);
				});
			});
			return run;
		},
		async cancel(sourceId, runId) {
			requireKnownSource(sourceId);
			const active = persistence.listRuns(sourceId).map((run) => runtimeRuns.get(run.id) ?? run).find((run) => runActive(run) && (runId === void 0 || run.id === runId));
			if (active === void 0) throw new Error("No matching active Catalog run");
			controllers.get(active.id)?.abort(/* @__PURE__ */ new Error("Catalog scan cancelled by user"));
			return active;
		},
		async interruptActiveRuns() {
			for (const run of persistence.listRuns()) {
				if (!runActive(run)) continue;
				const interrupted = ACTIVE_RUN_STATUSES.has(run.status) ? {
					...run,
					status: "interrupted",
					completedAt: now(),
					error: "Catalog scan interrupted by process restart"
				} : {
					...run,
					enrichment: {
						...run.enrichment,
						status: "cancelled",
						completedAt: now(),
						error: "Catalog AI enrichment interrupted by process restart"
					}
				};
				await persistence.putRun(interrupted);
				runtimeRuns.delete(run.id);
				await persistence.deleteObservations(run.id);
			}
		}
	};
	const review = {
		async saveCandidate(sourceId, rawDefinition, semanticId, expectedVersion) {
			if (rawDefinition.kind === "meaning") throw new Error("AI business meanings can only be created by Catalog enrichment");
			const existing = semanticId === void 0 ? void 0 : persistence.getSemanticEntry(semanticId);
			if (existing !== void 0 && existing.sourceId !== sourceId) throw new Error("Semantic belongs to another Catalog source");
			const currentStatus = existing === void 0 ? void 0 : currentSemantic(existing).definition.status;
			if (currentStatus === "retired") throw new Error("Retired semantics cannot be edited");
			return appendSemantic(sourceId, semanticDefinitionSchema.parse({
				...rawDefinition,
				status: currentStatus === "needs_review" ? "needs_review" : "inferred"
			}), semanticId, expectedVersion, false);
		},
		async verify(sourceId, semanticId, expectedVersion, rawDefinition) {
			const existing = requireSemanticEntry(sourceId, semanticId);
			if (currentSemantic(existing).definition.status === "retired") throw new Error("Retired semantics cannot be verified again");
			const note = rawDefinition.revisionNote?.trim();
			if (note === void 0 || note.length === 0) throw new Error("Verification requires revisionNote");
			return appendSemantic(sourceId, semanticDefinitionSchema.parse({
				...rawDefinition,
				status: "verified",
				verifiedAt: now(),
				revisionNote: note,
				needsReviewReason: void 0,
				triggerRunId: void 0
			}), semanticId, expectedVersion, true);
		},
		async retire(sourceId, semanticId, expectedVersion, revisionNote) {
			if (revisionNote.trim().length === 0) throw new Error("Retirement requires revisionNote");
			const entry = requireSemanticEntry(sourceId, semanticId);
			const current = currentSemantic(entry);
			if (current.definition.status !== "verified" && current.definition.status !== "needs_review") throw new Error("Only verified or needs_review semantics can be retired");
			return appendSemantic(sourceId, {
				...current.definition,
				status: "retired",
				revisionNote: normalizeCatalogText(revisionNote, options.maxTextChars).value
			}, semanticId, expectedVersion, true);
		},
		async dismissMeaning(sourceId, semanticId, expectedVersion) {
			const entry = requireSemanticEntry(sourceId, semanticId);
			const current = currentSemantic(entry);
			if (current.definition.kind !== "meaning" || current.definition.generatedBy.kind !== "ai") throw new Error("Only AI-generated business meanings can be deleted with this action");
			if (current.definition.status === "retired") throw new Error("Business meaning is already deleted");
			return appendSemantic(sourceId, {
				...current.definition,
				status: "retired",
				revisionNote: "AI-generated business meaning deleted by user"
			}, semanticId, expectedVersion, true);
		}
	};
	async function executeRun(initial, databaseType, controller, modelSelection) {
		let run = await setRun(initial, {
			status: "running",
			startedAt: now()
		});
		let resolvedConnection;
		try {
			const connection = await connections.resolveForExecution(run.sessionId);
			resolvedConnection = connection;
			if (connection.profileId !== run.sourceId || connection.type !== databaseType) throw new Error("Session connection no longer matches the Catalog source");
			const adapter = adapters[connection.type];
			if (adapter === void 0) throw new Error(`No Catalog adapter for ${connection.type}`);
			let assets = 0;
			const result = await adapter.scan({
				connections,
				connection,
				sessionId: run.sessionId,
				sourceId: run.sourceId,
				runId: run.id,
				scope: run.scope,
				signal: controller.signal,
				options: {
					maxTextChars: options.maxTextChars,
					schemaConcurrency: options.schemaConcurrency,
					assetConcurrency: options.assetConcurrency
				},
				onProgress(kind) {
					assets += 1;
					if (assets > options.maxAssetsPerRun) throw new Error(`Catalog scan exceeded maxAssetsPerRun (${options.maxAssetsPerRun})`);
					const progress = {
						...run.progress,
						assets
					};
					if (kind === "schema") progress.schemas += 1;
					if (kind === "relation") progress.relations += 1;
					if (kind === "field") progress.fields += 1;
					run = {
						...run,
						progress
					};
					runtimeRuns.set(run.id, run);
				}
			});
			controller.signal.throwIfAborted();
			validateAdapterResult(result, run);
			for (const observation of result.observations) await persistence.putObservation(observation);
			run = await setRun(run, {
				status: "applying",
				coverageComplete: result.coverageComplete,
				progress: run.progress
			});
			await promote(run, result);
			const completedAt = now();
			run = await setRun(run, {
				status: "succeeded",
				coverageComplete: result.coverageComplete,
				completedAt
			});
			const source = persistence.getSource(run.sourceId);
			await persistence.putSource({
				...source,
				updatedAt: completedAt,
				...run.scope.kind === "source" ? { lastFullScanAt: completedAt } : { lastPartialScanAt: completedAt }
			});
			try {
				await markImpactedSemantics(run);
				await rebuildIndex(run.sourceId);
				await persistence.deleteObservations(run.id);
			} catch (error) {
				options.logger?.warn("data-agent Catalog run %s committed, but post-commit maintenance failed: %s", run.id, error);
			}
			if (modelSelection !== void 0 && options.meaningGenerator !== void 0) run = await enrichBusinessMeanings(run, modelSelection, options.meaningGenerator, controller, resolvedConnection);
		} catch (error) {
			const aborted = controller.signal.aborted;
			const rawMessage = error instanceof Error ? error.message : String(error);
			const message = normalizeCatalogText(redactSecretText(rawMessage, [resolvedConnection?.password]), options.maxTextChars).value;
			if (run.status === "succeeded") {
				if (run.enrichment !== void 0 && ACTIVE_ENRICHMENT_STATUSES.has(run.enrichment.status)) run = await setRun(run, { enrichment: {
					...run.enrichment,
					status: aborted ? "cancelled" : "failed",
					completedAt: now(),
					error: message
				} });
				return;
			}
			run = await setRun(run, {
				status: aborted ? "cancelled" : "failed",
				coverageComplete: false,
				completedAt: now(),
				error: message
			});
			await persistence.deleteObservations(run.id);
		} finally {
			controllers.delete(run.id);
			runtimeRuns.delete(run.id);
		}
	}
	async function setRun(run, changes) {
		const next = {
			...run,
			...changes
		};
		await persistence.putRun(next);
		runtimeRuns.set(next.id, next);
		return next;
	}
	async function enrichBusinessMeanings(initial, selection, generator, controller, connection) {
		const source = requireKnownSource(initial.sourceId);
		const relations = currentRelations(initial.sourceId);
		const tables = persistence.listAssetHeads(initial.sourceId).flatMap((head) => {
			const revision = currentRevision(head.assetId);
			if (revision === void 0 || revision.status !== "observed" || revision.payload.identity.kind !== "table" && revision.payload.identity.kind !== "view" || !inScope(revision, initial.scope) || !isBusinessSchema(source, revision.payload.identity.schema)) return [];
			return [revision];
		}).sort((a, b) => a.payload.path.localeCompare(b.payload.path));
		let run = await setRun(initial, { enrichment: {
			...initial.enrichment,
			status: "running",
			tablesTotal: tables.length,
			startedAt: now()
		} });
		let completed = 0;
		let failed = 0;
		let generated = 0;
		const errors = [];
		try {
			for (const table of tables) {
				controller.signal.throwIfAborted();
				const fields = persistence.listAssetHeads(run.sourceId).flatMap((head) => {
					const revision = currentRevision(head.assetId);
					return revision !== void 0 && revision.status === "observed" && revision.payload.parentId === table.assetId ? [revision] : [];
				}).sort((a, b) => (a.payload.ordinal ?? Number.MAX_SAFE_INTEGER) - (b.payload.ordinal ?? Number.MAX_SAFE_INTEGER) || a.payload.name.localeCompare(b.payload.name));
				const tableRelations = relations.filter((relation) => relation.fromAssetId === table.assetId || relation.toAssetId === table.assetId);
				const input = {
					assetId: table.assetId,
					schema: table.payload.identity.schema,
					name: table.payload.name,
					objectType: table.payload.identity.kind,
					...table.payload.comment !== void 0 ? { comment: table.payload.comment } : {},
					fields: fields.map((field) => ({
						assetId: field.assetId,
						name: field.payload.name,
						...field.payload.dataType !== void 0 ? { dataType: field.payload.dataType } : {},
						...field.payload.nullable !== void 0 ? { nullable: field.payload.nullable } : {},
						...field.payload.comment !== void 0 ? { comment: field.payload.comment } : {},
						keyKinds: tableRelations.filter((relation) => relation.columnAssetIds.includes(field.assetId)).map((relation) => relation.kind)
					})),
					relations: tableRelations.map((relation) => ({
						kind: relation.kind,
						...relation.name !== void 0 ? { name: relation.name } : {},
						fromAssetId: relation.fromAssetId,
						...relation.toAssetId !== void 0 ? { toAssetId: relation.toAssetId } : {},
						columnAssetIds: relation.columnAssetIds,
						...relation.referencedColumnAssetIds !== void 0 ? { referencedColumnAssetIds: relation.referencedColumnAssetIds } : {}
					}))
				};
				try {
					const result = await generator.generate(selection, input, controller.signal);
					generated += await upsertGeneratedMeaning(run, table, result.table.meaning, selection);
					const byId = new Map(fields.map((field) => [field.assetId, field]));
					for (const fieldMeaning of result.fields) generated += await upsertGeneratedMeaning(run, byId.get(fieldMeaning.assetId), fieldMeaning.meaning, selection);
					completed += 1;
				} catch (error) {
					if (controller.signal.aborted) throw error;
					failed += 1;
					const message = catalogEnrichmentError(error, connection, table.payload.path);
					errors.push(message);
					options.logger?.warn("data-agent Catalog AI enrichment failed for %s: %s", table.payload.path, message);
				}
				run = await setRun(run, { enrichment: {
					...run.enrichment,
					tablesCompleted: completed,
					tablesFailed: failed,
					candidatesGenerated: generated,
					...errors.length > 0 ? { error: errors.slice(-3).join(" | ") } : {}
				} });
			}
			await rebuildIndex(run.sourceId);
			const status = failed === 0 ? "succeeded" : completed === 0 ? "failed" : "partial";
			return setRun(run, { enrichment: {
				...run.enrichment,
				status,
				completedAt: now(),
				...errors.length > 0 ? { error: errors.slice(-3).join(" | ") } : {}
			} });
		} catch (error) {
			const cancelled = controller.signal.aborted;
			const message = catalogEnrichmentError(error, connection);
			return setRun(run, { enrichment: {
				...run.enrichment,
				status: cancelled ? "cancelled" : completed === 0 ? "failed" : "partial",
				tablesCompleted: completed,
				tablesFailed: failed + (cancelled ? 0 : 1),
				candidatesGenerated: generated,
				completedAt: now(),
				error: message
			} });
		}
	}
	async function upsertGeneratedMeaning(run, asset, description, selection) {
		const semanticId = `meaning_${asset.assetId}`;
		const existing = persistence.getSemanticEntry(semanticId);
		const current = existing === void 0 ? void 0 : currentSemantic(existing);
		if (current !== void 0) {
			if (current.definition.kind !== "meaning") throw new Error(`Catalog semantic id collision: ${semanticId}`);
			if (current.definition.status !== "inferred" || current.definition.description === description) return 0;
		}
		const definition = {
			kind: "meaning",
			name: asset.payload.name,
			aliases: [],
			description,
			sourceAssetIds: [asset.assetId],
			status: "inferred",
			targetAssetId: asset.assetId,
			targetKind: asset.payload.identity.kind,
			generatedBy: {
				kind: "ai",
				provider: selection.provider,
				model: selection.model,
				runId: run.id
			},
			triggerRunId: run.id,
			revisionNote: `AI business meaning candidate generated by Catalog run ${run.id}`
		};
		await appendSemantic(run.sourceId, definition, semanticId, existing?.currentVersion, false, false);
		return 1;
	}
	function catalogEnrichmentError(error, connection, path) {
		const raw = error instanceof Error ? error.message : String(error);
		const prefix = path === void 0 ? "" : `${path}: `;
		return normalizeCatalogText(redactSecretText(`${prefix}${raw}`, [connection.password]), options.maxTextChars).value;
	}
	function validateAdapterResult(result, run) {
		if (result.observations.length > options.maxAssetsPerRun) throw new Error(`Catalog scan exceeded maxAssetsPerRun (${options.maxAssetsPerRun})`);
		result.observations.forEach((value) => catalogObservationSchema.parse(value));
		result.relations.forEach((value) => catalogRelationSchema.parse(value));
		const ids = new Set(result.observations.map((value) => value.assetId));
		if (ids.size !== result.observations.length) throw new Error("Catalog adapter returned duplicate asset ids");
		for (const observation of result.observations) {
			if (observation.runId !== run.id || observation.sourceId !== run.sourceId) throw new Error("Catalog adapter returned an observation for another run or source");
			const parentId = observation.payload.parentId;
			if (parentId !== void 0 && !ids.has(parentId) && currentRevision(parentId) === void 0) throw new Error(`Catalog observation has unknown parent ${parentId}`);
		}
		if (new Set(result.relations.map((value) => value.id)).size !== result.relations.length) throw new Error("Catalog adapter returned duplicate relation ids");
		const knownAsset = (assetId) => ids.has(assetId) || currentRevision(assetId) !== void 0;
		for (const relation of result.relations) {
			if (relation.runId !== run.id || relation.sourceId !== run.sourceId) throw new Error("Catalog adapter returned a relation for another run or source");
			const unknown = [
				relation.fromAssetId,
				relation.toAssetId,
				...relation.columnAssetIds,
				...relation.referencedColumnAssetIds ?? []
			].filter((value) => value !== void 0).find((assetId) => !knownAsset(assetId));
			if (unknown !== void 0) throw new Error(`Catalog relation has unknown asset reference ${unknown}`);
		}
	}
	async function promote(run, result) {
		const observations = [...result.observations];
		const observedIds = new Set(observations.map((value) => value.assetId));
		if (result.coverageComplete) for (const head of persistence.listAssetHeads(run.sourceId)) {
			const current = currentRevision(head.assetId);
			if (current === void 0 || current.status === "missing" || !inScope(current, run.scope) || observedIds.has(head.assetId)) continue;
			const payload = {
				...current.payload,
				provenance: {
					...current.payload.provenance,
					runId: run.id
				}
			};
			observations.push({
				runId: run.id,
				sourceId: run.sourceId,
				assetId: current.assetId,
				status: "missing",
				fingerprint: catalogTechnicalFingerprint(payload, "missing"),
				observedAt: now(),
				payload
			});
		}
		for (const observation of observations) await promoteObservation(observation);
		for (const relation of result.relations) await persistence.putRelation(relation);
	}
	async function promoteObservation(observation) {
		const current = currentRevision(observation.assetId);
		const existingHead = persistence.getAssetHead(observation.assetId);
		if (current?.fingerprint === observation.fingerprint && current.status === observation.status) {
			if (existingHead !== void 0) await persistence.putAssetHead({
				...existingHead,
				lastSeenAt: observation.observedAt
			});
			return;
		}
		const revisionNumber = (existingHead?.revisionIds.length ?? 0) + 1;
		const revision = {
			id: catalogRevisionId(observation.assetId, revisionNumber),
			assetId: observation.assetId,
			sourceId: observation.sourceId,
			runId: observation.runId,
			revision: revisionNumber,
			status: observation.status,
			fingerprint: observation.fingerprint,
			observedAt: observation.observedAt,
			...current !== void 0 ? { previousRevisionId: current.id } : {},
			changeSummary: summarizeTechnicalChange(current, observation),
			payload: observation.payload
		};
		await persistence.putAssetRevision(revision);
		const head = existingHead === void 0 ? {
			assetId: observation.assetId,
			sourceId: observation.sourceId,
			revisionIds: [revision.id],
			firstSeenAt: observation.observedAt,
			lastSeenAt: observation.observedAt
		} : {
			...existingHead,
			revisionIds: [...existingHead.revisionIds, revision.id],
			lastSeenAt: observation.observedAt
		};
		await persistence.putAssetHead(head);
	}
	async function appendSemantic(sourceId, rawDefinition, semanticId, expectedVersion, requireExisting, rebuild = true) {
		requireKnownSource(sourceId);
		const definition = semanticDefinitionSchema.parse(normalizeSemanticDefinition(rawDefinition, options.maxTextChars));
		validateSemanticReferences(sourceId, definition);
		const id = semanticId ?? (definition.kind === "meaning" ? `meaning_${definition.targetAssetId}` : catalogSemanticId(sourceId, definition.kind, definition.name));
		const existing = persistence.getSemanticEntry(id);
		if (requireExisting && existing === void 0) throw new Error(`Unknown Catalog semantic: ${id}`);
		if (existing !== void 0 && existing.sourceId !== sourceId) throw new Error("Semantic belongs to another Catalog source");
		if (existing !== void 0 && expectedVersion !== existing.currentVersion) throw new CatalogVersionConflictError(currentSemantic(existing));
		if (existing === void 0 && expectedVersion !== void 0 && expectedVersion !== 0) throw new Error("New semantic expectedVersion must be 0 or omitted");
		const version = (existing?.currentVersion ?? 0) + 1;
		const timestamp = now();
		const revision = {
			id: catalogSemanticRevisionId(id, version),
			semanticId: id,
			sourceId,
			version,
			createdAt: timestamp,
			definition
		};
		await persistence.putSemanticRevision(revision);
		await persistence.putSemanticEntry({
			id,
			sourceId,
			kind: definition.kind,
			currentVersion: version,
			createdAt: existing?.createdAt ?? timestamp,
			updatedAt: timestamp
		});
		if (rebuild) await rebuildIndex(sourceId);
		return revision;
	}
	function validateSemanticReferences(sourceId, definition) {
		for (const assetId of definition.sourceAssetIds) {
			const revision = currentRevision(assetId);
			if (revision === void 0 || revision.sourceId !== sourceId) throw new Error(`Unknown or cross-source asset reference: ${assetId}`);
		}
		if (definition.kind === "metric" && definition.timeFieldAssetId !== void 0) {
			const field = currentRevision(definition.timeFieldAssetId);
			if (field === void 0 || field.sourceId !== sourceId || field.payload.identity.kind !== "column") throw new Error(`Invalid metric time field: ${definition.timeFieldAssetId}`);
		}
		if (definition.kind === "meaning") {
			const target = currentRevision(definition.targetAssetId);
			if (target === void 0 || target.sourceId !== sourceId || target.payload.identity.kind !== definition.targetKind) throw new Error(`Invalid business meaning target: ${definition.targetAssetId}`);
			if (definition.sourceAssetIds.length !== 1 || definition.sourceAssetIds[0] !== definition.targetAssetId) throw new Error("Business meaning sourceAssetIds must contain only its target asset");
			const generatedRun = persistence.getRun(definition.generatedBy.runId);
			if (generatedRun === void 0 || generatedRun.sourceId !== sourceId) throw new Error(`Invalid business meaning generation run: ${definition.generatedBy.runId}`);
		}
	}
	async function markImpactedSemantics(run) {
		const changed = persistence.listAssetRevisions().filter((revision) => revision.runId === run.id && (revision.status === "missing" || incompatibleTypeChange(revision)));
		if (changed.length === 0) return;
		const changedIds = new Set(changed.map((revision) => revision.assetId));
		for (const entry of persistence.listSemanticEntries(run.sourceId)) {
			const current = currentSemantic(entry);
			if (current.definition.status === "retired" || current.definition.status === "needs_review") continue;
			const impacted = current.definition.sourceAssetIds.filter((id) => changedIds.has(id));
			if (current.definition.kind === "metric" && current.definition.timeFieldAssetId !== void 0 && changedIds.has(current.definition.timeFieldAssetId)) impacted.push(current.definition.timeFieldAssetId);
			if (impacted.length === 0) continue;
			await appendSemantic(run.sourceId, {
				...current.definition,
				status: "needs_review",
				needsReviewReason: `Referenced Catalog assets changed: ${[...new Set(impacted)].join(", ")}`,
				triggerRunId: run.id,
				revisionNote: `Automatically marked needs_review after Catalog run ${run.id}`
			}, entry.id, entry.currentVersion, true);
		}
	}
	async function ensureIndex(sourceId) {
		if (persistence.getIndexState()?.version !== 1 || persistence.listIndex(sourceId).length === 0) await rebuildIndex(sourceId);
	}
	async function rebuildIndex(sourceId) {
		await persistence.clearIndex(sourceId);
		const timestamp = now();
		for (const head of persistence.listAssetHeads(sourceId)) {
			const revision = currentRevision(head.assetId);
			if (revision === void 0) continue;
			const payload = revision.payload;
			const item = {
				id: revision.assetId,
				sourceId,
				resultType: "asset",
				kind: payload.identity.kind,
				name: payload.name,
				path: payload.path,
				summary: payload.comment ?? payload.dataType ?? "",
				matchReasons: [],
				status: revision.status,
				provenance: "database",
				untrusted: true
			};
			await persistence.putIndex(indexRecord(item, [
				payload.name,
				payload.path,
				payload.comment,
				payload.dataType
			], timestamp));
		}
		for (const entry of persistence.listSemanticEntries(sourceId)) {
			const revision = currentSemantic(entry);
			const definition = revision.definition;
			if (definition.status === "retired") continue;
			const item = {
				id: entry.id,
				sourceId,
				resultType: "semantic",
				kind: definition.kind,
				name: definition.name,
				path: `${definition.kind}:${definition.name}`,
				summary: definition.description,
				matchReasons: [],
				status: definition.status,
				version: revision.version,
				provenance: definition.status === "inferred" ? "inferred" : "human",
				untrusted: true
			};
			await persistence.putIndex(indexRecord(item, [
				definition.name,
				...definition.aliases,
				definition.description,
				definition.kind === "metric" ? definition.formula : void 0
			], timestamp));
		}
		await persistence.putIndexState({
			version: 1,
			rebuiltAt: timestamp
		});
	}
	function indexRecord(item, values, timestamp) {
		const searchText = values.filter((value) => value !== void 0).join(" ").normalize("NFKC").toLocaleLowerCase("en-US");
		return {
			id: `${item.resultType}:${item.id}`,
			sourceId: item.sourceId,
			resultType: item.resultType,
			searchText,
			searchItem: item,
			updatedAt: timestamp
		};
	}
	function buildDiff(sourceId, from, to) {
		const items = [];
		for (const head of persistence.listAssetHeads(sourceId)) {
			const before = revisionAtRun(head.assetId, from);
			const after = revisionAtRun(head.assetId, to);
			if (before?.id === after?.id || before === void 0 && after === void 0) continue;
			const kind = diffKind(before, after);
			if (kind === void 0) continue;
			const revision = after ?? before;
			items.push({
				kind,
				assetId: head.assetId,
				name: revision.payload.name,
				path: revision.payload.path,
				...before !== void 0 ? { fromRevisionId: before.id } : {},
				...after !== void 0 ? { toRevisionId: after.id } : {},
				summary: after?.changeSummary ?? ["asset removed from the target snapshot"]
			});
		}
		return items.sort((a, b) => diffOrder(a.kind) - diffOrder(b.kind) || a.path.localeCompare(b.path) || a.assetId.localeCompare(b.assetId));
	}
	function currentRelations(sourceId) {
		const runs = successfulRuns(sourceId);
		const latestApplicableRun = /* @__PURE__ */ new Map();
		for (const head of persistence.listAssetHeads(sourceId)) {
			const revision = currentRevision(head.assetId);
			if (revision === void 0) continue;
			const run = [...runs].reverse().find((candidate) => inScope(revision, candidate.scope));
			if (run !== void 0) latestApplicableRun.set(head.assetId, run.id);
		}
		return persistence.listRelations(sourceId).filter((relation) => latestApplicableRun.get(relation.fromAssetId) === relation.runId).sort((a, b) => a.kind.localeCompare(b.kind) || (a.name ?? "").localeCompare(b.name ?? "") || a.id.localeCompare(b.id));
	}
	function requireKnownSource(sourceId) {
		const source = persistence.getSource(nonEmpty(sourceId, "sourceId"));
		if (source === void 0) throw new Error(`Unknown Catalog source: ${sourceId}`);
		return source;
	}
	function requireSemanticEntry(sourceId, semanticId) {
		const entry = persistence.getSemanticEntry(semanticId);
		if (entry === void 0 || entry.sourceId !== sourceId) throw new Error(`Unknown Catalog semantic: ${semanticId}`);
		return entry;
	}
	await scanner.interruptActiveRuns();
	return {
		read,
		scanner,
		review
	};
}
function compareRun(a, b) {
	return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
function runOrderKey(run) {
	return `${run.createdAt}\0${run.id}`;
}
function inScope(revision, scope) {
	const identity = revision.payload.identity;
	if (scope.kind === "source") return true;
	if (identity.schema.toLocaleLowerCase("en-US") !== scope.schema.toLocaleLowerCase("en-US")) return false;
	if (scope.kind === "schema") return true;
	return (identity.kind === "table" || identity.kind === "view" ? identity.name : identity.relation)?.toLocaleLowerCase("en-US") === scope.table.toLocaleLowerCase("en-US");
}
function isBusinessSchema(source, schema) {
	const normalized = schema.toLocaleLowerCase("en-US");
	if (source.type === "mysql" || source.type === "doris" || source.type === "clickhouse") return normalized === source.database.toLocaleLowerCase("en-US");
	if (source.type === "sqlite") return normalized === "main";
	if (normalized === "information_schema" || normalized === "sys" || normalized === "system") return false;
	if (source.type === "postgres" && (normalized === "pg_catalog" || normalized.startsWith("pg_toast"))) return false;
	if (source.type === "oracle" && [
		"sys",
		"system",
		"xdb",
		"outln"
	].includes(normalized)) return false;
	return true;
}
function normalizeScope(type, scope) {
	if (scope.kind === "source") return scope;
	const schema = normalizeCatalogIdentifier(type, scope.schema);
	if (scope.kind === "schema") return {
		kind: "schema",
		schema
	};
	return {
		kind: "table",
		schema,
		table: normalizeCatalogIdentifier(type, scope.table)
	};
}
function summarizeTechnicalChange(current, next) {
	if (current === void 0) return ["added"];
	if (current.status === "missing" && next.status === "observed") return ["restored"];
	if (next.status === "missing") return ["missing"];
	if (next.status === "unavailable") return ["unavailable"];
	const fields = [];
	for (const key of [
		"dataType",
		"nullable",
		"comment",
		"parentId",
		"objectType"
	]) if (stableJson(current.payload[key]) !== stableJson(next.payload[key])) fields.push(`${key} changed`);
	return fields.length > 0 ? fields : ["technical metadata changed"];
}
function incompatibleTypeChange(revision) {
	if (revision.payload.identity.kind !== "column" || revision.previousRevisionId === void 0) return false;
	return revision.changeSummary.includes("dataType changed");
}
function diffKind(before, after) {
	if (before === void 0 && after !== void 0) return "added";
	if (after === void 0) return void 0;
	if (after.status === "missing" && before?.status !== "missing") return "missing";
	if (after.status === "unavailable" && before?.status !== "unavailable") return "unavailable";
	if (before?.status === "missing" && after.status === "observed") return "restored";
	if (before?.fingerprint !== after.fingerprint) return "changed";
}
function diffOrder(kind) {
	return [
		"added",
		"changed",
		"missing",
		"restored",
		"unavailable"
	].indexOf(kind);
}
function filterSearchItem(item, request) {
	const filters = request.filters;
	if (item.resultType === "asset") {
		if (filters.assetKinds !== void 0 && !filters.assetKinds.some((value) => value === item.kind)) return false;
		if (filters.assetStatuses !== void 0 && !filters.assetStatuses.some((value) => value === item.status)) return false;
		if (filters.schema !== void 0 && !item.path.toLocaleLowerCase("en-US").includes(`.${filters.schema.toLocaleLowerCase("en-US")}.`)) return false;
		return true;
	}
	if (filters.semanticKinds !== void 0 && !filters.semanticKinds.some((value) => value === item.kind)) return false;
	if (item.status === "inferred" && !filters.includeInferred) return false;
	if (filters.semanticStatuses !== void 0 && !filters.semanticStatuses.some((value) => value === item.status)) return false;
	return true;
}
function compareSearchItems(a, b) {
	return searchRank(a) - searchRank(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}
function searchRank(item) {
	if (item.resultType === "semantic" && item.status === "verified") return 0;
	if (item.resultType === "asset" && item.status === "observed") return 10;
	if (item.status === "needs_review") return 20;
	if (item.status === "inferred") return 30;
	if (item.status === "missing") return 40;
	return 50;
}
function searchMatchReasons(item, query) {
	if (query === "*") return ["browse"];
	const reasons = [];
	if (item.name.toLocaleLowerCase("en-US").includes(query)) reasons.push("name");
	if (item.path.toLocaleLowerCase("en-US").includes(query)) reasons.push("path");
	if (item.summary.toLocaleLowerCase("en-US").includes(query)) reasons.push("description");
	return reasons.length > 0 ? reasons : ["definition or alias"];
}
function encodeCursor(offset, sourceId, query) {
	return Buffer.from(JSON.stringify({
		offset,
		sourceId,
		query
	}), "utf8").toString("base64url");
}
function decodeCursor(cursor, sourceId, query) {
	if (cursor === void 0) return 0;
	if (cursor.length > 512) throw new Error("Invalid Catalog cursor");
	try {
		const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
		if (!Number.isInteger(parsed.offset) || parsed.offset < 0 || parsed.sourceId !== sourceId || parsed.query !== query) throw new Error("mismatch");
		return parsed.offset;
	} catch {
		throw new Error("Invalid Catalog cursor");
	}
}
function nonEmpty(value, label) {
	if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) throw new Error(`${label} must be a non-empty bounded string`);
	return value;
}
function normalizeSemanticDefinition(definition, maxTextChars) {
	const text = (value, max = maxTextChars) => normalizeCatalogText(value, max).value;
	const common = {
		...definition,
		name: text(definition.name, 256),
		aliases: definition.aliases.map((value) => text(value, 256)),
		description: text(definition.description),
		...definition.owner !== void 0 ? { owner: text(definition.owner, 256) } : {},
		...definition.revisionNote !== void 0 ? { revisionNote: text(definition.revisionNote) } : {},
		...definition.needsReviewReason !== void 0 ? { needsReviewReason: text(definition.needsReviewReason) } : {}
	};
	if (definition.kind === "meaning") return {
		...common,
		kind: "meaning",
		targetAssetId: definition.targetAssetId,
		targetKind: definition.targetKind,
		generatedBy: {
			kind: "ai",
			provider: text(definition.generatedBy.provider, 256),
			model: text(definition.generatedBy.model, 512),
			runId: definition.generatedBy.runId
		}
	};
	if (definition.kind === "term") return {
		...common,
		kind: "term"
	};
	return {
		...common,
		kind: "metric",
		formula: text(definition.formula, 8192),
		grain: text(definition.grain, 512),
		filters: definition.filters.map((value) => text(value, 2048)),
		exclusions: definition.exclusions.map((value) => text(value, 2048))
	};
}
//#endregion
export { catalogDateTimeSchema as a, catalogRunSchema as c, catalogSearchRequestSchema as d, catalogSemanticEntrySchema as f, semanticDefinitionSchema as h, catalogAssetRevisionSchema as i, catalogScopeSchema as l, catalogSourceSchema as m, createCatalogService as n, catalogObservationSchema as o, catalogSemanticRevisionSchema as p, catalogAssetHeadSchema as r, catalogRelationSchema as s, CatalogVersionConflictError as t, catalogSearchItemSchema as u };
