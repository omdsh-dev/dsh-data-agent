import { d as clientsSchema, f as enforceReadRowLimit, i as DEFAULT_MAX_RESULT_CHARS, o as DEFAULT_QUERY_TIMEOUT_MS, u as classifyStatement, y as assertSingleStatement } from "./defaults-Bac6QvNt.js";
import { t as runClientQuery } from "./query-CmhTFklw.js";
import z from "schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region src/structured.ts
function normalizeNewlines(text) {
	return text.replace(/\r\n?/g, "\n");
}
function splitLine(line, delimiter) {
	return line.split(delimiter);
}
/** Make column names valid unique JSON object keys. */
function uniqueColumns(columns) {
	const used = /* @__PURE__ */ new Set();
	return columns.map((raw, index) => {
		let name = raw.trim();
		if (name.length === 0) name = `column_${index + 1}`;
		if (used.has(name)) {
			let suffix = 2;
			while (used.has(`${name}_${suffix}`)) suffix += 1;
			name = `${name}_${suffix}`;
		}
		used.add(name);
		return name;
	});
}
function rowObject(columns, fields) {
	const row = {};
	for (let index = 0; index < columns.length; index += 1) row[columns[index]] = fields[index] ?? null;
	return row;
}
function emptyOutput() {
	return {
		columns: [],
		rows: [],
		rowLimitExceeded: false
	};
}
function skipLeadingBlank(lines) {
	let index = 0;
	while (index < lines.length && lines[index].trim().length === 0) index += 1;
	return index;
}
/** PostgreSQL `-A` appends a `(N rows)` / `(N row)` footer after SELECT output. */
function isPostgresFooter(line) {
	return /^\(\d+ rows?\)$/.test(line.trim());
}
function parseDelimited(stdout, delimiter, maxRows, skipFooter = false) {
	const lines = normalizeNewlines(stdout).split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	const headerIndex = skipLeadingBlank(lines);
	if (headerIndex >= lines.length) return emptyOutput();
	const columns = uniqueColumns(splitLine(lines[headerIndex], delimiter));
	const rows = [];
	let rowLimitExceeded = false;
	for (let index = headerIndex + 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (skipFooter && isPostgresFooter(line)) continue;
		if (rows.length >= maxRows) {
			rowLimitExceeded = true;
			break;
		}
		rows.push(rowObject(columns, splitLine(line, delimiter)));
	}
	return {
		columns,
		rows,
		rowLimitExceeded
	};
}
/** Minimal RFC-4180-style parser for sqlite3 `-csv` output. */
function parseCsv(text) {
	const records = [];
	let record = [];
	let field = "";
	let quoted = false;
	let index = 0;
	const pushField = () => {
		record.push(field);
		field = "";
	};
	const pushRecord = () => {
		pushField();
		records.push(record);
		record = [];
	};
	while (index < text.length) {
		const char = text[index];
		if (quoted) {
			if (char === "\"") {
				if (text[index + 1] === "\"") {
					field += "\"";
					index += 2;
					continue;
				}
				quoted = false;
				index += 1;
				continue;
			}
			field += char;
			index += 1;
			continue;
		}
		if (char === "\"" && field.length === 0) {
			quoted = true;
			index += 1;
			continue;
		}
		if (char === ",") {
			pushField();
			index += 1;
			continue;
		}
		if (char === "\n") {
			pushRecord();
			index += 1;
			continue;
		}
		if (char === "\r") {
			if (text[index + 1] === "\n") index += 1;
			pushRecord();
			index += 1;
			continue;
		}
		field += char;
		index += 1;
	}
	if (field.length > 0 || record.length > 0) pushRecord();
	return records;
}
function parseCsvOutput(stdout, maxRows) {
	const records = parseCsv(normalizeNewlines(stdout)).filter((record) => !(record.length === 1 && record[0] === ""));
	if (records.length === 0) return emptyOutput();
	const columns = uniqueColumns(records[0]);
	const rows = [];
	let rowLimitExceeded = false;
	for (let index = 1; index < records.length; index += 1) {
		if (rows.length >= maxRows) {
			rowLimitExceeded = true;
			break;
		}
		rows.push(rowObject(columns, records[index]));
	}
	return {
		columns,
		rows,
		rowLimitExceeded
	};
}
/**
* Parse one database type's structured-query stdout. The matching template is
* `buildStructuredQueryTemplate`: mysql tab-separated with a header, postgres
* pipe-separated with a header and row-count footer, sqlite CSV with a header,
* oracle pipe-separated with heading on, hive/impala tsv with a header.
*/
function parseStructuredQueryOutput(type, stdout, maxRows) {
	switch (type) {
		case "mysql": return parseDelimited(stdout, "	", maxRows);
		case "postgres": return parseDelimited(stdout, "|", maxRows, true);
		case "sqlite": return parseCsvOutput(stdout, maxRows);
		case "oracle": return parseDelimited(stdout, "|", maxRows);
		case "hive":
		case "impala": return parseDelimited(stdout, "	", maxRows);
	}
}
//#endregion
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
	readonly: z.boolean().default(false),
	clients: clientsSchema
});
/** One-line tool-call label (newlines collapsed). */
function oneLine(sql) {
	const line = sql.replace(/\s+/g, " ").trim();
	return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}
/** Format the raw terminal result. */
function formatResult(value) {
	const parts = [];
	if (value.stdout.length > 0) parts.push(value.stdout);
	if (value.stderr.length > 0) parts.push(`[stderr]\n${value.stderr}`);
	if (value.truncated) parts.push("… 输出超过上限，已截断（可缩小查询或增加 maxResultChars）");
	if (value.exitCode !== 0) parts.push(`[exit code: ${value.exitCode ?? "signal"}]`);
	return parts.join("\n");
}
/** Format the structured result as JSON text (the canonical value stays JSON). */
function formatStructuredResult(value) {
	return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}
/** Look up the session connection, failing with the same message for every tool. */
function requireToolConnection(ctx, exec, toolName) {
	const sessionId = exec.agent?.id;
	if (sessionId === void 0) throw new Error(`${toolName}: 缺少会话上下文（agent loop 未注入）`);
	const connection = ctx.dataAgentConnections.getWithSecret(sessionId);
	if (connection === void 0) throw new Error(`请先在「数据库」标签页连接数据库，再使用 ${toolName}（未找到当前会话的连接）`);
	return connection;
}
/** Empty and multi-statement checks shared by all three tools. */
function validateSingleSql(sql, toolName) {
	if (sql.trim().length === 0) throw new Error(`${toolName}: sql 不能为空`);
	assertSingleStatement(sql, toolName);
}
/** Query runner options with the deployment overrides applied. */
function runnerOptions(resolved, mode) {
	return {
		clients: resolved.clients,
		timeoutMs: resolved.queryTimeoutMs,
		maxResultChars: resolved.maxResultChars,
		...mode !== void 0 ? { mode } : {}
	};
}
/**
* Mount the data-agent database tools: `sql-query` (structured read-only),
* `sql-write` (explicit write semantics), and `sqlcmd` (raw compatibility).
* @param ctx - the preset-scoped agent context.
* @param config - validated loader configuration.
*/
function apply(ctx, config) {
	const resolved = {
		queryTimeoutMs: config.queryTimeoutMs,
		maxResultChars: config.maxResultChars,
		maxRows: config.maxRows,
		readonly: config.readonly,
		clients: config.clients
	};
	ctx.tools.register(defineTool({
		name: "sql-query",
		description: `在已连接数据库上执行一条只读 SQL（SELECT/SHOW/DESCRIBE/EXPLAIN，SQLite 还含查询型 PRAGMA），返回结构化 JSON：{ columns, rows, affectedRows, elapsedMs, truncated }。SELECT 未写 LIMIT 时会自动限制为最多 ${resolved.maxRows} 行；所有结果最多返回 ${resolved.maxRows} 行。只执行单条语句；写操作请使用 sql-write，原始客户端输出请使用 sqlcmd。`,
		parameters: { sql: {
			type: "string",
			required: true,
			description: "一条只读 SQL，如 \"SELECT * FROM orders LIMIT 5;\"、\"SHOW TABLES;\"、\"DESCRIBE users;\""
		} },
		output: {
			schema: {
				type: "object",
				properties: {
					columns: {
						type: "array",
						items: { type: "string" },
						required: true
					},
					rows: {
						type: "array",
						items: {
							type: "object",
							properties: {},
							additionalProperties: true
						},
						required: true
					},
					affectedRows: {
						type: "integer",
						required: true
					},
					elapsedMs: {
						type: "integer",
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
				text: formatStructuredResult(value)
			}]
		},
		presentCall: (args) => ({
			card: "generic",
			kind: "read",
			title: `sql-query ${oneLine(args.sql)}`,
			rawInput: args.sql
		}),
		presentResult: (args, result) => ({
			card: "generic",
			title: `sql-query ${oneLine(args.sql)}`,
			content: result.content
		}),
		async execute(args, exec) {
			const connection = requireToolConnection(ctx, exec, "sql-query");
			validateSingleSql(args.sql, "sql-query");
			if (classifyStatement(args.sql, connection.type) !== "read") throw new Error("sql-query 只执行读语句（SELECT/SHOW/DESCRIBE/EXPLAIN，SQLite 还含查询型 PRAGMA）；写语句请使用 sql-write");
			const limitedSql = enforceReadRowLimit(args.sql, connection.type, resolved.maxRows);
			const startedAt = Date.now();
			const result = await runClientQuery(ctx, connection, limitedSql, runnerOptions(resolved, "structured"), exec.signal);
			const elapsedMs = Date.now() - startedAt;
			if (result.exitCode !== 0) {
				const detail = result.stderr.trim() !== "" ? result.stderr.trim() : result.stdout.trim();
				throw new Error(`sql-query 执行失败（exit ${result.exitCode}）：${detail}`);
			}
			const parsed = parseStructuredQueryOutput(connection.type, result.stdout, resolved.maxRows);
			return {
				columns: parsed.columns,
				rows: parsed.rows,
				affectedRows: 0,
				elapsedMs,
				truncated: result.truncated || parsed.rowLimitExceeded
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "sql-write",
		description: "在已连接数据库上执行一条写/管理语句（INSERT/UPDATE/DELETE/DDL 等）。每次调用都是独立客户端进程并自动提交，只接受单条语句，不支持跨调用的多语句事务；如需原子性，请改用单条 SQL（如 INSERT ... SELECT）或数据库端脚本/存储过程。只读查询请使用 sql-query。",
		parameters: { sql: {
			type: "string",
			required: true,
			description: "一条写/管理 SQL，如 \"INSERT INTO t VALUES (1);\"、\"UPDATE t SET x=1;\"、\"CREATE INDEX idx_t_x ON t(x);\""
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
			title: `sql-write ${oneLine(args.sql)}`,
			description: "执行一条写/管理 SQL（自动提交）"
		}),
		presentResult: (args, result) => ({
			card: "terminal",
			title: `sql-write ${oneLine(args.sql)}`,
			content: result.content
		}),
		async execute(args, exec) {
			const connection = requireToolConnection(ctx, exec, "sql-write");
			validateSingleSql(args.sql, "sql-write");
			if (classifyStatement(args.sql, connection.type) === "read") throw new Error("sql-write 只执行写/管理语句；只读查询请使用 sql-query");
			if (connection.readonly ?? resolved.readonly) throw new Error("当前连接为只读模式，sql-write 拒绝执行写/管理语句（仅放行 SELECT/SHOW/DESCRIBE/EXPLAIN/查询型 PRAGMA 等）");
			return runClientQuery(ctx, connection, args.sql, runnerOptions(resolved), exec.signal);
		}
	}));
	ctx.tools.register(defineTool({
		name: "sqlcmd",
		description: `在已连接数据库上执行一条 SQL 或客户端命令（如 SHOW TABLES、DESCRIBE users），返回原始 exitCode/stdout/stderr 文本。新调用优先使用 sql-query（结构化只读结果）和 sql-write（明确写语义）。一次只执行一条语句；读 SELECT 会自动限制最多 ${resolved.maxRows} 行；每次调用为独立客户端进程并自动提交。`,
		parameters: { sql: {
			type: "string",
			required: true,
			description: "一条 SQL 文本（或客户端命令），如 \"SHOW TABLES;\"、\"DESCRIBE users;\"、\"SELECT * FROM orders LIMIT 5;\""
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
			description: "在数据库客户端执行一条 SQL"
		}),
		presentResult: (args, result) => ({
			card: "terminal",
			title: `sqlcmd ${oneLine(args.sql)}`,
			content: result.content
		}),
		async execute(args, exec) {
			const connection = requireToolConnection(ctx, exec, "sqlcmd");
			validateSingleSql(args.sql, "sqlcmd");
			if ((connection.readonly ?? resolved.readonly) && classifyStatement(args.sql, connection.type) === "write") throw new Error("当前连接为只读模式，sqlcmd 拒绝执行非读语句（仅放行 SELECT/SHOW/DESCRIBE/EXPLAIN/查询型 PRAGMA 等）");
			const sql = classifyStatement(args.sql, connection.type) === "read" ? enforceReadRowLimit(args.sql, connection.type, resolved.maxRows) : args.sql;
			return runClientQuery(ctx, connection, sql, runnerOptions(resolved), exec.signal);
		}
	}));
}
//#endregion
export { Config, apply, inject, name };
