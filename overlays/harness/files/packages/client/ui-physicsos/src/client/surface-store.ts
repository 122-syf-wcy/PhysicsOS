import { createSnapshotStore, type SnapshotStore } from './runtime-compat.ts'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PhysicsScene } from '@physicsos/physics-scene'
import type { InstanceSource, TemplateReleaseIdentity } from '@physicsos/physics-workbench/types'

import { collectLearningPages, LearningApiError } from './learning-api.ts'
import type { LearningApi, PersonalProductApi, ProductStateMutation, RecentSceneLifecycle } from './learning-api.ts'
import { domainOfScene } from './physics/domain-of-scene.ts'

/** Student-visible PhysicsOS surface; `admin` is the role-gated console. */
export type PhysicsSurfaceId =
  | 'home'
  | 'lab'
  | 'canvas'
  | 'whiteboard'
  | 'courseware'
  | 'projects'
  | 'record'
  | 'paper'
  | 'contribute'
  | 'notice'
  | 'admin'

/**
 * Central-panel identity each product surface occupies in the layout shell.
 *
 * The target shell exposes global panels through the `main` keyed slot and the
 * sidebar's `sidebar.panellist` rows, so every PhysicsOS surface that is not
 * the Home conversation needs a stable panel id. `home` is deliberately absent:
 * it IS the Conversation panel (`selectPanel(null)`).
 */
export const PHYSICS_PANEL_IDS = {
  lab: 'physicsos-lab' as MainPanelId,
  canvas: 'physicsos-canvas' as MainPanelId,
  whiteboard: 'physicsos-whiteboard' as MainPanelId,
  courseware: 'physicsos-courseware' as MainPanelId,
  projects: 'physicsos-projects' as MainPanelId,
  paper: 'physicsos-paper' as MainPanelId,
  notice: 'physicsos-notice' as MainPanelId,
  contribute: 'physicsos-contribute' as MainPanelId,
  record: 'physicsos-record' as MainPanelId,
  admin: 'physicsos-admin' as MainPanelId,
} satisfies Record<Exclude<PhysicsSurfaceId, 'home'>, MainPanelId>

const SURFACE_BY_PANEL: Readonly<Record<string, PhysicsSurfaceId>> = {
  [PHYSICS_PANEL_IDS.lab]: 'lab',
  [PHYSICS_PANEL_IDS.canvas]: 'canvas',
  [PHYSICS_PANEL_IDS.whiteboard]: 'whiteboard',
  [PHYSICS_PANEL_IDS.courseware]: 'courseware',
  [PHYSICS_PANEL_IDS.projects]: 'projects',
  [PHYSICS_PANEL_IDS.paper]: 'paper',
  [PHYSICS_PANEL_IDS.notice]: 'notice',
  [PHYSICS_PANEL_IDS.contribute]: 'contribute',
  [PHYSICS_PANEL_IDS.record]: 'record',
  [PHYSICS_PANEL_IDS.admin]: 'admin',
}

/**
 * Interpret one shell panel selection as a product surface.
 * @param panelId - active `main` key, or null for the Conversation.
 * @returns the surface; the removed library panel restores Home, and foreign panels return undefined.
 */
export function physicsSurfaceOfPanel(
  panelId: string | null | undefined,
): PhysicsSurfaceId | undefined {
  if (panelId === null || panelId === 'physicsos-library') return 'home'
  if (panelId === undefined) return undefined
  return SURFACE_BY_PANEL[panelId]
}

/** Scene handover every entry point exchanges with the Lab. */
export interface PhysicsSceneRef {
  sceneId: string
  scene: PhysicsScene
  originScene?: PhysicsScene
  /** Verification belongs to the original question, outside the scene/hash contract. */
  hasVerifiedSolution?: boolean
  buildMode?: true
  canvasTemplateId?: string
  canvasSource?: InstanceSource
  canvasTemplateRelease?: TemplateReleaseIdentity
}

/** Keep persisted authoring/provenance state when opening a recent scene. */
export const sceneRefOf = (entry: PhysicsSceneRef): PhysicsSceneRef => ({
  sceneId: entry.sceneId,
  scene: entry.scene,
  ...(entry.originScene === undefined ? {} : { originScene: entry.originScene }),
  ...(entry.hasVerifiedSolution === undefined ? {} : { hasVerifiedSolution: entry.hasVerifiedSolution }),
  ...(entry.buildMode === true ? { buildMode: true } : {}),
  ...(entry.canvasTemplateId === undefined ? {} : { canvasTemplateId: entry.canvasTemplateId }),
  ...(entry.canvasSource === undefined ? {} : { canvasSource: entry.canvasSource }),
  ...(entry.canvasTemplateRelease === undefined ? {} : { canvasTemplateRelease: entry.canvasTemplateRelease }),
})

/** Snapshot the sidebar and workspace overlay subscribe to. */
export interface PhysicsSurfaceState {
  surface: PhysicsSurfaceId
  canvasId?: string
  whiteboardId?: string
  coursewareId?: string
  routeNotice?: string
  /** Changes only on an explicit handover, never a write-back. */
  sceneGeneration?: number
  /** The active scene. Survives surface switches so returning to the Lab resumes it. */
  sceneRef?: PhysicsSceneRef
  /**
   * Set when the student asked to pick (or switch) an experiment, so the Lab
   * shows the chooser even while a scene is active. Choosing a template — or
   * resuming the active scene — clears it. Plain navigation to the Lab shows
   * the active scene when there is one and the chooser when there is none; it
   * never auto-loads a demo scene the student did not ask for.
   */
  experimentPicker?: true
  /**
   * Set while the Lab is ASSEMBLING a circuit rather than reading one.
   *
   * Building passes through circuits that do not solve yet — nothing wired,
   * no source, a lead across the battery — and those states must keep their
   * schematic on screen. This is view state, not a physical fact about the
   * scene, so it stays out of the scene contract. Picking a template clears it.
   */
  buildMode?: true
}

/** One recently opened real scene, restorable exactly as it was created. */
export interface RecentExperimentEntry extends Partial<RecentSceneLifecycle> {
  readonly sceneId: string
  readonly title: string
  /** Lab domain the scene routes to; labels the entry in the sidebar. */
  readonly domain: string
  /** A question-sourced scene reads as 题目, a picked template as 实验. */
  readonly kind: 'experiment' | 'question'
  readonly updatedAt: string
  readonly scene: PhysicsScene
  readonly originScene?: PhysicsScene
  readonly hasVerifiedSolution?: boolean
  readonly buildMode?: true
  readonly canvasTemplateId?: string
  readonly canvasSource?: InstanceSource
  readonly canvasTemplateRelease?: TemplateReleaseIdentity
}

/** Snapshot the sidebar recent-space list subscribes to. */
export interface RecentExperimentsState {
  items: readonly RecentExperimentEntry[]
  archivedItems?: readonly RecentExperimentEntry[]
  deletedItems?: readonly RecentExperimentEntry[]
  pendingSceneIds?: readonly string[]
  lifecycleEnabled?: boolean
  lifecycleReadable?: boolean
  accountKey?: string
  notice?: string
}

export interface PhysicsSurfaceAccount {
  /** Include tenant and immutable account id; never just a display name. */
  readonly key: string
  readonly storage?: SceneStorage
}
export interface PhysicsSurfaceOptions {
  /** Re-evaluated before requests, publications and persistence, not just at boot. */
  readonly account?: () => PhysicsSurfaceAccount | undefined
  readonly recentLifecycleEnabled?: () => boolean
  readonly recentLifecycleReadable?: () => boolean
  readonly recentLifecycleReady?: () => boolean
}

const RECENT_SCENES_KEY = 'physicsos.recent-scenes'
const RECENT_SCENES_DELETED_KEY = 'physicsos.recent-scenes.deleted'
const RECENT_SCENES_LIMIT = 8

export type SceneStorage = Pick<Storage, 'getItem' | 'setItem'>
type SavedSceneSync = Pick<LearningApi, 'listScenes' | 'putScene' | 'deleteScene'> & Partial<PersonalProductApi>
type PersonalRecentApi = SavedSceneSync & Pick<PersonalProductApi, 'listRecentScenes' | 'getRecentState' | 'mutateRecentScene'>

/** Parse persisted entries defensively: a corrupt payload yields an empty list. */
const readStoredScenes = (storage: SceneStorage | undefined): RecentExperimentEntry[] => {
  try {
    const raw = storage?.getItem(RECENT_SCENES_KEY)
    if (raw === null || raw === undefined) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (entry): entry is RecentExperimentEntry =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as { sceneId?: unknown }).sceneId === 'string' &&
          typeof (entry as { title?: unknown }).title === 'string' &&
          typeof (entry as { updatedAt?: unknown }).updatedAt === 'string' &&
          Number.isFinite(Date.parse((entry as { updatedAt: string }).updatedAt)) &&
          typeof (entry as { scene?: unknown }).scene === 'object' && (entry as { scene?: unknown }).scene !== null,
      )
      .slice(0, RECENT_SCENES_LIMIT)
  } catch {
    return []
  }
}

/** Controller returned by {@link createPhysicsSurfaceController}. */
export interface PhysicsSurfaceController {
  store: SnapshotStore<PhysicsSurfaceState>
  /** Real scenes the student opened, newest first, for the sidebar 最近空间. */
  recent: SnapshotStore<RecentExperimentsState>
  open: (surface: PhysicsSurfaceId, sceneRef?: PhysicsSceneRef) => void
  /** Select a workbench without replacing the independently resumable lab scene. */
  openCanvas: (canvasId?: string) => void
  openWhiteboard: (whiteboardId?: string) => void
  openCourseware: (coursewareId?: string) => void
  /**
   * Show a scene without adding it to 最近空间.
   *
   * The agent's own visits are working views, not artifacts a reader restores:
   * the baseline it adopts on (re)load, and every revision it builds on the way
   * to an answer. Recording those is what filled 最近空间 with the scaffolding
   * of one question — three attempts at the same model, all kept. Only
   * {@link remember} writes an entry, once the turn knows which world the
   * answer belongs to.
   */
  openTransient: (surface: PhysicsSurfaceId, sceneRef: PhysicsSceneRef) => void
  /**
   * Add a scene to 最近空间 without navigating: the world a turn's answer
   * belongs to, recorded once when that turn ends.
   */
  remember: (sceneRef: PhysicsSceneRef) => void
  /** Open the Lab assembling a circuit: the build bench, not the reading bench. */
  updateScene: (scene: PhysicsScene) => void
  openBuilder: (sceneRef: PhysicsSceneRef) => void
  /** Open the Lab on the experiment chooser, keeping the active scene resumable. */
  setRouteNotice: (message: string | undefined) => void
  openExperimentPicker: () => void
  /** Drop a scene from 最近空间; an active scene keeps running in the Lab. */
  removeRecent: (sceneId: string) => void
  restoreRecent: (sceneId: string) => void
  archiveRecent: (sceneId: string) => void
  unarchiveRecent: (sceneId: string) => void
  /** Invalidate requests and reload only the new account's namespace. */
  refreshAccount: () => void
  /** Merge account-backed scenes and migrate local-only entries. */
  sync: () => Promise<void>
  /**
   * Adopt a panel selection made outside this controller — a `sidebar.panellist`
   * row click, or the Conversation returning to the front. Foreign panels are
   * left alone, so another package's page never rewrites the product surface.
   * @param panelId - the shell's active `main` key, or null for the Conversation.
   */
  adoptPanel: (panelId: string | null) => void
}

/** How the product surface reaches the layout shell. */
export interface PhysicsSurfaceNavigation {
  /**
   * Ask the shell to show the panel a product surface occupies.
   * @param surface - the surface the student navigated to.
   */
  selectSurface: (surface: PhysicsSurfaceId) => void
}

const RECENT_LIFECYCLE_KEY = 'physicsos.recent-scenes.lifecycle.v1'
type PendingRecentMutation = ProductStateMutation & { readonly sceneId: string }
const operationId = (): string => globalThis.crypto?.randomUUID?.() ?? `recent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
const lifecycleOf = (entry: RecentExperimentEntry): RecentSceneLifecycle => ({
  sceneId: entry.sceneId, recentGeneration: entry.recentGeneration ?? 0,
  recentVersion: entry.recentVersion ?? 0, recentState: entry.recentState ?? 'live',
  ...(entry.recentRestoreState === undefined ? {} : { recentRestoreState: entry.recentRestoreState }),
})
const validLifecycle = (value: unknown): value is RecentSceneLifecycle => {
  if (value === null || typeof value !== 'object') return false
  const row = value as Partial<RecentSceneLifecycle>
  return typeof row.sceneId === 'string' && typeof row.recentGeneration === 'number'
    && Number.isSafeInteger(row.recentGeneration) && row.recentGeneration >= 0
    && typeof row.recentVersion === 'number' && Number.isSafeInteger(row.recentVersion) && row.recentVersion >= 0
    && ['live', 'archived', 'deleted'].includes(row.recentState ?? '')
}

/** One account lifetime. Discarding it fences every queued request and late response. */
function createPersonalRecentController(
  recent: SnapshotStore<RecentExperimentsState>, storage: SceneStorage | undefined,
  remote: PersonalRecentApi, alive: () => boolean, writesEnabled: () => boolean, accountKey?: string,
) {
  const entries = new Map(readStoredScenes(storage).map(entry => [entry.sceneId, entry]))
  const heads = new Map<string, RecentSceneLifecycle>()
  const pending = new Map<string, PendingRecentMutation[]>()
  const writes = new Map<string, Promise<unknown>>()
  const access = new Map<string, number>()
  const suppressed = new Set<string>()
  let notice: string | undefined
  let syncing: Promise<void> | undefined
  try {
    const saved = JSON.parse(storage?.getItem(RECENT_LIFECYCLE_KEY) ?? 'null') as {
      version?: unknown; items?: RecentExperimentEntry[]; heads?: RecentSceneLifecycle[]; pending?: PendingRecentMutation[]
    } | null
    if (saved?.version === 1) {
      for (const item of saved.items ?? []) if (item !== null && typeof item === 'object' && typeof item.sceneId === 'string'
        && typeof item.title === 'string' && typeof item.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt))
        && item.scene !== null && typeof item.scene === 'object') entries.set(item.sceneId, item)
      for (const head of saved.heads ?? []) if (validLifecycle(head)) heads.set(head.sceneId, head)
      for (const op of saved.pending ?? []) if (op !== null && typeof op === 'object' && typeof op.sceneId === 'string' && typeof op.operationId === 'string'
        && ['delete', 'restore', 'archive', 'unarchive', 'reopen'].includes(op.action)
        && Number.isSafeInteger(op.expectedGeneration) && op.expectedGeneration >= 0
        && Number.isSafeInteger(op.expectedVersion) && op.expectedVersion >= 0) {
        pending.set(op.sceneId, [...pending.get(op.sceneId) ?? [], op])
      }
    }
    // Migrate old, unacknowledged local deletes without ever clearing them on ACK.
    const legacy = JSON.parse(storage?.getItem(RECENT_SCENES_DELETED_KEY) ?? '[]') as unknown
    if (Array.isArray(legacy)) for (const id of legacy) if (typeof id === 'string' && !heads.has(id) && !pending.has(id)) {
      pending.set(id, [{ sceneId: id, action: 'delete', expectedGeneration: 0, expectedVersion: 0, operationId: operationId() }])
    }
  } catch { /* A corrupt cache cannot change a server generation. */ }
  const headOf = (id: string): RecentSceneLifecycle => heads.get(id) ?? lifecycleOf(entries.get(id) ?? { sceneId: id } as RecentExperimentEntry)
  const effective = (id: string): RecentSceneLifecycle => {
    let head = headOf(id)
    for (const op of pending.get(id) ?? []) {
      const state = op.action === 'delete' ? 'deleted' : op.action === 'archive' ? 'archived'
        : op.action === 'restore' ? head.recentRestoreState ?? 'live' : 'live'
      head = { sceneId: id, recentGeneration: op.expectedGeneration + 1, recentVersion: op.expectedVersion + 1,
        recentState: state, ...(state === 'deleted' ? { recentRestoreState: head.recentState === 'deleted' ? head.recentRestoreState ?? 'live' : head.recentState } : {}) }
    }
    return head
  }
  const publish = (): void => {
    if (!alive()) return
    const all = [...entries.values()].map(entry => ({ ...entry, ...effective(entry.sceneId) }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.sceneId.localeCompare(a.sceneId))
    recent.set({ items: all.filter(entry => entry.recentState === 'live').slice(0, RECENT_SCENES_LIMIT),
      archivedItems: all.filter(entry => entry.recentState === 'archived'), deletedItems: all.filter(entry => entry.recentState === 'deleted'),
      pendingSceneIds: [...pending.keys()], lifecycleEnabled: writesEnabled(), lifecycleReadable: true, ...(accountKey === undefined ? {} : { accountKey }),
      ...(notice === undefined ? {} : { notice }) })
    try {
      storage?.setItem(RECENT_SCENES_KEY, JSON.stringify(all.filter(entry => entry.recentState === 'live').slice(0, RECENT_SCENES_LIMIT)))
      storage?.setItem(RECENT_LIFECYCLE_KEY, JSON.stringify({ version: 1, items: all, heads: [...heads.values()], pending: [...pending.values()].flat() }))
      storage?.setItem(RECENT_SCENES_DELETED_KEY, JSON.stringify([...new Set([...heads.keys(), ...pending.keys()])].filter(id => effective(id).recentState === 'deleted')))
    } catch { /* The in-memory fence still holds; a server tombstone is never evicted. */ }
  }
  const enqueue = <T>(id: string, job: () => Promise<T>): Promise<T | undefined> => {
    const next = (writes.get(id) ?? Promise.resolve()).catch(() => {}).then(() => alive() ? job() : undefined)
    writes.set(id, next)
    void next.finally(() => { if (writes.get(id) === next) writes.delete(id) }).catch(() => {})
    return next
  }
  const conflict = (id: string, error: unknown): boolean => {
    if (!(error instanceof LearningApiError) || ![403, 404, 409, 410].includes(error.status)) return false
    if (validLifecycle(error.current) && error.current.sceneId === id) heads.set(id, error.current)
    // Authorization errors do not become an offline retry under a different account.
    if (error.status === 403 || error.status === 404) entries.delete(id)
    pending.delete(id)
    suppressed.add(id)
    notice = error.message
    publish()
    return true
  }
  const flush = (id: string, freshOpen?: string): Promise<unknown> => enqueue(id, async () => {
    if (!writesEnabled()) return
    while (alive() && (pending.get(id)?.length ?? 0) > 0) {
      let op = pending.get(id)![0]!
      try {
        // This read belongs to the user's CURRENT click only. Offline replay
        // keeps its original CAS: it must not adopt a later unseen tombstone.
        if (freshOpen === op.operationId) {
          const result = await remote.getRecentState(id)
          if (!alive()) return
          heads.set(id, result.state)
          const generationDelta = result.state.recentGeneration - op.expectedGeneration
          const versionDelta = result.state.recentVersion - op.expectedVersion
          const queue = pending.get(id)!
          pending.set(id, queue.map(value => ({ ...value, expectedGeneration: value.expectedGeneration + generationDelta,
            expectedVersion: value.expectedVersion + versionDelta })))
          op = pending.get(id)![0]!
          publish()
          freshOpen = undefined
        }
        const { sceneId: _id, ...mutation } = op
        const result = await remote.mutateRecentScene(id, mutation)
        if (!alive()) return
        heads.set(id, result.state)
        const remaining = pending.get(id)!.slice(1)
        if (remaining.length === 0) pending.delete(id); else pending.set(id, remaining)
        const local = entries.get(id)
        if (op.action === 'reopen' && local !== undefined) entries.set(id, { ...local, ...result.state })
        else if (result.item !== undefined) entries.set(id, result.item)
        else if (local !== undefined) entries.set(id, { ...local, ...result.state })
        if (op.action === 'reopen') { access.set(id, result.state.recentGeneration); suppressed.delete(id) }
        else if (op.action === 'delete') suppressed.add(id)
        notice = undefined
        publish()
      } catch (error) {
        if (!alive()) return
        if (!conflict(id, error)) { notice = '整理操作已保存在本机，联网后会重试；不会重新上传已移除的记录。'; publish() }
        throw error
      }
    }
  })
  const save = (id: string, known?: RecentExperimentEntry, restoredSnapshot = false): Promise<unknown> => enqueue(id, async () => {
    if (pending.has(id) || !alive()) return
    const entry = entries.get(id), head = headOf(id)
    if (entry === undefined || head.recentState === 'deleted' || (suppressed.has(id) && !restoredSnapshot)) return
    // A newer lifecycle may be read while an old Lab is still running. Never
    // relabel that Lab's old snapshot with the newly read generation.
    if ((entry.recentGeneration ?? 0) !== head.recentGeneration) return
    if (known !== undefined && (known.recentGeneration ?? 0) === head.recentGeneration && entry.updatedAt <= known.updatedAt) return
    try {
      const saved = await remote.putScene({ ...entry, ...head })
      if (!alive()) return
      const latest = entries.get(id)
      if (latest !== undefined && latest.updatedAt === entry.updatedAt && !pending.has(id)) entries.set(id, { ...latest, ...lifecycleOf(saved.item) })
      publish()
    } catch (error) { if (alive()) conflict(id, error); throw error }
  })
  const mutate = (id: string, action: ProductStateMutation['action'], fresh = false): void => {
    if (!alive()) return
    if (!writesEnabled()) { notice = '兼容模式保留现有整理状态；新的归档、删除与恢复尚未启用。'; publish(); return }
    const current = effective(id)
    const op: PendingRecentMutation = { sceneId: id, action, expectedGeneration: current.recentGeneration,
      expectedVersion: current.recentVersion, operationId: operationId() }
    pending.set(id, [...pending.get(id) ?? [], op])
    if (action === 'delete') suppressed.add(id)
    publish()
    void flush(id, fresh ? op.operationId : undefined).then(() => save(id, undefined, action === 'restore')).catch(() => {})
  }
  const canUpdate = (id: string): boolean => {
    const last = pending.get(id)?.at(-1)
    if (last?.action === 'reopen') return true
    const head = headOf(id)
    return !suppressed.has(id) && head.recentState !== 'deleted'
      && (access.get(id) === undefined || access.get(id) === head.recentGeneration)
  }
  publish()
  return {
    canUpdate,
    suppress: (id: string): void => { suppressed.add(id) },
    record: (entry: RecentExperimentEntry, explicit: boolean): void => {
      if (!alive() || (!explicit && !canUpdate(entry.sceneId))) return
      const head = effective(entry.sceneId)
      if (!writesEnabled()) {
        if (head.recentState === 'deleted' || suppressed.has(entry.sceneId)) return
        entries.set(entry.sceneId, { ...entry, ...head })
        if (explicit) access.set(entry.sceneId, head.recentGeneration)
        publish()
        void save(entry.sceneId).catch(() => {})
        return
      }
      entries.set(entry.sceneId, { ...entry, ...head })
      if (explicit) {
        // An explicit visit is the only action (besides restore) allowed to
        // establish a new access generation. A background edit cannot do so.
        access.set(entry.sceneId, head.recentGeneration)
        mutate(entry.sceneId, 'reopen', true)
      } else {
        publish()
        void save(entry.sceneId).catch(() => {})
      }
    },
    mutate,
    refresh: publish,
    remove: (id: string): void => { mutate(id, 'delete') },
    sync: (): Promise<void> => {
      syncing ??= (async () => {
        await Promise.allSettled([...writes.values()])
        const failures: unknown[] = []
        for (const id of [...pending.keys()]) { try { await flush(id) } catch (error) { failures.push(error) } }
        if (!alive()) return
        const rows = await collectLearningPages(cursor => remote.listRecentScenes({ state: 'all', limit: 100, ...(cursor === undefined ? {} : { cursor }) }))
        if (!alive()) return
        const known = new Map(rows.map(row => [row.sceneId, row]))
        for (const row of rows) {
          const incoming = lifecycleOf(row), previous = headOf(row.sceneId), local = entries.get(row.sceneId)
          if (incoming.recentGeneration < previous.recentGeneration || incoming.recentVersion < previous.recentVersion) continue
          heads.set(row.sceneId, incoming)
          if (!pending.has(row.sceneId) && (local === undefined || (local.recentGeneration ?? 0) !== incoming.recentGeneration || local.updatedAt <= row.updatedAt)) entries.set(row.sceneId, row)
          if (incoming.recentState === 'deleted' || incoming.recentGeneration > previous.recentGeneration
            || (access.has(row.sceneId) && access.get(row.sceneId) !== incoming.recentGeneration)) suppressed.add(row.sceneId)
        }
        publish()
        for (const id of entries.keys()) { try { await save(id, known.get(id)) } catch (error) { failures.push(error) } }
        if (failures.length > 0) throw failures[0]
      })().finally(() => { syncing = undefined })
      return syncing
    },
  }
}

/**
 * Create the Home / Lab / Record surface switch.
 *
 * Every real scene handed to the Lab is also recorded to the recent-experiments
 * list (persisted when `storage` is given), so 最近空间 lists actual
 * PhysicsScenes a click can restore — not chat sessions.
 * @param storage - optional per-user storage for the recent list; absent keeps it in memory.
 * @returns the surface controller the chrome binds against.
 */
export function createPhysicsSurfaceController(
  initialStorage?: SceneStorage,
  remote?: SavedSceneSync,
  navigation?: PhysicsSurfaceNavigation,
  options: PhysicsSurfaceOptions = {},
): PhysicsSurfaceController {
  let account = options.account?.()
  let storage = options.account === undefined ? initialStorage : account?.storage
  let accountEpoch = 0
  let capabilityWasReady = options.recentLifecycleReady?.() !== false
  let personal: ReturnType<typeof createPersonalRecentController> | undefined
  let generation = 0
  const store = createSnapshotStore<PhysicsSurfaceState>({ surface: 'home' })
  const recent = createSnapshotStore<RecentExperimentsState>({
    items: options.recentLifecycleReady?.() === false ? [] : readStoredScenes(storage),
    ...(account === undefined ? {} : { accountKey: account.key }),
  })
  const readDeleted = (): Set<string> => {
    try {
      const parsed = JSON.parse(storage?.getItem(RECENT_SCENES_DELETED_KEY) ?? '[]') as unknown
      return new Set(
        Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [],
      )
    } catch {
      return new Set()
    }
  }
  const deleted = readDeleted()
  const currentAccount = (epoch = accountEpoch): boolean => epoch === accountEpoch
    && (options.account === undefined || (account !== undefined && options.account()?.key === account.key))
  const refreshAccount = (): void => {
    if (options.account === undefined) return
    const next = options.account()
    if (next?.key === account?.key) return
    accountEpoch += 1
    account = next
    storage = next?.storage
    personal = undefined
    activeSync = undefined
    writes.clear()
    deleted.clear()
    for (const id of readDeleted()) deleted.add(id)
    removedDuringSync.clear()
    recent.set({ items: options.recentLifecycleReady?.() === false ? [] : readStoredScenes(storage), ...(next === undefined ? {} : { accountKey: next.key }) })
    store.set({ surface: 'home' })
  }
  const recentReadable = (): boolean => options.recentLifecycleReadable?.() ?? options.recentLifecycleEnabled?.() ?? false
  const personalRecent = (): ReturnType<typeof createPersonalRecentController> | undefined => {
    refreshAccount()
    const ready = options.recentLifecycleReady?.() !== false
    if (!ready) {
      capabilityWasReady = false
      recent.set({ items: [], ...(account === undefined ? {} : { accountKey: account.key }) })
      return undefined
    }
    if (!capabilityWasReady) {
      capabilityWasReady = true
      recent.set({ items: readStoredScenes(storage), ...(account === undefined ? {} : { accountKey: account.key }) })
    }
    if (!recentReadable() || !currentAccount()
      || remote?.listRecentScenes === undefined || remote.getRecentState === undefined || remote.mutateRecentScene === undefined) return undefined
    if (personal === undefined) {
      const epoch = accountEpoch
      personal = createPersonalRecentController(recent, storage, remote as PersonalRecentApi,
        () => currentAccount(epoch) && recentReadable() && options.recentLifecycleReady?.() !== false,
        () => options.recentLifecycleEnabled?.() === true, account?.key)
    }
    return personal
  }
  // A server delete can be acknowledged while this sync still holds an older
  // remote page. Keep its tombstone until that reconciliation has completed.
  const removedDuringSync = new Set<string>()

  const persistItems = (items: readonly RecentExperimentEntry[]): void => {
    if (!currentAccount()) return
    recent.set({ items, ...(account === undefined ? {} : { accountKey: account.key }) })
    try {
      storage?.setItem(RECENT_SCENES_KEY, JSON.stringify(items))
    } catch {
      /* Storage full or unavailable — the in-memory list still works this session. */
    }
  }
  const persistDeleted = (): void => {
    if (!currentAccount()) return
    try {
      storage?.setItem(RECENT_SCENES_DELETED_KEY, JSON.stringify([...deleted]))
    } catch {
      /* The in-memory tombstone still suppresses the row this session. */
    }
  }
  const merge = (
    groups: readonly (readonly RecentExperimentEntry[])[],
  ): RecentExperimentEntry[] => {
    const byId = new Map<string, RecentExperimentEntry>()
    for (const group of groups) {
      for (const entry of group) {
        if (deleted.has(entry.sceneId) || removedDuringSync.has(entry.sceneId)) continue
        const current = byId.get(entry.sceneId)
        if (current === undefined || current.updatedAt <= entry.updatedAt)
          byId.set(entry.sceneId, entry)
      }
    }
    return [...byId.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.sceneId.localeCompare(a.sceneId))
      .slice(0, RECENT_SCENES_LIMIT)
  }
  const writes = new Map<string, Promise<unknown>>()
  const enqueue = <T>(sceneId: string, write: () => Promise<T>): Promise<T> => {
    const epoch = accountEpoch
    const previous = writes.get(sceneId) ?? Promise.resolve()
    const job = previous.catch(() => {}).then(() => {
      if (!currentAccount(epoch) || options.recentLifecycleReady?.() === false) throw new Error('RECENT_ACCOUNT_CHANGED')
      return write()
    })
    writes.set(sceneId, job)
    void job.finally(() => {
      if (writes.get(sceneId) === job) writes.delete(sceneId)
    }).catch(() => {})
    return job
  }
  const saveNewest = (sceneId: string, known?: RecentExperimentEntry) =>
    enqueue(sceneId, async () => {
      if (remote === undefined || deleted.has(sceneId) || removedDuringSync.has(sceneId)) return undefined
      // An earlier scene's upload or this scene's queue may have yielded long
      // enough for a new edit. Capture facts only when the write actually runs.
      const latest = recent.getSnapshot().items.find(item => item.sceneId === sceneId)
      if (latest === undefined || (known !== undefined && latest.updatedAt <= known.updatedAt)) return undefined
      return remote.putScene(latest)
    })
  let activeSync: Promise<void> | undefined
  const sync = (): Promise<void> => {
    const advanced = personalRecent()
    if (advanced !== undefined) return advanced.sync()
    if (remote === undefined || !currentAccount() || options.recentLifecycleReady?.() === false) return Promise.resolve()
    const epoch = accountEpoch
    activeSync ??= (async () => {
      await Promise.allSettled([...writes.values()])
      if (!currentAccount(epoch)) return
      for (const sceneId of deleted) {
        await remote.deleteScene(sceneId)
        if (!currentAccount(epoch)) return
        // Retain the tombstone after acknowledgement; only an explicit new
        // visit may clear the legacy local fence.
      }
      persistDeleted()

      const remoteItems: RecentExperimentEntry[] = []
      const seenCursors = new Set<string>()
      let cursor: string | undefined
      for (let page = 0; page < 100; page += 1) {
        const result = await remote.listScenes(cursor === undefined ? {} : { cursor })
        if (!currentAccount(epoch)) return
        remoteItems.push(...result.items)
        if (result.nextCursor === undefined) break
        if (seenCursors.has(result.nextCursor)) throw new Error('scene sync repeated a cursor')
        seenCursors.add(result.nextCursor)
        cursor = result.nextCursor
      }

      const remoteById = new Map(remoteItems.map(entry => [entry.sceneId, entry]))
      const sceneIds = recent.getSnapshot().items.map(entry => entry.sceneId)
      for (const sceneId of sceneIds) {
        const saved = await saveNewest(sceneId, remoteById.get(sceneId))
        if (!currentAccount(epoch)) return
        if (saved !== undefined) remoteById.set(sceneId, saved.item)
      }
      const items = merge([remoteItems, [...remoteById.values()], recent.getSnapshot().items])
      persistItems(items)
    })().finally(() => {
      if (accountEpoch !== epoch) return
      activeSync = undefined
      removedDuringSync.clear()
    })
    return activeSync
  }

  const record = (sceneRef: PhysicsSceneRef, explicit = false): void => {
    const advanced = personalRecent()
    if (!currentAccount() || options.recentLifecycleReady?.() === false || (advanced === undefined && !explicit && deleted.has(sceneRef.sceneId))) return
    const scene = sceneRef.scene
    const entry: RecentExperimentEntry = {
      sceneId: sceneRef.sceneId,
      title: scene.metadata.title ?? sceneRef.sceneId,
      domain: domainOfScene(scene),
      kind: scene.metadata.sourceQuestionId === undefined ? 'experiment' : 'question',
      updatedAt: new Date(Math.max(
        Date.now(),
        Date.parse(recent.getSnapshot().items.find(item => item.sceneId === sceneRef.sceneId)?.updatedAt ?? '') + 1 || 0,
      )).toISOString(),
      scene,
      ...(sceneRef.originScene === undefined ? {} : { originScene: sceneRef.originScene }),
      ...(sceneRef.hasVerifiedSolution === undefined ? {} : { hasVerifiedSolution: sceneRef.hasVerifiedSolution }),
      ...(sceneRef.buildMode === true ? { buildMode: true } : {}),
      ...(sceneRef.canvasTemplateId === undefined ? {} : { canvasTemplateId: sceneRef.canvasTemplateId }),
      ...(sceneRef.canvasSource === undefined ? {} : { canvasSource: sceneRef.canvasSource }),
      ...(sceneRef.canvasTemplateRelease === undefined ? {} : { canvasTemplateRelease: sceneRef.canvasTemplateRelease }),
    }
    if (advanced !== undefined) { advanced.record(entry, explicit); return }
    deleted.delete(entry.sceneId)
    removedDuringSync.delete(entry.sceneId)
    persistDeleted()
    const entryItems = [
      entry,
      ...recent.getSnapshot().items.filter(existing => existing.sceneId !== entry.sceneId),
    ].slice(0, RECENT_SCENES_LIMIT)
    persistItems(entryItems)
    if (remote !== undefined) void saveNewest(entry.sceneId).catch(() => {
      /* Local-first: the next sync compares timestamps and retries. */
    })
  }

  /* Show a scene without remembering it: one surface swap, shared by the
     reader's own opens and the agent's working visits. */
  const show = (surface: PhysicsSurfaceId, sceneRef: PhysicsSceneRef): void => {
    refreshAccount()
    store.set({
      surface, sceneRef, sceneGeneration: ++generation,
      ...(sceneRef.buildMode === true ? { buildMode: true } : {}),
    })
    navigation?.selectSurface(surface)
  }

  return {
    store,
    recent,
    open: (surface, sceneRef) => {
      refreshAccount()
      /* The active scene survives navigation: leaving for Home or the record
         and coming back resumes the same experiment. Only an explicit handover
         replaces it. The picker flag is deliberately dropped on every open, so
         choosing a template (or resuming) closes the chooser — and build mode
         is dropped with it, because reading a template is not assembling one. */
      const previous = store.getSnapshot()
      const active = sceneRef ?? previous.sceneRef
      store.set({
        surface,
        sceneGeneration: sceneRef === undefined ? previous.sceneGeneration ?? generation : ++generation,
        ...(active === undefined ? {} : { sceneRef: active }),
        ...(active?.buildMode === true || (sceneRef === undefined && previous.buildMode === true) ? { buildMode: true } : {}),
      })
      navigation?.selectSurface(surface)
      if (sceneRef !== undefined) record(sceneRef, true)
    },
    openCanvas: (canvasId) => {
      refreshAccount()
      const next = { ...store.getSnapshot(), surface: 'canvas' as const }
      delete next.canvasId
      delete next.routeNotice
      delete next.experimentPicker
      store.set(canvasId === undefined ? next : { ...next, canvasId })
      navigation?.selectSurface('canvas')
    },
    openWhiteboard: (whiteboardId) => {
      refreshAccount()
      const next = { ...store.getSnapshot(), surface: 'whiteboard' as const }
      delete next.whiteboardId
      delete next.routeNotice
      delete next.experimentPicker
      store.set(whiteboardId === undefined ? next : { ...next, whiteboardId })
      navigation?.selectSurface('whiteboard')
    },
    openCourseware: (coursewareId) => {
      refreshAccount()
      const next = { ...store.getSnapshot(), surface: 'courseware' as const }
      delete next.coursewareId
      delete next.routeNotice
      delete next.experimentPicker
      store.set(coursewareId === undefined ? next : { ...next, coursewareId })
      navigation?.selectSurface('courseware')
    },
    openTransient: show,
    remember: ref => { record(ref) },
    updateScene: (scene) => {
      refreshAccount()
      const current = store.getSnapshot()
      const previous = current.sceneRef
      if (previous === undefined || (previous.scene.id === scene.id && previous.scene.revision === scene.revision && previous.scene.metadata.experimentNotebook === scene.metadata.experimentNotebook)) return
      const originScene = previous.originScene ?? (previous.scene.metadata.sourceQuestionId === undefined ? undefined : previous.scene)
      const sceneRef: PhysicsSceneRef = {
        sceneId: String(scene.id), scene,
        ...(originScene === undefined ? {} : { originScene }),
        ...(previous.hasVerifiedSolution === undefined ? {} : { hasVerifiedSolution: scene.id === previous.scene.id && previous.hasVerifiedSolution }),
        ...(current.buildMode === true ? { buildMode: true } : {}),
        ...(previous.canvasTemplateId === undefined ? {} : { canvasTemplateId: previous.canvasTemplateId }),
        ...(previous.canvasSource === undefined ? {} : { canvasSource: previous.canvasSource }),
        ...(previous.canvasTemplateRelease === undefined ? {} : { canvasTemplateRelease: previous.canvasTemplateRelease }),
      }
      store.set({ ...current, sceneRef })
      const advanced = personalRecent()
      if (advanced !== undefined && !advanced.canUpdate(previous.sceneId)) advanced.suppress(sceneRef.sceneId)
      else if (advanced === undefined && deleted.has(previous.sceneId)) { deleted.add(sceneRef.sceneId); persistDeleted() }
      record(sceneRef)
    },
    openBuilder: (ref) => {
      refreshAccount()
      const sceneRef: PhysicsSceneRef = { ...ref, buildMode: true }
      store.set({ surface: 'lab', sceneRef, sceneGeneration: ++generation, buildMode: true })
      navigation?.selectSurface('lab')
      record(sceneRef, true)
    },
    setRouteNotice: (message) => {
      // Clearing the notice must drop the key: exactOptionalPropertyTypes rejects `undefined`.
      const rest = { ...store.getSnapshot() }
      delete rest.routeNotice
      store.set(message === undefined ? rest : { ...rest, routeNotice: message })
    },
    openExperimentPicker: () => {
      store.set({ ...store.getSnapshot(), surface: 'lab', experimentPicker: true })
      navigation?.selectSurface('lab')
    },
    removeRecent: (sceneId) => {
      const advanced = personalRecent()
      if (advanced !== undefined) { advanced.remove(sceneId); return }
      if (!currentAccount() || options.recentLifecycleReady?.() === false) return
      const epoch = accountEpoch
      const items = recent.getSnapshot().items.filter(entry => entry.sceneId !== sceneId)
      if (items.length === recent.getSnapshot().items.length) return
      deleted.add(sceneId)
      if (activeSync !== undefined) removedDuringSync.add(sceneId)
      persistDeleted()
      persistItems(items)
      if (remote !== undefined) void enqueue(sceneId, () => remote.deleteScene(sceneId))
        .then(() => {
          if (!currentAccount(epoch)) return
          // The legacy transport has no durable server head. Keep the local
          // tombstone too; an active Lab cannot re-add it after an ACK.
          persistDeleted()
        })
        .catch(() => {
          /* Keep the tombstone so a later sync cannot resurrect the row. */
        })
    },
    restoreRecent: sceneId => { personalRecent()?.mutate(sceneId, 'restore') },
    archiveRecent: sceneId => { personalRecent()?.mutate(sceneId, 'archive') },
    unarchiveRecent: sceneId => { personalRecent()?.mutate(sceneId, 'unarchive') },
    refreshAccount: () => { refreshAccount(); personalRecent()?.refresh() },
    sync,
    adoptPanel: (panelId) => {
      refreshAccount()
      const surface = physicsSurfaceOfPanel(panelId)
      if (surface === undefined) return
      const current = store.getSnapshot()
      /* Only the field the shell owns moves: an adopted panel never drops the
         active scene, the picker flag, or build mode. */
      if (current.surface !== surface) store.set({ ...current, surface })
      // A removed panel can still be restored by an older shell snapshot.
      if (panelId === 'physicsos-library') navigation?.selectSurface('home')
    },
  }
}
