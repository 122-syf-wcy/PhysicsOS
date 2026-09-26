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

export interface LearningApi {
  listAttempts: (query?: ListLearningQuery) => Promise<LearningPage<StudentAttempt>>
  putAttempt: (attempt: StudentAttempt) => Promise<{ item: StudentAttempt }>
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
    const response = await call(`${base}${path}`, {
      ...init,
      headers,
    })
    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string }
    }
    if (!response.ok) {
      throw new LearningApiError(
        response.status,
        body.error?.code ?? `HTTP_${response.status}`,
        body.error?.message ?? String(response.status),
      )
    }
    return body as T
  }

  return {
    listAttempts: query => request(`/attempts${queryString(query)}`),
    putAttempt: attempt =>
      request(`/attempts/${encodeURIComponent(attempt.id)}`, {
        method: 'PUT',
        body: JSON.stringify(attempt),
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
