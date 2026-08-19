/**
 * Community v0.15 host facet.
 *
 * This facet intentionally publishes no commands, tools, UI, routes, storage,
 * credentials, or database effects. The existing Cordis bundle remains the
 * sole functional runtime so hosts may discover the ecosystem declaration
 * without double-registering data-agent behavior.
 */
import { type FacetProjection } from '@dsh-std/sdk';
/** Stable degraded snapshot for declaration-only ecosystem discovery. */
export declare const ECOSYSTEM_SNAPSHOT: FacetProjection;
declare const ecosystemFacet: import("@dsh-std/sdk").FacetModule;
export default ecosystemFacet;
