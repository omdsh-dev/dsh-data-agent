import { o as clientsSchema, t as createConnectionService } from "./connections-gGr1fq73.js";
import { a as DEFAULT_PRESET_ID, i as DEFAULT_MAX_RESULT_CHARS, o as DEFAULT_QUERY_TIMEOUT_MS, r as DEFAULT_MAX_QUERY_CHARS, t as DEFAULT_CONNECT_TIMEOUT_MS } from "./defaults-DP4RyRh1.js";
import { access, cp, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Storage from "@deepseek-ai/dsh-storage";
import * as storageDomainPlugin from "@deepseek-ai/dsh-storage-domain";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import * as storageJsonPlugin from "@deepseek-ai/dsh-storage-json";
import z from "schemastery";
import { z as z$1 } from "zod";
//#region src/storage.ts
/**
* Durable, non-secret connection profiles, session bindings, and form drafts.
*
* The domain intentionally excludes passwords, resolved credentials, SQL,
* table metadata, and client output. Form drafts likewise accept no secret
* fields. Runtime secrets stay in
* {@link DataAgentConnectionService}; durable records only retain enough
* information to rebuild a connection description in another DSH surface.
* @module @yejiming/dsh-data-agent/storage
*/
/** Storage-domain identity. Bump the version only with an explicit migration. */
const CONNECTION_STORAGE_DOMAIN = "data_agent_connections";
/** Durable profile schema. There is deliberately no `password` field. */
const persistedConnectionProfileSchema = z$1.object({
	name: z$1.string().min(1).optional(),
	type: z$1.enum([
		"mysql",
		"postgres",
		"sqlite",
		"oracle",
		"hive",
		"impala"
	]),
	host: z$1.string().optional(),
	port: z$1.number().int().min(1).max(65535).optional(),
	user: z$1.string().optional(),
	database: z$1.string().min(1),
	readonly: z$1.boolean().optional(),
	passwordRef: z$1.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
	updatedAt: z$1.string().min(1)
}).strict();
/** Durable session-to-profile binding schema. */
const sessionConnectionBindingSchema = z$1.object({
	profileId: z$1.string().min(1),
	updatedAt: z$1.string().min(1)
}).strict();
/** Session form draft schema. Secret-shaped fields are rejected by strict mode. */
const persistedConnectionFormDraftSchema = z$1.object({
	type: z$1.enum([
		"mysql",
		"postgres",
		"sqlite",
		"oracle",
		"hive",
		"impala"
	]),
	host: z$1.string(),
	port: z$1.string(),
	user: z$1.string(),
	database: z$1.string(),
	readonly: z$1.boolean(),
	updatedAt: z$1.string().min(1)
}).strict();
/** Single source of truth for the storage layout and durable validation. */
const connectionStorageSpec = defineDomain({
	name: CONNECTION_STORAGE_DOMAIN,
	version: 1,
	tables: {
		profiles: domainTable(persistedConnectionProfileSchema),
		bindings: domainTable(sessionConnectionBindingSchema),
		drafts: domainTable(persistedConnectionFormDraftSchema)
	}
});
/** Project a typed DSH domain handle onto the service's persistence seam. */
function createDomainConnectionPersistence(domain) {
	const profiles = domain.table("profiles");
	const bindings = domain.table("bindings");
	const drafts = domain.table("drafts");
	return {
		getProfile(profileId) {
			return profiles.get(profileId);
		},
		putProfile(profileId, profile) {
			return profiles.put(profileId, profile);
		},
		deleteProfile(profileId) {
			return profiles.delete(profileId);
		},
		getBinding(sessionId) {
			return bindings.get(sessionId);
		},
		putBinding(sessionId, binding) {
			return bindings.put(sessionId, binding);
		},
		deleteBinding(sessionId) {
			return bindings.delete(sessionId);
		},
		getDraft(sessionId) {
			return drafts.get(sessionId);
		},
		putDraft(sessionId, draft) {
			return drafts.put(sessionId, draft);
		}
	};
}
//#endregion
//#region src/index.ts
/**
* Data Agent server half for the dsh web GUI. The host row provides the
* `dataAgentConnections` service (shared non-secret profile/binding storage;
* temporary passwords stay process-local), seeds config connections (`connections`, `'*'` =
* wildcard default), and installs the `data-agent` agent preset into
* `$DSH_HOME/.agent-presets/` (idempotent, never overwrites a user-edited
* directory).
*
* The HTTP routes live in the separate `./routes` entry
* (`@yejiming/dsh-data-agent/routes`, cordis row `data-agent-routes`) so
* this row keeps working in headless profiles without a webserver; the
* database tools themselves live in the `./tool` entry and are mounted only
* by the data-agent preset.
* @module @yejiming/dsh-data-agent
*/
/** Cordis plugin name (diagnostics only). */
const name = "data-agent";
/** Services required before the store can serve. */
const inject = ["subprocess", "credentials"];
/** Loader schema with deployment defaults (no library defaults). */
const Config = z.object({
	presetId: z.string().default(DEFAULT_PRESET_ID),
	installPreset: z.boolean().default(true),
	connectTimeoutMs: z.number().step(1).min(1e3).default(DEFAULT_CONNECT_TIMEOUT_MS),
	introspectMaxTables: z.number().step(1).min(1).default(500),
	queryTimeoutMs: z.number().step(1).min(1e3).default(DEFAULT_QUERY_TIMEOUT_MS),
	maxResultChars: z.number().step(1).min(1024).default(DEFAULT_MAX_RESULT_CHARS),
	maxQueryChars: z.number().step(1).min(1024).default(DEFAULT_MAX_QUERY_CHARS),
	readonly: z.boolean().default(false),
	persistConnections: z.boolean().default(true),
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
		readonly: z.boolean(),
		passwordRef: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/),
		password: z.never().hidden()
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
		await diagnoseExistingPreset(ctx, targetDir);
		return;
	} catch {}
	const sourceDir = fileURLToPath(new URL("../preset/data-agent/", import.meta.url));
	try {
		await mkdir(targetDir, { recursive: true });
		await cp(sourceDir, targetDir, { recursive: true });
		ctx.logger.info("data-agent: installed preset \"%s\" to %s", presetId, targetDir);
	} catch (error) {
		ctx.logger.warn("data-agent: failed to install preset \"%s\" to %s (%s); copy preset/data-agent/ manually to enable the 数据模式 preset", presetId, targetDir, error instanceof Error ? error.message : String(error));
	}
}
/** Exact profile-local package installation command used by diagnostics/docs. */
function profileInstallCommand(profile) {
	return `dsh plugin --profile ${profile} add @yejiming/dsh-data-agent`;
}
/** Actionable diagnostic for a roster-visible preset whose profile lacks this package. */
function missingProfileDependencyMessage(profile) {
	return `data-agent preset is visible, but profile "${profile}" cannot resolve @yejiming/dsh-data-agent/tool or /command. Run: ${profileInstallCommand(profile)}`;
}
/** Warn without overwriting when a pre-existing user preset lacks the command row. */
async function diagnoseExistingPreset(ctx, targetDir) {
	const composition = join(targetDir, "agent.cordis.yml");
	try {
		if ((await readFile(composition, "utf8")).includes("@yejiming/dsh-data-agent/command")) return;
		const profile = process.env.DSH_PROFILE?.trim();
		const installHint = profile !== void 0 && profile.length > 0 ? profileInstallCommand(profile) : `${profileInstallCommand("web")}；${profileInstallCommand("dsh-tui")}`;
		ctx.logger.warn("data-agent: existing user preset at %s does not contain the database-command row; the file was not overwritten. Back it up, then add name: \"@yejiming/dsh-data-agent/command\". Also install this package in the target profile: %s", composition, installHint);
	} catch (error) {
		ctx.logger.warn("data-agent: could not inspect existing preset %s (%s); it was not overwritten", composition, error instanceof Error ? error.message : String(error));
	}
}
/**
* Mount the data-agent host row: connection store, config-seeded
* connections, and preset self-install. HTTP routes are the sibling
* `data-agent-routes` row (`./routes`).
* @param ctx - host cordis context.
* @param config - validated loader configuration.
*/
async function apply(ctx, config) {
	const resolved = {
		presetId: config.presetId,
		installPreset: config.installPreset,
		connectTimeoutMs: config.connectTimeoutMs,
		introspectMaxTables: config.introspectMaxTables,
		queryTimeoutMs: config.queryTimeoutMs,
		maxResultChars: config.maxResultChars,
		maxQueryChars: config.maxQueryChars,
		readonly: config.readonly,
		persistConnections: config.persistConnections,
		clients: config.clients,
		connections: config.connections
	};
	const mountService = (scope, persistence) => {
		const store = createConnectionService(scope, {
			connectTimeoutMs: resolved.connectTimeoutMs,
			queryTimeoutMs: resolved.queryTimeoutMs,
			maxResultChars: resolved.maxResultChars,
			maxQueryChars: resolved.maxQueryChars,
			introspectMaxTables: resolved.introspectMaxTables,
			readonly: resolved.readonly,
			clients: resolved.clients
		}, persistence);
		scope.provide("dataAgentConnections", store);
		for (const [sessionId, spec] of Object.entries(resolved.connections)) {
			const connection = {
				type: spec.type,
				database: spec.type === "sqlite" ? resolve(process.cwd(), spec.database) : spec.database,
				...spec.host !== void 0 ? { host: spec.host } : {},
				...spec.port !== void 0 ? { port: spec.port } : {},
				...spec.user !== void 0 ? { user: spec.user } : {},
				...spec.passwordRef !== void 0 ? { passwordRef: spec.passwordRef } : {},
				...spec.readonly !== void 0 ? { readonly: spec.readonly } : {}
			};
			store.set(sessionId, connection);
		}
	};
	if (resolved.persistConnections) {
		const domain = await (await ensureStorageDomain(ctx)).open(connectionStorageSpec);
		ctx.effect(() => () => domain.close(), "data-agent: close connection storage domain");
		mountService(ctx, createDomainConnectionPersistence(domain));
	} else {
		ctx.logger.warn("data-agent: persistConnections=false; connection state is process-local and cannot restore across Web/TUI");
		mountService(ctx);
	}
	if (resolved.installPreset) await installPreset(ctx, resolved.presetId);
}
/**
* Reuse a surface-provided storage stack (Web) or mount the same JSON stack
* when an interactive profile such as dsh-tui does not ship one.
*/
async function ensureStorageDomain(ctx) {
	const existing = ctx.get("storageDomain");
	if (existing !== void 0) return existing;
	ctx.logger.info("data-agent: storageDomain is absent; mounting the JSON storage stack for this profile");
	let storage = ctx.get("storage");
	if (storage === void 0) {
		await ctx.plugin(Storage);
		storage = ctx.get("storage");
	}
	if (storage === void 0) throw new Error("data-agent: failed to mount DSH storage hub");
	if (!storage.backend.names().includes("json")) await ctx.plugin(storageJsonPlugin, { root: join(resolveDshHome(), "storages") });
	let facility = ctx.get("storageDomain");
	if (facility === void 0) {
		await ctx.plugin(storageDomainPlugin, { backend: "json" });
		facility = ctx.get("storageDomain");
	}
	if (facility === void 0) throw new Error("data-agent: failed to mount DSH storage-domain facility");
	return facility;
}
//#endregion
export { Config, apply, inject, installPreset, missingProfileDependencyMessage, name, profileInstallCommand, resolveDshHome };
