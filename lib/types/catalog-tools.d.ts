/** Read-only Catalog model tools. No scan or review service is injected here. */
import type { Context } from '@deepseek-ai/cordis';
import { type JsonValue } from '@deepseek-ai/dsh-tools';
export declare function applyCatalogTools(ctx: Context): void;
export declare function sanitizeToolValue(value: unknown): JsonValue;
