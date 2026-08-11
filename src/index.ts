/**
 * Data Agent server half for the dsh web GUI. The host row provides the
 * `dataAgentConnections` service (session-scoped in-memory store; passwords
 * never leave memory), seeds config connections (`connections`, `'*'` =
 * wildcard default), and installs the `data-agent` agent preset into
 * `$DSH_HOME/.agent-presets/` (idempotent, never overwrites a user-edited
 * directory).
 *
 * The HTTP routes live in the separate `./routes` entry
 * (`@deepseek-ai/dsh-data-agent/routes`, cordis row `data-agent-routes`) so
 * this row keeps working in headless profiles without a webserver; the sqlcmd
 * tool itself lives in the `./tool` entry and is mounted only by the
 * data-agent preset.
 * @module @deepseek-ai/dsh-data-agent
 */

import { access, cp, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from 'cordis'

/** The `dataAgentConnections` service face on the cordis context. */
declare module 'cordis' {
  interface Context {
    dataAgentConnections: DataAgentConnections
  }
}
import z from 'schemastery'
import {
  createConnectionStore,
  type DataAgentConnections,
  type DatabaseConnection,
  type DatabaseType,
} from './connections.ts'
import { clientsSchema, type ClientConfig } from './clients.ts'
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_INTROSPECT_MAX_TABLES,
  DEFAULT_MAX_RESULT_CHARS,
  DEFAULT_PRESET_ID,
  DEFAULT_QUERY_TIMEOUT_MS,
} from './defaults.ts'

/** Cordis plugin name (diagnostics only). */
export const name = 'data-agent'

/** Services required before the store can serve. */
export const inject = ['subprocess']

/** Deployment overrides for one database type's CLI client. */
export interface ClientsConfig {
  mysql?: ClientConfig
  postgres?: ClientConfig
  sqlite?: ClientConfig
}

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
  /** Deadline for one sqlcmd query, milliseconds. */
  queryTimeoutMs: number
  /** In-memory cap on sqlcmd captured output. */
  maxResultChars: number
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
  clients: clientsSchema,
  connections: z.dict(z.object({
    type: z.union([z.const('mysql'), z.const('postgres'), z.const('sqlite')]),
    host: z.string(),
    port: z.natural(),
    user: z.string(),
    database: z.string(),
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
      + 'copy preset/data-agent/ manually to enable the 数据Agent preset',
      presetId, targetDir, error instanceof Error ? error.message : String(error),
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
export function apply(ctx: Context, config: Config): void {
  const resolved: Required<Config> = {
    presetId: config.presetId,
    installPreset: config.installPreset,
    connectTimeoutMs: config.connectTimeoutMs,
    introspectMaxTables: config.introspectMaxTables,
    queryTimeoutMs: config.queryTimeoutMs,
    maxResultChars: config.maxResultChars,
    clients: config.clients,
    connections: config.connections,
  }

  // The connection store is host-plane state: the sqlcmd tool half (mounted
  // inside the data-agent preset) consumes it across the agent boundary, so
  // it must live here, keyed by session id, not inside any preset realm.
  const store = createConnectionStore()
  ctx.provide('dataAgentConnections', store)

  // Config-seeded connections (password-free by schema): sqlite paths pin to
  // absolute; the `'*'` key seeds the wildcard default.
  for (const [sessionId, spec] of Object.entries(config.connections)) {
    const connection: DatabaseConnection = {
      type: spec.type,
      database: spec.type === 'sqlite' ? resolve(process.cwd(), spec.database) : spec.database,
      ...spec.host !== undefined ? { host: spec.host } : {},
      ...spec.port !== undefined ? { port: spec.port } : {},
      ...spec.user !== undefined ? { user: spec.user } : {},
    }
    store.set(sessionId, connection)
  }

  if (resolved.installPreset) {
    void installPreset(ctx, resolved.presetId)
  }
}
