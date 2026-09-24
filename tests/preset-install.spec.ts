import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPreset, isLegacyManagedPreset, registerPreset } from '../src/index.ts'

const packagedPreset = new URL('../preset/data-agent/agent.cordis.yml', import.meta.url)
const fixture = (version: string) => new URL(`./fixtures/presets/data-agent-${version}.yml`, import.meta.url)
const ctx = { logger: { info: vi.fn(), warn: vi.fn() } } as unknown as Context

type PresetRow = { id: string, name: string, config: Record<string, unknown> }
const parse = (source: string) => yaml.load(source) as PresetRow[]

describe('data-agent preset installation and persona compatibility', () => {
  let home: string
  let directory: string
  let composition: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'data-agent-preset-test-'))
    directory = join(home, '.agent-presets', 'data-agent')
    composition = join(directory, 'agent.cordis.yml')
    vi.stubEnv('DSH_HOME', home)
    vi.clearAllMocks()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true })
  })

  it('installs a persona readable by both old and new hosts without changing its prompt or other rows', async () => {
    expect(await installPreset(ctx, 'data-agent')).toBe(true)
    const installed = await readFile(composition, 'utf8')
    expect(installed).toBe(await readFile(packagedPreset, 'utf8'))
    const oldRows = parse(await readFile(fixture('0.1.4'), 'utf8'))
    const newRows = parse(installed)
    const oldPersona = oldRows.find(row => row.id === 'persona')!
    const newPersona = newRows.find(row => row.id === 'persona')!
    expect(newPersona.config.prefix).toBe(oldPersona.config.text)
    expect(newPersona.config.text).toBe(oldPersona.config.text)
    expect(newPersona.config.prefix).toContain('catalog-search')
    expect(newRows.filter(row => row.id !== 'persona')).toEqual(oldRows.filter(row => row.id !== 'persona'))
    expect(await readFile(join(directory, 'preset.yml'), 'utf8')).toContain('数据模式')
  })

  it.each(['0.0.11', '0.0.12', '0.1.4', '0.1.5'])('migrates the exact %s release preset and preserves adjacent metadata', async (version) => {
    const old = await readFile(fixture(version), 'utf8')
    expect(isLegacyManagedPreset(old)).toBe(true)
    await mkdir(directory, { recursive: true })
    await writeFile(composition, old)
    const metadata = 'name: My Data Mode\n'
    await writeFile(join(directory, 'preset.yml'), metadata)

    expect(await installPreset(ctx, 'data-agent')).toBe(true)
    expect(await readFile(composition, 'utf8')).toBe(await readFile(packagedPreset, 'utf8'))
    expect(await readFile(join(directory, 'preset.yml'), 'utf8')).toBe(metadata)
    expect(isLegacyManagedPreset(await readFile(composition, 'utf8'))).toBe(false)
  })

  it.each(['0.0.12', '0.1.4'])('leaves a customized %s preset byte-identical', async (version) => {
    const custom = (await readFile(fixture(version), 'utf8')).replace('你是数据工程师 Agent', '你是财务分析师 Agent')
    expect(isLegacyManagedPreset(custom)).toBe(false)
    await mkdir(directory, { recursive: true })
    await writeFile(composition, custom)
    expect(await installPreset(ctx, 'data-agent')).toBe(true)
    expect(await readFile(composition, 'utf8')).toBe(custom)
  })

  it('does not rewrite a current preset on subsequent starts', async () => {
    expect(await installPreset(ctx, 'data-agent')).toBe(true)
    await utimes(composition, new Date('2020-01-01'), new Date('2020-01-01'))
    const before = await stat(composition)
    expect(await installPreset(ctx, 'data-agent')).toBe(true)
    expect((await stat(composition)).mtimeMs).toBe(before.mtimeMs)
  })

  it('registers custom metadata and existing tool config once without rewriting user files', async () => {
    await installPreset(ctx, 'data-agent')
    const custom = (await readFile(composition, 'utf8')) + '\n- id: custom-tools\n  name: "@yejiming/dsh-data-agent/tool"\n  config:\n    maxRows: 7\n'
    const metadata = 'name: Custom data mode\ndescription: Preserved description\norder: 5\n'
    await writeFile(composition, custom)
    await writeFile(join(directory, 'preset.yml'), metadata)
    const dispose = vi.fn(async () => {})
    const register = vi.fn(async (_definition: PresetDefinition) => dispose)
    const effect = vi.fn()
    await registerPreset({ agentPresets: { register }, effect } as unknown as Context, 'data-agent', {
      queryTimeoutMs: 30000, maxResultChars: 20000, maxRows: 100, maxQueryChars: 65536, readonly: false, clients: {},
    })
    expect(register).toHaveBeenCalledOnce()
    expect(register.mock.calls[0]?.[0]).toMatchObject({
      id: 'data-agent', name: 'Custom data mode', description: 'Preserved description', order: 5,
      plugins: expect.arrayContaining([
        { id: 'custom-tools', name: expect.stringMatching(/\/tool\.js$/), config: { maxRows: 7 } },
        { id: 'data-agent-command', name: expect.stringMatching(/\/command\.js$/) },
      ]),
    })
    const definition = register.mock.calls[0]?.[0] as unknown as { plugins: { name: string }[] }
    expect(definition.plugins.filter(row => row.name.endsWith('/tool.js'))).toHaveLength(1)
    await effect.mock.calls[0]?.[0]()()
    expect(dispose).toHaveBeenCalledOnce()
    expect(await readFile(composition, 'utf8')).toBe(custom)
    expect(await readFile(join(directory, 'preset.yml'), 'utf8')).toBe(metadata)
  })

  it.each(['{ invalid: object }', '- id: broken\n  name: 42'])('rejects malformed composition before registration: %s', async (invalid) => {
    await installPreset(ctx, 'data-agent')
    await writeFile(composition, invalid)
    const register = vi.fn()
    await expect(registerPreset({ agentPresets: { register } } as unknown as Context, 'data-agent', {
      queryTimeoutMs: 30000, maxResultChars: 20000, maxRows: 100, maxQueryChars: 65536, readonly: false, clients: {},
    })).rejects.toThrow()
    expect(register).not.toHaveBeenCalled()
    expect(await readFile(composition, 'utf8')).toBe(invalid)
  })
})
