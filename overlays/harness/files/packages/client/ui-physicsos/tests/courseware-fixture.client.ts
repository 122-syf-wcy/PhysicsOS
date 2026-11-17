import { CoursewareApiError, type CoursewareApi } from '../src/client/courseware/api.ts'
import { createCoursewareController, type CoursewareControllerOptions } from '../src/client/courseware/controller.ts'
import type { CoursewareDraftCache } from '../src/client/courseware/persistence.ts'
import type { CoursewareAnnotationHead, CoursewareDraft, CoursewareLesson, CoursewarePlayerState, CoursewareRecord } from '../src/client/courseware/types.ts'
export const cwAt = '2026-11-17T02:00:00.000Z'
export const cwRecord: CoursewareRecord = { deck: { id: 'deck_1', title: '声音的特性', description: '真实课堂', lifecycle: 'active', sharing: 'private', activeVersionId: 'v_1', versionCount: 1, revision: 1, updatedAt: cwAt, mine: true, canManage: true, canTeach: true, schoolId: 'school-a' }, versions: [{ id: 'v_1', number: 1, createdAt: cwAt, source: { digest: 'a'.repeat(64), bytes: 1000 }, content: { digest: 'b'.repeat(64), bytes: 2000 }, csp: "default-src 'none'", securityVersion: 1, mode: 'slides', adapterVersion: 'test-v1', slideIds: ['cover', 'pitch'], width: 1920, height: 1080 }] }
export const cwLesson: CoursewareLesson = { id: 'lesson_1', deckId: 'deck_1', versionId: 'v_1', createdAt: cwAt, updatedAt: cwAt, blankPages: [], revision: 1, pageIds: [] }
export const cwPresentation = (slideId = 'cover'): CoursewarePlayerState => ({ slideId, index: slideId === 'cover' ? 0 : 1, total: 2, slides: [{ id: 'cover', title: '封面' }, { id: 'pitch', title: '音调' }], stage: { width: 1920, height: 1080, scale: .5, rect: { x: 20, y: 30, width: 960, height: 540 } }, interactive: true })
export const cwInk = (id = 'pen_1') => ({ id, type: 'polyline' as const, points: [[10, 20], [30, 40]] as const, samples: [{ x: 10, y: 20, pressure: .13, time: 1 }, { x: 30, y: 40, pressure: .93, time: 2 }], style: { strokeColor: '#263f4a', strokeWidth: 4 } })
export const cwDeferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { resolve, reject, promise } }
export async function cwWait(predicate: () => boolean): Promise<void> { for (let n = 0; n < 60; n++) { if (predicate()) return; await Promise.resolve() }; throw new Error('Controller did not reach the expected asynchronous boundary') }
export function coursewareClientFixture(overrides: Partial<CoursewareApi> = {}, settings: Partial<CoursewareControllerOptions> = {}) {
  let namespace: string | undefined = 'school-a|teacher'; let counter = 0
  let record = structuredClone(cwRecord); let lesson = structuredClone(cwLesson)
  const remote = new Map<string, CoursewareAnnotationHead>(); const receipts = new Map<string, { hash: string; revision: number }>()
  const drafts = new Map<string, CoursewareDraft>(); const leases = new Map<string, string>()
  const cache: CoursewareDraftCache = { activate: async (owner, epoch) => { if (epoch === undefined) leases.delete(owner); else leases.set(owner, epoch) }, read: async (owner, key) => structuredClone(drafts.get(`${owner}:${key}`)), write: async (owner, epoch, key, draft) => { if (leases.get(owner) !== epoch) return false; drafts.set(`${owner}:${key}`, structuredClone(draft)); return true } }
  const getRemote = (slideId: string): CoursewareAnnotationHead => structuredClone(remote.get(slideId) ?? { revision: 0, updatedAt: cwAt, scene: { schemaVersion: 1, primitives: [] } })
  const api: CoursewareApi = {
    capabilities: async () => ({ capability: 'courseware-v1', schemaVersion: 1, enabled: true, writesEnabled: true, canImport: true, canTeach: true, limits: { maxFileBytes: 16 * 1024 * 1024, maxAnnotationBytes: 4 * 1024 * 1024, maxVersionsPerDeck: 20 } }),
    list: async () => ({ items: [record.deck] }), read: async () => structuredClone(record), importFile: async () => record,
    activate: async input => { record = { ...record, deck: { ...record.deck, activeVersionId: input.versionId } }; return structuredClone(record) },
    manage: async input => { record = { ...record, deck: { ...record.deck, revision: record.deck.revision + 1, lifecycle: input.action === 'delete' ? 'deleted' : input.action === 'archive' ? 'archived' : record.deck.lifecycle } }; return structuredClone(record) },
    ticket: async () => ({ wrapperUrl: `/physicsos/courseware/embed/${'a'.repeat(43)}`, nonce: 'n'.repeat(32), expiresAt: '2026-11-17T02:02:00.000Z', presentation: cwRecord.versions[0]! }),
    lessons: async () => [structuredClone(lesson)], startLesson: async () => structuredClone(lesson), readLesson: async () => structuredClone(lesson),
    readAnnotation: async input => getRemote(input.slideId),
    saveAnnotation: async input => {
      const hash = JSON.stringify(input.scene); const previous = receipts.get(input.operationId); const current = getRemote(input.slideId)
      if (previous) { if (previous.hash !== hash) throw new CoursewareApiError(409, 'OPERATION_REUSED', 'id reused'); return { operationId: input.operationId, appliedRevision: previous.revision, page: current } }
      if (input.expectedRevision !== current.revision) throw new CoursewareApiError(409, 'ANNOTATION_CONFLICT', 'Changed on another device')
      const next = { revision: current.revision + 1, updatedAt: cwAt, scene: input.scene as CoursewareAnnotationHead['scene'] }; remote.set(input.slideId, structuredClone(next)); receipts.set(input.operationId, { hash, revision: next.revision })
      return { operationId: input.operationId, appliedRevision: next.revision, page: structuredClone(next) }
    },
    addBlankPage: async () => { lesson = { ...lesson, revision: lesson.revision + 1, blankPages: [...lesson.blankPages, `blank_${lesson.blankPages.length + 1}`] }; return structuredClone(lesson) }, ...overrides,
  }
  const controller = createCoursewareController({ api, cache, getNamespace: () => namespace, getAccountKey: () => namespace ? 'school-a:teacher' : undefined, id: () => `op_${++counter}`, now: () => new Date(cwAt), schedule: () => undefined, cancelSchedule: () => {}, ...settings })
  const open = async (): Promise<void> => { await controller.initialize(); await controller.open('deck_1'); controller.setPresentation(cwPresentation()); await controller.startLesson('lesson_1'); await cwWait(() => controller.getSnapshot().page?.status !== 'loading') }
  return { api, cache, controller, drafts, remote, receipts, getRemote, open, namespace: (next: string | undefined) => { namespace = next; controller.resetNamespace() }, record: (next: CoursewareRecord) => { record = structuredClone(next) } }
}
