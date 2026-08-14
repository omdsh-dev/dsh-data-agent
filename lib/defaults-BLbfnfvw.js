import z from "schemastery";
//#region src/clients.ts
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
* validated by the caller (`[A-Za-z0-9_$#.-]`) before they reach here.
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
			case "mysql": return `SHOW TABLES FROM \`${schema}\`;`;
			case "postgres": return `SELECT tablename FROM pg_tables WHERE schemaname='${schema}' ORDER BY 1;`;
			case "sqlite": return "SELECT name FROM sqlite_master WHERE type='table' ORDER BY 1;";
			case "oracle": return `SELECT table_name FROM all_tables WHERE owner='${schema}' ORDER BY 1;`;
			case "hive":
			case "impala": return `SHOW TABLES IN ${schema};`;
		}
		case "describe": switch (type) {
			case "mysql": return `DESCRIBE \`${schema}\`.\`${table}\`;`;
			case "postgres": return `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='${schema}' AND table_name='${table}' ORDER BY ordinal_position;`;
			case "sqlite": return `PRAGMA table_info("${table}");`;
			case "oracle": return `SELECT column_name, data_type, nullable FROM all_tab_columns WHERE owner='${schema}' AND table_name='${table}' ORDER BY column_id;`;
			case "hive":
			case "impala": return `DESCRIBE ${schema}.${table};`;
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
* sqlcmd tool half (`src/tool.ts`). Loader schemas carry these as their
* defaults so a deployment may override every one of them in cordis.yml.
* @module @deepseek-ai/dsh-data-agent/defaults
*/
/** Preset directory name installed into `$DSH_HOME/.agent-presets/`. */
const DEFAULT_PRESET_ID = "data-agent";
/** End-to-end deadline for one `/connect` connectivity check, milliseconds. */
const DEFAULT_CONNECT_TIMEOUT_MS = 1e4;
/** End-to-end deadline for one sqlcmd query, milliseconds. */
const DEFAULT_QUERY_TIMEOUT_MS = 3e4;
/** In-memory cap on sqlcmd captured output (stdout and stderr each). */
const DEFAULT_MAX_RESULT_CHARS = 2e4;
/** Cap on one /query SQL text length (abuse guard; the wire body stays small). */
const DEFAULT_MAX_QUERY_CHARS = 65536;
/** Grace period for the subprocess terminate escalation. */
const DEFAULT_GRACE_MS = 5e3;
//#endregion
export { DEFAULT_PRESET_ID as a, buildIntrospectTemplate as c, parseColumns as d, parseListing as f, DEFAULT_MAX_RESULT_CHARS as i, clientsSchema as l, tableListingSql as m, DEFAULT_GRACE_MS as n, DEFAULT_QUERY_TIMEOUT_MS as o, parseTableListing as p, DEFAULT_MAX_QUERY_CHARS as r, buildClientTemplate as s, DEFAULT_CONNECT_TIMEOUT_MS as t, metadataQuery as u };
