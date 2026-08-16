import { describe, expect, it } from 'vitest'
import { createConnectionStore, type DatabaseConnection } from '../src/connections.ts'
import { apply, type Config } from '../src/tool.ts'
import type { AnalysisReportV1 } from '../src/analysis.ts'
import { parseAnalysisReport } from '../src/analysis.ts'

interface SpawnSpec {
  argv: readonly string[]
  stdio: { stdin: unknown; stdout: unknown; stderr: unknown }
  signal: AbortSignal
  env?: Record<string, string>
}

interface SpawnResult {
  done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
  collected: {
    stdout?: { readFrom(): { text: string; lossy: boolean } }
    stderr?: { readFrom(): { text: string; lossy: boolean } }
  }
}

interface ToolDefinitionFace {
  name?: string
  description?: string
  execute?: (args: unknown, exec: { agent?: { id: string }, signal: AbortSignal }) => Promise<unknown>
  output?: {
    render?: (args: unknown, value: unknown) => { type: string, text: string }[]
    presentationMeta?: (args: unknown, value: unknown) => unknown
  }
}

function spawnOk(text: string): SpawnResult {
  return {
    done: Promise.resolve({ exitCode: 0, signal: null }),
    collected: {
      stdout: { readFrom: () => ({ text, lossy: false }) },
      stderr: { readFrom: () => ({ text: '', lossy: false }) },
    },
  }
}

function makeContext(options: {
  spawns?: (SpawnResult | ((spec: SpawnSpec) => SpawnResult))[]
  resolveForExecution?: (sessionId: string) => Promise<DatabaseConnection>
  configOverrides?: Partial<Config>
}) {
  const store = createConnectionStore()
  const connections = options.resolveForExecution === undefined
    ? store
    : { ...store, resolveForExecution: options.resolveForExecution }
  const spawns = options.spawns ?? [spawnOk('id\n1\n')]
  const captured: SpawnSpec[] = []
  const agentDefinitions: Record<string, ToolDefinitionFace> = {}
  const ctx = {
    tools: {
      register(def: ToolDefinitionFace) {
        if (def.name !== undefined) agentDefinitions[def.name] = def
      },
    },
    subprocess: {
      resolveExecutable: async (command: string) => '/usr/bin/' + command,
      spawn(spec: SpawnSpec) {
        captured.push(spec)
        const next = spawns.shift() ?? spawnOk('')
        return typeof next === 'function' ? next(spec) : next
      },
    },
    dataAgentConnections: connections,
    get(name: string) {
      if (name === 'webServer') return {}
      return undefined
    },
  } as never
  apply(ctx as never, {
    queryTimeoutMs: 5000,
    maxResultChars: 200000,
    maxRows: 100,
    maxQueryChars: 65536,
    readonly: false,
    clients: {},
    ...options.configOverrides,
  })
  return { ctx, store, captured, agentDefinitions }
}

function execOf(sessionId: string) {
  return { agent: { id: sessionId }, signal: new AbortController().signal }
}

const BASE_ARGS = {
  title: '月度经营分析',
  datasets: [{ id: 'ds1', sql: 'SELECT month, revenue FROM t ORDER BY month' }],
  views: [{ id: 'v1', kind: 'line', datasetId: 'ds1', x: { field: 'month', type: 'time' }, y: ['revenue'] }],
}

describe('render-analysis tool', () => {
  it('registers the Web-only tool with a description that guides agentic choice', () => {
    const { agentDefinitions } = makeContext({})
    const definition = agentDefinitions['render-analysis']!
    expect(definition.name).toBe('render-analysis')
    expect(definition.description).toContain('First use sql-query to inspect and verify data')
    expect(definition.description).toContain('3-6 complementary views')
    expect(definition.description).not.toMatch(/[\u3400-\u9fff]/)
    expect(definition.execute).toBeTypeOf('function')
  })

  it('fails with the connect-first message when the session has no connection', async () => {
    const { agentDefinitions, captured } = makeContext({})
    await expect(agentDefinitions['render-analysis']!.execute!(BASE_ARGS, execOf('unknown')))
      .rejects.toThrow(/请先在.*连接数据库/)
    expect(captured).toHaveLength(0)
  })

  it('rejects a write dataset before any query spawns', async () => {
    const { agentDefinitions, store, captured } = makeContext({})
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db' })
    await expect(agentDefinitions['render-analysis']!.execute!({
      title: 'x',
      datasets: [
        { id: 'ok', sql: 'SELECT 1' },
        { id: 'bad', sql: 'DELETE FROM orders' },
      ],
      views: [{ id: 'v1', kind: 'metric', datasetId: 'ok', field: 'a', label: 'a' }],
    }, execOf('session-a'))).rejects.toThrow(/dataset "bad" 必须是读语句/)
    expect(captured).toHaveLength(0)
  })

  it('rejects multi-statement and oversized SQL before spawning', async () => {
    const { agentDefinitions, store, captured } = makeContext({})
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db' })
    await expect(agentDefinitions['render-analysis']!.execute!({
      title: 'x',
      datasets: [{ id: 'd', sql: 'SELECT 1; SELECT 2' }],
      views: [{ id: 'v1', kind: 'metric', datasetId: 'd', field: 'a', label: 'a' }],
    }, execOf('session-a'))).rejects.toThrow(/一次只允许执行一条 SQL 语句/)
    await expect(agentDefinitions['render-analysis']!.execute!({
      title: 'x',
      datasets: [{ id: 'd', sql: 'SELECT ' + 'x'.repeat(70000) }],
      views: [{ id: 'v1', kind: 'metric', datasetId: 'd', field: 'a', label: 'a' }],
    }, execOf('session-a'))).rejects.toThrow(/超过长度上限/)
    expect(captured).toHaveLength(0)
  })

  it('executes datasets sequentially in request order, each exactly once', async () => {
    const { agentDefinitions, store, captured } = makeContext({
      spawns: [
        spawnOk('total\n10\n'),
        spawnOk('region\ttotal\n东\t5\n'),
        spawnOk('region\ttotal\n西\t2\n'),
      ],
    })
    store.set('session-a', { type: 'mysql', host: 'h', port: 3306, user: 'u', database: 'd' })
    const result = await agentDefinitions['render-analysis']!.execute!({
      title: '多数据集',
      datasets: [
        { id: 'trend', sql: 'SELECT total FROM t' },
        { id: 'east', sql: 'SELECT region, total FROM t WHERE region=1' },
        { id: 'west', sql: 'SELECT region, total FROM t WHERE region=2' },
      ],
      views: [
        { id: 'v1', kind: 'metric', datasetId: 'trend', field: 'total', label: 'm' },
        { id: 'v2', kind: 'pie', datasetId: 'east', categoryField: 'region', valueField: 'total' },
        { id: 'v3', kind: 'pie', datasetId: 'west', categoryField: 'region', valueField: 'total' },
        { id: 'v4', kind: 'table', datasetId: 'west' },
      ],
    }, execOf('session-a')) as AnalysisReportV1
    expect(captured).toHaveLength(3)
    expect(result.datasets.map((dataset) => dataset.id)).toEqual(['trend', 'east', 'west'])
    // Dataset reuse across views never re-queries: 3 queries for 3 datasets.
    expect(result.views.map((view) => view.id)).toEqual(['v1', 'v2', 'v3', 'v4'])
  })

  it('injects LIMIT for unbounded SELECT and preserves row order', async () => {
    const { agentDefinitions, store, captured } = makeContext({
      spawns: [spawnOk('month\trevenue\n3月\t30\n1月\t10\n2月\t20\n')],
    }, )
    store.set('session-a', { type: 'mysql', host: 'h', port: 3306, user: 'u', database: 'd' })
    const result = await agentDefinitions['render-analysis']!.execute!({
      ...BASE_ARGS,
      views: [{ id: 'v1', kind: 'line', datasetId: 'ds1', x: { field: 'month', type: 'category' }, y: ['revenue'] }],
    }, execOf('session-a')) as AnalysisReportV1
    expect(captured[0]!.stdio.stdin).toEqual({ data: 'SELECT month, revenue FROM t ORDER BY month LIMIT 100\n' })
    expect(result.datasets[0]!.rows).toEqual([['3月', '30'], ['1月', '10'], ['2月', '20']])
  })

  it('stops after a failing dataset, discards earlier results and names the dataset', async () => {
    const { agentDefinitions, store, captured } = makeContext({
      spawns: [
        spawnOk('month\n2026-01\n'),
        {
          done: Promise.resolve({ exitCode: 1, signal: null }),
          collected: {
            stdout: { readFrom: () => ({ text: '', lossy: false }) },
            stderr: { readFrom: () => ({ text: 'no such table: nope\n', lossy: false }) },
          },
        },
        spawnOk('x\n1\n'),
      ],
    })
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db' })
    await expect(agentDefinitions['render-analysis']!.execute!({
      title: 'x',
      datasets: [
        { id: 'first', sql: 'SELECT 1' },
        { id: 'second', sql: 'SELECT * FROM nope' },
        { id: 'third', sql: 'SELECT 2' },
      ],
      views: [{ id: 'v1', kind: 'metric', datasetId: 'first', field: 'a', label: 'a' }],
    }, execOf('session-a'))).rejects.toThrow(/dataset "second" 执行失败.*no such table: nope/)
    expect(captured).toHaveLength(2)
    expect(captured[1]!.stdio.stdin).toEqual({ data: 'SELECT * FROM nope LIMIT 100\n' })
  })

  it('propagates caller cancellation and stops remaining datasets', async () => {
    const { agentDefinitions, store } = makeContext({
      spawns: [
        (spec) => ({
          done: new Promise((_resolve, reject) => {
            if (spec.signal.aborted) reject(new Error('aborted before spawn settled'))
            else spec.signal.addEventListener('abort', () => reject(new Error('aborted by signal')), { once: true })
          }),
          collected: {},
        }),
      ],
    })
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db' })
    const controller = new AbortController()
    const pending = agentDefinitions['render-analysis']!.execute!(BASE_ARGS, {
      agent: { id: 'session-a' },
      signal: controller.signal,
    })
    controller.abort(new Error('caller cancelled'))
    await expect(pending).rejects.toThrow('caller cancelled')
  })

  it('fails the whole call when any dataset output is truncated', async () => {
    const { agentDefinitions, store } = makeContext({
      spawns: [
        spawnOk('month\n2026-01\n'),
        {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: {
            stdout: { readFrom: () => ({ text: 'x\n1\n', lossy: true }) },
            stderr: { readFrom: () => ({ text: '', lossy: false }) },
          },
        },
      ],
    })
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db' })
    await expect(agentDefinitions['render-analysis']!.execute!({
      title: 'x',
      datasets: [
        { id: 'a', sql: 'SELECT 1' },
        { id: 'b', sql: 'SELECT 2' },
      ],
      views: [{ id: 'v1', kind: 'metric', datasetId: 'a', field: 'month', label: 'a' }],
    }, execOf('session-a'))).rejects.toThrow(/dataset "b" 的查询结果被截断.*缩小、聚合或拆分/)
  })

  it('accepts empty datasets and reports them in the model summary', async () => {
    const { agentDefinitions, store } = makeContext({
      spawns: [spawnOk('month,revenue\n')],
    })
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db' })
    const definition = agentDefinitions['render-analysis']!
    const result = await definition.execute!(BASE_ARGS, execOf('session-a')) as AnalysisReportV1
    expect(result.datasets[0]!.rows).toEqual([])
    const render = definition.output!.render!(BASE_ARGS, result)
    expect(render[0]!.text).toContain('无数据')
    expect(render[0]!.text).toContain('ds1')
    expect(render[0]!.text).not.toContain('2026')
  })

  it('validates field existence, numerics, times and pie signs against queried data', async () => {
    const { agentDefinitions, store } = makeContext({
      spawns: [spawnOk('month\trevenue\n2026-01\t10\n')],
    })
    store.set('session-a', { type: 'mysql', host: 'h', port: 3306, user: 'u', database: 'd' })
    const execute = agentDefinitions['render-analysis']!.execute!
    await expect(execute!({
      title: 'x',
      datasets: [{ id: 'd', sql: 'SELECT 1' }],
      views: [{ id: 'v1', kind: 'metric', datasetId: 'd', field: 'ghost', label: 'a' }],
    }, execOf('session-a'))).rejects.toThrow(/不存在的字段 "ghost"/)

    const { agentDefinitions: d2, store: s2 } = makeContext({
      spawns: [spawnOk('month\trevenue\n2026-01\tabc\n')],
    })
    s2.set('session-a', { type: 'mysql', host: 'h', port: 3306, user: 'u', database: 'd' })
    await expect(d2['render-analysis']!.execute!({
      title: 'x',
      datasets: [{ id: 'd', sql: 'SELECT 1' }],
      views: [{ id: 'v1', kind: 'metric', datasetId: 'd', field: 'revenue', label: 'a' }],
    }, execOf('session-a'))).rejects.toThrow(/含有非数值 "abc"/)

    const { agentDefinitions: d3, store: s3 } = makeContext({
      spawns: [spawnOk('month\trevenue\nnot-a-date\t10\n')],
    })
    s3.set('session-a', { type: 'mysql', host: 'h', port: 3306, user: 'u', database: 'd' })
    await expect(d3['render-analysis']!.execute!({
      title: 'x',
      datasets: [{ id: 'd', sql: 'SELECT 1' }],
      views: [{ id: 'v1', kind: 'line', datasetId: 'd', x: { field: 'month', type: 'time' }, y: ['revenue'] }],
    }, execOf('session-a'))).rejects.toThrow(/不可解析的时间值/)

    const { agentDefinitions: d4, store: s4 } = makeContext({
      spawns: [spawnOk('region\ttotal\n东\t-5\n')],
    })
    s4.set('session-a', { type: 'mysql', host: 'h', port: 3306, user: 'u', database: 'd' })
    await expect(d4['render-analysis']!.execute!({
      title: 'x',
      datasets: [{ id: 'd', sql: 'SELECT 1' }],
      views: [{ id: 'v1', kind: 'pie', datasetId: 'd', categoryField: 'region', valueField: 'total' }],
    }, execOf('session-a'))).rejects.toThrow(/饼图值必须非负/)
  })

  it('redacts credential secrets from execution errors', async () => {
    const secret = 'credential-secret'
    const { agentDefinitions } = makeContext({
      resolveForExecution: async () => ({
        type: 'mysql', host: 'h', port: 3306, user: 'u', database: 'd',
        passwordRef: 'DB_PASSWORD', password: secret,
      }),
      spawns: [{
        done: Promise.resolve({ exitCode: 1, signal: null }),
        collected: {
          stdout: { readFrom: () => ({ text: '', lossy: false }) },
          stderr: { readFrom: () => ({ text: 'access denied for ' + secret + '\n', lossy: false }) },
        },
      }],
    })
    let message = ''
    try {
      await agentDefinitions['render-analysis']!.execute!(BASE_ARGS, execOf('session-ref'))
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).not.toContain(secret)
    expect(message).toContain('[REDACTED]')
  })

  it('persists the full report as presentationMeta and round-trips through session JSON', async () => {
    const { agentDefinitions, store } = makeContext({
      spawns: [spawnOk('month\trevenue\n2026-01\t10\n')],
    })
    store.set('session-a', { type: 'mysql', host: 'h', port: 3306, user: 'u', database: 'd' })
    const definition = agentDefinitions['render-analysis']!
    const report = await definition.execute!(BASE_ARGS, execOf('session-a')) as AnalysisReportV1
    const meta = definition.output!.presentationMeta!(BASE_ARGS, report)
    // Session JSON round-trip (the persistence boundary): stringify + parse.
    const restored = JSON.parse(JSON.stringify({ meta, version: 1 })) as { meta: unknown }
    const parsed = parseAnalysisReport(restored.meta)
    expect(parsed.datasets[0]!.rows).toEqual([['2026-01', '10']])
    expect(parsed.views[0]).toMatchObject({ kind: 'line', datasetId: 'ds1' })
    // The model-facing render never re-injects the rows.
    const render = definition.output!.render!(BASE_ARGS, report)
    expect(render[0]!.text).not.toContain('2026-01')
    expect(render[0]!.text).toContain('1 个数据集、1 个视图')
  })

  it('rejects reports over the 512 KiB total bound without deleting data', async () => {
    const big = 'x'.repeat(600 * 1024)
    const { agentDefinitions, store } = makeContext({
      configOverrides: { maxResultChars: 2_000_000 },
      spawns: [spawnOk('col\n' + big + '\n')],
    })
    store.set('session-a', { type: 'sqlite', database: '/tmp/orders.db' })
    await expect(agentDefinitions['render-analysis']!.execute!({
      title: 'x',
      datasets: [{ id: 'd', sql: 'SELECT 1' }],
      views: [{ id: 'v1', kind: 'table', datasetId: 'd' }],
    }, execOf('session-a'))).rejects.toThrow(/报告 JSON 超过 524288 字节上限/)
  })
})
