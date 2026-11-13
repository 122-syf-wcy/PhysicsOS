import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type {
  CanvasCommitRequest, CanvasCreateRequest, CanvasDeleteRequest, CanvasHead,
  CanvasOpenResponse, CanvasRestoreRequest,
} from '@physicsos/physics-workbench/protocol'
import type { CanvasManifest, JsonObject, JsonValue, MergeConflict, WorkbenchObject } from '@physicsos/physics-workbench/types'
import { parseObject } from '@physicsos/physics-workbench/codec'
import { digest, exactKeys, fail, integer, record, text, unwrap } from '@physicsos/physics-workbench/json'
import type { CanvasClientError } from './types.ts'
import { readLocalCanvasRecord } from './cache-codec.ts'
import { createCanvasDigest, payloadDigest } from './digest.ts'

export interface SealedMutation {
  readonly body: string
  readonly bodyDigest: string
  readonly createdAt: string
  readonly editSequence: number
}
export type PendingCanvasMutation =
  | (SealedMutation & { readonly kind: 'create'; readonly request: CanvasCreateRequest })
  | (SealedMutation & { readonly kind: 'commit'; readonly request: CanvasCommitRequest; readonly manifest: CanvasManifest })
  | (SealedMutation & { readonly kind: 'delete'; readonly request: CanvasDeleteRequest })
  | (SealedMutation & { readonly kind: 'restore'; readonly request: CanvasRestoreRequest })

export interface CanvasConflictCopy {
  readonly base: CanvasManifest
  readonly local: CanvasManifest
  readonly remote: CanvasOpenResponse
  readonly conflicts: readonly MergeConflict[]
}
export interface CanvasLocalConflictCopy {
  readonly base: CanvasManifest
  readonly local: CanvasManifest
  readonly remote: CanvasManifest
  readonly remoteCacheVersion: number
  readonly conflicts: readonly MergeConflict[]
}
export interface CanvasEntityPatch {
  readonly collection: 'nodes' | 'edges' | 'instances' | 'snapshots' | 'comparisons'
  readonly id: string
  readonly before?: JsonObject
  readonly after?: JsonObject
  readonly fields: readonly {
    readonly path: readonly string[]
    readonly before?: JsonValue
    readonly after?: JsonValue
  }[]
}
export interface CanvasAnnotationPatch {
  readonly schemaVersion: 2
  readonly beforePresent: boolean
  readonly afterPresent: boolean
  readonly changes: readonly { readonly id: string; readonly before?: import('@physicsos/physics-whiteboard').CanvasAnnotationPrimitive; readonly beforeIndex?: number; readonly after?: import('@physicsos/physics-whiteboard').CanvasAnnotationPrimitive; readonly afterIndex?: number }[]
}
export interface CanvasDocumentPatch {
  readonly annotations?: CanvasAnnotationPatch
  readonly label: string
  readonly entities: readonly CanvasEntityPatch[]
  readonly title?: { readonly before: string; readonly after: string }
}
export interface CanvasDocumentHistory {
  readonly schemaVersion: 1
  readonly past: readonly CanvasDocumentPatch[]
  readonly future: readonly CanvasDocumentPatch[]
}
/** A small pure-data checkpoint, separate from a completed note history edit. */
export interface CanvasPendingNoteDraft {
  readonly nodeId: string
  readonly writerId: string
  readonly revision: number
  readonly body: string
  readonly format: 'plain' | 'markdown'
  readonly baseBody: string
  readonly baseFormat: 'plain' | 'markdown'
}

/** Cache CAS versions, local edits, and server acknowledgements are independent counters. */
export interface LocalCanvasRecord {
  readonly namespace: string
  readonly id: string
  readonly cacheVersion: number
  readonly editSequence: number
  readonly acknowledgedSequence: number
  readonly working: CanvasManifest
  readonly base?: CanvasManifest
  readonly head?: CanvasHead
  readonly pending?: PendingCanvasMutation
  readonly conflict?: CanvasConflictCopy
  readonly localConflict?: CanvasLocalConflictCopy
  readonly documentHistory?: CanvasDocumentHistory
  readonly pendingNoteDrafts?: readonly CanvasPendingNoteDraft[]
  readonly deleted: boolean
  readonly savedAt: string
  readonly error?: CanvasClientError
}

interface StoredObject {
  readonly key: string
  readonly document: string
  readonly namespace: string
  readonly hash: string
  readonly value: WorkbenchObject
}
interface CanvasDatabase extends DBSchema {
  documents: { key: string; value: LocalCanvasRecord; indexes: { namespace: string } }
  objects: { key: string; value: StoredObject; indexes: { document: string; namespace: string } }
  preferences: { key: string; value: string }
}

export class CanvasCacheConflict extends Error {
  constructor(readonly current: LocalCanvasRecord | undefined) {
    super('LOCAL_VERSION_CONFLICT')
    this.name = 'CanvasCacheConflict'
  }
}
export interface CanvasPersistence {
  list(namespace: string): Promise<readonly LocalCanvasRecord[]>
  read(namespace: string, id: string): Promise<LocalCanvasRecord | undefined>
  objects(namespace: string, id: string): Promise<Readonly<Record<string, WorkbenchObject>>>
  /** Every save uses compare-and-swap, including the initial expected version zero. */
  save(record: LocalCanvasRecord, objects?: Readonly<Record<string, WorkbenchObject>>, expectedCacheVersion?: number): Promise<LocalCanvasRecord>
  remove(namespace: string, id: string, expectedCacheVersion: number): Promise<void>
  getPreference(namespace: string, key: string): Promise<string | undefined>
  setPreference(namespace: string, key: string, value: string): Promise<void>
  close(): Promise<void>
}
export interface CanvasPersistenceOptions {
  readonly name?: string
  /** A schema-version injection for connection-lifecycle tests, not an edit/CAS counter. */
  readonly version?: number
  readonly hash?: (value: unknown) => Promise<string>
  readonly onUnavailable?: (error: unknown) => void
}

const documentKey = (namespace: string, id: string): string => `${namespace}\u0000${id}`
const objectKey = (namespace: string, id: string, hash: string): string => `${documentKey(namespace, id)}\u0000${hash}`
const readStoredObject = (input: unknown, namespace: string, id: string): StoredObject => {
  const value = record(input, '/object')
  exactKeys(value, ['key', 'document', 'namespace', 'hash', 'value'], '/object')
  const hash = digest(value.hash, '/object/hash')
  if (value.namespace !== namespace || value.document !== documentKey(namespace, id) || value.key !== objectKey(namespace, id, hash)) {
    fail('/object', 'account', 'Cached object belongs to another account or document.')
  }
  return { namespace, document: documentKey(namespace, id), key: objectKey(namespace, id, hash), hash,
    value: unwrap(parseObject(value.value)) }
}

/** Connections close on versionchange; hashing and networking never run inside a transaction. */
export function createCanvasPersistence(
  configuration: CanvasPersistenceOptions | ((error: unknown) => void) = {},
): CanvasPersistence {
  const options: CanvasPersistenceOptions = typeof configuration === 'function' ? { onUnavailable: configuration } : configuration
  const hashing = createCanvasDigest(options.hash ?? payloadDigest)
  const hash = hashing.digest
  let database: IDBPDatabase<CanvasDatabase> | undefined
  let opening: Promise<IDBPDatabase<CanvasDatabase>> | undefined
  let closed = false
  const active = new Set<Promise<unknown>>()
  const report = (error: unknown): void => {
    try { options.onUnavailable?.(error) } catch { /* Reporting cannot change durability. */ }
  }
  const getDatabase = (): Promise<IDBPDatabase<CanvasDatabase>> => {
    if (closed) return Promise.reject(new Error('LOCAL_STORE_CLOSED'))
    if (database !== undefined) return Promise.resolve(database)
    if (opening !== undefined) return opening
    let blocked = false
    let rejectBlocked: ((error: Error) => void) | undefined
    const unavailable = new Promise<never>((_resolve, reject) => { rejectBlocked = reject })
    const connection = openDB<CanvasDatabase>(options.name ?? 'physicsos-canvas-v1', integer(options.version ?? 1, '/database/version', 1), {
      upgrade: (db, _oldVersion, _newVersion, tx) => {
        const documents = db.objectStoreNames.contains('documents') ? tx.objectStore('documents') : db.createObjectStore('documents')
        if (!documents.indexNames.contains('namespace')) documents.createIndex('namespace', 'namespace')
        const objects = db.objectStoreNames.contains('objects') ? tx.objectStore('objects') : db.createObjectStore('objects')
        if (!objects.indexNames.contains('document')) objects.createIndex('document', 'document')
        if (!objects.indexNames.contains('namespace')) objects.createIndex('namespace', 'namespace')
        if (!db.objectStoreNames.contains('preferences')) db.createObjectStore('preferences')
      },
      blocked: () => {
        blocked = true
        const error = new Error('LOCAL_STORE_BLOCKED')
        report(error)
        rejectBlocked?.(error)
      },
      blocking: () => {
        database?.close()
        database = undefined
        opening = undefined
        report(new Error('LOCAL_STORE_VERSION_CHANGED'))
      },
      terminated: () => {
        database = undefined
        opening = undefined
        report(new Error('LOCAL_STORE_TERMINATED'))
      },
    }).then(db => {
      if (closed || blocked) { db.close(); throw new Error(closed ? 'LOCAL_STORE_CLOSED' : 'LOCAL_STORE_BLOCKED') }
      database = db
      return db
    })
    opening = Promise.race([connection, unavailable]).catch(error => {
      opening = undefined
      throw error
    })
    return opening
  }
  const track = <T>(operation: () => Promise<T>): Promise<T> => {
    if (closed) return Promise.reject(new Error('LOCAL_STORE_CLOSED'))
    const promise = operation()
    active.add(promise)
    void promise.then(() => { active.delete(promise) }, () => { active.delete(promise) })
    return promise
  }
  const validate = async (value: unknown, namespace: string): Promise<LocalCanvasRecord> => {
    const record = readLocalCanvasRecord(value, namespace)
    if (record.pending !== undefined && await hash(record.pending.request) !== record.pending.bodyDigest) {
      fail('/document/pending/bodyDigest', 'digest', 'Pending mutation body failed its SHA256 check.')
    }
    if (record.pending?.kind === 'commit' && await hash(record.pending.manifest) !== record.pending.request.manifestDigest) {
      fail('/document/pending/manifest', 'digest', 'The sealed commit manifest failed its SHA256 check.')
    }
    if (record.base !== undefined && record.head !== undefined && await hash(record.base) !== record.head.manifestDigest) {
      fail('/document/base', 'digest', 'The retained base does not match its server head digest.')
    }
    return record
  }
  return {
    list: namespace => track(async () => {
      const values = await (await getDatabase()).getAllFromIndex('documents', 'namespace', namespace)
      return Promise.all(values.map(value => validate(value, namespace)))
    }),
    read: (namespace, id) => track(async () => {
      const value = await (await getDatabase()).get('documents', documentKey(namespace, id))
      if (value === undefined) return undefined
      const item = await validate(value, namespace)
      if (item.id !== id) fail('/document/id', 'identity', 'Cache key does not match its document.')
      return item
    }),
    objects: (namespace, id) => track(async () => {
      const values = await (await getDatabase()).getAllFromIndex('objects', 'document', documentKey(namespace, id))
      const result: Record<string, WorkbenchObject> = {}
      for (const input of values) {
        const item = readStoredObject(input, namespace, id)
        if (await hash(item.value) !== item.hash) fail('/object/hash', 'digest', 'Cached object failed its SHA256 check.')
        result[item.hash] = item.value
      }
      return result
    }),
    save: (value, objects = {}, expectedCacheVersion = value.cacheVersion) => track(async () => {
      const validated = await validate(value, value.namespace)
      const entries: { readonly hash: string; readonly value: WorkbenchObject }[] = []
      for (const [key, input] of Object.entries(objects)) {
        const object = unwrap(parseObject(input))
        const objectDigest = digest(key, '/objects/digest')
        if (await hash(object) !== objectDigest) fail('/objects/digest', 'digest', 'Object does not match its content digest.')
        entries.push({ hash: objectDigest, value: object })
      }
      const db = await getDatabase()
      const key = documentKey(value.namespace, value.id)
      const tx = db.transaction(['documents', 'objects'], 'readwrite')
      const completion = tx.done
      void completion.catch(() => undefined)
      try {
        const rawPrevious = await tx.objectStore('documents').get(key)
        const previous = rawPrevious === undefined ? undefined : readLocalCanvasRecord(rawPrevious, value.namespace)
        if ((previous?.cacheVersion ?? 0) !== expectedCacheVersion) throw new CanvasCacheConflict(previous)
        const next: LocalCanvasRecord = { ...validated, cacheVersion: (previous?.cacheVersion ?? 0) + 1 }
        const writes: Promise<unknown>[] = []
        for (const entry of entries) {
          const objectId = objectKey(value.namespace, value.id, entry.hash)
          const stored = await tx.objectStore('objects').get(objectId)
          if (stored !== undefined && hashing.stringify(readStoredObject(stored, value.namespace, value.id).value) !== hashing.stringify(entry.value)) {
            fail('/objects', 'immutable', 'A stored digest cannot be replaced by different content.')
          }
          writes.push(tx.objectStore('objects').put({ key: objectId, document: key, namespace: value.namespace,
            hash: entry.hash, value: entry.value }, objectId))
        }
        writes.push(tx.objectStore('documents').put(next, key))
        await Promise.all(writes)
        await completion
        return next
      } catch (error) {
        try { tx.abort() } catch { /* It may already have aborted on a storage failure. */ }
        await completion.catch(() => undefined)
        throw error
      }
    }),
    remove: (namespace, id, expectedCacheVersion) => track(async () => {
      const db = await getDatabase()
      const key = documentKey(namespace, id)
      const tx = db.transaction(['documents', 'objects'], 'readwrite')
      const completion = tx.done
      void completion.catch(() => undefined)
      try {
        const rawPrevious = await tx.objectStore('documents').get(key)
        const previous = rawPrevious === undefined ? undefined : readLocalCanvasRecord(rawPrevious, namespace)
        if ((previous?.cacheVersion ?? 0) !== expectedCacheVersion) throw new CanvasCacheConflict(previous)
        const keys = await tx.objectStore('objects').index('document').getAllKeys(key)
        await Promise.all([...keys.map(objectId => tx.objectStore('objects').delete(objectId)), tx.objectStore('documents').delete(key)])
        await completion
      } catch (error) {
        try { tx.abort() } catch { /* The failing request may already have aborted. */ }
        await completion.catch(() => undefined)
        throw error
      }
    }),
    getPreference: (namespace, key) => track(async () => {
      const value = await (await getDatabase()).get('preferences', documentKey(namespace, key))
      return value === undefined ? undefined : text(value, '/preference')
    }),
    setPreference: (namespace, key, value) => track(async () => {
      const db = await getDatabase()
      const tx = db.transaction('preferences', 'readwrite')
      const completion = tx.done
      void completion.catch(() => undefined)
      try {
        await tx.store.put(text(value, '/preference'), documentKey(namespace, key))
        await completion
      } catch (error) {
        try { tx.abort() } catch { /* Completion remains the authoritative outcome. */ }
        await completion.catch(() => undefined)
        throw error
      }
    }),
    close: async () => {
      if (closed) return
      closed = true
      await Promise.allSettled([...active])
      database?.close()
      database = undefined
      opening = undefined
    },
  }
}
