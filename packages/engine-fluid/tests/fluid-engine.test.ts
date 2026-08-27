import { describe, expect, it } from 'vitest'
import { quantity } from '@physicsos/physics-units'
import { derivedScalar, isScalarQuantity } from '@physicsos/physics-core'
import {
  SceneRuntime,
  createArchimedesScene,
  createEchoRangingScene,
  createSceneCommand,
  fluidTankOf,
  isFluidScene,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'

import {
  BUOYANCY_MODEL,
  FLUID_ENGINE_ID,
  FluidEngine,
  buoyancyFromPressure,
  createFluidSimulationRequest,
  equilibriumOf,
  fluidEngine,
  immersionStateAt,
  resolveFluidModel,
} from '../src/index.ts'

/* 铝块 100 cm³ / 270 g 在水里：G = 2.646 N，全浸后 F_浮 = 0.98 N，读数 1.666 N。 */
const tankScene = (overrides: Parameters<typeof createArchimedesScene>[0] = {}): PhysicsScene =>
  createArchimedesScene(overrides)

const simulated = (scene: PhysicsScene) =>
  fluidEngine.simulate(scene, createFluidSimulationRequest(scene, 'sim-buoy', 'trace-buoy'))

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

describe('buoyancy kinematics', () => {
  it('resolves the aluminium block into density, cross-section and weight', () => {
    const model = resolveFluidModel(tankScene())
    expect(model.blockDensity).toBeCloseTo(2700, 9)
    expect(model.crossSection).toBeCloseTo(2e-3, 12)
    expect(equilibriumOf(model).weight).toBeCloseTo(2.646, 9)
    expect(equilibriumOf(model).floats).toBe(false)
  })

  it('drops the reading linearly while the block enters, then holds it flat', () => {
    const model = resolveFluidModel(tankScene())
    /* Bottom face level with the surface: nothing displaced yet. */
    expect(immersionStateAt(model, 0)).toMatchObject({ phase: 'dry' })
    expect(immersionStateAt(model, 0).scaleReading).toBeCloseTo(2.646, 9)

    /* Half in at 1.25 s (2 cm/s × 1.25 s = 2.5 cm of a 5 cm block). */
    const half = immersionStateAt(model, 1.25)
    expect(half.phase).toBe('entering')
    expect(half.displacedVolume).toBeCloseTo(5e-5, 12)
    expect(half.buoyantForce).toBeCloseTo(0.49, 9)
    expect(half.scaleReading).toBeCloseTo(2.156, 9)

    /* Just covered at 2.5 s: the whole 100 cm³ is displaced. */
    const covered = immersionStateAt(model, 2.5)
    expect(covered.phase).toBe('submerged')
    expect(covered.displacedVolume).toBeCloseTo(1e-4, 12)
    expect(covered.buoyantForce).toBeCloseTo(0.98, 9)
    expect(covered.scaleReading).toBeCloseTo(1.666, 9)

    /* Twice as deep, identical reading — the whole point of the experiment. */
    const deeper = immersionStateAt(model, 5)
    expect(deeper.depth).toBeCloseTo(0.1, 12)
    expect(deeper.buoyantForce).toBeCloseTo(covered.buoyantForce, 12)
    expect(deeper.scaleReading).toBeCloseTo(covered.scaleReading, 12)
  })

  it('agrees with the pressure-difference route at every depth', () => {
    const model = resolveFluidModel(tankScene())
    for (const time of [0.5, 1.25, 2.5, 4, 5]) {
      const state = immersionStateAt(model, time)
      expect(buoyancyFromPressure(model, state.depth)).toBeCloseTo(state.buoyantForce, 12)
    }
  })

  it('floats a block lighter than the liquid at ρ_物/ρ_液 of its height', () => {
    const model = resolveFluidModel(tankScene({ blockMass: 60 }))
    const equilibrium = equilibriumOf(model)
    expect(equilibrium.floats).toBe(true)
    /* 600 / 1000 of a 5 cm block = 3 cm under. */
    expect(equilibrium.settledSubmergedHeight).toBeCloseTo(0.03, 12)
    expect(equilibrium.settleTime).toBeCloseTo(1.5, 12)

    const settled = immersionStateAt(model, 1.5)
    expect(settled.phase).toBe('floating')
    expect(settled.buoyantForce).toBeCloseTo(equilibrium.weight, 12)
    /* Buoyancy carries the whole weight, so the string goes slack. */
    expect(settled.scaleReading).toBeCloseTo(0, 12)
    /* Lowering the hook further cannot push a floater under. */
    expect(immersionStateAt(model, 10).submergedHeight).toBeCloseTo(0.03, 12)
  })

  it('lifts the buoyant force when the liquid gets denser', () => {
    const brine = resolveFluidModel(tankScene({ liquidDensity: 1100 }))
    const settled = immersionStateAt(brine, equilibriumOf(brine).settleTime)
    expect(settled.buoyantForce).toBeCloseTo(1.078, 9)
    expect(settled.scaleReading).toBeCloseTo(1.568, 9)
  })
})

describe('fluid engine', () => {
  it('handles a pure tank scene as the buoyancy model in the mechanics domain', () => {
    expect(fluidEngine.canHandle(tankScene())).toMatchObject({
      supported: true,
      modelId: BUOYANCY_MODEL,
      domain: 'mechanics',
    })
    expect(isFluidScene(tankScene())).toBe(true)
  })

  it('rejects scenes without a tank, naming the failed condition', () => {
    const none = fluidEngine.canHandle({ ...tankScene(), fluidTanks: [] })
    expect(none.supported).toBe(false)
    if (!none.supported) {
      expect(none.failedConditions[0]?.condition).toBe('single_tank')
    }
    const acoustics = fluidEngine.canHandle(createEchoRangingScene())
    expect(acoustics.supported).toBe(false)
  })

  it('derives the whole measurement chain the student writes in the table', () => {
    const outcome = simulated(tankScene())
    expect(derivedScalar(outcome.derivedQuantities, 'block_weight').value).toBeCloseTo(2.646, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'block_density').value).toBeCloseTo(2700, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'liquid_density').value).toBeCloseTo(1000, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'displaced_volume').value).toBeCloseTo(1e-4, 12)
    /* Archimedes: the displaced water weighs exactly what the block lost. */
    expect(derivedScalar(outcome.derivedQuantities, 'displaced_weight').value).toBeCloseTo(0.98, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'buoyant_force').value).toBeCloseTo(0.98, 9)
    expect(derivedScalar(outcome.derivedQuantities, 'scale_reading').value).toBeCloseTo(1.666, 9)
  })

  it('passes every verification check on the textbook rig', () => {
    const outcome = simulated(tankScene())
    const ids = outcome.verification.checks.map(entry => entry.id)
    expect(ids).toContain('archimedes_principle')
    expect(ids).toContain('scale_reading_balance')
    expect(ids).toContain('buoyancy_depth_independent')
    expect(outcome.verification.status).toBe('passed')
  })

  it('swaps the depth-independence check for a float check when the block floats', () => {
    const outcome = simulated(tankScene({ blockMass: 60 }))
    const ids = outcome.verification.checks.map(entry => entry.id)
    expect(ids).toContain('float_equilibrium')
    expect(ids).not.toContain('buoyancy_depth_independent')
    expect(outcome.verification.status).toBe('passed')
  })

  it('marks the entry, the covering and the end of the descent on the timeline', () => {
    const outcome = simulated(tankScene())
    expect(outcome.events.map(event => event.type)).toEqual([
      'BlockEntersLiquid',
      'BlockFullySubmerged',
      'DescentComplete',
    ])
    expect(outcome.events[1]?.time).toBeCloseTo(2.5, 9)
    expect(outcome.events[2]?.time).toBeCloseTo(5, 9)

    const floating = simulated(tankScene({ blockMass: 60 }))
    expect(floating.events.map(event => event.type)).toEqual([
      'BlockEntersLiquid',
      'BlockFloats',
      'DescentComplete',
    ])
  })

  it('samples the descent with a state exactly on the covering instant', () => {
    const outcome = simulated(tankScene())
    expect(outcome.states).toHaveLength(65)
    /* 64 segments over a 5 s run put sample 32 on 2.5 s, the kink itself. */
    const covering = outcome.states[32]
    if (covering === undefined) throw new Error('Expected a state at sample 32.')
    expect(covering.time.value).toBeCloseTo(2.5, 9)

    const tankValues = covering.objects.find(object => object.id === 'fluid-tank-1')?.values
    const reading = tankValues?.['scale_reading']
    if (reading === undefined || !isScalarQuantity(reading)) {
      throw new Error('Expected a scalar scale reading on the tank state.')
    }
    expect(reading.value).toBeCloseTo(1.666, 9)
  })

  it('refuses a simulation request pinned to another revision', () => {
    const scene = tankScene()
    const stale = createFluidSimulationRequest(scene, 'sim-stale', 'trace-stale')
    expect(() => fluidEngine.simulate({ ...scene, revision: 7 }, stale)).toThrow(
      /SimulationRequest must reference the exact PhysicsScene revision/,
    )
  })

  it('rejects a negative simulation time rather than extrapolating backwards', () => {
    expect(() => fluidEngine.stateAt(tankScene(), quantity(-1, 's', 'time'))).toThrow(
      /finite and non-negative/,
    )
  })

  it('reports its own identity so results can be traced to this engine', () => {
    const engine = new FluidEngine()
    expect(engine.engineId).toBe(FLUID_ENGINE_ID)
    expect(simulated(tankScene()).metadata.engineId).toBe(FLUID_ENGINE_ID)
  })
})

describe('fluid scene commands', () => {
  it('re-solves the rig after a liquid swap through a real scene command', () => {
    const runtime = new SceneRuntime(tankScene())
    const result = execute(runtime, 'SetLiquidDensity', {
      tankId: 'fluid-tank-1',
      density: quantity(1100, 'kg/m^3', 'density'),
    })
    expect(result.ok).toBe(true)
    expect(runtime.getEvents().at(-1)?.type).toBe('LiquidDensityChanged')

    const model = resolveFluidModel(runtime.getScene())
    const settled = immersionStateAt(model, equilibriumOf(model).settleTime)
    expect(settled.buoyantForce).toBeCloseTo(1.078, 9)
  })

  it('turns a sinker into a floater through a real mass edit', () => {
    const runtime = new SceneRuntime(tankScene())
    expect(execute(runtime, 'SetBlockMass', {
      tankId: 'fluid-tank-1',
      mass: quantity(60, 'g', 'mass'),
    }).ok).toBe(true)
    expect(fluidTankOf(runtime.getScene())?.block.mass.value).toBe(60)
    expect(equilibriumOf(resolveFluidModel(runtime.getScene())).floats).toBe(true)
  })

  it('rejects a non-positive density or mass instead of solving a broken rig', () => {
    const runtime = new SceneRuntime(tankScene())
    const zeroDensity = execute(runtime, 'SetLiquidDensity', {
      tankId: 'fluid-tank-1',
      density: quantity(0, 'kg/m^3', 'density'),
    })
    expect(zeroDensity.ok).toBe(false)
    if (zeroDensity.ok) throw new Error('Expected command rejection.')
    expect(zeroDensity.error.code).toBe('INVALID_LIQUID_DENSITY')

    const negativeMass = execute(runtime, 'SetBlockMass', {
      tankId: 'fluid-tank-1',
      mass: quantity(-5, 'g', 'mass'),
    })
    expect(negativeMass.ok).toBe(false)
    if (negativeMass.ok) throw new Error('Expected command rejection.')
    expect(negativeMass.error.code).toBe('INVALID_BLOCK_MASS')
  })

  it('reports a missing tank rather than silently doing nothing', () => {
    const runtime = new SceneRuntime(tankScene())
    const result = execute(runtime, 'SetLiquidDensity', {
      tankId: 'no-such-tank',
      density: quantity(1000, 'kg/m^3', 'density'),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected command rejection.')
    expect(result.error.code).toBe('FLUID_TANK_NOT_FOUND')
  })
})
