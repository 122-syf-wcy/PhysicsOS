/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-physicsos`.
 * @module @deepseek-ai/dsh-tool-physicsos/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-physicsos'

/** Cordis companion plugin name. */
export const name = 'tool-physicsos-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No durable-log invariant: the plugin appends no session events of its own.
 * Physics truth lives in the PhysicsScene EventStore behind
 * `@physicsos/agent-tools` (docs/04 §131), and every tool result is validated
 * by the tool registry against the declared output schema.
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
