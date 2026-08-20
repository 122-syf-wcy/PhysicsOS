import type { Quantity } from '@physicsos/physics-units'

import type { DomainError, PhysicsDomain } from './common.ts'
import type { PhysicsEventLike, SimulationRequest, SimulationResult } from './simulation.ts'
import type { SimulationState } from './simulation-state.ts'
import type { VerificationResult } from './verification.ts'

/**
 * Structured verdict on whether an engine may handle a scene. When conditions
 * fail the engine must report why instead of silently applying formulas whose
 * preconditions do not hold (docs/05 §33).
 */
export type ModelSupport =
  | { readonly supported: true; readonly modelId: string; readonly domain: PhysicsDomain }
  | {
      readonly supported: false
      readonly reason: 'unsupported_model' | 'invalid_model_condition'
      readonly modelId?: string
      readonly failedConditions: readonly ModelConditionFailure[]
    }

export interface ModelConditionFailure {
  readonly condition: string
  readonly message: string
  readonly details?: Record<string, unknown>
}

export const supported = (modelId: string, domain: PhysicsDomain): ModelSupport => ({
  supported: true,
  modelId,
  domain,
})

export const unsupportedModel = (
  failedConditions: readonly ModelConditionFailure[],
  modelId?: string,
): ModelSupport => ({
  supported: false,
  reason: 'unsupported_model',
  ...(modelId === undefined ? {} : { modelId }),
  failedConditions,
})

export const invalidModelCondition = (
  modelId: string,
  failedConditions: readonly ModelConditionFailure[],
): ModelSupport => ({
  supported: false,
  reason: 'invalid_model_condition',
  modelId,
  failedConditions,
})

/**
 * Contract every physics engine implements (docs/05 §27). `TScene` is generic so
 * physics-core does not depend on physics-scene; concrete engines bind it to
 * `PhysicsScene`.
 */
export interface PhysicsEngine<TScene, TEvent extends PhysicsEventLike = PhysicsEventLike> {
  readonly engineId: string
  readonly engineVersion: string
  readonly domain: PhysicsDomain

  /** Decides whether this engine can model the scene, with reasons on failure. */
  canHandle(scene: TScene): ModelSupport

  /** Validates scene invariants before any solving happens. */
  validate(scene: TScene): VerificationResult

  /** Closed-form state at an arbitrary time; the timeline uses this for seeking. */
  stateAt(scene: TScene, time: Quantity<'time'>): SimulationState

  /** Runs the simulation and returns sampled states plus derived quantities. */
  simulate(scene: TScene, request: SimulationRequest): SimulationResult<TEvent>
}

export class EngineUnsupportedError extends Error {
  readonly domainError: DomainError

  constructor(engineId: string, support: Extract<ModelSupport, { supported: false }>) {
    const conditions = support.failedConditions.map((entry) => entry.condition).join(', ')
    super(`Engine "${engineId}" cannot model this scene (${support.reason}): ${conditions}`)
    this.name = 'EngineUnsupportedError'
    this.domainError = {
      code:
        support.reason === 'unsupported_model' ? 'UNSUPPORTED_MODEL' : 'INVALID_MODEL_CONDITION',
      message: this.message,
      category: 'unsupported',
      retryable: false,
      details: {
        engineId,
        ...(support.modelId === undefined ? {} : { modelId: support.modelId }),
        failedConditions: support.failedConditions.map((entry) => ({
          condition: entry.condition,
          message: entry.message,
        })),
      },
    }
  }
}
