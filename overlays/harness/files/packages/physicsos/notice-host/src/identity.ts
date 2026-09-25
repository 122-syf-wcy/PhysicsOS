/**
 * Identity verification and role-based access control for 反馈与公告.
 *
 * Same contract as `paper-host/src/identity.ts`, and deliberately NOT a shared
 * import: the two hosts are independent workspace members, and a dependency
 * edge between them would make the load-order tie (paper/notice are declared
 * BEFORE auth-host) impossible to reproduce in a test. They are held together
 * by the composition spec, which wires the hosts and asserts the guard answers.
 *
 * The rules differ from the paper host in exactly one place, because 反馈 is
 * meant to be reachable by the people who have the bug reports:
 *
 *   - reading feedback: TEACHER and above (a student sees their own back —
 *     handled in the service, not here, because that is a row filter rather
 *     than a door).
 *   - writing feedback: ANY signed-in account.
 *   - announcements: reading needs a session, writing needs SCHOOL_ADMIN.
 *
 * A missing identity service refuses everything with 503 rather than failing
 * open — the alternative is a deployment where the gate silently is not there.
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

/** The failure envelope this host answers with, shaped like the paper host's. */
export class NoticeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'NoticeError'
  }
}

const RANK: Record<IdentityRole, number> = {
  STUDENT: 0, TEACHER: 1, SCHOOL_ADMIN: 2, SUPER_ADMIN: 3,
}

/** True when `role` is at least `floor`. */
export const atLeast = (role: IdentityRole, floor: IdentityRole): boolean =>
  RANK[role] >= RANK[floor]

export interface GuardResult {
  readonly actor: IdentityActor
  /** Whether this request mutates state — the caller audits those only. */
  readonly writes: boolean
}

/**
 * The single door every notice route passes through.
 * @param identity - the resolved service, or undefined when not mounted.
 * @param req - the incoming request carrying the session cookie.
 * @param floor - minimum role for MUTATING methods; reads need only a session.
 * @returns the acting account, or throws the refusal to send.
 */
export const guard = (
  identity: PhysicsosIdentity | undefined,
  req: IncomingMessage,
  floor: IdentityRole,
): GuardResult => {
  if (identity === undefined) {
    throw new NoticeError(503, 'IDENTITY_UNAVAILABLE', 'Identity service is not mounted.')
  }
  const actor = identity.actorOf(req)
  if (actor === null) {
    throw new NoticeError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
  }
  const writes = req.method !== 'GET' && req.method !== undefined
  if (writes && !atLeast(actor.role, floor)) {
    throw new NoticeError(403, 'FORBIDDEN', '当前角色无权执行该操作')
  }
  return { actor, writes }
}

/**
 * Append a successful write to the shared ledger.
 *
 * Fire-and-forget: `finish` fires after the response is on the wire, and a
 * ledger write that failed must not retroactively fail the action it recorded.
 * Refused requests (>= 400) are not events — a trail that logged attempts
 * would make "who changed the bank" unreadable.
 */
export const auditWrites = async (
  ledger: PhysicsosIdentity,
  actor: IdentityActor,
  req: IncomingMessage,
  statusCode: number,
  path: string,
): Promise<void> => {
  if (req.method === undefined || req.method === 'GET') return
  if (statusCode >= 400) return
  await ledger.record(actor, `notice.${req.method.toLowerCase()}`, path, { status: statusCode })
}

/** Lazily look up the identity service: called per request to break load-order ties. */
export const identityOf = (
  ctx: { get: (name: string) => unknown },
): PhysicsosIdentity | undefined => {
  const service = ctx.get(IDENTITY_SERVICE)
  return service === undefined ? undefined : service as PhysicsosIdentity
}
