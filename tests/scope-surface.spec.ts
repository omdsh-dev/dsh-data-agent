import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Commands from '@deepseek-ai/dsh-commands'
import { bindScopeParent, createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry, { type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createConnectionStore } from '../src/connections.ts'
import { mountPresetCapabilities } from '../src/index.ts'

const HOST_TOOLS = [
  'describe_image',
  'read',
  'write',
  'edit',
  'ssh_cluster',
  'ssh_download',
  'ssh_exec',
  'ssh_list',
  'ssh_tunnel',
  'ssh_upload',
] as const

const DATA_TOOLS = [
  'str_replace_editor', 'sql-query', 'sql-write', 'sql-cmd',
  'catalog-search', 'catalog-get', 'metric-get',
] as const

function tool(name: string): ToolDefinition {
  return {
    name,
    description: `fixture ${name}`,
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
    },
    execute: () => Promise.resolve(name),
  }
}

async function mintScope(ctx: Context, key: object): Promise<Scope> {
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => {
    scope = createScope(inner, key)
  }, { inject: ['tools', 'systemPrompt'] }))
  return scope
}

describe('standing preset tool surface', () => {
  it.each([
    ['Web', [...DATA_TOOLS, 'render-analysis'].sort()],
    ['TUI', [...DATA_TOOLS, 'render-analysis'].sort()],
    ['headless', [...DATA_TOOLS, 'render-analysis'].sort()],
  ] as const)('rebinds an existing blank %s agent to the exact data-mode tools', async (surface, expected) => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRegistry)
    for (const name of HOST_TOOLS) ctx.tools.register(tool(name))

    const standardKey = { agentPreset: 'standard-fixture' }
    const standard = await mintScope(ctx, standardKey)
    standard.ctx.tools.register(tool('standard_local'))

    const dataKey = { agentPreset: `data-${surface}-fixture` }
    const data = await mintScope(ctx, dataKey)
    for (const name of DATA_TOOLS) data.ctx.tools.register(tool(name))
    data.ctx.tools.register(tool('render-analysis'))
    // Same operation installed by src/command.ts in the standing preset.
    const ownToolNames = new Set<string>([...DATA_TOOLS, 'render-analysis'])
    const inheritedToolNames = data.ctx.tools.schemas()
      .map(item => item.name)
      .filter(name => !ownToolNames.has(name))
    data.ctx.tools.restrict({ deny: inheritedToolNames })

    const agentKey = { id: `blank-${surface}` }
    const binding = bindScopeParent(agentKey, standardKey)
    await mintScope(ctx, agentKey)
    expect(ctx.tools.schemas(agentKey).map(item => item.name)).toContain('ssh_exec')

    // DSH blank-session preset selection is a parent rebind, not a new
    // agent/created event. The standing restriction and local tools must be
    // sufficient by themselves.
    binding.rebind(dataKey)
    expect(ctx.tools.schemas(agentKey).map(item => item.name).sort()).toEqual(expected)
  })

  it.each([
    ['Web runtime', false, []],
    ['Desktop runtime', false, []],
    ['headless runtime', false, []],
    ['runtime with dsh-tui loaded', true, ['catalog', 'database']],
  ] as const)('registers shared tools but gates human commands on %s', async (surface, hasDshTuiPlugin, expectedCommands) => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(Commands)
    ctx.provide('subprocess', {
      resolveExecutable: async (command: string) => `/usr/bin/${command}`,
      spawn: () => ({ done: Promise.resolve({ exitCode: 0, signal: null }), collected: {} }),
    } as never)
    ctx.provide('dataAgentConnections', createConnectionStore())
    for (const name of HOST_TOOLS) ctx.tools.register(tool(name))

    const dataKey = { agentPreset: 'data-agent' }
    const standing = createScope(ctx, dataKey)
    const scopeTag = Object.getOwnPropertySymbols(standing.ctx)
      .find(candidate => Reflect.get(standing.ctx, candidate) === dataKey)!
    await ctx.plugin(Object.assign(async (inner: Context) => {
      inner.extend({ [scopeTag]: dataKey }).tools.register(tool('str_replace_editor'))
      await mountPresetCapabilities(inner, dataKey, scopeTag, {
        queryTimeoutMs: 30_000,
        maxResultChars: 20_000,
        maxRows: 100,
        maxQueryChars: 65_536,
        readonly: false,
        clients: {},
      }, { isDshTuiPluginLoaded: () => hasDshTuiPlugin })
    }, { inject: ['commands', 'dataAgentConnections', 'subprocess', 'tools'] }))

    const agentKey = { id: `${surface}-session` }
    bindScopeParent(agentKey, dataKey)
    await mintScope(ctx, agentKey)
    expect(ctx.tools.schemas(agentKey).map(item => item.name).sort()).toEqual([
      'catalog-get', 'catalog-search', 'metric-get', 'render-analysis',
      'sql-cmd', 'sql-query', 'sql-write', 'str_replace_editor',
    ])
    expect(ctx.commands.list(agentKey as never).map(item => item.name)).toEqual(expectedCommands)
  })

  it('follows the actual dsh-tui Cordis runtime across late load and unload', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(Commands)
    ctx.provide('subprocess', {
      resolveExecutable: async (command: string) => `/usr/bin/${command}`,
      spawn: () => ({ done: Promise.resolve({ exitCode: 0, signal: null }), collected: {} }),
    } as never)
    ctx.provide('dataAgentConnections', createConnectionStore())

    const dataKey = { agentPreset: 'custom-profile-data-agent' }
    const standing = createScope(ctx, dataKey)
    const scopeTag = Object.getOwnPropertySymbols(standing.ctx)
      .find(candidate => Reflect.get(standing.ctx, candidate) === dataKey)!
    await ctx.plugin(Object.assign(async (inner: Context) => {
      inner.extend({ [scopeTag]: dataKey }).tools.register(tool('str_replace_editor'))
      await mountPresetCapabilities(inner, dataKey, scopeTag, {
        queryTimeoutMs: 30_000,
        maxResultChars: 20_000,
        maxRows: 100,
        maxQueryChars: 65_536,
        readonly: false,
        clients: {},
      })
    }, { inject: ['commands', 'dataAgentConnections', 'subprocess', 'tools'] }))

    const agentKey = { id: 'custom-profile-session' }
    bindScopeParent(agentKey, dataKey)
    await mintScope(ctx, agentKey)
    expect(ctx.commands.list(agentKey as never).map(item => item.name)).toEqual([])

    // The official package exports this exact Cordis runtime name. The
    // profile's label is deliberately absent from this fixture.
    const tui = ctx.plugin({ name: 'dsh-tui', apply() {} })
    await tui
    expect(ctx.commands.list(agentKey as never).map(item => item.name)).toEqual(['catalog', 'database'])

    await tui.dispose()
    expect(ctx.commands.list(agentKey as never).map(item => item.name)).toEqual([])
  })
})
