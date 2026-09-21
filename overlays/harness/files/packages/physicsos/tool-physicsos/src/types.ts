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
 * The structured half of a `physics_solve_question` result, carried on the
 * `cause: 'solved'` snapshot so the chat card can present the question
 * understanding (knowns, targets), the worked steps and the engine verdict —
 * the same contract Question Space drew, without a second pipeline.
 * All fields are lossless JSON (`value: null` marks a non-finite parse).
 */
export interface PhysicsSceneSolveSummary {
  /** Quantities the parser read off the stem. `key` feeds canvas highlighting. */
  readonly knowns: readonly {
    readonly key: string
    readonly label: string
    readonly symbol: string
    readonly value: number | null
    readonly unit: string
  }[]
  /** Quantities the stem asks for, in the solver's own vocabulary. */
  readonly targets: readonly string[]
  /** Solved target values, already formatted for the student. */
  readonly answers: readonly {
    readonly key: string
    readonly label: string
    readonly symbol: string
    readonly value: string
    readonly unit: string
  }[]
  readonly steps: readonly {
    readonly index: number
    readonly title: string
    readonly description: string
    readonly substitution?: string
    readonly result?: string
  }[]
  readonly verification?: {
    readonly status: string
    readonly checks: readonly { readonly id: string; readonly passed: boolean; readonly message?: string }[]
  }
  /** Parser/validator complaints; empty when the run was clean. */
  readonly issues: readonly {
    readonly code: string
    readonly message: string
    readonly severity: string
  }[]
  /** Golden-bank id when the stem matched a built-in question — the card
      attaches that question's self-check items and records attempts. */
  readonly goldenQuestionId?: string
}

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
  /** Agent turn that produced the snapshot; absent in logs written before it. */
  turn?: number
  /** Structured solve result; present only on `cause: 'solved'` snapshots. */
  solve?: PhysicsSceneSolveSummary
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
