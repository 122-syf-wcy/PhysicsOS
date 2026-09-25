import { describe, expect, it } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { isScalarQuantity } from '@physicsos/physics-core'

import { MechanicsEngine, createMechanicsSimulationRequest } from '../src/index.ts'
import { detectMechanicsModel } from '../src/mechanics-model-selector.ts'

/* The ISS again, this time through the whole chain: factory → selector →
   resolver → engine → checks. */
type OrbitInput = Partial<Omit<Parameters<typeof createMechanicsScene>[0], 'model'>>

const orbitScene = (input: OrbitInput = {}) =>
  createMechanicsScene({ ...input, model: 'circular_orbit', mass: input.mass ?? 420_000 })

const engine = new MechanicsEngine()

const simulate = (scene: ReturnType<typeof orbitScene>) =>
  engine.simulate(scene, createMechanicsSimulationRequest(scene, 'sim-orbit', 'trace-orbit'))

const scalarOf = (scene: ReturnType<typeof orbitScene>, key: string): number => {
  const derived = simulate(scene).derivedQuantities.find((entry) => entry.key === key)
  if (derived === undefined) throw new Error(`derived missing: ${key}`)
  if (!isScalarQuantity(derived.value)) throw new Error(`not scalar: ${key}`)
  return derived.value.value
}

describe('circular orbit through the engine', () => {
  it('is detected from its own orbit observable', () => {
    expect(detectMechanicsModel(orbitScene())).toBe('circular_orbit')
  })

  it('accepts the scene and reports the ISS numbers', () => {
    const scene = orbitScene()
    expect(engine.canHandle(scene).supported).toBe(true)
    expect(scalarOf(scene, 'orbit_radius')).toBeCloseTo(6.8e6, 6)
    expect(scalarOf(scene, 'orbital_speed')).toBeCloseTo(7656, 0)
    expect(scalarOf(scene, 'orbital_period')).toBeCloseTo(5580, -2)
  })

  it('verifies that gravity supplies exactly the centripetal force', () => {
    const result = simulate(orbitScene())
    const byId = (id: string) => result.verification.checks.find((c) => c.id === id)?.passed
    expect(byId('gravity_supplies_the_centripetal_force')).toBe(true)
    expect(byId('period_follows_keplers_third_law')).toBe(true)
    expect(result.verification.status).toBe('passed')
  })

  it('runs for exactly one period, and comes back to where it started', () => {
    const scene = orbitScene()
    const result = simulate(scene)
    const period = scalarOf(scene, 'orbital_period')
    const first = result.states[0]
    if (first === undefined) throw new Error('the run produced no states')
    const last = result.states.reduce((latest, state) =>
      state.time.value > latest.time.value ? state : latest,
    )
    expect(last.time.value).toBeCloseTo(period, 6)
    /* After one turn the satellite is back at (r, 0) — the circle closes. */
    const start = first.objects[0]?.position?.vector
    const end = last.objects[0]?.position?.vector
    expect(end?.x).toBeCloseTo(start?.x ?? NaN, 0)
    expect(end?.y).toBeCloseTo(start?.y ?? NaN, 0)
  })

  it('keeps the speed constant and the acceleration pointing inward', () => {
    const scene = orbitScene()
    const result = simulate(scene)
    for (const state of result.states) {
      const object = state.objects[0]
      const position = object?.position?.vector
      const velocity = object?.velocity?.vector
      const acceleration = object?.acceleration?.vector
      if (position === undefined || velocity === undefined || acceleration === undefined) {
        throw new Error('state lost its vectors')
      }
      /* Speed never changes — the force is perpendicular to it at every sample. */
      expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(7656, 0)
      /* And the acceleration points at the centre: a·r < 0, with no tangential
         component at all. */
      expect(acceleration.x * position.x + acceleration.y * position.y).toBeLessThan(0)
      expect(acceleration.x * velocity.x + acceleration.y * velocity.y).toBeCloseTo(0, 6)
    }
  })
})
