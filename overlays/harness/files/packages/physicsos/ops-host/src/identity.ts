/**
 * Lazy identity gate for the operations host.
 *
 * `ops-host` loads before `auth-host`, so the identity service is resolved on
 * every request. A missing service is a configuration failure, not permission
 * to expose operational metadata.
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

export class OpsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'OpsError'
  }
}

export const identityOf = (ctx: {
  get: (name: string) => unknown
}): PhysicsosIdentity | undefined => {
  const service = ctx.get(IDENTITY_SERVICE)
  return service === undefined ? undefined : (service as PhysicsosIdentity)
}

export const requireSuperAdmin = (
  identity: PhysicsosIdentity | undefined,
  req: IncomingMessage,
): IdentityActor => {
  if (identity === undefined) {
    throw new OpsError(503, 'IDENTITY_UNAVAILABLE', '身份服务尚未就绪')
  }
  const actor = identity.actorOf(req)
  if (actor === null) {
    throw new OpsError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
  }
  if (actor.role !== 'SUPER_ADMIN') {
    throw new OpsError(403, 'FORBIDDEN', '只有平台管理员可以查看运维指标')
  }
  return actor
}
