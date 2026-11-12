/** Private immutable mobile checkpoints; no file path or digest is a public authorization grant. */
import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, rmdir, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { LearningError, type IdentityActor } from './identity.ts'
import { z } from 'zod'
import { parsePhysicsScene } from '@physicsos/physics-scene'
import { readInstanceSource } from '@physicsos/physics-workbench/codec'
import { canonicalStringify } from '@physicsos/physics-workbench/json'

export const MOBILE_CHECKPOINT_BYTES = 8 * 1024 * 1024
const jsonObject = z.record(z.string(), z.unknown())
const safeRevision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const componentTypes = ['voltage_source', 'switch', 'resistor', 'variable_resistor', 'ammeter', 'voltmeter'] as const
const allowedParams: Record<(typeof componentTypes)[number], readonly string[]> = {
  voltage_source: ['voltage', 'internalResistance'], switch: ['state'], resistor: ['resistance'],
  variable_resistor: ['totalResistance', 'sliderPosition'], ammeter: ['internalResistance'], voltmeter: ['internalResistance'],
}
/** Persisted editing data only: disconnected circuits remain valid; no solve is performed here. */
const draftWire = z.object({
  title: z.string(), description: z.string(), nextNet: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  components: z.array(z.object({
    id: z.string().min(1), type: z.enum(componentTypes), nets: z.record(z.string(), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)),
    placement: z.object({ x: z.number().finite(), y: z.number().finite(), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]) }).strict(),
    params: z.object({ resistance: z.number().positive().optional(), voltage: z.number().finite().optional(),
      internalResistance: z.number().nonnegative().optional(), state: z.enum(['open', 'closed']).optional(),
      totalResistance: z.number().positive().optional(), sliderPosition: z.number().min(0).max(1).optional() }).strict(),
  }).strict()),
}).strict().refine(draft => new Set(draft.components.map(row => row.id)).size === draft.components.length && draft.components.every(row => {
  const terminals = row.type === 'voltage_source' ? ['positive', 'negative'] : ['a', 'b']
  return Object.keys(row.nets).length === terminals.length && terminals.every(key => row.nets[key] !== undefined && row.nets[key]! < draft.nextNet)
    && Object.keys(row.params).every(key => allowedParams[row.type].includes(key))
}))
const historyEntryWire = z.object({
  id: z.string().min(1).max(200), label: z.string().min(1).max(500), before: jsonObject, after: jsonObject,
  beforeDraft: draftWire.optional(), afterDraft: draftWire.optional(),
}).strict()
const checkpointWire = z.object({
  version: z.literal(1), scene: jsonObject, originScene: jsonObject, templateId: z.string().min(1).max(200).optional(),
  playback: z.object({ time: z.number().nonnegative(), duration: z.number().nonnegative(), rate: z.number().positive().max(100), running: z.boolean() }).strict(),
  history: z.object({ past: z.array(historyEntryWire).max(500), future: z.array(historyEntryWire).max(500) }).strict(),
  editing: z.object({
    instanceKey: z.string().min(1).max(256), instanceEditRevision: safeRevision, source: jsonObject,
    buildMode: z.enum(['inspect', 'construct']), draft: draftWire.optional(),
    selectedIds: z.array(z.string().min(1).max(256)).max(256), observables: z.record(z.string(), z.boolean()).refine(value => Object.keys(value).length <= 4096),
    viewport: z.object({ x: z.number().min(-1e7).max(1e7), y: z.number().min(-1e7).max(1e7), zoom: z.number().min(0.25).max(8) }).strict(),
    activePanel: z.enum(['parameters', 'apparatus', 'data', 'guide', 'report']),
  }).strict(),
}).strict()

/** Validate the full native checkpoint using the existing shared PhysicsScene/source decoders. */
export function validateMobileCheckpoint(input: Readonly<Record<string, unknown>>, sceneId?: string,
  scene?: unknown, originScene?: unknown): void {
  let values = 0
  const ancestors = new Set<object>()
  const visit = (value: unknown, depth: number): void => {
    if (depth > 64 || ++values > 400_000) throw new Error('checkpoint complexity')
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return
    if (typeof value === 'number' && Number.isFinite(value)) return
    if (typeof value !== 'object' || ancestors.has(value)) throw new Error('checkpoint JSON')
    ancestors.add(value)
    for (const child of Object.values(value)) visit(child, depth + 1)
    ancestors.delete(value)
  }
  try { visit(input, 0) } catch { throw new LearningError(400, 'CHECKPOINT_INVALID', '检查点必须是有界、有限数值的完整 JSON') }
  if (Buffer.byteLength(JSON.stringify(input)) > MOBILE_CHECKPOINT_BYTES) throw new LearningError(413, 'CHECKPOINT_TOO_LARGE', '完整检查点最多 8 MiB，历史未截断')
  const parsed = checkpointWire.safeParse(input)
  if (!parsed.success) throw new LearningError(400, 'CHECKPOINT_INVALID', '检查点缺少有效场景、播放、编辑状态或完整历史')
  const checkpoint = parsed.data
  const entries = [...checkpoint.history.past, ...checkpoint.history.future]
  if (new Set(entries.map(row => row.id)).size !== entries.length) throw new LearningError(400, 'CHECKPOINT_INVALID', '历史记录标识不能重复')
  try { readInstanceSource(checkpoint.editing.source) } catch { throw new LearningError(400, 'CHECKPOINT_INVALID', '检查点来源无效') }
  for (const snapshot of [checkpoint.scene, checkpoint.originScene, ...entries.flatMap(row => [row.before, row.after])]) {
    if (!parsePhysicsScene(snapshot).ok || (sceneId !== undefined && snapshot['id'] !== sceneId)) {
      throw new LearningError(400, 'CHECKPOINT_INVALID', '检查点及全部历史场景必须有效且属于同一场景标识')
    }
  }
  if ((scene !== undefined && canonicalStringify(scene) !== canonicalStringify(checkpoint.scene))
    || (originScene !== undefined && canonicalStringify(originScene) !== canonicalStringify(checkpoint.originScene))) {
    throw new LearningError(400, 'CHECKPOINT_MISMATCH', '请求场景与检查点中的场景不一致')
  }
}

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
