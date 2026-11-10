/** Account usage wire contract; counters are authored by the authenticated Host. */
export interface UsageTokens {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
  readonly totalTokens: number
}
export interface UsageCoverage {
  readonly reportedCalls: number
  readonly missingCalls: number
  readonly unavailableSessions?: number
}
export interface UsageDay extends UsageCoverage {
  readonly date: string
  readonly visits: number
  readonly uses: number
  readonly tokens: UsageTokens
}
export interface UsageSummary {
  readonly scope: 'account' | 'school' | 'platform'
  readonly timezone: 'Asia/Shanghai'
  readonly from: string
  readonly to: string
  readonly visits: number
  readonly uses: number
  readonly activeDays: number
  readonly tokens: UsageTokens
  readonly coverage: UsageCoverage
  readonly system: UsageCoverage & { readonly tokens: UsageTokens }
  readonly daily: readonly UsageDay[]
  readonly updatedAt: string
}
export interface UsageQuery {
  readonly from?: string
  readonly to?: string
  readonly schoolId?: string
}
export interface UsageEventInput {
  readonly id: string
  readonly kind: 'visit' | 'use'
  readonly surface: string
  readonly action?: string
}
export interface UsageEvent extends UsageEventInput {
  readonly at: string
}
export interface UsageApi {
  summary(query?: UsageQuery): Promise<UsageSummary>
  adminSummary(query?: UsageQuery): Promise<UsageSummary>
  recordEvent(input: UsageEventInput): Promise<UsageEvent>
}

/** Cookie-authenticated counters; an expected owner can only narrow server authority. */
export function createUsageApi(
  options: {
    readonly fetch?: typeof globalThis.fetch
    readonly owner?: () => { readonly schoolId: string; readonly username: string } | undefined
  } = {},
): UsageApi {
  const request = async <T>(path: string, body?: unknown): Promise<T> => {
    const owner = options.owner?.(),
      headers = new Headers()
    if (owner !== undefined) headers.set('x-physicsos-usage-owner', encodeURIComponent(JSON.stringify(owner)))
    if (body !== undefined) headers.set('content-type', 'application/json')
    const response = await (options.fetch ?? globalThis.fetch)(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    })
    const value = (await response.json()) as T & { error?: { message?: string } }
    if (!response.ok) throw new Error(value.error?.message ?? `HTTP ${response.status}`)
    return value
  }
  const queryString = (query?: UsageQuery): string => {
    const params = new URLSearchParams()
    for (const key of ['from', 'to', 'schoolId'] as const) {
      const value = query?.[key]
      if (value !== undefined) params.set(key, value)
    }
    return params.size === 0 ? '' : `?${params}`
  }
  return {
    summary: query => request(`/physicsos/usage${queryString(query)}`),
    adminSummary: query => request(`/physicsos/admin/usage${queryString(query)}`),
    recordEvent: input => request('/physicsos/usage/events', input),
  }
}
