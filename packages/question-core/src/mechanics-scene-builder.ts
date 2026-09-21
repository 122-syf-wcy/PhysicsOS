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

/**
 * Student-facing scene titles.
 *
 * The title reaches the Lab toolbar and the canvas accessible name, so it has to
 * be the name of the physical situation rather than an internal model id.
 */
const MODEL_TITLES: Record<MechanicsModelId, string> = {
  uniform_linear_motion: '匀速直线运动',
  uniformly_accelerated_motion: '匀加速直线运动',
  projectile_motion: '抛体运动',
  newton_second_law: '牛顿第二定律',
  inclined_plane: '斜面运动',
  spring_oscillator: '弹簧振子',
  simple_pendulum: '单摆',
  horizontal_friction: '水平面摩擦',
  spring_statics: '胡克定律',
}

export function buildMechanicsSceneFromIR(
  ir: PhysicsSemanticIR,
  options: { sceneId?: string; questionId?: string; now?: IsoDateTime } = {},
): MechanicsSceneBuildResult {
  const now = options.now ?? new Date().toISOString()
  const model = ir.model as MechanicsModelId
  const sceneId = options.sceneId ?? `question-mechanics-${model}`
  const questionId = options.questionId

  const mass = getKnown(ir, 'mass') ?? 1
  const velocity = getKnown(ir, 'initial_velocity') ?? getKnown(ir, 'velocity') ?? 0
  const acceleration = getKnown(ir, 'acceleration')
  const height = getKnown(ir, 'height')
  const gravity = getKnown(ir, 'gravity') ?? 9.8
  const inclineAngle = ir.inclineAngle ?? 30
  const frictionCoefficient = ir.frictionCoefficient ?? 0
  const horizontalSpeed = getKnown(ir, 'horizontal_speed')
  const launchAngle = ir.launchAngle ?? 0
  /* A stated run duration ("运动 5 s") is the scene's end time; the engine
     reads it off the request and solves to that instant instead of its own
     default window. */
  const endTime = getKnown(ir, 'time')

  const input: Record<string, unknown> = {
    sceneId,
    model,
    mass,
    now,
    title: MODEL_TITLES[model] ?? model,
    ...(questionId === undefined ? {} : { sourceQuestionId: questionId }),
    description:
      options.questionId === undefined
        ? '来自试题空间的力学场景'
        : `来自试题 ${options.questionId} 的力学场景`,
  }

  if (model === 'uniform_linear_motion') {
    input.velocity = vec3(velocity, 0, 0)
    input.position = vec3(0, 0, 0)
    if (endTime !== undefined) input.endTime = endTime
  } else if (model === 'uniformly_accelerated_motion') {
    input.velocity = vec3(velocity, 0, 0)
    input.acceleration = vec3(acceleration ?? 0, 0, 0)
    input.position = vec3(0, 0, 0)
    if (endTime !== undefined) input.endTime = endTime
  } else if (model === 'projectile_motion') {
    /* vx defaults to v0·cosθ — only an explicitly stated 水平分速度 overrides.
       Launch height defaults to the ground (0): a text that says "从 h 高处"
       parses height explicitly, otherwise the throw leaves the ground. */
    const vx = horizontalSpeed ?? velocity * Math.cos((launchAngle * Math.PI) / 180)
    const vy = velocity * Math.sin((launchAngle * Math.PI) / 180)
    input.position = vec3(0, height ?? 0, 0)
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
    if (endTime !== undefined) input.endTime = endTime
  } else if (model === 'inclined_plane') {
    input.mass = mass
    input.position = vec3(0, 0, 0)
    input.velocity = vec3(0, 0, 0)
    input.gravity = vec3(0, -gravity, 0)
    input.inclineAngle = inclineAngle
    input.frictionCoefficient = frictionCoefficient
    if (endTime !== undefined) input.endTime = endTime
  }

  const scene = createMechanicsScene(input as unknown as MechanicsSceneInput)
  return { scene }
}
