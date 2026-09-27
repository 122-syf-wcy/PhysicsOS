import { describe, expect, it } from 'vitest'
import { quantity } from '@physicsos/physics-units'
import { derivedScalar, isScalarQuantity } from '@physicsos/physics-core'
import {
  SceneRuntime,
  createCrystalMeltingScene,
  createLeverBalanceScene,
  createSceneCommand,
  isLeverScene,
  leverBenchOf,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'

import {
  LEVER_ENGINE_ID,
  LEVER_INTEGRATION_STEP,
  LEVER_MAX_ANGLE,
  MOMENT_BALANCE_MODEL,
  LeverEngine,
  createLeverSimulationRequest,
  leverAngularStateAt,
  leverEngine,
  leverRunDuration,
  leverStateAt,
  momentsOf,
  resolveLeverModel,
  resolveLeverRotationalModel,
  staticLeverState,
  type ResolvedLeverModel,
} from '../src/index.ts'

/* 200 g at 15 cm vs 300 g at 10 cm, g = 9.8 → both moments 0.294 N·m. */
const balancedScene = (
  overrides: Parameters<typeof createLeverBalanceScene>[0] = {},
): PhysicsScene => createLeverBalanceScene(overrides)

const simulated = (scene: PhysicsScene) =>
  leverEngine.simulate(scene, createLeverSimulationRequest(scene, 'sim-lever', 'trace-lever'))

const leverValues = (result: ReturnType<typeof simulated>, index: number) =>
  result.states[index]?.objects.find((object) => object.id === 'lever-1')?.values

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

describe('lever moments (static path)', () => {
  it('balances the textbook pair: 200 g × 15 cm = 300 g × 10 cm', () => {
    const model = resolveLeverModel(balancedScene())
    expect(model.left.mass).toBeCloseTo(0.2, 12)
    expect(model.left.armLength).toBeCloseTo(0.15, 12)
    expect(model.right.mass).toBeCloseTo(0.3, 12)
    expect(model.right.armLength).toBeCloseTo(0.1, 12)

    const moments = momentsOf(model)
    expect(moments.leftWeight).toBeCloseTo(1.96, 9)
    expect(moments.rightWeight).toBeCloseTo(2.94, 9)
    expect(moments.leftMoment).toBeCloseTo(0.294, 9)
    expect(moments.rightMoment).toBeCloseTo(0.294, 9)
    expect(moments.balanced).toBe(true)
    expect(moments.netMoment).toBeCloseTo(0, 12)

    expect(staticLeverState(model).modelKind).toBe('static_equilibrium')
    expect(staticLeverState(model).tilt).toBe(0)
  })

  it('restores balance by halving the left arm after doubling the left mass', () => {
    const doubled = resolveLeverModel(balancedScene({ leftMass: 400 }))
    expect(momentsOf(doubled).balanced).toBe(false)
    const restored = resolveLeverModel(balancedScene({ leftMass: 400, leftArm: 7.5 }))
    expect(momentsOf(restored).balanced).toBe(true)
    expect(momentsOf(restored).leftMoment).toBeCloseTo(momentsOf(restored).rightMoment, 9)
  })
})

describe('lever rotational dynamics', () => {
  const swungModel = () => resolveLeverModel(balancedScene({ leftMass: 400 }))

  it('does not move a balanced beam', () => {
    const model = resolveLeverModel(balancedScene())
    for (const time of [0, 0.25, 1, 3]) {
      const state = leverStateAt(model, time)
      expect(state.tilt).toBe(0)
      expect(state.angularVelocity).toBe(0)
      expect(state.angularAcceleration).toBe(0)
      expect(state.phase).toBe('balanced')
      expect(state.settled).toBe(true)
    }
  })

  it('swings an asymmetric lever and settles at the moment-free vertical', () => {
    const model = swungModel()
    expect(momentsOf(model).netMoment).toBeGreaterThan(0)

    const start = leverStateAt(model, 0)
    expect(start.tilt).toBe(0)
    expect(start.angularVelocity).toBe(0)
    expect(start.phase).toBe('settling')

    /* It rotates toward the heavier (left) side and, once settled, reports the
       same resting pose for every later time. */
    const settleTime = leverRunDuration(model)
    expect(settleTime).toBeGreaterThan(0)
    expect(settleTime).toBeLessThan(4)

    const early = leverStateAt(model, settleTime / 4)
    const mid = leverStateAt(model, settleTime / 2)
    expect(early.tilt).toBeGreaterThan(0)
    expect(mid.tilt).toBeGreaterThan(early.tilt)

    const settled = leverStateAt(model, settleTime)
    expect(settled.tilt).toBeCloseTo(Math.PI / 2, 2)
    expect(Math.abs(settled.angularVelocity)).toBeLessThanOrEqual(1e-2)
    expect(settled.settled).toBe(true)
    expect(settled.phase).toBe('tipped')
    expect(leverStateAt(model, settleTime + 2).tilt).toBeCloseTo(settled.tilt, 12)
  })

  it('swings right when the right moment is larger', () => {
    const model = resolveLeverModel(balancedScene({ rightArm: 15 }))
    expect(momentsOf(model).netMoment).toBeLessThan(0)
    const settled = leverStateAt(model, leverRunDuration(model))
    expect(settled.tilt).toBeCloseTo(-Math.PI / 2, 2)
  })

  it('is NOT a display ramp: the swing accelerates, so equal time steps differ', () => {
    const model = swungModel()
    const h = LEVER_INTEGRATION_STEP * 10
    const first = leverStateAt(model, h).tilt
    const second = leverStateAt(model, 2 * h).tilt - first
    /* A linear ramp would give first === second. Real τ = Iα makes the early
       displacement grow (≈3× over the first doubling), so this must differ. */
    expect(second).toBeGreaterThan(first * 1.5)
    /* And ω is not constant while it accelerates. */
    expect(leverStateAt(model, 2 * h).angularVelocity).toBeGreaterThan(
      leverStateAt(model, h).angularVelocity,
    )
  })

  it('reads the angular state from the engine, not from a view-side value', () => {
    const model = swungModel()
    expect(leverAngularStateAt(model, 0.05).angle).toBe(leverStateAt(model, 0.05).tilt)
    expect(leverAngularStateAt(model, 0.05).angularVelocity).toBe(
      leverStateAt(model, 0.05).angularVelocity,
    )

    const result = simulated(balancedScene({ leftMass: 400 }))
    const total = leverRunDuration(model)
    for (const index of [3, 12, 24]) {
      const time = (index / 24) * total
      const values = leverValues(result, index)
      const tilt = values?.['tilt']
      const omega = values?.['angular_velocity']
      expect(tilt !== undefined && isScalarQuantity(tilt) ? tilt.value : Number.NaN).toBeCloseTo(
        leverAngularStateAt(model, time).angle,
        12,
      )
      expect(
        omega !== undefined && isScalarQuantity(omega) ? omega.value : Number.NaN,
      ).toBeCloseTo(leverAngularStateAt(model, time).angularVelocity, 12)
    }
  })

  it('bounds the motion so it cannot spin forever', () => {
    const model = resolveLeverModel(balancedScene({ leftMass: 2000 }))
    for (const time of [0, 0.1, 0.5, 1, 2, 4, 10]) {
      const state = leverStateAt(model, time)
      expect(Number.isFinite(state.tilt)).toBe(true)
      expect(Number.isFinite(state.angularVelocity)).toBe(true)
      expect(Math.abs(state.tilt)).toBeLessThanOrEqual(LEVER_MAX_ANGLE)
    }
  })

  it('refuses a degenerate lever (no moment of inertia) instead of returning NaN', () => {
    const zeroMass: ResolvedLeverModel = {
      leverId: 'lever-1',
      beamLength: 0.4,
      gravity: 9.8,
      left: { hangerId: 'hanger-left', side: 'left', mass: 0, armLength: 0.15 },
      right: { hangerId: 'hanger-right', side: 'right', mass: 0, armLength: 0.1 },
    }
    expect(() => resolveLeverRotationalModel(zeroMass)).toThrowError(/moment of inertia/)
    try {
      resolveLeverRotationalModel(zeroMass)
    } catch (error: unknown) {
      expect((error as { code?: string }).code).toBe('LEVER_DEGENERATE_INERTIA')
    }

    const zeroArm: ResolvedLeverModel = {
      ...zeroMass,
      left: { hangerId: 'hanger-left', side: 'left', mass: 0.2, armLength: 0 },
      right: { hangerId: 'hanger-right', side: 'right', mass: 0.3, armLength: 0 },
    }
    expect(() => resolveLeverRotationalModel(zeroArm)).toThrowError(/moment of inertia/)
  })
})

describe('lever verification', () => {
  it('passes weight, moment, class-1 and balance checks on the textbook pair', () => {
    const result = simulated(balancedScene())
    expect(result.verification.status).toBe('passed')
    const ids = result.verification.checks.map((check) => check.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'weight_from_mass',
        'moment_from_force',
        'arms_opposite',
        'moment_balance',
      ]),
    )
    expect(
      result.verification.checks
        .filter((check) =>
          ['weight_from_mass', 'moment_from_force', 'arms_opposite', 'moment_balance'].includes(
            check.id,
          ),
        )
        .every((check) => check.passed),
    ).toBe(true)
  })

  it('verifies the dynamic solution: law, energy, equilibrium and bound', () => {
    const result = simulated(balancedScene({ leftMass: 400 }))
    expect(result.verification.status).toBe('passed')
    const dynamics = result.verification.checks.filter((check) =>
      [
        'angular_dynamics_law',
        'rotational_energy_dissipates',
        'angular_equilibrium',
        'angular_motion_bounded',
      ].includes(check.id),
    )
    expect(dynamics.map((check) => check.id)).toEqual([
      'angular_dynamics_law',
      'rotational_energy_dissipates',
      'angular_equilibrium',
      'angular_motion_bounded',
    ])
    expect(dynamics.every((check) => check.passed)).toBe(true)
  })

  it('still verifies when unbalanced: the tilt follows the moment difference', () => {
    const result = simulated(balancedScene({ leftMass: 400 }))
    expect(result.verification.status).toBe('passed')
    const balance = result.verification.checks.find((check) => check.id === 'moment_balance')
    expect(balance?.passed).toBe(true)
    expect(balance?.message).toContain('力矩不平衡')
  })

  it('publishes G, M and the moment ratio as derived quantities', () => {
    const result = simulated(balancedScene())
    expect(derivedScalar(result.derivedQuantities, 'left_weight').value).toBeCloseTo(1.96, 9)
    expect(derivedScalar(result.derivedQuantities, 'right_weight').value).toBeCloseTo(2.94, 9)
    expect(derivedScalar(result.derivedQuantities, 'left_moment').value).toBeCloseTo(0.294, 9)
    expect(derivedScalar(result.derivedQuantities, 'right_moment').value).toBeCloseTo(0.294, 9)
    expect(derivedScalar(result.derivedQuantities, 'moment_ratio').value).toBeCloseTo(1, 9)
    const leftMoment = result.derivedQuantities.find((entry) => entry.key === 'left_moment')
    expect(leftMoment !== undefined && isScalarQuantity(leftMoment.value)).toBe(true)
    if (leftMoment !== undefined && isScalarQuantity(leftMoment.value)) {
      expect(leftMoment.value.dimension).toBe('torque')
      expect(leftMoment.value.unit).toBe('N*m')
    }
  })

  it('emits a balanced event on the textbook pair and a tip event when unbalanced', () => {
    expect(simulated(balancedScene()).events.map((event) => event.type)).toEqual(['LeverBalanced'])
    expect(simulated(balancedScene({ leftMass: 400 })).events.map((event) => event.type)).toEqual([
      'LeverSettling',
      'LeverTipped',
    ])
  })
})

describe('lever engine support', () => {
  it('accepts a pure lever scene and rejects a heating bench', () => {
    expect(isLeverScene(balancedScene())).toBe(true)
    expect(leverEngine.canHandle(balancedScene())).toMatchObject({
      supported: true,
      modelId: MOMENT_BALANCE_MODEL,
      domain: 'mechanics',
    })
    expect(leverEngine.canHandle(createCrystalMeltingScene()).supported).toBe(false)
    const none = leverEngine.canHandle({ ...balancedScene(), leverBenches: [] })
    expect(none.supported).toBe(false)
  })

  it('reports its own identity so results can be traced to this engine', () => {
    expect(new LeverEngine().engineId).toBe(LEVER_ENGINE_ID)
    expect(simulated(balancedScene()).metadata.engineId).toBe(LEVER_ENGINE_ID)
    expect(simulated(balancedScene()).metadata.solver).toBe('lever-rotational-dynamics')
  })
})

describe('lever scene commands', () => {
  it('unbalances the beam through a real mass command', () => {
    const runtime = new SceneRuntime(balancedScene())
    const result = execute(runtime, 'SetHangerMass', {
      leverId: 'lever-1',
      hangerId: 'hanger-left',
      mass: quantity(400, 'g', 'mass'),
    })
    expect(result.ok).toBe(true)
    expect(runtime.getEvents().at(-1)?.type).toBe('HangerMassChanged')
    expect(momentsOf(resolveLeverModel(runtime.getScene())).balanced).toBe(false)
    expect(leverBenchOf(runtime.getScene())?.hangers[0]?.mass.value).toBe(400)
  })

  it('restores balance by shortening the heavier arm', () => {
    const runtime = new SceneRuntime(balancedScene({ leftMass: 400 }))
    expect(
      execute(runtime, 'SetHangerArm', {
        leverId: 'lever-1',
        hangerId: 'hanger-left',
        armLength: quantity(7.5, 'cm', 'length'),
      }).ok,
    ).toBe(true)
    expect(momentsOf(resolveLeverModel(runtime.getScene())).balanced).toBe(true)
  })

  it('rejects a non-positive mass or an arm past half the beam', () => {
    const runtime = new SceneRuntime(balancedScene())
    const zeroMass = execute(runtime, 'SetHangerMass', {
      leverId: 'lever-1',
      hangerId: 'hanger-left',
      mass: quantity(0, 'g', 'mass'),
    })
    expect(zeroMass.ok).toBe(false)
    if (zeroMass.ok) throw new Error('Expected command rejection.')
    expect(zeroMass.error.code).toBe('INVALID_HANGER_MASS')

    const offBeam = execute(runtime, 'SetHangerArm', {
      leverId: 'lever-1',
      hangerId: 'hanger-left',
      armLength: quantity(25, 'cm', 'length'),
    })
    expect(offBeam.ok).toBe(false)
    if (offBeam.ok) throw new Error('Expected command rejection.')
    expect(offBeam.error.code).toBe('INVALID_HANGER_ARM')
  })

  it('reports a missing lever or hanger rather than silently doing nothing', () => {
    const runtime = new SceneRuntime(balancedScene())
    const missingLever = execute(runtime, 'SetHangerMass', {
      leverId: 'no-such-lever',
      hangerId: 'hanger-left',
      mass: quantity(200, 'g', 'mass'),
    })
    expect(missingLever.ok).toBe(false)
    if (missingLever.ok) throw new Error('Expected command rejection.')
    expect(missingLever.error.code).toBe('LEVER_NOT_FOUND')

    const missingHanger = execute(runtime, 'SetHangerMass', {
      leverId: 'lever-1',
      hangerId: 'no-such-hanger',
      mass: quantity(200, 'g', 'mass'),
    })
    expect(missingHanger.ok).toBe(false)
    if (missingHanger.ok) throw new Error('Expected command rejection.')
    expect(missingHanger.error.code).toBe('HANGER_NOT_FOUND')
  })
})
