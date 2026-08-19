import { i as DEFAULT_MAX_RESULT_CHARS, l as DATABASE_TYPES, o as DEFAULT_QUERY_TIMEOUT_MS, p as isDatabaseType, r as DEFAULT_MAX_QUERY_CHARS, t as DEFAULT_CONNECT_TIMEOUT_MS } from "./defaults-Cngd8Tf8.js";
import { resolve } from "node:path";
import z from "schemastery";
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
	ctx.inject(["webServer", "dataAgentConnections"], (scope) => {
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
						writeJson(404, { error: "unknown data-agent route" });
					} catch (error) {
						writeJson(400, { error: error instanceof Error ? error.message : String(error) });
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
async function readJson(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
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
//#endregion
export { Config, DATA_AGENT_PATH, apply, inject, name, validateConnectBody };
