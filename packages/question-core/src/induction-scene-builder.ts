/**
 * Induction scene builder: IR → PhysicsScene.
 *
 * Maps the parsed induction question to the induction bench factory
 * (createBarMotionScene / createFluxChangeScene, falling back to
 * createInductionScene with a raw bench spec). It performs NO physics: no EMF
 * is computed, no current is divided out. The induction engine solves the
 * scene this produces (closed form E = BLv / E = -dΦ/dt), and the verifier
 * judges what the engine produced.
 *
 * The IR stores SI (metres, square metres, Wb/s); the bench templates take
 * authoring units (centimetres, cm², Wb/s, tesla, ohms), so this is where the
 * one conversion happens.
 */

import {
  createBarMotionScene,
  createFluxChangeScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import type { IsoDateTime } from '@physicsos/shared'

import type { PhysicsSemanticIR } from './semantic-ir.ts'

export interface InductionSceneBuildResult {
  readonly scene: PhysicsScene
  readonly irToSceneMapping: Record<string, string>
}

const knownValue = (ir: PhysicsSemanticIR, key: string): number | undefined =>
  ir.knowns.find((entry) => entry.key === key)?.value

const METRES_PER_CM = 100
const CM2_PER_M2 = 1e4
const RADIANS_PER_DEGREE = Math.PI / 180

/**
 * Build an induction PhysicsScene from a question IR.
 *
 * Returns a scene the InductionEngine accepts (exactly one induction bench,
 * nothing else). The B and R defaults follow the textbook templates so a
 * validator-passing IR that omitted them still builds a runnable rig — the
 * validator already rejects an IR missing the facts the model needs, so the
 * defaults only ever fill display-grade gaps, not physics gaps.
 */
export function buildInductionSceneFromIR(
  ir: PhysicsSemanticIR,
  options: { sceneId?: string; questionId?: string; now?: IsoDateTime } = {},
): InductionSceneBuildResult {
  const fieldT = knownValue(ir, 'magnetic_field_strength') ?? 0.5
  const resistanceOhm = knownValue(ir, 'resistance_1') ?? knownValue(ir, 'resistance') ?? 5

  const title =
    ir.model === 'bar_motion_emf' ? '试题场景：导体棒切割磁感线' : '试题场景：磁通量变化'
  const description =
    options.questionId === undefined
      ? '由 Induction Question IR 生成'
      : `由试题 ${options.questionId} 的 Induction Question IR 生成`
  const now = options.now
  const sceneId = options.sceneId

  if (ir.model === 'bar_motion_emf') {
    const lengthSI = ir.inductionBarLength ?? knownValue(ir, 'bar_length') ?? 0.2
    const velocity = ir.inductionBarVelocity ?? knownValue(ir, 'bar_velocity') ?? 2
    const scene = createBarMotionScene({
      ...(sceneId === undefined ? {} : { sceneId }),
      magneticFluxDensity: fieldT,
      barLength: lengthSI * METRES_PER_CM,
      barVelocity: velocity,
      resistance: resistanceOhm,
      ...(now === undefined ? {} : { now }),
    })
    scene.metadata.title = title
    scene.metadata.description = description
    return {
      scene,
      irToSceneMapping: {
        conducting_bar: scene.inductionBenches?.[0]?.id ?? 'induction-bench-1',
        magnetic_field: 'induction-bench-1',
        circuit_loop: 'induction-bench-1',
      },
    }
  }

  /* flux_change_emf */
  const areaSI = ir.inductionCoilArea ?? knownValue(ir, 'coil_area') ?? 5e-3
  const angleRad = ir.inductionCoilAngle ?? knownValue(ir, 'coil_angle') ?? 0
  const fluxRate = ir.inductionFluxRate ?? knownValue(ir, 'flux_rate') ?? 0.05
  const scene = createFluxChangeScene({
    ...(sceneId === undefined ? {} : { sceneId }),
    magneticFluxDensity: fieldT,
    coilArea: areaSI * CM2_PER_M2,
    coilAngle: angleRad / RADIANS_PER_DEGREE,
    fluxRate,
    resistance: resistanceOhm,
    ...(now === undefined ? {} : { now }),
  })
  scene.metadata.title = title
  scene.metadata.description = description
  return {
    scene,
    irToSceneMapping: {
      coil: scene.inductionBenches?.[0]?.id ?? 'induction-bench-1',
      magnetic_field: 'induction-bench-1',
      circuit_loop: 'induction-bench-1',
    },
  }
}
