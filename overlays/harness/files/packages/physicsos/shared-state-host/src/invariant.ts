/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-shared-state-host`.
 *
 * Rate-limit buckets and one-time claims are ephemeral runtime state bounded by
 * their configured TTLs. Redis owns the durable representation when configured,
 * so this host has no storage-domain write boundary to validate.
 * @module @deepseek-ai/dsh-shared-state-host/invariant
 */

const PACKAGE_NAME = '@deepseek-ai/dsh-shared-state-host'

/** Cordis companion plugin name. */
export const name = 'shared-state-host-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

interface InvariantContext {
  readonly invariants: {
    register(
      packageName: string,
      install: (ctx: unknown, fail: (message: string) => void) => void,
    ): () => void
  }
}

/** No durable invariant: every value is TTL-scoped and not reconstructed here. */
const install = (): void => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: InvariantContext): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
