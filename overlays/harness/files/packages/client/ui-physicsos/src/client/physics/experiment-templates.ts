/**
 * Experiment template registry.
 *
 * The single source of experiment templates every entry point reads — sidebar
 * "新建", the Home quick action and the Lab empty state. A template is a small
 * input for a Scene Factory plus the locale keys the chooser shows; selecting
 * one builds a REAL {@link PhysicsScene} and hands it to the Lab, so there is
 * one shared PhysicsWorkspace shell and one canvas, not a workspace per
 * experiment.
 *
 * Copy lives in {@link locales.ts}, so `title`/`hint` here are KEYS, never
 * sentences: the same template reads correctly in zh and en.
 *
 * Cyclotron is intentionally absent from the selectable templates: the composite
 * engine models static uniform regions, not a time-dependent alternating field,
 * so a cyclotron here would be a fake. It is surfaced only as "即将支持".
 */

import {
  createCompositeFieldScene,
  createMassSpectrometerScene,
  createMechanicsScene,
  createMultiRegionFieldScene,
  createMagneticScene,
  createParallelPlateScene,
  createPointChargeScene,
  createVelocitySelectorScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import type { ReactElement } from 'react'

import type { PhysicsosKey } from '../locales.ts'
import type { PhysicsIconProps } from '../icons/physics-icons.tsx'
import {
  IconCompositeField,
  IconInclinedPlane,
  IconKinematics,
  IconMagneticCircle,
  IconMassSpectrometer,
  IconNewtonLaw,
  IconParallelPlate,
  IconPointCharge,
  IconProjectileHorizontal,
  IconProjectileOblique,
  IconUniformElectric,
  IconVelocity,
  IconVelocitySelector,
} from '../icons/physics-icons.tsx'

/** Domains a template belongs to, mirrored from the Lab runtime dispatch. */
export type ExperimentDomain = 'mechanics' | 'electric' | 'magnetic' | 'composite'

/** A pickable experiment. */
export interface ExperimentTemplate {
  readonly id: string
  readonly domain: ExperimentDomain
  /** Locale key for the experiment name. */
  readonly label: PhysicsosKey
  /** Locale key for the one-line description shown under the name. */
  readonly hint: PhysicsosKey
  readonly icon: (props: PhysicsIconProps) => ReactElement
  readonly tags: readonly string[]
  /** Build the real scene for this experiment. Stamps a fresh id per call. */
  readonly createScene: (title: string) => { sceneId: string; scene: PhysicsScene }
  /** True when the runtime cannot yet model this experiment honestly. */
  readonly comingSoon?: true
}

export interface ExperimentTemplateGroup {
  readonly id: ExperimentDomain
  /** Locale key for the group (tab) heading. */
  readonly label: PhysicsosKey
  readonly templates: readonly ExperimentTemplate[]
}

const g = 9.8

/* Each scene is stamped with a fresh id at creation time, so two students (or
   two creations by one student) never share a scene identity — the Lab keys its
   runtime on domain + scene id + revision, and a fixed id would silently keep
   the first runtime alive across recreations. The serial guards the same-
   millisecond double-create. */
let stampSerial = 0
const stampId = (base: string): string =>
  `${base}-${Date.now().toString(36)}-${(stampSerial++).toString(36)}`

/* ----------------------------------------------------------------- mechanics -- */

const mechanicsTemplates: readonly ExperimentTemplate[] = [
  {
    id: 'uniform-linear',
    domain: 'mechanics',
    label: 'lab.template.uniformLinear',
    hint: 'lab.template.uniformLinear.hint',
    icon: IconVelocity,
    tags: ['运动学'],
    createScene: (title) => {
      const scene = createMechanicsScene({
        sceneId: stampId('mechanics-uniform-linear'),
        model: 'uniform_linear_motion',
        mass: 1,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 4, y: 0, z: 0 },
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'uniform-acceleration',
    domain: 'mechanics',
    label: 'lab.template.uniformAcceleration',
    hint: 'lab.template.uniformAcceleration.hint',
    icon: IconKinematics,
    tags: ['运动学'],
    createScene: (title) => {
      const scene = createMechanicsScene({
        sceneId: stampId('mechanics-uniform-acceleration'),
        model: 'uniformly_accelerated_motion',
        mass: 1,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 2, y: 0, z: 0 },
        acceleration: { x: 1.5, y: 0, z: 0 },
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'projectile-horizontal',
    domain: 'mechanics',
    label: 'lab.template.projectileHorizontal',
    hint: 'lab.template.projectileHorizontal.hint',
    icon: IconProjectileHorizontal,
    tags: ['抛体'],
    createScene: (title) => {
      const scene = createMechanicsScene({
        sceneId: stampId('mechanics-projectile-horizontal'),
        model: 'projectile_motion',
        mass: 1,
        position: { x: 0, y: 20, z: 0 },
        velocity: { x: 10, y: 0, z: 0 },
        gravity: { x: 0, y: -g, z: 0 },
        groundY: 0,
        launchAngle: 0,
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'projectile-oblique',
    domain: 'mechanics',
    label: 'lab.template.projectileOblique',
    hint: 'lab.template.projectileOblique.hint',
    icon: IconProjectileOblique,
    tags: ['抛体'],
    createScene: (title) => {
      const scene = createMechanicsScene({
        sceneId: stampId('mechanics-projectile-oblique'),
        model: 'projectile_motion',
        mass: 1,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 20 * Math.cos((40 * Math.PI) / 180), y: 20 * Math.sin((40 * Math.PI) / 180), z: 0 },
        gravity: { x: 0, y: -g, z: 0 },
        groundY: 0,
        launchAngle: 40,
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'newton-second-law',
    domain: 'mechanics',
    label: 'lab.template.newton',
    hint: 'lab.template.newton.hint',
    icon: IconNewtonLaw,
    tags: ['力与运动'],
    createScene: (title) => {
      const scene = createMechanicsScene({
        sceneId: stampId('mechanics-newton-second-law'),
        model: 'newton_second_law',
        mass: 2,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        gravity: { x: 0, y: -g, z: 0 },
        appliedForce: { x: 10, y: 0, z: 0 },
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'incline',
    domain: 'mechanics',
    label: 'lab.template.incline',
    hint: 'lab.template.incline.hint',
    icon: IconInclinedPlane,
    tags: ['力与运动'],
    createScene: (title) => {
      const scene = createMechanicsScene({
        sceneId: stampId('mechanics-incline'),
        model: 'inclined_plane',
        mass: 2,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        gravity: { x: 0, y: -g, z: 0 },
        inclineAngle: 30,
        frictionCoefficient: 0.2,
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
]

/* ------------------------------------------------------------------ electric -- */

const electricTemplates: readonly ExperimentTemplate[] = [
  {
    id: 'point-charge',
    domain: 'electric',
    label: 'lab.template.pointCharge',
    hint: 'lab.template.pointCharge.hint',
    icon: IconPointCharge,
    tags: ['电场'],
    createScene: (title) => {
      const scene = createPointChargeScene({
        sceneId: stampId('electric-point-charge'),
        charges: [{ id: 'source-1', charge: 5e-6, position: { x: 0, y: 0, z: 0 } }],
        samplePoint: { x: 0.2, y: 0, z: 0 },
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'multi-point-charge',
    domain: 'electric',
    label: 'lab.template.multiPointCharge',
    hint: 'lab.template.multiPointCharge.hint',
    icon: IconPointCharge,
    tags: ['电场', '叠加'],
    createScene: (title) => {
      const scene = createPointChargeScene({
        sceneId: stampId('electric-multi-point-charge'),
        charges: [
          { id: 'source-1', charge: 4e-6, position: { x: -0.1, y: 0, z: 0 } },
          { id: 'source-2', charge: -4e-6, position: { x: 0.1, y: 0, z: 0 } },
        ],
        samplePoint: { x: 0, y: 0.1, z: 0 },
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'uniform-electric',
    domain: 'electric',
    label: 'lab.template.uniformElectric',
    hint: 'lab.template.uniformElectric.hint',
    icon: IconUniformElectric,
    tags: ['电场'],
    createScene: (title) => {
      const scene = createPointChargeScene({
        sceneId: stampId('electric-uniform-particle'),
        charges: [{ id: 'source-1', charge: 5e-6, position: { x: 0, y: 0, z: 0 } }],
        probe: { id: 'probe-1', charge: -1.6e-19, mass: 9.11e-31, position: { x: 0.2, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'parallel-plate',
    domain: 'electric',
    label: 'lab.template.parallelPlate',
    hint: 'lab.template.parallelPlate.hint',
    icon: IconParallelPlate,
    tags: ['电场', '偏转'],
    createScene: (title) => {
      const scene = createParallelPlateScene({
        sceneId: stampId('electric-parallel-plate'),
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
]

/* ------------------------------------------------------------------ magnetic -- */

const magneticTemplates: readonly ExperimentTemplate[] = [
  {
    id: 'magnetic-circular',
    domain: 'magnetic',
    label: 'lab.template.magnetic',
    hint: 'lab.template.magnetic.hint',
    icon: IconMagneticCircle,
    tags: ['磁场'],
    createScene: (title) => {
      const scene = createMagneticScene({
        sceneId: stampId('magnetic-circular'),
        charge: 1.6e-19,
        mass: 1.67e-27,
        velocity: { x: 2e6, y: 0, z: 0 },
        magneticFieldStrength: 0.5,
        magneticFieldDirection: 'into_page',
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
]

/* ----------------------------------------------------------------- composite -- */

const compositeTemplates: readonly ExperimentTemplate[] = [
  {
    id: 'velocity-selector',
    domain: 'composite',
    label: 'lab.template.velocitySelector',
    hint: 'lab.template.velocitySelector.hint',
    icon: IconVelocitySelector,
    tags: ['复合场'],
    createScene: (title) => {
      /* Defaults are chosen so v₀ = E/B exactly (E = 2.0e4 V/m, B = 0.20 T,
         v₀ = 1.0e5 m/s) AND the two forces actually oppose: with q > 0 and v
         along +x, qE points up only cancels qv×B when B points OUT of the page.
         The student breaks the balance by editing v₀ in the Lab. */
      const scene = createVelocitySelectorScene({
        sceneId: stampId('composite-velocity-selector'),
        charge: 1.6e-19,
        mass: 1.67e-27,
        velocity: { x: 1.0e5, y: 0, z: 0 },
        electricFieldStrength: 2.0e4,
        electricFieldDirection: 'up',
        magneticFieldStrength: 0.2,
        magneticFieldOrientation: 'out_of_page',
        regionWidth: 0.4,
        regionHeight: 0.2,
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'mass-spectrometer',
    domain: 'composite',
    label: 'lab.template.massSpectrometer',
    hint: 'lab.template.massSpectrometer.hint',
    icon: IconMassSpectrometer,
    tags: ['复合场'],
    createScene: (title) => {
      /* Field magnitudes are chosen so the apparatus is legible as well as
         correct: v = E/B = 1.0e5 m/s selects, and the deflection radius
         r = mv/(qB) ≈ 0.52 m is comparable to the 1.2 m deflection region, so the
         arc is a visible curve inside the apparatus rather than a proton-scale
         curl a student cannot see. */
      const scene = createMassSpectrometerScene({
        sceneId: stampId('composite-mass-spectrometer'),
        charge: 1.6e-19,
        mass: 1.67e-27,
        velocity: { x: 1.0e5, y: 0, z: 0 },
        electricFieldStrength: 200,
        electricFieldDirection: 'up',
        magneticFieldStrength: 2.0e-3,
        magneticFieldOrientation: 'out_of_page',
        deflectionWidth: 1.2,
        deflectionHeight: 1.2,
        duration: 2.4e-5,
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'composite-eb',
    domain: 'composite',
    label: 'lab.template.compositeEB',
    hint: 'lab.template.compositeEB.hint',
    icon: IconCompositeField,
    tags: ['复合场', 'E+B'],
    createScene: (title) => {
      /* B out of the page so qE (up) and qv×B (down) oppose at q > 0, v ∥ +x —
         the crossed-field drift world, not a rigged double-deflection. */
      const scene = createCompositeFieldScene({
        sceneId: stampId('composite-eb'),
        charge: 1.6e-19,
        mass: 1.67e-27,
        velocity: { x: 1.0e5, y: 0, z: 0 },
        electricFieldStrength: 2.0e4,
        electricFieldDirection: 'up',
        magneticFieldStrength: 0.2,
        magneticFieldOrientation: 'out_of_page',
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'composite-ebg',
    domain: 'composite',
    label: 'lab.template.compositeEBG',
    hint: 'lab.template.compositeEBG.hint',
    icon: IconCompositeField,
    tags: ['复合场', 'E+B+g'],
    createScene: (title) => {
      const scene = createCompositeFieldScene({
        sceneId: stampId('composite-ebg'),
        charge: 1.6e-19,
        mass: 1.67e-27,
        velocity: { x: 1.0e5, y: 0, z: 0 },
        electricFieldStrength: 2.0e4,
        electricFieldDirection: 'up',
        magneticFieldStrength: 0.2,
        magneticFieldOrientation: 'out_of_page',
        gravity: 9.8,
        /* Gravity is off by default in the factory (most composite questions
           neglect it); in the three-field experiment it is the point. */
        observableVisibility: { gravityForce: true },
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'multi-region-field',
    domain: 'composite',
    label: 'lab.template.multiRegion',
    hint: 'lab.template.multiRegion.hint',
    icon: IconCompositeField,
    tags: ['复合场', '多场区'],
    createScene: (title) => {
      const scene = createMultiRegionFieldScene({
        sceneId: stampId('composite-multi-region'),
        charge: 1.6e-19,
        mass: 1.67e-27,
        velocity: { x: 1.0e5, y: 0, z: 0 },
        electricFieldStrength: 2.0e4,
        electricFieldDirection: 'up',
        magneticFieldStrength: 0.2,
        magneticFieldOrientation: 'out_of_page',
        title,
      })
      return { sceneId: String(scene.id), scene }
    },
  },
  {
    id: 'cyclotron',
    domain: 'composite',
    label: 'lab.template.cyclotron',
    hint: 'lab.template.cyclotron.hint',
    icon: IconMagneticCircle,
    tags: ['复合场'],
    /* The composite engine models static uniform regions, not a time-dependent
       alternating field. A cyclotron here would compute the wrong trajectory, so
       it is shown as "即将支持" until the engine gains time-dependent fields. */
    comingSoon: true,
    createScene: () => {
      throw new Error('cyclotron is not yet modelled by the composite engine')
    },
  },
]

/** Ordered groups, one per domain. The "全部" tab is built by flattening these. */
export const EXPERIMENT_TEMPLATE_GROUPS: readonly ExperimentTemplateGroup[] = [
  { id: 'mechanics', label: 'lab.template.group.mechanics', templates: mechanicsTemplates },
  { id: 'electric', label: 'lab.template.group.electric', templates: electricTemplates },
  { id: 'magnetic', label: 'lab.template.group.magnetic', templates: magneticTemplates },
  { id: 'composite', label: 'lab.template.group.composite', templates: compositeTemplates },
]

/** Every selectable template, flattened across groups. */
export const EXPERIMENT_TEMPLATES: readonly ExperimentTemplate[] =
  EXPERIMENT_TEMPLATE_GROUPS.flatMap(group => group.templates)

/** Count of templates a student can actually create (excludes comingSoon). */
export const SELECTABLE_TEMPLATE_COUNT = EXPERIMENT_TEMPLATES.filter(
  template => template.comingSoon !== true,
).length

export const findExperimentTemplate = (id: string): ExperimentTemplate | undefined =>
  EXPERIMENT_TEMPLATES.find(template => template.id === id)

/**
 * Build the scene handover for a template.
 *
 * Shared by every entry point so the sidebar popover, the Home action and the
 * Lab empty state produce byte-identical scenes; the title is passed in because
 * it is UI copy and only the caller holds the translator.
 */
export const createExperimentSceneRef = (
  template: ExperimentTemplate,
  title: string,
): { sceneId: string; scene: PhysicsScene } => template.createScene(title)
