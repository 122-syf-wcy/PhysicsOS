/**
 * Auth domain service — every decision a route can take funnels through here.
 * Never trusts client-supplied ids beyond the wire schema: `role` is pinned,
 * `schoolId` must resolve to an active tenant row, and session authority is
 * the hashed token alone. Error codes are the public contract; messages are
 * deliberately non-identifying to blunt enumeration.
 */

import crypto from 'node:crypto'
import type {
  ApiTokenRecord, AuditEvent, AuthDomain, DeviceRecord, DeviceRevocation, InviteRecord,
  LearningCount, School, ResetRequest, SchoolRequestRecord, SessionRecord, UserRecord,
} from './domain'
import {
  approveRequestWire, auditExportWire, createApiTokenWire, createInvitesWire,
  createSchoolWire, createUserWire, deviceIdWire, deviceKey, deviceRevocationKey,
  forgotWire, GLOBAL_DEVICE_SCOPE, learningKey, learningReportWire, loginTwoFactorWire,
  loginWire, passwordResetWire, registerDeviceWire, registerWire, rejectRequestWire,
  resetPasswordWire, schoolRequestWire, schoolStatusWire, totpDisableWire,
  totpVerifyWire, userKey, userStatusWire,
} from './domain'
import { hashPassword, verifyPassword } from './passwords'
import { newSessionToken, readSessionCookieHeader, sessionTokenHash } from './cookies'
import type { IdentityActor } from './identity'
import {
  InMemoryLimiterBackend, type LimiterBackend, type LimiterName,
  type LimiterPolicy, type LimiterSnapshot,
} from './limiter'
import { newPasswordResetToken, passwordResetPath, passwordResetTokenHash } from './reset'
import {
  QUEUE_PASSWORD_RESET_DELIVERY, type PasswordResetDelivery,
} from './reset-delivery'
import {
  generateRecoveryCode, generateTotpSecret, recoveryCodeHash, verifyTotpCode,
} from './totp'
import {
  hashOpaqueCredential, newApiToken, newInviteCode, newLoginChallengeToken,
  readBearerToken,
} from './tokens'

/** Public error codes — the only failure vocabulary the wire exposes. */
export type AuthErrorCode =
  | 'BAD_REQUEST' | 'SCHOOL_NOT_FOUND' | 'USERNAME_TAKEN' | 'SCHOOL_TAKEN'
  | 'SCHOOL_REQUIRED' | 'SCHOOL_AMBIGUOUS'
  | 'INVALID_CREDENTIALS' | 'RATE_LIMITED' | 'UNAUTHENTICATED'
  | 'FORBIDDEN' | 'NOT_FOUND' | 'DEVICE_REVOKED'
  | 'INVALID_RESET_TOKEN' | 'DEPENDENCY_UNAVAILABLE'
  | 'REGISTRATION_CLOSED' | 'INVITE_REQUIRED' | 'INVALID_INVITE_CODE'
  | 'TWO_FACTOR_REQUIRED' | 'INVALID_TWO_FACTOR_CHALLENGE' | 'INVALID_TWO_FACTOR_CODE'
  | 'TWO_FACTOR_ALREADY_ENABLED' | 'TOKEN_SCOPE_REQUIRED'

/** The only failure shape the wire exposes — `{error:{code,message,...details}}`. */
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

/** A successful register/login: the minted token plus the public principal. */
export interface LoginResult {
  token: string
  expiresAt: string
  /** Seconds the cookie should live when `rememberDevice` was set; else 0 → session cookie. */
  cookieMaxAge: number
  user: PublicUser
}

/** Password succeeded, but this account still needs a TOTP or recovery code. */
export interface TwoFactorChallenge {
  twoFactorRequired: true
  challengeToken: string
  expiresAt: string
}

/** Registration policy; invite is intentionally fail-closed. */
export type RegistrationMode = 'open' | 'invite' | 'closed'

/** Personal-token authority. Read tokens cannot call mutating API methods. */
export type ApiTokenScope = 'read' | 'write'

/** The credential that authenticated one request. */
export type AuthCredential =
  | { kind: 'session'; session: SessionRecord }
  | { kind: 'api-token'; token: ApiTokenRecord; scope: ApiTokenScope }

/** One resolved request principal plus the credential authorizing it. */
export interface ResolvedCredential {
  user: PublicUser
  actor: AdminActor
  credential: AuthCredential
}

/** A live session's principal — the public user plus the session row that resolved it. */
export interface ResolvedSession {
  user: PublicUser
  session: SessionRecord
}

/**
 * 一条风控信号 —— 只说明「哪个主体、在多大窗口里、出现了多少次」。
 *
 * 有意不携带 IP:地址只在计数时用过,出了这个函数就没了。`subject` 要么是
 * 账号键、要么是设备哈希,两者都不是自然人的身份。
 */
export interface RiskSignal {
  kind: 'account-multi-device' | 'device-multi-ip'
  subject: string
  count: number
  windowMs: number
}

/** 风控观察窗 —— 24 小时,够覆盖一个寄宿学校的作息。 */
const RISK_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * 达到几条才值得看一眼。3 是「记录与展示」的阈值,不是封禁线 —— 同一个学生
 * 换台电脑、教职工在家和办公室各登录一次,都不该报警。
 */
const RISK_THRESHOLD = 3

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

/** Admin queue row — never includes a token, its hash, or the source IP. */
export interface PasswordResetQueueRow {
  id: string
  schoolId: string
  schoolName: string
  username: string
  displayName: string
  status: ResetRequest['status']
  delivery: ResetRequest['delivery']
  at: string
  issuedAt?: string
  expiresAt?: string
  usedAt?: string
  cancelledAt?: string
  deliveryError?: string
}

/** Shared one-time ledger subset used to serialize invite consumption. */
export interface InviteClaimLedger {
  readonly kind: string
  claim(
    key: string,
    ttlSeconds: number,
    now?: number,
  ): { status: 'claimed' | 'already-claimed'; expiresAt: number } | Promise<{
    status: 'claimed' | 'already-claimed'
    expiresAt: number
  }>
  release(key: string, now?: number): void | Promise<void>
}

/** One admin-facing invite row; raw codes never appear after creation. */
export interface InviteRow {
  id: string
  codeMasked: string
  schoolId: string
  schoolName: string
  maxUses: number
  usedCount: number
  createdAt: string
  expiresAt?: string
  disabledAt?: string
}

/** One admin-facing personal-token row; only a display mask is returned. */
export interface ApiTokenRow {
  id: string
  name: string
  scope: ApiTokenScope
  tokenMasked: string
  createdAt: string
  expiresAt?: string
  revokedAt?: string
}

/** Optional runtime seams; absent values use safe process-local defaults. */
export interface AuthServiceDeps {
  /** Atomic shared limiter. Defaults to {@link InMemoryLimiterBackend}. */
  limiter?: LimiterBackend
  /** Password-reset delivery. Defaults to the admin queue (no direct send). */
  resetDelivery?: PasswordResetDelivery
  /** Injectable clock for expiry tests and deterministic deployments. */
  now?: () => Date
  /** Optional shared lock for invite consumption across app instances. */
  onceLedger?: InviteClaimLedger
  /** Client handoff path; defaults to `/?reset_token=<token>`. */
  resetPath?: (token: string) => string
}

/** Management ceiling order — SUPER_ADMIN itself is never API-managed. */
const ROLE_RANK: Record<UserRecord['role'], number> = {
  STUDENT: 0,
  TEACHER: 1,
  SCHOOL_ADMIN: 2,
  SUPER_ADMIN: 3,
}

/** Tunable lifetimes and rate-limit budgets, all cordis.yml-configurable. */
export interface AuthServiceConfig {
  /** Non-remembered session lifetime (ms). Default 12h. */
  sessionTtlMs: number
  /** Remembered session lifetime (ms) — also the cookie Max-Age. Default 30d. */
  rememberTtlMs: number
  /** Failed logins allowed per account within the window. Default 5. */
  accountAttemptLimit: number
  /** Failed logins allowed per source IP within the window. Default 20. */
  ipAttemptLimit: number
  /** Anonymous school applications allowed per source IP within the window. Default 10. */
  applyAttemptLimit: number
  /** Student registrations allowed per source IP within the window. Default 10. */
  registrationAttemptLimit?: number
  /** Learning reports allowed per account within the window. Default 120. */
  learningAttemptLimit?: number
  /** Forgot/reset attempts allowed by source or account within the window. Default 10. */
  passwordResetAttemptLimit?: number
  /** Password-reset token lifetime. Default 30min. */
  passwordResetTtlMs?: number
  /** Registration admission policy. Default `open` for backward compatibility. */
  registrationMode?: RegistrationMode
  /** TOTP/recovery-code attempts per account within the window. Default 5. */
  totpAttemptLimit?: number
  /** TOTP challenge lifetime. Default 5min. */
  totpChallengeTtlMs?: number
  /** Maximum live personal tokens per account. Default 50. */
  apiTokenLimit?: number
  /** Exact IP literals of proxies allowed to supply forwarded client metadata. */
  trustedProxies?: string[]
  /** Maximum live buckets per limiter. Default 10000. */
  attemptBucketLimit?: number
  /** Rate-limit window (ms). Default 10min. */
  attemptWindowMs: number
}

/** The secure-by-default config values; a deployment overrides per field. */
export const DEFAULT_AUTH_CONFIG: Required<AuthServiceConfig> = {
  sessionTtlMs: 12 * 60 * 60 * 1000,
  rememberTtlMs: 30 * 24 * 60 * 60 * 1000,
  accountAttemptLimit: 5,
  ipAttemptLimit: 20,
  applyAttemptLimit: 10,
  registrationAttemptLimit: 60,
  learningAttemptLimit: 120,
  passwordResetAttemptLimit: 10,
  passwordResetTtlMs: 30 * 60 * 1000,
  registrationMode: 'open',
  totpAttemptLimit: 5,
  totpChallengeTtlMs: 5 * 60 * 1000,
  apiTokenLimit: 50,
  trustedProxies: [],
  attemptBucketLimit: 10_000,
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

/**
 * The auth rules over the `physicsos_auth` domain: school-tenant registration
 * and login, cookie sessions, attempt limiting, the admin surface, device
 * registration/revocation, and the anonymous learning-aggregate channel.
 */
export class AuthService {
  private readonly limiter: LimiterBackend
  private readonly policies: Record<LimiterName, LimiterPolicy>
  private readonly resetDelivery: PasswordResetDelivery
  private readonly now: () => Date
  private readonly resetPath: (token: string) => string
  private readonly onceLedger: InviteClaimLedger | undefined

  constructor(
    private readonly domain: AuthDomain,
    readonly config: AuthServiceConfig = DEFAULT_AUTH_CONFIG,
    deps: AuthServiceDeps = {},
  ) {
    const maxBuckets = config.attemptBucketLimit ?? DEFAULT_AUTH_CONFIG.attemptBucketLimit
    const policy = (name: LimiterName, limit: number): LimiterPolicy => ({
      name,
      limit,
      windowMs: config.attemptWindowMs,
      maxBuckets,
    })
    this.policies = {
      login: policy('login', config.accountAttemptLimit),
      ip: policy('ip', config.ipAttemptLimit),
      apply: policy('apply', config.applyAttemptLimit),
      registration: policy(
        'registration',
        config.registrationAttemptLimit ?? DEFAULT_AUTH_CONFIG.registrationAttemptLimit,
      ),
      learning: policy(
        'learning',
        config.learningAttemptLimit ?? DEFAULT_AUTH_CONFIG.learningAttemptLimit,
      ),
      passwordReset: policy(
        'passwordReset',
        config.passwordResetAttemptLimit ?? DEFAULT_AUTH_CONFIG.passwordResetAttemptLimit,
      ),
      totp: policy(
        'totp',
        config.totpAttemptLimit ?? DEFAULT_AUTH_CONFIG.totpAttemptLimit,
      ),
    }
    this.limiter = deps.limiter ?? new InMemoryLimiterBackend()
    this.resetDelivery = deps.resetDelivery ?? QUEUE_PASSWORD_RESET_DELIVERY
    this.now = deps.now ?? (() => new Date())
    this.resetPath = deps.resetPath ?? passwordResetPath
    this.onceLedger = deps.onceLedger
  }

  private get schools() { return this.domain.table('schools') }
  private get users() { return this.domain.table('users') }
  private get invites() { return this.domain.table('invites') }
  private get apiTokens() { return this.domain.table('api_tokens') }
  private get loginChallenges() { return this.domain.table('login_challenges') }
  private get recoveryCodes() { return this.domain.table('totp_recovery_codes') }
  private get sessions() { return this.domain.table('sessions') }
  private get resets() { return this.domain.table('reset_requests') }
  private get resetTokens() { return this.domain.table('password_reset_tokens') }
  private get apiResources() { return this.domain.table('api_resources') }

  /**
   * Whether an account owns one Harness session/workspace. Platform
   * administrators retain an unscoped troubleshooting view.
   * @param actor - the server-resolved account.
   * @param kind - session or workspace.
   * @param id - the Harness resource id.
   * @returns whether the actor may address the resource.
   */
  ownsApiResource(actor: IdentityActor, kind: 'session' | 'workspace', id: string): boolean {
    if (actor.role === 'SUPER_ADMIN') return true
    return this.apiResources.get(`${kind}:${id}`)?.ownerKey === actor.userKey
  }

  /**
   * The resources owned by one account, used to filter list responses.
   * @param actor - the server-resolved account.
   * @param kind - session or workspace.
   * @returns owned resource ids; a platform administrator sees every row.
   */
  ownedApiResources(actor: IdentityActor, kind: 'session' | 'workspace'): Set<string> {
    const rows = [...this.apiResources.entries()]
      .map(([, row]) => row)
      .filter(row => row.kind === kind)
      .filter(row => actor.role === 'SUPER_ADMIN' || row.ownerKey === actor.userKey)
    return new Set(rows.map(row => row.resourceId))
  }

  /**
   * Claim a newly-created Harness resource for one account. A resource never
   * changes owner: an existing row with another owner is indistinguishable
   * from absence at the request boundary.
   * @param actor - the server-resolved account.
   * @param kind - session or workspace.
   * @param id - the Harness resource id.
   */
  async claimApiResource(actor: IdentityActor, kind: 'session' | 'workspace', id: string): Promise<void> {
    const key = `${kind}:${id}`
    const existing = this.apiResources.get(key)
    if (existing !== undefined) {
      if (existing.ownerKey !== actor.userKey) {
        throw new AuthError(403, 'NOT_FOUND', `${kind} "${id}" not found`)
      }
      return
    }
    await this.apiResources.put(key, {
      id: key,
      kind,
      resourceId: id,
      ownerKey: actor.userKey,
      schoolId: actor.schoolId,
      createdAt: new Date().toISOString(),
    })
  }

  /**
   * Release one resource after its owning account deletes it.
   * @param actor - the server-resolved account.
   * @param kind - session or workspace.
   * @param id - the Harness resource id.
   */
  async releaseApiResource(actor: IdentityActor, kind: 'session' | 'workspace', id: string): Promise<void> {
    const key = `${kind}:${id}`
    const existing = this.apiResources.get(key)
    if (existing === undefined) return
    if (actor.role !== 'SUPER_ADMIN' && existing.ownerKey !== actor.userKey) {
      throw new AuthError(403, 'NOT_FOUND', `${kind} "${id}" not found`)
    }
    await this.apiResources.delete(key)
  }

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
   * Consume one slot from the configured shared backend. Backend failures are
   * translated to an explicit 503 and never fall through to an unlimited path.
   */
  private async allow(
    name: LimiterName,
    key: string,
    message = '尝试过于频繁，请稍后再试',
  ): Promise<void> {
    try {
      if (!(await this.limiter.consume(this.policies[name], key))) {
        throw new AuthError(429, 'RATE_LIMITED', message)
      }
    } catch (error) {
      if (error instanceof AuthError) throw error
      throw new AuthError(503, 'DEPENDENCY_UNAVAILABLE', '限流服务暂时不可用，请稍后再试')
    }
  }

  private async clearLimit(name: LimiterName, key: string): Promise<void> {
    try {
      await this.limiter.reset?.(this.policies[name], key)
    } catch {
      throw new AuthError(503, 'DEPENDENCY_UNAVAILABLE', '限流服务暂时不可用，请稍后再试')
    }
  }

  private async limiterSnapshot(name: LimiterName): Promise<LimiterSnapshot & { available: boolean }> {
    const policy = this.policies[name]
    try {
      const snapshot = await this.limiter.snapshot?.(policy)
      return snapshot === undefined
        ? {
          tracked: 0,
          saturated: 0,
          limit: policy.limit,
          windowMs: policy.windowMs,
          backend: this.limiter.kind,
          available: false,
        }
        : { ...snapshot, backend: this.limiter.kind, available: true }
    } catch {
      return {
        tracked: 0,
        saturated: 0,
        limit: policy.limit,
        windowMs: policy.windowMs,
        backend: this.limiter.kind,
        available: false,
      }
    }
  }

  /**
   * Atomically increment one invite use before the account write. The domain
   * write chain makes the read-modify-write operation non-interleaving; a
   * rollback restores the exact prior count if the account write fails.
   */
  private async consumeInvite(rawCode: string, schoolId: string): Promise<InviteRecord> {
    const codeHash = hashOpaqueCredential(rawCode)
    const lockKey = `invite-consume:${codeHash}`
    let locked = false
    if (this.onceLedger !== undefined) {
      try {
        const claim = await this.onceLedger.claim(lockKey, 15)
        if (claim.status !== 'claimed') {
          throw new AuthError(429, 'RATE_LIMITED', '邀请码正在被使用，请稍后重试')
        }
        locked = true
      } catch (error) {
        if (error instanceof AuthError) throw error
        throw new AuthError(503, 'DEPENDENCY_UNAVAILABLE', '邀请码服务暂时不可用，请稍后再试')
      }
    }
    try {
      return await this.invites.update(codeHash, (row) => {
        const unusable = row.schoolId !== schoolId
          || row.disabledAt !== undefined
          || row.usedCount >= row.maxUses
          || (row.expiresAt !== undefined && Date.parse(row.expiresAt) <= this.now().getTime())
        if (unusable) throw new AuthError(400, 'INVALID_INVITE_CODE', '邀请码无效或已失效')
        return { ...row, usedCount: row.usedCount + 1 }
      })
    } catch (error) {
      if (error instanceof AuthError) throw error
      throw new AuthError(503, 'DEPENDENCY_UNAVAILABLE', '邀请码服务暂时不可用，请稍后再试')
    } finally {
      if (locked && this.onceLedger !== undefined) {
        try {
          await this.onceLedger.release(lockKey)
        } catch {
          /* The short lock TTL is the recovery path; the invite write is done. */
        }
      }
    }
  }

  /**
   * Register a student account under a school tenant, then issue its first
   * session — the caller just proved the password, so a second verify would
   * only spend argon2 for nothing. The tenant list is fixed by the roster
   * seeds: an unlisted `schoolName` is a `SCHOOL_NOT_FOUND`, never a new
   * tenant — name variants would otherwise fork one school per spelling.
   * `role` is pinned server-side: teacher/admin enrolment is a future admin
   * surface, not wire input.
   * @param body - the wire body (`registerWire`): credentials plus a school selector.
   * @param ip - the source IP for the register-path attempt ledger.
   * @param userAgent - the client UA stored on the session row.
   * @returns the fresh session token and public principal.
   */
  async register(body: unknown, ip?: string, userAgent?: string): Promise<LoginResult> {
    const input = registerWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查填写内容')
    const { username, displayName, password } = input.data
    const sourceIp = ip ?? 'unknown'
    await this.allow('registration', `ip:${sourceIp}`, '注册请求过于频繁，请稍后再试')
    const registrationMode = this.config.registrationMode ?? DEFAULT_AUTH_CONFIG.registrationMode
    if (registrationMode === 'closed') {
      throw new AuthError(403, 'REGISTRATION_CLOSED', '当前未开放注册')
    }
    if (registrationMode === 'invite' && input.data.inviteCode === undefined) {
      throw new AuthError(403, 'INVITE_REQUIRED', '当前仅限邀请注册')
    }

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
    const invite = input.data.inviteCode === undefined
      ? undefined
      : await this.consumeInvite(input.data.inviteCode, school.id)
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
    try {
      await this.users.put(key, record)
    } catch (error) {
      if (invite !== undefined) await this.invites.put(invite.id, invite)
      throw error
    }
    if (invite !== undefined) {
      await this.audit(
        { userKey: key, schoolId: school.id, username: record.username, role: record.role },
        'invite.use',
        invite.id,
        school.id,
        { usedCount: invite.usedCount + 1 },
      )
    }
    if (input.data.deviceId !== undefined) {
      await this.touchDevice(record, input.data.deviceId)
    }
    return this.issueSession(record, school, false, ip, userAgent, input.data.deviceId)
  }

  /**
   * Authenticate `username + password` — the host resolves the tenant, so the
   * user never picks a school. All reject paths collapse to
   * `INVALID_CREDENTIALS` (or `RATE_LIMITED`); a missing account still pays
   * the argon2 cost via a dummy verify so timing does not reveal it. When the
   * same username exists in several schools and the password matches more
   * than one, the caller gets `SCHOOL_REQUIRED` with the matching schools —
   * the only moment a school list ever reaches the wire.
   * @param body - the wire body (`loginWire`): `username`, `password`, `rememberDevice`, `deviceId`.
   * @param ip - the source IP, shared into the IP attempt bucket and stored on the session.
   * @param userAgent - the client UA stored on the session row.
   * @returns a session result, or a short-lived TOTP challenge when enabled.
   */
  async login(
    body: unknown,
    ip?: string,
    userAgent?: string,
  ): Promise<LoginResult | TwoFactorChallenge> {
    const input = loginWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查填写内容')
    const { username, password } = input.data
    const remember = input.data.rememberDevice === true
    const sourceIp = ip ?? 'unknown'

    await this.allow('ip', `ip:${sourceIp}`)
    const accountKey = `acct:${username.toLowerCase()}`
    await this.allow('login', accountKey)

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
    await this.clearLimit('login', accountKey)
    const match = matches[0]
    if (match === undefined) {
      throw new AuthError(401, 'INVALID_CREDENTIALS', '账号或密码错误')
    }
    const { record, school } = match
    /* 设备闸门在签发会话之前:被注销的机器不该拿到一张新 cookie,否则「远程
       注销」只能等下一条路由自己再判一次,漏一处就是一个缺口。 */
    if (input.data.deviceId !== undefined) {
      this.assertDeviceUsable(record, input.data.deviceId)
    }
    if (record.totp !== undefined) {
      return this.issueLoginChallenge(
        record,
        school,
        remember,
        sourceIp,
        userAgent,
        input.data.deviceId,
      )
    }
    return this.completeLogin(
      record,
      school,
      remember,
      sourceIp,
      userAgent,
      input.data.deviceId,
    )
  }

  /**
   * Complete the second login step. The challenge is single-use, short-lived,
   * and bound to the user, remembered-device choice, IP, and optional device.
   */
  async loginTwoFactor(
    body: unknown,
    ip?: string,
    userAgent?: string,
  ): Promise<LoginResult> {
    const input = loginTwoFactorWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查验证码')
    const challengeHash = hashOpaqueCredential(input.data.challengeToken)
    await this.allow('totp', `challenge:${challengeHash}`, '验证码尝试过于频繁，请稍后再试')
    const challenge = this.loginChallenges.get(challengeHash)
    if (challenge === undefined || challenge.usedAt !== undefined
      || Date.parse(challenge.expiresAt) <= this.now().getTime()
      || this.claimedLoginChallenges.has(challengeHash)) {
      throw new AuthError(401, 'INVALID_TWO_FACTOR_CHALLENGE', '二次验证已失效，请重新登录')
    }
    await this.allow('totp', `acct:${challenge.userKey}`, '验证码尝试过于频繁，请稍后再试')

    const record = this.users.get(challenge.userKey)
    const school = this.schools.get(challenge.schoolId)
    if (record === undefined || school === undefined || record.totp === undefined
      || record.status !== 'active' || school.status !== 'active'
      || record.id !== challenge.userId) {
      throw new AuthError(401, 'INVALID_TWO_FACTOR_CHALLENGE', '二次验证已失效，请重新登录')
    }

    this.claimedLoginChallenges.add(challengeHash)
    const totpValid = verifyTotpCode(record.totp.secret, input.data.code, this.now().getTime())
    const recoveryUsed = totpValid
      ? false
      : await this.consumeRecoveryCode(record, input.data.code)
    if (!totpValid && !recoveryUsed) {
      this.claimedLoginChallenges.delete(challengeHash)
      throw new AuthError(401, 'INVALID_TWO_FACTOR_CODE', '验证码不正确')
    }

    const usedAt = this.now().toISOString()
    await this.loginChallenges.put(challengeHash, { ...challenge, usedAt })
    this.claimedLoginChallenges.delete(challengeHash)
    const resumedIp = ip ?? challenge.ip
    const resumedUserAgent = userAgent ?? challenge.userAgent
    if (challenge.deviceId !== undefined) this.assertDeviceUsable(record, challenge.deviceId)
    if (recoveryUsed) {
      await this.audit(
        { userKey: challenge.userKey, schoolId: challenge.schoolId, username: challenge.username, role: record.role },
        'totp.recovery_code_use',
        challenge.userKey,
        challenge.schoolId,
      )
    }
    return this.completeLogin(
      record,
      school,
      challenge.remember,
      resumedIp,
      resumedUserAgent,
      challenge.deviceId,
    )
  }

  private readonly claimedLoginChallenges = new Set<string>()
  private readonly claimedRecoveryCodeHashes = new Set<string>()

  private async issueLoginChallenge(
    record: UserRecord,
    school: School,
    remember: boolean,
    ip: string,
    userAgent?: string,
    deviceId?: string,
  ): Promise<TwoFactorChallenge> {
    const raw = newLoginChallengeToken()
    const id = hashOpaqueCredential(raw)
    const now = this.now()
    const expiresAt = new Date(
      now.getTime() + (this.config.totpChallengeTtlMs ?? DEFAULT_AUTH_CONFIG.totpChallengeTtlMs),
    ).toISOString()
    await this.loginChallenges.put(id, {
      id,
      userId: record.id,
      userKey: userKey(school.id, record.username),
      schoolId: school.id,
      username: record.username,
      remember,
      ip,
      ...(userAgent !== undefined ? { userAgent: userAgent.slice(0, 256) } : {}),
      ...(deviceId !== undefined ? { deviceId } : {}),
      createdAt: now.toISOString(),
      expiresAt,
    })
    return { twoFactorRequired: true, challengeToken: raw, expiresAt }
  }

  private async consumeRecoveryCode(record: UserRecord, rawCode: string): Promise<boolean> {
    const codeHash = recoveryCodeHash(rawCode)
    const row = this.recoveryCodes.get(codeHash)
    if (row === undefined || row.usedAt !== undefined || row.userId !== record.id
      || row.userKey !== userKey(record.schoolId, record.username)
      || this.claimedRecoveryCodeHashes.has(codeHash)) {
      return false
    }
    this.claimedRecoveryCodeHashes.add(codeHash)
    try {
      await this.recoveryCodes.put(codeHash, { ...row, usedAt: this.now().toISOString() })
      return true
    } catch {
      this.claimedRecoveryCodeHashes.delete(codeHash)
      throw new AuthError(503, 'DEPENDENCY_UNAVAILABLE', '二次验证服务暂时不可用，请稍后再试')
    } finally {
      this.claimedRecoveryCodeHashes.delete(codeHash)
    }
  }

  private async completeLogin(
    record: UserRecord,
    school: School,
    remember: boolean,
    ip?: string,
    userAgent?: string,
    deviceId?: string,
  ): Promise<LoginResult> {
    const sourceIp = ip ?? 'unknown'
    const firstDevice = deviceId !== undefined
      && this.devices.get(deviceKey(userKey(record.schoolId, record.username), deviceId)) === undefined
    const firstIp = ![...this.sessions.entries()].some(([, session]) =>
      session.userId === record.id
      && session.schoolId === record.schoolId
      && session.username === record.username
      && session.ip === sourceIp)
    const result = await this.issueSession(
      record,
      school,
      remember,
      sourceIp,
      userAgent,
      deviceId,
    )
    const now = this.now().toISOString()
    await this.users.put(userKey(school.id, record.username), {
      ...record,
      lastLoginAt: now,
      updatedAt: now,
    })
    if (deviceId !== undefined) await this.touchDevice(record, deviceId)
    if (firstDevice || firstIp) {
      await this.audit(
        { userKey: userKey(record.schoolId, record.username), schoolId: school.id, username: record.username, role: record.role },
        'auth.new_login',
        userKey(record.schoolId, record.username),
        school.id,
        {
          newDevice: firstDevice,
          newIp: firstIp,
          ip: sourceIp,
          ...(deviceId !== undefined ? { deviceId } : {}),
        },
      )
    }
    return result
  }

  /**
   * Start TOTP enrollment for an administrator/teacher. The pending secret is
   * durable so the next request only needs the six-digit confirmation.
   */
  async startTotpSetup(actor: AdminActor): Promise<{
    secret: string
    uri: string
  }> {
    this.requireTwoFactorRole(actor)
    const record = this.loadActorRecord(actor)
    if (record.totp !== undefined) {
      throw new AuthError(400, 'TWO_FACTOR_ALREADY_ENABLED', '该账号已开启二次验证')
    }
    const secret = generateTotpSecret()
    const now = this.now()
    await this.users.put(userKey(record.schoolId, record.username), {
      ...record,
      totpPendingSecret: secret,
      updatedAt: now.toISOString(),
    })
    const label = encodeURIComponent(`PhysicsOS:${record.schoolId}:${record.username}`)
    return {
      secret,
      uri: `otpauth://totp/${label}?issuer=PhysicsOS&secret=${secret}&algorithm=SHA1&digits=6&period=30`,
    }
  }

  /**
   * Confirm enrollment and return recovery codes exactly once. Only hashes of
   * those codes are written to the domain.
   */
  async enableTotp(
    actor: AdminActor,
    body: unknown,
  ): Promise<{ recoveryCodes: string[] }> {
    this.requireTwoFactorRole(actor)
    const input = totpVerifyWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请输入 6 位验证码')
    await this.allow('totp', `enroll:${actor.userKey}`, '验证码尝试过于频繁，请稍后再试')
    const record = this.loadActorRecord(actor)
    const secret = record.totpPendingSecret
    if (record.totp !== undefined) {
      throw new AuthError(400, 'TWO_FACTOR_ALREADY_ENABLED', '该账号已开启二次验证')
    }
    if (secret === undefined) {
      throw new AuthError(400, 'BAD_REQUEST', '请先开始绑定二次验证')
    }
    if (!verifyTotpCode(secret, input.data.code, this.now().getTime())) {
      throw new AuthError(401, 'INVALID_TWO_FACTOR_CODE', '验证码不正确')
    }

    const recoveryCodes = Array.from({ length: 10 }, () => generateRecoveryCode())
    const now = this.now().toISOString()
    for (const code of recoveryCodes) {
      const codeHash = recoveryCodeHash(code)
      await this.recoveryCodes.put(codeHash, {
        id: codeHash,
        codeHash,
        userId: record.id,
        userKey: actor.userKey,
        schoolId: record.schoolId,
        username: record.username,
        createdAt: now,
      })
    }
    delete record.totpPendingSecret
    await this.users.put(actor.userKey, {
      ...record,
      totp: { secret, enabledAt: now },
      updatedAt: now,
    })
    await this.audit(actor, 'totp.enable', actor.userKey, actor.schoolId)
    return { recoveryCodes }
  }

  /** Verify one current TOTP for an already-authenticated session. */
  async verifyTotpForActor(actor: AdminActor, body: unknown): Promise<void> {
    this.requireTwoFactorRole(actor)
    const input = totpVerifyWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请输入 6 位验证码')
    await this.allow('totp', `verify:${actor.userKey}`, '验证码尝试过于频繁，请稍后再试')
    const record = this.loadActorRecord(actor)
    if (record.totp === undefined) throw new AuthError(400, 'BAD_REQUEST', '该账号尚未开启二次验证')
    if (!verifyTotpCode(record.totp.secret, input.data.code, this.now().getTime())) {
      throw new AuthError(401, 'INVALID_TWO_FACTOR_CODE', '验证码不正确')
    }
  }

  /** Disable TOTP after proving both the account password and a second factor. */
  async disableTotp(actor: AdminActor, body: unknown): Promise<void> {
    this.requireTwoFactorRole(actor)
    const input = totpDisableWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查密码和验证码')
    const record = this.loadActorRecord(actor)
    if (record.totp === undefined) throw new AuthError(400, 'BAD_REQUEST', '该账号尚未开启二次验证')
    if (!verifyPassword(input.data.password, record.passwordHash)) {
      throw new AuthError(401, 'INVALID_CREDENTIALS', '密码不正确')
    }
    await this.allow('totp', `disable:${actor.userKey}`, '验证码尝试过于频繁，请稍后再试')
    const totpValid = verifyTotpCode(record.totp.secret, input.data.code, this.now().getTime())
    const recoveryValid = totpValid
      ? false
      : await this.consumeRecoveryCode(record, input.data.code)
    if (!totpValid && !recoveryValid) {
      throw new AuthError(401, 'INVALID_TWO_FACTOR_CODE', '验证码不正确')
    }

    const updated: UserRecord = { ...record, updatedAt: this.now().toISOString() }
    delete updated.totp
    delete updated.totpPendingSecret
    await this.users.put(actor.userKey, updated)
    for (const [id, row] of [...this.recoveryCodes.entries()]) {
      if (row.userKey === actor.userKey) await this.recoveryCodes.delete(id)
    }
    await this.audit(actor, 'totp.disable', actor.userKey, actor.schoolId)
  }

  private requireTwoFactorRole(actor: AdminActor): void {
    if (!['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(actor.role)) {
      throw new AuthError(403, 'FORBIDDEN', '仅管理员和教师可开启二次验证')
    }
  }

  private loadActorRecord(actor: AdminActor): UserRecord {
    const record = this.users.get(actor.userKey)
    if (record === undefined || record.status !== 'active') {
      throw new AuthError(401, 'UNAUTHENTICATED', '账号不存在或已停用')
    }
    return record
  }

  /** Create a named personal token; the raw secret is returned exactly once. */
  async createApiToken(
    actor: AdminActor,
    body: unknown,
  ): Promise<{ token: ApiTokenRow; secret: string }> {
    const input = createApiTokenWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查令牌名称和有效期')
    const record = this.loadActorRecord(actor)
    const now = this.now()
    let expiresAt: string | undefined
    if (input.data.expiresAt !== undefined) {
      const parsed = Date.parse(input.data.expiresAt)
      if (!Number.isFinite(parsed) || parsed <= now.getTime()) {
        throw new AuthError(400, 'BAD_REQUEST', '令牌过期时间必须晚于当前时间')
      }
      expiresAt = new Date(parsed).toISOString()
    }
    const activeCount = [...this.apiTokens.entries()]
      .filter(([, row]) => row.userKey === actor.userKey && row.revokedAt === undefined)
      .filter(([, row]) => row.expiresAt === undefined || Date.parse(row.expiresAt) > now.getTime())
      .length
    if (activeCount >= (this.config.apiTokenLimit ?? DEFAULT_AUTH_CONFIG.apiTokenLimit)) {
      throw new AuthError(429, 'RATE_LIMITED', '个人令牌数量已达上限')
    }

    const generated = newApiToken()
    const id = `pat_${crypto.randomBytes(9).toString('base64url')}`
    const row: ApiTokenRecord = {
      id,
      tokenHash: generated.hash,
      userId: record.id,
      userKey: actor.userKey,
      schoolId: actor.schoolId,
      username: record.username,
      name: input.data.name,
      scope: input.data.scope,
      createdAt: now.toISOString(),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    }
    await this.apiTokens.put(generated.hash, row)
    await this.audit(actor, 'api_token.create', id, actor.schoolId, {
      name: row.name,
      scope: row.scope,
    })
    return { token: this.toApiTokenRow(row), secret: generated.raw }
  }

  /** List the acting account's tokens without hashes or raw secrets. */
  listApiTokens(actor: AdminActor): { tokens: ApiTokenRow[] } {
    const tokens = [...this.apiTokens.entries()]
      .map(([, row]) => row)
      .filter(row => row.userKey === actor.userKey)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(row => this.toApiTokenRow(row))
    return { tokens }
  }

  /** Revoke one owned token; the next request fails immediately. */
  async revokeApiToken(actor: AdminActor, tokenId: string): Promise<ApiTokenRow> {
    const found = [...this.apiTokens.entries()]
      .find(([, row]) => row.id === tokenId && row.userKey === actor.userKey)
    if (found === undefined) throw new AuthError(404, 'NOT_FOUND', '令牌不存在')
    const [key, row] = found
    const revoked = row.revokedAt === undefined
      ? { ...row, revokedAt: this.now().toISOString() }
      : row
    if (row.revokedAt === undefined) {
      await this.apiTokens.put(key, revoked)
      await this.audit(actor, 'api_token.revoke', row.id, actor.schoolId, { name: row.name })
    }
    return this.toApiTokenRow(revoked)
  }

  private toApiTokenRow(row: ApiTokenRecord): ApiTokenRow {
    return {
      id: row.id,
      name: row.name,
      scope: row.scope,
      tokenMasked: `pso_${'*'.repeat(8)}${row.id.slice(-6)}`,
      createdAt: row.createdAt,
      ...(row.expiresAt !== undefined ? { expiresAt: row.expiresAt } : {}),
      ...(row.revokedAt !== undefined ? { revokedAt: row.revokedAt } : {}),
    }
  }

  /** Mint an opaque token and persist only its hash as a session row. */
  private async issueSession(
    record: UserRecord, school: School, remember: boolean,
    ip?: string, userAgent?: string, deviceId?: string,
  ): Promise<LoginResult> {
    const now = this.now().getTime()
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
      ...(deviceId !== undefined ? { deviceId } : {}),
    }
    await this.sessions.put(session.id, session)
    return {
      token,
      expiresAt: session.expiresAt,
      cookieMaxAge: remember ? Math.floor(this.config.rememberTtlMs / 1000) : 0,
      user: this.toPublic(record, school),
    }
  }

  /**
   * Revoke the session behind a raw cookie token; unknown tokens are a no-op.
   * @param token - the raw cookie token, or null when the request carried none.
   */
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
   * @param token - the raw `physicsos_session` cookie value.
   * @returns `{user, session}` for a live session, else null.
   */
  /* Reads an in-memory index only, so it is sync — `await` at the call sites
     still works, and the plugin never has to invent a promise. */
  resolveSession(token: string): ResolvedSession | null {
    const session = this.sessions.get(sessionTokenHash(token))
    if (session === undefined || session.revokedAt !== undefined) return null
    if (Date.parse(session.expiresAt) <= this.now().getTime()) return null

    const school = this.schools.get(session.schoolId)
    if (school === undefined || school.status !== 'active') return null

    const user = this.users.get(userKey(session.schoolId, session.username))
    if (user === undefined || user.id !== session.userId || user.status !== 'active') return null
    /* 远程注销在这里生效:会话记住了它来自哪台设备,而设备一旦被注销(平台级
       或本校),这条会话下一次解析就是 null —— 不用等 cookie 过期。 */
    if (session.deviceId !== undefined
      && this.isDeviceRevoked(session.deviceId, session.schoolId)) {
      return null
    }
    return { user: this.toPublic(user, school), session }
  }

  /**
   * Resolve a personal API token. Revocation and expiry are checked on every
   * request, so a revoked credential stops working immediately.
   */
  resolveApiToken(token: string): ResolvedCredential | null {
    const row = this.apiTokens.get(hashOpaqueCredential(token))
    if (row === undefined || row.revokedAt !== undefined) return null
    if (row.expiresAt !== undefined && Date.parse(row.expiresAt) <= this.now().getTime()) return null
    const school = this.schools.get(row.schoolId)
    const user = this.users.get(row.userKey)
    if (school === undefined || school.status !== 'active'
      || user === undefined || user.status !== 'active'
      || user.id !== row.userId || userKey(user.schoolId, user.username) !== row.userKey) {
      return null
    }
    return {
      user: this.toPublic(user, school),
      actor: {
        userKey: row.userKey,
        schoolId: row.schoolId,
        username: row.username,
        role: user.role,
      },
      credential: { kind: 'api-token', token: row, scope: row.scope },
    }
  }

  /**
   * Resolve the request credential. A present Authorization header is
   * authoritative: a malformed or unknown bearer never falls back to a cookie.
   * Sessions keep precedence only when no Authorization header was supplied.
   */
  resolveCredential(
    cookieHeader: string | undefined,
    authorizationHeader: string | undefined,
  ): ResolvedCredential | null {
    if (authorizationHeader !== undefined) {
      const token = readBearerToken(authorizationHeader)
      return token === null ? null : this.resolveApiToken(token)
    }
    const sessionToken = readSessionCookieHeader(cookieHeader)
    if (sessionToken === null) return null
    const resolved = this.resolveSession(sessionToken)
    if (resolved === null) return null
    return {
      user: resolved.user,
      actor: {
        userKey: userKey(resolved.user.schoolId, resolved.user.username),
        schoolId: resolved.user.schoolId,
        username: resolved.user.username,
        role: resolved.user.role,
      },
      credential: { kind: 'session', session: resolved.session },
    }
  }

  /**
   * Queue a recovery request and, when a direct adapter is configured, issue
   * and deliver a token in the same call. The HTTP receipt is uniform in both
   * modes and whether or not the account exists.
   * @param body - the wire body (`forgotWire`): `username` plus `schoolId`.
   * @param ip - the source IP for the password-reset attempt bucket.
   */
  async requestPasswordReset(body: unknown, ip?: string): Promise<void> {
    const input = forgotWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查填写内容')
    const { username, schoolId } = input.data
    const sourceIp = ip ?? 'unknown'
    await this.allow('passwordReset', `forgot:ip:${sourceIp}`)
    await this.allow('passwordReset', `forgot:account:${username.toLowerCase()}`)

    const candidates = this.loginCandidates(username, schoolId)
    const only = candidates.length === 1 ? candidates[0] : undefined
    if (only === undefined) return
    const { record, school } = only
    const ownerKey = userKey(school.id, record.username)

    /* A newer recovery request invalidates every older token and open queue row. */
    await this.supersedeOpenResetRequests(ownerKey)

    const request: ResetRequest = {
      id: `rr_${crypto.randomBytes(9).toString('base64url')}`,
      schoolId: school.id,
      username: record.username,
      at: this.now().toISOString(),
      status: 'pending',
      delivery: this.resetDelivery.mode,
      ...(ip !== undefined ? { ip } : {}),
    }
    await this.resets.put(request.id, request)
    if (this.resetDelivery.mode !== 'direct') return

    const issued = await this.issueResetToken(request)
    try {
      await this.resetDelivery.deliver({
        requestId: request.id,
        userKey: ownerKey,
        schoolId: school.id,
        username: record.username,
        displayName: record.displayName,
        token: issued.token,
        expiresAt: issued.request.expiresAt ?? '',
        resetPath: this.resetPath(issued.token),
      })
    } catch {
      await this.revokeResetToken(issued.request.tokenHash)
      await this.resets.put(request.id, {
        ...issued.request,
        status: 'delivery_failed',
        deliveryError: 'delivery adapter failed',
      })
    }
  }

  /**
   * Admin recovery queue. Tokens and hashes never cross this boundary.
   * @param actor - resolved admin principal.
   * @param filter - optional status/school/query and capped result count.
   * @returns tenant-scoped queue rows, newest first.
   */
  listPasswordResets(
    actor: AdminActor,
    filter: { status?: string; schoolId?: string; q?: string; limit?: number } = {},
  ): { requests: PasswordResetQueueRow[] } {
    this.requireAdmin(actor)
    const statuses = new Set<ResetRequest['status']>([
      'pending', 'active', 'used', 'cancelled', 'expired', 'superseded', 'delivery_failed',
    ])
    if (filter.status !== undefined && !statuses.has(filter.status as ResetRequest['status'])) {
      throw new AuthError(400, 'BAD_REQUEST', '重置状态不正确')
    }
    const schoolId = actor.role === 'SUPER_ADMIN' ? filter.schoolId : actor.schoolId
    const needle = filter.q?.trim().toLowerCase()
    const requestedLimit = filter.limit !== undefined && Number.isFinite(filter.limit)
      ? Math.trunc(filter.limit)
      : 100
    const limit = Math.min(Math.max(requestedLimit, 1), 200)
    const requests = [...this.resets.entries()]
      .map(([, request]) => this.toPasswordResetRow(request))
      .filter(request => schoolId === undefined || request.schoolId === schoolId)
      .filter(request => filter.status === undefined || request.status === filter.status)
      .filter(request => needle === undefined || needle === ''
        || request.username.includes(needle))
      .sort((left, right) => right.at.localeCompare(left.at))
      .slice(0, limit)
    return { requests }
  }

  /**
   * Issue a fresh token for one queued request and return the raw value exactly
   * once to the acting administrator. Reissuing invalidates every older token
   * held by that account.
   * @param actor - resolved admin principal.
   * @param requestId - queue row id.
   * @returns the raw token, expiry, and client path.
   */
  async issuePasswordReset(
    actor: AdminActor,
    requestId: string,
  ): Promise<{ request: PasswordResetQueueRow; token: string; expiresAt: string; resetPath: string }> {
    this.requireAdmin(actor)
    const request = this.loadManagedReset(actor, requestId)
    if (request.status === 'used' || request.status === 'cancelled' || request.status === 'superseded') {
      throw new AuthError(400, 'BAD_REQUEST', '该重置请求已结束')
    }
    if (request.status === 'active' && request.expiresAt !== undefined
      && Date.parse(request.expiresAt) <= this.now().getTime()) {
      await this.resets.put(request.id, { ...request, status: 'expired' })
      throw new AuthError(400, 'BAD_REQUEST', '该重置请求已过期')
    }
    const target = this.users.get(userKey(request.schoolId, request.username))
    if (target === undefined || target.status !== 'active') {
      throw new AuthError(404, 'NOT_FOUND', '账号不存在或已停用')
    }
    const issued = await this.issueResetToken(request, actor.userKey)
    await this.audit(actor, 'password_reset.issue', request.id, request.schoolId, {
      username: request.username,
    })
    return {
      request: this.toPasswordResetRow(issued.request),
      token: issued.token,
      expiresAt: issued.request.expiresAt ?? '',
      resetPath: this.resetPath(issued.token),
    }
  }

  /**
   * Cancel one queue row and revoke its currently issued token, if any.
   * @param actor - resolved admin principal.
   * @param requestId - queue row id.
   * @returns the cancelled queue row.
   */
  async cancelPasswordReset(actor: AdminActor, requestId: string): Promise<PasswordResetQueueRow> {
    this.requireAdmin(actor)
    const request = this.loadManagedReset(actor, requestId)
    if (request.status === 'used') throw new AuthError(400, 'BAD_REQUEST', '密码已经重置')
    const now = this.now().toISOString()
    await this.revokeResetToken(request.tokenHash, now)
    const cancelled: ResetRequest = {
      ...request,
      status: 'cancelled',
      cancelledAt: now,
      decidedBy: actor.userKey,
    }
    await this.resets.put(cancelled.id, cancelled)
    await this.audit(actor, 'password_reset.cancel', request.id, request.schoolId, {
      username: request.username,
    })
    return this.toPasswordResetRow(cancelled)
  }

  /**
   * Redeem one token, replace the password, and revoke every live session and
   * every sibling token. Invalid, expired, revoked, and already-used values
   * share one error so token probing learns nothing.
   * @param body - `{token, newPassword}`.
   * @param ip - source IP for the redemption limiter.
   */
  async submitPasswordReset(body: unknown, ip?: string): Promise<void> {
    const input = passwordResetWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查填写内容')
    const sourceIp = ip ?? 'unknown'
    const hash = passwordResetTokenHash(input.data.token)
    await this.allow('passwordReset', `reset:ip:${sourceIp}`)
    await this.allow('passwordReset', `reset:token:${hash}`)

    const token = this.resetTokens.get(hash)
    const now = this.now()
    if (token === undefined || token.usedAt !== undefined || token.revokedAt !== undefined
      || Date.parse(token.expiresAt) <= now.getTime()) {
      if (token !== undefined && Date.parse(token.expiresAt) <= now.getTime()
        && token.revokedAt === undefined) {
        await this.revokeResetToken(hash, now.toISOString())
        const request = this.resets.get(token.requestId)
        if (request !== undefined) {
          await this.resets.put(request.id, { ...request, status: 'expired' })
        }
      }
      throw new AuthError(400, 'INVALID_RESET_TOKEN', '重置链接无效或已过期')
    }
    if (!this.claimResetToken(hash)) {
      throw new AuthError(400, 'INVALID_RESET_TOKEN', '重置链接无效或已过期')
    }

    /* Claim before the first await: two local requests cannot both redeem the
       same token. A shared multi-instance store must expose the same CAS. */
    await this.resetTokens.put(hash, { ...token, usedAt: now.toISOString() })
    this.claimedResetTokens.delete(hash)
    const record = this.users.get(token.userKey)
    const school = this.schools.get(token.schoolId)
    if (record === undefined || school === undefined
      || record.status !== 'active' || school.status !== 'active') {
      throw new AuthError(400, 'INVALID_RESET_TOKEN', '重置链接无效或已过期')
    }

    await this.users.put(token.userKey, {
      ...record,
      passwordHash: hashPassword(input.data.newPassword),
      updatedAt: now.toISOString(),
    })
    await this.revokeUserSessions(record)
    await this.supersedeOpenResetRequests(token.userKey, token.requestId)
    const request = this.resets.get(token.requestId)
    if (request !== undefined) {
      await this.resets.put(request.id, {
        ...request,
        status: 'used',
        usedAt: now.toISOString(),
      })
    }
    await this.audit(
      { userKey: 'system:password-reset', schoolId: token.schoolId, username: 'system', role: 'STUDENT' },
      'password_reset.use',
      token.requestId,
      token.schoolId,
      { username: token.username },
    )
  }

  private readonly claimedResetTokens = new Set<string>()

  private claimResetToken(hash: string): boolean {
    if (this.claimedResetTokens.has(hash)) return false
    this.claimedResetTokens.add(hash)
    return true
  }

  private async revokeResetToken(
    hash: string | undefined,
    revokedAt = this.now().toISOString(),
  ): Promise<void> {
    if (hash === undefined) return
    const token = this.resetTokens.get(hash)
    if (token === undefined || token.revokedAt !== undefined) return
    await this.resetTokens.put(hash, { ...token, revokedAt })
  }

  private async invalidateUserResetTokens(
    ownerKey: string,
    exceptRequestId?: string,
  ): Promise<void> {
    const now = this.now().toISOString()
    for (const [hash, token] of this.resetTokens.entries()) {
      if (token.userKey !== ownerKey || token.usedAt !== undefined || token.revokedAt !== undefined) {
        continue
      }
      await this.resetTokens.put(hash, { ...token, revokedAt: now })
      if (token.requestId === exceptRequestId) continue
      const request = this.resets.get(token.requestId)
      if (request !== undefined
        && request.status !== 'used'
        && request.status !== 'cancelled'
        && request.status !== 'superseded') {
        await this.resets.put(request.id, { ...request, status: 'superseded' })
      }
    }
  }

  private async supersedeOpenResetRequests(
    ownerKey: string,
    exceptRequestId?: string,
  ): Promise<void> {
    const now = this.now().toISOString()
    for (const [id, request] of this.resets.entries()) {
      if (id === exceptRequestId
        || userKey(request.schoolId, request.username) !== ownerKey) continue
      if (request.status !== 'pending' && request.status !== 'active'
        && request.status !== 'delivery_failed') continue
      await this.revokeResetToken(request.tokenHash, now)
      await this.resets.put(id, { ...request, status: 'superseded' })
    }
  }

  private async issueResetToken(
    request: ResetRequest,
    decidedBy?: string,
  ): Promise<{ request: ResetRequest; token: string }> {
    const ownerKey = userKey(request.schoolId, request.username)
    await this.invalidateUserResetTokens(ownerKey, request.id)
    const now = this.now()
    const token = newPasswordResetToken()
    const tokenHash = passwordResetTokenHash(token)
    const expiresAt = new Date(
      now.getTime() + (this.config.passwordResetTtlMs ?? DEFAULT_AUTH_CONFIG.passwordResetTtlMs),
    ).toISOString()
    const record = this.users.get(ownerKey)
    if (record === undefined) throw new AuthError(404, 'NOT_FOUND', '账号不存在')
    await this.resetTokens.put(tokenHash, {
      id: tokenHash,
      tokenHash,
      requestId: request.id,
      userId: record.id,
      userKey: ownerKey,
      schoolId: request.schoolId,
      username: request.username,
      createdAt: now.toISOString(),
      expiresAt,
    })
    const issued: ResetRequest = {
      id: request.id,
      schoolId: request.schoolId,
      username: request.username,
      at: request.at,
      status: 'active',
      delivery: this.resetDelivery.mode,
      tokenHash,
      issuedAt: now.toISOString(),
      expiresAt,
      ...(request.ip !== undefined ? { ip: request.ip } : {}),
      ...(decidedBy !== undefined ? { decidedBy } : {}),
    }
    await this.resets.put(issued.id, issued)
    return { request: issued, token }
  }

  private loadManagedReset(actor: AdminActor, requestId: string): ResetRequest {
    const request = this.resets.get(requestId)
    if (request === undefined) throw new AuthError(404, 'NOT_FOUND', '重置请求不存在')
    if (actor.role !== 'SUPER_ADMIN' && request.schoolId !== actor.schoolId) {
      throw new AuthError(403, 'FORBIDDEN', '无权管理其他学校')
    }
    return request
  }

  private toPasswordResetRow(request: ResetRequest): PasswordResetQueueRow {
    const school = this.schools.get(request.schoolId)
    const user = this.users.get(userKey(request.schoolId, request.username))
    const expired = request.status === 'active' && request.expiresAt !== undefined
      && Date.parse(request.expiresAt) <= this.now().getTime()
    return {
      id: request.id,
      schoolId: request.schoolId,
      schoolName: school?.name ?? request.schoolId,
      username: request.username,
      displayName: user?.displayName ?? request.username,
      status: expired ? 'expired' : request.status,
      delivery: request.delivery,
      at: request.at,
      ...(request.issuedAt !== undefined ? { issuedAt: request.issuedAt } : {}),
      ...(request.expiresAt !== undefined ? { expiresAt: request.expiresAt } : {}),
      ...(request.usedAt !== undefined ? { usedAt: request.usedAt } : {}),
      ...(request.cancelledAt !== undefined ? { cancelledAt: request.cancelledAt } : {}),
      ...(request.deliveryError !== undefined ? { deliveryError: request.deliveryError } : {}),
    }
  }

  /* ---- Admin Console ----
     Every method below takes the session-derived actor, never wire claims:
     the route layer resolves the cookie, the service enforces role + tenant. */

  /**
   * 申请开通 a school. Anonymous submissions carry `requestedBy: null`;
   * an authed submitter is recorded so the approving admin can see who asked.
   * Re-submitting the same pending name returns the existing row — repeated
   * taps are idempotent, not a queue of duplicates.
   * @param body - the wire body (`schoolRequestWire`): the school's roster name etc.
   * @param requestedBy - the submitter's userKey, or null for an anonymous submission.
   * @param ip - the source IP for the `apply:` attempt bucket.
   * @returns the new or already-pending request row.
   */
  async submitSchoolRequest(
    body: unknown, requestedBy: string | null, ip?: string,
  ): Promise<SchoolRequestRecord> {
    const input = schoolRequestWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查填写内容')
    await this.allow('apply', `apply:${ip ?? 'unknown'}`, '提交过于频繁，请稍后再试')
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

  /**
   * Applications queue — SUPER_ADMIN only; newest first, optional status filter.
   * @param actor - the resolved admin principal (must be SUPER_ADMIN).
   * @param status - optional `pending|approved|rejected` filter.
   * @returns the matching request rows, newest first.
   */
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
   * @param actor - the resolved admin principal (must be SUPER_ADMIN).
   * @param requestId - the pending request's id.
   * @param body - `approveRequestWire`: the chosen school id plus first-admin credentials.
   * @returns the created tenant and its seeded SCHOOL_ADMIN row.
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

  /**
   * Reject an application; the optional reason rides the audit row.
   * @param actor - the resolved admin principal (must be SUPER_ADMIN).
   * @param requestId - the pending request's id.
   * @param body - `rejectRequestWire`: an optional reason.
   * @returns the updated request row.
   */
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

  /**
   * Tenant list — SUPER_ADMIN sees all; a school admin sees exactly its own.
   * @param actor - the resolved admin principal.
   * @returns the visible tenants, sorted by name.
   */
  listSchoolsAdmin(actor: AdminActor): School[] {
    this.requireAdmin(actor)
    const all = [...this.schools.entries()].map(([, school]) => school)
    const visible = actor.role === 'SUPER_ADMIN'
      ? all
      : all.filter(school => school.id === actor.schoolId)
    return visible.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  }

  /**
   * Direct school creation (SUPER_ADMIN), bypassing the application queue.
   * @param actor - the resolved admin principal (must be SUPER_ADMIN).
   * @param body - `createSchoolWire`: `id`, `name`, optional `shortName`.
   * @returns the created tenant row.
   */
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
   * @param actor - the resolved admin principal (must be SUPER_ADMIN).
   * @param schoolId - the tenant to update.
   * @param body - `schoolStatusWire`: the new `status`.
   * @returns the updated tenant row.
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
   * @param actor - the resolved admin principal.
   * @param filter - optional `schoolId` (supers only), `role`, and a name substring `q`.
   * @returns the matching accounts as admin-facing rows.
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
   * @param actor - the resolved admin principal.
   * @param body - `createUserWire`: credentials, display name, role, optional schoolId.
   * @returns the created account as an admin-facing row.
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
   * @param actor - the resolved admin principal; a school admin stays in its tenant.
   * @param schoolId - the target account's school.
   * @param username - the target account's username.
   * @param body - `userStatusWire`: the new `status`.
   * @returns the updated account as an admin-facing row.
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
      ...target.record, status: input.data.status, updatedAt: this.now().toISOString(),
    }
    await this.users.put(target.userKey, updated)
    if (input.data.status === 'disabled') {
      await this.revokeUserSessions(target.record)
      await this.supersedeOpenResetRequests(target.userKey)
    }
    await this.audit(actor, 'user.status', target.userKey, schoolId, { status: input.data.status })
    return this.toAdminRow(updated, this.schools.get(schoolId))
  }

  /**
   * Admin-driven password reset (the forgot-password queue's consumer): rehash
   * and revoke every live session so the old password's sessions die with it.
   * The new password never appears in audit detail.
   * @param actor - the resolved admin principal; a school admin stays in its tenant.
   * @param schoolId - the target account's school.
   * @param username - the target account's username.
   * @param body - `resetPasswordWire`: the admin-chosen `newPassword`.
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
      updatedAt: this.now().toISOString(),
    })
    await this.revokeUserSessions(target.record)
    await this.supersedeOpenResetRequests(target.userKey)
    await this.audit(actor, 'user.reset_password', target.userKey, schoolId)
  }

  /**
   * Revoke every live session of one account without touching its password.
   * @param actor - the resolved admin principal; a school admin stays in its tenant.
   * @param schoolId - the target account's school.
   * @param username - the target account's username.
   */
  async revokeUserSessionsByAdmin(
    actor: AdminActor, schoolId: string, username: string,
  ): Promise<void> {
    this.requireAdmin(actor)
    const target = this.loadManagedTarget(actor, schoolId, username)
    await this.revokeUserSessions(target.record)
    await this.audit(actor, 'user.revoke_sessions', target.userKey, schoolId)
  }

  /**
   * Mint a bounded batch of invite codes. A school admin can only target its
   * own tenant; only hashes are persisted and only this response carries raw
   * values.
   */
  async createInvites(
    actor: AdminActor,
    body: unknown,
  ): Promise<{ invites: (InviteRow & { code: string })[] }> {
    this.requireAdmin(actor)
    const input = createInvitesWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查邀请码参数')
    if (actor.role !== 'SUPER_ADMIN' && input.data.schoolId !== actor.schoolId) {
      throw new AuthError(403, 'FORBIDDEN', '无权管理其他学校')
    }
    const school = this.schools.get(input.data.schoolId)
    if (school === undefined || school.status !== 'active') {
      throw new AuthError(400, 'SCHOOL_NOT_FOUND', '学校不存在或未开放')
    }
    let expiresAt: string | undefined
    if (input.data.expiresAt !== undefined) {
      const parsed = Date.parse(input.data.expiresAt)
      if (!Number.isFinite(parsed) || parsed <= this.now().getTime()) {
        throw new AuthError(400, 'BAD_REQUEST', '邀请码过期时间必须晚于当前时间')
      }
      expiresAt = new Date(parsed).toISOString()
    }

    const invites: (InviteRow & { code: string })[] = []
    for (let index = 0; index < input.data.count; index += 1) {
      const generated = newInviteCode()
      const row: InviteRecord = {
        id: `inv_${crypto.randomBytes(9).toString('base64url')}`,
        codeHash: generated.hash,
        schoolId: input.data.schoolId,
        maxUses: input.data.maxUses,
        usedCount: 0,
        createdBy: actor.userKey,
        createdAt: this.now().toISOString(),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      }
      await this.invites.put(generated.hash, row)
      await this.audit(actor, 'invite.create', row.id, row.schoolId, {
        maxUses: row.maxUses,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      })
      invites.push({ ...this.toInviteRow(row, school.name), code: generated.raw })
    }
    return { invites }
  }

  /** Tenant-scoped invite list; never returns a raw value or hash. */
  listInvites(
    actor: AdminActor,
    filter: { schoolId?: string; limit?: number } = {},
  ): { invites: InviteRow[] } {
    this.requireAdmin(actor)
    const schoolId = actor.role === 'SUPER_ADMIN' ? filter.schoolId : actor.schoolId
    const requestedLimit = filter.limit !== undefined && Number.isFinite(filter.limit)
      ? Math.trunc(filter.limit)
      : 200
    const limit = Math.min(Math.max(requestedLimit, 1), 500)
    const invites = [...this.invites.entries()]
      .map(([, row]) => row)
      .filter(row => schoolId === undefined || row.schoolId === schoolId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map(row => this.toInviteRow(row, this.schools.get(row.schoolId)?.name ?? row.schoolId))
    return { invites }
  }

  /** Disable one invite without ever exposing its hash or raw code. */
  async disableInvite(actor: AdminActor, inviteId: string): Promise<InviteRow> {
    this.requireAdmin(actor)
    const found = [...this.invites.entries()].find(([, row]) => row.id === inviteId)
    if (found === undefined) throw new AuthError(404, 'NOT_FOUND', '邀请码不存在')
    const [key, row] = found
    if (actor.role !== 'SUPER_ADMIN' && row.schoolId !== actor.schoolId) {
      throw new AuthError(403, 'FORBIDDEN', '无权管理其他学校')
    }
    const disabled = row.disabledAt === undefined
      ? {
        ...row,
        disabledAt: this.now().toISOString(),
        disabledBy: actor.userKey,
      }
      : row
    if (row.disabledAt === undefined) {
      await this.invites.put(key, disabled)
      await this.audit(actor, 'invite.disable', row.id, row.schoolId)
    }
    return this.toInviteRow(
      disabled,
      this.schools.get(disabled.schoolId)?.name ?? disabled.schoolId,
    )
  }

  private toInviteRow(row: InviteRecord, schoolName: string): InviteRow {
    return {
      id: row.id,
      codeMasked: `inv_${'*'.repeat(8)}${row.id.slice(-6)}`,
      schoolId: row.schoolId,
      schoolName,
      maxUses: row.maxUses,
      usedCount: row.usedCount,
      createdAt: row.createdAt,
      ...(row.expiresAt !== undefined ? { expiresAt: row.expiresAt } : {}),
      ...(row.disabledAt !== undefined ? { disabledAt: row.disabledAt } : {}),
    }
  }

  /**
   * Validate an export request before headers are written, then expose it as a
   * bounded async stream. Rows are filtered as they are visited, so the full
   * audit table is never materialized in memory.
   */
  prepareAuditExport(
    actor: AdminActor,
    body: unknown,
  ): {
    format: 'csv' | 'jsonl'
    stream: Iterable<AuditEvent>
  } {
    this.requireAdmin(actor)
    const input = auditExportWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查导出参数')
    const from = input.data.from === undefined ? undefined : Date.parse(input.data.from)
    const to = input.data.to === undefined ? undefined : Date.parse(input.data.to)
    if (from !== undefined && to !== undefined && from >= to) {
      throw new AuthError(400, 'BAD_REQUEST', '导出开始时间必须早于结束时间')
    }
    const schoolId = actor.role === 'SUPER_ADMIN' ? input.data.schoolId : actor.schoolId
    const limit = input.data.limit ?? 10_000
    return {
      format: input.data.format,
      stream: this.streamAudit(schoolId, from, to, limit),
    }
  }

  private *streamAudit(
    schoolId: string | undefined,
    from: number | undefined,
    to: number | undefined,
    limit: number,
  ): Iterable<AuditEvent> {
    let emitted = 0
    for (const [, event] of this.audits.entries()) {
      if (schoolId !== undefined && event.schoolId !== schoolId) continue
      const createdAt = Date.parse(event.createdAt)
      if (from !== undefined && createdAt < from) continue
      if (to !== undefined && createdAt >= to) continue
      yield event
      emitted += 1
      if (emitted >= limit) break
    }
  }

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
   * @param actor - the resolved admin principal; scopes the counts to its tenant.
   * @returns the dashboard payload — see the field docs for the two layers.
   */
  async dashboard(actor: AdminActor): Promise<{
    schools: { total: number; active: number; disabled: number }
    users: { total: number; byRole: Record<string, number>; disabled: number }
    sessions: { live: number; distinctUsers: number }
    activity: { date: string; logins: number; created: number }[]
    limiters: {
      backend: string
      available: boolean
      login: LimiterSnapshot
      ip: LimiterSnapshot
      apply: LimiterSnapshot
    }
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
  }> {
    this.requireAdmin(actor)
    const scope = actor.role === 'SUPER_ADMIN' ? undefined : actor.schoolId
    const now = this.now().getTime()
    const [loginLimiter, ipLimiter, applyLimiter] = await Promise.all([
      this.limiterSnapshot('login'),
      this.limiterSnapshot('ip'),
      this.limiterSnapshot('apply'),
    ])

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
        backend: this.limiter.kind,
        available: loginLimiter.available && ipLimiter.available && applyLimiter.available,
        login: loginLimiter,
        ip: ipLimiter,
        apply: applyLimiter,
      },
      learning,
    }
  }

  /**
   * Audit ledger — append-only on the write side; school admins read only
   * their own tenant's rows, supers may narrow with `schoolId`.
   * @param actor - the resolved admin principal; scopes the rows to its tenant.
   * @param filter - optional `schoolId` (supers only) and a `limit` (default 200).
   * @returns the newest matching audit rows.
   */
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
    await this.allow('learning', actor.userKey, '学习上报过于频繁，请稍后再试')
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

  /* ---- 设备登记与远程注销(方案第 4 期的服务端半) ----
     用户定过的用途是「设备登记 / 远程注销 / 异常风控」,**不是**一机一码锁死。
     所以这里没有任何一处会拦住一台没登记过的机器的正常使用:没带 deviceId 的
     登录照常签发会话;带了但还没登记过的,登记一下即可。被注销的设备才是例外,
     而那是管理员显式做的动作。 */

  /**
   * 设备列表 —— 校管理员只看自己学校,超管看全部。
   *
   * 每行都带有效注销状态与最近活跃时间;设备**哈希**原样展示(它本来就是哈希,
   * 不是序列号),暴露不了硬件身份。
   * @param actor - 已解析的管理员身份;校管理员的范围强制收窄到本校。
   * @param filter - 可选 `schoolId`(仅超管可用)与设备哈希/用户名子串 `q`。
   * @returns 设备行(带 `revoked`/`revokedGlobally`)与风控信号列表。
   */
  listDevices(
    actor: AdminActor, filter: { schoolId?: string; q?: string } = {},
  ): {
    devices: (DeviceRecord & { revoked: boolean; revokedGlobally: boolean })[]
    risk: RiskSignal[]
  } {
    this.requireAdmin(actor)
    const schoolId: string | undefined =
      actor.role === 'SUPER_ADMIN' ? filter.schoolId : actor.schoolId
    const needle = filter.q?.trim().toLowerCase()
    const devices = [...this.devices.entries()]
      .map(([, row]) => row)
      .filter(row => schoolId === undefined || row.schoolId === schoolId)
      .filter(row => needle === undefined || needle === ''
        || row.deviceId.includes(needle)
        || row.username.includes(needle))
      .sort((l, r) => r.lastSeenAt.localeCompare(l.lastSeenAt))
      .map(row => ({
        ...row,
        /* 有效注销 = 平台级 或 本校。展开成两个布尔,界面不必自己重算 scope。 */
        revoked: this.isDeviceRevoked(row.deviceId, row.schoolId),
        revokedGlobally:
          this.revocations.get(deviceRevocationKey(GLOBAL_DEVICE_SCOPE, row.deviceId)) !== undefined,
      }))
    return { devices, risk: this.riskSignals(schoolId) }
  }

  /**
   * 远程注销 / 恢复一台设备 —— 按**物理机器**记账,不是按某一行。
   *
   * 这一条是本轮改出来的:注销最初记在 `(账号, 设备)` 行上,于是同一台机器换一
   * 个账号登录就是一行干净的新记录,注销被绕过。远程注销必须是这台机器的事,
   * 所以它落在自己的表里,键是 `scope|deviceId`。
   *
   * `scope` 由发起人决定:超管是 `'*'`(对所有学校生效),校管理员是本校本设备。
   * 恢复只删自己那一把 scope 的锁 —— 一个学校管理员不该把平台级注销解开。
   *
   * 注销时同一台设备**已经在线的会话一并失效**:否则被注销的机器只要不退出就能
   * 继续用,「远程注销」就成了摆设。
   * @param actor - 已解析的管理员身份;超管的 scope 是 `'*'`,校管理员是本校。
   * @param deviceId - 设备哈希(`deviceIdWire` 形状),非平台原始标识。
   * @param revoked - true 注销,false 只解开自己那把 scope 的锁。
   * @returns 设备 id、生效的 scope,以及注销时写入的锁行。
   */
  async setDeviceRevoked(
    actor: AdminActor, deviceId: string, revoked: boolean,
  ): Promise<{ deviceId: string; scope: string; revocation?: DeviceRevocation }> {
    this.requireAdmin(actor)
    const parsed = deviceIdWire.safeParse(deviceId)
    if (!parsed.success) throw new AuthError(400, 'BAD_REQUEST', '设备标识形状不正确')
    const scope = actor.role === 'SUPER_ADMIN' ? GLOBAL_DEVICE_SCOPE : actor.schoolId

    const seen = [...this.devices.entries()]
      .filter(([, row]) => row.deviceId === deviceId
        && (scope === GLOBAL_DEVICE_SCOPE || row.schoolId === scope))
    const key = deviceRevocationKey(scope, deviceId)
    const existing = this.revocations.get(key)
    if (revoked && seen.length === 0 && existing === undefined
      && this.revocations.get(deviceRevocationKey(GLOBAL_DEVICE_SCOPE, deviceId)) === undefined) {
      throw new AuthError(404, 'NOT_FOUND', '没有这台设备')
    }

    if (!revoked) {
      if (existing === undefined) return { deviceId, scope }
      await this.revocations.delete(key)
      /* 每个受影响租户各写一行 —— 别把「发起人的学校」当成所有学校的审计归属。 */
      const schools = existing.affectedSchools.length > 0 ? existing.affectedSchools : [actor.schoolId]
      for (const schoolId of schools) {
        await this.audit(actor, 'device.restore', deviceId, schoolId, { scope })
      }
      return { deviceId, scope }
    }

    /* 受影响租户在注销那一刻定下来:平台级是「见过这台机器的所有学校」,校级
       就是本校。恢复时设备行可能已经不在了,所以这份名单必须当场存进锁里。 */
    const affectedSchools: string[] = scope === GLOBAL_DEVICE_SCOPE
      ? [...new Set(seen.map(([, row]) => row.schoolId))].sort()
      : [scope]
    const revocation: DeviceRevocation = existing ?? {
      id: key,
      scope,
      deviceId,
      revokedBy: actor.userKey,
      revokedAt: new Date().toISOString(),
      affectedSchools,
    }
    await this.revocations.put(key, revocation)

    /* 踢掉这台设备上所有受影响租户的在线会话。平台级注销影响全部学校,校级只
       影响本校 —— 断线范围与注销范围必须一致。 */
    for (const [id, session] of this.sessions.entries()) {
      if (session.deviceId !== deviceId || session.revokedAt !== undefined) continue
      if (scope !== GLOBAL_DEVICE_SCOPE && session.schoolId !== scope) continue
      await this.sessions.put(id, { ...session, revokedAt: revocation.revokedAt })
    }
    /* 台账按受影响租户各写一行:一所学校有权在自己的审计里看到「我们学校有台
       设备被平台注销了」,而不是只有发起人那所学校看得见。 */
    for (const schoolId of affectedSchools) {
      await this.audit(actor, 'device.revoke', deviceId, schoolId, { scope })
    }
    return { deviceId, scope, revocation }
  }

  /**
   * 异常风控信号 —— **只记录与展示,不自动封禁**(用户明确要求)。
   *
   * 两个问题都从**已经存在的行**里推导,不新增任何采集:
   *   - 同账号短时间内在多台设备出现过:`devices.lastSeenAt` 落在窗口内的不同
   *     `deviceId` 计数。
   *   - 同一台设备短时间内在多个 IP 出现过:`sessions` 里带该 `deviceId` 的行按
   *     `ip` 去重计数。IP 只在计数里用,**不出现在返回结构里**。
   * 所以看板能说「这条账号 24 小时内从 5 台设备登录过」,但看不到任何地址。
   */
  private riskSignals(schoolId: string | undefined): RiskSignal[] {
    const windowMs = RISK_WINDOW_MS
    const since = Date.now() - windowMs
    const inScope = (value: string): boolean => schoolId === undefined || value === schoolId

    const byAccount = new Map<string, Set<string>>()
    const byDevice = new Map<string, Set<string>>()
    for (const [, row] of this.devices.entries()) {
      if (!inScope(row.schoolId)) continue
      if (Date.parse(row.lastSeenAt) < since) continue
      const found = byAccount.get(row.primaryUserKey) ?? new Set<string>()
      found.add(row.deviceId)
      byAccount.set(row.primaryUserKey, found)
    }
    for (const [, session] of this.sessions.entries()) {
      if (!inScope(session.schoolId)) continue
      if (session.deviceId === undefined) continue
      if (Date.parse(session.createdAt) < since) continue
      const found = byDevice.get(session.deviceId) ?? new Set<string>()
      found.add(session.ip ?? 'unknown')
      byDevice.set(session.deviceId, found)
    }

    const out: RiskSignal[] = []
    for (const [subject, found] of byAccount) {
      if (found.size >= RISK_THRESHOLD) {
        out.push({ kind: 'account-multi-device', subject, count: found.size, windowMs })
      }
    }
    for (const [subject, found] of byDevice) {
      if (found.size >= RISK_THRESHOLD) {
        out.push({ kind: 'device-multi-ip', subject, count: found.size, windowMs })
      }
    }
    return out.sort((l, r) => r.count - l.count)
  }

  /**
   * 这台设备对这个租户是不是被注销的。
   *
   * 两个 scope 任一命中即算被注销:平台级(`'*'`,超管做的,对所有学校生效)
   * 或本校(该校管理员做的)。反过来,一所学校注销不了另一所学校的设备。
   */
  private isDeviceRevoked(deviceId: string, schoolId: string): boolean {
    return this.revocations.get(deviceRevocationKey(GLOBAL_DEVICE_SCOPE, deviceId)) !== undefined
      || this.revocations.get(deviceRevocationKey(schoolId, deviceId)) !== undefined
  }

  /** 被注销的设备不能换一张新会话 —— 拦在登录这一步,别指望每个下游自己判。 */
  private assertDeviceUsable(record: UserRecord, deviceId: string): void {
    if (this.isDeviceRevoked(deviceId, record.schoolId)) {
      throw new AuthError(403, 'DEVICE_REVOKED', '这台设备已被注销,请联系学校管理员')
    }
  }

  /**
   * 登记 / 刷新一台设备 —— 幂等。
   *
   * 键是 `userKey|deviceId`,所以「这台机器这个账号见过」就是一行;再见只累加
   * `seenCount` 与 `lastSeenAt`。注销状态**不在这一行上**,由
   * `device_revocations` 单独记账 —— 那是按机器算的,这是按(账号,机器)算的。
   */
  private async touchDevice(record: UserRecord, deviceId: string): Promise<DeviceRecord> {
    const key = deviceKey(userKey(record.schoolId, record.username), deviceId)
    const now = new Date().toISOString()
    const existing = this.devices.get(key)
    const next: DeviceRecord = existing === undefined
      ? {
        id: key,
        deviceId,
        primaryUserKey: userKey(record.schoolId, record.username),
        schoolId: record.schoolId,
        username: record.username,
        firstSeenAt: now,
        lastSeenAt: now,
        seenCount: 1,
      }
      : { ...existing, lastSeenAt: now, seenCount: existing.seenCount + 1 }
    await this.devices.put(key, next)
    return next
  }

  /**
   * 会话主人登记自己的设备 —— `/physicsos/auth/devices` 的落地。
   *
   * 与 `touchDevice` 分开是有意的:`touchDevice` 是登录路径上的副产物(拿的是
   * `UserRecord`),这里是**显式**登记(拿的是 actor),而且它必须拒绝一台正在
   * 被注销的机器 —— 否则「远程注销」会被机器自己的下一次心跳抹掉。
   * @param actor - 会话解析出的设备主人;device 行记到 `(userKey, deviceId)`。
   * @param body - `registerDeviceWire`:设备哈希、可选平台与版本。
   * @returns 登记后的设备行。
   */
  async registerOwnDevice(actor: AdminActor, body: unknown): Promise<DeviceRecord> {
    const input = registerDeviceWire.safeParse(body)
    if (!input.success) throw new AuthError(400, 'BAD_REQUEST', '请检查设备信息')
    const record = this.users.get(userKey(actor.schoolId, actor.username))
    if (record === undefined) throw new AuthError(401, 'UNAUTHENTICATED', '账号不存在')
    this.assertDeviceUsable(record, input.data.deviceId)
    const device = await this.touchDevice(record, input.data.deviceId)
    const shaped: DeviceRecord = { ...device }
    if (input.data.platform !== undefined) shaped.platform = input.data.platform
    if (input.data.appVersion !== undefined) shaped.appVersion = input.data.appVersion
    await this.devices.put(deviceKey(device.primaryUserKey, device.deviceId), shaped)
    return shaped
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
   * @param actor - the acting account (`userKey` + `schoolId` only — no role check).
   * @param action - the verb, e.g. `paper.publish`.
   * @param target - the object the action landed on.
   * @param detail - optional structured extras; never secrets or raw answers.
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
  /** 设备登记,键 `userKey|deviceId`。 */
  private get devices() { return this.domain.table('devices') }
  /** 设备注销,键 `scope|deviceId`。 */
  private get revocations() { return this.domain.table('device_revocations') }

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
