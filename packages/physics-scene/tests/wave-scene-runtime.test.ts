import { describe, expect, it } from 'vitest'
import { quantity } from '@physicsos/physics-units'

import {
  SceneRuntime,
  createSceneCommand,
  createStandingWaveScene,
  createTravellingWaveScene,
  createWaveInterferenceScene,
  createWaveScene,
  isWaveScene,
  validateScene,
  waveBenchOf,
  waveBenchesOf,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '../src/index.ts'

const cm = (value: number) => quantity(value, 'cm', 'length')
const m = (value: number) => quantity(value, 'm', 'length')
const hz = (value: number) => quantity(value, 'Hz', 'frequency')
const mps = (value: number) => quantity(value, 'm/s', 'velocity')

const execute = <T extends SceneCommandType>(
  runtime: SceneRuntime,
  type: T,
  payload: SceneCommandPayloadMap[T],
) => {
  const scene = runtime.getScene()
  /* The generic envelope does not narrow back to the distributive union. */
  return runtime.execute(
    createSceneCommand({
      commandId: `cmd-${type}-${scene.revision}`,
      sceneId: String(scene.id),
      expectedRevision: scene.revision,
      type,
      payload,
      traceId: `trace-${type}`,
    }) as SceneCommand,
  )
}

const rejected = <T extends { ok: boolean }>(result: T): Exclude<T, { ok: true }> => {
  if (result.ok) throw new Error('Expected command rejection.')
  return result as Exclude<T, { ok: true }>
}

describe('createWaveScene', () => {
  it('builds a pure travelling-wave scene that passes validation', () => {
    const scene = createTravellingWaveScene()
    expect(isWaveScene(scene)).toBe(true)
    expect(validateScene(scene).status).toBe('passed')
    const bench = waveBenchOf(scene)!
    expect(bench.type).toBe('travelling')
    expect(bench.amplitude.unit).toBe('cm')
    expect(bench.amplitude.value).toBe(5)
    expect(bench.wavelength?.value).toBe(0.4)
    expect(bench.frequency.value).toBe(5)
    expect(bench.ropeLength?.value).toBe(1.2)
    /* Two periods of a 5 Hz wave is 0.4 s; the window floors at 1 s so the
       student sees the profile repeat rather than a single flicker. */
    expect(scene.timeline.endTime?.value).toBe(1)
    expect(scene.observableDefinitions.map((entry) => String(entry.id))).toEqual([
      'observable-wave-waveform',
      'observable-wave-wave_speed',
    ])
  })

  it('derives the standing-wave frequency from L, n and v and exposes the nodes observable', () => {
    const scene = createStandingWaveScene()
    expect(validateScene(scene).status).toBe('passed')
    const bench = waveBenchOf(scene)!
    expect(bench.type).toBe('standing')
    /* f_n = n·v/(2L) = 2 × 40 / 2 = 40 Hz */
    expect(bench.frequency.value).toBeCloseTo(40, 9)
    expect(bench.wavelength).toBeUndefined()
    expect(scene.observableDefinitions.map((entry) => String(entry.id))).toContain(
      'observable-wave-nodes',
    )
    expect(scene.observableDefinitions.map((entry) => String(entry.id))).not.toContain(
      'observable-wave-superposition',
    )
  })

  it('exposes the superposition observable only on the interference rig', () => {
    const scene = createWaveInterferenceScene()
    expect(validateScene(scene).status).toBe('passed')
    const bench = waveBenchOf(scene)!
    expect(bench.type).toBe('interference')
    expect(bench.pathOne?.value).toBe(1.0)
    expect(bench.pathTwo?.value).toBe(1.4)
    const ids = scene.observableDefinitions.map((entry) => String(entry.id))
    expect(ids).toContain('observable-wave-superposition')
    expect(ids).not.toContain('observable-wave-nodes')
    /* Every wave observable uses the shared vocabulary; no bespoke types. */
    for (const observable of scene.observableDefinitions) {
      expect(['geometry', 'velocity', 'annotation']).toContain(observable.type)
    }
  })

  it('defaults the rope to three wavelengths when no length is given', () => {
    const scene = createWaveScene({
      bench: { type: 'travelling', amplitude: 2, wavelength: 0.5, frequency: 4 },
    })
    expect(waveBenchOf(scene)!.ropeLength?.value).toBeCloseTo(1.5, 9)
  })

  it('treats legacy scenes without the collection as having no benches', () => {
    const scene = createTravellingWaveScene()
    const legacy = { ...scene } as Partial<PhysicsScene>
    delete legacy.waveBenches
    expect(waveBenchesOf(legacy as PhysicsScene)).toEqual([])
    expect(isWaveScene(legacy as PhysicsScene)).toBe(false)
  })

  it('rejects non-positive magnitudes and a fractional harmonic in validation', () => {
    const flat = createTravellingWaveScene({ amplitude: 0 })
    expect(validateScene(flat).status).toBe('failed')

    const negativeWavelength = createTravellingWaveScene({ wavelength: -0.4 })
    expect(validateScene(negativeWavelength).status).toBe('failed')

    const fractionalHarmonic = createStandingWaveScene({ harmonic: 1.5 })
    expect(validateScene(fractionalHarmonic).status).toBe('failed')
  })
})

describe('wave scene commands', () => {
  it('changes the amplitude on any rig and records WaveAmplitudeChanged', () => {
    const runtime = new SceneRuntime(createTravellingWaveScene())
    const result = execute(runtime, 'SetWaveAmplitude', {
      benchId: 'wave-bench-1',
      amplitude: cm(8),
    })
    expect(result.ok).toBe(true)
    expect(waveBenchOf(runtime.getScene())!.amplitude.value).toBe(8)
    expect(runtime.getScene().revision).toBe(1)
    expect(runtime.getEvents()[0]?.type).toBe('WaveAmplitudeChanged')

    const before = runtime.getScene()
    const flat = rejected(
      execute(runtime, 'SetWaveAmplitude', { benchId: 'wave-bench-1', amplitude: cm(0) }),
    )
    expect(flat.error.code).toBe('INVALID_WAVE_AMPLITUDE')
    expect(runtime.getScene()).toEqual(before)
  })

  it('changes the frequency on a travelling rig — the medium keeps v, so λ = v/f follows', () => {
    const rope = new SceneRuntime(createTravellingWaveScene())
    const ok = execute(rope, 'SetWaveFrequency', { benchId: 'wave-bench-1', frequency: hz(8) })
    expect(ok.ok).toBe(true)
    const bench = waveBenchOf(rope.getScene())!
    expect(bench.frequency.value).toBe(8)
    /* v = λf = 0.4 × 5 = 2 m/s stays; λ = 2 / 8 = 0.25 m */
    expect(bench.wavelength?.value).toBeCloseTo(0.25, 9)
    expect(rope.getEvents().at(-1)?.type).toBe('WaveFrequencyChanged')

    const zero = rejected(
      execute(rope, 'SetWaveFrequency', { benchId: 'wave-bench-1', frequency: hz(0) }),
    )
    expect(zero.error.code).toBe('INVALID_WAVE_FREQUENCY')

    /* A clamped string only resonates at f_n = n·v/(2L); the frequency is a
       consequence of the geometry, never an input. */
    const string = new SceneRuntime(createStandingWaveScene())
    const wrong = rejected(
      execute(string, 'SetWaveFrequency', { benchId: 'wave-bench-1', frequency: hz(50) }),
    )
    expect(wrong.error.code).toBe('WAVE_WRONG_SUBMODEL')
    expect(waveBenchOf(string.getScene())!.frequency.value).toBeCloseTo(40, 9)
  })

  it('re-derives the standing-wave frequency when the wave speed changes', () => {
    const runtime = new SceneRuntime(createStandingWaveScene())
    const ok = execute(runtime, 'SetWaveSpeed', { benchId: 'wave-bench-1', speed: mps(80) })
    expect(ok.ok).toBe(true)
    const bench = waveBenchOf(runtime.getScene())!
    expect(bench.waveSpeed?.value).toBe(80)
    /* f_2 = 2 × 80 / (2 × 1.0) = 80 Hz */
    expect(bench.frequency.value).toBeCloseTo(80, 9)
    expect(runtime.getEvents().at(-1)?.type).toBe('WaveSpeedChanged')
    expect(validateScene(runtime.getScene()).status).toBe('passed')

    const stopped = rejected(
      execute(runtime, 'SetWaveSpeed', { benchId: 'wave-bench-1', speed: mps(0) }),
    )
    expect(stopped.error.code).toBe('INVALID_WAVE_SPEED')
  })

  it('re-derives λ = v/f when the medium speed changes on a rope or in a ripple tank', () => {
    /* A new medium at the same 5 Hz source: v = 4 m/s → λ = 0.8 m. */
    const rope = new SceneRuntime(createTravellingWaveScene())
    const ok = execute(rope, 'SetWaveSpeed', { benchId: 'wave-bench-1', speed: mps(4) })
    expect(ok.ok).toBe(true)
    const bench = waveBenchOf(rope.getScene())!
    expect(bench.frequency.value).toBe(5)
    expect(bench.wavelength?.value).toBeCloseTo(0.8, 9)
    expect(bench.waveSpeed).toBeUndefined()
    expect(rope.getEvents().at(-1)?.type).toBe('WaveSpeedChanged')
    expect(validateScene(rope.getScene()).status).toBe('passed')

    const pair = new SceneRuntime(createWaveInterferenceScene())
    execute(pair, 'SetWaveSpeed', { benchId: 'wave-bench-1', speed: mps(1) })
    /* 10 Hz sources in a slower tank: λ = 1 / 10 = 0.1 m */
    expect(waveBenchOf(pair.getScene())!.wavelength?.value).toBeCloseTo(0.1, 9)
  })

  it('re-derives the standing-wave frequency when the string length changes', () => {
    const runtime = new SceneRuntime(createStandingWaveScene())
    const ok = execute(runtime, 'SetWaveStringLength', {
      benchId: 'wave-bench-1',
      stringLength: m(2),
    })
    expect(ok.ok).toBe(true)
    const bench = waveBenchOf(runtime.getScene())!
    expect(bench.stringLength?.value).toBe(2)
    /* f_2 = 2 × 40 / (2 × 2.0) = 20 Hz */
    expect(bench.frequency.value).toBeCloseTo(20, 9)
    expect(runtime.getEvents().at(-1)?.type).toBe('WaveStringLengthChanged')

    const collapsed = rejected(
      execute(runtime, 'SetWaveStringLength', { benchId: 'wave-bench-1', stringLength: m(0) }),
    )
    expect(collapsed.error.code).toBe('INVALID_WAVE_STRING_LENGTH')

    const pair = new SceneRuntime(createWaveInterferenceScene())
    const wrong = rejected(
      execute(pair, 'SetWaveStringLength', { benchId: 'wave-bench-1', stringLength: m(1) }),
    )
    expect(wrong.error.code).toBe('WAVE_WRONG_SUBMODEL')
  })

  it('re-derives the standing-wave frequency when the harmonic changes and insists on n ≥ 1', () => {
    const runtime = new SceneRuntime(createStandingWaveScene())
    const ok = execute(runtime, 'SetWaveHarmonic', { benchId: 'wave-bench-1', harmonic: 3 })
    expect(ok.ok).toBe(true)
    const bench = waveBenchOf(runtime.getScene())!
    expect(bench.harmonic).toBe(3)
    /* f_3 = 3 × 40 / (2 × 1.0) = 60 Hz */
    expect(bench.frequency.value).toBeCloseTo(60, 9)
    expect(runtime.getEvents().at(-1)?.type).toBe('WaveHarmonicChanged')

    const before = runtime.getScene()
    expect(
      rejected(execute(runtime, 'SetWaveHarmonic', { benchId: 'wave-bench-1', harmonic: 0 }))
        .error.code,
    ).toBe('INVALID_WAVE_HARMONIC')
    expect(
      rejected(execute(runtime, 'SetWaveHarmonic', { benchId: 'wave-bench-1', harmonic: 1.5 }))
        .error.code,
    ).toBe('INVALID_WAVE_HARMONIC')
    expect(runtime.getScene()).toEqual(before)

    const rope = new SceneRuntime(createTravellingWaveScene())
    const wrong = rejected(
      execute(rope, 'SetWaveHarmonic', { benchId: 'wave-bench-1', harmonic: 2 }),
    )
    expect(wrong.error.code).toBe('WAVE_WRONG_SUBMODEL')
  })

  it('sets the interference path difference by moving the second path', () => {
    const runtime = new SceneRuntime(createWaveInterferenceScene())
    const ok = execute(runtime, 'SetWavePathDifference', {
      benchId: 'wave-bench-1',
      pathDifference: m(0.1),
    })
    expect(ok.ok).toBe(true)
    const bench = waveBenchOf(runtime.getScene())!
    /* Source 1 stays put; Δ = r₂ − r₁ exactly. Δ = λ/2 here — a destructive
       point the engine will report as such. */
    expect(bench.pathOne?.value).toBe(1.0)
    expect(bench.pathTwo?.value).toBeCloseTo(1.1, 9)
    expect(runtime.getEvents().at(-1)?.type).toBe('WavePathDifferenceChanged')
    expect(validateScene(runtime.getScene()).status).toBe('passed')

    const zero = execute(runtime, 'SetWavePathDifference', {
      benchId: 'wave-bench-1',
      pathDifference: m(0),
    })
    expect(zero.ok).toBe(true)
    expect(waveBenchOf(runtime.getScene())!.pathTwo?.value).toBeCloseTo(1.0, 9)

    const negative = rejected(
      execute(runtime, 'SetWavePathDifference', {
        benchId: 'wave-bench-1',
        pathDifference: m(-0.2),
      }),
    )
    expect(negative.error.code).toBe('INVALID_WAVE_PATH_DIFFERENCE')

    /* Δ > d = 0.8 m: no point in the plane is that much farther from S₁ than S₂. */
    const before = runtime.getScene()
    const unreachable = rejected(
      execute(runtime, 'SetWavePathDifference', { benchId: 'wave-bench-1', pathDifference: m(1.5) }),
    )
    expect(unreachable.error.code).toBe('WAVE_PATH_DIFFERENCE_UNREACHABLE')
    expect(runtime.getScene()).toEqual(before)

    const rope = new SceneRuntime(createTravellingWaveScene())
    const wrong = rejected(
      execute(rope, 'SetWavePathDifference', { benchId: 'wave-bench-1', pathDifference: m(0.2) }),
    )
    expect(wrong.error.code).toBe('WAVE_WRONG_SUBMODEL')
  })

  it('reports a missing bench as not-found without writes', () => {
    const runtime = new SceneRuntime(createTravellingWaveScene())
    const before = runtime.getScene()
    const missing = rejected(
      execute(runtime, 'SetWaveAmplitude', { benchId: 'ghost-bench', amplitude: cm(1) }),
    )
    expect(missing.error.code).toBe('WAVE_BENCH_NOT_FOUND')
    expect(runtime.getScene()).toEqual(before)
    expect(runtime.getEvents()).toEqual([])
  })
})
