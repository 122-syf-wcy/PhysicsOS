import { GOLDEN_QUESTIONS } from '@physicsos/question-core'

import {
  COMMAND_TYPES,
  EXPERIMENT_CATALOG,
  PHYSICS_TOOL_DOCS,
  PHYSICS_TOOL_NAMES,
  PhysicsToolRuntime,
  ToolRuntimeError,
  commandReferenceText,
  domainOfEngine,
  normalizeCommandPayload,
  pickEngine,
} from '../src/index.ts'

/** The tool boundary is JSON: no `undefined`, no NaN, no class instances may cross it. */
const roundTrips = (value: unknown): void => {
  expect(JSON.parse(JSON.stringify(value))).toEqual(value)
}

describe('experiment catalog', () => {
  it('has unique ids and each entry builds a scene its own domain engine accepts', () => {
    const ids = new Set(EXPERIMENT_CATALOG.map((entry) => entry.id))
    expect(ids.size).toBe(EXPERIMENT_CATALOG.length)
    for (const entry of EXPERIMENT_CATALOG) {
      const scene = entry.build(`probe-${entry.id}`, entry.title)
      const picked = pickEngine(scene)
      expect(picked.entry, entry.id).toBeDefined()
      expect(domainOfEngine(picked.entry!.engine), entry.id).toBe(entry.domain)
    }
  })

  it('routes the lever rig to the lever engine, not the body engine', () => {
    const scene = EXPERIMENT_CATALOG.find((entry) => entry.id === 'lever-balance')!.build(
      'probe-lever',
      'lever',
    )
    expect(pickEngine(scene).entry?.engine.engineId).toBe('engine-lever')
  })

  it('covers every domain the Lab exposes', () => {
    const domains = new Set(EXPERIMENT_CATALOG.map((entry) => entry.domain))
    expect([...domains].sort()).toEqual([
      'acoustics',
      'circuit',
      'composite',
      'electric',
      'fluid',
      'induction',
      'magnetic',
      'mechanics',
      'optics',
      'thermal',
      'wave',
    ])
  })
})

describe('PhysicsToolRuntime: experiments', () => {
  it('lists the catalog as plain data', () => {
    const runtime = new PhysicsToolRuntime()
    const listing = runtime.listExperiments()
    expect(listing.length).toBe(EXPERIMENT_CATALOG.length)
    expect(listing[0]).toEqual({
      id: 'uniform-linear',
      domain: 'mechanics',
      stage: 'junior',
      title: '匀速直线运动',
      description: expect.any(String),
    })
    roundTrips(listing)
  })

  it('opens every catalogued experiment and simulates it green', () => {
    const runtime = new PhysicsToolRuntime()
    for (const entry of EXPERIMENT_CATALOG) {
      const description = runtime.createExperiment(entry.id)
      expect(description.domain, entry.id).toBe(entry.domain)
      expect(description.revision).toBe(0)
      expect(description.objects.length, entry.id).toBeGreaterThan(0)
      expect(description.commands).toContain('SetObservableEnabled')
      const result = runtime.simulate(description.sceneId)
      expect(
        result.verification.status,
        `${entry.id}: ${result.verification.errors.join(' ')}`,
      ).toBe('passed')
      expect(result.derived.length, entry.id).toBeGreaterThan(0)
      expect(result.sampleCount, entry.id).toBeGreaterThan(0)
      roundTrips(description)
      roundTrips(result)
    }
    expect(runtime.listScenes().length).toBe(EXPERIMENT_CATALOG.length)
  })

  it('rejects unknown experiment ids and unknown scenes with coded errors', () => {
    const runtime = new PhysicsToolRuntime()
    expect(() => runtime.createExperiment('no-such-rig')).toThrowError(ToolRuntimeError)
    try {
      runtime.describeScene('ghost')
    } catch (error) {
      expect(error).toBeInstanceOf(ToolRuntimeError)
      expect((error as ToolRuntimeError).code).toBe('SCENE_NOT_FOUND')
    }
  })

  it('drops the oldest scene once the configured cap is reached', () => {
    const runtime = new PhysicsToolRuntime({ maxScenes: 2 })
    const first = runtime.createExperiment('uniform-linear')
    const second = runtime.createExperiment('series-circuit')
    const third = runtime.createExperiment('convex-lens')
    expect(runtime.listScenes().map((scene) => scene.sceneId)).toEqual([
      second.sceneId,
      third.sceneId,
    ])
    expect(() => runtime.describeScene(first.sceneId)).toThrowError(ToolRuntimeError)
    expect(() => new PhysicsToolRuntime({ maxScenes: 0 })).toThrowError(ToolRuntimeError)
  })

  it('accepts a custom title without touching physics', () => {
    const runtime = new PhysicsToolRuntime()
    const description = runtime.createExperiment('magnetic-circular', '小明的质子实验')
    expect(description.title).toBe('小明的质子实验')
    expect(description.engineId).toBe('engine-magnetic')
    const radius = runtime
      .simulate(description.sceneId)
      .derived.find((entry) => entry.key === 'cyclotron_radius')
    expect(radius?.value).toBeCloseTo((1.67e-27 * 2e6) / (1.6e-19 * 0.5), 6)
  })
})

describe('PhysicsToolRuntime: scene commands', () => {
  it('applies a validated command, bumps the revision and changes the simulated fact', () => {
    const runtime = new PhysicsToolRuntime()
    const scene = runtime.createExperiment('magnetic-circular')
    const field = scene.objects.find((object) => object.kind === 'uniform_magnetic')
    expect(field).toBeDefined()
    const radiusOf = (): number =>
      runtime.simulate(scene.sceneId).derived.find((entry) => entry.key === 'cyclotron_radius')!
        .value!
    const before = radiusOf()

    const result = runtime.applyCommand(scene.sceneId, 'SetMagneticFieldStrength', {
      fieldId: field!.id,
      strength: { value: 1, unit: 'T' },
    })
    expect(result).toEqual({
      ok: true,
      sceneId: scene.sceneId,
      revision: 1,
      eventType: 'MagneticFieldStrengthChanged',
    })
    expect(radiusOf()).toBeCloseTo(before / 2, 9)
    expect(runtime.describeScene(scene.sceneId).revision).toBe(1)
  })

  it('returns the domain refusal instead of throwing when the runtime rejects an edit', () => {
    const runtime = new PhysicsToolRuntime()
    const standing = runtime.createExperiment('wave-standing')
    const bench = standing.objects.find((object) => object.kind.startsWith('wave_bench'))!
    const refused = runtime.applyCommand(standing.sceneId, 'SetWaveFrequency', {
      benchId: bench.id,
      frequency: { value: 30, unit: 'Hz' },
    })
    expect(refused.ok).toBe(false)
    expect(refused.error?.code).toBe('WAVE_WRONG_SUBMODEL')
    expect(refused.revision).toBe(0)
    roundTrips(refused)
  })

  it('reports malformed payloads and unknown command types without mutating the scene', () => {
    const runtime = new PhysicsToolRuntime()
    const scene = runtime.createExperiment('series-circuit')
    const missing = runtime.applyCommand(scene.sceneId, 'SetSourceVoltage', { circuitId: 'c' })
    expect(missing.ok).toBe(false)
    expect(missing.error?.code).toBe('INVALID_PAYLOAD')
    const unknown = runtime.applyCommand(scene.sceneId, 'SetWarpFactor', {})
    expect(unknown.error?.code).toBe('UNKNOWN_COMMAND')
    expect(runtime.describeScene(scene.sceneId).revision).toBe(0)
  })

  it('normalizes quantities, vectors and observable ids into the contract shapes', () => {
    expect(
      normalizeCommandPayload('SetBodyVelocity', {
        bodyId: 'b',
        velocity: { x: 3, y: 4, unit: 'm/s' },
      }),
    ).toEqual({
      bodyId: 'b',
      velocity: { vector: { x: 3, y: 4, z: 0 }, unit: 'm/s', dimension: 'velocity' },
    })
    expect(
      normalizeCommandPayload('SetParticleCharge', {
        particleId: 'p',
        charge: { value: -1.6e-19, unit: 'C' },
      }),
    ).toEqual({
      particleId: 'p',
      charge: { value: -1.6e-19, unit: 'C', dimension: 'electric_charge' },
    })
    expect(
      normalizeCommandPayload('SetObservableEnabled', { observableId: 'obs', enabled: false }),
    ).toEqual({
      observableId: 'obs',
      enabled: false,
    })
    expect(() =>
      normalizeCommandPayload('SetSliderPosition', {
        circuitId: 'c',
        componentId: 'r',
        position: 'half',
      }),
    ).toThrowError(/position/)
  })

  it('documents every frozen command type in the model-facing reference', () => {
    const text = commandReferenceText()
    for (const type of COMMAND_TYPES) expect(text).toContain(`- ${type} `)
    expect(COMMAND_TYPES.length).toBeGreaterThanOrEqual(45)
  })
})

describe('PhysicsToolRuntime: observe', () => {
  it('reads the engine state at a time', () => {
    const runtime = new PhysicsToolRuntime()
    const scene = runtime.createExperiment('projectile-horizontal')
    const observed = runtime.observe(scene.sceneId, 1)
    const body = observed.objects.find((object) => object.position !== undefined)!
    expect(body.position!.x).toBeCloseTo(10, 9)
    expect(body.position!.y).toBeCloseTo(20 - 0.5 * 9.8, 9)
    expect(body.velocity!.y).toBeCloseTo(-9.8, 9)
    roundTrips(observed)
  })

  it('rejects negative or non-finite times', () => {
    const runtime = new PhysicsToolRuntime()
    const scene = runtime.createExperiment('uniform-linear')
    expect(() => runtime.observe(scene.sceneId, -1)).toThrowError(ToolRuntimeError)
    expect(() => runtime.observe(scene.sceneId, Number.NaN)).toThrowError(ToolRuntimeError)
  })
})

describe('PhysicsToolRuntime: solve question', () => {
  it('solves every VALID golden question and registers its scene', () => {
    const runtime = new PhysicsToolRuntime()
    const valid = GOLDEN_QUESTIONS.filter((question) => question.expectedValidation === 'VALID')
    expect(valid.length).toBeGreaterThan(50)
    for (const question of valid) {
      const result = runtime.solveQuestion(question.text)
      expect(
        result.status,
        `${question.id}: ${result.issues.map((issue) => issue.message).join(' ')}`,
      ).toBe('solved')
      expect(result.goldenQuestionId).toBe(question.id)
      expect(result.answers.length, question.id).toBeGreaterThan(0)
      expect(result.steps.length, question.id).toBeGreaterThan(0)
      expect(result.verification?.status, question.id).toBe('passed')
      expect(result.scene?.sourceQuestionId, question.id).toBe(`golden-${question.id}`)
      if (question.expectedDomain !== undefined) {
        expect(result.scene?.domain, question.id).toBe(question.expectedDomain)
      }
      roundTrips(result)
    }
  })

  it('returns a rejection with reasons for a non-VALID golden question, never invented numbers', () => {
    const runtime = new PhysicsToolRuntime()
    const rejected = GOLDEN_QUESTIONS.filter((question) => question.expectedValidation !== 'VALID')
    expect(rejected.length).toBeGreaterThan(0)
    for (const question of rejected) {
      const result = runtime.solveQuestion(question.text)
      expect(result.status, question.id).toBe('rejected')
      expect(result.answers).toEqual([])
      expect(result.issues.length, question.id).toBeGreaterThan(0)
      expect(result.scene).toBeUndefined()
      roundTrips(result)
    }
  })

  it('solves a free-text question and lets the agent keep exploring the built scene', () => {
    const runtime = new PhysicsToolRuntime()
    const result = runtime.solveQuestion(
      '一个质子以 3.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.40 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求：1. 轨道半径 2. 运动周期',
    )
    expect(result.status).toBe('solved')
    expect(result.goldenQuestionId).toBeUndefined()
    expect(result.scene).toBeDefined()
    expect(result.scene?.sceneId.startsWith('question-agent-question-')).toBe(true)
    expect(result.answers.length).toBeGreaterThan(0)
    const sim = runtime.simulate(result.scene!.sceneId)
    expect(sim.verification.status).toBe('passed')
    const radius = sim.derived.find((entry) => entry.key === 'cyclotron_radius')
    expect(radius?.value).toBeCloseTo((1.67e-27 * 3e6) / (1.6e-19 * 0.4), 6)
  })

  it('rejects empty text', () => {
    const runtime = new PhysicsToolRuntime()
    expect(() => runtime.solveQuestion('   ')).toThrowError(ToolRuntimeError)
  })
})

describe('tool docs', () => {
  it('documents every tool name and embeds the command reference and catalog ids', () => {
    for (const name of PHYSICS_TOOL_NAMES) {
      expect(PHYSICS_TOOL_DOCS[name].description.length).toBeGreaterThan(20)
    }
    expect(PHYSICS_TOOL_DOCS.physics_scene_command.description).toContain('SetWaveHarmonic')
    for (const entry of EXPERIMENT_CATALOG) {
      expect(PHYSICS_TOOL_DOCS.physics_list_experiments.description).toContain(entry.id)
    }
  })
})
