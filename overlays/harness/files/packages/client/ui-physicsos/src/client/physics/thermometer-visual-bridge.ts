/**
 * Thermometer rig → SceneVisualModel bridge.
 *
 * Projects the engine's expansion geometry onto the shared visual contract. Every
 * drawn fact — where the column stands, where the two fixed points are, how long
 * the graduated span is — comes from the Thermometer Engine's closed form; this
 * module only frames the glass and formats strings.
 *
 * Scene units are CENTIMETRES OF GLASS, so the figure is to scale: the distance
 * between 0 °C and 100 °C on screen IS the instrument's span. Rescaling it for
 * looks would throw away the one thing the picture is for.
 */

import { thermometerReadingOf, type ResolvedThermometerModel } from '@physicsos/engine-thermal'
import { CELSIUS_ZERO_IN_KELVIN } from '@physicsos/physics-scene'
import type { ObservableDefinition, PhysicsScene } from '@physicsos/physics-scene'

import { fmtFluidValue } from './fluid-visual-bridge.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  ObservableKey,
  ObservableVisibility,
  SceneVisualModel,
  ThermometerVisual,
} from './scene-visual-model.ts'

/** Metres → centimetres of glass. */
const cm = (metres: number): number => metres * 100
/** Drawn half-width of the tube and radius of the bulb — ink, not measurements. */
const TUBE_HALF_WIDTH = 0.35
const BULB_RADIUS = 0.9
const THERMOMETER_MARGIN = 1.6

export interface ThermometerVisualInput {
  readonly scene: PhysicsScene
  readonly model: ResolvedThermometerModel
}

/** Student-facing name of the rig. */
export const thermometerRigText = (): string => '液体温度计'

/**
 * Scene observable definition → canvas toggle key. The bench factory stamps
 * `observable-thermometer-scale` / `observable-thermometer-column`.
 */
export const thermometerObservableKeyOf = (
  definition: ObservableDefinition,
): ObservableKey | undefined => {
  const id = String(definition.id)
  if (id.endsWith('-scale')) return 'guides'
  if (id.endsWith('-column')) return 'thermometer'
  return undefined
}

const visibilityOf = (scene: PhysicsScene): ObservableVisibility => {
  const visible: Partial<Record<ObservableKey, boolean>> = {}
  for (const definition of scene.observableDefinitions) {
    const key = thermometerObservableKeyOf(definition)
    if (key !== undefined) visible[key] = definition.visible
  }
  return visible
}

export const thermometerSceneVisual = ({
  scene,
  model,
}: ThermometerVisualInput): SceneVisualModel => {
  const celsius = model.temperature - CELSIUS_ZERO_IN_KELVIN
  const reading = thermometerReadingOf(
    model.bulbVolume,
    model.boreDiameter,
    model.expansionCoefficient,
    celsius,
    model.icePointLength,
  )
  const visible = visibilityOf(scene)

  const visual: ThermometerVisual = {
    id: 'thermometer',
    at: { x: 0, y: 0 },
    halfWidth: TUBE_HALF_WIDTH,
    bulbRadius: BULB_RADIUS,
    columnTop: cm(reading.column),
    icePoint: cm(reading.icePoint),
    steamPoint: cm(reading.steamPoint),
    span: cm(reading.span),
    temperatureText: `${fmtFluidValue(celsius, 4)} °C`,
    /* Millimetres per degree is how a thermometer is actually spoken about. */
    scaleText: `k = ${fmtFluidValue(reading.scale * 1000, 4)} mm/°C`,
    fixedPointsText: `0 °C → ${fmtFluidValue(cm(reading.icePoint), 4)} cm · 100 °C → ${fmtFluidValue(cm(reading.steamPoint), 4)} cm`,
    spanText: `0–100 °C 之间液柱长 ${fmtFluidValue(cm(reading.span), 4)} cm`,
    columnText: `液柱 ${fmtFluidValue(cm(reading.column), 4)} cm`,
    label: '液体温度计',
  }

  const height = visual.steamPoint + THERMOMETER_MARGIN
  return emptyVisualModel('thermal', {
    extent: { width: 2 * (TUBE_HALF_WIDTH + 6), height: height + THERMOMETER_MARGIN },
    origin: { x: -(TUBE_HALF_WIDTH + 6), y: -BULB_RADIUS * 2 },
    grid: { minor: 1, major: 5 },
    axes: { x: '', y: '' },
    tickStep: 5,
    thermometer: visual,
    overlay: {
      readout: [
        '液体温度计 h = h₀ + k·t',
        visual.temperatureText,
        visual.scaleText,
        visual.fixedPointsText,
        visual.spanText,
        '刻度均匀不是约定：膨胀与温度成正比，所以每一度在玻璃上都是同样长的一段',
      ],
      scale: { label: '1 cm', length: 1 },
    },
    visible,
  })
}
