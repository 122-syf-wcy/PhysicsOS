/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-storage-postgres`.
 * @module @deepseek-ai/dsh-storage-postgres/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-storage-postgres'

/** Cordis companion plugin name. */
export const name = 'storage-postgres-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: schema and unit-version consistency are checked at
 * open time, while durability and malformed-medium behavior are covered by
 * the shared KV contract suite against a real PostgreSQL server.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
