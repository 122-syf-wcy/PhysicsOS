/**
 * Package-owned durable relations for `physicsos_learning`.
 *
 * The one relation worth pinning is tenant ownership: every personal row's
 * `userKey` must begin with its `schoolId`. Pagination and access checks rely
 * on that prefix, so a malformed row is rejected at the durable boundary.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-learning-host'
const DOMAIN = 'physicsos_learning'

export const name = 'learning-host-invariant'
export const inject = ['invariants']

const check = (_ctx: Context, change: DomainChanged, fail: InvariantFailure): void => {
  if (change.domain !== DOMAIN || change.operation !== 'put') return
  if (change.table !== 'attempts' && change.table !== 'saved_scenes') return
  const row = change.value as { id?: string; sceneId?: string; userKey?: string; schoolId?: string }
  const rowId = change.table === 'attempts' ? row.id : row.sceneId
  if (row.userKey === undefined || !row.userKey.startsWith(`${row.schoolId ?? ''}:`)) {
    fail(`${change.table} '${rowId ?? '?'}' userKey does not belong to its school`)
  }
}

const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('domain/changed', (change) => {
    check(ctx, change, fail)
  })
}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
