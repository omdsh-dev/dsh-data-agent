import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPreset, isLegacyManagedPreset } from '../src/index.ts'

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

  it.each(['0.0.11', '0.0.12', '0.1.4'])('migrates the exact %s release preset and preserves adjacent metadata', async (version) => {
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
})
