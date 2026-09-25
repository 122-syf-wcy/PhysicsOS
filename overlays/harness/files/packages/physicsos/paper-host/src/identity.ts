/**
 * Identity verification and role-based access control.
 *
 * This module asks the `physicsosIdentity` service (provided by auth-host) WHO
 * is calling. It enforces the rule that read routes require a valid session,
 * and write routes require at least TEACHER privileges.
 *
 * The two packages are decoupled: if `physicsosIdentity` is missing (e.g. in a
 * standalone composition), `guard` refuses everything with 503 rather than
 * failing open.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { PaperError } from './service.ts'

export const IDENTITY_SERVICE = 'physicsosIdentity'

export interface IdentityActor {
  readonly userKey: string
  readonly schoolId: string
  readonly username: string
  readonly role: IdentityRole
}

/**
 * The four roles the 账户体系 can mint — spelled once, here.
 *
 * A consumer that needs to iterate the roles (a guard table, a spec that walks
 * every privileged role) names this union rather than re-typing four string
 * literals, which is how a fifth role gets forgotten in exactly one place.
 */
export type IdentityRole = 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN' | 'SUPER_ADMIN'

export interface PhysicsosIdentity {
  actorOf(req: IncomingMessage): IdentityActor | null
  record(
    actor: IdentityActor,
    action: string,
    target: string,
    detail?: Record<string, unknown>,
  ): Promise<void>
}

export const guard = (
  identity: PhysicsosIdentity | undefined,
  req: IncomingMessage,
  method: string,
): { actor: IdentityActor; writes: boolean } => {
  if (identity === undefined) {
    throw new PaperError(503, 'IDENTITY_UNAVAILABLE', 'Identity service is not mounted.')
  }

  const actor = identity.actorOf(req)
  if (actor === null) {
    throw new PaperError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
  }

  const writes = method !== 'GET'
  if (writes && actor.role === 'STUDENT') {
    throw new PaperError(403, 'FORBIDDEN', '只有教师及以上角色可以修改题库与试卷')
  }

  return { actor, writes }
}

export const auditWrites = async (
  ledger: PhysicsosIdentity,
  actor: IdentityActor,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<void> => {
  if (req.method === 'GET' || req.method === undefined) return
  /* The trail records what HAPPENED. A 400 is a refused request, not an event,
     and a ledger that logged attempts would make the history unreadable. */
  if (res.statusCode >= 400) return
  await ledger.record(actor, `paper.${req.method.toLowerCase()}`, path, {
    status: res.statusCode,
  })
}

/** Lazily look up the identity service: called per request to break load-order ties. */
export const identityOf = (ctx: { get: (name: string) => unknown }): PhysicsosIdentity | undefined => {
  const service = ctx.get(IDENTITY_SERVICE)
  return service === undefined ? undefined : service as PhysicsosIdentity
}
