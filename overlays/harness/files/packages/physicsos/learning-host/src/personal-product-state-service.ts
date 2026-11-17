import { createHash } from 'node:crypto'
import { savedSceneKey, type LearningDomain, type SavedSceneRecord } from './domain.ts'
import { LearningError, type IdentityActor } from './identity.ts'
import { pageOf, type ListQuery, type Page, type RecentSceneLifecycleAdapter } from './service.ts'
import {
  personalProductStateKey, productResourceId, productStateMutation, sessionProjectMutation,
  type PersonalProductStateDomain, type PersonalProductStateRecord,
  type ProductLifecycle, type ProductStateMutation, type SessionProjectAssignmentRecord,
} from './personal-product-state-domain.ts'

export const PERSONAL_WORKSPACES_SERVICE = 'physicsosPersonalWorkspaces'
export const PRODUCT_STATE_SERVICE = 'physicsosProductState'
export interface PersonalWorkspace {
  readonly id: string
  readonly title: string
  readonly sessionIds: readonly string[]
}
/** Auth-host resolves BOTH the exact claim owner and the native registry record. */
export interface PersonalWorkspaces {
  get(actor: IdentityActor, id: string): PersonalWorkspace | undefined
  list(actor: IdentityActor): readonly PersonalWorkspace[]
  ownsSession(actor: IdentityActor, id: string): boolean
  sessions(actor: IdentityActor): readonly string[]
}
export interface SessionProjectAssignment {
  /** False is an owned native grouping, not an explicit move to ungrouped. */
  readonly assigned?: boolean
  readonly sessionId: string
  readonly projectId: string | null
  readonly version: number
  readonly updatedAt: string
}
export interface RecentSceneLifecycle {
  readonly sceneId: string
  readonly recentGeneration: number
  readonly recentVersion: number
  readonly recentState: ProductLifecycle
  readonly recentRestoreState?: 'live' | 'archived'
}
export type RecentSceneRecord = SavedSceneRecord & RecentSceneLifecycle
export interface ProjectProductState {
  readonly projectId: string
  readonly generation: number
  readonly version: number
  readonly state: ProductLifecycle
  readonly restoreState?: 'live' | 'archived'
  readonly updatedAt: string
}
export interface ProductStateListQuery extends ListQuery {
  readonly state?: string
}
export interface PersonalProductStateOptions {
  readonly learning: LearningDomain
  readonly workspaces: () => PersonalWorkspaces | undefined
  /** Bridge mode leaves this false: read/enforce existing heads, no feature writes. */
  readonly writesEnabled: () => boolean
  readonly now?: () => Date
  readonly maxRowsPerAccount?: number
  readonly maxRows?: number
}
export class PersonalProductStateError extends LearningError {
  constructor(status: number, code: string, message: string, readonly current?: RecentSceneLifecycle | ProjectProductState) {
    super(status, code, message)
  }
}

const filterOf = (value: string | undefined): ProductLifecycle | 'all' => {
  if (value === undefined) return 'live'
  if (value === 'live' || value === 'archived' || value === 'deleted' || value === 'all') return value
  throw new LearningError(400, 'BAD_REQUEST', 'state must be live, archived, deleted or all')
}
const assertId = (id: string): string => {
  if (!productResourceId.safeParse(id).success) throw new LearningError(400, 'BAD_REQUEST', '标识符格式无效')
  return id
}
const owns = (actor: IdentityActor, row: { ownerKey: string; schoolId: string }): boolean =>
  actor.userKey === row.ownerKey && actor.schoolId === row.schoolId
const sceneState = (row: PersonalProductStateRecord): RecentSceneLifecycle => ({
  sceneId: row.resourceId, recentGeneration: row.generation, recentVersion: row.version, recentState: row.state,
  ...(row.restoreState === undefined ? {} : { recentRestoreState: row.restoreState }),
})
const projectState = (row: PersonalProductStateRecord): ProjectProductState => ({
  projectId: row.resourceId, generation: row.generation, version: row.version, state: row.state, updatedAt: row.updatedAt,
  ...(row.restoreState === undefined ? {} : { restoreState: row.restoreState }),
})

/**
 * Durable metadata only. A delete never touches a scene, native Workspace,
 * Session claim/log, or Canvas metadata. Every scene write and lifecycle CAS
 * shares one lifecycle admission queue, including the awaited snapshot write.
 */
export class PersonalProductStateService implements RecentSceneLifecycleAdapter {
  /** Bridge/enabled installs refuse the native registry's irreversible delete RPC. */
  readonly nativeProjectSoftDelete = true
  private readonly queues = new Map<string, Promise<unknown>>()
  private closed = false
  private readonly now: () => Date
  constructor(private readonly domain: PersonalProductStateDomain, private readonly options: PersonalProductStateOptions) {
    this.now = options.now ?? (() => new Date())
  }
  private row(actor: IdentityActor, table: 'recent_scenes' | 'projects', id: string): PersonalProductStateRecord {
    const row = this.domain.table(table).get(personalProductStateKey(actor.schoolId, actor.userKey, id))
    if (row !== undefined) {
      if (!owns(actor, row) || row.resourceId !== id) throw new LearningError(404, 'NOT_FOUND', '资料不存在')
      return row
    }
    return { schemaVersion: 1, ownerKey: actor.userKey, schoolId: actor.schoolId, resourceId: id,
      generation: 0, version: 0, state: 'live', updatedAt: '1970-01-01T00:00:00.000Z' }
  }
  private enqueue<T>(_actor: IdentityActor, _table: 'recent_scenes' | 'projects' | 'session_projects', _id: string, work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new LearningError(503, 'PRODUCT_STATE_UNAVAILABLE', '个人资料状态服务已关闭'))
    // Lifecycle admission is deliberately serialized: moves cannot race target
    // deletion, and both per-account AND global new-row limits remain bounds.
    // This queue also holds the legacy snapshot write through its durable ACK.
    const key = 'personal-product-admission'
    const job = (this.queues.get(key) ?? Promise.resolve()).catch(() => {}).then(work)
    this.queues.set(key, job)
    void job.finally(() => { if (this.queues.get(key) === job) this.queues.delete(key) }).catch(() => {})
    return job
  }
  private requireWrites(): void {
    if (!this.options.writesEnabled()) throw new LearningError(503, 'PRODUCT_STATE_FEATURE_DISABLED', '当前为兼容桥接模式，整理功能尚未启用')
  }
  private scene(actor: IdentityActor, id: string): SavedSceneRecord | undefined {
    const row = this.options.learning.table('saved_scenes').get(savedSceneKey(actor.userKey, id))
    if (row !== undefined && (row.userKey !== actor.userKey || row.schoolId !== actor.schoolId))
      throw new LearningError(404, 'NOT_FOUND', '场景不存在')
    return row
  }
  private workspace(actor: IdentityActor, id: string): PersonalWorkspace {
    const workspaces = this.options.workspaces()
    if (workspaces === undefined) throw new LearningError(503, 'PROJECT_REGISTRY_UNAVAILABLE', '项目服务尚未就绪')
    const workspace = workspaces.get(actor, id)
    if (workspace === undefined || workspace.id !== id) throw new LearningError(404, 'NOT_FOUND', '项目不存在')
    return workspace
  }
  /** Synchronous bridge used by auth-host. Claims remain intact, including on delete. */
  projectDeleted(actor: IdentityActor, id: string): boolean { return this.row(actor, 'projects', id).state === 'deleted' }
  getProjectState(actor: IdentityActor, id: string): ProjectProductState {
    assertId(id)
    this.workspace(actor, id)
    return projectState(this.row(actor, 'projects', id))
  }
  getRecentState(actor: IdentityActor, id: string): RecentSceneLifecycle {
    assertId(id)
    this.scene(actor, id)
    return sceneState(this.row(actor, 'recent_scenes', id))
  }
  decorateScene(actor: IdentityActor, row: SavedSceneRecord): RecentSceneRecord {
    return { ...row, ...sceneState(this.row(actor, 'recent_scenes', row.sceneId)) }
  }
  sceneVisible(actor: IdentityActor, id: string): boolean { return this.row(actor, 'recent_scenes', id).state === 'live' }
  async withSceneWrite<T extends SavedSceneRecord>(actor: IdentityActor, id: string, generation: number | undefined, write: () => Promise<T>): Promise<T & RecentSceneLifecycle> {
    return this.enqueue(actor, 'recent_scenes', assertId(id), async () => {
      const head = this.row(actor, 'recent_scenes', id)
      const current = sceneState(head)
      if (head.state === 'deleted') throw new PersonalProductStateError(410, 'RECENT_SCENE_DELETED', '此最近记录已移除；请明确重新打开或从回收站恢复', current)
      // Legacy PUTs can write only the original, never-deleted generation.
      if (generation === undefined && head.generation !== 0)
        throw new PersonalProductStateError(409, 'RECENT_GENERATION_REQUIRED', '请刷新客户端后重新打开实验', current)
      if ((generation ?? 0) !== head.generation)
        throw new PersonalProductStateError(409, 'RECENT_GENERATION_CONFLICT', '最近记录已在另一设备整理，请重新打开', current)
      return { ...await write(), ...current }
    })
  }
  listRecentScenes(actor: IdentityActor, query: ProductStateListQuery = {}): Page<RecentSceneRecord> {
    const state = filterOf(query.state)
    const rows = [...this.options.learning.table('saved_scenes').entries()].flatMap(([, row]) => {
      if (row.userKey !== actor.userKey || row.schoolId !== actor.schoolId) return []
      const item = this.decorateScene(actor, row)
      return state === 'all' || state === item.recentState ? [item] : []
    })
    return pageOf(rows, query, row => row.updatedAt, row => row.sceneId)
  }
  listProjectStates(actor: IdentityActor, query: ProductStateListQuery = {}): Page<ProjectProductState> {
    const registry = this.options.workspaces()
    if (registry === undefined) throw new LearningError(503, 'PROJECT_REGISTRY_UNAVAILABLE', '项目服务尚未就绪')
    const state = filterOf(query.state)
    const rows = registry.list(actor).map(workspace => projectState(this.row(actor, 'projects', workspace.id)))
      .filter(row => state === 'all' || row.state === state)
    return pageOf(rows, query, row => row.updatedAt, row => row.projectId)
  }
  private async mutate(actor: IdentityActor, tableName: 'recent_scenes' | 'projects', id: string, mutation: ProductStateMutation): Promise<PersonalProductStateRecord> {
    this.requireWrites()
    const key = personalProductStateKey(actor.schoolId, actor.userKey, id)
    const table = this.domain.table(tableName)
    const previous = this.row(actor, tableName, id)
    const hash = createHash('sha256').update(JSON.stringify(mutation)).digest('hex')
    const transition = (current: PersonalProductStateRecord): PersonalProductStateRecord => {
      if (!owns(actor, current) || current.resourceId !== id) throw new LearningError(404, 'NOT_FOUND', '资料不存在')
      if (current.lastOperation?.id === mutation.operationId) {
        if (current.lastOperation.hash !== hash) throw new LearningError(409, 'PRODUCT_OPERATION_CONFLICT', '同一操作 id 不能改写')
        return current
      }
      if (current.generation !== mutation.expectedGeneration || current.version !== mutation.expectedVersion)
        throw new PersonalProductStateError(409, 'PRODUCT_STATE_CONFLICT', '资料状态已变化，请刷新后重试', tableName === 'projects' ? projectState(current) : sceneState(current))
      let state: ProductLifecycle
      if (mutation.action === 'delete') state = 'deleted'
      else if (mutation.action === 'restore' && current.state === 'deleted') state = current.restoreState ?? 'live'
      else if (mutation.action === 'archive' && current.state === 'live') state = 'archived'
      else if (mutation.action === 'unarchive' && current.state === 'archived') state = 'live'
      else if (mutation.action === 'reopen' && tableName === 'recent_scenes') state = 'live'
      else throw new LearningError(409, 'PRODUCT_STATE_TRANSITION_INVALID', '当前状态不能执行此操作')
      if (current.generation >= Number.MAX_SAFE_INTEGER || current.version >= Number.MAX_SAFE_INTEGER)
        throw new LearningError(409, 'PRODUCT_GENERATION_EXHAUSTED', '资料代际已达到上限')
      const { restoreState: _restore, lastOperation: _operation, ...base } = current
      return { ...base, state, generation: current.generation + 1, version: current.version + 1,
        ...(state === 'deleted' ? { restoreState: current.state === 'deleted' ? current.restoreState ?? 'live' : current.state } : {}),
        updatedAt: this.now().toISOString(), lastOperation: { id: mutation.operationId, hash } }
    }
    if (table.get(key) !== undefined) return table.update(key, transition)
    const accountRows = [...table.entries()].filter(([, row]) => owns(actor, row)).length
    if (accountRows >= (this.options.maxRowsPerAccount ?? 10_000) || table.size >= (this.options.maxRows ?? 200_000))
      throw new LearningError(413, 'PRODUCT_STATE_LIMIT', '整理记录已达到容量上限；已有墓碑仍会保留')
    const next = transition(previous)
    await table.put(key, next)
    return next
  }
  async mutateRecentScene(actor: IdentityActor, id: string, body: unknown): Promise<{ state: RecentSceneLifecycle; item?: RecentSceneRecord }> {
    assertId(id)
    const parsed = productStateMutation.safeParse(body)
    if (!parsed.success) throw new LearningError(400, 'BAD_REQUEST', '整理操作需要完整代际、版本和 operationId')
    return this.enqueue(actor, 'recent_scenes', id, async () => {
      const snapshot = this.scene(actor, id)
      if (snapshot === undefined && parsed.data.action !== 'delete' && parsed.data.action !== 'reopen'
        && !(parsed.data.action === 'restore' && this.row(actor, 'recent_scenes', id).state === 'deleted'))
        throw new LearningError(404, 'NOT_FOUND', '可恢复的场景快照不存在')
      const head = await this.mutate(actor, 'recent_scenes', id, parsed.data)
      const state = sceneState(head)
      return { state, ...(snapshot === undefined ? {} : { item: { ...snapshot, ...state } }) }
    })
  }
  async mutateProject(actor: IdentityActor, id: string, body: unknown): Promise<ProjectProductState> {
    assertId(id)
    const parsed = productStateMutation.safeParse(body)
    if (!parsed.success || parsed.data.action === 'reopen') throw new LearningError(400, 'BAD_REQUEST', '项目整理操作格式无效')
    return this.enqueue(actor, 'projects', id, async () => {
      this.workspace(actor, id)
      return projectState(await this.mutate(actor, 'projects', id, parsed.data))
    })
  }
  private sessionOwner(actor: IdentityActor, id: string): PersonalWorkspaces {
    const registry = this.options.workspaces()
    if (registry === undefined) throw new LearningError(503, 'PROJECT_REGISTRY_UNAVAILABLE', '项目服务尚未就绪')
    if (!registry.ownsSession(actor, id)) throw new LearningError(404, 'NOT_FOUND', '会话不存在')
    return registry
  }
  getSessionAssignment(actor: IdentityActor, id: string): SessionProjectAssignment {
    assertId(id)
    const registry = this.sessionOwner(actor, id)
    const stored = this.domain.table('session_projects').get(personalProductStateKey(actor.schoolId, actor.userKey, id))
    if (stored !== undefined && (!owns(actor, stored) || stored.sessionId !== id)) throw new LearningError(404, 'NOT_FOUND', '会话不存在')
    const native = registry.list(actor).find(workspace => workspace.sessionIds.includes(id))?.id ?? null
    return { sessionId: id, assigned: stored !== undefined, projectId: stored === undefined ? native : stored.projectId, version: stored?.version ?? 0,
      updatedAt: stored?.updatedAt ?? '1970-01-01T00:00:00.000Z' }
  }
  listSessionAssignments(actor: IdentityActor, query: ListQuery = {}): Page<SessionProjectAssignment> {
    const registry = this.options.workspaces()
    if (registry === undefined) throw new LearningError(503, 'PROJECT_REGISTRY_UNAVAILABLE', '项目服务尚未就绪')
    // Include unmodified membership as well. During a read/create race, an ID
    // absent from this authorized inventory is unknown, not implicitly live.
    const native = new Map(registry.list(actor).flatMap(workspace => workspace.sessionIds.map(id => [id, workspace.id] as const)))
    const rows = registry.sessions(actor).flatMap(id => {
      if (!registry.ownsSession(actor, id)) return []
      const row = this.domain.table('session_projects').get(personalProductStateKey(actor.schoolId, actor.userKey, id))
      if (row !== undefined && (!owns(actor, row) || row.sessionId !== id)) return []
      return [{ sessionId: id, assigned: row !== undefined, projectId: row === undefined ? native.get(id) ?? null : row.projectId,
        version: row?.version ?? 0, updatedAt: row?.updatedAt ?? '1970-01-01T00:00:00.000Z' }]
    })
    return pageOf(rows, query, row => row.updatedAt, row => row.sessionId)
  }
  async assignSessionProject(actor: IdentityActor, id: string, body: unknown): Promise<SessionProjectAssignment> {
    assertId(id)
    const parsed = sessionProjectMutation.safeParse(body)
    if (!parsed.success) throw new LearningError(400, 'BAD_REQUEST', '移动会话需要目标项目、版本和 operationId')
    return this.enqueue(actor, 'session_projects', id, async () => {
      this.requireWrites()
      this.sessionOwner(actor, id)
      const target = parsed.data.projectId
      if (target !== null) {
        this.workspace(actor, target)
        if (this.row(actor, 'projects', target).state !== 'live') throw new LearningError(409, 'PROJECT_NOT_LIVE', '只能移入正常项目')
      }
      const table = this.domain.table('session_projects'), key = personalProductStateKey(actor.schoolId, actor.userKey, id)
      const hash = createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex')
      const transition = (current: SessionProjectAssignmentRecord | undefined): SessionProjectAssignmentRecord => {
        if (current !== undefined && (!owns(actor, current) || current.sessionId !== id)) throw new LearningError(404, 'NOT_FOUND', '会话不存在')
        if (current?.lastOperation.id === parsed.data.operationId) {
          if (current.lastOperation.hash !== hash) throw new LearningError(409, 'PRODUCT_OPERATION_CONFLICT', '同一移动操作 id 不能改写')
          return current
        }
        if ((current?.version ?? 0) !== parsed.data.expectedVersion) throw new LearningError(409, 'PROJECT_ASSIGNMENT_CONFLICT', '会话已被移动，请刷新后重试')
        if ((current?.version ?? 0) >= Number.MAX_SAFE_INTEGER) throw new LearningError(409, 'PRODUCT_GENERATION_EXHAUSTED', '移动版本已达到上限')
        return { schemaVersion: 1, ownerKey: actor.userKey, schoolId: actor.schoolId, sessionId: id,
          projectId: target, version: (current?.version ?? 0) + 1, updatedAt: this.now().toISOString(),
          lastOperation: { id: parsed.data.operationId, hash } }
      }
      let row: SessionProjectAssignmentRecord
      if (table.get(key) === undefined) {
        if (table.size >= (this.options.maxRows ?? 200_000) || [...table.entries()].filter(([, row]) => owns(actor, row)).length >= (this.options.maxRowsPerAccount ?? 10_000))
          throw new LearningError(413, 'PRODUCT_STATE_LIMIT', '项目关联记录达到容量上限')
        row = transition(undefined)
        await table.put(key, row)
      } else row = await table.update(key, transition)
      return { sessionId: id, assigned: true, projectId: row.projectId, version: row.version, updatedAt: row.updatedAt }
    })
  }
  /** Old DELETE is safe only before the first lifecycle transition; retries on a tombstone are no-ops. */
  async deleteScene(actor: IdentityActor, id: string): Promise<void> {
    assertId(id)
    await this.enqueue(actor, 'recent_scenes', id, async () => {
      this.scene(actor, id)
      const current = this.row(actor, 'recent_scenes', id)
      if (current.state === 'deleted') return
      if (current.generation !== 0) throw new PersonalProductStateError(409, 'RECENT_GENERATION_REQUIRED', '请刷新客户端后整理最近记录', sceneState(current))
      if (!this.options.writesEnabled()) {
        // Before feature activation preserve the original DELETE contract only
        // for untouched gen-0 rows. A bridge can never erase an existing head.
        await this.options.learning.table('saved_scenes').delete(savedSceneKey(actor.userKey, id))
        return
      }
      await this.mutate(actor, 'recent_scenes', id, { action: 'delete', expectedGeneration: 0, expectedVersion: current.version, operationId: `legacy-delete-${id}`.slice(0, 128) })
    })
  }
  async dispose(): Promise<void> {
    this.closed = true
    await Promise.allSettled([...this.queues.values()])
  }
}
