import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import yaml from 'js-yaml'

const execute = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))

it('cold-starts the packaged plugin on DSH 0.1.7-rc.1 and completes a real SQLite tool turn', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-data-agent-runtime-'))
  try {
    const home = join(directory, 'home')
    const profile = join(home, 'profiles', 'compatibility')
    const artifact = join(directory, 'artifact')
    const workspace = join(directory, 'workspace')
    await Promise.all([mkdir(join(profile, 'node_modules', '@yejiming'), { recursive: true }), mkdir(artifact), mkdir(workspace)])
    const { stdout } = await execute('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', directory, '--cache', join(directory, 'npm-cache')], { cwd: root })
    const [{ filename }] = JSON.parse(stdout) as { filename: string }[]
    const sourcePackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string }
    expect(filename).toBe(`yejiming-dsh-data-agent-${sourcePackage.version}.tgz`)
    await execute('tar', ['-xzf', join(directory, filename), '--strip-components=1', '-C', artifact])
    for (const manifest of ['package.json', 'dsh-plugin.json']) {
      expect(JSON.parse(await readFile(join(artifact, manifest), 'utf8')).version).toBe(sourcePackage.version)
    }
    expect(JSON.parse(await readFile(join(root, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version).toBe('0.1.7-rc.1')
    await symlink(join(root, 'node_modules'), join(artifact, 'node_modules'), 'dir')
    await symlink(artifact, join(profile, 'node_modules', '@yejiming', 'dsh-data-agent'), 'dir')
    const database = join(workspace, 'fixture.sqlite')
    await execute('sqlite3', [database, 'CREATE TABLE sales(amount INTEGER); INSERT INTO sales VALUES (19), (23);'])
    const before = await readFile(database)
    await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'data-agent-compatibility-fixture', private: true, type: 'module', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@yejiming/dsh-data-agent'] } } }))
    await writeFile(join(profile, 'cordis.patch.yml'), yaml.dump([
      { id: 'data-agent', config: { connections: { '*': { type: 'sqlite', database, readonly: true } } } },
      { id: 'session-title-llm', disabled: true },
      { id: 'deepseek-account', disabled: true },
      { id: 'hmr', disabled: true },
      { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions'), compression: 'none' } },
      { insert: [
        { id: 'agent-preset-registry', name: '@deepseek-ai/dsh-agent-preset-registry', config: { default: 'data-agent' } },
        { id: 'runtime-probe', name: new URL('./fixtures/dsh-runtime-probe.mjs', import.meta.url).href },
      ] },
    ]))
    const { stdout: output } = await execute(process.execPath, [join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'compatibility'], {
      cwd: workspace,
      env: { PATH: process.env.PATH, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    const result = output.split('\n').find(line => line.startsWith('DSH_DATA_AGENT_SMOKE='))
    expect(result).toBeDefined()
    expect(JSON.parse(result!.slice('DSH_DATA_AGENT_SMOKE='.length))).toMatchInlineSnapshot(`
      {
        "modelCalls": 2,
        "reload": true,
        "tools": [
          "catalog-get",
          "catalog-search",
          "metric-get",
          "render-analysis",
          "sql-cmd",
          "sql-query",
          "sql-write",
          "str_replace_editor",
        ],
        "unload": true,
      }
    `)
    expect(await readFile(database)).toEqual(before)
    const logs = (await readdir(join(home, 'sessions'), { recursive: true })).filter(path => path.endsWith('.jsonl'))
    expect(logs).toHaveLength(1)
    const persisted = await readFile(join(home, 'sessions', logs[0]!), 'utf8')
    expect(persisted).toContain('Fixture total: 42.')
    expect(persisted).toContain('sql-query')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 45_000)
