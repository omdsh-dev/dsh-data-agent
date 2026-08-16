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
    expect(pkg.peerDependenciesMeta['@deepseek-ai/dsh-client-runtime'].optional).toBe(true)
    expect(pkg.peerDependencies['@deepseek-ai/dsh-client-ui-tool']).toBe('^0.1.0-rc.6')
    expect(pkg.peerDependenciesMeta['@deepseek-ai/dsh-client-ui-tool'].optional).toBe(true)
    // The keyed tool.call.toolview slot must exist before this package registers
    // into it: the client inject list loads the tool renderer ahead of us.
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-tool')
  })

  it('composes four preset rows with the native editor and the exact Web/TUI tools', () => {
    const preset = readFileSync(new URL('preset/data-agent/agent.cordis.yml', root), 'utf8')
    expect(preset.match(/^- id:/gm)).toHaveLength(4)
    expect(preset).toContain("name: '@yejiming/dsh-data-agent/tool'")
    expect(preset).toContain("name: '@yejiming/dsh-data-agent/command'")
    const toolSource = readFileSync(new URL('src/tool.ts', root), 'utf8')
    expect([...toolSource.matchAll(/name: '(sql-query|sql-write|sql-cmd)'/g)].map(match => match[1])).toEqual([
      'sql-query', 'sql-write', 'sql-cmd',
    ])
    // render-analysis is registered directly in the standing preset scope,
    // gated on the Web capability.
    expect(toolSource).toContain("name: 'render-analysis'")
    expect(toolSource).toContain("ctx.get('webServer')")
    const commandSource = readFileSync(new URL('src/command.ts', root), 'utf8')
    expect(commandSource).toContain("DATA_AGENT_TOOL_NAMES = ['str_replace_editor', 'sql-query', 'sql-write', 'sql-cmd']")
    expect(DATA_AGENT_TOOL_NAMES).toEqual(['str_replace_editor', 'sql-query', 'sql-write', 'sql-cmd'])
    expect(preset).toContain("name: '@deepseek-ai/dsh-tool-str-replace-editor'")
    expect(preset).not.toContain("name: '@deepseek-ai/dsh-tool-fs'")
    expect(preset).not.toContain('）、read、write、edit')
    expect(preset).not.toContain('（write/edit）')
    // The persona names the Web-only analysis capability without adding a row.
    expect(preset).toContain('render-analysis')
    expect(preset).toContain('不强制画图')
  })

  it('keeps the command entry free of TUI and browser implementation imports', () => {
    const command = readFileSync(new URL('src/command.ts', root), 'utf8')
    expect(command).not.toMatch(/from ['"](?:@deepseek-harness-tui\/dsh-tui|react|ink)['"]/)
  })

  it('returns an actionable target-profile missing-package diagnostic', () => {
    const message = missingProfileDependencyMessage('dsh-tui')
    expect(message).toContain('profile "dsh-tui"')
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

  it('uses process-local mode immediately when persistence is explicitly disabled', () => {
    let provided = false
    const ctx: any = {
      logger: { info() {}, warn() {} },
      provide(name: string) { if (name === 'dataAgentConnections') provided = true },
      inject() { throw new Error('persistConnections=false must not wait for storageDomain') },
    }
    apply(ctx, Config({ installPreset: false, persistConnections: false }))
    expect(provided).toBe(true)
  })
})

describe('render-analysis Web-capability gating (D6)', () => {
  function makeToolContext(webServer: boolean) {
    const registered: { name?: string }[] = []
    const ctx = {
      tools: { register(def: { name?: string }) { registered.push(def) } },
      subprocess: {
        resolveExecutable: async (command: string) => '/usr/bin/' + command,
        spawn: () => ({ done: Promise.resolve({ exitCode: 0, signal: null }), collected: {} }),
      },
      dataAgentConnections: createConnectionStore(),
      get(name: string) {
        if (name === 'webServer') return webServer ? {} : undefined
        return undefined
      },
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

  it('registers render-analysis in the standing scope only when webServer exists', () => {
    expect(makeToolContext(false)).toEqual(['sql-query', 'sql-write', 'sql-cmd'])
    expect(makeToolContext(true)).toEqual(['sql-query', 'sql-write', 'sql-cmd', 'render-analysis'])
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
      emit() {},
      effect(setup: () => () => void) {
        const dispose = setup()
        return { dispose }
      },
    } as never
    applyCommandHalf(ctx)
    expect(restrictions).toEqual([{ deny: ['describe_image', 'ssh_exec'] }])
    const command = readFileSync(new URL('src/command.ts', root), 'utf8')
    expect(command).not.toContain("ctx.on('agent/created'")
  })
})
