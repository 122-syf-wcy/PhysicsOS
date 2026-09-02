import { describe, expect, it } from 'vitest'

import { derivedScalar, isScalarQuantity } from '@physicsos/physics-core'
import {
  createBarMotionScene,
  createFluxChangeScene,
  createInductionScene,
  isInductionScene,
  SceneRuntime,
  createSceneCommand,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'

import {
  BAR_MOTION_EMF_MODEL,
  FLUX_CHANGE_EMF_MODEL,
  INDUCTION_ENGINE_ID,
  InductionEngine,
  createInductionSimulationRequest,
  inductionEngine,
  resolveInductionModel,
  type ResolvedInductionModel,
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
  inductionEngine.simulate(scene, createInductionSimulationRequest(scene, 'sim-induction', 'trace-induction'))

const scalar = (result: ReturnType<typeof simulated>, key: string): number =>
  derivedScalar(result.derivedQuantities, key).value

/* ------------------------------------------------------- bar_motion -- */

describe('Induction Engine · bar_motion_emf', () => {
  /* Default: B=0.5 T, L=20 cm, v=2 m/s, R=5 Ω → E = BLv = 0.5×0.20×2 = 0.20 V,
     I = E/R = 0.20/5 = 0.040 A. */

  it('1. resolves B, L, v, R into canonical SI', () => {
    const model = resolveInductionModel(createBarMotionScene())
    expect(model.subModel).toBe('bar_motion_emf')
    expect(model.magneticFluxDensity).toBeCloseTo(0.5, 12)
    expect(model.barLength).toBeCloseTo(0.20, 12) /* 20 cm → 0.20 m */
    expect(model.barVelocity).toBeCloseTo(2, 12)
    expect(model.resistance).toBeCloseTo(5, 12)
  })

  it('2. computes E = BLv = 0.20 V on the textbook defaults', () => {
    const result = simulated(createBarMotionScene())
    expect(scalar(result, 'induced_emf')).toBeCloseTo(0.20, 12)
  })

  it('3. computes I = E / R = 0.040 A on the textbook defaults', () => {
    const result = simulated(createBarMotionScene())
    expect(scalar(result, 'induced_current')).toBeCloseTo(0.040, 12)
  })

  it('4. publishes E and I as volts and amperes with the right dimensions', () => {
    const result = simulated(createBarMotionScene())
    const emf = result.derivedQuantities.find((entry) => entry.key === 'induced_emf')
    expect(emf !== undefined && isScalarQuantity(emf.value)).toBe(true)
    if (emf !== undefined && isScalarQuantity(emf.value)) {
      expect(emf.value.dimension).toBe('electric_potential')
      expect(emf.value.unit).toBe('V')
    }
    const current = result.derivedQuantities.find((entry) => entry.key === 'induced_current')
    expect(current !== undefined && isScalarQuantity(current.value)).toBe(true)
    if (current !== undefined && isScalarQuantity(current.value)) {
      expect(current.value.dimension).toBe('electric_current')
      expect(current.value.unit).toBe('A')
    }
  })

  it('5. gives the bar displacement x(t) = v·t and constant velocity at every sample', () => {
    const scene = createBarMotionScene()
    const result = simulated(scene)
    const t = 3 /* s */
    const state = result.states.find((candidate) => Math.abs(candidate.time.value - t) < 1e-9)
    const bar = state?.objects.find((entry) => entry.id === 'induction-bench-1.bar')
    expect(bar).toBeDefined()
    if (bar !== undefined && bar.position !== undefined && bar.velocity !== undefined) {
      expect(bar.position.vector.x).toBeCloseTo(2 * t, 9) /* v·t = 2×3 = 6 m */
      expect(bar.velocity.vector.x).toBeCloseTo(2, 9)
    }
  })

  it('6. keeps E constant across the entire run (constant v)', () => {
    const result = simulated(createBarMotionScene())
    const emfs = result.states.map((state) =>
      derivedScalar(state.derived, 'induced_emf').value,
    )
    expect(emfs.every((emf) => Math.abs(emf - 0.20) < 1e-9)).toBe(true)
  })

  it('7. doubles E when v doubles (E = BLv is linear in v)', () => {
    const before = simulated(createBarMotionScene({ barVelocity: 2 }))
    const after = simulated(createBarMotionScene({ barVelocity: 4 }))
    expect(scalar(after, 'induced_emf')).toBeCloseTo(scalar(before, 'induced_emf') * 2, 12)
    expect(scalar(after, 'induced_current')).toBeCloseTo(scalar(before, 'induced_current') * 2, 12)
  })

  it('8. halves E when B halves (E = BLv is linear in B)', () => {
    const before = simulated(createBarMotionScene({ magneticFluxDensity: 0.5 }))
    const after = simulated(createBarMotionScene({ magneticFluxDensity: 0.25 }))
    expect(scalar(after, 'induced_emf')).toBeCloseTo(scalar(before, 'induced_emf') / 2, 12)
  })

  it('9. reverses the Lenz direction sign when v reverses', () => {
    const positive = simulated(createBarMotionScene({ barVelocity: 2 }))
    const negative = simulated(createBarMotionScene({ barVelocity: -2 }))
    expect(scalar(positive, 'lenz_direction')).toBe(1)
    expect(scalar(negative, 'lenz_direction')).toBe(-1)
    expect(scalar(negative, 'induced_emf')).toBeCloseTo(-0.20, 12)
  })

  it('10. gives zero EMF when v = 0 (no flux cutting)', () => {
    const result = simulated(createBarMotionScene({ barVelocity: 0 }))
    expect(scalar(result, 'induced_emf')).toBeCloseTo(0, 12)
    expect(scalar(result, 'induced_current')).toBeCloseTo(0, 12)
    expect(scalar(result, 'lenz_direction')).toBe(0)
  })
})

/* ------------------------------------------------------- flux_change -- */

describe('Induction Engine · flux_change_emf', () => {
  /* Default: B=0.4 T, S=50 cm², θ=0, dΦ/dt=0.05 Wb/s, R=2 Ω →
     E = -dΦ/dt = -0.05 V (Lenz sign; magnitude 0.05 V),
     I = E/R = -0.025 A. */

  it('11. computes E = -dΦ/dt = -0.05 V on the textbook defaults (Lenz sign)', () => {
    const result = simulated(createFluxChangeScene())
    expect(scalar(result, 'induced_emf')).toBeCloseTo(-0.05, 12)
  })

  it('12. computes I = E / R = -0.025 A on the textbook defaults', () => {
    const result = simulated(createFluxChangeScene())
    expect(scalar(result, 'induced_current')).toBeCloseTo(-0.025, 12)
  })

  it('13. flips the EMF sign when dΦ/dt flips (Lenz law)', () => {
    const increasing = simulated(createFluxChangeScene({ fluxRate: 0.05 }))
    const decreasing = simulated(createFluxChangeScene({ fluxRate: -0.05 }))
    expect(scalar(increasing, 'induced_emf')).toBeCloseTo(-0.05, 12)
    expect(scalar(decreasing, 'induced_emf')).toBeCloseTo(0.05, 12)
  })

  it('14. computes the initial flux Φ = B·S·cosθ for the coil', () => {
    const model = resolveInductionModel(createFluxChangeScene()) as ResolvedInductionModel
    /* B = 0.4 T, S = 50 cm² = 5e-3 m², θ = 0 → Φ = 0.4 × 5e-3 × cos(0) = 2e-3 Wb */
    expect(model.initialFlux).toBeCloseTo(0.4 * 5e-3 * Math.cos(0), 12)
    expect(model.initialFlux).toBeCloseTo(2e-3, 12)
  })
})

/* ------------------------------------------------------- verification -- */

describe('Induction Engine · verification & support', () => {
  it('15. passes faraday_law, lenz_direction and ohm_law_loop on the bar_motion defaults', () => {
    const result = simulated(createBarMotionScene())
    expect(result.verification.status).toBe('passed')
    const ids = result.verification.checks.map((check) => check.id)
    expect(ids).toEqual(
      expect.arrayContaining(['faraday_law', 'lenz_direction', 'ohm_law_loop']),
    )
    expect(
      result.verification.checks.filter((check) =>
        ['faraday_law', 'lenz_direction', 'ohm_law_loop'].includes(check.id),
      ).every((check) => check.passed),
    ).toBe(true)
  })

  it('16. passes verification on the flux_change defaults', () => {
    const result = simulated(createFluxChangeScene())
    expect(result.verification.status).toBe('passed')
    expect(
      result.verification.checks.filter((check) =>
        ['faraday_law', 'lenz_direction', 'ohm_law_loop'].includes(check.id),
      ).every((check) => check.passed),
    ).toBe(true)
  })

  it('17. reports its own identity so results can be traced to this engine', () => {
    expect(new InductionEngine().engineId).toBe(INDUCTION_ENGINE_ID)
    expect(simulated(createBarMotionScene()).metadata.engineId).toBe(INDUCTION_ENGINE_ID)
  })

  it('18. accepts a pure bar_motion induction scene', () => {
    const scene = createBarMotionScene()
    expect(isInductionScene(scene)).toBe(true)
    expect(inductionEngine.canHandle(scene)).toMatchObject({
      supported: true,
      modelId: BAR_MOTION_EMF_MODEL,
      domain: 'induction',
    })
  })

  it('19. accepts a pure flux_change induction scene', () => {
    const scene = createFluxChangeScene()
    expect(isInductionScene(scene)).toBe(true)
    expect(inductionEngine.canHandle(scene)).toMatchObject({
      supported: true,
      modelId: FLUX_CHANGE_EMF_MODEL,
      domain: 'induction',
    })
  })

  it('20. rejects a scene without an induction bench', () => {
    const scene = createBarMotionScene()
    const support = inductionEngine.canHandle({ ...scene, inductionBenches: undefined })
    expect(support.supported).toBe(false)
  })

  it('21. rejects a scene with a zero magnetic flux density', () => {
    const scene = createInductionScene({
      bench: {
        type: 'bar_motion',
        magneticFluxDensity: 0,
        barLength: 20,
        barVelocity: 2,
        resistance: 5,
      },
    })
    expect(inductionEngine.canHandle(scene).supported).toBe(false)
  })

  it('22. rejects a scene with a zero loop resistance', () => {
    const scene = createInductionScene({
      bench: {
        type: 'bar_motion',
        magneticFluxDensity: 0.5,
        barLength: 20,
        barVelocity: 2,
        resistance: 0,
      },
    })
    expect(inductionEngine.canHandle(scene).supported).toBe(false)
  })

  it('23. rejects a scene with two induction benches', () => {
    const scene = createBarMotionScene()
    const bench = scene.inductionBenches?.[0]
    if (bench === undefined) throw new Error('Expected an induction bench.')
    const support = inductionEngine.canHandle({
      ...scene,
      inductionBenches: [bench, { ...bench, id: 'extra-bench' }],
    })
    expect(support.supported).toBe(false)
  })

  it('24. rejects a scene mixing induction with particles or circuits', () => {
    const scene = createBarMotionScene()
    const withParticle = {
      ...scene,
      particles: [
        {
          id: 'p1',
          type: 'particle' as const,
          mass: { value: 1, unit: 'kg', dimension: 'mass' as const },
          position: { vector: { x: 0, y: 0, z: 0 }, unit: 'm', dimension: 'length' as const },
          velocity: { vector: { x: 0, y: 0, z: 0 }, unit: 'm/s', dimension: 'velocity' as const },
        },
      ],
    }
    expect(inductionEngine.canHandle(withParticle).supported).toBe(false)
  })

  it('25. rejects a simulation request that does not match the scene revision', () => {
    const scene = createBarMotionScene()
    const request = createInductionSimulationRequest(scene, 'sim', 'trace')
    const mismatched = { ...request, sceneRevision: scene.revision + 1 }
    expect(() => inductionEngine.simulate(scene, mismatched)).toThrow()
  })
})

describe('Induction scene commands', () => {
  it('doubles the EMF through a real velocity command (E = BLv is linear in v)', () => {
    const runtime = new SceneRuntime(createBarMotionScene())
    const result = execute(runtime, 'SetInductionBarVelocity', {
      benchId: 'induction-bench-1',
      velocity: quantity(4, 'm/s', 'velocity'),
    })
    expect(result.ok).toBe(true)
    expect(runtime.getEvents().at(-1)?.type).toBe('InductionBarVelocityChanged')
    const emf = inducedEmfOf(runtime.getScene())
    expect(emf).toBeCloseTo(0.4, 12)
  })

  it('changes the loop resistance and the current follows I = E/R', () => {
    const runtime = new SceneRuntime(createBarMotionScene())
    expect(execute(runtime, 'SetInductionLoopResistance', {
      benchId: 'induction-bench-1',
      resistance: quantity(10, 'Ω', 'resistance'),
    }).ok).toBe(true)
    const result = inductionEngine.simulate(
      runtime.getScene(),
      createInductionSimulationRequest(runtime.getScene(), 'sim', 'trace'),
    )
    const current = derivedScalar(result.derivedQuantities, 'induced_current').value
    /* E stays 0.20 V (B, L, v untouched); I = 0.20/10 = 0.020 A. */
    expect(current).toBeCloseTo(0.02, 12)
  })

  it('flips the Lenz sign by reversing the velocity command', () => {
    const runtime = new SceneRuntime(createBarMotionScene())
    expect(execute(runtime, 'SetInductionBarVelocity', {
      benchId: 'induction-bench-1',
      velocity: quantity(-2, 'm/s', 'velocity'),
    }).ok).toBe(true)
    expect(inducedEmfOf(runtime.getScene())).toBeCloseTo(-0.2, 12)
  })

  it('edits the flux rate on a flux_change bench', () => {
    const runtime = new SceneRuntime(createFluxChangeScene())
    expect(execute(runtime, 'SetInductionFluxRate', {
      benchId: 'induction-bench-1',
      fluxRate: quantity(-0.1, 'Wb/s', 'magnetic_flux_rate'),
    }).ok).toBe(true)
    const model = resolveInductionModel(runtime.getScene())
    /* E = -dΦ/dt = +0.1 V after the flip. */
    expect(model.fluxRate).toBeCloseTo(-0.1, 12)
  })

  it('rejects a non-positive field or resistance rather than silently zeroing', () => {
    const runtime = new SceneRuntime(createBarMotionScene())
    const zeroField = execute(runtime, 'SetInductionFieldStrength', {
      benchId: 'induction-bench-1',
      strength: quantity(0, 'T', 'magnetic_flux_density'),
    })
    expect(zeroField.ok).toBe(false)
    if (zeroField.ok) throw new Error('Expected command rejection.')
    expect(zeroField.error.code).toBe('INVALID_INDUCTION_FIELD')

    const negativeResistance = execute(runtime, 'SetInductionLoopResistance', {
      benchId: 'induction-bench-1',
      resistance: quantity(-1, 'Ω', 'resistance'),
    })
    expect(negativeResistance.ok).toBe(false)
  })

  it('rejects a sub-model mismatch and a missing bench', () => {
    const barRuntime = new SceneRuntime(createBarMotionScene())
    const fluxCommandOnBar = execute(barRuntime, 'SetInductionFluxRate', {
      benchId: 'induction-bench-1',
      fluxRate: quantity(0.05, 'Wb/s', 'magnetic_flux_rate'),
    })
    expect(fluxCommandOnBar.ok).toBe(false)
    if (fluxCommandOnBar.ok) throw new Error('Expected command rejection.')
    expect(fluxCommandOnBar.error.code).toBe('INDUCTION_WRONG_SUBMODEL')

    const missingBench = execute(barRuntime, 'SetInductionFieldStrength', {
      benchId: 'no-such-bench',
      strength: quantity(0.5, 'T', 'magnetic_flux_density'),
    })
    expect(missingBench.ok).toBe(false)
    if (missingBench.ok) throw new Error('Expected command rejection.')
    expect(missingBench.error.code).toBe('INDUCTION_BENCH_NOT_FOUND')
  })
})

/** Read the current induced EMF straight off the resolved model. */
const inducedEmfOf = (scene: PhysicsScene): number => {
  const model = resolveInductionModel(scene)
  return model.subModel === 'bar_motion_emf'
    ? model.magneticFluxDensity * model.barLength * model.barVelocity
    : -(model.fluxRate ?? 0)
}
