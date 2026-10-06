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

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
/* Type-only: the canonical provenance contract (`QuantityProvenance`) the
   solved answers carry. Erased at build, so the snapshot stays plain data. */
import type { QuantityProvenance } from '@physicsos/physics-core'

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
    /**
     * The engine's trace for this answer — engine id/version, scene revision,
     * the verifier that signed off and the checks it ran — or null when no
     * engine produced the value. The client derives the verified-result block
     * from this ({@link QuantityProvenance}), never from the scene's domain or
     * the bare number, so a surface can always say who computed the answer.
     */
    readonly provenance: QuantityProvenance | null
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
    /**
     * One `physics_solve_question` run — solved OR rejected — appended after
     * the tool result so every attempt leaves run-level diagnostics in the
     * session log: pipeline state, engine verdict, answers, issues and the
     * retry guidance the model was handed. The `physicsScenes` mirror only
     * carries READY solves; this event is what makes rejected attempts
     * (parse failures, verification failures) visible after the fact.
     */
    'physics/solve-trace': PhysicsSolveTrace
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Scenes the agent touched in this session, folded from `physics/scene` events. */
    physicsScenes: PhysicsScenesProjection
    /** Solve attempts (solved and rejected) in order, folded from `physics/solve-trace` events. */
    physicsSolveTraces: PhysicsSolveTracesProjection
  }
}

/**
 * One `physics_solve_question` attempt as a durable record: what the pipeline
 * did with the stem, what the engine verified, which answers came out, which
 * issues surfaced, and — for a rejection — the retry hints the model received.
 * All fields are lossless JSON.
 */
export interface PhysicsSolveTrace {
  /** Agent turn that produced the attempt; absent without an open turn. */
  turn?: number
  status: 'solved' | 'rejected'
  /** Question Runtime workflow state (READY / PARSE_FAILED / …). */
  workflowState: string
  domain?: string
  model?: string
  /** Golden-bank id when the stem matched a built-in question. */
  goldenQuestionId?: string
  /** Attempt ordinal for this normalized stem within the session runtime. */
  attempt?: number
  /** Scene a READY solve registered; rejected attempts have none. */
  sceneId?: string
  /** True when the scene was reused from an identical earlier solve. */
  reusedScene?: boolean
  /** Engine verdict summary; absent when no simulation ran (parse-stage rejects). */
  verification?: {
    status: string
    passed: number
    total: number
    failed: readonly { readonly id: string; readonly message?: string }[]
  }
  answers: readonly { readonly key: string; readonly value: string; readonly unit: string }[]
  issues: readonly { readonly code: string; readonly severity: string }[]
  /** Retry-hint codes the rejected result carried (empty for solved runs). */
  retryGuidance: readonly { readonly code: string }[]
  /** Wall-clock duration of the solve call, milliseconds. */
  durationMs: number
}

/**
 * The `physicsSolveTraces` projection's wire value: the session's solve
 * attempts in order, newest last, capped by the fold.
 */
export interface PhysicsSolveTracesProjection {
  traces: readonly PhysicsSolveTrace[]
}
