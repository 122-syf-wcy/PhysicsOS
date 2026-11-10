/** Linux descriptor-anchored filesystem operations for managed, private erasure roots. */

import { randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, rmdir, unlink } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { isAbsolute, parse, resolve } from 'node:path'

/** Stable, path-free failure returned by local erasure primitives. */
export class LocalErasureError extends Error {
  constructor(readonly code: 'ERASURE_UNAVAILABLE' | 'ERASURE_UNSAFE_PATH' | 'ERASURE_BUSY' | 'ERASURE_STORAGE_FAILED') {
    super(code)
    this.name = 'LocalErasureError'
  }
}

/**
 * Identify an absent filesystem entry without treating permissions or I/O failure as absence.
 * @param error - filesystem operation failure.
 * @returns whether the entry is definitely absent.
 */
export function erasureEntryMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function segment(name: string): void {
  if (name === '' || name === '.' || name === '..' || /[/\\\0]/u.test(name)) {
    throw new LocalErasureError('ERASURE_UNSAFE_PATH')
  }
}

function directoryFlags(): number {
  if (process.platform !== 'linux') throw new LocalErasureError('ERASURE_UNAVAILABLE')
  return constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
}

function anchored(handle: FileHandle, name?: string): string {
  if (name !== undefined) segment(name)
  return `/proc/self/fd/${handle.fd}${name === undefined ? '' : `/${name}`}`
}

async function missingOrThrow<T>(operation: () => Promise<T>): Promise<T | undefined> {
  try {
    return await operation()
  } catch (error: unknown) {
    if (erasureEntryMissing(error)) return undefined
    throw error
  }
}

/**
 * A pinned directory descriptor. Child operations never resolve an untrusted ancestor again.
 * Only Linux exposes the required descriptor-relative namespace through procfs; other hosts fail closed.
 */
export class ErasureDirectory implements AsyncDisposable {
  private constructor(private readonly handle: FileHandle) {}

  /**
   * Open a configured root, rejecting symlinks in every component, including the root itself.
   * @param path - absolute, deployment-owned root, never a user-supplied cwd.
   * @param create - create missing private components and fsync their parent entries.
   * @returns the pinned root, or undefined for a definitely absent root when creation is disabled.
   */
  static async open(path: string, create = false): Promise<ErasureDirectory | undefined> {
    const flags = directoryFlags()
    if (!isAbsolute(path) || path.includes('\0') || resolve(path) === parse(path).root) {
      throw new LocalErasureError('ERASURE_UNSAFE_PATH')
    }
    let current = new ErasureDirectory(await open(parse(path).root, flags))
    try {
      for (const name of resolve(path).slice(parse(path).root.length).split('/')) {
        const next = await current.child(name, create)
        if (next === undefined) {
          await current.close()
          return undefined
        }
        await current.close()
        current = next
      }
      const metadata = await current.handle.stat()
      if ((metadata.mode & 0o022) !== 0) throw new LocalErasureError('ERASURE_UNSAFE_PATH')
      // Opening procfs through the descriptor also rejects hosts without the required mount.
      await readdir(anchored(current.handle))
      return current
    } catch (error: unknown) {
      await current.close()
      throw error
    }
  }

  /**
   * Open one actual child directory without following a symlink or junction.
   * @param name - single provider-owned leaf component.
   * @param create - create a missing child with owner-only permissions.
   * @returns a separately owned child descriptor, or undefined when absent.
   */
  async child(name: string, create = false): Promise<ErasureDirectory | undefined> {
    const path = anchored(this.handle, name)
    if (create) {
      try {
        await mkdir(path, { mode: 0o700 })
      } catch (error: unknown) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      }
      await this.handle.sync()
    }
    const handle = await missingOrThrow(() => open(path, directoryFlags()))
    return handle === undefined ? undefined : new ErasureDirectory(handle)
  }

  /**
   * List this pinned directory without following child links.
   * @returns the actual immediate child names and their entry types.
   */
  entries(): Promise<string[]> {
    return readdir(anchored(this.handle))
  }

  /**
   * Inspect one leaf without following its target.
   * @param name - provider-owned leaf name.
   * @returns lstat metadata, or undefined when absent.
   */
  stat(name: string): Promise<Stats | undefined> {
    return missingOrThrow(() => lstat(anchored(this.handle, name)))
  }

  /**
   * Read one regular file through an O_NOFOLLOW descriptor.
   * @param name - provider-owned leaf name.
   * @returns exact bytes, or undefined when absent.
   */
  async read(name: string): Promise<Buffer | undefined> {
    const handle = await missingOrThrow(() => open(anchored(this.handle, name), constants.O_RDONLY | constants.O_NOFOLLOW))
    if (handle === undefined) return undefined
    try {
      if (!(await handle.stat()).isFile()) throw new LocalErasureError('ERASURE_UNSAFE_PATH')
      return await handle.readFile()
    } finally {
      await handle.close()
    }
  }

  /**
   * Replace a private metadata file atomically, syncing both bytes and its directory entry.
   * @param name - provider-owned metadata filename.
   * @param value - serializable metadata; no secrets or transcript text.
   */
  async writeJson(name: string, value: unknown): Promise<void> {
    const destination = anchored(this.handle, name)
    const temporary = anchored(this.handle, `.erasure-${randomUUID()}.tmp`)
    try {
      const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
      try {
        await file.writeFile(`${JSON.stringify(value)}\n`)
        await file.sync()
      } finally {
        await file.close()
      }
      const existing = await this.stat(name)
      if (existing !== undefined && !existing.isFile()) throw new LocalErasureError('ERASURE_UNSAFE_PATH')
      await rename(temporary, destination)
      await this.handle.sync()
    } finally {
      await missingOrThrow(() => unlink(temporary))
    }
  }

  /**
   * Remove a known file or link, never a directory or a link's target.
   * @param name - provider-owned leaf name.
   */
  async removeFile(name: string): Promise<void> {
    const metadata = await this.stat(name)
    if (metadata === undefined) {
      await this.handle.sync()
      return
    }
    if (!metadata.isFile() && !metadata.isSymbolicLink()) throw new LocalErasureError('ERASURE_UNSAFE_PATH')
    await missingOrThrow(() => unlink(anchored(this.handle, name)))
    await this.handle.sync()
  }

  /**
   * Remove a managed child tree using pinned directory descriptors; links are unlinked, not traversed.
   * @param name - validated private child leaf, never the configured root itself.
   */
  async removeTree(name: string): Promise<void> {
    const metadata = await this.stat(name)
    if (metadata === undefined) {
      await this.handle.sync()
      return
    }
    if (metadata.isFile() || metadata.isSymbolicLink()) {
      await this.removeFile(name)
      return
    }
    if (!metadata.isDirectory()) throw new LocalErasureError('ERASURE_UNSAFE_PATH')
    const child = await this.child(name)
    if (child === undefined) return
    try {
      const opened = await child.handle.stat()
      if (opened.ino !== metadata.ino || opened.dev !== metadata.dev) throw new LocalErasureError('ERASURE_BUSY')
      for (const entry of await child.entries()) await child.removeTree(entry)
      const current = await this.stat(name)
      if (current === undefined || current.ino !== opened.ino || current.dev !== opened.dev) {
        throw new LocalErasureError('ERASURE_BUSY')
      }
      // rmdir does not follow a replacement symlink and refuses a concurrently populated directory.
      await rmdir(anchored(this.handle, name))
      await this.handle.sync()
    } finally {
      await child.close()
    }
  }

  /**
   * Obtain a descriptor-relative filename for a kernel-lock operation while this directory stays open.
   * @param name - optional single leaf name.
   * @returns process-local descriptor path; never persist, log, or expose it to a remote client.
   */
  handlePath(name?: string): string {
    return anchored(this.handle, name)
  }

  /** Fsync this pinned directory after a caller-owned namespace operation. */
  sync(): Promise<void> {
    return this.handle.sync()
  }

  /** Release the pinned descriptor. */
  close(): Promise<void> {
    return this.handle.close()
  }

  /** Release the pinned descriptor at the end of an await-using scope. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }
}
