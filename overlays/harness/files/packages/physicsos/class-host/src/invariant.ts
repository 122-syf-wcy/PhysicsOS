/**
 * Package-owned durable invariants for `physicsos_class`.
 *
 * The relations are the tenant boundaries that must survive every future
 * writer: a member's and a submission's userKey must belong to the row's
 * school, and an assignment target is always paper or experiment.
 * @module @deepseek-ai/dsh-class-host/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-class-host'
const DOMAIN = 'physicsos_class'

export const name = 'class-host-invariant'
export const inject = ['invariants']

const check = (_ctx: Context, change: DomainChanged, fail: InvariantFailure): void => {
  if (change.domain !== DOMAIN || change.operation !== 'put') return

  if (change.table === 'memberships') {
    const row = change.value as { id?: string; schoolId?: string; userKey?: string }
    if (!row.userKey?.startsWith(`${row.schoolId ?? ''}:`)) {
      fail(`membership '${row.id}' userKey does not belong to its school`)
    }
    return
  }

  if (change.table === 'submissions') {
    const row = change.value as {
      id?: string
      schoolId?: string
      studentKey?: string
      review?: { status?: string }
    }
    if (!row.studentKey?.startsWith(`${row.schoolId ?? ''}:`)) {
      fail(`submission '${row.id}' studentKey does not belong to its school`)
    }
    if (
      row.review !== undefined &&
      row.review.status !== 'accepted' &&
      row.review.status !== 'returned'
    )
      fail(`submission '${row.id}' carries an unknown review status`)
    return
  }

  if (change.table === 'assignments') {
    const row = change.value as { id?: string; target?: { kind?: string } }
    if (row.target?.kind !== 'paper' && row.target?.kind !== 'experiment') {
      fail(`assignment '${row.id}' target is not paper or experiment`)
    }
  }
}

const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('domain/changed', (change) => {
    check(ctx, change, fail)
  })
}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
