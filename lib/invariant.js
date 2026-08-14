//#region src/invariant.ts
const PACKAGE_NAME = "@yejiming/dsh-data-agent";
/** Cordis companion plugin name. */
const name = "data-agent-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the connection store's session→connection mapping is
* a plain in-memory Map owned entirely by this package, every wire input is
* validated at the HTTP boundary, and the security invariants (password
* stripping, session isolation, sqlite-only-for-sqlite) are asserted by this
* package's unit tests.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
