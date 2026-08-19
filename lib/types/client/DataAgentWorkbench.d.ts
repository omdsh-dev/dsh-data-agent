import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
export type { DatabaseType } from '../database-types.ts';
/** The sessions-list slice the workbench needs (structural; avoids a runtime import). */
export interface SessionListLike {
    byId: Record<string, {
        agentPreset?: string;
    }>;
}
/** Registration-side business face: the sessions-list observable becomes `useSessions`. */
export interface DataAgentWorkbenchInjected {
    hooks: {
        sessions: {
            getSnapshot(): SessionListLike;
            subscribe(fn: () => void): () => void;
        };
    };
}
/** The workbench's full component props: the composer-right seat + locale + sessions hook. */
export type DataAgentWorkbenchProps = PropsRuntime<'conversation.input.right'> & PropsLocale<'data-agent'> & InjectFace<DataAgentWorkbenchInjected>;
/** The database workbench body. */
export declare function DataAgentWorkbench({ sessionId, useSessions, t }: DataAgentWorkbenchProps): import("react").JSX.Element | null;
