/**
 * Optional dsh-tui presentation adapter for Catalog progress and read-only
 * browsing. It only consumes the public `tuiStatus`/`tuiScenes` service
 * shapes and deliberately has no runtime import from dsh-tui or React.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CatalogCommandPresentation } from './catalog-command.ts';
import type { CatalogAssetDetail, CatalogRun } from './catalog-types.ts';
export interface CatalogTuiAdapter extends CatalogCommandPresentation {
    dispose(): void;
}
/** Create an adapter only from public optional services exposed by dsh-tui. */
export declare function createCatalogTuiAdapter(ctx: Context): CatalogTuiAdapter;
/** One bounded status-line projection shared by the adapter and tests. */
export declare function formatCatalogTuiStatus(run: CatalogRun): string;
export declare function isCatalogRunSettled(run: CatalogRun): boolean;
/** Text projection for the independently scrollable right pane. */
export declare function buildCatalogTuiDetailLines(detail: CatalogAssetDetail): string[];
