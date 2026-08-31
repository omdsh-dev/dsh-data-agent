/**
 * Data Agent browser half, plugin entry: registers the database workbench
 * as a compact context-row control for data-agent sessions, and the
 * `data-agent` dictionaries. The workbench itself opens in one Modal.
 * Connection state lives in the server-side connection store, so layout and
 * session switches never lose it — the view only mirrors what
 * `/plugins/data-agent/status` reports.
 * @module @yejiming/dsh-data-agent/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ComponentType } from 'react'
// Type-only: pulls the alpha.2 Session Controller service (ctx.sessions) into this program.
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: declares the host New Session preset seat and its locale namespace.
import type { AgentPresetSeatProps } from '@deepseek-ai/dsh-client-ui-agent-preset/client'
// Type-only: pulls the ui-conversation slot declarations (conversation.input.right)
// and the session standard props (sessionId) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: declares the SlotRegistry service implemented by the renderer.
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: contributes the useSessions/sessionId standard slot props.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the keyed tool.call.toolview slot declaration owned by the
// tool call-tree renderer, so this package can register its render-analysis row.
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
// Type-only: pulls the host-owned New Session navigation service into ctx.
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { DataAgentWorkbench, type SessionListLike } from './DataAgentWorkbench.tsx'
import { DataAgentHeroControls, type HostAgentPresetSeatFace } from './DataAgentHeroControls.tsx'
import { RenderAnalysisRow } from './AnalysisDashboard.tsx'
import { NS, en, zh, type DataAgentKey } from './locales.ts'
import { createWorkbenchOpenBridge } from './workbench-open.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The database workbench copy. */
    'data-agent': DataAgentKey
  }
}

/** Required services: locale/slots, Session state, and host New Session navigation. */
export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace']

function priorityOf(entry: StoredEntry): number {
  return entry.options.priority ?? 0
}

/**
 * Client plugin body: register the data-agent dictionaries and the database
 * workbench trigger into the composer card's right control region. The registration rides the slot
 * service's effect wrapper, so plugin unload removes it.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'data-agent: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.inject(['slots', 'locale', 'sessions', 'uiWorkspace'], (scope: ClientContext) => {
    // The server half also has a `sessions` service in this package's combined
    // declaration program. Narrow the browser fiber to the alpha.2 client
    // services explicitly instead of relying on the colliding Context merge.
    const services = scope as unknown as {
      sessions: ISessions
      slots: SlotRegistry
      uiWorkspace: UiWorkspace
    }
    const { sessions, slots, uiWorkspace } = services
    const list = sessions.list
    // The sessions list is the agent-preset authority on the client: the
    // alpha.2 projects the current preset into `projectionValues.agentPreset`.
    const sessionsSource = {
      getSnapshot: (): SessionListLike => list.getSnapshot() as unknown as SessionListLike,
      subscribe: (fn: () => void): (() => void) => list.subscribe(fn),
    }
    const workbenchOpen = createWorkbenchOpenBridge(
      sessionsSource,
      () => uiWorkspace.startSession(),
    )
    scope.effect(() => () => workbenchOpen.dispose(), 'data-agent: workbench open bridge')

    // The workbench is a compact input-card control; its own CSS places the
    // registered control at the card's top-right. Non-data-agent sessions render null.
    slots.inject('conversation.input.right', () => slots.register({
      name: 'conversation.input.right',
      id: 'data-agent',
      order: 0,
      locale: NS,
      inject: () => ({
        hooks: { sessions: sessionsSource, workbenchOpen: workbenchOpen.store },
        acknowledgeWorkbenchOpen: workbenchOpen.acknowledge,
      }),
    }, DataAgentWorkbench))

    // alpha.2's blank-session composer has no Session scope, so input.right
    // cannot render there. Shadow the host's single agent-preset seat with an
    // additive wrapper that preserves its exact component/inject face and adds
    // the database entry only while `data-agent` is staged. Slot priority makes
    // the original seat the automatic fallback if this wrapper ever abdicates.
    slots.inject('conversation.hero.agentPreset', () => {
      let source: StoredEntry | undefined
      let disposeShadow: (() => void) | undefined
      let disposed = false
      let scheduled = false

      const reconcile = (): void => {
        scheduled = false
        if (disposed) return
        const entries = slots.entries('conversation.hero.agentPreset')
          .filter(entry => entry.component !== DataAgentHeroControls)
          .slice()
          .sort((left, right) => priorityOf(left) - priorityOf(right))
        const next = entries[0]
        if (next === source) return

        const previous = disposeShadow
        disposeShadow = undefined
        source = undefined
        previous?.()
        if (next === undefined || next.inject === undefined) return

        const originalSeat = next.component as ComponentType<AgentPresetSeatProps>
        const originalInject = next.inject as unknown as (() => HostAgentPresetSeatFace)
        const priority = Math.min(...entries.map(priorityOf)) - 1
        source = next
        disposeShadow = slots.register({
          name: 'conversation.hero.agentPreset',
          priority,
          locale: 'settings.agentPreset',
          inject: () => {
            const face = originalInject()
            return {
              ...face,
              hooks: {
                ...face.hooks,
                heroWorkbench: workbenchOpen.store,
              },
              originalSeat,
              dataAgentT: t,
              requestWorkbench: workbenchOpen.requestFromHero,
            }
          },
        }, DataAgentHeroControls)
      }
      const schedule = (): void => {
        if (scheduled || disposed) return
        scheduled = true
        queueMicrotask(reconcile)
      }
      const unsubscribe = slots.subscribe('conversation.hero.agentPreset', schedule)
      reconcile()
      return () => {
        disposed = true
        unsubscribe()
        disposeShadow?.()
      }
    })

    // The render-analysis tool result row: additive keyed registration into
    // the tool renderer's key domain. Disposal rides slots.inject's effect.
    slots.inject('tool.call.toolview', () => slots.register({
      name: 'tool.call.toolview',
      key: 'render-analysis',
      locale: NS,
    }, RenderAnalysisRow))
  })
}
