import { describe, expect, it } from 'vitest'
import { derivedScalar, derivedVector, toCanonicalVector } from '@physicsos/physics-core'
import { createCollisionScene, validateScene } from '@physicsos/physics-scene'
import { collisionEngine, detectCollisionModel, type CollisionEngine } from '../src/index.ts'

const engine: CollisionEngine = collisionEngine

const simulate = (scene: Parameters<CollisionEngine['simulate']>[0], duration = 10) =>
  engine.simulate(scene, {
    schemaVersion: 'simulation-request/1.0',
    simulationId: 'sim-1' as never,
    sceneId: scene.id,
    sceneRevision: scene.revision,
    requestedDomain: 'mechanics',
    options: { endTime: { value: duration, unit: 's', dimension: 'time' } },
    trace: {
      traceId: 'trace-1' as never,
      sceneId: scene.id,
      sceneRevision: scene.revision,
    },
  })

const totalMomentumAt = (state: ReturnType<typeof simulate>['states'][number]) => {
  const total = derivedVector(state.derived, 'total_momentum')
  return toCanonicalVector(total).vectorSI
}

const totalEnergyAt = (state: ReturnType<typeof simulate>['states'][number]) =>
  derivedScalar(state.derived, 'total_kinetic_energy').value

describe('engine-collision · model detection', () => {
  it('classifies all-restitution-1 scenes as elastic', () => {
    const scene = createCollisionScene({
      bodies: [
        { id: 'a', mass: 1, position: [-2, 0], velocity: [1, 0], restitution: 1 },
        { id: 'b', mass: 1, position: [2, 0], velocity: [-1, 0], restitution: 1 },
      ],
    })
    expect(detectCollisionModel(scene)).toBe('elastic_collision')
  })

  it('classifies all-restitution-0 scenes as perfectly inelastic', () => {
    const scene = createCollisionScene({
      bodies: [
        { id: 'a', mass: 1, position: [-2, 0], velocity: [1, 0], restitution: 0 },
        { id: 'b', mass: 1, position: [2, 0], velocity: [-1, 0], restitution: 0 },
      ],
    })
    expect(detectCollisionModel(scene)).toBe('perfectly_inelastic_collision')
  })

  it('classifies a mixed scene as inelastic', () => {
    const scene = createCollisionScene({
      bodies: [
        { id: 'a', mass: 1, position: [-2, 0], velocity: [1, 0], restitution: 1 },
        { id: 'b', mass: 1, position: [2, 0], velocity: [-1, 0], restitution: 0.5 },
      ],
    })
    expect(detectCollisionModel(scene)).toBe('inelastic_collision')
  })

  it('rejects single-body scenes', () => {
    const scene = createCollisionScene({
      bodies: [{ id: 'a', mass: 1, position: [0, 0], velocity: [1, 0] }],
    })
    expect(engine.canHandle(scene).supported).toBe(false)
  })
})

describe('engine-collision · elastic collisions', () => {
  it('equal masses exchange velocities on a head-on collision', () => {
    const scene = createCollisionScene({
      bodies: [
        { id: 'a', mass: 1, position: [-2, 0], velocity: [2, 0] },
        { id: 'b', mass: 1, position: [2, 0], velocity: [-1, 0] },
      ],
    })
    const result = simulate(scene)
    /* After the elastic exchange a should carry -1 and b should carry 2. */
    const finalA = result.states[result.states.length - 1]?.objects.find(o => o.id === 'a')?.velocity
    const finalB = result.states[result.states.length - 1]?.objects.find(o => o.id === 'b')?.velocity
    const va = toCanonicalVector(finalA as never).vectorSI
    const vb = toCanonicalVector(finalB as never).vectorSI
    expect(va.x).toBeCloseTo(-1, 1)
    expect(vb.x).toBeCloseTo(2, 1)
  })

  it('unequal masses follow the analytic impulse solution and conserve p and K', () => {
    /* m1=1, v1=3; m2=3, v2=-1 → v1' = -3, v2' = 1 (analytic for elastic). */
    const scene = createCollisionScene({
      bodies: [
        { id: 'a', mass: 1, position: [-4, 0], velocity: [3, 0] },
        { id: 'b', mass: 3, position: [4, 0], velocity: [-1, 0] },
      ],
    })
    const result = simulate(scene, 20)
    const states = result.states
    expect(states.length).toBeGreaterThan(0)

    const first = states[0] as NonNullable<(typeof states)[number]>
    const last = states[states.length - 1] as NonNullable<(typeof states)[number]>
    const p0 = totalMomentumAt(first)
    const pEnd = totalMomentumAt(last)
    expect(pEnd.x).toBeCloseTo(p0.x, 6)
    expect(pEnd.y).toBeCloseTo(p0.y, 6)
    expect(totalEnergyAt(first)).toBeCloseTo(totalEnergyAt(last), 6)

    const finalA = last.objects.find(o => o.id === 'a')?.velocity
    const finalB = last.objects.find(o => o.id === 'b')?.velocity
    const va = toCanonicalVector(finalA as never).vectorSI
    const vb = toCanonicalVector(finalB as never).vectorSI
    expect(va.x).toBeCloseTo(-3, 1)
    expect(vb.x).toBeCloseTo(1, 1)
  })

  it('passes momentum and energy conservation checks', () => {
    const scene = createCollisionScene({
      bodies: [
        { id: 'a', mass: 2, position: [-3, 0], velocity: [1.5, 0] },
        { id: 'b', mass: 1, position: [3, 0], velocity: [-2, 0] },
      ],
    })
    const result = simulate(scene, 15)
    const ids = result.verification.checks.map(c => c.id)
    expect(ids).toContain('momentum_conservation')
    expect(ids).toContain('energy_conservation')
    const momentumCheck = result.verification.checks.find(c => c.id === 'momentum_conservation')
    expect(momentumCheck?.passed).toBe(true)
    const energyCheck = result.verification.checks.find(c => c.id === 'energy_conservation')
    expect(energyCheck?.passed).toBe(true)
  })
})

describe('engine-collision · perfectly inelastic', () => {
  it('the pair sticks and moves at the common centre-of-mass velocity', () => {
    /* m1=1, v1=2; m2=3, v2=0 → v_cm = 0.5. */
    const scene = createCollisionScene({
      bodies: [
        { id: 'a', mass: 1, position: [-3, 0], velocity: [2, 0], restitution: 0 },
        { id: 'b', mass: 3, position: [3, 0], velocity: [0, 0], restitution: 0 },
      ],
    })
    const result = simulate(scene, 20)
    const last = result.states[result.states.length - 1] as NonNullable<(typeof result.states)[number]>
    const va = toCanonicalVector(last.objects.find(o => o.id === 'a')?.velocity as never).vectorSI
    const vb = toCanonicalVector(last.objects.find(o => o.id === 'b')?.velocity as never).vectorSI
    expect(va.x).toBeCloseTo(0.5, 2)
    expect(vb.x).toBeCloseTo(0.5, 2)
    /* Momentum still conserved. */
    const first = result.states[0] as NonNullable<(typeof result.states)[number]>
    const p0 = totalMomentumAt(first)
    const pEnd = totalMomentumAt(last)
    expect(pEnd.x).toBeCloseTo(p0.x, 6)
    /* Kinetic energy is lost. */
    expect(totalEnergyAt(last)).toBeLessThan(totalEnergyAt(first))
  })

  it('does not assert energy conservation for a lossy model', () => {
    const scene = createCollisionScene({
      bodies: [
        { id: 'a', mass: 1, position: [-3, 0], velocity: [2, 0], restitution: 0 },
        { id: 'b', mass: 3, position: [3, 0], velocity: [0, 0], restitution: 0 },
      ],
    })
    const result = simulate(scene, 15)
    const ids = result.verification.checks.map(c => c.id)
    expect(ids).toContain('momentum_conservation')
    expect(ids).not.toContain('energy_conservation')
  })
})

describe('engine-collision · partial restitution', () => {
  it('reproduces e = -(vB\' - vA\') / (vB - vA) along the normal', () => {
    const e = 0.5
    const scene = createCollisionScene({
      bodies: [
        { id: 'a', mass: 1, position: [-3, 0], velocity: [3, 0], restitution: e },
        { id: 'b', mass: 1, position: [3, 0], velocity: [-1, 0], restitution: e },
      ],
    })
    const result = simulate(scene, 20)
    const last = result.states[result.states.length - 1] as NonNullable<(typeof result.states)[number]>
    const va = toCanonicalVector(last.objects.find(o => o.id === 'a')?.velocity as never).vectorSI
    const vb = toCanonicalVector(last.objects.find(o => o.id === 'b')?.velocity as never).vectorSI
    const closing = -1 - 3 // vB0 - vA0 = -4
    const separating = vb.x - va.x
    expect(separating / closing).toBeCloseTo(-e, 3)
  })
})

describe('engine-collision · boundary reflection', () => {
  it('reflects the normal velocity component off a wall with the boundary restitution', () => {
    const scene = createCollisionScene({
      bodies: [
        { id: 'a', mass: 1, position: [0, 0], velocity: [2, 0] },
        { id: 'b', mass: 1, position: [8, 0], velocity: [0, 0] },
      ],
      boundary: { width: 10, height: 10 },
      boundaryRestitution: 1,
    })
    const result = simulate(scene, 10)
    const events = result.events
    /* b stays put; a bounces off the right wall, so it changes sign at least once. */
    const vxSeries = result.states.map(s =>
      toCanonicalVector(s.objects.find(o => o.id === 'a')?.velocity as never).vectorSI.x)
    const minVx = Math.min(...vxSeries)
    const maxVx = Math.max(...vxSeries)
    expect(minVx).toBeLessThan(0)
    expect(maxVx).toBeGreaterThan(0)
    /* With e=1 the speed magnitude is preserved. */
    const first = result.states[0] as NonNullable<(typeof result.states)[number]>
    const last = result.states[result.states.length - 1] as NonNullable<(typeof result.states)[number]>
    const v0 = Math.hypot(...Object.values(totalMomentumAt(first)).map((v, i) => (i < 2 ? v : 0)))
    const vEnd = Math.hypot(totalMomentumAt(last).x, totalMomentumAt(last).y)
    expect(Math.abs(vEnd - v0)).toBeLessThan(1e-6)
    void events
  })

  it('still verifies a bounded elastic scene — wall impulses are external, not violations', () => {
    /* Walls inject external momentum, so Σp is only an invariant up to the
       first wall contact; asserting it across the whole run fails the scene. */
    const scene = createCollisionScene({
      bodies: [
        { id: 'ball-a', mass: 1, position: [-2.4, 0], velocity: [2, 0], radius: 0.5, restitution: 1 },
        { id: 'ball-b', mass: 1, position: [2.4, 0], velocity: [-1.5, 0], radius: 0.5, restitution: 1 },
      ],
      boundary: { width: 12, height: 5 },
      boundaryRestitution: 1,
    })
    const result = simulate(scene, 10)
    expect(result.verification.status).toBe('passed')
    const momentum = result.verification.checks.find(c => c.id === 'momentum_conservation')
    expect(momentum?.passed).toBe(true)
    /* The run really did bounce off walls, so the check must be a windowed
       one rather than a skipped one. */
    expect(momentum?.message).toContain('碰壁')
  })
})

describe('engine-collision · events', () => {
  it('publishes CollisionOccurred events with a plausible time', () => {
    const scene = createCollisionScene({
      bodies: [
        { id: 'a', mass: 1, position: [-3, 0], velocity: [1, 0] },
        { id: 'b', mass: 1, position: [3, 0], velocity: [-1, 0] },
      ],
    })
    const result = simulate(scene, 10)
    const collisions = result.events.filter(e => e.type === 'CollisionOccurred')
    expect(collisions.length).toBeGreaterThan(0)
    /* Balls start 6 m apart closing at 2 m/s → first contact near t = 2.5 s. */
    const firstCollision = collisions[0]
    expect(firstCollision?.time).toBeDefined()
    expect(firstCollision?.time).toBeGreaterThan(1)
    expect(firstCollision?.time).toBeLessThan(4)
    expect(firstCollision?.bodyA).toBeDefined()
    expect(firstCollision?.bodyB).toBeDefined()
    expect(firstCollision?.impactSpeed).toBeGreaterThan(0)
  })
})

describe('engine-collision · scene factory validity', () => {
  it('creates a scene that passes validateScene', () => {
    const scene = createCollisionScene({
      bodies: [
        { id: 'a', mass: 1, position: [-2, 0], velocity: [1, 0], radius: 0.5 },
        { id: 'b', mass: 2, position: [2, 0], velocity: [-1, 0], radius: 0.6, restitution: 0.8 },
      ],
      boundary: { width: 10, height: 6 },
      title: '弹性碰撞实验',
    })
    const verification = validateScene(scene)
    expect(verification.status).toBe('passed')
    expect(scene.bodies).toHaveLength(2)
    expect(scene.boundaries).toHaveLength(1)
  })
})