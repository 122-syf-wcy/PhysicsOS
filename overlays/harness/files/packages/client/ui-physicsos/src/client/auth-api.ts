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
    Object.defineProperty(error, 'code', { value: body.error?.code ?? 'HTTP_' + response.status })
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

export interface RegisterInput {
  /** Free-text school the user typed; the host resolves it to a tenant. */
  readonly schoolName?: string
  /** Disambiguation answer after `SCHOOL_AMBIGUOUS` — wins over schoolName. */
  readonly schoolId?: string
  readonly username: string
  readonly displayName: string
  readonly password: string
}

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
export interface AuditEventRow {
  readonly id: string
  readonly actorKey: string
  readonly schoolId: string
  readonly action: string
  readonly target: string
  readonly detail?: Record<string, unknown>
  readonly createdAt: string
}

export interface ApproveInput {
  readonly schoolId: string
  readonly shortName?: string
  readonly adminUsername: string
  readonly adminDisplayName: string
  readonly adminPassword: string
}

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
}

/** The injected surface: plain callbacks returning wire data. */
export interface AuthApi {
  register: (input: RegisterInput) => Promise<{ user: AuthUser }>
  login: (input: LoginInput) => Promise<{ user: AuthUser }>
  logout: () => Promise<{ ok: boolean }>
  me: () => Promise<{ user: AuthUser }>
  forgotPassword: (input: { username: string; schoolId?: string }) => Promise<{ ok: boolean }>
}

/** The real client — bound once in `apply`, injected as callbacks. */
export function createAuthApi(): AuthApi {
  return {
    register: input => post('/register', input),
    login: input => post('/login', input),
    logout: () => post('/logout'),
    me: () => request(AUTH_BASE, '/me'),
    forgotPassword: input => post('/password/forgot', input),
  }
}

/** The admin client — same cookie session, `/physicsos/admin` prefix. */
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
    listUsers: filter => {
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
    listAudit: filter => {
      const params = new URLSearchParams()
      if (filter?.schoolId !== undefined) params.set('schoolId', filter.schoolId)
      if (filter?.limit !== undefined) params.set('limit', String(filter.limit))
      const qs = params.toString()
      return request(ADMIN_BASE, `/audit${qs === '' ? '' : `?${qs}`}`)
    },
  }
}
