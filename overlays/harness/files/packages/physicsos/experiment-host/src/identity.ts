/**
 * Identity verification for 实验贡献.
 *
 * Same contract as `notice-host/src/identity.ts`, and deliberately NOT a
 * shared import: the two hosts are independent workspace members, and a
 * dependency edge between them would make the load-order tie (experiment-host
 * is declared BEFORE auth-host) impossible to reproduce in a test. They are
 * held together by the composition spec.
 *
 * The rules:
 *
 *   - reading the package list: ANY signed-in account.
 *   - uploading a package: ANY signed-in account (contribution is the point;
 *     review is where quality is enforced).
 *   - publishing / rejecting / rolling back a package: SUPER_ADMIN only.
 *
 * A missing identity service refuses everything with 503 rather than failing
 * open — the alternative is a deployment where the gate silently is not there.
 */
import type { IncomingMessage } from 'node:http'
import type { ContractIssue } from './contract-v2.ts'

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

/**
 * The seam auth-host exposes to sibling hosts: resolve the acting account from
 * a request, and file an attributed audit row for a write.
 */
export interface PhysicsosIdentity {
  actorOf(req: IncomingMessage): IdentityActor | null
  record(
    actor: IdentityActor,
    action: string,
    target: string,
    detail?: Record<string, unknown>,
  ): Promise<void>
}

/** The failure envelope this host answers with, shaped like every other host's. */
export class ExperimentError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues?: ContractIssue[],
  ) {
    super(message)
    this.name = 'ExperimentError'
  }
}

const RANK: Record<IdentityRole, number> = {
  STUDENT: 0,
  TEACHER: 1,
  SCHOOL_ADMIN: 2,
  SUPER_ADMIN: 3,
}

/**
 * True when `role` is at least `floor`.
 * @param role - the actor's role.
 * @param floor - the minimum role that still passes.
 * @returns whether `role` ranks at or above `floor`.
 */
export const atLeast = (role: IdentityRole, floor: IdentityRole): boolean =>
  RANK[role] >= RANK[floor]

/** The outcome of resolving and checking a request's actor. */
export interface GuardResult {
  readonly actor: IdentityActor
  /** Whether this request mutates state — the caller audits those only. */
  readonly writes: boolean
}

/**
 * Resolve the actor and enforce the write floor.
 * @param identity - lazily resolved seam; undefined means the gate refuses.
 * @param req - the incoming request.
 * @param floor - minimum role for non-GET calls.
 * @returns the actor plus whether this call mutates.
 */
export const guard = (
  identity: PhysicsosIdentity | undefined,
  req: IncomingMessage,
  floor: IdentityRole,
): GuardResult => {
  if (identity === undefined) {
    throw new ExperimentError(503, 'IDENTITY_UNAVAILABLE', 'Identity service is not mounted.')
  }
  const actor = identity.actorOf(req)
  if (actor === null) {
    throw new ExperimentError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
  }
  const writes = req.method !== 'GET' && req.method !== undefined
  if (writes && !atLeast(actor.role, floor)) {
    throw new ExperimentError(403, 'FORBIDDEN', '当前角色无权执行该操作')
  }
  return { actor, writes }
}

/**
 * Append a successful write to the shared ledger.
 * @param ledger - the identity seam to record through.
 * @param actor - the acting account.
 * @param req - the request that mutated.
 * @param statusCode - the response status; failures are not audited here.
 * @param path - the request path, for the ledger row.
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
  await ledger.record(actor, `experiments.${req.method.toLowerCase()}`, path, {
    status: statusCode,
  })
}

/**
 * Lazily look up the identity service: called per request to break load-order ties.
 * @param ctx - the registrant context's service store.
 * @returns the seam when auth-host has published it, else `undefined`.
 */
export const identityOf = (ctx: {
  get: (name: string) => unknown
}): PhysicsosIdentity | undefined => {
  const service = ctx.get(IDENTITY_SERVICE)
  return service === undefined ? undefined : (service as PhysicsosIdentity)
}
