/**
 * Package-owned invariant for `@deepseek-ai/dsh-mobile-host`.
 *
 * This host owns no storage table, so it has nothing to check. It still ships
 * the `./invariant` face every PhysicsOS host exports: the boot loader
 * composes the invariant plugin for each host in the chain, and a missing
 * module would abort the profile rather than report a rule violation.
 *
 * @module @deepseek-ai/dsh-mobile-host/invariant
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'mobile-host-invariant'

/** No invariant inputs are required: the host persists nothing. */
export const inject: readonly string[] = []

/**
 * Register nothing; present so the profile's invariant pass stays uniform.
 * @param _ctx - plugin context (unused).
 */
export function apply(_ctx: Context): void {
  // Intentionally empty: no durable rows are owned here.
}
