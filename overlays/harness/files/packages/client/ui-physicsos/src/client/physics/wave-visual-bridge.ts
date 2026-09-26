/**
 * Wave → SceneVisualModel bridge.
 *
 * Projects a verified wave frame (the engine's resolved model + the state at the
 * current time) onto the shared visual contract. Every drawn fact — the rope
 * profile, where the marked particle sits, the node positions, the interference
 * verdict — comes from the Wave Engine's objects and derived set; this module only
 * converts SI metres into the bench's display unit (centimetres), applies one
 * declared vertical gain, frames the extent and formats strings. It never
 * evaluates y(x, t).
 *
 * Scene units on the canvas are CENTIMETRES. Textbook wave diagrams exaggerate
 * the amplitude (a 5 cm wave on a 1.2 m rope would be a hairline at 1:1), so the
 * bridge multiplies every displacement by a single gain, prints that gain in the
 * axis label and the readout, and keeps every NUMBER a student reads in real
 * units — the ink is stretched, the values are not.
 */

import type { ResolvedWaveModel } from '@physicsos/engine-wave'
import { derivedScalar, type SimulationResult, type SimulationState } from '@physicsos/physics-core'
import { waveBenchOf, type ObservableDefinition, type PhysicsScene } from '@physicsos/physics-scene'

import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  DimensionVisual,
  ObservableKey,
  ObservableVisibility,
  ScenePoint,
  SceneVisualModel,
  VectorVisual,
  WaveFrontVisual,
  WaveNodeVisual,
} from './scene-visual-model.ts'

/** Engine lengths are SI metres; the bench displays centimetres. */
const CM_PER_METRE = 100

/** Displayed amplitude as a fraction of the rig's horizontal extent. */
const AMPLITUDE_FRACTION = 0.12

/** Gains a student can read at a glance; the bridge picks the closest fit. */
const GAIN_STEPS = [1, 2, 3, 4, 5, 8, 10, 15, 20, 30, 50, 100] as const

/**
 * The wave scene visuals helper `fmtWaveValue`.
 * @returns the formatted string.
 * @param digits - the digits.
 * @param value - the new value.
 */
export const fmtWaveValue = (value: number, digits = 3): string => {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) < 1e-12) return '0'
  return String(Number.parseFloat(value.toPrecision(digits)))
}

/**
 * Scene observable definition → canvas toggle key. The wave factory stamps
 * `observable-wave-waveform / -wave_speed / -superposition / -nodes`, keyed by
 * the id suffix.
 * @returns the observable key.
 * @param definition - the observable definition.
 */
export const waveObservableKeyOf = (
  definition: ObservableDefinition,
): ObservableKey | undefined => {
  const id = String(definition.id)
  if (id.endsWith('-waveform')) return 'waveform'
  if (id.endsWith('-wave_speed')) return 'waveSpeed'
  if (id.endsWith('-superposition')) return 'superposition'
  if (id.endsWith('-nodes')) return 'nodes'
  return undefined
}

const visibilityOf = (scene: PhysicsScene): ObservableVisibility => {
  const visible: Partial<Record<ObservableKey, boolean>> = {}
  for (const definition of scene.observableDefinitions) {
    const key = waveObservableKeyOf(definition)
    if (key !== undefined) visible[key] = definition.visible
  }
  return visible
}

/**
 * The vertical exaggeration for a rig: the smallest listed gain that lifts the
 * amplitude to about a tenth of the horizontal extent. Declared once so the
 * axis label, the readout and every drawn displacement agree.
 * @returns the computed number.
 * @param model - the model.
 */
export const verticalGainOf = (model: ResolvedWaveModel): number => {
  const widthCm = horizontalExtentMetres(model) * CM_PER_METRE
  const amplitudeCm = model.amplitude * CM_PER_METRE
  const target = widthCm * AMPLITUDE_FRACTION
  let best: number = GAIN_STEPS[0]
  for (const gain of GAIN_STEPS) {
    if (Math.abs(amplitudeCm * gain - target) < Math.abs(amplitudeCm * best - target)) best = gain
  }
  return best
}

const horizontalExtentMetres = (model: ResolvedWaveModel): number => {
  if (model.subModel === 'travelling_wave') return model.ropeLength ?? model.wavelength * 3
  if (model.subModel === 'standing_wave') return model.stringLength ?? 1
  if (model.subModel === 'longitudinal_wave') return model.mediumLength ?? model.wavelength * 3
  if (model.subModel === 'wave_diffraction') return model.screenDistance ?? 2
  if (model.subModel === 'wave_doppler') return 4
  if (model.subModel === 'reflection_refraction') return 2
  return Math.max(model.sourceSeparation ?? 1, (model.pathOne ?? 0) + (model.pathTwo ?? 0)) || 1
}

/**
 * Student-facing verdict for the interference readout.
 * @returns the formatted string.
 * @param verdict - the review verdict.
 */
export const interferenceVerdictText = (
  verdict: 'constructive' | 'destructive' | 'partial',
): string =>
  verdict === 'constructive' ? '振动加强' : verdict === 'destructive' ? '振动减弱' : '部分叠加'

const verdictOf = (sign: number): 'constructive' | 'destructive' | 'partial' =>
  sign > 0 ? 'constructive' : sign < 0 ? 'destructive' : 'partial'

const cmOf = (metres: number): number => metres * CM_PER_METRE

const positionOf = (state: SimulationState, id: string): { x: number; y: number } | undefined => {
  const vector = state.objects.find(object => object.id === id)?.position?.vector
  return vector === undefined ? undefined : { x: vector.x, y: vector.y }
}

const scalarValueOf = (state: SimulationState, id: string, key: string): number | undefined => {
  const value = state.objects.find(object => object.id === id)?.values?.[key]
  if (value === undefined || 'vector' in value) return undefined
  return value.value
}

/**
 * The engine's `<bench>.<kind>.<i>` objects in index order, in cm with the gain
 * applied — profile samples, nodes and antinodes all follow this id scheme.
 */
const indexedPointsOf = (
  state: SimulationState,
  benchId: string,
  kind: 'profile' | 'node' | 'antinode',
  gain: number,
): ScenePoint[] => {
  const prefix = `${benchId}.${kind}.`
  const indexed: { index: number; point: ScenePoint }[] = []
  for (const object of state.objects) {
    if (!object.id.startsWith(prefix) || object.position === undefined) continue
    const index = Number(object.id.slice(prefix.length))
    if (!Number.isFinite(index)) continue
    indexed.push({
      index,
      point: { x: cmOf(object.position.vector.x), y: cmOf(object.position.vector.y) * gain },
    })
  }
  return indexed.sort((left, right) => left.index - right.index).map(entry => entry.point)
}

const profilePointsOf = (state: SimulationState, benchId: string, gain: number): ScenePoint[] =>
  indexedPointsOf(state, benchId, 'profile', gain)

/** Longitudinal displacement graph: ξ is published as a value, not a y position. */
const longitudinalPointsOf = (
  state: SimulationState,
  benchId: string,
  gain: number,
  mediumLength: number,
): ScenePoint[] => {
  const prefix = `${benchId}.profile.`
  const entries: { index: number; displacement: number }[] = []
  for (const object of state.objects) {
    if (!object.id.startsWith(prefix)) continue
    const index = Number(object.id.slice(prefix.length))
    const displacement = object.values?.['displacement']
    if (!Number.isFinite(index) || displacement === undefined || 'vector' in displacement) continue
    entries.push({ index, displacement: displacement.value })
  }
  entries.sort((left, right) => left.index - right.index)
  const lastIndex = entries.at(-1)?.index ?? 0
  return entries.map(entry => ({
    x: (cmOf(mediumLength) * entry.index) / Math.max(1, lastIndex),
    y: cmOf(entry.displacement) * gain,
  }))
}

/**
 * The wave visual input shape used by the wave scene visuals module.
 */
export interface WaveVisualInput {
  readonly scene: PhysicsScene
  readonly model: ResolvedWaveModel
  readonly simulation: SimulationResult
  /** Engine state at the frame being drawn. */
  readonly state: SimulationState
  /** Engine state at t = 0, for the standing-wave envelope. */
  readonly envelopeState?: SimulationState
  readonly time: number
}

/**
 * Build one wave frame from the resolved model and the engine state.
 *
 * Travelling: the sampled rope, the marked particle with its transverse velocity
 * arrow, a λ dimension and an A dimension. Interference: the two sources with
 * their spreading crests, the r₁ / r₂ / d dimensions and the observation point
 * carrying the engine's verdict. Standing: the string, its envelope, nodes and
 * antinodes, an L dimension and a λ/2 dimension between adjacent nodes.
 * @returns the scene visual model.
 * @param input - the visual input for this frame.
 */
export const waveSceneVisual = (input: WaveVisualInput): SceneVisualModel => {
  const {
    scene,
    model,
    simulation,
    state,
    envelopeState,
    time,
  } = input

  const bench = waveBenchOf(scene)
  if (bench === undefined) return emptyVisualModel('wave')

  const speed = derivedScalar(simulation.derivedQuantities, 'wave_speed').value
  const period = derivedScalar(simulation.derivedQuantities, 'period').value
  const amplitudeCm = cmOf(model.amplitude)
  const gain = verticalGainOf(model)
  const visible = visibilityOf(scene)
  /* 波速读数 observable gates every `v = …` fragment; absent definition
     means visible (the scene declares it true by default). */
  const showSpeed = visible.waveSpeed !== false
  const timeText = `t = ${time.toFixed(2)} s`

  if (model.subModel === 'travelling_wave') {
    const ropeCm = cmOf(model.ropeLength ?? model.wavelength * 3)
    const displayedAmplitude = amplitudeCm * gain
    const points = profilePointsOf(state, model.benchId, gain)
    const marker = positionOf(state, `${model.benchId}.marker`)
    const markerVelocity = state.objects.find(object => object.id === `${model.benchId}.marker`)
      ?.velocity?.vector

    const vectors: VectorVisual[] = []
    if (marker !== undefined && markerVelocity !== undefined) {
      /* Arrow length: the peak transverse speed 2πfA maps to 0.8 of the drawn
         amplitude, so the arrow shrinks to nothing at the turning points. */
      const peakSpeed = 2 * Math.PI * model.frequency * model.amplitude
      const arrowScale = peakSpeed === 0 ? 0 : (0.8 * displayedAmplitude) / peakSpeed
      const at = { x: cmOf(marker.x), y: cmOf(marker.y) * gain }
      if (Math.abs(markerVelocity.y) * arrowScale > 0.5) {
        vectors.push({
          id: 'wave-marker-velocity',
          role: 'velocity',
          observable: 'waveform',
          from: at,
          to: { x: at.x, y: at.y + markerVelocity.y * arrowScale },
          symbol: 'v_y',
        })
      }
    }

    const dimensions: DimensionVisual[] = [
      {
        id: 'wave-wavelength',
        from: { x: 0, y: -displayedAmplitude * 1.35 },
        to: { x: cmOf(model.wavelength), y: -displayedAmplitude * 1.35 },
        label: `λ = ${fmtWaveValue(model.wavelength)} m`,
        side: 'right',
      },
      {
        id: 'wave-amplitude',
        from: { x: ropeCm + displayedAmplitude * 0.25, y: 0 },
        to: { x: ropeCm + displayedAmplitude * 0.25, y: displayedAmplitude },
        label: `A = ${fmtWaveValue(amplitudeCm)} cm`,
        side: 'right',
      },
    ]

    /* The λ ruler runs from the rope's left end out to λ (in cm). λ = v/f is
       editable, so at a low enough frequency the ruler reaches past the rope
       and used to be clipped by a frame sized on ropeCm alone. Frame the wider
       of the two; the default rig (λ = 0.4 m on a 1.2 m rope) is unchanged. */
    const wavelengthCm = cmOf(model.wavelength)
    const framedWidthCm = Math.max(ropeCm, wavelengthCm + displayedAmplitude * 0.6)

    return emptyVisualModel('wave', {
      extent: { width: framedWidthCm * 1.18, height: displayedAmplitude * 3.6 },
      origin: { x: -framedWidthCm * 0.06, y: -displayedAmplitude * 1.8 },
      grid: { minor: ropeCm / 24, major: ropeCm / 6 },
      axes: { x: 'x / cm', y: `y / cm（×${gain}）` },
      tickStep: ropeCm / 6,
      waveProfile: {
        id: model.benchId,
        kind: 'rope',
        points,
        equilibrium: { from: { x: 0, y: 0 }, to: { x: ropeCm, y: 0 } },
      },
      ...(marker === undefined
        ? {}
        : {
          waveMarker: {
            id: `${model.benchId}.marker`,
            at: { x: cmOf(marker.x), y: cmOf(marker.y) * gain },
            label: `质点 y = ${fmtWaveValue(cmOf(marker.y))} cm`,
          },
        }),
      vectors,
      dimensions,
      overlay: {
        readout: [
          '绳上的简谐横波',
          `A = ${fmtWaveValue(amplitudeCm)} cm · λ = ${fmtWaveValue(model.wavelength)} m · f = ${fmtWaveValue(model.frequency)} Hz`,
          ...(showSpeed
            ? [`v = λf = ${fmtWaveValue(speed)} m/s · T = 1/f = ${fmtWaveValue(period)} s`]
            : []),
          `${timeText} · 纵向放大 ×${gain}（读数为真实值）`,
        ],
        scale: { label: '10 cm', length: 10 },
      },
      visible,
    })
  }

  if (model.subModel === 'longitudinal_wave') {
    const mediumCm = cmOf(model.mediumLength ?? model.wavelength * 3)
    const displayedAmplitude = amplitudeCm * gain
    const points = longitudinalPointsOf(
      state,
      model.benchId,
      gain,
      model.mediumLength ?? model.wavelength * 3,
    )
    const marker = state.objects.find(entry => entry.id === `${model.benchId}.marker`)
    const displacement = marker?.values?.['displacement']
    return emptyVisualModel('wave', {
      extent: { width: mediumCm * 1.12, height: displayedAmplitude * 3.2 },
      origin: { x: -mediumCm * 0.06, y: -displayedAmplitude * 1.6 },
      grid: { minor: mediumCm / 20, major: mediumCm / 5 },
      axes: { x: 'x / cm', y: `ξ / cm（×${gain}）` },
      tickStep: mediumCm / 5,
      waveProfile: {
        id: model.benchId,
        kind: 'rope',
        points,
        equilibrium: { from: { x: 0, y: 0 }, to: { x: mediumCm, y: 0 } },
      },
      overlay: {
        readout: [
          '纵波：质点振动方向与传播方向平行',
          `A = ${fmtWaveValue(amplitudeCm)} cm · λ = ${fmtWaveValue(model.wavelength)} m · f = ${fmtWaveValue(model.frequency)} Hz`,
          ...(showSpeed ? [`v = λf = ${fmtWaveValue(speed)} m/s`] : []),
          ...(displacement !== undefined && !('vector' in displacement)
            ? [`中点位移 ξ = ${fmtWaveValue(cmOf(displacement.value))} cm · 压缩区应变 ∂ξ/∂x < 0`]
            : []),
          `${timeText} · 纵向放大 ×${gain}`,
        ],
        scale: { label: '10 cm', length: 10 },
      },
      visible,
    })
  }

  if (model.subModel === 'reflection_refraction') {
    const incident = positionOf(state, `${model.benchId}.incident`)
    const reflected = positionOf(state, `${model.benchId}.reflected`)
    const refracted = positionOf(state, `${model.benchId}.refracted`)
    const boundary = positionOf(state, `${model.benchId}.boundary`) ?? { x: 0, y: 0 }
    const rayLength = 140
    const line = (point: { x: number; y: number }, scaleSign = -1): ScenePoint[] => [
      {
        x: boundary.x * 100 + scaleSign * point.x * rayLength,
        y: boundary.y * 100 + scaleSign * point.y * rayLength,
      },
      { x: boundary.x * 100, y: boundary.y * 100 },
    ]
    const trajectories = [
      {
        id: 'wave-incident-ray',
        kind: 'history' as const,
        points: line(incident ?? { x: -1, y: 1 }),
      },
      {
        id: 'wave-reflected-ray',
        kind: 'predicted' as const,
        points: line(reflected ?? { x: -1, y: -1 }, 1).reverse(),
      },
      ...(refracted === undefined
        ? []
        : [
          {
            id: 'wave-refracted-ray',
            kind: 'predicted' as const,
            points: line(refracted, 1).reverse(),
          },
        ]),
    ]
    const reading =
      model.refractedAngleRad === undefined
        ? `θ₁ = ${fmtWaveValue(((model.incidentAngleRad ?? 0) * 180) / Math.PI)}° · 全反射`
        : `θ₁ = ${fmtWaveValue(((model.incidentAngleRad ?? 0) * 180) / Math.PI)}° · θt = ${fmtWaveValue((model.refractedAngleRad * 180) / Math.PI)}°`
    return emptyVisualModel('wave', {
      extent: { width: 420, height: 300 },
      origin: { x: -160, y: -150 },
      grid: { minor: 20, major: 100 },
      axes: { x: 'x / cm', y: 'y / cm' },
      tickStep: 100,
      trajectories,
      labels: [
        { id: 'wave-boundary-label', at: { x: 0, y: 0 }, text: '界面 · 频率不变', anchor: 'start' },
      ],
      overlay: {
        readout: [
          '波的反射与折射',
          `v₁ = ${fmtWaveValue(model.incidentSpeed ?? 0)} m/s · v₂ = ${fmtWaveValue(model.transmittedWaveSpeed ?? 0)} m/s`,
          reading,
        ],
        scale: { label: '50 cm', length: 50 },
      },
      visible,
    })
  }

  if (model.subModel === 'wave_diffraction') {
    const slit = positionOf(state, `${model.benchId}.slit`) ?? { x: 0, y: 0 }
    const minimum = positionOf(state, `${model.benchId}.minimum.${model.diffractionOrder ?? 1}`)
    const screenDistanceCm = cmOf(model.screenDistance ?? 0)
    const centralWidthCm = cmOf(model.centralMaximumWidth ?? 0)
    const points: ScenePoint[] = [
      { x: cmOf(slit.x), y: cmOf(slit.y) },
      ...(minimum === undefined ? [] : [{ x: cmOf(minimum.x), y: cmOf(minimum.y) }]),
    ]
    return emptyVisualModel('wave', {
      extent: {
        width: Math.max(screenDistanceCm * 1.3, 120),
        height: Math.max(centralWidthCm * 2.5, 100),
      },
      origin: { x: -screenDistanceCm * 0.1, y: -Math.max(centralWidthCm * 1.25, 50) },
      grid: { minor: 20, major: 100 },
      axes: { x: 'x / cm', y: 'y / cm' },
      tickStep: 100,
      trajectories:
        points.length < 2 ? [] : [{ id: 'wave-first-minimum', kind: 'predicted', points }],
      labels: [
        { id: 'wave-slit-label', at: { x: 0, y: 0 }, text: '单缝', anchor: 'end' },
        { id: 'wave-screen-label', at: { x: screenDistanceCm, y: 0 }, text: '屏', anchor: 'start' },
      ],
      dimensions: [
        {
          id: 'wave-central-width',
          from: { x: screenDistanceCm, y: -centralWidthCm / 2 },
          to: { x: screenDistanceCm, y: centralWidthCm / 2 },
          label: `w₀ = ${fmtWaveValue(model.centralMaximumWidth ?? 0)} m`,
          side: 'right',
        },
      ],
      overlay: {
        readout: [
          '单缝衍射',
          `a = ${fmtWaveValue(model.slitWidth ?? 0)} m · λ = ${fmtWaveValue(model.wavelength)} m · L = ${fmtWaveValue(model.screenDistance ?? 0)} m`,
          `中央明纹宽度 w₀ = 2Lλ/a = ${fmtWaveValue(model.centralMaximumWidth ?? 0)} m`,
        ],
        scale: { label: '50 cm', length: 50 },
      },
      visible,
    })
  }

  if (model.subModel === 'wave_doppler') {
    const source = positionOf(state, `${model.benchId}.source`) ?? { x: -1, y: 0 }
    const observer = positionOf(state, `${model.benchId}.observer`) ?? { x: 1, y: 0 }
    const observed = derivedScalar(simulation.derivedQuantities, 'observed_frequency').value
    const shift = derivedScalar(simulation.derivedQuantities, 'frequency_shift').value
    const s = { x: cmOf(source.x), y: 0 }
    const o = { x: cmOf(observer.x), y: 0 }
    return emptyVisualModel('wave', {
      extent: { width: 360, height: 120 },
      origin: { x: -180, y: -60 },
      grid: { minor: 20, major: 100 },
      axes: { x: 'x / cm', y: 'y / cm' },
      tickStep: 100,
      waveSources: [
        { id: `${model.benchId}.source`, at: s, label: '运动波源 S' },
        { id: `${model.benchId}.observer`, at: o, label: '观察者 O' },
      ],
      trajectories: [{ id: 'wave-doppler-axis', kind: 'predicted', points: [s, o] }],
      overlay: {
        readout: [
          '多普勒效应',
          `f = ${fmtWaveValue(model.frequency)} Hz · v = ${fmtWaveValue(model.waveSpeed)} m/s`,
          `vs = ${fmtWaveValue(model.sourceSpeed ?? 0)} m/s（${model.sourceDirection === 'approaching' ? '接近' : '远离'}）`,
          `观察频率 f′ = ${fmtWaveValue(observed)} Hz · Δf = ${fmtWaveValue(shift)} Hz`,
        ],
        scale: { label: '50 cm', length: 50 },
      },
      visible,
    })
  }

  if (model.subModel === 'wave_interference') {
    const separationCm = cmOf(model.sourceSeparation ?? 0)
    const sourceOne = positionOf(state, `${model.benchId}.source-1`)
    const sourceTwo = positionOf(state, `${model.benchId}.source-2`)
    const point = positionOf(state, `${model.benchId}.point`)
    if (sourceOne === undefined || sourceTwo === undefined || point === undefined) {
      return emptyVisualModel('wave')
    }
    const s1 = { x: cmOf(sourceOne.x), y: cmOf(sourceOne.y) }
    const s2 = { x: cmOf(sourceTwo.x), y: cmOf(sourceTwo.y) }
    const p = { x: cmOf(point.x), y: cmOf(point.y) }

    const pathDifference = derivedScalar(simulation.derivedQuantities, 'path_difference').value
    const ratio = derivedScalar(simulation.derivedQuantities, 'path_difference_ratio').value
    const resultant = derivedScalar(simulation.derivedQuantities, 'resultant_amplitude').value
    const verdict = verdictOf(
      derivedScalar(simulation.derivedQuantities, 'interference_type').value,
    )
    const displacement = scalarValueOf(state, `${model.benchId}.point`, 'displacement') ?? 0

    /* Crest circles must respect causality and the engine's own phase.
       The engine drives each source as A·sin(2πft) with phase(r,t) =
       2π(ft − r/λ), so a crest (sin = 1) left the source a quarter period
       ago: r = v·t − λ/4 − kλ, and nothing can be further out than v·t.
       The old code drew full-radius rings from λ upward at t = 0 and put
       the rings on the engine's zero-displacement circles (λ/4 early). */
    const frontReach = Math.min(
      Math.max(model.pathOne ?? 0, model.pathTwo ?? 0) + model.wavelength,
      speed * time,
    )
    const crestRadius0 =
      (((speed * time - model.wavelength / 4) % model.wavelength) + model.wavelength) %
      model.wavelength
    const fronts: WaveFrontVisual[] = []
    for (const [index, source] of [s1, s2].entries()) {
      for (let radius = crestRadius0; radius <= frontReach; radius += model.wavelength) {
        if (radius <= 1e-9) continue
        fronts.push({
          id: `wave-front-${index + 1}-${Math.round(radius / model.wavelength)}`,
          center: source,
          radius: cmOf(radius),
        })
      }
    }

    const dimensions: DimensionVisual[] = [
      {
        id: 'wave-path-one',
        from: s1,
        to: p,
        label: `r_1 = ${fmtWaveValue(model.pathOne ?? 0)} m`,
        side: 'left',
      },
      {
        id: 'wave-path-two',
        from: s2,
        to: p,
        label: `r_2 = ${fmtWaveValue(model.pathTwo ?? 0)} m`,
        side: 'right',
      },
      {
        id: 'wave-source-separation',
        from: { x: s1.x, y: -separationCm * 0.16 },
        to: { x: s2.x, y: -separationCm * 0.16 },
        label: `d = ${fmtWaveValue(model.sourceSeparation ?? 0)} m`,
        side: 'right',
      },
    ]

    const left = Math.min(s1.x, p.x) - separationCm * 0.3
    const right = Math.max(s2.x, p.x) + separationCm * 0.3
    const top = Math.max(p.y, separationCm * 0.5) + separationCm * 0.3
    const bottom = -separationCm * 0.4
    return emptyVisualModel('wave', {
      extent: { width: right - left, height: top - bottom },
      origin: { x: left, y: bottom },
      grid: { minor: 10, major: 50 },
      axes: { x: 'x / cm', y: 'y / cm' },
      tickStep: 50,
      waveSources: [
        { id: `${model.benchId}.source-1`, at: s1, label: 'S₁' },
        { id: `${model.benchId}.source-2`, at: s2, label: 'S₂' },
      ],
      wavePoint: {
        id: `${model.benchId}.point`,
        at: p,
        verdict,
        readout: `P · Δ = ${fmtWaveValue(pathDifference)} m = ${fmtWaveValue(ratio)} λ · ${interferenceVerdictText(verdict)}`,
      },
      waveFronts: fronts,
      dimensions,
      overlay: {
        readout: [
          '双源干涉与波的叠加',
          `A = ${fmtWaveValue(amplitudeCm)} cm · λ = ${fmtWaveValue(model.wavelength)} m · f = ${fmtWaveValue(model.frequency)} Hz${showSpeed ? ` · v = ${fmtWaveValue(speed)} m/s` : ''}`,
          `Δ = |r₂ − r₁| = ${fmtWaveValue(pathDifference)} m = ${fmtWaveValue(ratio)} λ → ${interferenceVerdictText(verdict)}`,
          `A_P = |2A·cos(πΔ/λ)| = ${fmtWaveValue(cmOf(resultant))} cm · y_P(${timeText.slice(4)}) = ${fmtWaveValue(cmOf(displacement))} cm`,
        ],
        scale: { label: '20 cm', length: 20 },
      },
      visible,
    })
  }

  /* standing_wave */
  const stringCm = cmOf(model.stringLength ?? 1)
  const displayedAmplitude = amplitudeCm * gain
  const points = profilePointsOf(state, model.benchId, gain)
  const nodes = indexedPointsOf(state, model.benchId, 'node', gain)
  const antinodes = indexedPointsOf(state, model.benchId, 'antinode', gain)
  const waveNodes: WaveNodeVisual[] = [
    /* The clamped ends are nodes too, but labelling them would crowd the
       dimension ticks; the interior nodes carry the word. */
    ...nodes.map((node, index) => ({
      id: `${model.benchId}.node.${index}`,
      kind: 'node' as const,
      at: node,
      ...(index === 0 || index === nodes.length - 1 ? {} : { label: '波节' }),
    })),
    ...antinodes.map((antinode, index) => ({
      id: `${model.benchId}.antinode.${index}`,
      kind: 'antinode' as const,
      at: antinode,
      label: '波腹',
    })),
  ]
  /* The envelope is |y(x, 0)| and its mirror: at t = 0 the string sits on its
     extreme, so the engine's own first frame IS the envelope. */
  const envelopePoints =
    envelopeState === undefined ? [] : profilePointsOf(envelopeState, model.benchId, gain)
  const upper = envelopePoints.map(pt => ({ x: pt.x, y: Math.abs(pt.y) }))
  const lower = envelopePoints.map(pt => ({ x: pt.x, y: -Math.abs(pt.y) }))
  const harmonic = model.harmonic ?? 1
  const fundamental = derivedScalar(simulation.derivedQuantities, 'fundamental_frequency').value

  const dimensions: DimensionVisual[] = [
    {
      id: 'wave-string-length',
      from: { x: 0, y: -displayedAmplitude * 1.45 },
      to: { x: stringCm, y: -displayedAmplitude * 1.45 },
      label: `L = ${fmtWaveValue(model.stringLength ?? 0)} m`,
      side: 'right',
    },
  ]
  const firstNode = nodes[0]
  const secondNode = nodes[1]
  if (firstNode !== undefined && secondNode !== undefined) {
    dimensions.push({
      id: 'wave-half-wavelength',
      from: { x: firstNode.x, y: displayedAmplitude * 1.3 },
      to: { x: secondNode.x, y: displayedAmplitude * 1.3 },
      label: `λ/2 = ${fmtWaveValue(model.wavelength / 2)} m`,
      side: 'left',
    })
  }

  return emptyVisualModel('wave', {
    extent: { width: stringCm * 1.18, height: displayedAmplitude * 3.8 },
    origin: { x: -stringCm * 0.09, y: -displayedAmplitude * 1.9 },
    grid: { minor: stringCm / 20, major: stringCm / 5 },
    axes: { x: 'x / cm', y: `y / cm（×${gain}）` },
    tickStep: stringCm / 5,
    waveProfile: {
      id: model.benchId,
      kind: 'string',
      points,
      equilibrium: { from: { x: 0, y: 0 }, to: { x: stringCm, y: 0 } },
    },
    waveNodes,
    ...(upper.length === 0 ? {} : { waveEnvelope: { id: 'wave-envelope', upper, lower } }),
    dimensions,
    overlay: {
      readout: [
        '两端固定的弦驻波',
        `L = ${fmtWaveValue(model.stringLength ?? 0)} m · n = ${harmonic}${showSpeed ? ` · v = ${fmtWaveValue(speed)} m/s` : ''}`,
        `λ = 2L/n = ${fmtWaveValue(model.wavelength)} m · f_n = n·v/2L = ${fmtWaveValue(model.frequency)} Hz（f₁ = ${fmtWaveValue(fundamental)} Hz）`,
        `波节 ${nodes.length} 个 · 波腹 ${antinodes.length} 个 · ${timeText} · 纵向放大 ×${gain}`,
      ],
      scale: { label: '10 cm', length: 10 },
    },
    visible,
  })
}
