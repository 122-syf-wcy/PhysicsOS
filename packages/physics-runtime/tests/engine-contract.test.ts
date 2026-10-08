import { describe, expect, it } from 'vitest'
import { EXPERIMENT_CATALOG } from '../../agent-tools/src/experiment-catalog.ts'
import {
  createMechanicalEnergyScene,
  createPinholeScene,
  createNoiseBarrierScene,
  createSolidPressureScene,
  createThermometerCalibrationScene,
  createTransformerBenchScene,
  createStraightWireFieldScene,
  createPhotoelectricEffectScene,
  createCollisionScene,
  createEchoRangingScene,
} from '@physicsos/physics-scene'
import { ENGINE_CAPABILITIES, pickEngine, questionEngine } from '../src/index.ts'

const staticEngines = new Set([
  'engine-current-magnetic',
  'engine-energy',
  'engine-optics',
  'engine-light',
  'engine-noise-level',
  'engine-pressure',
  'engine-thermometer',
  'engine-transformer',
])

// Exercises concrete engines through the shared dispatch with the same catalog
// used by model-facing tools; a new advertised bench joins this contract test.
const fixtures = [
  ...EXPERIMENT_CATALOG,
  ...[
    ['energy', createMechanicalEnergyScene],
    ['pinhole', createPinholeScene],
    ['noise', createNoiseBarrierScene],
    ['pressure', createSolidPressureScene],
    ['thermometer', createThermometerCalibrationScene],
    ['transformer', createTransformerBenchScene],
    ['current', createStraightWireFieldScene],
    ['modern', createPhotoelectricEffectScene],
  ].map(([id, factory]) => ({
    id: id as string,
    title: id as string,
    build: () => (factory as () => ReturnType<typeof createPinholeScene>)(),
  })),
  {
    id: 'collision',
    title: 'collision',
    build: () =>
      createCollisionScene({
        bodies: [
          { id: 'a', mass: 1, position: [-2, 0], velocity: [1, 0] },
          { id: 'b', mass: 1, position: [2, 0], velocity: [-1, 0] },
        ],
      }),
  },
]

describe.each(fixtures)('$id engine request contract', (fixture) => {
  const scene = fixture.build(`contract-${fixture.id}`, fixture.title)
  const entry = pickEngine(scene).entry!
  const support = entry.engine.canHandle(scene)
  const isStatic =
    staticEngines.has(entry.engine.engineId) ||
    (support.supported && support.modelId === 'point_charge_electrostatic_field')
  it('honors nonzero absolute sample times and the bounded output count', () => {
    const request = entry.createRequest(scene, 'contract', 'contract')
    request.options = {
      startTime: { value: 0.1, unit: 's', dimension: 'time' },
      endTime: { value: 0.2, unit: 's', dimension: 'time' },
      outputSampleRate: 7,
    }
    const simulation = entry.engine.simulate(scene, request)
    expect(
      simulation.verification.status,
      simulation.verification.errors.map((error) => error.message).join('; '),
    ).not.toBe('failed')
    expect(simulation.states[0]!.time.value).toBe(0.1)
    if (isStatic) {
      expect(simulation.states).toHaveLength(1)
    } else {
      expect(simulation.states.at(-1)!.time.value).toBe(0.2)
      expect(simulation.states.length).toBeGreaterThanOrEqual(7)
      // Additional event samples are allowed, with the shared storage cap.
      expect(simulation.states.length).toBeLessThanOrEqual(1024)
      if (simulation.events.length === 0) expect(simulation.states).toHaveLength(7)
    }
  })
  it('returns only timed events in the accepted interval', () => {
    const request = entry.createRequest(scene, 'event-window', 'event-window')
    request.options = {
      startTime: { value: 0.1, unit: 's', dimension: 'time' },
      endTime: { value: 0.2, unit: 's', dimension: 'time' },
      outputSampleRate: 7,
    }
    for (const event of entry.engine.simulate(scene, request).events) {
      if (event.time === undefined) continue
      expect(event.time, event.type).toBeGreaterThanOrEqual(0.1)
      expect(event.time, event.type).toBeLessThanOrEqual(0.2)
    }
  })
  it('rejects requests for a different scene revision', () => {
    const request = entry.createRequest(scene, 'stale', 'stale')
    request.sceneRevision += 1
    expect(() => entry.engine.simulate(scene, request)).toThrow()
  })
})

describe('shared capability inventory', () => {
  it('contains unique engine ids and a callable question path for modern physics', () => {
    expect(new Set(ENGINE_CAPABILITIES.map((entry) => entry.engineId)).size).toBe(
      ENGINE_CAPABILITIES.length,
    )
    expect(questionEngine('modern_physics', 'photoelectric_effect')?.engineId).toBe('engine-modern')
    expect(questionEngine('modern_physics', 'unknown')).toBeUndefined()
  })
})

describe('acoustic event window boundaries', () => {
  const scene = createEchoRangingScene({ wallDistance: 340, soundSpeed: 340 })
  const entry = pickEngine(scene).entry!
  it.each([
    [1.1, 1.2, []],
    [1, 2, ['PulseReflected', 'EchoReceived']],
    [0, 0, ['PulseEmitted']],
  ] as const)('returns events in [%s, %s] including endpoints', (start, end, expected) => {
    const request = entry.createRequest(scene, 'echo-window', 'echo-window')
    request.options = {
      startTime: { value: start, unit: 's', dimension: 'time' },
      endTime: { value: end, unit: 's', dimension: 'time' },
    }
    expect(entry.engine.simulate(scene, request).events.map((event) => event.type)).toEqual(
      expected,
    )
  })
})
