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
import { add, angleBetween, dot, magnitude, scale, subtract, tryNormalize, type Vector3 } from '@physicsos/physics-math'
import {
  fieldSamplePointOf,
  sourceChargesOf,
  validateScene,
  type PhysicsScene,
  type PointChargeField,
  type UniformElectricField,
} from '@physicsos/physics-scene'
import { canonicalValue } from '@physicsos/physics-units'
import {
  COULOMB_CONSTANT,
  electricForce,
  fieldAt,
  pointChargeElectricField,
  superposeElectricFields,
} from '@physicsos/physics-electric-core'

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

const pointChargeFields = (scene: PhysicsScene): PointChargeField[] =>
  scene.fields.filter((field): field is PointChargeField => field.type === 'point_charge')

const isPointChargeScene = (scene: PhysicsScene): boolean => pointChargeFields(scene).length > 0

export function verifyElectricScene(scene: PhysicsScene): VerificationResult {
  if (isPointChargeScene(scene)) {
    return verifyPointChargeScene(scene)
  }
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
  /* Two models share the electric engine; each is verified by its own checks.
     Routing here keeps a point-charge scene from being judged by the uniform
     field's "exactly one particle, one uniform_electric field" preconditions. */
  if (isPointChargeScene(scene)) {
    return verifyPointChargeSimulation(scene, simulation, tolerance)
  }
  return verifyUniformElectricSimulation(scene, simulation, tolerance)
}

/** Uniform-field model verification. Unchanged from the original electric path. */
function verifyUniformElectricSimulation(
  scene: PhysicsScene,
  simulation: SimulationResult,
  tolerance: PhysicsTolerance,
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

/* --------------------------------------------------------- point charge -- */

const REJECT_MODEL: readonly string[] = [
  'electric_scene_2d',
  'point_charge_fields_only',
  'charges_only',
  'electric_force_only',
]

/** Scene-shape checks for the static point-charge model, mirroring `canHandlePointCharge`. */
function verifyPointChargeScene(scene: PhysicsScene): VerificationResult {
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
      message: error instanceof Error ? error.message : 'Point-charge scene validation failed.',
    }))
  }

  const fields = pointChargeFields(scene)
  checks.push(
    check('electric_scene_2d', 'constraint', scene.dimension === '2d', {
      message: 'Electric V1 supports 2D scenes only.',
    }),
    check('point_charge_field_present', 'constraint', fields.length > 0, {
      message: 'The scene declares no point-charge field.',
    }),
    check(
      'point_charge_fields_only',
      'constraint',
      scene.fields.length === fields.length,
      {
        message: 'Mixing a point-charge field with another field type is not supported yet.',
        details: { fieldCount: scene.fields.length, pointChargeFieldCount: fields.length },
      },
    ),
    check(
      'charges_only',
      'constraint',
      scene.bodies.length === 0 && scene.circuits.length === 0,
      { message: 'Electric V1 solves charges, not rigid bodies or circuits.' },
    ),
    check(
      'electric_force_only',
      'constraint',
      scene.forces.length === 0 && scene.boundaries.length === 0 && scene.constraints.length === 0,
      { message: 'Electric V1 does not combine explicit forces, boundaries or constraints.' },
    ),
  )

  const sources = sourceChargesOf(scene.particles, scene.fields)
  checks.push(
    check(
      'field_source_exists',
      'constraint',
      sources.length === fields.length,
      { message: 'Every point-charge field must name a particle that exists in the scene.' },
    ),
  )
  for (const source of sources) {
    if (source.charge === undefined) {
      checks.push(
        check('source_charge_defined', 'constraint', false, {
          message: `Source particle "${source.id}" has no charge.`,
        }),
      )
      continue
    }
    const chargeValue = canonicalValue(source.charge)
    checks.push(
      check('source_charge_finite', 'constraint', Number.isFinite(chargeValue), {
        message: `Source particle "${source.id}" charge must be finite.`,
      }),
    )
    checks.push(
      check('static_sources', 'constraint', magnitude(toCanonicalVector(source.velocity).vectorSI) <= 1e-12, {
        message: `Source particle "${source.id}" must be at rest; a moving source produces a time-varying field.`,
      }),
    )
  }

  return summarizeVerification(checks, warnings, errors)
}

/**
 * Verifies a static point-charge simulation against the one definition of
 * E = kq/r² in `@physicsos/physics-electric-core`.
 *
 * The engine reports the field, potential and (if a probe is present) the force
 * at one sample point. Here we recompute each from the scene's source charges
 * independently and require agreement — so a wrong constant, a flipped sign or a
 * missing superposition term fails loudly rather than painting a plausible arrow.
 */
function verifyPointChargeSimulation(
  scene: PhysicsScene,
  simulation: SimulationResult,
  tolerance: PhysicsTolerance,
): VerificationResult {
  const sceneVerification = verifyPointChargeScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]

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
      message: 'Point-charge simulation must supply at least one state.',
    }),
  )

  /* Scene-shape rejection pre-empts the physical checks below; a scene that
     fails structural validation cannot be meaningfully compared. */
  const structuralFailure = checks.some(
    (entry) => !entry.passed && REJECT_MODEL.includes(entry.id),
  )
  if (structuralFailure || simulation.states.length === 0) {
    return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
  }

  const sources = sourceChargesOf(scene.particles, scene.fields)
  const resolvedCharges = sources.map((source) => ({
    id: source.id,
    charge: source.charge === undefined ? 0 : canonicalValue(source.charge),
    position: toCanonicalVector(source.position).vectorSI,
    fixed: true,
  }))
  /* The probe is the non-source particle that is not fixed, mirroring
     physics-scene's `probeParticleOf` (point-charge.ts:94). A second fixed
     particle must not be misread as the probe. */
  const sourceIds = new Set(resolvedCharges.map((charge) => charge.id))
  const probe = scene.particles.find(
    (particle) => !sourceIds.has(particle.id) && particle.fixed !== true,
  )

  /* Sample point: the probe position when one is present, else the scene's
     declared sample, else the derived target's location. */
  const samplePoint = probe !== undefined
    ? toCanonicalVector(probe.position).vectorSI
    : fieldSamplePointOf(scene)
  if (samplePoint === undefined) {
    checks.push(
      check('sample_point_declared', 'constraint', false, {
        message: 'A scene without a probe must declare where the field is sampled.',
      }),
    )
    return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
  }

  const state = simulation.states[0]
  if (state === undefined) {
    return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
  }
  const expectedField = fieldAt(resolvedCharges, samplePoint)
  const expectedPotential = resolvedCharges.reduce(
    (total, charge) =>
      total + (COULOMB_CONSTANT * charge.charge) / magnitude(subtract(samplePoint, charge.position)),
    0,
  )

  const actualField = readVector(state.derived, 'electric_field_vector')
  const actualFieldMagnitude = readScalar(state.derived, 'electric_field_magnitude')
  const actualPotential = readScalar(state.derived, 'potential')

  /* 1. Inverse-square law: the field at 2r is a quarter of the field at r, along a ray.
     Falsifiable against the engine: the reported |E| at the sample point must equal
     the recomputed E(r) AND 4×E(2r). A wrong power law (e.g. 1/r) would make the
     reported value disagree with 4×E(2r). Only meaningful for a single source with a
     clean ray; skipped otherwise. */
  const primary = resolvedCharges[0]
  const inverseSquareOk = primary === undefined || actualFieldMagnitude === undefined
    ? true
    : (() => {
        if (resolvedCharges.length !== 1) return true /* superposition has no single ray */
        const ray = subtract(samplePoint, primary.position)
        const rayLength = magnitude(ray)
        if (rayLength === 0) return true
        const unit = scale(ray, 1 / rayLength)
        const nearAt = add(primary.position, scale(unit, rayLength))
        const farAt = add(primary.position, scale(unit, rayLength * 2))
        const nearExpected = magnitude(pointChargeElectricField(primary.charge, primary.position, nearAt))
        const farExpected = magnitude(pointChargeElectricField(primary.charge, primary.position, farAt))
        if (nearExpected === 0) return true
        /* The reported value at r must match E(r), and 4×E(2r) must match E(r). */
        return withinTolerance(actualFieldMagnitude, nearExpected, tolerance)
          && withinTolerance(nearExpected, 4 * farExpected, tolerance)
      })()

  /* 2. Direction: for a SINGLE source the reported field must point along the radial
     ray — outward from a positive charge, inward toward a negative one. Stated as an
     angle between the reported field and the radial unit vector: ≈0 for positive,
     ≈π for negative. Skipped for superposition (no single radial direction). */
  const directionOk = primary === undefined || resolvedCharges.length !== 1 || actualField === undefined
    ? true
    : (() => {
        const radialUnit = tryNormalize(subtract(samplePoint, primary.position))
        const fieldUnit = tryNormalize(actualField)
        if (radialUnit === undefined || fieldUnit === undefined) return true
        const angle = angleBetween(radialUnit, fieldUnit)
        if (primary.charge > 0) return angle <= tolerance.angular
        if (primary.charge < 0) return Math.abs(angle - Math.PI) <= tolerance.angular
        return true
      })()

  /* 3. Superposition: removing one source from the total must change the field by
     exactly that source's contribution. Falsifiable: |E_total_reported − E(others)|
     must equal |E(source_0)|. Only meaningful for ≥2 sources; skipped otherwise. */
  const superpositionOk = resolvedCharges.length <= 1 || actualField === undefined
    ? true
    : (() => {
        const removed = resolvedCharges[0]
        if (removed === undefined) return true
        const others = resolvedCharges.slice(1)
        const othersField = others.length === 0
          ? { x: 0, y: 0, z: 0 } as Vector3
          : superposeElectricFields(
              others.map((charge) => pointChargeElectricField(charge.charge, charge.position, samplePoint)),
            )
        const removedContribution = pointChargeElectricField(removed.charge, removed.position, samplePoint)
        const expectedDelta = magnitude(subtract(actualField, othersField))
        const contributionMagnitude = magnitude(removedContribution)
        if (contributionMagnitude === 0) return true
        return withinTolerance(expectedDelta, contributionMagnitude, tolerance)
      })()

  checks.push(
    check('electric_field_1_over_r2', 'constraint', inverseSquareOk, {
      message: '|E| must fall off as 1/r² (a quarter at twice the distance along a ray).',
    }),
    check('electric_field_direction', 'constraint', directionOk, {
      message: 'The field points away from a positive charge and toward a negative one.',
    }),
    check('electric_field_superposition', 'constraint', superpositionOk, {
      message: 'The total field must equal the vector sum of each source contribution.',
    }),
    ...(actualField === undefined
      ? [check('electric_field_vector_present', 'constraint', false, {
          message: 'The simulation did not report an electric_field_vector.',
        })]
      : [check('electric_field_vector_matches', 'constraint', vectorMatches(actualField, expectedField.field, tolerance), {
          message: 'Reported E must equal Σ kq·r̂/r² recomputed from the sources.',
        })]),
    ...(actualFieldMagnitude === undefined
      ? [check('electric_field_magnitude_present', 'constraint', false, {
          message: 'The simulation did not report an electric_field_magnitude.',
        })]
      : [check('electric_field_magnitude_matches', 'constraint', withinTolerance(actualFieldMagnitude, expectedField.magnitude, tolerance), {
          message: 'Reported |E| must match the recomputed magnitude.',
        })]),
    ...(actualPotential === undefined
      ? [check('electric_potential_present', 'constraint', false, {
          message: 'The simulation did not report a potential.',
        })]
      : [check('electric_potential_matches', 'constraint', withinTolerance(actualPotential, expectedPotential, tolerance), {
          message: 'Reported V must equal Σ kq/r recomputed from the sources.',
        })]),
  )

  /* 4. Force on the probe: F = qE. */
  if (probe !== undefined && probe.charge !== undefined) {
    const probeCharge = canonicalValue(probe.charge)
    const probeMass = canonicalValue(probe.mass)
    checks.push(
      check('probe_mass_positive', 'constraint', Number.isFinite(probeMass) && probeMass > 0, {
        message: 'Probe mass must be greater than zero.',
      }),
    )
    const onSource = resolvedCharges.some((charge) =>
      magnitude(subtract(samplePoint, charge.position)) <= 0,
    )
    checks.push(
      check('probe_not_on_source', 'constraint', !onSource, {
        message: 'The field is undefined at a source position; move the probe off the charge.',
      }),
    )
    const expectedForce = electricForce(probeCharge, expectedField.field)
    const actualForce = readVector(state.derived, 'electric_force_vector')
    const actualForceMagnitude = readScalar(state.derived, 'electric_force_magnitude')
    checks.push(
      ...(actualForce === undefined
        ? [check('electric_force_vector_present', 'constraint', false, {
            message: 'The simulation did not report an electric_force_vector for the probe.',
          })]
        : [check('electric_force_qE', 'constraint', vectorMatches(actualForce, expectedForce, tolerance), {
            message: 'Force on the probe must satisfy F = qE.',
          })]),
      ...(actualForceMagnitude === undefined
        ? [check('electric_force_magnitude_present', 'constraint', false, {
            message: 'The simulation did not report an electric_force_magnitude for the probe.',
          })]
        : [check('electric_force_magnitude_matches', 'constraint', withinTolerance(actualForceMagnitude, magnitude(expectedForce), tolerance), {
            message: 'Reported |F| must match |qE|.',
          })]),
    )
    const actualAcceleration = readVector(state.derived, 'acceleration_vector')
    if (actualAcceleration !== undefined && probeMass > 0) {
      const expectedAcceleration = scale(expectedForce, 1 / probeMass)
      checks.push(
        check('electric_acceleration_qE_over_m', 'constraint', vectorMatches(actualAcceleration, expectedAcceleration, tolerance), {
          message: 'Probe acceleration must satisfy a = qE/m.',
        }),
      )
    }
  }

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

/** Read a derived vector, returning undefined when absent (rather than throwing). */
const readVector = (derived: SimulationResult['states'][number]['derived'], key: string): Vector3 | undefined => {
  const found = derived.find((entry) => entry.key === key)
  if (found === undefined || !('vector' in found.value)) return undefined
  return toCanonicalVector(found.value).vectorSI
}

/** Read a derived scalar, returning undefined when absent. */
const readScalar = (derived: SimulationResult['states'][number]['derived'], key: string): number | undefined => {
  const found = derived.find((entry) => entry.key === key)
  if (found === undefined || !('value' in found.value)) return undefined
  return canonicalValue(found.value)
}

export { verifyPointChargeScene, verifyPointChargeSimulation }

