import { parseCanvasAnnotations } from '@physicsos/physics-whiteboard'
import type { CoursewareAnnotationHead, CoursewareAnnotationSave, CoursewareCapabilities, CoursewareLesson, CoursewareLessonSummary, CoursewareLifecycle, CoursewareRecord, CoursewareSummary, CoursewareTicket } from './types.ts'
interface Lifetime { readonly signal?: AbortSignal }
export interface CoursewareApi {
  capabilities(input: Lifetime): Promise<CoursewareCapabilities>
  list(input: Lifetime & { readonly search?: string; readonly lifecycle?: CoursewareLifecycle; readonly scope?: 'all' | 'mine' | 'school'; readonly cursor?: string }): Promise<{ readonly items: readonly CoursewareSummary[]; readonly nextCursor?: string }>
  importFile(input: Lifetime & { readonly file: Blob; readonly title: string; readonly description: string; readonly operationId: string; readonly deckId?: string; readonly expectedActiveId?: string }): Promise<CoursewareRecord>
  read(input: Lifetime & { readonly deckId: string }): Promise<CoursewareRecord>
  activate(input: Lifetime & { readonly deckId: string; readonly versionId: string; readonly expectedActiveId: string; readonly operationId: string }): Promise<CoursewareRecord>
  manage(input: Lifetime & { readonly deckId: string; readonly expectedRevision: number; readonly operationId: string; readonly action: 'rename' | 'publish' | 'unpublish' | 'archive' | 'unarchive' | 'delete' | 'restore'; readonly title?: string; readonly description?: string }): Promise<CoursewareRecord>
  ticket(input: Lifetime & { readonly deckId: string; readonly versionId: string }): Promise<CoursewareTicket>
  lessons(input: Lifetime & { readonly deckId: string; readonly versionId: string }): Promise<readonly CoursewareLessonSummary[]>
  startLesson(input: Lifetime & { readonly deckId: string; readonly versionId: string; readonly operationId: string }): Promise<CoursewareLesson>
  readLesson(input: Lifetime & { readonly deckId: string; readonly lessonId: string }): Promise<CoursewareLesson>
  readAnnotation(input: Lifetime & { readonly deckId: string; readonly lessonId: string; readonly slideId: string }): Promise<CoursewareAnnotationHead>
  saveAnnotation(input: Lifetime & { readonly deckId: string; readonly lessonId: string; readonly slideId: string; readonly expectedRevision: number; readonly operationId: string; readonly scene: unknown }): Promise<CoursewareAnnotationSave>
  addBlankPage(input: Lifetime & { readonly deckId: string; readonly lessonId: string; readonly expectedRevision: number; readonly operationId: string }): Promise<CoursewareLesson>
}
export class CoursewareApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: Readonly<Record<string, unknown>>) { super(message); this.name = 'CoursewareApiError' }
}
export const coursewareAccessFailure = (error: unknown): boolean => error instanceof CoursewareApiError && [401, 403, 404, 410, 423, 426].includes(error.status)
export const coursewareOfflineFailure = (error: unknown): boolean => error instanceof TypeError || error instanceof CoursewareApiError && (error.status >= 500 || [408, 429].includes(error.status))
export function createCoursewareHttpApi(options: { readonly owner: () => { readonly schoolId: string; readonly username: string } | undefined; readonly fetch?: typeof fetch }): CoursewareApi {
  const root = '/physicsos/courseware'; const transport = options.fetch ?? fetch
  const path = (id: string): string => `${root}/${encodeURIComponent(id)}`
  async function request<T>(url: string, method: string, body: unknown, signal?: AbortSignal, captured = options.owner()): Promise<T> {
    if (!captured) throw new CoursewareApiError(401, 'NO_ACCOUNT', '请先登录后打开课件。')
    signal?.throwIfAborted()
    const response = await transport(url, { method, credentials: 'same-origin', cache: 'no-store', headers: { 'x-physicsos-canvas-owner': encodeURIComponent(JSON.stringify(captured)), 'x-physicsos-courseware-capability': 'courseware-v1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}) })
    const data: unknown = await response.json()
    if (!response.ok) {
      const error = data && typeof data === 'object' && 'error' in data && data.error && typeof data.error === 'object' ? data.error as Record<string, unknown> : undefined
      throw new CoursewareApiError(response.status, typeof error?.code === 'string' ? error.code : 'HTTP_ERROR', typeof error?.message === 'string' ? error.message : `课件请求失败（${response.status}）。`, error?.details && typeof error.details === 'object' ? error.details as Record<string, unknown> : undefined)
    }
    signal?.throwIfAborted()
    // An expectation is refusal-only; a later account cannot adopt the response of an earlier one.
    const current = options.owner()
    if (!current || captured.schoolId !== current.schoolId || captured.username !== current.username) throw new CoursewareApiError(401, 'ACCOUNT_CHANGED', '账号已变化，旧课件响应已隔离。')
    return data as T
  }
  const page = (data: CoursewareAnnotationHead): CoursewareAnnotationHead => {
    if (!Number.isSafeInteger(data.revision) || data.revision < 0 || !Number.isFinite(Date.parse(data.updatedAt))) throw new CoursewareApiError(502, 'INVALID_RESPONSE', '批注响应格式无效。')
    return { ...data, scene: parseCanvasAnnotations(data.scene) }
  }
  return {
    capabilities: ({ signal }) => request(`${root}/capabilities`, 'GET', undefined, signal),
    list: ({ signal, ...query }) => request(`${root}?${new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))}`, 'GET', undefined, signal),
    importFile: async ({ file, signal, deckId, ...data }) => {
      const owner = options.owner()
      if (!owner) throw new CoursewareApiError(401, 'NO_ACCOUNT', '请先登录后导入课件。')
      if (file.size < 1 || file.size > 16 * 1024 * 1024) throw new CoursewareApiError(413, 'FILE_LIMIT', '请选择不超过 16 MiB 的完整 HTML 文件。')
      const bytes = new Uint8Array(await file.arrayBuffer()); signal?.throwIfAborted()
      let binary = ''; for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192))
      return request(deckId ? `${path(deckId)}/versions` : root, 'POST', { ...data, htmlBase64: btoa(binary) }, signal, owner)
    },
    read: ({ deckId, signal }) => request(path(deckId), 'GET', undefined, signal),
    activate: ({ deckId, signal, ...data }) => request(`${path(deckId)}/activate`, 'POST', data, signal),
    manage: ({ deckId, signal, ...data }) => request(`${path(deckId)}/manage`, 'POST', data, signal),
    ticket: ({ deckId, signal, ...data }) => request(`${path(deckId)}/tickets`, 'POST', data, signal),
    lessons: ({ deckId, versionId, signal }) => request(`${path(deckId)}/lessons?${new URLSearchParams({ versionId })}`, 'GET', undefined, signal),
    startLesson: ({ deckId, signal, ...data }) => request(`${path(deckId)}/lessons`, 'POST', data, signal),
    readLesson: ({ deckId, lessonId, signal }) => request(`${path(deckId)}/lessons/${encodeURIComponent(lessonId)}`, 'GET', undefined, signal),
    readAnnotation: async ({ deckId, lessonId, slideId, signal }) => page(await request(`${path(deckId)}/lessons/${encodeURIComponent(lessonId)}/pages/${encodeURIComponent(slideId)}`, 'GET', undefined, signal)),
    saveAnnotation: async ({ deckId, lessonId, slideId, signal, ...data }) => {
      const result = await request<CoursewareAnnotationSave>(`${path(deckId)}/lessons/${encodeURIComponent(lessonId)}/pages/${encodeURIComponent(slideId)}`, 'PUT', { ...data, scene: parseCanvasAnnotations(data.scene) }, signal)
      if (result.operationId !== data.operationId || !Number.isSafeInteger(result.appliedRevision) || result.appliedRevision < 1) throw new CoursewareApiError(502, 'INVALID_RESPONSE', '批注保存回执与操作不匹配。')
      return { ...result, page: page(result.page) }
    },
    addBlankPage: ({ deckId, lessonId, signal, ...data }) => request(`${path(deckId)}/lessons/${encodeURIComponent(lessonId)}/blank-pages`, 'POST', data, signal),
  }
}
