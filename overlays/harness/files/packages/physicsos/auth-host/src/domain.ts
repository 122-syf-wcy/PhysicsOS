/**
 * Storage-domain spec for the PhysicsOS 账户体系 — one `physicsos_auth` unit
 * over the JSON backend with a table per identity fact: schools (tenants),
 * users (keyed `schoolId:username`, which makes UNIQUE(school_id, username)
 * structural rather than enforced), sessions (keyed by the SHA-256 of the
 * opaque cookie token, so tokens never rest in the store), password-reset
 * requests, school applications, and the append-only admin audit ledger.
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'

const role = z.enum(['STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'])

const school = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  shortName: z.string().optional(),
  logoUrl: z.string().optional(),
  /** 地州市 label (e.g. 黔东南州) — carried by roster seeds for disambiguation. */
  city: z.string().optional(),
  /** 区县 label when the roster source carries one. */
  county: z.string().optional(),
  status: z.enum(['active', 'disabled']),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const user = z.object({
  id: z.string().min(1),
  schoolId: z.string().min(1),
  username: z.string().min(1),
  passwordHash: z.string().min(1),
  displayName: z.string().min(1),
  avatarUrl: z.string().optional(),
  role,
  status: z.enum(['active', 'disabled']),
  lastLoginAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const session = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  schoolId: z.string().min(1),
  /** Lower-cased login username — with schoolId it rebuilds the user-key, so
      session resolution stays O(1) instead of scanning the users table. */
  username: z.string().min(1),
  remember: z.boolean(),
  createdAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().optional(),
  ip: z.string().optional(),
  userAgent: z.string().optional(),
})

const resetRequest = z.object({
  id: z.string().min(1),
  schoolId: z.string().min(1),
  username: z.string().min(1),
  at: z.string(),
  ip: z.string().optional(),
})

/* A school's application to join PhysicsOS — the register view's 申请开通
   submission lands here for a SUPER_ADMIN to approve or reject. */
const schoolRequest = z.object({
  id: z.string().min(1),
  schoolName: z.string().min(1),
  contact: z.string().min(1),
  status: z.enum(['pending', 'approved', 'rejected']),
  /** userKey of the submitter; anonymous submissions carry null. */
  requestedBy: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().optional(),
  decidedBy: z.string().optional(),
})

/* Append-only admin action ledger — every state-changing admin verb writes
   one row; there is no update path by design. */
const auditEvent = z.object({
  id: z.string().min(1),
  /** userKey (`schoolId:username`) of the acting admin. */
  actorKey: z.string().min(1),
  /** Tenant the action touched — school-scoped audit reads filter on this. */
  schoolId: z.string().min(1),
  action: z.string().min(1),
  target: z.string().min(1),
  detail: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
})

export type School = z.infer<typeof school>
export type UserRecord = z.infer<typeof user>
export type SessionRecord = z.infer<typeof session>
export type ResetRequest = z.infer<typeof resetRequest>
export type SchoolRequestRecord = z.infer<typeof schoolRequest>
export type AuditEvent = z.infer<typeof auditEvent>

/**
 * Registration accepts exactly these fields; `role` is never client input.
 * The school arrives as free-text `schoolName` resolved host-side (unique
 * active match wins, ambiguity returns candidates); `schoolId` is the
 * disambiguation answer — never a form the user picks from a public list.
 */
export const registerWire = z.object({
  schoolId: z.string().min(1).optional(),
  schoolName: z.string().min(1).max(64).optional(),
  username: z.string().regex(/^[a-zA-Z0-9_.-]{3,32}$/),
  displayName: z.string().min(1).max(32),
  password: z.string().min(8).max(128),
}).refine(data => data.schoolId !== undefined || data.schoolName !== undefined, {
  message: 'schoolName or schoolId required',
})

/**
 * Login is account + password; the host resolves the tenant globally.
 * `schoolId` exists only to disambiguate the rare same-username-same-password
 * collision the host reports back with candidates.
 */
export const loginWire = z.object({
  schoolId: z.string().min(1).optional(),
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
  rememberDevice: z.boolean().optional(),
})

export const forgotWire = z.object({
  schoolId: z.string().min(1).optional(),
  username: z.string().min(1).max(64),
})

/** 申请开通 a school — anonymous-allowed, IP rate-limited upstream. */
export const schoolRequestWire = z.object({
  schoolName: z.string().min(2).max(64),
  contact: z.string().min(2).max(128),
})

const schoolIdWire = z.string().regex(/^[A-Za-z0-9_-]{2,32}$/)

/** SUPER_ADMIN approves an application and seeds its first school admin. */
export const approveRequestWire = z.object({
  schoolId: schoolIdWire,
  shortName: z.string().min(1).max(16).optional(),
  adminUsername: registerWire.shape.username,
  adminDisplayName: registerWire.shape.displayName,
  adminPassword: registerWire.shape.password,
})

export const rejectRequestWire = z.object({
  reason: z.string().max(200).optional(),
})

export const createSchoolWire = z.object({
  id: schoolIdWire,
  name: z.string().min(2).max(64),
  shortName: z.string().min(1).max(16).optional(),
})

export const schoolStatusWire = z.object({
  status: z.enum(['active', 'disabled']),
})

/** Admin user provisioning — `SUPER_ADMIN` is structurally unreachable here:
    the enum omits it, so no wire value can mint one. `schoolId` is required
    for SUPER_ADMIN; a SCHOOL_ADMIN may omit it (own tenant implied) but a
    mismatched value is refused. */
export const createUserWire = z.object({
  schoolId: z.string().min(1).max(64).optional(),
  username: registerWire.shape.username,
  displayName: registerWire.shape.displayName,
  password: registerWire.shape.password,
  role: z.enum(['STUDENT', 'TEACHER', 'SCHOOL_ADMIN']),
})

export const userStatusWire = z.object({
  status: z.enum(['active', 'disabled']),
})

export const resetPasswordWire = z.object({
  newPassword: registerWire.shape.password,
})

/** The users-table key — the durable form of UNIQUE(school_id, username). */
export const userKey = (schoolId: string, username: string): string =>
  `${schoolId}:${username.toLowerCase()}`

/**
 * The auth durable unit. `users`/`sessions` keys are lookup paths (school +
 * username, token hash) — the row `id` stays the opaque cross-reference.
 */
export const authDomain = defineDomain({
  name: 'physicsos_auth',
  version: 0,
  tables: {
    schools: domainTable<string, School>(school),
    users: domainTable<string, UserRecord>(user),
    sessions: domainTable<string, SessionRecord>(session),
    reset_requests: domainTable<string, ResetRequest>(resetRequest),
    school_requests: domainTable<string, SchoolRequestRecord>(schoolRequest),
    admin_audit: domainTable<string, AuditEvent>(auditEvent),
  },
})

/** Handle the opened domain hands to the route layer. */
export type AuthDomain = Domain<typeof authDomain>

import type { Context } from '@deepseek-ai/cordis'

/**
 * Open the auth domain on the mounted storage facility.
 * @param ctx - plugin context carrying the `storageDomain` service.
 * @returns the opened domain, typed by {@link authDomain}.
 */
export async function openAuthDomain(ctx: Context): Promise<AuthDomain> {
  return ctx.storageDomain.open(authDomain)
}
