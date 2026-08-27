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
  MAX_TILT_RADIANS,
  MOMENT_BALANCE_MODEL,
  TIP_DURATION,
  LeverEngine,
  createLeverSimulationRequest,
  leverEngine,
  leverRunDuration,
  leverStateAt,
  momentsOf,
  resolveLeverModel,
} from '../src/index.ts'

/* 200 g at 15 cm vs 300 g at 10 cm, g = 9.8 → both moments 0.294 N·m. */
const balancedScene = (
  overrides: Parameters<typeof createLeverBalanceScene>[0] = {},
): PhysicsScene => createLeverBalanceScene(overrides)

const simulated = (scene: PhysicsScene) =>
  leverEngine.simulate(scene, createLeverSimulationRequest(scene, 'sim-lever', 'trace-lever'))

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

describe('lever moments', () => {
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
  })

  it('stays level for the whole run when the moments match', () => {
    const model = resolveLeverModel(balancedScene())
    expect(leverStateAt(model, 0).phase).toBe('balanced')
    expect(leverStateAt(model, 0).tilt).toBe(0)
    expect(leverStateAt(model, leverRunDuration()).tilt).toBe(0)
  })

  it('tips left when the left moment is larger, to a finite display angle', () => {
    const model = resolveLeverModel(balancedScene({ leftMass: 400 }))
    const moments = momentsOf(model)
    expect(moments.balanced).toBe(false)
    expect(moments.leftMoment).toBeGreaterThan(moments.rightMoment)

    expect(leverStateAt(model, 0).tilt).toBeCloseTo(0, 12)
    expect(leverStateAt(model, 0).phase).toBe('settling')
    const half = leverStateAt(model, TIP_DURATION / 2)
    expect(half.phase).toBe('settling')
    expect(half.tilt).toBeCloseTo(MAX_TILT_RADIANS / 2, 9)
    const done = leverStateAt(model, TIP_DURATION)
    expect(done.phase).toBe('tipped')
    expect(done.tilt).toBeCloseTo(MAX_TILT_RADIANS, 9)
    expect(leverStateAt(model, leverRunDuration()).tilt).toBeCloseTo(MAX_TILT_RADIANS, 9)
  })

  it('tips right when the right moment is larger', () => {
    const model = resolveLeverModel(balancedScene({ rightArm: 15 }))
    expect(momentsOf(model).netMoment).toBeLessThan(0)
    expect(leverStateAt(model, TIP_DURATION).tilt).toBeCloseTo(-MAX_TILT_RADIANS, 9)
  })

  it('restores balance by halving the left arm after doubling the left mass', () => {
    const doubled = resolveLeverModel(balancedScene({ leftMass: 400 }))
    expect(momentsOf(doubled).balanced).toBe(false)
    const restored = resolveLeverModel(balancedScene({ leftMass: 400, leftArm: 7.5 }))
    expect(momentsOf(restored).balanced).toBe(true)
    expect(momentsOf(restored).leftMoment).toBeCloseTo(momentsOf(restored).rightMoment, 9)
  })
})

describe('lever verification', () => {
  it('passes weight, moment, class-1 and balance checks on the textbook pair', () => {
    const result = simulated(balancedScene())
    expect(result.verification.status).toBe('passed')
    const ids = result.verification.checks.map((check) => check.id)
    expect(ids).toEqual(expect.arrayContaining([
      'weight_from_mass',
      'moment_from_force',
      'arms_opposite',
      'moment_balance',
    ]))
    expect(result.verification.checks.filter((check) =>
      ['weight_from_mass', 'moment_from_force', 'arms_opposite', 'moment_balance']
        .includes(check.id),
    ).every((check) => check.passed)).toBe(true)
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
    expect(simulated(balancedScene({ leftMass: 400 })).events.map((event) => event.type))
      .toEqual(['LeverSettling', 'LeverTipped'])
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
    expect(execute(runtime, 'SetHangerArm', {
      leverId: 'lever-1',
      hangerId: 'hanger-left',
      armLength: quantity(7.5, 'cm', 'length'),
    }).ok).toBe(true)
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
