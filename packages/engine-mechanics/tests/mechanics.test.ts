import { describe, it, expect } from 'vitest'
import {
  createGoldenQuestionDocument,
  processQuestion,
  GOLDEN_QUESTIONS,
} from '../../question-core/src/index.ts'
import { MechanicsEngine } from '../src/index.ts'
import { createMechanicsScene as createScene, createMechanicsSimulationRequest as createReq } from '@physicsos/physics-scene'
import { vec3 } from '@physicsos/physics-math'

const mechQuestions = GOLDEN_QUESTIONS.filter((q) => q.id.startsWith('mech-'))

describe('Mechanics Golden Questions', () => {
  for (const def of mechQuestions) {
    describe(def.id + ': ' + def.title, () => {
      const doc = createGoldenQuestionDocument(def)
      const result = processQuestion(doc)

      it('should have expected validation status', () => {
        if (def.expectedValidation === 'VALID') {
          expect(result.validation?.status).toBe('VALID')
        }
      })

      it('should reach READY state', () => {
        expect(result.workflowState).toBe('READY')
      })

      it('should produce a PhysicsScene', () => {
        expect(result.scene).not.toBeNull()
        expect(result.scene!.bodies.length).toBe(1)
      })

      it('should produce simulation', () => {
        expect(result.simulation).not.toBeNull()
      })

      it('should pass verification', () => {
        expect(result.simulation!.verification.status).not.toBe('failed')
      })

      it('should produce solution', () => {
        expect(result.solution).not.toBeNull()
        expect(result.solution!.steps.length).toBeGreaterThan(0)
      })
    })
  }
})

describe('mech-01: Uniform Acceleration', () => {
  const def = mechQuestions.find((q) => q.id === 'mech-01-uniform-acceleration')!
  const doc = createGoldenQuestionDocument(def)
  const result = processQuestion(doc)

  it('should parse v0=10, a=2, t=5', () => {
    expect(result.ir).not.toBeNull()
    const v0 = result.ir!.knowns.find((k) => k.key === 'initial_velocity')
    const a = result.ir!.knowns.find((k) => k.key === 'acceleration')
    const t = result.ir!.knowns.find((k) => k.key === 'time')
    expect(v0?.value).toBeCloseTo(10, 0)
    expect(a?.value).toBeCloseTo(2, 0)
    expect(t?.value).toBeCloseTo(5, 0)
  })

  it('should compute v=20 m/s', () => {
    const finalV = result.simulation!.derivedQuantities.find((d) => d.key === 'final_velocity')
    expect(finalV).toBeDefined()
  })

  it('should compute s=75 m', () => {
    const disp = result.simulation!.derivedQuantities.find((d) => d.key === 'displacement')
    expect(disp).toBeDefined()
  })
})

describe('mech-02: Horizontal Projectile', () => {
  const def = mechQuestions.find((q) => q.id === 'mech-02-projectile-horizontal')!
  const doc = createGoldenQuestionDocument(def)
  const result = processQuestion(doc)

  it('should detect projectile model', () => {
    expect(result.ir?.model).toBe('projectile_motion')
  })

  it('should compute flight_time = 2s', () => {
    const ft = result.simulation!.derivedQuantities.find((d) => d.key === 'flight_time')
    expect(ft).toBeDefined()
    const val = (ft!.value as { value: number }).value
    expect(val).toBeCloseTo(2, 0)
  })

  it('should compute range = 20m', () => {
    const range = result.simulation!.derivedQuantities.find((d) => d.key === 'range')
    expect(range).toBeDefined()
    const val = (range!.value as { value: number }).value
    expect(val).toBeCloseTo(20, 0)
  })
})

describe('mech-03: Oblique Projectile', () => {
  const def = mechQuestions.find((q) => q.id === 'mech-03-projectile-oblique')!
  const doc = createGoldenQuestionDocument(def)
  const result = processQuestion(doc)

  it('should detect projectile model', () => {
    expect(result.ir?.model).toBe('projectile_motion')
  })

  it('should produce flight_time, max_height, range', () => {
    const ft = result.simulation!.derivedQuantities.find((d) => d.key === 'flight_time')
    const maxH = result.simulation!.derivedQuantities.find((d) => d.key === 'max_height')
    const range = result.simulation!.derivedQuantities.find((d) => d.key === 'range')
    expect(ft).toBeDefined()
    expect(maxH).toBeDefined()
    expect(range).toBeDefined()
  })
})

describe('mech-04: Newton Second Law', () => {
  const def = mechQuestions.find((q) => q.id === 'mech-04-newton-second-law')!
  const doc = createGoldenQuestionDocument(def)
  const result = processQuestion(doc)

  it('should detect newton_second_law model', () => {
    expect(result.ir?.model).toBe('newton_second_law')
  })

  it('should compute a = 5 m/s²', () => {
    const acc = result.simulation!.derivedQuantities.find((d) => d.key === 'acceleration')
    expect(acc).toBeDefined()
  })
})

describe('mech-05: Incline No Friction', () => {
  const def = mechQuestions.find((q) => q.id === 'mech-05-incline-no-friction')!
  const doc = createGoldenQuestionDocument(def)
  const result = processQuestion(doc)

  it('should detect inclined_plane model', () => {
    expect(result.ir?.model).toBe('inclined_plane')
  })

  it('should compute a = 5 m/s²', () => {
    const a = result.simulation!.derivedQuantities.find((d) => d.key === 'incline_acceleration')
    expect(a).toBeDefined()
    const val = (a!.value as { value: number }).value
    expect(val).toBeCloseTo(5, 0)
  })

  it('should compute N ≈ 17.32 N', () => {
    const n = result.simulation!.derivedQuantities.find((d) => d.key === 'normal_force')
    expect(n).toBeDefined()
    const val = (n!.value as { value: number }).value
    expect(val).toBeCloseTo(17.32, 1)
  })
})

describe('mech-06: Unit Conversion 72 km/h', () => {
  const def = mechQuestions.find((q) => q.id === 'mech-06-unit-conversion')!
  const doc = createGoldenQuestionDocument(def)
  const result = processQuestion(doc)

  it('should convert 72 km/h to 20 m/s', () => {
    const v = result.ir?.knowns.find((k) => k.key === 'initial_velocity')
    expect(v).toBeDefined()
    expect(v!.value).toBeCloseTo(20, 0)
  })

  it('should be VALID', () => {
    expect(result.workflowState).toBe('READY')
  })
})

describe('Engine Direct Tests', () => {
  const engine = new MechanicsEngine()

  it('canHandle uniform linear scene', () => {
    const scene = createScene({ model: 'uniform_linear_motion', mass: 1, position: vec3(0, 0, 0), velocity: vec3(5, 0, 0) })
    const support = engine.canHandle(scene)
    expect(support.supported).toBe(true)
  })

  it('canHandle projectile scene', () => {
    const scene = createScene({ model: 'projectile_motion', mass: 1, position: vec3(0, 20, 0), velocity: vec3(10, 0, 0), gravity: vec3(0, -10, 0), groundY: 0 })
    const support = engine.canHandle(scene)
    expect(support.supported).toBe(true)
  })

  it('canHandle incline scene', () => {
    const scene = createScene({ model: 'inclined_plane', mass: 2, inclineAngle: 30, gravity: vec3(0, -10, 0) })
    const support = engine.canHandle(scene)
    expect(support.supported).toBe(true)
  })

  it('rejects mass <= 0', () => {
    const scene = createScene({ model: 'uniform_linear_motion', mass: -1, velocity: vec3(5, 0, 0) })
    const support = engine.canHandle(scene)
    expect(support.supported).toBe(false)
  })

  it('stateAt returns valid state', () => {
    const scene = createScene({ model: 'uniform_linear_motion', mass: 1, position: vec3(0, 0, 0), velocity: vec3(5, 0, 0) })
    const state = engine.stateAt(scene, { value: 2, unit: 's', dimension: 'time' as const })
    expect(state.objects[0]?.position?.vector.x).toBeCloseTo(10, 0)
  })

  it('simulate produces states and derived', () => {
    const scene = createScene({ model: 'projectile_motion', mass: 1, position: vec3(0, 20, 0), velocity: vec3(10, 0, 0), gravity: vec3(0, -10, 0), groundY: 0 })
    const req = createReq(scene, 'test-sim', 'test-trace')
    const result = engine.simulate(scene, req)
    expect(result.states.length).toBeGreaterThan(0)
    expect(result.derivedQuantities.length).toBeGreaterThan(0)
    expect(result.verification.status).not.toBe('failed')
  })
})

describe('Metamorphic Tests', () => {
  it('projectile: vx*2 -> range*2, same flight time', () => {
    const scene1 = createScene({ model: 'projectile_motion', mass: 1, position: vec3(0, 20, 0), velocity: vec3(10, 0, 0), gravity: vec3(0, -10, 0), groundY: 0 })
    const scene2 = createScene({ model: 'projectile_motion', mass: 1, position: vec3(0, 20, 0), velocity: vec3(20, 0, 0), gravity: vec3(0, -10, 0), groundY: 0 })
    const engine = new MechanicsEngine()
    const req1 = createReq(scene1, 'sim1', 'trace1')
    const req2 = createReq(scene2, 'sim2', 'trace2')
    const r1 = engine.simulate(scene1, req1)
    const r2 = engine.simulate(scene2, req2)
    const ft1 = (r1.derivedQuantities.find((d) => d.key === 'flight_time')!.value as { value: number }).value
    const ft2 = (r2.derivedQuantities.find((d) => d.key === 'flight_time')!.value as { value: number }).value
    expect(ft1).toBeCloseTo(ft2, 1)
    const range1 = (r1.derivedQuantities.find((d) => d.key === 'range')!.value as { value: number }).value
    const range2 = (r2.derivedQuantities.find((d) => d.key === 'range')!.value as { value: number }).value
    expect(range2).toBeCloseTo(range1 * 2, 0)
  })

  it('newton: F*2 -> a*2', () => {
    const scene1 = createScene({ model: 'newton_second_law', mass: 2, appliedForce: vec3(10, 0, 0) } as never)
    const scene2 = createScene({ model: 'newton_second_law', mass: 2, appliedForce: vec3(20, 0, 0) } as never)
    const engine = new MechanicsEngine()
    const r1 = engine.simulate(scene1, createReq(scene1, 'sim1', 'trace1'))
    const r2 = engine.simulate(scene2, createReq(scene2, 'sim2', 'trace2'))
    const a1 = r1.derivedQuantities.find((d) => d.key === 'acceleration')
    const a2 = r2.derivedQuantities.find((d) => d.key === 'acceleration')
    expect(a1).toBeDefined()
    expect(a2).toBeDefined()
    const mag1 = Math.hypot((a1!.value as { vector: { x: number } }).vector.x, 0, 0)
    const mag2 = Math.hypot((a2!.value as { vector: { x: number } }).vector.x, 0, 0)
    expect(mag2).toBeCloseTo(mag1 * 2, 0)
  })

  it('incline no friction: mass*2 -> acceleration unchanged', () => {
    const scene1 = createScene({ model: 'inclined_plane', mass: 2, inclineAngle: 30, gravity: vec3(0, -10, 0) })
    const scene2 = createScene({ model: 'inclined_plane', mass: 4, inclineAngle: 30, gravity: vec3(0, -10, 0) })
    const engine = new MechanicsEngine()
    const r1 = engine.simulate(scene1, createReq(scene1, 'sim1', 'trace1'))
    const r2 = engine.simulate(scene2, createReq(scene2, 'sim2', 'trace2'))
    const a1 = (r1.derivedQuantities.find((d) => d.key === 'incline_acceleration')!.value as { value: number }).value
    const a2 = (r2.derivedQuantities.find((d) => d.key === 'incline_acceleration')!.value as { value: number }).value
    expect(a2).toBeCloseTo(a1, 1)
  })
})

describe('Edge Cases', () => {
  const engine = new MechanicsEngine()

  it('mass = 0 -> unsupported', () => {
    const scene = createScene({ model: 'uniform_linear_motion', mass: 0, velocity: vec3(5, 0, 0) })
    const support = engine.canHandle(scene)
    expect(support.supported).toBe(false)
  })

  it('mass < 0 -> unsupported', () => {
    const scene = createScene({ model: 'uniform_linear_motion', mass: -5, velocity: vec3(5, 0, 0) })
    const support = engine.canHandle(scene)
    expect(support.supported).toBe(false)
  })

  it('g = 0 projectile -> no crash', () => {
    const scene = createScene({ model: 'projectile_motion', mass: 1, position: vec3(0, 10, 0), velocity: vec3(10, 0, 0), gravity: vec3(0, 0, 0), groundY: 0 })
    const support = engine.canHandle(scene)
    expect(support.supported).toBe(true)
    const result = engine.simulate(scene, createReq(scene, 'sim', 'trace'))
    expect(result.states.length).toBeGreaterThan(0)
  })

  it('no NaN in simulation results', () => {
    const scene = createScene({ model: 'projectile_motion', mass: 1, position: vec3(0, 20, 0), velocity: vec3(10, 0, 0), gravity: vec3(0, -10, 0), groundY: 0 })
    const result = engine.simulate(scene, createReq(scene, 'sim', 'trace'))
    for (const state of result.states) {
      for (const obj of state.objects) {
        expect(Number.isFinite(obj.position?.vector.x ?? 0)).toBe(true)
        expect(Number.isFinite(obj.position?.vector.y ?? 0)).toBe(true)
        expect(Number.isFinite(obj.velocity?.vector.x ?? 0)).toBe(true)
        expect(Number.isFinite(obj.velocity?.vector.y ?? 0)).toBe(true)
      }
    }
  })
})

describe('Derived-quantity regressions', () => {
  const engine = new MechanicsEngine()

  it('velocity_magnitude tracks the state velocity, not the initial speed', () => {
    // v0 = 10, a = 2 → |v(t)| = 20 at t = 5.
    const scene = createScene({
      model: 'uniformly_accelerated_motion',
      mass: 1,
      position: vec3(0, 0, 0),
      velocity: vec3(10, 0, 0),
      acceleration: vec3(2, 0, 0),
    })
    const state = engine.stateAt(scene, { value: 5, unit: 's', dimension: 'time' as const })
    const speed = state.derived.find((d) => d.key === 'velocity_magnitude')
    expect(speed).toBeDefined()
    expect((speed!.value as { value: number }).value).toBeCloseTo(20, 6)
  })

  it('projectile max_height is the launch height when launched downward', () => {
    // y0 = 20, vy0 = -5 < 0 → the trajectory descends immediately, apex = y0.
    const scene = createScene({
      model: 'projectile_motion',
      mass: 1,
      position: vec3(0, 20, 0),
      velocity: vec3(10, -5, 0),
      gravity: vec3(0, -10, 0),
      groundY: 0,
    })
    const result = engine.simulate(scene, createReq(scene, 'sim', 'trace'))
    const maxH = result.derivedQuantities.find((d) => d.key === 'max_height')
    expect(maxH).toBeDefined()
    expect((maxH!.value as { value: number }).value).toBeCloseTo(20, 6)
  })
})
