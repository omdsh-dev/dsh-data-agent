import { C as isDatabaseType, b as DATABASE_TYPES, d as DEFAULT_CONNECT_TIMEOUT_MS, f as DEFAULT_MAX_QUERY_CHARS, h as DEFAULT_QUERY_TIMEOUT_MS, p as DEFAULT_MAX_RESULT_CHARS } from "./connections-CFXOZTHZ.js";
import { d as catalogSearchRequestSchema, h as semanticDefinitionSchema, l as catalogScopeSchema, t as CatalogVersionConflictError } from "./catalog-DEJqOXRo.js";
import { resolve } from "node:path";
import z from "schemastery";
import { z as z$1 } from "zod";
//#region src/routes.ts
const name = "data-agent-routes";
/** Headless profiles activate this row without waiting forever for webServer. */
const inject = [];
const DATA_AGENT_PATH = "/plugins/data-agent";
const Config = z.object({
	connectTimeoutMs: z.number().step(1).min(1e3).default(DEFAULT_CONNECT_TIMEOUT_MS),
	introspectMaxTables: z.number().step(1).min(1).default(500),
	maxResultChars: z.number().step(1).min(1024).default(DEFAULT_MAX_RESULT_CHARS),
	queryTimeoutMs: z.number().step(1).min(1e3).default(DEFAULT_QUERY_TIMEOUT_MS),
	maxQueryChars: z.number().step(1).min(1024).default(DEFAULT_MAX_QUERY_CHARS),
	readonly: z.boolean().default(false)
});
/** Validate the Web wire shape while retaining temporary-password compatibility. */
function validateConnectBody(value, cwd = process.cwd()) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("请求体必须是 JSON 对象");
	const candidate = value;
	const sessionId = requireString(candidate.sessionId, "sessionId");
	const type = candidate.type;
	if (!isDatabaseType(type)) throw new Error(`type 必须是受支持的数据库类型：${DATABASE_TYPES.join("、")}`);
	const database = requireString(candidate.database, "database");
	const password = optionalString(candidate.password, "password");
	const passwordRef = optionalString(candidate.passwordRef, "passwordRef");
	if (password !== void 0 && passwordRef !== void 0) throw new Error("password 与 passwordRef 不能同时提供");
	const readonly = optionalBoolean(candidate.readonly, "readonly");
	const secure = optionalBoolean(candidate.secure, "secure");
	const profileId = optionalString(candidate.profileId, "profileId");
	const profileName = optionalString(candidate.name, "name");
	const request = {
		sessionId,
		type,
		database: type === "sqlite" ? resolve(cwd, database) : database
	};
	if (readonly !== void 0) request.readonly = readonly;
	if (type === "clickhouse" && secure !== void 0) request.secure = secure;
	if (profileId !== void 0) request.profileId = profileId;
	if (profileName !== void 0) request.name = profileName;
	if (type === "sqlite") return request;
	const host = optionalString(candidate.host, "host");
	const user = optionalString(candidate.user, "user");
	const port = candidate.port;
	if (port !== void 0 && (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error("port 必须是 1-65535 的整数");
	if (host !== void 0) request.host = host;
	if (user !== void 0) request.user = user;
	if (typeof port === "number") request.port = port;
	if (password !== void 0) request.password = password;
	if (passwordRef !== void 0) request.passwordRef = passwordRef;
	return request;
}
/** Register Web routes only when both the webserver and shared service exist. */
function apply(ctx, _config) {
	ctx.inject([
		"webServer",
		"dataAgentConnections",
		"dataAgentCatalog",
		"dataAgentCatalogScanner",
		"dataAgentCatalogReview"
	], (scope) => {
		scope.effect(() => {
			const dispose = scope.webServer.register({
				kind: "prefix",
				path: DATA_AGENT_PATH,
				handler: async (req, res) => {
					const writeJson = (status, body) => {
						res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
						res.end(JSON.stringify(body));
					};
					try {
						const url = new URL(req.url ?? "/", "http://dsh.internal");
						const segments = url.pathname.slice(19).split("/").filter(Boolean);
						const signal = requestSignal(req);
						if (req.method === "POST" && routeIs(segments, "connect")) {
							try {
								const { sessionId, ...input } = validateConnectBody(await readJson(req));
								const result = await scope.dataAgentConnections.connect(sessionId, input, signal);
								writeJson(200, {
									ok: true,
									tables: result.tables,
									summary: result.summary
								});
							} catch (error) {
								writeJson(200, {
									ok: false,
									error: error instanceof Error ? error.message : String(error)
								});
							}
							return;
						}
						if (req.method === "POST" && routeIs(segments, "disconnect")) {
							const sessionId = requireString((await readJson(req)).sessionId, "sessionId");
							await scope.dataAgentConnections.disconnect(sessionId);
							writeJson(200, { ok: true });
							return;
						}
						if (req.method === "GET" && routeIs(segments, "status")) {
							const sessionId = requireString(url.searchParams.get("sessionId"), "sessionId");
							const summary = await scope.dataAgentConnections.status(sessionId);
							writeJson(200, summary === void 0 ? {
								connected: false,
								reconnectRequired: false
							} : {
								connected: summary.ready === true,
								reconnectRequired: summary.reconnectRequired === true,
								summary
							});
							return;
						}
						if (req.method === "GET" && routeIs(segments, "schemas")) {
							const sessionId = requireString(url.searchParams.get("sessionId"), "sessionId");
							writeJson(200, {
								ok: true,
								schemas: await scope.dataAgentConnections.listSchemas(sessionId, signal)
							});
							return;
						}
						if (req.method === "GET" && routeIs(segments, "tables")) {
							const sessionId = requireString(url.searchParams.get("sessionId"), "sessionId");
							const schema = url.searchParams.get("schema") ?? void 0;
							writeJson(200, {
								ok: true,
								tables: await scope.dataAgentConnections.listTables(sessionId, schema, signal)
							});
							return;
						}
						if (req.method === "GET" && routeIs(segments, "describe")) {
							const sessionId = requireString(url.searchParams.get("sessionId"), "sessionId");
							const schema = url.searchParams.get("schema") ?? void 0;
							const table = requireString(url.searchParams.get("table"), "table");
							writeJson(200, {
								ok: true,
								columns: await scope.dataAgentConnections.describe(sessionId, schema, table, signal)
							});
							return;
						}
						if (req.method === "POST" && routeIs(segments, "query")) {
							const body = await readJson(req);
							const sessionId = requireString(body.sessionId, "sessionId");
							const sql = requireString(body.sql, "sql");
							writeJson(200, {
								ok: true,
								result: await scope.dataAgentConnections.executeInteractive(sessionId, sql, signal)
							});
							return;
						}
						if (req.method === "GET" && routePathIs(segments, "catalog", "sources")) {
							assertOnlySearchParams(url.searchParams, []);
							writeJson(200, {
								ok: true,
								sources: scope.dataAgentCatalog.listSources()
							});
							return;
						}
						if (req.method === "GET" && routePathIs(segments, "catalog", "status")) {
							assertOnlySearchParams(url.searchParams, ["sourceId"]);
							const sourceId = requireBoundedString(url.searchParams.get("sourceId"), "sourceId");
							writeJson(200, {
								ok: true,
								status: scope.dataAgentCatalog.status(sourceId) ?? null
							});
							return;
						}
						if (req.method === "GET" && routePathIs(segments, "catalog", "runs")) {
							assertOnlySearchParams(url.searchParams, ["sourceId", "limit"]);
							const sourceId = requireBoundedString(url.searchParams.get("sourceId"), "sourceId");
							const limit = optionalPositiveInteger(url.searchParams.get("limit"), "limit", 200);
							writeJson(200, {
								ok: true,
								runs: scope.dataAgentCatalog.listRuns(sourceId, limit)
							});
							return;
						}
						if (req.method === "POST" && routePathIs(segments, "catalog", "scan")) {
							const body = catalogScanBodySchema.parse(await readJson(req));
							if (body.sourceId !== void 0) {
								if (scope.dataAgentConnections.get(body.sessionId)?.profileId !== body.sourceId) throw new Error("sourceId does not match the session connection");
							}
							writeJson(202, {
								ok: true,
								run: await scope.dataAgentCatalogScanner.start({
									sessionId: body.sessionId,
									scope: body.scope
								})
							});
							return;
						}
						if (req.method === "POST" && routePathIs(segments, "catalog", "cancel")) {
							const body = catalogCancelBodySchema.parse(await readJson(req));
							writeJson(200, {
								ok: true,
								run: await scope.dataAgentCatalogScanner.cancel(body.sourceId, body.runId)
							});
							return;
						}
						if (req.method === "GET" && routePathIs(segments, "catalog", "search")) {
							assertOnlySearchParams(url.searchParams, [
								"sourceId",
								"query",
								"schema",
								"assetKinds",
								"semanticKinds",
								"assetStatuses",
								"semanticStatuses",
								"includeInferred",
								"cursor",
								"pageSize"
							]);
							const sourceId = requireBoundedString(url.searchParams.get("sourceId"), "sourceId");
							const query = requireBoundedString(url.searchParams.get("query"), "query", 512);
							const pageSize = optionalPositiveInteger(url.searchParams.get("pageSize"), "pageSize", 200);
							const includeInferred = optionalBooleanQuery(url.searchParams.get("includeInferred"), "includeInferred");
							const request = catalogSearchRequestSchema.parse({
								query,
								filters: {
									sourceId,
									...url.searchParams.get("schema") !== null ? { schema: url.searchParams.get("schema") } : {},
									...csvParam(url.searchParams, "assetKinds") !== void 0 ? { assetKinds: csvParam(url.searchParams, "assetKinds") } : {},
									...csvParam(url.searchParams, "semanticKinds") !== void 0 ? { semanticKinds: csvParam(url.searchParams, "semanticKinds") } : {},
									...csvParam(url.searchParams, "assetStatuses") !== void 0 ? { assetStatuses: csvParam(url.searchParams, "assetStatuses") } : {},
									...csvParam(url.searchParams, "semanticStatuses") !== void 0 ? { semanticStatuses: csvParam(url.searchParams, "semanticStatuses") } : {},
									includeInferred: includeInferred ?? false
								},
								...url.searchParams.get("cursor") !== null ? { cursor: url.searchParams.get("cursor") } : {},
								...pageSize !== void 0 ? { pageSize } : {}
							});
							writeJson(200, {
								ok: true,
								page: await scope.dataAgentCatalog.search(request)
							});
							return;
						}
						if (req.method === "GET" && segments.length === 3 && segments[0] === "catalog" && segments[1] === "assets") {
							assertOnlySearchParams(url.searchParams, [
								"sourceId",
								"cursor",
								"pageSize"
							]);
							const sourceId = requireBoundedString(url.searchParams.get("sourceId"), "sourceId");
							const assetId = requireBoundedString(segments[2], "assetId");
							const pageSize = optionalPositiveInteger(url.searchParams.get("pageSize"), "pageSize", 200);
							const cursor = optionalBoundedString(url.searchParams.get("cursor"), "cursor", 512);
							writeJson(200, {
								ok: true,
								detail: scope.dataAgentCatalog.getAsset(sourceId, assetId, cursor, pageSize)
							});
							return;
						}
						if (req.method === "GET" && routePathIs(segments, "catalog", "diff")) {
							assertOnlySearchParams(url.searchParams, [
								"sourceId",
								"from",
								"to",
								"cursor",
								"pageSize"
							]);
							const sourceId = requireBoundedString(url.searchParams.get("sourceId"), "sourceId");
							const fromRunId = optionalBoundedString(url.searchParams.get("from"), "from", 256);
							const toRunId = optionalBoundedString(url.searchParams.get("to"), "to", 256);
							if (fromRunId === void 0 !== (toRunId === void 0)) throw new Error("from and to must be supplied together");
							const cursor = optionalBoundedString(url.searchParams.get("cursor"), "cursor", 512);
							const pageSize = optionalPositiveInteger(url.searchParams.get("pageSize"), "pageSize", 200);
							writeJson(200, {
								ok: true,
								diff: scope.dataAgentCatalog.diff(sourceId, fromRunId, toRunId, cursor, pageSize)
							});
							return;
						}
						if (req.method === "GET" && segments.length === 3 && segments[0] === "catalog" && segments[1] === "semantics") {
							assertOnlySearchParams(url.searchParams, ["sourceId", "version"]);
							const sourceId = requireBoundedString(url.searchParams.get("sourceId"), "sourceId");
							const semanticId = requireBoundedString(segments[2], "semanticId");
							const version = optionalPositiveInteger(url.searchParams.get("version"), "version", Number.MAX_SAFE_INTEGER);
							writeJson(200, {
								ok: true,
								semantic: scope.dataAgentCatalog.getSemantic(sourceId, semanticId, version)
							});
							return;
						}
						if (req.method === "POST" && routePathIs(segments, "catalog", "semantics")) {
							const body = catalogSemanticSaveBodySchema.parse(await readJson(req));
							writeJson(200, {
								ok: true,
								semantic: await scope.dataAgentCatalogReview.saveCandidate(body.sourceId, body.definition, body.semanticId, body.expectedVersion)
							});
							return;
						}
						if (req.method === "POST" && segments.length === 4 && segments[0] === "catalog" && segments[1] === "semantics" && segments[3] === "verify") {
							const body = catalogSemanticVerifyBodySchema.parse(await readJson(req));
							writeJson(200, {
								ok: true,
								semantic: await scope.dataAgentCatalogReview.verify(body.sourceId, requireBoundedString(segments[2], "semanticId"), body.expectedVersion, body.definition)
							});
							return;
						}
						if (req.method === "POST" && segments.length === 4 && segments[0] === "catalog" && segments[1] === "semantics" && segments[3] === "retire") {
							const body = catalogSemanticRetireBodySchema.parse(await readJson(req));
							writeJson(200, {
								ok: true,
								semantic: await scope.dataAgentCatalogReview.retire(body.sourceId, requireBoundedString(segments[2], "semanticId"), body.expectedVersion, body.revisionNote)
							});
							return;
						}
						if (req.method === "POST" && segments.length === 4 && segments[0] === "catalog" && segments[1] === "semantics" && segments[3] === "dismiss") {
							const body = catalogSemanticDismissBodySchema.parse(await readJson(req));
							writeJson(200, {
								ok: true,
								semantic: await scope.dataAgentCatalogReview.dismissMeaning(body.sourceId, requireBoundedString(segments[2], "semanticId"), body.expectedVersion)
							});
							return;
						}
						writeJson(404, { error: "unknown data-agent route" });
					} catch (error) {
						writeJson(error instanceof CatalogVersionConflictError ? 409 : 400, {
							error: sanitizeCatalogRouteError(error instanceof Error ? error.message : String(error)),
							...error instanceof CatalogVersionConflictError ? { current: error.current } : {}
						});
					}
				}
			});
			return () => {
				dispose();
			};
		}, "data-agent-routes: routes");
	});
}
function routeIs(segments, expected) {
	return segments.length === 1 && segments[0] === expected;
}
function routePathIs(segments, ...expected) {
	return segments.length === expected.length && segments.every((value, index) => value === expected[index]);
}
const catalogScanBodySchema = z$1.strictObject({
	sessionId: z$1.string().min(1).max(256),
	sourceId: z$1.string().min(1).max(256).optional(),
	scope: catalogScopeSchema
});
const catalogCancelBodySchema = z$1.strictObject({
	sourceId: z$1.string().min(1).max(256),
	runId: z$1.string().min(1).max(256).optional()
});
const catalogSemanticSaveBodySchema = z$1.strictObject({
	sourceId: z$1.string().min(1).max(256),
	semanticId: z$1.string().min(1).max(256).optional(),
	expectedVersion: z$1.number().int().nonnegative().optional(),
	definition: semanticDefinitionSchema
});
const catalogSemanticVerifyBodySchema = z$1.strictObject({
	sourceId: z$1.string().min(1).max(256),
	expectedVersion: z$1.number().int().positive(),
	definition: semanticDefinitionSchema
});
const catalogSemanticRetireBodySchema = z$1.strictObject({
	sourceId: z$1.string().min(1).max(256),
	expectedVersion: z$1.number().int().positive(),
	revisionNote: z$1.string().trim().min(1).max(4096)
});
const catalogSemanticDismissBodySchema = z$1.strictObject({
	sourceId: z$1.string().min(1).max(256),
	expectedVersion: z$1.number().int().positive()
});
async function readJson(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.byteLength;
		if (size > 1048576) throw new Error("JSON request body exceeds 1 MiB");
		chunks.push(buffer);
	}
	const raw = Buffer.concat(chunks).toString("utf8");
	return raw.length === 0 ? {} : JSON.parse(raw);
}
function requestSignal(req) {
	const controller = new AbortController();
	req.once("aborted", () => controller.abort(/* @__PURE__ */ new Error("HTTP request aborted")));
	return controller.signal;
}
function requireString(value, label) {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${label} 必须是非空字符串`);
	return value;
}
function optionalString(value, label) {
	if (value === void 0 || value === "") return void 0;
	if (typeof value !== "string") throw new Error(`${label} 必须是字符串`);
	return value;
}
function optionalBoolean(value, label) {
	if (value === void 0) return void 0;
	if (typeof value !== "boolean") throw new Error(`${label} 必须是布尔值`);
	return value;
}
function requireBoundedString(value, label, max = 256) {
	if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new Error(`${label} must be a non-empty string of at most ${max} characters`);
	return value;
}
function optionalBoundedString(value, label, max) {
	if (value === void 0 || value === null || value === "") return void 0;
	return requireBoundedString(value, label, max);
}
function optionalPositiveInteger(value, label, max) {
	if (value === null || value === "") return void 0;
	const number = Number(value);
	if (!Number.isInteger(number) || number < 1 || number > max) throw new Error(`${label} must be an integer between 1 and ${max}`);
	return number;
}
function optionalBooleanQuery(value, label) {
	if (value === null || value === "") return void 0;
	if (value === "true") return true;
	if (value === "false") return false;
	throw new Error(`${label} must be true or false`);
}
function csvParam(search, name) {
	const value = search.get(name);
	if (value === null || value === "") return void 0;
	const items = value.split(",");
	if (items.some((item) => item.length === 0 || item.length > 64) || items.length > 32) throw new Error(`${name} is invalid`);
	return items;
}
function assertOnlySearchParams(search, allowed) {
	const accepted = new Set(allowed);
	const seen = /* @__PURE__ */ new Set();
	for (const key of search.keys()) {
		if (!accepted.has(key)) throw new Error(`Unknown query parameter: ${key}`);
		if (seen.has(key)) throw new Error(`Duplicate query parameter: ${key}`);
		seen.add(key);
	}
}
function sanitizeCatalogRouteError(message) {
	return message.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/(?:\/[^\s/:]+){3,}/g, "[PATH]").slice(0, 4096);
}
//#endregion
export { Config, DATA_AGENT_PATH, apply, inject, name, validateConnectBody };
