import "./defaults-DP4RyRh1.js";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, resolve, win32 } from "node:path";
import z from "schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
//#region src/sql.ts
/**
* Lightweight SQL-text scanning helpers shared by the sql-cmd tool half and
* the /query route. This is intentionally NOT a SQL parser: the scanner only
* understands lexical boundaries (strings, quoted identifiers, comments and
* parenthesis depth) well enough to make the two agent-loop guarantees from
* docs/optimization-opportunities.md:
*
* - a single tool call carries at most ONE SQL statement;
* - `maxRows` can be enforced with a real top-level LIMIT, not just a prompt.
*
* @module @yejiming/dsh-data-agent/sql
*/
const IDENT_CHAR = /[A-Za-z0-9_$]/;
function isWhitespace(char) {
	return /\s/.test(char);
}
function isIdentChar(char) {
	return IDENT_CHAR.test(char);
}
function skipQuoted(sql, start) {
	const quote = sql[start];
	let index = start + 1;
	while (index < sql.length) {
		const char = sql[index];
		if (char === "\\" && index + 1 < sql.length && quote !== "`") {
			index += 2;
			continue;
		}
		if (char === quote) {
			if (sql[index + 1] === quote) {
				index += 2;
				continue;
			}
			return index + 1;
		}
		index += 1;
	}
	return sql.length;
}
function skipDollarQuoted(sql, start) {
	const match = sql.slice(start).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
	if (match === null) return -1;
	const delimiter = match[0];
	const end = sql.indexOf(delimiter, start + delimiter.length);
	return end === -1 ? sql.length : end + delimiter.length;
}
function skipOracleQuoted(sql, start) {
	if (!/^q'/i.test(sql.slice(start, start + 2))) return -1;
	const open = sql[start + 2];
	if (open === void 0) return sql.length;
	const close = {
		"[": "]",
		"{": "}",
		"(": ")",
		"<": ">"
	}[open] ?? open;
	let index = start + 3;
	while (index < sql.length) {
		if (sql[index] === close && sql[index + 1] === "'") return index + 2;
		index += 1;
	}
	return sql.length;
}
function skipBlockComment(sql, start) {
	let depth = 1;
	let index = start + 2;
	while (index < sql.length) {
		if (sql.startsWith("/*", index)) {
			depth += 1;
			index += 2;
			continue;
		}
		if (sql.startsWith("*/", index)) {
			depth -= 1;
			index += 2;
			if (depth === 0) return index;
			continue;
		}
		index += 1;
	}
	return sql.length;
}
function skipLineComment(sql, start) {
	const newline = sql.indexOf("\n", start);
	return newline === -1 ? sql.length : newline + 1;
}
/**
* Walk the SQL text, invoking `onSemicolon` for every top-level statement
* separator (parenthesis depth zero, outside strings, quoted identifiers and
* comments).
*/
function scanTopLevelSemicolons(sql, onSemicolon) {
	let depth = 0;
	let index = 0;
	while (index < sql.length) {
		const char = sql[index];
		if (isWhitespace(char)) {
			index += 1;
			continue;
		}
		if (sql.startsWith("--", index)) {
			index = skipLineComment(sql, index + 2);
			continue;
		}
		if (sql.startsWith("/*", index)) {
			index = skipBlockComment(sql, index);
			continue;
		}
		if (char === "'" || char === "\"" || char === "`") {
			index = skipQuoted(sql, index);
			continue;
		}
		if (char === "$") {
			const dollarEnd = skipDollarQuoted(sql, index);
			if (dollarEnd !== -1) {
				index = dollarEnd;
				continue;
			}
		}
		const oracleEnd = skipOracleQuoted(sql, index);
		if (oracleEnd !== -1) {
			index = oracleEnd;
			continue;
		}
		if (char === "(") {
			depth += 1;
			index += 1;
			continue;
		}
		if (char === ")") {
			depth = Math.max(0, depth - 1);
			index += 1;
			continue;
		}
		if (char === ";" && depth === 0) onSemicolon(index);
		index += 1;
	}
}
/** Whether meaningful SQL content exists after `index` (trailing `;`/comments ignored). */
function hasContentAfter(sql, index) {
	let cursor = index;
	while (cursor < sql.length) {
		const char = sql[cursor];
		if (isWhitespace(char)) {
			cursor += 1;
			continue;
		}
		if (char === ";") {
			cursor += 1;
			continue;
		}
		if (sql.startsWith("--", cursor)) {
			cursor = skipLineComment(sql, cursor + 2);
			continue;
		}
		if (sql.startsWith("/*", cursor)) {
			cursor = skipBlockComment(sql, cursor);
			continue;
		}
		return true;
	}
	return false;
}
/**
* Throw unless `sql` contains at most one statement. A single trailing
* semicolon (and any number of repeated trailing semicolons / comments) is
* accepted; a semicolon followed by real content is rejected.
*/
function assertSingleStatement(sql, label = "SQL") {
	if (stripTrailingTerminator(sql).trim().length === 0) throw new Error(`${label}: SQL 不能为空`);
	const semicolons = [];
	scanTopLevelSemicolons(sql, (index) => {
		semicolons.push(index);
	});
	const offending = semicolons.find((index) => hasContentAfter(sql, index + 1));
	if (offending === void 0) return;
	throw new Error(`${label}: 一次只允许执行一条 SQL 语句（第 ${offending + 1} 个字符后的分号不是末尾分号）。多条语句请拆成多次调用；客户端进程独立、自动提交，不支持在多次调用间保持事务。`);
}
/** Whether `keyword` appears at top level as a whole word in `sql`. */
function hasTopLevelKeyword(sql, keyword) {
	const needle = keyword.toLowerCase();
	let depth = 0;
	let index = 0;
	while (index < sql.length) {
		const char = sql[index];
		if (isWhitespace(char)) {
			index += 1;
			continue;
		}
		if (sql.startsWith("--", index)) {
			index = skipLineComment(sql, index + 2);
			continue;
		}
		if (sql.startsWith("/*", index)) {
			index = skipBlockComment(sql, index);
			continue;
		}
		if (char === "'" || char === "\"" || char === "`") {
			index = skipQuoted(sql, index);
			continue;
		}
		if (char === "$") {
			const dollarEnd = skipDollarQuoted(sql, index);
			if (dollarEnd !== -1) {
				index = dollarEnd;
				continue;
			}
		}
		const oracleEnd = skipOracleQuoted(sql, index);
		if (oracleEnd !== -1) {
			index = oracleEnd;
			continue;
		}
		if (char === "(") {
			depth += 1;
			index += 1;
			continue;
		}
		if (char === ")") {
			depth = Math.max(0, depth - 1);
			index += 1;
			continue;
		}
		if (depth === 0 && sql.slice(index, index + needle.length).toLowerCase() === needle && (index === 0 || !isIdentChar(sql[index - 1])) && (index + needle.length >= sql.length || !isIdentChar(sql[index + needle.length]))) return true;
		index += 1;
	}
	return false;
}
function trailingLineCommentStart(sql, end) {
	let index = sql.lastIndexOf("\n", end - 1) + 1;
	while (index < end) {
		const char = sql[index];
		if (char === "'" || char === "\"" || char === "`") {
			index = skipQuoted(sql, index);
			continue;
		}
		if (sql.startsWith("--", index)) {
			const tail = sql.slice(index + 2, end);
			return tail.length === 0 || isWhitespace(tail[0]) ? index : -1;
		}
		index += 1;
	}
	return -1;
}
function blockCommentEndingAt(sql, end) {
	let candidate = -1;
	let index = 0;
	while (index < end) {
		const char = sql[index];
		if (isWhitespace(char)) {
			index += 1;
			continue;
		}
		if (char === "'" || char === "\"" || char === "`") {
			index = skipQuoted(sql, index);
			continue;
		}
		if (sql.startsWith("--", index)) {
			index = skipLineComment(sql, index + 2);
			continue;
		}
		if (sql.startsWith("/*", index)) {
			const start = index;
			let commentDepth = 1;
			index += 2;
			while (index < end && commentDepth > 0) {
				if (sql.startsWith("/*", index)) {
					commentDepth += 1;
					index += 2;
					continue;
				}
				if (sql.startsWith("*/", index)) {
					commentDepth -= 1;
					index += 2;
					if (commentDepth === 0) {
						if (index === end) candidate = start;
						break;
					}
					continue;
				}
				index += 1;
			}
			continue;
		}
		index += 1;
	}
	return candidate;
}
/**
* Strip trailing whitespace, statement terminators and trailing comments so a
* limit clause can be appended to the actual statement text. Only comments
* that occupy the whole tail are removed; the preceding statement is kept.
*/
function stripTrailingTerminator(sql) {
	let end = sql.length;
	for (;;) {
		while (end > 0 && isWhitespace(sql[end - 1])) end -= 1;
		if (end > 0 && sql[end - 1] === ";") {
			end -= 1;
			continue;
		}
		if (end >= 2 && sql.slice(end - 2, end) === "*/") {
			const start = blockCommentEndingAt(sql, end);
			if (start !== -1) {
				end = start;
				continue;
			}
		}
		const lineComment = trailingLineCommentStart(sql, end);
		if (lineComment !== -1) {
			end = lineComment;
			continue;
		}
		return sql.slice(0, end);
	}
}
//#endregion
//#region src/clients.ts
/**
* Whitespace / comment stripping for {@link classifyStatement}: remove
* leading whitespace, `--` line comments, and nested `/* ... *​/` block
* comments so the first meaningful token can be read reliably.
*/
function stripLeadingComments(sql) {
	let rest = sql;
	for (;;) {
		let changed = false;
		const trimmed = rest.replace(/^\s+/, "");
		if (trimmed !== rest) {
			rest = trimmed;
			changed = true;
		}
		if (rest.startsWith("--")) {
			const newline = rest.indexOf("\n");
			rest = newline === -1 ? "" : rest.slice(newline + 1);
			changed = true;
			continue;
		}
		if (rest.startsWith("/*")) {
			const end = scanBlockCommentEnd(rest, 2);
			rest = end === -1 ? "" : rest.slice(end);
			changed = true;
			continue;
		}
		if (!changed) {
			const retrim = rest.replace(/^\s+/, "");
			if (retrim !== rest) {
				rest = retrim;
				continue;
			}
			break;
		}
	}
	return rest;
}
/** Find the index just past a `/* ... *​/` block starting at `start` (nesting-aware). */
function scanBlockCommentEnd(sql, start) {
	let depth = 1;
	let i = start;
	while (i < sql.length) {
		if (sql.startsWith("/*", i)) {
			depth += 1;
			i += 2;
			continue;
		}
		if (sql.startsWith("*/", i)) {
			depth -= 1;
			i += 2;
			if (depth === 0) return i;
			continue;
		}
		i += 1;
	}
	return -1;
}
/**
* Strip a `WITH` prefix down to the main query: remove `WITH [RECURSIVE]`,
* then consume successive `name [ (cols) ] AS ( ... )` clauses (comma
* separated, parenthesis-aware) until the leading keyword of the main
* statement. Falls back to the whole (comment-stripped) input when the CTE
* shape does not parse cleanly, in which case {@link classifyStatement} treats
* it as a write (conservative).
*/
function stripWithBody(sql) {
	let rest = stripLeadingComments(sql).replace(/^[A-Za-z_]+/, "");
	rest = stripLeadingComments(rest);
	if (/^RECURSIVE\b/i.test(rest)) rest = stripLeadingComments(rest.replace(/^[A-Za-z_]+/, ""));
	for (;;) {
		rest = stripLeadingComments(rest);
		if (rest === "" || !/^[A-Za-z_][A-Za-z0-9_$]*/.test(rest)) break;
		rest = stripLeadingComments(rest.replace(/^[A-Za-z_][A-Za-z0-9_$]*/, ""));
		rest = stripLeadingComments(rest);
		if (rest.startsWith("(")) {
			const afterCols = skipParens(rest, 0);
			rest = stripLeadingComments(afterCols === -1 ? rest : rest.slice(afterCols));
		}
		rest = stripLeadingComments(rest);
		if (!/^AS\b/i.test(rest)) break;
		rest = stripLeadingComments(rest.replace(/^[A-Za-z_]+/, ""));
		rest = stripLeadingComments(rest);
		if (!rest.startsWith("(")) break;
		const afterBody = skipParens(rest, 0);
		if (afterBody === -1) return sql;
		rest = stripLeadingComments(rest.slice(afterBody));
		rest = stripLeadingComments(rest);
		if (rest.startsWith(",")) {
			rest = stripLeadingComments(rest.slice(1));
			continue;
		}
		break;
	}
	return stripLeadingComments(rest);
}
/** Index just past a balanced parenthesis group starting at `start` (0-based). */
function skipParens(sql, start) {
	let depth = 0;
	let i = start;
	while (i < sql.length) {
		const ch = sql[i];
		if (ch === "(") {
			depth += 1;
			i += 1;
			continue;
		}
		if (ch === ")") {
			depth -= 1;
			i += 1;
			if (depth === 0) return i;
			continue;
		}
		i += 1;
	}
	return -1;
}
/**
* Classify a SQL text as a read or write statement by its FIRST effective
* token (a conservative read whitelist, not a parser). `with` is read only
* when its body's first token is `select`. SQLite `pragma` is read in its
* query form and write when a value is assigned.
*/
function classifyStatement(sql, type) {
	const rest = stripLeadingComments(sql);
	const tokenMatch = rest.match(/^[A-Za-z_]+/);
	if (tokenMatch === null) return "write";
	switch (tokenMatch[0].toLowerCase()) {
		case "select":
		case "show":
		case "describe":
		case "desc":
		case "explain": return "read";
		case "pragma": {
			if (type !== "sqlite") return "write";
			const afterPragma = rest.replace(/^pragma\b/i, "").trimStart();
			return /^(?:[A-Za-z_][A-Za-z0-9_$]*(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_$]*)?|"[^"]+"|`[^`]+`)\s*=/.test(afterPragma) ? "write" : "read";
		}
		case "with": return stripWithBody(rest).match(/^[A-Za-z_]+/)?.[0]?.toLowerCase() === "select" ? "read" : "write";
		default: return "write";
	}
}
/**
* Enforce the configured `maxRows` on a read query instead of relying on the
* prompt. SELECT/CTE-read statements get a real top-level LIMIT (Oracle uses
* a ROWNUM wrapper because it has no LIMIT); SHOW/DESCRIBE/EXPLAIN/PRAGMA are
* left untouched here and are capped while parsing structured output.
*
* An existing numeric top-level LIMIT is rewritten when it is larger than
* `maxRows`; a smaller existing LIMIT is preserved, and a non-numeric or
* unparseable LIMIT is left for the client (structured tools still truncate).
*/
function enforceReadRowLimit(sql, type, maxRows) {
	if (classifyStatement(sql, type) !== "read") return sql;
	const first = stripLeadingComments(sql).match(/^[A-Za-z_]+/)?.[0]?.toLowerCase();
	if (first !== "select" && first !== "with") return sql;
	const hadTrailingSemicolon = /;\s*$/.test(sql);
	if (!hasTopLevelKeyword(sql, "limit") && type !== "oracle") return `${stripTrailingTerminator(sql)} LIMIT ${maxRows}${hadTrailingSemicolon ? ";" : ""}`;
	if (type === "oracle") return `SELECT * FROM (${stripTrailingTerminator(sql)}) dsh_limit WHERE ROWNUM <= ${maxRows}${hadTrailingSemicolon ? ";" : ""}`;
	if (!hasTopLevelKeyword(sql, "limit")) return sql;
	return rewriteTopLevelLimit(sql, maxRows);
}
/** Rewrite the first top-level `LIMIT n` / `LIMIT n, m` with a capped row count. */
function rewriteTopLevelLimit(sql, maxRows) {
	let depth = 0;
	let index = 0;
	while (index < sql.length) {
		const char = sql[index];
		if (/\s/.test(char)) {
			index += 1;
			continue;
		}
		if (sql.startsWith("--", index)) {
			const newline = sql.indexOf("\n", index + 2);
			index = newline === -1 ? sql.length : newline + 1;
			continue;
		}
		if (sql.startsWith("/*", index)) {
			let depthComment = 1;
			index += 2;
			while (index < sql.length && depthComment > 0) {
				if (sql.startsWith("/*", index)) {
					depthComment += 1;
					index += 2;
					continue;
				}
				if (sql.startsWith("*/", index)) {
					depthComment -= 1;
					index += 2;
					continue;
				}
				index += 1;
			}
			continue;
		}
		if (char === "'" || char === "\"" || char === "`") {
			const quote = char;
			index += 1;
			while (index < sql.length) {
				if (sql[index] === "\\" && index + 1 < sql.length && quote !== "`") {
					index += 2;
					continue;
				}
				if (sql[index] === quote) {
					if (sql[index + 1] === quote) {
						index += 2;
						continue;
					}
					index += 1;
					break;
				}
				index += 1;
			}
			continue;
		}
		if (char === "(") {
			depth += 1;
			index += 1;
			continue;
		}
		if (char === ")") {
			depth = Math.max(0, depth - 1);
			index += 1;
			continue;
		}
		if (depth === 0 && sql.slice(index, index + 5).toLowerCase() === "limit" && (index === 0 || !/[A-Za-z0-9_$]/.test(sql[index - 1])) && (index + 5 >= sql.length || !/[A-Za-z0-9_$]/.test(sql[index + 5]))) {
			const match = sql.slice(index).match(/^LIMIT\s+(ALL|\d+)(\s*,\s*\d+)?/i);
			if (match === null) return sql;
			const firstValue = match[1];
			const hasOffsetPart = match[2] !== void 0;
			let replacement = "";
			if (hasOffsetPart) {
				const rowCount = Number(match[2].match(/\d+/)[0]);
				replacement = `LIMIT ${firstValue === "ALL" ? "0" : firstValue}, ${Math.min(rowCount, maxRows)}`;
			} else if (/^\d+$/.test(firstValue)) replacement = `LIMIT ${Math.min(Number(firstValue), maxRows)}`;
			else replacement = `LIMIT ${maxRows}`;
			return sql.slice(0, index) + replacement + sql.slice(index + match[0].length);
		}
		index += 1;
	}
	return sql;
}
/**
* Validate and quote one schema/table identifier for a safe metadata query.
* Identifiers are restricted to `[A-Za-z0-9_$]+` and then wrapped per type:
* backticks (mysql/hive/impala) or double quotes (postgres/oracle/sqlite),
* with the wrapping quote doubled for any interior occurrence. Rejects any
* input that could cross the identifier boundary (`#`, `--`, `;`, `'`, `` ` ``,
* `"`, `.`, `-` are all refused).
*/
function sanitizeIdentifier(type, identifier) {
	if (!/^[A-Za-z0-9_$]+$/.test(identifier)) throw new Error(`标识符含非法字符（仅允许字母、数字与 _ $）：${identifier}`);
	switch (type) {
		case "mysql":
		case "hive":
		case "impala": return "`" + identifier.replace(/`/g, "``") + "`";
		case "postgres":
		case "oracle":
		case "sqlite": return "\"" + identifier.replace(/"/g, "\"\"") + "\"";
	}
}
/**
* Quote one identifier-shaped value as a SQL string literal (single quotes,
* interior `'` doubled). postgres/oracle metadata queries filter system
* catalogs by NAME (a string value), not by identifier, so those positions
* need a quoted literal — not {@link sanitizeIdentifier}'s identifier quoting.
* The whitelist already excludes `'`, so doubling is a defense-in-depth no-op
* here but keeps the helper correct for any future widened charset.
*/
function quoteStringLiteral(value) {
	return "'" + value.replace(/'/g, "''") + "'";
}
/** Loader schema for one client override (all fields optional at input). */
const clientConfigSchema = z.object({
	command: z.string(),
	args: z.array(z.string()),
	searchPaths: z.array(z.string())
});
/** Loader schema for the whole `clients` config object (any type key). */
const clientsSchema = z.dict(clientConfigSchema).default({});
/** Query-mode flag arguments per type (plain/human output). */
const QUERY_ARGS = {
	mysql: ["--batch", "--raw"],
	postgres: ["-A"],
	sqlite: ["-header", "-column"],
	oracle: ["-S", "/nolog"],
	hive: ["--silent=true", "--outputformat=tsv2"],
	impala: ["-B"]
};
/** Introspection-mode flag arguments per type (machine-readable listing). */
const INTROSPECT_ARGS = {
	mysql: ["--batch", "--raw"],
	postgres: ["-t", "-A"],
	sqlite: ["-noheader", "-list"],
	oracle: ["-S", "/nolog"],
	hive: ["--silent=true", "--outputformat=tsv2"],
	impala: ["-B"]
};
/** Structured `sql-query` flag arguments: header + one row per line. */
const STRUCTURED_QUERY_ARGS = {
	mysql: ["--batch", "--raw"],
	postgres: ["-A"],
	sqlite: ["-header", "-csv"],
	oracle: ["-S", "/nolog"],
	hive: ["--silent=true", "--outputformat=tsv2"],
	impala: ["-B", "--print_header"]
};
/** Default ports when the connection does not carry one. */
const DEFAULT_PORTS = {
	mysql: 3306,
	postgres: 5432,
	sqlite: 0,
	oracle: 1521,
	hive: 1e4,
	impala: 21050
};
/** Built-in commands per type (also the loader defaults; see `src/defaults.ts`). */
const DEFAULT_CLIENTS_COMMAND = {
	mysql: "mysql",
	postgres: "psql",
	sqlite: "sqlite3",
	oracle: "sqlplus",
	hive: "beeline",
	impala: "impala-shell"
};
/**
* Connection flags for one type. Oracle and Hive carry NO connection flags:
* their endpoint + credentials travel in the stdin prefix; Impala takes
* `-i host:port -d db` on the argv. SQLite's `database` file is positional
* and must come AFTER the flags.
*/
function connectionArgs(type, connection) {
	switch (type) {
		case "mysql": return [
			"-h",
			connection.host ?? "127.0.0.1",
			"-P",
			String(connection.port ?? DEFAULT_PORTS.mysql),
			"-u",
			connection.user ?? "root",
			"-D",
			connection.database
		];
		case "postgres": return [
			"-h",
			connection.host ?? "127.0.0.1",
			"-p",
			String(connection.port ?? DEFAULT_PORTS.postgres),
			"-U",
			connection.user ?? "postgres",
			"-d",
			connection.database
		];
		case "sqlite": return [connection.database];
		case "impala": return [
			"-i",
			`${connection.host ?? "127.0.0.1"}:${connection.port ?? DEFAULT_PORTS.impala}`,
			"-d",
			connection.database
		];
		case "oracle":
		case "hive": return [];
	}
}
/** Credential environment entries per type; absent password yields an empty env. */
function credentialEnv(type, connection) {
	const password = connection.password;
	if (password === void 0) return {};
	switch (type) {
		case "mysql": return { MYSQL_PWD: password };
		case "postgres": return { PGPASSWORD: password };
		case "sqlite":
		case "oracle":
		case "hive":
		case "impala": return {};
	}
}
/**
* The stdin prefix per type: Oracle and Hive establish the session here, so
* their credentials never appear in argv. Oracle also silences sqlplus
* decoration (PAGESIZE/FEEDBACK/HEADING) and pins the column separator to
* `|` for the describe parser; Hive connects through beeline's `!connect`.
*/
function stdinPrefix(type, connection) {
	switch (type) {
		case "oracle": return `${[
			"SET PAGESIZE 0",
			"SET FEEDBACK OFF",
			"SET HEADING OFF",
			"SET COLSEP '|'",
			"SET TRIMSPOOL ON",
			connection.user !== void 0 ? `connect ${connection.user}${connection.password !== void 0 ? `/${connection.password}` : ""}@${connection.host ?? "127.0.0.1"}:${connection.port ?? DEFAULT_PORTS.oracle}/${connection.database}` : ""
		].filter((line) => line !== "").join("\n")}\n`;
		case "hive": return connection.user !== void 0 ? `!connect jdbc:hive2://${connection.host ?? "127.0.0.1"}:${connection.port ?? DEFAULT_PORTS.hive}/${connection.database} ${connection.user} ${connection.password ?? ""}\n` : "";
		case "mysql":
		case "postgres":
		case "sqlite":
		case "impala": return "";
	}
}
/**
* Oracle structured-query prefix: same connect block as {@link stdinPrefix},
* but with HEADING ON and UNDERLINE OFF so `sql-query` can read the column
* names from the first output line.
*/
function structuredStdinPrefix(type, connection) {
	if (type !== "oracle") return stdinPrefix(type, connection);
	return `${[
		"SET PAGESIZE 0",
		"SET FEEDBACK OFF",
		"SET HEADING ON",
		"SET UNDERLINE OFF",
		"SET COLSEP '|'",
		"SET TRIMSPOOL ON",
		connection.user !== void 0 ? `connect ${connection.user}${connection.password !== void 0 ? `/${connection.password}` : ""}@${connection.host ?? "127.0.0.1"}:${connection.port ?? DEFAULT_PORTS.oracle}/${connection.database}` : ""
	].filter((line) => line !== "").join("\n")}\n`;
}
/** Apply one deployment override's extra args in front of the built-in flags. */
function withOverrides(flags, override) {
	if (override === void 0 || override.args === void 0) return flags;
	return [...override.args, ...flags];
}
/**
* Build one client invocation for a query execution (plain output). Flags
* come BEFORE the connection arguments everywhere: sqlite3 takes
* `[options] <database>`, and putting flags first is harmless for the others.
*/
function buildClientTemplate(type, connection, override) {
	return {
		command: override?.command ?? DEFAULT_CLIENTS_COMMAND[type],
		args: [...withOverrides(QUERY_ARGS[type], override), ...connectionArgs(type, connection)],
		env: credentialEnv(type, connection),
		stdinPrefix: stdinPrefix(type, connection)
	};
}
/** Build one client invocation for metadata runs (machine-readable flags). */
function buildIntrospectTemplate(type, connection, override) {
	return {
		command: override?.command ?? DEFAULT_CLIENTS_COMMAND[type],
		args: [...withOverrides(INTROSPECT_ARGS[type], override), ...connectionArgs(type, connection)],
		env: credentialEnv(type, connection),
		stdinPrefix: stdinPrefix(type, connection)
	};
}
/**
* Build one client invocation for the structured `sql-query` tool: every
* supported client prints a header row followed by one row per line (mysql
* tab, postgres pipe, sqlite csv, oracle pipe, hive/impala tsv).
*/
function buildStructuredQueryTemplate(type, connection, override) {
	return {
		command: override?.command ?? DEFAULT_CLIENTS_COMMAND[type],
		args: [...withOverrides(STRUCTURED_QUERY_ARGS[type], override), ...connectionArgs(type, connection)],
		env: credentialEnv(type, connection),
		stdinPrefix: structuredStdinPrefix(type, connection)
	};
}
/**
* The table-listing SQL per type, run at /connect time to verify
* connectivity: the connected database's own tables (mysql uses the
* connection's database as the schema; postgres lists `public`; oracle lists
* the connected user's tables; hive/impala list the default database).
*/
function tableListingSql(type, connection) {
	switch (type) {
		case "mysql": return `SHOW TABLES FROM \`${connection?.database ?? ""}\`;`;
		case "postgres": return "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1;";
		case "sqlite": return "SELECT name FROM sqlite_master WHERE type='table' ORDER BY 1;";
		case "oracle": return "SELECT table_name FROM user_tables ORDER BY 1;";
		case "hive":
		case "impala": return "SHOW TABLES;";
	}
}
/**
* Metadata query per kind × type. `schema`/`table` are identifier whitelist
* validated by the caller (`[A-Za-z0-9_$]`) before they reach here.
*/
function metadataQuery(kind, type, schema, table) {
	switch (kind) {
		case "schemas": switch (type) {
			case "mysql": return "SHOW DATABASES;";
			case "postgres": return "SELECT schema_name FROM information_schema.schemata ORDER BY 1;";
			case "sqlite": return "SELECT 'main';";
			case "oracle": return "SELECT username FROM all_users ORDER BY 1;";
			case "hive":
			case "impala": return "SHOW DATABASES;";
		}
		case "tables": switch (type) {
			case "mysql": return `SHOW TABLES FROM ${sanitizeIdentifier(type, schema)};`;
			case "postgres": return `SELECT tablename FROM pg_tables WHERE schemaname=${quoteStringLiteral(schema)} ORDER BY 1;`;
			case "sqlite": return "SELECT name FROM sqlite_master WHERE type='table' ORDER BY 1;";
			case "oracle": return `SELECT table_name FROM all_tables WHERE owner=${quoteStringLiteral(schema)} ORDER BY 1;`;
			case "hive":
			case "impala": return `SHOW TABLES IN ${sanitizeIdentifier(type, schema)};`;
		}
		case "describe": switch (type) {
			case "mysql": return `DESCRIBE ${sanitizeIdentifier(type, schema)}.${sanitizeIdentifier(type, table)};`;
			case "postgres": return `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema=${quoteStringLiteral(schema)} AND table_name=${quoteStringLiteral(table)} ORDER BY ordinal_position;`;
			case "sqlite": return `PRAGMA table_info(${sanitizeIdentifier(type, table)});`;
			case "oracle": return `SELECT column_name, data_type, nullable FROM all_tab_columns WHERE owner=${quoteStringLiteral(schema)} AND table_name=${quoteStringLiteral(table)} ORDER BY column_id;`;
			case "hive":
			case "impala": return `DESCRIBE ${sanitizeIdentifier(type, schema)}.${sanitizeIdentifier(type, table)};`;
		}
	}
}
/**
* Split one type's machine-readable listing output into trimmed lines.
* Header lines are stripped per type: mysql `--batch` prints a header row
* (skip 1); postgres `-t`, sqlite `-noheader`, oracle `SET HEADING OFF`,
* hive/impala batch modes print none (skip 0).
*/
function parseListing(type, stdout) {
	const lines = stdout.split("\n");
	const start = type === "mysql" ? 1 : 0;
	const items = [];
	for (let index = start; index < lines.length; index += 1) {
		const name = lines[index].trim();
		if (name.length > 0) items.push(name);
	}
	return items;
}
/** Parse one type's table-listing output (the /connect connectivity check). */
function parseTableListing(type, stdout) {
	return parseListing(type, stdout);
}
/**
* Parse one type's describe output into columns. Formats:
* - mysql `--batch`: `Field\tType\tNull\tKey\t...` (skip header);
* - postgres `-t -A`: `name|type|is_nullable`;
* - sqlite `-noheader -list`: `cid|name|type|notnull|dflt|pk` (name is part 1);
* - oracle (`SET COLSEP '|'`, heading off): `NAME|TYPE|NULLABLE`;
* - hive/impala batch: `name\ttype\tcomment`.
*/
function parseColumns(type, stdout) {
	const lines = stdout.split("\n");
	const start = type === "mysql" ? 1 : 0;
	const columns = [];
	for (let index = start; index < lines.length; index += 1) {
		const line = lines[index].trim();
		if (line.length === 0) continue;
		const parts = line.includes("	") ? line.split("	") : line.split("|");
		const nameIndex = type === "sqlite" ? 1 : 0;
		const name = parts[nameIndex]?.trim() ?? "";
		const columnType = parts[nameIndex + 1]?.trim() ?? "";
		if (name.length === 0) continue;
		const rawNullable = parts[nameIndex + 2]?.trim().toLowerCase();
		let nullable;
		switch (type) {
			case "mysql":
				nullable = rawNullable === "yes";
				break;
			case "postgres":
				nullable = rawNullable === "yes";
				break;
			case "sqlite":
				nullable = rawNullable !== "1";
				break;
			case "oracle":
				nullable = rawNullable === "y";
				break;
			case "hive":
			case "impala": nullable = void 0;
		}
		columns.push({
			name,
			type: columnType,
			...nullable !== void 0 ? { nullable } : {}
		});
	}
	return columns;
}
//#endregion
//#region src/client-discovery.ts
/**
* Cross-platform database CLI discovery.
*
* The subprocess provider remains the authority for executable validation.
* This module only builds a bounded, platform-aware PATH fallback when the
* provider cannot resolve the configured/default bare command from its
* current execution environment. No shell, registry, or recursive scan is
* involved, and the exact discovery environment is returned for spawn.
* @module @yejiming/dsh-data-agent/client-discovery
*/
/** Maximum child names consumed from one known version/formula directory. */
const MAX_DYNAMIC_ENTRIES = 64;
/** Production host facts. */
const DEFAULT_SYSTEM = {
	platform: process.platform,
	env: process.env,
	homeDir: homedir(),
	cwd: process.cwd(),
	async readDirectory(directory) {
		return await readdir(directory);
	}
};
const HOME_ENV_BY_TYPE = {
	mysql: ["MYSQL_HOME"],
	postgres: ["PGHOME", "PGROOT"],
	sqlite: ["SQLITE_HOME"],
	oracle: ["ORACLE_HOME"],
	hive: ["HIVE_HOME"],
	impala: ["IMPALA_HOME"]
};
function pathApi(platform) {
	return platform === "win32" ? win32 : posix;
}
function environmentValue(env, name, platform) {
	if (platform !== "win32") return env[name];
	const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
	return key === void 0 ? void 0 : env[key];
}
function expandHome(directory, system, paths) {
	const trimmed = directory.trim();
	if (trimmed === "~") return system.homeDir;
	if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return paths.join(system.homeDir, trimmed.slice(2));
	return paths.isAbsolute(trimmed) ? paths.normalize(trimmed) : paths.resolve(system.cwd, trimmed);
}
function normalizeDirectories(directories, system, paths) {
	const result = [];
	const seen = /* @__PURE__ */ new Set();
	for (const raw of directories) {
		if (raw.trim() === "") continue;
		const directory = expandHome(raw, system, paths);
		const key = system.platform === "win32" ? directory.toLowerCase() : directory;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(directory);
	}
	return result;
}
function clientHomeDirectories(type, system, paths) {
	const result = [];
	for (const name of HOME_ENV_BY_TYPE[type]) {
		const value = environmentValue(system.env, name, system.platform)?.trim();
		if (value === void 0 || value === "") continue;
		result.push(paths.join(value, "bin"), value);
	}
	return result;
}
function macFixedDirectories(type) {
	return [
		"/opt/homebrew/bin",
		...{
			mysql: [
				"/opt/homebrew/opt/mysql-client/bin",
				"/opt/homebrew/opt/mysql/bin",
				"/usr/local/opt/mysql-client/bin",
				"/usr/local/opt/mysql/bin",
				"/usr/local/mysql/bin"
			],
			postgres: [
				"/opt/homebrew/opt/libpq/bin",
				"/usr/local/opt/libpq/bin",
				"/Applications/Postgres.app/Contents/Versions/latest/bin"
			],
			sqlite: ["/opt/homebrew/opt/sqlite/bin", "/usr/local/opt/sqlite/bin"],
			oracle: [],
			hive: ["/opt/homebrew/opt/hive/bin", "/usr/local/opt/hive/bin"],
			impala: ["/opt/homebrew/opt/impala/bin", "/usr/local/opt/impala/bin"]
		}[type],
		"/usr/local/bin",
		"/opt/local/bin",
		"/usr/bin"
	];
}
function linuxFixedDirectories(system, paths) {
	return [
		paths.join(system.homeDir, ".local", "bin"),
		"/home/linuxbrew/.linuxbrew/bin",
		paths.join(system.homeDir, ".linuxbrew", "bin"),
		"/usr/local/bin",
		"/usr/bin",
		"/snap/bin",
		paths.join(system.homeDir, ".nix-profile", "bin"),
		"/nix/var/nix/profiles/default/bin"
	];
}
function windowsFixedDirectories(type, system, paths) {
	const localAppData = environmentValue(system.env, "LOCALAPPDATA", system.platform);
	const userProfile = environmentValue(system.env, "USERPROFILE", system.platform) ?? system.homeDir;
	const chocolatey = environmentValue(system.env, "ChocolateyInstall", system.platform);
	const programData = environmentValue(system.env, "ProgramData", system.platform) ?? "C:\\ProgramData";
	const programFiles = environmentValue(system.env, "ProgramFiles", system.platform) ?? "C:\\Program Files";
	const typeSpecific = {
		mysql: [],
		postgres: [],
		sqlite: [paths.join("C:\\", "sqlite"), paths.join(programFiles, "SQLite")],
		oracle: [],
		hive: [],
		impala: []
	};
	return [
		...localAppData === void 0 ? [] : [paths.join(localAppData, "Microsoft", "WinGet", "Links")],
		paths.join(userProfile, "scoop", "shims"),
		...chocolatey === void 0 ? [] : [paths.join(chocolatey, "bin")],
		paths.join(programData, "chocolatey", "bin"),
		...typeSpecific[type]
	];
}
function formulaPattern(type) {
	switch (type) {
		case "mysql": return /^(?:mysql|mysql-client)(?:@.+)?$/i;
		case "postgres": return /^(?:postgresql(?:@.+)?|libpq)$/i;
		case "sqlite": return /^sqlite(?:@.+)?$/i;
		case "oracle": return /^(?:oracle|instantclient)(?:@.+)?$/i;
		case "hive": return /^hive(?:@.+)?$/i;
		case "impala": return /^impala(?:@.+)?$/i;
	}
}
function dynamicDirectories(type, system, paths) {
	const result = [];
	if (system.platform === "darwin") {
		const pattern = formulaPattern(type);
		result.push({
			root: "/opt/homebrew/opt",
			accepts: (name) => pattern.test(name),
			suffix: ["bin"]
		}, {
			root: "/usr/local/opt",
			accepts: (name) => pattern.test(name),
			suffix: ["bin"]
		});
		if (type === "postgres") result.push({
			root: "/Library/PostgreSQL",
			accepts: () => true,
			suffix: ["bin"]
		}, {
			root: "/Applications/Postgres.app/Contents/Versions",
			accepts: (name) => name !== "latest",
			suffix: ["bin"]
		});
		if (type === "oracle") result.push({
			root: "/opt/oracle",
			accepts: (name) => /^instantclient/i.test(name),
			suffix: []
		});
	} else if (system.platform === "linux") {
		const pattern = formulaPattern(type);
		result.push({
			root: "/home/linuxbrew/.linuxbrew/opt",
			accepts: (name) => pattern.test(name),
			suffix: ["bin"]
		}, {
			root: paths.join(system.homeDir, ".linuxbrew", "opt"),
			accepts: (name) => pattern.test(name),
			suffix: ["bin"]
		});
	} else if (system.platform === "win32") {
		const roots = [environmentValue(system.env, "ProgramFiles", system.platform) ?? "C:\\Program Files", environmentValue(system.env, "ProgramFiles(x86)", system.platform) ?? "C:\\Program Files (x86)"];
		for (const root of roots) if (type === "mysql") result.push({
			root: paths.join(root, "MySQL"),
			accepts: () => true,
			suffix: ["bin"]
		}, {
			root,
			accepts: (name) => /^MariaDB/i.test(name),
			suffix: ["bin"]
		});
		else if (type === "postgres") result.push({
			root: paths.join(root, "PostgreSQL"),
			accepts: () => true,
			suffix: ["bin"]
		});
		else if (type === "oracle") result.push({
			root: paths.join(root, "Oracle"),
			accepts: () => true,
			suffix: ["bin"]
		});
	}
	return result;
}
async function expandDynamicDirectories(descriptors, system, paths, signal) {
	return (await Promise.all(descriptors.map(async (descriptor) => {
		signal.throwIfAborted();
		let names;
		try {
			names = await system.readDirectory(descriptor.root);
		} catch {
			return [];
		}
		signal.throwIfAborted();
		return names.filter((name) => descriptor.accepts(name)).sort((left, right) => right.localeCompare(left, void 0, {
			numeric: true,
			sensitivity: "base"
		})).slice(0, MAX_DYNAMIC_ENTRIES).map((name) => paths.join(descriptor.root, name, ...descriptor.suffix));
	}))).flat();
}
/** Build ordered fallback directories without recursively scanning the host. */
async function buildClientSearchDirectories(type, config, signal, system = DEFAULT_SYSTEM) {
	const paths = pathApi(system.platform);
	const configured = config?.searchPaths ?? [];
	const homes = clientHomeDirectories(type, system, paths);
	const fixed = system.platform === "win32" ? windowsFixedDirectories(type, system, paths) : system.platform === "darwin" ? macFixedDirectories(type) : linuxFixedDirectories(system, paths);
	const dynamic = await expandDynamicDirectories(dynamicDirectories(type, system, paths), system, paths, signal);
	signal.throwIfAborted();
	return normalizeDirectories([
		...configured,
		...homes,
		...fixed,
		...dynamic
	], system, paths);
}
function hasPathSeparator(command) {
	return command.includes("/") || command.includes("\\");
}
function withSearchPath(explicitEnv, directories, system) {
	const pathName = system.platform === "win32" ? Object.keys(system.env).find((name) => name.toLowerCase() === "path") ?? "Path" : "PATH";
	const explicitPathName = Object.keys(explicitEnv).find((name) => system.platform === "win32" ? name.toLowerCase() === "path" : name === "PATH");
	const parentPath = explicitPathName === void 0 ? environmentValue(system.env, "PATH", system.platform) : explicitEnv[explicitPathName];
	const separator = system.platform === "win32" ? ";" : ":";
	const prefix = directories.join(separator);
	const combined = parentPath === void 0 || parentPath === "" ? prefix : `${prefix}${separator}${parentPath}`;
	const result = { ...explicitEnv };
	if (explicitPathName !== void 0 && explicitPathName !== pathName) delete result[explicitPathName];
	result[pathName] = combined;
	return result;
}
function errorText(error) {
	return error instanceof Error ? error.message : String(error);
}
function checkedDirectoriesText(directories) {
	const visible = directories.slice(0, 16);
	const suffix = directories.length > visible.length ? `，另有${directories.length - visible.length}个目录` : "";
	return visible.length === 0 ? "无补充目录" : `${visible.join("、")}${suffix}`;
}
/**
* Resolve one configured/default client. Current PATH (or an explicit path)
* always wins. Only a missing bare command activates bounded PATH discovery.
*/
async function resolveClientExecutable(options) {
	const system = options.system ?? DEFAULT_SYSTEM;
	let initialError;
	try {
		return {
			executable: await options.resolveExecutable(options.command, options.env, options.signal),
			env: options.env,
			searchedDirectories: []
		};
	} catch (error) {
		options.signal.throwIfAborted();
		initialError = error;
	}
	if (pathApi(system.platform).isAbsolute(options.command) || hasPathSeparator(options.command)) throw new Error(`无法解析数据库客户端 "${options.command}"（类型 ${options.type}：${errorText(initialError)}）；该显式路径不会回退到默认命令，请检查 clients.${options.type}.command`);
	const directories = await buildClientSearchDirectories(options.type, options.config, options.signal, system);
	const discoveryEnv = withSearchPath(options.env, directories, system);
	try {
		return {
			executable: await options.resolveExecutable(options.command, discoveryEnv, options.signal),
			env: discoveryEnv,
			searchedDirectories: directories
		};
	} catch (fallbackError) {
		options.signal.throwIfAborted();
		throw new Error(`无法解析数据库客户端 "${options.command}"（类型 ${options.type}；当前PATH：${errorText(initialError)}；补充PATH：${errorText(fallbackError)}）。已检查：${checkedDirectoriesText(directories)}；请确认客户端已安装，或配置 clients.${options.type}.command / clients.${options.type}.searchPaths`);
	}
}
//#endregion
//#region src/query.ts
/** Read one collected stream from offset 0. */
function readCaptured(reader) {
	if (reader === void 0) return {
		text: "",
		truncated: false
	};
	const read = reader.readFrom(0);
	return {
		text: read.text,
		truncated: read.lossy
	};
}
/**
* Run one SQL text through the type's CLI client. The SQL is written to the
* child's stdin (`{ data }` batch disposition) so it never appears in argv;
* passwords travel in the env entries built by the template.
*
* Failure classification:
* - the caller's external signal (e.g. the tool exec signal) aborts → the
*   abort reason propagates;
* - the internal timeout fires → an Error naming the deadline is thrown;
* - the executable cannot be resolved → an Error naming the command is thrown;
* - the process runs to completion → `{ exitCode, stdout, stderr, truncated }`
*   is returned even for a non-zero exit (the caller decides what that means).
* @param ctx - context exposing the subprocess service.
* @param connection - the stored connection (password included).
* @param sql - the SQL text (or client command) to run.
* @param options - timeouts, caps, client overrides.
* @param externalSignal - caller-owned cancellation (the tool exec signal).
* @param introspect - use the machine-readable introspection flag set.
* @returns the captured outcome.
*/
async function runClientQuery(ctx, connection, sql, options, externalSignal, introspect = false) {
	const template = options.mode === "structured" ? buildStructuredQueryTemplate(connection.type, connection, options.clients[connection.type]) : options.mode === "introspect" || introspect ? buildIntrospectTemplate(connection.type, connection, options.clients[connection.type]) : buildClientTemplate(connection.type, connection, options.clients[connection.type]);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(/* @__PURE__ */ new Error(`查询超过 ${options.timeoutMs}ms 未完成，已终止客户端进程`)), options.timeoutMs);
	const onExternalAbort = () => {
		controller.abort(externalSignal.reason);
	};
	if (externalSignal.aborted) controller.abort(externalSignal.reason);
	else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
	try {
		const resolution = await resolveClientExecutable({
			type: connection.type,
			command: template.command,
			config: options.clients[connection.type],
			env: template.env,
			signal: controller.signal,
			resolveExecutable: ctx.subprocess.resolveExecutable.bind(ctx.subprocess)
		});
		const handle = ctx.subprocess.spawn({
			argv: [resolution.executable, ...template.args],
			cwd: process.cwd(),
			stdio: {
				stdin: { data: `${template.stdinPrefix}${sql}\n` },
				stdout: { maxBytes: options.maxResultChars },
				stderr: { maxBytes: options.maxResultChars }
			},
			graceMs: options.graceMs ?? 5e3,
			signal: controller.signal,
			env: resolution.env
		});
		let outcome;
		try {
			outcome = await handle.done;
		} catch (error) {
			controller.signal.throwIfAborted();
			throw new Error(`启动数据库客户端失败：${error instanceof Error ? error.message : String(error)}`);
		}
		if (controller.signal.aborted) controller.signal.throwIfAborted();
		const stdout = readCaptured(handle.collected.stdout);
		const stderr = readCaptured(handle.collected.stderr);
		return {
			exitCode: outcome.exitCode,
			stdout: stdout.text,
			stderr: stderr.text,
			truncated: stdout.truncated || stderr.truncated
		};
	} finally {
		clearTimeout(timer);
		externalSignal.removeEventListener("abort", onExternalAbort);
	}
}
/** Build a password-stripped copy of one connection. */
function summarize(connection) {
	const summary = {
		type: connection.type,
		database: connection.database
	};
	if (connection.host !== void 0) summary.host = connection.host;
	if (connection.port !== void 0) summary.port = connection.port;
	if (connection.user !== void 0) summary.user = connection.user;
	if (connection.passwordRef !== void 0) summary.passwordRef = connection.passwordRef;
	if (connection.readonly !== void 0) summary.readonly = connection.readonly;
	if (connection.profileId !== void 0) summary.profileId = connection.profileId;
	if (connection.name !== void 0) summary.name = connection.name;
	if (connection.tables !== void 0) summary.tables = [...connection.tables];
	return summary;
}
/** Replace every occurrence of a resolved secret before crossing a public seam. */
function redactSecretText(text, secrets) {
	let redacted = text;
	for (const secret of secrets) if (secret !== void 0 && secret.length > 0) redacted = redacted.split(secret).join("[REDACTED]");
	return redacted;
}
/** Redact a client result without mutating the runner-owned object. */
function redactQueryResult(result, connection) {
	const secrets = [connection.password];
	return {
		...result,
		stdout: redactSecretText(result.stdout, secrets),
		stderr: redactSecretText(result.stderr, secrets)
	};
}
/** Validate/normalize a shared connect input before any I/O. */
function normalizeConnectionInput(input, cwd = process.cwd()) {
	if (!isDatabaseType(input.type)) throw new Error("数据库类型无效");
	if (typeof input.database !== "string" || input.database.trim().length === 0) throw new Error("database 必须是非空字符串");
	if (input.password !== void 0 && input.passwordRef !== void 0) throw new Error("password 与 passwordRef 不能同时提供");
	if (input.passwordRef !== void 0) validatePasswordRef(input.passwordRef);
	if (input.port !== void 0 && (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)) throw new Error("port 必须是 1-65535 的整数");
	if (input.profileId !== void 0 && input.profileId.trim().length === 0) throw new Error("profileId 不能为空");
	if (input.name !== void 0 && input.name.trim().length === 0) throw new Error("name 不能为空");
	const connection = {
		type: input.type,
		database: input.type === "sqlite" ? resolve(cwd, input.database) : input.database,
		credentialMode: input.type === "sqlite" ? "none" : input.passwordRef !== void 0 ? "reference" : input.password !== void 0 && input.password.length > 0 ? "password" : "none"
	};
	if (input.type !== "sqlite") {
		if (input.host !== void 0 && input.host.length > 0) connection.host = input.host;
		if (input.port !== void 0) connection.port = input.port;
		if (input.user !== void 0 && input.user.length > 0) connection.user = input.user;
		if (input.password !== void 0 && input.password.length > 0) connection.password = input.password;
		if (input.passwordRef !== void 0) connection.passwordRef = input.passwordRef;
	}
	if (input.readonly !== void 0) connection.readonly = input.readonly;
	if (input.profileId !== void 0) connection.profileId = input.profileId;
	if (input.name !== void 0) connection.name = input.name;
	return connection;
}
/** Create the surface-independent service. */
function createConnectionService(ctx, options, persistence) {
	const resolvedOptions = options ?? {
		connectTimeoutMs: 15e3,
		queryTimeoutMs: 3e4,
		maxResultChars: 2e5,
		maxQueryChars: 65536,
		introspectMaxTables: 500,
		readonly: false,
		clients: {}
	};
	const runtime = /* @__PURE__ */ new Map();
	const formDrafts = /* @__PURE__ */ new Map();
	const profileConnection = (sessionId) => {
		if (persistence === void 0) return void 0;
		const binding = persistence.getBinding(sessionId);
		if (binding === void 0) return void 0;
		const profile = persistence.getProfile(binding.profileId);
		return profile === void 0 ? void 0 : connectionFromProfile(binding.profileId, profile);
	};
	/** Required precedence: exact runtime, exact binding, wildcard runtime, wildcard binding. */
	const rawConnection = (sessionId) => runtime.get(sessionId) ?? profileConnection(sessionId) ?? runtime.get("*") ?? profileConnection("*");
	const requireContext = () => {
		if (ctx === void 0) throw new Error("数据库执行服务尚未配置");
		return ctx;
	};
	const resolveCredential = async (connection) => {
		const mode = credentialModeOf(connection);
		if (mode === "reference") {
			if (connection.passwordRef === void 0) throw new Error("数据库凭据引用缺失，请重新配置连接");
			const ref = validatedCredentialRef(connection.passwordRef);
			const hit = await requireContext().credentials.resolve(ref);
			if (hit === void 0 || hit.value.length === 0) throw new Error(`凭据引用 "${connection.passwordRef}" 未配置`);
			return {
				...connection,
				password: hit.value,
				tables: copyTables(connection.tables)
			};
		}
		if (mode === "password" && connection.password === void 0) throw new Error("数据库凭据需要重新输入；请打开数据库配置并重新连接");
		return {
			...connection,
			tables: copyTables(connection.tables)
		};
	};
	const queryOptions = (mode, connect = false) => ({
		clients: resolvedOptions.clients,
		timeoutMs: connect ? resolvedOptions.connectTimeoutMs : resolvedOptions.queryTimeoutMs,
		maxResultChars: resolvedOptions.maxResultChars,
		...mode !== void 0 ? { mode } : {}
	});
	const run = async (connection, sql, signal, introspection = false, connect = false) => {
		try {
			return redactQueryResult(await runClientQuery(requireContext(), connection, sql, queryOptions(void 0, connect), signal, introspection), connection);
		} catch (error) {
			const message = redactSecretText(error instanceof Error ? error.message : String(error), [connection.password]);
			throw new Error(message, error instanceof Error ? { cause: error } : void 0);
		}
	};
	const verify = async (connection, signal, connect = false) => {
		const result = await run(connection, tableListingSql(connection.type, connection), signal, true, connect);
		if (result.exitCode !== 0) {
			const detail = result.stderr.trim() !== "" ? result.stderr.trim() : result.stdout.trim();
			throw new Error(`数据库连接验证失败（exit ${result.exitCode}）：${detail}`);
		}
		return parseTableListing(connection.type, result.stdout).slice(0, resolvedOptions.introspectMaxTables);
	};
	const persistAtomically = async (sessionId, profileId, profile) => {
		if (persistence === void 0) return;
		const previousProfile = persistence.getProfile(profileId);
		const previousBinding = persistence.getBinding(sessionId);
		await persistence.putProfile(profileId, profile);
		try {
			await persistence.putBinding(sessionId, {
				profileId,
				updatedAt: profile.updatedAt
			});
		} catch (error) {
			if (previousProfile === void 0) await persistence.deleteProfile(profileId);
			else await persistence.putProfile(profileId, previousProfile);
			if (previousBinding === void 0) await persistence.deleteBinding(sessionId);
			else await persistence.putBinding(sessionId, previousBinding);
			throw error;
		}
	};
	const credentialSummary = async (connection) => {
		const mode = credentialModeOf(connection);
		if (connection.type === "sqlite" || mode === "none") return void 0;
		if (mode === "password") return connection.password === void 0 ? { configured: false } : {
			configured: true,
			source: "memory"
		};
		if (mode !== "reference" || connection.passwordRef === void 0) return { configured: false };
		const info = await requireContext().credentials.describe(validatedCredentialRef(connection.passwordRef));
		return {
			configured: info.configured,
			...info.source !== void 0 ? { source: info.source } : {}
		};
	};
	const statusSummary = async (connection) => {
		const summary = summarize(connection);
		const mode = credentialModeOf(connection);
		summary.credentialMode = mode;
		summary.credential = await credentialSummary(connection);
		const ready = mode === "none" || summary.credential?.configured === true;
		summary.ready = ready;
		summary.reconnectRequired = !ready;
		return summary;
	};
	const service = {
		set(sessionId, connection) {
			if (connection.password !== void 0 && connection.passwordRef !== void 0) throw new Error("password 与 passwordRef 不能同时提供");
			if (connection.passwordRef !== void 0) validatePasswordRef(connection.passwordRef);
			runtime.set(sessionId, {
				...connection,
				tables: copyTables(connection.tables)
			});
		},
		get(sessionId) {
			const connection = rawConnection(sessionId);
			return connection === void 0 ? void 0 : summarize(connection);
		},
		getWithSecret(sessionId) {
			const connection = rawConnection(sessionId);
			return connection === void 0 ? void 0 : {
				...connection,
				tables: copyTables(connection.tables)
			};
		},
		has(sessionId) {
			return rawConnection(sessionId) !== void 0;
		},
		clear(sessionId) {
			runtime.delete(sessionId);
		},
		getFormDraft(sessionId) {
			const draft = persistence?.getDraft?.(sessionId) ?? formDrafts.get(sessionId);
			return draft === void 0 ? void 0 : copyFormDraft(draft);
		},
		async saveFormDraft(sessionId, draft) {
			if (sessionId.length === 0) throw new Error("sessionId 必须是非空字符串");
			const safe = normalizeFormDraft(draft);
			if (persistence?.putDraft !== void 0) await persistence.putDraft(sessionId, {
				...safe,
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			});
			else formDrafts.set(sessionId, safe);
		},
		async status(sessionId) {
			const connection = rawConnection(sessionId);
			if (connection === void 0) return void 0;
			return statusSummary(connection);
		},
		async connect(sessionId, input, signal) {
			if (sessionId.length === 0) throw new Error("sessionId 必须是非空字符串");
			const normalized = normalizeConnectionInput(input, resolvedOptions.cwd);
			const execution = await resolveCredential(normalized);
			const tables = await verify(execution, signal, true);
			const profileId = normalized.profileId ?? `session:${sessionId}`;
			const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
			await persistAtomically(sessionId, profileId, profileFromConnection(normalized, updatedAt));
			const published = {
				...normalized,
				profileId,
				tables
			};
			runtime.set(sessionId, published);
			return {
				tables,
				summary: await statusSummary(published)
			};
		},
		async disconnect(sessionId) {
			runtime.delete(sessionId);
			if (persistence !== void 0) await persistence.deleteBinding(sessionId);
		},
		async test(sessionId, signal) {
			const connection = await service.resolveForExecution(sessionId);
			const tables = await verify(connection, signal);
			const published = {
				...rawConnection(sessionId),
				tables
			};
			runtime.set(sessionId, published);
			return {
				tables,
				summary: await statusSummary(published)
			};
		},
		async resolveForExecution(sessionId) {
			const connection = rawConnection(sessionId);
			if (connection === void 0) throw new Error("请先在 Web「数据库」标签页连接数据库，或在 TUI 运行 /database connect（未找到当前会话的连接）");
			return resolveCredential(connection);
		},
		async listSchemas(sessionId, signal) {
			const connection = await service.resolveForExecution(sessionId);
			const stdout = await runMetadata(connection, "schemas", signal);
			return parseListing(connection.type, stdout).slice(0, resolvedOptions.introspectMaxTables);
		},
		async listTables(sessionId, schema, signal) {
			const connection = await service.resolveForExecution(sessionId);
			if (connection.type !== "sqlite") requireIdentifier(connection.type, schema, "schema");
			const stdout = await runMetadata(connection, "tables", signal, schema);
			return parseListing(connection.type, stdout).slice(0, resolvedOptions.introspectMaxTables);
		},
		async describe(sessionId, schema, table, signal) {
			const connection = await service.resolveForExecution(sessionId);
			if (connection.type !== "sqlite") requireIdentifier(connection.type, schema, "schema");
			requireIdentifier(connection.type, table, "table");
			const stdout = await runMetadata(connection, "describe", signal, schema, table);
			return parseColumns(connection.type, stdout);
		},
		async query(sessionId, sql, signal) {
			if (sql.trim().length === 0) throw new Error("sql 必须是非空字符串");
			const maxQueryChars = resolvedOptions.maxQueryChars ?? 65536;
			if (sql.length > maxQueryChars) throw new Error(`sql 超过长度上限（${maxQueryChars} 字符）`);
			assertSingleStatement(sql, "/query");
			const connection = await service.resolveForExecution(sessionId);
			if ((connection.readonly ?? resolvedOptions.readonly) && classifyStatement(sql, connection.type) === "write") throw new Error("当前连接为只读模式，拒绝执行非读语句（仅放行 SELECT/SHOW/DESCRIBE/EXPLAIN/PRAGMA 等）");
			return run(connection, sql, signal);
		}
	};
	async function runMetadata(connection, kind, signal, schema, table) {
		const result = await run(connection, metadataQuery(kind, connection.type, schema, table), signal, true);
		if (result.exitCode !== 0) {
			const detail = result.stderr.trim() !== "" ? result.stderr.trim() : result.stdout.trim();
			throw new Error(`元数据查询失败（exit ${result.exitCode}）：${detail}`);
		}
		return result.stdout;
	}
	return service;
}
function copyTables(tables) {
	return tables === void 0 ? void 0 : [...tables];
}
function normalizeFormDraft(draft) {
	if (!isDatabaseType(draft.type)) throw new Error("数据库类型无效");
	if (typeof draft.host !== "string" || typeof draft.port !== "string" || typeof draft.user !== "string" || typeof draft.database !== "string" || typeof draft.readonly !== "boolean") throw new Error("数据库表单草稿无效");
	return copyFormDraft(draft);
}
function copyFormDraft(draft) {
	return {
		type: draft.type,
		host: draft.host,
		port: draft.port,
		user: draft.user,
		database: draft.database,
		readonly: draft.readonly
	};
}
function isDatabaseType(value) {
	return value === "mysql" || value === "postgres" || value === "sqlite" || value === "oracle" || value === "hive" || value === "impala";
}
function validatePasswordRef(value) {
	try {
		credentialRef(value);
	} catch {
		throw new Error(`passwordRef "${value}" 无效；必须是 POSIX 环境变量形式的名称`);
	}
}
function validatedCredentialRef(value) {
	validatePasswordRef(value);
	return credentialRef(value);
}
function connectionFromProfile(profileId, profile) {
	return {
		type: profile.type,
		database: profile.database,
		profileId,
		...profile.name !== void 0 ? { name: profile.name } : {},
		...profile.host !== void 0 ? { host: profile.host } : {},
		...profile.port !== void 0 ? { port: profile.port } : {},
		...profile.user !== void 0 ? { user: profile.user } : {},
		...profile.readonly !== void 0 ? { readonly: profile.readonly } : {},
		...profile.passwordRef !== void 0 ? { passwordRef: profile.passwordRef } : {},
		credentialMode: profile.credentialMode ?? (profile.type === "sqlite" ? "none" : profile.passwordRef !== void 0 ? "reference" : "password")
	};
}
function profileFromConnection(connection, updatedAt) {
	return {
		type: connection.type,
		database: connection.database,
		updatedAt,
		...connection.name !== void 0 ? { name: connection.name } : {},
		...connection.host !== void 0 ? { host: connection.host } : {},
		...connection.port !== void 0 ? { port: connection.port } : {},
		...connection.user !== void 0 ? { user: connection.user } : {},
		...connection.readonly !== void 0 ? { readonly: connection.readonly } : {},
		...connection.passwordRef !== void 0 ? { passwordRef: connection.passwordRef } : {},
		...connection.credentialMode !== void 0 ? { credentialMode: connection.credentialMode } : {}
	};
}
/** Infer legacy records while leaving ambiguous secret-less SQL profiles conservative. */
function credentialModeOf(connection) {
	if (connection.credentialMode !== void 0) return connection.credentialMode;
	if (connection.type === "sqlite") return "none";
	if (connection.passwordRef !== void 0) return "reference";
	if (connection.password !== void 0) return "password";
	return "none";
}
function requireIdentifier(type, value, label) {
	if (value === void 0 || value.length === 0) throw new Error(`${label} 不能为空`);
	sanitizeIdentifier(type, value);
	return value;
}
//#endregion
export { classifyStatement as a, assertSingleStatement as c, runClientQuery as i, redactQueryResult as n, clientsSchema as o, redactSecretText as r, enforceReadRowLimit as s, createConnectionService as t };
