import { _ as clientsSchema, b as DATABASE_TYPES, c as DEFAULT_CATALOG_MAX_RESULT_CHARS, d as DEFAULT_CONNECT_TIMEOUT_MS, f as DEFAULT_MAX_QUERY_CHARS, h as DEFAULT_QUERY_TIMEOUT_MS, l as DEFAULT_CATALOG_MAX_TEXT_CHARS, m as DEFAULT_PRESET_ID, p as DEFAULT_MAX_RESULT_CHARS, s as DEFAULT_CATALOG_MAX_ASSETS, t as createConnectionService, u as DEFAULT_CATALOG_QUERY_TIMEOUT_MS } from "./connections-CFXOZTHZ.js";
import { a as catalogDateTimeSchema, c as catalogRunSchema, f as catalogSemanticEntrySchema, i as catalogAssetRevisionSchema, m as catalogSourceSchema, n as createCatalogService, o as catalogObservationSchema, p as catalogSemanticRevisionSchema, r as catalogAssetHeadSchema, s as catalogRelationSchema, u as catalogSearchItemSchema } from "./catalog-DEJqOXRo.js";
import { i as apply$1 } from "./command-CzzSPmag.js";
import { n as apply$2 } from "./tool-DNkywSph.js";
import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Storage from "@deepseek-ai/dsh-storage";
import * as storageDomainPlugin from "@deepseek-ai/dsh-storage-domain";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import * as storageJsonPlugin from "@deepseek-ai/dsh-storage-json";
import z from "schemastery";
import { z as z$1 } from "zod";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
//#region src/catalog-ai.ts
const MAX_MODEL_OUTPUT_CHARS = 65536;
const MAX_MODEL_OUTPUT_TOKENS = 16384;
var CatalogModelOutputTruncatedError = class extends Error {
	constructor() {
		super("Catalog AI meaning output was truncated by the model token limit");
		this.name = "CatalogModelOutputTruncatedError";
	}
};
const modelResultSchema = z$1.strictObject({
	table: z$1.strictObject({
		assetId: z$1.string().min(1).max(256),
		meaning: z$1.string().trim().min(1).max(4096)
	}),
	fields: z$1.array(z$1.strictObject({
		assetId: z$1.string().min(1).max(256),
		meaning: z$1.string().trim().min(1).max(4096)
	})).max(512)
});
/** Resolve the exact current session model once, then use the host's configured LLM adapters and credentials. */
function createDshCatalogMeaningGenerator(agents, llm) {
	return {
		capture(sessionId) {
			const agent = agents.get(sessionId);
			if (agent === void 0) throw new Error("Catalog scan requires a live DSH session to use its configured AI model");
			const configured = agent.session.requestHeader()?.config;
			const provider = configured?.provider ?? agent.options.provider;
			const model = configured?.model ?? agent.options.model;
			if (provider === void 0 || provider.trim().length === 0 || model === void 0 || model.trim().length === 0) throw new Error("Catalog scan requires the current DSH session to have a configured AI model");
			return {
				provider,
				model,
				...configured?.reasoningEffort !== void 0 ? { reasoningEffort: configured.reasoningEffort } : {}
			};
		},
		async generate(selection, input, signal) {
			return generateCompleteModelResult(llm, selection, input, signal);
		}
	};
}
async function generateCompleteModelResult(llm, selection, input, signal) {
	try {
		return await generateModelBatch(llm, selection, input, signal);
	} catch (error) {
		if (!(error instanceof CatalogModelOutputTruncatedError)) throw error;
		if (input.fields.length <= 1) throw new Error("Catalog AI meaning output remained truncated after retrying a single-field batch");
		const middle = Math.ceil(input.fields.length / 2);
		const batches = [input.fields.slice(0, middle), input.fields.slice(middle)];
		const results = [];
		for (const fields of batches) {
			signal.throwIfAborted();
			results.push(await generateCompleteModelResult(llm, selection, sliceTableInput(input, fields), signal));
		}
		return {
			table: results[0].table,
			fields: results.flatMap((result) => result.fields)
		};
	}
}
async function generateModelBatch(llm, selection, input, signal) {
	const config = {
		provider: selection.provider,
		model: selection.model,
		...selection.reasoningEffort !== void 0 ? { reasoningEffort: selection.reasoningEffort } : {},
		maxTokens: MAX_MODEL_OUTPUT_TOKENS
	};
	const prepared = await llm.prepareCall(config, signal);
	const message = createUserMessage({
		content: [{
			type: "text",
			text: JSON.stringify(input)
		}],
		source: {
			kind: "plugin",
			plugin: "@yejiming/dsh-data-agent"
		}
	});
	let output = "";
	let finished = false;
	for await (const chunk of prepared.stream({
		...prepared.config,
		messages: [message],
		system: CATALOG_MEANING_SYSTEM_PROMPT,
		signal
	})) {
		signal.throwIfAborted();
		if (chunk.type === "text-delta") {
			output += chunk.text;
			if (output.length > MAX_MODEL_OUTPUT_CHARS) throw new Error("Catalog AI meaning output exceeded the configured bound");
			continue;
		}
		if (chunk.type !== "finish") continue;
		finished = true;
		if (chunk.reason.kind === "error" || chunk.reason.kind === "aborted") throw new Error(`Catalog AI meaning generation failed: ${chunk.reason.failure.message}`);
		if (chunk.reason.kind === "max-tokens") throw new CatalogModelOutputTruncatedError();
		if (chunk.reason.kind !== "stop") throw new Error(`Catalog AI meaning generation stopped unexpectedly: ${chunk.reason.kind}`);
	}
	if (!finished) throw new Error("Catalog AI meaning generation ended without a finish event");
	return validateModelResult(output, input);
}
function sliceTableInput(input, fields) {
	const fieldIds = new Set(fields.map((field) => field.assetId));
	return {
		...input,
		fields,
		relations: input.relations.filter((relation) => relation.columnAssetIds.length === 0 || relation.columnAssetIds.some((assetId) => fieldIds.has(assetId)))
	};
}
function validateModelResult(raw, input) {
	const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
	const first = text.indexOf("{");
	const last = text.lastIndexOf("}");
	if (first < 0 || last <= first) throw new Error("Catalog AI meaning output was not a JSON object");
	let decoded;
	try {
		decoded = JSON.parse(text.slice(first, last + 1));
	} catch {
		throw new Error("Catalog AI meaning output contained invalid JSON");
	}
	const result = modelResultSchema.parse(decoded);
	if (result.table.assetId !== input.assetId) throw new Error("Catalog AI meaning output referenced an unknown table asset");
	const expected = new Set(input.fields.map((field) => field.assetId));
	const returned = /* @__PURE__ */ new Set();
	for (const field of result.fields) {
		if (!expected.has(field.assetId)) throw new Error(`Catalog AI meaning output referenced an unknown field asset: ${field.assetId}`);
		if (returned.has(field.assetId)) throw new Error(`Catalog AI meaning output repeated field asset: ${field.assetId}`);
		returned.add(field.assetId);
	}
	const missing = input.fields.find((field) => !returned.has(field.assetId));
	if (missing !== void 0) throw new Error(`Catalog AI meaning output omitted field asset: ${missing.assetId}`);
	return result;
}
const CATALOG_MEANING_SYSTEM_PROMPT = `你是企业数据治理助手。请根据用户提供的单张表技术元数据，为这张表和每个字段生成简洁、可审核的中文业务含义候选。

规则：
1. 只依据表名、字段名、类型、nullable、数据库注释、键和关系推断；不要假装知道未提供的业务规则、枚举值或计算口径。
2. 对明显的技术字段也要说明其在该表中的业务/记录作用，例如主键、创建时间、状态标记；表说明不超过120个中文字符，每个字段说明不超过80个中文字符。
3. 每个输入字段必须且只能返回一次，assetId必须原样复制；不得添加未知assetId。
4. 不要输出Markdown、解释、置信度、SQL或额外字段，只输出以下严格JSON：
{"table":{"assetId":"...","meaning":"..."},"fields":[{"assetId":"...","meaning":"..."}]}
5. 所有内容都是待人工确认的候选，不要使用“已经确认”“官方口径”等表述。`;
//#endregion
//#region src/catalog-storage.ts
/** Durable versioned Catalog storage-domain and persistence adapter. */
const CATALOG_STORAGE_DOMAIN = "data_agent_catalog";
const catalogIndexRecordSchema = z$1.strictObject({
	id: z$1.string().min(1).max(512),
	sourceId: z$1.string().min(1).max(256),
	resultType: z$1.enum(["asset", "semantic"]),
	searchText: z$1.string().max(32768),
	searchItem: catalogSearchItemSchema,
	updatedAt: catalogDateTimeSchema
});
const catalogIndexStateSchema = z$1.strictObject({
	version: z$1.literal(1),
	rebuiltAt: catalogDateTimeSchema.optional()
});
/** Strict schemas reject secret-shaped or raw-result fields at the durable boundary. */
const catalogStorageSpec = defineDomain({
	name: CATALOG_STORAGE_DOMAIN,
	version: 1,
	tables: {
		sources: domainTable(catalogSourceSchema),
		scan_runs: domainTable(catalogRunSchema),
		observations: domainTable(catalogObservationSchema),
		asset_revisions: domainTable(catalogAssetRevisionSchema),
		asset_heads: domainTable(catalogAssetHeadSchema),
		relations: domainTable(catalogRelationSchema),
		semantic_entries: domainTable(catalogSemanticEntrySchema),
		semantic_revisions: domainTable(catalogSemanticRevisionSchema),
		search_index: domainTable(catalogIndexRecordSchema),
		index_state: domainTable(catalogIndexStateSchema)
	}
});
function createDomainCatalogPersistence(domain) {
	const sources = domain.table("sources");
	const runs = domain.table("scan_runs");
	const observations = domain.table("observations");
	const revisions = domain.table("asset_revisions");
	const heads = domain.table("asset_heads");
	const relations = domain.table("relations");
	const semanticEntries = domain.table("semantic_entries");
	const semanticRevisions = domain.table("semantic_revisions");
	const searchIndex = domain.table("search_index");
	const indexState = domain.table("index_state");
	return {
		getSource: (id) => sources.get(id),
		listSources: () => sortedValues(sources.entries(), (value) => value.id),
		putSource: (source) => sources.put(source.id, catalogSourceSchema.parse(source)),
		getRun: (id) => runs.get(id),
		listRuns: (sourceId) => sortedValues(runs.entries(), (value) => value.createdAt).filter((value) => sourceId === void 0 || value.sourceId === sourceId),
		putRun: (run) => runs.put(run.id, catalogRunSchema.parse(run)),
		putObservation: (observation) => observations.put(`${observation.runId}:${observation.assetId}`, catalogObservationSchema.parse(observation)),
		listObservations: (runId) => sortedValues(observations.entries(), (value) => value.assetId).filter((value) => value.runId === runId),
		async deleteObservations(runId) {
			const keys = [...observations.entries()].filter(([, value]) => value.runId === runId).map(([key]) => key);
			for (const key of keys) await observations.delete(key);
		},
		getAssetHead: (assetId) => heads.get(assetId),
		listAssetHeads: (sourceId) => sortedValues(heads.entries(), (value) => value.assetId).filter((value) => sourceId === void 0 || value.sourceId === sourceId),
		putAssetHead: (head) => heads.put(head.assetId, catalogAssetHeadSchema.parse(head)),
		getAssetRevision: (id) => revisions.get(id),
		listAssetRevisions: (assetId) => sortedValues(revisions.entries(), (value) => value.id).filter((value) => assetId === void 0 || value.assetId === assetId),
		putAssetRevision: (revision) => revisions.put(revision.id, catalogAssetRevisionSchema.parse(revision)),
		listRelations: (sourceId) => sortedValues(relations.entries(), (value) => value.id).filter((value) => sourceId === void 0 || value.sourceId === sourceId),
		putRelation: (relation) => relations.put(`${relation.runId}:${relation.id}`, catalogRelationSchema.parse(relation)),
		getSemanticEntry: (id) => semanticEntries.get(id),
		listSemanticEntries: (sourceId) => sortedValues(semanticEntries.entries(), (value) => value.id).filter((value) => sourceId === void 0 || value.sourceId === sourceId),
		putSemanticEntry: (entry) => semanticEntries.put(entry.id, catalogSemanticEntrySchema.parse(entry)),
		getSemanticRevision: (id) => semanticRevisions.get(id),
		listSemanticRevisions: (semanticId) => sortedValues(semanticRevisions.entries(), (value) => value.id).filter((value) => semanticId === void 0 || value.semanticId === semanticId),
		putSemanticRevision: (revision) => semanticRevisions.put(revision.id, catalogSemanticRevisionSchema.parse(revision)),
		listIndex: (sourceId) => sortedValues(searchIndex.entries(), (value) => value.id).filter((value) => sourceId === void 0 || value.sourceId === sourceId),
		putIndex: (record) => searchIndex.put(record.id, catalogIndexRecordSchema.parse(record)),
		async clearIndex(sourceId) {
			const keys = [...searchIndex.entries()].filter(([, value]) => sourceId === void 0 || value.sourceId === sourceId).map(([key]) => key);
			for (const key of keys) await searchIndex.delete(key);
		},
		getIndexState: () => indexState.get("current"),
		putIndexState: (state) => indexState.put("current", catalogIndexStateSchema.parse(state))
	};
}
/** In-memory adapter used when Catalog persistence is explicitly disabled and by focused tests. */
function createMemoryCatalogPersistence() {
	const map = () => /* @__PURE__ */ new Map();
	const sources = map();
	const runs = map();
	const observations = map();
	const heads = map();
	const revisions = map();
	const relations = map();
	const entries = map();
	const semanticRevisions = map();
	const index = map();
	let state;
	return {
		getSource: (id) => sources.get(id),
		listSources: () => [...sources.values()].sort((a, b) => a.id.localeCompare(b.id)),
		async putSource(source) {
			sources.set(source.id, catalogSourceSchema.parse(source));
		},
		getRun: (id) => runs.get(id),
		listRuns: (sourceId) => [...runs.values()].filter((value) => sourceId === void 0 || value.sourceId === sourceId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
		async putRun(run) {
			runs.set(run.id, catalogRunSchema.parse(run));
		},
		async putObservation(value) {
			observations.set(`${value.runId}:${value.assetId}`, catalogObservationSchema.parse(value));
		},
		listObservations: (runId) => [...observations.values()].filter((value) => value.runId === runId),
		async deleteObservations(runId) {
			for (const [key, value] of observations) if (value.runId === runId) observations.delete(key);
		},
		getAssetHead: (id) => heads.get(id),
		listAssetHeads: (sourceId) => [...heads.values()].filter((value) => sourceId === void 0 || value.sourceId === sourceId),
		async putAssetHead(value) {
			heads.set(value.assetId, catalogAssetHeadSchema.parse(value));
		},
		getAssetRevision: (id) => revisions.get(id),
		listAssetRevisions: (assetId) => [...revisions.values()].filter((value) => assetId === void 0 || value.assetId === assetId),
		async putAssetRevision(value) {
			revisions.set(value.id, catalogAssetRevisionSchema.parse(value));
		},
		listRelations: (sourceId) => [...relations.values()].filter((value) => sourceId === void 0 || value.sourceId === sourceId),
		async putRelation(value) {
			relations.set(`${value.runId}:${value.id}`, catalogRelationSchema.parse(value));
		},
		getSemanticEntry: (id) => entries.get(id),
		listSemanticEntries: (sourceId) => [...entries.values()].filter((value) => sourceId === void 0 || value.sourceId === sourceId),
		async putSemanticEntry(value) {
			entries.set(value.id, catalogSemanticEntrySchema.parse(value));
		},
		getSemanticRevision: (id) => semanticRevisions.get(id),
		listSemanticRevisions: (semanticId) => [...semanticRevisions.values()].filter((value) => semanticId === void 0 || value.semanticId === semanticId),
		async putSemanticRevision(value) {
			semanticRevisions.set(value.id, catalogSemanticRevisionSchema.parse(value));
		},
		listIndex: (sourceId) => [...index.values()].filter((value) => sourceId === void 0 || value.sourceId === sourceId),
		async putIndex(value) {
			index.set(value.id, catalogIndexRecordSchema.parse(value));
		},
		async clearIndex(sourceId) {
			for (const [key, value] of index) if (sourceId === void 0 || value.sourceId === sourceId) index.delete(key);
		},
		getIndexState: () => state,
		async putIndexState(value) {
			state = catalogIndexStateSchema.parse(value);
		}
	};
}
function sortedValues(entries, by) {
	return [...entries].map(([, value]) => value).sort((a, b) => by(a).localeCompare(by(b)));
}
//#endregion
//#region src/storage.ts
/**
* Durable, non-secret connection profiles, session bindings, and form drafts.
*
* The domain intentionally excludes passwords, resolved credentials, SQL,
* table metadata, and client output. Form drafts likewise accept no secret
* fields. Runtime secrets stay in
* {@link DataAgentConnectionService}; durable records only retain enough
* information to rebuild a connection description in another DSH surface.
* @module @yejiming/dsh-data-agent/storage
*/
/** Storage-domain identity. Bump the version only with an explicit migration. */
const CONNECTION_STORAGE_DOMAIN = "data_agent_connections";
/** Durable profile schema. There is deliberately no `password` field. */
const persistedConnectionProfileSchema = z$1.object({
	name: z$1.string().min(1).optional(),
	type: z$1.enum(DATABASE_TYPES),
	host: z$1.string().optional(),
	port: z$1.number().int().min(1).max(65535).optional(),
	user: z$1.string().optional(),
	database: z$1.string().min(1),
	readonly: z$1.boolean().optional(),
	secure: z$1.boolean().optional(),
	passwordRef: z$1.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
	credentialMode: z$1.enum([
		"none",
		"password",
		"reference"
	]).optional(),
	updatedAt: z$1.string().min(1)
}).strict();
/** Durable session-to-profile binding schema. */
const sessionConnectionBindingSchema = z$1.object({
	profileId: z$1.string().min(1),
	updatedAt: z$1.string().min(1)
}).strict();
/** Session form draft schema. Secret-shaped fields are rejected by strict mode. */
const persistedConnectionFormDraftSchema = z$1.object({
	type: z$1.enum(DATABASE_TYPES),
	host: z$1.string(),
	port: z$1.string(),
	user: z$1.string(),
	database: z$1.string(),
	readonly: z$1.boolean(),
	secure: z$1.boolean().optional(),
	updatedAt: z$1.string().min(1)
}).strict();
/** Single source of truth for the storage layout and durable validation. */
const connectionStorageSpec = defineDomain({
	name: CONNECTION_STORAGE_DOMAIN,
	version: 1,
	tables: {
		profiles: domainTable(persistedConnectionProfileSchema),
		bindings: domainTable(sessionConnectionBindingSchema),
		drafts: domainTable(persistedConnectionFormDraftSchema)
	}
});
/** Select the newest successful profile with a deterministic id tie-break. */
function latestConnectionProfile(entries) {
	let latest;
	for (const [profileId, profile] of entries) if (latest === void 0 || profile.updatedAt > latest.profile.updatedAt || profile.updatedAt === latest.profile.updatedAt && profileId > latest.profileId) latest = {
		profileId,
		profile
	};
	return latest;
}
/** Project a typed DSH domain handle onto the service's persistence seam. */
function createDomainConnectionPersistence(domain) {
	const profiles = domain.table("profiles");
	const bindings = domain.table("bindings");
	const drafts = domain.table("drafts");
	return {
		getProfile(profileId) {
			return profiles.get(profileId);
		},
		getLatestProfile() {
			return latestConnectionProfile(profiles.entries());
		},
		listProfiles() {
			return [...profiles.entries()].map(([profileId, profile]) => ({
				profileId,
				profile
			})).sort((left, right) => left.profileId.localeCompare(right.profileId));
		},
		putProfile(profileId, profile) {
			return profiles.put(profileId, profile);
		},
		deleteProfile(profileId) {
			return profiles.delete(profileId);
		},
		getBinding(sessionId) {
			return bindings.get(sessionId);
		},
		putBinding(sessionId, binding) {
			return bindings.put(sessionId, binding);
		},
		deleteBinding(sessionId) {
			return bindings.delete(sessionId);
		},
		getDraft(sessionId) {
			return drafts.get(sessionId);
		},
		putDraft(sessionId, draft) {
			return drafts.put(sessionId, draft);
		},
		deleteDraft(sessionId) {
			return drafts.delete(sessionId);
		}
	};
}
//#endregion
//#region src/index.ts
/**
* Data Agent profile entry. The host row provides the
* `dataAgentConnections` service (shared non-secret profile/binding storage;
* temporary passwords stay process-local), seeds config connections (`connections`, `'*'` =
* wildcard default), provides a separate versioned governance Catalog, installs the `data-agent` agent preset into
* `$DSH_HOME/.agent-presets/`, and preloads the preset-scoped database tools
* on every surface, while registering `/database` and `/catalog` only while
* the current Cordis composition actually loads the dsh-tui plugin.
*
* The HTTP routes live in the separate `./routes` entry
* (`@yejiming/dsh-data-agent/routes`, cordis row `data-agent-routes`) so
* this row keeps working in headless profiles without a webserver. The
* database implementations still have public `./tool` and `./command`
* exports, but the shipped preset does not dynamically import those package
* subpaths. Loading them here keeps Desktop on the same profile-startup path
* as other UI bundles and avoids Electron ASAR package-resolution drift.
* @module @yejiming/dsh-data-agent
*/
/** Cordis plugin name (diagnostics only). */
const name = "data-agent";
/** Services required before the profile entry can mount its preset layer. */
const inject = [
	"agentPresets",
	"agents",
	"commands",
	"credentials",
	"llm",
	"subprocess",
	"tools"
];
/** Loader schema with deployment defaults (no library defaults). */
const Config = z.object({
	presetId: z.string().default(DEFAULT_PRESET_ID),
	installPreset: z.boolean().default(true),
	connectTimeoutMs: z.number().step(1).min(1e3).default(DEFAULT_CONNECT_TIMEOUT_MS),
	introspectMaxTables: z.number().step(1).min(1).default(500),
	queryTimeoutMs: z.number().step(1).min(1e3).default(DEFAULT_QUERY_TIMEOUT_MS),
	catalogQueryTimeoutMs: z.number().step(1).min(1e3).default(DEFAULT_CATALOG_QUERY_TIMEOUT_MS),
	catalogMaxResultChars: z.number().step(1).min(1024).default(DEFAULT_CATALOG_MAX_RESULT_CHARS),
	catalogSchemaConcurrency: z.number().step(1).min(1).max(16).default(2),
	catalogAssetConcurrency: z.number().step(1).min(1).max(32).default(4),
	catalogMaxAssetsPerRun: z.number().step(1).min(1).max(1e6).default(DEFAULT_CATALOG_MAX_ASSETS),
	catalogMaxTextChars: z.number().step(1).min(256).max(4096).default(DEFAULT_CATALOG_MAX_TEXT_CHARS),
	catalogPageSize: z.number().step(1).min(1).max(200).default(50),
	catalogMaxPageSize: z.number().step(1).min(1).max(200).default(200),
	maxResultChars: z.number().step(1).min(1024).default(DEFAULT_MAX_RESULT_CHARS),
	maxRows: z.number().step(1).min(1).default(100),
	maxQueryChars: z.number().step(1).min(1024).default(DEFAULT_MAX_QUERY_CHARS),
	readonly: z.boolean().default(false),
	persistConnections: z.boolean().default(true),
	clients: clientsSchema,
	connections: z.dict(z.object({
		type: z.union([
			z.const("mysql"),
			z.const("postgres"),
			z.const("sqlite"),
			z.const("oracle"),
			z.const("hive"),
			z.const("impala"),
			z.const("clickhouse"),
			z.const("doris"),
			z.const("sqlserver")
		]),
		host: z.string(),
		port: z.natural(),
		user: z.string(),
		database: z.string(),
		readonly: z.boolean(),
		secure: z.boolean(),
		passwordRef: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/),
		password: z.never().hidden()
	})).default({})
});
/**
* Resolve the harness home the same way `@deepseek-ai/dsh-paths` does:
* `$DSH_HOME` (non-blank) else `~/.dsh`, normalized absolute.
*/
function resolveDshHome(env = process.env) {
	const fromEnv = env.DSH_HOME;
	const selected = fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), ".dsh");
	return resolve(selected.startsWith("~/") ? join(homedir(), selected.slice(2)) : selected);
}
/**
* Install the packaged `preset/data-agent/` directory into
* `$DSH_HOME/.agent-presets/<presetId>/`. Idempotent: an existing target is
* normally left untouched. Exact package-owned legacy compositions are
* migrated once when their runtime contract changes; user-edited compositions
* are never overwritten. `installPreset: false` never calls this. Best-effort
* — a failure logs a warning with manual install instructions instead of
* failing the boot.
*/
async function installPreset(ctx, presetId) {
	const targetDir = join(resolveDshHome(), ".agent-presets", presetId);
	const sourceDir = fileURLToPath(new URL("../preset/data-agent/", import.meta.url));
	try {
		await access(targetDir);
		return await synchronizeExistingPreset(ctx, targetDir, sourceDir, presetId);
	} catch {}
	try {
		await mkdir(targetDir, { recursive: true });
		await cp(sourceDir, targetDir, { recursive: true });
		ctx.logger.info("data-agent: installed preset \"%s\" to %s", presetId, targetDir);
		return true;
	} catch (error) {
		ctx.logger.warn("data-agent: failed to install preset \"%s\" to %s (%s); copy preset/data-agent/ manually to enable the 数据模式 preset", presetId, targetDir, error instanceof Error ? error.message : String(error));
		return false;
	}
}
/** SHA-256 values of unmodified package-owned compositions safe to migrate. */
const LEGACY_MANAGED_PRESET_SHA256 = /* @__PURE__ */ new Set([
	"bae875a90d638ea78715030246b0f8a9f1a2c3359ca61febb6ceb59d0fcd930a",
	"d3c6f4049580069eec1c6b7de101f12c7fb30482ad317434afb69afb08a91fc6",
	"11c4b5ef62c5934d1dc7133950bd78622dd68dc4e1075b5f24d0789011d6da9d"
]);
/** Public for regression tests of the non-destructive preset migration gate. */
function isLegacyManagedPreset(source) {
	return LEGACY_MANAGED_PRESET_SHA256.has(createHash("sha256").update(source).digest("hex"));
}
/** Upgrade only exact package-owned legacy compositions; preserve every edited preset. */
async function synchronizeExistingPreset(ctx, targetDir, sourceDir, presetId) {
	const composition = join(targetDir, "agent.cordis.yml");
	try {
		const current = await readFile(composition, "utf8");
		if (isLegacyManagedPreset(current)) {
			const replacement = await readFile(join(sourceDir, "agent.cordis.yml"), "utf8");
			await writeFile(composition, replacement, "utf8");
			ctx.logger.info("data-agent: migrated package-owned preset at %s to the current runtime contract", composition);
			return true;
		}
		if (current.includes("@yejiming/dsh-data-agent/tool") || current.includes("@yejiming/dsh-data-agent/command")) {
			ctx.logger.warn("data-agent: user-edited preset at %s still imports /tool or /command dynamically; remove those rows so the profile-preloaded preset capabilities can activate in DSH Desktop", composition);
			return false;
		}
		ctx.logger.info("data-agent: preset \"%s\" already present at %s, skipping install", presetId, targetDir);
		return true;
	} catch (error) {
		ctx.logger.warn("data-agent: could not inspect existing preset %s (%s); it was not overwritten", composition, error instanceof Error ? error.message : String(error));
		return false;
	}
}
/** Exact profile-local package installation command used by diagnostics/docs. */
function profileInstallCommand(profile) {
	return `dsh plugin --profile ${profile} add @yejiming/dsh-data-agent`;
}
/** Actionable diagnostic for a roster-visible preset whose profile lacks this package. */
function missingProfileDependencyMessage(profile) {
	return `data-agent preset is visible, but its profile-preloaded capabilities are absent from profile "${profile}". Run: ${profileInstallCommand(profile)}`;
}
/**
* Register the statically imported database tools and surface adapters under the exact
* standing key owned by the data-agent preset. Selecting the preset performs
* no package import and only links the agent scope to this key.
*/
async function mountPresetCapabilities(ctx, key, scopeTag, config, commandOptions = {}) {
	const scoped = ctx.extend({ [scopeTag]: key });
	apply$2(scoped, config);
	apply$1(scoped, commandOptions);
}
/** Read the host-owned scope tag from AgentPresets' already-created standing mount. */
async function standingScopeTag(ctx, presetId, key) {
	const pending = ctx.agentPresets.standing?.get(presetId);
	if (pending === void 0) throw new Error(`data-agent: preset "${presetId}" has no standing scope after standingKeyFor()`);
	const standing = await pending;
	if (standing.key !== key) throw new Error(`data-agent: preset "${presetId}" standing scope changed during profile preload`);
	const tag = Object.getOwnPropertySymbols(standing.scope.ctx).find((candidate) => Reflect.get(standing.scope.ctx, candidate) === key);
	if (tag === void 0) throw new Error(`data-agent: preset "${presetId}" standing context exposes no scope tag`);
	return tag;
}
/**
* Mount the data-agent profile row: connection store, config-seeded
* connections, preset installation, and profile-preloaded preset capabilities.
* HTTP routes are the sibling `data-agent-routes` row (`./routes`).
* @param ctx - host cordis context.
* @param config - validated loader configuration.
*/
async function apply(ctx, config) {
	if (config.catalogPageSize > config.catalogMaxPageSize) throw new Error("data-agent: catalogPageSize cannot exceed catalogMaxPageSize");
	const resolved = {
		presetId: config.presetId,
		installPreset: config.installPreset,
		connectTimeoutMs: config.connectTimeoutMs,
		introspectMaxTables: config.introspectMaxTables,
		queryTimeoutMs: config.queryTimeoutMs,
		catalogQueryTimeoutMs: config.catalogQueryTimeoutMs,
		catalogMaxResultChars: config.catalogMaxResultChars,
		catalogSchemaConcurrency: config.catalogSchemaConcurrency,
		catalogAssetConcurrency: config.catalogAssetConcurrency,
		catalogMaxAssetsPerRun: config.catalogMaxAssetsPerRun,
		catalogMaxTextChars: config.catalogMaxTextChars,
		catalogPageSize: config.catalogPageSize,
		catalogMaxPageSize: config.catalogMaxPageSize,
		maxResultChars: config.maxResultChars,
		maxRows: config.maxRows,
		maxQueryChars: config.maxQueryChars,
		readonly: config.readonly,
		persistConnections: config.persistConnections,
		clients: config.clients,
		connections: config.connections
	};
	const mountService = (scope, persistence, preferredProfileIds) => {
		const store = createConnectionService(scope, {
			connectTimeoutMs: resolved.connectTimeoutMs,
			queryTimeoutMs: resolved.queryTimeoutMs,
			catalogQueryTimeoutMs: resolved.catalogQueryTimeoutMs,
			catalogMaxResultChars: resolved.catalogMaxResultChars,
			maxResultChars: resolved.maxResultChars,
			maxQueryChars: resolved.maxQueryChars,
			introspectMaxTables: resolved.introspectMaxTables,
			readonly: resolved.readonly,
			clients: resolved.clients,
			...preferredProfileIds !== void 0 ? { preferredProfileIds } : {}
		}, persistence);
		scope.provide("dataAgentConnections", store);
		for (const [sessionId, spec] of Object.entries(resolved.connections)) {
			const connection = {
				type: spec.type,
				database: spec.type === "sqlite" ? resolve(process.cwd(), spec.database) : spec.database,
				...spec.host !== void 0 ? { host: spec.host } : {},
				...spec.port !== void 0 ? { port: spec.port } : {},
				...spec.user !== void 0 ? { user: spec.user } : {},
				...spec.passwordRef !== void 0 ? { passwordRef: spec.passwordRef } : {},
				...spec.readonly !== void 0 ? { readonly: spec.readonly } : {},
				...spec.secure !== void 0 ? { secure: spec.secure } : {}
			};
			store.set(sessionId, connection);
		}
		return store;
	};
	const presetReady = resolved.installPreset ? await installPreset(ctx, resolved.presetId) : false;
	let connectionPersistence;
	let catalogPersistence;
	if (resolved.persistConnections) {
		const storageDomain = await ensureStorageDomain(ctx);
		const domain = await storageDomain.open(connectionStorageSpec);
		ctx.effect(() => () => domain.close(), "data-agent: close connection storage domain");
		connectionPersistence = createDomainConnectionPersistence(domain);
		const catalogDomain = await storageDomain.open(catalogStorageSpec);
		ctx.effect(() => () => catalogDomain.close(), "data-agent: close Catalog storage domain");
		catalogPersistence = createDomainCatalogPersistence(catalogDomain);
	} else {
		ctx.logger.warn("data-agent: persistConnections=false; connection and Catalog state are process-local and cannot restore across Web/TUI");
		catalogPersistence = createMemoryCatalogPersistence();
	}
	const connectionService = mountService(ctx, connectionPersistence, () => catalogPersistence.listSources().map((source) => source.profileId));
	const catalog = await createCatalogService(connectionService, catalogPersistence, {
		maxAssetsPerRun: resolved.catalogMaxAssetsPerRun,
		maxTextChars: resolved.catalogMaxTextChars,
		pageSize: resolved.catalogPageSize,
		maxPageSize: resolved.catalogMaxPageSize,
		schemaConcurrency: resolved.catalogSchemaConcurrency,
		assetConcurrency: resolved.catalogAssetConcurrency,
		meaningGenerator: createDshCatalogMeaningGenerator(ctx.agents, ctx.llm),
		logger: ctx.logger
	});
	ctx.provide("dataAgentCatalog", catalog.read);
	ctx.provide("dataAgentCatalogScanner", catalog.scanner);
	ctx.provide("dataAgentCatalogReview", catalog.review);
	ctx.effect(() => () => catalog.scanner.interruptActiveRuns(), "data-agent: interrupt active Catalog scans");
	if (presetReady) {
		const standingKey = await ctx.agentPresets.standingKeyFor(resolved.presetId);
		await mountPresetCapabilities(ctx, standingKey, await standingScopeTag(ctx, resolved.presetId, standingKey), {
			queryTimeoutMs: resolved.queryTimeoutMs,
			maxResultChars: resolved.maxResultChars,
			maxRows: resolved.maxRows,
			maxQueryChars: resolved.maxQueryChars,
			readonly: resolved.readonly,
			clients: resolved.clients
		});
	}
}
/**
* Reuse a surface-provided storage stack (Web) or mount the same JSON stack
* when an interactive profile such as dsh-tui does not ship one.
*/
async function ensureStorageDomain(ctx) {
	const existing = ctx.get("storageDomain");
	if (existing !== void 0) return existing;
	ctx.logger.info("data-agent: storageDomain is absent; mounting the JSON storage stack for this profile");
	let storage = ctx.get("storage");
	if (storage === void 0) {
		await ctx.plugin(Storage);
		storage = ctx.get("storage");
	}
	if (storage === void 0) throw new Error("data-agent: failed to mount DSH storage hub");
	if (!storage.backend.names().includes("json")) await ctx.plugin(storageJsonPlugin, { root: join(resolveDshHome(), "storages") });
	let facility = ctx.get("storageDomain");
	if (facility === void 0) {
		await ctx.plugin(storageDomainPlugin, { backend: "json" });
		facility = ctx.get("storageDomain");
	}
	if (facility === void 0) throw new Error("data-agent: failed to mount DSH storage-domain facility");
	return facility;
}
//#endregion
export { Config, apply, inject, installPreset, isLegacyManagedPreset, missingProfileDependencyMessage, mountPresetCapabilities, name, profileInstallCommand, resolveDshHome };
