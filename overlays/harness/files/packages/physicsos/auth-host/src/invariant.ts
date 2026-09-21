/**
 * Package-owned durable invariants for `physicsos_auth`.
 *
 * Two relations keep the identity graph honest: every session must point at
 * an existing user in its own school (the `(schoolId, username)` key pair on
 * the session row rebuilds the user key), and every user must point at an
 * existing school. A violation means a write landed outside AuthService.
 * @module @deepseek-ai/dsh-auth-host/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {
  AuditEvent, SchoolRequestRecord, SessionRecord, UserRecord,
} from './domain.ts'
import { userKey } from './domain.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-auth-host'
const DOMAIN = 'physicsos_auth'

/** Cordis companion plugin name. */
export const name = 'auth-host-invariant'
/** Services required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Re-check the durable relations after each change lands. */
const check = (ctx: Context, change: DomainChanged, fail: InvariantFailure): void => {
  if (change.domain !== DOMAIN) return
  const domain = ctx.storageDomain.get(DOMAIN)
  if (domain === undefined) return

  if (change.table === 'sessions' && change.operation === 'put') {
    const session = change.value as SessionRecord
    const user = domain.table('users').get(userKey(session.schoolId, session.username)) as UserRecord | undefined
    if (user === undefined) {
      fail(`session '${session.id}' references missing user '${session.schoolId}/${session.username}'`)
    } else if (user.id !== session.userId) {
      fail(`session '${session.id}' userId '${session.userId}' mismatches user row '${user.id}'`)
    }
    return
  }

  if (change.table === 'users' && change.operation === 'put') {
    const user = change.value as UserRecord
    if (domain.table('schools').get(user.schoolId) === undefined) {
      fail(`user '${user.id}' references missing school '${user.schoolId}'`)
    }
    return
  }

  if (change.table === 'school_requests' && change.operation === 'put') {
    const request = change.value as SchoolRequestRecord
    if (request.requestedBy !== null
      && domain.table('users').get(request.requestedBy) === undefined) {
      fail(`school request '${request.id}' references missing requester '${request.requestedBy}'`)
    }
    return
  }

  if (change.table === 'admin_audit' && change.operation === 'put') {
    const event = change.value as AuditEvent
    if (domain.table('users').get(event.actorKey) === undefined) {
      fail(`audit event '${event.id}' references missing actor '${event.actorKey}'`)
    }
  }
}

/** Install the relation checks on every domain change; the child fiber waits for storageDomain. */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: InvariantFailure) => {
    ctx.on('domain/changed', (change: DomainChanged) => { check(ctx, change, fail) })
  },
  { inject: ['storageDomain'] },
)

/**
 * Register the auth-domain invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
