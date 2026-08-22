// @vitest-environment jsdom

import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  buildCatalogTuiDetailLines,
  createCatalogTuiAdapter,
  formatCatalogTuiStatus,
  isCatalogRunSettled,
} from '../src/catalog-tui.ts'
import type { CatalogRun } from '../src/catalog-types.ts'

function run(overrides: Partial<CatalogRun> = {}): CatalogRun {
  return {
    id: 'run-a', sourceId: 'profile-a', sessionId: 'session-a', scope: { kind: 'source' }, status: 'running',
    coverageComplete: false, progress: { schemas: 2, relations: 8, fields: 31, assets: 41 },
    createdAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  }
}

describe('Catalog dsh-tui adapter', () => {
  it('projects technical, AI and terminal phases into bounded persistent status text', () => {
    expect(formatCatalogTuiStatus(run())).toContain('正在读取技术元数据')
    expect(formatCatalogTuiStatus(run({ status: 'applying' }))).toContain('正在发布技术目录')
    const enriching = run({
      status: 'succeeded',
      enrichment: {
        status: 'running', provider: 'provider-a', model: 'model-a', tablesTotal: 27, tablesCompleted: 11,
        tablesFailed: 1, candidatesGenerated: 132,
      },
    })
    expect(formatCatalogTuiStatus(enriching)).toContain('11/27 表')
    expect(formatCatalogTuiStatus(enriching)).toContain('1 失败')
    expect(isCatalogRunSettled(enriching)).toBe(false)
    const complete = run({
      ...enriching,
      enrichment: { ...enriching.enrichment!, status: 'succeeded', tablesCompleted: 27 },
    })
    expect(formatCatalogTuiStatus(complete)).toContain('/catalog view')
    expect(isCatalogRunSettled(complete)).toBe(true)
    expect(formatCatalogTuiStatus(run({ status: 'failed', error: 'secret detail' }))).not.toContain('secret detail')
  })

  it('soft-mounts public TUI services, clears status on view, and disposes symmetrically', () => {
    const statusWrites: Array<string | undefined> = []
    const opens: string[] = []
    let registeredScene: { id: string } | undefined
    let sceneDisposed = false
    const current = run({ status: 'queued', progress: { schemas: 0, relations: 0, fields: 0, assets: 0 } })
    const services = {
      tuiStatus: {
        set(_key: string, text: string | undefined) {
          statusWrites.push(text)
          return () => statusWrites.push(undefined)
        },
      },
      tuiScenes: {
        register(scene: { id: string }) {
          registeredScene = scene
          return () => { sceneDisposed = true }
        },
        open(id: string) { opens.push(id); return true },
      },
    }
    const ctx = {
      logger: { warn() {} },
      get(name: string) { return services[name as keyof typeof services] },
      dataAgentCatalog: { listRuns: () => [current] },
    } as never
    const adapter = createCatalogTuiAdapter(ctx)
    expect(registeredScene?.id).toBe('data-agent-catalog')
    adapter.watch(current)
    expect(statusWrites.some(value => value?.includes('等待扫描'))).toBe(true)
    expect(adapter.open('session-a')).toBe(true)
    expect(opens).toEqual(['data-agent-catalog'])
    expect(statusWrites.at(-1)).toBeUndefined()
    adapter.dispose()
    expect(sceneDisposed).toBe(true)
  })

  it('keeps scan commands usable when optional TUI presentation services are absent', () => {
    const adapter = createCatalogTuiAdapter({
      logger: { warn() {} }, get() { return undefined }, dataAgentCatalog: { listRuns: () => [] },
    } as never)
    expect(() => adapter.watch(run({ status: 'succeeded' }))).not.toThrow()
    expect(adapter.open('session-a')).toBe(false)
    adapter.dispose()
  })

  it('groups table and field AI meanings in the right-pane projection', () => {
    const lines = buildCatalogTuiDetailLines({
      asset: {
        assetId: 'table-a', status: 'observed',
        payload: { name: 'orders', path: 'shop.sales.orders', comment: '订单事实表' },
      },
      fields: [{ assetId: 'field-a', payload: { name: 'amount', dataType: 'decimal(18,2)', nullable: false } }],
      relations: [{ kind: 'foreign_key', name: 'fk_customer', columnAssetIds: ['field-b'] }],
      semantics: [
        {
          semanticId: 'meaning-table', definition: {
            kind: 'meaning', targetAssetId: 'table-a', status: 'inferred', description: '记录订单交易事实',
            generatedBy: { provider: 'p', model: 'm', runId: 'run-a' },
          },
        },
        {
          semanticId: 'meaning-field', definition: {
            kind: 'meaning', targetAssetId: 'field-a', status: 'verified', description: '订单含税金额',
            generatedBy: { provider: 'p', model: 'm', runId: 'run-a' },
          },
        },
      ],
      history: [], truncated: false, untrusted: true,
    } as never)
    expect(lines).toContain('表业务含义')
    expect(lines).toContain('[inferred] 记录订单交易事实')
    expect(lines).toContain('amount · decimal(18,2) · 非空')
    expect(lines).toContain('  [verified] 订单含税金额')
    expect(lines).toContain('关系')
  })

  it('renders the registered scene with the host React instance and shared Catalog data', async () => {
    let scene: { component: React.ComponentType<any> } | undefined
    const source = {
      id: 'profile-a', profileId: 'profile-a', type: 'mysql', name: 'Shop', database: 'sales',
      credentialConfigured: true, createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z',
    }
    const detail = {
      asset: { assetId: 'table-a', status: 'observed', payload: { name: 'orders', path: 'shop.sales.orders' } },
      fields: [{ assetId: 'field-a', payload: { name: 'amount', dataType: 'decimal(18,2)' } }],
      relations: [],
      semantics: [{
        semanticId: 'meaning-table', definition: {
          kind: 'meaning', targetAssetId: 'table-a', status: 'inferred', description: '记录订单交易事实',
          generatedBy: { provider: 'p', model: 'm', runId: 'run-a' },
        },
      }],
      history: [], truncated: false, untrusted: true,
    }
    const ctx = {
      logger: { warn() {} },
      get(name: string) {
        if (name !== 'tuiScenes') return undefined
        return {
          register(value: { component: React.ComponentType<any> }) { scene = value; return () => {} },
          open() { return true },
        }
      },
      dataAgentCatalog: {
        resolveSource: async () => source,
        search: async () => ({
          sourceId: 'profile-a', query: '*',
          items: [{
            id: 'table-a', sourceId: 'profile-a', resultType: 'asset', kind: 'table', name: 'orders',
            path: 'shop.sales.orders', summary: '', matchReasons: ['browse'], status: 'observed',
            provenance: 'database', untrusted: true,
          }],
          truncated: false, warnings: [],
        }),
        status: () => ({ source, counts: { assets: 2, fields: 1, needsReview: 1 } }),
        getAsset: () => detail,
        listRuns: () => [],
      },
    } as never
    const adapter = createCatalogTuiAdapter(ctx)
    expect(adapter.open('session-a')).toBe(true)
    expect(scene).toBeDefined()
    const Box = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)
    const Text = ({ children }: { children?: React.ReactNode }) => React.createElement('span', null, children)
    const view = render(React.createElement(scene!.component, {
      React,
      ui: { Box, Text, useInput() {}, useTerminalSize: () => ({ columns: 120, rows: 32 }) },
      close() {},
    }))
    await waitFor(() => expect(view.container.textContent).toContain('记录订单交易事实'))
    expect(view.container.textContent).toContain('amount · decimal(18,2)')
    adapter.dispose()
  })
})
