/**
 * Cross-surface hand-off for opening the session-scoped database workbench
 * from the alpha.2 New Session hero, where no Session scope exists yet.
 */
import type { SessionListLike } from './DataAgentWorkbench.tsx'

/** The plugin preset id used by both the hero stage and Session projection. */
export const DATA_AGENT_PRESET = 'data-agent'

/** Minimal observable contract consumed by the slot renderer's Hook binder. */
export interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(fn: () => void): () => void
}

/** One pending/ready request to open the workbench. */
export interface WorkbenchOpenSnapshot {
  pending: boolean
  revision: number
  sessionId?: string
}

/** Mutable observable kept private behind the compatibility bridge. */
interface MutableObservableSnapshot<T> extends ObservableSnapshot<T> {
  set(snapshot: T): void
}

function createObservable<T>(initial: T): MutableObservableSnapshot<T> {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    set(next) {
      if (Object.is(snapshot, next)) return
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

/** The Session-list operations needed to bridge a root action into one Session. */
export interface SessionListSource extends ObservableSnapshot<SessionListLike> {}

export interface WorkbenchOpenBridge {
  store: ObservableSnapshot<WorkbenchOpenSnapshot>
  /** Start the host's New Session flow and open once data-agent is mounted. */
  requestFromHero(): void
  /** Clear a delivered request after the target workbench accepts it. */
  acknowledge(revision: number): void
  dispose(): void
}

/**
 * Create the one-way hero → Session workbench bridge.
 *
 * The host remains responsible for workspace inheritance, Session creation,
 * navigation, and applying the staged agent preset. This bridge only waits
 * for the resulting Session projection before publishing an open request.
 */
export function createWorkbenchOpenBridge(
  sessions: SessionListSource,
  startSession: () => void,
): WorkbenchOpenBridge {
  const store = createObservable<WorkbenchOpenSnapshot>({ pending: false, revision: 0 })

  const settle = (): void => {
    const current = store.getSnapshot()
    if (!current.pending) return
    const list = sessions.getSnapshot()
    const sessionId = list.current
    if (sessionId === undefined) return
    if (list.byId[sessionId]?.projectionValues?.agentPreset !== DATA_AGENT_PRESET) return
    store.set({ pending: false, revision: current.revision + 1, sessionId })
  }

  const unsubscribe = sessions.subscribe(settle)
  return {
    store,
    requestFromHero() {
      if (store.getSnapshot().pending) return
      const current = store.getSnapshot()
      store.set({ pending: true, revision: current.revision })
      try {
        startSession()
        settle()
      } catch (error) {
        store.set({ pending: false, revision: current.revision })
        throw error
      }
    },
    acknowledge(revision) {
      const current = store.getSnapshot()
      if (current.revision !== revision || current.sessionId === undefined) return
      store.set({ pending: false, revision: current.revision })
    },
    dispose() {
      unsubscribe()
    },
  }
}
