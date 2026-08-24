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
