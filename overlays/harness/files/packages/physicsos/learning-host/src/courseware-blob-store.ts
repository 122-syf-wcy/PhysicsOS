import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, link, lstat, mkdir, open, readdir, statfs, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { CoursewareError, type CoursewareBlobRef, type CoursewareOwner } from './courseware-types.ts'

export const coursewareHash = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
export const coursewareKey = (...parts: readonly string[]): string => coursewareHash(JSON.stringify(parts))
const isCode = (error: unknown, code: string): boolean => error instanceof Error && 'code' in error && error.code === code
export interface CoursewareBlobScope extends CoursewareOwner { readonly deckId: string }
export interface CoursewareBlobs {
  initialize(readOnly?: boolean, minFreeBytes?: number): Promise<void>
  freeBytes(): Promise<number>
  publish(scope: CoursewareBlobScope, bytes: Uint8Array, maxBytes: number, minFreeBytes: number, signal?: AbortSignal): Promise<CoursewareBlobRef>
  read(scope: CoursewareBlobScope, ref: CoursewareBlobRef, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array>
  remove(scope: CoursewareBlobScope, digest: string): Promise<void>
  close(): Promise<void>
}
/** Separate private immutable store. Neither an upload directory nor a public web-server static root. */
export class CoursewareBlobStore implements CoursewareBlobs {
  readonly root: string
  private readonly home: string
  private readonly pending = new Set<Promise<unknown>>()
  private closing = false
  constructor(root: string) {
    this.root = resolve(root); this.home = dirname(dirname(dirname(this.root)))
    if (join(this.home, 'physicsos', 'courseware', 'v1') !== this.root) throw new Error('Courseware root must be <DSH_HOME>/physicsos/courseware/v1')
  }
  private async directory(path: string, create: boolean, readOnly = false): Promise<void> {
    const relative = path.slice(this.home.length)
    if (path !== this.home && !relative.startsWith('/')) throw new CoursewareError(503, 'UNSAFE_STORAGE', '课件存储路径不安全。')
    const paths: string[] = []; let current = path
    for (;;) { paths.unshift(current); if (current === this.home) break; const parent = dirname(current); if (parent === current) throw new CoursewareError(503, 'UNSAFE_STORAGE', '课件存储路径不安全。'); current = parent }
    for (const directory of paths) {
      if (create) { try { await mkdir(directory, { mode: 0o700 }) } catch (error) { if (!isCode(error, 'EEXIST')) throw error } }
      const info = await lstat(directory)
      if (!info.isDirectory() || info.isSymbolicLink() || typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new CoursewareError(503, 'UNSAFE_STORAGE', '课件存储必须是应用账号所有的私有目录。')
      // The DSH home may be a shared application mount; never chmod an ancestor outside this store.
      if (directory !== this.home && (info.mode & 0o077)) {
        if (readOnly) throw new CoursewareError(503, 'UNSAFE_STORAGE', '只读课件目录权限不是私有；兼容模式不会自动修改磁盘。')
        await chmod(directory, 0o700)
      }
    }
  }
  private async syncDirectory(path: string): Promise<void> {
    const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try { await handle.sync() } finally { await handle.close() }
  }
  private async syncAncestors(path: string): Promise<void> {
    let current = path
    for (;;) { await this.syncDirectory(current); if (current === this.home) return; current = dirname(current) }
  }
  private path(scope: CoursewareBlobScope, digest: string): string {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new CoursewareError(400, 'BAD_DIGEST', '课件摘要无效。')
    return join(this.root, coursewareKey(scope.schoolId, scope.userKey), coursewareKey(scope.deckId), digest)
  }
  private track<T>(fn: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new CoursewareError(503, 'CLOSED', '课件存储正在关闭。'))
    const result = fn(); this.pending.add(result)
    void result.then(() => this.pending.delete(result), () => this.pending.delete(result))
    return result
  }
  initialize(readOnly = false, minFreeBytes = 256 * 1024 * 1024): Promise<void> {
    return this.track(async () => {
      if (readOnly) {
        try { await this.directory(this.root, false, true) } catch (error) { if (!isCode(error, 'ENOENT')) throw error }
        return
      }
      const space = await statfs(this.home)
      if (space.bavail * space.bsize < minFreeBytes) throw new CoursewareError(507, 'DISK_RESERVE', '课件存储低于安全空闲空间；未创建目录或清理文件。')
      await this.directory(this.root, true)
      const staging = join(this.root, 'staging'); await this.directory(staging, true)
      for (const entry of await readdir(staging, { withFileTypes: true })) {
        if (!/^part-[a-f0-9-]{36}$/.test(entry.name) || !entry.isFile() || entry.isSymbolicLink()) throw new CoursewareError(503, 'UNSAFE_STORAGE', '课件临时目录含有未知文件。')
        const info = await lstat(join(staging, entry.name))
        if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new CoursewareError(503, 'UNSAFE_STORAGE', '课件临时文件所有者无效。')
        await unlink(join(staging, entry.name))
      }
      await this.syncAncestors(staging)
    })
  }
  async freeBytes(): Promise<number> {
    const info = await statfs(this.root)
    return info.bavail * info.bsize
  }
  publish(scope: CoursewareBlobScope, bytes: Uint8Array, maxBytes: number, minFreeBytes: number, signal?: AbortSignal): Promise<CoursewareBlobRef> {
    return this.track(async () => {
      signal?.throwIfAborted()
      if (!bytes.byteLength || bytes.byteLength > maxBytes) throw new CoursewareError(413, 'BLOB_LIMIT', '完整课件或批注超过大小限制，未截断任何数据。')
      const ref = { digest: coursewareHash(bytes), bytes: bytes.byteLength }; const path = this.path(scope, ref.digest)
      await this.directory(dirname(path), true)
      try { await this.readFile(path, ref, maxBytes); return ref } catch (error) { if (!isCode(error, 'ENOENT')) throw error }
      if (await this.freeBytes() - bytes.byteLength < minFreeBytes) throw new CoursewareError(507, 'DISK_RESERVE', '服务器可用空间不足，已保留安全余量；课件未发布。')
      const staging = join(this.root, 'staging'); await this.directory(staging, true)
      const temporary = join(staging, `part-${randomUUID()}`)
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try {
        let offset = 0
        while (offset < bytes.byteLength) { signal?.throwIfAborted(); const written = await handle.write(bytes, offset, bytes.byteLength - offset, offset); if (!written.bytesWritten) throw new CoursewareError(503, 'BLOB_WRITE', '课件文件未完整写入。'); offset += written.bytesWritten }
        await handle.sync(); signal?.throwIfAborted()
        try { await link(temporary, path) } catch (error) { if (!isCode(error, 'EEXIST')) throw error }
        await this.readFile(path, ref, maxBytes)
        await this.syncAncestors(dirname(path))
        return ref
      } finally {
        await handle.close()
        await unlink(temporary).catch(error => { if (!isCode(error, 'ENOENT')) throw error })
        await this.syncDirectory(staging)
      }
    })
  }
  private async readFile(path: string, ref: CoursewareBlobRef, maxBytes: number): Promise<Uint8Array> {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size !== ref.bytes || info.size > maxBytes || typeof process.getuid === 'function' && info.uid !== process.getuid() || (info.mode & 0o077) !== 0) throw new CoursewareError(503, 'BLOB_INTEGRITY', '课件文件完整性或私有权限校验失败。')
      const bytes = await handle.readFile()
      if (bytes.byteLength !== ref.bytes || coursewareHash(bytes) !== ref.digest) throw new CoursewareError(503, 'BLOB_INTEGRITY', '课件摘要校验失败。')
      return bytes
    } finally { await handle.close() }
  }
  read(scope: CoursewareBlobScope, ref: CoursewareBlobRef, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
    return this.track(async () => { signal?.throwIfAborted(); const path = this.path(scope, ref.digest); await this.directory(dirname(path), false, true); const bytes = await this.readFile(path, ref, maxBytes); signal?.throwIfAborted(); return bytes })
  }
  remove(scope: CoursewareBlobScope, digest: string): Promise<void> {
    return this.track(async () => {
      const path = this.path(scope, digest)
      try { await this.directory(dirname(path), false); const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new CoursewareError(503, 'UNSAFE_STORAGE', '课件文件路径不安全。'); await unlink(path); await this.syncAncestors(dirname(path)) } catch (error) { if (!isCode(error, 'ENOENT')) throw error }
    })
  }
  async close(): Promise<void> { this.closing = true; await Promise.allSettled([...this.pending]) }
}
