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
  type ThermalSample,
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
  /** State of the comparison sample, when the bench has two. */
  readonly comparisonState?: ThermalState
  /** Scene time in seconds the frame is showing. */
  readonly time: number
  /** Lowest temperature on the shared column scale (K). */
  readonly floorTemperature: number
  /** Highest temperature the run reaches (K), so the column scale is stable. */
  readonly peakTemperature: number
}

const beakerVisual = (
  sample: ThermalSample,
  at: { x: number; y: number },
  halfWidth: number,
  halfHeight: number,
  state: ThermalState,
): ThermalSampleVisual => ({
  id: sample.id,
  at,
  halfWidth,
  halfHeight,
  meltedFraction: state.meltedFraction,
  phase: state.phase,
  label: sample.name ?? '样品',
})

const thermometerVisual = (
  id: string,
  at: { x: number; y: number },
  columnHeight: number,
  temperature: number,
): ThermalThermometerVisual => ({
  id,
  at,
  columnHeight,
  reading: `${celsiusOf(temperature).toFixed(1)} ℃`,
  label: '温度计',
})

const heaterVisual = (
  id: string,
  at: { x: number; y: number },
  halfWidth: number,
  power: string,
): ThermalHeaterVisual => ({
  id,
  at,
  halfWidth,
  power,
  label: '加热器',
})

/** Build one heating frame from the verified thermal state. */
export const thermalSceneVisual = ({
  scene,
  model,
  state,
  comparisonState,
  time,
  floorTemperature,
  peakTemperature,
}: ThermalVisualInput): SceneVisualModel => {
  const bench = thermalBenchOf(scene)
  if (bench === undefined) return emptyVisualModel('thermal')

  /* Scene units are arbitrary bench centimetres: the apparatus has no physical
     size in the model, so the frame is a fixed, legible layout and only the
     thermometer column carries a measured quantity. */
  const beakerHalfWidth = 7
  const beakerHalfHeight = 5
  const span = Math.max(peakTemperature - floorTemperature, 1)
  const columnMax = 14
  const columnOf = (temperature: number) =>
    ((temperature - floorTemperature) / span) * columnMax
  const power = `${fmtThermalValue(model.heaterPower, 3)} W`

  if (bench.comparisonSample !== undefined && comparisonState !== undefined) {
    const left = { x: -12, y: 6 }
    const right = { x: 8, y: 6 }
    const readout: string[] = [
      '对比读数',
      `t = ${time.toFixed(0)} s · 同时加热`,
      `${bench.sample.name ?? '水'} T = ${celsiusOf(state.temperature).toFixed(1)} ℃ · ${bench.comparisonSample.name ?? '煤油'} T = ${celsiusOf(comparisonState.temperature).toFixed(1)} ℃`,
      `Q = ${fmtThermalValue(state.heatAbsorbed, 4)} J（两边相同） · m = ${fmtThermalValue(model.mass * 1000, 4)} g`,
    ]
    return emptyVisualModel('thermal', {
      extent: { width: 44, height: 22 },
      origin: { x: -24, y: -2 },
      grid: { minor: 1, major: 5 },
      axes: { x: '', y: '' },
      tickStep: 5,
      thermalSample: beakerVisual(bench.sample, left, beakerHalfWidth, beakerHalfHeight, state),
      thermalThermometer: thermometerVisual(
        'thermometer',
        { x: left.x + 10, y: 1 },
        columnOf(state.temperature),
        state.temperature,
      ),
      thermalHeater: heaterVisual(model.benchId, { x: left.x, y: 0 }, beakerHalfWidth * 0.7, power),
      thermalComparisonSample: beakerVisual(
        bench.comparisonSample,
        right,
        beakerHalfWidth,
        beakerHalfHeight,
        comparisonState,
      ),
      thermalComparisonThermometer: thermometerVisual(
        'thermometer-2',
        { x: right.x + 10, y: 1 },
        columnOf(comparisonState.temperature),
        comparisonState.temperature,
      ),
      thermalComparisonHeater: heaterVisual(
        `${model.benchId}-comparison`,
        { x: right.x, y: 0 },
        beakerHalfWidth * 0.7,
        power,
      ),
      overlay: {
        readout,
        scale: { label: '5', length: 5 },
      },
      visible: visibilityOf(scene),
    })
  }

  const beakerCentre = { x: -6, y: 6 }

  const thermalSample: ThermalSampleVisual = beakerVisual(
    bench.sample,
    beakerCentre,
    beakerHalfWidth,
    beakerHalfHeight,
    state,
  )

  const thermalThermometer: ThermalThermometerVisual = thermometerVisual(
    'thermometer',
    { x: 9, y: 1 },
    columnOf(state.temperature),
    state.temperature,
  )

  const thermalHeater: ThermalHeaterVisual = heaterVisual(
    model.benchId,
    { x: beakerCentre.x, y: 0 },
    beakerHalfWidth * 0.7,
    power,
  )

  /* The melting point drawn across the bench: the level the column parks on. */
  const meltingLevel = columnOf(model.meltingPoint) + 1
  const guides: GuideVisual[] = model.crystalline && !model.startsMolten
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
