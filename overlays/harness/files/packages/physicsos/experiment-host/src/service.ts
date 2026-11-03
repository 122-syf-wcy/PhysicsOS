import crypto from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { ExperimentError, type IdentityActor } from './identity.ts'
import { assetContentType, validateArchive, ZIP_LIMIT, type ValidatedArchive } from './archive.ts'
import type { experimentDomain, ExperimentPackageRecord, ExperimentState } from './domain.ts'
import { prepareRecovery, readRecovery, clearRecovery } from './recovery.ts'

export const ASSET_PREFIX = '/physicsos/experiment-assets'
const embedPath = (raw: string): string => `${ASSET_PREFIX}/embed/${raw.slice(ASSET_PREFIX.length + 1)}`
const sha256 = (bytes: Buffer): string => crypto.createHash('sha256').update(bytes).digest('hex')
const badRequest = (): ExperimentError => new ExperimentError(400, 'BAD_REQUEST', '投稿资料或操作参数不符合要求')
const base64 = /^[A-Za-z0-9+/]*(?:==|=)?$/
const github = /^https:\/\/github\.com\/[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/
const uploadWire = z.object({
  zipBase64: z.string().min(1), author: z.object({ name: z.string().trim().min(1).max(80), bio: z.string().max(300).optional(), github: z.string().regex(github).optional(), avatarDataUrl: z.string().max(350_000).optional() }).strict(), note: z.string().max(500).optional(),
}).strict()
const reviewWire = z.object({ action: z.enum(['approve', 'reject']), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().max(500).optional() }).strict()
const rollbackWire = z.object({ packageId: z.string().min(1), expectedActiveId: z.string().min(1) }).strict()
export interface PackageView {
  id: string; experimentId: 'convex-lens'; version: string; sha256: string; status: 'pending' | 'approved' | 'rejected'
  author: { name: string; bio?: string; github?: string; avatarUrl?: string }; note?: string; createdAt: string
  publishedAt?: string; rejectionReason?: string; entryUrl?: string
}
export interface ExperimentOptions { root: string; assetOrigin?: string; previewTtlMs?: number }
export interface Asset { bytes: Buffer; contentType: string; scopePath: string; immutable: boolean; sha256: string }
function decodeBase64(value: string, limit: number): Buffer {
  if (value.length > Math.ceil(limit / 3) * 4) throw new ExperimentError(413, 'BODY_TOO_LARGE', '文件超过大小限制')
  if (!base64.test(value) || value.length % 4 !== 0) throw badRequest()
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw badRequest()
  if (bytes.length > limit) throw new ExperimentError(413, 'BODY_TOO_LARGE', '文件超过大小限制')
  return bytes
}
function avatarOf(value?: string): { path: string; bytes: Buffer } | undefined {
  if (value === undefined) return undefined
  const parsed = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value)
  if (!parsed) throw badRequest()
  const format = parsed[1], bytes = decodeBase64(parsed[2] ?? '', 256 * 1024)
  const matches = format === 'png' ? bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.subarray(12, 16).toString() === 'IHDR'
    : format === 'jpeg' ? bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217
    : bytes.length >= 16 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
  if (!matches) throw badRequest()
  return { path: `dist/__author-avatar.${format === 'jpeg' ? 'jpg' : format}`, bytes }
}
async function durableFile(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const handle = await open(path, 'wx', 0o400)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
}
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try { await handle.sync() } finally { await handle.close() }
}
/** Read with no symlink following, bounded to the size frozen in metadata. */
async function verifiedFile(path: string, expected: { sha256: string; size?: number }): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024 || (expected.size !== undefined && stat.size !== expected.size)) throw new Error('size')
    const bytes = await handle.readFile()
    if (sha256(bytes) !== expected.sha256) throw new Error('digest')
    return bytes
  } catch { throw new ExperimentError(409, 'INTEGRITY_MISMATCH', '冻结的实验文件校验失败') } finally { await handle.close() }
}
export class ExperimentService {
  private tail: Promise<void> = Promise.resolve()
  private readonly previews = new Map<string, { packageId: string; expires: number }>()
  private readonly root: string
  readonly assetOrigin: string | undefined
  private readonly previewTtlMs: number
  private initialized = false
  private fenced = false
  private currentState: ExperimentState = { packages: [], activeId: null, sequence: 0, releases: [] }
  constructor(private readonly domain: Domain<typeof experimentDomain>, options: ExperimentOptions) {
    this.root = resolve(options.root)
    if (options.assetOrigin !== undefined) {
      const url = new URL(options.assetOrigin)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('assetOrigin must be an HTTP origin')
      this.assetOrigin = url.origin
    }
    this.previewTtlMs = Math.min(15 * 60_000, Math.max(1, options.previewTtlMs ?? 10 * 60_000))
  }
  /** Reconcile an interrupted or ambiguous write before mounting any routes. */
  async initialize(): Promise<void> {
    if (this.initialized && !this.fenced) return
    this.fenced = true
    const previous = await readRecovery(this.root)
    if (previous) {
      await this.domain.table('state').put('convex-lens', previous)
      await clearRecovery(this.root)
    }
    this.currentState = this.domain.table('state').get('convex-lens') ?? { packages: [], activeId: null, sequence: 0, releases: [] }
    this.initialized = true; this.fenced = false
  }
  private state(): ExperimentState {
    if (!this.initialized || this.fenced) throw new ExperimentError(503, 'STATE_UNCERTAIN', '发布存储状态尚未恢复，请稍后重试')
    return this.currentState
  }
  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const next = this.tail.then(() => { this.state(); return job() })
    this.tail = next.then(() => {}, () => {}); return next
  }
  /** A rejected metadata promise can follow its durable rename. Never infer abort from rejection. */
  private async persistState(next: ExperimentState): Promise<void> {
    const previous = this.state()
    try {
      await prepareRecovery(this.root, previous)
      await this.domain.table('state').put('convex-lens', next)
      await clearRecovery(this.root)
      // Reads keep the accepted prior snapshot until journal removal is durable.
      this.currentState = next
    } catch (error) {
      this.fenced = true
      try {
        // Recreate the marker even if an ambiguous journal unlink already happened.
        await prepareRecovery(this.root, previous)
        await this.domain.table('state').put('convex-lens', previous)
        await clearRecovery(this.root)
        this.currentState = previous; this.fenced = false
      } catch {
        // Keep this process fenced and retain finalized bytes. Multiple I/O failures may leave no marker;
        // restart can adopt a valid persisted next state, so callers must refresh canonical versions.
      }
      throw error
    }
  }
  private url(path: string): string { return `${this.assetOrigin ?? ''}${path}` }
  private releasePath(item: ExperimentPackageRecord): string { return `${ASSET_PREFIX}/releases/${item.id}/${item.sha256}/` }
  private view(item: ExperimentPackageRecord): PackageView {
    const author: PackageView['author'] = { name: item.author.name, ...(item.author.bio === undefined ? {} : { bio: item.author.bio }), ...(item.author.github === undefined ? {} : { github: item.author.github }) }
    if (author.github) author.avatarUrl = `${author.github}.png?size=128`
    else if (item.avatarPath && item.status === 'approved') author.avatarUrl = this.url(`${this.releasePath(item)}${item.avatarPath}`)
    return { id: item.id, experimentId: item.experimentId, version: item.version, sha256: item.sha256, status: item.status, author, createdAt: item.createdAt,
      ...(item.note === undefined ? {} : { note: item.note }), ...(item.publishedAt === undefined ? {} : { publishedAt: item.publishedAt }),
      ...(item.rejectionReason === undefined ? {} : { rejectionReason: item.rejectionReason }), ...(item.status === 'approved' ? { entryUrl: this.url(embedPath(`${this.releasePath(item)}${item.entry}`)) } : {}) }
  }
  private record(packageId: string): ExperimentPackageRecord {
    const item = this.state().packages.find(row => row.id === packageId)
    if (!item) throw new ExperimentError(404, 'NOT_FOUND', '实验包不存在')
    return item
  }
  private requireAdmin(actor: IdentityActor): void { if (actor.role !== 'SUPER_ADMIN') throw new ExperimentError(403, 'FORBIDDEN', '只有平台管理员可以审核或回滚') }
  list(actor: IdentityActor): { active: PackageView | null; items: PackageView[]; canReview: boolean } {
    const state = this.state(), active = state.packages.find(item => item.id === state.activeId && item.status === 'approved')
    return { active: active ? this.view(active) : null, items: state.packages.filter(item => actor.role === 'SUPER_ADMIN' || item.status === 'approved' || item.authorKey === actor.userKey).slice().reverse().map(item => this.view(item)), canReview: actor.role === 'SUPER_ADMIN' }
  }
  async upload(actor: IdentityActor, body: unknown): Promise<PackageView> {
    this.state()
    const parsed = uploadWire.safeParse(body)
    if (!parsed.success) throw badRequest()
    const input = parsed.data
    const archive = decodeBase64(input.zipBase64, ZIP_LIMIT), avatar = avatarOf(input.author.avatarDataUrl)
    return this.serialize(async () => {
      const validated = await validateArchive(archive)
      if (avatar) { if (validated.assets.has(avatar.path)) throw badRequest(); validated.assets.set(avatar.path, avatar.bytes) }
      const id = `exp_${crypto.randomBytes(16).toString('hex')}`, digest = sha256(archive)
      const stage = join(this.root, `.staging-${id}`), final = join(this.root, id)
      let frozen = false
      try {
        await mkdir(this.root, { recursive: true, mode: 0o700 })
        await syncDirectory(dirname(this.root))
        await mkdir(stage, { recursive: true, mode: 0o700 })
        await durableFile(join(stage, 'archive.zip'), archive)
        for (const [name, bytes] of validated.assets) await durableFile(join(stage, name), bytes)
        // Sync every directory whose entry set changed before publishing the root rename.
        const dirs = new Set([stage])
        for (const name of validated.assets.keys()) {
          let directory = dirname(join(stage, name))
          while (directory !== stage) { dirs.add(directory); directory = dirname(directory) }
        }
        for (const directory of [...dirs].sort((a, b) => b.length - a.length)) await syncDirectory(directory)
        await rename(stage, final); frozen = true; await syncDirectory(this.root)
        const item: ExperimentPackageRecord = { id, experimentId: 'convex-lens', version: validated.manifest.version, sha256: digest,
          authorKey: actor.userKey, author: { name: input.author.name, ...(input.author.bio === undefined ? {} : { bio: input.author.bio }), ...(input.author.github === undefined ? {} : { github: input.author.github }) },
          ...(input.note === undefined ? {} : { note: input.note }), ...(avatar === undefined ? {} : { avatarPath: avatar.path }),
          status: 'pending', entry: 'dist/index.html', createdAt: new Date().toISOString(),
          assets: [...validated.assets].map(([name, bytes]) => ({ name, sha256: sha256(bytes), size: bytes.length, contentType: assetContentType(name)! })) }
        const current = this.state()
        await this.persistState({ ...current, packages: [...current.packages, item] })
        return this.view(item)
      } catch (error) {
        // A finalized directory may already be referenced by renamed metadata, even after rejection.
        if (!frozen) await rm(stage, { force: true, recursive: true }).catch(() => {})
        throw error
      }
    })
  }
  private async verify(item: ExperimentPackageRecord): Promise<void> {
    try {
      const archive = await verifiedFile(join(this.root, item.id, 'archive.zip'), { sha256: item.sha256 })
      const validated: ValidatedArchive = await validateArchive(archive)
      if (validated.manifest.version !== item.version) throw new Error('manifest')
      for (const asset of item.assets) await verifiedFile(join(this.root, item.id, asset.name), asset)
    } catch { throw new ExperimentError(409, 'INTEGRITY_MISMATCH', '冻结的实验文件校验失败') }
  }
  async preview(actor: IdentityActor, packageId: string): Promise<{ entryUrl: string }> {
    const item = this.record(packageId)
    if (actor.role !== 'SUPER_ADMIN' && item.authorKey !== actor.userKey) throw new ExperimentError(403, 'FORBIDDEN', '无权预览此实验包')
    await this.verify(item)
    if (item.status === 'approved') return { entryUrl: this.url(embedPath(`${this.releasePath(item)}${item.entry}`)) }
    for (const [token, preview] of this.previews) if (preview.expires <= Date.now()) this.previews.delete(token)
    const token = crypto.randomBytes(32).toString('hex')
    this.previews.set(token, { packageId: item.id, expires: Date.now() + this.previewTtlMs })
    return { entryUrl: this.url(embedPath(`${ASSET_PREFIX}/preview/${token}/${item.entry}`)) }
  }
  async review(actor: IdentityActor, packageId: string, body: unknown): Promise<PackageView> {
    this.requireAdmin(actor)
    const input = reviewWire.safeParse(body)
    if (!input.success) throw badRequest()
    return this.serialize(async () => {
      const item = this.record(packageId)
      if (item.status !== 'pending' || item.sha256 !== input.data.expectedSha256) throw new ExperimentError(409, 'VERSION_CONFLICT', '摘要或审核状态已改变')
      const now = new Date().toISOString(), current = this.state()
      if (input.data.action === 'reject') {
        const updated: ExperimentPackageRecord = { ...item, status: 'rejected', ...(input.data.reason === undefined ? {} : { rejectionReason: input.data.reason }) }
        await this.persistState({ ...current, packages: current.packages.map(row => row.id === item.id ? updated : row) })
        return this.view(updated)
      }
      await this.verify(item)
      const updated: ExperimentPackageRecord = { ...item, status: 'approved', publishedAt: now }
      const sequence = current.sequence + 1
      await this.persistState({ packages: current.packages.map(row => row.id === item.id ? updated : row), activeId: item.id, sequence,
        releases: [...current.releases, { sequence, packageId: item.id, action: 'approve', actorKey: actor.userKey, createdAt: now }] })
      return this.view(updated)
    })
  }
  async rollback(actor: IdentityActor, body: unknown): Promise<PackageView> {
    this.requireAdmin(actor)
    const input = rollbackWire.safeParse(body)
    if (!input.success) throw badRequest()
    return this.serialize(async () => {
      const current = this.state(), item = this.record(input.data.packageId)
      if (current.activeId !== input.data.expectedActiveId || item.status !== 'approved' || !current.releases.some(release => release.packageId === item.id)) throw new ExperimentError(409, 'VERSION_CONFLICT', '默认版本已改变或目标未发布')
      await this.verify(item)
      const sequence = current.sequence + 1
      await this.persistState({ ...current, activeId: item.id, sequence,
        releases: [...current.releases, { sequence, packageId: item.id, action: 'rollback', actorKey: actor.userKey, createdAt: new Date().toISOString() }] })
      return this.view(item)
    })
  }
  async asset(url: URL): Promise<Asset | null> {
    const match = /^\/physicsos\/experiment-assets\/(?:releases\/(exp_[a-f0-9]{32})\/([a-f0-9]{64})|preview\/([a-f0-9]{64}))\/(dist\/[a-zA-Z0-9_./-]+)$/.exec(url.pathname)
    if (!match) return null
    let item: ExperimentPackageRecord | undefined, scopePath: string
    const name = match[4]
    if (!name) return null
    if (match[3]) {
      const capability = this.previews.get(match[3])
      if (!capability || capability.expires <= Date.now()) { this.previews.delete(match[3]); return null }
      item = this.state().packages.find(row => row.id === capability.packageId)
      scopePath = `${ASSET_PREFIX}/preview/${match[3]}/`
    } else {
      item = this.state().packages.find(row => row.id === match[1] && row.sha256 === match[2] && row.status === 'approved')
      scopePath = `${ASSET_PREFIX}/releases/${match[1]}/${match[2]}/`
    }
    const asset = item?.assets.find(asset => asset.name === name)
    if (!item || !asset) return null
    try { return { bytes: await verifiedFile(join(this.root, item.id, name), asset), contentType: asset.contentType, scopePath, immutable: !match[3], sha256: asset.sha256 } }
    catch { return null }
  }
  /** Drain writes before the plugin closes its storage unit. */
  async close(): Promise<void> { await this.tail; this.previews.clear() }
}
