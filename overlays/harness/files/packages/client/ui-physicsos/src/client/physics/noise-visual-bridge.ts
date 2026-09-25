/**
 * Noise rig → SceneVisualModel bridge.
 *
 * Projects the engine's level calculation onto the shared visual contract. Every
 * drawn fact — how far the listener stands, what the meter reads there, what the
 * barrier saves — comes from the Noise Engine's closed form; this module only
 * frames the rig and formats strings.
 *
 * Scene units are METRES, to scale, because the subject IS the distance: the
 * listener is drawn where it stands, and 音强按 1/r² 衰减 becomes something the
 * eye can check by moving it.
 */

import { noiseReadingOf, type ResolvedNoiseModel } from '@physicsos/engine-acoustics'
import type { ObservableDefinition, PhysicsScene } from '@physicsos/physics-scene'

import { fmtFluidValue } from './fluid-visual-bridge.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  NoiseRigVisual,
  ObservableKey,
  ObservableVisibility,
  SceneVisualModel,
} from './scene-visual-model.ts'

/** How many wavefront arcs are drawn, and at what fractions of the distance. */
const WAVEFRONT_FRACTIONS = [0.35, 0.6, 0.85] as const
const NOISE_MARGIN = 0.9

export interface NoiseVisualInput {
  readonly scene: PhysicsScene
  readonly model: ResolvedNoiseModel
}

/** Student-facing name of the rig. */
export const noiseRigText = (): string => '噪声的减弱'

/**
 * Scene observable definition → canvas toggle key. The bench factory stamps
 * `observable-noise-level` / `observable-noise-spreading`.
 */
export const noiseObservableKeyOf = (
  definition: ObservableDefinition,
): ObservableKey | undefined => {
  const id = String(definition.id)
  if (id.endsWith('-level')) return 'thermometer'
  if (id.endsWith('-spreading')) return 'wavefronts'
  return undefined
}

const visibilityOf = (scene: PhysicsScene): ObservableVisibility => {
  const visible: Partial<Record<ObservableKey, boolean>> = {}
  for (const definition of scene.observableDefinitions) {
    const key = noiseObservableKeyOf(definition)
    if (key !== undefined) visible[key] = definition.visible
  }
  return visible
}

export const noiseSceneVisual = ({ scene, model }: NoiseVisualInput): SceneVisualModel => {
  const reading = noiseReadingOf(model.soundPowerLevel, model.distance, model.barrierAttenuation)
  const visible = visibilityOf(scene)
  const distance = reading.distance

  const level = (value: number) => `${fmtFluidValue(value, 4)} dB`
  const rig: NoiseRigVisual = {
    id: 'noise-rig',
    sourceAt: { x: 0, y: 0 },
    listenerAt: { x: distance, y: 0 },
    distance,
    ...(reading.barrierAttenuation > 0
      ? { barrierAt: { x: distance / 2, y: 0 } }
      : {}),
    wavefronts: WAVEFRONT_FRACTIONS.map(fraction => fraction * distance),
    levelText: `L = ${level(reading.level)}`,
    sourceText: `Lw = ${level(reading.soundPowerLevel)}`,
    distanceText: `r = ${fmtFluidValue(distance, 4)} m`,
    barrierText: reading.barrierAttenuation === 0
      ? '没有屏障'
      : `隔声量 ${level(reading.barrierAttenuation)}`,
    comparisonText: `无屏障时 ${level(reading.levelWithoutBarrier)}`,
    label: '声源、听者与屏障',
  }

  return emptyVisualModel('acoustics', {
    extent: { width: distance + 2 * NOISE_MARGIN, height: 2 * NOISE_MARGIN + 1.2 },
    origin: { x: -NOISE_MARGIN, y: -(NOISE_MARGIN + 0.6) },
    grid: { minor: 0.5, major: 1 },
    axes: { x: '', y: '' },
    tickStep: 1,
    noiseRig: rig,
    overlay: {
      readout: [
        '噪声 L = 10·lg(I/I₀) · I = P/(4πr²)',
        `${rig.sourceText} · ${rig.distanceText}`,
        `听者处：${rig.levelText}`,
        `${rig.barrierText} · ${rig.comparisonText}`,
        '距离加倍少 6 dB —— 声强只剩四分之一；dB 是对数，所以"只降 6 dB"其实拿掉了四分之三的能量',
      ],
      scale: { label: '1 m', length: 1 },
    },
    visible,
  })
}
