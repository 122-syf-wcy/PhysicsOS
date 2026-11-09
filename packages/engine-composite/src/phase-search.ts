import { compositeMotionAt } from '@physicsos/physics-composite-core'
import { isFiniteVector, type Vector3 } from '@physicsos/physics-math'
import {
  sameFieldEnvironment,
  sampleFieldsAt,
  type FieldSample,
  type PhysicsScene,
} from '@physicsos/physics-scene'

import type { CompositeModel } from './composite-engine.ts'

/** A cyclotron can cross the gap twice per turn; every search remains capped. */
export const MAX_COMPOSITE_PHASES = 512
const PHASE_SCAN_STEPS = 400
const BISECTION_ROUNDS = 40

export interface CompositePhaseSearchBudget {
  readonly phaseCountBound: number
  readonly scanStepsPerPhase: number
  readonly bisectionRoundsPerBoundary: number
  readonly numericalIterationCountBound: number
}

/** Resolve the actual search limits, without searching a boundary or evaluating motion. */
export const prepareCompositePhaseSearch = (
  scene: PhysicsScene,
  model: CompositeModel,
  endTime: number,
): CompositePhaseSearchBudget => {
  if (endTime === 0) {
    return {
      phaseCountBound: 0,
      scanStepsPerPhase: 0,
      bisectionRoundsPerBoundary: 0,
      numericalIterationCountBound: 0,
    }
  }

  // With no spatially varying membership, the environment is constant everywhere.
  // Non-finite summed fields cannot satisfy the search's equality predicate.
  const sample = scene.regions.every((region) => region.shape.type === 'unbounded')
    ? sampleFieldsAt(scene, model.position)
    : undefined
  const constantEnvironment = sample !== undefined &&
    isFiniteVector(sample.electricField) &&
    isFiniteVector(sample.magneticFluxDensity) &&
    isFiniteVector(sample.gravity)
  const phaseCountBound = constantEnvironment ? 1 : MAX_COMPOSITE_PHASES
  const scanStepsPerPhase = constantEnvironment ? 0 : PHASE_SCAN_STEPS
  const bisectionRoundsPerBoundary = constantEnvironment ? 0 : BISECTION_ROUNDS
  return {
    phaseCountBound,
    scanStepsPerPhase,
    bisectionRoundsPerBoundary,
    numericalIterationCountBound:
      phaseCountBound * (scanStepsPerPhase + bisectionRoundsPerBoundary),
  }
}

export interface CompositePhaseBoundarySearch {
  readonly crossedAt?: number
  readonly crossedSample?: FieldSample
  /** One iteration is one coarse probe or one bisection round, not an ODE step. */
  readonly numericalIterationCount: number
}

/** The actual bounded root search used by phase decomposition. */
export const findCompositePhaseBoundary = (
  scene: PhysicsScene,
  model: CompositeModel,
  position: Vector3,
  velocity: Vector3,
  sample: FieldSample,
  remaining: number,
  budget: CompositePhaseSearchBudget,
): CompositePhaseBoundarySearch => {
  if (budget.scanStepsPerPhase === 0) return { numericalIterationCount: 0 }
  const step = remaining / budget.scanStepsPerPhase
  let numericalIterationCount = 0

  for (let i = 1; i <= budget.scanStepsPerPhase; i += 1) {
    numericalIterationCount += 1
    const dt = step * i
    const probe = compositeMotionAt(model.charge, model.mass, position, velocity, sample, dt)
    const probeSample = sampleFieldsAt(scene, probe.position)
    if (
      !sameFieldEnvironment(sample, probeSample) ||
      probeSample.regionIds.length !== sample.regionIds.length ||
      probeSample.regionIds.some((id) => !sample.regionIds.includes(id))
    ) {
      let low = step * (i - 1)
      let high = dt
      for (let round = 0; round < budget.bisectionRoundsPerBoundary; round += 1) {
        numericalIterationCount += 1
        const mid = (low + high) / 2
        const midMotion = compositeMotionAt(model.charge, model.mass, position, velocity, sample, mid)
        const midSample = sampleFieldsAt(scene, midMotion.position)
        const unchanged =
          sameFieldEnvironment(sample, midSample) &&
          midSample.regionIds.length === sample.regionIds.length &&
          midSample.regionIds.every((id) => sample.regionIds.includes(id))
        if (unchanged) low = mid
        else high = mid
      }
      return {
        crossedAt: high,
        crossedSample: sampleFieldsAt(
          scene,
          compositeMotionAt(model.charge, model.mass, position, velocity, sample, high).position,
        ),
        numericalIterationCount,
      }
    }
  }
  return { numericalIterationCount }
}
