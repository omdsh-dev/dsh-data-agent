/** Browser-only Catalog route client and wire contracts. */

import type {
  CatalogAssetDetail,
  CatalogDiffPage,
  CatalogRun,
  CatalogScope,
  CatalogSearchItem,
  CatalogSearchPage,
  CatalogSemanticRevision,
  CatalogSource,
  SemanticDefinition,
} from '../catalog-types.ts'

const BASE = '/plugins/data-agent/catalog'

export interface CatalogStatusWire {
  source: CatalogSource
  activeRun?: CatalogRun
  latestRun?: CatalogRun
  latestSuccessfulRun?: CatalogRun
  counts: { assets: number; fields: number; needsReview: number }
}

export type {
  CatalogAssetDetail,
  CatalogDiffPage,
  CatalogRun,
  CatalogScope,
  CatalogSearchItem,
  CatalogSearchPage,
  CatalogSemanticRevision,
  CatalogSource,
  SemanticDefinition,
}

export async function listCatalogSources(signal?: AbortSignal): Promise<CatalogSource[]> {
  return (await request<{ ok: true; sources: CatalogSource[] }>(`${BASE}/sources`, { signal })).sources
}

export async function getCatalogStatus(sourceId: string, signal?: AbortSignal): Promise<CatalogStatusWire | null> {
  const params = new URLSearchParams({ sourceId })
  return (await request<{ ok: true; status: CatalogStatusWire | null }>(`${BASE}/status?${params}`, { signal })).status
}

export async function listCatalogRuns(sourceId: string, signal?: AbortSignal): Promise<CatalogRun[]> {
  const params = new URLSearchParams({ sourceId, limit: '100' })
  return (await request<{ ok: true; runs: CatalogRun[] }>(`${BASE}/runs?${params}`, { signal })).runs
}

export async function searchCatalog(input: {
  sourceId: string
  query: string
  schema?: string
  assetKinds?: string[]
  semanticKinds?: string[]
  assetStatuses?: string[]
  semanticStatuses?: string[]
  includeInferred?: boolean
  cursor?: string
  pageSize?: number
}, signal?: AbortSignal): Promise<CatalogSearchPage> {
  const params = new URLSearchParams({ sourceId: input.sourceId, query: input.query.trim() || '*' })
  if (input.schema !== undefined && input.schema !== '') params.set('schema', input.schema)
  if (input.assetKinds?.length) params.set('assetKinds', input.assetKinds.join(','))
  if (input.semanticKinds?.length) params.set('semanticKinds', input.semanticKinds.join(','))
  if (input.assetStatuses?.length) params.set('assetStatuses', input.assetStatuses.join(','))
  if (input.semanticStatuses?.length) params.set('semanticStatuses', input.semanticStatuses.join(','))
  if (input.includeInferred === true) params.set('includeInferred', 'true')
  if (input.cursor !== undefined) params.set('cursor', input.cursor)
  if (input.pageSize !== undefined) params.set('pageSize', String(input.pageSize))
  return (await request<{ ok: true; page: CatalogSearchPage }>(`${BASE}/search?${params}`, { signal })).page
}

export async function getCatalogAsset(
  sourceId: string,
  assetId: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<CatalogAssetDetail> {
  const params = new URLSearchParams({ sourceId, pageSize: '100' })
  if (cursor !== undefined) params.set('cursor', cursor)
  return (await request<{ ok: true; detail: CatalogAssetDetail }>(
    `${BASE}/assets/${encodeURIComponent(assetId)}?${params}`,
    { signal },
  )).detail
}

export async function getCatalogSemantic(
  sourceId: string,
  semanticId: string,
  version?: number,
  signal?: AbortSignal,
): Promise<CatalogSemanticRevision> {
  const params = new URLSearchParams({ sourceId })
  if (version !== undefined) params.set('version', String(version))
  return (await request<{ ok: true; semantic: CatalogSemanticRevision }>(
    `${BASE}/semantics/${encodeURIComponent(semanticId)}?${params}`,
    { signal },
  )).semantic
}

export async function startCatalogScan(sessionId: string, scope: CatalogScope): Promise<CatalogRun> {
  return (await request<{ ok: true; run: CatalogRun }>(`${BASE}/scan`, json({ sessionId, scope }))).run
}

export async function cancelCatalogScan(sourceId: string, runId?: string): Promise<CatalogRun> {
  return (await request<{ ok: true; run: CatalogRun }>(`${BASE}/cancel`, json({ sourceId, ...(runId ? { runId } : {}) }))).run
}

export async function getCatalogDiff(
  sourceId: string,
  from?: string,
  to?: string,
  cursor?: string,
): Promise<CatalogDiffPage> {
  const params = new URLSearchParams({ sourceId, pageSize: '100' })
  if (from !== undefined && to !== undefined) { params.set('from', from); params.set('to', to) }
  if (cursor !== undefined) params.set('cursor', cursor)
  return (await request<{ ok: true; diff: CatalogDiffPage }>(`${BASE}/diff?${params}`)).diff
}

export async function saveCatalogCandidate(input: {
  sourceId: string
  semanticId?: string
  expectedVersion?: number
  definition: SemanticDefinition
}): Promise<CatalogSemanticRevision> {
  return (await request<{ ok: true; semantic: CatalogSemanticRevision }>(`${BASE}/semantics`, json(input))).semantic
}

export async function verifyCatalogSemantic(input: {
  sourceId: string
  semanticId: string
  expectedVersion: number
  definition: SemanticDefinition
}): Promise<CatalogSemanticRevision> {
  return (await request<{ ok: true; semantic: CatalogSemanticRevision }>(
    `${BASE}/semantics/${encodeURIComponent(input.semanticId)}/verify`,
    json({ sourceId: input.sourceId, expectedVersion: input.expectedVersion, definition: input.definition }),
  )).semantic
}

export async function retireCatalogSemantic(input: {
  sourceId: string
  semanticId: string
  expectedVersion: number
  revisionNote: string
}): Promise<CatalogSemanticRevision> {
  return (await request<{ ok: true; semantic: CatalogSemanticRevision }>(
    `${BASE}/semantics/${encodeURIComponent(input.semanticId)}/retire`,
    json({ sourceId: input.sourceId, expectedVersion: input.expectedVersion, revisionNote: input.revisionNote }),
  )).semantic
}

export async function dismissCatalogMeaning(input: {
  sourceId: string
  semanticId: string
  expectedVersion: number
}): Promise<CatalogSemanticRevision> {
  return (await request<{ ok: true; semantic: CatalogSemanticRevision }>(
    `${BASE}/semantics/${encodeURIComponent(input.semanticId)}/dismiss`,
    json({ sourceId: input.sourceId, expectedVersion: input.expectedVersion }),
  )).semantic
}

function json(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  let body: unknown
  try { body = await response.json() } catch { body = undefined }
  if (!response.ok) {
    const error = body !== null && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `HTTP ${response.status}`
    throw new Error(error)
  }
  return body as T
}
