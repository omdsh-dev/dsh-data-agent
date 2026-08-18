import { o as clientsSchema, t as createConnectionService } from "./connections-5sfdEDsG.js";
import { a as DEFAULT_PRESET_ID, i as DEFAULT_MAX_RESULT_CHARS, o as DEFAULT_QUERY_TIMEOUT_MS, r as DEFAULT_MAX_QUERY_CHARS, t as DEFAULT_CONNECT_TIMEOUT_MS } from "./defaults-DP4RyRh1.js";
import { r as apply$1 } from "./command-DuCpwVbl.js";
import { n as apply$2 } from "./tool-DgL0fBfj.js";
import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
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
	credentialMode: z$1.enum([
		"none",
		"password",
		"reference"
	]).optional(),
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
* Data Agent profile entry. The host row provides the
* `dataAgentConnections` service (shared non-secret profile/binding storage;
* temporary passwords stay process-local), seeds config connections (`connections`, `'*'` =
* wildcard default), installs the `data-agent` agent preset into
* `$DSH_HOME/.agent-presets/`, and preloads the preset-scoped database tools
* and command through this profile bundle entry.
*
* The HTTP routes live in the separate `./routes` entry
* (`@yejiming/dsh-data-agent/routes`, cordis row `data-agent-routes`) so
* this row keeps working in headless profiles without a webserver. The
* database implementations still have public `./tool` and `./command`
* exports, but the shipped preset does not dynamically import those package
* subpaths. Loading them here keeps Desktop on the same profile-startup path
* as other UI bundles and avoids Electron ASAR package-resolution drift.
* @module @yejiming/dsh-data-agent
*/
/** Cordis plugin name (diagnostics only). */
const name = "data-agent";
/** Services required before the profile entry can mount its preset layer. */
const inject = [
	"agentPresets",
	"commands",
	"credentials",
	"subprocess",
	"tools"
];
/** Loader schema with deployment defaults (no library defaults). */
const Config = z.object({
	presetId: z.string().default(DEFAULT_PRESET_ID),
	installPreset: z.boolean().default(true),
	connectTimeoutMs: z.number().step(1).min(1e3).default(DEFAULT_CONNECT_TIMEOUT_MS),
	introspectMaxTables: z.number().step(1).min(1).default(500),
	queryTimeoutMs: z.number().step(1).min(1e3).default(DEFAULT_QUERY_TIMEOUT_MS),
	maxResultChars: z.number().step(1).min(1024).default(DEFAULT_MAX_RESULT_CHARS),
	maxRows: z.number().step(1).min(1).default(100),
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
* `$DSH_HOME/.agent-presets/<presetId>/`. Idempotent: an existing target is
* normally left untouched. Exact package-owned legacy compositions are
* migrated once when their runtime contract changes; user-edited compositions
* are never overwritten. `installPreset: false` never calls this. Best-effort
* — a failure logs a warning with manual install instructions instead of
* failing the boot.
*/
async function installPreset(ctx, presetId) {
	const targetDir = join(resolveDshHome(), ".agent-presets", presetId);
	const sourceDir = fileURLToPath(new URL("../preset/data-agent/", import.meta.url));
	try {
		await access(targetDir);
		return await synchronizeExistingPreset(ctx, targetDir, sourceDir, presetId);
	} catch {}
	try {
		await mkdir(targetDir, { recursive: true });
		await cp(sourceDir, targetDir, { recursive: true });
		ctx.logger.info("data-agent: installed preset \"%s\" to %s", presetId, targetDir);
		return true;
	} catch (error) {
		ctx.logger.warn("data-agent: failed to install preset \"%s\" to %s (%s); copy preset/data-agent/ manually to enable the 数据模式 preset", presetId, targetDir, error instanceof Error ? error.message : String(error));
		return false;
	}
}
/** SHA-256 values of unmodified package-owned compositions safe to migrate. */
const LEGACY_MANAGED_PRESET_SHA256 = /* @__PURE__ */ new Set(["bae875a90d638ea78715030246b0f8a9f1a2c3359ca61febb6ceb59d0fcd930a", "d3c6f4049580069eec1c6b7de101f12c7fb30482ad317434afb69afb08a91fc6"]);
/** Public for regression tests of the non-destructive preset migration gate. */
function isLegacyManagedPreset(source) {
	return LEGACY_MANAGED_PRESET_SHA256.has(createHash("sha256").update(source).digest("hex"));
}
/** Upgrade only exact package-owned legacy compositions; preserve every edited preset. */
async function synchronizeExistingPreset(ctx, targetDir, sourceDir, presetId) {
	const composition = join(targetDir, "agent.cordis.yml");
	try {
		const current = await readFile(composition, "utf8");
		if (isLegacyManagedPreset(current)) {
			const replacement = await readFile(join(sourceDir, "agent.cordis.yml"), "utf8");
			await writeFile(composition, replacement, "utf8");
			ctx.logger.info("data-agent: migrated package-owned preset at %s to the current runtime contract", composition);
			return true;
		}
		if (current.includes("@yejiming/dsh-data-agent/tool") || current.includes("@yejiming/dsh-data-agent/command")) {
			ctx.logger.warn("data-agent: user-edited preset at %s still imports /tool or /command dynamically; remove those rows so the profile-preloaded preset capabilities can activate in DSH Desktop", composition);
			return false;
		}
		ctx.logger.info("data-agent: preset \"%s\" already present at %s, skipping install", presetId, targetDir);
		return true;
	} catch (error) {
		ctx.logger.warn("data-agent: could not inspect existing preset %s (%s); it was not overwritten", composition, error instanceof Error ? error.message : String(error));
		return false;
	}
}
/** Exact profile-local package installation command used by diagnostics/docs. */
function profileInstallCommand(profile) {
	return `dsh plugin --profile ${profile} add @yejiming/dsh-data-agent`;
}
/** Actionable diagnostic for a roster-visible preset whose profile lacks this package. */
function missingProfileDependencyMessage(profile) {
	return `data-agent preset is visible, but its profile-preloaded capabilities are absent from profile "${profile}". Run: ${profileInstallCommand(profile)}`;
}
/**
* Register the statically imported database tools and command under the exact
* standing key owned by the data-agent preset. Selecting the preset performs
* no package import and only links the agent scope to this key.
*/
async function mountPresetCapabilities(ctx, key, scopeTag, config) {
	const scoped = ctx.extend({ [scopeTag]: key });
	apply$2(scoped, config);
	apply$1(scoped);
}
/** Read the host-owned scope tag from AgentPresets' already-created standing mount. */
async function standingScopeTag(ctx, presetId, key) {
	const pending = ctx.agentPresets.standing?.get(presetId);
	if (pending === void 0) throw new Error(`data-agent: preset "${presetId}" has no standing scope after standingKeyFor()`);
	const standing = await pending;
	if (standing.key !== key) throw new Error(`data-agent: preset "${presetId}" standing scope changed during profile preload`);
	const tag = Object.getOwnPropertySymbols(standing.scope.ctx).find((candidate) => Reflect.get(standing.scope.ctx, candidate) === key);
	if (tag === void 0) throw new Error(`data-agent: preset "${presetId}" standing context exposes no scope tag`);
	return tag;
}
/**
* Mount the data-agent profile row: connection store, config-seeded
* connections, preset installation, and profile-preloaded preset capabilities.
* HTTP routes are the sibling `data-agent-routes` row (`./routes`).
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
		maxRows: config.maxRows,
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
	const presetReady = resolved.installPreset ? await installPreset(ctx, resolved.presetId) : false;
	if (resolved.persistConnections) {
		const domain = await (await ensureStorageDomain(ctx)).open(connectionStorageSpec);
		ctx.effect(() => () => domain.close(), "data-agent: close connection storage domain");
		mountService(ctx, createDomainConnectionPersistence(domain));
	} else {
		ctx.logger.warn("data-agent: persistConnections=false; connection state is process-local and cannot restore across Web/TUI");
		mountService(ctx);
	}
	if (presetReady) {
		const standingKey = await ctx.agentPresets.standingKeyFor(resolved.presetId);
		await mountPresetCapabilities(ctx, standingKey, await standingScopeTag(ctx, resolved.presetId, standingKey), {
			queryTimeoutMs: resolved.queryTimeoutMs,
			maxResultChars: resolved.maxResultChars,
			maxRows: resolved.maxRows,
			maxQueryChars: resolved.maxQueryChars,
			readonly: resolved.readonly,
			clients: resolved.clients
		});
	}
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
export { Config, apply, inject, installPreset, isLegacyManagedPreset, missingProfileDependencyMessage, mountPresetCapabilities, name, profileInstallCommand, resolveDshHome };
