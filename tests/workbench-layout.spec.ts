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

  it('keeps the Catalog isolated to its tab and gives its controls non-collapsing layout tracks', () => {
    const styles = readFileSync(new URL('src/client/DataAgentWorkbench.module.css', root), 'utf8')
    expect(styles).toMatch(/\.catalogPanel\[hidden\]\s*\{[^}]*display:\s*none/s)
    expect(styles).toMatch(/\.catalogOverview\s*\{[^}]*display:\s*grid/s)
    expect(styles).toMatch(/\.catalogActionGroup\s*\{[^}]*grid-template-columns:\s*104px\s+minmax\(0,\s*1fr\)/s)
    expect(styles).toMatch(/\.catalogDiffBar\s*\{[^}]*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)\s+auto/s)
    expect(styles).toMatch(/\.catalogSearch\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s)
    expect(styles).toMatch(/\.catalogWorkspace\s*\{[^}]*minmax\(0,\s*0\.9fr\)\s+minmax\(0,\s*1\.1fr\)/s)
    expect(styles).toMatch(/\.catalogWorkspace\s*\{[^}]*height:\s*clamp\([^}]*overflow:\s*hidden/s)
    expect(styles).toMatch(/\.catalogList\s*\{[^}]*overflow-y:\s*auto[^}]*overscroll-behavior:\s*contain/s)
    expect(styles).toMatch(/\.catalogDetailScroll\s*\{[^}]*overflow:\s*auto[^}]*overscroll-behavior:\s*contain/s)
    expect(styles).toMatch(/\.catalogBadge\s*\{[^}]*flex:\s*none/s)
    expect(styles).toMatch(/\.catalogBadge\s*\{[^}]*white-space:\s*nowrap/s)
    expect(styles).toMatch(/@media \(max-width: 640px\)[\s\S]*\.catalogScanBar \.input\s*\{[^}]*flex:\s*none/s)
  })
})
