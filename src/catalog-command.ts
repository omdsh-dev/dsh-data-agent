/** Preset-scoped `/catalog` human command adapter. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { CatalogDiffPage, CatalogScope } from './catalog-types.ts'
import type {} from './index.ts'

export const CATALOG_COMMAND_USAGE = [
  '用法：',
  '  /catalog scan --all',
  '  /catalog scan --schema <name>',
  '  /catalog scan --schema <name> --table <name>',
  '  /catalog status [--run <run-id>]',
  '  /catalog cancel [--run <run-id>]',
  '  /catalog diff [--from <run-id> --to <run-id>]',
  '  /catalog view',
  '说明：无参数 scan 仅在有交互 provider 时选择范围；不会隐式执行全库扫描。',
].join('\n')

export type CatalogCommandAction =
  | { kind: 'scan'; scope?: CatalogScope }
  | { kind: 'status'; runId?: string }
  | { kind: 'cancel'; runId?: string }
  | { kind: 'diff'; fromRunId?: string; toRunId?: string }
  | { kind: 'view' }

export interface CatalogCommandPresentation {
  watch(run: Awaited<ReturnType<Context['dataAgentCatalogScanner']['start']>>): void
  open(sessionId: string): boolean
}

export function registerCatalogCommand(ctx: Context, presentation?: CatalogCommandPresentation): () => void {
  return ctx.commands.register({
    name: 'catalog',
    description: '扫描、查看或比较 data-agent 数据目录',
    input: { hint: 'scan | status | cancel | diff | view' },
    recordInput: false,
    handler: async invocation => executeCatalogCommand(ctx, invocation, presentation),
  })
}

export async function executeCatalogCommand(
  ctx: Context,
  invocation: CommandInvocation,
  presentation?: CatalogCommandPresentation,
): Promise<CommandResult> {
  try {
    const action = parseCatalogAction(invocation.rawInput)
    const sessionId = String(invocation.agent.id)
    switch (action.kind) {
      case 'scan': {
        const scope = action.scope ?? await askForCatalogScope(ctx, invocation)
        if (scope === undefined) {
          return { kind: 'error', text: `当前界面没有可用的问答 provider；未开始扫描。\n\n${CATALOG_COMMAND_USAGE}` }
        }
        const run = await ctx.dataAgentCatalogScanner.start({ sessionId, scope })
        presentation?.watch(run)
        return {
          kind: 'success',
          text: `Catalog 扫描已进入后台队列。\nrun: ${run.id}\nsource: ${run.sourceId}\nscope: ${formatScope(run.scope)}\nAI model: ${run.enrichment?.provider ?? '未配置'}/${run.enrichment?.model ?? '未配置'}\n使用 /catalog status 查看技术扫描和 AI 业务含义进度。`,
        }
      }
      case 'status': {
        const sourceId = await resolveCommandSourceId(ctx, sessionId)
        if (sourceId === undefined) return { kind: 'success', text: `当前没有Catalog source或扫描记录。\n\n${CATALOG_COMMAND_USAGE}` }
        const status = ctx.dataAgentCatalog.status(sourceId)
        if (status === undefined) return { kind: 'success', text: `source ${sourceId} 尚未扫描。\n\n${CATALOG_COMMAND_USAGE}` }
        const run = action.runId === undefined
          ? status.activeRun ?? status.latestRun
          : ctx.dataAgentCatalog.listRuns(sourceId, 200).find(candidate => candidate.id === action.runId)
        if (action.runId !== undefined && run === undefined) {
          return { kind: 'error', text: `未找到 Catalog run ${action.runId}（仅查询最近 200 条记录）。` }
        }
        const lines = [
          `Catalog source: ${status.source.name} (${status.source.id})`,
          `资产: ${status.counts.assets}，字段: ${status.counts.fields}，待确认: ${status.counts.needsReview}`,
        ]
        if (run !== undefined) {
          lines.push(
            `run: ${run.id}`,
            `状态: ${run.status}`,
            `范围: ${formatScope(run.scope)}`,
            `进度: ${run.progress.schemas} schema / ${run.progress.relations} 表或视图 / ${run.progress.fields} 字段`,
          )
          if (run.error !== undefined) lines.push(`错误: ${run.error}`)
          if (run.enrichment !== undefined) {
            lines.push(
              `AI 业务含义: ${run.enrichment.status}`,
              `AI 模型: ${run.enrichment.provider}/${run.enrichment.model}`,
              `AI 进度: ${run.enrichment.tablesCompleted}/${run.enrichment.tablesTotal} 表，${run.enrichment.candidatesGenerated} 个候选，${run.enrichment.tablesFailed} 个失败`,
            )
            if (run.enrichment.error !== undefined) lines.push(`AI 错误: ${run.enrichment.error}`)
          }
        }
        return { kind: 'success', text: lines.join('\n') }
      }
      case 'cancel': {
        const sourceId = await requireCommandSourceId(ctx, sessionId)
        const run = await ctx.dataAgentCatalogScanner.cancel(sourceId, action.runId)
        return { kind: 'success', text: `已请求取消 Catalog run ${run.id}；当前状态 ${run.status}。` }
      }
      case 'diff': {
        const sourceId = await requireCommandSourceId(ctx, sessionId)
        const diff = ctx.dataAgentCatalog.diff(sourceId, action.fromRunId, action.toRunId, undefined, 50)
        return { kind: 'success', text: formatCatalogDiff(diff) }
      }
      case 'view': {
        if (presentation?.open(sessionId) !== true) {
          return {
            kind: 'error',
            text: '当前dsh-tui未提供Catalog全屏scene能力；请升级dsh-tui，或暂用 /catalog status 和Web数据目录查看。',
          }
        }
        return { kind: 'success' }
      }
    }
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
}

export function parseCatalogAction(rawInput: string): CatalogCommandAction {
  const tokens = splitCommandLine(rawInput.trim())
  if (tokens.length === 0) throw new Error(`必须提供 Catalog 子命令。\n\n${CATALOG_COMMAND_USAGE}`)
  const [subcommand, ...args] = tokens
  if (subcommand === 'status') {
    const values = parseNamedArguments(args, new Set(['run']))
    return { kind: 'status', ...values.get('run') !== undefined ? { runId: values.get('run') } : {} }
  }
  if (subcommand === 'scan') return parseScan(args)
  if (subcommand === 'view') {
    if (args.length > 0) throw new Error(`view 不接受额外参数。\n\n${CATALOG_COMMAND_USAGE}`)
    return { kind: 'view' }
  }
  if (subcommand === 'cancel') {
    const values = parseNamedArguments(args, new Set(['run']))
    return { kind: 'cancel', ...values.get('run') !== undefined ? { runId: values.get('run') } : {} }
  }
  if (subcommand === 'diff') {
    const values = parseNamedArguments(args, new Set(['from', 'to']))
    const fromRunId = values.get('from')
    const toRunId = values.get('to')
    if ((fromRunId === undefined) !== (toRunId === undefined)) throw new Error('diff 的 --from 与 --to 必须同时提供')
    return {
      kind: 'diff',
      ...fromRunId !== undefined ? { fromRunId } : {},
      ...toRunId !== undefined ? { toRunId } : {},
    }
  }
  throw new Error(`未知 catalog 子命令：${subcommand}\n\n${CATALOG_COMMAND_USAGE}`)
}

function parseScan(args: readonly string[]): CatalogCommandAction {
  if (args.length === 0) return { kind: 'scan' }
  let all = false
  const named: string[] = []
  for (const token of args) {
    if (token === '--all') all = true
    else named.push(token)
  }
  const values = parseNamedArguments(named, new Set(['schema', 'table']))
  const schema = values.get('schema')
  const table = values.get('table')
  if (all && (schema !== undefined || table !== undefined)) throw new Error('--all 不能与 --schema/--table 同时使用')
  if (table !== undefined && schema === undefined) throw new Error('--table 必须与 --schema 同时提供')
  if (all) return { kind: 'scan', scope: { kind: 'source' } }
  if (schema !== undefined && table !== undefined) return { kind: 'scan', scope: { kind: 'table', schema, table } }
  if (schema !== undefined) return { kind: 'scan', scope: { kind: 'schema', schema } }
  throw new Error(`scan 必须显式提供 --all 或 --schema。\n\n${CATALOG_COMMAND_USAGE}`)
}

async function askForCatalogScope(ctx: Context, invocation: CommandInvocation): Promise<CatalogScope | undefined> {
  const questions = ctx.get('userQuestions')
  if (questions === undefined) return undefined
  try {
    const selected = await questions.ask({
      agent: invocation.agent,
      signal: invocation.signal,
      questions: [{
        id: 'scope',
        header: '扫描范围',
        question: '选择 Catalog 扫描范围（不会读取业务明细）',
        options: [{ label: '单表' }, { label: 'Schema' }, { label: '全库' }],
      }],
    })
    const kind = answerValue(selected, 'scope')
    if (kind === '全库') {
      const confirmation = await questions.ask({
        agent: invocation.agent,
        signal: invocation.signal,
        questions: [{
          id: 'confirm', header: '确认全库', question: '确认扫描当前数据源的全部可见Schema和对象？',
          options: [{ label: '取消' }, { label: '确认' }],
        }],
      })
      if (answerValue(confirmation, 'confirm') !== '确认') throw new Error('已取消 Catalog 扫描。')
      return { kind: 'source' }
    }
    if (kind !== 'Schema' && kind !== '单表') throw new Error('未选择有效的扫描范围')
    const detail = await questions.ask({
      agent: invocation.agent,
      signal: invocation.signal,
      questions: [
        { id: 'schema', header: 'Schema', question: '输入要扫描的 Schema / database 名称' },
        ...(kind === '单表' ? [{ id: 'table', header: '表或视图', question: '输入要扫描的表或视图名称' }] : []),
      ],
    })
    const schema = answerValue(detail, 'schema')?.trim()
    if (schema === undefined || schema.length === 0) throw new Error('Schema 不能为空')
    if (kind === 'Schema') return { kind: 'schema', schema }
    const table = answerValue(detail, 'table')?.trim()
    if (table === undefined || table.length === 0) throw new Error('表或视图名称不能为空')
    return { kind: 'table', schema, table }
  } catch (error) {
    if ((error as { code?: string }).code === 'NO_PROVIDER') return undefined
    throw error
  }
}

async function resolveCommandSourceId(ctx: Context, sessionId: string): Promise<string | undefined> {
  const connected = ctx.dataAgentConnections.get(sessionId)?.profileId
  if (connected !== undefined && ctx.dataAgentCatalog.status(connected) !== undefined) return connected
  const sources = ctx.dataAgentCatalog.listSources()
  return sources.length === 1 ? sources[0]!.id : undefined
}

async function requireCommandSourceId(ctx: Context, sessionId: string): Promise<string> {
  const sourceId = await resolveCommandSourceId(ctx, sessionId)
  if (sourceId === undefined) throw new Error('无法确定 Catalog source；请连接对应profile或在Web选择source')
  return sourceId
}

function formatScope(scope: CatalogScope): string {
  if (scope.kind === 'source') return '全库'
  if (scope.kind === 'schema') return `Schema ${scope.schema}`
  return `${scope.schema}.${scope.table}`
}

function formatCatalogDiff(diff: CatalogDiffPage): string {
  const groups = new Map<string, number>()
  for (const item of diff.items) groups.set(item.kind, (groups.get(item.kind) ?? 0) + 1)
  const summary = ['added', 'changed', 'missing', 'restored', 'unavailable']
    .map(kind => `${kind}: ${groups.get(kind) ?? 0}`).join('，')
  const details = diff.items.slice(0, 20).map(item => `- [${item.kind}] ${item.path}: ${item.summary.join('; ')}`)
  return [
    `Catalog diff ${diff.fromRunId} → ${diff.toRunId}`,
    `范围: ${formatScope(diff.scope)}`,
    summary,
    ...details,
    ...(diff.truncated ? ['结果已截断；请在Web数据目录继续查看。'] : []),
  ].join('\n')
}

function parseNamedArguments(tokens: readonly string[], allowed: Set<string>): Map<string, string> {
  const values = new Map<string, string>()
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (/password|secret|credential/i.test(token)) throw new Error('Catalog 命令不接受任何secret或credential参数')
    if (!token.startsWith('--')) throw new Error(`无法解析参数：${token}\n\n${CATALOG_COMMAND_USAGE}`)
    const assignment = token.slice(2).split('=', 2)
    const key = assignment[0]!
    if (!allowed.has(key)) throw new Error(`未知 Catalog 参数：--${key}\n\n${CATALOG_COMMAND_USAGE}`)
    const value = assignment.length === 2 ? assignment[1]! : tokens[++index]
    if (value === undefined || value.startsWith('--') || value.length === 0 || value.length > 256) {
      throw new Error(`参数 --${key} 缺少有效值`)
    }
    if (values.has(key)) throw new Error(`参数 --${key} 不能重复`)
    values.set(key, value)
  }
  return values
}

function answerValue(answer: { answers: { id: string; selected: string[]; custom?: string }[] }, id: string): string | undefined {
  const item = answer.answers.find(candidate => candidate.id === id)
  return item?.custom ?? item?.selected[0]
}

function splitCommandLine(value: string): string[] {
  const tokens: string[] = []
  let token = ''
  let quote: '"' | "'" | undefined
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      else token += char
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (/\s/.test(char)) {
      if (token.length > 0) { tokens.push(token); token = '' }
    } else token += char
  }
  if (quote !== undefined) throw new Error('Catalog 命令包含未闭合引号')
  if (token.length > 0) tokens.push(token)
  return tokens
}
