/** DSH-native AI enrichment for table and field business-meaning candidates. */

import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig, LlmRuntime, RequestUserInput } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'

const MAX_MODEL_OUTPUT_CHARS = 65_536
const MAX_MODEL_OUTPUT_TOKENS = 16_384

class CatalogModelOutputTruncatedError extends Error {
  constructor() {
    super('Catalog AI meaning output was truncated by the model token limit')
    this.name = 'CatalogModelOutputTruncatedError'
  }
}

export interface CatalogModelSelection {
  provider: string
  model: string
  reasoningEffort?: LlmCallConfig['reasoningEffort']
}

export interface CatalogMeaningFieldInput {
  assetId: string
  name: string
  dataType?: string
  nullable?: boolean
  comment?: string
  keyKinds: string[]
}

export interface CatalogMeaningTableInput {
  assetId: string
  schema: string
  name: string
  objectType: 'table' | 'view'
  comment?: string
  fields: CatalogMeaningFieldInput[]
  relations: Array<{
    kind: string
    name?: string
    fromAssetId: string
    toAssetId?: string
    columnAssetIds: string[]
    referencedColumnAssetIds?: string[]
  }>
}

export interface CatalogMeaningModelResult {
  table: { assetId: string; meaning: string }
  fields: Array<{ assetId: string; meaning: string }>
}

export interface CatalogMeaningGenerator {
  capture(sessionId: string): CatalogModelSelection
  generate(
    selection: CatalogModelSelection,
    input: CatalogMeaningTableInput,
    signal: AbortSignal,
  ): Promise<CatalogMeaningModelResult>
}

const modelResultSchema = z.strictObject({
  table: z.strictObject({
    assetId: z.string().min(1).max(256),
    meaning: z.string().trim().min(1).max(4_096),
  }),
  fields: z.array(z.strictObject({
    assetId: z.string().min(1).max(256),
    meaning: z.string().trim().min(1).max(4_096),
  })).max(512),
})

/** Resolve the exact current session model once, then use the host's configured LLM adapters and credentials. */
export function createDshCatalogMeaningGenerator(
  agents: AgentRegistry,
  llm: LlmRuntime,
  language: CatalogMeaningLanguage = 'zh',
): CatalogMeaningGenerator {
  return {
    capture(sessionId) {
      const agent = agents.get(sessionId as SessionId)
      if (agent === undefined) throw new Error('Catalog scan requires a live DSH session to use its configured AI model')
      const configured = agent.session.requestHeader()?.config
      const provider = configured?.provider ?? agent.options.provider
      const model = configured?.model ?? agent.options.model
      if (provider === undefined || provider.trim().length === 0 || model === undefined || model.trim().length === 0) {
        throw new Error('Catalog scan requires the current DSH session to have a configured AI model')
      }
      return {
        provider,
        model,
        ...configured?.reasoningEffort !== undefined ? { reasoningEffort: configured.reasoningEffort } : {},
      }
    },
    async generate(selection, input, signal) {
      return generateCompleteModelResult(llm, selection, input, signal, language)
    },
  }
}

async function generateCompleteModelResult(
  llm: LlmRuntime,
  selection: CatalogModelSelection,
  input: CatalogMeaningTableInput,
  signal: AbortSignal,
  language: CatalogMeaningLanguage,
): Promise<CatalogMeaningModelResult> {
  try {
    return await generateModelBatch(llm, selection, input, signal, language)
  } catch (error) {
    if (!(error instanceof CatalogModelOutputTruncatedError)) throw error
    if (input.fields.length <= 1) {
      throw new Error('Catalog AI meaning output remained truncated after retrying a single-field batch')
    }
    const middle = Math.ceil(input.fields.length / 2)
    const batches = [input.fields.slice(0, middle), input.fields.slice(middle)]
    const results: CatalogMeaningModelResult[] = []
    for (const fields of batches) {
      signal.throwIfAborted()
      results.push(await generateCompleteModelResult(llm, selection, sliceTableInput(input, fields), signal, language))
    }
    return {
      table: results[0]!.table,
      fields: results.flatMap(result => result.fields),
    }
  }
}

async function generateModelBatch(
  llm: LlmRuntime,
  selection: CatalogModelSelection,
  input: CatalogMeaningTableInput,
  signal: AbortSignal,
  language: CatalogMeaningLanguage,
): Promise<CatalogMeaningModelResult> {
  const config: LlmCallConfig = {
    provider: selection.provider,
    model: selection.model,
    ...selection.reasoningEffort !== undefined ? { reasoningEffort: selection.reasoningEffort } : {},
    maxTokens: MAX_MODEL_OUTPUT_TOKENS,
  }
  const prepared = await llm.prepareCall(config, signal)
  // An auxiliary request has no durable session-message identity or source.
  const message: RequestUserInput = {
    role: 'user',
    content: [{ type: 'text', text: JSON.stringify(input) }],
  }
  let output = ''
  let finished = false
  for await (const chunk of prepared.stream({
    ...prepared.config,
    messages: [message],
    system: CATALOG_MEANING_SYSTEM_PROMPTS[language],
    signal,
  })) {
    signal.throwIfAborted()
    if (chunk.type === 'text-delta') {
      output += chunk.text
      if (output.length > MAX_MODEL_OUTPUT_CHARS) throw new Error('Catalog AI meaning output exceeded the configured bound')
      continue
    }
    if (chunk.type !== 'finish') continue
    finished = true
    if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
      throw new Error(`Catalog AI meaning generation failed: ${chunk.reason.failure.message}`)
    }
    if (chunk.reason.kind === 'max-tokens') throw new CatalogModelOutputTruncatedError()
    if (chunk.reason.kind !== 'stop') throw new Error(`Catalog AI meaning generation stopped unexpectedly: ${chunk.reason.kind}`)
  }
  if (!finished) throw new Error('Catalog AI meaning generation ended without a finish event')
  return validateModelResult(output, input)
}

function sliceTableInput(
  input: CatalogMeaningTableInput,
  fields: CatalogMeaningFieldInput[],
): CatalogMeaningTableInput {
  const fieldIds = new Set(fields.map(field => field.assetId))
  return {
    ...input,
    fields,
    relations: input.relations.filter(relation =>
      relation.columnAssetIds.length === 0
      || relation.columnAssetIds.some(assetId => fieldIds.has(assetId))),
  }
}

export function validateModelResult(raw: string, input: CatalogMeaningTableInput): CatalogMeaningModelResult {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first < 0 || last <= first) throw new Error('Catalog AI meaning output was not a JSON object')
  let decoded: unknown
  try {
    decoded = JSON.parse(text.slice(first, last + 1))
  } catch {
    throw new Error('Catalog AI meaning output contained invalid JSON')
  }
  const result = modelResultSchema.parse(decoded)
  if (result.table.assetId !== input.assetId) throw new Error('Catalog AI meaning output referenced an unknown table asset')
  const expected = new Set(input.fields.map(field => field.assetId))
  const returned = new Set<string>()
  for (const field of result.fields) {
    if (!expected.has(field.assetId)) throw new Error(`Catalog AI meaning output referenced an unknown field asset: ${field.assetId}`)
    if (returned.has(field.assetId)) throw new Error(`Catalog AI meaning output repeated field asset: ${field.assetId}`)
    returned.add(field.assetId)
  }
  const missing = input.fields.find(field => !returned.has(field.assetId))
  if (missing !== undefined) throw new Error(`Catalog AI meaning output omitted field asset: ${missing.assetId}`)
  return result
}

/** Output language of generated business-meaning candidates. */
export type CatalogMeaningLanguage = 'zh' | 'ru' | 'en'

/**
 * Shared English-instruction prompt for the non-Chinese languages: English
 * instructions tend to be followed more reliably across models, so only the
 * required output language and the rule-5 wording examples are localized.
 */
function englishCatalogMeaningPrompt(outputLanguage: string, forbiddenWording: string): string {
  return `You are an enterprise data-governance assistant. Based on the technical metadata of a single table provided by the user, produce concise, reviewable business-meaning candidates written in ${outputLanguage} for that table and each of its fields.

Rules:
1. Infer only from the table name, field names, data types, nullability, database comments, keys, and relations; never pretend to know business rules, enumeration values, or calculation definitions that were not provided.
2. For obviously technical fields, still state their business/record role in this table, e.g. primary key, creation time, status flag; keep the table description within 120 characters and each field description within 80 characters.
3. Every input field must be returned exactly once, with assetId copied verbatim; never add unknown assetIds.
4. Output no Markdown, explanations, confidence scores, SQL, or extra fields — only this strict JSON:
{"table":{"assetId":"...","meaning":"..."},"fields":[{"assetId":"...","meaning":"..."}]}
5. Everything is a candidate pending human confirmation; never use wording such as ${forbiddenWording}.`
}

const CATALOG_MEANING_SYSTEM_PROMPTS: Record<CatalogMeaningLanguage, string> = {
  zh: `你是企业数据治理助手。请根据用户提供的单张表技术元数据，为这张表和每个字段生成简洁、可审核的中文业务含义候选。

规则：
1. 只依据表名、字段名、类型、nullable、数据库注释、键和关系推断；不要假装知道未提供的业务规则、枚举值或计算口径。
2. 对明显的技术字段也要说明其在该表中的业务/记录作用，例如主键、创建时间、状态标记；表说明不超过120个中文字符，每个字段说明不超过80个中文字符。
3. 每个输入字段必须且只能返回一次，assetId必须原样复制；不得添加未知assetId。
4. 不要输出Markdown、解释、置信度、SQL或额外字段，只输出以下严格JSON：
{"table":{"assetId":"...","meaning":"..."},"fields":[{"assetId":"...","meaning":"..."}]}
5. 所有内容都是待人工确认的候选，不要使用“已经确认”“官方口径”等表述。`,
  ru: englishCatalogMeaningPrompt(
    'Russian (русский язык)',
    '«уже подтверждено», «официальная методика»',
  ),
  en: englishCatalogMeaningPrompt(
    'English',
    '"confirmed", "official definition"',
  ),
}
