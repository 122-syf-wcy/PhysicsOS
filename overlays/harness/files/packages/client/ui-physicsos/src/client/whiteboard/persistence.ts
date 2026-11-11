import { parseSourceImage, parseWhiteboardDocument, type SourceImage } from '@physicsos/physics-whiteboard'
import type { WhiteboardApi } from './api.ts'
import type { WhiteboardDraft, WhiteboardDraftCache } from './controller.ts'

export function createWhiteboardHttpApi(options: { readonly owner?: () => { readonly schoolId: string; readonly username: string } | undefined } = {}): WhiteboardApi {
  const base = '/physicsos/whiteboards'
  const path = (id: string) => `${base}/${encodeURIComponent(id)}`
  async function request<T>(url: string, method: string, data: unknown, signal?: AbortSignal, captured = { owner: options.owner?.() }): Promise<T> {
    signal?.throwIfAborted()
    const headers: Record<string, string> = { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(captured.owner ? { 'x-physicsos-canvas-owner': encodeURIComponent(JSON.stringify({ schoolId: captured.owner.schoolId, username: captured.owner.username })) } : {}) }
    const response = await fetch(url, { method, credentials: 'same-origin', headers, ...(signal ? { signal } : {}), ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
    const payload: unknown = await response.json()
    if (!response.ok) {
      const message = typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string' ? payload.error : `Whiteboard request failed (${response.status})`
      throw Object.assign(new Error(message), { status: response.status })
    }
    return payload as T
  }
  return {
    list: ({ signal }) => request(base, 'GET', undefined, signal),
    create: ({ signal, ...data }) => request(base, 'POST', data, signal),
    read: ({ id, signal }) => request(path(id), 'GET', undefined, signal),
    save: ({ id, signal, ...data }) => request(path(id), 'PUT', data, signal),
    uploadImage: async ({ whiteboardId, file, operationId, signal }) => {
      const captured = { owner: options.owner?.() }
      const bytes = new Uint8Array(await file.arrayBuffer())
      signal?.throwIfAborted()
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
      return parseSourceImage(await request(`${path(whiteboardId)}/images`, 'POST', { mimeType: file.type, base64: btoa(binary), operationId }, signal, captured))
    },
    readImage: async ({ whiteboardId, imageId, signal }) => {
      const response = await request<{ source: SourceImage; base64: string }>(`${path(whiteboardId)}/images/${encodeURIComponent(imageId)}`, 'GET', undefined, signal)
      const source = parseSourceImage(response.source)
      if (source.id !== imageId) throw new Error('Source image identity mismatch')
      const binary = atob(response.base64)
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
      if (bytes.length !== source.byteLength) throw new Error('Source image byte length mismatch')
      return { source, blob: new Blob([bytes], { type: source.mimeType }) }
    },
    startGeneration: ({ whiteboardId, signal, ...data }) => request(`${path(whiteboardId)}/generations`, 'POST', data, signal),
    readGeneration: ({ whiteboardId, jobId, signal }) => request(`${path(whiteboardId)}/generations/${encodeURIComponent(jobId)}`, 'GET', undefined, signal),
    cancelGeneration: ({ whiteboardId, jobId, signal, ...data }) => request(`${path(whiteboardId)}/generations/${encodeURIComponent(jobId)}/cancel`, 'POST', data, signal),
  }
}

/** Namespace and ID are a compound IndexedDB key; no account identity enters document data. */
export function createIndexedDbWhiteboardCache(): WhiteboardDraftCache {
  const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const request = indexedDB.open('physicsos-whiteboard-v1', 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('drafts') }
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
    request.onerror = () => reject(request.error ?? new Error('Cannot open whiteboard draft storage'))
    request.onblocked = () => reject(new Error('Close other tabs to update whiteboard draft storage'))
  })
  return {
    async read(namespace, id) {
      const db = await open()
      try {
        const result = await new Promise<WhiteboardDraft | undefined>((resolve, reject) => {
          const request = db.transaction('drafts', 'readonly').objectStore('drafts').get([namespace, id])
          request.onsuccess = () => resolve(request.result as WhiteboardDraft | undefined)
          request.onerror = () => reject(request.error)
        })
        if (result) parseWhiteboardDocument(result.record.document)
        return result
      } finally { db.close() }
    },
    async write(namespace, id, draft) {
      const db = await open()
      try { await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('drafts', 'readwrite')
        transaction.objectStore('drafts').put(draft, [namespace, id])
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error ?? new Error('Whiteboard draft transaction aborted'))
      }) } finally { db.close() }
    },
  }
}
