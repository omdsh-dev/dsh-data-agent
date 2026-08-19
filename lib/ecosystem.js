import { defineFacet } from "@dsh-std/sdk";
//#region src/ecosystem.ts
/**
* Community v0.15 host facet.
*
* This facet intentionally publishes no commands, tools, UI, routes, storage,
* credentials, or database effects. The existing Cordis bundle remains the
* sole functional runtime so hosts may discover the ecosystem declaration
* without double-registering data-agent behavior.
*/
/** Stable degraded snapshot for declaration-only ecosystem discovery. */
const ECOSYSTEM_SNAPSHOT = Object.freeze({
	state: "degraded",
	message: "Native Cordis runtime owns all data-agent effects; this facet publishes declarations only.",
	extensions: Object.freeze([])
});
const ecosystemFacet = defineFacet(() => void 0, () => void 0, () => ECOSYSTEM_SNAPSHOT);
//#endregion
export { ECOSYSTEM_SNAPSHOT, ecosystemFacet as default };
