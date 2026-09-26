/**
 * The identity service other hosts consume.
 *
 * The 账户体系 owns two things `/physicsos/auth` is not the only user of: the
 * session cookie, and the audit ledger. The paper host needs both — it has to
 * know WHO is asking before it lets a write through, and a write there belongs
 * in the same trail an admin action lands in. Rather than let every host parse
 * the cookie and re-derive "is this session still good", that knowledge stays
 * here and is published as one cordis service.
 *
 * `actorOf` is the ONLY sanctioned way to learn who is asking: it returns null
 * for a missing, malformed, revoked, expired, or deactivated-account session,
 * so a host that fails closed on null cannot accidentally trust the wire.
 */

import type { IncomingMessage } from 'node:http'
import type { AuthService } from './service.ts'

/**
 * Cordis service name. A consumer injects this exact string — see
 * `paper-host/src/identity.ts`, which declares the same name next to the slice
 * of this contract it uses. The two are held together by
 * `auth-host/tests/composition.spec.ts`, which wires both hosts and asserts the
 * guard actually answers, rather than by a shared import: hosts stay
 * independent of each other, and a consumer that cannot find the service
 * refuses every write instead of allowing them.
 */
export const IDENTITY_SERVICE = 'physicsosIdentity'

/**
 * Who is asking, as the SERVER knows it.
 *
 * Structurally identical to {@link AdminActor} on purpose: an actor is an actor,
 * and the role union is spelled out here so a consumer can copy the shape
 * without importing this module.
 */
export interface IdentityActor {
  /** `schoolId:username` — the key the audit ledger files actions under. */
  readonly userKey: string
  readonly schoolId: string
  readonly username: string
  readonly role: 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN' | 'SUPER_ADMIN'
}

/**
 * The seam this host publishes for sibling hosts: resolve the acting account
 * from a request's session cookie, and file an attributed audit row.
 */
export interface PhysicsosIdentity {
  /** The acting account for this request, or null when its session does not resolve. */
  actorOf(req: IncomingMessage): IdentityActor | null
  /**
   * Append to the platform audit ledger. The school is taken from the actor
   * rather than the caller, so a host cannot file an action under a tenant it
   * is not acting in.
   */
  record(
    actor: IdentityActor,
    action: string,
    target: string,
    detail?: Record<string, unknown>,
  ): Promise<void>
}

/**
 * Adapt the service into the `physicsosIdentity` seam sibling hosts consume.
 * @param service - the auth service doing session resolution and audit writes.
 * @returns the published seam object.
 */
export const createIdentityService = (service: AuthService): PhysicsosIdentity => ({
  actorOf: (req) => {
    const resolved = service.resolveCredential(req.headers.cookie, req.headers.authorization)
    if (resolved === null) return null
    return resolved.actor
  },
  record: (actor, action, target, detail) => service.auditAs(actor, action, target, detail),
})
