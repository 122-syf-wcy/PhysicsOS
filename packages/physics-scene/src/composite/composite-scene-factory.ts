/**
 * Composite-field scene factories.
 *
 * A composite-field scene is one where a charged particle feels more than one of
 * {electric, magnetic, gravity} at once, so the motion follows
 * `F = qE + qv×B + mg` rather than any single-field model. Three classic
 * high-school apparatuses live here:
 *
 *  - **Velocity selector**: one rectangular region carrying E and B crossed so
 *    that only the particle with v = E/B passes straight through.
 *  - **Mass spectrometer**: a selector region (E+B), a field-free gap, then a
 *    deflection region carrying B only — straight, then straight, then circular.
 *  - **Generic crossed field**: E + B (optionally + g) in one region or across
 *    the whole plane, for "charged droplet in crossed fields" questions.
 *
 * Each factory only DESCRIBES the geometry (particles, region-bound fields,
 * regions, observables). The engine evaluates the trajectory; the scene never
 * disagrees with a solver about what the field is.
 *
 * Coordinates: x is the beam direction, y is the deflection axis, B is along ±z
 * (into/out of the page) so the composite closed form's gyration-about-z holds.
 */
import { quantityVector } from '@physicsos/physics-core'
import { vec3, type Vector3 } from '@physicsos/physics-math'
import { asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'
import { quantity } from '@physicsos/physics-units'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type {
  GravityField,
  ObservableDefinition,
  PhysicsScene,
  Region,
  UniformElectricField,
  UniformMagneticField,
} from '../scene.ts'

export type CompositeObservableKey =
  | 'velocity'
  | 'electricForce'
  | 'magneticForce'
  | 'gravityForce'
  | 'netForce'
  | 'electricField'
  | 'magneticField'
  | 'trajectory'

/** Which way the magnetic field points relative to the page. */
export type MagneticOrientation = 'into_page' | 'out_of_page'

/** In-plane electric field direction, the same vocabulary the electric factory uses. */
export type CompositeElectricDirection = 'right' | 'left' | 'up' | 'down'

export interface CompositeSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly particleId?: string
  readonly charge?: number
  readonly mass?: number
  readonly position?: Vector3
  readonly velocity?: Vector3
  readonly electricFieldStrength?: number
  readonly electricFieldDirection?: CompositeElectricDirection
  readonly magneticFieldStrength?: number
  readonly magneticFieldOrientation?: MagneticOrientation
  /** Gravitational acceleration magnitude (m/s²); omit to neglect gravity. */
  readonly gravity?: number
  readonly duration?: number
  readonly observableVisibility?: Partial<Record<CompositeObservableKey, boolean>>
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const DEFAULTS = {
  sceneId: 'composite-field-scene',
  revision: 0,
  particleId: 'particle-1',
  charge: 1.6e-19,
  mass: 1.67e-27,
  position: vec3(0, 0, 0),
  velocity: vec3(1e5, 0, 0),
  electricFieldStrength: 2.0e4,
  electricFieldDirection: 'up' as const,
  magneticFieldStrength: 0.2,
  magneticFieldOrientation: 'into_page' as const,
  duration: 1e-5,
} as const

const electricDirectionVector = (
  direction: CompositeElectricDirection,
  strength: number,
): Vector3 => {
  switch (direction) {
    case 'right':
      return vec3(strength, 0, 0)
    case 'left':
      return vec3(-strength, 0, 0)
    case 'up':
      return vec3(0, strength, 0)
    case 'down':
      return vec3(0, -strength, 0)
  }
}

const observableId = (key: CompositeObservableKey) =>
  asObservableId(`observable-composite-${key}`)

/**
 * Observable definitions for a composite scene.
 *
 * The field observables target the ACTUAL field ids, not a synthetic one: scene
 * validation checks that every observable target resolves to an object in the
 * scene, and a placeholder id made the whole scene fail verification — which the
 * Lab then displayed as a green badge and the question pipeline rejected outright.
 * The electric observable is omitted when the scene carries no electric field.
 */
const observableDefinitions = (
  particleId: string,
  fieldIds: { readonly electric: string | undefined; readonly magnetic: string },
  visibility: Partial<Record<CompositeObservableKey, boolean>>,
): ObservableDefinition[] => [
  { id: observableId('velocity'), type: 'velocity', targetId: particleId, visible: visibility.velocity ?? true },
  { id: observableId('electricForce'), type: 'force', targetId: particleId, visible: visibility.electricForce ?? true, parameters: { kind: 'electric' } },
  { id: observableId('magneticForce'), type: 'force', targetId: particleId, visible: visibility.magneticForce ?? true, parameters: { kind: 'magnetic' } },
  { id: observableId('gravityForce'), type: 'force', targetId: particleId, visible: visibility.gravityForce ?? false, parameters: { kind: 'gravity' } },
  { id: observableId('netForce'), type: 'force', targetId: particleId, visible: visibility.netForce ?? true, parameters: { kind: 'net' } },
  ...(fieldIds.electric === undefined
    ? []
    : [{
        id: observableId('electricField'),
        type: 'electric_field' as const,
        targetId: fieldIds.electric,
        visible: visibility.electricField ?? true,
      }]),
  { id: observableId('magneticField'), type: 'magnetic_field', targetId: fieldIds.magnetic, visible: visibility.magneticField ?? true },
  { id: observableId('trajectory'), type: 'trajectory', targetId: particleId, visible: visibility.trajectory ?? true },
]

interface FieldParts {
  readonly electric: UniformElectricField | undefined
  readonly magnetic: UniformMagneticField
  readonly gravity: GravityField | undefined
  /** Ids the observables target. `electric` is absent when E = 0. */
  readonly fieldIds: { readonly electric: string | undefined; readonly magnetic: string }
}

const buildFields = (
  input: CompositeSceneInput,
  regionId: string | undefined,
): FieldParts => {
  const strength = Math.abs(input.magneticFieldStrength ?? DEFAULTS.magneticFieldStrength)
  const orientation = input.magneticFieldOrientation ?? DEFAULTS.magneticFieldOrientation
  const fieldZ = orientation === 'into_page' ? -strength : strength
  const magnetic: UniformMagneticField = {
    id: 'composite-magnetic-1',
    type: 'uniform_magnetic',
    magneticFluxDensity: quantityVector(vec3(0, 0, fieldZ), 'T', 'magnetic_flux_density'),
    ...(regionId === undefined ? {} : { regionId }),
  }
  const electricStrength = Math.abs(input.electricFieldStrength ?? 0)
  const electric: UniformElectricField | undefined = electricStrength > 0
    ? {
        id: 'composite-electric-1',
        type: 'uniform_electric',
        fieldStrength: quantityVector(
          electricDirectionVector(
            input.electricFieldDirection ?? DEFAULTS.electricFieldDirection,
            electricStrength,
          ),
          'V/m',
          'electric_field',
        ),
        ...(regionId === undefined ? {} : { regionId }),
      }
    : undefined
  const gravityMagnitude = input.gravity
  const gravity: GravityField | undefined = gravityMagnitude === undefined
    ? undefined
    : {
        id: 'composite-gravity-1',
        type: 'uniform_gravity',
        acceleration: quantityVector(vec3(0, -Math.abs(gravityMagnitude), 0), 'm/s^2', 'acceleration'),
        ...(regionId === undefined ? {} : { regionId }),
      }
  return {
    electric,
    magnetic,
    gravity,
    fieldIds: { electric: electric?.id, magnetic: magnetic.id },
  }
}

const buildScene = (
  input: CompositeSceneInput,
  regions: Region[],
  fields: PhysicsScene['fields'],
  fieldIds: { readonly electric: string | undefined; readonly magnetic: string },
): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const sceneId = input.sceneId ?? DEFAULTS.sceneId
  const particleId = input.particleId ?? DEFAULTS.particleId
  const duration = input.duration ?? DEFAULTS.duration
  const visibility = input.observableVisibility ?? {}

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(sceneId),
    revision: input.revision ?? DEFAULTS.revision,
    dimension: '2d',
    coordinateSystem: defaultCoordinateSystem(),
    timeline: {
      currentTime: quantity(0, 's', 'time'),
      startTime: quantity(0, 's', 'time'),
      endTime: quantity(duration, 's', 'time'),
      state: 'idle',
      playbackRate: 1,
      simulationTimeStep: quantity(duration / 240, 's', 'time'),
    },
    bodies: [],
    particles: [
      {
        id: particleId,
        type: 'particle',
        mass: quantity(input.mass ?? DEFAULTS.mass, 'kg', 'mass'),
        charge: quantity(input.charge ?? DEFAULTS.charge, 'C', 'electric_charge'),
        position: quantityVector(input.position ?? DEFAULTS.position, 'm', 'length'),
        velocity: quantityVector(input.velocity ?? DEFAULTS.velocity, 'm/s', 'velocity'),
      },
    ],
    fields,
    forces: [],
    regions,
    boundaries: [],
    constraints: [],
    circuits: [],
    opticalBenches: [],
    acousticBenches: [],
    measurementDefinitions: [],
    observableDefinitions: observableDefinitions(particleId, fieldIds, visibility),
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? '复合场中的带电粒子',
      description: input.description ?? 'Composite Engine · E + B (+ g) 复合场解析运动模型',
    },
  }
}

/**
 * Velocity-selector scene.
 *
 * One rectangular region carrying crossed E and B, bound to that region, so the
 * field is zero outside it. The particle enters from the left and is undeflected
 * only when v = E/B.
 *
 * The default geometry is chosen so the forces actually CANCEL, which fixes the
 * sign the factory previously got wrong: with v along +x, E along +y and q > 0,
 * `qv×B` points along −y only when B points OUT of the page (+z). With B into the
 * page the two forces both point +y and add, so the "selector" deflected every
 * particle including the one at v = E/B. The default is therefore
 * E = 2.0×10⁴ V/m up, B = 0.20 T out of the page, v₀ = 1.0×10⁵ m/s = E/B.
 *
 * A caller that wants B into the page must flip either the charge sign or the
 * electric-field direction to keep the apparatus selecting.
 *
 * The selector region is a rectangle wide enough that the beam crosses it fully
 * at the selected speed.
 */
export interface VelocitySelectorSceneInput extends CompositeSceneInput {
  readonly regionId?: string
  readonly electricFieldId?: string
  readonly magneticFieldId?: string
  /** Selector region width (beam direction) and height (deflection), in metres. */
  readonly regionWidth?: number
  readonly regionHeight?: number
}

export const createVelocitySelectorScene = (
  input: VelocitySelectorSceneInput = {},
): PhysicsScene => {
  const regionId = input.regionId ?? 'selector-region-1'
  const regionWidth = input.regionWidth ?? 0.4
  const regionHeight = input.regionHeight ?? 0.2
  /* Place the selector region just right of the particle start so the beam
     enters it from the left edge and exits the right, as in the apparatus. */
  const regionCenter = vec3(regionWidth / 2, 0, 0)
  const region: Region = {
    id: regionId,
    shape: {
      type: 'rectangle',
      width: quantity(regionWidth, 'm', 'length'),
      height: quantity(regionHeight, 'm', 'length'),
    },
    center: quantityVector(regionCenter, 'm', 'length'),
  }
  /* A selector without an electric field is not a selector: `buildFields`
     defaults E to zero (correct for a magnetic-only composite world), so this
     apparatus has to state its own default. The orientation defaults to
     out-of-page for the cancellation reason in the doc comment above. */
  const selectorInput: VelocitySelectorSceneInput = {
    ...input,
    electricFieldStrength: input.electricFieldStrength ?? DEFAULTS.electricFieldStrength,
    magneticFieldOrientation: input.magneticFieldOrientation ?? 'out_of_page',
  }
  const parts = buildFields(selectorInput, regionId)
  const fields: PhysicsScene['fields'] = [parts.magnetic]
  if (parts.electric !== undefined) fields.push(parts.electric)
  if (parts.gravity !== undefined) fields.push(parts.gravity)
  const scene = buildScene(selectorInput, [region], fields, parts.fieldIds)
  /* Start the particle just left of the selector region so it is field-free
     until it enters — the textbook "从左端进入" setup. */
  scene.particles[0]!.position = quantityVector(
    input.position ?? vec3(-0.05, 0, 0),
    'm',
    'length',
  )
  return {
    ...scene,
    metadata: {
      ...scene.metadata,
      title: input.title ?? '速度选择器',
      description: input.description ?? 'Composite Engine · 互相垂直的 E 与 B 筛选 v = E/B 的粒子',
    },
  }
}

/**
 * Mass-spectrometer scene.
 *
 * Three regions laid out left-to-right along the beam:
 *   A — selector region (E + B crossed), rectangle.
 *   B — field-free drift gap, rectangle (no fields bound to it).
 *   C — deflection region (B only), rectangle; the particle turns in an arc here.
 *
 * The selected speed from region A carries straight through the gap B and into
 * the magnetic-only region C, where it follows a circular arc. Fields are bound
 * to their regions by `regionId` so the composite engine's phase decomposition
 * starts a new phase at each region boundary.
 */
export interface MassSpectrometerSceneInput extends CompositeSceneInput {
  readonly selectorRegionId?: string
  readonly driftRegionId?: string
  readonly deflectionRegionId?: string
  readonly selectorWidth?: number
  readonly selectorHeight?: number
  readonly driftWidth?: number
  readonly driftHeight?: number
  readonly deflectionWidth?: number
  readonly deflectionHeight?: number
}

export const createMassSpectrometerScene = (
  input: MassSpectrometerSceneInput = {},
): PhysicsScene => {
  const selectorId = input.selectorRegionId ?? 'spectrometer-selector'
  const driftId = input.driftRegionId ?? 'spectrometer-drift'
  const deflectionId = input.deflectionRegionId ?? 'spectrometer-deflection'

  const selectorWidth = input.selectorWidth ?? 0.3
  const selectorHeight = input.selectorHeight ?? 0.2
  const driftWidth = input.driftWidth ?? 0.15
  const driftHeight = input.driftHeight ?? 0.4
  const deflectionWidth = input.deflectionWidth ?? 0.6
  const deflectionHeight = input.deflectionHeight ?? 0.6

  /* Lay the three regions end to end along +x. Region A starts at the origin so
     the particle (starting just left of it) enters immediately. */
  let cursorX = 0
  const selectorCenter = vec3(cursorX + selectorWidth / 2, 0, 0)
  cursorX += selectorWidth
  const driftCenter = vec3(cursorX + driftWidth / 2, 0, 0)
  cursorX += driftWidth
  const deflectionCenter = vec3(cursorX + deflectionWidth / 2, 0, 0)

  const regions: Region[] = [
    {
      id: selectorId,
      shape: { type: 'rectangle', width: quantity(selectorWidth, 'm', 'length'), height: quantity(selectorHeight, 'm', 'length') },
      center: quantityVector(selectorCenter, 'm', 'length'),
    },
    {
      id: driftId,
      shape: { type: 'rectangle', width: quantity(driftWidth, 'm', 'length'), height: quantity(driftHeight, 'm', 'length') },
      center: quantityVector(driftCenter, 'm', 'length'),
    },
    {
      id: deflectionId,
      shape: { type: 'rectangle', width: quantity(deflectionWidth, 'm', 'length'), height: quantity(deflectionHeight, 'm', 'length') },
      center: quantityVector(deflectionCenter, 'm', 'length'),
    },
  ]

  /* Selector region fields: crossed E + B, both bound to the selector region.
     The orientation defaults to out-of-page for the same cancellation reason as
     the standalone selector: with v along +x, E along +y and q > 0, only B along
     +z makes qv×B oppose qE. A selector that deflects the beam would never let it
     reach the deflection region with the selected speed. */
  const strength = Math.abs(input.magneticFieldStrength ?? DEFAULTS.magneticFieldStrength)
  const orientation = input.magneticFieldOrientation ?? 'out_of_page'
  const fieldZ = orientation === 'into_page' ? -strength : strength
  const fields: PhysicsScene['fields'] = [
    {
      id: 'spectrometer-magnetic-selector',
      type: 'uniform_magnetic',
      magneticFluxDensity: quantityVector(vec3(0, 0, fieldZ), 'T', 'magnetic_flux_density'),
      regionId: selectorId,
    },
    {
      id: 'spectrometer-magnetic-deflection',
      type: 'uniform_magnetic',
      magneticFluxDensity: quantityVector(vec3(0, 0, fieldZ), 'T', 'magnetic_flux_density'),
      regionId: deflectionId,
    },
  ]
  const electricStrength = Math.abs(input.electricFieldStrength ?? DEFAULTS.electricFieldStrength)
  if (electricStrength > 0) {
    fields.push({
      id: 'spectrometer-electric-selector',
      type: 'uniform_electric',
      fieldStrength: quantityVector(
        electricDirectionVector(
          input.electricFieldDirection ?? DEFAULTS.electricFieldDirection,
          electricStrength,
        ),
        'V/m',
        'electric_field',
      ),
      regionId: selectorId,
    })
  }

  const scene = buildScene(input, regions, fields, {
    /* Observables target the selector region's own fields, the pair a student is
       reading when the beam is being selected. */
    electric: electricStrength > 0 ? 'spectrometer-electric-selector' : undefined,
    magnetic: 'spectrometer-magnetic-selector',
  })
  /* Start the particle just left of the selector region. */
  scene.particles[0]!.position = quantityVector(
    input.position ?? vec3(-0.05, 0, 0),
    'm',
    'length',
  )
  return {
    ...scene,
    metadata: {
      ...scene.metadata,
      title: input.title ?? '质谱仪基础模型',
      description: input.description ?? 'Composite Engine · 选择器 + 无场过渡 + 磁偏转多区域相位',
    },
  }
}

/**
 * Generic crossed-field scene.
 *
 * E + B (optionally + g) acting on the particle. With no region the fields are
 * global (unbounded); with a region they are bound to it. Used for "charged
 * droplet in crossed E and B fields" and "E + B + gravity balance" questions
 * where the whole plane is the field region.
 *
 * E defaults to the composite default rather than to zero: a "composite field"
 * carrying only B is a single-field magnetic world, which `isCompositeFieldScene`
 * rejects and the Lab would then route to the magnetic runtime.
 */
export const createCompositeFieldScene = (input: CompositeSceneInput = {}): PhysicsScene => {
  const compositeInput: CompositeSceneInput = {
    ...input,
    electricFieldStrength: input.electricFieldStrength ?? DEFAULTS.electricFieldStrength,
  }
  const parts = buildFields(compositeInput, undefined)
  const fields: PhysicsScene['fields'] = [parts.magnetic]
  if (parts.electric !== undefined) fields.push(parts.electric)
  if (parts.gravity !== undefined) fields.push(parts.gravity)
  const scene = buildScene(compositeInput, [], fields, parts.fieldIds)
  return {
    ...scene,
    metadata: {
      ...scene.metadata,
      title: input.title ?? '复合场中的带电粒子',
      description: input.description ?? 'Composite Engine · F = qE + qv×B + mg 复合场解析运动模型',
    },
  }
}

/**
 * Multi-region field scene: a particle crossing three DIFFERENT field regions.
 *
 * Laid out left to right along the beam:
 *   A — electric only (transverse E): the beam is deflected like a parallel plate.
 *   B — magnetic only: the beam turns on a circular arc.
 *   C — crossed E + B: the two forces act together.
 *
 * This is the "多场区带电粒子运动" apparatus, and it is a different world from the
 * mass spectrometer: the spectrometer selects then deflects with the SAME field
 * kinds in a fixed order, while here each region changes which law dominates. It
 * exists to exercise — and to let a student see — the engine's phase
 * decomposition across field CHANGES, not just field boundaries.
 *
 * Both field kinds are present in the scene, so the world stays a composite one
 * even though no single region carries every field.
 */
export interface MultiRegionFieldSceneInput extends CompositeSceneInput {
  readonly electricRegionId?: string
  readonly magneticRegionId?: string
  readonly crossedRegionId?: string
  /** Width of each region along the beam, in metres. */
  readonly regionWidth?: number
  /** Height of each region across the beam, in metres. */
  readonly regionHeight?: number
  /** Field-free gap between consecutive regions, in metres. */
  readonly gap?: number
}

export const createMultiRegionFieldScene = (
  input: MultiRegionFieldSceneInput = {},
): PhysicsScene => {
  const electricRegionId = input.electricRegionId ?? 'multi-region-electric'
  const magneticRegionId = input.magneticRegionId ?? 'multi-region-magnetic'
  const crossedRegionId = input.crossedRegionId ?? 'multi-region-crossed'
  const regionWidth = input.regionWidth ?? 0.2
  const regionHeight = input.regionHeight ?? 0.3
  const gap = input.gap ?? 0.06

  /* Regions are laid end to end with a field-free gap between them, so the engine
     starts a new phase at every entry and exit. */
  const centers = [0, 1, 2].map((index) =>
    vec3(regionWidth / 2 + index * (regionWidth + gap), 0, 0),
  )
  const rectangle = (id: string, center: Vector3): Region => ({
    id,
    shape: {
      type: 'rectangle',
      width: quantity(regionWidth, 'm', 'length'),
      height: quantity(regionHeight, 'm', 'length'),
    },
    center: quantityVector(center, 'm', 'length'),
  })
  const regions: Region[] = [
    rectangle(electricRegionId, centers[0]!),
    rectangle(magneticRegionId, centers[1]!),
    rectangle(crossedRegionId, centers[2]!),
  ]

  const electricStrength = Math.abs(input.electricFieldStrength ?? DEFAULTS.electricFieldStrength)
  const magneticStrength = Math.abs(input.magneticFieldStrength ?? DEFAULTS.magneticFieldStrength)
  const orientation = input.magneticFieldOrientation ?? DEFAULTS.magneticFieldOrientation
  const fieldZ = orientation === 'into_page' ? -magneticStrength : magneticStrength
  const electricVector = electricDirectionVector(
    input.electricFieldDirection ?? DEFAULTS.electricFieldDirection,
    electricStrength,
  )

  const fields: PhysicsScene['fields'] = [
    {
      id: 'multi-region-electric-1',
      type: 'uniform_electric',
      fieldStrength: quantityVector(electricVector, 'V/m', 'electric_field'),
      regionId: electricRegionId,
    },
    {
      id: 'multi-region-magnetic-1',
      type: 'uniform_magnetic',
      magneticFluxDensity: quantityVector(vec3(0, 0, fieldZ), 'T', 'magnetic_flux_density'),
      regionId: magneticRegionId,
    },
    {
      id: 'multi-region-electric-2',
      type: 'uniform_electric',
      fieldStrength: quantityVector(electricVector, 'V/m', 'electric_field'),
      regionId: crossedRegionId,
    },
    {
      id: 'multi-region-magnetic-2',
      type: 'uniform_magnetic',
      magneticFluxDensity: quantityVector(vec3(0, 0, fieldZ), 'T', 'magnetic_flux_density'),
      regionId: crossedRegionId,
    },
  ]

  const scene = buildScene(input, regions, fields, {
    /* Observables target the first region of each kind — the field a student reads
       when the beam first meets it. */
    electric: 'multi-region-electric-1',
    magnetic: 'multi-region-magnetic-1',
  })
  scene.particles[0]!.position = quantityVector(
    input.position ?? vec3(-0.05, 0, 0),
    'm',
    'length',
  )
  return {
    ...scene,
    metadata: {
      ...scene.metadata,
      title: input.title ?? '多场区带电粒子运动',
      description:
        input.description ?? 'Composite Engine · 电场区 → 磁场区 → 复合场区 多相位穿越',
    },
  }
}
