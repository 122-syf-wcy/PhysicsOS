import { parseSourceImage, parseWhiteboardDocument, type DrawingDiagram, type SourceImage } from '@physicsos/physics-whiteboard'
import { boolean, exactKeys, integer, isoDate, list, oneOf, optional, record, text } from '@physicsos/physics-workbench/json'
import { readLifecycleCapabilities } from '../canvas/api.ts'
import { workbenchLifecycleState } from '@physicsos/physics-workbench/protocol'
import { whiteboardGenerationOf, whiteboardSummaryOf, WhiteboardRequestError, type PendingWhiteboardLifecycle, type WhiteboardApi, type WhiteboardGeneration, type WhiteboardRecord, type WhiteboardSummary } from './api.ts'
import type { WhiteboardDraft, WhiteboardDraftCache } from './controller.ts'

const status = (value: unknown, at: string) => oneOf(value, ['queued', 'reading', 'drawing', 'validating', 'ready', 'error', 'cancelled'], at)
const lifecycleMetadata = (value: Record<string, unknown>, path: string) => {
  const archivedAt = optional(value.archivedAt, `${path}/archivedAt`, isoDate)
  const deletedAt = optional(value.deletedAt, `${path}/deletedAt`, isoDate)
  return { revision: integer(value.revision, `${path}/revision`, 1), generation: value.generation === undefined ? 1 : integer(value.generation, `${path}/generation`, 1),
    updatedAt: isoDate(value.updatedAt, `${path}/updatedAt`), ...(archivedAt === undefined ? {} : { archivedAt }), ...(deletedAt === undefined ? {} : { deletedAt }) }
}
export const readWhiteboardSummary = (input: unknown, path = '/head'): WhiteboardSummary => {
  const value = record(input, path)
  exactKeys(value, ['id', 'title', 'revision', 'generation', 'updatedAt', 'archivedAt', 'deletedAt'], path)
  return { id: text(value.id, `${path}/id`, true), title: text(value.title, `${path}/title`, true), ...lifecycleMetadata(value, path) }
}
export const readWhiteboardRecord = (input: unknown): WhiteboardRecord => {
  const value = record(input, '/record')
  exactKeys(value, ['document', 'revision', 'generation', 'updatedAt', 'archivedAt', 'deletedAt', 'activeGeneration', 'recoverableGenerations'], '/record')
  const binding = (input: unknown, path: string) => { const item = record(input, path); exactKeys(item, ['jobId', 'imageId', 'status'], path); return { jobId: text(item.jobId, `${path}/jobId`, true), imageId: text(item.imageId, `${path}/imageId`, true) } }
  const activeGeneration = optional(value.activeGeneration, '/record/activeGeneration', binding)
  const recoverableGenerations = optional(value.recoverableGenerations, '/record/recoverableGenerations', (input, at) => list(input, at, (input, at) => {
    const item = record(input, at); return { ...binding(item, at), status: status(item.status, `${at}/status`) }
  }))
  return { document: parseWhiteboardDocument(value.document), ...lifecycleMetadata(value, '/record'),
    ...(activeGeneration === undefined ? {} : { activeGeneration }), ...(recoverableGenerations === undefined ? {} : { recoverableGenerations }) }
}
const readGeneration = (input: unknown): WhiteboardGeneration => {
  const value = record(input, '/job')
  exactKeys(value, ['id', 'whiteboardId', 'imageId', 'generation', 'currentHead', 'status', 'result', 'error'], '/job')
  const currentHead = optional(value.currentHead, '/job/currentHead', readWhiteboardSummary)
  const error = optional(value.error, '/job/error', text)
  const result = value.result === undefined ? undefined : record(value.result, '/job/result') as unknown as DrawingDiagram
  return { id: text(value.id, '/job/id', true), whiteboardId: text(value.whiteboardId, '/job/whiteboardId', true), imageId: text(value.imageId, '/job/imageId', true),
    generation: value.generation === undefined ? 1 : integer(value.generation, '/job/generation', 1), status: status(value.status, '/job/status'),
    ...(currentHead === undefined ? {} : { currentHead }), ...(error === undefined ? {} : { error }), ...(result === undefined ? {} : { result }) }
}
export const readWhiteboardLifecycle = (input: unknown): PendingWhiteboardLifecycle => {
  const value = record(input, '/lifecycle')
  exactKeys(value, ['id', 'operation', 'expectedRevision', 'expectedGeneration', 'operationId'], '/lifecycle')
  return { id: text(value.id, '/lifecycle/id', true), operation: oneOf(value.operation, ['archive', 'unarchive', 'delete', 'restore'], '/lifecycle/operation'),
    expectedRevision: integer(value.expectedRevision, '/lifecycle/expectedRevision', 1), expectedGeneration: integer(value.expectedGeneration, '/lifecycle/expectedGeneration', 1), operationId: text(value.operationId, '/lifecycle/operationId', true) }
}
export const readWhiteboardDraft = (input: unknown, id: string): WhiteboardDraft => {
  const value = record(input, '/draft')
  exactKeys(value, ['record', 'dirty', 'job', 'pendingSave', 'pendingGeneration', 'editingSessionId', 'blocked', 'serverHead'], '/draft')
  const stored = readWhiteboardRecord(value.record)
  if (stored.document.id !== id) throw new Error('Cached whiteboard identity mismatch')
  const pendingSave = optional(value.pendingSave, '/draft/pendingSave', (input, at) => {
    const item = record(input, at); exactKeys(item, ['document', 'expectedRevision', 'expectedGeneration', 'operationId', 'editingSessionId'], at)
    const document = parseWhiteboardDocument(item.document)
    if (document.id !== id) throw new Error('Cached save identity mismatch')
    const generation = optional(item.expectedGeneration, `${at}/expectedGeneration`, (input, at) => integer(input, at, 1))
    const editingSessionId = optional(item.editingSessionId, `${at}/editingSessionId`, (input, at) => text(input, at, true))
    return { document, expectedRevision: integer(item.expectedRevision, `${at}/expectedRevision`, 1), operationId: text(item.operationId, `${at}/operationId`, true),
      ...(generation === undefined ? {} : { expectedGeneration: generation }), ...(editingSessionId === undefined ? {} : { editingSessionId }) }
  })
  const pendingGeneration = optional(value.pendingGeneration, '/draft/pendingGeneration', (input, at) => {
    const item = record(input, at); exactKeys(item, ['imageId', 'expectedRevision', 'expectedGeneration', 'operationId'], at)
    const generation = optional(item.expectedGeneration, `${at}/expectedGeneration`, (input, at) => integer(input, at, 1))
    return { imageId: text(item.imageId, `${at}/imageId`, true), expectedRevision: integer(item.expectedRevision, `${at}/expectedRevision`, 1), operationId: text(item.operationId, `${at}/operationId`, true), ...(generation === undefined ? {} : { expectedGeneration: generation }) }
  })
  const job = optional(value.job, '/draft/job', readGeneration)
  const editingSessionId = optional(value.editingSessionId, '/draft/editingSessionId', (input, at) => text(input, at, true))
  const blocked = optional(value.blocked, '/draft/blocked', (input, at) => oneOf(input, ['conflict', 'deleted', 'archived', 'unavailable', 'auth-required', 'upgrade-required'], at)) ??
    (value.dirty === true && record(value.record, '/draft/record').generation === undefined ? 'upgrade-required' : undefined)
  const serverHead = optional(value.serverHead, '/draft/serverHead', readWhiteboardSummary)
  if (job !== undefined && job.whiteboardId !== id || serverHead !== undefined && serverHead.id !== id) throw new Error('Cached whiteboard binding mismatch')
  return { record: stored, dirty: boolean(value.dirty, '/draft/dirty'), ...(job === undefined ? {} : { job }), ...(pendingSave === undefined ? {} : { pendingSave }),
    ...(pendingGeneration === undefined ? {} : { pendingGeneration }), ...(editingSessionId === undefined ? {} : { editingSessionId }), ...(blocked === undefined ? {} : { blocked }), ...(serverHead === undefined ? {} : { serverHead }) }
}

export function createWhiteboardHttpApi(options: { readonly owner?: () => { readonly schoolId: string; readonly username: string } | undefined } = {}): WhiteboardApi {
  const base = '/physicsos/whiteboards'
  const path = (id: string) => `${base}/${encodeURIComponent(id)}`
  async function request<T>(url: string, method: string, data: unknown, parse: (value: unknown) => T, signal?: AbortSignal, captured = { owner: options.owner?.() }): Promise<T> {
    signal?.throwIfAborted()
    if (!captured.owner) throw new WhiteboardRequestError(401, 'WHITEBOARD_OWNER_REQUIRED', '请登录后访问画板；旧账号草稿已保留。', undefined, false)
    const headers: Record<string, string> = { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), 'x-physicsos-canvas-owner': encodeURIComponent(JSON.stringify({ schoolId: captured.owner.schoolId, username: captured.owner.username })) }
    const response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers, ...(signal ? { signal } : {}), ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
    signal?.throwIfAborted()
    if (JSON.stringify(options.owner?.()) !== JSON.stringify(captured.owner)) throw new WhiteboardRequestError(401, 'WHITEBOARD_ACCOUNT_CHANGED', '账号已变化，旧账号草稿已保留且不会写入新账号。', undefined, false)
    let payload: unknown
    try { payload = await response.json() } catch { throw new WhiteboardRequestError(response.ok ? 502 : response.status, 'WHITEBOARD_RESPONSE_INVALID', '画板服务未返回有效响应；未将错误作为可写离线版本。', undefined, false) }
    if (!response.ok) {
      const value = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {}
      const message = typeof value.error === 'string' ? value.error : `Whiteboard request failed (${response.status})`
      const code = typeof value.code === 'string' ? value.code : 'WHITEBOARD_REQUEST_FAILED'
      let currentHead: WhiteboardSummary | undefined
      try { if (value.currentHead !== undefined) currentHead = readWhiteboardSummary(value.currentHead) } catch { /* Status still retains its denial authority. */ }
      throw new WhiteboardRequestError(response.status, code, message, currentHead)
    }
    try { return parse(payload) } catch { throw new WhiteboardRequestError(502, 'WHITEBOARD_RESPONSE_INVALID', '画板服务响应未通过完整数据校验；草稿已保留。', undefined, false) }
  }
  const mutation = (action: string, method = 'POST') => ({ id, signal, ...data }: { readonly id: string; readonly signal?: AbortSignal }) => request(`${path(id)}${action}`, method, data, readWhiteboardRecord, signal)
  return {
    capabilities: ({ signal }) => request(`${base}/capabilities`, 'GET', undefined, readLifecycleCapabilities, signal),
    list: ({ signal, state }) => request(`${base}${state ? `?state=${encodeURIComponent(state)}` : ''}`, 'GET', undefined, value => list(value, '/items', readWhiteboardSummary), signal),
    create: ({ signal, ...data }) => request(base, 'POST', data, readWhiteboardRecord, signal),
    read: ({ id, signal }) => request(path(id), 'GET', undefined, readWhiteboardRecord, signal),
    readRetained: ({ id, signal }) => request(`${path(id)}/retained`, 'GET', undefined, readWhiteboardRecord, signal),
    save: mutation('', 'PUT'), archive: mutation('/archive'), unarchive: mutation('/unarchive'), remove: mutation('', 'DELETE'), restore: mutation('/restore'), copy: mutation('/copy'),
    uploadImage: async ({ whiteboardId, file, operationId, expectedRevision, expectedGeneration, signal }) => {
      const captured = { owner: options.owner?.() }
      const bytes = new Uint8Array(await file.arrayBuffer())
      signal?.throwIfAborted()
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
      return request(`${path(whiteboardId)}/images`, 'POST', { mimeType: file.type, base64: btoa(binary), operationId, expectedRevision, expectedGeneration }, parseSourceImage, signal, captured)
    },
    readImage: async ({ whiteboardId, imageId, signal }) => {
      const response = await request(`${path(whiteboardId)}/images/${encodeURIComponent(imageId)}`, 'GET', undefined, input => {
        const value = record(input, '/image'); exactKeys(value, ['source', 'base64'], '/image')
        return { source: parseSourceImage(value.source), base64: text(value.base64, '/image/base64', true) }
      }, signal)
      const source: SourceImage = response.source
      if (source.id !== imageId) throw new Error('Source image identity mismatch')
      const binary = atob(response.base64)
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
      if (bytes.length !== source.byteLength) throw new Error('Source image byte length mismatch')
      return { source, blob: new Blob([bytes], { type: source.mimeType }) }
    },
    startGeneration: ({ whiteboardId, signal, ...data }) => request(`${path(whiteboardId)}/generations`, 'POST', data, readGeneration, signal),
    readGeneration: ({ whiteboardId, jobId, signal }) => request(`${path(whiteboardId)}/generations/${encodeURIComponent(jobId)}`, 'GET', undefined, readGeneration, signal),
    cancelGeneration: ({ whiteboardId, jobId, signal, ...data }) => request(`${path(whiteboardId)}/generations/${encodeURIComponent(jobId)}/cancel`, 'POST', data, readGeneration, signal),
  }
}

/** Compound owner/ID keys and a separate durable lifecycle outbox, without a database version bump. */
export function createIndexedDbWhiteboardCache(): WhiteboardDraftCache {
  const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const request = indexedDB.open('physicsos-whiteboard-v1', 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('drafts') }
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
    request.onerror = () => reject(request.error ?? new Error('Cannot open whiteboard draft storage'))
    request.onblocked = () => reject(new Error('Close other tabs to update whiteboard draft storage'))
  })
  const get = async (key: IDBValidKey): Promise<unknown> => {
    const db = await open()
    try { return await new Promise((resolve, reject) => { const request = db.transaction('drafts', 'readonly').objectStore('drafts').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) }
    finally { db.close() }
  }
  const put = async (key: IDBValidKey, value: unknown, merge?: (stored: unknown, incoming: unknown) => unknown): Promise<void> => {
    const db = await open()
    try { await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite')
      const store = transaction.objectStore('drafts')
      let failure: unknown
      const write = (next: unknown) => { if (next === undefined) store.delete(key); else store.put(next, key) }
      if (merge) {
        const request = store.get(key)
        request.onsuccess = () => { try { write(merge(request.result, value)) } catch (error) { failure = error; transaction.abort() } }
        request.onerror = () => { failure = request.error; transaction.abort() }
      } else write(value)
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Whiteboard draft transaction aborted'))
    }) } finally { db.close() }
  }
  return {
    read: async (namespace, id) => { const value = await get([namespace, id]); return value === undefined ? undefined : readWhiteboardDraft(value, id) },
    write: (namespace, id, draft) => put([namespace, id], readWhiteboardDraft(draft, id), (stored, incoming) => {
      const candidate = readWhiteboardDraft(incoming, id)
      if (stored === undefined) return candidate
      const previous = readWhiteboardDraft(stored, id)
      const oldHead = previous.serverHead ?? whiteboardSummaryOf(previous.record)
      const newHead = candidate.serverHead ?? whiteboardSummaryOf(candidate.record)
      const stale = whiteboardGenerationOf(newHead) < whiteboardGenerationOf(oldHead) || whiteboardGenerationOf(newHead) === whiteboardGenerationOf(oldHead) && newHead.revision < oldHead.revision
      if (!stale) return candidate
      if (!candidate.dirty) return previous
      const lifecycle = workbenchLifecycleState(oldHead)
      return { ...candidate, serverHead: oldHead, blocked: lifecycle === 'active' ? 'conflict' : lifecycle }
    }),
    readLifecycle: async (namespace, id) => { const value = await get([namespace, 'lifecycle', id]); if (value === undefined) return undefined; const parsed = readWhiteboardLifecycle(value); if (parsed.id !== id) throw new Error('Lifecycle outbox belongs to another document'); return parsed },
    writeLifecycle: (namespace, id, pending, expectedOperationId) => put([namespace, 'lifecycle', id], pending === undefined ? undefined : readWhiteboardLifecycle(pending), (stored, incoming) => {
      const previous = stored === undefined ? undefined : readWhiteboardLifecycle(stored)
      const candidate = incoming === undefined ? undefined : readWhiteboardLifecycle(incoming)
      if (previous !== undefined && (candidate !== undefined ? previous.operationId !== candidate.operationId || JSON.stringify(previous) !== JSON.stringify(candidate) : expectedOperationId !== previous.operationId)) throw new Error('另一个页面正在整理此画板；原请求保留，请刷新后重试。')
      return candidate
    }),
  }
}
