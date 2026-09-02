/**
 * Wave scene builder: IR → PhysicsScene.
 *
 * Maps the parsed wave question to the wave bench templates
 * (createTravellingWaveScene / createWaveInterferenceScene /
 * createStandingWaveScene). It performs NO physics: a question that states the
 * wave speed instead of the wavelength hands the speed to the template, whose
 * bench contract folds it into λ = v/f; a period is passed as f = 1/T only
 * because T = 1/f is the definition of the period, not a law. The wave engine
 * solves the scene this produces and the verifier judges what it produced.
 *
 * The IR stores SI (metres, hertz); the bench templates take authoring units
 * (centimetres for the amplitude, metres and hertz otherwise), so this is where
 * the one conversion happens.
 */

import {
  createStandingWaveScene,
  createTravellingWaveScene,
  createWaveInterferenceScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { asQuestionId, type IsoDateTime } from '@physicsos/shared'

import type { PhysicsSemanticIR } from './semantic-ir.ts'

export interface WaveSceneBuildResult {
  readonly scene: PhysicsScene
  readonly irToSceneMapping: Record<string, string>
}

const knownValue = (ir: PhysicsSemanticIR, key: string): number | undefined =>
  ir.knowns.find((entry) => entry.key === key)?.value

const CM_PER_METRE = 100

/** Display-grade defaults: the physics gaps were already rejected by the validator. */
const DEFAULT_AMPLITUDE_CM = 5
const DEFAULT_INTERFERENCE_AMPLITUDE_CM = 3
const DEFAULT_STANDING_AMPLITUDE_CM = 4
const DEFAULT_INTERFERENCE_FREQUENCY_HZ = 10

/**
 * Build a wave PhysicsScene from a question IR.
 *
 * Returns a scene the WaveEngine accepts (exactly one wave bench, nothing
 * else). `sourceQuestionId` is written so the Lab forks the scene before the
 * student edits a stated fact.
 */
export function buildWaveSceneFromIR(
  ir: PhysicsSemanticIR,
  options: { sceneId?: string; questionId?: string; now?: IsoDateTime } = {},
): WaveSceneBuildResult {
  const amplitudeMetres = ir.waveAmplitude ?? knownValue(ir, 'wave_amplitude')
  const wavelength = ir.waveWavelength ?? knownValue(ir, 'wavelength')
  const waveSpeed = ir.waveSpeed ?? knownValue(ir, 'wave_speed')
  const period = knownValue(ir, 'wave_period')
  const frequency =
    ir.waveFrequency ??
    knownValue(ir, 'wave_frequency') ??
    (period !== undefined && period > 0 ? 1 / period : undefined)

  const title =
    ir.model === 'travelling_wave'
      ? '试题场景：绳上的简谐横波'
      : ir.model === 'wave_interference'
        ? '试题场景：双源干涉'
        : '试题场景：弦驻波'
  const description =
    options.questionId === undefined
      ? '由 Wave Question IR 生成'
      : `由试题 ${options.questionId} 的 Wave Question IR 生成`
  const sceneId = options.sceneId
  const now = options.now
  const common = {
    ...(sceneId === undefined ? {} : { sceneId }),
    ...(now === undefined ? {} : { now }),
    title,
    description,
  }
  /* Prefer the stated wavelength; a stated speed is the alternative the
     template resolves through its own λ = v/f contract. */
  const medium =
    wavelength !== undefined
      ? { wavelength }
      : waveSpeed !== undefined
        ? { waveSpeed }
        : {}

  let scene: PhysicsScene
  let mapping: Record<string, string>

  if (ir.model === 'travelling_wave') {
    scene = createTravellingWaveScene({
      ...common,
      amplitude: (amplitudeMetres ?? DEFAULT_AMPLITUDE_CM / CM_PER_METRE) * CM_PER_METRE,
      ...medium,
      ...(frequency === undefined ? {} : { frequency }),
    })
    mapping = { rope: 'wave-bench-1', wave_source: 'wave-bench-1' }
  } else if (ir.model === 'wave_interference') {
    const pathOne = ir.wavePathOne ?? knownValue(ir, 'path_one')
    const pathTwo = ir.wavePathTwo ?? knownValue(ir, 'path_two')
    const pathDifference =
      ir.wavePathDifference ??
      knownValue(ir, 'path_difference') ??
      (pathOne !== undefined && pathTwo !== undefined ? Math.abs(pathTwo - pathOne) : 0)
    /* When only Δ is stated the rig still needs a real point: park it a full
       separation from S₁ and Δ farther from S₂ — reachable for every Δ ≤ d. */
    const separation =
      ir.waveSourceSeparation ??
      knownValue(ir, 'source_separation') ??
      Math.max(0.8, 2 * pathDifference)
    const resolvedPathOne = pathOne ?? separation
    const resolvedPathTwo = pathTwo ?? resolvedPathOne + pathDifference
    scene = createWaveInterferenceScene({
      ...common,
      amplitude: (amplitudeMetres ?? DEFAULT_INTERFERENCE_AMPLITUDE_CM / CM_PER_METRE) * CM_PER_METRE,
      ...medium,
      frequency: frequency ?? DEFAULT_INTERFERENCE_FREQUENCY_HZ,
      sourceSeparation: separation,
      pathOne: resolvedPathOne,
      pathTwo: resolvedPathTwo,
    })
    mapping = {
      wave_source: 'wave-bench-1.source-1',
      observation_point: 'wave-bench-1.point',
    }
  } else {
    const stringLength = ir.waveStringLength ?? knownValue(ir, 'string_length') ?? 1
    const harmonic = ir.waveHarmonic ?? knownValue(ir, 'harmonic') ?? 1
    scene = createStandingWaveScene({
      ...common,
      amplitude: (amplitudeMetres ?? DEFAULT_STANDING_AMPLITUDE_CM / CM_PER_METRE) * CM_PER_METRE,
      stringLength,
      harmonic,
      ...(waveSpeed !== undefined
        ? { waveSpeed }
        : frequency !== undefined
          ? { frequency }
          : {}),
    })
    mapping = { string: 'wave-bench-1' }
  }

  if (options.questionId !== undefined) {
    scene.metadata.sourceQuestionId = asQuestionId(options.questionId)
  }
  return { scene, irToSceneMapping: mapping }
}
