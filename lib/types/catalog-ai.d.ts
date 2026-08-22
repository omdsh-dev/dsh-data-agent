/** DSH-native AI enrichment for table and field business-meaning candidates. */
import type { AgentRegistry } from '@deepseek-ai/dsh-agent';
import { type LlmCallConfig, type LlmRuntime } from '@deepseek-ai/dsh-llm';
export interface CatalogModelSelection {
    provider: string;
    model: string;
    reasoningEffort?: LlmCallConfig['reasoningEffort'];
}
export interface CatalogMeaningFieldInput {
    assetId: string;
    name: string;
    dataType?: string;
    nullable?: boolean;
    comment?: string;
    keyKinds: string[];
}
export interface CatalogMeaningTableInput {
    assetId: string;
    schema: string;
    name: string;
    objectType: 'table' | 'view';
    comment?: string;
    fields: CatalogMeaningFieldInput[];
    relations: Array<{
        kind: string;
        name?: string;
        fromAssetId: string;
        toAssetId?: string;
        columnAssetIds: string[];
        referencedColumnAssetIds?: string[];
    }>;
}
export interface CatalogMeaningModelResult {
    table: {
        assetId: string;
        meaning: string;
    };
    fields: Array<{
        assetId: string;
        meaning: string;
    }>;
}
export interface CatalogMeaningGenerator {
    capture(sessionId: string): CatalogModelSelection;
    generate(selection: CatalogModelSelection, input: CatalogMeaningTableInput, signal: AbortSignal): Promise<CatalogMeaningModelResult>;
}
/** Resolve the exact current session model once, then use the host's configured LLM adapters and credentials. */
export declare function createDshCatalogMeaningGenerator(agents: AgentRegistry, llm: LlmRuntime): CatalogMeaningGenerator;
export declare function validateModelResult(raw: string, input: CatalogMeaningTableInput): CatalogMeaningModelResult;
