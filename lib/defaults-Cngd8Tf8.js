//#region src/database-types.ts
/**
* Browser-safe database type descriptors shared by every DSH surface.
* Keep this module dependency-free: server-only client/process details belong
* in the database adapters, not in Web or persistence bundles.
*/
const DATABASE_TYPES = [
	"mysql",
	"postgres",
	"sqlite",
	"oracle",
	"hive",
	"impala",
	"clickhouse",
	"doris",
	"sqlserver"
];
const DATABASE_TYPE_DESCRIPTORS = {
	mysql: {
		type: "mysql",
		label: "MySQL",
		localeKey: "type.mysql",
		defaultPort: 3306,
		defaultUser: "root",
		fileBased: false
	},
	postgres: {
		type: "postgres",
		label: "PostgreSQL",
		localeKey: "type.postgres",
		defaultPort: 5432,
		defaultUser: "postgres",
		fileBased: false
	},
	sqlite: {
		type: "sqlite",
		label: "SQLite",
		localeKey: "type.sqlite",
		defaultPort: 0,
		defaultUser: "",
		fileBased: true
	},
	oracle: {
		type: "oracle",
		label: "Oracle",
		localeKey: "type.oracle",
		defaultPort: 1521,
		defaultUser: "",
		fileBased: false
	},
	hive: {
		type: "hive",
		label: "Hive",
		localeKey: "type.hive",
		defaultPort: 1e4,
		defaultUser: "",
		fileBased: false
	},
	impala: {
		type: "impala",
		label: "Impala",
		localeKey: "type.impala",
		defaultPort: 21050,
		defaultUser: "",
		fileBased: false
	},
	clickhouse: {
		type: "clickhouse",
		label: "ClickHouse",
		localeKey: "type.clickhouse",
		defaultPort: 8123,
		securePort: 8443,
		defaultUser: "default",
		fileBased: false
	},
	doris: {
		type: "doris",
		label: "Apache Doris",
		localeKey: "type.doris",
		defaultPort: 9030,
		defaultUser: "root",
		fileBased: false
	},
	sqlserver: {
		type: "sqlserver",
		label: "SQL Server",
		localeKey: "type.sqlserver",
		defaultPort: 1433,
		defaultUser: "sa",
		fileBased: false
	}
};
function isDatabaseType(value) {
	return typeof value === "string" && DATABASE_TYPES.includes(value);
}
function defaultDatabasePort(type, secure = false) {
	const descriptor = DATABASE_TYPE_DESCRIPTORS[type];
	return secure && descriptor.securePort !== void 0 ? descriptor.securePort : descriptor.defaultPort;
}
function defaultDatabaseUser(type) {
	return DATABASE_TYPE_DESCRIPTORS[type].defaultUser;
}
function databaseTypeLabel(type) {
	return DATABASE_TYPE_DESCRIPTORS[type].label;
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
/** Hard row cap for one structured Web workbench result/export. */
const WORKBENCH_MAX_EXPORT_ROWS = 5e4;
/** Bounded capture size for the larger structured Web workbench result. */
const WORKBENCH_MAX_RESULT_CHARS = 33554432;
/** Cap on one /query SQL text length (abuse guard; the wire body stays small). */
const DEFAULT_MAX_QUERY_CHARS = 65536;
/** Grace period for the subprocess terminate escalation. */
const DEFAULT_GRACE_MS = 5e3;
//#endregion
export { DEFAULT_PRESET_ID as a, WORKBENCH_MAX_RESULT_CHARS as c, defaultDatabasePort as d, defaultDatabaseUser as f, DEFAULT_MAX_RESULT_CHARS as i, DATABASE_TYPES as l, DEFAULT_GRACE_MS as n, DEFAULT_QUERY_TIMEOUT_MS as o, isDatabaseType as p, DEFAULT_MAX_QUERY_CHARS as r, WORKBENCH_MAX_EXPORT_ROWS as s, DEFAULT_CONNECT_TIMEOUT_MS as t, databaseTypeLabel as u };
