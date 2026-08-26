import { describe, expect, it } from 'vitest'
import { quantity } from '@physicsos/physics-units'
import { derivedScalar } from '@physicsos/physics-core'
import {
  SceneRuntime,
  createEchoRangingScene,
  createConvexLensScene,
  createSceneCommand,
  acousticBenchOf,
  isAcousticsScene,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'

import {
  ACOUSTICS_ENGINE_ID,
  ECHO_RANGING_MODEL,
  AcousticsEngine,
  acousticsEngine,
  createAcousticsSimulationRequest,
  echoTimingOf,
  pulseStateAt,
  resolveAcousticModel,
} from '../src/index.ts'

const echoScene = (wallDistance = 340, soundSpeed = 340): PhysicsScene =>
  createEchoRangingScene({ wallDistance, soundSpeed })

const simulated = (scene: PhysicsScene) =>
  acousticsEngine.simulate(
    scene,
    createAcousticsSimulationRequest(scene, 'sim-echo', 'trace-echo'),
  )

describe('echo ranging timing', () => {
  it('times the textbook round trip: 340 m in 15 °C air is exactly 2 s', () => {
    const model = resolveAcousticModel(echoScene())
    const timing = echoTimingOf(model)
    expect(timing.oneWayTime).toBeCloseTo(1, 12)
    expect(timing.roundTripTime).toBeCloseTo(2, 12)
  })

  it('moves the pulse out, folds it at the wall and parks it after reception', () => {
    const model = resolveAcousticModel(echoScene())
    expect(pulseStateAt(model, 0).x).toBeCloseTo(0, 12)
    expect(pulseStateAt(model, 0.5)).toMatchObject({ phase: 'outbound' })
    expect(pulseStateAt(model, 0.5).x).toBeCloseTo(170, 12)
    expect(pulseStateAt(model, 1).x).toBeCloseTo(340, 12)
    expect(pulseStateAt(model, 1.5)).toMatchObject({ phase: 'return' })
    expect(pulseStateAt(model, 1.5).x).toBeCloseTo(170, 12)
    expect(pulseStateAt(model, 2)).toMatchObject({ phase: 'received' })
    expect(pulseStateAt(model, 2).x).toBeCloseTo(0, 12)
    /* Past the round trip the experiment is over; the state is a reading. */
    expect(pulseStateAt(model, 5).x).toBeCloseTo(0, 12)
    expect(pulseStateAt(model, 5).travelled).toBeCloseTo(680, 12)
  })

  it('scales with the medium: 750 m in water (1500 m/s) echoes after 1 s', () => {
    const model = resolveAcousticModel(echoScene(750, 1500))
    expect(echoTimingOf(model).roundTripTime).toBeCloseTo(1, 12)
  })
})

describe('acoustics engine', () => {
  it('handles a pure echo scene as the echo_ranging model in the wave domain', () => {
    const support = acousticsEngine.canHandle(echoScene())
    expect(support).toMatchObject({
      supported: true,
      modelId: ECHO_RANGING_MODEL,
      domain: 'wave',
    })
  })

  it('rejects scenes without an acoustic bench, naming the failed condition', () => {
    const none = acousticsEngine.canHandle({ ...echoScene(), acousticBenches: [] })
    expect(none.supported).toBe(false)
    if (!none.supported) {
      expect(none.failedConditions[0]?.condition).toBe('single_range')
    }
    const optics = acousticsEngine.canHandle(createConvexLensScene({}))
    expect(optics.supported).toBe(false)
  })

  it('derives distance, speed and timing with the teaching formula d = v·t/2', () => {
    const outcome = simulated(echoScene())
    expect(derivedScalar(outcome.derivedQuantities, 'wall_distance').value).toBeCloseTo(340, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'sound_speed').value).toBeCloseTo(340, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'one_way_time').value).toBeCloseTo(1, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'echo_time').value).toBeCloseTo(2, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'measured_distance').value).toBeCloseTo(340, 9)
    const formulas = outcome.derivedQuantities.map((entry) => entry.formula?.expression)
    expect(formulas).toContain('d = v·t/2')
  })

  it('verifies the echo formula, reflection symmetry and uniform propagation', () => {
    const outcome = simulated(echoScene(510, 340))
    expect(outcome.verification.status).toBe('passed')
    const ids = outcome.verification.checks.map((entry) => entry.id)
    expect(ids).toContain('echo_distance_formula')
    expect(ids).toContain('reflection_symmetry')
    expect(ids).toContain('pulse_speed_constant')
    for (const id of ['echo_distance_formula', 'reflection_symmetry', 'pulse_speed_constant']) {
      expect(outcome.verification.checks.find((entry) => entry.id === id)?.passed).toBe(true)
    }
  })

  it('emits the three timeline events at 0, d/v and 2d/v', () => {
    const outcome = simulated(echoScene())
    expect(outcome.events.map((event) => [event.type, event.time])).toEqual([
      ['PulseEmitted', 0],
      ['PulseReflected', 1],
      ['EchoReceived', 2],
    ])
  })

  it('samples the reflection instant exactly (kink, not interpolation)', () => {
    const outcome = simulated(echoScene())
    expect(outcome.states).toHaveLength(65)
    const midway = outcome.states[32]
    expect(midway?.time.value).toBeCloseTo(1, 12)
    const bench = midway?.objects.find((object) => object.id === 'acoustic-bench-1')
    const pulseX = bench?.values?.['pulse_position_x']
    expect(pulseX !== undefined && 'value' in pulseX ? pulseX.value : Number.NaN).toBeCloseTo(
      340,
      9,
    )
  })

  it('seeks any time closed-form via stateAt and rejects negative times', () => {
    const scene = echoScene()
    const state = acousticsEngine.stateAt(scene, quantity(0.25, 's', 'time'))
    const bench = state.objects.find((object) => object.id === 'acoustic-bench-1')
    const pulseX = bench?.values?.['pulse_position_x']
    expect(pulseX !== undefined && 'value' in pulseX ? pulseX.value : Number.NaN).toBeCloseTo(
      85,
      9,
    )
    expect(() => acousticsEngine.stateAt(scene, quantity(-1, 's', 'time'))).toThrow()
  })

  it('refuses to simulate a mismatched scene revision', () => {
    const scene = echoScene()
    const request = createAcousticsSimulationRequest(scene, 'sim-echo', 'trace-echo')
    expect(() => acousticsEngine.simulate({ ...scene, revision: 7 }, request)).toThrow()
  })

  it('exposes stable identity for the engine gate', () => {
    const engine = new AcousticsEngine()
    expect(engine.engineId).toBe(ACOUSTICS_ENGINE_ID)
    expect(engine.domain).toBe('wave')
  })
})

describe('scene commands drive the range', () => {
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

  it('moves the wall and re-times the echo', () => {
    const runtime = new SceneRuntime(echoScene())
    const bench = acousticBenchOf(runtime.getScene())
    expect(bench).toBeDefined()
    const executed = execute(runtime, 'SetAcousticReflectorPosition', {
      benchId: bench?.id ?? '',
      position: quantity(170, 'm', 'length'),
    })
    expect(executed.ok).toBe(true)
    const model = resolveAcousticModel(runtime.getScene())
    expect(model.wallDistance).toBeCloseTo(170, 12)
    expect(echoTimingOf(model).roundTripTime).toBeCloseTo(1, 12)
  })

  it('rejects a wall at or behind the source', () => {
    const runtime = new SceneRuntime(echoScene())
    const executed = execute(runtime, 'SetAcousticReflectorPosition', {
      benchId: acousticBenchOf(runtime.getScene())?.id ?? '',
      position: quantity(0, 'm', 'length'),
    })
    expect(executed.ok).toBe(false)
    if (!executed.ok) {
      expect(executed.error.code).toBe('INVALID_ACOUSTIC_REFLECTOR_POSITION')
    }
  })

  it('switches the medium speed and rejects non-positive speeds', () => {
    const runtime = new SceneRuntime(echoScene())
    const benchId = acousticBenchOf(runtime.getScene())?.id ?? ''
    const executed = execute(runtime, 'SetAcousticSoundSpeed', {
      benchId,
      soundSpeed: quantity(1500, 'm/s', 'velocity'),
    })
    expect(executed.ok).toBe(true)
    expect(resolveAcousticModel(runtime.getScene()).soundSpeed).toBeCloseTo(1500, 9)

    const rejected = execute(runtime, 'SetAcousticSoundSpeed', {
      benchId,
      soundSpeed: quantity(0, 'm/s', 'velocity'),
    })
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) {
      expect(rejected.error.code).toBe('INVALID_ACOUSTIC_SOUND_SPEED')
    }
  })

  it('classifies the template as a pure acoustics scene', () => {
    expect(isAcousticsScene(echoScene())).toBe(true)
    expect(isAcousticsScene(createConvexLensScene({}))).toBe(false)
  })
})
