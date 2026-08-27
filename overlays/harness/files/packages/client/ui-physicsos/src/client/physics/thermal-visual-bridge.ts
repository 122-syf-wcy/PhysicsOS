/**
 * Thermal → SceneVisualModel bridge.
 *
 * Projects a verified heating frame onto the shared visual contract. Every
 * drawn fact — the thermometer column, how much of the sample has melted, the
 * heat absorbed so far — comes from the Thermal Engine's resolved model and
 * state; this module only frames the bench, maps temperature onto a column
 * height and formats strings. It never computes a joule.
 *
 * Temperatures cross the engine boundary in kelvin because that is the unit the
 * registry can convert honestly. Everything the student sees is °C, and this is
 * the single place the conversion happens.
 */

import type { ResolvedThermalModel, ThermalState } from '@physicsos/engine-thermal'
import {
  CELSIUS_ZERO_IN_KELVIN,
  thermalBenchOf,
  type ObservableDefinition,
  type PhysicsScene,
} from '@physicsos/physics-scene'

import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  GuideVisual,
  ObservableKey,
  ObservableVisibility,
  SceneVisualModel,
  ThermalHeaterVisual,
  ThermalSampleVisual,
  ThermalThermometerVisual,
} from './scene-visual-model.ts'

/** Kelvin → °C, the unit every reading in this domain is shown in. */
export const celsiusOf = (kelvin: number): number => kelvin - CELSIUS_ZERO_IN_KELVIN

export const fmtThermalValue = (value: number, digits = 4): string => {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) < 1e-9) return '0'
  return String(Number.parseFloat(value.toPrecision(digits)))
}

/**
 * Scene observable definition → canvas toggle key. The thermal factory stamps
 * `observable-thermal-thermometer` / `observable-thermal-phase`, so the key is
 * carried by the id rather than inferred from the observable type.
 */
export const thermalObservableKeyOf = (
  definition: ObservableDefinition,
): ObservableKey | undefined => {
  const id = String(definition.id)
  if (id.endsWith('-thermometer')) return 'thermometer'
  if (id.endsWith('-phase')) return 'phase'
  return undefined
}

const visibilityOf = (scene: PhysicsScene): ObservableVisibility => {
  const visible: Partial<Record<ObservableKey, boolean>> = {}
  for (const definition of scene.observableDefinitions) {
    const key = thermalObservableKeyOf(definition)
    if (key !== undefined) visible[key] = definition.visible
  }
  return visible
}

/** Student-facing one-liner for the current segment of the heating curve. */
export const thermalPhaseText = (
  phase: ThermalState['phase'],
  crystalline: boolean,
): string => {
  switch (phase) {
    case 'solid':
      return '固态升温中'
    case 'melting':
      return '正在熔化（吸热但温度不变）'
    case 'liquid':
      return crystalline ? '已全部熔化，液态升温中' : '软化后继续升温（非晶体无熔点）'
  }
}

export interface ThermalVisualInput {
  readonly scene: PhysicsScene
  readonly model: ResolvedThermalModel
  readonly state: ThermalState
  /** Scene time in seconds the frame is showing. */
  readonly time: number
  /** Highest temperature the run reaches (K), so the column scale is stable. */
  readonly peakTemperature: number
}

/** Build one heating frame from the verified thermal state. */
export const thermalSceneVisual = ({
  scene,
  model,
  state,
  time,
  peakTemperature,
}: ThermalVisualInput): SceneVisualModel => {
  const bench = thermalBenchOf(scene)
  if (bench === undefined) return emptyVisualModel('thermal')

  /* Scene units are arbitrary bench centimetres: the apparatus has no physical
     size in the model, so the frame is a fixed, legible layout and only the
     thermometer column carries a measured quantity. */
  const beakerHalfWidth = 7
  const beakerHalfHeight = 5
  const beakerCentre = { x: -6, y: 6 }

  const thermalSample: ThermalSampleVisual = {
    id: model.sampleId,
    at: beakerCentre,
    halfWidth: beakerHalfWidth,
    halfHeight: beakerHalfHeight,
    meltedFraction: state.meltedFraction,
    phase: state.phase,
    label: bench.sample.name ?? '样品',
  }

  /* The column spans the run's own temperature range, so the mercury climbs,
     stops dead through the plateau and climbs again — the graph in miniature.
     Floor is the starting temperature, ceiling the peak the run reaches. */
  const floor = model.initialTemperature
  const span = Math.max(peakTemperature - floor, 1)
  const columnMax = 14
  const columnHeight = ((state.temperature - floor) / span) * columnMax

  const thermalThermometer: ThermalThermometerVisual = {
    id: 'thermometer',
    at: { x: 9, y: 1 },
    columnHeight,
    reading: `${celsiusOf(state.temperature).toFixed(1)} ℃`,
    label: '温度计',
  }

  const thermalHeater: ThermalHeaterVisual = {
    id: model.benchId,
    at: { x: beakerCentre.x, y: 0 },
    halfWidth: beakerHalfWidth * 0.7,
    power: `${fmtThermalValue(model.heaterPower, 3)} W`,
    label: '加热器',
  }

  /* The melting point drawn across the bench: the level the column parks on. */
  const meltingLevel = ((model.meltingPoint - floor) / span) * columnMax + 1
  const guides: GuideVisual[] = model.crystalline
    ? [
      {
        id: 'melting-point-line',
        observable: 'phase',
        from: { x: beakerCentre.x - beakerHalfWidth, y: meltingLevel },
        to: { x: 13, y: meltingLevel },
        label: `熔点 ${fmtThermalValue(celsiusOf(model.meltingPoint), 3)} ℃`,
      },
    ]
    : []

  const readout: string[] = [
    '加热读数',
    `t = ${time.toFixed(0)} s · ${thermalPhaseText(state.phase, model.crystalline)}`,
    `T = ${celsiusOf(state.temperature).toFixed(1)} ℃ · 已吸热 ${fmtThermalValue(state.heatAbsorbed, 4)} J`,
    `P = ${fmtThermalValue(model.heaterPower, 3)} W · m = ${fmtThermalValue(model.mass * 1000, 4)} g`,
  ]

  return emptyVisualModel('thermal', {
    extent: { width: 30, height: 22 },
    origin: { x: -16, y: -2 },
    grid: { minor: 1, major: 5 },
    axes: { x: '', y: '' },
    tickStep: 5,
    guides,
    thermalSample,
    thermalThermometer,
    thermalHeater,
    overlay: {
      readout,
      scale: { label: '5', length: 5 },
    },
    visible: visibilityOf(scene),
  })
}
