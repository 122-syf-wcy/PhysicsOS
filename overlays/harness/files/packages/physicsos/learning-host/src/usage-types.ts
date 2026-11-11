/** Account-use data contains numerical counters and product action names, never conversation text. */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'

export const USAGE_SURFACES = [
  'home',
  'lab',
  'experiment',
  'canvas',
  'whiteboard',
  'projects',
  'chat',
  'record',
  'usage',
  'community',
  'admin',
  'papers',
  'question',
  'knowledge',
  'profile',
] as const
export type UsageSurface = (typeof USAGE_SURFACES)[number]
export const USAGE_ACTIONS = ['open', 'view', 'run', 'edit', 'capture', 'generate', 'submit', 'save', 'export'] as const
export type UsageAction = (typeof USAGE_ACTIONS)[number]
export interface UsageEventInput {
  readonly id: string
  readonly kind: 'visit' | 'use'
  readonly surface: UsageSurface
  readonly action?: UsageAction
}
export interface UsageEvent extends UsageEventInput {
  readonly at: string
}
export interface UsageQuery {
  readonly from?: string
  readonly to?: string
  readonly schoolId?: string
}
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
export interface UsageApi {
  summary(query?: UsageQuery): Promise<UsageSummary>
  adminSummary(query?: UsageQuery): Promise<UsageSummary>
  recordEvent(input: UsageEventInput): Promise<UsageEvent>
}
export interface UsageOwner {
  readonly schoolId: string
  readonly userKey: string
}
export type UsageModelSource = 'session' | 'moderation' | 'paper' | 'image' | 'diagram'
/** A trusted host callback; a missing owner is explicitly system work, not an anonymous account. */
export interface UsageModelReceiptInput {
  readonly id: string
  readonly source: UsageModelSource
  readonly owner?: UsageOwner
  readonly provider: string
  readonly model: string
  readonly usage?: TokenUsage
  readonly occurredAt?: string
}
export interface UsageLimits {
  readonly maxRequestBytes: number
  readonly maxEventsPerAccount: number
  readonly maxReceiptsPerAccount: number
  readonly maxWindowDays: number
  readonly maxSessionEventsPerPass: number
  readonly scanIntervalMs: number
  readonly requestTimeoutMs: number
  readonly maxInFlightRequests: number
}
export const DEFAULT_USAGE_LIMITS: UsageLimits = Object.freeze({
  maxRequestBytes: 16_384,
  maxEventsPerAccount: 100_000,
  maxReceiptsPerAccount: 100_000,
  maxWindowDays: 3660,
  maxSessionEventsPerPass: 10_000,
  scanIntervalMs: 5000,
  requestTimeoutMs: 120_000,
  maxInFlightRequests: 128,
})
