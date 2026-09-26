/**
 * Identity verification for the model-pool console.
 *
 * The pool is deployment-wide infrastructure — one channel list serves the
 * whole platform — so every route, reads included, is SUPER_ADMIN. A missing
 * identity service refuses with 503 rather than failing open.
 *
 * Same contract as the notice/ops hosts, and deliberately not a shared import:
 * those hosts are independent workspace members, and the load-order tie (this
 * host is declared BEFORE auth-host) is reproduced by the composition spec
 * instead of a dependency edge.
 */
import type { IncomingMessage } from 'node:http'
import { PoolError } from './errors.ts'

/** Service key `auth-host` publishes the session identity seam under. */
export const IDENTITY_SERVICE = 'physicsosIdentity'

/** Account roles in ascending privilege order. */
export type IdentityRole = 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN' | 'SUPER_ADMIN'

/** The signed-in account resolved from a session cookie. */
export interface IdentityActor {
  readonly userKey: string
  readonly schoolId: string
  readonly username: string
  readonly role: IdentityRole
}

/** The seam auth-host exposes to sibling hosts. */
export interface PhysicsosIdentity {
  actorOf(req: IncomingMessage): IdentityActor | null
  record(
    actor: IdentityActor,
    action: string,
    target: string,
    detail?: Record<string, unknown>,
  ): Promise<void>
}

/**
 * Resolve and check the acting account.
 * @param identity - the resolved service, or undefined when not mounted.
 * @param req - the incoming request carrying the session cookie.
 * @returns the acting SUPER_ADMIN.
 */
export const requireSuperAdmin = (
  identity: PhysicsosIdentity | undefined,
  req: IncomingMessage,
): IdentityActor => {
  if (identity === undefined) {
    throw new PoolError(503, 'IDENTITY_UNAVAILABLE', '身份服务未挂载')
  }
  const actor = identity.actorOf(req)
  if (actor === null) {
    throw new PoolError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
  }
  if (actor.role !== 'SUPER_ADMIN') {
    throw new PoolError(403, 'FORBIDDEN', '模型通道是平台级配置，仅超级管理员可管理')
  }
  return actor
}

/**
 * Lazily look up the identity service: called per request to break the
 * load-order tie with auth-host.
 * @param ctx - the registrant context's service store.
 * @returns the seam when auth-host has published it, else `undefined`.
 */
export const identityOf = (
  ctx: { get: (name: string) => unknown },
): PhysicsosIdentity | undefined => {
  const service = ctx.get(IDENTITY_SERVICE)
  return service === undefined ? undefined : service as PhysicsosIdentity
}
