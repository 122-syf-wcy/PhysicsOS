/**
 * Agent → Lab scene mirroring (docs/04 §92 `SceneRevisionChanged`).
 *
 * The model edits scenes inside the host process through the physics tools;
 * `@deepseek-ai/dsh-tool-physicsos` publishes every touched scene as a
 * `physics/scene` session event, and the host folds them into the session's
 * `physicsScenes` projection. This module turns that projection into Lab
 * navigation: the FIRST value seen for a session is its baseline (the scene
 * becomes the active one silently, so a reload or a session switch does not
 * yank the student off the surface they are on); every later change is a live
 * revision and opens the Lab on it.
 *
 * Pure and framework-free: the caller feeds `(sessionId, projection value)`
 * and supplies the two surface actions. The projection is read defensively —
 * it crossed the wire as JSON and the Lab must never mount a malformed scene.
 */

import { validateScene, type PhysicsScene } from '@physicsos/physics-scene'

/** One scene snapshot as the host published it (the subset the Lab needs). */
export interface AgentSceneSnapshot {
  sceneId: string
  revision: number
  title?: string
  cause?: string
  scene: PhysicsScene
}

/** The `physicsScenes` projection value as the Lab reads it. */
export interface AgentScenesProjection {
  latest: string | null
  scenes: Readonly<Record<string, AgentSceneSnapshot>>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Shape-check a projection value from the wire. Returns undefined for anything
 * that is not a `{ latest, scenes }` fold of scene snapshots whose embedded
 * scene agrees with its header (same id and revision, frozen schema version).
 * @param value - raw projection value (unknown until proven).
 */
export const readAgentScenesProjection = (value: unknown): AgentScenesProjection | undefined => {
  if (!isRecord(value)) return undefined
  const { latest, scenes } = value
  if (latest !== null && typeof latest !== 'string') return undefined
  if (!isRecord(scenes)) return undefined
  const checked: Record<string, AgentSceneSnapshot> = {}
  for (const [key, entry] of Object.entries(scenes)) {
    if (!isRecord(entry)) return undefined
    const { sceneId, revision, title, cause, scene } = entry
    if (typeof sceneId !== 'string' || sceneId !== key) return undefined
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return undefined
    if (!isRecord(scene)) return undefined
    if (scene['schemaVersion'] !== 'physics-scene/1.0' || scene['id'] !== sceneId || scene['revision'] !== revision) {
      return undefined
    }
    checked[key] = {
      sceneId,
      revision,
      ...(typeof title === 'string' ? { title } : {}),
      ...(typeof cause === 'string' ? { cause } : {}),
      scene: scene as unknown as PhysicsScene,
    }
  }
  return { latest, scenes: checked }
}

/** Scene handover shared with the surface store. */
export interface AgentSceneRef {
  sceneId: string
  scene: PhysicsScene
}

export interface AgentSceneSyncDeps {
  /** Make the scene the active one without changing surface (baseline / session switch). */
  adoptScene: (ref: AgentSceneRef) => void
  /** Open the Lab on the scene (a live revision the agent just produced). */
  showScene: (ref: AgentSceneRef) => void
}

/** What one `apply` did, for callers and tests. */
export type AgentSceneSyncOutcome = 'absent' | 'invalid' | 'unchanged' | 'adopted' | 'shown'

export interface AgentSceneSync {
  /**
   * Feed the current session and its `physicsScenes` projection value.
   * @param sessionId - current session, or undefined while none is selected.
   * @param projection - raw projection value (undefined = capability absent).
   */
  apply: (sessionId: string | undefined, projection: unknown) => AgentSceneSyncOutcome
}

/**
 * Create the mirror. Per session it remembers the last `sceneId@revision` it
 * acted on, so a projection re-delivery (reconnect, list rebuild) is a no-op
 * and a malformed value is not retried until the projection changes.
 * @param deps - the two surface actions.
 */
export function createAgentSceneSync(deps: AgentSceneSyncDeps): AgentSceneSync {
  const applied = new Map<string, string>()
  return {
    apply: (sessionId, value) => {
      if (sessionId === undefined) return 'absent'
      const projection = readAgentScenesProjection(value)
      if (projection === undefined) return value === undefined ? 'absent' : 'invalid'
      if (projection.latest === null) return 'absent'
      const snapshot = projection.scenes[projection.latest]
      if (snapshot === undefined) return 'invalid'
      const stamp = `${snapshot.sceneId}@${snapshot.revision}`
      const previous = applied.get(sessionId)
      if (previous === stamp) return 'unchanged'
      applied.set(sessionId, stamp)
      /* The Lab keys its runtime on the scene's own validity: a snapshot the
         scene validator rejects is remembered (so it is not re-tried on every
         list rebuild) but never mounted. */
      if (validateScene(snapshot.scene).status === 'failed') return 'invalid'
      const ref: AgentSceneRef = { sceneId: snapshot.sceneId, scene: snapshot.scene }
      if (previous === undefined) {
        deps.adoptScene(ref)
        return 'adopted'
      }
      deps.showScene(ref)
      return 'shown'
    },
  }
}
