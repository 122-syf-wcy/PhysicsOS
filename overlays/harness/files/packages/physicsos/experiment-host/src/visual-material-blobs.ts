/** Owner-private content addressed originals; never serve this tree as web assets. */
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, statfs, unlink, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  VisualMaterialError, VISUAL_MATERIAL_DISK_RESERVE, visualMaterialLimits,
  type VisualMaterialBlobStore, type VisualMaterialLimits, type VisualMaterialPngValidator,
  type VisualMaterialRecord,
} from './visual-material-contracts.ts'
import { visualMaterialDigest, visualMaterialId, visualMaterialSha } from './visual-material-domain.ts'
import { validateVisualMaterialPng } from './visual-material-png.ts'

export interface FileVisualMaterialBlobStoreOptions {
  /** Existing physical DSH_HOME, not a user-supplied path. No symlink components are accepted. */
  readonly dshHome?: string
  readonly limits?: Partial<VisualMaterialLimits>
  readonly validatePng?: VisualMaterialPngValidator
}
interface Directory { readonly handle: FileHandle; readonly physical: string; readonly anchored: string }
const codeOf = (error: unknown): string | undefined => error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined
const unsafe = (): never => { throw new VisualMaterialError(503, 'BLOB_PATH_UNSAFE', 'Private visual material storage boundary is unsafe.') }
const sameFile = (a: { dev: number; ino: number }, b: { dev: number; ino: number }): boolean => a.dev === b.dev && a.ino === b.ino

/** Uses pinned /proc/self/fd parents on Linux; checked private inode boundaries on macOS. */
export class FileVisualMaterialBlobStore implements VisualMaterialBlobStore {
  private readonly home: string
  private readonly limits: VisualMaterialLimits
  private readonly validator: VisualMaterialPngValidator
  private initialized = false
  private readonly locks = new Map<string, Promise<void>>()
  constructor(options: FileVisualMaterialBlobStoreOptions = {}) {
    const home = options.dshHome ?? process.env.DSH_HOME
    if (typeof home !== 'string' || !path.isAbsolute(home) || home.includes('\0')
      || home.split(path.sep).some(part => part === '.' || part === '..')) {
      throw new VisualMaterialError(500, 'CONFIG_INVALID', 'A physical absolute DSH_HOME is required for the visual material library.')
    }
    this.home = path.resolve(home)
    this.limits = visualMaterialLimits(options.limits)
    this.validator = options.validatePng ?? validateVisualMaterialPng
    if (typeof constants.O_NOFOLLOW !== 'number' || typeof constants.O_DIRECTORY !== 'number' || typeof process.getuid !== 'function') unsafe()
  }

  private async directory(physical: string, anchored: string, privateDirectory: boolean): Promise<Directory> {
    const before = await lstat(anchored)
    if (!before.isDirectory() || before.isSymbolicLink() || privateDirectory && ((before.mode & 0o077) !== 0 || before.uid !== process.getuid!())) unsafe()
    let handle: FileHandle
    try { handle = await open(anchored, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY) }
    catch (error) { if (['ELOOP', 'ENOTDIR'].includes(codeOf(error) ?? '')) unsafe(); throw error }
    try {
      const current = await handle.stat()
      if (!current.isDirectory() || !sameFile(before, current)) unsafe()
      return { handle, physical, anchored: process.platform === 'linux' ? `/proc/self/fd/${handle.fd}` : physical }
    } catch (error) { await handle.close(); throw error }
  }
  private async recheck(dir: Directory): Promise<void> {
    const physical = await lstat(dir.physical), held = await dir.handle.stat()
    if (!physical.isDirectory() || physical.isSymbolicLink() || !sameFile(physical, held)) unsafe()
  }
  private async withDirectories<T>(parts: readonly string[], create: boolean, action: (dir: Directory) => Promise<T>): Promise<T> {
    const dirs: Directory[] = []
    try {
      // Walk the physical home without following links before entering the private boundary.
      let physical = path.parse(this.home).root
      let dir = await this.directory(physical, physical, false); dirs.push(dir)
      for (const part of this.home.slice(physical.length).split(path.sep).filter(Boolean)) {
        physical = path.join(physical, part)
        dir = await this.directory(physical, path.join(dir.anchored, part), false); dirs.push(dir)
      }
      const homeStat = await dir.handle.stat()
      if (homeStat.uid !== process.getuid!() || (homeStat.mode & 0o022) !== 0) unsafe()
      for (const part of ['visual-materials', ...parts]) {
        if (!/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..') unsafe()
        const anchored = path.join(dir.anchored, part)
        physical = path.join(physical, part)
        if (create) {
          try { await mkdir(anchored, { mode: 0o700 }); await dir.handle.sync() }
          catch (error) { if (codeOf(error) !== 'EEXIST') throw error }
        }
        await this.recheck(dir)
        dir = await this.directory(physical, anchored, true); dirs.push(dir)
      }
      for (const held of dirs) await this.recheck(held)
      const result = await action(dir)
      for (const held of dirs) await this.recheck(held)
      return result
    } finally { for (const dir of dirs.reverse()) await dir.handle.close() }
  }

  private async locked<T>(key: string, action: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(key) ?? Promise.resolve()
    let release!: () => void
    const done = new Promise<void>(resolve => { release = resolve })
    const queued = prior.then(() => done)
    this.locks.set(key, queued)
    await prior
    try { return await action() }
    finally { release(); if (this.locks.get(key) === queued) this.locks.delete(key) }
  }
  private requireInitialized(): void {
    if (!this.initialized) throw new VisualMaterialError(503, 'LIBRARY_UNAVAILABLE', 'Visual material storage has not initialized.')
  }
  async initialize(): Promise<void> {
    await this.withDirectories(['_stages'], true, async () => {})
    this.initialized = true
    try { await this.cursorKey() } catch (error) { this.initialized = false; throw error }
  }

  private async boundedRead(filename: string, length: number): Promise<Buffer> {
    if (!Number.isSafeInteger(length) || length < 1 || length > this.limits.maxImageBytes) unsafe()
    let file: FileHandle
    try { file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) }
    catch (error) { if (codeOf(error) === 'ELOOP') unsafe(); throw error }
    try {
      const before = await file.stat()
      if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid!() || (before.mode & 0o077) !== 0 || before.size !== length) unsafe()
      const bytes = Buffer.alloc(length + 1)
      let offset = 0
      for (;;) {
        const read = await file.read(bytes, offset, bytes.length - offset, offset)
        offset += read.bytesRead
        if (!read.bytesRead || offset === bytes.length) break
      }
      const after = await file.stat()
      if (!sameFile(before, after) || after.nlink !== 1 || after.size !== length || offset !== length
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) unsafe()
      return bytes.subarray(0, length)
    } finally { await file.close() }
  }
  private async writeExclusive(filename: string, bytes: Buffer): Promise<void> {
    const file = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try {
      const opened = await file.stat()
      if (!opened.isFile() || opened.nlink !== 1 || opened.uid !== process.getuid!() || (opened.mode & 0o077) !== 0) unsafe()
      await file.writeFile(bytes)
      await file.sync()
      const after = await file.stat()
      if (!sameFile(opened, after) || after.nlink !== 1 || after.size !== bytes.length) unsafe()
    } finally { await file.close() }
  }
  async cursorKey(): Promise<Buffer> {
    this.requireInitialized()
    return this.locked('cursor-key', () => this.withDirectories([], false, async dir => {
      const filename = path.join(dir.anchored, '_cursor-key')
      try { return await this.boundedRead(filename, 32) }
      catch (error) { if (codeOf(error) !== 'ENOENT') throw error }
      const bytes = randomBytes(32)
      await this.writeExclusive(filename, bytes)
      await dir.handle.sync()
      return this.boundedRead(filename, 32)
    }))
  }
  private blobParts(record: VisualMaterialRecord): readonly string[] {
    visualMaterialId(record.id); visualMaterialSha(record.sha256)
    return ['owners', visualMaterialDigest(Buffer.from(record.ownerKey)), record.sha256.slice(0, 2)]
  }
  private verify(record: VisualMaterialRecord, bytes: Buffer): void {
    if (bytes.length !== record.byteLength || bytes.length > this.limits.maxImageBytes || visualMaterialDigest(bytes) !== record.sha256) {
      throw new VisualMaterialError(503, 'BLOB_INTEGRITY', 'Visual material bytes failed integrity verification.')
    }
    const decoded = this.validator(bytes)
    if (decoded.width !== record.width || decoded.height !== record.height) {
      throw new VisualMaterialError(503, 'BLOB_INTEGRITY', 'Visual material dimensions failed integrity verification.')
    }
  }
  private async finalize(record: VisualMaterialRecord, dir: Directory): Promise<void> {
    const filename = path.join(dir.anchored, `${record.sha256}.png`)
    this.verify(record, await this.boundedRead(filename, record.byteLength))
    const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const info = await file.stat()
      if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid!() || (info.mode & 0o077) !== 0 || info.size !== record.byteLength) unsafe()
      await file.chmod(0o400); await file.sync()
    } finally { await file.close() }
    await dir.handle.sync()
  }
  private async cleanStage(record: VisualMaterialRecord): Promise<void> {
    await this.withDirectories(['_stages'], false, async dir => {
      const stage = path.join(dir.anchored, `${record.id}.part`)
      try {
        this.verify(record, await this.boundedRead(stage, record.byteLength))
        await unlink(stage); await dir.handle.sync()
      } catch (error) { if (codeOf(error) !== 'ENOENT') throw error }
    })
  }
  private async available(dir: Directory, stageBytesReserved: number, minimum: number): Promise<void> {
    if (!Number.isSafeInteger(stageBytesReserved) || stageBytesReserved < minimum || stageBytesReserved > this.limits.maxStageBytes) {
      throw new VisualMaterialError(429, 'STAGING_QUOTA', 'Visual material staging quota is exhausted.')
    }
    const space = await statfs(dir.anchored, { bigint: true })
    const available = space.bavail * space.bsize
    if (available < BigInt(VISUAL_MATERIAL_DISK_RESERVE) + BigInt(stageBytesReserved)) {
      throw new VisualMaterialError(507, 'DISK_RESERVE', 'Visual material storage must preserve its disk reserve.')
    }
  }

  async publish(record: VisualMaterialRecord, bytes: Buffer, stageBytesReserved: number, fence: () => void): Promise<void> {
    this.requireInitialized(); fence(); this.verify(record, bytes)
    const key = `${visualMaterialDigest(Buffer.from(record.ownerKey))}:${record.sha256}`
    await this.locked(key, async () => {
      await this.withDirectories(this.blobParts(record), true, async destination => {
        const finalName = path.join(destination.anchored, `${record.sha256}.png`)
        let alreadyPublished = false
        try { this.verify(record, await this.boundedRead(finalName, record.byteLength)); alreadyPublished = true }
        catch (error) { if (codeOf(error) !== 'ENOENT') throw error }
        if (alreadyPublished) {
          await this.finalize(record, destination); await this.cleanStage(record); fence(); return
        }
        await this.withDirectories(['_stages'], false, async stage => {
          fence(); await this.available(stage, stageBytesReserved, record.byteLength)
          const temporary = path.join(stage.anchored, `${record.id}.part`)
          try { const prior = await this.boundedRead(temporary, record.byteLength); this.verify(record, prior) }
          catch (error) {
            if (codeOf(error) !== 'ENOENT') throw error
            await this.writeExclusive(temporary, bytes)
            await stage.handle.sync()
          }
          fence()
          // Rename a completely fsynced, single-link inode inside pinned private directories.
          // No hardlink publication, no truncated final file, no overwrite of an unchecked existing file.
          try {
            const prior = await this.boundedRead(finalName, record.byteLength); this.verify(record, prior)
            await this.finalize(record, destination); await unlink(temporary); await stage.handle.sync(); fence(); return
          } catch (error) { if (codeOf(error) !== 'ENOENT') throw error }
          await this.recheck(stage); await this.recheck(destination); fence()
          await rename(temporary, finalName)
          await this.finalize(record, destination); await stage.handle.sync()
          this.verify(record, await this.boundedRead(finalName, record.byteLength)); fence()
        })
      })
    })
  }

  async recover(record: VisualMaterialRecord, stageBytesReserved: number, fence: () => void): Promise<'durable' | 'missing'> {
    this.requireInitialized(); fence()
    const parts = this.blobParts(record)
    try {
      const final = await this.withDirectories(parts, false, async dir => this.boundedRead(path.join(dir.anchored, `${record.sha256}.png`), record.byteLength))
      this.verify(record, final)
      // A crash after rename but before chmod/directory fsync is finalized here.
      await this.withDirectories(parts, false, dir => this.finalize(record, dir))
      await this.cleanStage(record)
      fence(); return 'durable'
    } catch (error) { if (codeOf(error) !== 'ENOENT') throw error }
    let bytes: Buffer
    try { bytes = await this.withDirectories(['_stages'], false, dir => this.boundedRead(path.join(dir.anchored, `${record.id}.part`), record.byteLength)) }
    catch (error) { if (codeOf(error) === 'ENOENT') return 'missing'; throw error }
    this.verify(record, bytes)
    await this.publish(record, bytes, stageBytesReserved, fence)
    return 'durable'
  }
  async read(record: VisualMaterialRecord, fence: () => void): Promise<Buffer> {
    this.requireInitialized(); fence()
    try {
      const bytes = await this.withDirectories(this.blobParts(record), false,
        dir => this.boundedRead(path.join(dir.anchored, `${record.sha256}.png`), record.byteLength))
      this.verify(record, bytes); fence(); return bytes
    } catch (error) {
      if (codeOf(error) === 'ENOENT') throw new VisualMaterialError(503, 'BLOB_MISSING', 'Retained visual material bytes are unavailable.')
      if (error instanceof VisualMaterialError) throw error
      throw new VisualMaterialError(503, 'BLOB_UNAVAILABLE', 'Private visual material storage is unavailable.', undefined, { cause: error })
    }
  }
}
