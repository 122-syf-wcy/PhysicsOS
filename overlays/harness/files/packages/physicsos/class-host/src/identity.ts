/**
 * Identity verification and class-workflow access control.
 *
 * Consumers copy the `physicsosIdentity` contract instead of importing
 * auth-host, preserving independent package ownership and allowing this host
 * to load before the identity provider.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

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

export class ClassError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ClassError'
  }
}

const RANK: Record<IdentityRole, number> = {
  STUDENT: 0,
  TEACHER: 1,
  SCHOOL_ADMIN: 2,
  SUPER_ADMIN: 3,
}

export const atLeast = (role: IdentityRole, floor: IdentityRole): boolean =>
  RANK[role] >= RANK[floor]

export const guard = (
  identity: PhysicsosIdentity | undefined,
  req: IncomingMessage,
  floor: IdentityRole,
): { actor: IdentityActor; writes: boolean } => {
  if (identity === undefined) {
    throw new ClassError(503, 'IDENTITY_UNAVAILABLE', 'Identity service is not mounted.')
  }
  const actor = identity.actorOf(req)
  if (actor === null) {
    throw new ClassError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
  }
  const writes = req.method !== undefined && req.method !== 'GET'
  if (writes && !atLeast(actor.role, floor)) {
    throw new ClassError(403, 'FORBIDDEN', '当前角色无权执行该操作')
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
  if (req.method === undefined || req.method === 'GET' || res.statusCode >= 400) return
  await ledger.record(actor, `class.${req.method.toLowerCase()}`, path, {
    status: res.statusCode,
  })
}

export const identityOf = (ctx: {
  get: (name: string) => unknown
}): PhysicsosIdentity | undefined => {
  const service = ctx.get(IDENTITY_SERVICE)
  return service === undefined ? undefined : (service as PhysicsosIdentity)
}
