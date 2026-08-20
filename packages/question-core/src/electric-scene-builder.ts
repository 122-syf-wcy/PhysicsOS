import { vec3, type Vector3 } from '@physicsos/physics-math'
import {
  createElectricScene,
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
