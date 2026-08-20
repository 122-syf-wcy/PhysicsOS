import {
  DEFAULT_TOLERANCE,
  check,
  derivedScalar,
  derivedVector,
  summarizeVerification,
  toCanonicalVector,
  withinTolerance,
  type PhysicsTolerance,
  type SimulationResult,
  type VerificationCheck,
  type VerificationIssue,
  type VerificationResult,
} from '@physicsos/physics-core'
import { add, dot, magnitude, scale, type Vector3 } from '@physicsos/physics-math'
import { validateScene, type PhysicsScene, type UniformElectricField } from '@physicsos/physics-scene'
import { canonicalValue } from '@physicsos/physics-units'

export const ELECTRIC_VERIFIER_ASSUMPTIONS = [
  'uniform electric field',
  'electric force only',
  '2D analytical motion',
] as const

const vectorMatches = (
  actual: Vector3,
  expected: Vector3,
  tolerance: PhysicsTolerance = DEFAULT_TOLERANCE,
): boolean =>
  withinTolerance(actual.x, expected.x, tolerance) &&
  withinTolerance(actual.y, expected.y, tolerance) &&
  withinTolerance(actual.z, expected.z, tolerance)

const uniformFields = (scene: PhysicsScene): UniformElectricField[] =>
  scene.fields.filter((field): field is UniformElectricField => field.type === 'uniform_electric')

export function verifyElectricScene(scene: PhysicsScene): VerificationResult {
  const checks: VerificationCheck[] = []
  const warnings: VerificationIssue[] = []
  const errors: VerificationIssue[] = []
  try {
    const validation = validateScene(scene)
    checks.push(...validation.checks)
    warnings.push(...validation.warnings)
    errors.push(...validation.errors)
  } catch (error: unknown) {
    checks.push(check('electric_scene_valid', 'schema', false, {
      message: error instanceof Error ? error.message : 'Electric scene validation failed.',
    }))
  }

  const particle = scene.particles[0]
  const fields = uniformFields(scene)
  const field = fields[0]
  const fieldVector = field === undefined ? undefined : toCanonicalVector(field.fieldStrength).vectorSI
  checks.push(
    check('electric_scene_2d', 'constraint', scene.dimension === '2d', {
      message: 'Electric V1 requires a 2D scene.',
    }),
    check(
      'electric_scene_single_particle',
      'constraint',
      scene.particles.length === 1 && scene.bodies.length === 0,
      {
        message: 'Electric V1 requires exactly one particle and no rigid bodies.',
        details: { particleCount: scene.particles.length, bodyCount: scene.bodies.length },
      },
    ),
    check(
      'electric_scene_single_uniform_field',
      'constraint',
      scene.fields.length === 1 && fields.length === 1,
      {
        message: 'Electric V1 requires exactly one uniform electric field.',
        details: { fieldCount: scene.fields.length, uniformElectricFieldCount: fields.length },
      },
    ),
    check('electric_scene_charge_defined', 'constraint', particle?.charge !== undefined, {
      message: 'The particle charge must be defined.',
    }),
    check(
      'electric_scene_mass_positive',
      'constraint',
      particle !== undefined && canonicalValue(particle.mass) > 0,
      { message: 'Particle mass must be greater than zero.' },
    ),
    check(
      'electric_scene_field_in_plane',
      'constraint',
      fieldVector !== undefined && Math.abs(fieldVector.z) <= DEFAULT_TOLERANCE.absolute,
      { message: 'Electric V1 requires the field vector to lie in the xy plane.' },
    ),
    check(
      'electric_scene_force_only',
      'constraint',
      scene.forces.length === 0 && scene.boundaries.length === 0 && scene.constraints.length === 0,
      { message: 'Electric V1 accepts only electric force without explicit boundaries or constraints.' },
    ),
  )

  return summarizeVerification(checks, warnings, errors)
}

export function verifyElectricSimulation(
  scene: PhysicsScene,
  simulation: SimulationResult,
  tolerance: PhysicsTolerance = DEFAULT_TOLERANCE,
): VerificationResult {
  const sceneVerification = verifyElectricScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]
  const particle = scene.particles[0]
  const field = uniformFields(scene)[0]

  checks.push(
    check('electric_result_schema', 'schema', simulation.schemaVersion === 'simulation-result/1.0', {
      message: 'SimulationResult must use schema simulation-result/1.0.',
    }),
    check('electric_result_scene_id', 'schema', simulation.sceneId === scene.id, {
      message: 'SimulationResult must reference the supplied scene id.',
      details: { expected: scene.id, actual: simulation.sceneId },
    }),
    check('electric_result_scene_revision', 'schema', simulation.sceneRevision === scene.revision, {
      message: 'SimulationResult must reference the supplied scene revision.',
      details: { expected: scene.revision, actual: simulation.sceneRevision },
    }),
    check('electric_result_states_present', 'trajectory', simulation.states.length > 0, {
      message: 'Electric simulation must supply trajectory states.',
    }),
  )

  if (particle === undefined || particle.charge === undefined || field === undefined) {
    return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
  }

  const mass = canonicalValue(particle.mass)
  const charge = canonicalValue(particle.charge)
  const initialPosition = toCanonicalVector(particle.position).vectorSI
  const initialVelocity = toCanonicalVector(particle.velocity).vectorSI
  const electricField = toCanonicalVector(field.fieldStrength).vectorSI
  const expectedForce = scale(electricField, charge)
  const expectedAcceleration = scale(expectedForce, 1 / mass)
  const initialKineticEnergy = 0.5 * mass * magnitude(initialVelocity) ** 2

  const samples = simulation.states.map((state) => {
    const object = state.objects.find((candidate) => candidate.id === particle.id)
    if (object?.position === undefined || object.velocity === undefined || object.acceleration === undefined) {
      return { complete: false, kinematics: false, force: false, acceleration: false, energy: false }
    }
    try {
      const time = canonicalValue(state.time)
      const position = toCanonicalVector(object.position).vectorSI
      const velocity = toCanonicalVector(object.velocity).vectorSI
      const acceleration = toCanonicalVector(object.acceleration).vectorSI
      const displacement = add(scale(initialVelocity, time), scale(expectedAcceleration, 0.5 * time * time))
      const expectedPosition = add(initialPosition, displacement)
      const expectedVelocity = add(initialVelocity, scale(expectedAcceleration, time))
      const actualForce = toCanonicalVector(derivedVector(state.derived, 'electric_force_vector')).vectorSI
      const actualDerivedAcceleration = toCanonicalVector(derivedVector(state.derived, 'acceleration_vector')).vectorSI
      const potentialChange = canonicalValue(derivedScalar(state.derived, 'electric_potential_change'))
      const potentialEnergyChange = canonicalValue(derivedScalar(state.derived, 'electric_potential_energy_change'))
      const work = canonicalValue(derivedScalar(state.derived, 'work_by_electric_field'))
      const kineticEnergy = canonicalValue(derivedScalar(state.derived, 'kinetic_energy'))
      const expectedPotentialChange = -dot(electricField, displacement)
      const expectedPotentialEnergyChange = charge * expectedPotentialChange
      const expectedWork = dot(expectedForce, displacement)
      const expectedKineticEnergy = 0.5 * mass * magnitude(expectedVelocity) ** 2

      return {
        complete: true,
        kinematics:
          vectorMatches(position, expectedPosition, tolerance) &&
          vectorMatches(velocity, expectedVelocity, tolerance),
        force: vectorMatches(actualForce, expectedForce, tolerance),
        acceleration:
          vectorMatches(acceleration, expectedAcceleration, tolerance) &&
          vectorMatches(actualDerivedAcceleration, expectedAcceleration, tolerance),
        energy:
          withinTolerance(potentialChange, expectedPotentialChange, tolerance) &&
          withinTolerance(potentialEnergyChange, expectedPotentialEnergyChange, tolerance) &&
          withinTolerance(work, expectedWork, tolerance) &&
          withinTolerance(kineticEnergy, expectedKineticEnergy, tolerance) &&
          withinTolerance(kineticEnergy - initialKineticEnergy, work, tolerance) &&
          withinTolerance(work, -potentialEnergyChange, tolerance),
      }
    } catch {
      return { complete: false, kinematics: false, force: false, acceleration: false, energy: false }
    }
  })

  checks.push(
    check('electric_state_objects_complete', 'trajectory', samples.every((sample) => sample.complete), {
      message: 'Every electric state must contain particle position, velocity, acceleration and derived facts.',
    }),
    check('electric_kinematic_consistency', 'trajectory', samples.every((sample) => sample.kinematics), {
      message: 'Every state must satisfy r = r0 + v0t + 0.5at² and v = v0 + at.',
    }),
    check('electric_force_consistency', 'constraint', samples.every((sample) => sample.force), {
      message: 'Every state must satisfy F = qE.',
    }),
    check('electric_acceleration_consistency', 'constraint', samples.every((sample) => sample.acceleration), {
      message: 'Every state must satisfy a = F/m.',
    }),
    check('electric_energy_consistency', 'conservation', samples.every((sample) => sample.energy), {
      message: 'Every state must satisfy ΔK = W = -ΔU and ΔU = qΔφ.',
    }),
  )

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}
