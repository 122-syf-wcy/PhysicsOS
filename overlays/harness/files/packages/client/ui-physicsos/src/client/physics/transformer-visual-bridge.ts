/**
 * Transformer rig → SceneVisualModel bridge.
 *
 * Projects the engine's ideal-transformer reading onto the shared visual
 * contract. Every drawn fact — the two windings, what each one reads, what the
 * machine does as a whole — comes from the Transformer Engine's closed form;
 * this module only frames it and formats strings.
 *
 * Scene units are arbitrary here (a transformer is a schematic, not a bench with
 * a ruler): the drawing's job is to put the four readings where they can be
 * compared, and the loop counts are ink rather than turns.
 */

import { transformerReadingOf, type ResolvedTransformerModel } from '@physicsos/engine-induction'
import type { ObservableDefinition, PhysicsScene } from '@physicsos/physics-scene'

import { fmtFluidValue } from './fluid-visual-bridge.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  ObservableKey,
  ObservableVisibility,
  SceneVisualModel,
  TransformerCoilVisual,
  TransformerCoreVisual,
} from './scene-visual-model.ts'

/** Drawn geometry of the schematic, in scene units. */
const COIL_HALF_WIDTH = 6
const COIL_HALF_HEIGHT = 14
const PRIMARY_X = -22
const SECONDARY_X = 22
const CORE_HALF_HEIGHT = 1.6
/** Drawn loops per winding: ink, capped so a 4000-turn coil still reads as a coil. */
const loopsOf = (turns: number): number => Math.min(12, Math.max(4, Math.round(turns / 100)))
const SPACING = (2 * COIL_HALF_WIDTH) / 12

/**
 * The transformer visual input shape used by the transformer scene visuals module.
 */
export interface TransformerVisualInput {
  readonly scene: PhysicsScene
  readonly model: ResolvedTransformerModel
}

/**
 * Student-facing name of the rig.
 * @returns the formatted string.
 */
export const transformerRigText = (): string => '变压器'

/**
 * Scene observable definition → canvas toggle key. The bench factory stamps
 * `observable-transformer-readings` / `observable-transformer-windings`.
 * @returns the observable key.
 * @param definition - the observable definition.
 */
export const transformerObservableKeyOf = (
  definition: ObservableDefinition,
): ObservableKey | undefined => {
  const id = String(definition.id)
  if (id.endsWith('-readings')) return 'voltage'
  if (id.endsWith('-windings')) return 'current'
  return undefined
}

const visibilityOf = (scene: PhysicsScene): ObservableVisibility => {
  const visible: Partial<Record<ObservableKey, boolean>> = {}
  for (const definition of scene.observableDefinitions) {
    const key = transformerObservableKeyOf(definition)
    if (key !== undefined) visible[key] = definition.visible
  }
  return visible
}

/**
 * The transformer scene visuals helper `transformerSceneVisual`.
 * @returns the scene visual model.
 * @param input - the visual input for this frame.
 */
export const transformerSceneVisual = (input: TransformerVisualInput): SceneVisualModel => {
  const {
    scene,
    model,
  } = input

  const reading = transformerReadingOf(
    model.primaryVoltage,
    model.primaryCurrent,
    model.primaryTurns,
    model.secondaryTurns,
  )
  const visible = visibilityOf(scene)

  const volt = (value: number) => `${fmtFluidValue(value, 4)} V`
  const amp = (value: number) => `${fmtFluidValue(value, 4)} A`
  const count = (value: number) => fmtFluidValue(value, 4)

  const coils: TransformerCoilVisual[] = [
    {
      id: 'primary-coil',
      at: { x: PRIMARY_X, y: 0 },
      halfWidth: COIL_HALF_WIDTH,
      halfHeight: COIL_HALF_HEIGHT,
      turnsLoops: loopsOf(reading.primaryTurns),
      spacing: SPACING,
      voltageText: `U₁ = ${volt(reading.primaryVoltage)}`,
      currentText: `I₁ = ${amp(reading.primaryCurrent)}`,
      turnsText: `N₁ = ${count(reading.primaryTurns)}`,
      primary: true,
    },
    {
      id: 'secondary-coil',
      at: { x: SECONDARY_X, y: 0 },
      halfWidth: COIL_HALF_WIDTH,
      halfHeight: COIL_HALF_HEIGHT,
      turnsLoops: loopsOf(reading.secondaryTurns),
      spacing: SPACING,
      voltageText: `U₂ = ${volt(reading.secondaryVoltage)}`,
      currentText: `I₂ = ${amp(reading.secondaryCurrent)}`,
      turnsText: `N₂ = ${count(reading.secondaryTurns)}`,
      primary: false,
    },
  ]

  const core: TransformerCoreVisual = {
    id: 'transformer-core',
    from: { x: PRIMARY_X - COIL_HALF_WIDTH - 4, y: 0 },
    to: { x: SECONDARY_X + COIL_HALF_WIDTH + 4, y: 0 },
    halfHeight: CORE_HALF_HEIGHT,
    ratioText: `N₁/N₂ = ${fmtFluidValue(reading.turnsRatio, 4)}`,
    powerText: `P₁ = P₂ = ${fmtFluidValue(reading.primaryPower, 4)} W`,
    stepsUp: reading.stepsUp,
    label: '铁芯',
  }

  return emptyVisualModel('induction', {
    extent: { width: 2 * (SECONDARY_X + COIL_HALF_WIDTH + 10), height: 2 * (COIL_HALF_HEIGHT + 14) },
    origin: { x: -(SECONDARY_X + COIL_HALF_WIDTH + 10), y: -(COIL_HALF_HEIGHT + 14) },
    grid: { minor: 2, major: 10 },
    axes: { x: '', y: '' },
    tickStep: 10,
    transformerCoils: coils,
    transformerCore: core,
    overlay: {
      readout: [
        '理想变压器 U₁/U₂ = N₁/N₂ · U₁I₁ = U₂I₂',
        `一次：${coils[0]?.voltageText} · ${coils[0]?.turnsText} · ${coils[0]?.currentText}`,
        `二次：${coils[1]?.voltageText} · ${coils[1]?.turnsText} · ${coils[1]?.currentText}`,
        reading.stepsUp
          ? 'N₂ > N₁：升压变压器 —— 电压升上去，电流按同一比值降下来'
          : 'N₂ < N₁：降压变压器 —— 电压降下来，电流按同一比值升上去',
        `${core.powerText}：理想变压器不改变功率`,
        '两个绕组穿同一个磁通，所以每个绕组的电压都等于自己的匝数乘以 dΦ/dt',
      ],
      scale: { label: '', length: 1 },
    },
    visible,
  })
}
