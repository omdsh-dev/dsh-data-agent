import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Config, apply, missingProfileDependencyMessage } from '../src/index.ts'

const root = new URL('../', import.meta.url)

describe('Web/TUI package and preset composition', () => {
  it('publishes isolated Node tool/command entries and optional Web peers', () => {
    const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as Record<string, any>
    expect(pkg.exports['./tool'].default).toBe('./lib/tool.js')
    expect(pkg.exports['./command'].default).toBe('./lib/command.js')
    expect(pkg.peerDependencies.react).toContain('^19.0.0')
    expect(pkg.peerDependenciesMeta.react.optional).toBe(true)
    expect(pkg.peerDependenciesMeta['@deepseek-ai/dsh-client-runtime'].optional).toBe(true)
  })

  it('composes four preset rows while keeping exactly six model tools', () => {
    const preset = readFileSync(new URL('preset/data-agent/agent.cordis.yml', root), 'utf8')
    expect(preset.match(/^- id:/gm)).toHaveLength(4)
    expect(preset).toContain("name: '@yejiming/dsh-data-agent/tool'")
    expect(preset).toContain("name: '@yejiming/dsh-data-agent/command'")
    const toolSource = readFileSync(new URL('src/tool.ts', root), 'utf8')
    expect([...toolSource.matchAll(/name: '(sql-query|sql-write|sqlcmd)'/g)].map(match => match[1])).toEqual([
      'sql-query', 'sql-write', 'sqlcmd',
    ])
    // The fs row contributes read/write/edit; the command entry contributes no tool.
    expect(preset).toContain("name: '@deepseek-ai/dsh-tool-fs'")
    expect(preset).toMatch(/id: tool-fs[\s\S]*?isolate:\n\s+attachments: true/)
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
