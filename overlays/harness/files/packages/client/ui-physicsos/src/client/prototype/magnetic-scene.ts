/**
 * Magnetic lab input and presentation metadata.
 *
 * This module deliberately contains no Physics facts or formulas. The
 * Physics Runtime Bridge turns this input into a PhysicsScene, then exposes
 * Engine/Verifier/Observation output to the UI.
 */
import type { LabObservableId, LabParameter } from '../lab-view-model.ts'

export const MAGNETIC_SCENE_TITLE = '磁场中的带电粒子运动'
export const MAGNETIC_SCENE_SUBTITLE = '匀强磁场 · 带电粒子垂直入射'

/** Initial editable values only; mutations go through SceneCommand. */
export const MAGNETIC_PARAMETERS: readonly LabParameter[] = [
  { id: 'q', label: '粒子电荷', symbol: 'q', unit: 'C', value: 1.6e-19 },
  { id: 'm', label: '粒子质量', symbol: 'm', unit: 'kg', value: 1.67e-27 },
  { id: 'v0', label: '初速度', symbol: 'v₀', unit: 'm/s', value: 2e6 },
]

export const MAGNETIC_FIELD_PARAMETERS: readonly LabParameter[] = [
  { id: 'B', label: '磁感应强度', symbol: 'B', unit: 'T', value: 0.5 },
]

export const MAGNETIC_SCENE_INPUT = {
  sceneId: 'magnetic-runtime-scene',
  particleId: 'particle-1',
  fieldId: 'field-1',
  charge: 1.6e-19,
  mass: 1.67e-27,
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 2e6, y: 0, z: 0 },
  magneticFieldStrength: 0.5,
  magneticFieldDirection: 'into_page' as const,
} as const

export const MAGNETIC_FIELD_DIRECTION_OPTIONS = ['垂直纸面向里', '垂直纸面向外'] as const

export const MAGNETIC_OBSERVABLE_DEFAULTS: Readonly<Record<LabObservableId, boolean>> = {
  velocity: true,
  force: true,
  trajectory: true,
  center: false,
  radius: false,
  guides: false,
}

export const MAGNETIC_OBSERVABLE_LABELS: readonly { id: LabObservableId; label: string }[] = [
  { id: 'velocity', label: '速度' },
  { id: 'force', label: '洛伦兹力' },
  { id: 'trajectory', label: '运动轨迹' },
  { id: 'center', label: '圆心' },
  { id: 'radius', label: '半径' },
  { id: 'guides', label: '辅助线' },
]
