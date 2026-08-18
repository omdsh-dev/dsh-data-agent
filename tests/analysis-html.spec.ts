import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ANALYSIS_REPORT_DIRECTORY,
  analysisArtifactRelativePath,
  analysisFileSegment,
  escapeJsonForHtmlScript,
  renderAnalysisHtml,
  writeAnalysisHtml,
} from '../src/analysis-html.ts'
import type { AnalysisReportV1 } from '../src/analysis.ts'

const temporaryRoots: string[] = []

afterEach(() => {
  while (temporaryRoots.length > 0) rmSync(temporaryRoots.pop()!, { recursive: true, force: true })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-analysis-html-'))
  temporaryRoots.push(root)
  return root
}

function sixViewReport(overrides: Partial<AnalysisReportV1> = {}): AnalysisReportV1 {
  return {
    version: 1,
    title: '经营分析',
    summary: '趋势、构成与明细',
    datasets: [{
      id: 'all',
      columns: ['month', 'revenue', 'orders', 'region', 'x', 'y'],
      rows: [
        ['2026-01', '10', '2', '东区', '1', '3'],
        ['2026-02', '18', '4', '西区', '2', '7'],
        ['2026-03', '12', '3', '南区', '3', '4'],
      ],
    }],
    views: [
      { id: 'metric', kind: 'metric', datasetId: 'all', field: 'revenue', label: '营收' },
      { id: 'line', kind: 'line', datasetId: 'all', x: { field: 'month', type: 'time' }, y: ['revenue'] },
      { id: 'bar', kind: 'bar', datasetId: 'all', x: { field: 'region', type: 'category' }, y: ['orders'] },
      { id: 'pie', kind: 'pie', datasetId: 'all', categoryField: 'region', valueField: 'orders' },
      { id: 'scatter', kind: 'scatter', datasetId: 'all', xField: 'x', yField: 'y' },
      { id: 'table', kind: 'table', datasetId: 'all', columns: ['month', 'revenue'] },
    ],
    ...overrides,
  }
}

describe('offline analysis HTML', () => {
  it('renders all six views without external assets or runtime dependencies', () => {
    const html = renderAnalysisHtml(sixViewReport(), '2026-08-17T00:00:00.000Z')
    expect(html).toContain('<!doctype html>')
    expect(html).toContain("default-src 'none'")
    expect(html).not.toMatch(/<(?:script|link|img)\b[^>]+(?:src|href)=/i)
    expect(html).not.toContain('echarts')

    const dom = new JSDOM(html, { runScripts: 'dangerously' })
    expect(dom.window.document.querySelectorAll('#metric-band > article.metric')).toHaveLength(1)
    expect(dom.window.document.querySelectorAll('#dashboard > article')).toHaveLength(5)
    expect(dom.window.document.querySelector('#dashboard > article.line')?.classList.contains('full')).toBe(true)
    expect(dom.window.document.querySelector('#dashboard > article.bar')?.classList.contains('full')).toBe(false)
    expect(dom.window.document.querySelector('#dashboard > article.table')?.classList.contains('full')).toBe(true)
    expect(dom.window.document.querySelector('.sub')).toBeNull()
    expect(dom.window.document.querySelectorAll('svg')).toHaveLength(4)
    expect(dom.window.document.querySelector('.metric-value')?.textContent).toBe('10')
    expect(dom.window.document.querySelectorAll('table')).toHaveLength(5)
    expect(dom.window.document.body.textContent).toContain('经营分析')
  })

  it('keeps script, HTML, URL and Unicode separator payloads inert text', () => {
    const payload = '</script><script>window.__analysisInjected=true</script><img src=https://evil.invalid onerror=alert(1)>\u2028\u2029'
    const report = sixViewReport({
      title: payload,
      datasets: [{ id: 'all', columns: ['value'], rows: [[payload]] }],
      views: [{ id: 'table', kind: 'table', datasetId: 'all' }],
    })
    const escaped = escapeJsonForHtmlScript(report)
    expect(escaped).not.toContain('</script>')
    expect(escaped).toContain('\\u003c/script\\u003e')
    expect(escaped).toContain('\\u2028')
    expect(escaped).toContain('\\u2029')

    const dom = new JSDOM(renderAnalysisHtml(report), { runScripts: 'dangerously' })
    expect((dom.window as unknown as { __analysisInjected?: boolean }).__analysisInjected).toBeUndefined()
    expect(dom.window.document.querySelectorAll('img')).toHaveLength(0)
    expect(dom.window.document.querySelectorAll('a')).toHaveLength(0)
    expect(dom.window.document.querySelector('h1')?.textContent).toBe(payload)
    expect(dom.window.document.querySelector('td')?.textContent).toBe(payload)
  })

  it('keeps generated timestamps inert when using the pure renderer API', () => {
    const dom = new JSDOM(renderAnalysisHtml(sixViewReport(), `';document.body.dataset.injected='yes`), {
      runScripts: 'dangerously',
    })
    expect(dom.window.document.body.dataset.injected).toBeUndefined()
    expect(dom.window.document.querySelector('footer')?.textContent).toContain("';document.body.dataset.injected='yes")
  })

  it('shows an explicit empty state without manufacturing chart values', () => {
    const report = sixViewReport({
      datasets: [{ id: 'all', columns: ['month', 'revenue'], rows: [] }],
      views: [{ id: 'line', kind: 'line', datasetId: 'all', x: { field: 'month', type: 'time' }, y: ['revenue'] }],
    })
    const dom = new JSDOM(renderAnalysisHtml(report), { runScripts: 'dangerously' })
    expect(dom.window.document.querySelector('.empty')?.textContent).toBe('暂无数据')
    expect(dom.window.document.querySelectorAll('svg')).toHaveLength(0)
  })

  it('writes a readable semantic filename under the session workspace without overwriting', async () => {
    const cwd = temporaryRoot()
    const outputName = '电商经营全景分析-2023-09至2026-08'
    const first = await writeAnalysisHtml(sixViewReport(), { cwd, outputName, generatedAt: '2026-08-17T00:00:00.000Z' })
    const firstContents = readFileSync(first.htmlPath!, 'utf8')

    expect(first.htmlPath).toBe(join(cwd, ANALYSIS_REPORT_DIRECTORY, `${outputName}.html`))
    expect(existsSync(first.htmlPath!)).toBe(true)
    await expect(writeAnalysisHtml(sixViewReport(), { cwd, outputName }))
      .rejects.toThrow(/目标文件已存在，请使用更具体的outputName/)
    expect(readFileSync(first.htmlPath!, 'utf8')).toBe(firstContents)
    expect(readdirSync(join(cwd, ANALYSIS_REPORT_DIRECTORY)).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('fails instead of returning a path when the artifact directory cannot be created', async () => {
    const root = temporaryRoot()
    const notDirectory = join(root, 'workspace-file')
    writeFileSync(notDirectory, 'occupied')
    await expect(writeAnalysisHtml(sixViewReport(), { cwd: notDirectory }))
      .rejects.toThrow(/保存Dashboard HTML失败/)
    expect(readFileSync(notDirectory, 'utf8')).toBe('occupied')
  })

  it('normalizes unsafe filename input to a bounded portable segment', () => {
    expect(analysisFileSegment('../../Q2 Revenue!', 'report')).toBe('Q2-Revenue')
    expect(analysisFileSegment('季度分析', 'analysis-report')).toBe('季度分析')
    expect(analysisFileSegment('x'.repeat(120), 'report')).toHaveLength(96)
    expect(analysisArtifactRelativePath('默认标题', '../电商经营全景分析（2023-09～2026-08）.html'))
      .toBe('analysis-reports/电商经营全景分析-2023-09-2026-08.html')
  })
})
