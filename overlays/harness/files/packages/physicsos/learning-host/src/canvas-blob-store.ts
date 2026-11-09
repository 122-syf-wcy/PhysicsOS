/** Account- and document-private immutable Canvas files, outside storage-domain snapshots. */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rmdir,
  unlink,
} from 'node:fs/promises'
import { dirname, join, parse, resolve } from 'node:path'
import { CanvasError, hasErrorCode } from './canvas-error.ts'

/** Identity resolved by the server, never copied from an upload envelope. */
export interface CanvasBlobScope {
  readonly schoolId: string
  readonly userKey: string
  readonly canvasId: string
}

/** Facts measured while writing the complete immutable file. */
export interface CanvasBlobReference {
  readonly digest: string
  readonly bytes: number
}

/** Bounded publication; reservation accounting must precede this operation. */
export interface CanvasBlobWriteOptions {
  readonly expectedBytes: number
  readonly maxBytes: number
  readonly signal?: AbortSignal
}

const DIGEST = /^[a-f0-9]{64}(?![\s\S])/
const IDENTIFIER = /^[A-Za-z0-9._-]{1,128}(?![\s\S])/

/**
 * Hash a server-owned identity tuple for filesystem and metadata keys.
 * @param parts - Identity components, with their tuple boundaries retained.
 * @returns Lowercase SHA-256, safe as a single path segment.
 */
export function canvasScopeKey(...parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex')
}

/**
 * Verify the address syntax before constructing any path.
 * @param digest - Lowercase SHA-256 address.
 * @returns The validated address.
 */
export function canvasDigest(digest: string): string {
  if (!DIGEST.test(digest)) throw new CanvasError(400, 'BAD_DIGEST', 'Object digest must be lowercase SHA-256.')
  return digest
}

/**
 * Compute the address of exact canonical bytes.
 * @param bytes - Complete object bytes, including its envelope.
 * @returns Lowercase SHA-256.
 */
export function canvasHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Linux production storage requires real POSIX directory durability. */
async function syncAncestors(path: string): Promise<void> {
  let current = resolve(path)
  while (true) {
    await syncDirectory(current)
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

async function assertDirectory(path: string, privateOwner: boolean): Promise<void> {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new CanvasError(503, 'BLOB_UNSAFE_PATH', 'Canvas storage contains a non-directory or symbolic link.')
  }
  if (privateOwner && typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new CanvasError(503, 'BLOB_UNSAFE_PATH', 'Canvas storage is not owned by the application account.')
  }
  if (privateOwner && (info.mode & 0o077) !== 0) await chmod(path, 0o700)
}

/**
 * File publications are exclusive, fsynced, and verified before a reference is returned.
 * All public operations participate in close quiescence. Metadata authorization belongs
 * to CanvasService; filesystem paths contain only hashes of that authorized scope.
 */
export class CanvasBlobStore {
  private readonly root: string
  private readonly home: string
  private readonly pending = new Set<Promise<unknown>>()
  private closing = false
  private disposal: Promise<void> | undefined
  private initialized: Promise<void> | undefined

  constructor(root: string) {
    this.root = resolve(root)
    this.home = dirname(dirname(dirname(this.root)))
    if (join(this.home, 'physicsos', 'canvases', 'v1') !== this.root) {
      throw new Error('CanvasBlobStore root must be <DSH_HOME>/physicsos/canvases/v1')
    }
  }

  /**
   * Establish owner-private directories and durable ancestor entries.
   * @returns Completion after the root is usable; failures prevent service mounting.
   */
  initialize(): Promise<void> {
    return this.track(async () => {
      this.initialized ??= this.ensurePrivateDirectory(this.root)
      try { await this.initialized } catch (error) {
        if (error instanceof CanvasError) throw error
        throw new CanvasError(503, 'BLOB_INITIALIZATION_FAILED', 'Unable to initialize private Canvas storage.', { cause: error })
      }
    })
  }

  /**
   * Publish bytes after the caller has durably reserved their complete quota.
   * @param scope - Server-authorized account and document.
   * @param digest - Expected SHA-256 of the complete canonical object.
   * @param chunks - Exact bytes in order; oversized chunks are not truncated.
   * @param options - Actual-byte limits and optional cancellation.
   * @returns Measured facts only after file and ancestor-directory fsyncs.
   */
  publish(
    scope: CanvasBlobScope,
    digest: string,
    chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
    options: CanvasBlobWriteOptions,
  ): Promise<CanvasBlobReference> {
    return this.track(async () => {
      try { return await this.publishFile(scope, canvasDigest(digest), chunks, options) } catch (error) {
        if (error instanceof CanvasError || options.signal?.aborted === true) throw error
        throw new CanvasError(503, 'BLOB_WRITE_FAILED', 'Unable to durably publish Canvas object.', { cause: error })
      }
    })
  }

  /**
   * Read and verify the complete file before exposing any bytes to a response.
   * @param scope - Server-authorized account and document.
   * @param digest - Immutable object address.
   * @param expectedBytes - Authoritative metadata length.
   * @param maxBytes - Current configured object bound.
   * @param signal - Optional request cancellation.
   * @returns Exact bytes; missing, corrupt, unsafe, or oversized files reject.
   */
  read(
    scope: CanvasBlobScope,
    digest: string,
    expectedBytes: number,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    return this.track(async () => {
      signal?.throwIfAborted()
      const path = this.objectPath(scope, canvasDigest(digest))
      try {
        await this.assertPrivateAncestors(dirname(path))
        const bytes = await this.readVerified(path, digest, expectedBytes, maxBytes)
        signal?.throwIfAborted()
        return bytes
      } catch (error) {
        if (error instanceof CanvasError || signal?.aborted === true) throw error
        if (hasErrorCode(error, 'ENOENT')) throw new CanvasError(503, 'BLOB_MISSING', 'A referenced Canvas object is missing.', { cause: error })
        throw new CanvasError(503, 'BLOB_READ_FAILED', 'Unable to read Canvas object.', { cause: error })
      }
    })
  }

  /**
   * Publish a server-only verification attempt, which can never be addressed by a client object route.
   * @param scope - Server-authorized account and document.
   * @param digest - Exact SHA-256 of the complete attempt JSON.
   * @param bytes - Complete original outcome/evidence bytes; its quota is already reserved.
   * @param options - Actual-byte admission and request cancellation.
   * @returns Immutable file facts after full durable publication.
   */
  publishVerificationAttempt(scope: CanvasBlobScope, digest: string, bytes: Uint8Array, options: CanvasBlobWriteOptions): Promise<CanvasBlobReference> {
    return this.track(async () => {
      try { return await this.publishFile(scope, canvasDigest(digest), [bytes], options, true) } catch (error) {
        if (error instanceof CanvasError || options.signal?.aborted === true) throw error
        throw new CanvasError(503, 'BLOB_WRITE_FAILED', 'Unable to durably publish server verification attempt.', { cause: error })
      }
    })
  }

  /**
   * Read the exact first server attempt instead of rerunning an already-published verification.
   * @param scope - Server-authorized account and document.
   * @param digest - Address retained in server reservation metadata.
   * @param bytes - Authoritative reserved length.
   * @param maxBytes - Configured complete attempt-byte limit.
   * @returns Original verified bytes; absence is recoverable only while the reservation is pending.
   */
  readVerificationAttempt(scope: CanvasBlobScope, digest: string, bytes: number, maxBytes: number): Promise<Uint8Array> {
    return this.track(async () => {
      const path = this.verificationPath(scope, canvasDigest(digest))
      try {
        await this.assertPrivateAncestors(dirname(path))
        return await this.readVerified(path, digest, bytes, maxBytes)
      } catch (error) {
        if (error instanceof CanvasError) throw error
        if (hasErrorCode(error, 'ENOENT')) throw new CanvasError(503, 'BLOB_MISSING', 'Pending server verification attempt is not published.', { cause: error })
        throw new CanvasError(503, 'BLOB_READ_FAILED', 'Unable to read server verification attempt.', { cause: error })
      }
    })
  }

  /**
   * Remove first-attempt bytes before their reservation charge is released.
   * @param scope - Server-authorized account and document.
   * @param digest - Server-only attempt address.
   * @returns Completion after real unlink and ancestor-directory fsync.
   */
  removeVerificationAttempt(scope: CanvasBlobScope, digest: string): Promise<void> {
    return this.track(async () => {
      try { await this.removeFile(scope, canvasDigest(digest), true) } catch (error) {
        if (error instanceof CanvasError) throw error
        throw new CanvasError(503, 'BLOB_DELETE_FAILED', 'Unable to durably remove server verification attempt.', { cause: error })
      }
    })
  }

  /**
   * Remove an unreachable file before the caller reduces reservation or object accounting.
   * @param scope - Server-authorized account and document.
   * @param digest - Address selected by the same-account reachability collector.
   * @returns Completion after unlink and directory fsync; absence is idempotent.
   */
  remove(scope: CanvasBlobScope, digest: string): Promise<void> {
    return this.track(async () => {
      try { await this.removeFile(scope, canvasDigest(digest)) } catch (error) {
        if (error instanceof CanvasError) throw error
        throw new CanvasError(503, 'BLOB_DELETE_FAILED', 'Unable to durably remove Canvas object.', { cause: error })
      }
    })
  }

  private async removeFile(scope: CanvasBlobScope, digest: string, verification = false): Promise<void> {
    const path = verification ? this.verificationPath(scope, digest) : this.objectPath(scope, digest)
    try {
      await this.assertPrivateAncestors(dirname(path))
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new CanvasError(503, 'BLOB_UNSAFE_PATH', 'Canvas object is not a regular private file.')
      }
      await unlink(path)
      await syncAncestors(dirname(path))
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        let existing = dirname(path)
        while (true) {
          try {
            await this.assertPrivateAncestors(existing)
            await syncAncestors(existing)
            return
          } catch (ancestorError) {
            if (!hasErrorCode(ancestorError, 'ENOENT')) throw ancestorError
            const parent = dirname(existing)
            if (parent === existing || !parent.startsWith(this.home)) throw ancestorError
            existing = parent
          }
        }
      }
      if (error instanceof CanvasError) throw error
      throw new CanvasError(503, 'BLOB_DELETE_FAILED', 'Unable to durably remove Canvas object.', { cause: error })
    }
  }

  /**
   * Remove abandoned private staging files while the caller holds its account queue.
   * @param scope - Account and document whose expired reservations are being collected.
   * @param olderThan - Epoch milliseconds; active reservations must be excluded by the caller.
   * @returns Number of staging directories actually removed and directory-synced.
   */
  collectStaging(scope: CanvasBlobScope, olderThan: number): Promise<number> {
    return this.track(async () => {
      try { return await this.collectStagingFiles(scope, olderThan) } catch (error) {
        if (error instanceof CanvasError) throw error
        throw new CanvasError(503, 'BLOB_DELETE_FAILED', 'Unable to durably collect Canvas staging files.', { cause: error })
      }
    })
  }

  private async collectStagingFiles(scope: CanvasBlobScope, olderThan: number): Promise<number> {
    const staging = join(this.documentPath(scope), 'staging')
    try {
      await this.assertPrivateAncestors(staging)
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return 0
      throw error
    }
    let removed = 0
    for (const entry of await readdir(staging, { withFileTypes: true })) {
      if (!entry.name.startsWith('upload-') || !entry.isDirectory() || entry.isSymbolicLink()) {
        throw new CanvasError(503, 'BLOB_UNSAFE_PATH', 'Canvas staging contains an unexpected entry.')
      }
      const path = join(staging, entry.name)
      const info = await lstat(path)
      if (info.mtimeMs >= olderThan) continue
      const leaves = await readdir(path)
      if (leaves.some(name => name !== 'object')) {
        throw new CanvasError(503, 'BLOB_UNSAFE_PATH', 'Canvas staging contains unexpected files.')
      }
      if (leaves.includes('object')) await unlink(join(path, 'object'))
      await rmdir(path)
      removed += 1
    }
    await syncAncestors(staging)
    return removed
  }

  /**
   * Refuse new operations and wait for every acquired file handle to settle.
   * @returns One shared quiescent disposal promise.
   */
  close(): Promise<void> {
    this.closing = true
    this.disposal ??= Promise.allSettled([...this.pending]).then(() => {})
    return this.disposal
  }

  private track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new CanvasError(503, 'CLOSED', 'Canvas storage is closing.'))
    const result = operation()
    this.pending.add(result)
    void result.then(() => this.pending.delete(result), () => this.pending.delete(result))
    return result
  }

  private documentPath(scope: CanvasBlobScope): string {
    if (!IDENTIFIER.test(scope.canvasId) || scope.schoolId.length === 0 || scope.userKey.length === 0) {
      throw new CanvasError(400, 'BAD_REQUEST', 'Canvas storage scope is invalid.')
    }
    return join(
      this.root,
      'accounts',
      canvasScopeKey(scope.schoolId, scope.userKey),
      'documents',
      canvasScopeKey(scope.canvasId),
    )
  }

  private objectPath(scope: CanvasBlobScope, digest: string): string {
    return join(this.documentPath(scope), 'objects', digest.slice(0, 2), digest)
  }

  private verificationPath(scope: CanvasBlobScope, digest: string): string {
    return join(this.documentPath(scope), 'verification-attempts', digest.slice(0, 2), digest)
  }

  private async ensurePrivateDirectory(target: string): Promise<void> {
    const absolute = resolve(target)
    const root = parse(absolute).root
    const components = absolute.slice(root.length).split('/').filter(Boolean)
    let current = root
    for (const component of components) {
      current = join(current, component)
      const privateOwner = current === this.home || current.startsWith(`${this.home}/`)
      try {
        await mkdir(current, { mode: privateOwner ? 0o700 : 0o755 })
      } catch (error) {
        if (!hasErrorCode(error, 'EEXIST')) throw error
      }
      await assertDirectory(current, privateOwner)
    }
    await syncAncestors(absolute)
  }

  private async assertPrivateAncestors(target: string): Promise<void> {
    let current = this.home
    await assertDirectory(current, true)
    const relative = resolve(target).slice(this.home.length + 1)
    for (const component of relative.split('/').filter(Boolean)) {
      current = join(current, component)
      await assertDirectory(current, true)
    }
  }

  private async readVerified(path: string, digest: string, expectedBytes: number, maxBytes: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > maxBytes) {
      throw new CanvasError(413, 'OBJECT_TOO_LARGE', 'Canvas object exceeds its complete-byte limit.')
    }
    let handle
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      const info = await handle.stat()
      if (!info.isFile() || info.size !== expectedBytes || info.size > maxBytes) {
        throw new CanvasError(503, 'BLOB_CORRUPT', 'Canvas object length or file type failed integrity verification.')
      }
      if ((typeof process.getuid === 'function' && info.uid !== process.getuid()) || (info.mode & 0o077) !== 0) {
        throw new CanvasError(503, 'BLOB_UNSAFE_PATH', 'Canvas object is not an owner-private application file.')
      }
      const bytes = await handle.readFile()
      if (bytes.byteLength !== expectedBytes || canvasHash(bytes) !== digest) {
        throw new CanvasError(503, 'BLOB_CORRUPT', 'Canvas object failed SHA-256 verification.')
      }
      return bytes
    } catch (error) {
      if (error instanceof CanvasError) throw error
      if (hasErrorCode(error, 'ENOENT')) throw new CanvasError(503, 'BLOB_MISSING', 'A referenced Canvas object is missing.', { cause: error })
      if (hasErrorCode(error, 'ELOOP')) throw new CanvasError(503, 'BLOB_UNSAFE_PATH', 'Canvas object is a symbolic link.', { cause: error })
      throw new CanvasError(503, 'BLOB_READ_FAILED', 'Unable to read Canvas object.', { cause: error })
    } finally {
      await handle?.close()
    }
  }

  private async publishFile(
    scope: CanvasBlobScope,
    digest: string,
    chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
    options: CanvasBlobWriteOptions,
    verification = false,
  ): Promise<CanvasBlobReference> {
    if (!Number.isSafeInteger(options.expectedBytes) || options.expectedBytes < 1 || options.expectedBytes > options.maxBytes) {
      throw new CanvasError(413, 'OBJECT_TOO_LARGE', 'Canvas object exceeds its complete-byte limit.')
    }
    const document = this.documentPath(scope)
    const staging = join(document, 'staging')
    const target = verification ? this.verificationPath(scope, digest) : this.objectPath(scope, digest)
    await this.ensurePrivateDirectory(staging)
    await this.ensurePrivateDirectory(dirname(target))
    const temporary = await mkdtemp(join(staging, 'upload-'))
    await chmod(temporary, 0o700)
    const leaf = join(temporary, 'object')
    let handle
    try {
      handle = await open(leaf, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
      const hash = createHash('sha256')
      let bytes = 0
      for await (const chunk of chunks) {
        options.signal?.throwIfAborted()
        if (!(chunk instanceof Uint8Array)) throw new CanvasError(400, 'BAD_REQUEST', 'Canvas object chunks must be bytes.')
        bytes += chunk.byteLength
        if (!Number.isSafeInteger(bytes) || bytes > options.maxBytes || bytes > options.expectedBytes) {
          throw new CanvasError(413, 'OBJECT_TOO_LARGE', 'Canvas object exceeds its declared complete-byte limit.')
        }
        await handle.writeFile(chunk)
        hash.update(chunk)
      }
      options.signal?.throwIfAborted()
      const info = await handle.stat()
      if (bytes !== options.expectedBytes || info.size !== bytes || hash.digest('hex') !== digest) {
        throw new CanvasError(400, 'DIGEST_MISMATCH', 'Canvas object bytes do not match their address and length.')
      }
      await handle.chmod(0o400)
      await handle.sync()
      await handle.close()
      handle = undefined
      try {
        await link(leaf, target)
      } catch (error) {
        if (!hasErrorCode(error, 'EEXIST')) throw error
        await this.readVerified(target, digest, bytes, options.maxBytes)
      }
      await syncAncestors(dirname(target))
      await unlink(leaf)
      await rmdir(temporary)
      await syncAncestors(staging)
      return { digest, bytes }
    } catch (error) {
      if (error instanceof CanvasError) throw error
      if (options.signal?.aborted === true) throw error
      throw new CanvasError(503, 'BLOB_WRITE_FAILED', 'Unable to durably publish Canvas object.', { cause: error })
    } finally {
      await handle?.close()
      let removed = false
      try {
        await unlink(leaf)
        removed = true
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) throw error
      }
      try {
        await rmdir(temporary)
        removed = true
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) throw error
      }
      if (removed) await syncAncestors(staging)
    }
  }
}
