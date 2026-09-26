/**
 * Fetch client for the auth host's `/physicsos/auth` and `/physicsos/admin`
 * REST surfaces.
 *
 * Same-origin calls only; the session lives in an HttpOnly cookie the browser
 * attaches automatically — this file never sees a token. Every failure shape
 * the route emits (`{error:{code,message}}`) surfaces as an `Error` carrying
 * the code, so views can branch on `UNAUTHENTICATED` vs `INVALID_CREDENTIALS`.
 */

export interface AuthApiError extends Error {
  readonly code: string
  /** `SCHOOL_REQUIRED`/`SCHOOL_AMBIGUOUS` carry the schools to pick from. */
  readonly candidates?: SchoolRow[]
}

const request = async <T>(base: string, path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${base}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const body = await response.json().catch(() => ({})) as {
    error?: { code?: string; message?: string; candidates?: SchoolRow[] }
  }
  if (!response.ok) {
    const error = new Error(body.error?.message ?? `${response.status}`) as AuthApiError
    Object.defineProperty(error, 'code', { value: body.error?.code ?? `HTTP_${response.status}` })
    if (body.error?.candidates !== undefined) {
      Object.defineProperty(error, 'candidates', { value: body.error.candidates })
    }
    throw error
  }
  return body as T
}

const AUTH_BASE = '/physicsos/auth'
const ADMIN_BASE = '/physicsos/admin'

const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(AUTH_BASE, path, { method: 'POST', body: body === undefined ? null : JSON.stringify(body) })

const adminPost = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(ADMIN_BASE, path, { method: 'POST', body: body === undefined ? null : JSON.stringify(body) })

/* Wire shapes — structural mirrors of the host's public rows; the host package
   stays host-side, the client keeps its own minimal contract. */

/** A tenant row as `/schools` and admin routes return it. */
export interface SchoolRow {
  readonly id: string
  readonly name: string
  readonly shortName?: string
  /** 地州市 label on roster-seeded tenants — disambiguation display. */
  readonly city?: string
  /** 区县 label when the roster carries one. */
  readonly county?: string
}

/** The principal `/me`, `login`, and `register` return — never carries secrets. */
export interface AuthUser {
  readonly id: string
  readonly schoolId: string
  readonly schoolName: string
  readonly schoolShortName?: string
  readonly username: string
  readonly displayName: string
  readonly avatarUrl?: string
  readonly role: 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN' | 'SUPER_ADMIN'
}

/** `/register` body — school selection resolves server-side, never trusted as-is. */
export interface RegisterInput {
  /** Free-text school the user typed; the host resolves it to a tenant. */
  readonly schoolName?: string
  /** Disambiguation answer after `SCHOOL_AMBIGUOUS` — wins over schoolName. */
  readonly schoolId?: string
  readonly username: string
  readonly displayName: string
  readonly password: string
}

/** `/login` body — credentials plus the remember-device flag. */
export interface LoginInput {
  /** Disambiguation answer after `SCHOOL_REQUIRED`; not a form field otherwise. */
  readonly schoolId?: string
  readonly username: string
  readonly password: string
  readonly rememberDevice: boolean
}

/** A school application row — the register view's 申请开通 submission. */
export interface SchoolRequestRow {
  readonly id: string
  readonly schoolName: string
  readonly contact: string
  readonly status: 'pending' | 'approved' | 'rejected'
  /** userKey of the submitter; null when anonymous. */
  readonly requestedBy: string | null
  readonly createdAt: string
}

/** An admin-facing user row — AuthUser plus lifecycle fields. */
export interface AdminUserRow extends AuthUser {
  readonly status: 'active' | 'disabled'
  readonly createdAt: string
  readonly lastLoginAt?: string
}

/** An append-only admin action row. */
/**
 * The `/physicsos/admin/dashboard` payload.
 *
 * Every field is a count of rows the SERVER holds. 学习记录 is not here on
 * purpose: it lives in the browser's localStorage, so a "correct rate" shown
 * next to these numbers would be a fabrication. Experiment usage needs a new
 * opt-in reporting endpoint and is deliberately absent until its collected
 * fields are agreed.
 */
export interface DashboardRow {
  readonly schools: { readonly total: number; readonly active: number; readonly disabled: number }
  readonly users: {
    readonly total: number
    readonly byRole: Readonly<Record<string, number>>
    readonly disabled: number
  }
  /** Live = not revoked, not expired, account still active — i.e. resolvable. */
  readonly sessions: { readonly live: number; readonly distinctUsers: number }
  /** 14 days, oldest first. */
  readonly activity: readonly {
    readonly date: string
    readonly logins: number
    readonly created: number
  }[]
  /**
   * Abuse posture. Counts only — no IPs, no usernames: an operator reads "how
   * close is this deployment to its limiter", not "who is throttled".
   */
  readonly limiters: Readonly<Record<'login' | 'ip' | 'apply', {
    readonly tracked: number
    readonly saturated: number
    readonly limit: number
    readonly windowMs: number
  }>> & {
    readonly backend?: string
    readonly available?: boolean
  }
  /**
   * 第二层:学生自测的聚合计数,来自带会话的学习上报。
   *
   * 行里没有账号、没有答案原文 —— 这层回答「哪个知识点错得多」,回答不了
   * 「谁错了」。`available: false` 是「还没有人上报」,不是「正确率 0」。
   */
  readonly learning: {
    readonly available: boolean
    readonly attempts: number
    readonly correct: number
    readonly wrong: number
    readonly nodes: readonly {
      readonly knowledgeId: string
      readonly correct: number
      readonly wrong: number
    }[]
    readonly days: number
  }
}

/** Read-only operational metrics returned by `/physicsos/ops/metrics`. */
export interface OpsDiskUsage {
  readonly path: string
  readonly totalBytes: number
  readonly freeBytes: number
  readonly availableBytes: number
  readonly usedBytes: number
  readonly usedPercent: number
  readonly available: boolean
}

export interface OpsDirectoryUsage {
  readonly path: string
  readonly bytes: number
  readonly entries: number
  readonly partial: boolean
}

export interface OpsBytesUsage {
  readonly bytes: number
  readonly available: boolean
  readonly partial: boolean
}

export interface OpsProbe {
  readonly ok: boolean
  readonly latencyMs?: number
  readonly code?: string
}

export interface OpsPostgresProbe extends OpsProbe {
  readonly sizeBytes?: number
  readonly sessions?: {
    readonly live: number
    readonly distinctUsers: number
  }
  readonly accounts?: {
    readonly total: number
    readonly active: number
    readonly disabled: number
  }
}

export interface OpsRedisProbe extends OpsProbe {
  readonly usedMemoryBytes?: number
}

export interface OpsMetrics {
  readonly cache: {
    readonly ttlMs: number
    readonly hit: boolean
    readonly collectedAt: string
    readonly partial: boolean
  }
  readonly disk: {
    readonly thresholds: {
      readonly warningPercent: number
      readonly criticalPercent: number
    }
    readonly root: OpsDiskUsage
    readonly data: OpsDiskUsage
    readonly breakdown: {
      readonly sessions: OpsDirectoryUsage
      readonly workspaces: OpsDirectoryUsage
      readonly postgres: OpsBytesUsage
      readonly redis: OpsBytesUsage
    }
    readonly partial: boolean
  }
  readonly health: {
    readonly status: 'ok' | 'warning' | 'critical'
    readonly uptimeSeconds: number
    readonly node: {
      readonly version: string
      readonly platform: string
      readonly arch: string
    }
    readonly postgres: OpsPostgresProbe
    readonly redis: OpsRedisProbe
    readonly sessions: {
      readonly live: number
      readonly distinctUsers: number
    }
    readonly accounts: {
      readonly total: number
      readonly active: number
      readonly disabled: number
    }
  }
  readonly alerts: readonly {
    readonly severity: 'warning' | 'critical'
    readonly code: string
    readonly message: string
  }[]
  readonly partial: boolean
}

/** One admin-readable audit-ledger row. */
export interface AuditEventRow {
  readonly id: string
  readonly actorKey: string
  readonly schoolId: string
  readonly action: string
  readonly target: string
  readonly detail?: Record<string, unknown>
  readonly createdAt: string
}

/**
 * 一台登记过的设备。
 *
 * `deviceId` 是**哈希**,不是硬件序列号 —— 客户端只上传哈希,所以这一列即便
 * 原样展示也不泄露机器身份。`revoked` 是这个租户下**有效**的注销状态(平台级
 * 或本校任一命中),`revokedGlobally` 说明它是平台级的那把锁。
 */
export interface DeviceRow {
  readonly id: string
  readonly deviceId: string
  readonly primaryUserKey: string
  readonly schoolId: string
  readonly username: string
  readonly platform?: string
  readonly appVersion?: string
  readonly firstSeenAt: string
  readonly lastSeenAt: string
  readonly seenCount: number
  readonly revoked: boolean
  readonly revokedGlobally: boolean
}

/**
 * 一条风控信号 —— 只有计数,没有 IP。
 *
 * `subject` 要么是账号键、要么是设备哈希;IP 只在服务端计数时用过,出了那个
 * 函数就没了。这是「记录与展示,不自动封禁」的可观测形式。
 */
export interface RiskSignalRow {
  readonly kind: 'account-multi-device' | 'device-multi-ip'
  readonly subject: string
  readonly count: number
  readonly windowMs: number
}

/** Password-reset queue lifecycle states exposed to administrators. */
export type PasswordResetStatus =
  | 'pending'
  | 'active'
  | 'used'
  | 'cancelled'
  | 'expired'
  | 'superseded'
  | 'delivery_failed'

/**
 * One admin-visible recovery request.
 *
 * The host deliberately omits the token, its hash, and the source IP: the raw
 * token is returned only once by `issuePasswordReset`.
 */
export interface PasswordResetQueueRow {
  readonly id: string
  readonly schoolId: string
  readonly schoolName: string
  readonly username: string
  readonly displayName: string
  readonly status: PasswordResetStatus
  readonly delivery: 'queue' | 'direct'
  readonly at: string
  readonly issuedAt?: string
  readonly expiresAt?: string
  readonly usedAt?: string
  readonly cancelledAt?: string
  readonly deliveryError?: string
}

/** One-time result of issuing an admin reset link. */
export interface IssuedPasswordReset {
  readonly request: PasswordResetQueueRow
  readonly token: string
  readonly expiresAt: string
  readonly resetPath: string
}

/** `/school-requests/:id/approve` body — the approver-chosen tenant id and first admin. */
export interface ApproveInput {
  readonly schoolId: string
  readonly shortName?: string
  readonly adminUsername: string
  readonly adminDisplayName: string
  readonly adminPassword: string
}

/** `/users` create body — the host enforces role ceiling and tenant scope. */
export interface AdminCreateUserInput {
  /** Required for SUPER_ADMIN; a SCHOOL_ADMIN may omit it (own tenant implied). */
  readonly schoolId?: string
  readonly username: string
  readonly displayName: string
  readonly password: string
  readonly role: 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN'
}

/** The `/physicsos/admin` surface — every call is session+role-gated host-side. */
export interface AdminApi {
  listSchoolRequests: (status?: string) => Promise<{ requests: SchoolRequestRow[] }>
  approveSchoolRequest: (id: string, input: ApproveInput) => Promise<{ school: SchoolRow; admin: AdminUserRow }>
  rejectSchoolRequest: (id: string, reason?: string) => Promise<{ request: SchoolRequestRow }>
  listSchools: () => Promise<{ schools: (SchoolRow & { status: string })[] }>
  createSchool: (input: { id: string; name: string; shortName?: string }) => Promise<{ school: SchoolRow }>
  setSchoolStatus: (id: string, status: 'active' | 'disabled') => Promise<{ school: SchoolRow }>
  listUsers: (filter?: { schoolId?: string; role?: string; q?: string }) => Promise<{ users: AdminUserRow[] }>
  createUser: (input: AdminCreateUserInput) => Promise<{ user: AdminUserRow }>
  setUserStatus: (schoolId: string, username: string, status: 'active' | 'disabled') => Promise<{ user: AdminUserRow }>
  resetUserPassword: (schoolId: string, username: string, newPassword: string) => Promise<{ ok: boolean }>
  revokeUserSessions: (schoolId: string, username: string) => Promise<{ ok: boolean }>
  listAudit: (filter?: { schoolId?: string; limit?: number }) => Promise<{ events: AuditEventRow[] }>
  /** Password-recovery queue; rows never contain the raw token or its hash. */
  listPasswordResets: (filter?: {
    status?: PasswordResetStatus
    schoolId?: string
    q?: string
    limit?: number
  }) => Promise<{ requests: PasswordResetQueueRow[] }>
  /** Issue and reveal a fresh one-time token to the acting administrator. */
  issuePasswordReset: (id: string) => Promise<IssuedPasswordReset>
  /** Cancel a queue row and revoke its currently active token. */
  cancelPasswordReset: (id: string) => Promise<{ request: PasswordResetQueueRow }>
  /** Server-known platform/tenant figures. Never inferred, never client-side. */
  dashboard: () => Promise<DashboardRow>
  /** Read-only host, dependency, disk, and cache metrics for platform admins. */
  opsMetrics: (force?: boolean) => Promise<OpsMetrics>
  /** 登记过的设备 + 风控信号(第 4 期服务端半)。 */
  listDevices: (filter?: { schoolId?: string; q?: string }) =>
  Promise<{ devices: DeviceRow[]; risk: RiskSignalRow[] }>
  /** 远程注销 / 恢复一台设备。scope 由发起人的角色决定(超管 = 全局)。 */
  setDeviceRevoked: (deviceId: string, revoked: boolean) =>
  Promise<{ deviceId: string; scope: string }>
}

/** The injected surface: plain callbacks returning wire data. */
export interface AuthApi {
  register: (input: RegisterInput) => Promise<{ user: AuthUser }>
  login: (input: LoginInput) => Promise<{ user: AuthUser }>
  logout: () => Promise<{ ok: boolean }>
  me: () => Promise<{ user: AuthUser }>
  forgotPassword: (input: { username: string; schoolId?: string }) => Promise<{ ok: boolean }>
  /** Redeem a one-time token; the host revokes every live session on success. */
  resetPassword: (input: { token: string; newPassword: string }) => Promise<{ ok: boolean }>
  /**
   * 上报一次自测对错。只发知识点 id 与对错 —— 没有账号、没有答案、没有自由
   * 文本;学校与日期都由服务端决定。记录学习历史是本地的事,上报是尽力而为。
   */
  reportLearning: (input: { knowledgeId: string; correct: boolean }) => Promise<{ ok: boolean }>
}

/** The real client — bound once in `apply`, injected as callbacks.
 * @returns the `AuthApi` callback surface over `fetch`.
 */
export function createAuthApi(): AuthApi {
  return {
    register: input => post('/register', input),
    login: input => post('/login', input),
    logout: () => post('/logout'),
    me: () => request(AUTH_BASE, '/me'),
    forgotPassword: input => post('/password/forgot', input),
    resetPassword: input => post('/password/reset', input),
    reportLearning: async (input) => {
      await post('/usage/learning', input)
      return { ok: true }
    },
  }
}

/** The admin client — same cookie session, `/physicsos/admin` prefix.
 * @returns the `AdminApi` callback surface over `fetch`.
 */
export function createAdminApi(): AdminApi {
  const userPath = (schoolId: string, username: string, verb: string) =>
    `/users/${encodeURIComponent(`${schoolId}:${username}`)}/${verb}`
  return {
    listSchoolRequests: status =>
      request(ADMIN_BASE, `/school-requests${status === undefined ? '' : `?status=${status}`}`),
    approveSchoolRequest: (id, input) => adminPost(`/school-requests/${id}/approve`, input),
    rejectSchoolRequest: (id, reason) =>
      adminPost(`/school-requests/${id}/reject`, reason === undefined ? {} : { reason }),
    listSchools: () => request(ADMIN_BASE, '/schools'),
    createSchool: input => adminPost('/schools', input),
    setSchoolStatus: (id, status) => adminPost(`/schools/${id}/status`, { status }),
    listUsers: (filter) => {
      const params = new URLSearchParams()
      if (filter?.schoolId !== undefined) params.set('schoolId', filter.schoolId)
      if (filter?.role !== undefined) params.set('role', filter.role)
      if (filter?.q !== undefined) params.set('q', filter.q)
      const qs = params.toString()
      return request(ADMIN_BASE, `/users${qs === '' ? '' : `?${qs}`}`)
    },
    createUser: input => adminPost('/users', input),
    setUserStatus: (schoolId, username, status) =>
      adminPost(userPath(schoolId, username, 'status'), { status }),
    resetUserPassword: (schoolId, username, newPassword) =>
      adminPost(userPath(schoolId, username, 'reset-password'), { newPassword }),
    revokeUserSessions: (schoolId, username) =>
      adminPost(userPath(schoolId, username, 'revoke-sessions'), {}),
    listAudit: (filter) => {
      const params = new URLSearchParams()
      if (filter?.schoolId !== undefined) params.set('schoolId', filter.schoolId)
      if (filter?.limit !== undefined) params.set('limit', String(filter.limit))
      const qs = params.toString()
      return request(ADMIN_BASE, `/audit${qs === '' ? '' : `?${qs}`}`)
    },
    listPasswordResets: (filter) => {
      const params = new URLSearchParams()
      if (filter?.status !== undefined) params.set('status', filter.status)
      if (filter?.schoolId !== undefined) params.set('schoolId', filter.schoolId)
      if (filter?.q !== undefined) params.set('q', filter.q)
      if (filter?.limit !== undefined) params.set('limit', String(filter.limit))
      const qs = params.toString()
      return request(ADMIN_BASE, `/password-resets${qs === '' ? '' : `?${qs}`}`, { cache: 'no-store' })
    },
    issuePasswordReset: id =>
      adminPost(`/password-resets/${encodeURIComponent(id)}/issue`, {}),
    cancelPasswordReset: id =>
      adminPost(`/password-resets/${encodeURIComponent(id)}/cancel`, {}),
    /* 看板是活数据:同一次会话里先看过一次,再点回来看的必须是新数字。
       没有这个 header 时,浏览器把 GET 缓存住,上报进来的新增量看不见 ——
       运维会照着过期数字做决定。 */
    dashboard: () => request(ADMIN_BASE, '/dashboard', { cache: 'no-store' }),
    opsMetrics: force => request('/physicsos/ops', `/metrics${force === true ? '?force=1' : ''}`, {
      cache: 'no-store',
    }),
    listDevices: (filter) => {
      const params = new URLSearchParams()
      if (filter?.schoolId !== undefined) params.set('schoolId', filter.schoolId)
      if (filter?.q !== undefined) params.set('q', filter.q)
      const qs = params.toString()
      return request(ADMIN_BASE, `/devices${qs === '' ? '' : `?${qs}`}`, { cache: 'no-store' })
    },
    /* deviceId 是哈希,只含 [a-f0-9],放进路径无需转义;仍然编码一道,免得将来
       闸门放宽时这里悄悄变成路径拼接问题。 */
    setDeviceRevoked: (deviceId, revoked) =>
      adminPost(`/devices/${encodeURIComponent(deviceId)}/revoked`, { revoked }),
  }
}
