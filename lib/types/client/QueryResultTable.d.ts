import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
export interface StructuredWorkbenchResult {
    kind: 'table';
    columns: string[];
    rows: Record<string, string | null>[];
    elapsedMs: number;
    truncated: boolean;
    maxRows: number;
}
export declare function QueryResultTable({ result, t, }: {
    result: StructuredWorkbenchResult;
    t: TranslateNS<'data-agent'>;
}): import("react").JSX.Element;
