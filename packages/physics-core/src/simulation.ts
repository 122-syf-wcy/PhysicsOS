import type { IsoDateTime, SceneId, SimulationId, PhysicsEventId } from '@physicsos/shared'
import type { Quantity } from '@physicsos/physics-units'

import type { PhysicsDomain, TraceContext } from './common.ts'
import type { DerivedQuantity, Measurement, SimulationState } from './simulation-state.ts'
import type { VerificationResult } from './verification.ts'

/**
 * Minimal event shape for generic constraint. The full PhysicsEvent contract
 * lives in physics-scene; this interface exists only to constrain SimulationResult
 * without creating a dependency cycle.
 */
export interface PhysicsEventLike {
  eventId: PhysicsEventId
  sceneId: SceneId
  revision: number
  type: string
  /**
   * Scene time in seconds at which the event occurs, when the engine knows it.
   *
   * Optional because the minimal constraint existed before any engine produced
   * timed events: a single-field model whose event order is implicit (e.g. the
   * magnetic orbit) has no meaningful time to attach. Composite phase-boundary
   * events DO carry their phase end time, so the timeline can place them without
   * the runtime reconstructing it from the state stream.
   */
  time?: number
}

/** docs/03 §77 */
export interface SimulationOptions {
  startTime?: Quantity<'time'>
  endTime?: Quantity<'time'>
  timeStep?: Quantity<'time'>
  outputSampleRate?: number
  solver?: string
  tolerance?: {
    absolute: number
    relative: number
  }
  maxIterations?: number
  randomSeed?: number
}

/** docs/03 §76 */
export interface SimulationRequest {
  schemaVersion: 'simulation-request/1.0'
  simulationId: SimulationId
  sceneId: SceneId
  sceneRevision: number
  requestedDomain?: PhysicsDomain
  options: SimulationOptions
  trace: TraceContext
}

/** docs/03 §83 */
export interface SimulationMetadata {
  engineId: string
  engineVersion: string
  solver?: string
  startedAt: IsoDateTime
  finishedAt: IsoDateTime
  durationMs: number
  deterministic: boolean
  randomSeed?: number
}

/**
 * docs/03 §84. `PhysicsEvent` is declared in physics-scene (it is a scene
 * lifecycle concept), so the event array is generic here to keep the dependency
 * direction physics-scene -> physics-core. The PhysicsEventLike constraint prevents
 * arbitrary event types from being used.
 */
export interface SimulationResult<TEvent extends PhysicsEventLike = PhysicsEventLike> {
  schemaVersion: 'simulation-result/1.0'
  simulationId: SimulationId
  sceneId: SceneId
  sceneRevision: number
  states: SimulationState[]
  events: TEvent[]
  measurements: Measurement[]
  derivedQuantities: DerivedQuantity[]
  verification: VerificationResult
  metadata: SimulationMetadata
  trace: TraceContext
}

export const SIMULATION_REQUEST_SCHEMA = 'simulation-request/1.0' as const
export const SIMULATION_RESULT_SCHEMA = 'simulation-result/1.0' as const

/* ---------------------------------------------------------- worker contract -- */

/**
 * docs/05 §124 — progress reports emitted by a running worker.
 *
 * Plain, JSON-serializable data only (docs/02 §125: worker messages carry no
 * functions, DOM references or arbitrary objects). `progress` is the completed
 * fraction of the requested time range, in `[0, 1]`.
 */
export interface SimulationProgress {
  readonly simulationId: SimulationId
  /** Completed fraction of the simulation, `0 <= progress <= 1`. */
  readonly progress: number
  /** Scene time (seconds) reached when the last completed step was sampled. */
  readonly simulatedTime?: number
  /** Short human-readable status, when the worker has one to report. */
  readonly message?: string
}

/**
 * docs/02 §56 / docs/05 §123 — worker-side failure envelope.
 *
 * Mirrors the standard DomainError shape so callers can branch on a stable
 * `code` without sniffing message text. `retryable` says whether the same
 * request may succeed on a retry.
 */
export interface SimulationError {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly details?: Record<string, unknown>
}

/**
 * The wire contract between the UI (main) thread and a physics computation
 * worker (docs/01 §34, docs/02 §26/#125, docs/05 §122-123).
 *
 * Every message is a discriminated union with a `schemaVersion` tag; nothing
 * else may cross the boundary. Main thread -> worker is a `simulation-request`;
 * worker -> main thread is `simulation-progress` (`SimulationProgress`),
 * `simulation-result` (`SimulationResult`) or `simulation-error`
 * (`SimulationError`). The payloads are the same immutable contracts used
 * in-process, so a worker-ified engine and a synchronous engine produce
 * byte-identical results for identical input.
 */
export type SimulationWorkerMessage =
  | {
      readonly schemaVersion: typeof SIMULATION_WORKER_SCHEMA
      readonly kind: 'simulation-request'
      readonly payload: SimulationRequest
    }
  | {
      readonly schemaVersion: typeof SIMULATION_WORKER_SCHEMA
      readonly kind: 'simulation-progress'
      readonly payload: SimulationProgress
    }
  | {
      readonly schemaVersion: typeof SIMULATION_WORKER_SCHEMA
      readonly kind: 'simulation-result'
      readonly payload: SimulationResult
    }
  | {
      readonly schemaVersion: typeof SIMULATION_WORKER_SCHEMA
      readonly kind: 'simulation-error'
      readonly payload: SimulationError
    }

export const SIMULATION_WORKER_SCHEMA = 'simulation-worker/1.0' as const

/** Discriminator values for {@link SimulationWorkerMessage}, for switch exhaustiveness. */
export const SIMULATION_WORKER_MESSAGE_KINDS = [
  'simulation-request',
  'simulation-progress',
  'simulation-result',
  'simulation-error',
] as const

/**
 * Narrow a raw posted message to a {@link SimulationWorkerMessage}.
 *
 * The worker boundary cannot trust the other end to send well-formed types, so
 * every inbound message is validated here before it drives any computation or
 * state. Each kind gets its own shape check — schema tag, required fields, and
 * the numeric/boolean field constraints that matter for safety (`progress` must
 * be in `[0, 1]`, `retryable` must be a boolean, …). This is structural
 * validation, not a deep re-check of every nested contract object (e.g. each
 * `SimulationState` inside a result): a valid envelope with structurally sound
 * payload is narrowed and returned, and anything else yields `undefined`.
 */
export const parseSimulationWorkerMessage = (raw: unknown): SimulationWorkerMessage | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  if (record.schemaVersion !== SIMULATION_WORKER_SCHEMA) return undefined
  const kind = record.kind
  if (typeof kind !== 'string') return undefined
  const payload = record.payload
  if (typeof payload !== 'object' || payload === null) return undefined
  const body = payload as Record<string, unknown>

  switch (kind) {
    case 'simulation-request': {
      if (body.schemaVersion !== 'simulation-request/1.0') return undefined
      if (typeof body.simulationId !== 'string' || typeof body.sceneId !== 'string') return undefined
      if (typeof body.sceneRevision !== 'number' || !Number.isFinite(body.sceneRevision)) return undefined
      if (typeof body.options !== 'object' || body.options === null) return undefined
      if (typeof body.trace !== 'object' || body.trace === null) return undefined
      return record as unknown as SimulationWorkerMessage
    }
    case 'simulation-progress': {
      if (typeof body.simulationId !== 'string') return undefined
      if (typeof body.progress !== 'number' || !Number.isFinite(body.progress)) return undefined
      if (body.progress < 0 || body.progress > 1) return undefined
      if (
        body.simulatedTime !== undefined &&
        (typeof body.simulatedTime !== 'number' || !Number.isFinite(body.simulatedTime))
      ) {
        return undefined
      }
      return record as unknown as SimulationWorkerMessage
    }
    case 'simulation-result': {
      if (body.schemaVersion !== 'simulation-result/1.0') return undefined
      if (typeof body.simulationId !== 'string' || typeof body.sceneId !== 'string') return undefined
      if (!Array.isArray(body.states) || !Array.isArray(body.events)) return undefined
      return record as unknown as SimulationWorkerMessage
    }
    case 'simulation-error': {
      if (typeof body.code !== 'string' || typeof body.message !== 'string') return undefined
      if (typeof body.retryable !== 'boolean') return undefined
      return record as unknown as SimulationWorkerMessage
    }
    default:
      return undefined
  }
}
