/**
 * Lever statics → SceneVisualModel bridge.
 *
 * Projects a verified class-1 lever frame onto the shared visual contract.
 * Every drawn fact — where each hanger sits, how far the beam has tipped,
 * the length of each arm — comes from the Lever Engine's resolved model and
 * state; this module only frames the apparatus, rotates the beam and formats
 * strings. It never computes a moment.
 *
 * Scene units on the canvas are CENTIMETRES: the arms are authored in cm,
 * which is what the student reads off the lever's scale.
 */

import type { LeverState, ResolvedLeverModel } from '@physicsos/engine-lever'
import { leverBenchOf, type ObservableDefinition, type PhysicsScene } from '@physicsos/physics-scene'

import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  DimensionVisual,
  LeverBeamVisual,
  LeverFulcrumVisual,
  LeverHangerVisual,
  ObservableKey,
  ObservableVisibility,
  ScenePoint,
  SceneVisualModel,
  VectorVisual,
} from './scene-visual-model.ts'

/** Metres → centimetres, the unit the lever is drawn in. */
const cm = (metres: number): number => metres * 100

export const fmtLeverValue = (value: number, digits = 4): string => {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) < 1e-12) return '0'
  return String(Number.parseFloat(value.toPrecision(digits)))
}

export const leverObservableKeyOf = (
  definition: ObservableDefinition,
): ObservableKey | undefined => {
  const id = String(definition.id)
  if (id.endsWith('-moments')) return 'moments'
  if (id.endsWith('-arms')) return 'arms'
  return undefined
}

const visibilityOf = (scene: PhysicsScene): ObservableVisibility => {
  const visible: Partial<Record<ObservableKey, boolean>> = {}
  for (const definition of scene.observableDefinitions) {
    const key = leverObservableKeyOf(definition)
    if (key !== undefined) visible[key] = definition.visible
  }
  return visible
}

export const leverPhaseText = (state: LeverState): string => {
  switch (state.phase) {
    case 'balanced':
      return 'F₁l₁ = F₂l₂ · 杠杆平衡'
    case 'settling':
      return state.moments.netMoment > 0 ? '左端力矩更大，正在下沉' : '右端力矩更大，正在下沉'
    case 'tipped':
      return state.moments.netMoment > 0 ? '左端下沉（力矩不平衡）' : '右端下沉（力矩不平衡）'
  }
}

export interface LeverVisualInput {
  readonly scene: PhysicsScene
  readonly model: ResolvedLeverModel
  readonly state: LeverState
  readonly time: number
}

const rotate = (point: ScenePoint, tilt: number): ScenePoint => ({
  x: point.x * Math.cos(tilt) - point.y * Math.sin(tilt),
  y: point.x * Math.sin(tilt) + point.y * Math.cos(tilt),
})

/** Build one lever frame from the verified statics state. */
export const leverSceneVisual = ({
  scene,
  model,
  state,
  time,
}: LeverVisualInput): SceneVisualModel => {
  const bench = leverBenchOf(scene)
  if (bench === undefined) return emptyVisualModel('mechanics')

  const halfBeam = cm(model.beamLength) / 2
  const leftArm = cm(model.left.armLength)
  const rightArm = cm(model.right.armLength)
  const string = 8
  const tilt = state.tilt

  const leftAttach = rotate({ x: -leftArm, y: 0 }, tilt)
  const rightAttach = rotate({ x: rightArm, y: 0 }, tilt)
  const leftEnd = rotate({ x: -halfBeam, y: 0 }, tilt)
  const rightEnd = rotate({ x: halfBeam, y: 0 }, tilt)
  const leftMass = { x: leftAttach.x, y: leftAttach.y - string }
  const rightMass = { x: rightAttach.x, y: rightAttach.y - string }

  const leverBeam: LeverBeamVisual = {
    id: model.leverId,
    from: leftEnd,
    to: rightEnd,
    tilt,
  }
  const leverFulcrum: LeverFulcrumVisual = { id: 'fulcrum', at: { x: 0, y: 0 } }

  const leftHanger: LeverHangerVisual = {
    id: model.left.hangerId,
    side: 'left',
    attach: leftAttach,
    massAt: leftMass,
    label: bench.hangers.find(hanger => hanger.id === model.left.hangerId)?.name ?? '左钩码',
    massText: `${fmtLeverValue(model.left.mass * 1000, 4)} g`,
  }
  const rightHanger: LeverHangerVisual = {
    id: model.right.hangerId,
    side: 'right',
    attach: rightAttach,
    massAt: rightMass,
    label: bench.hangers.find(hanger => hanger.id === model.right.hangerId)?.name ?? '右钩码',
    massText: `${fmtLeverValue(model.right.mass * 1000, 4)} g`,
  }

  const dimensions: DimensionVisual[] = [
    {
      id: 'arm-left',
      from: { x: 0, y: 2.4 },
      to: { x: -leftArm, y: 2.4 },
      label: `l₁ = ${fmtLeverValue(leftArm, 3)} cm`,
    },
    {
      id: 'arm-right',
      from: { x: 0, y: 2.4 },
      to: { x: rightArm, y: 2.4 },
      label: `l₂ = ${fmtLeverValue(rightArm, 3)} cm`,
    },
  ]

  const arrow = 6
  const vectors: VectorVisual[] = [
    {
      id: 'force-left',
      observable: 'moments',
      role: 'gravity',
      from: leftMass,
      to: { x: leftMass.x, y: leftMass.y - arrow },
      symbol: 'G₁',
    },
    {
      id: 'force-right',
      observable: 'moments',
      role: 'gravity',
      from: rightMass,
      to: { x: rightMass.x, y: rightMass.y - arrow },
      symbol: 'G₂',
    },
  ]

  const leftMomentCm = state.moments.leftMoment * 100
  const rightMomentCm = state.moments.rightMoment * 100
  const readout: string[] = [
    '杠杆读数',
    `t = ${time.toFixed(2)} s · ${leverPhaseText(state)}`,
    `M₁ = ${fmtLeverValue(leftMomentCm, 4)} N·cm · M₂ = ${fmtLeverValue(rightMomentCm, 4)} N·cm`,
    `G₁ = ${fmtLeverValue(state.moments.leftWeight, 3)} N · G₂ = ${fmtLeverValue(state.moments.rightWeight, 3)} N`,
  ]

  const span = halfBeam * 2 + 8
  return emptyVisualModel('mechanics', {
    extent: { width: span, height: 28 },
    origin: { x: -span / 2, y: -16 },
    grid: { minor: 1, major: 5 },
    axes: { x: '', y: '' },
    tickStep: 5,
    dimensions,
    vectors,
    leverBeam,
    leverFulcrum,
    leverHangers: [leftHanger, rightHanger],
    overlay: {
      readout,
      scale: { label: '5 cm', length: 5 },
    },
    visible: visibilityOf(scene),
  })
}
