import { parseCanvasAnnotations } from '@physicsos/physics-whiteboard'
import { readAnnotationDelta } from './annotation-history.ts'
import type { CoursewareDraft } from './types.ts'
export interface CoursewareDraftCache {
  activate(namespace: string, epoch: string | undefined): Promise<void>
  read(namespace: string, key: string): Promise<CoursewareDraft | undefined>
  write(namespace: string, epoch: string, key: string, draft: CoursewareDraft): Promise<boolean>
}
export const coursewareDraftKey = (deckId: string, versionId: string, lessonId: string, slideId: string): string => [deckId, versionId, lessonId, slideId].map(encodeURIComponent).join('|')
export function readCoursewareDraft(value: unknown, namespace: string, key: string): CoursewareDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('本机课件草稿格式无效。')
  const raw = value as CoursewareDraft
  if (Object.keys(raw).some(k => !['schemaVersion', 'namespace', 'deckId', 'versionId', 'lessonId', 'slideId', 'base', 'pending', 'undo', 'redo', 'savedAt'].includes(k)) || raw.schemaVersion !== 1 || raw.namespace !== namespace || [raw.deckId, raw.versionId, raw.lessonId, raw.slideId].some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) || coursewareDraftKey(raw.deckId, raw.versionId, raw.lessonId, raw.slideId) !== key) throw new Error('本机草稿账号或课件身份不匹配。')
  if (!Number.isSafeInteger(raw.base?.revision) || raw.base.revision < 0 || !Number.isFinite(Date.parse(raw.base.updatedAt)) || !Array.isArray(raw.pending) || raw.pending.length > 500 || !Array.isArray(raw.undo) || raw.undo.length > 200 || !Array.isArray(raw.redo) || raw.redo.length > 200) throw new Error('本机草稿操作队列超限或格式无效。')
  const operationIds = new Set<string>()
  return { ...raw, base: { ...raw.base, scene: parseCanvasAnnotations(raw.base.scene) }, pending: raw.pending.map(op => {
    if (typeof op.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(op.id) || operationIds.has(op.id) || Object.keys(op).some(k => !['id', 'delta', 'request'].includes(k))) throw new Error('本机草稿操作身份无效。')
    operationIds.add(op.id)
    if (op.request && (!Number.isSafeInteger(op.request.expectedRevision) || op.request.expectedRevision < 0)) throw new Error('本机草稿 CAS 版本无效。')
    return { ...op, delta: readAnnotationDelta(op.delta), ...(op.request ? { request: { expectedRevision: op.request.expectedRevision, scene: parseCanvasAnnotations(op.request.scene) } } : {}) }
  }), undo: raw.undo.map(readAnnotationDelta), redo: raw.redo.map(readAnnotationDelta) }
}
/** The per-tab lease is checked WITH the draft write in one IDB transaction.
 * A late logout/account-switch write cannot overwrite a later epoch; different tabs keep separate drafts.
 * Persist clientId in sessionStorage at the entry (not in the opaque content child). */
export function createIndexedDbCoursewareCache(clientId = 'primary', databaseName = 'physicsos-courseware-v1'): CoursewareDraftCache {
  const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('drafts'); request.result.createObjectStore('epochs') }
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
    request.onerror = () => reject(request.error ?? new Error('无法打开本机课件草稿存储。'))
    request.onblocked = () => reject(new Error('请关闭旧标签页以升级课件草稿存储。'))
  })
  return {
    async activate(namespace, epoch) {
      const db = await open()
      try { await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('epochs', 'readwrite'); const store = tx.objectStore('epochs')
        if (epoch === undefined) store.delete([namespace, clientId]); else store.put(epoch, [namespace, clientId])
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('课件草稿账号代际未建立。'))
      }) } finally { db.close() }
    },
    async read(namespace, key) {
      const db = await open()
      try {
        const value = await new Promise<unknown>((resolve, reject) => {
          const request = db.transaction('drafts', 'readonly').objectStore('drafts').get([namespace, clientId, key])
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
        })
        return value === undefined ? undefined : readCoursewareDraft(value, namespace, key)
      } finally { db.close() }
    },
    async write(namespace, epoch, key, draft) {
      const value = readCoursewareDraft(draft, namespace, key); const db = await open()
      try { return await new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(['drafts', 'epochs'], 'readwrite'); let written = false
        const lease = tx.objectStore('epochs').get([namespace, clientId])
        lease.onsuccess = () => { if (lease.result === epoch) { tx.objectStore('drafts').put(value, [namespace, clientId, key]); written = true } }
        tx.oncomplete = () => resolve(written); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('课件草稿未写入。'))
      }) } finally { db.close() }
    },
  }
}
