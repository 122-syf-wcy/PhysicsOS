/** Private immutable mobile checkpoints; no file path or digest is a public authorization grant. */
import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, rmdir, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { LearningError, type IdentityActor } from './identity.ts'

export const MOBILE_CHECKPOINT_BYTES = 8 * 1024 * 1024
const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')
const missing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT'

export interface CheckpointReference { readonly digest: string; readonly bytes: number }

/** A learning-host-owned file store, independent of Canvas document files and public assets. */
export class CheckpointStore {
  private readonly root: string
  constructor(root: string) { this.root = resolve(root) }

  private owner(actor: Pick<IdentityActor, 'userKey' | 'schoolId'>): string {
    return join(this.root, hash(JSON.stringify([actor.schoolId, actor.userKey])))
  }

  private async directory(path: string): Promise<void> {
    const parent = dirname(path)
    if (parent !== path) {
      try {
        const info = await lstat(parent)
        if (!info.isDirectory() || info.isSymbolicLink()) throw new LearningError(503, 'UNSAFE_STORAGE', 'Checkpoint parent is not a real directory.')
      } catch (error) {
        if (!missing(error)) throw error
        await this.directory(parent)
      }
    }
    await mkdir(path, { recursive: false, mode: 0o700 }).catch(error => {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    })
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new LearningError(503, 'UNSAFE_STORAGE', 'Checkpoint storage must not contain symbolic links.')
    if (path === this.root || path.startsWith(`${this.root}/`)) {
      if ((info.mode & 0o077) !== 0 || (process.getuid !== undefined && info.uid !== process.getuid())) {
        throw new LearningError(503, 'UNSAFE_STORAGE', 'Checkpoint storage must be owner-private (0700).')
      }
    }
  }

  async initialize(): Promise<void> { await this.directory(this.root) }

  private async sync(path: string): Promise<void> {
    const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try { await handle.sync() } finally { await handle.close() }
  }

  /** Persist exact validated JSON before publishing its reference in the learning row. */
  async save(actor: IdentityActor, checkpoint: Readonly<Record<string, unknown>>): Promise<CheckpointReference> {
    const bytes = Buffer.from(JSON.stringify(checkpoint))
    if (bytes.length > MOBILE_CHECKPOINT_BYTES) throw new LearningError(413, 'CHECKPOINT_TOO_LARGE', '完整检查点最多 8 MiB，未截断历史。')
    const digest = hash(bytes)
    const owner = this.owner(actor)
    await this.directory(owner)
    const path = join(owner, `${digest}.json`)
    try {
      await lstat(path)
      await this.read(actor, { digest, bytes: bytes.length })
      return { digest, bytes: bytes.length }
    } catch (error) { if (!missing(error)) throw error }
    const temporary = join(owner, `.upload-${randomBytes(16).toString('hex')}`)
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally { await handle.close() }
    try {
      await rename(temporary, path)
      await this.sync(owner)
      await this.sync(this.root)
    } catch (error) {
      await unlink(temporary).catch(cleanup => { if (!missing(cleanup)) throw cleanup })
      throw error
    }
    return { digest, bytes: bytes.length }
  }

  /** Reads verify the complete file, its ownership, length and SHA-256 before JSON decoding. */
  async read(actor: IdentityActor, reference: CheckpointReference): Promise<Record<string, unknown>> {
    if (!/^[a-f0-9]{64}$/.test(reference.digest) || reference.bytes > MOBILE_CHECKPOINT_BYTES) throw new LearningError(503, 'CHECKPOINT_CORRUPT', '检查点引用无效')
    const owner = this.owner(actor)
    await this.directory(owner)
    const file = await open(join(owner, `${reference.digest}.json`), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size !== reference.bytes || (stat.mode & 0o077) !== 0) throw new LearningError(503, 'CHECKPOINT_CORRUPT', '检查点大小或权限异常')
      const bytes = await file.readFile()
      if (hash(bytes) !== reference.digest) throw new LearningError(503, 'CHECKPOINT_CORRUPT', '检查点校验失败')
      const value: unknown = JSON.parse(bytes.toString('utf8'))
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new LearningError(503, 'CHECKPOINT_CORRUPT', '检查点不是对象')
      return value as Record<string, unknown>
    } finally { await file.close() }
  }

  /** Collect unreachable immutable checkpoints only while the learning service holds its account queue. */
  async collect(actor: IdentityActor, retained: ReadonlySet<string>): Promise<void> {
    const path = this.owner(actor)
    try { await lstat(path) } catch (error) { if (missing(error)) return; throw error }
    await this.directory(path)
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()) throw new LearningError(503, 'UNSAFE_STORAGE', '检查点目录含非预期文件')
      const match = /^([a-f0-9]{64})\.json$/.exec(entry.name)
      if (match !== null && !retained.has(match[1]!)) await unlink(join(path, entry.name))
      else if (/^\.upload-[a-f0-9]{32}$/.test(entry.name)) await unlink(join(path, entry.name))
    }
    await this.sync(path)
  }

  /** Removes all account bytes, including unpublished crash leftovers; the caller holds its account queue. */
  async erase(actor: IdentityActor): Promise<void> {
    const path = this.owner(actor)
    try { await lstat(path) } catch (error) { if (missing(error)) return; throw error }
    await this.directory(path)
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || !entry.isFile() || !/^(?:[a-f0-9]{64}\.json|\.upload-[a-f0-9]{32})$/.test(entry.name)) {
        throw new LearningError(503, 'UNSAFE_STORAGE', '检查点目录含非预期文件，删除未完成')
      }
      await unlink(join(path, entry.name))
    }
    await this.sync(path)
    await rmdir(path)
    await this.sync(this.root)
  }
}
