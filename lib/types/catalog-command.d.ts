/** Preset-scoped `/catalog` human command adapter. */
import type { Context } from '@deepseek-ai/cordis';
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands';
import type { CatalogScope } from './catalog-types.ts';
export declare const CATALOG_COMMAND_USAGE: string;
export type CatalogCommandAction = {
    kind: 'scan';
    scope?: CatalogScope;
} | {
    kind: 'status';
    runId?: string;
} | {
    kind: 'cancel';
    runId?: string;
} | {
    kind: 'diff';
    fromRunId?: string;
    toRunId?: string;
} | {
    kind: 'view';
};
export interface CatalogCommandPresentation {
    watch(run: Awaited<ReturnType<Context['dataAgentCatalogScanner']['start']>>): void;
    open(sessionId: string): boolean;
}
export declare function registerCatalogCommand(ctx: Context, presentation?: CatalogCommandPresentation): () => void;
export declare function executeCatalogCommand(ctx: Context, invocation: CommandInvocation, presentation?: CatalogCommandPresentation): Promise<CommandResult>;
export declare function parseCatalogAction(rawInput: string): CatalogCommandAction;
