import { existsSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)
const bundlePath = new URL('lib/client.js', root)
const nodeBundlePath = new URL('lib/index.js', root)

/** Baseline: 1.62 MB (echarts core + zrender + the four chart types). */
const BUNDLE_SIZE_LIMIT = 1_900_000

describe('client bundle purity (built artifact, task 6.7)', () => {
  const hasBundle = existsSync(bundlePath)

  it.runIf(hasBundle)('keeps ECharts tree-shaken to the four v1 chart types', () => {
    const bundle = readFileSync(bundlePath, 'utf8')
    for (const marker of ['LineSeries', 'BarSeries', 'PieSeries', 'ScatterSeries', 'SVGPainter']) {
      expect(bundle).toContain(marker)
    }
    // Unregistered chart types must not leak into the bundle.
    for (const marker of ['CandlestickSeries', 'GaugeSeries', 'TreemapSeries', 'SankeySeries', 'EffectScatterSeries']) {
      expect(bundle).not.toContain(marker)
    }
  })

  it.runIf(hasBundle)('contains no cross-plugin value imports from @deepseek-ai', () => {
    const bundle = readFileSync(bundlePath, 'utf8')
    // The build-time purity gate already throws for these; assert the artifact
    // anyway so a config regression fails the suite.
    expect(bundle).not.toMatch(/require\("@deepseek-ai\/dsh-client-ui-tool"\)/)
    expect(bundle).not.toMatch(/require\("@deepseek-ai\/[^"]*"\)[\s\S]{0,80}ModuleLoader/)
  })

  it.runIf(hasBundle)('contains no Node or Vite environment probes', () => {
    const bundle = readFileSync(bundlePath, 'utf8')
    const platformModules = new Set([
      'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'cordis',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-web-react',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-schema-form',
    ])
    // DSH evaluates the closure factory in a browser without a Node process
    // global or Node built-ins; unresolved probes/imports from inlined
    // dependencies fail at plugin boot before the workbench can render.
    expect(bundle).not.toMatch(/\bprocess\.env\b/)
    expect(bundle).not.toMatch(/\bimport\.meta\.env\b/)
    expect(bundle).not.toMatch(/\bnode:module\b/)
    expect(bundle).not.toMatch(/\bcreateRequire\b/)
    const unsupportedRequires = [...bundle.matchAll(/\brequire\((['"])([^'"]+)\1\)/g)]
      .map(match => match[2]!)
      .filter(dependency => !platformModules.has(dependency))
    expect(unsupportedRequires).toEqual([])
  })

  it.runIf(hasBundle)('keeps the Web client free of removed TUI scene code', () => {
    const bundle = readFileSync(bundlePath, 'utf8')
    for (const marker of ['data-agent-analysis', 'TerminalCellGrid', 'tuiScenes', 'dsh-tui/scenes']) {
      expect(bundle).not.toContain(marker)
    }
  })

  it.runIf(hasBundle)('records the bundle size regression threshold', () => {
    const bytes = statSync(bundlePath).size
    expect(bytes).toBeLessThan(BUNDLE_SIZE_LIMIT)
    // The loader handoff banner proves the closure-factory artifact shape.
    expect(readFileSync(bundlePath, 'utf8')).toContain('window.__ModuleLoader__.load')
  })
})

describe('Node/TUI bundle purity (built artifact)', () => {
  const hasBundle = existsSync(nodeBundlePath)

  it.runIf(hasBundle)('contains no Web renderer, ECharts, browser loader, or stylesheet payload', () => {
    const bundle = readFileSync(nodeBundlePath, 'utf8')
    expect(bundle).not.toMatch(/(?:from|require\()\s*['"]echarts/)
    expect(bundle).not.toContain('window.__ModuleLoader__')
    expect(bundle).not.toContain('analysis-dashboard.css')
    expect(bundle).not.toContain('SVGPainter')
  })

  it.runIf(hasBundle)('contains no dsh-TUI scene dependency or character renderer', () => {
    const bundle = readFileSync(nodeBundlePath, 'utf8')
    expect(bundle).not.toContain('@deepseek-harness-tui/dsh-tui')
    expect(bundle).not.toContain('TerminalCellGrid')
    expect(bundle).not.toContain('data-agent-analysis')
  })
})
