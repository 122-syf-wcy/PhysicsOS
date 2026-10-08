import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PhysicsScene } from '@physicsos/physics-scene'

import type { LearningApi } from './learning-api.ts'
import { domainOfScene } from './physics/domain-of-scene.ts'

/** Student-visible PhysicsOS surface; `admin` is the role-gated console. */
export type PhysicsSurfaceId =
  | 'home'
  | 'lab'
  | 'record'
  | 'paper'
  | 'library'
  | 'notice'
  | 'admin'

/** Scene handover every entry point exchanges with the Lab. */
export interface PhysicsSceneRef {
  sceneId: string
  scene: PhysicsScene
  originScene?: PhysicsScene
  buildMode?: true
}

/** Keep persisted authoring/provenance state when opening a recent scene. */
export const sceneRefOf = (entry: PhysicsSceneRef): PhysicsSceneRef => ({
  sceneId: entry.sceneId,
  scene: entry.scene,
  ...(entry.originScene === undefined ? {} : { originScene: entry.originScene }),
  ...(entry.buildMode === true ? { buildMode: true } : {}),
})

/** Snapshot the sidebar and workspace overlay subscribe to. */
export interface PhysicsSurfaceState {
  surface: PhysicsSurfaceId
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
export interface RecentExperimentEntry {
  readonly sceneId: string
  readonly title: string
  /** Lab domain the scene routes to; labels the entry in the sidebar. */
  readonly domain: string
  /** A question-sourced scene reads as 题目, a picked template as 实验. */
  readonly kind: 'experiment' | 'question'
  readonly updatedAt: string
  readonly scene: PhysicsScene
  readonly originScene?: PhysicsScene
  readonly buildMode?: true
}

/** Snapshot the sidebar recent-space list subscribes to. */
export interface RecentExperimentsState {
  items: readonly RecentExperimentEntry[]
}

const RECENT_SCENES_KEY = 'physicsos.recent-scenes'
const RECENT_SCENES_DELETED_KEY = 'physicsos.recent-scenes.deleted'
const RECENT_SCENES_LIMIT = 8

type SceneStorage = Pick<Storage, 'getItem' | 'setItem'>
type SavedSceneSync = Pick<LearningApi, 'listScenes' | 'putScene' | 'deleteScene'>

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
          typeof (entry as { scene?: unknown }).scene === 'object',
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
  /** Open the Lab assembling a circuit: the build bench, not the reading bench. */
  updateScene: (scene: PhysicsScene) => void
  openBuilder: (sceneRef: PhysicsSceneRef) => void
  /** Open the Lab on the experiment chooser, keeping the active scene resumable. */
  openExperimentPicker: () => void
  /** Drop a scene from 最近空间; an active scene keeps running in the Lab. */
  removeRecent: (sceneId: string) => void
  /** Merge account-backed scenes and migrate local-only entries. */
  sync: () => Promise<void>
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
  storage?: SceneStorage,
  remote?: SavedSceneSync,
): PhysicsSurfaceController {
  let generation = 0
  const store = createSnapshotStore<PhysicsSurfaceState>({ surface: 'home' })
  const recent = createSnapshotStore<RecentExperimentsState>({
    items: readStoredScenes(storage),
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
  // A server delete can be acknowledged while this sync still holds an older
  // remote page. Keep its tombstone until that reconciliation has completed.
  const removedDuringSync = new Set<string>()

  const persistItems = (items: readonly RecentExperimentEntry[]): void => {
    recent.set({ items })
    try {
      storage?.setItem(RECENT_SCENES_KEY, JSON.stringify(items))
    } catch {
      /* Storage full or unavailable — the in-memory list still works this session. */
    }
  }
  const persistDeleted = (): void => {
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
    const previous = writes.get(sceneId) ?? Promise.resolve()
    const job = previous.catch(() => {}).then(write)
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
    if (remote === undefined) return Promise.resolve()
    activeSync ??= (async () => {
      await Promise.allSettled([...writes.values()])
      for (const sceneId of deleted) {
        await remote.deleteScene(sceneId)
        deleted.delete(sceneId)
      }
      persistDeleted()

      const remoteItems: RecentExperimentEntry[] = []
      const seenCursors = new Set<string>()
      let cursor: string | undefined
      for (let page = 0; page < 100; page += 1) {
        const result = await remote.listScenes(cursor === undefined ? {} : { cursor })
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
        if (saved !== undefined) remoteById.set(sceneId, saved.item)
      }
      const items = merge([remoteItems, [...remoteById.values()], recent.getSnapshot().items])
      persistItems(items)
    })().finally(() => {
      activeSync = undefined
      removedDuringSync.clear()
    })
    return activeSync
  }

  const record = (sceneRef: PhysicsSceneRef): void => {
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
      ...(sceneRef.buildMode === true ? { buildMode: true } : {}),
    }
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

  return {
    store,
    recent,
    open: (surface, sceneRef) => {
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
      if (sceneRef !== undefined) record(sceneRef)
    },
    updateScene: (scene) => {
      const current = store.getSnapshot()
      const previous = current.sceneRef
      if (previous === undefined || (previous.scene.id === scene.id && previous.scene.revision === scene.revision)) return
      const originScene = previous.originScene ?? (previous.scene.metadata.sourceQuestionId === undefined ? undefined : previous.scene)
      const sceneRef: PhysicsSceneRef = {
        sceneId: String(scene.id), scene,
        ...(originScene === undefined ? {} : { originScene }),
        ...(current.buildMode === true ? { buildMode: true } : {}),
      }
      store.set({ ...current, sceneRef })
      record(sceneRef)
    },
    openBuilder: (ref) => {
      const sceneRef: PhysicsSceneRef = { ...ref, buildMode: true }
      store.set({ surface: 'lab', sceneRef, sceneGeneration: ++generation, buildMode: true })
      record(sceneRef)
    },
    openExperimentPicker: () => {
      store.set({ ...store.getSnapshot(), surface: 'lab', experimentPicker: true })
    },
    removeRecent: (sceneId) => {
      const items = recent.getSnapshot().items.filter(entry => entry.sceneId !== sceneId)
      if (items.length === recent.getSnapshot().items.length) return
      deleted.add(sceneId)
      if (activeSync !== undefined) removedDuringSync.add(sceneId)
      persistDeleted()
      persistItems(items)
      if (remote !== undefined) void enqueue(sceneId, () => remote.deleteScene(sceneId))
        .then(() => {
          deleted.delete(sceneId)
          persistDeleted()
        })
        .catch(() => {
          /* Keep the tombstone so a later sync cannot resurrect the row. */
        })
    },
    sync,
  }
}
