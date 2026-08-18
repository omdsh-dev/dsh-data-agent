/**
 * Real end-to-end SQLite smoke (task 7.2 tool path, 7.4 TUI shared path):
 * the REAL subprocess service + the REAL sqlite3 binary, exercised through
 * the render-analysis tool definition registered for Web and the public TUI
 * analysis bridge shape. No model, HTTP, or browser is involved here: both
 * surfaces execute the exact same shared tool half.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
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
  execute?: (args: unknown, exec: {
    callId: string
    agent?: { id: string, session?: { header?: { cwd?: string } } }
    signal: AbortSignal
  }) => Promise<unknown>
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
  it('builds the same report on Web and TUI and executes each dataset exactly once per surface', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-da-smoke-'))
    const db = join(dir, 'orders.db')
    try {
      execFileSync('sqlite3', [
        db,
        "CREATE TABLE orders (month TEXT, revenue INTEGER, region TEXT);",
        "INSERT INTO orders VALUES ('2026-01', 10, '东'), ('2026-02', 20, '东'), ('2026-01', 5, '西');",
      ])

      const request = {
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
      }
      const run = async (surface: 'web' | 'tui') => {
        const runtime = new Context()
        await runtime.plugin(SubprocessLocal)
        const subprocess = runtime.get('subprocess')!
        let spawnCount = 0
        let captured: ToolDefinitionFace | undefined
        const ctx = {
          subprocess: {
            resolveExecutable: subprocess.resolveExecutable.bind(subprocess),
            spawn: (...args: Parameters<typeof subprocess.spawn>) => {
              spawnCount += 1
              return subprocess.spawn(...args)
            },
          },
          dataAgentConnections: { resolveForExecution: async () => ({ type: 'sqlite', database: db }) },
          tools: {
            register(def: ToolDefinitionFace) {
              if (def.name === 'render-analysis') captured = def
            },
          },
          get() { return undefined },
        }
        apply(ctx as never, CONFIG)
        expect(captured?.name).toBe('render-analysis')
        const report = await captured!.execute!({
          ...request,
          outputName: `SQLite-冒烟报告-${surface}`,
        }, {
          callId: `smoke-${surface}`,
          agent: { id: `smoke-${surface}`, session: { header: { cwd: dir } } },
          signal: new AbortController().signal,
        }) as AnalysisReportV1
        return { captured: captured!, report, spawnCount }
      }

      const web = await run('web')
      const tui = await run('tui')
      const report = web.report

      expect(report.version).toBe(1)
      expect(report.datasets.map((dataset) => dataset.id)).toEqual(['trend', 'regions'])
      // SQL aggregation + ORDER BY happened inside sqlite: rows stay ordered.
      expect(report.datasets[0]!.rows).toEqual([['2026-01', '15'], ['2026-02', '20']])
      expect(report.datasets[1]!.rows).toEqual([['东', '30'], ['西', '5']])
      expect(parseAnalysisReport(report).views.map((view) => view.id)).toEqual(['m1', 'v1', 'v2', 'v3'])
      expect(report.htmlPath).not.toBe(tui.report.htmlPath)
      expect(existsSync(report.htmlPath!)).toBe(true)
      expect(existsSync(tui.report.htmlPath!)).toBe(true)
      expect({ ...tui.report, htmlPath: undefined }).toEqual({ ...web.report, htmlPath: undefined })
      expect(web.spawnCount).toBe(2)
      expect(tui.spawnCount).toBe(2)
      // The model-facing render is short and never re-injects rows.
      const render = web.captured.output!.render!({}, report)
      expect(render[0]!.text).toContain('2 个数据集、4 个视图')
      expect(render[0]!.text).not.toContain('2026-01')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
