/**
 * Composite-field scene predicates and the multi-region field sampler.
 *
 * A composite-field scene is one where a charged particle feels more than one of
 * {electric, magnetic, gravity} at once, so the motion follows
 * `F = qE + qv×B + mg` rather than any single-field model. This is the shape of
 * the classic apparatus questions — velocity selector, mass spectrometer,
 * cyclotron — and of "charged particle in crossed fields" generally.
 *
 * Two things live here because every downstream layer needs them and none of them
 * should re-derive the geometry:
 *
 *  1. **Predicates.** Which scenes are composite, and which are deliberately not.
 *     The single-field engines each reject multi-field scenes outright, so a
 *     misclassification does not degrade — it fails the whole frame.
 *  2. **The field sampler.** Which fields act at a given point. A composite scene
 *     may bind different fields to different regions (a selector region with E+B,
 *     then a deflection region with B only, then field-free space), so "what is
 *     the field here" is a lookup, not a scene-level constant.
 *
 * The sampler never computes a force — it answers only "which fields apply at this
 * point". Turning fields into a force is the engine's job, and keeping that split
 * is what stops a scene and a solver from disagreeing about the physics.
 */
import { canonicalValue } from '@physicsos/physics-units'
import { toCanonicalVector } from '@physicsos/physics-core'
import { vec3, type Vector3 } from '@physicsos/physics-math'

import type {
  Field,
  GravityField,
  PhysicsScene,
  Region,
  UniformElectricField,
  UniformMagneticField,
} from '../scene.ts'

/* ------------------------------------------------------------- predicates -- */

const fieldsOfType = <TType extends Field['type']>(
  scene: PhysicsScene,
  type: TType,
): Extract<Field, { type: TType }>[] =>
  scene.fields.filter((field): field is Extract<Field, { type: TType }> => field.type === type)

export const uniformElectricFieldsOf = (scene: PhysicsScene): UniformElectricField[] =>
  fieldsOfType(scene, 'uniform_electric')

export const uniformMagneticFieldsOf = (scene: PhysicsScene): UniformMagneticField[] =>
  fieldsOfType(scene, 'uniform_magnetic')

export const gravityFieldsOf = (scene: PhysicsScene): GravityField[] =>
  fieldsOfType(scene, 'uniform_gravity')

/**
 * Whether the scene needs the composite force law.
 *
 * The test is "at least two of the three uniform field kinds are present", not
 * "more than one field", because two electric fields bound to different regions
 * is still single-force physics and the bounded-electric engine handles it.
 * A `point_charge` field is excluded on purpose: its field varies as 1/r², so it
 * is not a uniform field and the closed-form drift solution does not apply.
 */
export const isCompositeFieldScene = (scene: PhysicsScene): boolean => {
  if (scene.fields.some((field) => field.type === 'point_charge')) return false
  const kinds = [
    uniformElectricFieldsOf(scene).length > 0,
    uniformMagneticFieldsOf(scene).length > 0,
    gravityFieldsOf(scene).length > 0,
  ].filter(Boolean).length
  return kinds >= 2 && scene.particles.length > 0
}

/* --------------------------------------------------------- region geometry -- */

/**
 * Whether a point lies inside a region.
 *
 * Only `rectangle` and `unbounded` are decided here. Every composite apparatus in
 * the high-school corpus is built from axis-aligned rectangular regions, and a
 * shape whose containment test does not exist must NOT quietly report `false` —
 * that would place the particle outside a field that physically acts on it and
 * produce a confidently wrong trajectory. Unsupported shapes therefore return
 * `undefined`, which callers are expected to surface as "unsupported scene".
 */
export const pointInRegion = (region: Region, point: Vector3): boolean | undefined => {
  const center = toCanonicalVector(region.center).vectorSI
  switch (region.shape.type) {
    case 'unbounded':
      return true
    case 'rectangle': {
      const halfWidth = canonicalValue(region.shape.width) / 2
      const halfHeight = canonicalValue(region.shape.height) / 2
      return (
        point.x >= center.x - halfWidth &&
        point.x <= center.x + halfWidth &&
        point.y >= center.y - halfHeight &&
        point.y <= center.y + halfHeight
      )
    }
    case 'circle':
    case 'polygon':
    case 'half_plane':
      return undefined
  }
}

/** Region shapes the sampler can decide containment for. */
export const SAMPLEABLE_REGION_SHAPES = ['rectangle', 'unbounded'] as const

export const hasUnsampleableRegion = (scene: PhysicsScene): boolean =>
  scene.regions.some(
    (region) => !(SAMPLEABLE_REGION_SHAPES as readonly string[]).includes(region.shape.type),
  )

/* ----------------------------------------------------------- field sample -- */

/**
 * The uniform fields acting at one point, already in SI.
 *
 * A field with no `regionId` is global; a field bound to a region acts only
 * inside it. Vectors are summed when several fields of the same kind overlap,
 * which is how "two selector plates in series" or "E from two sources" compose.
 */
export interface FieldSample {
  /** Electric field in V/m. Zero when no electric field acts here. */
  readonly electricField: Vector3
  /** Magnetic flux density in T. Zero when no magnetic field acts here. */
  readonly magneticFluxDensity: Vector3
  /** Gravitational acceleration in m/s². Zero when the scene declares no gravity. */
  readonly gravity: Vector3
  /** Ids of the regions containing this point, in scene order. */
  readonly regionIds: readonly string[]
}

const addInto = (accumulator: Vector3, addend: Vector3): Vector3 => ({
  x: accumulator.x + addend.x,
  y: accumulator.y + addend.y,
  z: accumulator.z + addend.z,
})

/**
 * Sample the scene's uniform fields at `point`.
 *
 * Throws when a field is bound to a region whose containment test is not
 * implemented, rather than treating the point as outside it. A scene that reaches
 * the engine must already have passed `hasUnsampleableRegion`; this is the
 * backstop that keeps an unsupported shape from becoming silent wrong physics.
 *
 * Gravity is read only from a declared `uniform_gravity` field and is otherwise
 * exactly zero. There is deliberately no fallback to g = 9.8: a velocity selector
 * is normally posed with gravity neglected, and injecting an undeclared 9.8 would
 * break the force balance the question is about.
 */
export const sampleFieldsAt = (scene: PhysicsScene, point: Vector3): FieldSample => {
  const regionIds: string[] = []
  for (const region of scene.regions) {
    const inside = pointInRegion(region, point)
    if (inside === undefined) {
      throw new Error(
        `Region "${region.id}" has shape "${region.shape.type}", which has no containment test; ` +
          'sampling it would silently place the particle outside a field that acts on it.',
      )
    }
    if (inside) regionIds.push(region.id)
  }

  const acts = (field: Field): boolean =>
    field.regionId === undefined || regionIds.includes(field.regionId)

  let electricField = vec3(0, 0, 0)
  let magneticFluxDensity = vec3(0, 0, 0)
  let gravity = vec3(0, 0, 0)

  for (const field of scene.fields) {
    if (field.enabled === false || !acts(field)) continue
    if (field.type === 'uniform_electric') {
      electricField = addInto(electricField, toCanonicalVector(field.fieldStrength).vectorSI)
    } else if (field.type === 'uniform_magnetic') {
      magneticFluxDensity = addInto(
        magneticFluxDensity,
        toCanonicalVector(field.magneticFluxDensity).vectorSI,
      )
    } else if (field.type === 'uniform_gravity') {
      gravity = addInto(gravity, toCanonicalVector(field.acceleration).vectorSI)
    }
  }

  return { electricField, magneticFluxDensity, gravity, regionIds }
}

/**
 * Whether two samples describe the same physical environment.
 *
 * The engine uses this to find where one uniform-field phase ends and the next
 * begins: a phase boundary is exactly a point where the sampled fields change.
 */
export const sameFieldEnvironment = (a: FieldSample, b: FieldSample): boolean => {
  const near = (u: Vector3, v: Vector3) =>
    Math.abs(u.x - v.x) < 1e-12 && Math.abs(u.y - v.y) < 1e-12 && Math.abs(u.z - v.z) < 1e-12
  return (
    near(a.electricField, b.electricField) &&
    near(a.magneticFluxDensity, b.magneticFluxDensity) &&
    near(a.gravity, b.gravity)
  )
}
