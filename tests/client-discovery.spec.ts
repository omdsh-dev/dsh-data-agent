import { describe, expect, it } from 'vitest'
import {
  buildClientSearchDirectories,
  resolveClientExecutable,
  type ClientDiscoverySystem,
} from '../src/client-discovery.ts'

function fakeSystem(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined> = {},
  entries: Record<string, readonly string[]> = {},
): ClientDiscoverySystem {
  return {
    platform,
    env,
    homeDir: platform === 'win32' ? 'C:\\Users\\tester' : '/Users/tester',
    cwd: platform === 'win32' ? 'C:\\workspace' : '/workspace',
    async readDirectory(directory) {
      const hit = entries[directory]
      if (hit === undefined) throw new Error('missing directory')
      return hit
    },
  }
}

const signal = (): AbortSignal => new AbortController().signal

describe('database client discovery', () => {
  it('uses the current subprocess PATH result without scanning fallback directories', async () => {
    let calls = 0
    const system = fakeSystem('darwin', { PATH: '/usr/bin' })
    system.readDirectory = async () => {
      throw new Error('fallback directories must not be read')
    }
    const resolution = await resolveClientExecutable({
      type: 'mysql',
      command: 'mysql',
      env: {},
      signal: signal(),
      system,
      async resolveExecutable(command, env) {
        calls += 1
        expect(command).toBe('mysql')
        expect(env).toEqual({})
        return '/usr/bin/mysql'
      },
    })
    expect(calls).toBe(1)
    expect(resolution).toEqual({ executable: '/usr/bin/mysql', env: {}, searchedDirectories: [] })
  })

  it('finds a Homebrew mysql client for a macOS GUI process and preserves credential env', async () => {
    const resolverEnvs: Array<Readonly<Record<string, string>> | undefined> = []
    const resolution = await resolveClientExecutable({
      type: 'mysql',
      command: 'mysql',
      env: { MYSQL_PWD: 'secret' },
      signal: signal(),
      system: fakeSystem('darwin', { PATH: '/usr/bin:/bin' }),
      async resolveExecutable(_command, env) {
        resolverEnvs.push(env)
        if (env?.PATH?.startsWith('/opt/homebrew/bin:')) return '/opt/homebrew/bin/mysql'
        throw new Error('command "mysql" was not found on PATH')
      },
    })
    expect(resolverEnvs).toHaveLength(2)
    expect(resolution.executable).toBe('/opt/homebrew/bin/mysql')
    expect(resolution.env.MYSQL_PWD).toBe('secret')
    expect(resolution.env.PATH).toMatch(/^\/opt\/homebrew\/bin:/)
    expect(resolution.env.PATH).toMatch(/:\/usr\/bin:\/bin$/)
  })

  it('places configured searchPaths before client homes and platform defaults', async () => {
    const directories = await buildClientSearchDirectories(
      'mysql',
      { searchPaths: ['/opt/company/mysql/bin'] },
      signal(),
      fakeSystem('darwin', { MYSQL_HOME: '/srv/mysql', PATH: '/usr/bin' }),
    )
    expect(directories.slice(0, 4)).toEqual([
      '/opt/company/mysql/bin',
      '/srv/mysql/bin',
      '/srv/mysql',
      '/opt/homebrew/bin',
    ])
  })

  it('includes Linux user, Linuxbrew, Snap, and Nix locations', async () => {
    const directories = await buildClientSearchDirectories(
      'postgres',
      undefined,
      signal(),
      fakeSystem('linux', { PATH: '/usr/bin' }),
    )
    expect(directories).toEqual(expect.arrayContaining([
      '/Users/tester/.local/bin',
      '/home/linuxbrew/.linuxbrew/bin',
      '/usr/local/bin',
      '/snap/bin',
      '/Users/tester/.nix-profile/bin',
      '/nix/var/nix/profiles/default/bin',
    ]))
  })

  it('uses MySQL discovery for Doris and Microsoft ODBC paths for SQL Server', async () => {
    const doris = await buildClientSearchDirectories(
      'doris',
      undefined,
      signal(),
      fakeSystem('darwin', { MYSQL_HOME: '/srv/mysql', PATH: '/usr/bin' }),
    )
    expect(doris).toEqual(expect.arrayContaining([
      '/srv/mysql/bin', '/opt/homebrew/opt/mysql-client/bin',
    ]))

    const sqlserver = await buildClientSearchDirectories(
      'sqlserver',
      undefined,
      signal(),
      fakeSystem('win32', { ProgramFiles: 'C:\\Program Files', Path: 'C:\\Windows\\System32' }),
    )
    expect(sqlserver).toEqual(expect.arrayContaining([
      'C:\\Program Files\\Microsoft SQL Server\\Client SDK\\ODBC\\180\\Tools\\Binn',
      'C:\\Program Files\\Microsoft SQL Server\\Client SDK\\ODBC\\170\\Tools\\Binn',
    ]))
  })

  it('sorts Windows PostgreSQL version directories newest first and uses the effective Path key', async () => {
    const system = fakeSystem(
      'win32',
      {
        Path: 'C:\\Windows\\System32',
        ProgramFiles: 'C:\\Program Files',
        'ProgramFiles(x86)': 'C:\\Program Files (x86)',
        LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
        USERPROFILE: 'C:\\Users\\tester',
      },
      {
        'C:\\Program Files\\PostgreSQL': ['15', '17', '16'],
        'C:\\Program Files (x86)\\PostgreSQL': ['14'],
      },
    )
    const resolution = await resolveClientExecutable({
      type: 'postgres',
      command: 'psql',
      env: { PGPASSWORD: 'secret' },
      signal: signal(),
      system,
      async resolveExecutable(_command, env) {
        const path = env?.Path
        if (path?.includes('C:\\Program Files\\PostgreSQL\\17\\bin')) {
          return 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe'
        }
        throw new Error('psql was not found')
      },
    })
    const path = resolution.env.Path!
    expect(path.indexOf('PostgreSQL\\17\\bin')).toBeLessThan(path.indexOf('PostgreSQL\\16\\bin'))
    expect(path).toMatch(/;C:\\Windows\\System32$/)
    expect(resolution.env.PGPASSWORD).toBe('secret')
    expect(resolution.executable).toMatch(/psql\.exe$/)
  })

  it('does not replace a failing explicit command path with the built-in default', async () => {
    let calls = 0
    await expect(resolveClientExecutable({
      type: 'mysql',
      command: '/custom/mysql-client',
      env: {},
      signal: signal(),
      system: fakeSystem('linux', { PATH: '/usr/bin' }),
      async resolveExecutable() {
        calls += 1
        throw new Error('not executable')
      },
    })).rejects.toThrow(/显式路径不会回退到默认命令/)
    expect(calls).toBe(1)
  })

  it('reports the database type, checked directories, and both configuration fallbacks', async () => {
    await expect(resolveClientExecutable({
      type: 'mysql',
      command: 'mysql',
      config: { searchPaths: ['/opt/company/mysql/bin'] },
      env: {},
      signal: signal(),
      system: fakeSystem('linux', { PATH: '/usr/bin' }),
      async resolveExecutable() {
        throw new Error('not found')
      },
    })).rejects.toThrow(/类型 mysql.*\/opt\/company\/mysql\/bin.*clients\.mysql\.command \/ clients\.mysql\.searchPaths/)
  })

  it('propagates cancellation instead of turning it into a missing-client diagnostic', async () => {
    const controller = new AbortController()
    const reason = new Error('cancel discovery')
    controller.abort(reason)
    await expect(resolveClientExecutable({
      type: 'sqlite',
      command: 'sqlite3',
      env: {},
      signal: controller.signal,
      system: fakeSystem('linux'),
      async resolveExecutable() {
        throw new Error('not found')
      },
    })).rejects.toBe(reason)
  })
})
