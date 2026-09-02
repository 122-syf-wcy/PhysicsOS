import type { IsoDateTime } from '@physicsos/shared'

import type { PhysicsScene } from '../scene.ts'
import { createWaveScene } from './wave-scene.ts'

/**
 * Wave experiment templates (初中/高中机械波).
 *
 * Same shape as the optics / acoustics / induction templates: each creator
 * returns a complete PhysicsScene through the wave bench factory with
 * textbook-friendly defaults, so the Lab, tests and the agent all start from
 * identical worlds.
 */

export interface TravellingWaveSceneInput {
  readonly sceneId?: string
  /** Amplitude in centimetres (> 0). */
  readonly amplitude?: number
  /** Wavelength in metres (> 0); defaults to 0.4 m unless `waveSpeed` is given instead. */
  readonly wavelength?: number
  /** Medium wave speed in m/s (> 0); an alternative to `wavelength` (λ = v/f). */
  readonly waveSpeed?: number
  /** Frequency in hertz (> 0). */
  readonly frequency?: number
  /** Length of rope drawn in metres (> 0). */
  readonly ropeLength?: number
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

/**
 * 绳上的简谐横波 — a 5 cm wave of wavelength 0.4 m driven at 5 Hz along a 1.2 m
 * rope. The wave speed is v = λf = 0.4 × 5 = 2 m/s and the period is
 * T = 1/f = 0.2 s: the pair of numbers the 初中 textbook builds v = λf from.
 */
export const createTravellingWaveScene = (
  input: TravellingWaveSceneInput = {},
): PhysicsScene =>
  createWaveScene({
    sceneId: input.sceneId ?? 'lab-wave-travelling',
    ...(input.now === undefined ? {} : { now: input.now }),
    bench: {
      type: 'travelling',
      amplitude: input.amplitude ?? 5,
      ...(input.waveSpeed !== undefined && input.wavelength === undefined
        ? { waveSpeed: input.waveSpeed }
        : { wavelength: input.wavelength ?? 0.4 }),
      frequency: input.frequency ?? 5,
      ...(input.ropeLength === undefined && input.waveSpeed !== undefined && input.wavelength === undefined
        ? {}
        : { ropeLength: input.ropeLength ?? 1.2 }),
    },
    title: input.title ?? '绳上的简谐横波',
    description: input.description ?? 'Wave Engine · 波速 v = λf 与波形传播 y(x,t)',
  })

export interface InterferenceWaveSceneInput {
  readonly sceneId?: string
  /** Amplitude of each source in centimetres (> 0). */
  readonly amplitude?: number
  /** Wavelength in metres (> 0); defaults to 0.2 m unless `waveSpeed` is given instead. */
  readonly wavelength?: number
  /** Medium wave speed in m/s (> 0); an alternative to `wavelength` (λ = v/f). */
  readonly waveSpeed?: number
  /** Frequency in hertz (> 0). */
  readonly frequency?: number
  /** Separation between the two coherent sources in metres (> 0). */
  readonly sourceSeparation?: number
  /** Distance from source 1 to the observation point in metres (> 0). */
  readonly pathOne?: number
  /** Distance from source 2 to the observation point in metres (> 0). */
  readonly pathTwo?: number
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

/**
 * 双源干涉 — two coherent 3 cm sources 0.8 m apart, wavelength 0.2 m, driven at
 * 10 Hz. The observation point sits 1.0 m from one source and 1.4 m from the
 * other: the path difference is 0.4 m = 2λ, an exact whole number of
 * wavelengths, so the point is a constructive maximum with amplitude 6 cm.
 */
export const createWaveInterferenceScene = (
  input: InterferenceWaveSceneInput = {},
): PhysicsScene =>
  createWaveScene({
    sceneId: input.sceneId ?? 'lab-wave-interference',
    ...(input.now === undefined ? {} : { now: input.now }),
    bench: {
      type: 'interference',
      amplitude: input.amplitude ?? 3,
      ...(input.waveSpeed !== undefined && input.wavelength === undefined
        ? { waveSpeed: input.waveSpeed }
        : { wavelength: input.wavelength ?? 0.2 }),
      frequency: input.frequency ?? 10,
      sourceSeparation: input.sourceSeparation ?? 0.8,
      pathOne: input.pathOne ?? 1.0,
      pathTwo: input.pathTwo ?? 1.4,
    },
    title: input.title ?? '双源干涉与波的叠加',
    description: input.description ?? 'Wave Engine · 路程差 Δ = nλ 决定加强或减弱',
  })

export interface StandingWaveSceneInput {
  readonly sceneId?: string
  /** Amplitude in centimetres (> 0). */
  readonly amplitude?: number
  /** Length of the clamped string in metres (> 0). */
  readonly stringLength?: number
  /** Harmonic number n ≥ 1 (integral). */
  readonly harmonic?: number
  /** Wave speed on the string in m/s (> 0); defaults to 40 m/s unless `frequency` is given instead. */
  readonly waveSpeed?: number
  /** Frequency of the named harmonic in hertz (> 0); an alternative to `waveSpeed` (v = 2L·f/n). */
  readonly frequency?: number
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

/**
 * 两端固定的弦驻波 — a 1.0 m string carrying waves at 40 m/s, driven into its
 * 2nd harmonic. L = n·λ/2 gives λ = 1.0 m and f₂ = n·v/(2L) = 40 Hz, with
 * nodes at 0, 0.5 and 1.0 m — the harmonic series every 高中 textbook tabulates.
 */
export const createStandingWaveScene = (
  input: StandingWaveSceneInput = {},
): PhysicsScene =>
  createWaveScene({
    sceneId: input.sceneId ?? 'lab-wave-standing',
    ...(input.now === undefined ? {} : { now: input.now }),
    bench: {
      type: 'standing',
      amplitude: input.amplitude ?? 4,
      stringLength: input.stringLength ?? 1.0,
      harmonic: input.harmonic ?? 2,
      ...(input.frequency !== undefined && input.waveSpeed === undefined
        ? { frequency: input.frequency }
        : { waveSpeed: input.waveSpeed ?? 40 }),
    },
    title: input.title ?? '两端固定的弦驻波',
    description: input.description ?? 'Wave Engine · L = nλ/2 与波节波腹',
  })
