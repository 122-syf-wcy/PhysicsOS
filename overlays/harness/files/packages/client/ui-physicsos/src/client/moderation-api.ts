/** Cookie-only same-origin DTO contract: auth-host/src/moderation/types.ts. */
export const moderationStatuses = ['pending', 'reviewing', 'allowed', 'flagged', 'error', 'dismissed', 'banned'] as const
export type ModerationStatus = typeof moderationStatuses[number]
export interface ModerationReview {
  risk: 'allow' | 'review'
  category: 'none' | 'illegal_assistance' | 'abuse' | 'self_harm' | 'sexual' | 'violence' | 'privacy' | 'other'
  severity: 'none' | 'low' | 'medium' | 'high'
  confidence: number
  reason: string
  evidence: string[]
}
export interface ModerationCase {
  id: string
  sessionId: string
  messageId: string
  sessionTitle?: string
  ownerKey: string
  schoolId: string
  username: string
  userId: string
  text: string
  context: string
  textTruncated: boolean
  contextTruncated: boolean
  status: ModerationStatus
  version: number
  createdAt: string
  updatedAt: string
  review?: ModerationReview
  error?: string
  decision?: { decision: 'dismiss' | 'ban'; reason: string; actorKey: string; decidedAt: string }
  accountStatus: 'active' | 'disabled'
}
export interface ModerationSettings {
  version: number
  enabled: boolean
  updatedAt: string
  captureFailures: number
  lastCaptureFailure?: 'CAPTURE_CAPACITY'
}
export interface ModerationQuery { page?: number; limit?: number; status?: ModerationStatus }
export interface ModerationPage { cases: ModerationCase[]; total: number; page: number; limit: number }
export interface ModerationDecision { version: number; decision: 'dismiss' | 'ban'; reason: string }
export interface ModerationScan { scanned: number; captured: number }
export interface ModerationApi {
  list: (query: ModerationQuery, signal?: AbortSignal) => Promise<ModerationPage>
  detail: (id: string, signal?: AbortSignal) => Promise<ModerationCase>
  settings: (signal?: AbortSignal) => Promise<ModerationSettings>
  setEnabled: (input: { version: number; enabled: boolean }, signal?: AbortSignal) => Promise<ModerationSettings>
  decide: (id: string, input: ModerationDecision, signal?: AbortSignal) => Promise<ModerationCase>
  retry: (id: string, input: { version: number }, signal?: AbortSignal) => Promise<ModerationCase>
  scan: (signal?: AbortSignal) => Promise<ModerationScan>
}
export class ModerationApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'ModerationApiError'
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max = Infinity, min = 0): value is string =>
  typeof value === 'string' && value.length >= min && value.length <= max
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
const oneOf = (value: unknown, choices: readonly string[]): boolean =>
  typeof value === 'string' && choices.includes(value)
function validReview(value: unknown): value is ModerationReview {
  return object(value) && oneOf(value.risk, ['allow', 'review'])
    && oneOf(value.category, ['none', 'illegal_assistance', 'abuse', 'self_harm', 'sexual', 'violence', 'privacy', 'other'])
    && oneOf(value.severity, ['none', 'low', 'medium', 'high'])
    && typeof value.confidence === 'number' && Number.isFinite(value.confidence)
    && value.confidence >= 0 && value.confidence <= 1 && text(value.reason, 2_000, 1)
    && Array.isArray(value.evidence) && value.evidence.length <= 20
    && value.evidence.every(part => text(part, 4_000, 1))
}
function validCase(value: unknown): value is ModerationCase {
  return object(value) && text(value.id, Infinity, 1)
    && text(value.sessionId, 256, 1) && text(value.messageId, 256, 1)
    && (value.sessionTitle === undefined || text(value.sessionTitle, 256))
    && ['ownerKey', 'schoolId', 'username', 'userId'].every(key => text(value[key], Infinity, 1))
    && text(value.text, 12_000) && text(value.context, 4_000)
    && typeof value.textTruncated === 'boolean' && typeof value.contextTruncated === 'boolean'
    && oneOf(value.status, moderationStatuses) && integer(value.version, 1)
    && text(value.createdAt) && text(value.updatedAt)
    && oneOf(value.accountStatus, ['active', 'disabled'])
    && (value.review === undefined || validReview(value.review))
    && (value.error === undefined || text(value.error, 64))
    && (value.decision === undefined || (object(value.decision)
      && oneOf(value.decision.decision, ['dismiss', 'ban']) && text(value.decision.reason, 2_000, 1)
      && text(value.decision.actorKey, Infinity, 1) && text(value.decision.decidedAt)))
}
function validPage(value: unknown): value is ModerationPage {
  return object(value) && integer(value.total) && integer(value.page, 1) && integer(value.limit, 1, 50)
    && Array.isArray(value.cases) && value.cases.length <= value.limit && value.cases.every(validCase)
}
function validSettings(value: unknown): value is ModerationSettings {
  return object(value) && integer(value.version, 1) && typeof value.enabled === 'boolean'
    && text(value.updatedAt) && integer(value.captureFailures, 0, 1_000_000_000)
    && (value.lastCaptureFailure === undefined || value.lastCaptureFailure === 'CAPTURE_CAPACITY')
}
function validScan(value: unknown): value is ModerationScan {
  return object(value) && integer(value.scanned, 0, 20) && integer(value.captured, 0, 20)
}
async function request<T>(
  path: string, validate: (value: unknown) => value is T, input?: unknown, signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/physicsos/admin/moderation${path}`, {
    credentials: 'same-origin', cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
    ...(input === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }),
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = object(body) && object(body.error) ? body.error : undefined
    throw new ModerationApiError(response.status,
      typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED',
      typeof error?.message === 'string' ? error.message : '对话审核请求失败，请重试。')
  }
  if (!validate(body)) throw new ModerationApiError(502, 'INVALID_RESPONSE', '审核返回内容不完整，请刷新。')
  return body
}
export function createModerationApi(): ModerationApi {
  const casePath = (id: string) => `/cases/${encodeURIComponent(id)}`
  return {
    list: (query, signal) => {
      const params = new URLSearchParams({
        page: String(Math.max(1, Math.floor(query.page ?? 1))),
        limit: String(Math.max(1, Math.min(50, Math.floor(query.limit ?? 20)))),
      })
      if (query.status !== undefined) params.set('status', query.status)
      return request(`/cases?${params}`, validPage, undefined, signal)
    },
    detail: (id, signal) => request(casePath(id), validCase, undefined, signal),
    settings: signal => request('/settings', validSettings, undefined, signal),
    setEnabled: (input, signal) => request('/settings', validSettings, input, signal),
    decide: (id, input, signal) => request(`${casePath(id)}/decision`, validCase, input, signal),
    retry: (id, input, signal) => request(`${casePath(id)}/retry`, validCase, input, signal),
    scan: signal => request('/scan', validScan, {}, signal),
  }
}
