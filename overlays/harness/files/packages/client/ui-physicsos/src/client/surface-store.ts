import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PhysicsScene } from '@physicsos/physics-scene'

import { domainOfScene } from './physics/domain-of-scene.ts'

/** Student-visible PhysicsOS surface; `admin` is the role-gated console. */
export type PhysicsSurfaceId = 'home' | 'lab' | 'record' | 'paper' | 'library' | 'notice' | 'admin'

/** Scene handover every entry point exchanges with the Lab. */
export interface PhysicsSceneRef {
  sceneId: string
  scene: PhysicsScene
}

/** Snapshot the sidebar and workspace overlay subscribe to. */
export interface PhysicsSurfaceState {
  surface: PhysicsSurfaceId
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
}

/** Snapshot the sidebar recent-space list subscribes to. */
export interface RecentExperimentsState {
  items: readonly RecentExperimentEntry[]
}

const RECENT_SCENES_KEY = 'physicsos.recent-scenes'
const RECENT_SCENES_LIMIT = 8

type SceneStorage = Pick<Storage, 'getItem' | 'setItem'>

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
  openBuilder: (sceneRef: PhysicsSceneRef) => void
  /** Open the Lab on the experiment chooser, keeping the active scene resumable. */
  openExperimentPicker: () => void
  /** Drop a scene from 最近空间; an active scene keeps running in the Lab. */
  removeRecent: (sceneId: string) => void
}

/**
 * Create the Home / Lab / Record surface switch.
 *
 * Every real scene handed to the Lab is also recorded to the recent-experiments
 * list (persisted when `storage` is given), so 最近空间 lists actual
 * PhysicsScenes a click can restore — not chat sessions.
 */
export function createPhysicsSurfaceController(storage?: SceneStorage): PhysicsSurfaceController {
  const store = createSnapshotStore<PhysicsSurfaceState>({ surface: 'home' })
  const recent = createSnapshotStore<RecentExperimentsState>({
    items: readStoredScenes(storage),
  })

  const persistItems = (items: readonly RecentExperimentEntry[]): void => {
    recent.set({ items })
    try {
      storage?.setItem(RECENT_SCENES_KEY, JSON.stringify(items))
    } catch {
      /* Storage full or unavailable — the in-memory list still works this session. */
    }
  }

  const record = (sceneRef: PhysicsSceneRef): void => {
    const scene = sceneRef.scene
    const entry: RecentExperimentEntry = {
      sceneId: sceneRef.sceneId,
      title: scene.metadata.title ?? sceneRef.sceneId,
      domain: domainOfScene(scene),
      kind: scene.metadata.sourceQuestionId === undefined ? 'experiment' : 'question',
      updatedAt: new Date().toISOString(),
      scene,
    }
    persistItems([
      entry,
      ...recent.getSnapshot().items.filter(existing => existing.sceneId !== entry.sceneId),
    ].slice(0, RECENT_SCENES_LIMIT))
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
      const active = sceneRef ?? store.getSnapshot().sceneRef
      store.set({
        surface,
        ...(active === undefined ? {} : { sceneRef: active }),
      })
      if (sceneRef !== undefined) record(sceneRef)
    },
    openBuilder: (sceneRef) => {
      store.set({ surface: 'lab', sceneRef, buildMode: true })
      record(sceneRef)
    },
    openExperimentPicker: () => {
      const active = store.getSnapshot().sceneRef
      store.set({
        surface: 'lab',
        experimentPicker: true,
        ...(active === undefined ? {} : { sceneRef: active }),
      })
    },
    removeRecent: (sceneId) => {
      const items = recent.getSnapshot().items.filter(entry => entry.sceneId !== sceneId)
      if (items.length === recent.getSnapshot().items.length) return
      persistItems(items)
    },
  }
}
