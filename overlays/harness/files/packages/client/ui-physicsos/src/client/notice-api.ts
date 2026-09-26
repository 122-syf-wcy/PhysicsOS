/**
 * Fetch client for the notice host's `/physicsos/notice` REST surface.
 *
 * One file for both directions because they are one conversation: a student
 * reports, an operator answers, an admin publishes. The two halves share the
 * prefix, the cookie and the error envelope, so splitting them would only mean
 * two places to update when the envelope changes.
 */
const BASE = '/physicsos/notice'

/** The category a report lands in — drives the admin queue's triage columns. */
export type FeedbackKind = 'bug' | 'content' | 'idea' | 'other'
/** A report's lifecycle: teacher replies move `open` to `answered`/`closed`. */
export type FeedbackStatus = 'open' | 'answered' | 'closed'

/** One feedback report as the host returns it. */
export interface FeedbackRow {
  readonly id: string
  readonly schoolId: string
  /** `schoolId:username` as the SERVER resolved it — never from the body. */
  readonly authorKey: string
  readonly kind: FeedbackKind
  readonly body: string
  readonly contact?: string
  readonly context?: string
  readonly status: FeedbackStatus
  readonly reply?: string
  readonly repliedBy?: string
  readonly repliedAt?: string
  readonly createdAt: string
}

/** One announcement as the host returns it. */
export interface AnnouncementRow {
  readonly id: string
  /** null = platform-wide. */
  readonly schoolId: string | null
  readonly title: string
  readonly body: string
  readonly authorKey: string
  readonly publishedAt?: string
  readonly retiredAt?: string
  readonly createdAt: string
}

/** A failed call, carrying the host's code so the UI can say something exact. */
export class NoticeApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'NoticeApiError'
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const body = await response.json().catch(() => ({})) as {
    error?: { code?: string; message?: string }
  }
  if (!response.ok) {
    throw new NoticeApiError(
      response.status,
      body.error?.code ?? `HTTP_${response.status}`,
      body.error?.message ?? `${response.status}`,
    )
  }
  return body as T
}

/** The `/physicsos/notice` surface — feedback intake plus the announcement board. */
export interface NoticeApi {
  /** File a report. Any signed-in account; the author comes from the session. */
  submitFeedback: (input: {
    kind: FeedbackKind
    body: string
    contact?: string
    context?: string
  }) => Promise<{ item: FeedbackRow }>
  /**
   * Rows the CALLER is entitled to: their own when they are a student, the
   * tenant queue when they are a teacher or above. The filter lives on the
   * server — this client does not decide what is visible.
   */
  listFeedback: (filter?: { status?: FeedbackStatus }) => Promise<{ items: FeedbackRow[] }>
  replyFeedback: (
    id: string, reply: string, status?: 'answered' | 'closed',
  ) => Promise<{ item: FeedbackRow }>
  feedbackStats: () => Promise<{ open: number; answered: number; closed: number }>
  listAnnouncements: () => Promise<{ items: AnnouncementRow[] }>
  publishAnnouncement: (
    input: { title: string; body: string; schoolId?: string | null },
  ) => Promise<{ item: AnnouncementRow }>
  retireAnnouncement: (id: string) => Promise<{ item: AnnouncementRow }>
}

/** The real client — bound once in `apply`, injected as callbacks.
 * @returns the `NoticeApi` callback surface over `fetch`.
 */
export function createNoticeApi(): NoticeApi {
  return {
    submitFeedback: input => request('/feedback', {
      method: 'POST', body: JSON.stringify(input),
    }),
    listFeedback: (filter) => {
      const params = new URLSearchParams()
      if (filter?.status !== undefined) params.set('status', filter.status)
      const qs = params.toString()
      return request(`/feedback${qs === '' ? '' : `?${qs}`}`)
    },
    replyFeedback: (id, reply, status) => request(`/feedback/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify(status === undefined ? { reply } : { reply, status }),
    }),
    feedbackStats: () => request('/feedback/stats'),
    listAnnouncements: () => request('/announcements'),
    publishAnnouncement: input => request('/announcements', {
      method: 'POST', body: JSON.stringify(input),
    }),
    retireAnnouncement: id => request(`/announcements/${id}/retire`, {
      method: 'POST', body: '{}',
    }),
  }
}
