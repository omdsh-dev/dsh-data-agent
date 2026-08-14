/**
 * Data Agent browser half, plugin entry: registers the database workbench
 * into the composer input dock (the strip ABOVE the input bar) for
 * data-agent sessions, and the `data-agent` dictionaries. The old
 * conversation-view tab is gone — the workbench lives inside the session.
 * Connection state lives in the server-side connection store, so layout and
 * session switches never lose it — the view only mirrors what
 * `/plugins/data-agent/status` reports.
 * @module @yejiming/dsh-data-agent/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation slot declarations (conversation.input.dock)
// and the session standard props (sessionId) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { DataAgentWorkbench, type SessionListLike } from './DataAgentWorkbench.tsx'
import { NS, en, zh, type DataAgentKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The database workbench copy. */
    'data-agent': DataAgentKey
  }
}

/** Required services: the locale service, the slot registry, and the sessions list. */
export const inject = ['slots', 'locale', 'sessions']

/**
 * Client plugin body: register the data-agent dictionaries and the database
 * workbench into the composer input dock. The registration rides the slot
 * service's effect wrapper, so plugin unload removes it.
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
    // The workbench strip sits above the input bar (order 0, first entry);
    // it renders only for data-agent sessions and returns null elsewhere.
    scope.slots.inject('conversation.input.dock', () => scope.slots.register({
      name: 'conversation.input.dock',
      id: 'data-agent',
      order: 0,
      locale: NS,
      inject: () => ({ hooks: { sessions: sessionsSource } }),
    }, DataAgentWorkbench))
  })
}
