/**
 * Durable, non-secret connection profiles, session bindings, and form drafts.
 *
 * The domain intentionally excludes passwords, resolved credentials, SQL,
 * table metadata, and client output. Form drafts likewise accept no secret
 * fields. Runtime secrets stay in
 * {@link DataAgentConnectionService}; durable records only retain enough
 * information to rebuild a connection description in another DSH surface.
 * @module @yejiming/dsh-data-agent/storage
 */

import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type {
  ConnectionPersistence,
  PersistedConnectionFormDraft,
  PersistedConnectionProfile,
  PersistedConnectionProfileEntry,
  SessionConnectionBinding,
} from './connections.ts'
import { DATABASE_TYPES } from './database-types.ts'

/** Storage-domain identity. Bump the version only with an explicit migration. */
export const CONNECTION_STORAGE_DOMAIN = 'data_agent_connections'
export const CONNECTION_STORAGE_VERSION = 1

/** Durable profile schema. There is deliberately no `password` field. */
export const persistedConnectionProfileSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(DATABASE_TYPES),
  host: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  user: z.string().optional(),
  database: z.string().min(1),
  readonly: z.boolean().optional(),
  secure: z.boolean().optional(),
  passwordRef: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
  credentialMode: z.enum(['none', 'password', 'reference']).optional(),
  updatedAt: z.string().min(1),
}).strict()

/** Durable session-to-profile binding schema. */
export const sessionConnectionBindingSchema = z.object({
  profileId: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()

/** Session form draft schema. Secret-shaped fields are rejected by strict mode. */
export const persistedConnectionFormDraftSchema = z.object({
  type: z.enum(DATABASE_TYPES),
  host: z.string(),
  port: z.string(),
  user: z.string(),
  database: z.string(),
  readonly: z.boolean(),
  secure: z.boolean().optional(),
  updatedAt: z.string().min(1),
}).strict()

/** Single source of truth for the storage layout and durable validation. */
export const connectionStorageSpec = defineDomain({
  name: CONNECTION_STORAGE_DOMAIN,
  version: CONNECTION_STORAGE_VERSION,
  tables: {
    profiles: domainTable<string, PersistedConnectionProfile>(persistedConnectionProfileSchema),
    bindings: domainTable<string, SessionConnectionBinding>(sessionConnectionBindingSchema),
    drafts: domainTable<string, PersistedConnectionFormDraft>(persistedConnectionFormDraftSchema),
  },
})

export type ConnectionStorageDomain = Domain<typeof connectionStorageSpec>

/** Select the newest successful profile with a deterministic id tie-break. */
export function latestConnectionProfile(
  entries: Iterable<readonly [string, PersistedConnectionProfile]>,
): PersistedConnectionProfileEntry | undefined {
  let latest: PersistedConnectionProfileEntry | undefined
  for (const [profileId, profile] of entries) {
    if (latest === undefined
      || profile.updatedAt > latest.profile.updatedAt
      || (profile.updatedAt === latest.profile.updatedAt && profileId > latest.profileId)) {
      latest = { profileId, profile }
    }
  }
  return latest
}

/** Project a typed DSH domain handle onto the service's persistence seam. */
export function createDomainConnectionPersistence(domain: ConnectionStorageDomain): ConnectionPersistence {
  const profiles = domain.table('profiles')
  const bindings = domain.table('bindings')
  const drafts = domain.table('drafts')
  return {
    getProfile(profileId) {
      return profiles.get(profileId)
    },
    getLatestProfile() {
      return latestConnectionProfile(profiles.entries())
    },
    listProfiles() {
      return [...profiles.entries()]
        .map(([profileId, profile]) => ({ profileId, profile }))
        .sort((left, right) => left.profileId.localeCompare(right.profileId))
    },
    putProfile(profileId, profile) {
      return profiles.put(profileId, profile)
    },
    deleteProfile(profileId) {
      return profiles.delete(profileId)
    },
    getBinding(sessionId) {
      return bindings.get(sessionId)
    },
    putBinding(sessionId, binding) {
      return bindings.put(sessionId, binding)
    },
    deleteBinding(sessionId) {
      return bindings.delete(sessionId)
    },
    getDraft(sessionId) {
      return drafts.get(sessionId)
    },
    putDraft(sessionId, draft) {
      return drafts.put(sessionId, draft)
    },
    deleteDraft(sessionId) {
      return drafts.delete(sessionId)
    },
  }
}
