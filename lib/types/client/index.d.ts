/**
 * Data Agent browser half, plugin entry: registers the database workbench
 * as a compact context-row control for data-agent sessions, and the
 * `data-agent` dictionaries. The workbench itself opens in one Modal.
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
 * workbench trigger into the composer card's right control region. The registration rides the slot
 * service's effect wrapper, so plugin unload removes it.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
