/**
 * Acoustics → SceneVisualModel bridge.
 *
 * Projects a verified echo-ranging frame onto the shared visual contract. Every
 * drawn fact — the pulse position, which leg of the round trip it is on, the
 * wall distance — comes from the Acoustics Engine's resolved model and pulse
 * state; this module only frames the extent, offsets the two legs for the
 * textbook out/return picture and formats strings. It never propagates sound
 * itself.
 *
 * Scene units on the canvas are METRES: the junior echo range is authored and
 * taught in metres (340 m in 15 °C air ⇔ a 2 s round trip), so the axis ticks
 * are the numbers the student plugs into d = v·t/2.
 */

import type { PulseState, ResolvedAcousticModel } from '@physicsos/engine-acoustics'
import { acousticBenchOf, type ObservableDefinition, type PhysicsScene } from '@physicsos/physics-scene'

import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  AcousticPulseVisual,
  AcousticReflectorVisual,
  AcousticSourceVisual,
  AcousticWavefrontVisual,
  DimensionVisual,
  GuideVisual,
  ObservableKey,
  ObservableVisibility,
  SceneVisualModel,
} from './scene-visual-model.ts'

export const fmtAcousticsValue = (value: number, digits = 4): string => {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) < 1e-9) return '0'
  return String(Number.parseFloat(value.toPrecision(digits)))
}

/**
 * Scene observable definition → canvas toggle key. The acoustics factory
 * stamps `observable-acoustics-wavefronts` / `observable-acoustics-path`, both
 * of type `geometry`, so the key is carried by the id.
 */
export const acousticsObservableKeyOf = (
  definition: ObservableDefinition,
): ObservableKey | undefined => {
  const id = String(definition.id)
  if (id.endsWith('-wavefronts')) return 'wavefronts'
  if (id.endsWith('-path')) return 'path'
  return undefined
}

const visibilityOf = (scene: PhysicsScene): ObservableVisibility => {
  const visible: Partial<Record<ObservableKey, boolean>> = {}
  for (const definition of scene.observableDefinitions) {
    const key = acousticsObservableKeyOf(definition)
    if (key !== undefined) visible[key] = definition.visible
  }
  return visible
}

/** Student-facing one-liner for the pulse's current leg. */
export const pulsePhaseText = (phase: PulseState['phase']): string =>
  phase === 'outbound' ? '去程（向峭壁传播）' : phase === 'return' ? '回程（反射后返回）' : '回声已接收'

/** A tick step that reads well for this range: 5 / 10 / 50 / 100 m … */
const tickStepOf = (span: number): number => {
  const target = span / 6
  const decade = 10 ** Math.floor(Math.log10(Math.max(target, 1)))
  for (const step of [1, 2, 5, 10]) {
    if (decade * step >= target) return decade * step
  }
  return decade * 10
}

export interface AcousticsVisualInput {
  readonly scene: PhysicsScene
  readonly model: ResolvedAcousticModel
  readonly pulse: PulseState
  /** Scene time in seconds the frame is showing. */
  readonly time: number
}

/** Build one acoustics frame from the verified echo state. */
export const acousticsSceneVisual = ({
  scene,
  model,
  pulse,
  time,
}: AcousticsVisualInput): SceneVisualModel => {
  const bench = acousticBenchOf(scene)
  if (bench === undefined) return emptyVisualModel('acoustics')

  const span = model.wallDistance
  const margin = Math.max(span * 0.12, 6)

  /* The real path is one line; the picture splits the two legs vertically the
     way every 初中 textbook draws 回声 — out high, back low. Presentation only:
     both heights are fractions of the range so the diagram scales with d. */
  const outboundY = span * 0.075
  const returnY = outboundY * 0.45
  const wallHalf = span * 0.09
  const top = span * 0.24
  const bottom = -span * 0.06

  const pulseY = pulse.phase === 'outbound' ? outboundY : returnY

  const acousticSources: AcousticSourceVisual[] = [
    {
      id: model.sourceId,
      at: { x: model.sourceX, y: 0 },
      label: bench.source.name ?? '声源',
    },
  ]

  const acousticReflectors: AcousticReflectorVisual[] = [
    {
      id: model.reflectorId,
      at: { x: model.reflectorX, y: 0 },
      halfHeight: wallHalf,
      label: bench.reflector.name ?? '峭壁',
    },
  ]

  const acousticPulse: AcousticPulseVisual = {
    id: 'sound-pulse',
    at: { x: pulse.x, y: pulseY },
    phase: pulse.phase,
  }

  /* Three trailing arcs behind the pulse, opening against the travel sense.
     Radii are fractions of the range so the glyph reads at any zoom. Once the
     echo is received there is nothing travelling, so no arcs. */
  const acousticWavefronts: AcousticWavefrontVisual[] =
    pulse.phase === 'received'
      ? []
      : [0.018, 0.034, 0.05].map((fraction, index) => ({
        id: `wavefront-${index}`,
        at: { x: pulse.x, y: pulseY },
        radius: span * fraction,
        direction: pulse.phase === 'outbound' ? 'forward' : 'backward',
      }))

  /* The two legs as construction guides, gated by the `path` observable. The
     renderer arrows them; travelled legs read solid through the pulse. */
  const guides: GuideVisual[] = [
    {
      id: 'path-outbound',
      observable: 'path',
      from: { x: model.sourceX, y: outboundY },
      to: { x: model.reflectorX, y: outboundY },
      label: '去程 t₁ = d/v',
    },
    {
      id: 'path-return',
      observable: 'path',
      from: { x: model.reflectorX, y: returnY },
      to: { x: model.sourceX, y: returnY },
      label: '回程 t₂ = d/v',
    },
  ]

  const dimensions: DimensionVisual[] = [
    {
      id: 'range-distance',
      from: { x: model.sourceX, y: top * 0.82 },
      to: { x: model.reflectorX, y: top * 0.82 },
      label: `d = ${fmtAcousticsValue(span)} m`,
    },
  ]

  const readout: string[] = [
    '回声读数',
    `t = ${time.toFixed(2)} s · ${pulsePhaseText(pulse.phase)}`,
    `已传播 s = ${fmtAcousticsValue(pulse.travelled)} m`,
    `声速 v = ${fmtAcousticsValue(model.soundSpeed)} m/s`,
  ]

  const tickStep = tickStepOf(span)

  return emptyVisualModel('acoustics', {
    extent: { width: span + 2 * margin, height: top - bottom },
    origin: { x: model.sourceX - margin, y: bottom },
    grid: { minor: tickStep / 5, major: tickStep },
    axes: { x: 'x / m', y: '' },
    tickStep,
    ground: {
      y: 0,
      from: model.sourceX - margin,
      to: model.reflectorX + margin,
    },
    guides,
    dimensions,
    acousticSources,
    acousticReflectors,
    acousticPulse,
    acousticWavefronts,
    overlay: {
      readout,
      scale: { label: `${fmtAcousticsValue(tickStep)} m`, length: tickStep },
    },
    visible: visibilityOf(scene),
  })
}
