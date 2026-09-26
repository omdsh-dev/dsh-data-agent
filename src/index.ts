/**
 * Data Agent profile entry. The host row provides the
 * `dataAgentConnections` service (shared non-secret profile/binding storage;
 * temporary passwords stay process-local), seeds config connections (`connections`, `'*'` =
 * wildcard default), provides a separate versioned governance Catalog, installs the `data-agent` agent preset into
 * `$DSH_HOME/.agent-presets/`, and declares its preset-scoped database tools
 * on every surface, while registering `/database` and `/catalog` only while
 * the current Cordis composition actually loads the dsh-tui plugin.
 *
 * The HTTP routes live in the separate `./routes` entry
 * (`@yejiming/dsh-data-agent/routes`, cordis row `data-agent-routes`) so
 * this row keeps working in headless profiles without a webserver. The
 * database implementations still have public `./tool` and `./command`
 * exports. The preset registry loads them from absolute URLs beside this
 * artifact, so scoped activation never relies on resolving this package
 * again from a different host module root.
 * @module @yejiming/dsh-data-agent
 */

import { createHash } from 'node:crypto'
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { entryListProblem, type PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-credentials'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as storageJsonPlugin from '@deepseek-ai/dsh-storage-json'
import type {} from '@deepseek-ai/dsh-subprocess'

/** The `dataAgentConnections` service face on the cordis context. */
declare module '@deepseek-ai/cordis' {
  interface Context {
    dataAgentConnections: DataAgentConnections
    dataAgentCatalog: DataAgentCatalog
    dataAgentCatalogScanner: DataAgentCatalogScanner
    dataAgentCatalogReview: DataAgentCatalogReview
  }
}
import z from 'schemastery'
import yaml from 'js-yaml'
import {
  createConnectionService,
  type DataAgentConnections,
  type DatabaseConnection,
  type DatabaseType,
} from './connections.ts'
import { clientsSchema, type CliDatabaseType, type ClientConfig } from './clients.ts'
import {
  createCatalogService,
  type DataAgentCatalog,
  type DataAgentCatalogReview,
  type DataAgentCatalogScanner,
} from './catalog.ts'
import { createDshCatalogMeaningGenerator, type CatalogMeaningLanguage } from './catalog-ai.ts'
import {
  catalogStorageSpec,
  createDomainCatalogPersistence,
  createMemoryCatalogPersistence,
  type CatalogPersistence,
} from './catalog-storage.ts'
import {
  DEFAULT_CATALOG_ASSET_CONCURRENCY,
  DEFAULT_CATALOG_MAX_ASSETS,
  DEFAULT_CATALOG_MAX_RESULT_CHARS,
  DEFAULT_CATALOG_MAX_TEXT_CHARS,
  DEFAULT_CATALOG_PAGE_SIZE,
  DEFAULT_CATALOG_QUERY_TIMEOUT_MS,
  DEFAULT_CATALOG_SCHEMA_CONCURRENCY,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_INTROSPECT_MAX_TABLES,
  DEFAULT_MAX_RESULT_CHARS,
  DEFAULT_MAX_QUERY_CHARS,
  DEFAULT_MAX_ROWS,
  DEFAULT_PRESET_ID,
  DEFAULT_QUERY_TIMEOUT_MS,
  MAX_CATALOG_PAGE_SIZE,
} from './defaults.ts'
import { connectionStorageSpec, createDomainConnectionPersistence } from './storage.ts'
import type { Config as ToolConfig } from './tool.ts'

export type {
  CatalogServiceBundle,
  CatalogServiceOptions,
  CatalogStatusSummary,
  DataAgentCatalog,
  DataAgentCatalogReview,
  DataAgentCatalogScanner,
  StartCatalogScanInput,
} from './catalog.ts'
export type {
  CatalogAssetDetail,
  CatalogAssetHead,
  CatalogAssetKind,
  CatalogAssetRevision,
  CatalogAssetStatus,
  CatalogCapability,
  CatalogDiffItem,
  CatalogDiffKind,
  CatalogDiffPage,
  CatalogEnrichment,
  CatalogEnrichmentStatus,
  CatalogIdentity,
  CatalogObservation,
  CatalogProgress,
  CatalogRelation,
  CatalogRun,
  CatalogRunStatus,
  CatalogScope,
  CatalogSearchFilters,
  CatalogSearchItem,
  CatalogSearchPage,
  CatalogSearchRequest,
  CatalogSemanticEntry,
  CatalogSemanticKind,
  CatalogSemanticRevision,
  CatalogSemanticStatus,
  CatalogSource,
  CatalogTechnicalPayload,
  MetricDefinition,
  MeaningDefinition,
  SemanticDefinition,
  TermDefinition,
} from './catalog-types.ts'

/** Cordis plugin name (diagnostics only). */
export const name = 'data-agent'

/** Services required before the profile entry can mount its preset layer. */
export const inject = ['agentPresets', 'agents', 'commands', 'credentials', 'llm', 'subprocess', 'tools']

/** Deployment overrides for one database type's CLI client. */
export type ClientsConfig = Partial<Record<CliDatabaseType, ClientConfig>>

/**
 * One config-seeded connection. Deliberately password-free: passwords are a
 * memory-only / connect-time value, so only the /connect route may carry one.
 * The key `'*'` seeds the wildcard default used by any session without its
 * own connection (headless/keyless runs, deployments pinning one database).
 */
export interface SeededConnectionConfig {
  type: DatabaseType
  host?: string
  port?: number
  user?: string
  database: string
  /** Optional per-seed read-only guard. */
  readonly?: boolean
  /** ClickHouse only: use HTTPS with certificate verification. */
  secure?: boolean
  /** Safe credential reference. Real passwords are rejected by the schema. */
  passwordRef?: string
  password?: never
}

/** Required plugin configuration (loader schema with deployment defaults). */
export interface Config {
  /** Preset directory name installed under `$DSH_HOME/.agent-presets/`. */
  presetId: string
  /** Whether to self-install the preset on startup (idempotent). */
  installPreset: boolean
  /** Deadline for one /connect connectivity check, milliseconds. */
  connectTimeoutMs: number
  /** Cap on the table list returned by /connect and /status. */
  introspectMaxTables: number
  /** Deadline for one database-tool query, milliseconds. */
  queryTimeoutMs: number
  /** Deadline for one package-owned system-catalog metadata query. */
  catalogQueryTimeoutMs: number
  /** Per-stream capture budget for one package-owned system-catalog query. */
  catalogMaxResultChars: number
  /** Maximum schemas and table/view details processed concurrently. */
  catalogSchemaConcurrency: number
  catalogAssetConcurrency: number
  /** Hard technical asset bound for one scan. */
  catalogMaxAssetsPerRun: number
  /** Maximum normalized database/human text field length. */
  catalogMaxTextChars: number
  /** Default and maximum Catalog list/detail page sizes. */
  catalogPageSize: number
  catalogMaxPageSize: number
  /** In-memory cap on database-tool captured output. */
  maxResultChars: number
  /** Maximum structured rows returned by one database read tool call. */
  maxRows: number
  /** Maximum SQL text accepted by the shared Web query adapter. */
  maxQueryChars: number
  /** Default read-only guard: true rejects write statements in database tools and /query. */
  readonly: boolean
  /** Persist non-secret profiles/bindings through DSH storage-domain. */
  persistConnections: boolean
  /** CLI client overrides keyed by database type. */
  clients: ClientsConfig
  /** Output language of AI business-meaning candidates ('zh' | 'ru' | 'en'). */
  enrichmentLanguage: CatalogMeaningLanguage
  /** Config-seeded connections keyed by session id (`'*'` = wildcard default). */
  connections: Record<string, SeededConnectionConfig>
}

/** Loader schema with deployment defaults (no library defaults). */
export const Config = z.object({
  presetId: z.string().default(DEFAULT_PRESET_ID),
  installPreset: z.boolean().default(true),
  connectTimeoutMs: z.number().step(1).min(1000).default(DEFAULT_CONNECT_TIMEOUT_MS),
  introspectMaxTables: z.number().step(1).min(1).default(DEFAULT_INTROSPECT_MAX_TABLES),
  queryTimeoutMs: z.number().step(1).min(1000).default(DEFAULT_QUERY_TIMEOUT_MS),
  catalogQueryTimeoutMs: z.number().step(1).min(1000).default(DEFAULT_CATALOG_QUERY_TIMEOUT_MS),
  catalogMaxResultChars: z.number().step(1).min(1024).default(DEFAULT_CATALOG_MAX_RESULT_CHARS),
  catalogSchemaConcurrency: z.number().step(1).min(1).max(16).default(DEFAULT_CATALOG_SCHEMA_CONCURRENCY),
  catalogAssetConcurrency: z.number().step(1).min(1).max(32).default(DEFAULT_CATALOG_ASSET_CONCURRENCY),
  catalogMaxAssetsPerRun: z.number().step(1).min(1).max(1_000_000).default(DEFAULT_CATALOG_MAX_ASSETS),
  catalogMaxTextChars: z.number().step(1).min(256).max(4_096).default(DEFAULT_CATALOG_MAX_TEXT_CHARS),
  catalogPageSize: z.number().step(1).min(1).max(MAX_CATALOG_PAGE_SIZE).default(DEFAULT_CATALOG_PAGE_SIZE),
  catalogMaxPageSize: z.number().step(1).min(1).max(MAX_CATALOG_PAGE_SIZE).default(MAX_CATALOG_PAGE_SIZE),
  maxResultChars: z.number().step(1).min(1024).default(DEFAULT_MAX_RESULT_CHARS),
  maxRows: z.number().step(1).min(1).default(DEFAULT_MAX_ROWS),
  maxQueryChars: z.number().step(1).min(1024).default(DEFAULT_MAX_QUERY_CHARS),
  readonly: z.boolean().default(false),
  persistConnections: z.boolean().default(true),
  clients: clientsSchema,
  enrichmentLanguage: z.union([z.const('zh'), z.const('ru'), z.const('en')]).default('zh'),
  connections: z.dict(z.object({
    type: z.union([
      z.const('mysql'), z.const('postgres'), z.const('sqlite'), z.const('oracle'), z.const('hive'),
      z.const('impala'), z.const('clickhouse'), z.const('doris'), z.const('sqlserver'),
    ]),
    host: z.string(),
    port: z.natural(),
    user: z.string(),
    database: z.string(),
    readonly: z.boolean(),
    secure: z.boolean(),
    passwordRef: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/),
    password: z.never().hidden(),
  })).default({}),
})

/**
 * Resolve the harness home the same way `@deepseek-ai/dsh-paths` does:
 * `$DSH_HOME` (non-blank) else `~/.dsh`, normalized absolute.
 */
export function resolveDshHome(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env.DSH_HOME
  const selected = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
  return resolve(selected.startsWith('~/') ? join(homedir(), selected.slice(2)) : selected)
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
export async function installPreset(ctx: Context, presetId: string): Promise<boolean> {
  const targetDir = join(resolveDshHome(), '.agent-presets', presetId)
  const sourceDir = fileURLToPath(new URL('../preset/data-agent/', import.meta.url))
  try {
    await access(targetDir)
    return await synchronizeExistingPreset(ctx, targetDir, sourceDir, presetId)
  } catch {
    // Not present — fall through to install.
  }
  try {
    await mkdir(targetDir, { recursive: true })
    await cp(sourceDir, targetDir, { recursive: true })
    ctx.logger.info('data-agent: installed preset "%s" to %s', presetId, targetDir)
    return true
  } catch (error) {
    ctx.logger.warn(
      'data-agent: failed to install preset "%s" to %s (%s); '
      + 'copy preset/data-agent/ manually to enable the 数据模式 preset',
      presetId, targetDir, error instanceof Error ? error.message : String(error),
    )
    return false
  }
}

/** SHA-256 values of unmodified package-owned compositions safe to migrate. */
const LEGACY_MANAGED_PRESET_SHA256 = new Set([
  // 0.1.5: registry migration updates obsolete loading comments only.
  '899d351670bac68fdc385467cc71d646a0fc426c58f3dd8b181d679d1a9d5709',
  // 0.0.9: imported /tool and /command dynamically.
  'bae875a90d638ea78715030246b0f8a9f1a2c3359ca61febb6ceb59d0fcd930a',
  // 0.0.11 before HTML artifacts: described render-analysis as Web-only.
  'd3c6f4049580069eec1c6b7de101f12c7fb30482ad317434afb69afb08a91fc6',
  // 0.0.13 before the governance Catalog tools/persona contract.
  '11c4b5ef62c5934d1dc7133950bd78622dd68dc4e1075b5f24d0789011d6da9d',
  // 0.0.12: offline HTML persona, before the database dialect guidance.
  '1e42e007ad4cac04af95a67a5af1b7a0b02cc0f78e21d2da35461309db8dc9db',
  // 0.1.0–0.1.4: Catalog persona with only the legacy text config key.
  '2c5a8fc07dd49d0c10d6d10f0056da2d84575f47b47d4b28bc0e37f7d166413a',
])

/** Public for regression tests of the non-destructive preset migration gate. */
export function isLegacyManagedPreset(source: string): boolean {
  return LEGACY_MANAGED_PRESET_SHA256.has(createHash('sha256').update(source).digest('hex'))
}

/** Upgrade only exact package-owned legacy compositions; preserve every edited preset. */
async function synchronizeExistingPreset(
  ctx: Context,
  targetDir: string,
  sourceDir: string,
  presetId: string,
): Promise<boolean> {
  const composition = join(targetDir, 'agent.cordis.yml')
  try {
    const current = await readFile(composition, 'utf8')
    if (isLegacyManagedPreset(current)) {
      const replacement = await readFile(join(sourceDir, 'agent.cordis.yml'), 'utf8')
      await writeFile(composition, replacement, 'utf8')
      ctx.logger.info(
        'data-agent: migrated package-owned preset at %s to the current runtime contract',
        composition,
      )
      return true
    }
    ctx.logger.info('data-agent: preset "%s" already present at %s, skipping install', presetId, targetDir)
    return true
  } catch (error) {
    ctx.logger.warn(
      'data-agent: could not inspect existing preset %s (%s); it was not overwritten',
      composition,
      error instanceof Error ? error.message : String(error),
    )
    return false
  }
}

/** Exact profile-local package installation command used by diagnostics/docs. */
export function profileInstallCommand(profile: string): string {
  return `dsh plugin --profile ${profile} add @yejiming/dsh-data-agent`
}

/** Actionable diagnostic for a roster-visible preset whose profile lacks this package. */
export function missingProfileDependencyMessage(profile: string): string {
  return `data-agent preset is visible, but its profile-preloaded capabilities are absent from profile "${profile}". Run: ${profileInstallCommand(profile)}`
}

/** Tool configuration inherited by the registry-owned preset capabilities. */
type PresetCapabilitiesConfig = Pick<
  ToolConfig,
  'queryTimeoutMs' | 'maxResultChars' | 'maxRows' | 'maxQueryChars' | 'readonly' | 'clients'
>

/**
 * Declare the preset through the host registry. The registry owns its scope,
 * revision lifetime and blank-session rebinding; no private scope tags are read.
 * Absolute artifact URLs keep scoped entries beside this installed package even
 * when the host and plugin use different module-resolution roots (Desktop).
 */
export async function registerPreset(
  ctx: Context,
  presetId: string,
  config: PresetCapabilitiesConfig,
): Promise<void> {
  const directory = join(resolveDshHome(), '.agent-presets', presetId)
  const plugins: unknown = yaml.load(await readFile(join(directory, 'agent.cordis.yml'), 'utf8'))
  const problem = entryListProblem(plugins, `data-agent preset ${presetId}`)
  if (problem !== undefined) throw new Error(problem)
  const metadata: unknown = yaml.load(await readFile(join(directory, 'preset.yml'), 'utf8'))
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error(`data-agent: preset "${presetId}" metadata must be an object`)
  }
  const fields = metadata as Record<string, unknown>
  for (const field of ['name', 'description']) {
    if (fields[field] !== undefined && typeof fields[field] !== 'string') {
      throw new Error(`data-agent: preset "${presetId}" ${field} must be a string`)
    }
  }
  if (fields.order !== undefined && (typeof fields.order !== 'number' || !Number.isFinite(fields.order))) {
    throw new Error(`data-agent: preset "${presetId}" order must be a finite number`)
  }
  // Old user compositions may already own these rows. Preserve their config
  // and resolve their entries to this artifact instead of registering twice.
  const rows = (plugins as PresetDefinition['plugins']).map(row => ({ ...row }))
  for (const [entry, entryConfig] of [['tool', config], ['command', undefined]] as const) {
    const specifier = `@yejiming/dsh-data-agent/${entry}`
    const existing = rows.find(row => row.name === specifier)
    const name = new URL(`./${entry}.js`, import.meta.url).href
    if (existing !== undefined) existing.name = name
    else rows.push({ id: `data-agent-${entry}`, name, ...entryConfig === undefined ? {} : { config: entryConfig } })
  }
  const dispose = await ctx.agentPresets.register({
    id: presetId,
    ...typeof fields.name === 'string' ? { name: fields.name } : {},
    ...typeof fields.description === 'string' ? { description: fields.description } : {},
    ...typeof fields.order === 'number' ? { order: fields.order } : {},
    plugins: rows,
  })
  ctx.effect(() => dispose, 'data-agent: unregister preset definition')
}

/**
 * Mount the data-agent profile row: connection store, config-seeded
 * connections, preset installation, and registry-owned preset capabilities.
 * HTTP routes are the sibling `data-agent-routes` row (`./routes`).
 * @param ctx - host cordis context.
 * @param config - validated loader configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (config.catalogPageSize > config.catalogMaxPageSize) {
    throw new Error('data-agent: catalogPageSize cannot exceed catalogMaxPageSize')
  }
  const resolved: Required<Config> = {
    presetId: config.presetId,
    installPreset: config.installPreset,
    connectTimeoutMs: config.connectTimeoutMs,
    introspectMaxTables: config.introspectMaxTables,
    queryTimeoutMs: config.queryTimeoutMs,
    catalogQueryTimeoutMs: config.catalogQueryTimeoutMs,
    catalogMaxResultChars: config.catalogMaxResultChars,
    catalogSchemaConcurrency: config.catalogSchemaConcurrency,
    catalogAssetConcurrency: config.catalogAssetConcurrency,
    catalogMaxAssetsPerRun: config.catalogMaxAssetsPerRun,
    catalogMaxTextChars: config.catalogMaxTextChars,
    catalogPageSize: config.catalogPageSize,
    catalogMaxPageSize: config.catalogMaxPageSize,
    maxResultChars: config.maxResultChars,
    maxRows: config.maxRows,
    maxQueryChars: config.maxQueryChars,
    readonly: config.readonly,
    persistConnections: config.persistConnections,
    clients: config.clients,
    enrichmentLanguage: config.enrichmentLanguage,
    connections: config.connections,
  }

  const mountService = (
    scope: Context,
    persistence?: ReturnType<typeof createDomainConnectionPersistence>,
    preferredProfileIds?: () => readonly string[],
  ): DataAgentConnections => {
    const store = createConnectionService(scope, {
      connectTimeoutMs: resolved.connectTimeoutMs,
      queryTimeoutMs: resolved.queryTimeoutMs,
      catalogQueryTimeoutMs: resolved.catalogQueryTimeoutMs,
      catalogMaxResultChars: resolved.catalogMaxResultChars,
      maxResultChars: resolved.maxResultChars,
      maxQueryChars: resolved.maxQueryChars,
      introspectMaxTables: resolved.introspectMaxTables,
      readonly: resolved.readonly,
      clients: resolved.clients,
      ...preferredProfileIds !== undefined ? { preferredProfileIds } : {},
    }, persistence)
    scope.provide('dataAgentConnections', store)

    // Config seeds remain runtime-only deployment defaults. They accept a
    // reference but never a real password and preserve wildcard fallback.
    for (const [sessionId, spec] of Object.entries(resolved.connections)) {
      const connection: DatabaseConnection = {
        type: spec.type,
        database: spec.type === 'sqlite' ? resolve(process.cwd(), spec.database) : spec.database,
        ...spec.host !== undefined ? { host: spec.host } : {},
        ...spec.port !== undefined ? { port: spec.port } : {},
        ...spec.user !== undefined ? { user: spec.user } : {},
        ...spec.passwordRef !== undefined ? { passwordRef: spec.passwordRef } : {},
        ...spec.readonly !== undefined ? { readonly: spec.readonly } : {},
        ...spec.secure !== undefined ? { secure: spec.secure } : {},
      }
      store.set(sessionId, connection)
    }
    return store
  }

  const presetReady = resolved.installPreset
    ? await installPreset(ctx, resolved.presetId)
    : false

  let connectionPersistence: ReturnType<typeof createDomainConnectionPersistence> | undefined
  let catalogPersistence: CatalogPersistence
  if (resolved.persistConnections) {
    const storageDomain = await ensureStorageDomain(ctx)
    const domain = await storageDomain.open(connectionStorageSpec)
    ctx.effect(() => () => domain.close(), 'data-agent: close connection storage domain')
    connectionPersistence = createDomainConnectionPersistence(domain)
    const catalogDomain = await storageDomain.open(catalogStorageSpec)
    ctx.effect(() => () => catalogDomain.close(), 'data-agent: close Catalog storage domain')
    catalogPersistence = createDomainCatalogPersistence(catalogDomain)
  } else {
    ctx.logger.warn('data-agent: persistConnections=false; connection and Catalog state are process-local and cannot restore across Web/TUI')
    catalogPersistence = createMemoryCatalogPersistence()
  }

  // Catalog source ids are durable identities. Prefer their exact matching
  // connection profile even when an older installation created it with a
  // session-prefixed id; this keeps later sessions on the same Catalog.
  const connectionService = mountService(
    ctx,
    connectionPersistence,
    () => catalogPersistence.listSources().map(source => source.profileId),
  )

  const catalog = await createCatalogService(connectionService, catalogPersistence, {
    maxAssetsPerRun: resolved.catalogMaxAssetsPerRun,
    maxTextChars: resolved.catalogMaxTextChars,
    pageSize: resolved.catalogPageSize,
    maxPageSize: resolved.catalogMaxPageSize,
    schemaConcurrency: resolved.catalogSchemaConcurrency,
    assetConcurrency: resolved.catalogAssetConcurrency,
    meaningGenerator: createDshCatalogMeaningGenerator(ctx.agents, ctx.llm, resolved.enrichmentLanguage),
    logger: ctx.logger,
  })
  ctx.provide('dataAgentCatalog', catalog.read)
  ctx.provide('dataAgentCatalogScanner', catalog.scanner)
  ctx.provide('dataAgentCatalogReview', catalog.review)
  ctx.effect(() => () => catalog.scanner.interruptActiveRuns(), 'data-agent: interrupt active Catalog scans')

  if (presetReady) {
    await registerPreset(ctx, resolved.presetId, {
      queryTimeoutMs: resolved.queryTimeoutMs,
      maxResultChars: resolved.maxResultChars,
      maxRows: resolved.maxRows,
      maxQueryChars: resolved.maxQueryChars,
      readonly: resolved.readonly,
      clients: resolved.clients,
    })
  }
}

/**
 * Reuse a surface-provided storage stack (Web) or mount the same JSON stack
 * when an interactive profile such as dsh-tui does not ship one.
 */
async function ensureStorageDomain(ctx: Context): Promise<Context['storageDomain']> {
  const existing = ctx.get('storageDomain')
  if (existing !== undefined) return existing

  ctx.logger.info('data-agent: storageDomain is absent; mounting the JSON storage stack for this profile')
  let storage = ctx.get('storage')
  if (storage === undefined) {
    await ctx.plugin(Storage)
    storage = ctx.get('storage')
  }
  if (storage === undefined) throw new Error('data-agent: failed to mount DSH storage hub')

  if (!storage.backend.names().includes('json')) {
    await ctx.plugin(storageJsonPlugin, { root: join(resolveDshHome(), 'storages') })
  }
  let facility = ctx.get('storageDomain')
  if (facility === undefined) {
    await ctx.plugin(storageDomainPlugin, { backend: 'json' })
    facility = ctx.get('storageDomain')
  }
  if (facility === undefined) throw new Error('data-agent: failed to mount DSH storage-domain facility')
  return facility
}
