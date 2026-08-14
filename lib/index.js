import { a as DEFAULT_PRESET_ID, i as DEFAULT_MAX_RESULT_CHARS, o as DEFAULT_QUERY_TIMEOUT_MS, t as DEFAULT_CONNECT_TIMEOUT_MS, u as clientsSchema } from "./defaults-Dgu2B2Yq.js";
import { access, cp, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import z from "schemastery";
/** Build the password-stripped copy of one connection. */
function summarize(connection) {
	const summary = {
		type: connection.type,
		database: connection.database
	};
	if (connection.host !== void 0) summary.host = connection.host;
	if (connection.port !== void 0) summary.port = connection.port;
	if (connection.user !== void 0) summary.user = connection.user;
	if (connection.readonly !== void 0) summary.readonly = connection.readonly;
	if (connection.tables !== void 0) summary.tables = [...connection.tables];
	return summary;
}
/** Create a fresh connection store (per-process singleton, one per plugin instance). */
function createConnectionStore() {
	const connections = /* @__PURE__ */ new Map();
	/** Exact entry first; the wildcard (`'*'`) entry is the fallback. */
	const exactOrWildcard = (sessionId) => connections.get(sessionId) ?? connections.get("*");
	return {
		set(sessionId, connection) {
			connections.set(sessionId, connection);
		},
		get(sessionId) {
			const connection = exactOrWildcard(sessionId);
			return connection === void 0 ? void 0 : summarize(connection);
		},
		getWithSecret(sessionId) {
			return exactOrWildcard(sessionId);
		},
		has(sessionId) {
			return exactOrWildcard(sessionId) !== void 0;
		},
		clear(sessionId) {
			connections.delete(sessionId);
		}
	};
}
//#endregion
//#region src/index.ts
/**
* Data Agent server half for the dsh web GUI. The host row provides the
* `dataAgentConnections` service (session-scoped in-memory store; passwords
* never leave memory), seeds config connections (`connections`, `'*'` =
* wildcard default), and installs the `data-agent` agent preset into
* `$DSH_HOME/.agent-presets/` (idempotent, never overwrites a user-edited
* directory).
*
* The HTTP routes live in the separate `./routes` entry
* (`@yejiming/dsh-data-agent/routes`, cordis row `data-agent-routes`) so
* this row keeps working in headless profiles without a webserver; the sqlcmd
* tool itself lives in the `./tool` entry and is mounted only by the
* data-agent preset.
* @module @yejiming/dsh-data-agent
*/
/** Cordis plugin name (diagnostics only). */
const name = "data-agent";
/** Services required before the store can serve. */
const inject = ["subprocess"];
/** Loader schema with deployment defaults (no library defaults). */
const Config = z.object({
	presetId: z.string().default(DEFAULT_PRESET_ID),
	installPreset: z.boolean().default(true),
	connectTimeoutMs: z.number().step(1).min(1e3).default(DEFAULT_CONNECT_TIMEOUT_MS),
	introspectMaxTables: z.number().step(1).min(1).default(500),
	queryTimeoutMs: z.number().step(1).min(1e3).default(DEFAULT_QUERY_TIMEOUT_MS),
	maxResultChars: z.number().step(1).min(1024).default(DEFAULT_MAX_RESULT_CHARS),
	readonly: z.boolean().default(false),
	clients: clientsSchema,
	connections: z.dict(z.object({
		type: z.union([
			z.const("mysql"),
			z.const("postgres"),
			z.const("sqlite"),
			z.const("oracle"),
			z.const("hive"),
			z.const("impala")
		]),
		host: z.string(),
		port: z.natural(),
		user: z.string(),
		database: z.string(),
		readonly: z.boolean()
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
* `$DSH_HOME/.agent-presets/<presetId>/`. Idempotent: an existing target
* directory is left untouched (user edits survive); `installPreset: false`
* never calls this. Best-effort — a failure logs a warning with manual
* install instructions instead of failing the boot.
*/
async function installPreset(ctx, presetId) {
	const targetDir = join(resolveDshHome(), ".agent-presets", presetId);
	try {
		await access(targetDir);
		ctx.logger.info("data-agent: preset \"%s\" already present at %s, skipping install", presetId, targetDir);
		return;
	} catch {}
	const sourceDir = fileURLToPath(new URL("../preset/data-agent/", import.meta.url));
	try {
		await mkdir(targetDir, { recursive: true });
		await cp(sourceDir, targetDir, { recursive: true });
		ctx.logger.info("data-agent: installed preset \"%s\" to %s", presetId, targetDir);
	} catch (error) {
		ctx.logger.warn("data-agent: failed to install preset \"%s\" to %s (%s); copy preset/data-agent/ manually to enable the 数据Agent preset", presetId, targetDir, error instanceof Error ? error.message : String(error));
	}
}
/**
* Mount the data-agent host row: connection store, config-seeded
* connections, and preset self-install. HTTP routes are the sibling
* `data-agent-routes` row (`./routes`).
* @param ctx - host cordis context.
* @param config - validated loader configuration.
*/
function apply(ctx, config) {
	const resolved = {
		presetId: config.presetId,
		installPreset: config.installPreset,
		connectTimeoutMs: config.connectTimeoutMs,
		introspectMaxTables: config.introspectMaxTables,
		queryTimeoutMs: config.queryTimeoutMs,
		maxResultChars: config.maxResultChars,
		readonly: config.readonly,
		clients: config.clients,
		connections: config.connections
	};
	const store = createConnectionStore();
	ctx.provide("dataAgentConnections", store);
	for (const [sessionId, spec] of Object.entries(config.connections)) {
		const connection = {
			type: spec.type,
			database: spec.type === "sqlite" ? resolve(process.cwd(), spec.database) : spec.database,
			...spec.host !== void 0 ? { host: spec.host } : {},
			...spec.port !== void 0 ? { port: spec.port } : {},
			...spec.user !== void 0 ? { user: spec.user } : {},
			...spec.readonly !== void 0 ? { readonly: spec.readonly } : {}
		};
		store.set(sessionId, connection);
	}
	if (resolved.installPreset) installPreset(ctx, resolved.presetId);
}
//#endregion
export { Config, apply, inject, installPreset, name, resolveDshHome };
