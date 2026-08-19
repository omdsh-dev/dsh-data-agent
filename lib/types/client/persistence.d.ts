/**
 * Connection-config persistence for the database workbench. The most recent
 * successful connection (type/host/port/user/database/password) is kept in
 * localStorage under one key so remounts and restarts can restore the form
 * and auto-reconnect (the server persists only non-secret profiles/bindings).
 *
 * Security note: the password is persisted in PLAIN TEXT by explicit user
 * decision (local single-user scenario) — see README 安全说明. The storage
 * key is versioned so a future shape change can migrate or ignore old data.
 * @module @yejiming/dsh-data-agent/persistence
 */
import { type DatabaseType } from '../database-types.ts';
/** localStorage key holding the most recent connection configuration. */
export declare const CONNECTION_STORAGE_KEY = "dsh-data-agent.connection.v1";
/** The persisted connection configuration. */
export interface SavedConnection {
    type: DatabaseType;
    host?: string;
    port?: number;
    user?: string;
    database: string;
    /** Present only when the user explicitly opted in to persist the password. */
    password?: string;
    /** Non-secret credential reference; mutually exclusive with `password`. */
    passwordRef?: string;
    /** Explicit form mode; absent legacy records infer it from passwordRef. */
    credentialMode?: 'none' | 'password' | 'reference';
    /** Opt-in flag; when true, {@link saveConnection} may write `password`. */
    persistPassword?: boolean;
    readonly?: boolean;
    /** ClickHouse only: HTTPS with normal certificate verification. */
    secure?: boolean;
    /** Diagnostic timestamp of the save. */
    savedAt: string;
}
/** Runtime storage face (injectable for tests). */
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
/** Save one connection configuration (best-effort; storage failures degrade silently). */
export declare function saveConnection(connection: SavedConnection, storage?: StorageLike | undefined): void;
/** Load the saved connection configuration; null when absent or malformed. */
export declare function loadConnection(storage?: StorageLike | undefined): SavedConnection | null;
/** Remove the saved connection configuration. */
export declare function clearConnection(storage?: StorageLike | undefined): void;
