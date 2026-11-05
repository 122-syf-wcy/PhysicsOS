import {
  check,
  summarizeVerification,
  type VerificationCheck,
  type VerificationIssue,
  type VerificationResult,
  type SimulationResult,
  type DerivedQuantity,
  toCanonicalVector,
  withinTolerance,
} from '@physicsos/physics-core'
import { magnitude, add, scale, type Vector3 } from '@physicsos/physics-math'
import { validateScene, type PhysicsScene } from '@physicsos/physics-scene'
import { canonicalValue } from '@physicsos/physics-units'

/** Read the prescribed constant acceleration from scene inputs, never engine output. */
const prescribedAcceleration = (scene: PhysicsScene): Vector3 | undefined => {
  const body = scene.bodies[0]
  if (body === undefined) return undefined
  if (
    scene.constraints.some((c) => c.type === 'spring' || c.type === 'rope') ||
    scene.observableDefinitions.some((o) =>
      ['orbit', 'friction_surface'].includes(String(o.parameters?.['kind'])),
    )
  )
    return undefined
  const gravityField = scene.fields.find((f) => f.type === 'uniform_gravity')
  const gravity =
    gravityField?.type === 'uniform_gravity'
      ? toCanonicalVector(gravityField.acceleration).vectorSI
      : { x: 0, y: -9.8, z: 0 }
  if (scene.observableDefinitions.some((o) => o.parameters?.['kind'] === 'ground')) {
    return { x: 0, y: -Math.abs(gravity.y), z: 0 }
  }
  if (scene.observableDefinitions.some((o) => o.parameters?.['kind'] === 'incline'))
    return undefined
  const custom = scene.forces.filter((f) => f.type === 'custom' && f.targetId === body.id)
  if (custom.length > 0) {
    let acceleration = custom.reduce(
      (a, f) =>
        f.vector === undefined
          ? a
          : add(a, scale(toCanonicalVector(f.vector).vectorSI, 1 / canonicalValue(body.mass))),
      { x: 0, y: 0, z: 0 },
    )
    if (scene.forces.some((f) => f.type === 'gravity' && f.targetId === body.id))
      acceleration = add(acceleration, gravity)
    if (scene.forces.some((f) => f.type === 'normal' && f.targetId === body.id))
      acceleration = add(acceleration, scale(gravity, -1))
    return acceleration
  }
  return body.acceleration === undefined
    ? { x: 0, y: 0, z: 0 }
    : toCanonicalVector(body.acceleration).vectorSI
}

const vectorMatches = (actual: Vector3, expected: Vector3): boolean =>
  (['x', 'y', 'z'] as const).every((axis) => withinTolerance(actual[axis], expected[axis]))

interface ExpectedState {
  position: Vector3
  velocity: Vector3
  acceleration: Vector3
  incline?: {
    acceleration: number
    friction: Vector3
    normalForce: number
    gravityParallel: number
    gravityNormal: number
  }
}

/** Independent scene-only Coulomb model: integrate to zero speed, then stick or slide. */
const prescribedInclineMotion = (scene: PhysicsScene): ((time: number) => ExpectedState) | undefined => {
  const body = scene.bodies[0]
  const incline = scene.observableDefinitions.find((o) => o.parameters?.['kind'] === 'incline')
  if (body === undefined || incline === undefined) return undefined
  const angle = Number(incline.parameters?.['angle'] ?? 30) * Math.PI / 180
  const along = { x: Math.cos(angle), y: -Math.sin(angle), z: 0 }
  const position = toCanonicalVector(body.position).vectorSI
  const velocity = toCanonicalVector(body.velocity).vectorSI
  const initialSpeed = velocity.x * along.x + velocity.y * along.y
  const mass = canonicalValue(body.mass)
  const field = scene.fields.find((entry) => entry.type === 'uniform_gravity')
  const gravity = field?.type === 'uniform_gravity'
    ? magnitude(toCanonicalVector(field.acceleration).vectorSI) : 9.8
  const friction = scene.forces.find((entry) => entry.type === 'friction' && entry.targetId === body.id)
  const mu = friction?.model === 'kinetic_friction' ? (body.material?.frictionCoefficient ?? 0) : 0
  const gravityParallel = gravity * Math.sin(angle)
  const gravityNormal = gravity * Math.cos(angle)
  const frictionAcceleration = mu * gravityNormal
  const restAcceleration = gravityParallel - Math.sign(gravityParallel)
    * Math.min(Math.abs(gravityParallel), frictionAcceleration)
  const initialAcceleration = Math.abs(initialSpeed) > 1e-10
    ? gravityParallel - Math.sign(initialSpeed) * frictionAcceleration : restAcceleration
  const stopTime = initialSpeed * initialAcceleration < 0 ? -initialSpeed / initialAcceleration : Infinity
  return (time) => {
    const slidingTime = Math.min(time, stopTime)
    const remaining = time - slidingTime
    const displacement = initialSpeed * slidingTime + 0.5 * initialAcceleration * slidingTime ** 2
      + 0.5 * restAcceleration * remaining ** 2
    const speed = time < stopTime ? initialSpeed + initialAcceleration * time : restAcceleration * remaining
    const acceleration = time < stopTime ? initialAcceleration : restAcceleration
    return {
      position: add(position, scale(along, displacement)),
      velocity: scale(along, speed),
      acceleration: scale(along, acceleration),
      incline: { acceleration, friction: scale(along, mass * (acceleration - gravityParallel)),
        normalForce: mass * gravityNormal, gravityParallel, gravityNormal },
    }
  }
}

const derivedMatches = (
  quantities: readonly DerivedQuantity[], expected: ExpectedState, mass: number, displacement?: Vector3,
): boolean => {
  const vectors: Record<string, Vector3> = {
    acceleration: expected.acceleration, net_force: scale(expected.acceleration, mass),
    ...(displacement === undefined ? {} : { displacement }),
  }
  const scalars: Record<string, number> = {
    final_velocity: magnitude(expected.velocity), velocity_magnitude: magnitude(expected.velocity),
  }
  if (expected.incline !== undefined) {
    const incline = expected.incline
    vectors['friction_vector'] = incline.friction
    Object.assign(scalars, { incline_acceleration: incline.acceleration,
      friction_force: magnitude(incline.friction), normal_force: incline.normalForce,
      gravity_parallel: incline.gravityParallel, gravity_normal: incline.gravityNormal })
    const required = ['acceleration', 'net_force', 'velocity_magnitude', 'friction_vector',
      'incline_acceleration', 'friction_force', 'normal_force', 'gravity_parallel', 'gravity_normal']
    if (required.some(key => !quantities.some(entry => entry.key === key))) return false
  }
  return quantities.every(({ key, value }) => {
    const vector = vectors[key]
    if (vector !== undefined)
      return 'vector' in value && vectorMatches(toCanonicalVector(value).vectorSI, vector)
    const scalar = scalars[key]
    if (scalar !== undefined)
      return 'value' in value && withinTolerance(canonicalValue(value), scalar)
    return true
  })
}

export const MECHANICS_VERIFIER_ASSUMPTIONS = [
  'analytical solver',
  'constant forces',
  '2D motion',
  'no air resistance',
] as const

export function verifyNewtonSecondLaw(
  mass: number,
  netForce: Vector3,
  acceleration: Vector3,
): VerificationCheck {
  const computedForce = scale(acceleration, mass)
  const diff = magnitude(add(computedForce, scale(netForce, -1)))
  return check('newton_second_law', 'numerical', diff < 1e-6, {
    message: diff < 1e-6 ? 'ΣF = ma verified.' : `ΣF ≠ ma: diff = ${diff}`,
    details: { mass, netForce, acceleration, computedForce, diff },
  })
}

export function verifyKinematicConsistency(
  initialVelocity: Vector3,
  acceleration: Vector3,
  time: number,
  finalVelocity: Vector3,
  finalPosition: Vector3,
  initialPosition: Vector3,
): VerificationCheck {
  const expectedV = add(initialVelocity, scale(acceleration, time))
  const expectedPosition = add(
    add(initialPosition, scale(initialVelocity, time)),
    scale(acceleration, 0.5 * time * time),
  )
  const vDiff = magnitude(add(finalVelocity, scale(expectedV, -1)))
  const positionDiff = magnitude(add(finalPosition, scale(expectedPosition, -1)))
  const passed = vDiff < 0.1 && positionDiff < 0.1
  return check('kinematic_consistency', 'numerical', passed, {
    message: passed
      ? 'v(t) = v0 + at and x(t) = x0 + v0t + 0.5at^2 verified.'
      : `Kinematic mismatch: velocity diff = ${vDiff}, position diff = ${positionDiff}`,
    details: { vDiff, positionDiff, expectedV, expectedPosition },
  })
}

export function verifyProjectileHorizontalVelocity(
  states: readonly {
    time: { value: number }
    objects: { id: string; velocity?: { vector: Vector3; unit: string; dimension: string } }[]
  }[],
  bodyId: string,
): VerificationCheck {
  if (states.length < 2)
    return check('projectile_vx_constant', 'conservation', true, {
      message: 'Insufficient states.',
    })
  const firstObj = states[0]?.objects.find((o) => o.id === bodyId)
  const lastObj = states[states.length - 1]?.objects.find((o) => o.id === bodyId)
  if (!firstObj?.velocity || !lastObj?.velocity)
    return check('projectile_vx_constant', 'conservation', true, { message: 'No velocity data.' })
  const vx0 = firstObj.velocity.vector.x
  const vx1 = lastObj.velocity.vector.x
  const diff = Math.abs(vx0 - vx1)
  return check('projectile_vx_constant', 'conservation', diff < 0.01, {
    message: diff < 0.01 ? 'Horizontal velocity constant.' : `vx changed: diff = ${diff}`,
    details: { vx0, vx1, diff },
  })
}

export function verifyProjectileVerticalAcceleration(
  acceleration: Vector3,
  gravity: Vector3,
): VerificationCheck {
  const gMag = magnitude(gravity)
  const expectedAy = -gMag
  const diff = Math.abs(acceleration.y - expectedAy)
  return check('projectile_ay', 'constraint', diff < 1e-10, {
    message: diff < 1e-10 ? 'ay = -g verified.' : `ay ≠ -g: diff = ${diff}`,
    details: { ay: acceleration.y, expectedAy, diff },
  })
}

export function verifyProjectileImpact(
  finalY: number,
  groundY: number,
  tolerance = 0.5,
): VerificationCheck {
  const diff = Math.abs(finalY - groundY)
  return check('projectile_impact', 'boundary', diff < tolerance, {
    message:
      diff < tolerance ? 'Impact y ≈ groundY.' : `Impact y = ${finalY}, groundY = ${groundY}`,
    details: { finalY, groundY, diff, tolerance },
  })
}

export function verifyInclineForceDecomposition(
  gravity: Vector3,
  inclineAngle: number,
  gravityParallel: number,
  gravityNormal: number,
  normalForce: number,
  mass: number,
): VerificationCheck[] {
  const g = magnitude(gravity)
  const angleRad = (inclineAngle * Math.PI) / 180
  const expectedParallel = g * Math.sin(angleRad)
  const expectedNormal = g * Math.cos(angleRad)
  const expectedNormalForce = mass * expectedNormal

  return [
    check('incline_mg_sin', 'numerical', Math.abs(gravityParallel - expectedParallel) < 1e-6, {
      message: 'mg*sin(θ) verified.',
      details: { gravityParallel, expectedParallel },
    }),
    check('incline_mg_cos', 'numerical', Math.abs(gravityNormal - expectedNormal) < 1e-6, {
      message: 'mg*cos(θ) verified.',
      details: { gravityNormal, expectedNormal },
    }),
    check('incline_normal_force', 'numerical', Math.abs(normalForce - expectedNormalForce) < 1e-6, {
      message: 'N = mg*cos(θ) verified.',
      details: { normalForce, expectedNormalForce },
    }),
  ]
}

export function verifyMechanicsScene(scene: PhysicsScene): VerificationResult {
  const checks: VerificationCheck[] = []
  const warnings: VerificationIssue[] = []
  const errors: VerificationIssue[] = []
  try {
    const validation = validateScene(scene)
    checks.push(...validation.checks)
    warnings.push(...validation.warnings)
    errors.push(...validation.errors)
  } catch (error: unknown) {
    checks.push(
      check('mechanics_scene_valid', 'schema', false, {
        message: error instanceof Error ? error.message : 'Mechanics scene validation failed.',
      }),
    )
  }
  checks.push(
    check('mechanics_scene_2d', 'constraint', scene.dimension === '2d', {
      message: 'Mechanics V1 requires a 2D scene.',
    }),
    check('mechanics_scene_single_body', 'constraint', scene.bodies.length === 1, {
      message: 'Mechanics V1 requires exactly one rigid body.',
      details: { bodyCount: scene.bodies.length },
    }),
  )
  return summarizeVerification(checks, warnings, errors)
}

export function verifyMechanicsSimulation(
  scene: PhysicsScene,
  simulation: SimulationResult,
): VerificationResult {
  const sceneVerification = verifyMechanicsScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]
  const bodyId = scene.bodies[0]?.id
  const statesContainBody =
    bodyId !== undefined &&
    simulation.states.length > 0 &&
    simulation.states.every((state) => {
      const body = state.objects.find((object) => object.id === bodyId)
      return body?.position !== undefined && body.velocity !== undefined
    })
  checks.push(
    check(
      'mechanics_result_schema',
      'schema',
      simulation.schemaVersion === 'simulation-result/1.0',
      {
        message: 'SimulationResult must use schema simulation-result/1.0.',
      },
    ),
    check('mechanics_result_scene_id', 'schema', simulation.sceneId === scene.id, {
      message: 'SimulationResult must reference the supplied scene id.',
      details: { expected: scene.id, actual: simulation.sceneId },
    }),
    check(
      'mechanics_result_scene_revision',
      'schema',
      simulation.sceneRevision === scene.revision,
      {
        message: 'SimulationResult must reference the supplied scene revision.',
        details: { expected: scene.revision, actual: simulation.sceneRevision },
      },
    ),
    check('mechanics_result_body_states', 'trajectory', statesContainBody, {
      message: 'Every mechanics state must contain the scene body position and velocity.',
      details: { bodyId, stateCount: simulation.states.length },
    }),
  )
  if (statesContainBody && scene.bodies[0] !== undefined) {
    const body = scene.bodies[0]
    try {
      const initialPosition = toCanonicalVector(body.position).vectorSI
      const initialVelocity = toCanonicalVector(body.velocity).vectorSI
      const acceleration = prescribedAcceleration(scene)
      const expectedAt = prescribedInclineMotion(scene) ?? (acceleration === undefined ? undefined
        : (time: number): ExpectedState => ({
          position: add(add(initialPosition, scale(initialVelocity, time)), scale(acceleration, 0.5 * time * time)),
          velocity: add(initialVelocity, scale(acceleration, time)), acceleration,
        }))
      const mass = canonicalValue(body.mass)
      let finite = true
      let kinematics = true
      let accelerationMatches = true
      let frameDerivedMatches = true
      let previousTime = -Infinity
      for (const state of simulation.states) {
        const time = canonicalValue(state.time)
        const object = state.objects.find((o) => o.id === body.id)!
        const position = toCanonicalVector(object.position!).vectorSI
        const velocity = toCanonicalVector(object.velocity!).vectorSI
        finite &&=
          Number.isFinite(time) &&
          time >= 0 &&
          time >= previousTime &&
          [...Object.values(position), ...Object.values(velocity)].every(Number.isFinite)
        previousTime = time
        if (expectedAt !== undefined) {
          const expected = expectedAt(time)
          kinematics &&=
            vectorMatches(velocity, expected.velocity) && vectorMatches(position, expected.position)
          accelerationMatches &&=
            object.acceleration !== undefined &&
            vectorMatches(toCanonicalVector(object.acceleration).vectorSI, expected.acceleration)
          frameDerivedMatches &&= derivedMatches(state.derived, expected, mass)
        }
      }
      checks.push(
        check('mechanics_numeric_states', 'numerical', finite, {
          message: 'All states must be finite and ordered in scene time.',
        }),
      )
      if (expectedAt !== undefined) {
        const first = simulation.states[0]!
        const last = simulation.states.at(-1)!
        const endTime = canonicalValue(last.time)
        const startTime = canonicalValue(first.time)
        const final = expectedAt(endTime)
        const displacement = add(final.position, scale(expectedAt(startTime).position, -1))
        const summaryMatches = derivedMatches(simulation.derivedQuantities, final, mass, displacement)
        checks.push(
          check('mechanics_derived_consistency', 'numerical', frameDerivedMatches, {
            message: 'Every frame derived quantity must agree with independently resolved scene motion and forces.',
          }),
          check('mechanics_summary_consistency', 'numerical', summaryMatches, {
            message:
              'Summary velocity, displacement, acceleration and force must agree with the sampled window.',
          }),
          check('mechanics_kinematic_consistency', 'numerical', kinematics, {
            message:
              'Every sampled position and velocity must satisfy the scene initial conditions and acceleration.',
          }),
          check('mechanics_prescribed_acceleration', 'numerical', accelerationMatches, {
            message:
              'Every sampled acceleration must match the independently resolved scene forces.',
          }),
        )
      }
    } catch (error) {
      checks.push(
        check('mechanics_numeric_states', 'numerical', false, {
          message: error instanceof Error ? error.message : 'Invalid numeric mechanics state.',
        }),
      )
    }
  }
  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}
