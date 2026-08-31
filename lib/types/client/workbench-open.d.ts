/**
 * Cross-surface hand-off for opening the session-scoped database workbench
 * from the alpha.2 New Session hero, where no Session scope exists yet.
 */
import type { SessionListLike } from './DataAgentWorkbench.tsx';
/** The plugin preset id used by both the hero stage and Session projection. */
export declare const DATA_AGENT_PRESET = "data-agent";
/** Minimal observable contract consumed by the slot renderer's Hook binder. */
export interface ObservableSnapshot<T> {
    getSnapshot(): T;
    subscribe(fn: () => void): () => void;
}
/** One pending/ready request to open the workbench. */
export interface WorkbenchOpenSnapshot {
    pending: boolean;
    revision: number;
    sessionId?: string;
}
/** The Session-list operations needed to bridge a root action into one Session. */
export interface SessionListSource extends ObservableSnapshot<SessionListLike> {
}
export interface WorkbenchOpenBridge {
    store: ObservableSnapshot<WorkbenchOpenSnapshot>;
    /** Start the host's New Session flow and open once data-agent is mounted. */
    requestFromHero(): void;
    /** Clear a delivered request after the target workbench accepts it. */
    acknowledge(revision: number): void;
    dispose(): void;
}
/**
 * Create the one-way hero → Session workbench bridge.
 *
 * The host remains responsible for workspace inheritance, Session creation,
 * navigation, and applying the staged agent preset. This bridge only waits
 * for the resulting Session projection before publishing an open request.
 */
export declare function createWorkbenchOpenBridge(sessions: SessionListSource, startSession: () => void): WorkbenchOpenBridge;
