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

export type ProductLifecycle = 'live' | 'archived' | 'deleted'
export interface RecentSceneLifecycle {
  readonly sceneId: string
  readonly recentGeneration: number
  readonly recentVersion: number
  readonly recentState: ProductLifecycle
  readonly recentRestoreState?: 'live' | 'archived'
}
export interface ProjectProductState {
  readonly projectId: string
  readonly generation: number
  readonly version: number
  readonly state: ProductLifecycle
  readonly restoreState?: 'live' | 'archived'
  readonly updatedAt: string
}
export interface ProductStateMutation {
  readonly action: 'delete' | 'restore' | 'archive' | 'unarchive' | 'reopen'
  readonly expectedGeneration: number
  readonly expectedVersion: number
  readonly operationId: string
}
export interface ListProductStateQuery extends ListLearningQuery { readonly state?: ProductLifecycle | 'all' }
/** Available methods are not permission: callers must check the server capability first. */
export interface SessionProjectAssignment {
  readonly assigned?: boolean
  readonly sessionId: string
  readonly projectId: string | null
  readonly version: number
  readonly updatedAt: string
}
export interface PersonalProductApi {
  listSessionAssignments(query?: ListLearningQuery): Promise<LearningPage<SessionProjectAssignment>>
  getSessionAssignment(id: string): Promise<{ assignment: SessionProjectAssignment }>
  assignSessionProject(id: string, body: { readonly projectId: string | null; readonly expectedVersion: number; readonly operationId: string }): Promise<{ assignment: SessionProjectAssignment }>
  listRecentScenes(query?: ListProductStateQuery): Promise<LearningPage<RecentExperimentEntry>>
  getRecentState(sceneId: string): Promise<{ state: RecentSceneLifecycle }>
  mutateRecentScene(sceneId: string, mutation: ProductStateMutation): Promise<{ state: RecentSceneLifecycle; item?: RecentExperimentEntry }>
  listProjectStates(query?: ListProductStateQuery): Promise<LearningPage<ProjectProductState>>
  getProjectState(projectId: string): Promise<{ state: ProjectProductState }>
  mutateProjectState(projectId: string, mutation: ProductStateMutation): Promise<{ state: ProjectProductState }>
}

/** Exhaust every page or fail explicitly; never return an apparently complete first 100 rows. */
export async function collectLearningPages<T>(read: (cursor?: string) => Promise<LearningPage<T>>): Promise<T[]> {
  const items: T[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < 10_000; page += 1) {
    const result = await read(cursor)
    items.push(...result.items)
    if (result.nextCursor === undefined) return items
    if (seen.has(result.nextCursor)) throw new Error('learning pagination repeated a cursor')
    seen.add(result.nextCursor)
    cursor = result.nextCursor
  }
  throw new Error('learning pagination exceeded its safety budget')
}

export class LearningApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly current?: RecentSceneLifecycle | ProjectProductState,
  ) {
    super(message)
    this.name = 'LearningApiError'
  }
}

export interface LearningRequestOwner { readonly schoolId: string; readonly username: string }
export interface LearningApiOptions {
  readonly baseUrl?: string
  readonly fetch?: typeof globalThis.fetch
  /** Expected namespace, not authority. The cookie actor must match it on the host. */
  readonly owner?: () => LearningRequestOwner | undefined
}

const queryString = (query: ListProductStateQuery | undefined): string => {
  const params = new URLSearchParams()
  if (query?.cursor !== undefined) params.set('cursor', query.cursor)
  if (query?.limit !== undefined) params.set('limit', String(query.limit))
  if (query?.state !== undefined) params.set('state', query.state)
  const value = params.toString()
  return value === '' ? '' : `?${value}`
}

export function createLearningApi(options: LearningApiOptions = {}): LearningApi & PersonalProductApi {
  const base = (options.baseUrl ?? '/physicsos/learning').replace(/\/$/, '')
  const call = options.fetch ?? globalThis.fetch
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers)
    if (options.owner !== undefined) {
      const owner = options.owner()
      if (owner === undefined) throw new LearningApiError(401, 'LEARNING_OWNER_REQUIRED', '请先选择已登录账号。')
      headers.set('x-physicsos-learning-owner', encodeURIComponent(JSON.stringify({ schoolId: owner.schoolId, username: owner.username })))
    }
    if (init?.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }
    const expectedOwner = headers.get('x-physicsos-learning-owner')
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
      })) as { error?: { code?: string; message?: string; current?: RecentSceneLifecycle | ProjectProductState } }
      if (controller.signal.aborted) throw timeout
      if (options.owner !== undefined) {
        const owner = options.owner()
        if (owner === undefined || expectedOwner !== encodeURIComponent(JSON.stringify({ schoolId: owner.schoolId, username: owner.username })))
          throw new LearningApiError(409, 'LEARNING_OWNER_MISMATCH', '账号已变化；已放弃旧账号的响应。')
      }
      if (!response.ok) {
        throw new LearningApiError(response.status, body.error?.code ?? `HTTP_${response.status}`,
          body.error?.message ?? String(response.status), body.error?.current)
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
    listSessionAssignments: query => request(`/product-state/session-projects${queryString(query)}`),
    getSessionAssignment: id => request(`/product-state/session-projects/${encodeURIComponent(id)}`),
    assignSessionProject: (id, mutation) => request(`/product-state/session-projects/${encodeURIComponent(id)}`, {
      method: 'POST', body: JSON.stringify(mutation),
    }),
    listRecentScenes: query => request(`/product-state/recent-scenes${queryString(query)}`),
    getRecentState: id => request(`/product-state/recent-scenes/${encodeURIComponent(id)}`),
    mutateRecentScene: (id, mutation) => request(`/product-state/recent-scenes/${encodeURIComponent(id)}`, {
      method: 'POST', body: JSON.stringify(mutation),
    }),
    listProjectStates: query => request(`/product-state/projects${queryString(query)}`),
    getProjectState: id => request(`/product-state/projects/${encodeURIComponent(id)}`),
    mutateProjectState: (id, mutation) => request(`/product-state/projects/${encodeURIComponent(id)}`, {
      method: 'POST', body: JSON.stringify(mutation),
    }),
  }
}
