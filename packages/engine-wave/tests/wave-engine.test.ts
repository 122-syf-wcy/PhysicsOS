import { describe, expect, it } from 'vitest'

import { derivedScalar, isScalarQuantity } from '@physicsos/physics-core'
import {
  SceneRuntime,
  createBarMotionScene,
  createSceneCommand,
  createStandingWaveScene,
  createTravellingWaveScene,
  createWaveInterferenceScene,
  createWaveScene,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'

import {
  STANDING_WAVE_MODEL,
  TRAVELLING_WAVE_MODEL,
  WAVE_ENGINE_ID,
  WAVE_INTERFERENCE_MODEL,
  WAVE_PROFILE_SAMPLES,
  createWaveSimulationRequest,
  interferenceVerdictOf,
  nodePositionsOf,
  resolveWaveModel,
  waveEngine,
  waveMarkerId,
  waveNodeId,
  wavePointId,
  waveProfileId,
} from '../src/index.ts'

/* ------------------------------------------------------------ helpers -- */

const execute = <T extends SceneCommandType>(
  runtime: SceneRuntime,
  type: T,
  payload: SceneCommandPayloadMap[T],
) => {
  const scene = runtime.getScene()
  return runtime.execute(
    createSceneCommand<T>({
      commandId: `cmd-${type}-${scene.revision}`,
      sceneId: String(scene.id),
      expectedRevision: scene.revision,
      type,
      payload,
      traceId: `trace-${type}`,
    }) as SceneCommand,
  )
}

const simulated = (scene: PhysicsScene) =>
  waveEngine.simulate(scene, createWaveSimulationRequest(scene, 'sim-wave', 'trace-wave'))

const scalar = (result: ReturnType<typeof simulated>, key: string): number =>
  derivedScalar(result.derivedQuantities, key).value

const at = (scene: PhysicsScene, t: number) => waveEngine.stateAt(scene, quantity(t, 's', 'time'))

const positionOf = (scene: PhysicsScene, t: number, id: string) => {
  const position = at(scene, t).objects.find((entry) => entry.id === id)?.position?.vector
  if (position === undefined) throw new Error(`object ${id} missing at t = ${t}`)
  return position
}

const checkOf = (result: ReturnType<typeof simulated>, id: string) => {
  const found = result.verification.checks.find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`verification check ${id} missing`)
  return found
}

/* --------------------------------------------------------- travelling -- */

describe('Wave Engine · travelling_wave', () => {
  /* Default: A = 5 cm, λ = 0.4 m, f = 5 Hz, rope 1.2 m → v = λf = 2 m/s, T = 0.2 s. */

  it('1. resolves A, λ, f into canonical SI and derives v = λf', () => {
    const model = resolveWaveModel(createTravellingWaveScene())
    expect(model.subModel).toBe('travelling_wave')
    expect(model.amplitude).toBeCloseTo(0.05, 12) /* 5 cm → 0.05 m */
    expect(model.wavelength).toBeCloseTo(0.4, 12)
    expect(model.frequency).toBeCloseTo(5, 12)
    expect(model.waveSpeed).toBeCloseTo(2, 12)
    expect(model.ropeLength).toBeCloseTo(1.2, 12)
  })

  it('2. publishes v = 2 m/s and T = 0.2 s with the right dimensions', () => {
    const result = simulated(createTravellingWaveScene())
    expect(scalar(result, 'wave_speed')).toBeCloseTo(2, 12)
    expect(scalar(result, 'period')).toBeCloseTo(0.2, 12)
    const speed = result.derivedQuantities.find((entry) => entry.key === 'wave_speed')
    expect(speed !== undefined && isScalarQuantity(speed.value)).toBe(true)
    if (speed !== undefined && isScalarQuantity(speed.value)) {
      expect(speed.value.dimension).toBe('velocity')
      expect(speed.value.unit).toBe('m/s')
    }
  })

  it('3. samples the rope profile at t = 0 as y = A·sin(2πx/λ)', () => {
    const scene = createTravellingWaveScene()
    const quarter = positionOf(scene, 0, waveProfileId('wave-bench-1', WAVE_PROFILE_SAMPLES / 4))
    /* x = 0.3 m = 3λ/4 → sin(3π/2) = −1 → y = −A */
    expect(quarter.x).toBeCloseTo(0.3, 12)
    expect(quarter.y).toBeCloseTo(-0.05, 12)
    const start = positionOf(scene, 0, waveProfileId('wave-bench-1', 0))
    expect(start.y).toBeCloseTo(0, 12)
  })

  it('4. repeats the profile after one period and shifts it by λ/4 after T/4', () => {
    const scene = createTravellingWaveScene()
    const T = 0.2
    for (const index of [5, 17, 29, 41]) {
      const now = positionOf(scene, 0.07, waveProfileId('wave-bench-1', index))
      const later = positionOf(scene, 0.07 + T, waveProfileId('wave-bench-1', index))
      expect(later.y).toBeCloseTo(now.y, 9)
    }
    /* After T/4 the crest has moved v·T/4 = λ/4 = 0.1 m = 4 samples downstream. */
    const before = positionOf(scene, 0, waveProfileId('wave-bench-1', 12))
    const shifted = positionOf(scene, T / 4, waveProfileId('wave-bench-1', 16))
    expect(shifted.y).toBeCloseTo(before.y, 9)
  })

  it('5. keeps the marked particle at fixed x while it oscillates transversely', () => {
    const scene = createTravellingWaveScene()
    const xs = new Set<number>()
    let maxY = 0
    for (const t of [0, 0.05, 0.1, 0.15, 0.2, 0.33]) {
      const marker = positionOf(scene, t, waveMarkerId('wave-bench-1'))
      xs.add(Number(marker.x.toFixed(12)))
      maxY = Math.max(maxY, Math.abs(marker.y))
    }
    expect(xs.size).toBe(1)
    expect([...xs][0]).toBeCloseTo(0.3, 12)
    expect(maxY).toBeLessThanOrEqual(0.05 + 1e-12)
    const velocity = at(scene, 0.1).objects.find((entry) => entry.id === waveMarkerId('wave-bench-1'))
      ?.velocity?.vector
    expect(velocity?.x).toBe(0)
  })

  it('6. gives the marked particle transverse speed 2πfA at the equilibrium crossing', () => {
    const scene = createTravellingWaveScene()
    /* At x = 0.3 m, y = A·sin(2π(0.75 − 5t)); y = 0 when 5t = 0.75 → t = 0.15 s. */
    const marker = at(scene, 0.15).objects.find((entry) => entry.id === waveMarkerId('wave-bench-1'))
    expect(marker?.position?.vector.y).toBeCloseTo(0, 9)
    expect(Math.abs(marker?.velocity?.vector.y ?? 0)).toBeCloseTo(2 * Math.PI * 5 * 0.05, 9)
  })

  it('7. doubles v when λ doubles at fixed f, and T halves when f doubles', () => {
    const base = simulated(createTravellingWaveScene())
    const longer = simulated(createTravellingWaveScene({ wavelength: 0.8 }))
    expect(scalar(longer, 'wave_speed')).toBeCloseTo(scalar(base, 'wave_speed') * 2, 12)
    const faster = simulated(createTravellingWaveScene({ frequency: 10 }))
    expect(scalar(faster, 'period')).toBeCloseTo(scalar(base, 'period') / 2, 12)
  })

  it('8. passes the four travelling-wave checks', () => {
    const result = simulated(createTravellingWaveScene())
    expect(result.verification.status).toBe('passed')
    for (const id of [
      'wave_speed_relation',
      'period_frequency_reciprocal',
      'profile_translation',
      'particle_no_net_transport',
    ]) {
      expect(checkOf(result, id).passed).toBe(true)
    }
    expect(result.states).toHaveLength(61)
    expect(result.metadata.deterministic).toBe(true)
  })
})

/* ------------------------------------------------------- interference -- */

describe('Wave Engine · wave_interference', () => {
  /* Default: A = 3 cm, λ = 0.2 m, f = 10 Hz, d = 0.8 m, r₁ = 1.0 m, r₂ = 1.4 m
     → Δ = 0.4 m = 2λ → constructive, A_P = 2A = 6 cm. */

  it('9. finds Δ = 2λ constructive with resultant 2A on the defaults', () => {
    const scene = createWaveInterferenceScene()
    const model = resolveWaveModel(scene)
    expect(model.subModel).toBe('wave_interference')
    expect(interferenceVerdictOf(model)).toBe('constructive')
    const result = simulated(scene)
    expect(scalar(result, 'path_difference')).toBeCloseTo(0.4, 12)
    expect(scalar(result, 'path_difference_ratio')).toBeCloseTo(2, 12)
    expect(scalar(result, 'resultant_amplitude')).toBeCloseTo(0.06, 12)
    expect(scalar(result, 'interference_type')).toBe(1)
  })

  it('10. turns destructive with zero resultant when Δ = λ/2', () => {
    const scene = createWaveInterferenceScene({ pathTwo: 1.1 })
    expect(interferenceVerdictOf(resolveWaveModel(scene))).toBe('destructive')
    const result = simulated(scene)
    expect(scalar(result, 'resultant_amplitude')).toBeCloseTo(0, 12)
    expect(scalar(result, 'interference_type')).toBe(-1)
    /* The summed displacement at P vanishes at every sampled time. */
    const displacements = result.states.map((state) => {
      const value = state.objects.find((entry) => entry.id === wavePointId('wave-bench-1'))?.values?.[
        'displacement'
      ]
      return value !== undefined && 'value' in value ? value.value : Number.NaN
    })
    expect(displacements.every((value) => Math.abs(value) < 1e-12)).toBe(true)
  })

  it('11. reports a partial sum strictly between 0 and 2A off the special ratios', () => {
    const scene = createWaveInterferenceScene({ pathTwo: 1.05 }) /* Δ = 0.05 = λ/4 */
    const result = simulated(scene)
    expect(scalar(result, 'interference_type')).toBe(0)
    /* A_P = |2A·cos(π/4)| = 2 × 0.03 × √2/2 */
    expect(scalar(result, 'resultant_amplitude')).toBeCloseTo(0.06 * Math.SQRT1_2, 12)
    expect(checkOf(result, 'path_difference_rule').passed).toBe(true)
  })

  it('12. places the sources ±d/2 apart and the point at the stated path lengths', () => {
    const scene = createWaveInterferenceScene()
    const s1 = positionOf(scene, 0, 'wave-bench-1.source-1')
    const s2 = positionOf(scene, 0, 'wave-bench-1.source-2')
    const p = positionOf(scene, 0, wavePointId('wave-bench-1'))
    expect(s1.x).toBeCloseTo(-0.4, 12)
    expect(s2.x).toBeCloseTo(0.4, 12)
    expect(Math.hypot(p.x - s1.x, p.y - s1.y)).toBeCloseTo(1.0, 9)
    expect(Math.hypot(p.x - s2.x, p.y - s2.y)).toBeCloseTo(1.4, 9)
  })

  it('13. bounds the summed displacement by the resultant amplitude in every state', () => {
    const result = simulated(createWaveInterferenceScene({ pathTwo: 1.05 }))
    expect(checkOf(result, 'superposition_bounds').passed).toBe(true)
    expect(checkOf(result, 'interference_geometry').passed).toBe(true)
    expect(result.verification.status).toBe('passed')
  })

  it('14. refuses a path difference no point in the plane can have', () => {
    const scene = createWaveInterferenceScene({ pathTwo: 2.0 }) /* Δ = 1.0 > d = 0.8 */
    const support = waveEngine.canHandle(scene)
    expect(support.supported).toBe(false)
    if (!support.supported) {
      expect(support.failedConditions[0]?.condition).toBe('interference_geometry')
    }
  })
})

/* ----------------------------------------------------------- standing -- */

describe('Wave Engine · standing_wave', () => {
  /* Default: A = 4 cm, L = 1.0 m, n = 2, v = 40 m/s → λ = 2L/n = 1.0 m,
     f₂ = n·v/(2L) = 40 Hz, f₁ = 20 Hz, nodes at 0 / 0.5 / 1.0 m. */

  it('15. derives λ = 2L/n and f_n = n·v/(2L) from the geometry', () => {
    const model = resolveWaveModel(createStandingWaveScene())
    expect(model.subModel).toBe('standing_wave')
    expect(model.wavelength).toBeCloseTo(1.0, 12)
    expect(model.frequency).toBeCloseTo(40, 12)
    expect(model.waveSpeed).toBeCloseTo(40, 12)
    const result = simulated(createStandingWaveScene())
    expect(scalar(result, 'fundamental_frequency')).toBeCloseTo(20, 12)
    expect(scalar(result, 'node_count')).toBe(3)
    expect(scalar(result, 'antinode_count')).toBe(2)
  })

  it('16. pins the nodes at m·L/n and keeps them still at every time', () => {
    const scene = createStandingWaveScene()
    expect(nodePositionsOf(resolveWaveModel(scene))).toEqual([0, 0.5, 1.0])
    for (const t of [0, 0.003, 0.0125, 0.02]) {
      for (const index of [0, 1, 2]) {
        expect(positionOf(scene, t, waveNodeId('wave-bench-1', index)).y).toBe(0)
      }
      /* The clamped ends of the sampled profile are nodes too. */
      expect(Math.abs(positionOf(scene, t, waveProfileId('wave-bench-1', 0)).y)).toBeLessThan(1e-12)
      expect(
        Math.abs(positionOf(scene, t, waveProfileId('wave-bench-1', WAVE_PROFILE_SAMPLES)).y),
      ).toBeLessThan(1e-12)
    }
  })

  it('17. swings the antinodes between +A and −A over half a period', () => {
    const scene = createStandingWaveScene()
    const T = 1 / 40
    const first = positionOf(scene, 0, 'wave-bench-1.antinode.0')
    const second = positionOf(scene, 0, 'wave-bench-1.antinode.1')
    expect(first.x).toBeCloseTo(0.25, 12)
    expect(second.x).toBeCloseTo(0.75, 12)
    /* Adjacent antinodes are in anti-phase. */
    expect(first.y).toBeCloseTo(0.04, 12)
    expect(second.y).toBeCloseTo(-0.04, 12)
    expect(positionOf(scene, T / 2, 'wave-bench-1.antinode.0').y).toBeCloseTo(-0.04, 12)
    expect(positionOf(scene, T / 4, 'wave-bench-1.antinode.0').y).toBeCloseTo(0, 9)
  })

  it('18. raises f_n to 60 Hz for the third harmonic and adds a node', () => {
    const scene = createStandingWaveScene({ harmonic: 3 })
    const result = simulated(scene)
    expect(scalar(result, 'frequency')).toBeCloseTo(60, 12)
    expect(scalar(result, 'wavelength')).toBeCloseTo(2 / 3, 12)
    expect(scalar(result, 'node_count')).toBe(4)
    expect(nodePositionsOf(resolveWaveModel(scene)).map((x) => Number(x.toFixed(9)))).toEqual([
      0, 0.333333333, 0.666666667, 1,
    ])
  })

  it('19. passes the standing-wave checks', () => {
    const result = simulated(createStandingWaveScene())
    expect(result.verification.status).toBe('passed')
    for (const id of [
      'wave_speed_relation',
      'harmonic_relation',
      'frequency_harmonic',
      'boundary_nodes',
      'node_positions_fixed',
    ]) {
      expect(checkOf(result, id).passed).toBe(true)
    }
  })
})

/* --------------------------------------------------------- contract -- */

describe('Wave Engine · contract', () => {
  it('20. supports the three rigs under their frozen model ids', () => {
    const rope = waveEngine.canHandle(createTravellingWaveScene())
    expect(rope.supported).toBe(true)
    if (rope.supported) expect(rope.modelId).toBe(TRAVELLING_WAVE_MODEL)
    const pair = waveEngine.canHandle(createWaveInterferenceScene())
    if (pair.supported) expect(pair.modelId).toBe(WAVE_INTERFERENCE_MODEL)
    const string = waveEngine.canHandle(createStandingWaveScene())
    if (string.supported) expect(string.modelId).toBe(STANDING_WAVE_MODEL)
    expect(waveEngine.engineId).toBe(WAVE_ENGINE_ID)
    expect(waveEngine.domain).toBe('wave')
  })

  it('21. rejects scenes that are not pure single-bench wave scenes', () => {
    const induction = waveEngine.canHandle(createBarMotionScene())
    expect(induction.supported).toBe(false)
    if (!induction.supported) {
      expect(induction.failedConditions[0]?.condition).toBe('single_wave_bench')
    }

    const mixed = createTravellingWaveScene()
    mixed.inductionBenches = createBarMotionScene().inductionBenches
    const support = waveEngine.canHandle(mixed)
    expect(support.supported).toBe(false)
    if (!support.supported) {
      expect(support.failedConditions[0]?.condition).toBe('pure_wave_scene')
    }
  })

  it('22. rejects a bench whose values fail scene validation', () => {
    const flat = createWaveScene({
      bench: { type: 'travelling', amplitude: 0, wavelength: 0.4, frequency: 5 },
    })
    const support = waveEngine.canHandle(flat)
    expect(support.supported).toBe(false)
    expect(waveEngine.validate(flat).status).toBe('failed')
  })

  it('23. refuses negative time and mismatched simulation requests', () => {
    const scene = createTravellingWaveScene()
    expect(() => waveEngine.stateAt(scene, quantity(-1, 's', 'time'))).toThrow(
      /finite and non-negative/,
    )
    const request = createWaveSimulationRequest(scene, 'sim-stale', 'trace-stale')
    const edited = { ...scene, revision: scene.revision + 1 }
    expect(() => waveEngine.simulate(edited, request)).toThrow(/exact PhysicsScene revision/)
  })

  it('24. follows SceneCommand edits: a doubled frequency doubles v and halves T', () => {
    const runtime = new SceneRuntime(createTravellingWaveScene())
    const before = simulated(runtime.getScene())
    const edit = execute(runtime, 'SetWaveFrequency', {
      benchId: 'wave-bench-1',
      frequency: quantity(10, 'Hz', 'frequency'),
    })
    expect(edit.ok).toBe(true)
    const after = simulated(runtime.getScene())
    expect(after.sceneRevision).toBe(1)
    expect(scalar(after, 'wave_speed')).toBeCloseTo(scalar(before, 'wave_speed') * 2, 12)
    expect(scalar(after, 'period')).toBeCloseTo(scalar(before, 'period') / 2, 12)
  })

  it('25. re-derives the standing-wave frequency after a harmonic edit through the runtime', () => {
    const runtime = new SceneRuntime(createStandingWaveScene())
    execute(runtime, 'SetWaveHarmonic', { benchId: 'wave-bench-1', harmonic: 4 })
    const result = simulated(runtime.getScene())
    expect(scalar(result, 'frequency')).toBeCloseTo(80, 12)
    expect(scalar(result, 'wavelength')).toBeCloseTo(0.5, 12)
    expect(result.verification.status).toBe('passed')
  })

  it('26. runs the time window the scene declares and reads kHz frequencies', () => {
    const scene = createWaveScene({
      bench: { type: 'travelling', amplitude: 1, wavelength: 0.01, frequency: 2 },
    })
    const bench = scene.waveBenches?.[0]
    if (bench === undefined) throw new Error('bench missing')
    bench.frequency = quantity(2, 'kHz', 'frequency')
    const model = resolveWaveModel(scene)
    expect(model.frequency).toBeCloseTo(2000, 9)
    expect(model.waveSpeed).toBeCloseTo(20, 9)

    const result = simulated(createTravellingWaveScene())
    expect(result.states[0]?.time.value).toBe(0)
    expect(result.states.at(-1)?.time.value).toBeCloseTo(1, 12)
  })
})
