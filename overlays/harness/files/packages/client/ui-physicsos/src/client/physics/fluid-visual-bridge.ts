/**
 * Fluid statics → SceneVisualModel bridge.
 *
 * Projects a verified buoyancy frame onto the shared visual contract. Every
 * drawn fact — how deep the block is, how much of it is under, the reading on
 * the dial, the length of each force arrow — comes from the Fluid Engine's
 * resolved model and immersion state; this module only frames the tank, picks
 * arrow lengths and formats strings. It never computes a force.
 *
 * Scene units on the canvas are CENTIMETRES: the block is authored in cm and
 * cm³, which is what the student reads off the ruler and the measuring cup.
 */

import type { ImmersionState, ResolvedFluidModel } from '@physicsos/engine-fluid'
import { fluidTankOf, type ObservableDefinition, type PhysicsScene } from '@physicsos/physics-scene'

import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  DimensionVisual,
  FluidBlockVisual,
  FluidLiquidVisual,
  FluidScaleVisual,
  GuideVisual,
  ObservableKey,
  ObservableVisibility,
  SceneVisualModel,
  VectorVisual,
} from './scene-visual-model.ts'

/** Metres → centimetres, the unit the tank is drawn in. */
const cm = (metres: number): number => metres * 100

export const fmtFluidValue = (value: number, digits = 4): string => {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) < 1e-12) return '0'
  return String(Number.parseFloat(value.toPrecision(digits)))
}

/**
 * Scene observable definition → canvas toggle key. The fluid factory stamps
 * `observable-fluid-forces` / `observable-fluid-displaced`, so the key is
 * carried by the id rather than inferred from the observable type.
 */
export const fluidObservableKeyOf = (
  definition: ObservableDefinition,
): ObservableKey | undefined => {
  const id = String(definition.id)
  if (id.endsWith('-forces')) return 'forces'
  if (id.endsWith('-displaced')) return 'displaced'
  return undefined
}

const visibilityOf = (scene: PhysicsScene): ObservableVisibility => {
  const visible: Partial<Record<ObservableKey, boolean>> = {}
  for (const definition of scene.observableDefinitions) {
    const key = fluidObservableKeyOf(definition)
    if (key !== undefined) visible[key] = definition.visible
  }
  return visible
}

/** Student-facing one-liner for the block's current stage of the descent. */
export const immersionPhaseText = (phase: ImmersionState['phase']): string => {
  switch (phase) {
    case 'dry':
      return '未入水（底面刚好齐液面）'
    case 'entering':
      return '正在浸入（V_排 还在变大）'
    case 'submerged':
      return '已完全浸没（V_排 不再变化）'
    case 'floating':
      return '漂浮平衡（F_浮 = G，测力计读数为零）'
  }
}

export interface FluidVisualInput {
  readonly scene: PhysicsScene
  readonly model: ResolvedFluidModel
  readonly immersion: ImmersionState
  /** Scene time in seconds the frame is showing. */
  readonly time: number
}

/** Build one buoyancy frame from the verified immersion state. */
export const fluidSceneVisual = ({
  scene,
  model,
  immersion,
  time,
}: FluidVisualInput): SceneVisualModel => {
  const tank = fluidTankOf(scene)
  if (tank === undefined) return emptyVisualModel('fluid')

  const blockHeight = cm(model.blockHeight)
  /* A square-ish face reads as a block without claiming a specific footprint:
     the model only fixes the volume and the height, and the cross-section is
     what the physics uses. Width is picked purely for the picture. */
  const blockWidth = blockHeight * 1.1
  const tankWidth = blockWidth * 4.2
  /* Deep enough for the whole run plus a floor gap, so the block never draws
     through the bottom of the tank. */
  const tankDepth = cm(model.blockHeight) * 2 + blockHeight * 0.6

  const surface = 0
  const floor = -tankDepth
  const left = -tankWidth / 2
  const right = tankWidth / 2

  const depth = cm(immersion.depth)
  const blockBottom = surface - depth
  const blockTop = blockBottom + blockHeight
  const submergedTop = Math.min(blockTop, surface)

  const fluidLiquid: FluidLiquidVisual = {
    id: model.liquidId,
    left,
    right,
    surface,
    floor,
    label: tank.liquid.name ?? '液体',
  }

  const fluidBlock: FluidBlockVisual = {
    id: model.blockId,
    at: { x: 0, y: blockBottom + blockHeight / 2 },
    halfWidth: blockWidth / 2,
    halfHeight: blockHeight / 2,
    submergedTop,
    phase: immersion.phase,
    label: tank.block.name ?? '物块',
  }

  const weight = model.blockMass * model.gravity
  const fluidScale: FluidScaleVisual = {
    id: 'spring-scale',
    at: { x: 0, y: blockHeight * 2.4 },
    reading: `${immersion.scaleReading.toFixed(2)} N`,
    label: '弹簧测力计',
  }

  /* Free-body arrows on the block, scaled off the weight so the three always
     read against each other: G down, F_浮 up, F_示 up. Lengths are proportional
     to the engine's forces — nothing here is drawn to a fixed size. */
  const arrowSpan = blockHeight * 1.5
  const perNewton = weight === 0 ? 0 : arrowSpan / weight
  const centre = { x: 0, y: blockBottom + blockHeight / 2 }
  const vectors: VectorVisual[] = [
    {
      id: 'force-weight',
      observable: 'forces',
      role: 'force',
      from: centre,
      to: { x: centre.x, y: centre.y - weight * perNewton },
      symbol: 'G',
    },
  ]
  if (immersion.buoyantForce > 0) {
    vectors.push({
      id: 'force-buoyancy',
      observable: 'forces',
      role: 'force',
      from: centre,
      to: { x: centre.x, y: centre.y + immersion.buoyantForce * perNewton },
      symbol: 'F_浮',
    })
  }
  if (immersion.scaleReading > 0) {
    vectors.push({
      id: 'force-scale',
      observable: 'forces',
      role: 'force',
      from: { x: centre.x + blockWidth * 0.32, y: centre.y },
      to: {
        x: centre.x + blockWidth * 0.32,
        y: centre.y + immersion.scaleReading * perNewton,
      },
      symbol: 'F_示',
      subordinate: true,
    })
  }

  /* The submerged slab measured off to the side: this height times the block's
     cross-section IS the displaced volume the whole law is about. */
  const submergedHeight = cm(immersion.submergedHeight)
  const dimensions: DimensionVisual[] =
    submergedHeight <= 0
      ? []
      : [
        {
          id: 'submerged-height',
          from: { x: -blockWidth * 0.62, y: submergedTop - submergedHeight },
          to: { x: -blockWidth * 0.62, y: submergedTop },
          label: `V_排 = ${fmtFluidValue(immersion.displacedVolume * 1e6, 4)} cm³`,
        },
      ]

  /* The liquid surface continued across the block, so "how deep it is" is read
     off the same line the eye already follows. */
  const guides: GuideVisual[] = [
    {
      id: 'surface-line',
      observable: 'displaced',
      from: { x: left, y: surface },
      to: { x: right, y: surface },
      label: '液面',
    },
  ]

  const readout: string[] = [
    '称重法读数',
    `t = ${time.toFixed(2)} s · ${immersionPhaseText(immersion.phase)}`,
    `F_示 = ${fmtFluidValue(immersion.scaleReading, 3)} N · F_浮 = ${fmtFluidValue(immersion.buoyantForce, 3)} N`,
    `ρ_液 = ${fmtFluidValue(model.liquidDensity)} kg/m³`,
  ]

  const top = blockHeight * 3
  const margin = blockWidth * 0.6

  return emptyVisualModel('fluid', {
    extent: { width: tankWidth + 2 * margin, height: top - floor },
    origin: { x: left - margin, y: floor },
    grid: { minor: 1, major: 5 },
    axes: { x: '', y: 'y / cm' },
    tickStep: 5,
    guides,
    dimensions,
    vectors,
    fluidLiquid,
    fluidBlock,
    fluidScale,
    overlay: {
      readout,
      scale: { label: '5 cm', length: 5 },
    },
    visible: visibilityOf(scene),
  })
}
