/**
 * Wire envelope and identity contract for the first-party Android API.
 *
 * This host is a composition surface, not another business domain: every
 * answer comes from the already-open auth, learning, class, paper and notice
 * hosts. It therefore owns no storage table and re-declares only the tiny
 * slices of their published services it consumes, so the hosts stay
 * independent workspace members (the same rule class-host and paper-host
 * follow for `physicsosIdentity`).
 *
 * @module @deepseek-ai/dsh-mobile-host/contract
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** The mobile API version this host serves; the path segment matches it. */
export const MOBILE_PREFIX = '/physicsos/mobile/v1'

/** Cordis service the auth host publishes for first-party device grants. */
export const MOBILE_AUTH_SERVICE = 'physicsosMobileAuth'

export type IdentityRole = 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN' | 'SUPER_ADMIN'

/** Resolved server-side account; never taken from the request body. */
export interface IdentityActor {
  readonly userKey: string
  readonly userId?: string
  readonly schoolId: string
  readonly username: string
  readonly role: IdentityRole
}

/** Published mobile user DTO (mirrors auth-host's `mobileUserWire`). */
export interface MobileUser {
  readonly userId: string
  readonly userKey: string
  readonly schoolId: string
  readonly username: string
  readonly displayName: string
  readonly role: IdentityRole
}

/** One authenticated device grant, minus every credential digest. */
export interface MobileDevice {
  readonly id: string
  readonly platform: 'android'
  readonly deviceName: string
  readonly appVersion?: string
  readonly createdAt: string
  readonly lastSeenAt: string
  readonly refreshExpiresAt: string
  readonly current: boolean
  readonly revokedAt?: string
}

/** Authenticated response shared by login, refresh and the 2FA completion. */
export interface MobileAuthenticated {
  readonly status: 'authenticated'
  readonly user: MobileUser
  readonly tokens: {
    readonly accessToken: string
    readonly expiresAt: string
    readonly refreshToken: string
    readonly refreshExpiresAt: string
  }
}

/** A second factor is still required; no grant exists yet. */
export interface MobileChallenge {
  readonly status: 'challenge'
  readonly challengeToken: string
  readonly expiresAt: string
}

/** The existing school-admission workflow still holds this account. */
export type MobilePending = {
  readonly status: 'pending'
  readonly message: string
} | {
  readonly status: 'pending'
  readonly requestId: string
  readonly schoolName: string
  readonly username: string
  readonly email: string
}

/** Explicit login outcomes; only `authenticated` carries credentials. */
export type MobileLoginResult = MobileAuthenticated | MobileChallenge | MobilePending

/** Live server-resolved mobile principal plus the credential that proved it. */
export interface ResolvedMobile {
  readonly actor: IdentityActor
  readonly user: MobileUser
  readonly grantId: string
}

/**
 * The narrow auth face this host consumes.
 *
 * `resolve` is the only way to learn who is asking: it returns null for a
 * missing, malformed, revoked, expired or disabled-account credential. The
 * business calls stay on the auth service — this host never re-implements
 * password, TOTP or grant policy.
 */
export interface MobileAuthFacade {
  resolve(req: IncomingMessage): {
    readonly actor: IdentityActor
    readonly user: MobileUser
    readonly grantId: string
  } | null
  login(body: unknown, ip?: string, userAgent?: string): Promise<MobileLoginResult>
  register(body: unknown, ip?: string, userAgent?: string): Promise<MobileLoginResult>
  loginTwoFactor(body: unknown, ip?: string, userAgent?: string): Promise<MobileAuthenticated>
  refresh(body: unknown, ip?: string): Promise<MobileAuthenticated>
  logout(req: IncomingMessage, body: unknown, ip?: string): Promise<void>
  listDevices(req: IncomingMessage): { items: MobileDevice[] }
  revokeDevice(req: IncomingMessage, grantId: string): Promise<void>
  updateProfile(req: IncomingMessage, body: unknown): Promise<MobileUser>
  changePassword(req: IncomingMessage, body: unknown, ip?: string): Promise<void>
  deleteAccount(req: IncomingMessage, body: unknown, ip?: string): Promise<{ status: 'deleted' | 'deletion_pending'; requestId: string }>
  completeErasure(requestId: string): Promise<void>
  schools(query: string): Promise<unknown>
}

/** One student learning attempt, already projected by learning-host. */
export interface AttemptView {
  readonly id: string
  readonly at: string
  readonly [field: string]: unknown
}

/** One saved scene summary, already projected by learning-host. */
export interface SceneSummary {
  readonly sceneId: string
  readonly revision: number
  readonly [field: string]: unknown
}

/** Student learning facade published by learning-host. */
export interface MobileLearningFacade {
  listAttempts(actor: IdentityActor): AttemptView[]
  saveAttempt(actor: IdentityActor, id: string, body: unknown): Promise<{ item: AttemptView }>
  listScenes(actor: IdentityActor): SceneSummary[]
  getScene(actor: IdentityActor, id: string): Promise<{ item: Record<string, unknown> }>
  saveScene(
    actor: IdentityActor,
    id: string,
    body: unknown,
    mutationId: string,
  ): Promise<Record<string, unknown> & { item: SceneSummary }>
  deleteScene(
    actor: IdentityActor,
    id: string,
    body: unknown,
    mutationId: string,
  ): Promise<Record<string, unknown> & { item: SceneSummary }>
  eraseAccount(request: {
    requestId: string
    userId: string
    userKey: string
    schoolId: string
    username: string
  }): Promise<void>
}

/** Student class facade published by class-host. */
export interface MobileClassFacade {
  listClasses(actor: IdentityActor): readonly Record<string, unknown>[]
  listAssignments(actor: IdentityActor, classId: string): readonly Record<string, unknown>[]
  getSubmission(
    actor: IdentityActor,
    classId: string,
    assignmentId: string,
  ): Record<string, unknown>
  submit(
    actor: IdentityActor,
    classId: string,
    assignmentId: string,
    body: unknown,
    mutationId: string,
  ): Promise<Record<string, unknown>>
  exportMemberships(actor: IdentityActor): readonly Record<string, unknown>[]
  exportSubmissions(actor: IdentityActor): readonly Record<string, unknown>[]
  eraseAccount(request: {
    requestId: string
    userId: string
    userKey: string
    schoolId: string
    username: string
  }): Promise<void>
}

/** Verified paper library facade published by paper-host. */
export interface MobilePaperFacade {
  listSources(actor: IdentityActor): readonly Record<string, unknown>[]
  listAnnotations(actor: IdentityActor, sourceId?: string): readonly Record<string, unknown>[]
  listQuestions(actor: IdentityActor): readonly Record<string, unknown>[]
  /** The approved target a released assignment points at (paper, or experiment build). */
  target(actor: IdentityActor, classId: string, assignmentId: string): Promise<Record<string, unknown>>
  /** One question figure, already checked against the approved document. */
  figure(actor: IdentityActor, classId: string, assignmentId: string, ref: string): Promise<Uint8Array>
}

/** Notice facade published by notice-host (patched in by this host's scope). */
export interface MobileNoticeFacade {
  platformNotice(actor: IdentityActor): { notice: Record<string, unknown>; acknowledgedVersion: number | null }
  acknowledgePlatformNotice(actor: IdentityActor, body: unknown): Promise<{ acknowledgedVersion: number }>
  listAnnouncements(actor: IdentityActor): readonly Record<string, unknown>[]
}

/** Push registration facade published by the notice host's device table. */
export interface MobilePushFacade {
  register(actor: IdentityActor, body: unknown): Promise<{ id: string; platform: 'android'; registeredAt: string }>
  revoke(actor: IdentityActor, id: string): Promise<void>
}

/** Error shape every mobile route answers with. */
export class MobileApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'MobileApiError'
  }
}

/** Reply with the `{data}` envelope. */
export function sendData(res: ServerResponse, data: unknown, status = 200): void {
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify({ data }))
}

/** Reply with the `{error:{code,message,details?}}` envelope. */
export function sendError(res: ServerResponse, status: number, code: string, message: string, details?: Record<string, unknown>): void {
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify({ error: { code, message, ...(details === undefined ? {} : { details }) } }))
}

/**
 * Translate any business failure into the mobile envelope.
 *
 * Hosts raise their own error classes with a numeric `status` and a stable
 * `code`; everything else is a 500 without leaking internals. The mapping is
 * deliberately conservative — an unknown failure never becomes a 2xx.
 * @param res - the response to write.
 * @param error - whatever the business call threw.
 */
export function sendFailure(res: ServerResponse, error: unknown): void {
  if (error instanceof MobileApiError) {
    sendError(res, error.status, error.code, error.message, error.details)
    return
  }
  const shaped = error as { status?: unknown; code?: unknown; message?: unknown; details?: unknown } | null
  if (shaped !== null && typeof shaped === 'object'
    && typeof shaped.status === 'number' && shaped.status >= 400 && shaped.status < 600
    && typeof shaped.code === 'string') {
    sendError(
      res,
      shaped.status,
      shaped.code,
      typeof shaped.message === 'string' ? shaped.message : '请求失败',
      typeof shaped.details === 'object' && shaped.details !== null
        ? shaped.details as Record<string, unknown>
        : undefined,
    )
    return
  }
  sendError(res, 500, 'INTERNAL', '服务器内部错误')
}

/** Reject a caller that is not a signed-in student. */
export function requireStudent(actor: IdentityActor): void {
  if (actor.role !== 'STUDENT') {
    throw new MobileApiError(403, 'STUDENT_REQUIRED', '移动学习入口仅供学生本人使用')
  }
}

/**
 * Idempotency key from the request header.
 *
 * Mutations carry `Idempotency-Key`; the value is replayed by the business
 * service so a retried sync cannot apply twice. Absence is a client error,
 * not a silent new key — the app always generates one.
 * @param req - the mutation request.
 * @returns the header value.
 */
export function mutationIdOf(req: IncomingMessage): string {
  const value = req.headers['idempotency-key']
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    throw new MobileApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', '变更请求必须携带 8–128 位 Idempotency-Key')
  }
  return value
}

/** Cap the JSON body; over-limit answers 413 instead of buffering without bound. */
export async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new MobileApiError(413, 'PAYLOAD_TOO_LARGE', '请求体过大')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new MobileApiError(400, 'BAD_REQUEST', '请求不是合法 JSON')
  }
}

/** Read `limit`/`cursor` without letting a client invent other query keys. */
export function listQuery(url: URL): { limit?: string; cursor?: string } {
  const query: { limit?: string; cursor?: string } = {}
  const limit = url.searchParams.get('limit')
  const cursor = url.searchParams.get('cursor')
  if (limit !== null) query.limit = limit
  if (cursor !== null) query.cursor = cursor
  return query
}
