/**
 * Mechanics experiment templates.
 *
 * Each entry is a small input for the Mechanics Scene Factory plus the locale
 * keys the "新建" popover and the Lab empty state show. Selecting one builds a
 * real PhysicsScene → Runtime → Canvas; there is no separate per-experiment
 * workspace, only different inputs into the one shared PhysicsWorkspace.
 *
 * Copy lives in locales.ts, so these are KEYS, never sentences: the same
 * template has to read correctly in zh and en.
 */

import { createMechanicsScene, type MechanicsSceneInput, type PhysicsScene } from '@physicsos/physics-scene'
import type { ReactElement } from 'react'
import type { PhysicsosKey } from '../locales.ts'
import type { PhysicsIconProps } from '../icons/physics-icons.tsx'
import {
  IconInclinedPlane,
  IconKinematics,
  IconNewtonLaw,
  IconProjectileHorizontal,
  IconProjectileOblique,
  IconVelocity,
} from '../icons/physics-icons.tsx'

export interface MechanicsTemplateGroup {
  id: string
  /** Locale key for the group heading. */
  label: PhysicsosKey
  templates: readonly MechanicsTemplate[]
}

export interface MechanicsTemplate {
  id: string
  /** Locale key for the experiment name. */
  label: PhysicsosKey
  /** Locale key for the one-line parameter hint under the name. */
  hint: PhysicsosKey
  icon: (props: PhysicsIconProps) => ReactElement
  input: MechanicsSceneInput
}

const g = 9.8

/* Every template pins its own sceneId. The factory would otherwise fall back to
   `mechanics-<model>-scene`, and the Lab keys its runtime on domain + scene id +
   revision: 平抛 and 斜抛 share the projectile model, so a shared id would make
   switching between them silently keep the first runtime alive. */
export const MECHANICS_TEMPLATE_GROUPS: readonly MechanicsTemplateGroup[] = [
  {
    id: 'kinematics',
    label: 'lab.template.group.kinematics',
    templates: [
      {
        id: 'uniform-linear',
        label: 'lab.template.uniformLinear',
        hint: 'lab.template.uniformLinear.hint',
        icon: IconVelocity,
        input: {
          sceneId: 'mechanics-uniform-linear',
          model: 'uniform_linear_motion',
          mass: 1,
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 4, y: 0, z: 0 },
        },
      },
      {
        id: 'uniform-acceleration',
        label: 'lab.template.uniformAcceleration',
        hint: 'lab.template.uniformAcceleration.hint',
        icon: IconKinematics,
        input: {
          sceneId: 'mechanics-uniform-acceleration',
          model: 'uniformly_accelerated_motion',
          mass: 1,
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 2, y: 0, z: 0 },
          acceleration: { x: 1.5, y: 0, z: 0 },
        },
      },
    ],
  },
  {
    id: 'projectile',
    label: 'lab.template.group.projectile',
    templates: [
      {
        id: 'projectile-horizontal',
        label: 'lab.template.projectileHorizontal',
        hint: 'lab.template.projectileHorizontal.hint',
        icon: IconProjectileHorizontal,
        input: {
          sceneId: 'mechanics-projectile-horizontal',
          model: 'projectile_motion',
          mass: 1,
          position: { x: 0, y: 20, z: 0 },
          velocity: { x: 10, y: 0, z: 0 },
          gravity: { x: 0, y: -g, z: 0 },
          groundY: 0,
          launchAngle: 0,
        },
      },
      {
        id: 'projectile-oblique',
        label: 'lab.template.projectileOblique',
        hint: 'lab.template.projectileOblique.hint',
        icon: IconProjectileOblique,
        input: {
          sceneId: 'mechanics-projectile-oblique',
          model: 'projectile_motion',
          mass: 1,
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 20 * Math.cos((40 * Math.PI) / 180), y: 20 * Math.sin((40 * Math.PI) / 180), z: 0 },
          gravity: { x: 0, y: -g, z: 0 },
          groundY: 0,
          launchAngle: 40,
        },
      },
    ],
  },
  {
    id: 'dynamics',
    label: 'lab.template.group.dynamics',
    templates: [
      {
        id: 'newton-second-law',
        label: 'lab.template.newton',
        hint: 'lab.template.newton.hint',
        icon: IconNewtonLaw,
        input: {
          sceneId: 'mechanics-newton-second-law',
          model: 'newton_second_law',
          mass: 2,
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          gravity: { x: 0, y: -g, z: 0 },
          appliedForce: { x: 10, y: 0, z: 0 },
        },
      },
      {
        id: 'incline',
        label: 'lab.template.incline',
        hint: 'lab.template.incline.hint',
        icon: IconInclinedPlane,
        input: {
          sceneId: 'mechanics-incline',
          model: 'inclined_plane',
          mass: 2,
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
          gravity: { x: 0, y: -g, z: 0 },
          inclineAngle: 30,
          frictionCoefficient: 0.2,
        },
      },
    ],
  },
]

export const findMechanicsTemplate = (id: string): MechanicsTemplate | undefined => {
  for (const group of MECHANICS_TEMPLATE_GROUPS) {
    const found = group.templates.find(template => template.id === id)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Build the scene handover for a template.
 *
 * Shared by the sidebar popover and the Lab empty state so both entry points
 * produce byte-identical scenes; the title is passed in because it is UI copy
 * and only the caller holds the translator.
 * @param template - chosen template.
 * @param title - localized scene title shown in the Lab toolbar.
 */
export const createTemplateSceneRef = (
  template: MechanicsTemplate,
  title: string,
): { sceneId: string; scene: PhysicsScene } => {
  const scene = createMechanicsScene({ ...template.input, title })
  return { sceneId: String(scene.id), scene }
}
