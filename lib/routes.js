import { d as parseColumns, f as parseListing, i as DEFAULT_MAX_RESULT_CHARS, m as tableListingSql, o as DEFAULT_QUERY_TIMEOUT_MS, p as parseTableListing, r as DEFAULT_MAX_QUERY_CHARS, t as DEFAULT_CONNECT_TIMEOUT_MS, u as metadataQuery } from "./defaults-DcyUOySz.js";
import { t as runClientQuery } from "./query-Ba5C9pul.js";
import { resolve } from "node:path";
import z from "schemastery";
//#region src/routes.ts
/** Cordis plugin name (diagnostics only). */
const name = "data-agent-routes";
/**
* No top-level `inject` export: the row must ACTIVATE even in headless
* profiles where `webServer` never exists (a permanently pending entry
* breaks one-shot runs). The routes register through a nested inject fiber
* the moment the webserver and the connection store are both available.
*/
const inject = [];
/** Route prefix owned by this plugin (the browser half calls under it). */
const DATA_AGENT_PATH = "/plugins/data-agent";
/** Loader schema with deployment defaults (no library defaults). */
const Config = z.object({
	connectTimeoutMs: z.number().step(1).min(1e3).default(DEFAULT_CONNECT_TIMEOUT_MS),
	introspectMaxTables: z.number().step(1).min(1).default(500),
	maxResultChars: z.number().step(1).min(1024).default(DEFAULT_MAX_RESULT_CHARS),
	queryTimeoutMs: z.number().step(1).min(1e3).default(DEFAULT_QUERY_TIMEOUT_MS),
	maxQueryChars: z.number().step(1).min(1024).default(DEFAULT_MAX_QUERY_CHARS)
});
/**
* Validate an untrusted /connect body; sqlite paths resolve to absolute
* (the client resolves the path relative to its own cwd, so the server pins
* it at connect time). Oracle/Hive/Impala follow the mysql/postgres shape:
* host/port/user/database (Oracle database = service name/SID, Hive/Impala
* database = default schema).
*/
function validateConnectBody(value, cwd = process.cwd()) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("请求体必须是 JSON 对象");
	const candidate = value;
	const sessionId = candidate.sessionId;
	if (typeof sessionId !== "string" || sessionId.length === 0) throw new Error("sessionId 必须是非空字符串");
	const type = candidate.type;
	if (type !== "mysql" && type !== "postgres" && type !== "sqlite" && type !== "oracle" && type !== "hive" && type !== "impala") throw new Error("type 必须是 \"mysql\"、\"postgres\"、\"sqlite\"、\"oracle\"、\"hive\" 或 \"impala\"");
	const database = candidate.database;
	if (typeof database !== "string" || database.length === 0) throw new Error("database 必须是非空字符串" + (type === "sqlite" ? "（SQLite 为数据库文件路径）" : ""));
	if (type === "sqlite") return {
		sessionId,
		type,
		database: resolve(cwd, database)
	};
	const host = candidate.host;
	if (host !== void 0 && typeof host !== "string") throw new Error("host 必须是字符串");
	const port = candidate.port;
	if (port !== void 0 && (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error("port 必须是 1-65535 的整数");
	const user = candidate.user;
	if (user !== void 0 && typeof user !== "string") throw new Error("user 必须是字符串");
	const password = candidate.password;
	if (password !== void 0 && typeof password !== "string") throw new Error("password 必须是字符串");
	const connection = {
		type,
		database
	};
	if (typeof host === "string" && host.length > 0) connection.host = host;
	if (port !== void 0) connection.port = port;
	if (typeof user === "string" && user.length > 0) connection.user = user;
	if (typeof password === "string" && password.length > 0) connection.password = password;
	return {
		sessionId,
		type,
		database,
		...connection.host !== void 0 ? { host: connection.host } : {},
		...connection.port !== void 0 ? { port: connection.port } : {},
		...connection.user !== void 0 ? { user: connection.user } : {},
		...connection.password !== void 0 ? { password: connection.password } : {}
	};
}
/** Identifier whitelist for schema/table names in metadata queries. */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_$#.-]+$/;
/** Validate one schema/table identifier (rejects any injection-shaped input). */
function requireIdentifier(value, label) {
	if (value === null || value.length === 0) throw new Error(`${label} 不能为空`);
	if (!IDENTIFIER_PATTERN.test(value)) throw new Error(`${label} 含非法字符（仅允许字母、数字与 _ $ # . -）`);
	return value;
}
/**
* Mount the data-agent routes against the host webserver, when one exists.
* The registration rides a nested inject fiber so this row activates in every
* profile; headless profiles simply never get routes.
* @param ctx - host cordis context.
* @param config - validated loader configuration.
*/
function apply(ctx, config) {
	ctx.inject([
		"webServer",
		"subprocess",
		"dataAgentConnections"
	], (scope) => {
		const store = scope.dataAgentConnections;
		const connectOptions = {
			clients: {},
			timeoutMs: config.connectTimeoutMs,
			maxResultChars: config.maxResultChars
		};
		const queryOptions = {
			clients: {},
			timeoutMs: config.queryTimeoutMs,
			maxResultChars: config.maxResultChars
		};
		const introspectMaxTables = config.introspectMaxTables;
		/** Collect the request body into a parsed JSON value. */
		const readJson = async (req) => {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const raw = Buffer.concat(chunks).toString("utf8");
			if (raw.length === 0) return {};
			return JSON.parse(raw);
		};
		/** The stored connection for one session, failing loud when absent. */
		const requireConnection = (sessionId) => {
			const connection = store.getWithSecret(sessionId);
			if (connection === void 0) throw new Error("请先连接数据库（未找到当前会话的连接），再执行该操作");
			return connection;
		};
		/**
		* Run one metadata query in machine-readable mode and return its stdout;
		* a non-zero exit throws with the client's stderr as the message.
		*/
		const runMetadata = async (connection, kind, schema, table) => {
			const result = await runClientQuery(scope, connection, metadataQuery(kind, connection.type, schema, table), queryOptions, new AbortController().signal, true);
			if (result.exitCode !== 0) {
				const detail = result.stderr.trim() !== "" ? result.stderr.trim() : result.stdout.trim();
				throw new Error(`元数据查询失败（exit ${result.exitCode}）：${detail}`);
			}
			return result.stdout;
		};
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
						if (req.method === "POST" && segments.length === 1 && segments[0] === "connect") {
							const request = validateConnectBody(await readJson(req));
							const connection = {
								type: request.type,
								database: request.database,
								...request.host !== void 0 ? { host: request.host } : {},
								...request.port !== void 0 ? { port: request.port } : {},
								...request.user !== void 0 ? { user: request.user } : {},
								...request.password !== void 0 ? { password: request.password } : {}
							};
							const listing = await runClientQuery(scope, connection, tableListingSql(connection.type, connection), connectOptions, new AbortController().signal, true);
							if (listing.exitCode !== 0) {
								const detail = listing.stderr.trim() !== "" ? listing.stderr.trim() : listing.stdout.trim();
								writeJson(200, {
									ok: false,
									error: `数据库连接验证失败（exit ${listing.exitCode}）：${detail}`
								});
								return;
							}
							const tables = parseTableListing(connection.type, listing.stdout).slice(0, introspectMaxTables);
							connection.tables = tables;
							store.set(request.sessionId, connection);
							writeJson(200, {
								ok: true,
								tables
							});
							return;
						}
						if (req.method === "POST" && segments.length === 1 && segments[0] === "disconnect") {
							const sessionId = (await readJson(req)).sessionId;
							if (typeof sessionId !== "string" || sessionId.length === 0) throw new Error("sessionId 必须是非空字符串");
							store.clear(sessionId);
							writeJson(200, { ok: true });
							return;
						}
						if (req.method === "GET" && segments.length === 1 && segments[0] === "status") {
							const sessionId = url.searchParams.get("sessionId") ?? "";
							const summary = store.get(sessionId);
							writeJson(200, summary === void 0 ? { connected: false } : {
								connected: true,
								summary
							});
							return;
						}
						if (req.method === "GET" && segments.length === 1 && segments[0] === "schemas") {
							const sessionId = url.searchParams.get("sessionId") ?? "";
							if (sessionId.length === 0) throw new Error("sessionId 不能为空");
							const connection = requireConnection(sessionId);
							const stdout = await runMetadata(connection, "schemas");
							writeJson(200, {
								ok: true,
								schemas: parseListing(connection.type, stdout).slice(0, introspectMaxTables)
							});
							return;
						}
						if (req.method === "GET" && segments.length === 1 && segments[0] === "tables") {
							const sessionId = url.searchParams.get("sessionId") ?? "";
							if (sessionId.length === 0) throw new Error("sessionId 不能为空");
							const connection = requireConnection(sessionId);
							const stdout = await runMetadata(connection, "tables", connection.type === "sqlite" ? void 0 : requireIdentifier(url.searchParams.get("schema"), "schema"));
							writeJson(200, {
								ok: true,
								tables: parseListing(connection.type, stdout).slice(0, introspectMaxTables)
							});
							return;
						}
						if (req.method === "GET" && segments.length === 1 && segments[0] === "describe") {
							const sessionId = url.searchParams.get("sessionId") ?? "";
							if (sessionId.length === 0) throw new Error("sessionId 不能为空");
							const connection = requireConnection(sessionId);
							const stdout = await runMetadata(connection, "describe", connection.type === "sqlite" ? void 0 : requireIdentifier(url.searchParams.get("schema"), "schema"), requireIdentifier(url.searchParams.get("table"), "table"));
							writeJson(200, {
								ok: true,
								columns: parseColumns(connection.type, stdout)
							});
							return;
						}
						if (req.method === "POST" && segments.length === 1 && segments[0] === "query") {
							const body = await readJson(req);
							const sessionId = body.sessionId;
							if (typeof sessionId !== "string" || sessionId.length === 0) throw new Error("sessionId 必须是非空字符串");
							const sql = body.sql;
							if (typeof sql !== "string" || sql.trim().length === 0) throw new Error("sql 必须是非空字符串");
							if (sql.length > config.maxQueryChars) throw new Error(`sql 超过长度上限（${config.maxQueryChars} 字符）`);
							writeJson(200, {
								ok: true,
								result: await runClientQuery(scope, requireConnection(sessionId), sql, queryOptions, new AbortController().signal)
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
//#endregion
export { Config, DATA_AGENT_PATH, apply, inject, name, validateConnectBody };
