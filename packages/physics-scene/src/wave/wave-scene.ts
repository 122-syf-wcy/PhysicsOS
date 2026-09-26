import { quantity } from '@physicsos/physics-units'
import { asObservableId, asSceneId, PhysicsOSError, type IsoDateTime } from '@physicsos/shared'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type { PhysicsScene, WaveBench, WaveBenchType } from '../scene.ts'

/**
 * Wave bench scenes carry a real timeline: a travelling wave advances one
 * wavelength every period, and a standing wave oscillates between its extremes,
 * so the displacement profile evolves with time. The scene does NOT store the
 * wave speed or the displacement anywhere — A, λ, f and the geometry are the
 * editable facts, so v = λf, T = 1/f, the interference verdict and the node
 * positions are derived by the engine instead of persisted values that go stale
 * on the next edit.
 *
 * Authoring units follow the lab: centimetres for amplitude, metres for
 * wavelength and rig geometry, hertz for frequency.
 */
export type WaveObservableKey =
  | 'waveform'
  | 'wave_speed'
  | 'superposition'
  | 'nodes'
  | 'longitudinal'
  | 'boundary'
  | 'diffraction'
  | 'doppler'

/**
 * Netlist-style authoring input for the travelling rope-wave rig.
 *
 * A source states either the wavelength or the medium's wave speed alongside
 * the frequency — textbooks do both — and the bench keeps λ, so a speed is
 * folded into λ = v/f here, the same identity the runtime commands maintain.
 */
export interface TravellingWaveSpec {
  readonly benchId?: string
  readonly type?: 'travelling'
  /** Amplitude in centimetres (> 0). */
  readonly amplitude: number
  /** Wavelength in metres (> 0). Required unless `waveSpeed` is given. */
  readonly wavelength?: number
  /** Wave speed of the medium in m/s (> 0); used as λ = v/f when `wavelength` is absent. */
  readonly waveSpeed?: number
  /** Frequency in hertz (> 0). */
  readonly frequency: number
  /** Length of rope drawn in metres (> 0); defaults to three wavelengths. */
  readonly ropeLength?: number
}

/** Authoring input for the two-source interference rig. */
export interface InterferenceWaveSpec {
  readonly benchId?: string
  readonly type: 'interference'
  /** Amplitude of each source in centimetres (> 0). */
  readonly amplitude: number
  /** Wavelength in metres (> 0). Required unless `waveSpeed` is given. */
  readonly wavelength?: number
  /** Wave speed of the medium in m/s (> 0); used as λ = v/f when `wavelength` is absent. */
  readonly waveSpeed?: number
  /** Frequency in hertz (> 0). */
  readonly frequency: number
  /** Separation between the two coherent sources in metres (> 0). */
  readonly sourceSeparation: number
  /** Distance from source 1 to the observation point in metres (> 0). */
  readonly pathOne: number
  /** Distance from source 2 to the observation point in metres (> 0). */
  readonly pathTwo: number
}

/**
 * Authoring input for the clamped-string standing-wave rig. The medium is
 * stated either as the wave speed or as the frequency of the named harmonic;
 * the bench keeps v, so a frequency is folded into v = 2L·f/n here.
 */
export interface StandingWaveSpec {
  readonly benchId?: string
  readonly type: 'standing'
  /** Amplitude in centimetres (> 0). */
  readonly amplitude: number
  /** Length of the clamped string in metres (> 0). */
  readonly stringLength: number
  /** Harmonic number n ≥ 1 (integral). */
  readonly harmonic: number
  /** Wave speed on the string in m/s (> 0). Required unless `frequency` is given. */
  readonly waveSpeed?: number
  /** Frequency of the n-th harmonic in hertz (> 0); used as v = 2L·f/n when `waveSpeed` is absent. */
  readonly frequency?: number
}

/** Authoring input for a longitudinal wave in a one-dimensional medium. */
export interface LongitudinalWaveSpec {
  readonly benchId?: string
  readonly type: 'longitudinal'
  /** Displacement amplitude in centimetres (> 0). */
  readonly amplitude: number
  /** Wavelength in metres (> 0). Required unless `waveSpeed` is given. */
  readonly wavelength?: number
  /** Wave speed in m/s (> 0); used as λ = v/f when `wavelength` is absent. */
  readonly waveSpeed?: number
  /** Frequency in hertz (> 0). */
  readonly frequency: number
  /** Drawn medium length in metres (> 0); defaults to three wavelengths. */
  readonly mediumLength?: number
}

/**
 * Authoring input for a wave crossing a boundary between two media.
 *
 * Angles are measured from the boundary normal. The incident frequency is
 * unchanged across the boundary; the transmitted speed sets the transmitted
 * wavelength through λ = v/f.
 */
export interface ReflectionRefractionWaveSpec {
  readonly benchId?: string
  readonly type: 'reflection_refraction'
  /** Relative amplitude in arbitrary length units; the model only uses ratios. */
  readonly amplitude: number
  /** Frequency in hertz (> 0). */
  readonly frequency: number
  /** Incident-medium wave speed in m/s (> 0). */
  readonly incidentSpeed: number
  /** Second-medium wave speed in m/s (> 0). */
  readonly transmittedSpeed: number
  /** Angle of incidence from the normal, in degrees. */
  readonly incidentAngle: number
}

/** Authoring input for a single slit diffraction rig. */
export interface DiffractionWaveSpec {
  readonly benchId?: string
  readonly type: 'diffraction'
  readonly amplitude: number
  readonly wavelength?: number
  readonly waveSpeed?: number
  readonly frequency: number
  /** Slit width in metres (> 0). */
  readonly slitWidth: number
  /** Slit-to-screen distance in metres (> 0). */
  readonly screenDistance: number
  /** Order of the reported minimum; positive integer, defaults to 1. */
  readonly order?: number
}

/** Authoring input for the moving-source/moving-observer Doppler rig. */
export interface DopplerWaveSpec {
  readonly benchId?: string
  readonly type: 'doppler'
  readonly amplitude: number
  /** Emitted source frequency in hertz (> 0). */
  readonly sourceFrequency: number
  /** Wave speed in the medium in m/s (> 0). */
  readonly waveSpeed: number
  /** Source speed along the source-observer line in m/s (≥ 0). */
  readonly sourceSpeed: number
  /** Observer speed along the source-observer line in m/s (≥ 0). */
  readonly observerSpeed: number
  readonly sourceDirection: 'approaching' | 'receding'
  readonly observerDirection: 'approaching' | 'receding' | 'stationary'
}

/** Discriminated authoring input: one sub-model per bench. */
export type WaveBenchSpec =
  | TravellingWaveSpec
  | InterferenceWaveSpec
  | StandingWaveSpec
  | LongitudinalWaveSpec
  | ReflectionRefractionWaveSpec
  | DiffractionWaveSpec
  | DopplerWaveSpec

export interface WaveBenchSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly bench: WaveBenchSpec
  readonly observableVisibility?: Partial<Record<WaveObservableKey, boolean>>
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const observableId = (key: WaveObservableKey) => asObservableId(`observable-wave-${key}`)

const typeOfSpec = (spec: WaveBenchSpec): WaveBenchType => spec.type ?? 'travelling'

/**
 * A standing wave's frequency is fixed by the harmonic: f_n = n·v/(2L). It is
 * stored on the bench so the contract stays uniform (every bench has a
 * frequency), while the engine re-derives it from L, n and v rather than
 * trusting this value.
 */
/**
 * The medium's speed on a standing bench: stated directly, or recovered from
 * the named harmonic's frequency through the same f_n = n·v/(2L) the bench
 * itself encodes. A spec with neither is not a rig.
 */
const standingSpeedOf = (spec: StandingWaveSpec): number => {
  if (spec.waveSpeed !== undefined) return spec.waveSpeed
  if (spec.frequency !== undefined) return (2 * spec.stringLength * spec.frequency) / spec.harmonic
  throw new PhysicsOSError(
    'WAVE_SPEC_INCOMPLETE',
    'A standing wave spec needs either waveSpeed or the harmonic frequency.',
  )
}

/** λ for a rope / tank spec: stated directly, or λ = v/f from the medium speed. */
const wavelengthOf = (spec: TravellingWaveSpec | InterferenceWaveSpec): number => {
  if (spec.wavelength !== undefined) return spec.wavelength
  if (spec.waveSpeed !== undefined) return spec.waveSpeed / spec.frequency
  throw new PhysicsOSError(
    'WAVE_SPEC_INCOMPLETE',
    'A travelling or interference wave spec needs either wavelength or waveSpeed.',
  )
}

const wavelengthFromSpeed = (speed: number, frequency: number): number => speed / frequency

const toBench = (spec: WaveBenchSpec): WaveBench => {
  const id = spec.benchId ?? 'wave-bench-1'
  const amplitude = quantity(spec.amplitude, 'cm', 'length')
  const type = typeOfSpec(spec)

  if (type === 'standing') {
    const standing = spec as StandingWaveSpec
    const waveSpeed = standingSpeedOf(standing)
    return {
      id,
      type: 'standing',
      amplitude,
      frequency: quantity(
        (standing.harmonic * waveSpeed) / (2 * standing.stringLength),
        'Hz',
        'frequency',
      ),
      stringLength: quantity(standing.stringLength, 'm', 'length'),
      harmonic: standing.harmonic,
      waveSpeed: quantity(waveSpeed, 'm/s', 'velocity'),
    }
  }

  if (type === 'interference') {
    const pair = spec as InterferenceWaveSpec
    return {
      id,
      type: 'interference',
      amplitude,
      frequency: quantity(pair.frequency, 'Hz', 'frequency'),
      wavelength: quantity(wavelengthOf(pair), 'm', 'length'),
      sourceSeparation: quantity(pair.sourceSeparation, 'm', 'length'),
      pathOne: quantity(pair.pathOne, 'm', 'length'),
      pathTwo: quantity(pair.pathTwo, 'm', 'length'),
    }
  }

  if (type === 'longitudinal') {
    const longitudinal = spec as LongitudinalWaveSpec
    const wavelength =
      longitudinal.wavelength ??
      (longitudinal.waveSpeed === undefined
        ? undefined
        : wavelengthFromSpeed(longitudinal.waveSpeed, longitudinal.frequency))
    if (wavelength === undefined) {
      throw new PhysicsOSError(
        'WAVE_SPEC_INCOMPLETE',
        'A longitudinal wave spec needs either wavelength or waveSpeed.',
      )
    }
    return {
      id,
      type: 'longitudinal',
      amplitude,
      frequency: quantity(longitudinal.frequency, 'Hz', 'frequency'),
      wavelength: quantity(wavelength, 'm', 'length'),
      mediumLength: quantity(longitudinal.mediumLength ?? wavelength * 3, 'm', 'length'),
    }
  }

  if (type === 'reflection_refraction') {
    const boundary = spec as ReflectionRefractionWaveSpec
    return {
      id,
      type: 'reflection_refraction',
      amplitude,
      frequency: quantity(boundary.frequency, 'Hz', 'frequency'),
      incidentSpeed: quantity(boundary.incidentSpeed, 'm/s', 'velocity'),
      transmittedWaveSpeed: quantity(boundary.transmittedSpeed, 'm/s', 'velocity'),
      incidentAngle: quantity(boundary.incidentAngle, 'deg', 'angle'),
    }
  }

  if (type === 'diffraction') {
    const diffraction = spec as DiffractionWaveSpec
    const wavelength = wavelengthOf({
      amplitude: diffraction.amplitude,
      frequency: diffraction.frequency,
      ...(diffraction.wavelength === undefined ? {} : { wavelength: diffraction.wavelength }),
      ...(diffraction.waveSpeed === undefined ? {} : { waveSpeed: diffraction.waveSpeed }),
    })
    return {
      id,
      type: 'diffraction',
      amplitude,
      frequency: quantity(diffraction.frequency, 'Hz', 'frequency'),
      wavelength: quantity(wavelength, 'm', 'length'),
      waveSpeed: quantity(wavelength * diffraction.frequency, 'm/s', 'velocity'),
      slitWidth: quantity(diffraction.slitWidth, 'm', 'length'),
      screenDistance: quantity(diffraction.screenDistance, 'm', 'length'),
      diffractionOrder: diffraction.order ?? 1,
    }
  }

  if (type === 'doppler') {
    const doppler = spec as DopplerWaveSpec
    return {
      id,
      type: 'doppler',
      amplitude,
      frequency: quantity(doppler.sourceFrequency, 'Hz', 'frequency'),
      waveSpeed: quantity(doppler.waveSpeed, 'm/s', 'velocity'),
      sourceSpeed: quantity(doppler.sourceSpeed, 'm/s', 'velocity'),
      observerSpeed: quantity(doppler.observerSpeed, 'm/s', 'velocity'),
      sourceDirection: doppler.sourceDirection,
      observerDirection: doppler.observerDirection,
    }
  }

  const rope = spec as TravellingWaveSpec
  const wavelength = wavelengthOf(rope)
  return {
    id,
    type: 'travelling',
    amplitude,
    frequency: quantity(rope.frequency, 'Hz', 'frequency'),
    wavelength: quantity(wavelength, 'm', 'length'),
    /* Three wavelengths of rope reads as a wave train rather than a single
       hump, which is what the textbook figure shows. */
    ropeLength: quantity(rope.ropeLength ?? wavelength * 3, 'm', 'length'),
  }
}

/**
 * Run window: two full periods of the slowest wave the junior lab uses. Long
 * enough to see the profile repeat, short enough that the student does not wait
 * for the point of the animation.
 */
const runSeconds = (bench: WaveBench): number => {
  const f = bench.frequency.value
  if (!Number.isFinite(f) || f <= 0) return 2
  return Math.min(10, Math.max(1, (2 / f) * 1))
}

/** Create a single-bench wave scene. */
export const createWaveScene = (input: WaveBenchSceneInput): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const sceneId = input.sceneId ?? 'wave-runtime-scene'
  const visibility = input.observableVisibility ?? {}
  const bench = toBench(input.bench)

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(sceneId),
    revision: input.revision ?? 0,
    dimension: '2d',
    coordinateSystem: defaultCoordinateSystem(),
    timeline: {
      currentTime: quantity(0, 's', 'time'),
      startTime: quantity(0, 's', 'time'),
      endTime: quantity(runSeconds(bench), 's', 'time'),
      state: 'idle',
      playbackRate: 1,
    },
    bodies: [],
    particles: [],
    fields: [],
    forces: [],
    regions: [],
    boundaries: [],
    constraints: [],
    circuits: [],
    opticalBenches: [],
    acousticBenches: [],
    fluidTanks: [],
    thermalBenches: [],
    leverBenches: [],
    waveBenches: [bench],
    measurementDefinitions: [],
    observableDefinitions: [
      {
        id: observableId('waveform'),
        type: 'geometry',
        targetId: bench.id,
        visible: visibility.waveform ?? true,
      },
      {
        id: observableId('wave_speed'),
        type: 'velocity',
        targetId: bench.id,
        visible: visibility.wave_speed ?? true,
      },
      ...(bench.type === 'interference'
        ? [
            {
              id: observableId('superposition'),
              type: 'annotation' as const,
              targetId: bench.id,
              visible: visibility.superposition ?? true,
            },
          ]
        : []),
      ...(bench.type === 'standing'
        ? [
            {
              id: observableId('nodes'),
              type: 'geometry' as const,
              targetId: bench.id,
              visible: visibility.nodes ?? true,
            },
          ]
        : []),
      ...(bench.type === 'longitudinal'
        ? [
            {
              id: observableId('longitudinal'),
              type: 'annotation' as const,
              targetId: bench.id,
              visible: visibility.longitudinal ?? true,
            },
          ]
        : []),
      ...(bench.type === 'reflection_refraction'
        ? [
            {
              id: observableId('boundary'),
              type: 'geometry' as const,
              targetId: bench.id,
              visible: visibility.boundary ?? true,
            },
          ]
        : []),
      ...(bench.type === 'diffraction'
        ? [
            {
              id: observableId('diffraction'),
              type: 'geometry' as const,
              targetId: bench.id,
              visible: visibility.diffraction ?? true,
            },
          ]
        : []),
      ...(bench.type === 'doppler'
        ? [
            {
              id: observableId('doppler'),
              type: 'annotation' as const,
              targetId: bench.id,
              visible: visibility.doppler ?? true,
            },
          ]
        : []),
    ],
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? '机械波实验台',
      description: input.description ?? 'Wave Engine · 波速 v = λf 与波的叠加',
    },
  }
}

/* ------------------------------------------------------------ accessors -- */

/**
 * Wave benches of a scene. Legacy-safe: scenes persisted before the wave slice
 * have no `waveBenches` collection, so readers fall back to `[]`.
 */
export const waveBenchesOf = (scene: PhysicsScene): WaveBench[] => scene.waveBenches ?? []

/** The single wave bench of a wave scene, if present. */
export const waveBenchOf = (scene: PhysicsScene): WaveBench | undefined => waveBenchesOf(scene)[0]

/** True when the scene is a pure single-bench wave scene. */
export const isWaveScene = (scene: PhysicsScene): boolean =>
  waveBenchesOf(scene).length === 1 &&
  scene.particles.length === 0 &&
  scene.bodies.length === 0 &&
  scene.fields.length === 0 &&
  scene.circuits.length === 0 &&
  (scene.opticalBenches ?? []).length === 0 &&
  (scene.acousticBenches ?? []).length === 0 &&
  (scene.fluidTanks ?? []).length === 0 &&
  (scene.thermalBenches ?? []).length === 0 &&
  (scene.leverBenches ?? []).length === 0 &&
  (scene.inductionBenches ?? []).length === 0 &&
  (scene.cyclotronBenches ?? []).length === 0 &&
  (scene.modernPhysicsBenches ?? []).length === 0

/** The wave sub-model type of the bench. */
export const waveTypeOf = (bench: WaveBench): WaveBenchType => bench.type
