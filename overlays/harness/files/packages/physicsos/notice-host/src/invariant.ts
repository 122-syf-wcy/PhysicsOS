/**
 * Package-owned durable invariants for `physicsos_notice`.
 *
 * One relation, and it is the one that would otherwise go unnoticed: an
 * announcement's `schoolId` is either null or a string, and a row carrying an
 * empty string would be a notice addressed to a tenant named "" — served to
 * nobody, visible in the console, impossible to explain. Same for a feedback
 * row whose author key lost its school prefix.
 * @module @deepseek-ai/dsh-notice-host/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-notice-host'
const DOMAIN = 'physicsos_notice'

/** Cordis companion plugin name. */
export const name = 'notice-host-invariant'
/**
 * Services required before the companion can reserve package ownership.
 *
 * `invariants` ONLY, matching every other package's companion — and for the
 * reason `paper-host/src/invariant.ts` records at length: a companion is
 * mounted inside the invariant startup barrier, so one that waits for a
 * Loader-managed service deadlocks the whole chain.
 */
export const inject = ['invariants']

/** Re-check the durable relations after each change lands. */
const check = (_ctx: Context, change: DomainChanged, fail: InvariantFailure): void => {
  if (change.domain !== DOMAIN) return

  if (change.table === 'announcements' && change.operation === 'put') {
    const row = change.value as { id?: string; schoolId?: unknown }
    if (row.schoolId === '') fail(`announcement '${row.id}' carries an empty schoolId`)
    if (row.schoolId !== null && typeof row.schoolId !== 'string') {
      fail(`announcement '${row.id}' schoolId is neither null nor a string`)
    }
    return
  }

  if (change.table === 'feedback' && change.operation === 'put') {
    const row = change.value as { id?: string; authorKey?: string; schoolId?: string }
    if (row.authorKey === undefined || !row.authorKey.startsWith(`${row.schoolId ?? ''}:`)) {
      fail(`feedback '${row.id}' authorKey does not belong to its school`)
    }
  }
}

/** Install the relation checks on every domain change. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('domain/changed', (change) => { check(ctx, change, fail) })
}

/**
 * Register the notice-domain invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
