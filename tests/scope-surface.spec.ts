import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { bindScopeParent, createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry, { type ToolDefinition } from '@deepseek-ai/dsh-tools'

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

const DATA_TOOLS = ['str_replace_editor', 'sql-query', 'sql-write', 'sql-cmd'] as const

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
    ['Web', true, [...DATA_TOOLS, 'render-analysis'].sort()],
    ['TUI', false, [...DATA_TOOLS].sort()],
  ] as const)('rebinds an existing blank %s agent to the exact data-mode tools', async (_surface, web, expected) => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRegistry)
    for (const name of HOST_TOOLS) ctx.tools.register(tool(name))

    const standardKey = { agentPreset: 'standard-fixture' }
    const standard = await mintScope(ctx, standardKey)
    standard.ctx.tools.register(tool('standard_local'))

    const dataKey = { agentPreset: web ? 'data-web-fixture' : 'data-tui-fixture' }
    const data = await mintScope(ctx, dataKey)
    for (const name of DATA_TOOLS) data.ctx.tools.register(tool(name))
    if (web) data.ctx.tools.register(tool('render-analysis'))
    // Same operation installed by src/command.ts in the standing preset.
    const ownToolNames = new Set<string>([...DATA_TOOLS, 'render-analysis'])
    const inheritedToolNames = data.ctx.tools.schemas()
      .map(item => item.name)
      .filter(name => !ownToolNames.has(name))
    data.ctx.tools.restrict({ deny: inheritedToolNames })

    const agentKey = { id: web ? 'blank-web' : 'blank-tui' }
    const binding = bindScopeParent(agentKey, standardKey)
    await mintScope(ctx, agentKey)
    expect(ctx.tools.schemas(agentKey).map(item => item.name)).toContain('ssh_exec')

    // DSH blank-session preset selection is a parent rebind, not a new
    // agent/created event. The standing restriction and local tools must be
    // sufficient by themselves.
    binding.rebind(dataKey)
    expect(ctx.tools.schemas(agentKey).map(item => item.name).sort()).toEqual(expected)
  })
})
