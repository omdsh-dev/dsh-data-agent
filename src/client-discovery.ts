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

import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import type { CliDatabaseType, ClientConfig } from './clients.ts'

/** Maximum child names consumed from one known version/formula directory. */
const MAX_DYNAMIC_ENTRIES = 64

/** Host facts are injectable so all supported platforms can be tested on one CI host. */
export interface ClientDiscoverySystem {
  platform: NodeJS.Platform
  env: Readonly<Record<string, string | undefined>>
  homeDir: string
  cwd: string
  readDirectory(directory: string): Promise<readonly string[]>
}

/** DSH subprocess executable resolver face. */
export type ExecutableResolver = (
  command: string,
  env?: Readonly<Record<string, string>>,
  signal?: AbortSignal,
) => Promise<string>

/** A resolved executable plus the environment that must also be used for spawn. */
export interface ClientExecutableResolution {
  executable: string
  env: Readonly<Record<string, string>>
  searchedDirectories: readonly string[]
}

/** Input for one database client resolution attempt. */
export interface ResolveClientExecutableOptions {
  type: CliDatabaseType
  command: string
  config?: ClientConfig
  env: Readonly<Record<string, string>>
  signal: AbortSignal
  resolveExecutable: ExecutableResolver
  system?: ClientDiscoverySystem
}

/** Production host facts. */
const DEFAULT_SYSTEM: ClientDiscoverySystem = {
  platform: process.platform,
  env: process.env,
  homeDir: homedir(),
  cwd: process.cwd(),
  async readDirectory(directory) {
    return await readdir(directory)
  },
}

const HOME_ENV_BY_TYPE: Readonly<Record<CliDatabaseType, readonly string[]>> = {
  mysql: ['MYSQL_HOME'],
  postgres: ['PGHOME', 'PGROOT'],
  sqlite: ['SQLITE_HOME'],
  oracle: ['ORACLE_HOME'],
  hive: ['HIVE_HOME'],
  impala: ['IMPALA_HOME'],
  doris: ['MYSQL_HOME'],
  sqlserver: ['SQLCMD_HOME', 'MSSQL_TOOLS_HOME'],
}

interface DynamicDirectory {
  root: string
  accepts(name: string): boolean
  suffix: readonly string[]
}

type PathApi = typeof posix

function pathApi(platform: NodeJS.Platform): PathApi {
  return platform === 'win32' ? win32 : posix
}

function environmentValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== 'win32') return env[name]
  const key = Object.keys(env).find(candidate => candidate.toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : env[key]
}

function expandHome(directory: string, system: ClientDiscoverySystem, paths: PathApi): string {
  const trimmed = directory.trim()
  if (trimmed === '~') return system.homeDir
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return paths.join(system.homeDir, trimmed.slice(2))
  }
  return paths.isAbsolute(trimmed) ? paths.normalize(trimmed) : paths.resolve(system.cwd, trimmed)
}

function normalizeDirectories(
  directories: readonly string[],
  system: ClientDiscoverySystem,
  paths: PathApi,
): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of directories) {
    if (raw.trim() === '') continue
    const directory = expandHome(raw, system, paths)
    const key = system.platform === 'win32' ? directory.toLowerCase() : directory
    if (seen.has(key)) continue
    seen.add(key)
    result.push(directory)
  }
  return result
}

function clientHomeDirectories(
  type: CliDatabaseType,
  system: ClientDiscoverySystem,
  paths: PathApi,
): string[] {
  const result: string[] = []
  for (const name of HOME_ENV_BY_TYPE[type]) {
    const value = environmentValue(system.env, name, system.platform)?.trim()
    if (value === undefined || value === '') continue
    result.push(paths.join(value, 'bin'), value)
  }
  return result
}

function macFixedDirectories(type: CliDatabaseType): string[] {
  const formulaDirectories: Readonly<Record<CliDatabaseType, readonly string[]>> = {
    mysql: [
      '/opt/homebrew/opt/mysql-client/bin', '/opt/homebrew/opt/mysql/bin',
      '/usr/local/opt/mysql-client/bin', '/usr/local/opt/mysql/bin', '/usr/local/mysql/bin',
    ],
    postgres: [
      '/opt/homebrew/opt/libpq/bin', '/usr/local/opt/libpq/bin',
      '/Applications/Postgres.app/Contents/Versions/latest/bin',
    ],
    sqlite: ['/opt/homebrew/opt/sqlite/bin', '/usr/local/opt/sqlite/bin'],
    oracle: [],
    hive: ['/opt/homebrew/opt/hive/bin', '/usr/local/opt/hive/bin'],
    impala: ['/opt/homebrew/opt/impala/bin', '/usr/local/opt/impala/bin'],
    doris: [
      '/opt/homebrew/opt/mysql-client/bin', '/opt/homebrew/opt/mysql/bin',
      '/usr/local/opt/mysql-client/bin', '/usr/local/opt/mysql/bin', '/usr/local/mysql/bin',
    ],
    sqlserver: [
      '/opt/homebrew/opt/mssql-tools18/bin', '/usr/local/opt/mssql-tools18/bin',
      '/opt/mssql-tools18/bin', '/opt/mssql-tools/bin',
    ],
  }
  return [
    '/opt/homebrew/bin',
    ...formulaDirectories[type],
    '/usr/local/bin',
    '/opt/local/bin',
    '/usr/bin',
  ]
}

function linuxFixedDirectories(system: ClientDiscoverySystem, paths: PathApi): string[] {
  return [
    paths.join(system.homeDir, '.local', 'bin'),
    '/home/linuxbrew/.linuxbrew/bin',
    paths.join(system.homeDir, '.linuxbrew', 'bin'),
    '/usr/local/bin',
    '/usr/bin',
    '/snap/bin',
    paths.join(system.homeDir, '.nix-profile', 'bin'),
    '/nix/var/nix/profiles/default/bin',
  ]
}

function windowsFixedDirectories(
  type: CliDatabaseType,
  system: ClientDiscoverySystem,
  paths: PathApi,
): string[] {
  const localAppData = environmentValue(system.env, 'LOCALAPPDATA', system.platform)
  const userProfile = environmentValue(system.env, 'USERPROFILE', system.platform) ?? system.homeDir
  const chocolatey = environmentValue(system.env, 'ChocolateyInstall', system.platform)
  const programData = environmentValue(system.env, 'ProgramData', system.platform) ?? 'C:\\ProgramData'
  const programFiles = environmentValue(system.env, 'ProgramFiles', system.platform) ?? 'C:\\Program Files'
  const typeSpecific: Readonly<Record<CliDatabaseType, readonly string[]>> = {
    mysql: [],
    postgres: [],
    sqlite: [paths.join('C:\\', 'sqlite'), paths.join(programFiles, 'SQLite')],
    oracle: [],
    hive: [],
    impala: [],
    doris: [],
    sqlserver: [
      paths.join(programFiles, 'Microsoft SQL Server', 'Client SDK', 'ODBC', '180', 'Tools', 'Binn'),
      paths.join(programFiles, 'Microsoft SQL Server', 'Client SDK', 'ODBC', '170', 'Tools', 'Binn'),
    ],
  }
  return [
    ...(localAppData === undefined ? [] : [paths.join(localAppData, 'Microsoft', 'WinGet', 'Links')]),
    paths.join(userProfile, 'scoop', 'shims'),
    ...(chocolatey === undefined ? [] : [paths.join(chocolatey, 'bin')]),
    paths.join(programData, 'chocolatey', 'bin'),
    ...typeSpecific[type],
  ]
}

function formulaPattern(type: CliDatabaseType): RegExp {
  switch (type) {
    case 'mysql': return /^(?:mysql|mysql-client)(?:@.+)?$/i
    case 'postgres': return /^(?:postgresql(?:@.+)?|libpq)$/i
    case 'sqlite': return /^sqlite(?:@.+)?$/i
    case 'oracle': return /^(?:oracle|instantclient)(?:@.+)?$/i
    case 'hive': return /^hive(?:@.+)?$/i
    case 'impala': return /^impala(?:@.+)?$/i
    case 'doris': return /^(?:mysql|mysql-client)(?:@.+)?$/i
    case 'sqlserver': return /^(?:mssql-tools|mssql-tools18)(?:@.+)?$/i
  }
}

function dynamicDirectories(
  type: CliDatabaseType,
  system: ClientDiscoverySystem,
  paths: PathApi,
): DynamicDirectory[] {
  const result: DynamicDirectory[] = []
  if (system.platform === 'darwin') {
    const pattern = formulaPattern(type)
    result.push(
      { root: '/opt/homebrew/opt', accepts: name => pattern.test(name), suffix: ['bin'] },
      { root: '/usr/local/opt', accepts: name => pattern.test(name), suffix: ['bin'] },
    )
    if (type === 'postgres') {
      result.push(
        { root: '/Library/PostgreSQL', accepts: () => true, suffix: ['bin'] },
        { root: '/Applications/Postgres.app/Contents/Versions', accepts: name => name !== 'latest', suffix: ['bin'] },
      )
    }
    if (type === 'oracle') {
      result.push({ root: '/opt/oracle', accepts: name => /^instantclient/i.test(name), suffix: [] })
    }
  } else if (system.platform === 'linux') {
    const pattern = formulaPattern(type)
    result.push(
      { root: '/home/linuxbrew/.linuxbrew/opt', accepts: name => pattern.test(name), suffix: ['bin'] },
      { root: paths.join(system.homeDir, '.linuxbrew', 'opt'), accepts: name => pattern.test(name), suffix: ['bin'] },
    )
  } else if (system.platform === 'win32') {
    const roots = [
      environmentValue(system.env, 'ProgramFiles', system.platform) ?? 'C:\\Program Files',
      environmentValue(system.env, 'ProgramFiles(x86)', system.platform) ?? 'C:\\Program Files (x86)',
    ]
    for (const root of roots) {
      if (type === 'mysql' || type === 'doris') {
        result.push(
          { root: paths.join(root, 'MySQL'), accepts: () => true, suffix: ['bin'] },
          { root, accepts: name => /^MariaDB/i.test(name), suffix: ['bin'] },
        )
      } else if (type === 'postgres') {
        result.push({ root: paths.join(root, 'PostgreSQL'), accepts: () => true, suffix: ['bin'] })
      } else if (type === 'oracle') {
        result.push({ root: paths.join(root, 'Oracle'), accepts: () => true, suffix: ['bin'] })
      } else if (type === 'sqlserver') {
        result.push({
          root: paths.join(root, 'Microsoft SQL Server', 'Client SDK', 'ODBC'),
          accepts: () => true,
          suffix: ['Tools', 'Binn'],
        })
      }
    }
  }
  return result
}

async function expandDynamicDirectories(
  descriptors: readonly DynamicDirectory[],
  system: ClientDiscoverySystem,
  paths: PathApi,
  signal: AbortSignal,
): Promise<string[]> {
  const groups = await Promise.all(descriptors.map(async descriptor => {
    signal.throwIfAborted()
    let names: readonly string[]
    try {
      names = await system.readDirectory(descriptor.root)
    } catch {
      return []
    }
    signal.throwIfAborted()
    return names
      .filter(name => descriptor.accepts(name))
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' }))
      .slice(0, MAX_DYNAMIC_ENTRIES)
      .map(name => paths.join(descriptor.root, name, ...descriptor.suffix))
  }))
  return groups.flat()
}

/** Build ordered fallback directories without recursively scanning the host. */
export async function buildClientSearchDirectories(
  type: CliDatabaseType,
  config: ClientConfig | undefined,
  signal: AbortSignal,
  system: ClientDiscoverySystem = DEFAULT_SYSTEM,
): Promise<string[]> {
  const paths = pathApi(system.platform)
  const configured = config?.searchPaths ?? []
  const homes = clientHomeDirectories(type, system, paths)
  const fixed = system.platform === 'win32'
    ? windowsFixedDirectories(type, system, paths)
    : system.platform === 'darwin'
      ? macFixedDirectories(type)
      : linuxFixedDirectories(system, paths)
  const dynamic = await expandDynamicDirectories(dynamicDirectories(type, system, paths), system, paths, signal)
  signal.throwIfAborted()
  return normalizeDirectories([...configured, ...homes, ...fixed, ...dynamic], system, paths)
}

function hasPathSeparator(command: string): boolean {
  return command.includes('/') || command.includes('\\')
}

function withSearchPath(
  explicitEnv: Readonly<Record<string, string>>,
  directories: readonly string[],
  system: ClientDiscoverySystem,
): Readonly<Record<string, string>> {
  const pathName = system.platform === 'win32'
    ? Object.keys(system.env).find(name => name.toLowerCase() === 'path') ?? 'Path'
    : 'PATH'
  const explicitPathName = Object.keys(explicitEnv).find(name => (
    system.platform === 'win32' ? name.toLowerCase() === 'path' : name === 'PATH'
  ))
  const parentPath = explicitPathName === undefined
    ? environmentValue(system.env, 'PATH', system.platform)
    : explicitEnv[explicitPathName]
  const separator = system.platform === 'win32' ? ';' : ':'
  const prefix = directories.join(separator)
  const combined = parentPath === undefined || parentPath === '' ? prefix : `${prefix}${separator}${parentPath}`
  const result: Record<string, string> = { ...explicitEnv }
  if (explicitPathName !== undefined && explicitPathName !== pathName) delete result[explicitPathName]
  result[pathName] = combined
  return result
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function checkedDirectoriesText(directories: readonly string[]): string {
  const visible = directories.slice(0, 16)
  const suffix = directories.length > visible.length ? `，另有${directories.length - visible.length}个目录` : ''
  return visible.length === 0 ? '无补充目录' : `${visible.join('、')}${suffix}`
}

/**
 * Resolve one configured/default client. Current PATH (or an explicit path)
 * always wins. Only a missing bare command activates bounded PATH discovery.
 */
export async function resolveClientExecutable(
  options: ResolveClientExecutableOptions,
): Promise<ClientExecutableResolution> {
  const system = options.system ?? DEFAULT_SYSTEM
  let initialError: unknown
  try {
    const executable = await options.resolveExecutable(options.command, options.env, options.signal)
    return { executable, env: options.env, searchedDirectories: [] }
  } catch (error) {
    options.signal.throwIfAborted()
    initialError = error
  }

  const paths = pathApi(system.platform)
  if (paths.isAbsolute(options.command) || hasPathSeparator(options.command)) {
    throw new Error(
      `无法解析数据库客户端 "${options.command}"（类型 ${options.type}：${errorText(initialError)}）；`
      + `该显式路径不会回退到默认命令，请检查 clients.${options.type}.command`,
    )
  }

  const directories = await buildClientSearchDirectories(options.type, options.config, options.signal, system)
  const discoveryEnv = withSearchPath(options.env, directories, system)
  try {
    const executable = await options.resolveExecutable(options.command, discoveryEnv, options.signal)
    return { executable, env: discoveryEnv, searchedDirectories: directories }
  } catch (fallbackError) {
    options.signal.throwIfAborted()
    throw new Error(
      `无法解析数据库客户端 "${options.command}"（类型 ${options.type}；`
      + `当前PATH：${errorText(initialError)}；补充PATH：${errorText(fallbackError)}）。`
      + `已检查：${checkedDirectoriesText(directories)}；请确认客户端已安装，`
      + `或配置 clients.${options.type}.command / clients.${options.type}.searchPaths`,
    )
  }
}
