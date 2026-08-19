/**
 * Cross-platform database CLI discovery.
 *
 * The subprocess provider remains the authority for executable validation.
 * This module only builds a bounded, platform-aware PATH fallback when the
 * provider cannot resolve the configured/default bare command from its
 * current execution environment. No shell, registry, or recursive scan is
 * involved, and the exact discovery environment is returned for spawn.
 * @module @yejiming/dsh-data-agent/client-discovery
 */
import type { CliDatabaseType, ClientConfig } from './clients.ts';
/** Host facts are injectable so all supported platforms can be tested on one CI host. */
export interface ClientDiscoverySystem {
    platform: NodeJS.Platform;
    env: Readonly<Record<string, string | undefined>>;
    homeDir: string;
    cwd: string;
    readDirectory(directory: string): Promise<readonly string[]>;
}
/** DSH subprocess executable resolver face. */
export type ExecutableResolver = (command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal) => Promise<string>;
/** A resolved executable plus the environment that must also be used for spawn. */
export interface ClientExecutableResolution {
    executable: string;
    env: Readonly<Record<string, string>>;
    searchedDirectories: readonly string[];
}
/** Input for one database client resolution attempt. */
export interface ResolveClientExecutableOptions {
    type: CliDatabaseType;
    command: string;
    config?: ClientConfig;
    env: Readonly<Record<string, string>>;
    signal: AbortSignal;
    resolveExecutable: ExecutableResolver;
    system?: ClientDiscoverySystem;
}
/** Build ordered fallback directories without recursively scanning the host. */
export declare function buildClientSearchDirectories(type: CliDatabaseType, config: ClientConfig | undefined, signal: AbortSignal, system?: ClientDiscoverySystem): Promise<string[]>;
/**
 * Resolve one configured/default client. Current PATH (or an explicit path)
 * always wins. Only a missing bare command activates bounded PATH discovery.
 */
export declare function resolveClientExecutable(options: ResolveClientExecutableOptions): Promise<ClientExecutableResolution>;
