import { describe, expect, it, vi } from 'vitest'
import { createDshCatalogMeaningGenerator, validateModelResult, type CatalogMeaningTableInput } from '../src/catalog-ai.ts'

const input: CatalogMeaningTableInput = {
  assetId: 'asset_orders',
  schema: 'sales',
  name: 'orders',
  objectType: 'table',
  fields: [
    { assetId: 'asset_order_id', name: 'order_id', dataType: 'bigint', nullable: false, keyKinds: ['primary_key'] },
    { assetId: 'asset_amount', name: 'amount', dataType: 'decimal(12,2)', nullable: false, keyKinds: [] },
  ],
  relations: [],
}

describe('Catalog AI result validation', () => {
  it('captures the live session request-header model and dispatches through the host LLM runtime', async () => {
    const prepareCall = vi.fn(async (config: Record<string, unknown>) => ({
      config,
      async *stream(options: Record<string, unknown>) {
        expect(options).toMatchObject({ provider: 'selected-provider', model: 'selected-model', maxTokens: 16_384 })
        expect(options.tools).toBeUndefined()
        yield { type: 'text-delta', index: 0, text: '{"table":{"assetId":"asset_orders","meaning":"订单"},"fields":[{"assetId":"asset_order_id","meaning":"订单编号"},{"assetId":"asset_amount","meaning":"订单金额"}]}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }))
    const generator = createDshCatalogMeaningGenerator({
      get: () => ({
        options: { provider: 'fallback-provider', model: 'fallback-model' },
        session: { requestHeader: () => ({ config: { provider: 'selected-provider', model: 'selected-model', reasoningEffort: 'high' } }) },
      }),
    } as never, { prepareCall } as never)
    const selection = generator.capture('session-a')
    expect(selection).toMatchObject({ provider: 'selected-provider', model: 'selected-model', reasoningEffort: 'high' })
    await expect(generator.generate(selection, input, new AbortController().signal)).resolves.toMatchObject({
      table: { meaning: '订单' }, fields: [{ meaning: '订单编号' }, { meaning: '订单金额' }],
    })
    expect(prepareCall).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'selected-provider', model: 'selected-model', reasoningEffort: 'high', maxTokens: 16_384,
    }), expect.any(AbortSignal))
  })

  it('retries a token-truncated table in smaller field batches and returns only the complete result', async () => {
    let call = 0
    const prepareCall = vi.fn(async (config: Record<string, unknown>) => {
      call += 1
      const current = call
      return {
        config,
        async *stream() {
          if (current === 1) {
            yield { type: 'text-delta', index: 0, text: '{"table":' }
            yield { type: 'finish', reason: { kind: 'max-tokens' } }
            return
          }
          const field = current === 2
            ? { assetId: 'asset_order_id', meaning: '订单编号' }
            : { assetId: 'asset_amount', meaning: '订单金额' }
          yield { type: 'text-delta', index: 0, text: JSON.stringify({
            table: { assetId: 'asset_orders', meaning: '订单业务记录' },
            fields: [field],
          }) }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    })
    const generator = createDshCatalogMeaningGenerator({
      get: () => ({ options: { provider: 'p', model: 'm' }, session: { requestHeader: () => undefined } }),
    } as never, { prepareCall } as never)

    await expect(generator.generate(generator.capture('session-a'), input, new AbortController().signal)).resolves.toEqual({
      table: { assetId: 'asset_orders', meaning: '订单业务记录' },
      fields: [
        { assetId: 'asset_order_id', meaning: '订单编号' },
        { assetId: 'asset_amount', meaning: '订单金额' },
      ],
    })
    expect(prepareCall).toHaveBeenCalledTimes(3)
    for (const [config] of prepareCall.mock.calls) {
      expect(config).toMatchObject({ provider: 'p', model: 'm', maxTokens: 16_384 })
    }
  })

  it('stops retrying when a single-field batch still reaches the token limit', async () => {
    const prepareCall = vi.fn(async (config: Record<string, unknown>) => ({
      config,
      async *stream() {
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
      },
    }))
    const generator = createDshCatalogMeaningGenerator({
      get: () => ({ options: { provider: 'p', model: 'm' }, session: { requestHeader: () => undefined } }),
    } as never, { prepareCall } as never)
    const singleFieldInput = { ...input, fields: input.fields.slice(0, 1) }

    await expect(generator.generate(generator.capture('session-a'), singleFieldInput, new AbortController().signal))
      .rejects.toThrow(/single-field batch/)
    expect(prepareCall).toHaveBeenCalledTimes(1)
  })

  it('accepts strict complete JSON and strips a JSON fence', () => {
    expect(validateModelResult('```json\n{"table":{"assetId":"asset_orders","meaning":"订单业务记录"},"fields":[{"assetId":"asset_order_id","meaning":"订单唯一标识"},{"assetId":"asset_amount","meaning":"订单金额"}]}\n```', input))
      .toMatchObject({ table: { meaning: '订单业务记录' }, fields: [{ assetId: 'asset_order_id' }, { assetId: 'asset_amount' }] })
  })

  it('rejects missing, duplicate, and unknown field asset ids', () => {
    expect(() => validateModelResult('{"table":{"assetId":"asset_orders","meaning":"订单"},"fields":[{"assetId":"asset_order_id","meaning":"编号"}]}', input))
      .toThrow(/omitted field asset/)
    expect(() => validateModelResult('{"table":{"assetId":"asset_orders","meaning":"订单"},"fields":[{"assetId":"asset_order_id","meaning":"编号"},{"assetId":"asset_order_id","meaning":"重复"}]}', input))
      .toThrow(/repeated field asset/)
    expect(() => validateModelResult('{"table":{"assetId":"asset_orders","meaning":"订单"},"fields":[{"assetId":"asset_order_id","meaning":"编号"},{"assetId":"asset_unknown","meaning":"未知"}]}', input))
      .toThrow(/unknown field asset/)
  })
})
