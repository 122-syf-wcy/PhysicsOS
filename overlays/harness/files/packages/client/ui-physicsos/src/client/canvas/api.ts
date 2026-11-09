import type {
  CanvasChangesResponse, CanvasCommitRequest, CanvasCommitResponse, CanvasCopyRequest,
  CanvasCreateRequest, CanvasDeleteRequest, CanvasHead, CanvasListResponse,
  CanvasObjectUploadResponse, CanvasOpenResponse, CanvasRestoreRequest,
  CanvasVerificationReceipt, CanvasVerifyRequest,
  CanvasVerificationListResponse,
  CanvasResourcePolicy,
} from '@physicsos/physics-workbench/protocol'
import type { CanvasManifest, CanvasStoredValue, JsonObject, MergeConflict, WorkbenchObject } from '@physicsos/physics-workbench/types'
import { parseManifest, parseObject, parseStoredValue } from '@physicsos/physics-workbench/codec'
import {
  boolean, canonicalStringify, digest, exactKeys, integer, isoDate, jsonObject, list, oneOf,
  optional, record, text, unwrap, WorkbenchDataError,
} from '@physicsos/physics-workbench/json'
import { readCanvasHead, readMergeConflict } from './cache-codec.ts'

export interface CanvasListQuery {
  readonly cursor?: string
  readonly limit?: number
  readonly search?: string
  readonly sort?: 'updated' | 'created' | 'title'
  readonly deleted?: 'live' | 'deleted' | 'all'
}
export type CanvasChanges = CanvasChangesResponse
export interface CanvasRequestOwner {
  readonly schoolId: string
  readonly username: string
}
export interface CanvasVerificationResponse {
  readonly receipt: CanvasVerificationReceipt
  /** A server result is not implicitly a snapshot or an alias. */
  readonly resultDigest?: string
}
/** Only complete, validated policies are cached or used for offline graph reads. */
export const readCanvasResourcePolicy = (value: unknown): CanvasResourcePolicy => {
  const input = record(value, '')
  exactKeys(input, ['schemaVersion', 'limits'], '')
  if (input.schemaVersion !== 1) throw new CanvasRequestError(502, 'RESPONSE_INVALID', 'The Canvas resource policy version is unsupported.', undefined, false)
  const raw = record(input.limits, '/limits')
  exactKeys(raw, ['maxBytes', 'maxJsonNodes', 'maxDepth', 'maxObjects', 'maxReferences', 'maxReferencesPerObject', 'maxIssues'], '/limits')
  const limits = { maxBytes: integer(raw.maxBytes, '/limits/maxBytes', 1), maxJsonNodes: integer(raw.maxJsonNodes, '/limits/maxJsonNodes', 1),
    maxDepth: integer(raw.maxDepth, '/limits/maxDepth', 1), maxObjects: integer(raw.maxObjects, '/limits/maxObjects', 1),
    maxReferences: integer(raw.maxReferences, '/limits/maxReferences', 1), maxReferencesPerObject: integer(raw.maxReferencesPerObject, '/limits/maxReferencesPerObject', 1),
    maxIssues: integer(raw.maxIssues, '/limits/maxIssues', 1) }
  if (limits.maxDepth > 512) throw new CanvasRequestError(502, 'RESPONSE_INVALID', 'The advertised Canvas depth exceeds the codec safety ceiling.', undefined, false)
  return { schemaVersion: 1, limits }
}

/** Validate both freshly returned receipts and previously cached server responses. */
export const readCanvasVerificationResponse = (value: unknown): CanvasVerificationResponse => {
  const input = record(value, '')
  const receipt = record(input.receipt, '/receipt')
  const parsedReceipt: CanvasVerificationReceipt = {
    id: text(receipt.id, '/receipt/id', true), canvasId: text(receipt.canvasId, '/receipt/canvasId', true),
    captureDigest: digest(receipt.captureDigest, '/receipt/captureDigest'), checkedAt: isoDate(receipt.checkedAt, '/receipt/checkedAt'),
    status: oneOf(receipt.status, ['verified', 'rejected', 'unsupported', 'error'], '/receipt/status'),
    engineId: text(receipt.engineId, '/receipt/engineId'), engineVersion: text(receipt.engineVersion, '/receipt/engineVersion'),
    sceneDigest: digest(receipt.sceneDigest, '/receipt/sceneDigest'), details: jsonObject(receipt.details, '/receipt/details'),
  }
  const resultDigest = optional(input.resultDigest, '/resultDigest', digest)
  return { receipt: parsedReceipt, ...(resultDigest === undefined ? {} : { resultDigest }) }
}

/** HTTP status and retry authority survive parsing so outages cannot erase a working copy. */
export class CanvasRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly currentHead?: CanvasHead,
    readonly retryable = status === 408 || status === 429 || status >= 500,
    readonly conflicts?: readonly MergeConflict[],
    readonly details?: JsonObject,
  ) {
    super(message)
    this.name = 'CanvasRequestError'
  }
}

const opened = (value: unknown): CanvasOpenResponse => {
  const input = record(value, '')
  const head = readCanvasHead(input.head)
  const manifest = unwrap(parseManifest(input.manifest))
  if (manifest.id !== head.id || manifest.title !== head.title) {
    throw new CanvasRequestError(502, 'RESPONSE_INVALID', 'The returned canvas manifest does not match its head.', undefined, false)
  }
  return { head, manifest }
}
const committed = (value: unknown): CanvasCommitResponse => {
  const input = record(value, '')
  const head = readCanvasHead(input.head)
  const manifest = input.manifest === undefined ? undefined : unwrap(parseManifest(input.manifest))
  if (manifest !== undefined && (manifest.id !== head.id || manifest.title !== head.title)) {
    throw new CanvasRequestError(502, 'RESPONSE_INVALID', 'The returned canvas manifest does not match its head.', undefined, false)
  }
  return { head, replayed: boolean(input.replayed, '/replayed'), ...(manifest === undefined ? {} : { manifest }) }
}

export interface CanvasApi {
  /** Pins account identity for every request, including GETs and late retries. */
  forOwner(owner: CanvasRequestOwner): CanvasApi
  resourcePolicy(signal?: AbortSignal): Promise<CanvasResourcePolicy>
  list(query?: CanvasListQuery, signal?: AbortSignal): Promise<CanvasListResponse>
  create(request: CanvasCreateRequest, signal?: AbortSignal): Promise<CanvasOpenResponse>
  open(id: string, signal?: AbortSignal): Promise<CanvasOpenResponse>
  putObject(id: string, hash: string, value: CanvasStoredValue, signal?: AbortSignal): Promise<CanvasObjectUploadResponse>
  getObject(id: string, hash: string, signal?: AbortSignal): Promise<WorkbenchObject>
  /** Tombstone heads retain their authorized manifest at the same immutable object route. */
  getManifest(id: string, hash: string, signal?: AbortSignal): Promise<CanvasManifest>
  commit(id: string, request: CanvasCommitRequest, signal?: AbortSignal): Promise<CanvasCommitResponse>
  remove(id: string, request: CanvasDeleteRequest, signal?: AbortSignal): Promise<CanvasHead>
  restore(id: string, request: CanvasRestoreRequest, signal?: AbortSignal): Promise<CanvasHead>
  copy(id: string, request: CanvasCopyRequest, signal?: AbortSignal): Promise<CanvasOpenResponse>
  changes(cursor: number, signal?: AbortSignal): Promise<CanvasChanges>
  verify(id: string, request: CanvasVerifyRequest, signal?: AbortSignal): Promise<CanvasVerificationResponse>
  verification(id: string, receiptId: string, signal?: AbortSignal): Promise<CanvasVerificationResponse>
  verifications(id: string, captureDigest: string, query?: { readonly cursor?: string; readonly limit?: number }, signal?: AbortSignal): Promise<CanvasVerificationListResponse>
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Cookie authority is fenced by a fixed expected actor, never by an editable document body. */
export function createCanvasApi(
  fetcher: Fetcher = globalThis.fetch.bind(globalThis),
  owner?: CanvasRequestOwner,
): CanvasApi {
  const base = '/physicsos/learning/canvases'
  const path = (id: string): string => `${base}/${encodeURIComponent(text(id, '/id', true))}`
  const ownerHeader = owner === undefined ? undefined : encodeURIComponent(canonicalStringify({
    schoolId: text(owner.schoolId, '/owner/schoolId', true),
    username: text(owner.username, '/owner/username', true),
  }))
  const request = async (
    url: string,
    method: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    if (ownerHeader === undefined) {
      throw new CanvasRequestError(401, 'CANVAS_OWNER_REQUIRED', 'Choose an authenticated account before synchronizing a canvas.', undefined, false)
    }
    const response = await fetcher(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'x-physicsos-canvas-owner': ownerHeader,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(signal === undefined ? {} : { signal }),
      ...(body === undefined ? {} : { body: canonicalStringify(body) }),
    })
    let value: unknown
    try { value = await response.json() } catch {
      throw new CanvasRequestError(response.status || 502, response.ok ? 'RESPONSE_INVALID' : 'REQUEST_FAILED',
        'The canvas service did not return a valid JSON response.', undefined, !response.ok && response.status >= 500)
    }
    if (!response.ok) {
      let code = 'REQUEST_FAILED'
      let message = 'The canvas request failed.'
      let currentHead: CanvasHead | undefined
      let retryable = response.status === 408 || response.status === 429 || response.status >= 500
      let conflicts: readonly MergeConflict[] | undefined
      let details: JsonObject | undefined
      try {
        const container = record(value, '')
        const error = record(container.error, '/error')
        if (error.code !== undefined) code = text(error.code, '/error/code', true)
        if (error.message !== undefined) message = text(error.message, '/error/message')
        currentHead = optional(error.currentHead, '/error/currentHead', readCanvasHead)
        if (error.retryable !== undefined) retryable = boolean(error.retryable, '/error/retryable')
        conflicts = optional(error.conflicts, '/error/conflicts', (entries, at) => list(entries, at, readMergeConflict))
        details = optional(error.details, '/error/details', jsonObject)
      } catch (error) {
        if (!(error instanceof WorkbenchDataError)) throw error
      }
      if ([400, 401, 403, 404, 409, 410, 413, 422].includes(response.status)) retryable = false
      throw new CanvasRequestError(response.status, code, message, currentHead, retryable, conflicts, details)
    }
    return value
  }
  const parseResponse = async <T>(operation: () => Promise<unknown>, parse: (value: unknown) => T): Promise<T> => {
    const value = await operation()
    try { return parse(value) } catch (error) {
      if (!(error instanceof WorkbenchDataError)) throw error
      throw new CanvasRequestError(502, 'RESPONSE_INVALID', error.message, undefined, false)
    }
  }
  return {
    forOwner: expected => createCanvasApi(fetcher, expected),
    resourcePolicy: signal => parseResponse(() => request(`${base}/policy`, 'GET', undefined, signal), readCanvasResourcePolicy),
    list: (query = {}, signal) => parseResponse(async () => {
      const params = new URLSearchParams()
      if (query.cursor !== undefined) params.set('cursor', query.cursor)
      if (query.limit !== undefined) params.set('limit', String(query.limit))
      if (query.search !== undefined) params.set('search', query.search)
      if (query.sort !== undefined) params.set('sort', query.sort)
      if (query.deleted !== undefined) params.set('state', query.deleted)
      return request(`${base}?${params}`, 'GET', undefined, signal)
    }, value => {
      const input = record(value, '')
      const nextCursor = optional(input.nextCursor, '/nextCursor', text)
      return { items: list(input.items, '/items', readCanvasHead), ...(nextCursor === undefined ? {} : { nextCursor }) }
    }),
    create: (body, signal) => parseResponse(() => request(base, 'POST', body, signal), opened),
    open: (id, signal) => parseResponse(() => request(path(id), 'GET', undefined, signal), opened),
    putObject: (id, hash, body, signal) => parseResponse(
      () => request(`${path(id)}/objects/${encodeURIComponent(digest(hash, '/digest'))}`, 'PUT', unwrap(parseStoredValue(body)), signal),
      value => {
        const input = record(value, '')
        const returnedDigest = digest(input.digest, '/digest')
        if (returnedDigest !== hash) throw new CanvasRequestError(502, 'RESPONSE_INVALID', 'Object upload acknowledged a different digest.', undefined, false)
        const kind = oneOf(input.kind, ['manifest', 'scene', 'snapshot', 'dataset', 'history'], '/kind')
        const expectedKind = 'kind' in body ? body.kind : 'manifest'
        if (kind !== expectedKind) throw new CanvasRequestError(502, 'RESPONSE_INVALID', 'Object upload acknowledged a different kind.', undefined, false)
        const bytes = integer(input.bytes, '/bytes')
        return { digest: returnedDigest, kind, bytes,
          byteLength: integer(input.byteLength ?? bytes, '/byteLength'), existed: boolean(input.existed, '/existed') }
      },
    ),
    getObject: (id, hash, signal) => parseResponse(
      () => request(`${path(id)}/objects/${encodeURIComponent(digest(hash, '/digest'))}`, 'GET', undefined, signal),
      value => unwrap(parseObject(value)),
    ),
    getManifest: (id, hash, signal) => parseResponse(
      () => request(`${path(id)}/objects/${encodeURIComponent(digest(hash, '/digest'))}`, 'GET', undefined, signal),
      value => {
        const manifest = unwrap(parseManifest(value))
        if (manifest.id !== id) throw new CanvasRequestError(502, 'RESPONSE_INVALID', 'The retained manifest belongs to another canvas.', undefined, false)
        return manifest
      },
    ),
    commit: (id, body, signal) => parseResponse(() => request(`${path(id)}/commit`, 'POST', body, signal), committed),
    remove: (id, body, signal) => parseResponse(() => request(path(id), 'DELETE', body, signal),
      value => readCanvasHead(record(value, '').head)),
    restore: (id, body, signal) => parseResponse(() => request(`${path(id)}/restore`, 'POST', body, signal),
      value => readCanvasHead(record(value, '').head)),
    copy: (id, body, signal) => parseResponse(() => request(`${path(id)}/copy`, 'POST', body, signal), opened),
    changes: (cursor, signal) => parseResponse(
      () => request(`${base}/changes?cursor=${encodeURIComponent(String(integer(cursor, '/cursor')))}`, 'GET', undefined, signal),
      value => {
        const input = record(value, '')
        return {
          changes: list(input.changes, '/changes', (entry, at) => {
            const change = record(entry, at)
            const head = readCanvasHead(change.head, `${at}/head`)
            const seq = integer(change.seq, `${at}/seq`, 1)
            if (seq !== head.changeSeq) throw new CanvasRequestError(502, 'RESPONSE_INVALID', 'Change sequence does not match its head.', undefined, false)
            return { seq, head, operation: oneOf(change.operation, ['create', 'commit', 'rename', 'delete', 'restore', 'copy'], `${at}/operation`),
              mutationId: text(change.mutationId, `${at}/mutationId`, true) }
          }),
          cursor: integer(input.cursor, '/cursor'), hasMore: boolean(input.hasMore, '/hasMore'),
        }
      },
    ),
    verify: (id, body, signal) => parseResponse(() => request(`${path(id)}/verify`, 'POST', body, signal), value => {
      const response = readCanvasVerificationResponse(value)
      if (response.receipt.canvasId !== id || response.receipt.captureDigest !== body.captureDigest) {
        throw new CanvasRequestError(502, 'RESPONSE_INVALID', 'Verification receipt belongs to another capture.', undefined, false)
      }
      return response
    }),
    verification: (id, receiptId, signal) => parseResponse(
      () => request(`${path(id)}/verifications/${encodeURIComponent(text(receiptId, '/receiptId', true))}`, 'GET', undefined, signal), value => {
      const response = readCanvasVerificationResponse(value)
      if (response.receipt.canvasId !== id || response.receipt.id !== receiptId) {
        throw new CanvasRequestError(502, 'RESPONSE_INVALID', 'The persisted verification receipt belongs to another canvas or request.', undefined, false)
      }
      return response
    }),
    verifications: (id, captureValue, query = {}, signal) => parseResponse(() => {
      const captureDigest = digest(captureValue, '/captureDigest')
      const params = new URLSearchParams({ captureDigest })
      if (query.cursor !== undefined) params.set('cursor', text(query.cursor, '/cursor', true))
      if (query.limit !== undefined) params.set('limit', String(integer(query.limit, '/limit', 1)))
      return request(`${path(id)}/verifications?${params}`, 'GET', undefined, signal)
    }, value => {
      const input = record(value, '')
      const items = list(input.items, '/items', item => {
        const response = readCanvasVerificationResponse(item)
        if (response.receipt.canvasId !== id || response.receipt.captureDigest !== captureValue) {
          throw new CanvasRequestError(502, 'RESPONSE_INVALID', 'The discovered receipt belongs to another canvas or capture.', undefined, false)
        }
        return response
      })
      const nextCursor = optional(input.nextCursor, '/nextCursor', (cursor, at) => text(cursor, at, true))
      return { items, ...(nextCursor === undefined ? {} : { nextCursor }) }
    }),
  }
}
