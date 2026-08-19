/**
 * Community v0.15 host facet.
 *
 * This facet intentionally publishes no commands, tools, UI, routes, storage,
 * credentials, or database effects. The existing Cordis bundle remains the
 * sole functional runtime so hosts may discover the ecosystem declaration
 * without double-registering data-agent behavior.
 */

import { defineFacet, type FacetProjection } from '@dsh-std/sdk'

/** Stable degraded snapshot for declaration-only ecosystem discovery. */
export const ECOSYSTEM_SNAPSHOT: FacetProjection = Object.freeze({
  state: 'degraded',
  message: 'Native Cordis runtime owns all data-agent effects; this facet publishes declarations only.',
  extensions: Object.freeze([]),
})

const ecosystemFacet = defineFacet(
  () => undefined,
  () => undefined,
  () => ECOSYSTEM_SNAPSHOT,
)

export default ecosystemFacet
