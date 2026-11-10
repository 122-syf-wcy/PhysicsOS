/** First-party Android request/response DTOs and opaque credential formats. */
import crypto from 'node:crypto'
import { z } from 'zod'
import { deviceIdWire, loginTwoFactorWire, loginWire, registerWire } from './domain.ts'
import type { PublicUser } from './service.ts'
import { hashOpaqueCredential } from './tokens.ts'

const label = z.string().trim().min(1).max(80).refine(value => !/[\u0000-\u001f\u007f]/.test(value))
const deviceFields = {
  deviceId: deviceIdWire,
  deviceName: label.optional(),
  appVersion: z.string().trim().min(1).max(32).refine(value => !/[\u0000-\u001f\u007f]/.test(value)).optional(),
  platform: z.literal('android').optional(),
}

/** Mobile credentials reuse the browser account/password fields with an installation id. */
export const mobileLoginWire = z.object({ ...loginWire.shape, ...deviceFields }).strict()
/** Email and tenant selection remain the existing registration requirements. */
export const mobileRegisterWire = z.object({ ...registerWire.shape, ...deviceFields }).strict()
  .refine(data => data.schoolName !== undefined || data.schoolId !== undefined)
/** A mobile second-factor challenge already owns its installation context. */
export const mobileTwoFactorWire = z.object(loginTwoFactorWire.shape).strict()
/** Raw refreshes are accepted only in JSON, never in query strings or Cookies. */
export const mobileRefreshWire = z.object({ refreshToken: z.string().min(1).max(160) }).strict()
/** Logout also works with a consumed refresh after an indeterminate rotation response. */
export const mobileLogoutWire = z.object({ refreshToken: z.string().min(1).max(160).optional() }).strict()
/** Profile changes cannot alter tenant, role, login name, or an unverified email address. */
export const mobileProfileWire = z.object({
  displayName: z.string().trim().min(1).max(32).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
}).strict()
/** Password changes require the current password and, when enabled, the second factor. */
export const mobilePasswordWire = z.object({
  currentPassword: loginWire.shape.password,
  newPassword: registerWire.shape.password,
  code: loginTwoFactorWire.shape.code.optional(),
}).strict()
/** Explicit confirmation is independent of the password/second-factor proof. */
export const mobileDeleteAccountWire = z.object({
  password: loginWire.shape.password,
  confirmation: z.literal('DELETE'),
  code: loginTwoFactorWire.shape.code.optional(),
}).strict()

/** Only the public account fields Android needs. */
export const mobileUserWire = z.object({
  userId: z.string().min(1),
  userKey: z.string().min(1),
  schoolId: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().min(1),
  role: z.enum(['STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN']),
}).strict()

/** Runtime-checkable authenticated response shared by all credential-issuing routes. */
export const mobileAuthenticatedWire = z.object({
  status: z.literal('authenticated'),
  user: mobileUserWire,
  tokens: z.object({
    accessToken: z.string().regex(/^pma_[A-Za-z0-9_-]{43}$/),
    expiresAt: z.string().datetime(),
    refreshToken: z.string().regex(/^pmr_[A-Za-z0-9_-]{43}$/),
    refreshExpiresAt: z.string().datetime(),
  }).strict(),
}).strict()

/** Public mobile account; credential material is separate. */
export type MobileUser = z.infer<typeof mobileUserWire>
/** A successfully authenticated mobile device. */
export type MobileAuthenticated = z.infer<typeof mobileAuthenticatedWire>
/** Validated installation context persisted on grants and mobile challenges. */
export type MobileDeviceContext = Pick<z.infer<typeof mobileLoginWire>, 'deviceId' | 'deviceName' | 'appVersion'>
/** Password acceptance does not imply authentication until the second factor completes. */
export interface MobileChallenge { status: 'challenge'; challengeToken: string; expiresAt: string }
/** An account is still waiting for the existing school admission workflow. */
export type MobilePending = { status: 'pending'; message: string } | {
  status: 'pending'; requestId: string; schoolName: string; username: string; email: string
}
/** Explicit login states; pending and challenge responses contain no grant. */
export type MobileLoginResult = MobileAuthenticated | MobileChallenge | MobilePending
/** Device list entry; no token digests, hardware id, IP, or user agent. */
export interface MobileDevice {
  id: string
  platform: 'android'
  deviceName: string
  appVersion?: string
  createdAt: string
  lastSeenAt: string
  refreshExpiresAt: string
  current: boolean
  revokedAt?: string
}
/** Acknowledges live erasure only when all domains completed it. */
export interface MobileDeletionResult { status: 'deleted' | 'deletion_pending'; requestId: string }

/**
 * Project an existing public account into the stable mobile DTO.
 * @param user - account resolved by AuthService.
 * @returns public identity and immutable account incarnation, without password, TOTP or email.
 */
export function toMobileUser(user: PublicUser): MobileUser {
  return {
    userId: user.id,
    userKey: `${user.schoolId}:${user.username.toLowerCase()}`,
    schoolId: user.schoolId,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  }
}

/**
 * Create 256-bit credentials with disjoint access/refresh namespaces.
 * @param kind - first-party credential purpose.
 * @returns the one-time raw value and its SHA-256 storage digest.
 */
export function newMobileToken(kind: 'access' | 'refresh'): { raw: string; hash: string } {
  const raw = `${kind === 'access' ? 'pma_' : 'pmr_'}${crypto.randomBytes(32).toString('base64url')}`
  return { raw, hash: hashOpaqueCredential(raw) }
}

/**
 * Check the complete mobile credential syntax before a storage lookup.
 * @param token - untrusted raw credential.
 * @param kind - required purpose; a refresh never authenticates an API request.
 * @returns whether the complete token matches the required namespace and entropy length.
 */
export function isMobileToken(token: string, kind: 'access' | 'refresh'): boolean {
  return (kind === 'access' ? /^pma_[A-Za-z0-9_-]{43}$/ : /^pmr_[A-Za-z0-9_-]{43}$/).test(token)
}
