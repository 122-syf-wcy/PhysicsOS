import { describe, expect, it } from 'vitest'

import { derivedScalar } from '@physicsos/physics-core'
import {
  createBarMotionScene,
  createDoubleBarRailScene,
  createFluxChangeScene,
  createInductionScene,
  SceneRuntime,
  createSceneCommand,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'

import {
  DOUBLE_BAR_RAIL_MODEL,
  INDUCTION_ENGINE_ID,
  createInductionSimulationRequest,
  inductionEngine,
  resolveInductionModel,
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
      commandId: `cmd-${type}`,
      sceneId: String(scene.id),
      expectedRevision: scene.revision,
      type,
      payload,
      traceId: `trace-${type}`,
    }) as SceneCommand,
  )
}

const simulated = (scene: PhysicsScene) =>
  inductionEngine.simulate(
    scene,
    createInductionSimulationRequest(scene, 'sim-induction', 'trace-induction'),
  )

/** The engine's exact state at a time — closed form, not a sampled neighbour. */
const stateAt = (scene: PhysicsScene, t: number) =>
  inductionEngine.stateAt(scene, quantity(t, 's', 'time'))

const derivedAt = (scene: PhysicsScene, t: number, key: string): number =>
  derivedScalar(stateAt(scene, t).derived, key).value

const objectXAt = (scene: PhysicsScene, t: number, id: string): number =>
  stateAt(scene, t).objects.find((o) => o.id === id)?.position?.vector.x ?? Number.NaN

/* ------------------------------------------------- double_bar_rail · free -- */

describe('Induction Engine · double_bar_rail (momentum pair)', () => {
  /* Template defaults: B = 0.5 T, L = 0.2 m, R = 0.1 Ω, m₁ = m₂ = 0.05 kg,
     bar 1 AHEAD at x = +0.2 m moving at 2 m/s, bar 2 at −0.2 m at rest.
     Coupling α = B²L²/R = 0.1 kg/s; μ = 0.025 kg; τ = μ/α = 0.25 s;
     v_cm = 1 m/s constant (momentum conserved); u(t) = 2e^(−4t). */
  const scene = createDoubleBarRailScene({ sceneId: 'db-momentum' })
  const result = simulated(scene)
  const model = resolveInductionModel(scene)
  const TAU = 0.25

  it('resolves the double-bar bench into canonical SI', () => {
    expect(model.subModel).toBe('double_bar_rail')
    expect(model.magneticFluxDensity).toBeCloseTo(0.5, 12)
    expect(model.barLength).toBeCloseTo(0.2, 12)
    expect(model.resistance).toBeCloseTo(0.1, 12)
    expect(model.barMasses).toEqual([0.05, 0.05])
    expect(model.barVelocities).toEqual([2, 0])
    expect(model.barPositions).toEqual([0.2, -0.2])
    expect(model.externalForce).toBe(0)
    expect(model.centreOfMassVelocity).toBeCloseTo(1, 12)
  })

  it('reports double_bar_rail through canHandle', () => {
    const support = inductionEngine.canHandle(scene)
    expect(support.supported).toBe(true)
    expect(support).toMatchObject({ modelId: DOUBLE_BAR_RAIL_MODEL, domain: 'induction' })
  })

  it('stamps a 4 s timeline (16 τ — the exchange completes, then the pair drifts)', () => {
    expect(scene.timeline.endTime?.value).toBeCloseTo(4, 12)
  })

  it('computes E₀ = BL(v₁−v₂) = 0.2 V, I₀ = 2 A and F磁₀ = −0.2 N at t = 0', () => {
    expect(derivedAt(scene, 0, 'induced_emf')).toBeCloseTo(0.2, 12)
    expect(derivedAt(scene, 0, 'induced_current')).toBeCloseTo(2, 12)
    expect(derivedAt(scene, 0, 'magnetic_force')).toBeCloseTo(-0.2, 12)
  })

  it('decays the EMF as e^(−t/τ): E(τ) = 0.2/e', () => {
    expect(derivedAt(scene, TAU, 'induced_emf')).toBeCloseTo(0.2 * Math.exp(-1), 12)
    expect(derivedAt(scene, 2 * TAU, 'induced_emf')).toBeCloseTo(0.2 * Math.exp(-2), 12)
  })

  it('shares the momentum: v₁(τ) = 1 + 1/e, v₂(τ) = 1 − 1/e, both → 1 m/s', () => {
    expect(derivedAt(scene, TAU, 'bar1_velocity')).toBeCloseTo(1 + Math.exp(-1), 12)
    expect(derivedAt(scene, TAU, 'bar2_velocity')).toBeCloseTo(1 - Math.exp(-1), 12)
    expect(derivedAt(scene, 4, 'bar1_velocity')).toBeCloseTo(1, 6)
    expect(derivedAt(scene, 4, 'bar2_velocity')).toBeCloseTo(1, 6)
  })

  it('conserves momentum across every sampled state: p₁ + p₂ ≡ 0.1 kg·m/s', () => {
    for (const state of result.states) {
      const p1 = derivedScalar(state.derived, 'momentum1').value
      const p2 = derivedScalar(state.derived, 'momentum2').value
      expect(p1 + p2).toBeCloseTo(0.1, 10)
    }
  })

  it('keeps the leading bar ahead — the gap grows from 0.4 m toward 0.4 + τ·u₀ = 0.9 m', () => {
    const gapAt = (t: number) =>
      objectXAt(scene, t, 'induction-bench-1.bar1') - objectXAt(scene, t, 'induction-bench-1.bar2')
    expect(gapAt(0)).toBeCloseTo(0.4, 12)
    expect(gapAt(TAU)).toBeCloseTo(0.4 + 0.5 * (1 - Math.exp(-1)), 9)
    expect(gapAt(4)).toBeCloseTo(0.9, 6)
    for (const t of [0, 0.1, 0.5, 1, 2, 4]) expect(gapAt(t)).toBeGreaterThan(0.4 - 1e-12)
  })

  it('integrates both positions in closed form (x₁(4) = 4.45 m, x₂(4) = 3.55 m)', () => {
    expect(objectXAt(scene, 4, 'induction-bench-1.bar1')).toBeCloseTo(4.45, 6)
    expect(objectXAt(scene, 4, 'induction-bench-1.bar2')).toBeCloseTo(3.55, 6)
  })

  it('closes the energy account: K + Q = K₀ = 0.1 J (no external work)', () => {
    expect(derivedAt(scene, 0, 'kinetic_energy')).toBeCloseTo(0.1, 12)
    for (const t of [TAU, 1, 4]) {
      const K = derivedAt(scene, t, 'kinetic_energy')
      const Q = derivedAt(scene, t, 'joule_heat')
      expect(K + Q).toBeCloseTo(0.1, 10)
    }
    /* Half the initial kinetic energy is dissipated once the pair moves as one. */
    expect(derivedAt(scene, 4, 'joule_heat')).toBeCloseTo(0.05, 6)
  })

  it('publishes the momentum/energy verification set on the free pair', () => {
    const ids = result.verification.checks.map((c) => c.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'faraday_law',
        'lenz_direction',
        'ohm_law_loop',
        'momentum_conservation',
        'energy_bookkeeping',
        'lenz_force_opposes_relative_motion',
      ]),
    )
    for (const c of result.verification.checks) {
      expect(c.passed, c.id).toBe(true)
    }
  })

  it('the magnetic force opposes the relative motion at every state', () => {
    for (const state of result.states) {
      const F = derivedScalar(state.derived, 'magnetic_force').value
      const u = derivedScalar(state.derived, 'relative_velocity').value
      if (Math.abs(u) > 1e-12) expect(F * u).toBeLessThanOrEqual(0)
    }
  })

  it('doubles τ when R doubles (E decays twice as slowly)', () => {
    const slower = createDoubleBarRailScene({ resistance: 0.2 })
    /* τ = 0.5 s → E(0.5) = 0.2/e. */
    expect(derivedAt(slower, 0.5, 'induced_emf')).toBeCloseTo(0.2 * Math.exp(-1), 12)
  })

  it('quarters τ when B doubles (coupling α ∝ B²) and doubles E₀', () => {
    const faster = createDoubleBarRailScene({ magneticFluxDensity: 1 })
    /* α = 0.4 → τ = 0.0625 s; E₀ = BLu₀ = 0.4 V → E(τ) = 0.4/e. */
    expect(derivedAt(faster, 0, 'induced_emf')).toBeCloseTo(0.4, 12)
    expect(derivedAt(faster, 0.0625, 'induced_emf')).toBeCloseTo(0.4 * Math.exp(-1), 12)
  })
})

/* ------------------------------------------ double_bar_rail · driven pair -- */

describe('Induction Engine · double_bar_rail (constant force)', () => {
  /* F = 0.1 N on bar 1, both bars at rest. u∞ = F·m₂/(αM) = 0.5 m/s;
     a = F/M = 1 m/s²; I∞ = F·m₂/(BL·M) = 0.5 A; W = F·(x₁ − x₁₀) closes K + Q. */
  const scene = createDoubleBarRailScene({
    sceneId: 'db-force',
    barVelocities: [0, 0],
    externalForce: 0.1,
  })
  const result = simulated(scene)
  const model = resolveInductionModel(scene)

  it('carries the external force and the drifting centre of mass', () => {
    expect(model.externalForce).toBeCloseTo(0.1, 12)
    /* v_cm(T) = a·T = 1 × 4 = 4 m/s. */
    expect(model.centreOfMassVelocity).toBeCloseTo(4, 12)
  })

  it('approaches the terminal relative velocity u∞ = 0.5 m/s', () => {
    expect(derivedAt(scene, 0.25, 'relative_velocity')).toBeCloseTo(0.5 * (1 - Math.exp(-1)), 12)
    expect(derivedAt(scene, 4, 'relative_velocity')).toBeCloseTo(0.5, 6)
  })

  it('reaches the terminal current I∞ = F·m₂/(BL·M) = 0.5 A', () => {
    expect(derivedAt(scene, 4, 'induced_current')).toBeCloseTo(0.5, 6)
  })

  it('does NOT emit momentum_conservation under an external force', () => {
    const ids = result.verification.checks.map((c) => c.id)
    expect(ids).not.toContain('momentum_conservation')
    expect(ids).toContain('energy_bookkeeping')
  })

  it('closes the energy account against the external work W = F·Δx₁', () => {
    for (const t of [0.5, 2, 4]) {
      const K = derivedAt(scene, t, 'kinetic_energy')
      const Q = derivedAt(scene, t, 'joule_heat')
      const work = 0.1 * (objectXAt(scene, t, 'induction-bench-1.bar1') - 0.2)
      expect(K + Q).toBeCloseTo(work, 9)
    }
  })

  it('accelerates the pair together at a = F/(m₁+m₂) = 1 m/s²', () => {
    const v1 = derivedAt(scene, 4, 'bar1_velocity')
    const v2 = derivedAt(scene, 4, 'bar2_velocity')
    expect((v1 + v2) / 2).toBeCloseTo(4, 9)
  })
})

/* --------------------------------------------- double_bar_rail · commands -- */

describe('Induction double-bar scene commands', () => {
  it('sets both masses with mixed units (g for the edited bar, kg for the other)', () => {
    const runtime = new SceneRuntime(createDoubleBarRailScene({ sceneId: 'db-cmd' }))
    const result = execute(runtime, 'SetInductionBarMasses', {
      benchId: 'induction-bench-1',
      masses: [quantity(200, 'g', 'mass'), quantity(0.05, 'kg', 'mass')],
    })
    expect(result.ok).toBe(true)
    expect(runtime.getEvents().at(-1)?.type).toBe('InductionBarMassesChanged')
    const model = resolveInductionModel(runtime.getScene())
    expect(model.barMasses).toEqual([0.2, 0.05])
  })

  it('sets either bar velocity by index', () => {
    const runtime = new SceneRuntime(createDoubleBarRailScene({ sceneId: 'db-cmd2' }))
    expect(
      execute(runtime, 'SetInductionBarVelocityOne', {
        benchId: 'induction-bench-1',
        barIndex: 2,
        velocity: quantity(-2, 'm/s', 'velocity'),
      }).ok,
    ).toBe(true)
    let model = resolveInductionModel(runtime.getScene())
    expect(model.barVelocities).toEqual([2, -2])
    expect(
      execute(runtime, 'SetInductionBarVelocityOne', {
        benchId: 'induction-bench-1',
        barIndex: 1,
        velocity: quantity(3, 'm/s', 'velocity'),
      }).ok,
    ).toBe(true)
    model = resolveInductionModel(runtime.getScene())
    expect(model.barVelocities).toEqual([3, -2])
  })

  it('sets the external force and rejects a negative one', () => {
    const runtime = new SceneRuntime(createDoubleBarRailScene({ sceneId: 'db-cmd3' }))
    expect(
      execute(runtime, 'SetInductionExternalForce', {
        benchId: 'induction-bench-1',
        force: quantity(0.02, 'N', 'force'),
      }).ok,
    ).toBe(true)
    expect(resolveInductionModel(runtime.getScene()).externalForce).toBeCloseTo(0.02, 12)

    const negative = execute(runtime, 'SetInductionExternalForce', {
      benchId: 'induction-bench-1',
      force: quantity(-1, 'N', 'force'),
    })
    expect(negative.ok).toBe(false)
    if (negative.ok) throw new Error('Expected rejection.')
    expect(negative.error.code).toBe('INVALID_INDUCTION_EXTERNAL_FORCE')
  })

  it('rejects double-bar commands on other sub-models (WRONG_SUBMODEL)', () => {
    const runtime = new SceneRuntime(createBarMotionScene())
    const masses = execute(runtime, 'SetInductionBarMasses', {
      benchId: 'induction-bench-1',
      masses: [quantity(0.1, 'kg', 'mass'), quantity(0.1, 'kg', 'mass')],
    })
    expect(masses.ok).toBe(false)
    if (masses.ok) throw new Error('Expected rejection.')
    expect(masses.error.code).toBe('INDUCTION_WRONG_SUBMODEL')

    const velocity = execute(runtime, 'SetInductionBarVelocityOne', {
      benchId: 'induction-bench-1',
      barIndex: 1,
      velocity: quantity(1, 'm/s', 'velocity'),
    })
    expect(velocity.ok).toBe(false)
  })

  it('accepts SetInductionBarLength on a double_bar_rail bench (rail spacing)', () => {
    const runtime = new SceneRuntime(createDoubleBarRailScene({ sceneId: 'db-cmd4' }))
    const result = execute(runtime, 'SetInductionBarLength', {
      benchId: 'induction-bench-1',
      length: quantity(30, 'cm', 'length'),
    })
    expect(result.ok).toBe(true)
    expect(resolveInductionModel(runtime.getScene()).barLength).toBeCloseTo(0.3, 12)
  })

  it('still rejects SetInductionBarLength on a flux_change bench', () => {
    const runtime = new SceneRuntime(createFluxChangeScene())
    const result = execute(runtime, 'SetInductionBarLength', {
      benchId: 'induction-bench-1',
      length: quantity(30, 'cm', 'length'),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected rejection.')
    expect(result.error.code).toBe('INDUCTION_WRONG_SUBMODEL')
  })

  it('rejects a bench with a non-positive bar mass at resolve time', () => {
    const bad = createInductionScene({
      sceneId: 'db-bad',
      bench: {
        type: 'double_bar_rail',
        magneticFluxDensity: 0.5,
        barLength: 20,
        resistance: 0.1,
        barMasses: [50, 0],
        barVelocities: [2, 0],
        barPositions: [20, -20],
      },
    })
    expect(() => resolveInductionModel(bad)).toThrow()
    expect(inductionEngine.canHandle(bad).supported).toBe(false)
  })

  it('keeps the engine identity traceable on double-bar results', () => {
    const result = simulated(createDoubleBarRailScene({ sceneId: 'db-id' }))
    expect(result.metadata.engineId).toBe(INDUCTION_ENGINE_ID)
    expect(result.states.length).toBeGreaterThan(10)
  })
})
