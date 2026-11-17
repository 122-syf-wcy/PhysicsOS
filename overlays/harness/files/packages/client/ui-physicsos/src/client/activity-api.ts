/** Activity v1 client. Separate from legacy UsageApi and auth/AdminApi; the host owns all counts. */
export type ActivityModule = 'app' | 'home' | 'lab' | 'canvas' | 'whiteboard' | 'courseware' | 'projects' | 'papers' | 'community' | 'profile' | 'sessions'
export type ActivitySource = 'experiment-run' | 'canvas-edit' | 'whiteboard-edit' | 'courseware-session'
export interface ActivityCounts { readonly visits: number; readonly opens: number; readonly uses: number }
export interface ActivityModuleCounts extends ActivityCounts { readonly module: ActivityModule; readonly lastUseAt?: string }
export interface ActivityIntegrity {
  readonly state: 'complete' | 'delayed' | 'incomplete'
  readonly codes: readonly string[]
  readonly pendingReceipts: number
  readonly sources: readonly { readonly source: ActivitySource; readonly caughtUp: boolean; readonly lastCheckedAt?: string }[]
}
export interface ActivityWindow {
  readonly version: 1
  readonly timezone: 'Asia/Shanghai'
  readonly from: string
  readonly to: string
  readonly collectionStartedAt: string | null
  readonly updatedAt: string
  readonly integrity: ActivityIntegrity
  readonly rankingExclusions: { readonly schoolIds: readonly string[]; readonly accounts: readonly { readonly schoolId: string; readonly username: string }[] }
}
export interface ActivityUserDetail extends ActivityWindow, ActivityCounts {
  readonly schoolId: string
  readonly username: string
  readonly lastUseAt?: string
  readonly modules: readonly ActivityModuleCounts[]
}
export interface ActivityAvatarSnapshot {
  readonly asOf: string
  readonly eligibleUsers: number
  readonly adoptedUsers: number
  readonly otherUsers: number
  readonly distribution: readonly { readonly id: string; readonly label: string; readonly path: string; readonly users: number }[]
}
export interface ActivitySchoolRow extends ActivityCounts {
  readonly rank: number
  readonly schoolId: string
  readonly schoolName: string
  readonly activeUsers: number
  readonly lastUseAt?: string
  readonly avatars: ActivityAvatarSnapshot
}
export type ActivityRankSort = 'uses' | 'visits' | 'opens' | 'activeUsers' | 'adoptedUsers'
export interface ActivitySchoolRanking extends ActivityWindow {
  readonly scope: 'platform' | 'school'
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly sort: ActivityRankSort
  readonly order: 'asc' | 'desc'
  readonly overview: ActivityCounts & { readonly schools: number; readonly activeUsers: number; readonly adoptedUsers: number }
  readonly rows: readonly ActivitySchoolRow[]
}
export type ActivityDays = 1 | 7 | 30 | 90
export interface ActivityDateQuery { readonly days?: ActivityDays; readonly to?: string }
export interface ActivityRankQuery extends ActivityDateQuery {
  readonly schoolId?: string
  readonly q?: string
  readonly page?: number
  readonly pageSize?: number
  readonly sort?: ActivityRankSort
  readonly order?: 'asc' | 'desc'
}
export interface ActivityClientEvent { readonly kind: 'visit' | 'open'; readonly id: string; readonly pageInstanceId: string; readonly module: ActivityModule }
export interface ActivityEventAck { readonly status: 'recorded' | 'duplicate'; readonly occurredAt: string }
export interface ActivityRequestOptions { readonly signal?: AbortSignal }
export interface ActivityCapabilities { readonly schemaVersion: 1; readonly mode: 'off' | 'bridge' | 'enabled'; readonly collectionEnabled: boolean; readonly queryCapacityVerified: boolean }
export interface ActivityApi {
  capabilities(request?: ActivityRequestOptions): Promise<ActivityCapabilities>
  userDetail(target: { readonly schoolId: string; readonly username: string }, query?: ActivityDateQuery, request?: ActivityRequestOptions): Promise<ActivityUserDetail>
  schoolRanking(query?: ActivityRankQuery, request?: ActivityRequestOptions): Promise<ActivitySchoolRanking>
  recordEvent(input: ActivityClientEvent, request?: ActivityRequestOptions): Promise<ActivityEventAck>
}
export class ActivityApiError extends Error {
  constructor(readonly code: string, message: string, readonly retryable: boolean) { super(message); this.name = 'ActivityApiError' }
}
/** The expectation header can ONLY narrow cookie authority, never choose an account to impersonate. */
export function createActivityApi(options: {
  readonly fetch?: typeof globalThis.fetch
  readonly owner?: () => { readonly schoolId: string; readonly username: string } | undefined
} = {}): ActivityApi {
  const request = async <T>(path: string, control: ActivityRequestOptions = {}, body?: unknown): Promise<T> => {
    const owner = options.owner?.(), headers = new Headers()
    if (owner !== undefined) headers.set('x-physicsos-activity-owner', encodeURIComponent(JSON.stringify(owner)))
    if (body !== undefined) headers.set('content-type', 'application/json')
    const timeout = AbortSignal.timeout(30_000), signal = control.signal === undefined ? timeout : AbortSignal.any([control.signal, timeout])
    const response = await (options.fetch ?? globalThis.fetch)(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers, signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const data = await response.json() as T & { error?: { code?: string; message?: string; retryable?: boolean } }
    if (!response.ok) throw new ActivityApiError(data.error?.code ?? `HTTP_${response.status}`, data.error?.message ?? '统计暂不可用。', data.error?.retryable ?? response.status >= 500)
    signal.throwIfAborted()
    return data
  }
  const search = (query: object): string => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value))
    return params.size === 0 ? '' : `?${params}`
  }
  return {
    capabilities: control => request('/physicsos/activity/v1/capabilities', control),
    userDetail: (target, query = {}, control) => request(`/physicsos/admin/activity/v1/users${search({ ...query, ...target })}`, control),
    schoolRanking: (query = {}, control) => request(`/physicsos/admin/activity/v1/schools${search(query)}`, control),
    recordEvent: (input, control) => request('/physicsos/activity/v1/events', control, input),
  }
}
