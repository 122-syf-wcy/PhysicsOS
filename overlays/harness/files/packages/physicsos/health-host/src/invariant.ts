/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-health-host`.
 *
 * The health host owns no durable medium: `/healthz` and `/readyz` re-read the
 * process and its configured dependency probes on every request and store
 * nothing between them. There is therefore no write boundary to check; this
 * companion exists so the package joins the repository's invariant topology
 * and so a future durable addition has a declared home.
 * @module @deepseek-ai/dsh-health-host/invariant
 */

/* jscpd:ignore-start */
const PACKAGE_NAME = '@deepseek-ai/dsh-health-host'

/** Cordis companion plugin name. */
export const name = 'health-host-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Structural view of the invariant service — the same shape `src/index.ts`
 * uses for the web server, so this package stays dependency-free.
 */
interface InvariantContext {
  readonly invariants: {
    register(
      packageName: string,
      install: (ctx: unknown, fail: (message: string) => void) => void,
    ): () => void
  }
}

/** No runtime invariant: this host holds no state across requests. */
const install = (): void => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: InvariantContext): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
