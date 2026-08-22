/** Deterministic identity, normalization, and fingerprint helpers. */

import { createHash } from 'node:crypto'
import type { DatabaseType } from './database-types.ts'
import type { CatalogIdentity, CatalogTechnicalPayload } from './catalog-types.ts'

const CASE_INSENSITIVE_DIALECTS = new Set<DatabaseType>([
  'mysql', 'doris', 'sqlite', 'hive', 'impala', 'sqlserver',
])

/** Strip unsafe controls, normalize Unicode, and enforce one explicit bound. */
export function normalizeCatalogText(value: string, maxChars: number): { value: string; truncated: boolean } {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized.length <= maxChars) return { value: normalized, truncated: false }
  return { value: normalized.slice(0, maxChars), truncated: true }
}

/** Normalize an observed identifier according to the dialect's identity rules. */
export function normalizeCatalogIdentifier(type: DatabaseType, value: string): string {
  const normalized = normalizeCatalogText(value, 256).value
  if (normalized.length === 0) throw new Error('Catalog identifier must not be empty')
  if (type === 'oracle') return normalized.toUpperCase()
  return CASE_INSENSITIVE_DIALECTS.has(type) ? normalized.toLowerCase() : normalized
}

/** v1 source identity is deliberately the stable connection profile id. */
export function catalogSourceId(profileId: string): string {
  const normalized = normalizeCatalogText(profileId, 256).value
  if (normalized.length === 0) throw new Error('Catalog scan requires a stable profileId')
  return normalized
}

/** Build canonical structured identity without parsing display paths. */
export function canonicalCatalogIdentity(type: DatabaseType, identity: CatalogIdentity): CatalogIdentity {
  return {
    sourceId: catalogSourceId(identity.sourceId),
    database: normalizeCatalogIdentifier(type, identity.database),
    schema: normalizeCatalogIdentifier(type, identity.schema),
    kind: identity.kind,
    ...identity.relation !== undefined
      ? { relation: normalizeCatalogIdentifier(type, identity.relation) }
      : {},
    name: normalizeCatalogIdentifier(type, identity.name),
  }
}

/** Stable opaque asset id derived only from structured identity components. */
export function catalogAssetId(type: DatabaseType, identity: CatalogIdentity): string {
  const canonical = canonicalCatalogIdentity(type, identity)
  const digest = createHash('sha256').update(stableJson(canonical)).digest('hex').slice(0, 32)
  return `asset_${digest}`
}

export function catalogSemanticId(sourceId: string, kind: 'term' | 'metric', name: string): string {
  const key = { sourceId: catalogSourceId(sourceId), kind, name: normalizeCatalogText(name, 256).value.toLocaleLowerCase('en-US') }
  return `${kind}_${createHash('sha256').update(stableJson(key)).digest('hex').slice(0, 32)}`
}

/** Technical fingerprint excludes run-specific provenance and display-only truncation facts. */
export function catalogTechnicalFingerprint(payload: CatalogTechnicalPayload, status: string = 'observed'): string {
  const canonical = {
    status,
    identity: payload.identity,
    name: payload.name,
    parentId: payload.parentId,
    objectType: payload.objectType,
    dataType: payload.dataType,
    nullable: payload.nullable,
    ordinal: payload.ordinal,
    comment: payload.comment,
    referencedAssetIds: payload.referencedAssetIds,
    attributes: payload.attributes,
    capabilities: payload.capabilities,
  }
  return createHash('sha256').update(stableJson(canonical)).digest('hex')
}

/** Deterministic JSON encoding for hashes and cursor order keys. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(Object.keys(record).sort().map(key => [key, sortValue(record[key])]))
}

export function catalogRevisionId(assetId: string, revision: number): string {
  return `${assetId}:r${String(revision).padStart(8, '0')}`
}

export function catalogSemanticRevisionId(semanticId: string, version: number): string {
  return `${semanticId}:v${String(version).padStart(8, '0')}`
}
