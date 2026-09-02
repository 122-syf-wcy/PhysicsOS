import {
  check,
  invalidModelCondition,
  quantityVector,
  summarizeVerification,
  supported,
  unsupportedModel,
  type DerivedQuantity,
  type ModelSupport,
  type ObjectState,
  type PhysicsEngine,
  type PhysicsEventLike,
  type SimulationRequest,
  type SimulationResult,
  type SimulationState,
  type VerificationCheck,
  type VerificationResult,
} from '@physicsos/physics-core'
import type { Vector3 } from '@physicsos/physics-math'
import { validateScene, waveBenchesOf, type PhysicsScene } from '@physicsos/physics-scene'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'
import { asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'

import {
  antinodePositionsOf,
  interferenceDisplacementAt,
  interferenceVerdictOf,
  nodePositionsOf,
  pathDifferenceOf,
  resolveWaveModel,
  resultantAmplitudeOf,
  standingDisplacement,
  travellingDisplacement,
  travellingTransverseVelocity,
  type InterferenceVerdict,
  type ResolvedWaveModel,
} from './wave-model.ts'

export const WAVE_ENGINE_ID = 'engine-wave'
export const WAVE_ENGINE_VERSION = '1.0.0'
export const TRAVELLING_WAVE_MODEL = 'travelling_wave'
export const WAVE_INTERFERENCE_MODEL = 'wave_interference'
export const STANDING_WAVE_MODEL = 'standing_wave'

const DEFAULT_DURATION_SECONDS = 1
const TRAJECTORY_SEGMENTS = 60
/**
 * Minimum rope / string profile samples per state. The actual count grows with
 * the number of wavelengths drawn (see {@link profileSampleCountOf}) so a
 * six-wavelength rope is sampled as smoothly as a three-wavelength one.
 */
export const WAVE_PROFILE_SAMPLES = 48
/** Samples per wavelength the profile is drawn with. */
const SAMPLES_PER_WAVELENGTH = 16
const MAX_PROFILE_SAMPLES = 480

/**
 * Profile segments for a rig: 16 per wavelength across the drawn length, never
 * fewer than {@link WAVE_PROFILE_SAMPLES}. Point i sits at x = length·i/count,
 * so the last index is the far end of the rope or string.
 */
export const profileSampleCountOf = (model: ResolvedWaveModel): number => {
  const length =
    model.subModel === 'standing_wave'
      ? (model.stringLength ?? 0)
      : (model.ropeLength ?? 0)
  const cycles = model.wavelength > 0 ? length / model.wavelength : 0
  return Math.min(
    MAX_PROFILE_SAMPLES,
    Math.max(WAVE_PROFILE_SAMPLES, Math.ceil(cycles * SAMPLES_PER_WAVELENGTH)),
  )
}

const WAVE_RELATIVE_TOLERANCE = 1e-9

const TRAVELLING_ASSUMPTIONS = [
  'ideal rope, no damping, one sinusoidal wave',
  'y(x, t) = A·sin(2π(x/λ − f·t))',
  'v = λf and T = 1/f',
  'rope particles oscillate transversely and do not travel with the wave',
] as const

const INTERFERENCE_ASSUMPTIONS = [
  'two coherent in-phase sources of equal amplitude',
  'no amplitude fall-off with distance',
  'path difference Δ = |r₂ − r₁| sets the phase difference 2πΔ/λ',
  'Δ = nλ constructive, Δ = (n + ½)λ destructive',
] as const

const STANDING_ASSUMPTIONS = [
  'string clamped at both ends (nodes at x = 0 and x = L)',
  'L = n·λ/2 and f_n = n·v/(2L)',
  'y(x, t) = A·sin(nπx/L)·cos(2πf·t)',
  'wave speed on the string is fixed by the medium',
] as const

const failure = (condition: string, message: string) => ({ condition, message })

const metres = (value: number): Quantity<'length'> => quantity(value, 'm', 'length')
const hertz = (value: number): Quantity<'frequency'> => quantity(value, 'Hz', 'frequency')
const seconds = (value: number): Quantity<'time'> => quantity(value, 's', 'time')
const metresPerSecond = (value: number): Quantity<'velocity'> =>
  quantity(value, 'm/s', 'velocity')
const dimensionless = (value: number): Quantity<'dimensionless'> =>
  quantity(value, '', 'dimensionless')

const verdictSign = (verdict: InterferenceVerdict): number =>
  verdict === 'constructive' ? 1 : verdict === 'destructive' ? -1 : 0

const assumptionsOf = (model: ResolvedWaveModel): string[] => {
  if (model.subModel === 'travelling_wave') return [...TRAVELLING_ASSUMPTIONS]
  if (model.subModel === 'wave_interference') return [...INTERFERENCE_ASSUMPTIONS]
  return [...STANDING_ASSUMPTIONS]
}

/** Solve the scene's wave model; the single entry point UI layers reuse. */
export const resolveWave = (scene: PhysicsScene): ResolvedWaveModel => resolveWaveModel(scene)

/* ------------------------------------------------------- object ids -- */

export const waveProfileId = (benchId: string, index: number): string =>
  `${benchId}.profile.${index}`
export const waveMarkerId = (benchId: string): string => `${benchId}.marker`
export const waveSourceId = (benchId: string, index: 1 | 2): string =>
  `${benchId}.source-${index}`
export const wavePointId = (benchId: string): string => `${benchId}.point`
export const waveNodeId = (benchId: string, index: number): string => `${benchId}.node.${index}`
export const waveAntinodeId = (benchId: string, index: number): string =>
  `${benchId}.antinode.${index}`

/**
 * Where the marked rope particle sits: a quarter rope in, so it is well inside
 * the drawn train and away from the ends where the eye reads the wave entering.
 */
const markerPositionOf = (model: ResolvedWaveModel): number => (model.ropeLength ?? 0) / 4

/**
 * Observation point of the interference rig in the bench frame: sources at
 * (−d/2, 0) and (+d/2, 0). From |P − S₁| = r₁ and |P − S₂| = r₂ the x
 * coordinate is (r₁² − r₂²)/(2d) and y follows; y ≥ 0 by convention.
 */
const observationPointOf = (model: ResolvedWaveModel): Vector3 => {
  const separation = model.sourceSeparation ?? 0
  const pathOne = model.pathOne ?? 0
  const pathTwo = model.pathTwo ?? 0
  const x = (pathOne * pathOne - pathTwo * pathTwo) / (2 * separation)
  const ySquared = pathOne * pathOne - (x + separation / 2) * (x + separation / 2)
  return { x, y: Math.sqrt(Math.max(0, ySquared)), z: 0 }
}

/**
 * Two path lengths and a source separation only describe a real point when
 * they satisfy the triangle inequality: |r₂ − r₁| ≤ d ≤ r₁ + r₂. A path
 * difference larger than the separation is unreachable anywhere in the plane.
 */
const interferenceGeometryValid = (model: ResolvedWaveModel): boolean => {
  const separation = model.sourceSeparation ?? 0
  const pathOne = model.pathOne ?? 0
  const pathTwo = model.pathTwo ?? 0
  const slack = WAVE_RELATIVE_TOLERANCE * Math.max(separation, pathOne, pathTwo)
  return Math.abs(pathTwo - pathOne) <= separation + slack && separation <= pathOne + pathTwo + slack
}

/* ------------------------------------------------------- derived facts -- */

const derivedOf = (model: ResolvedWaveModel): DerivedQuantity[] => {
  const assumptions = assumptionsOf(model)
  const period = 1 / model.frequency

  const facts: DerivedQuantity[] = [
    {
      key: 'wave_speed',
      targetId: model.benchId,
      value: metresPerSecond(model.waveSpeed),
      formula: { expression: 'v = λf' },
      assumptions,
    },
    {
      key: 'period',
      targetId: model.benchId,
      value: seconds(period),
      formula: { expression: 'T = 1 / f' },
      assumptions,
    },
    {
      key: 'wavelength',
      targetId: model.benchId,
      value: metres(model.wavelength),
      formula: {
        expression: model.subModel === 'standing_wave' ? 'λ = 2L / n' : 'λ',
      },
      assumptions,
    },
    {
      key: 'frequency',
      targetId: model.benchId,
      value: hertz(model.frequency),
      formula: {
        expression: model.subModel === 'standing_wave' ? 'f_n = n·v / (2L)' : 'f',
      },
      assumptions,
    },
    {
      key: 'amplitude',
      targetId: model.benchId,
      value: metres(model.amplitude),
      formula: { expression: 'A' },
      assumptions,
    },
  ]

  if (model.subModel === 'travelling_wave') {
    facts.push({
      key: 'rope_length',
      targetId: model.benchId,
      value: metres(model.ropeLength ?? 0),
      formula: { expression: 'ℓ' },
      assumptions,
    })
  }

  if (model.subModel === 'wave_interference') {
    const pathDifference = pathDifferenceOf(model)
    const verdict = interferenceVerdictOf(model)
    facts.push(
      {
        key: 'path_difference',
        targetId: wavePointId(model.benchId),
        value: metres(pathDifference),
        formula: { expression: 'Δ = |r₂ − r₁|' },
        assumptions,
      },
      {
        key: 'path_difference_ratio',
        targetId: wavePointId(model.benchId),
        value: dimensionless(pathDifference / model.wavelength),
        formula: { expression: 'Δ / λ' },
        assumptions,
      },
      {
        key: 'resultant_amplitude',
        targetId: wavePointId(model.benchId),
        value: metres(resultantAmplitudeOf(model)),
        formula: { expression: 'A_P = |2A·cos(πΔ/λ)|' },
        assumptions,
      },
      {
        /* +1 constructive (加强), −1 destructive (减弱), 0 partial — published
           so a renderer or tutor never re-classifies Δ/λ on its own. */
        key: 'interference_type',
        targetId: wavePointId(model.benchId),
        value: dimensionless(verdictSign(verdict)),
        formula: { expression: 'Δ = nλ → +1 · Δ = (n + ½)λ → −1 · otherwise 0' },
        assumptions,
      },
      {
        key: 'source_separation',
        targetId: model.benchId,
        value: metres(model.sourceSeparation ?? 0),
        formula: { expression: 'd' },
        assumptions,
      },
    )
  }

  if (model.subModel === 'standing_wave') {
    const stringLength = model.stringLength ?? 0
    const harmonic = model.harmonic ?? 1
    facts.push(
      {
        key: 'string_length',
        targetId: model.benchId,
        value: metres(stringLength),
        formula: { expression: 'L = n·λ / 2' },
        assumptions,
      },
      {
        key: 'harmonic',
        targetId: model.benchId,
        value: dimensionless(harmonic),
        formula: { expression: 'n' },
        assumptions,
      },
      {
        key: 'fundamental_frequency',
        targetId: model.benchId,
        value: hertz(model.waveSpeed / (2 * stringLength)),
        formula: { expression: 'f₁ = v / (2L)' },
        assumptions,
      },
      {
        key: 'node_count',
        targetId: model.benchId,
        value: dimensionless(harmonic + 1),
        formula: { expression: 'n + 1' },
        assumptions,
      },
      {
        key: 'antinode_count',
        targetId: model.benchId,
        value: dimensionless(harmonic),
        formula: { expression: 'n' },
        assumptions,
      },
    )
  }

  return facts
}

/* ---------------------------------------------------------- states -- */

const profileObjects = (
  model: ResolvedWaveModel,
  length: number,
  displacement: (x: number) => number,
): ObjectState[] => {
  const count = profileSampleCountOf(model)
  return Array.from({ length: count + 1 }, (_, index) => {
    const x = (length * index) / count
    return {
      id: waveProfileId(model.benchId, index),
      position: quantityVector({ x, y: displacement(x), z: 0 }, 'm', 'length'),
    }
  })
}

const stateOf = (model: ResolvedWaveModel, timeSeconds: number): SimulationState => {
  const benchValues: Record<string, Quantity> = {
    wave_speed: metresPerSecond(model.waveSpeed),
    period: seconds(1 / model.frequency),
    wavelength: metres(model.wavelength),
    frequency: hertz(model.frequency),
  }
  const objects: ObjectState[] = [{ id: model.benchId, values: benchValues }]

  if (model.subModel === 'travelling_wave') {
    const ropeLength = model.ropeLength ?? 0
    objects.push(
      ...profileObjects(model, ropeLength, (x) => travellingDisplacement(model, x, timeSeconds)),
    )
    /* The marked particle: fixed x, transverse SHM in y. Its velocity is the
       transverse velocity ∂y/∂t — it never gains an x component. */
    const markerX = markerPositionOf(model)
    objects.push({
      id: waveMarkerId(model.benchId),
      position: quantityVector(
        { x: markerX, y: travellingDisplacement(model, markerX, timeSeconds), z: 0 },
        'm',
        'length',
      ),
      velocity: quantityVector(
        { x: 0, y: travellingTransverseVelocity(model, markerX, timeSeconds), z: 0 },
        'm/s',
        'velocity',
      ),
    })
  }

  if (model.subModel === 'wave_interference') {
    const separation = model.sourceSeparation ?? 0
    const sourceDisplacement = model.amplitude * Math.sin(2 * Math.PI * model.frequency * timeSeconds)
    objects.push(
      {
        id: waveSourceId(model.benchId, 1),
        position: quantityVector({ x: -separation / 2, y: 0, z: 0 }, 'm', 'length'),
        values: { displacement: metres(sourceDisplacement) },
      },
      {
        id: waveSourceId(model.benchId, 2),
        position: quantityVector({ x: separation / 2, y: 0, z: 0 }, 'm', 'length'),
        values: { displacement: metres(sourceDisplacement) },
      },
      {
        id: wavePointId(model.benchId),
        position: quantityVector(observationPointOf(model), 'm', 'length'),
        values: {
          displacement: metres(interferenceDisplacementAt(model, timeSeconds)),
          resultant_amplitude: metres(resultantAmplitudeOf(model)),
          path_difference: metres(pathDifferenceOf(model)),
        },
      },
    )
  }

  if (model.subModel === 'standing_wave') {
    const stringLength = model.stringLength ?? 0
    objects.push(
      ...profileObjects(model, stringLength, (x) => standingDisplacement(model, x, timeSeconds)),
    )
    nodePositionsOf(model).forEach((x, index) => {
      objects.push({
        id: waveNodeId(model.benchId, index),
        position: quantityVector({ x, y: 0, z: 0 }, 'm', 'length'),
      })
    })
    antinodePositionsOf(model).forEach((x, index) => {
      objects.push({
        id: waveAntinodeId(model.benchId, index),
        position: quantityVector(
          { x, y: standingDisplacement(model, x, timeSeconds), z: 0 },
          'm',
          'length',
        ),
      })
    })
  }

  return {
    time: seconds(timeSeconds),
    objects,
    derived: derivedOf(model),
  }
}

/* ---------------------------------------------------- verification -- */

const relativeClose = (actual: number, expected: number, scale = 1): boolean =>
  Math.abs(actual - expected) <=
  WAVE_RELATIVE_TOLERANCE * Math.max(Math.abs(actual), Math.abs(expected), scale)

const positionOf = (state: SimulationState, id: string): Vector3 | undefined =>
  state.objects.find((entry) => entry.id === id)?.position?.vector

/**
 * The checks name the laws each sub-model claims to honour so the UI can cite
 * them by id. They are evaluated on the sampled states where possible, so a
 * broken closed form (sign slip, wrong k) fails here rather than in a renderer.
 */
const buildVerification = (
  scene: PhysicsScene,
  model: ResolvedWaveModel,
  states: readonly SimulationState[],
): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]
  const period = 1 / model.frequency

  checks.push(
    check(
      'wave_speed_relation',
      'constraint',
      relativeClose(model.waveSpeed, model.wavelength * model.frequency),
      {
        message: '波速、波长与频率满足 v = λf。',
        targetId: model.benchId,
        details: { waveSpeed: model.waveSpeed, wavelength: model.wavelength, frequency: model.frequency },
      },
    ),
    check('period_frequency_reciprocal', 'constraint', relativeClose(period * model.frequency, 1), {
      message: '周期与频率互为倒数：T = 1/f。',
      targetId: model.benchId,
      details: { period, frequency: model.frequency },
    }),
  )

  if (model.subModel === 'travelling_wave') {
    /* The profile translates at v: y(x, t) = y(x − v·δ, t − δ). Sampled at a
       few phases so a wrong sign in the phase would show as a mismatch. */
    const ropeLength = model.ropeLength ?? 0
    const delta = period / 7
    let translates = true
    for (const t of [period / 3, period, 2.5 * period]) {
      for (const x of [ropeLength * 0.3, ropeLength * 0.6, ropeLength * 0.9]) {
        const here = travellingDisplacement(model, x, t)
        const upstream = travellingDisplacement(model, x - model.waveSpeed * delta, t - delta)
        if (!relativeClose(here, upstream, model.amplitude)) translates = false
      }
    }
    checks.push(
      check('profile_translation', 'conservation', translates, {
        message: '波形以 v = λf 整体平移：y(x, t) = y(x − vΔt, t − Δt)。',
        targetId: model.benchId,
        details: { waveSpeed: model.waveSpeed },
      }),
    )

    /* The marked particle keeps its x at every sample and never leaves ±A. */
    const markerX = markerPositionOf(model)
    const markerFixed = states.every((state) => {
      const position = positionOf(state, waveMarkerId(model.benchId))
      return (
        position !== undefined &&
        relativeClose(position.x, markerX, Math.max(markerX, model.wavelength)) &&
        Math.abs(position.y) <= model.amplitude * (1 + WAVE_RELATIVE_TOLERANCE)
      )
    })
    checks.push(
      check('particle_no_net_transport', 'conservation', markerFixed, {
        message: '介质质点只在平衡位置附近横向振动，不随波迁移。',
        targetId: waveMarkerId(model.benchId),
        details: { markerX, amplitude: model.amplitude, sampleCount: states.length },
      }),
    )
  }

  if (model.subModel === 'wave_interference') {
    const pathDifference = pathDifferenceOf(model)
    const verdict = interferenceVerdictOf(model)
    const resultant = resultantAmplitudeOf(model)
    const ratio = pathDifference / model.wavelength

    checks.push(
      check('interference_geometry', 'constraint', interferenceGeometryValid(model), {
        message: '路程差不能超过两源间距：|r₂ − r₁| ≤ d ≤ r₁ + r₂。',
        targetId: wavePointId(model.benchId),
        details: {
          sourceSeparation: model.sourceSeparation,
          pathOne: model.pathOne,
          pathTwo: model.pathTwo,
        },
      }),
    )

    /* Δ = nλ must give 2A, Δ = (n + ½)λ must give 0, anything else strictly
       between — the classification and the amplitude formula must agree. */
    const twoA = 2 * model.amplitude
    const ruleHolds =
      verdict === 'constructive'
        ? relativeClose(resultant, twoA, twoA)
        : verdict === 'destructive'
          ? Math.abs(resultant) <= WAVE_RELATIVE_TOLERANCE * twoA
          : resultant > 0 && resultant < twoA
    checks.push(
      check('path_difference_rule', 'constraint', ruleHolds, {
        message: '路程差 Δ = nλ 处振动加强，Δ = (n + ½)λ 处振动减弱。',
        targetId: wavePointId(model.benchId),
        details: { pathDifference, ratio, verdict, resultantAmplitude: resultant },
      }),
    )

    /* The summed displacement at P never exceeds the derived resultant. */
    const bounded = states.every((state) => {
      const point = state.objects.find((entry) => entry.id === wavePointId(model.benchId))
      const displacement = point?.values?.['displacement']
      if (displacement === undefined || !('value' in displacement)) return false
      return Math.abs(displacement.value) <= resultant + WAVE_RELATIVE_TOLERANCE * twoA
    })
    checks.push(
      check('superposition_bounds', 'conservation', bounded, {
        message: '叠加位移 y = y₁ + y₂ 的幅值不超过合振幅 A_P = |2A·cos(πΔ/λ)|。',
        targetId: wavePointId(model.benchId),
        details: { resultantAmplitude: resultant, sampleCount: states.length },
      }),
    )
  }

  if (model.subModel === 'standing_wave') {
    const stringLength = model.stringLength ?? 0
    const harmonic = model.harmonic ?? 1
    checks.push(
      check(
        'harmonic_relation',
        'constraint',
        relativeClose(stringLength, (harmonic * model.wavelength) / 2, stringLength),
        {
          message: '两端固定的弦满足 L = n·λ/2。',
          targetId: model.benchId,
          details: { stringLength, harmonic, wavelength: model.wavelength },
        },
      ),
      check(
        'frequency_harmonic',
        'constraint',
        relativeClose(model.frequency, (harmonic * model.waveSpeed) / (2 * stringLength)),
        {
          message: '第 n 次谐波频率 f_n = n·v/(2L) = n·f₁。',
          targetId: model.benchId,
          details: { frequency: model.frequency, fundamental: model.waveSpeed / (2 * stringLength) },
        },
      ),
    )

    /* Clamped ends and every node stay at zero displacement in every state. */
    const nodeIds = nodePositionsOf(model).map((_, index) => waveNodeId(model.benchId, index))
    const lastSample = profileSampleCountOf(model)
    const endsFixed = states.every((state) =>
      [waveProfileId(model.benchId, 0), waveProfileId(model.benchId, lastSample)].every(
        (id) => {
          const position = positionOf(state, id)
          return position !== undefined && Math.abs(position.y) <= WAVE_RELATIVE_TOLERANCE * model.amplitude
        },
      ),
    )
    checks.push(
      check('boundary_nodes', 'constraint', endsFixed, {
        message: '固定端始终是波节：x = 0 与 x = L 处位移恒为零。',
        targetId: model.benchId,
        details: { sampleCount: states.length },
      }),
    )
    const nodesStill = states.every((state) =>
      nodeIds.every((id) => {
        const position = positionOf(state, id)
        if (position === undefined) return false
        return (
          Math.abs(standingDisplacement(model, position.x, state.time.value)) <=
          WAVE_RELATIVE_TOLERANCE * model.amplitude
        )
      }),
    )
    checks.push(
      check('node_positions_fixed', 'conservation', nodesStill, {
        message: '波节位置 x_m = m·L/n 的位移在任意时刻均为零。',
        targetId: model.benchId,
        details: { nodeCount: nodeIds.length },
      }),
    )
  }

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

/* --------------------------------------------------------- engine -- */

export function createWaveSimulationRequest(
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
): SimulationRequest {
  return {
    schemaVersion: 'simulation-request/1.0',
    simulationId: asSimulationId(simulationId),
    sceneId: scene.id,
    sceneRevision: scene.revision,
    requestedDomain: 'wave',
    options: {
      ...(scene.timeline.endTime === undefined ? {} : { endTime: scene.timeline.endTime }),
    },
    trace: {
      traceId: asTraceId(traceId),
      sceneId: scene.id,
      sceneRevision: scene.revision,
    },
  }
}

export class WaveEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = WAVE_ENGINE_ID
  readonly engineVersion = WAVE_ENGINE_VERSION
  readonly domain = 'wave' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    if (waveBenchesOf(scene).length !== 1) {
      return unsupportedModel(
        [failure('single_wave_bench', 'Wave Engine requires exactly one wave bench.')],
        WAVE_ENGINE_ID,
      )
    }
    if (
      scene.particles.length > 0 ||
      scene.bodies.length > 0 ||
      scene.fields.length > 0 ||
      scene.forces.length > 0 ||
      scene.regions.length > 0 ||
      scene.boundaries.length > 0 ||
      scene.constraints.length > 0 ||
      scene.circuits.length > 0 ||
      (scene.opticalBenches ?? []).length > 0 ||
      (scene.acousticBenches ?? []).length > 0 ||
      (scene.fluidTanks ?? []).length > 0 ||
      (scene.thermalBenches ?? []).length > 0 ||
      (scene.leverBenches ?? []).length > 0 ||
      (scene.inductionBenches ?? []).length > 0
    ) {
      return unsupportedModel(
        [
          failure(
            'pure_wave_scene',
            'Wave Engine models pure wave scenes without motion objects, fields, circuits or other bench rigs.',
          ),
        ],
        WAVE_ENGINE_ID,
      )
    }

    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(WAVE_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        WAVE_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }

    let model: ResolvedWaveModel
    try {
      model = resolveWaveModel(scene)
    } catch (error: unknown) {
      return invalidModelCondition(WAVE_ENGINE_ID, [
        failure(
          'wave_model_resolvable',
          error instanceof Error ? error.message : 'The wave bench cannot be resolved.',
        ),
      ])
    }
    if (model.subModel === 'wave_interference' && !interferenceGeometryValid(model)) {
      return invalidModelCondition(WAVE_ENGINE_ID, [
        failure(
          'interference_geometry',
          'The path lengths and source separation must satisfy |r₂ − r₁| ≤ d ≤ r₁ + r₂; no point in the plane has this path difference.',
        ),
      ])
    }
    return supported(model.subModel, this.domain)
  }

  validate(scene: PhysicsScene): VerificationResult {
    const support = this.canHandle(scene)
    if (support.supported) {
      return { status: 'passed', checks: [], warnings: [], errors: [] }
    }
    return {
      status: 'failed',
      checks: support.failedConditions.map((entry) => ({
        id: entry.condition,
        type: 'constraint',
        passed: false,
        message: entry.message,
      })),
      warnings: [],
      errors: support.failedConditions.map((entry) => ({
        code: entry.condition,
        severity: 'error',
        message: entry.message,
      })),
    }
  }

  stateAt(scene: PhysicsScene, time: Quantity<'time'>): SimulationState {
    const timeSeconds = canonicalValue(time)
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
      throw new PhysicsOSError(
        'INVALID_SIMULATION_TIME',
        'Simulation time must be finite and non-negative.',
      )
    }
    return stateOf(resolveWaveModel(scene), timeSeconds)
  }

  simulate(scene: PhysicsScene, request: SimulationRequest): SimulationResult<PhysicsEventLike> {
    if (request.sceneId !== scene.id || request.sceneRevision !== scene.revision) {
      throw new PhysicsOSError(
        'SIMULATION_SCENE_MISMATCH',
        'SimulationRequest must reference the exact PhysicsScene revision being simulated.',
        {
          details: {
            requestSceneId: request.sceneId,
            sceneId: scene.id,
            requestRevision: request.sceneRevision,
            sceneRevision: scene.revision,
          },
        },
      )
    }

    const startedAt = new Date().toISOString()
    const model = resolveWaveModel(scene)
    const sceneDuration =
      scene.timeline.endTime === undefined
        ? DEFAULT_DURATION_SECONDS
        : canonicalValue(scene.timeline.endTime)
    const startTime =
      request.options.startTime === undefined ? 0 : canonicalValue(request.options.startTime)
    const endTime =
      request.options.endTime === undefined ? sceneDuration : canonicalValue(request.options.endTime)
    if (
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      startTime < 0 ||
      endTime < startTime
    ) {
      throw new PhysicsOSError(
        'INVALID_SIMULATION_RANGE',
        'Wave simulation range must satisfy 0 <= startTime <= endTime.',
      )
    }

    const times = Array.from(
      { length: TRAJECTORY_SEGMENTS + 1 },
      (_, index) => startTime + ((endTime - startTime) * index) / TRAJECTORY_SEGMENTS,
    )
    const states = times.map((time) => stateOf(model, time))

    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      states,
      events: [],
      measurements: [],
      derivedQuantities: derivedOf(model),
      verification: buildVerification(scene, model, states),
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'wave-closed-form',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const waveEngine = new WaveEngine()
