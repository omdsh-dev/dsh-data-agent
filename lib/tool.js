import { i as DEFAULT_MAX_RESULT_CHARS, l as clientsSchema, o as DEFAULT_QUERY_TIMEOUT_MS } from "./defaults-DcyUOySz.js";
import { t as runClientQuery } from "./query-Ba5C9pul.js";
import z from "schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region src/tool.ts
/** Cordis plugin name (diagnostics only). */
const name = "data-agent-tool";
/** Services required before the tool can register. */
const inject = [
	"tools",
	"subprocess",
	"dataAgentConnections"
];
/** Loader schema with deployment defaults (no library defaults). */
const Config = z.object({
	queryTimeoutMs: z.number().step(1).min(1e3).default(DEFAULT_QUERY_TIMEOUT_MS),
	maxResultChars: z.number().step(1).min(1024).default(DEFAULT_MAX_RESULT_CHARS),
	maxRows: z.number().step(1).min(1).default(100),
	clients: clientsSchema
});
/** One-line sqlcmd label for the terminal card (newlines collapsed). */
function oneLine(sql) {
	const line = sql.replace(/\s+/g, " ").trim();
	return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}
/** Format the canonical result as a monospace text block. */
function formatResult(value) {
	const parts = [];
	if (value.stdout.length > 0) parts.push(value.stdout);
	if (value.stderr.length > 0) parts.push(`[stderr]\n${value.stderr}`);
	if (value.truncated) parts.push("… 输出超过上限，已截断（可缩小查询或增加 maxResultChars）");
	if (value.exitCode !== 0) parts.push(`[exit code: ${value.exitCode ?? "signal"}]`);
	return parts.join("\n");
}
/**
* Mount the sqlcmd tool: register it into the current agent's tool registry.
* @param ctx - the preset-scoped agent context.
* @param config - validated loader configuration.
*/
function apply(ctx, config) {
	const resolved = {
		queryTimeoutMs: config.queryTimeoutMs,
		maxResultChars: config.maxResultChars,
		maxRows: config.maxRows,
		clients: config.clients
	};
	ctx.tools.register(defineTool({
		name: "sqlcmd",
		description: `在已连接的数据库上执行 SQL 或客户端命令（如 SHOW TABLES、DESCRIBE users、SELECT * FROM orders LIMIT ${resolved.maxRows}）。需要先在「数据库」标签页连接数据库；SQL 经 stdin 传给客户端（mysql/psql/sqlite3），无 shell 层。结果包含 exitCode 与 stdout/stderr 文本。`,
		parameters: { sql: {
			type: "string",
			required: true,
			description: "要执行的 SQL 文本（或客户端命令），如 \"SHOW TABLES;\"、\"DESCRIBE users;\"、\"SELECT * FROM orders LIMIT 5;\""
		} },
		output: {
			schema: {
				type: "object",
				properties: {
					exitCode: {
						oneOf: [{ type: "integer" }, { type: "null" }],
						required: true
					},
					stdout: {
						type: "string",
						required: true
					},
					stderr: {
						type: "string",
						required: true
					},
					truncated: {
						type: "boolean",
						required: true
					}
				},
				additionalProperties: false
			},
			render: (_args, value) => [{
				type: "text",
				text: formatResult(value)
			}]
		},
		presentCall: (args) => ({
			card: "terminal",
			title: `sqlcmd ${oneLine(args.sql)}`,
			description: "在数据库客户端执行 SQL"
		}),
		presentResult: (args, result) => ({
			card: "terminal",
			title: `sqlcmd ${oneLine(args.sql)}`,
			content: result.content
		}),
		async execute(args, exec) {
			const sessionId = exec.agent?.id;
			if (sessionId === void 0) throw new Error("sqlcmd: 缺少会话上下文（agent loop 未注入）");
			const connection = ctx.dataAgentConnections.getWithSecret(sessionId);
			if (connection === void 0) throw new Error("请先在「数据库」标签页连接数据库，再使用 sqlcmd（未找到当前会话的连接）");
			return runClientQuery(ctx, connection, args.sql, {
				clients: resolved.clients,
				timeoutMs: resolved.queryTimeoutMs,
				maxResultChars: resolved.maxResultChars
			}, exec.signal);
		}
	}));
}
//#endregion
export { Config, apply, inject, name };
