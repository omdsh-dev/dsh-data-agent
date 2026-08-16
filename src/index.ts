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

import { access, cp, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-credentials'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as storageJsonPlugin from '@deepseek-ai/dsh-storage-json'
import type {} from '@deepseek-ai/dsh-subprocess'

/** The `dataAgentConnections` service face on the cordis context. */
declare module '@deepseek-ai/cordis' {
  interface Context {
    dataAgentConnections: DataAgentConnections
  }
}
import z from 'schemastery'
import {
  createConnectionService,
  type DataAgentConnections,
  type DatabaseConnection,
  type DatabaseType,
} from './connections.ts'
import { clientsSchema, type ClientConfig } from './clients.ts'
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_INTROSPECT_MAX_TABLES,
  DEFAULT_MAX_RESULT_CHARS,
  DEFAULT_MAX_QUERY_CHARS,
  DEFAULT_PRESET_ID,
  DEFAULT_QUERY_TIMEOUT_MS,
} from './defaults.ts'
import { connectionStorageSpec, createDomainConnectionPersistence } from './storage.ts'

/** Cordis plugin name (diagnostics only). */
export const name = 'data-agent'

/** Services required before the store can serve. */
export const inject = ['subprocess', 'credentials']

/** Deployment overrides for one database type's CLI client. */
export type ClientsConfig = Partial<Record<DatabaseType, ClientConfig>>

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
  /** In-memory cap on database-tool captured output. */
  maxResultChars: number
  /** Maximum SQL text accepted by the shared Web query adapter. */
  maxQueryChars: number
  /** Default read-only guard: true rejects write statements in database tools and /query. */
  readonly: boolean
  /** Persist non-secret profiles/bindings through DSH storage-domain. */
  persistConnections: boolean
  /** CLI client overrides keyed by database type. */
  clients: ClientsConfig
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
  maxResultChars: z.number().step(1).min(1024).default(DEFAULT_MAX_RESULT_CHARS),
  maxQueryChars: z.number().step(1).min(1024).default(DEFAULT_MAX_QUERY_CHARS),
  readonly: z.boolean().default(false),
  persistConnections: z.boolean().default(true),
  clients: clientsSchema,
  connections: z.dict(z.object({
    type: z.union([z.const('mysql'), z.const('postgres'), z.const('sqlite'), z.const('oracle'), z.const('hive'), z.const('impala')]),
    host: z.string(),
    port: z.natural(),
    user: z.string(),
    database: z.string(),
    readonly: z.boolean(),
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
 * `$DSH_HOME/.agent-presets/<presetId>/`. Idempotent: an existing target
 * directory is left untouched (user edits survive); `installPreset: false`
 * never calls this. Best-effort — a failure logs a warning with manual
 * install instructions instead of failing the boot.
 */
export async function installPreset(ctx: Context, presetId: string): Promise<void> {
  const targetDir = join(resolveDshHome(), '.agent-presets', presetId)
  try {
    await access(targetDir)
    ctx.logger.info('data-agent: preset "%s" already present at %s, skipping install', presetId, targetDir)
    await diagnoseExistingPreset(ctx, targetDir)
    return
  } catch {
    // Not present — fall through to install.
  }
  const sourceDir = fileURLToPath(new URL('../preset/data-agent/', import.meta.url))
  try {
    await mkdir(targetDir, { recursive: true })
    await cp(sourceDir, targetDir, { recursive: true })
    ctx.logger.info('data-agent: installed preset "%s" to %s', presetId, targetDir)
  } catch (error) {
    ctx.logger.warn(
      'data-agent: failed to install preset "%s" to %s (%s); '
      + 'copy preset/data-agent/ manually to enable the 数据模式 preset',
      presetId, targetDir, error instanceof Error ? error.message : String(error),
    )
  }
}

/** Exact profile-local package installation command used by diagnostics/docs. */
export function profileInstallCommand(profile: string): string {
  return `dsh plugin --profile ${profile} add @yejiming/dsh-data-agent`
}

/** Actionable diagnostic for a roster-visible preset whose profile lacks this package. */
export function missingProfileDependencyMessage(profile: string): string {
  return `data-agent preset is visible, but profile "${profile}" cannot resolve @yejiming/dsh-data-agent/tool or /command. Run: ${profileInstallCommand(profile)}`
}

/** Warn without overwriting when a pre-existing user preset lacks the command row. */
async function diagnoseExistingPreset(ctx: Context, targetDir: string): Promise<void> {
  const composition = join(targetDir, 'agent.cordis.yml')
  try {
    const source = await readFile(composition, 'utf8')
    if (source.includes('@yejiming/dsh-data-agent/command')) return
    const profile = process.env.DSH_PROFILE?.trim()
    const installHint = profile !== undefined && profile.length > 0
      ? profileInstallCommand(profile)
      : `${profileInstallCommand('web')}；${profileInstallCommand('dsh-tui')}`
    ctx.logger.warn(
      'data-agent: existing user preset at %s does not contain the database-command row; '
      + 'the file was not overwritten. Back it up, then add name: "@yejiming/dsh-data-agent/command". '
      + 'Also install this package in the target profile: %s',
      composition,
      installHint,
    )
  } catch (error) {
    ctx.logger.warn(
      'data-agent: could not inspect existing preset %s (%s); it was not overwritten',
      composition,
      error instanceof Error ? error.message : String(error),
    )
  }
}

/**
 * Mount the data-agent host row: connection store, config-seeded
 * connections, and preset self-install. HTTP routes are the sibling
 * `data-agent-routes` row (`./routes`).
 * @param ctx - host cordis context.
 * @param config - validated loader configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved: Required<Config> = {
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
    connections: config.connections,
  }

  const mountService = (
    scope: Context,
    persistence?: ReturnType<typeof createDomainConnectionPersistence>,
  ): void => {
    const store = createConnectionService(scope, {
      connectTimeoutMs: resolved.connectTimeoutMs,
      queryTimeoutMs: resolved.queryTimeoutMs,
      maxResultChars: resolved.maxResultChars,
      maxQueryChars: resolved.maxQueryChars,
      introspectMaxTables: resolved.introspectMaxTables,
      readonly: resolved.readonly,
      clients: resolved.clients,
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
      }
      store.set(sessionId, connection)
    }
  }

  if (resolved.persistConnections) {
    const storageDomain = await ensureStorageDomain(ctx)
    const domain = await storageDomain.open(connectionStorageSpec)
    ctx.effect(() => () => domain.close(), 'data-agent: close connection storage domain')
    mountService(ctx, createDomainConnectionPersistence(domain))
  } else {
    ctx.logger.warn('data-agent: persistConnections=false; connection state is process-local and cannot restore across Web/TUI')
    mountService(ctx)
  }

  if (resolved.installPreset) {
    await installPreset(ctx, resolved.presetId)
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
