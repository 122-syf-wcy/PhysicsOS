/**
 * @deepseek-ai/dsh-account-sync-host — the independently enableable account
 * synchronization/export plugin.
 *
 * It publishes exactly one service, `physicsosMobilePersonalExports`. Its
 * sections read the auth-owned immutable account scope, learning-host's
 * personal-data exports, and durable Harness Sessions. It does not publish or
 * require `physicsosAccountErasure`, attachment reference admission, deletion
 * fences, or a session-query index. Account erasure remains a separate,
 * optional extension plugin.
 *
 * @module @deepseek-ai/dsh-account-sync-host
 */

import type { Context } from '@deepseek-ai/cordis'
import { createPersonalExports, PERSONAL_EXPORTS_SERVICE } from './exports.ts'

export { createPersonalExports, PERSONAL_EXPORTS_SERVICE } from './exports.ts'
export type { ExportActor, PersonalExportSection } from './exports.ts'

/** Stable Cordis plugin name. */
export const name = 'account-sync-host'

/** No hard dependency: every service is resolved per export so boot order never matters. */
export const inject: readonly string[] = []

/** The single service this plugin publishes. */
export const PUBLISHES = Object.freeze([PERSONAL_EXPORTS_SERVICE] as const)

/**
 * Publish the personal-export facade.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.provide(PERSONAL_EXPORTS_SERVICE, createPersonalExports(service => ctx.get(service)))
}
