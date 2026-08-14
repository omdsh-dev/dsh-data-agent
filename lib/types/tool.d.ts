/**
 * The sqlcmd tool half (`@deepseek-ai/dsh-data-agent/tool`): mounted ONLY by
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
 * @module @deepseek-ai/dsh-data-agent/tool
 */
import type { Context } from 'cordis';
import z from 'schemastery';
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
    /** CLI client overrides keyed by database type. */
    clients: Partial<Record<string, ClientConfig>>;
}
/** Loader schema with deployment defaults (no library defaults). */
export declare const Config: z<Schemastery.ObjectS<{
    queryTimeoutMs: z<number, number>;
    maxResultChars: z<number, number>;
    maxRows: z<number, number>;
    clients: z<import("cosmokit").Dict<{
        command?: string | null | undefined;
        args?: string[] | null | undefined;
    } & import("cosmokit").Dict, string>, import("cosmokit").Dict<Schemastery.ObjectT<{
        command: z<string, string>;
        args: z<string[], string[]>;
    }>, string>>;
}>, Schemastery.ObjectT<{
    queryTimeoutMs: z<number, number>;
    maxResultChars: z<number, number>;
    maxRows: z<number, number>;
    clients: z<import("cosmokit").Dict<{
        command?: string | null | undefined;
        args?: string[] | null | undefined;
    } & import("cosmokit").Dict, string>, import("cosmokit").Dict<Schemastery.ObjectT<{
        command: z<string, string>;
        args: z<string[], string[]>;
    }>, string>>;
}>>;
/**
 * Mount the sqlcmd tool: register it into the current agent's tool registry.
 * @param ctx - the preset-scoped agent context.
 * @param config - validated loader configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
