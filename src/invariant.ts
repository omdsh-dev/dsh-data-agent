/**
 * Package-owned invariant companion for `@yejiming/dsh-data-agent`.
 * @module @yejiming/dsh-data-agent/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@yejiming/dsh-data-agent'

/** Cordis companion plugin name. */
export const name = 'data-agent-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the connection store's session→connection mapping is
 * a plain in-memory Map owned entirely by this package, every wire input is
 * validated at the HTTP boundary, and the security invariants (password
 * stripping, session isolation, sqlite-only-for-sqlite) are asserted by this
 * package's unit tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
