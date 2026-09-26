/**
 * Session identity gate for personal learning sync.
 *
 * The identity service is resolved lazily because this plugin is declared
 * before auth-host in the shipped chain. Missing identity refuses every route
 * with 503; a missing or invalid session refuses with 401. There is no role
 * override: even an administrator reads only their own personal learning rows.
 */

import type { IncomingMessage } from 'node:http'

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
