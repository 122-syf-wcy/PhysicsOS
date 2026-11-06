/**
 * Fetch client for `/physicsos/learning`.
 *
 * The session remains in the HttpOnly cookie, so this client never handles a
 * token. Attempts and scenes are personal data: paths carry only opaque client
 * ids, and every error preserves the host's code for callers that need to
 * distinguish offline/session failures from malformed data.
 */

import type { StudentAttempt } from './learning-record-store.ts'
import type { RecentExperimentEntry } from './surface-store.ts'

export interface LearningPage<T> {
  readonly items: T[]
  readonly nextCursor?: string
}

export interface ListLearningQuery {
  readonly cursor?: string
  readonly limit?: number
}

/**
 * One row's outcome inside a batch upload. `saved` is a fresh write or an
 * idempotent repeat; the other three are definitive host refusals — the row
 * as sent will never be accepted, so the client must stop retrying it.
 */
export type AttemptBatchResult =
  | { readonly id: string; readonly status: 'saved'; readonly item: StudentAttempt }
  | {
    readonly id: string
    readonly status: 'invalid' | 'conflict' | 'forbidden'
    readonly error: { readonly code: string; readonly message: string }
  }

/** Rows per batch request; mirrors the host's `MAX_ATTEMPT_BATCH`. */
export const ATTEMPT_BATCH_SIZE = 50

export interface LearningApi {
  listAttempts: (query?: ListLearningQuery) => Promise<LearningPage<StudentAttempt>>
  putAttempt: (attempt: StudentAttempt) => Promise<{ item: StudentAttempt }>
  /** Upload up to {@link ATTEMPT_BATCH_SIZE} attempts in one round trip. */
  putAttempts: (attempts: readonly StudentAttempt[]) => Promise<{ results: AttemptBatchResult[] }>
  listScenes: (query?: ListLearningQuery) => Promise<LearningPage<RecentExperimentEntry>>
  putScene: (entry: RecentExperimentEntry) => Promise<{ item: RecentExperimentEntry }>
  deleteScene: (sceneId: string) => Promise<{ ok: boolean }>
}

export class LearningApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'LearningApiError'
  }
}

export interface LearningApiOptions {
  readonly baseUrl?: string
  readonly fetch?: typeof globalThis.fetch
}

const queryString = (query: ListLearningQuery | undefined): string => {
  const params = new URLSearchParams()
  if (query?.cursor !== undefined) params.set('cursor', query.cursor)
  if (query?.limit !== undefined) params.set('limit', String(query.limit))
  const value = params.toString()
  return value === '' ? '' : `?${value}`
}

export function createLearningApi(options: LearningApiOptions = {}): LearningApi {
  const base = (options.baseUrl ?? '/physicsos/learning').replace(/\/$/, '')
  const call = options.fetch ?? globalThis.fetch
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers)
    if (init?.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }
    const controller = new AbortController()
    const timeout = new LearningApiError(408, 'LEARNING_TIMEOUT', '学习记录同步超时，请稍后重试。')
    const timer = setTimeout(() => { controller.abort(timeout) }, 15_000)
    try {
      const response = await call(`${base}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      })
      const body = (await response.json().catch((error: unknown) => {
        if (controller.signal.aborted) throw error
        return {}
      })) as { error?: { code?: string; message?: string } }
      if (controller.signal.aborted) throw timeout
      if (!response.ok) {
        throw new LearningApiError(response.status, body.error?.code ?? `HTTP_${response.status}`,
          body.error?.message ?? String(response.status))
      }
      return body as T
    } catch (error) {
      if (controller.signal.aborted) throw timeout
      throw error
    } finally { clearTimeout(timer) }
  }

  return {
    listAttempts: query => request(`/attempts${queryString(query)}`),
    putAttempt: attempt =>
      request(`/attempts/${encodeURIComponent(attempt.id)}`, {
        method: 'PUT',
        body: JSON.stringify(attempt),
      }),
    putAttempts: attempts =>
      request('/attempts/batch', {
        method: 'POST',
        body: JSON.stringify({ items: attempts }),
      }),
    listScenes: query => request(`/scenes${queryString(query)}`),
    putScene: entry =>
      request(`/scenes/${encodeURIComponent(entry.sceneId)}`, {
        method: 'PUT',
        body: JSON.stringify(entry),
      }),
    deleteScene: sceneId =>
      request(`/scenes/${encodeURIComponent(sceneId)}`, {
        method: 'DELETE',
      }),
  }
}
