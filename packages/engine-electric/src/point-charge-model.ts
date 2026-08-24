/**
 * Point-charge electrostatic model.
 *
 * Static source charges produce a field; a probe, if present, feels `F = qE`. This
 * is a STATIC model: it reports the field, potential and instantaneous force, and
 * deliberately does not integrate the probe's motion — in a 1/r² field that has no
 * closed form, and this engine only publishes analytical results.
 *
 * Same `PhysicsEngine` shape as the magnetic and mechanics engines: model
 * detection, `canHandle` with named failed conditions, `simulate` with derived
 * quantities. Nothing here decides what to display.
 */

import { magnitude, type Vector3 } from '@physicsos/physics-math'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import {
  invalidModelCondition,
  quantityVector,
  supported,
  toCanonicalVector,
  unsupportedModel,
  type DerivedQuantity,
  type ModelSupport,
} from '@physicsos/physics-core'
import {
  fieldSamplePointOf,
  sourceChargesOf,
  type PhysicsScene,
  type PointChargeField,
} from '@physicsos/physics-scene'

import {
  resolveSourceCharges,
  solveFieldAt,
  solvePotentialAt,
  type ResolvedSourceCharge,
} from './field-solver.ts'
import { resolveProbe, solveProbeForce, type ResolvedProbe } from './force-solver.ts'

export const POINT_CHARGE_MODEL = 'point_charge_electrostatic_field'

const ASSUMPTIONS = [
  'static point charges',
  'vacuum permittivity',
  'electric force only',
  '2D field sampling',
] as const

const failure = (condition: string, message: string) => ({ condition, message })

export interface PointChargeModel {
  readonly modelId: typeof POINT_CHARGE_MODEL
  readonly charges: readonly ResolvedSourceCharge[]
  readonly probe: ResolvedProbe | undefined
  /** Where E is reported: the probe position, or the scene's declared sample. */
  readonly samplePoint: Vector3
  readonly field: Vector3
  readonly fieldMagnitude: number
  readonly potential: number
  readonly force: Vector3 | undefined
  readonly forceMagnitude: number | undefined
  readonly acceleration: Vector3 | undefined
}

const pointChargeFields = (scene: PhysicsScene): PointChargeField[] =>
  scene.fields.filter((field): field is PointChargeField => field.type === 'point_charge')

/** Whether the scene is a point-charge world at all. */
export const isPointChargeScene = (scene: PhysicsScene): boolean =>
  pointChargeFields(scene).length > 0

/**
 * Preconditions for the point-charge model.
 *
 * Each rejection names its condition so the UI can explain WHY rather than saying
 * "unsupported": a moving source, a capacitor or a mixed uniform field are all
 * real models, just not this one.
 */
export const canHandlePointCharge = (scene: PhysicsScene): ModelSupport => {
  const fields = pointChargeFields(scene)
  if (scene.dimension !== '2d') {
    return unsupportedModel([failure('scene_is_2d', 'Electric V1 supports 2D scenes only.')], 'engine-electric')
  }
  if (fields.length === 0) {
    return unsupportedModel(
      [failure('point_charge_field_present', 'The scene declares no point-charge field.')],
      'engine-electric',
    )
  }
  if (scene.fields.length !== fields.length) {
    return unsupportedModel(
      [failure('point_charge_fields_only', 'Mixing a point-charge field with another field type is not supported yet.')],
      'engine-electric',
    )
  }
  if (scene.bodies.length > 0 || scene.circuits.length > 0) {
    return unsupportedModel(
      [failure('charges_only', 'Electric V1 solves charges, not rigid bodies or circuits.')],
      'engine-electric',
    )
  }
  if (scene.boundaries.length > 0 || scene.constraints.length > 0 || scene.forces.length > 0) {
    return unsupportedModel(
      [failure('electric_force_only', 'Electric V1 does not combine explicit forces, boundaries or constraints.')],
      'engine-electric',
    )
  }

  const sources = sourceChargesOf(scene.particles, scene.fields)
  if (sources.length !== fields.length) {
    return invalidModelCondition('engine-electric', [
      failure('field_source_exists', 'Every point-charge field must name a particle that exists in the scene.'),
    ])
  }
  for (const source of sources) {
    if (source.charge === undefined) {
      return invalidModelCondition('engine-electric', [
        failure('source_charge_defined', `Source particle "${source.id}" has no charge.`),
      ])
    }
    if (!Number.isFinite(canonicalValue(source.charge))) {
      return invalidModelCondition('engine-electric', [
        failure('source_charge_finite', `Source particle "${source.id}" charge must be finite.`),
      ])
    }
    /* A source that moves would make the field time-varying, which needs
       retarded potentials rather than Coulomb's law. */
    if (magnitude(toCanonicalVector(source.velocity).vectorSI) > 1e-12) {
      return unsupportedModel(
        [failure('static_sources', 'A moving source charge produces a time-varying field, which Electric V1 does not model.')],
        'engine-electric',
      )
    }
  }

  const probe = resolveProbe(scene)
  if (probe !== undefined) {
    if (!Number.isFinite(probe.mass) || probe.mass <= 0) {
      return invalidModelCondition('engine-electric', [
        failure('probe_mass_positive', 'Probe mass must be greater than zero.'),
      ])
    }
    const onSource = resolveSourceCharges(scene).some(
      (charge) => magnitude({
        x: probe.position.x - charge.position.x,
        y: probe.position.y - charge.position.y,
        z: probe.position.z - charge.position.z,
      }) <= 0,
    )
    if (onSource) {
      return invalidModelCondition('engine-electric', [
        failure('probe_not_on_source', 'The field is undefined at a source position; move the probe off the charge.'),
      ])
    }
  } else if (fieldSamplePointOf(scene) === undefined) {
    return invalidModelCondition('engine-electric', [
      failure('sample_point_declared', 'A scene without a probe must declare where the field is sampled.'),
    ])
  }

  return supported(POINT_CHARGE_MODEL, 'electric')
}

/** Resolve the model from the scene. Throws only if `canHandle` was skipped. */
export const resolvePointChargeModel = (scene: PhysicsScene): PointChargeModel => {
  const charges = resolveSourceCharges(scene)
  const probe = resolveProbe(scene)
  const samplePoint = probe?.position ?? fieldSamplePointOf(scene) ?? { x: 0.2, y: 0, z: 0 }
  const sample = solveFieldAt(charges, samplePoint)
  const potential = solvePotentialAt(charges, samplePoint)
  const probeForce = probe === undefined ? undefined : solveProbeForce(probe, sample.field)

  return {
    modelId: POINT_CHARGE_MODEL,
    charges,
    probe,
    samplePoint,
    field: sample.field,
    fieldMagnitude: sample.magnitude,
    potential,
    force: probeForce?.force,
    forceMagnitude: probeForce?.magnitude,
    acceleration: probeForce?.acceleration,
  }
}

/** Derived quantities the UI, Verifier and Question pipeline all read. */
export const pointChargeDerived = (model: PointChargeModel): DerivedQuantity[] => {
  const sampleTarget = model.probe?.id ?? 'field-sample'
  const derived: DerivedQuantity[] = [
    {
      key: 'electric_field_vector',
      targetId: sampleTarget,
      value: quantityVector(model.field, 'V/m', 'electric_field'),
      formula: { expression: 'E = \\sum k q_i \\hat r_i / r_i^2' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'electric_field_magnitude',
      targetId: sampleTarget,
      value: quantity(model.fieldMagnitude, 'V/m', 'electric_field'),
      formula: { expression: '|E| = k q / r^2' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'potential',
      targetId: sampleTarget,
      value: quantity(model.potential, 'V', 'electric_potential'),
      formula: { expression: 'V = \\sum k q_i / r_i' },
      assumptions: [...ASSUMPTIONS],
    },
  ]

  if (model.probe !== undefined && model.force !== undefined && model.forceMagnitude !== undefined) {
    derived.push(
      {
        key: 'electric_force_vector',
        targetId: model.probe.id,
        value: quantityVector(model.force, 'N', 'force'),
        formula: { expression: 'F = qE' },
        assumptions: [...ASSUMPTIONS],
      },
      {
        key: 'electric_force_magnitude',
        targetId: model.probe.id,
        value: quantity(model.forceMagnitude, 'N', 'force'),
        formula: { expression: '|F| = |q||E|' },
        assumptions: [...ASSUMPTIONS],
      },
    )
    if (model.acceleration !== undefined) {
      derived.push({
        key: 'acceleration_vector',
        targetId: model.probe.id,
        value: quantityVector(model.acceleration, 'm/s^2', 'acceleration'),
        formula: { expression: 'a = qE / m' },
        assumptions: [...ASSUMPTIONS],
      })
    }
  }

  return derived
}
