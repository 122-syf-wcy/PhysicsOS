import {
  check,
  summarizeVerification,
  type VerificationCheck,
  type VerificationIssue,
  type VerificationResult,
  type SimulationResult,
} from '@physicsos/physics-core'
import { magnitude, add, scale, type Vector3 } from '@physicsos/physics-math'
import { validateScene, type PhysicsScene } from '@physicsos/physics-scene'

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
  states: readonly { time: { value: number }; objects: { id: string; velocity?: { vector: Vector3; unit: string; dimension: string } }[] }[],
  bodyId: string,
): VerificationCheck {
  if (states.length < 2) return check('projectile_vx_constant', 'conservation', true, { message: 'Insufficient states.' })
  const firstObj = states[0]?.objects.find((o) => o.id === bodyId)
  const lastObj = states[states.length - 1]?.objects.find((o) => o.id === bodyId)
  if (!firstObj?.velocity || !lastObj?.velocity) return check('projectile_vx_constant', 'conservation', true, { message: 'No velocity data.' })
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
    message: diff < tolerance ? 'Impact y ≈ groundY.' : `Impact y = ${finalY}, groundY = ${groundY}`,
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
    checks.push(check('mechanics_scene_valid', 'schema', false, {
      message: error instanceof Error ? error.message : 'Mechanics scene validation failed.',
    }))
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
    check('mechanics_result_schema', 'schema', simulation.schemaVersion === 'simulation-result/1.0', {
      message: 'SimulationResult must use schema simulation-result/1.0.',
    }),
    check('mechanics_result_scene_id', 'schema', simulation.sceneId === scene.id, {
      message: 'SimulationResult must reference the supplied scene id.',
      details: { expected: scene.id, actual: simulation.sceneId },
    }),
    check('mechanics_result_scene_revision', 'schema', simulation.sceneRevision === scene.revision, {
      message: 'SimulationResult must reference the supplied scene revision.',
      details: { expected: scene.revision, actual: simulation.sceneRevision },
    }),
    check('mechanics_result_body_states', 'trajectory', statesContainBody, {
      message: 'Every mechanics state must contain the scene body position and velocity.',
      details: { bodyId, stateCount: simulation.states.length },
    }),
  )
  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}
