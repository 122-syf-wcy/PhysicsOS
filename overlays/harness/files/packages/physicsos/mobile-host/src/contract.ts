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
  readonly userId: string
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
  clientAddress(req: IncomingMessage): string | undefined
  requestPasswordReset(body: unknown, ip?: string): Promise<{ ok: true }>
  submitPasswordReset(body: unknown, ip?: string): Promise<{ ok: true }>
  listDevices(req: IncomingMessage): { items: MobileDevice[] }
  revokeDevice(req: IncomingMessage, grantId: string): Promise<{ ok: true; reauthenticate: boolean }>
  updateProfile(req: IncomingMessage, body: unknown): Promise<MobileUser>
  changePassword(req: IncomingMessage, body: unknown, ip?: string): Promise<{ ok: true; reauthenticate: true }>
  deleteAccount(req: IncomingMessage, body: unknown, ip?: string): Promise<{ status: 'deleted' | 'deletion_pending'; requestId: string }>
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
  exportScene(actor: IdentityActor, id: string, revision: number): Promise<Record<string, unknown>>
  exportCanvasMetadata(actor: IdentityActor): Promise<readonly Record<string, unknown>[]>
  exportCanvasObjectIndex(actor: IdentityActor): Promise<readonly Record<string, unknown>[]>
  exportCanvasObject(actor: IdentityActor, id: string): Promise<Record<string, unknown>>
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
  target(actor: IdentityActor, classId: string, assignmentId: string): Record<string, unknown> | Promise<Record<string, unknown>>
  /** One question figure, already checked against the approved document. */
  figure(actor: IdentityActor, classId: string, assignmentId: string, ref: string): Promise<Uint8Array>
}

/** Notice facade published by notice-host (patched in by this host's scope). */
export interface MobileNoticeFacade {
  platformNotice(actor: IdentityActor): { notice: Record<string, unknown>; acknowledgedVersion: number | null }
  acknowledgePlatformNotice(actor: IdentityActor, body: unknown): Promise<{ acknowledgedVersion: number }>
  listAnnouncements(actor: IdentityActor): readonly Record<string, unknown>[]
  /** Private account data only; platform/tenant announcements are not owned by this reader. */
  exportAccount(actor: IdentityActor): Promise<readonly Record<string, unknown>[]>
  /** Server-only hook; no mobile route accepts an erasure principal from the request body. */
  eraseAccount(request: { requestId: string; userId: string; userKey: string; schoolId: string; username: string }): Promise<void>
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
  const payload = JSON.stringify({ data })
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(payload)
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

/** Native mutations never accept browser-origin requests or compressed JSON. */
export function validateMutationRequest(req: IncomingMessage): void {
  if (req.headers.origin !== undefined) throw new MobileApiError(403, 'ORIGIN_NOT_ALLOWED', '移动接口不接受浏览器跨源变更')
  if (req.headers['content-encoding'] !== undefined && req.headers['content-encoding'] !== 'identity') {
    throw new MobileApiError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求必须是未压缩 JSON')
  }
}

/** Validate the raw path before URL normalization can erase encoded traversal. */
export function mobileRequest(req: IncomingMessage): { url: URL; path: string; segments: string[] } {
  const raw = req.url ?? '/'
  if (raw.length > 8192 || !raw.startsWith('/') || raw.startsWith('//') || /[\\\\\x00-\x20#]/.test(raw) || /%(?![a-f\d]{2})/i.test(raw)) {
    throw new MobileApiError(400, 'BAD_REQUEST', '接口地址无效')
  }
  const rawPath = raw.split('?', 1)[0]!
  if (rawPath !== MOBILE_PREFIX && !rawPath.startsWith(`${MOBILE_PREFIX}/`)) throw new MobileApiError(404, 'NOT_FOUND', '移动接口不存在')
  let segments: string[]
  try {
    const suffix = rawPath.slice(MOBILE_PREFIX.length)
    segments = suffix === '' || suffix === '/' ? [] : suffix.slice(1).split('/').map(value => {
      const decoded = decodeURIComponent(value)
      if (decoded === '' || decoded === '.' || decoded === '..' || /[/\\\\%\x00-\x20]/.test(decoded)) throw new Error('path segment')
      return decoded
    })
    // URLSearchParams otherwise replaces malformed UTF-8 rather than rejecting it.
    decodeURIComponent(raw.slice(rawPath.length).replace(/\+/g, ' '))
  } catch { throw new MobileApiError(400, 'BAD_REQUEST', '接口地址编码无效') }
  const url = new URL(raw, 'http://mobile.invalid')
  const seen = new Set<string>()
  for (const [key] of url.searchParams) {
    if (seen.has(key)) throw new MobileApiError(400, 'BAD_REQUEST', '查询参数不能重复')
    seen.add(key)
  }
  return { url, segments, path: `/${segments.join('/')}` }
}

/** Bound nesting/work and reject duplicate keys before JSON.parse discards them. */
function strictJson(text: string): Record<string, unknown> {
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|\s+/gy
  const stack: { keys: Set<string> | undefined; key: boolean }[] = []
  let offset = 0
  let values = 0
  while (offset < text.length) {
    tokens.lastIndex = offset
    const match = tokens.exec(text)
    if (match === null) throw new Error('JSON token')
    const token = match[0]
    offset = tokens.lastIndex
    if (/^\s/.test(token)) continue
    const frame = stack.at(-1)
    if (token === '{' || token === '[') {
      if (stack.length >= 64 || ++values > 400_000) throw new Error('JSON bound')
      stack.push({ keys: token === '{' ? new Set<string>() : undefined, key: token === '{' })
    } else if (token === '}' || token === ']') stack.pop()
    else if (token === ',') { if (frame?.keys !== undefined) frame.key = true }
    else if (token !== ':') {
      if (frame?.keys !== undefined && frame.key && token.startsWith('"')) {
        const key: string = JSON.parse(token)
        if (frame.keys.has(key)) throw new Error('duplicate JSON key')
        frame.keys.add(key)
        frame.key = false
      } else {
        if (++values > 400_000) throw new Error('JSON bound')
        if (/^[-\d]/.test(token) && !Number.isFinite(Number(token))) throw new Error('non-finite number')
      }
    }
  }
  const value: unknown = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object required')
  return value as Record<string, unknown>
}

/** Byte limits apply to the wire, including metadata; overflow never destroys the response socket. */
export async function readJson(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const contentType = req.headers['content-type']
  if (contentType !== undefined && !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
    throw new MobileApiError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求必须使用 application/json UTF-8')
  }
  const length = req.headers['content-length']
  if (length !== undefined && !/^\d+$/.test(length)) throw new MobileApiError(400, 'BAD_REQUEST', 'Content-Length 无效')
  if (length !== undefined && Number(length) > limit) {
    req.resume()
    throw new MobileApiError(413, 'PAYLOAD_TOO_LARGE', '请求体过大')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const value of req.iterator({ destroyOnReturn: false })) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as string)
    size += chunk.byteLength
    if (size > limit) {
      req.resume()
      throw new MobileApiError(413, 'PAYLOAD_TOO_LARGE', '请求体过大')
    }
    chunks.push(chunk)
  }
  if (length !== undefined && Number(length) !== size) throw new MobileApiError(400, 'BAD_REQUEST', '请求体长度不符')
  if (size === 0) return {}
  if (contentType === undefined) throw new MobileApiError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求必须使用 application/json')
  try {
    return strictJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  } catch { throw new MobileApiError(400, 'BAD_REQUEST', '请求不是有效、无重复键的 JSON 对象') }
}

/** Strict, bounded list input shared by the data and export routes. */
export function listQuery(url: URL, extra: readonly string[] = []): { limit: number; cursor?: string } {
  const allowed = new Set(['limit', 'cursor', ...extra])
  for (const [key] of url.searchParams) if (!allowed.has(key)) throw new MobileApiError(400, 'BAD_REQUEST', '不支持的查询参数')
  const rawLimit = url.searchParams.get('limit')
  const limit = rawLimit === null ? 50 : Number(rawLimit)
  if (rawLimit !== null && (!/^[1-9]\d{0,2}$/.test(rawLimit) || limit > 100)) throw new MobileApiError(400, 'BAD_REQUEST', 'limit 必须为 1..100 的整数')
  const cursor = url.searchParams.get('cursor')
  if (cursor !== null && (cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor))) throw new MobileApiError(400, 'BAD_CURSOR', '分页游标无效')
  return cursor === null ? { limit } : { limit, cursor }
}
