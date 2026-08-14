/**
 * The sqlcmd tool half (`@yejiming/dsh-data-agent/tool`): mounted ONLY by
 * the data-agent agent preset (`preset/data-agent/agent.cordis.yml`), never
 * by the host composition. It consumes the host's `subprocess` service and
 * the host-provided `dataAgentConnections` connection store, so it needs no
 * realm and satisfies the preset guard (a preset row that only consumes).
 *
 * Execution model (see `src/query.ts`): the SQL text travels on the client's
 * stdin, argv carries flags only, credentials go through environment entries
 * (`MYSQL_PWD` / `PGPASSWORD`), and the caller's signal plus an internal
 * deadline share one AbortController that drives the process-tree terminate
 * escalation. Output is bounded per stream and marked `truncated`.
 * @module @yejiming/dsh-data-agent/tool
 */
import type { Context } from '@deepseek-ai/cordis';
import { type ClientConfig } from './clients.ts';
/** Cordis plugin name (diagnostics only). */
export declare const name = "data-agent-tool";
/** Services required before the tool can register. */
export declare const inject: string[];
/** Tool-half configuration (loader schema with the same defaults as the host). */
export interface Config {
    /** Deadline for one sqlcmd query, milliseconds. */
    queryTimeoutMs: number;
    /** In-memory cap on captured output. */
    maxResultChars: number;
    /** Row-count guidance injected into the tool description. */
    maxRows: number;
    /** Read-only guard: true rejects write statements. */
    readonly: boolean;
    /** CLI client overrides keyed by database type. */
    clients: Partial<Record<string, ClientConfig>>;
}
/** Loader schema with deployment defaults (no library defaults). */
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
    queryTimeoutMs: import("@deepseek-ai/schemastery").default<number, number>;
    maxResultChars: import("@deepseek-ai/schemastery").default<number, number>;
    maxRows: import("@deepseek-ai/schemastery").default<number, number>;
    readonly: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    clients: import("@deepseek-ai/schemastery").default<import("@deepseek-ai/cosmokit").Dict<{
        command?: string | null | undefined;
        args?: string[] | null | undefined;
    } & import("cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<{
        command: import("@deepseek-ai/schemastery").default<string, string>;
        args: import("@deepseek-ai/schemastery").default<string[], string[]>;
    }>, string>>;
}>, Schemastery.ObjectT<{
    queryTimeoutMs: import("@deepseek-ai/schemastery").default<number, number>;
    maxResultChars: import("@deepseek-ai/schemastery").default<number, number>;
    maxRows: import("@deepseek-ai/schemastery").default<number, number>;
    readonly: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    clients: import("@deepseek-ai/schemastery").default<import("@deepseek-ai/cosmokit").Dict<{
        command?: string | null | undefined;
        args?: string[] | null | undefined;
    } & import("cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<{
        command: import("@deepseek-ai/schemastery").default<string, string>;
        args: import("@deepseek-ai/schemastery").default<string[], string[]>;
    }>, string>>;
}>>;
/**
 * Mount the sqlcmd tool: register it into the current agent's tool registry.
 * @param ctx - the preset-scoped agent context.
 * @param config - validated loader configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
