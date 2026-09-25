import { describe, expect, it } from 'vitest'
import { quantity } from '@physicsos/physics-units'
import { isScalarQuantity } from '@physicsos/physics-core'
import {
  SceneRuntime,
  createMechanicalEnergyScene,
  createRampFrictionScene,
  createSceneCommand,
  energyBenchesOf,
  isEnergyScene,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'

import {
  ENERGY_ENGINE_ID,
  MECHANICAL_ENERGY_MODEL,
  createEnergySimulationRequest,
  energyEngine,
  energyLedgerOf,
  kineticEnergy,
  rampLengthOf,
  resolveEnergyModel,
  speedFromHeight,
} from '../src/index.ts'

/* m = 2 kg from h = 90 cm on a smooth 45° ramp: Ep = mgh = 17.64 J and, with
   nothing taking energy out, Ek = 17.64 J so v = √(2gh) = 4.2 m/s exactly. */
const smoothScene = (): PhysicsScene => createMechanicalEnergyScene()

/* The same rig with μ = 0.2: friction takes μmg·h = 3.528 J, leaving 14.112 J. */
const roughScene = (): PhysicsScene => createRampFrictionScene()

const simulated = (scene: PhysicsScene) =>
  energyEngine.simulate(scene, createEnergySimulationRequest(scene, 'sim-energy', 'trace-energy'))

const scalarOf = (scene: PhysicsScene, key: string): number => {
  const derived = simulated(scene).derivedQuantities.find((entry) => entry.key === key)
  if (derived === undefined) throw new Error(`derived quantity missing: ${key}`)
  if (!isScalarQuantity(derived.value)) throw new Error(`derived quantity not scalar: ${key}`)
  return derived.value.value
}

const checkPassed = (scene: PhysicsScene, id: string): boolean | undefined =>
  simulated(scene).verification.checks.find((entry) => entry.id === id)?.passed

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

describe('mechanical energy on a smooth ramp', () => {
  it('resolves the cart, the ramp and the surface into SI', () => {
    const model = resolveEnergyModel(smoothScene())
    expect(model.benchId).toBe('energy-bench-1')
    expect(model.mass).toBe(2)
    expect(model.gravity).toBe(9.8)
    expect(model.releaseHeight).toBeCloseTo(0.9, 15)
    expect(model.inclineAngle).toBeCloseTo(Math.PI / 4, 15)
    expect(model.frictionCoefficient).toBe(0)
  })

  it('turns 17.64 J of height into 17.64 J of motion and 4.2 m/s', () => {
    const ledger = energyLedgerOf(resolveEnergyModel(smoothScene()))
    expect(ledger.potentialAtRelease).toBeCloseTo(17.64, 12)
    expect(ledger.frictionWork).toBe(0)
    expect(ledger.kineticAtBottom).toBeCloseTo(17.64, 12)
    /* √(2gh) = √17.64 = 4.2 exactly, because 2gh is a perfect square here. */
    expect(ledger.speedAtBottom).toBeCloseTo(4.2, 12)
    expect(ledger.idealSpeed).toBeCloseTo(4.2, 12)
    expect(ledger.rampLength).toBeCloseTo(0.9 / Math.sin(Math.PI / 4), 12)
  })

  it('verifies the ledger, the speed and the friction law', () => {
    const scene = smoothScene()
    expect(checkPassed(scene, 'ledger_sums_to_release_height')).toBe(true)
    expect(checkPassed(scene, 'speed_from_height')).toBe(true)
    expect(checkPassed(scene, 'friction_work_from_ramp_length')).toBe(true)
    expect(simulated(scene).verification.status).toBe('passed')
  })

  it('reports the ledger as derived quantities', () => {
    const scene = smoothScene()
    expect(scalarOf(scene, 'cart_mass')).toBe(2)
    expect(scalarOf(scene, 'release_height')).toBeCloseTo(0.9, 12)
    expect(scalarOf(scene, 'ramp_length')).toBeCloseTo(rampLengthOf(0.9, Math.PI / 4), 12)
    expect(scalarOf(scene, 'potential_energy')).toBeCloseTo(17.64, 12)
    expect(scalarOf(scene, 'friction_work')).toBe(0)
    expect(scalarOf(scene, 'kinetic_energy')).toBeCloseTo(17.64, 12)
    expect(scalarOf(scene, 'speed_at_bottom')).toBeCloseTo(4.2, 12)
    const energy = simulated(scene).derivedQuantities.find((entry) => entry.key === 'kinetic_energy')
    expect(energy?.formula?.expression).toBe('Ek = mgh − W_摩擦')
  })
})

describe('mechanical energy on a rough ramp', () => {
  it('leaves 14.112 J once friction has taken its 3.528 J', () => {
    const ledger = energyLedgerOf(resolveEnergyModel(roughScene()))
    /* μmg·h·cotθ, and at 45° cotθ is 1, so this rig's heat IS μmg·h exactly. */
    expect(ledger.frictionWork).toBeCloseTo(3.528, 12)
    expect(ledger.kineticAtBottom).toBeCloseTo(14.112, 12)
    expect(ledger.speedAtBottom).toBeCloseTo(Math.sqrt(14.112), 12)
    expect(ledger.speedAtBottom).toBeLessThan(ledger.idealSpeed)
    /* The ledger still adds up — that is the whole lesson. */
    expect(ledger.energyAccounted).toBeCloseTo(ledger.potentialAtRelease, 12)
  })

  it('still verifies all three checks', () => {
    const scene = roughScene()
    expect(checkPassed(scene, 'ledger_sums_to_release_height')).toBe(true)
    expect(checkPassed(scene, 'speed_from_height')).toBe(true)
    expect(checkPassed(scene, 'friction_work_from_ramp_length')).toBe(true)
    expect(simulated(scene).verification.status).toBe('passed')
  })

  it('takes MORE heat down a shallow ramp than down a steep one', () => {
    /* Same height, same surface, half the angle: the path grows as cotθ while
       the normal force only falls as cosθ — so easing the slope costs more. */
    const steep = energyLedgerOf(resolveEnergyModel(roughScene()))
    const shallow = energyLedgerOf(
      resolveEnergyModel(createRampFrictionScene({ inclineAngle: 22.5 })),
    )
    expect(shallow.rampLength).toBeGreaterThan(steep.rampLength)
    expect(shallow.frictionWork / steep.frictionWork).toBeCloseTo(
      Math.cos(Math.PI / 8) / Math.sin(Math.PI / 8),
      9,
    )
    expect(shallow.frictionWork).toBeGreaterThan(steep.frictionWork)
    expect(shallow.kineticAtBottom).toBeLessThan(steep.kineticAtBottom)
    /* A vertical drop rubs against nothing: no surface, no heat. */
    const vertical = energyLedgerOf(
      resolveEnergyModel(createRampFrictionScene({ inclineAngle: 89.9 })),
    )
    expect(vertical.frictionWork).toBeLessThan(steep.frictionWork / 100)
  })
})

describe('energy engine support and commands', () => {
  it('names its model and refuses a rig with a body or another bench on it', () => {
    expect(energyEngine.engineId).toBe(ENERGY_ENGINE_ID)
    expect(energyEngine.canHandle(smoothScene())).toMatchObject({
      supported: true,
      modelId: MECHANICAL_ENERGY_MODEL,
    })
    const withBench = {
      ...smoothScene(),
      energyBenches: [...energyBenchesOf(smoothScene()), { ...energyBenchesOf(smoothScene())[0]!, id: 'second' }],
    }
    expect(energyEngine.canHandle(withBench).supported).toBe(false)
    const noBench = { ...smoothScene(), energyBenches: [] }
    expect(energyEngine.canHandle(noBench).supported).toBe(false)
  })

  it('refuses an angle at either end and a negative friction coefficient', () => {
    expect(energyEngine.canHandle(createMechanicalEnergyScene({ inclineAngle: 0 })).supported).toBe(false)
    expect(energyEngine.canHandle(createMechanicalEnergyScene({ inclineAngle: 90 })).supported).toBe(false)
    expect(energyEngine.canHandle(createMechanicalEnergyScene({ frictionCoefficient: -0.1 })).supported).toBe(false)
    /* A smooth ramp is a rig, not a missing value. */
    expect(energyEngine.canHandle(createMechanicalEnergyScene({ frictionCoefficient: 0 })).supported).toBe(true)

    const runtime = new SceneRuntime(smoothScene())
    const zero = execute(runtime, 'SetRampAngle', {
      benchId: 'energy-bench-1',
      angle: quantity(0, 'deg', 'angle'),
    })
    expect(zero.ok).toBe(false)
    const flat = execute(runtime, 'SetRampFriction', {
      benchId: 'energy-bench-1',
      coefficient: quantity(-0.2, '', 'dimensionless'),
    })
    expect(flat.ok).toBe(false)
    expect(runtime.getScene().revision).toBe(0)
  })

  it('re-solves from the inspector: mass, height, angle and surface', () => {
    const runtime = new SceneRuntime(smoothScene())

    const heavier = execute(runtime, 'SetEnergyMass', {
      benchId: 'energy-bench-1',
      mass: quantity(4, 'kg', 'mass'),
    })
    expect(heavier.ok).toBe(true)
    expect(scalarOf(runtime.getScene(), 'potential_energy')).toBeCloseTo(35.28, 9)
    /* Mass cancels out of √(2gh): a heavier cart arrives at the same speed. */
    expect(scalarOf(runtime.getScene(), 'speed_at_bottom')).toBeCloseTo(4.2, 9)

    const higher = execute(runtime, 'SetReleaseHeight', {
      benchId: 'energy-bench-1',
      height: quantity(180, 'cm', 'length'),
    })
    expect(higher.ok).toBe(true)
    expect(scalarOf(runtime.getScene(), 'potential_energy')).toBeCloseTo(70.56, 9)
    expect(scalarOf(runtime.getScene(), 'speed_at_bottom')).toBeCloseTo(speedFromHeight(9.8, 1.8), 9)

    const rough = execute(runtime, 'SetRampFriction', {
      benchId: 'energy-bench-1',
      coefficient: quantity(0.2, '', 'dimensionless'),
    })
    expect(rough.ok).toBe(true)
    /* μmg·h with the new height: 0.2·4·9.8·1.8 = 14.112 J. */
    expect(scalarOf(runtime.getScene(), 'friction_work')).toBeCloseTo(14.112, 9)
    expect(scalarOf(runtime.getScene(), 'kinetic_energy')).toBeCloseTo(70.56 - 14.112, 9)

    const shallower = execute(runtime, 'SetRampAngle', {
      benchId: 'energy-bench-1',
      angle: quantity(30, 'deg', 'angle'),
    })
    expect(shallower.ok).toBe(true)
    /* 30° is shallower than 45°, so it takes MORE: μmg·h·cot30° = 14.112 × 1.732. */
    expect(scalarOf(runtime.getScene(), 'friction_work')).toBeCloseTo(14.112 * Math.sqrt(3), 6)
  })

  it('keeps the kinetic energy the speed implies, at every setting', () => {
    const scene = roughScene()
    const ledger = energyLedgerOf(resolveEnergyModel(scene))
    expect(kineticEnergy(ledger.mass, ledger.speedAtBottom)).toBeCloseTo(
      ledger.kineticAtBottom,
      12,
    )
    expect(isEnergyScene(scene)).toBe(true)
  })
})
