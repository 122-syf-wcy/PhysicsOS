/**
 * Mechanical-energy rig → SceneVisualModel bridge.
 *
 * Projects the engine's ledger onto the shared visual contract. Every drawn
 * fact — how tall the ramp is, how far the cart slides, what the energies are —
 * comes from the Mechanical Energy Engine's closed form; this module only frames
 * the ramp and stacks the bar.
 *
 * Scene units are CENTIMETRES, the same as every other bench, so the height
 * dimension drawn beside the ramp carries a label that is literally the length
 * on screen.
 *
 * The bar is the figure's argument: three segments whose WIDTHS are the shares
 * of the energy the cart started with. A conservation rig draws the same total
 * length every time; a rig that leaked energy somewhere would draw a shorter
 * bar, which is the one fault a student would spot before reading a number.
 */

import { energyLedgerOf, type ResolvedEnergyModel } from '@physicsos/engine-mechanics'
import type { ObservableDefinition, PhysicsScene } from '@physicsos/physics-scene'

import { fmtFluidValue } from './fluid-visual-bridge.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  DimensionVisual,
  EnergyBarVisual,
  EnergyRampVisual,
  EnergySegmentVisual,
  ObservableKey,
  ObservableVisibility,
  ScenePoint,
  SceneVisualModel,
  VectorVisual,
} from './scene-visual-model.ts'

/** Metres → centimetres, the unit every rig on this bridge is drawn in. */
const cm = (metres: number): number => metres * 100

const joulesText = (value: number): string => `${fmtFluidValue(value, 4)} J`

/**
 * The cart's drawn size, in scene centimetres. Ink, not a measurement: the cart
 * is a body on the ramp, and its length along the slope says nothing about the
 * energy it carries.
 */
const CART_LENGTH = 9
const CART_HALF_HEIGHT = 2.2
/** How far the base of the ramp sits from the frame's origin, in centimetres. */
const RAMP_START = 6
/** Margins that keep the dimensions and the bar inside the frame. */
const ENERGY_MARGIN_X = 26
const ENERGY_MARGIN_Y = 20
/** Drawn size of the energy bar, in scene centimetres. */
const BAR_WIDTH = 34
const BAR_HEIGHT = 5
/** Gap between the ramp's foot and the bar, and above the ramp's peak. */
const BAR_OFFSET = 10

/**
 * The energy visual input shape used by the energy scene visuals module.
 */
export interface EnergyVisualInput {
  readonly scene: PhysicsScene
  readonly model: ResolvedEnergyModel
}

/**
 * Student-facing name of the rig.
 * @returns the formatted string.
 */
export const energyRigText = (): string => '动能与势能的转化'

/**
 * Scene observable definition → canvas toggle key. The bench factory stamps
 * `observable-energy-ledger` / `observable-energy-conversion`.
 * @returns the observable key.
 * @param definition - the observable definition.
 */
export const energyObservableKeyOf = (
  definition: ObservableDefinition,
): ObservableKey | undefined => {
  const id = String(definition.id)
  if (id.endsWith('-ledger')) return 'energy'
  if (id.endsWith('-conversion')) return 'energyConversion'
  return undefined
}

const visibilityOf = (scene: PhysicsScene): ObservableVisibility => {
  const visible: Partial<Record<ObservableKey, boolean>> = {}
  for (const definition of scene.observableDefinitions) {
    const key = energyObservableKeyOf(definition)
    if (key !== undefined) visible[key] = definition.visible
  }
  return visible
}

/**
 * The ramp is drawn rising to the RIGHT: the cart starts at the top right and
 * the ledger bar sits under the foot, where the cart arrives. A ramp drawn the
 * other way would put the release point on the left and read backwards against
 * every other left-to-right figure in the app.
 * @returns the scene visual model.
 * @param input - the visual input for this frame.
 */
export const energySceneVisual = (input: EnergyVisualInput): SceneVisualModel => {
  const {
    scene,
    model,
  } = input

  const ledger = energyLedgerOf(model)
  const visible = visibilityOf(scene)

  const height = cm(ledger.releaseHeight)
  const rampLength = cm(ledger.rampLength)
  const run = Math.hypot(rampLength, height) === 0 ? rampLength : Math.sqrt(rampLength ** 2 - height ** 2)
  const foot: ScenePoint = { x: RAMP_START, y: 0 }
  const peak: ScenePoint = { x: RAMP_START + run, y: height }

  const total = ledger.potentialAtRelease
  const share = (value: number): number => (total === 0 ? 0 : value / total)

  const ramp: EnergyRampVisual = {
    id: 'energy-ramp',
    base: foot,
    peak,
    height,
    cartLength: CART_LENGTH,
    cartHalfHeight: CART_HALF_HEIGHT,
    heightText: `h = ${fmtFluidValue(height, 4)} cm`,
    rampText: `L = ${fmtFluidValue(rampLength, 4)} cm`,
    potentialText: `Ep = ${joulesText(ledger.potentialAtRelease)}`,
    kineticText: `Ek = ${joulesText(ledger.kineticAtBottom)}`,
    thermalText: `Q = ${joulesText(ledger.frictionWork)}`,
    speedText: `v = ${fmtFluidValue(ledger.speedAtBottom, 4)} m/s`,
    label: '斜面与小车',
  }

  const segments: EnergySegmentVisual[] = [
    {
      id: 'kinetic',
      role: 'kinetic',
      text: ramp.kineticText,
      fraction: share(ledger.kineticAtBottom),
    },
    { id: 'thermal', role: 'thermal', text: ramp.thermalText, fraction: share(ledger.frictionWork) },
  ]

  const bar: EnergyBarVisual = {
    id: 'energy-bar',
    at: { x: foot.x, y: -BAR_OFFSET },
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    segments,
    totalText: `E = ${joulesText(total)}`,
    label: '能量账本',
  }

  /* The height rule stands in the left gutter, clear of the slope and of the
     cart that slides down it. */
  const dimensions: DimensionVisual[] = [
    {
      id: 'release-height',
      side: 'right',
      from: { x: foot.x, y: 0 },
      to: peak,
      label: ramp.rampText,
    },
    {
      id: 'height',
      from: { x: peak.x, y: 0 },
      to: peak,
      label: ramp.heightText,
    },
  ]

  /* The cart, drawn where it starts: the top of the slope, tilted with it. */
  const vectors: VectorVisual[] = []

  return emptyVisualModel('mechanics', {
    extent: {
      width: run + ENERGY_MARGIN_X * 2,
      height: height + ENERGY_MARGIN_Y * 2,
    },
    origin: { x: foot.x - ENERGY_MARGIN_X, y: -ENERGY_MARGIN_Y },
    grid: { minor: 5, major: 25 },
    axes: { x: '', y: '' },
    tickStep: 25,
    energyRamp: ramp,
    energyBar: bar,
    dimensions,
    vectors,
    overlay: {
      readout: [
        '机械能 Ek = ½mv² · Ep = mgh',
        `m = ${fmtFluidValue(ledger.mass, 4)} kg · h = ${fmtFluidValue(height, 4)} cm · θ = ${fmtFluidValue((ledger.inclineAngle * 180) / Math.PI, 4)}°`,
        `出发：Ep = mgh = ${joulesText(ledger.potentialAtRelease)}，Ek = 0`,
        `到底端：Ek = ${joulesText(ledger.kineticAtBottom)}，v = ${fmtFluidValue(ledger.speedAtBottom, 4)} m/s`,
        `摩擦生的热 Q = μmg·cosθ·L = ${joulesText(ledger.frictionWork)}${ledger.frictionCoefficient === 0 ? '（光滑斜面，一分不少地变成动能）' : ''}`,
        `账本：Ek + Q = ${joulesText(ledger.energyAccounted)} = Ep —— 机械能守恒`,
      ],
      scale: { label: '10 cm', length: 10 },
    },
    visible,
  })
}
