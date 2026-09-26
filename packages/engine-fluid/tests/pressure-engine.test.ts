import { describe, expect, it } from 'vitest'
import { quantity } from '@physicsos/physics-units'
import { derivedScalar, isScalarQuantity } from '@physicsos/physics-core'
import {
  SceneRuntime,
  createAtmosphericPressureScene,
  createLiquidPressureScene,
  createSceneCommand,
  createSolidPressureScene,
  isPressureScene,
  pressureBenchOf,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'

import {
  ATMOSPHERIC_PRESSURE_MODEL,
  LIQUID_PRESSURE_MODEL,
  PRESSURE_ENGINE_ID,
  SOLID_PRESSURE_MODEL,
  createPressureSimulationRequest,
  hemisphereForceBySurfaceIntegral,
  hydrostaticPressureByIntegration,
  pressureEngine,
  resolvePressureModel,
} from '../src/index.ts'

/* 20 N 压在 200 cm² 上 = 1000 Pa；同一压力压在 50 cm² 上 = 4000 Pa。 */
const solidScene = (): PhysicsScene => createSolidPressureScene()
/* 水 1000 kg/m³，20 cm 深处 1960 Pa，40 cm 深处 3920 Pa；盐水 1100 kg/m³ 同深度 2156 Pa。 */
const liquidScene = (): PhysicsScene => createLiquidPressureScene()
/* 101300 Pa 对应 760 mm 汞柱；半径 5 cm 的半球对拉约 795.6 N。 */
const atmosphericScene = (): PhysicsScene => createAtmosphericPressureScene()

const simulated = (scene: PhysicsScene) =>
  pressureEngine.simulate(
    scene,
    createPressureSimulationRequest(scene, 'sim-pressure', 'trace-pressure'),
  )

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

/* Every pressure quantity is emitted in its canonical unit, so the raw value
   is already the SI number the textbook arithmetic predicts. */
const derivedNumber = (scene: PhysicsScene, key: string): number =>
  derivedScalar(pressureEngine.stateAt(scene, quantity(0, 's', 'time')).derived ?? [], key).value

/** Runs `action` and returns the `PhysicsOSError` code it refused with. */
const refusalCodeOf = (action: () => unknown): string => {
  try {
    action()
  } catch (error: unknown) {
    return (error as { code?: string }).code ?? `${String(error)}`
  }
  throw new Error('expected the call to be refused, but it returned')
}

describe('solid pressure model', () => {
  it('resolves the force and both contact faces into SI', () => {
    const model = resolvePressureModel(solidScene())
    expect(model.type).toBe('solid')
    if (model.type !== 'solid') return
    expect(model.force).toBeCloseTo(20, 12)
    expect(model.area).toBeCloseTo(0.02, 12)
    expect(model.comparisonArea).toBeCloseTo(0.005, 12)
  })

  it('reads 1000 Pa on the loaded face and 4000 Pa on the smaller one', () => {
    const scene = solidScene()
    expect(derivedNumber(scene, 'contact_pressure')).toBeCloseTo(1000, 9)
    expect(derivedNumber(scene, 'comparison_pressure')).toBeCloseTo(4000, 9)
  })

  it('keeps F = p·S equal on both faces and the pressures in inverse area ratio', () => {
    const check = simulated(solidScene()).verification.checks.find(
      (entry) => entry.id === 'contact_force_invariant',
    )
    expect(check?.passed).toBe(true)
  })

  it('rejects a bench whose contact area is missing, at both gates', () => {
    const scene = solidScene()
    const bench = scene.pressureBenches?.[0]
    if (bench === undefined) throw new Error('no bench')
    const broken: PhysicsScene = { ...scene, pressureBenches: [{ ...bench, area: undefined }] }
    /* The scene validator catches it first, so the engine never reaches its own
       resolver; that resolver still refuses the bench on its own terms. */
    const support = pressureEngine.canHandle(broken)
    expect(support.supported).toBe(false)
    if (!support.supported) {
      expect(support.failedConditions.map((entry) => entry.condition)).toContain(
        'pressure_bench_values:pressure-bench-1',
      )
    }
    expect(refusalCodeOf(() => resolvePressureModel(broken))).toBe('PRESSURE_AREA')
  })

  it('accepts a zero contact force as a real rig reading zero pressure', () => {
    const scene = createSolidPressureScene({ force: 0 })
    const support = pressureEngine.canHandle(scene)
    expect(support.supported).toBe(true)
    expect(support.modelId).toBe(SOLID_PRESSURE_MODEL)
    expect(derivedNumber(scene, 'contact_pressure')).toBe(0)
  })
})

describe('liquid pressure model', () => {
  it('reads 1960 Pa at 20 cm, 3920 Pa at 40 cm and 2156 Pa in brine', () => {
    const scene = liquidScene()
    expect(derivedNumber(scene, 'liquid_pressure')).toBeCloseTo(1960, 9)
    expect(derivedNumber(scene, 'comparison_depth_pressure')).toBeCloseTo(3920, 9)
    expect(derivedNumber(scene, 'comparison_liquid_pressure')).toBeCloseTo(2156, 9)
  })

  it('integrating dp/dh = ρg reproduces the closed form', () => {
    expect(hydrostaticPressureByIntegration(1000, 9.8, 0.2)).toBeCloseTo(1960, 9)
    expect(hydrostaticPressureByIntegration(1100, 9.8, 0.4)).toBeCloseTo(4312, 9)
  })

  it('verifies the gradient, the depth ratio and the density ratio', () => {
    const checks = simulated(liquidScene()).verification.checks
    for (const id of [
      'hydrostatic_gradient_integral',
      'pressure_proportional_to_depth',
      'pressure_proportional_to_density',
    ]) {
      expect(checks.find((entry) => entry.id === id)?.passed).toBe(true)
    }
  })

  it('reads zero at the surface', () => {
    const scene = createLiquidPressureScene({ depth: 0 })
    const support = pressureEngine.canHandle(scene)
    expect(support.supported).toBe(true)
    expect(derivedNumber(scene, 'liquid_pressure')).toBe(0)
  })

  it('rejects a bench with no liquid density', () => {
    const scene = liquidScene()
    const bench = scene.pressureBenches?.[0]
    if (bench === undefined) throw new Error('no bench')
    const broken: PhysicsScene = {
      ...scene,
      pressureBenches: [{ ...bench, liquidDensity: undefined }],
    }
    expect(pressureEngine.canHandle(broken).supported).toBe(false)
  })
})

describe('atmospheric pressure model', () => {
  it('settles the mercury column at ρ_Hg·g·h = p₀, i.e. 760 mm', () => {
    const model = resolvePressureModel(atmosphericScene())
    expect(model.type).toBe('atmospheric')
    if (model.type !== 'atmospheric') return
    const column = model.atmosphericPressure / (model.barometerFluidDensity * model.gravity)
    expect(column).toBeCloseTo(0.760054, 6)
    expect(derivedNumber(atmosphericScene(), 'barometer_column')).toBeCloseTo(0.760054, 6)
  })

  it('needs πr²·p₀ to separate the hemispheres', () => {
    expect(derivedNumber(atmosphericScene(), 'hemisphere_force')).toBeCloseTo(795.6083, 3)
  })

  it('the surface integral of p·cosθ agrees with p₀·πr²', () => {
    const exact = 101_300 * Math.PI * 0.05 ** 2
    const integrated = hemisphereForceBySurfaceIntegral(101_300, 0.05)
    expect(integrated).toBeCloseTo(exact, 6)
  })

  it('verifies the projected force and the column balance', () => {
    const checks = simulated(atmosphericScene()).verification.checks
    for (const id of ['hemisphere_projected_force', 'barometer_column_balance']) {
      expect(checks.find((entry) => entry.id === id)?.passed).toBe(true)
    }
  })

  it('the same p₀ read at a lower pressure gives a shorter column', () => {
    /* 山顶：气压降到 80000 Pa，汞柱随之变短 —— 这正是气压计能测海拔的原因。 */
    const scene = createAtmosphericPressureScene({ atmosphericPressure: 80_000 })
    expect(derivedNumber(scene, 'barometer_column')).toBeCloseTo(80_000 / (13_600 * 9.8), 9)
    expect(derivedNumber(scene, 'hemisphere_force')).toBeCloseTo(80_000 * Math.PI * 0.0025, 6)
  })
})

describe('pressure engine support', () => {
  it('names the sub-model it will solve', () => {
    expect(pressureEngine.canHandle(solidScene()).modelId).toBe(SOLID_PRESSURE_MODEL)
    expect(pressureEngine.canHandle(liquidScene()).modelId).toBe(LIQUID_PRESSURE_MODEL)
    expect(pressureEngine.canHandle(atmosphericScene()).modelId).toBe(ATMOSPHERIC_PRESSURE_MODEL)
    expect(pressureEngine.engineId).toBe(PRESSURE_ENGINE_ID)
  })

  it('rejects a scene with no pressure bench and one with two', () => {
    expect(
      pressureEngine.canHandle({ ...solidScene(), pressureBenches: undefined }).supported,
    ).toBe(false)
    const scene = solidScene()
    const bench = scene.pressureBenches?.[0]
    if (bench === undefined) throw new Error('no bench')
    const doubled: PhysicsScene = {
      ...scene,
      pressureBenches: [bench, { ...bench, id: 'extra-bench' }],
    }
    expect(pressureEngine.canHandle(doubled).supported).toBe(false)
  })

  it('rejects a scene carrying motion objects alongside the bench', () => {
    /* The rig is a statics apparatus; a body moving in the same scene would be
       a second experiment sharing one timeline. */
    const scene = createLiquidPressureScene()
    const mixed = { ...scene, bodies: [{ id: 'stray-body' }] } as unknown as PhysicsScene
    const support = pressureEngine.canHandle(mixed)
    expect(support.supported).toBe(false)
    if (!support.supported) {
      expect(support.failedConditions.map((entry) => entry.condition)).toContain(
        'pure_pressure_scene',
      )
    }
  })

  it('reports the same reading at every instant, because the rig is static', () => {
    const scene = liquidScene()
    const atZero = pressureEngine.stateAt(scene, quantity(0, 's', 'time'))
    const atTen = pressureEngine.stateAt(scene, quantity(10, 's', 'time'))
    const valueAt = (time: number) => {
      const values = pressureEngine.stateAt(scene, quantity(time, 's', 'time')).objects[0]?.values
      const pressure = values?.['liquid_pressure']
      return pressure !== undefined && isScalarQuantity(pressure) ? pressure.value : undefined
    }
    expect(valueAt(10)).toBeCloseTo(valueAt(0) ?? Number.NaN, 12)
    expect(atTen.objects[0]?.id).toBe(atZero.objects[0]?.id)
  })

  it('emits a single settled reading rather than an invented trajectory', () => {
    const result = simulated(liquidScene())
    expect(result.states).toHaveLength(1)
    expect(result.events.map((event) => event.type)).toEqual(['PressureReadingSettled'])
    expect(result.verification.status).toBe('passed')
  })

  it('refuses a request that references a different revision', () => {
    const scene = liquidScene()
    expect(() =>
      pressureEngine.simulate(scene, {
        ...createPressureSimulationRequest(scene, 'sim-x', 'trace-x'),
        sceneRevision: scene.revision + 1,
      }),
    ).toThrow()
  })
})

describe('pressure scene commands', () => {
  it('edits the contact force through a real revision bump', () => {
    const runtime = new SceneRuntime(solidScene())
    const before = runtime.getScene().revision
    const result = execute(runtime, 'SetPressureForce', {
      benchId: 'pressure-bench-1',
      force: quantity(40, 'N', 'force'),
    })
    expect(result.ok).toBe(true)
    const after = runtime.getScene()
    expect(after.revision).toBeGreaterThan(before)
    expect(derivedNumber(after, 'contact_pressure')).toBeCloseTo(2000, 9)
  })

  it('edits the probe depth and moves the reading with it', () => {
    const runtime = new SceneRuntime(liquidScene())
    const result = execute(runtime, 'SetPressureProbeDepth', {
      benchId: 'pressure-bench-1',
      depth: quantity(10, 'cm', 'length'),
    })
    expect(result.ok).toBe(true)
    expect(derivedNumber(runtime.getScene(), 'liquid_pressure')).toBeCloseTo(980, 9)
  })

  it('rejects a force command on a liquid bench', () => {
    const runtime = new SceneRuntime(liquidScene())
    const result = execute(runtime, 'SetPressureForce', {
      benchId: 'pressure-bench-1',
      force: quantity(20, 'N', 'force'),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('PRESSURE_WRONG_SUBMODEL')
  })

  it('rejects a negative depth and an unknown bench', () => {
    const runtime = new SceneRuntime(liquidScene())
    const negative = execute(runtime, 'SetPressureProbeDepth', {
      benchId: 'pressure-bench-1',
      depth: quantity(-1, 'cm', 'length'),
    })
    expect(negative.ok).toBe(false)
    const missing = execute(runtime, 'SetPressureProbeDepth', {
      benchId: 'nope',
      depth: quantity(1, 'cm', 'length'),
    })
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.error.code).toBe('PRESSURE_BENCH_NOT_FOUND')
  })

  it('edits the atmospheric pressure the barometer is reading', () => {
    const runtime = new SceneRuntime(atmosphericScene())
    const result = execute(runtime, 'SetPressureAtmospheric', {
      benchId: 'pressure-bench-1',
      pressure: quantity(90_000, 'Pa', 'pressure'),
    })
    expect(result.ok).toBe(true)
    expect(derivedNumber(runtime.getScene(), 'barometer_column')).toBeCloseTo(
      90_000 / (13_600 * 9.8),
      9,
    )
  })
})

describe('pressure scenes are recognisable', () => {
  it('classifies a pure pressure bench scene', () => {
    expect(isPressureScene(solidScene())).toBe(true)
    expect(isPressureScene(liquidScene())).toBe(true)
    expect(isPressureScene(atmosphericScene())).toBe(true)
    expect(pressureBenchOf(liquidScene())?.type).toBe('liquid')
  })
})
