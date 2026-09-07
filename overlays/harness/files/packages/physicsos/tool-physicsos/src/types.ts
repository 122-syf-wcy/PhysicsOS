/**
 * Pure types of the PhysicsOS scene-sync domain: the ONE home of the
 * `physics/scene` session event and the `physicsScenes` projection-key
 * declarations, free of this package's host-side value imports. Two namespace
 * projections serve it — `./types` for host consumers, `./client` for client
 * aggregates — with zero content duplication.
 *
 * Why a session event at all (docs/04 §92–§93, §131): the model edits a scene
 * inside the host process, while the student's canvas runs in the browser. The
 * PhysicsScene EventStore behind `@physicsos/agent-tools` stays the physics
 * truth; this event is the `SceneRevisionChanged` notification that carries a
 * display snapshot to the client, and the projection is its last-wins fold.
 *
 * @module @deepseek-ai/dsh-tool-physicsos/types
 */

import type { JsonValue } from '@deepseek-ai/dsh-session/types'

/** Why a snapshot was published. */
export type PhysicsSceneSnapshotCause = 'created' | 'solved' | 'command'

/**
 * One scene as the tool runtime holds it at one revision. `scene` is the
 * complete `PhysicsScene` (`physics-scene/1.0`) as lossless JSON, so a client
 * can mount it in the Lab without reaching back into the host process.
 */
export interface PhysicsSceneSnapshot {
  sceneId: string
  revision: number
  domain: string
  engineId: string
  title: string
  cause: PhysicsSceneSnapshotCause
  /** The SceneCommand type that produced this revision (`cause: 'command'`). */
  commandType?: string
  /** The PhysicsEvent the command emitted (`cause: 'command'`). */
  eventType?: string
  /** Question id when the scene was built by `physics_solve_question`. */
  sourceQuestionId?: string
  scene: JsonValue
}

/**
 * The projection's wire value: every scene the session's agent has touched,
 * by id, plus which one moved last (the one the Lab shows). `latest` is null
 * before the first snapshot.
 */
export interface PhysicsScenesProjection {
  latest: string | null
  scenes: Record<string, PhysicsSceneSnapshot>
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A scene the agent created, solved or edited through the physics tools,
     * at the revision the tool call left it. Whole-value per scene id; the
     * projection folds last-wins per id.
     */
    'physics/scene': PhysicsSceneSnapshot
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Scenes the agent touched in this session, folded from `physics/scene` events. */
    physicsScenes: PhysicsScenesProjection
  }
}
