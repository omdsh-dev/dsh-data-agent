import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Config, apply, missingProfileDependencyMessage } from '../src/index.ts'
import { apply as applyToolHalf } from '../src/tool.ts'
import { apply as applyCommandHalf, DATA_AGENT_TOOL_NAMES } from '../src/command.ts'
import { createConnectionStore } from '../src/connections.ts'

const root = new URL('../', import.meta.url)

describe('Web/TUI package and preset composition', () => {
  it('publishes isolated Node tool/command entries and optional Web peers', () => {
    const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as Record<string, any>
    expect(pkg.exports['./tool'].default).toBe('./lib/tool.js')
    expect(pkg.exports['./command'].default).toBe('./lib/command.js')
    expect(pkg.peerDependencies.react).toContain('^19.0.0')
    expect(pkg.peerDependenciesMeta.react.optional).toBe(true)
    expect(pkg.dsh.engines.dsh).toBe('0.1.7-rc.1')
    expect(pkg.peerDependencies['@deepseek-ai/dsh-client-runtime']).toBeUndefined()
    expect(pkg.peerDependenciesMeta['@deepseek-ai/dsh-api-session-controller'].optional).toBe(true)
    expect(pkg.peerDependencies['@deepseek-ai/dsh-client-ui-agent-preset']).toBe('0.1.7-rc.1')
    expect(pkg.peerDependenciesMeta['@deepseek-ai/dsh-client-ui-agent-preset'].optional).toBe(true)
    expect(pkg.peerDependencies['@deepseek-ai/dsh-client-ui-tool']).toBe('0.1.7-rc.1')
    expect(pkg.peerDependenciesMeta['@deepseek-ai/dsh-client-ui-tool'].optional).toBe(true)
    expect(pkg.peerDependencies['@deepseek-ai/dsh-client-ui-renderer']).toBe('0.1.7-rc.1')
    expect(pkg.peerDependencies['@deepseek-ai/dsh-client-ui-session']).toBe('0.1.7-rc.1')
    expect(pkg.peerDependencies['@deepseek-ai/dsh-client-ui-workspace']).toBe('0.1.7-rc.1')
    expect(pkg.peerDependenciesMeta['@deepseek-ai/dsh-client-ui-workspace'].optional).toBe(true)
    expect(pkg.peerDependencies['@deepseek-harness-tui/dsh-tui']).toBeUndefined()
    expect(pkg.devDependencies['@deepseek-harness-tui/dsh-tui']).toBeUndefined()
    // The keyed tool.call.toolview slot must exist before this package registers
    // into it: the client inject list loads the tool renderer ahead of us.
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-api-session-controller')
    expect(pkg.dsh.client.inject).not.toContain('@deepseek-ai/dsh-client-runtime')
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-agent-preset')
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-tool')
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-renderer')
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-session')
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-workspace')
  })

  it('keeps the preset composition on built-in rows and preloads package capabilities from the profile entry', () => {
    const preset = readFileSync(new URL('preset/data-agent/agent.cordis.yml', root), 'utf8')
    expect(preset.match(/^- id:/gm)).toHaveLength(2)
    expect(preset).not.toContain("name: '@yejiming/dsh-data-agent/tool'")
    expect(preset).not.toContain("name: '@yejiming/dsh-data-agent/command'")
    const profileEntry = readFileSync(new URL('src/index.ts', root), 'utf8')
    expect(profileEntry).toContain('ctx.agentPresets.register(')
    expect(profileEntry).not.toContain('standingKeyFor')
    expect(profileEntry).not.toContain('Object.getOwnPropertySymbols')
    const toolSource = readFileSync(new URL('src/tool.ts', root), 'utf8')
    expect([...toolSource.matchAll(/name: '(sql-query|sql-write|sql-cmd)'/g)].map(match => match[1])).toEqual([
      'sql-query', 'sql-write', 'sql-cmd',
    ])
    // render-analysis is registered directly in every data-agent standing scope.
    expect(toolSource).toContain("name: 'render-analysis'")
    expect(toolSource).not.toContain("ctx.get('webServer')")
    expect(toolSource).not.toContain("ctx.get('dataAgentTuiAnalysis')")
    const commandSource = readFileSync(new URL('src/command.ts', root), 'utf8')
    expect(commandSource).toContain("'catalog-search', 'catalog-get', 'metric-get'")
    expect(commandSource).toContain('options.isDshTuiPluginLoaded ?? isDshTuiPluginLoaded')
    expect(commandSource).toContain("DSH_TUI_PLUGIN_RUNTIME_NAME = 'dsh-tui'")
    expect(commandSource).not.toContain("--profile=dsh-tui")
    expect(commandSource).not.toContain('process.argv')
    expect(DATA_AGENT_TOOL_NAMES).toEqual([
      'str_replace_editor', 'sql-query', 'sql-write', 'sql-cmd',
      'catalog-search', 'catalog-get', 'metric-get',
    ])
    expect(preset).toContain("name: '@deepseek-ai/dsh-tool-str-replace-editor'")
    expect(preset).not.toContain("name: '@deepseek-ai/dsh-tool-fs'")
    expect(preset).not.toContain('）、read、write、edit')
    expect(preset).not.toContain('（write/edit）')
    // The persona describes the shared HTML artifact without adding a row.
    expect(preset).toContain('render-analysis')
    expect(preset).toContain('analysis-reports/')
    expect(preset).not.toContain('/analysis')
    expect(preset).toContain('不强制画图')
  })

  it('keeps the command entry free of TUI and browser implementation imports', () => {
    const command = readFileSync(new URL('src/command.ts', root), 'utf8')
    expect(command).not.toMatch(/from ['"](?:@deepseek-harness-tui\/dsh-tui|react|ink)['"]/)
  })

  it('returns an actionable target-profile missing-package diagnostic', () => {
    const message = missingProfileDependencyMessage('dsh-tui')
    expect(message).toContain('profile "dsh-tui"')
    expect(message).toContain('profile-preloaded capabilities')
    expect(message).toContain('dsh plugin --profile dsh-tui add @yejiming/dsh-data-agent')
  })

  it('models separate Web/TUI installs and the missing-package ghost preset case', () => {
    const readFixture = (name: string) => JSON.parse(readFileSync(
      new URL(`tests/fixtures/profiles/${name}/package.json`, root), 'utf8',
    )) as Record<string, any>
    for (const profile of ['web', 'dsh-tui']) {
      const fixture = readFixture(profile)
      expect(fixture.dependencies['@yejiming/dsh-data-agent']).toBe('file:../../../..')
      expect(fixture.dsh.profile.bundles).toContain('@yejiming/dsh-data-agent')
    }
    const missing = readFixture('missing')
    expect(missing.dependencies['@yejiming/dsh-data-agent']).toBeUndefined()
    expect(missing.dsh.profile.bundles).not.toContain('@yejiming/dsh-data-agent')
  })

  it('rejects real passwords in config-seeded connections', () => {
    expect(() => Config({
      connections: {
        '*': { type: 'mysql', database: 'orders', password: 'must-not-persist' },
      },
    } as never)).toThrow()
  })

  it('accepts a searchPaths-only client discovery override', () => {
    const config = Config({
      clients: { mysql: { searchPaths: ['/opt/company/mysql/bin'] } },
    })
    expect(config.clients.mysql).toEqual({ args: [], searchPaths: ['/opt/company/mysql/bin'] })
  })

  it('validates bounded Catalog loader options', async () => {
    expect(Config({
      catalogQueryTimeoutMs: 12_000,
      catalogMaxResultChars: 8_000_000,
      catalogSchemaConcurrency: 3,
      catalogAssetConcurrency: 6,
      catalogMaxAssetsPerRun: 75_000,
      catalogMaxTextChars: 4_096,
      catalogPageSize: 40,
      catalogMaxPageSize: 200,
    })).toMatchObject({
      catalogQueryTimeoutMs: 12_000,
      catalogMaxResultChars: 8_000_000,
      catalogSchemaConcurrency: 3,
      catalogAssetConcurrency: 6,
      catalogMaxAssetsPerRun: 75_000,
      catalogMaxTextChars: 4_096,
      catalogPageSize: 40,
      catalogMaxPageSize: 200,
    })
    expect(() => Config({ catalogAssetConcurrency: 0 })).toThrow()
    expect(() => Config({ catalogMaxResultChars: 1_023 })).toThrow()
    expect(() => Config({ catalogMaxAssetsPerRun: 1_000_001 })).toThrow()
    expect(() => Config({ catalogMaxTextChars: 4_097 })).toThrow()
    expect(() => Config({ catalogPageSize: 201 })).toThrow()
    await expect(apply({} as never, Config({ installPreset: false, catalogPageSize: 100, catalogMaxPageSize: 50 })))
      .rejects.toThrow(/cannot exceed/)
  })

  it('accepts safe seeded connections and CLI overrides for the new database types', () => {
    const config = Config({
      clients: {
        doris: { command: '/opt/mysql/bin/mysql' },
        sqlserver: { searchPaths: ['/opt/mssql-tools18/bin'] },
      },
      connections: {
        'clickhouse-session': {
          type: 'clickhouse', database: 'analytics', secure: true, passwordRef: 'CLICKHOUSE_PASSWORD',
        },
        'doris-session': { type: 'doris', database: 'analytics', passwordRef: 'DORIS_PASSWORD' },
        'sqlserver-session': { type: 'sqlserver', database: 'warehouse', passwordRef: 'SQLSERVER_PASSWORD' },
      },
    })
    expect(config.connections['clickhouse-session']).toMatchObject({ type: 'clickhouse', secure: true })
    expect(config.connections['doris-session']?.type).toBe('doris')
    expect(config.connections['sqlserver-session']?.type).toBe('sqlserver')
    expect(config.clients.sqlserver?.searchPaths).toEqual(['/opt/mssql-tools18/bin'])
    expect(() => Config({
      clients: { clickhouse: { command: 'clickhouse-client' } },
    } as never)).toThrow()
  })

  it('uses process-local mode immediately when persistence is explicitly disabled', async () => {
    let provided = false
    const ctx: any = {
      logger: { info() {}, warn() {} },
      provide(name: string) { if (name === 'dataAgentConnections') provided = true },
      effect() {},
      inject() { throw new Error('persistConnections=false must not wait for storageDomain') },
    }
    await apply(ctx, Config({ installPreset: false, persistConnections: false }))
    expect(provided).toBe(true)
  })
})

describe('render-analysis cross-surface registration', () => {
  function makeToolContext() {
    const registered: { name?: string }[] = []
    const ctx = {
      tools: { register(def: { name?: string }) { registered.push(def) } },
      subprocess: {
        resolveExecutable: async (command: string) => '/usr/bin/' + command,
        spawn: () => ({ done: Promise.resolve({ exitCode: 0, signal: null }), collected: {} }),
      },
      dataAgentConnections: createConnectionStore(),
      get() { return undefined },
    } as never
    applyToolHalf(ctx as never, {
      queryTimeoutMs: 5000,
      maxResultChars: 20000,
      maxRows: 100,
      maxQueryChars: 65536,
      readonly: false,
      clients: {},
    })
    return registered.map(def => def.name)
  }

  it('registers with no Web or TUI presentation service', () => {
    expect(makeToolContext()).toEqual([
      'sql-query', 'sql-write', 'sql-cmd', 'render-analysis',
      'catalog-search', 'catalog-get', 'metric-get',
    ])
  })

  it('denies host tools while retaining preset-owned tools without agent/created', () => {
    const restrictions: unknown[] = []
    const ctx = {
      tools: {
        restrict(filter: unknown) { restrictions.push(filter) },
        schemas() {
          return [
            'describe_image',
            ...DATA_AGENT_TOOL_NAMES,
            'render-analysis',
            'ssh_exec',
          ].map(name => ({ name }))
        },
      },
      commands: { register() {} },
      dataAgentConnections: createConnectionStore(),
      get() { return undefined },
      emit() {},
      effect(setup: () => () => void) {
        const dispose = setup()
        return { dispose }
      },
    } as never
    applyCommandHalf(ctx, { isDshTuiPluginLoaded: () => false })
    expect(restrictions).toEqual([{ deny: ['describe_image', 'ssh_exec'] }])
    expect((ctx.commands as unknown as { registered?: unknown }).registered).toBeUndefined()
    const command = readFileSync(new URL('src/command.ts', root), 'utf8')
    expect(command).not.toContain("ctx.on('agent/created'")
    expect(command).not.toContain("name: 'analysis'")
  })
})
