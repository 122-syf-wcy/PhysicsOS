/** Durable Session attachment roots and exclusive, reference-aware local collection. */

import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import type {
  AttachmentReferenceErasure, SessionAttachmentReference, SessionAttachmentSnapshot,
} from '@deepseek-ai/dsh-attachment'
import { ErasureDirectory, LocalErasureError } from '@deepseek-ai/dsh-attachment/local-erasure'
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock'
import { fileLeafName } from './file-store.ts'
import { ReferenceBarrier } from './reference-barrier.ts'

const HEX = /^[a-f0-9]{64}$/u
const METADATA_TEMP = /^\.erasure-[a-f0-9-]+\.tmp$/u
const UNSCOPED = 'unscoped'

interface ObjectReference {
  readonly kind: 'image' | 'file'
  readonly digest: string
  readonly name?: string
}

interface ReferenceRecord {
  readonly version: 1
  readonly owner: string
  readonly state: 'active' | 'erasing' | 'erased'
  readonly requestId?: string
  readonly references: readonly ObjectReference[]
}

interface VariantRecord {
  readonly version: 1
  readonly digest: string
  readonly variants: readonly string[]
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new LocalErasureError('ERASURE_STORAGE_FAILED')
  return value as Record<string, unknown>
}

function storedReference(value: unknown): ObjectReference {
  const row = object(value)
  if ((row['kind'] !== 'image' && row['kind'] !== 'file') || typeof row['digest'] !== 'string' || !HEX.test(row['digest'])) {
    throw new LocalErasureError('ERASURE_STORAGE_FAILED')
  }
  if (row['kind'] === 'image') return { kind: 'image', digest: row['digest'] }
  if (typeof row['name'] !== 'string' || row['name'] !== fileLeafName(row['name'])) {
    throw new LocalErasureError('ERASURE_STORAGE_FAILED')
  }
  return { kind: 'file', digest: row['digest'], name: row['name'] }
}

function toObject(reference: SessionAttachmentReference): ObjectReference {
  const digest = String(reference.ref.attachmentId).replace(/^sha256:/u, '')
  if (!HEX.test(digest) || String(reference.ref.attachmentId) !== `sha256:${digest}`) {
    throw new LocalErasureError('ERASURE_STORAGE_FAILED')
  }
  return storedReference({ kind: reference.kind, digest, ...(reference.kind === 'file' ? { name: reference.ref.name } : {}) })
}

function referenceKey(ref: ObjectReference): string {
  return JSON.stringify([ref.kind, ref.digest, ref.name])
}

function mergeReferences(left: readonly ObjectReference[], right: readonly ObjectReference[]): ObjectReference[] {
  return [...new Map([...left, ...right].map(ref => [referenceKey(ref), ref])).values()]
}

function decodeRecord(bytes: Buffer, owner: string): ReferenceRecord {
  const row = object(JSON.parse(bytes.toString('utf8')))
  if (row['version'] !== 1 || row['owner'] !== owner
    || (row['state'] !== 'active' && row['state'] !== 'erasing' && row['state'] !== 'erased')
    || !Array.isArray(row['references'])
    || (row['state'] !== 'active' && (typeof row['requestId'] !== 'string' || row['requestId'].length === 0))) {
    throw new LocalErasureError('ERASURE_STORAGE_FAILED')
  }
  const references = (row['references'] as readonly unknown[]).map(storedReference)
  if (row['state'] === 'erased' && references.length !== 0) throw new LocalErasureError('ERASURE_STORAGE_FAILED')
  return {
    version: 1, owner, state: row['state'], references,
    ...(typeof row['requestId'] === 'string' ? { requestId: row['requestId'] } : {}),
  }
}

function decodeVariant(bytes: Buffer, digest: string): VariantRecord {
  const row = object(JSON.parse(bytes.toString('utf8')))
  if (row['version'] !== 1 || row['digest'] !== digest || !Array.isArray(row['variants'])
    || !row['variants'].every((value: unknown) => typeof value === 'string' && HEX.test(value))) {
    throw new LocalErasureError('ERASURE_STORAGE_FAILED')
  }
  return { version: 1, digest, variants: row['variants'] as string[] }
}

async function requiredChild(parent: ErasureDirectory, name: string): Promise<ErasureDirectory> {
  const child = await parent.child(name, true)
  if (child === undefined) throw new LocalErasureError('ERASURE_STORAGE_FAILED')
  return child
}

async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error: unknown) {
    if (error instanceof LocalErasureError) throw error
    throw new LocalErasureError('ERASURE_STORAGE_FAILED')
  }
}

/** Local reference index. Its writer lock is held until every admitted operation has settled on disposal. */
export class LocalAttachmentReferences implements AttachmentReferenceErasure {
  private readonly barrier = new ReferenceBarrier()
  private readonly scope = new AsyncLocalStorage<{ readonly sessionId?: string }>()
  private readonly records = new Map<string, ReferenceRecord>()
  private readonly variants = new Map<string, VariantRecord>()
  private readonly pendingFences = new Set<string>()
  private ready?: Promise<void>
  private index?: ErasureDirectory
  private owners?: ErasureDirectory
  private variantFiles?: ErasureDirectory
  private writer?: FileHandle
  private metadataTail: Promise<void> = Promise.resolve()
  private closing = false

  /**
   * @param root - provider-owned versioned attachment root.
   * @param cacheRoot - provider-owned request-image cache root.
   */
  constructor(private readonly root: string, private readonly cacheRoot: string) {}

  async assertAvailable(): Promise<void> {
    await safe(async () => {
      await this.initialize()
      await this.barrier.exclusive(() => this.assertIndexedCache())
    })
  }

  withSession<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    return this.runOwned(sessionId, operation)
  }

  /**
   * Attribute a provider operation to the explicit scope, then the actual initiating Agent, else an unscoped root.
   * @param sessionId - actual initiating Session, when this call has no explicit Host scope.
   * @param operation - complete byte read, save, or transform lifetime.
   * @returns the result while keeping collection excluded through settlement.
   */
  run<T>(sessionId: string | undefined, operation: () => Promise<T>): Promise<T> {
    return this.runOwned(this.scope.getStore()?.sessionId ?? sessionId, operation)
  }

  private runOwned<T>(sessionId: string | undefined, operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new LocalErasureError('ERASURE_UNAVAILABLE'))
    return this.barrier.shared(async () => {
      const owner = sessionId === undefined ? UNSCOPED : hash(sessionId)
      await safe(async () => {
        await this.initialize()
        await this.mutate(async () => {
          this.assertWritable(owner)
          if (!this.records.has(owner)) await this.putNow({ version: 1, owner, state: 'active', references: [] })
        })
      })
      return this.scope.run(sessionId === undefined ? {} : { sessionId }, operation)
    })
  }

  /**
   * Persist a saved object's owner before any object bytes or references publish.
   * @param references - references derived from validated bytes by this provider.
   */
  async recordSaved(references: readonly SessionAttachmentReference[]): Promise<void> {
    const sessionId = this.scope.getStore()?.sessionId
    await safe(() => this.record(sessionId === undefined ? UNSCOPED : hash(sessionId), references, false))
  }

  /**
   * Choose the provider-private staging namespace for the active operation.
   * @returns a digest directory, or the protected unscoped namespace.
   */
  stagingOwner(): string {
    const sessionId = this.scope.getStore()?.sessionId
    return sessionId === undefined ? UNSCOPED : hash(sessionId)
  }

  recordSession(sessionId: string, references: readonly SessionAttachmentReference[]): Promise<void> {
    if (this.closing) return Promise.reject(new LocalErasureError('ERASURE_UNAVAILABLE'))
    return safe(() => this.barrier.shared(async () => {
      await this.initialize()
      await this.record(hash(sessionId), references, true)
    }))
  }

  /**
   * Record a source-to-variant association before a cache file can publish.
   * @param attachmentId - verified normalized image identity.
   * @param variantId - deterministic transform identity produced by the local encoder.
   */
  recordVariant(attachmentId: string, variantId: string): Promise<void> {
    const digest = attachmentId.replace(/^sha256:/u, '')
    const variant = variantId.replace(/^sha256:/u, '')
    if (!HEX.test(digest) || !HEX.test(variant)) return Promise.reject(new LocalErasureError('ERASURE_STORAGE_FAILED'))
    return safe(() => this.mutate(async () => {
      const current = this.variants.get(digest)
      if (current?.variants.includes(variant) === true) return
      const next: VariantRecord = { version: 1, digest, variants: [...(current?.variants ?? []), variant] }
      await this.requireVariants().writeJson(`${digest}.json`, next)
      this.variants.set(digest, next)
    }))
  }

  fenceSessions(requestId: string, sessionIds: readonly string[], signal?: AbortSignal): Promise<void> {
    const owners = new Set(sessionIds.map(hash))
    for (const owner of owners) this.pendingFences.add(owner)
    return safe(async () => {
      await this.initialize()
      await this.barrier.exclusive(async () => {
        for (const owner of owners) {
          const current = this.records.get(owner)
          if (current !== undefined && current.state !== 'active' && current.requestId !== requestId) {
            throw new LocalErasureError('ERASURE_BUSY')
          }
          if (current?.state === 'erased') continue
          await this.put({ version: 1, owner, state: 'erasing', requestId, references: current?.references ?? [] })
        }
      }, signal)
    })
  }

  eraseSessions(
    requestId: string,
    sessionIds: readonly string[],
    snapshot: () => Promise<readonly SessionAttachmentSnapshot[]>,
  ): Promise<void> {
    return safe(async () => {
      await this.initialize()
      await this.barrier.exclusive(async () => {
        await this.assertIndexedCache()
        const ids = new Set(sessionIds)
        const owners = new Set(sessionIds.map(hash))
        for (const owner of owners) {
          const row = this.records.get(owner)
          if (row === undefined || row.state === 'active' || row.requestId !== requestId) {
            throw new LocalErasureError('ERASURE_BUSY')
          }
        }
        const observations = await snapshot()
        const retained: ObjectReference[] = []
        const retainIds = new Set<string>()
        const candidates = new Map<string, readonly ObjectReference[]>()
        for (const [owner, row] of this.records) {
          if (owners.has(owner)) candidates.set(owner, row.references)
          else retained.push(...row.references)
        }
        for (const observation of observations) {
          if (ids.has(observation.sessionId)) {
            const owner = hash(observation.sessionId)
            candidates.set(owner, mergeReferences(candidates.get(owner) ?? [], observation.references.map(toObject)))
          } else {
            retained.push(...observation.references.map(toObject))
            for (const id of observation.retainedAttachmentIds) retainIds.add(id)
          }
        }
        // Keep the complete candidate directory durable until every object unlink has succeeded.
        for (const [owner, references] of candidates) {
          await this.put({ version: 1, owner, state: 'erasing', requestId, references })
        }
        const unique = mergeReferences([], [...candidates.values()].flat())
        const retainedKeys = new Set(retained.map(referenceKey))
        const retainedObjects = new Set(retained.map(ref => `${ref.kind}:${ref.digest}`))
        const root = await ErasureDirectory.open(this.root)
        if (root === undefined) throw new LocalErasureError('ERASURE_STORAGE_FAILED')
        await using directory = root
        for (const reference of unique) {
          if (retainIds.has(`sha256:${reference.digest}`)) continue
          if (reference.kind === 'image') {
            if (retainedObjects.has(`image:${reference.digest}`)) continue
            await this.removeObject(directory, 'objects', reference.digest)
            await this.removeVariants(reference.digest)
          } else if (!retainedObjects.has(`file:${reference.digest}`)) {
            await this.removeObject(directory, 'file-objects', reference.digest)
            await this.removeDigestDirectory(directory, 'files', reference.digest)
          } else if (!retainedKeys.has(referenceKey(reference))) {
            await this.removeFileAlias(directory, reference)
          }
        }
        const temporary = await directory.child('tmp')
        if (temporary !== undefined) {
          await using staging = temporary
          for (const owner of owners) await staging.removeTree(owner)
        }
        for (const owner of owners) {
          await this.put({ version: 1, owner, state: 'erased', requestId, references: [] })
        }
      })
    })
  }

  /** Stop new operations, drain current ones, and release the reference index's kernel writer lock. */
  async dispose(): Promise<void> {
    this.closing = true
    await this.barrier.exclusive(async () => {
      if (this.ready !== undefined) {
        try { await this.ready } catch (error: unknown) { void error /* initialize owns its failed-open cleanup. */ }
      }
      await this.metadataTail
      await this.writer?.close()
      await this.variantFiles?.close()
      await this.owners?.close()
      await this.index?.close()
      this.writer = undefined
      this.variantFiles = undefined
      this.owners = undefined
      this.index = undefined
      this.records.clear()
      this.variants.clear()
    })
  }

  private initialize(): Promise<void> {
    if (this.closing) return Promise.reject(new LocalErasureError('ERASURE_UNAVAILABLE'))
    return this.ready ??= this.load()
  }

  private async load(): Promise<void> {
    const root = await ErasureDirectory.open(this.root, true)
    if (root === undefined) throw new LocalErasureError('ERASURE_STORAGE_FAILED')
    await using directory = root
    const acquired: Array<ErasureDirectory | FileHandle> = []
    try {
      const index = await requiredChild(directory, 'reference-index')
      acquired.push(index)
      const writer = await open(index.handlePath('writer.lock'), constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)
      acquired.push(writer)
      if (!(await writer.stat()).isFile()) throw new LocalErasureError('ERASURE_UNSAFE_PATH')
      try {
        await tryLockExclusive(writer.fd)
      } catch (error: unknown) {
        void error
        throw new LocalErasureError('ERASURE_BUSY')
      }
      const held = await writer.stat()
      const currentLock = await index.stat('writer.lock')
      if (currentLock === undefined || !currentLock.isFile() || currentLock.dev !== held.dev || currentLock.ino !== held.ino) {
        throw new LocalErasureError('ERASURE_BUSY')
      }
      const owners = await requiredChild(index, 'sessions')
      acquired.push(owners)
      const variants = await requiredChild(index, 'variants')
      acquired.push(variants)
      for (const name of await this.metadataNames(owners)) {
        const owner = name.slice(0, -5)
        if (owner !== UNSCOPED && !HEX.test(owner)) throw new LocalErasureError('ERASURE_STORAGE_FAILED')
        const bytes = await owners.read(name)
        if (bytes === undefined) throw new LocalErasureError('ERASURE_STORAGE_FAILED')
        this.records.set(owner, decodeRecord(bytes, owner))
      }
      for (const name of await this.metadataNames(variants)) {
        const digest = name.slice(0, -5)
        if (!HEX.test(digest)) throw new LocalErasureError('ERASURE_STORAGE_FAILED')
        const bytes = await variants.read(name)
        if (bytes === undefined) throw new LocalErasureError('ERASURE_STORAGE_FAILED')
        this.variants.set(digest, decodeVariant(bytes, digest))
      }
      this.index = index
      this.writer = writer
      this.owners = owners
      this.variantFiles = variants
    } catch (error: unknown) {
      for (const handle of acquired.reverse()) await handle.close()
      throw error
    }
  }

  private async metadataNames(directory: ErasureDirectory): Promise<string[]> {
    const names: string[] = []
    for (const name of await directory.entries()) {
      if (METADATA_TEMP.test(name)) await directory.removeFile(name)
      else if (name.endsWith('.json')) names.push(name)
      else throw new LocalErasureError('ERASURE_STORAGE_FAILED')
    }
    return names
  }

  private assertWritable(owner: string): void {
    const row = this.records.get(owner)
    if (this.pendingFences.has(owner) || (row !== undefined && row.state !== 'active')) {
      throw new LocalErasureError('ERASURE_BUSY')
    }
  }

  private record(owner: string, references: readonly SessionAttachmentReference[], finalFlush: boolean): Promise<void> {
    const additions = references.map(toObject)
    return this.mutate(async () => {
      const current = this.records.get(owner)
      if (current?.state === 'erased') throw new LocalErasureError('ERASURE_BUSY')
      if (!finalFlush) this.assertWritable(owner)
      const merged = mergeReferences(current?.references ?? [], additions)
      if (current !== undefined && merged.length === current.references.length) return
      await this.putNow({ version: 1, owner, state: 'active', ...current, references: merged })
    })
  }

  private put(record: ReferenceRecord): Promise<void> {
    return this.mutate(() => this.putNow(record))
  }

  private async putNow(record: ReferenceRecord): Promise<void> {
    const owners = this.owners
    if (owners === undefined) throw new LocalErasureError('ERASURE_UNAVAILABLE')
    await owners.writeJson(`${record.owner}.json`, record)
    this.records.set(record.owner, record)
  }

  private mutate(operation: () => Promise<void>): Promise<void> {
    const result = this.metadataTail.then(operation)
    this.metadataTail = result.then(() => {}, () => {})
    return result
  }

  private requireVariants(): ErasureDirectory {
    if (this.variantFiles === undefined) throw new LocalErasureError('ERASURE_UNAVAILABLE')
    return this.variantFiles
  }

  private async assertIndexedCache(): Promise<void> {
    const root = await ErasureDirectory.open(this.cacheRoot)
    if (root === undefined) return
    await using cache = root
    const imageDirectory = await cache.child('request-images')
    if (imageDirectory === undefined) return
    await using images = imageDirectory
    const indexed = new Set([...this.variants.values()].flatMap(row => row.variants))
    for (const prefix of await images.entries()) {
      if (!/^[a-f0-9]{2}$/u.test(prefix)) throw new LocalErasureError('ERASURE_STORAGE_FAILED')
      const directory = await images.child(prefix)
      if (directory === undefined) throw new LocalErasureError('ERASURE_STORAGE_FAILED')
      await using bucket = directory
      for (const name of await bucket.entries()) {
        const match = /^([a-f0-9]{64})(?:\.[a-f0-9-]+\.tmp)?$/u.exec(name)
        const digest = match?.[1]
        if (digest === undefined || !digest.startsWith(prefix) || !indexed.has(digest)) {
          // Legacy variant hashes cannot be reversed into their source attachment and route policy.
          throw new LocalErasureError('ERASURE_UNAVAILABLE')
        }
        const metadata = await bucket.stat(name)
        if (metadata === undefined || !metadata.isFile()) throw new LocalErasureError('ERASURE_UNSAFE_PATH')
      }
    }
  }

  private async removeObject(root: ErasureDirectory, family: string, digest: string): Promise<void> {
    const parent = await root.child(family)
    if (parent === undefined) return
    await using objects = parent
    const child = await objects.child(digest.slice(0, 2))
    if (child === undefined) return
    await using bucket = child
    await bucket.removeFile(digest)
  }

  private async removeDigestDirectory(root: ErasureDirectory, family: string, digest: string): Promise<void> {
    const parent = await root.child(family)
    if (parent === undefined) return
    await using files = parent
    const child = await files.child(digest.slice(0, 2))
    if (child === undefined) return
    await using bucket = child
    await bucket.removeTree(digest)
  }

  private async removeFileAlias(root: ErasureDirectory, ref: ObjectReference): Promise<void> {
    if (ref.name === undefined) throw new LocalErasureError('ERASURE_STORAGE_FAILED')
    const family = await root.child('files')
    if (family === undefined) return
    await using files = family
    const child = await files.child(ref.digest.slice(0, 2))
    if (child === undefined) return
    await using bucket = child
    const directory = await bucket.child(ref.digest)
    if (directory === undefined) return
    await using aliases = directory
    await aliases.removeFile(ref.name)
  }

  private async removeVariants(digest: string): Promise<void> {
    const record = this.variants.get(digest)
    if (record === undefined) return
    const root = await ErasureDirectory.open(this.cacheRoot)
    if (root !== undefined) {
      await using cache = root
      const images = await cache.child('request-images')
      if (images !== undefined) {
        await using directory = images
        for (const variant of record.variants) {
          const child = await directory.child(variant.slice(0, 2))
          if (child === undefined) continue
          await using bucket = child
          for (const name of await bucket.entries()) {
            if (name === variant || new RegExp(`^${variant}\\.[a-f0-9-]+\\.tmp$`, 'u').test(name)) {
              await bucket.removeFile(name)
            }
          }
        }
      }
    }
    await this.requireVariants().removeFile(`${digest}.json`)
    this.variants.delete(digest)
  }
}
