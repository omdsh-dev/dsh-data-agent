/**
 * Agent-scoped `/database` human command. The preset mounts this entry below
 * the agent context, so the command registry scopes it to data-agent without
 * importing dsh-tui, React, or Ink.
 * @module @yejiming/dsh-data-agent/command
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands';
import { type ConnectionFormDraft, type ConnectionFormInitial, type ConnectionSummary, type DatabaseConnectionInput } from './connections.ts';
export declare const name = "data-agent-database-command";
export declare const inject: string[];
export declare const DATABASE_COMMAND_USAGE: string;
type DatabaseAction = {
    kind: 'status';
} | {
    kind: 'connect';
    input?: DatabaseConnectionInput;
} | {
    kind: 'test';
} | {
    kind: 'disconnect';
};
export declare const DATA_AGENT_TOOL_NAMES: readonly ["str_replace_editor", "sql-query", "sql-write", "sql-cmd", "catalog-search", "catalog-get", "metric-get"];
export interface DatabaseCommandInteraction {
    isTuiFormAvailable(): boolean;
    collectTuiConnection(signal: AbortSignal, options: {
        initialDraft?: ConnectionFormInitial;
        persistDraft(draft: ConnectionFormDraft): Promise<void>;
    }): Promise<DatabaseConnectionInput | undefined>;
}
export interface DataAgentCommandAdapterOptions {
    /** Override only for focused runtime-boundary tests. */
    isDshTuiPluginLoaded?: (ctx: Context) => boolean;
}
/** Official Cordis runtime name exported by `@deepseek-harness-tui/dsh-tui`. */
export declare const DSH_TUI_PLUGIN_RUNTIME_NAME = "dsh-tui";
/**
 * Detect actual plugin usage from Cordis' live registry. Package installation,
 * argv and profile labels are deliberately irrelevant.
 */
export declare function isDshTuiPluginLoaded(ctx: Context): boolean;
/** Keep the tool boundary everywhere; follow the actual dsh-tui runtime lifecycle for commands. */
export declare function apply(ctx: Context, options?: DataAgentCommandAdapterOptions): void;
/** Public for focused command tests and alternate command adapters. */
export declare function executeDatabaseCommand(ctx: Context, invocation: CommandInvocation, interaction?: DatabaseCommandInteraction): Promise<CommandResult>;
/** Parse one command's raw input without ever accepting a plaintext password. */
export declare function parseDatabaseAction(rawInput: string): DatabaseAction;
/** Non-interactive `connect` argument grammar. */
export declare function parseConnectArguments(tokens: readonly string[]): DatabaseConnectionInput;
/** Render a public summary; no password-bearing field exists in the type. */
export declare function formatConnectionStatus(summary: ConnectionSummary | undefined): string;
export {};
