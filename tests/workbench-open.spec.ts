import { describe, expect, it, vi } from 'vitest'
import type { SessionListLike } from '../src/client/DataAgentWorkbench.tsx'
import { createWorkbenchOpenBridge } from '../src/client/workbench-open.ts'

function sessionsSource(initial: SessionListLike) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    source: {
      getSnapshot: () => snapshot,
      subscribe(fn: () => void) {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    },
    publish(next: SessionListLike) {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

describe('New Session workbench bridge', () => {
  it('waits for the host-created Session to project data-agent before opening', () => {
    const sessions = sessionsSource({ byId: {} })
    const startSession = vi.fn()
    const bridge = createWorkbenchOpenBridge(sessions.source, startSession)

    bridge.requestFromHero()
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(bridge.store.getSnapshot()).toEqual({ pending: true, revision: 0 })

    sessions.publish({
      current: 'session-1',
      byId: { 'session-1': { projectionValues: { agentPreset: 'standard' } } },
    })
    expect(bridge.store.getSnapshot()).toEqual({ pending: true, revision: 0 })

    sessions.publish({
      current: 'session-1',
      byId: { 'session-1': { projectionValues: { agentPreset: 'data-agent' } } },
    })
    expect(bridge.store.getSnapshot()).toEqual({
      pending: false,
      revision: 1,
      sessionId: 'session-1',
    })

    bridge.acknowledge(1)
    expect(bridge.store.getSnapshot()).toEqual({ pending: false, revision: 1 })
    bridge.dispose()
  })

  it('deduplicates a pending hero click and resets when host navigation throws', () => {
    const sessions = sessionsSource({ byId: {} })
    const startSession = vi.fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => { throw new Error('navigation failed') })
    const bridge = createWorkbenchOpenBridge(sessions.source, startSession)

    bridge.requestFromHero()
    bridge.requestFromHero()
    expect(startSession).toHaveBeenCalledTimes(1)

    sessions.publish({ current: 'session-1', byId: { 'session-1': {} } })
    expect(bridge.store.getSnapshot().pending).toBe(true)

    bridge.acknowledge(0)
    expect(bridge.store.getSnapshot().pending).toBe(true)
    bridge.dispose()

    const retry = createWorkbenchOpenBridge(sessions.source, () => { throw new Error('navigation failed') })
    expect(() => retry.requestFromHero()).toThrow('navigation failed')
    expect(retry.store.getSnapshot()).toEqual({ pending: false, revision: 0 })
    retry.dispose()
  })
})
