/**
 * The narrow auth face the first-party Android API composes.
 *
 * `mobile-host` needs device credentials and the account mutations that belong
 * to the account owner; it does not need — and must not receive — the
 * administrative surface (`schools` management, `users`, `audit`, `dashboard`)
 * or the password-reset queue. Publishing this facade instead of the whole
 * `AuthService` keeps the capability a sibling host can reach exactly equal to
 * the mobile contract.
 *
 * The facade holds no state of its own: every call re-resolves the credential
 * from the request that carried it, so a revoked or rotated grant is rejected
 * on the next call exactly as the service would reject it.
 *
 * @module @deepseek-ai/dsh-auth-host/mobile-service
 */

import type { IncomingMessage } from 'node:http'
import type { AuthService, ResolvedCredential } from './service.ts'
import { toMobileUser, type MobileDevice, type MobileUser } from './mobile.ts'

/** Cordis service name consumed by `@deepseek-ai/dsh-mobile-host`. */
export const MOBILE_AUTH_SERVICE = 'physicsosMobileAuth'

/** Live mobile principal; carries no credential material. */
export interface ResolvedMobilePrincipal {
  readonly actor: {
    readonly userKey: string
    readonly userId?: string
    readonly schoolId: string
    readonly username: string
    readonly role: 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN' | 'SUPER_ADMIN'
  }
  readonly user: MobileUser
  readonly grantId: string
}

/** The exact methods `mobile-host` is allowed to call. */
export interface MobileAuthHostFacade {
  /** The mobile principal for this request, or null for anything else. */
  resolve(req: IncomingMessage): ResolvedMobilePrincipal | null
  login(body: unknown, ip?: string, userAgent?: string): Promise<unknown>
  register(body: unknown, ip?: string, userAgent?: string): Promise<unknown>
  loginTwoFactor(body: unknown, ip?: string, userAgent?: string): Promise<unknown>
  refresh(body: unknown, ip?: string): Promise<unknown>
  /** Revoking by access needs the request; by refresh token it does not. */
  logout(req: IncomingMessage, body: unknown, ip?: string): Promise<void>
  listDevices(req: IncomingMessage): { items: MobileDevice[] }
  revokeDevice(req: IncomingMessage, grantId: string): Promise<void>
  updateProfile(req: IncomingMessage, body: unknown): Promise<MobileUser>
  changePassword(req: IncomingMessage, body: unknown, ip?: string): Promise<void>
  deleteAccount(req: IncomingMessage, body: unknown, ip?: string): Promise<{ status: 'deleted' | 'deletion_pending'; requestId: string }>
  /** Mark an accepted erasure complete once every dependent domain confirmed. */
  completeErasure(requestId: string): Promise<void>
  schools(query: string): Promise<unknown>
}

/** The auth service's own credential view for this request. */
const credentialOf = (service: AuthService, req: IncomingMessage): ResolvedCredential | null =>
  service.resolveCredential(req.headers.cookie, req.headers.authorization)

/**
 * Project a resolved credential into the mobile principal.
 * @param resolved - a credential the service already validated.
 * @returns the principal, or null when it is not a mobile grant.
 */
function principalOf(resolved: ResolvedCredential): ResolvedMobilePrincipal | null {
  if (resolved.credential.kind !== 'mobile') return null
  return {
    actor: {
      userKey: resolved.actor.userKey,
      userId: resolved.user.id,
      schoolId: resolved.actor.schoolId,
      username: resolved.actor.username,
      role: resolved.actor.role,
    },
    user: toMobileUser(resolved.user),
    grantId: resolved.credential.grant.id,
  }
}

/** Require a live mobile credential or raise the service's own 401. */
function requireCredential(service: AuthService, req: IncomingMessage): ResolvedCredential {
  const resolved = credentialOf(service, req)
  if (resolved === null || resolved.credential.kind !== 'mobile') {
    throw Object.assign(new Error('未登录或会话已失效'), { status: 401, code: 'UNAUTHENTICATED' })
  }
  return resolved
}

/**
 * Build the facade over one open auth service.
 * @param service - the live AuthService instance.
 * @returns the subset published as `physicsosMobileAuth`.
 */
export function createMobileAuthHost(service: AuthService): MobileAuthHostFacade {
  return {
    resolve: req => {
      const resolved = credentialOf(service, req)
      return resolved === null ? null : principalOf(resolved)
    },
    login: (body, ip, userAgent) => service.loginMobile(body, ip, userAgent),
    register: (body, ip, userAgent) => service.registerMobile(body, ip, userAgent),
    loginTwoFactor: (body, ip, userAgent) => service.loginMobileTwoFactor(body, ip, userAgent),
    refresh: (body, ip) => service.refreshMobile(body, ip),
    logout: (req, body, ip) => service.logoutMobile(credentialOf(service, req), body, ip),
    listDevices: req => service.listMobileDevices(requireCredential(service, req)),
    revokeDevice: (req, grantId) => service.revokeMobileDevice(requireCredential(service, req), grantId),
    updateProfile: (req, body) => service.updateMobileProfile(requireCredential(service, req), body),
    changePassword: (req, body, ip) => service.changeMobilePassword(requireCredential(service, req), body, ip),
    deleteAccount: (req, body, ip) => service.deleteMobileAccount(requireCredential(service, req), body, ip),
    completeErasure: requestId => service.completeAccountErasure(requestId),
    schools: async query => service.searchSchools(query),
  }
}
