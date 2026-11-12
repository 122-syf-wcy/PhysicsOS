/** Personal learning rules over the single learning-host domain and account write queue. */
import { createHash } from 'node:crypto'
import { LearningError, type IdentityActor } from './identity.ts'
import {
  attemptKey, attemptWire, savedSceneKey, sceneEntryWire,
  type LearningDomain, type PersonalAttemptRecord, type SavedSceneRecord, type StoredSceneRecord,
  type LearningErasure,
} from './domain.ts'
import { CheckpointStore, MOBILE_CHECKPOINT_BYTES, validateMobileCheckpoint } from './checkpoint-store.ts'
import { parsePhysicsScene } from '@physicsos/physics-scene'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100
const LEGACY_SCENE_BYTES = 256 * 1024
export const MOBILE_SCENE_BYTES = 2 * 1024 * 1024
export const MOBILE_SCENE_REQUEST_BYTES = 12 * 1024 * 1024
const MAX_ACCOUNT_SCENE_BYTES = 128 * 1024 * 1024
const ID_RE = /^[A-Za-z0-9._-]{1,128}$/

export interface Page<T> { readonly items: T[]; readonly nextCursor?: string }
export interface ListQuery { readonly limit?: string; readonly cursor?: string }
export interface SceneMutation {
  readonly baseRevision: number
  readonly mutationId: string
  readonly restore?: boolean
  readonly checkpoint?: Readonly<Record<string, unknown>>
}
export interface SceneMutationResult {
  readonly item: StoredSceneRecord
  readonly replayed: boolean
  readonly appliedRevision: number
}
interface Cursor { readonly version: 1; readonly primary: string; readonly key: string }
const encodeCursor = (primary: string, key: string): string =>
  Buffer.from(JSON.stringify({ version: 1, primary, key } satisfies Cursor)).toString('base64url')
const decodeCursor = (value: string): Cursor => {
  try {
    if (value.length > 1024) throw new Error('cursor length')
    const parsed: Partial<Cursor> = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (parsed.version !== 1 || typeof parsed.primary !== 'string' || typeof parsed.key !== 'string' || parsed.primary.length > 64 || parsed.key.length > 128) throw new Error('cursor fields')
    return { version: 1, primary: parsed.primary, key: parsed.key }
  } catch { throw new LearningError(400, 'BAD_CURSOR', '分页游标无效') }
}
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const pageOf = <T>(rows: readonly T[], query: ListQuery, primaryOf: (row: T) => string, keyOf: (row: T) => string): Page<T> => {
  const limit = query.limit === undefined ? DEFAULT_PAGE_SIZE : Number(query.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE || (query.limit !== undefined && !/^\d+$/.test(query.limit))) throw new LearningError(400, 'BAD_REQUEST', 'limit must be 1..100')
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor)
  const ordered = [...rows].sort((a, b) => compare(primaryOf(b), primaryOf(a)) || compare(keyOf(b), keyOf(a)))
  const remaining = cursor === undefined ? ordered : ordered.filter(row => primaryOf(row) < cursor.primary || (primaryOf(row) === cursor.primary && keyOf(row) < cursor.key))
  const items = remaining.slice(0, limit)
  const last = items.at(-1)
  return last === undefined || remaining.length <= limit ? { items } : { items, nextCursor: encodeCursor(primaryOf(last), keyOf(last)) }
}
const assertId = (id: string): string => {
  if (!ID_RE.test(id)) throw new LearningError(400, 'BAD_REQUEST', '标识符格式无效')
  return id
}
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => {
  if (item !== null && typeof item === 'object' && !Array.isArray(item)) return Object.fromEntries(Object.entries(item).sort(([a], [b]) => compare(a, b)))
  return item
})
const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex')
const own = (actor: IdentityActor, row: { userKey: string; schoolId: string }): boolean => row.userKey === actor.userKey && row.schoolId === actor.schoolId
export const sceneRevision = (row: StoredSceneRecord | undefined): number => row === undefined ? 0 : row.revision ?? 1
export const sceneSummary = (row: StoredSceneRecord) => 'deletedAt' in row
  ? { sceneId: row.sceneId, revision: sceneRevision(row), deletedAt: row.deletedAt, savedAt: row.savedAt }
  : { sceneId: row.sceneId, title: row.title, domain: row.domain, kind: row.kind, updatedAt: row.updatedAt, savedAt: row.savedAt,
    revision: sceneRevision(row), hasCheckpoint: row.checkpointRef !== undefined, ...(row.buildMode === undefined ? {} : { buildMode: row.buildMode }) }

export class LearningService {
  private readonly queues = new Map<string, Promise<void>>()
  constructor(private readonly domain: LearningDomain, private readonly checkpoints?: CheckpointStore) {}
  private get attempts() { return this.domain.table('attempts') }
  private get scenes() { return this.domain.table('saved_scenes') }

  private serial<T>(actor: IdentityActor, operation: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([actor.schoolId, actor.userKey])
    const result = (this.queues.get(key) ?? Promise.resolve()).then(operation)
    const settled = result.then(() => {}, () => {})
    this.queues.set(key, settled)
    void settled.then(() => { if (this.queues.get(key) === settled) this.queues.delete(key) })
    return result
  }
  private assertActive(actor: IdentityActor): void {
    const fence = this.domain.table('erased_accounts').get(actor.userKey)
    if (fence !== undefined && fence.schoolId === actor.schoolId && (!fence.complete || actor.userId === undefined || actor.userId === fence.userId)) {
      throw new LearningError(410, 'ACCOUNT_ERASED', '账户数据已删除或正在删除')
    }
  }
  private currentScene(actor: IdentityActor, id: string): StoredSceneRecord | undefined {
    const current = this.scenes.get(savedSceneKey(actor.userKey, assertId(id)))
    if (current !== undefined && !own(actor, current)) throw new LearningError(404, 'NOT_FOUND', '场景不存在')
    return current
  }
  private conflict(current: StoredSceneRecord | undefined): never {
    throw new LearningError(409, 'VERSION_CONFLICT', '场景已修改，请读取当前版本后决定是否重提。', {
      currentRevision: sceneRevision(current), current: current === undefined ? null : sceneSummary(current),
    })
  }
  private replay(current: StoredSceneRecord | undefined, mutation: SceneMutation, hash: string): SceneMutationResult | undefined {
    const prior = current?.mutations?.find(value => value.id === mutation.mutationId)
    if (prior === undefined || current === undefined) return undefined
    if (prior.hash !== hash) throw new LearningError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于不同内容', { currentRevision: sceneRevision(current), current: sceneSummary(current) })
    return { item: current, replayed: true, appliedRevision: prior.revision }
  }
  private validateMutation(mutation: SceneMutation): void {
    if (!Number.isSafeInteger(mutation.baseRevision) || mutation.baseRevision < 0 || !/^[A-Za-z0-9._:-]{1,128}$/.test(mutation.mutationId)) throw new LearningError(400, 'BAD_REQUEST', 'baseRevision 或幂等键无效')
  }
  private nextRevision(current: StoredSceneRecord | undefined): number {
    const revision = sceneRevision(current) + 1
    if (!Number.isSafeInteger(revision)) throw new LearningError(409, 'REVISION_EXHAUSTED', '场景版本已达上限')
    return revision
  }

  saveAttempt(actor: IdentityActor, pathId: string, body: unknown): Promise<PersonalAttemptRecord> {
    return this.serial(actor, async () => {
      this.assertActive(actor)
      const id = assertId(pathId)
      const parsed = attemptWire.safeParse(body)
      if (!parsed.success || parsed.data.id !== id) throw new LearningError(400, 'BAD_REQUEST', '自测记录格式无效')
      const key = attemptKey(actor.userKey, id)
      const existing = this.attempts.get(key)
      if (existing !== undefined) {
        if (!own(actor, existing)) throw new LearningError(404, 'NOT_FOUND', '记录不存在')
        if (canonical(attemptWire.parse(existing)) !== canonical(parsed.data)) throw new LearningError(409, 'ID_CONFLICT', '同一自测记录 id 不能改写', { currentRevision: 1 })
        return existing
      }
      if (this.allAttempts(actor).length >= 20_000) throw new LearningError(413, 'ATTEMPT_LIMIT', '个人自测记录已达 20000 条上限')
      const record: PersonalAttemptRecord = { ...parsed.data, userKey: actor.userKey, schoolId: actor.schoolId, updatedAt: new Date().toISOString(), gradingSource: 'self-reported' }
      await this.attempts.put(key, record)
      return record
    })
  }
  allAttempts(actor: IdentityActor): PersonalAttemptRecord[] {
    this.assertActive(actor)
    return [...this.attempts.entries()].map(([, row]) => row).filter(row => own(actor, row))
  }
  listAttempts(actor: IdentityActor, query: ListQuery = {}): Page<PersonalAttemptRecord> {
    return pageOf(this.allAttempts(actor), query, row => row.at, row => row.id)
  }

  /** Legacy writes share the mobile queue, advance its revision, and cannot resurrect a tombstone. */
  async saveScene(actor: IdentityActor, pathId: string, body: unknown): Promise<SavedSceneRecord> {
    const result = await this.saveSceneInternal(actor, pathId, body)
    if ('deletedAt' in result.item) throw new LearningError(410, 'SCENE_DELETED', '场景已删除')
    return result.item
  }
  saveMobileScene(actor: IdentityActor, pathId: string, body: unknown, mutation: SceneMutation): Promise<SceneMutationResult> {
    this.validateMutation(mutation)
    return this.saveSceneInternal(actor, pathId, body, mutation)
  }
  private saveSceneInternal(actor: IdentityActor, pathId: string, body: unknown, mutation?: SceneMutation): Promise<SceneMutationResult> {
    return this.serial(actor, async () => {
      this.assertActive(actor)
      const id = assertId(pathId)
      if (Buffer.byteLength(JSON.stringify(body)) > MOBILE_SCENE_REQUEST_BYTES) throw new LearningError(413, 'PAYLOAD_TOO_LARGE', '完整场景请求最多 12 MiB')
      const parsed = sceneEntryWire.safeParse(body)
      if (!parsed.success || parsed.data.sceneId !== id || parsed.data.scene.id !== id) throw new LearningError(400, 'BAD_REQUEST', '实验场景格式或标识符无效')
      const contentBytes = Buffer.byteLength(JSON.stringify([parsed.data.scene, parsed.data.originScene]))
      if (contentBytes > (mutation === undefined ? LEGACY_SCENE_BYTES : MOBILE_SCENE_BYTES)) throw new LearningError(413, 'PAYLOAD_TOO_LARGE', '实验场景超过允许的完整大小')
      if (mutation !== undefined && (!parsePhysicsScene(parsed.data.scene).ok
        || (parsed.data.originScene !== undefined && !parsePhysicsScene(parsed.data.originScene).ok))) {
        throw new LearningError(400, 'BAD_REQUEST', '场景未通过共享 PhysicsScene 格式校验')
      }
      if (mutation?.checkpoint !== undefined) validateMobileCheckpoint(mutation.checkpoint, id, parsed.data.scene, parsed.data.originScene)
      const checkpointBytes = mutation?.checkpoint === undefined ? 0 : Buffer.byteLength(JSON.stringify(mutation.checkpoint))
      if (checkpointBytes > MOBILE_CHECKPOINT_BYTES) throw new LearningError(413, 'CHECKPOINT_TOO_LARGE', '完整检查点最多 8 MiB，历史未截断')
      const current = this.currentScene(actor, id)
      const hash = digest({ operation: 'save', payload: parsed.data, baseRevision: mutation?.baseRevision, restore: mutation?.restore === true, checkpoint: mutation?.checkpoint })
      if (mutation !== undefined) {
        const replay = this.replay(current, mutation, hash)
        if (replay !== undefined) return replay
        if (mutation.baseRevision !== sceneRevision(current)) this.conflict(current)
      }
      if (current !== undefined && 'deletedAt' in current && mutation?.restore !== true) this.conflict(current)
      if (mutation === undefined && current !== undefined && !('deletedAt' in current) && canonical(sceneEntryWire.parse(current)) === canonical(parsed.data)) return { item: current, replayed: true, appliedRevision: sceneRevision(current) }
      const rows = [...this.scenes.entries()].map(([, row]) => row).filter(row => own(actor, row))
      if (current === undefined && rows.length >= 1000) throw new LearningError(413, 'SCENE_LIMIT', '个人场景和墓碑合计最多 1000 条')
      const retainedBytes = rows.filter(row => row.sceneId !== id && !('deletedAt' in row)).reduce((total, row) => total + Buffer.byteLength(JSON.stringify(row)) + ('checkpointRef' in row ? row.checkpointRef?.bytes ?? 0 : 0), 0)
      if (retainedBytes + contentBytes + checkpointBytes > MAX_ACCOUNT_SCENE_BYTES) throw new LearningError(413, 'SCENE_QUOTA', '个人场景及完整检查点合计最多 128 MiB')
      if (mutation?.checkpoint !== undefined && this.checkpoints === undefined) throw new LearningError(503, 'CHECKPOINT_UNAVAILABLE', '私有检查点存储未挂载')
      const checkpointRef = mutation?.checkpoint === undefined ? undefined : await this.checkpoints!.save(actor, mutation.checkpoint)
      const revision = this.nextRevision(current)
      const record: SavedSceneRecord = {
        ...parsed.data, userKey: actor.userKey, schoolId: actor.schoolId, savedAt: new Date().toISOString(), revision,
        ...(checkpointRef === undefined ? {} : { checkpointRef }),
        mutations: [...(current?.mutations ?? []), ...(mutation === undefined ? [] : [{ id: mutation.mutationId, hash, revision }])].slice(-128),
      }
      await this.scenes.put(savedSceneKey(actor.userKey, id), record)
      await this.collectCheckpoints(actor)
      return { item: record, replayed: false, appliedRevision: revision }
    })
  }
  allScenes(actor: IdentityActor): StoredSceneRecord[] {
    this.assertActive(actor)
    return [...this.scenes.entries()].map(([, row]) => row).filter(row => own(actor, row))
  }
  listScenes(actor: IdentityActor, query: ListQuery = {}): Page<SavedSceneRecord> {
    const rows = this.allScenes(actor).filter((row): row is SavedSceneRecord => !('deletedAt' in row))
    return pageOf(rows, query, row => row.updatedAt, row => row.sceneId)
  }
  async openScene(actor: IdentityActor, id: string) {
    return this.serial(actor, async () => {
      this.assertActive(actor)
      const row = this.currentScene(actor, id)
      if (row === undefined) throw new LearningError(404, 'NOT_FOUND', '场景不存在')
      if ('deletedAt' in row) throw new LearningError(410, 'SCENE_DELETED', '场景已删除', { currentRevision: sceneRevision(row), current: sceneSummary(row) })
      return this.sceneContent(actor, row)
    })
  }
  private async sceneContent(actor: IdentityActor, row: SavedSceneRecord) {
    if (row.checkpointRef !== undefined && this.checkpoints === undefined) throw new LearningError(503, 'CHECKPOINT_UNAVAILABLE', '私有检查点存储未挂载')
    const checkpoint = row.checkpointRef === undefined ? undefined : await this.checkpoints!.read(actor, row.checkpointRef).then(value => {
      validateMobileCheckpoint(value, row.sceneId, row.scene, row.originScene)
      return value
    }).catch(() => { throw new LearningError(503, 'CHECKPOINT_UNAVAILABLE', '持久检查点读取或验证失败，未返回不完整成功') })
    return { ...sceneSummary(row), scene: row.scene, ...(row.originScene === undefined ? {} : { originScene: row.originScene }), ...(checkpoint === undefined ? {} : { checkpoint }) }
  }
  /** Export one owned live scene or tombstone; concurrent changes refuse rather than mixing revisions. */
  exportScene(actor: IdentityActor, id: string, revision: number): Promise<Record<string, unknown>> {
    return this.serial(actor, async () => {
      this.assertActive(actor)
      const row = this.currentScene(actor, id)
      if (row === undefined || sceneRevision(row) !== revision) throw new LearningError(409, 'EXPORT_CHANGED', '场景已变化，请重新导出')
      return 'deletedAt' in row ? sceneSummary(row) : this.sceneContent(actor, row)
    })
  }
  async deleteScene(actor: IdentityActor, id: string): Promise<void> { await this.deleteSceneInternal(actor, id) }
  deleteMobileScene(actor: IdentityActor, id: string, mutation: SceneMutation): Promise<SceneMutationResult> {
    this.validateMutation(mutation)
    return this.deleteSceneInternal(actor, id, mutation)
  }
  private deleteSceneInternal(actor: IdentityActor, pathId: string, mutation?: SceneMutation): Promise<SceneMutationResult> {
    return this.serial(actor, async () => {
      this.assertActive(actor)
      const id = assertId(pathId)
      const current = this.currentScene(actor, id)
      const hash = digest({ operation: 'delete', id, baseRevision: mutation?.baseRevision })
      if (mutation !== undefined) {
        const replay = this.replay(current, mutation, hash)
        if (replay !== undefined) return replay
        if (mutation.baseRevision !== sceneRevision(current)) this.conflict(current)
      }
      if (current !== undefined && 'deletedAt' in current) return { item: current, replayed: true, appliedRevision: sceneRevision(current) }
      if (current === undefined && this.allScenes(actor).length >= 1000) throw new LearningError(413, 'SCENE_LIMIT', '个人场景和墓碑合计最多 1000 条')
      const at = new Date().toISOString()
      const revision = this.nextRevision(current)
      const record: StoredSceneRecord = { sceneId: id, userKey: actor.userKey, schoolId: actor.schoolId, savedAt: at, deletedAt: at, revision,
        mutations: [...(current?.mutations ?? []), ...(mutation === undefined ? [] : [{ id: mutation.mutationId, hash, revision }])].slice(-128) }
      await this.scenes.put(savedSceneKey(actor.userKey, id), record)
      await this.collectCheckpoints(actor)
      return { item: record, replayed: false, appliedRevision: revision }
    })
  }
  private async collectCheckpoints(actor: IdentityActor): Promise<void> {
    if (this.checkpoints === undefined) return
    const retained = new Set(this.allScenes(actor).flatMap(row => 'checkpointRef' in row && row.checkpointRef !== undefined ? [row.checkpointRef.digest] : []))
    await this.checkpoints.collect(actor, retained)
  }

  /** Auth's disabled incarnation is fenced before any bytes are removed; retries keep the same request id. */
  eraseAccount(actor: IdentityActor, request: Omit<LearningErasure, 'complete'>): Promise<void> {
    return this.serial(actor, async () => {
      if (request.userKey !== actor.userKey || request.schoolId !== actor.schoolId) throw new LearningError(403, 'FORBIDDEN', '清理账户不匹配')
      const fences = this.domain.table('erased_accounts')
      const prior = fences.get(actor.userKey)
      if (prior?.requestId === request.requestId && prior.complete) return
      if (prior !== undefined && !prior.complete && prior.requestId !== request.requestId) throw new LearningError(409, 'ERASURE_CONFLICT', '其他账户清理仍在进行')
      await fences.put(actor.userKey, { ...request, complete: false })
      await this.checkpoints?.erase(actor)
      for (const [key, row] of this.attempts.entries()) if (own(actor, row)) await this.attempts.delete(key)
      for (const [key, row] of this.scenes.entries()) if (own(actor, row)) await this.scenes.delete(key)
      await fences.put(actor.userKey, { ...request, complete: true })
    })
  }
  async dispose(): Promise<void> { await Promise.all([...this.queues.values()]) }
}
