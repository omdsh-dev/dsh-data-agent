/**
 * Real end-to-end SQLite smoke (task 7.2 tool path, 7.4 TUI shared path):
 * the REAL subprocess service + the REAL sqlite3 binary, exercised through
 * the render-analysis tool definition registered in the Web standing scope.
 * No model, no HTTP, no browser — the shared tool half is what
 * both surfaces run, and the Web-only client rendering is covered by the
 * jsdom component tests.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import { apply, type Config } from '../src/tool.ts'
import type { AnalysisReportV1 } from '../src/analysis.ts'
import { parseAnalysisReport } from '../src/analysis.ts'

interface ToolDefinitionFace {
  name?: string
  execute?: (args: unknown, exec: { agent?: { id: string }, signal: AbortSignal }) => Promise<unknown>
  output?: { render?: (args: unknown, value: unknown) => { type: string, text: string }[] }
}

const CONFIG: Config = {
  queryTimeoutMs: 10_000,
  maxResultChars: 200_000,
  maxRows: 100,
  maxQueryChars: 65_536,
  readonly: false,
  clients: {},
}

describe('real sqlite smoke through the shared tool half', () => {
  it('builds a multi-dataset report with the real sqlite3 client and real subprocess service', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-da-smoke-'))
    const db = join(dir, 'orders.db')
    try {
      execFileSync('sqlite3', [
        db,
        "CREATE TABLE orders (month TEXT, revenue INTEGER, region TEXT);",
        "INSERT INTO orders VALUES ('2026-01', 10, '东'), ('2026-02', 20, '东'), ('2026-01', 5, '西');",
      ])

      const ctx = new Context()
      await ctx.plugin(SubprocessLocal)
      ctx.provide('dataAgentConnections', { resolveForExecution: async () => ({ type: 'sqlite', database: db }) } as never)
      ctx.provide('webServer', {} as never)

      let captured: ToolDefinitionFace | undefined
      ctx.provide('tools', {
        register(def: ToolDefinitionFace) {
          if (def.name === 'render-analysis') captured = def
        },
      } as never)
      apply(ctx as never, CONFIG)

      expect(captured?.name).toBe('render-analysis')
      const report = await captured!.execute!({
        title: 'SQLite 冒烟报告',
        summary: '真实客户端执行',
        datasets: [
          { id: 'trend', sql: 'SELECT month, SUM(revenue) AS revenue FROM orders GROUP BY month ORDER BY month' },
          { id: 'regions', sql: 'SELECT region, SUM(revenue) AS total FROM orders GROUP BY region ORDER BY total DESC' },
        ],
        views: [
          { id: 'm1', kind: 'metric', datasetId: 'trend', field: 'revenue', label: '总营收' },
          { id: 'v1', kind: 'line', datasetId: 'trend', label: '月度趋势', x: { field: 'month', type: 'time' }, y: ['revenue'] },
          { id: 'v2', kind: 'pie', datasetId: 'regions', categoryField: 'region', valueField: 'total' },
          { id: 'v3', kind: 'table', datasetId: 'regions' },
        ],
      }, { agent: { id: 'smoke-session' }, signal: new AbortController().signal }) as AnalysisReportV1

      expect(report.version).toBe(1)
      expect(report.datasets.map((dataset) => dataset.id)).toEqual(['trend', 'regions'])
      // SQL aggregation + ORDER BY happened inside sqlite: rows stay ordered.
      expect(report.datasets[0]!.rows).toEqual([['2026-01', '15'], ['2026-02', '20']])
      expect(report.datasets[1]!.rows).toEqual([['东', '30'], ['西', '5']])
      expect(parseAnalysisReport(report).views.map((view) => view.id)).toEqual(['m1', 'v1', 'v2', 'v3'])
      // The model-facing render is short and never re-injects rows.
      const render = captured!.output!.render!({}, report)
      expect(render[0]!.text).toContain('2 个数据集、4 个视图')
      expect(render[0]!.text).not.toContain('2026-01')

      // TUI-shape regression: without the webServer capability the same tool
      // half registers no render-analysis definition.
      const tuiCtx = new Context()
      await tuiCtx.plugin(SubprocessLocal)
      tuiCtx.provide('dataAgentConnections', { resolveForExecution: async () => ({ type: 'sqlite', database: db }) } as never)
      let tuiCaptured: ToolDefinitionFace | undefined
      tuiCtx.provide('tools', {
        register(def: ToolDefinitionFace) {
          if (def.name === 'render-analysis') tuiCaptured = def
        },
      } as never)
      apply(tuiCtx as never, CONFIG)
      expect(tuiCaptured).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
