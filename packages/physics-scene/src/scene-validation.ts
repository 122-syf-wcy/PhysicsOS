import { UNIT_X, UNIT_Y, UNIT_Z, isFiniteVector, magnitude } from '@physicsos/physics-math'
import {
  check,
  summarizeVerification,
  toCanonicalVector,
  type VerificationCheck,
  type VerificationIssue,
  type VerificationResult,
} from '@physicsos/physics-core'
import {
  canonicalValue,
  dimensionOf,
  isKnownUnit,
  type PhysicalDimension,
} from '@physicsos/physics-units'

import type { PhysicsScene } from './scene.ts'

const hasExpectedDimension = (
  value: { readonly unit: string; readonly dimension: string },
  expected: PhysicalDimension,
): boolean => {
  try {
    return (
      isKnownUnit(value.unit) &&
      dimensionOf(value.unit) === expected &&
      value.dimension === expected
    )
  } catch {
    return false
  }
}

/**
 * Scene-level structural validation. Physical model preconditions (v ⟂ B and
 * friends) belong to the engine's `canHandle`; this function only asserts the
 * invariants docs/03 §27, §33 and §174 place on any scene.
 */
export const validateScene = (scene: PhysicsScene): VerificationResult => {
  const checks: VerificationCheck[] = []
  const errors: VerificationIssue[] = []

  checks.push(
    check('scene_schema_version', 'schema', scene.schemaVersion === 'physics-scene/1.0', {
      message: `Unexpected scene schemaVersion "${scene.schemaVersion}".`,
    }),
  )

  const revisionValid = Number.isInteger(scene.revision) && scene.revision >= 0
  checks.push(
    check('scene_revision_valid', 'schema', revisionValid, {
      message: `Scene revision must be a non-negative integer, received ${String(scene.revision)}.`,
      details: { revision: scene.revision },
    }),
  )

  const ids = [
    ...scene.particles.map((entry) => entry.id),
    ...scene.bodies.map((entry) => entry.id),
    ...scene.fields.map((entry) => entry.id),
    ...scene.regions.map((entry) => entry.id),
  ]
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  checks.push(
    check('scene_object_ids_unique', 'schema', duplicates.length === 0, {
      message: `Duplicate object ids: ${duplicates.join(', ')}.`,
      details: { duplicates },
    }),
  )

  const observableIds = scene.observableDefinitions.map((entry) => String(entry.id))
  const duplicateObservables = observableIds.filter(
    (id, index) => observableIds.indexOf(id) !== index,
  )
  checks.push(
    check('observable_ids_unique', 'schema', duplicateObservables.length === 0, {
      message: `Duplicate observable ids: ${duplicateObservables.join(', ')}.`,
    }),
  )

  for (const particle of scene.particles) {
    const unitsKnown =
      isKnownUnit(particle.mass.unit) &&
      isKnownUnit(particle.position.unit) &&
      isKnownUnit(particle.velocity.unit) &&
      (particle.charge === undefined || isKnownUnit(particle.charge.unit))
    checks.push(
      check(`particle_units_known:${particle.id}`, 'dimension', unitsKnown, {
        message: `Particle "${particle.id}" uses a unit outside the registry (docs/03 §12).`,
        targetId: particle.id,
      }),
    )

    const dimensionsValid =
      hasExpectedDimension(particle.mass, 'mass') &&
      hasExpectedDimension(particle.position, 'length') &&
      hasExpectedDimension(particle.velocity, 'velocity') &&
      (particle.charge === undefined || hasExpectedDimension(particle.charge, 'electric_charge'))
    checks.push(
      check(`particle_dimensions_valid:${particle.id}`, 'dimension', dimensionsValid, {
        message: `Particle "${particle.id}" quantities must use their contract dimensions.`,
        targetId: particle.id,
      }),
    )

    if (dimensionsValid) {
      const massSI = canonicalValue(particle.mass)
      checks.push(
        check(`particle_mass_positive:${particle.id}`, 'constraint', massSI > 0, {
          message: `Particle "${particle.id}" must have mass > 0 (docs/03 §33).`,
          targetId: particle.id,
          details: { massSI },
        }),
      )
    }

    checks.push(
      check(
        `particle_position_finite:${particle.id}`,
        'numerical',
        isFiniteVector(particle.position.vector),
        { message: `Particle "${particle.id}" position must be finite.`, targetId: particle.id },
      ),
    )

    checks.push(
      check(
        `particle_velocity_finite:${particle.id}`,
        'numerical',
        isFiniteVector(particle.velocity.vector),
        { message: `Particle "${particle.id}" velocity must be finite.`, targetId: particle.id },
      ),
    )
  }

  for (const body of scene.bodies) {
    const unitsKnown =
      isKnownUnit(body.mass.unit) &&
      isKnownUnit(body.position.unit) &&
      isKnownUnit(body.velocity.unit)
    checks.push(
      check(`body_units_known:${body.id}`, 'dimension', unitsKnown, {
        message: `Body "${body.id}" uses a unit outside the registry (docs/03 §12).`,
        targetId: body.id,
      }),
    )

    const dimensionsValid =
      hasExpectedDimension(body.mass, 'mass') &&
      hasExpectedDimension(body.position, 'length') &&
      hasExpectedDimension(body.velocity, 'velocity')
    checks.push(
      check(`body_dimensions_valid:${body.id}`, 'dimension', dimensionsValid, {
        message: `Body "${body.id}" quantities must use their contract dimensions.`,
        targetId: body.id,
      }),
    )

    if (dimensionsValid) {
      const massSI = canonicalValue(body.mass)
      checks.push(
        check(`body_mass_positive:${body.id}`, 'constraint', massSI > 0, {
          message: `Body "${body.id}" must have mass > 0.`,
          targetId: body.id,
          details: { massSI },
        }),
      )
    }

    checks.push(
      check(
        `body_position_finite:${body.id}`,
        'numerical',
        isFiniteVector(body.position.vector),
        { message: `Body "${body.id}" position must be finite.`, targetId: body.id },
      ),
    )

    checks.push(
      check(
        `body_velocity_finite:${body.id}`,
        'numerical',
        isFiniteVector(body.velocity.vector),
        { message: `Body "${body.id}" velocity must be finite.`, targetId: body.id },
      ),
    )
  }

  for (const field of scene.fields) {
    if (field.type === 'uniform_magnetic') {
      const dimensionsValid = hasExpectedDimension(
        field.magneticFluxDensity,
        'magnetic_flux_density',
      )
      checks.push(
        check(`field_dimensions_valid:${field.id}`, 'dimension', dimensionsValid, {
          message: `Field "${field.id}" magnetic flux density must use magnetic_flux_density.`,
          targetId: field.id,
        }),
      )
      const canonical = dimensionsValid ? toCanonicalVector(field.magneticFluxDensity) : undefined
      checks.push(
        check(
          `field_finite:${field.id}`,
          'numerical',
          canonical !== undefined && isFiniteVector(canonical.vectorSI),
          {
            message: `Field "${field.id}" flux density must be finite.`,
            targetId: field.id,
          },
        ),
      )
    }
    if (field.type === 'uniform_electric') {
      const dimensionsValid = hasExpectedDimension(field.fieldStrength, 'electric_field')
      checks.push(
        check(`field_dimensions_valid:${field.id}`, 'dimension', dimensionsValid, {
          message: `Field "${field.id}" strength must use electric_field.`,
          targetId: field.id,
        }),
      )
      const canonical = dimensionsValid ? toCanonicalVector(field.fieldStrength) : undefined
      checks.push(
        check(
          `field_finite:${field.id}`,
          'numerical',
          canonical !== undefined && isFiniteVector(canonical.vectorSI),
          {
            message: `Field "${field.id}" field strength must be finite.`,
            targetId: field.id,
          },
        ),
      )
    }
    if (field.type === 'uniform_gravity') {
      const dimensionsValid = hasExpectedDimension(field.acceleration, 'acceleration')
      checks.push(
        check(`field_dimensions_valid:${field.id}`, 'dimension', dimensionsValid, {
          message: `Field "${field.id}" acceleration must use acceleration.`,
          targetId: field.id,
        }),
      )
      const canonical = dimensionsValid ? toCanonicalVector(field.acceleration) : undefined
      checks.push(
        check(
          `field_finite:${field.id}`,
          'numerical',
          canonical !== undefined && isFiniteVector(canonical.vectorSI),
          {
            message: `Field "${field.id}" acceleration must be finite.`,
            targetId: field.id,
          },
        ),
      )
    }
    if (field.regionId !== undefined) {
      const regionExists = scene.regions.some((region) => region.id === field.regionId)
      checks.push(
        check(`field_region_exists:${field.id}`, 'semantic', regionExists, {
          message: `Field "${field.id}" references unknown region "${field.regionId}".`,
          targetId: field.id,
        }),
      )
    }
  }

  for (const observable of scene.observableDefinitions) {
    if (observable.targetId === undefined) continue
    const targetExists = ids.includes(observable.targetId)
    checks.push(
      check(`observable_target_exists:${String(observable.id)}`, 'semantic', targetExists, {
        message: `Observable "${String(observable.id)}" targets unknown object "${observable.targetId}".`,
        targetId: observable.targetId,
      }),
    )
  }

  const axes = scene.coordinateSystem.axes
  const axesOrthonormal =
    magnitude(axes.x) > 0 &&
    magnitude(axes.y) > 0 &&
    magnitude(axes.z) > 0 &&
    isFiniteVector(axes.x) &&
    isFiniteVector(axes.y) &&
    isFiniteVector(axes.z)
  checks.push(
    check('coordinate_axes_valid', 'schema', axesOrthonormal, {
      message: 'Coordinate axes must be finite non-zero vectors.',
    }),
  )

  const playbackRateValid =
    Number.isFinite(scene.timeline.playbackRate) && scene.timeline.playbackRate > 0
  checks.push(
    check('timeline_playback_rate_valid', 'schema', playbackRateValid, {
      message: `Timeline playbackRate must be a positive finite number, received ${String(
        scene.timeline.playbackRate,
      )}.`,
    }),
  )

  const timelineDimensionsValid =
    hasExpectedDimension(scene.timeline.currentTime, 'time') &&
    hasExpectedDimension(scene.timeline.startTime, 'time') &&
    (scene.timeline.endTime === undefined ||
      hasExpectedDimension(scene.timeline.endTime, 'time')) &&
    (scene.timeline.simulationTimeStep === undefined ||
      hasExpectedDimension(scene.timeline.simulationTimeStep, 'time'))
  checks.push(
    check('timeline_dimensions_valid', 'dimension', timelineDimensionsValid, {
      message: 'Timeline quantities must use time dimensions.',
    }),
  )

  return summarizeVerification(checks, [], errors)
}

/** Standard right-handed 2D cartesian frame in metres. */
export const defaultCoordinateSystem = () => ({
  type: 'cartesian' as const,
  origin: { x: 0, y: 0, z: 0 },
  axes: { x: UNIT_X, y: UNIT_Y, z: UNIT_Z },
  lengthUnit: 'm',
})
