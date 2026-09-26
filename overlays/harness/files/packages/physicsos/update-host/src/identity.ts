/**
 * Identity contract for the 更新通道 host.
 *
 * Same contract as `paper-host` / `notice-host`, and again deliberately NOT a
 * shared import: these hosts are independent workspace members, they are
 * declared BEFORE auth-host in the composition row, and a dependency edge
 * between them would make that load order impossible to reproduce in a test.
 * The composition spec holds them together instead.
 *
 * 读 `latest.json` 是**公开**的(Tauri 的 updater 在客户端里发这个请求,没有
 * cookie),所以这个 host 的 identity 只用于**写**:发布 / 撤回 / 回滚。这是一条
 * 与其它 host 相反的规则,写进这里免得下一个接手的人以为漏了闸门 —— 公开读一个
 * 「有哪些版本、签名是什么」的清单没有风险,而那些签名本来就是给所有人验的。
 */
import type { IncomingMessage } from 'node:http'

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

/** Role ceiling order, mirrored from the auth host's own ranking. */
const RANK: Record<IdentityRole, number> = {
  STUDENT: 0,
  TEACHER: 1,
  SCHOOL_ADMIN: 2,
  SUPER_ADMIN: 3,
}

/**
 * `atLeast('TEACHER')` — is this role at or above the given floor?
 *
 * The comparison table is spelled out here rather than imported: a string
 * comparison would put `SCHOOL_ADMIN` below `STUDENT` alphabetically, which is
 * exactly the kind of bug that lets a student publish a release.
 * @param role - the actor's role.
 * @param floor - the minimum role that still passes.
 * @returns whether `role` ranks at or above `floor`.
 */
export const atLeast = (role: IdentityRole, floor: IdentityRole): boolean =>
  RANK[role] >= RANK[floor]

/** Public error vocabulary — the only failure shape the wire exposes. */
export class UpdateError extends Error {
  constructor(
    readonly status: number,
    readonly code:
      | 'BAD_REQUEST' | 'UNAUTHENTICATED' | 'FORBIDDEN'
      | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE',
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'UpdateError'
  }
}

/**
 * Resolve the identity service lazily, per request.
 *
 * Returns `undefined` rather than throwing when it is absent: this host is
 * declared before auth-host, so at LOAD time the service genuinely does not
 * exist yet. The route layer turns a missing service into a 503 on write
 * rather than failing open — the alternative is a deployment where releases
 * can be published anonymously because a wire came loose.
 *
 * Read through `ctx.get` rather than a property access, because that is the
 * only shape cordis exposes to a plugin that does not `inject` the service —
 * same as paper / notice, so all three guards answer the same way.
 * @param ctx - plugin context that may carry the identity service.
 * @returns the service, or undefined while auth-host has not loaded.
 */
export const identityOf = (ctx: { get: (name: string) => unknown }): PhysicsosIdentity | undefined => {
  const service = ctx.get(IDENTITY_SERVICE)
  return service === undefined ? undefined : service as PhysicsosIdentity
}
