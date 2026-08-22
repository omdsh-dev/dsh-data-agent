import { createHash } from "node:crypto";
//#region src/catalog-identity.ts
/** Deterministic identity, normalization, and fingerprint helpers. */
const CASE_INSENSITIVE_DIALECTS = /* @__PURE__ */ new Set([
	"mysql",
	"doris",
	"sqlite",
	"hive",
	"impala",
	"sqlserver"
]);
/** Strip unsafe controls, normalize Unicode, and enforce one explicit bound. */
function normalizeCatalogText(value, maxChars) {
	const normalized = value.normalize("NFKC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
	if (normalized.length <= maxChars) return {
		value: normalized,
		truncated: false
	};
	return {
		value: normalized.slice(0, maxChars),
		truncated: true
	};
}
/** Normalize an observed identifier according to the dialect's identity rules. */
function normalizeCatalogIdentifier(type, value) {
	const normalized = normalizeCatalogText(value, 256).value;
	if (normalized.length === 0) throw new Error("Catalog identifier must not be empty");
	if (type === "oracle") return normalized.toUpperCase();
	return CASE_INSENSITIVE_DIALECTS.has(type) ? normalized.toLowerCase() : normalized;
}
/** v1 source identity is deliberately the stable connection profile id. */
function catalogSourceId(profileId) {
	const normalized = normalizeCatalogText(profileId, 256).value;
	if (normalized.length === 0) throw new Error("Catalog scan requires a stable profileId");
	return normalized;
}
/** Build canonical structured identity without parsing display paths. */
function canonicalCatalogIdentity(type, identity) {
	return {
		sourceId: catalogSourceId(identity.sourceId),
		database: normalizeCatalogIdentifier(type, identity.database),
		schema: normalizeCatalogIdentifier(type, identity.schema),
		kind: identity.kind,
		...identity.relation !== void 0 ? { relation: normalizeCatalogIdentifier(type, identity.relation) } : {},
		name: normalizeCatalogIdentifier(type, identity.name)
	};
}
/** Stable opaque asset id derived only from structured identity components. */
function catalogAssetId(type, identity) {
	const canonical = canonicalCatalogIdentity(type, identity);
	return `asset_${createHash("sha256").update(stableJson(canonical)).digest("hex").slice(0, 32)}`;
}
function catalogSemanticId(sourceId, kind, name) {
	const key = {
		sourceId: catalogSourceId(sourceId),
		kind,
		name: normalizeCatalogText(name, 256).value.toLocaleLowerCase("en-US")
	};
	return `${kind}_${createHash("sha256").update(stableJson(key)).digest("hex").slice(0, 32)}`;
}
/** Technical fingerprint excludes run-specific provenance and display-only truncation facts. */
function catalogTechnicalFingerprint(payload, status = "observed") {
	const canonical = {
		status,
		identity: payload.identity,
		name: payload.name,
		parentId: payload.parentId,
		objectType: payload.objectType,
		dataType: payload.dataType,
		nullable: payload.nullable,
		ordinal: payload.ordinal,
		comment: payload.comment,
		referencedAssetIds: payload.referencedAssetIds,
		attributes: payload.attributes,
		capabilities: payload.capabilities
	};
	return createHash("sha256").update(stableJson(canonical)).digest("hex");
}
/** Deterministic JSON encoding for hashes and cursor order keys. */
function stableJson(value) {
	return JSON.stringify(sortValue(value));
}
function sortValue(value) {
	if (Array.isArray(value)) return value.map(sortValue);
	if (value === null || typeof value !== "object") return value;
	const record = value;
	return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortValue(record[key])]));
}
function catalogRevisionId(assetId, revision) {
	return `${assetId}:r${String(revision).padStart(8, "0")}`;
}
function catalogSemanticRevisionId(semanticId, version) {
	return `${semanticId}:v${String(version).padStart(8, "0")}`;
}
//#endregion
export { catalogSemanticRevisionId as a, normalizeCatalogIdentifier as c, catalogSemanticId as i, normalizeCatalogText as l, catalogAssetId as n, catalogSourceId as o, catalogRevisionId as r, catalogTechnicalFingerprint as s, canonicalCatalogIdentity as t, stableJson as u };
