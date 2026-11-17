/**
 * Session identity gate for personal learning sync.
 *
 * The identity service is resolved lazily because this plugin is declared
 * before auth-host in the shipped chain. Missing identity refuses every route
 * with 503; a missing or invalid session refuses with 401. There is no role
 * override: even an administrator reads only their own personal learning rows.
 */

import type { IncomingMessage } from 'node:http'
import type { ActivityRoster } from './activity-types.ts'

export const IDENTITY_SERVICE = 'physicsosIdentity'

export type IdentityRole = 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN' | 'SUPER_ADMIN'

export interface IdentityActor {
  readonly userKey: string
  readonly schoolId: string
  readonly username: string
  readonly role: IdentityRole
}

export interface PhysicsosIdentity {
  actorOf(req: IncomingMessage): IdentityActor | null
  usageSessionOwner?(sessionId: string): { readonly schoolId: string; readonly userKey: string } | undefined
  usageOwnedSessions?(): readonly { readonly sessionId: string; readonly schoolId: string; readonly userKey: string }[]
  /** Minimal internal roster; authorization and tenant scope are still checked by the activity service. */
  activityRoster?(actor: IdentityActor): ActivityRoster
  record(
    actor: IdentityActor,
    action: string,
    target: string,
    detail?: Record<string, unknown>,
  ): Promise<void>
}

export class LearningError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'LearningError'
  }
}

export const identityOf = (ctx: {
  get: (name: string) => unknown
}): PhysicsosIdentity | undefined => {
  const service = ctx.get(IDENTITY_SERVICE)
  return service === undefined ? undefined : (service as PhysicsosIdentity)
}

/** Product browser writes never elevate a read-scoped bearer token to session authority. */
export const requireCookieActor = (identity: PhysicsosIdentity | undefined, req: IncomingMessage): IdentityActor => {
  if (req.headers.authorization !== undefined) throw new LearningError(403, 'COOKIE_ONLY', '此功能只接受当前浏览器登录会话，不接受访问令牌。')
  if (typeof req.headers.cookie !== 'string' || req.headers.cookie.trim() === '') throw new LearningError(401, 'UNAUTHENTICATED', '请先登录。')
  return requireActor(identity, req)
}

export const requireActor = (
  identity: PhysicsosIdentity | undefined,
  req: IncomingMessage,
): IdentityActor => {
  if (identity === undefined) {
    throw new LearningError(503, 'IDENTITY_UNAVAILABLE', 'Identity service is not mounted.')
  }
  const actor = identity.actorOf(req)
  if (actor === null) {
    throw new LearningError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
  }
  return actor
}
