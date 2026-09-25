/**
 * Auth domain service — every decision a route can take funnels through here.
 * Never trusts client-supplied ids beyond the wire schema: `role` is pinned,
 * `schoolId` must resolve to an active tenant row, and session authority is
 * the hashed token alone. Error codes are the public contract; messages are
 * deliberately non-identifying to blunt enumeration.
 */

import crypto from 'node:crypto'
import type {
  AuditEvent, AuthDomain, LearningCount, School, SchoolRequestRecord, SessionRecord, UserRecord,
} from './domain'
import {
  approveRequestWire, createSchoolWire, createUserWire, forgotWire, learningKey,
  learningReportWire, loginWire, registerWire, rejectRequestWire, resetPasswordWire,
  schoolRequestWire, schoolStatusWire, userKey, userStatusWire,
} from './domain'
import { hashPassword, verifyPassword } from './passwords'
import { newSessionToken, sessionTokenHash } from './cookies'

/** Public error codes — the only failure vocabulary the wire exposes. */
export type AuthErrorCode =
  | 'BAD_REQUEST' | 'SCHOOL_NOT_FOUND' | 'USERNAME_TAKEN' | 'SCHOOL_TAKEN'
  | 'SCHOOL_REQUIRED' | 'SCHOOL_AMBIGUOUS'
  | 'INVALID_CREDENTIALS' | 'RATE_LIMITED' | 'UNAUTHENTICATED'
  | 'FORBIDDEN' | 'NOT_FOUND'

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: AuthErrorCode,
    message: string,
    /** Extra wire fields merged into `{error}` — e.g. disambiguation candidates. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

/** The client-facing principal — never carries `passwordHash`. */
export interface PublicUser {
  id: string
  schoolId: string
  schoolName: string
  schoolShortName?: string
  username: string
  displayName: string
  avatarUrl?: string
  role: UserRecord['role']
}

export interface LoginResult {
  token: string
  expiresAt: string
  /** Seconds the cookie should live when `rememberDevice` was set; else 0 → session cookie. */
  cookieMaxAge: number
  user: PublicUser
}

export interface ResolvedSession {
  user: PublicUser
  session: SessionRecord
}

/**
 * The acting admin, built by the route layer from the resolved session —
 * role and schoolId are server-authoritative and cannot be wire input.
 */
export interface AdminActor {
  userKey: string
  schoolId: string
  username: string
  role: UserRecord['role']
}

/** Admin-facing user row — PublicUser plus lifecycle fields; still no hash. */
export interface AdminUserRow extends PublicUser {
  status: UserRecord['status']
  createdAt: string
  lastLoginAt?: string
}

/** Management ceiling order — SUPER_ADMIN itself is never API-managed. */
const ROLE_RANK: Record<UserRecord['role'], number> = {
  STUDENT: 0,
  TEACHER: 1,
  SCHOOL_ADMIN: 2,
  SUPER_ADMIN: 3,
}

export interface AuthServiceConfig {
  /** Non-remembered session lifetime (ms). Default 12h. */
  sessionTtlMs: number
  /** Remembered session lifetime (ms) — also the cookie Max-Age. Default 30d. */
  rememberTtlMs: number
  /** Failed logins allowed per account within the window. Default 5. */
  accountAttemptLimit: number
  /** Failed logins allowed per source IP within the window. Default 20. */
  ipAttemptLimit: number
  /**
   * Anonymous school applications allowed per source IP within the window —
   * a dedicated bucket so flooding the public form cannot starve logins.
   * Default 10.
   */
  applyAttemptLimit: number
  /** Rate-limit window (ms). Default 10min. */
  attemptWindowMs: number
}

export const DEFAULT_AUTH_CONFIG: AuthServiceConfig = {
  sessionTtlMs: 12 * 60 * 60 * 1000,
  rememberTtlMs: 30 * 24 * 60 * 60 * 1000,
  accountAttemptLimit: 5,
  ipAttemptLimit: 20,
  applyAttemptLimit: 10,
  attemptWindowMs: 10 * 60 * 1000,
}

/* A well-formed but meaningless hash; verifying against it on a missing
   account keeps the reject path the same shape and timing as a real miss. */
const DUMMY_HASH = 'argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$'
  + 'A'.repeat(43)

/** A username in more tenants than this must name its school — argon2 stays bounded. */
const MAX_LOGIN_CANDIDATES = 16

/** Registration candidates cap — a longer list is unusable in a picker; the
    user refines the typed name instead. Shortest names sort first. */
const MAX_SCHOOL_CANDIDATES = 16

/**
 * 宿主本地时区的 `YYYY-MM-DD`。
 *
 * 不用 `toISOString().slice(0,10)`:那是 UTC 日界,对东八区的学校意味着「今天」
 * 从早上 8 点才开始,晚自习的自测会掉进前一天。聚合粒度是「学校 × 日期」,日期
 * 必须是学校说的那一天。
 */
const localDate = (at: Date): string => {
  const year = String(at.getFullYear()).padStart(4, '0')
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Fixed-window attempt counters, keyed per bucket; process-local by design. */
class AttemptLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Read-only view for the ops console.
   *
   * The keys are IPs and usernames, so they are NOT returned: the console needs
   * "how close is this deployment to its limiter", not a list of who is
   * currently throttled. Reported as aggregate counts.
   */
  snapshot(now = Date.now()): { tracked: number; saturated: number; limit: number; windowMs: number } {
    let tracked = 0
    let saturated = 0
    for (const bucket of this.buckets.values()) {
      if (now >= bucket.resetAt) continue
      tracked += 1
      if (bucket.count >= this.limit) saturated += 1
    }
    return { tracked, saturated, limit: this.limit, windowMs: this.windowMs }
  }

  /** True when the bucket has room; consumes one slot when it does. */
  consume(key: string, now = Date.now()): boolean {
    const bucket = this.buckets.get(key)
    if (bucket === undefined || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs })
      return true
    }
    bucket.count += 1
    return bucket.count <= this.limit
  }

  reset(key: string): void {
    this.buckets.delete(key)
  }
}

export class AuthService {
  private readonly accountLimiter: AttemptLimiter
  private readonly ipLimiter: AttemptLimiter
  private readonly applyLimiter: AttemptLimiter

  constructor(
    private readonly domain: AuthDomain,
    readonly config: AuthServiceConfig = DEFAULT_AUTH_CONFIG,
  ) {
    this.accountLimiter = new AttemptLimiter(config.accountAttemptLimit, config.attemptWindowMs)
    this.ipLimiter = new AttemptLimiter(config.ipAttemptLimit, config.attemptWindowMs)
    this.applyLimiter = new AttemptLimiter(config.applyAttemptLimit, config.attemptWindowMs)
  }

  private get schools() { return this.domain.table('schools') }
  private get users() { return this.domain.table('users') }
  private get sessions() { return this.domain.table('sessions') }
  private get resets() { return this.domain.table('reset_requests') }

  /**
   * Active-user candidates for a username across active school tenants.
   * `schoolId` (the disambiguation answer) narrows the pool to one tenant.
   */
  private loginCandidates(username: string, schoolId?: string): { record: UserRecord; school: School }[] {
    const out: { record: UserRecord; school: School }[] = []
    for (const [, record] of this.users.entries()) {
      if (record.username !== username.toLowerCase() || record.status !== 'active') continue
      if (schoolId !== undefined && record.schoolId !== schoolId) continue
      const school = this.schools.get(record.schoolId)
      if (school === undefined || school.status !== 'active') continue
      out.push({ record, school })
    }
    return out
  }

  /** Wire shape for a disambiguation candidate — region labels ride along so
      the picker can tell same-name schools apart. */
  private toCandidate(school: School): {
    id: string
    name: string
    shortName?: string
    city?: string
    county?: string
  } {
    return {
      id: school.id,
      name: school.name,
      ...(school.shortName !== undefined ? { shortName: school.shortName } : {}),
      ...(school.city !== undefined ? { city: school.city } : {}),
      ...(school.county !== undefined ? { county: school.county } : {}),
    }
  }

  /**
   * Resolve free-text `schoolName` to an active tenant: exact name/shortName
   * match first, then a contains-match — but only a unique result counts.
   */
  private resolveSchoolByName(schoolName: string): { school: School | undefined; ambiguous: School[] } {
    const needle = schoolName.trim().toLowerCase()
    const active = [...this.schools.entries()]
      .map(([, school]) => school)
      .filter(school => school.status === 'active')
    const exact = active.filter(school =>
      school.name.toLowerCase() === needle || school.shortName?.toLowerCase() === needle)
    const pool = exact.length > 0 ? exact : active.filter(school =>
      school.name.toLowerCase().includes(needle) || school.shortName?.toLowerCase().includes(needle) === true)
    return pool.length === 1 ? { school: pool[0], ambiguous: [] } : { school: undefined, ambiguous: pool }
  }

  /**
   * Register a student account under a school tenant, then issue its first
   * session — the caller just proved the password, so a second verify would
   * only spend argon2 for nothing. The tenant list is fixed by the roster
   * seeds: an unlisted `schoolName` is a `SCHOOL_NOT_FOUND`, never a new
   * tenant — name variants would otherwise fork one school per spelling.
   * `role` is pinned server-side: teacher/admin enrolment is a future admin
   * surface, not wire input.
   */
  async register(body: unknown, ip?: string, userAgent?: string): Promise<LoginResult> {
    const input = registerWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查填写内容')
    const { username, displayName, password } = input.data

    let school: School | undefined
    if (input.data.schoolId !== undefined) {
      const row = this.schools.get(input.data.schoolId)
      if (row !== undefined && row.status === 'active') school = row
    } else if (input.data.schoolName !== undefined) {
      const resolved = this.resolveSchoolByName(input.data.schoolName)
      if (resolved.ambiguous.length > 0) {
        const candidates = [...resolved.ambiguous]
          .sort((a, b) => a.name.length - b.name.length)
          .slice(0, MAX_SCHOOL_CANDIDATES)
          .map(s => this.toCandidate(s))
        throw new AuthError(409, 'SCHOOL_AMBIGUOUS', '存在多所同名学校，请选择你的学校', { candidates })
      }
      school = resolved.school
    }
    if (school === undefined) {
      throw new AuthError(400, 'SCHOOL_NOT_FOUND', '未找到该学校，请核对学校名称')
    }

    const key = userKey(school.id, username)
    if (this.users.get(key) !== undefined) {
      throw new AuthError(409, 'USERNAME_TAKEN', '该账号已被注册')
    }

    const now = new Date().toISOString()
    const record: UserRecord = {
      id: `u_${crypto.randomBytes(9).toString('base64url')}`,
      schoolId: school.id,
      username: username.toLowerCase(),
      passwordHash: hashPassword(password),
      displayName,
      role: 'STUDENT',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    await this.users.put(key, record)
    return this.issueSession(record, school, false, ip, userAgent)
  }

  /**
   * Authenticate `username + password` — the host resolves the tenant, so the
   * user never picks a school. All reject paths collapse to
   * `INVALID_CREDENTIALS` (or `RATE_LIMITED`); a missing account still pays
   * the argon2 cost via a dummy verify so timing does not reveal it. When the
   * same username exists in several schools and the password matches more
   * than one, the caller gets `SCHOOL_REQUIRED` with the matching schools —
   * the only moment a school list ever reaches the wire.
   */
  async login(body: unknown, ip?: string, userAgent?: string): Promise<LoginResult> {
    const input = loginWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查填写内容')
    const { username, password } = input.data
    const remember = input.data.rememberDevice === true
    const sourceIp = ip ?? 'unknown'

    if (!this.ipLimiter.consume(`ip:${sourceIp}`)) {
      throw new AuthError(429, 'RATE_LIMITED', '尝试过于频繁，请稍后再试')
    }
    const accountKey = `acct:${username.toLowerCase()}`
    if (!this.accountLimiter.consume(accountKey)) {
      throw new AuthError(429, 'RATE_LIMITED', '尝试过于频繁，请稍后再试')
    }

    const candidates = this.loginCandidates(username, input.data.schoolId)
    /* A username living in more tenants than this cannot be brute-picked —
       the caller must name the school before we spend more argon2. */
    if (candidates.length > MAX_LOGIN_CANDIDATES) {
      throw new AuthError(409, 'SCHOOL_REQUIRED', '该账号属于多所学校，请选择你的学校', {
        candidates: candidates.map(c => this.toCandidate(c.school)),
      })
    }
    if (candidates.length === 0) await Promise.resolve(verifyPassword(password, DUMMY_HASH))
    const matches: { record: UserRecord; school: School }[] = []
    for (const candidate of candidates) {
      if (await Promise.resolve(verifyPassword(password, candidate.record.passwordHash))) {
        matches.push(candidate)
      }
    }
    if (matches.length === 0) {
      throw new AuthError(401, 'INVALID_CREDENTIALS', '账号或密码不正确')
    }
    if (matches.length > 1) {
      throw new AuthError(409, 'SCHOOL_REQUIRED', '该账号属于多所学校，请选择你的学校', {
        candidates: matches.map(c => this.toCandidate(c.school)),
      })
    }
    this.accountLimiter.reset(accountKey)
    const match = matches[0]
    if (match === undefined) {
      throw new AuthError(401, 'INVALID_CREDENTIALS', '账号或密码错误')
    }
    const { record, school } = match
    const result = await this.issueSession(record, school, remember, sourceIp, userAgent)
    await this.users.put(userKey(school.id, record.username), {
      ...record, lastLoginAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    return result
  }

  /** Mint an opaque token and persist only its hash as a session row. */
  private async issueSession(
    record: UserRecord, school: School, remember: boolean,
    ip?: string, userAgent?: string,
  ): Promise<LoginResult> {
    const now = Date.now()
    const token = newSessionToken()
    const session: SessionRecord = {
      id: sessionTokenHash(token),
      userId: record.id,
      schoolId: school.id,
      username: record.username,
      remember,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + (remember ? this.config.rememberTtlMs : this.config.sessionTtlMs)).toISOString(),
      ip: ip ?? 'unknown',
      ...(userAgent !== undefined ? { userAgent: userAgent.slice(0, 256) } : {}),
    }
    await this.sessions.put(session.id, session)
    return {
      token,
      expiresAt: session.expiresAt,
      cookieMaxAge: remember ? Math.floor(this.config.rememberTtlMs / 1000) : 0,
      user: this.toPublic(record, school),
    }
  }

  /** Revoke the session behind a raw cookie token; unknown tokens are a no-op. */
  async logout(token: string | null): Promise<void> {
    if (token === null) return
    const id = sessionTokenHash(token)
    const session = this.sessions.get(id)
    if (session === undefined || session.revokedAt !== undefined) return
    await this.sessions.put(id, { ...session, revokedAt: new Date().toISOString() })
  }

  /**
   * Resolve a raw cookie token to the live principal, or null when the session
   * is absent, revoked, expired, or its user/school left `active`.
   */
  /* Reads an in-memory index only, so it is sync — `await` at the call sites
     still works, and the plugin never has to invent a promise. */
  resolveSession(token: string): ResolvedSession | null {
    const session = this.sessions.get(sessionTokenHash(token))
    if (session === undefined || session.revokedAt !== undefined) return null
    if (Date.parse(session.expiresAt) <= Date.now()) return null

    const school = this.schools.get(session.schoolId)
    if (school === undefined || school.status !== 'active') return null

    const user = this.users.get(userKey(session.schoolId, session.username))
    if (user === undefined || user.id !== session.userId || user.status !== 'active') return null
    return { user: this.toPublic(user, school), session }
  }

  /**
   * Record a recovery request for the V1 admin-driven flow. The response is
   * identical whether or not the account exists — enumeration is not a feature.
   */
  async requestPasswordReset(body: unknown, ip?: string): Promise<void> {
    const input = forgotWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查填写内容')
    if (!this.ipLimiter.consume(`forgot:${ip ?? 'unknown'}`)) {
      throw new AuthError(429, 'RATE_LIMITED', '尝试过于频繁，请稍后再试')
    }
    const { username, schoolId } = input.data
    const candidates = this.loginCandidates(username, schoolId)
    const only = candidates.length === 1 ? candidates[0] : undefined
    if (only === undefined) return
    const { record, school } = only
    const id = `rr_${crypto.randomBytes(9).toString('base64url')}`
    await this.resets.put(id, {
      id,
      schoolId: school.id,
      username: record.username,
      at: new Date().toISOString(),
      ...(ip !== undefined ? { ip } : {}),
    })
  }

  /* ---- Admin Console ----
     Every method below takes the session-derived actor, never wire claims:
     the route layer resolves the cookie, the service enforces role + tenant. */

  /**
   * 申请开通 a school. Anonymous submissions carry `requestedBy: null`;
   * an authed submitter is recorded so the approving admin can see who asked.
   * Re-submitting the same pending name returns the existing row — repeated
   * taps are idempotent, not a queue of duplicates.
   */
  async submitSchoolRequest(
    body: unknown, requestedBy: string | null, ip?: string,
  ): Promise<SchoolRequestRecord> {
    const input = schoolRequestWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查填写内容')
    if (!this.applyLimiter.consume(`apply:${ip ?? 'unknown'}`)) {
      throw new AuthError(429, 'RATE_LIMITED', '提交过于频繁，请稍后再试')
    }
    const name = input.data.schoolName.trim()
    const pending = [...this.requests.entries()]
      .map(([, request]) => request)
      .find(request => request.status === 'pending'
        && request.schoolName.trim().toLowerCase() === name.toLowerCase())
    if (pending !== undefined) return pending

    const id = `sr_${crypto.randomBytes(9).toString('base64url')}`
    const record: SchoolRequestRecord = {
      id,
      schoolName: name,
      contact: input.data.contact.trim(),
      status: 'pending',
      requestedBy,
      createdAt: new Date().toISOString(),
    }
    await this.requests.put(id, record)
    return record
  }

  /** Applications queue — SUPER_ADMIN only; newest first, optional status filter. */
  listSchoolRequests(actor: AdminActor, status?: string): SchoolRequestRecord[] {
    this.requireSuper(actor)
    return [...this.requests.entries()]
      .map(([, request]) => request)
      .filter(request => status === undefined || request.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /**
   * Approve an application: create its school tenant and seed the first
   * SCHOOL_ADMIN with the approver-chosen credentials. Re-deciding a decided
   * request is rejected rather than replayed.
   */
  async approveSchoolRequest(
    actor: AdminActor, requestId: string, body: unknown,
  ): Promise<{ school: School; admin: AdminUserRow }> {
    this.requireSuper(actor)
    const input = approveRequestWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查填写内容')
    const request = this.requests.get(requestId)
    if (request === undefined) throw new AuthError(404, 'NOT_FOUND', '申请不存在')
    if (request.status !== 'pending') throw new AuthError(400, 'BAD_REQUEST', '该申请已处理')

    const { schoolId, shortName, adminUsername, adminDisplayName, adminPassword } = input.data
    if (this.schools.get(schoolId) !== undefined) {
      throw new AuthError(409, 'SCHOOL_TAKEN', '该学校标识已被使用')
    }
    const key = userKey(schoolId, adminUsername)
    if (this.users.get(key) !== undefined) {
      throw new AuthError(409, 'USERNAME_TAKEN', '该账号已被注册')
    }

    const now = new Date().toISOString()
    const school: School = {
      id: schoolId,
      name: request.schoolName,
      ...(shortName !== undefined ? { shortName } : {}),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    await this.schools.put(schoolId, school)
    const admin = await this.createUserRecord(
      schoolId, adminUsername, adminDisplayName, adminPassword, 'SCHOOL_ADMIN',
    )
    await this.requests.put(requestId, {
      ...request, status: 'approved', decidedAt: now, decidedBy: actor.userKey,
    })
    await this.audit(actor, 'school_request.approve', requestId, schoolId, {
      schoolId, adminUsername: admin.username,
    })
    return { school, admin: this.toAdminRow(admin, school) }
  }

  /** Reject an application; the optional reason rides the audit row. */
  async rejectSchoolRequest(
    actor: AdminActor, requestId: string, body: unknown,
  ): Promise<SchoolRequestRecord> {
    this.requireSuper(actor)
    const input = rejectRequestWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查填写内容')
    const request = this.requests.get(requestId)
    if (request === undefined) throw new AuthError(404, 'NOT_FOUND', '申请不存在')
    if (request.status !== 'pending') throw new AuthError(400, 'BAD_REQUEST', '该申请已处理')
    const rejected: SchoolRequestRecord = {
      ...request,
      status: 'rejected',
      decidedAt: new Date().toISOString(),
      decidedBy: actor.userKey,
    }
    await this.requests.put(requestId, rejected)
    await this.audit(actor, 'school_request.reject', requestId, actor.schoolId,
      input.data.reason === undefined ? undefined : { reason: input.data.reason })
    return rejected
  }

  /** Tenant list — SUPER_ADMIN sees all; a school admin sees exactly its own. */
  listSchoolsAdmin(actor: AdminActor): School[] {
    this.requireAdmin(actor)
    const all = [...this.schools.entries()].map(([, school]) => school)
    const visible = actor.role === 'SUPER_ADMIN'
      ? all
      : all.filter(school => school.id === actor.schoolId)
    return visible.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  }

  /** Direct school creation (SUPER_ADMIN), bypassing the application queue. */
  async createSchool(actor: AdminActor, body: unknown): Promise<School> {
    this.requireSuper(actor)
    const input = createSchoolWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查填写内容')
    if (this.schools.get(input.data.id) !== undefined) {
      throw new AuthError(409, 'SCHOOL_TAKEN', '该学校标识已被使用')
    }
    const now = new Date().toISOString()
    const school: School = {
      id: input.data.id,
      name: input.data.name.trim(),
      ...(input.data.shortName !== undefined ? { shortName: input.data.shortName } : {}),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    await this.schools.put(school.id, school)
    await this.audit(actor, 'school.create', school.id, school.id, { name: school.name })
    return school
  }

  /**
   * Enable/disable a tenant (SUPER_ADMIN). Disabling needs no session sweep:
   * `resolveSession` re-checks the school row, so every live session under it
   * fails closed on its next request.
   */
  async setSchoolStatus(actor: AdminActor, schoolId: string, body: unknown): Promise<School> {
    this.requireSuper(actor)
    const input = schoolStatusWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查填写内容')
    const school = this.schools.get(schoolId)
    if (school === undefined) throw new AuthError(404, 'NOT_FOUND', '学校不存在')
    const updated: School = {
      ...school, status: input.data.status, updatedAt: new Date().toISOString(),
    }
    await this.schools.put(schoolId, updated)
    await this.audit(actor, 'school.status', schoolId, schoolId, { status: input.data.status })
    return updated
  }

  /**
   * User list — a school admin's `schoolId` filter is forced to its own tenant
   * regardless of what the wire asked for.
   */
  listUsers(
    actor: AdminActor, filter: { schoolId?: string; role?: string; q?: string },
  ): AdminUserRow[] {
    this.requireAdmin(actor)
    const schoolId = actor.role === 'SUPER_ADMIN' ? filter.schoolId : actor.schoolId
    const needle = filter.q?.trim().toLowerCase()
    return [...this.users.entries()]
      .map(([, user]) => user)
      .filter(user => schoolId === undefined || user.schoolId === schoolId)
      .filter(user => filter.role === undefined || user.role === filter.role)
      .filter(user => needle === undefined || needle === ''
        || user.username.includes(needle)
        || user.displayName.toLowerCase().includes(needle))
      .sort((a, b) => a.schoolId.localeCompare(b.schoolId) || a.username.localeCompare(b.username))
      .map(user => this.toAdminRow(user, this.schools.get(user.schoolId)))
  }

  /**
   * Provision a user. Tenant scope and role ceiling are server-enforced:
   * a school admin only mints STUDENT/TEACHER inside its own school; only a
   * super admin mints SCHOOL_ADMIN. SUPER_ADMIN is not a wire value at all.
   */
  async createUser(actor: AdminActor, body: unknown): Promise<AdminUserRow> {
    this.requireAdmin(actor)
    const input = createUserWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查填写内容')
    /* A school admin cannot even NAME another tenant on a write — the wire
       schoolId must equal their own when present; supers must name one. */
    if (actor.role !== 'SUPER_ADMIN'
        && input.data.schoolId !== undefined
        && input.data.schoolId !== actor.schoolId) {
      throw new AuthError(403, 'FORBIDDEN', '无权管理其他学校')
    }
    const schoolId = actor.role === 'SUPER_ADMIN' ? input.data.schoolId : actor.schoolId
    if (schoolId === undefined) {
      throw new AuthError(400, 'BAD_REQUEST', '请检查填写内容')
    }
    if (ROLE_RANK[input.data.role] > this.manageRank(actor)) {
      throw new AuthError(403, 'FORBIDDEN', '无权创建该角色')
    }
    const school = this.schools.get(schoolId)
    if (school === undefined || school.status !== 'active') {
      throw new AuthError(400, 'SCHOOL_NOT_FOUND', '学校不存在或未开放')
    }
    const record = await this.createUserRecord(
      schoolId, input.data.username, input.data.displayName, input.data.password, input.data.role,
    )
    await this.audit(actor, 'user.create', userKey(schoolId, record.username), schoolId, {
      role: record.role,
    })
    return this.toAdminRow(record, school)
  }

  /**
   * Enable/disable an account. Disabling revokes the target's sessions
   * immediately; the target user itself cannot be a SUPER_ADMIN (those are
   * config-managed) nor the actor (self-lockout).
   */
  async setUserStatus(
    actor: AdminActor, schoolId: string, username: string, body: unknown,
  ): Promise<AdminUserRow> {
    this.requireAdmin(actor)
    const input = userStatusWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查填写内容')
    /* Self-lockout is the more specific rule — it precedes the role ceiling
       so an admin disabling itself gets a plain 400, not a permission wall. */
    if (userKey(schoolId, username) === actor.userKey) {
      throw new AuthError(400, 'BAD_REQUEST', '不能停用自己的账号')
    }
    const target = this.loadManagedTarget(actor, schoolId, username)
    const updated: UserRecord = {
      ...target.record, status: input.data.status, updatedAt: new Date().toISOString(),
    }
    await this.users.put(target.userKey, updated)
    if (input.data.status === 'disabled') await this.revokeUserSessions(target.record)
    await this.audit(actor, 'user.status', target.userKey, schoolId, { status: input.data.status })
    return this.toAdminRow(updated, this.schools.get(schoolId))
  }

  /**
   * Admin-driven password reset (the forgot-password queue's consumer): rehash
   * and revoke every live session so the old password's sessions die with it.
   * The new password never appears in audit detail.
   */
  async resetUserPassword(
    actor: AdminActor, schoolId: string, username: string, body: unknown,
  ): Promise<void> {
    this.requireAdmin(actor)
    const input = resetPasswordWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查填写内容')
    const target = this.loadManagedTarget(actor, schoolId, username)
    await this.users.put(target.userKey, {
      ...target.record,
      passwordHash: hashPassword(input.data.newPassword),
      updatedAt: new Date().toISOString(),
    })
    await this.revokeUserSessions(target.record)
    await this.audit(actor, 'user.reset_password', target.userKey, schoolId)
  }

  /** Revoke every live session of one account without touching its password. */
  async revokeUserSessionsByAdmin(
    actor: AdminActor, schoolId: string, username: string,
  ): Promise<void> {
    this.requireAdmin(actor)
    const target = this.loadManagedTarget(actor, schoolId, username)
    await this.revokeUserSessions(target.record)
    await this.audit(actor, 'user.revoke_sessions', target.userKey, schoolId)
  }

  /**
   * Audit ledger — append-only on the write side; school admins read only
   * their own tenant's rows, supers may narrow with `schoolId`.
   */
  /**
   * The dashboard's data — and ONLY the part the server actually knows.
   *
   * The first layer is derived from rows that exist here: schools, users, live
   * sessions, and the ledger. The SECOND layer — 实验与自测成效 — is NOT derived
   * from the student's 学习记录, which lives in their browser's localStorage
   * (`learning-record-store.ts`) and which this server cannot read. It comes from
   * a separate opt-in channel instead: {@link reportLearning} accumulates one
   * right/wrong per knowledge tag per self-check into (school, day, knowledge
   * tag) cells that carry no account and no answer text. A deployment nobody has
   * used yet reports `available: false` — the panel says so rather than printing
   * a fabricated zero.
   *
   * Counts are scoped exactly like every other admin read: a SUPER_ADMIN sees
   * the platform, anyone else sees their own tenant.
   */
  dashboard(actor: AdminActor): {
    schools: { total: number; active: number; disabled: number }
    users: { total: number; byRole: Record<string, number>; disabled: number }
    sessions: { live: number; distinctUsers: number }
    activity: { date: string; logins: number; created: number }[]
    limiters: Record<'login' | 'ip' | 'apply', { tracked: number; saturated: number; limit: number; windowMs: number }>
    /**
     * 第二层:来自 {@link reportLearning} 的聚合计数。`available` 为 false 时
     * 是「这台部署还没有人上报过」,不是「零正确率」——界面据此说人话,而不是
     * 画一根 0% 的柱子。
     */
    learning: {
      available: boolean
      attempts: number
      correct: number
      wrong: number
      nodes: { knowledgeId: string; correct: number; wrong: number }[]
      days: number
    }
  } {
    this.requireAdmin(actor)
    const scope = actor.role === 'SUPER_ADMIN' ? undefined : actor.schoolId
    const now = Date.now()

    const schools = [...this.schools.entries()]
      .map(([, school]) => school)
      .filter(school => scope === undefined || school.id === scope)

    const users = [...this.users.entries()]
      .map(([, user]) => user)
      .filter(user => scope === undefined || user.schoolId === scope)

    /* A session is "live" under the same three conditions resolution checks:
       not revoked, not expired, and its account still active. A dashboard that
       counted rows instead of resolvable sessions would report logins that the
       next request answers 401 to. */
    const activeKeys = new Set(users.filter(u => u.status === 'active')
      .map(u => userKey(u.schoolId, u.username)))
    const sessions = [...this.sessions.entries()]
      .map(([, session]) => session)
      .filter(session => scope === undefined || session.schoolId === scope)
      .filter(session => session.revokedAt === undefined)
      .filter(session => Date.parse(session.expiresAt) > now)
      .filter(session => activeKeys.has(userKey(session.schoolId, session.username)))

    const byRole: Record<string, number> = {
      STUDENT: 0, TEACHER: 0, SCHOOL_ADMIN: 0, SUPER_ADMIN: 0,
    }
    for (const user of users) byRole[user.role] = (byRole[user.role] ?? 0) + 1

    /* Fourteen days, oldest first: a trend line people read left to right. */
    const dayOf = (iso: string): string => iso.slice(0, 10)
    const activity: { date: string; logins: number; created: number }[] = []
    for (let back = 13; back >= 0; back -= 1) {
      const date = new Date(now - back * 86_400_000).toISOString().slice(0, 10)
      activity.push({
        date,
        logins: users.filter(user => user.lastLoginAt !== undefined && dayOf(user.lastLoginAt) === date).length,
        created: users.filter(user => dayOf(user.createdAt) === date).length,
      })
    }

    /* 第二层:聚合计数。`scope` 与上面一致 —— 校管理员只看到自己学校。行里
       本来就没有账号,所以这里连「去标识」都不用做,直接求和即可。 */
    const learningRows = [...this.learningCounts.entries()]
      .map(([, row]) => row)
      .filter(row => scope === undefined || row.schoolId === scope)
    const nodeTotals = new Map<string, { correct: number; wrong: number }>()
    for (const row of learningRows) {
      const entry = nodeTotals.get(row.knowledgeId) ?? { correct: 0, wrong: 0 }
      entry.correct += row.correct
      entry.wrong += row.wrong
      nodeTotals.set(row.knowledgeId, entry)
    }
    const learning = {
      available: learningRows.length > 0,
      attempts: learningRows.reduce((sum, row) => sum + row.correct + row.wrong, 0),
      correct: learningRows.reduce((sum, row) => sum + row.correct, 0),
      wrong: learningRows.reduce((sum, row) => sum + row.wrong, 0),
      /* 错得多的排在前面 —— 看板是拿来决定「下一节课讲什么」的。 */
      nodes: [...nodeTotals.entries()]
        .map(([knowledgeId, totals]) => ({ knowledgeId, ...totals }))
        .sort((l, r) => (r.wrong - r.correct) - (l.wrong - l.correct)),
      days: new Set(learningRows.map(row => row.date)).size,
    }

    return {
      schools: {
        total: schools.length,
        active: schools.filter(school => school.status === 'active').length,
        disabled: schools.filter(school => school.status === 'disabled').length,
      },
      users: {
        total: users.length,
        byRole,
        disabled: users.filter(user => user.status === 'disabled').length,
      },
      sessions: {
        live: sessions.length,
        distinctUsers: new Set(sessions.map(s => userKey(s.schoolId, s.username))).size,
      },
      activity,
      /* Abuse posture, not a guest list: counts of in-flight buckets and how
         many are at the ceiling, with no IPs and no usernames. */
      limiters: {
        login: this.accountLimiter.snapshot(now),
        ip: this.ipLimiter.snapshot(now),
        apply: this.applyLimiter.snapshot(now),
      },
      learning,
    }
  }

  listAudit(
    actor: AdminActor, filter: { schoolId?: string; limit?: number },
  ): AuditEvent[] {
    this.requireAdmin(actor)
    const schoolId = actor.role === 'SUPER_ADMIN' ? filter.schoolId : actor.schoolId
    const limit = filter.limit ?? 200
    return [...this.audits.entries()]
      .map(([, event]) => event)
      .filter(event => schoolId === undefined || event.schoolId === schoolId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
  }

  /** Resolve the actor + target into a managed row, or throw 403/404. */
  private loadManagedTarget(
    actor: AdminActor, schoolId: string, username: string,
  ): { userKey: string; record: UserRecord } {
    if (actor.role !== 'SUPER_ADMIN' && schoolId !== actor.schoolId) {
      throw new AuthError(403, 'FORBIDDEN', '无权管理其他学校')
    }
    const key = userKey(schoolId, username)
    const record = this.users.get(key)
    if (record === undefined) throw new AuthError(404, 'NOT_FOUND', '账号不存在')
    /* SUPER_ADMIN rows are config-managed — no API path mutates them. */
    if (ROLE_RANK[record.role] > this.manageRank(actor)) {
      throw new AuthError(403, 'FORBIDDEN', '无权管理该账号')
    }
    return { userKey: key, record }
  }

  /**
   * 收一条学习上报 —— 聚合,且只聚合。
   *
   * 这个方法的形状就是它对未成年人数据的全部承诺,所以逐条写清:
   *
   *   - 收:学校(取会话,不信请求体)、日期(取服务端 UTC 时钟)、知识点 id
   *     (必须是课标知识点 id 的形状)、这一次对错。
   *   - 不收:账号 / userId、学生答案原文、题目原文、自由文本、IP、设备指纹。
   *     落库的行里没有 `userKey`,所以事后无法从这张表反查「谁答错了什么」。
   *   - 不写审计:审计是「谁改了什么」,而这里刻意没有「谁」。
   *
   * 键是 `schoolId|date|knowledgeId`,所以一行就是一个小格子 —— 这也是为什么
   * 它答不了「个体学情」:那需要账号,而账号正是我们决定不收的东西。
   * @param actor - 服务端解析出的账号(只取它的学校)。
   * @param body - 上报体,只有 `knowledgeId` 与 `correct`。
   * @returns 更新后的格子。
   */
  async reportLearning(actor: AdminActor, body: unknown): Promise<LearningCount> {
    const input = learningReportWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查上报内容')
    const now = new Date()
    /* 日期取宿主本地时间,不是 UTC。对一所贵州的学校来说,UTC 的日界落在当地
       早上 8 点 —— 晚自习做的那批自测会被算进「昨天」,而这正是看板要回答的
       「今天这个知识点错得多不多」。所以这里是 local date,不是 toISOString。 */
    const date = localDate(now)
    const key = learningKey(actor.schoolId, date, input.data.knowledgeId)
    const existing = this.learningCounts.get(key)
    const record: LearningCount = {
      id: key,
      schoolId: actor.schoolId,
      date,
      knowledgeId: input.data.knowledgeId,
      correct: (existing?.correct ?? 0) + (input.data.correct ? 1 : 0),
      wrong: (existing?.wrong ?? 0) + (input.data.correct ? 0 : 1),
      updatedAt: now.toISOString(),
    }
    await this.learningCounts.put(key, record)
    return record
  }

  private requireAdmin(actor: AdminActor): void {
    if (actor.role !== 'SCHOOL_ADMIN' && actor.role !== 'SUPER_ADMIN') {
      throw new AuthError(403, 'FORBIDDEN', '需要管理员权限')
    }
  }

  private requireSuper(actor: AdminActor): void {
    if (actor.role !== 'SUPER_ADMIN') {
      throw new AuthError(403, 'FORBIDDEN', '需要平台管理员权限')
    }
  }

  /** Highest role rank this actor may create or mutate. */
  private manageRank(actor: AdminActor): number {
    return actor.role === 'SUPER_ADMIN' ? ROLE_RANK.SCHOOL_ADMIN
      : actor.role === 'SCHOOL_ADMIN' ? ROLE_RANK.TEACHER
        : -1
  }

  private async createUserRecord(
    schoolId: string, username: string, displayName: string,
    password: string, role: UserRecord['role'],
  ): Promise<UserRecord> {
    const key = userKey(schoolId, username)
    if (this.users.get(key) !== undefined) {
      throw new AuthError(409, 'USERNAME_TAKEN', '该账号已被注册')
    }
    const now = new Date().toISOString()
    const record: UserRecord = {
      id: `u_${crypto.randomBytes(9).toString('base64url')}`,
      schoolId,
      username: username.toLowerCase(),
      passwordHash: hashPassword(password),
      displayName,
      role,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    await this.users.put(key, record)
    return record
  }

  private async revokeUserSessions(record: UserRecord): Promise<void> {
    const now = new Date().toISOString()
    for (const [id, session] of this.sessions.entries()) {
      if (session.schoolId === record.schoolId && session.username === record.username
        && session.revokedAt === undefined) {
        await this.sessions.put(id, { ...session, revokedAt: now })
      }
    }
  }

  /**
   * Public door onto the same ledger {@link audit} writes.
   *
   * Another host that guards its own routes appends here through the identity
   * service, so "a teacher published a paper" and "an admin disabled a school"
   * end up in ONE trail with one shape — rather than a second audit log nobody
   * remembers to read. The school comes from the actor, so a caller cannot file
   * an action under a tenant it is not acting in.
   */
  async auditAs(
    actor: Pick<AdminActor, 'userKey' | 'schoolId'>,
    action: string,
    target: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit(
      { ...actor, username: '', role: 'STUDENT' },
      action,
      target,
      actor.schoolId,
      detail,
    )
  }

  private async audit(
    actor: AdminActor, action: string, target: string, schoolId: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    const id = `au_${crypto.randomBytes(9).toString('base64url')}`
    await this.audits.put(id, {
      id,
      actorKey: actor.userKey,
      schoolId,
      action,
      target,
      ...(detail !== undefined ? { detail } : {}),
      createdAt: new Date().toISOString(),
    })
  }

  private get requests() { return this.domain.table('school_requests') }
  private get audits() { return this.domain.table('admin_audit') }
  /** 匿名聚合计数,键 `schoolId|date|knowledgeId`。 */
  private get learningCounts() { return this.domain.table('learning_counts') }

  private toAdminRow(user: UserRecord, school: School | undefined): AdminUserRow {
    return {
      ...this.toPublic(user, school ?? { id: user.schoolId, name: user.schoolId, status: 'active', createdAt: '', updatedAt: '' }),
      status: user.status,
      createdAt: user.createdAt,
      ...(user.lastLoginAt !== undefined ? { lastLoginAt: user.lastLoginAt } : {}),
    }
  }

  private toPublic(user: UserRecord, school: School): PublicUser {
    const pub: PublicUser = {
      id: user.id,
      schoolId: school.id,
      schoolName: school.name,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    }
    if (school.shortName !== undefined) pub.schoolShortName = school.shortName
    if (user.avatarUrl !== undefined) pub.avatarUrl = user.avatarUrl
    return pub
  }
}
