import { vec3 } from '@physicsos/physics-math'
import type { IsoDateTime } from '@physicsos/shared'
import { createMechanicsScene, type MechanicsSceneInput, type MechanicsModelId } from '@physicsos/physics-scene'
import type { PhysicsScene } from '@physicsos/physics-scene'
import type { PhysicsSemanticIR } from './semantic-ir.ts'

export interface MechanicsSceneBuildResult {
  scene: PhysicsScene
}

function getKnown(ir: PhysicsSemanticIR, key: string): number | undefined {
  const k = ir.knowns.find((kv) => kv.key === key)
  return k?.value
}

export function buildMechanicsSceneFromIR(
  ir: PhysicsSemanticIR,
  options: { sceneId?: string; questionId?: string; now?: IsoDateTime } = {},
): MechanicsSceneBuildResult {
  const now = options.now ?? new Date().toISOString()
  const model = ir.model as MechanicsModelId
  const sceneId = options.sceneId ?? `question-mechanics-${model}`

  const mass = getKnown(ir, 'mass') ?? 1
  const velocity = getKnown(ir, 'initial_velocity') ?? getKnown(ir, 'velocity') ?? 0
  const acceleration = getKnown(ir, 'acceleration')
  const height = getKnown(ir, 'height') ?? 20
  const gravity = getKnown(ir, 'gravity') ?? 9.8
  const inclineAngle = ir.inclineAngle ?? 30
  const frictionCoefficient = ir.frictionCoefficient ?? 0
  const horizontalSpeed = getKnown(ir, 'horizontal_speed') ?? velocity
  const launchAngle = ir.launchAngle ?? 0

  const input: Record<string, unknown> = {
    sceneId,
    model,
    mass,
    now,
    title: `Mechanics Question: ${model}`,
    description:
      options.questionId === undefined
        ? `Generated from Question IR for model ${model}`
        : `Generated from question ${options.questionId} for model ${model}`,
  }

  if (model === 'uniform_linear_motion') {
    input.velocity = vec3(velocity, 0, 0)
    input.position = vec3(0, 0, 0)
  } else if (model === 'uniformly_accelerated_motion') {
    input.velocity = vec3(velocity, 0, 0)
    input.acceleration = vec3(acceleration ?? 0, 0, 0)
    input.position = vec3(0, 0, 0)
  } else if (model === 'projectile_motion') {
    const vx = horizontalSpeed > 0 ? horizontalSpeed : velocity * Math.cos((launchAngle * Math.PI) / 180)
    const vy = velocity * Math.sin((launchAngle * Math.PI) / 180)
    input.position = vec3(0, height, 0)
    input.velocity = vec3(vx, vy, 0)
    input.gravity = vec3(0, -gravity, 0)
    input.groundY = 0
    input.launchAngle = launchAngle
  } else if (model === 'newton_second_law') {
    const force = getKnown(ir, 'applied_force') ?? 0
    input.mass = mass
    input.position = vec3(0, 0, 0)
    input.velocity = vec3(0, 0, 0)
    input.appliedForce = vec3(force, 0, 0)
    input.gravity = vec3(0, -gravity, 0)
  } else if (model === 'inclined_plane') {
    input.mass = mass
    input.position = vec3(0, 0, 0)
    input.velocity = vec3(0, 0, 0)
    input.gravity = vec3(0, -gravity, 0)
    input.inclineAngle = inclineAngle
    input.frictionCoefficient = frictionCoefficient
  }

  const scene = createMechanicsScene(input as unknown as MechanicsSceneInput)
  return { scene }
}
