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
import { type Domain } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import type { ConnectionPersistence, PersistedConnectionFormDraft, PersistedConnectionProfile, PersistedConnectionProfileEntry, SessionConnectionBinding } from './connections.ts';
/** Storage-domain identity. Bump the version only with an explicit migration. */
export declare const CONNECTION_STORAGE_DOMAIN = "data_agent_connections";
export declare const CONNECTION_STORAGE_VERSION = 1;
/** Durable profile schema. There is deliberately no `password` field. */
export declare const persistedConnectionProfileSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    type: z.ZodEnum<{
        mysql: "mysql";
        postgres: "postgres";
        sqlite: "sqlite";
        oracle: "oracle";
        hive: "hive";
        impala: "impala";
        clickhouse: "clickhouse";
        doris: "doris";
        sqlserver: "sqlserver";
    }>;
    host: z.ZodOptional<z.ZodString>;
    port: z.ZodOptional<z.ZodNumber>;
    user: z.ZodOptional<z.ZodString>;
    database: z.ZodString;
    readonly: z.ZodOptional<z.ZodBoolean>;
    secure: z.ZodOptional<z.ZodBoolean>;
    passwordRef: z.ZodOptional<z.ZodString>;
    credentialMode: z.ZodOptional<z.ZodEnum<{
        none: "none";
        password: "password";
        reference: "reference";
    }>>;
    updatedAt: z.ZodString;
}, z.core.$strict>;
/** Durable session-to-profile binding schema. */
export declare const sessionConnectionBindingSchema: z.ZodObject<{
    profileId: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strict>;
/** Session form draft schema. Secret-shaped fields are rejected by strict mode. */
export declare const persistedConnectionFormDraftSchema: z.ZodObject<{
    type: z.ZodEnum<{
        mysql: "mysql";
        postgres: "postgres";
        sqlite: "sqlite";
        oracle: "oracle";
        hive: "hive";
        impala: "impala";
        clickhouse: "clickhouse";
        doris: "doris";
        sqlserver: "sqlserver";
    }>;
    host: z.ZodString;
    port: z.ZodString;
    user: z.ZodString;
    database: z.ZodString;
    readonly: z.ZodBoolean;
    secure: z.ZodOptional<z.ZodBoolean>;
    updatedAt: z.ZodString;
}, z.core.$strict>;
/** Single source of truth for the storage layout and durable validation. */
export declare const connectionStorageSpec: {
    name: string;
    version: number;
    tables: {
        profiles: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, PersistedConnectionProfile>;
        bindings: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, SessionConnectionBinding>;
        drafts: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, PersistedConnectionFormDraft>;
    };
};
export type ConnectionStorageDomain = Domain<typeof connectionStorageSpec>;
/** Select the newest successful profile with a deterministic id tie-break. */
export declare function latestConnectionProfile(entries: Iterable<readonly [string, PersistedConnectionProfile]>): PersistedConnectionProfileEntry | undefined;
/** Project a typed DSH domain handle onto the service's persistence seam. */
export declare function createDomainConnectionPersistence(domain: ConnectionStorageDomain): ConnectionPersistence;
