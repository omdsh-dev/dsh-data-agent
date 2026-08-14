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
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type DataAgentKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** The database workbench copy. */
        'data-agent': DataAgentKey;
    }
}
/** Required services: the locale service, the slot registry, and the sessions list. */
export declare const inject: string[];
/**
 * Client plugin body: register the data-agent dictionaries and the database
 * workbench into the composer input dock. The registration rides the slot
 * service's effect wrapper, so plugin unload removes it.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
