import z from "schemastery";
//#region src/sql.ts
/**
* Lightweight SQL-text scanning helpers shared by the sqlcmd tool half and
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
	args: z.array(z.string())
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
//#region src/defaults.ts
/**
* Package-wide defaults shared by the server half (`src/index.ts`) and the
* database tool half (`src/tool.ts`). Loader schemas carry these as their
* defaults so a deployment may override every one of them in cordis.yml.
* @module @yejiming/dsh-data-agent/defaults
*/
/** Preset directory name installed into `$DSH_HOME/.agent-presets/`. */
const DEFAULT_PRESET_ID = "data-agent";
/** End-to-end deadline for one `/connect` connectivity check, milliseconds. */
const DEFAULT_CONNECT_TIMEOUT_MS = 1e4;
/** End-to-end deadline for one database-tool query, milliseconds. */
const DEFAULT_QUERY_TIMEOUT_MS = 3e4;
/** In-memory cap on database-tool captured output (stdout and stderr each). */
const DEFAULT_MAX_RESULT_CHARS = 2e4;
/** Cap on one /query SQL text length (abuse guard; the wire body stays small). */
const DEFAULT_MAX_QUERY_CHARS = 65536;
/** Grace period for the subprocess terminate escalation. */
const DEFAULT_GRACE_MS = 5e3;
//#endregion
export { sanitizeIdentifier as _, DEFAULT_PRESET_ID as a, buildIntrospectTemplate as c, clientsSchema as d, enforceReadRowLimit as f, parseTableListing as g, parseListing as h, DEFAULT_MAX_RESULT_CHARS as i, buildStructuredQueryTemplate as l, parseColumns as m, DEFAULT_GRACE_MS as n, DEFAULT_QUERY_TIMEOUT_MS as o, metadataQuery as p, DEFAULT_MAX_QUERY_CHARS as r, buildClientTemplate as s, DEFAULT_CONNECT_TIMEOUT_MS as t, classifyStatement as u, tableListingSql as v, assertSingleStatement as y };
