import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)

describe('database workbench host layout contract', () => {
  it('registers a context-row control from the composer slot instead of an above-input dock row', () => {
    const source = readFileSync(new URL('src/client/index.ts', root), 'utf8')
    expect(source).toContain("scope.slots.inject('conversation.input.right'")
    expect(source).toContain("name: 'conversation.input.right'")
    expect(source).not.toContain("scope.slots.inject('conversation.input.dock'")
  })

  it('does not measure, poll, or globally split hero/active conversation layout', () => {
    const component = readFileSync(new URL('src/client/DataAgentWorkbench.tsx', root), 'utf8')
    const styles = readFileSync(new URL('src/client/DataAgentWorkbench.module.css', root), 'utf8')
    expect(component).not.toMatch(/MutationObserver|ResizeObserver|setInterval|data-phase|RAIL_TOP_OFFSET/)
    expect(styles).not.toMatch(/da-split|data-phase|margin-left:\s*380px|padding-left:\s*380px/)
    expect(styles).toContain('.triggerSlot')
    expect(styles).toMatch(/\.triggerSlot\s*\{[^}]*top:\s*-42px/s)
    expect(styles).not.toMatch(/data-input-scroll[\s\S]*padding-right/)
    expect(styles).toContain('.workbenchModal')
  })
})
