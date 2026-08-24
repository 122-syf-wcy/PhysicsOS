import { vec3, type Vector3 } from '@physicsos/physics-math'
import {
  createElectricScene,
  createParallelPlateScene,
  createPointChargeScene,
  type ElectricFieldDirection,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import type { IsoDateTime } from '@physicsos/shared'

import type { PhysicsSemanticIR, PlanarDirection } from './semantic-ir.ts'

export interface ElectricSceneBuildResult {
  readonly scene: PhysicsScene
  readonly irToSceneMapping: Record<string, string>
}

const knownValue = (ir: PhysicsSemanticIR, key: string): number | undefined =>
  ir.knowns.find((known) => known.key === key)?.value

const directionVector = (direction: PlanarDirection | undefined, magnitude: number): Vector3 => {
  switch (direction) {
    case 'left':
      return vec3(-magnitude, 0, 0)
    case 'up':
      return vec3(0, magnitude, 0)
    case 'down':
      return vec3(0, -magnitude, 0)
    case 'right':
    case 'unknown':
    case undefined:
      return vec3(magnitude, 0, 0)
  }
}

const signedCharge = (ir: PhysicsSemanticIR, magnitude: number): number => {
  if (ir.chargeSign === 'negative') return -Math.abs(magnitude)
  if (ir.chargeSign === 'positive') return Math.abs(magnitude)
  return magnitude
}

export function buildElectricSceneFromIR(
  ir: PhysicsSemanticIR,
  options: { sceneId?: string; questionId?: string; now?: IsoDateTime } = {},
): ElectricSceneBuildResult {
  const particleId = 'particle-1'
  const fieldId = 'electric-field-1'
  const velocityMagnitude = knownValue(ir, 'initial_velocity') ?? 0
  const chargeMagnitude = knownValue(ir, 'charge') ?? 1
  const duration = knownValue(ir, 'time') ?? 5
  const fieldStrength = knownValue(ir, 'electric_field_strength') ?? 1
  const fieldDirection = ir.electricFieldDirection === 'unknown' || ir.electricFieldDirection === undefined
    ? 'right'
    : ir.electricFieldDirection

  const scene = createElectricScene({
    sceneId: options.sceneId ?? 'question-electric-scene',
    particleId,
    fieldId,
    charge: signedCharge(ir, chargeMagnitude),
    mass: knownValue(ir, 'mass') ?? 1,
    position: vec3(0, 0, 0),
    velocity: directionVector(ir.initialVelocityDirection, velocityMagnitude),
    electricFieldStrength: fieldStrength,
    electricFieldDirection: fieldDirection satisfies ElectricFieldDirection,
    duration,
    observableVisibility: {
      electricField: true,
      force: true,
      velocity: true,
      acceleration: true,
      trajectory: true,
      potential: true,
      energy: true,
    },
    ...(options.now === undefined ? {} : { now: options.now }),
    title: '试题场景：匀强电场中的带电粒子',
    description: options.questionId === undefined
      ? '由 Electric Question IR 生成'
      : `由试题 ${options.questionId} 的 Electric Question IR 生成`,
  })

  return {
    scene,
    irToSceneMapping: {
      particle: particleId,
      electric_field: fieldId,
    },
  }
}

/**
 * Build a point-charge Scene from a question IR.
 *
 * One signed source charge sits at the origin; a probe charge is placed at
 * distance r along +x so the field sample point coincides with the probe and the
 * E vector is drawn there. When the IR carries no probe charge, a tiny neutral
 * probe is still emitted so the Question canvas can light up E at the sample
 * point (the engine reports E at the probe position regardless of the probe's
 * own charge, so a near-zero probe does not distort the field).
 */
export const buildPointChargeSceneFromIR = (
  ir: PhysicsSemanticIR,
  options: { sceneId?: string; questionId?: string; now?: IsoDateTime } = {},
): ElectricSceneBuildResult => {
  /* Multi-source: the IR carries a list of signed source charges with positions.
     Sources already carry their sign (parsed from `q1 = -2 μC`); no sign re-derivation.
     The probe sits at the IR's sample position (default the midpoint origin). */
  if (ir.sourceCharges !== undefined && ir.sourceCharges.length >= 2) {
    const charges = ir.sourceCharges.map((source, index) => ({
      id: `source-${index + 1}`,
      charge: source.charge,
      position: vec3(source.position?.x ?? (index === 0 ? -0.1 : 0.1), source.position?.y ?? 0, 0),
    }))
    const sample = ir.samplePosition ?? { x: 0, y: 0 }
    const probe = {
      id: 'probe-1',
      charge: knownValue(ir, 'probe_charge') ?? 1e-12,
      mass: knownValue(ir, 'mass') ?? 1,
      position: vec3(sample.x, sample.y, 0),
    }
    const scene = createPointChargeScene({
      sceneId: options.sceneId ?? 'question-electric-multi-source-scene',
      charges,
      probe,
      samplePoint: { x: sample.x, y: sample.y, z: 0 },
      ...(options.now === undefined ? {} : { now: options.now }),
      title: '试题场景：多源点电荷电场',
      description: options.questionId === undefined
        ? '由 Electric Question IR 生成'
        : `由试题 ${options.questionId} 的 Electric Question IR 生成`,
      ...(options.questionId === undefined ? {} : { sourceQuestionId: options.questionId }),
    })
    return {
      scene,
      irToSceneMapping: {
        source_charges: charges.map((source) => source.id).join(','),
        probe: 'probe-1',
      },
    }
  }

  const sourceId = 'source-1'
  const probeId = 'probe-1'

  const chargeMagnitude = knownValue(ir, 'charge') ?? 0
  const distance = knownValue(ir, 'distance') ?? ir.sourceDistance ?? 0.2
  const probeCharge = knownValue(ir, 'probe_charge')

  /* The probe sits at the sampling distance along +x by default. A directional
     distance ("距其左侧 15 cm") carries an axis + sign that places it off-axis,
     so the rendered field points the way the question describes. */
  const offset = ir.sampleOffset
  const probePosition =
    offset === undefined
      ? vec3(distance, 0, 0)
      : offset.axis === 'x'
        ? vec3(offset.sign * offset.distance, 0, 0)
        : vec3(0, offset.sign * offset.distance, 0)

  /* The source sign is the physics of the field direction. A probe charge is
     optional in the text but a probe object must exist so E is drawn at the sample
     point; when absent, use a near-zero charge so it does not perturb the field. */
  const probe = {
    id: probeId,
    charge: probeCharge ?? 1e-12,
    mass: knownValue(ir, 'mass') ?? 1,
    position: probePosition,
  }

  const scene = createPointChargeScene({
    sceneId: options.sceneId ?? 'question-electric-point-charge-scene',
    charges: [{ id: sourceId, charge: signedCharge(ir, chargeMagnitude), position: vec3(0, 0, 0) }],
    probe,
    ...(options.now === undefined ? {} : { now: options.now }),
    title: '试题场景：点电荷的电场',
    description: options.questionId === undefined
      ? '由 Electric Question IR 生成'
      : `由试题 ${options.questionId} 的 Electric Question IR 生成`,
    ...(options.questionId === undefined ? {} : { sourceQuestionId: options.questionId }),
  })

  return {
    scene,
    irToSceneMapping: {
      source_charge: sourceId,
      probe: probeId,
    },
  }
}

/**
 * Build a parallel-plate / bounded electric field Scene from a question IR.
 *
 * The scene describes a bounded uniform field between two parallel plates. A
 * charged particle enters from the left edge (the usual textbook setup) and
 * follows a parabolic trajectory. The scene only describes the geometry; the
 * engine computes the trajectory.
 */
export const buildParallelPlateSceneFromIR = (
  ir: PhysicsSemanticIR,
  options: { sceneId?: string; questionId?: string; now?: IsoDateTime } = {},
): ElectricSceneBuildResult => {
  const particleId = 'particle-1'
  const fieldId = 'parallel-plate-field-1'

  const chargeMagnitude = knownValue(ir, 'charge') ?? 1.6e-19
  const mass = knownValue(ir, 'mass') ?? 9.11e-31
  const velocityMagnitude = knownValue(ir, 'initial_velocity') ?? 3e7
  const fieldStrength = knownValue(ir, 'electric_field_strength') ?? 2000
  const plateSeparation = ir.plateSeparation ?? 0.04
  const plateLength = ir.plateLength ?? 0.12
  const enterPosition = ir.enterPosition ?? 'edge'

  const fieldDirection: ElectricFieldDirection =
    ir.electricFieldDirection === 'up' ? 'up' :
    ir.electricFieldDirection === 'left' ? 'left' :
    ir.electricFieldDirection === 'right' ? 'right' :
    'down'

  /* Initial position: enter from the left edge → start just outside the field
     region at x = -plateLength/2 - small offset. For center entry, start above
     the gap at y = plateSeparation/2 + offset. */
  const position: Vector3 = enterPosition === 'edge'
    ? vec3(-plateLength / 2 - 0.01, 0, 0)
    : vec3(0, plateSeparation / 2 + 0.01, 0)

  /* Initial velocity: "水平射入" → along +x; default is horizontal. */
  const velocityDir = ir.initialVelocityDirection ?? 'right'
  const velocity: Vector3 = velocityDir === 'left'
    ? vec3(-velocityMagnitude, 0, 0)
    : velocityDir === 'up'
      ? vec3(0, velocityMagnitude, 0)
      : velocityDir === 'down'
        ? vec3(0, -velocityMagnitude, 0)
        : vec3(velocityMagnitude, 0, 0)

  /* Duration: estimate from plate length and velocity (time to traverse the field).
     Use a generous multiple so the trajectory covers the full field region. */
  const traverseTime = plateLength / Math.max(velocityMagnitude, 1e-10)
  const duration = traverseTime * 2

  const scene = createParallelPlateScene({
    sceneId: options.sceneId ?? 'question-parallel-plate-scene',
    particleId,
    fieldId,
    charge: signedCharge(ir, chargeMagnitude),
    mass,
    position,
    velocity,
    electricFieldStrength: fieldStrength,
    electricFieldDirection: fieldDirection,
    plateSeparation,
    plateLength,
    duration,
    observableVisibility: {
      electricField: true,
      force: true,
      velocity: true,
      acceleration: true,
      trajectory: true,
      energy: true,
    },
    ...(options.now === undefined ? {} : { now: options.now }),
    title: '试题场景：平行板电场中的带电粒子',
    description: options.questionId === undefined
      ? '由 Electric Question IR 生成'
      : `由试题 ${options.questionId} 的 Electric Question IR 生成`,
    ...(options.questionId === undefined ? {} : { sourceQuestionId: options.questionId }),
  })

  return {
    scene,
    irToSceneMapping: {
      particle: particleId,
      electric_field: fieldId,
    },
  }
}
