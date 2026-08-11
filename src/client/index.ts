/**
 * Data Agent browser half, plugin entry: registers the database conversation
 * view tab (right of Trajectory, order 15) and the `data-agent` dictionaries.
 * Connection state lives in the server-side connection store, so tab switches
 * never lose it — the view only mirrors what `/plugins/data-agent/status`
 * reports.
 * @module @deepseek-ai/dsh-data-agent/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation view-slot declaration and the session
// standard props (sessionId) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { DatabaseView, type SessionListLike } from './DatabaseView.tsx'
import { NS, en, zh, type DataAgentKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The database tab copy. */
    'data-agent': DataAgentKey
  }
}

/** Required services: the locale service, the slot registry, and the sessions list. */
export const inject = ['slots', 'locale', 'sessions']

/**
 * Client plugin body: register the data-agent dictionaries and the database
 * conversation-view tab. The registration rides the slot service's effect
 * wrapper, so plugin unload removes the tab.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'data-agent: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.inject(['slots', 'locale', 'sessions'], (scope: ClientContext) => {
    const list = scope.sessions.list
    // The sessions list is the agent-preset authority on the client: the
    // ui-agent-preset surface records `agentPreset` onto each session summary.
    const sessionsSource = {
      getSnapshot: (): SessionListLike => list.getSnapshot() as unknown as SessionListLike,
      subscribe: (fn: () => void): (() => void) => list.subscribe(fn),
    }
    scope.slots.inject('conversation.view', () => scope.slots.register({
      name: 'conversation.view',
      // order 15 places the tab right of Trajectory (order 10) and left of
      // gomoku (order 20).
      id: 'data-agent',
      order: 15,
      label: () => t('tab.label'),
      locale: NS,
      inject: () => ({ hooks: { sessions: sessionsSource } }),
    }, DatabaseView))
  })
}
