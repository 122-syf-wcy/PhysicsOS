import { describe, expect, it } from 'vitest'
import { quantity } from '@physicsos/physics-units'
import { derivedScalar, isScalarQuantity } from '@physicsos/physics-core'
import {
  SceneRuntime,
  createElectromagnetScene,
  createMagneticScene,
  createMotorScene,
  createSceneCommand,
  createSolenoidFieldScene,
  createStraightWireFieldScene,
  currentBenchesOf,
  isCurrentScene,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'

import {
  CURRENT_ENGINE_ID,
  CurrentFieldEngine,
  ELECTROMAGNET_MODEL,
  MOTOR_MODEL,
  MagneticEngine,
  SOLENOID_FIELD_MODEL,
  STRAIGHT_WIRE_FIELD_MODEL,
  VACUUM_PERMEABILITY,
  circulationOf,
  ampereForceOnSide,
  coilAreaOf,
  coreFieldMagnitude,
  createCurrentSimulationRequest,
  currentFieldEngine,
  electromagnetFieldOf,
  finiteSegmentFieldMagnitude,
  motorReadingOf,
  motorTorqueAt,
  northPoleOf,
  poleFacePull,
  resolveCurrentModel,
  solenoidEndFieldMagnitude,
  solenoidFieldMagnitude,
  solenoidFieldOf,
  straightWireFieldMagnitude,
  straightWireFieldOf,
  turnDensityOf,
} from '../src/index.ts'

/* I = 10 A at 5 cm: μ₀I/(2πr) = 2×10⁻⁷·10/0.05 = 4×10⁻⁵ T = 40 µT, and the
   second probe at 10 cm reads exactly half of it. */
const wireScene = (): PhysicsScene => createStraightWireFieldScene()

/* N = 400 over 20 cm is n = 2000 匝/米; at I = 5 A that is B = 4π×10⁻³ T, and
   the same former wound with 800 turns is exactly twice that. */
const solenoidScene = (): PhysicsScene => createSolenoidFieldScene()

/* N = 200 over 20 cm, μ_r = 200 and a 4 cm² pole face at I = 1 A: B = 0.2513 T
   and the pole holds 3.2π N ≈ 10.05 N, which is about a kilogram. */
const electromagnetScene = (): PhysicsScene => createElectromagnetScene()

/* B = 0.5 T, n = 100, I = 2 A, a 6 cm × 4 cm coil at θ = 0: each side carries
   F = BIL = 0.06 N and the couple is τ = n·B·I·A = 0.24 N·m. */
const motorScene = (input: Parameters<typeof createMotorScene>[0] = {}): PhysicsScene =>
  createMotorScene(input)

const simulated = (scene: PhysicsScene) =>
  currentFieldEngine.simulate(
    scene,
    createCurrentSimulationRequest(scene, 'sim-current', 'trace-current'),
  )

const scalarOf = (scene: PhysicsScene, key: string): number => {
  const derived = simulated(scene).derivedQuantities.find((entry) => entry.key === key)
  if (derived === undefined) throw new Error(`derived quantity missing: ${key}`)
  if (!isScalarQuantity(derived.value)) throw new Error(`derived quantity not scalar: ${key}`)
  return derived.value.value
}

/* A check carries `passed`, not a status string: the status is the summary's. */
const checkPassed = (scene: PhysicsScene, id: string): boolean | undefined =>
  simulated(scene).verification.checks.find((entry) => entry.id === id)?.passed

/** Drive a command through the real gate, the way the inspector does. */
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

const fieldOf = (scene: PhysicsScene): number => scalarOf(scene, 'magnetic_flux_density')

describe('straight-wire field model', () => {
  it('resolves the conductor, the probe and the second probe into SI', () => {
    const model = resolveCurrentModel(wireScene())
    expect(model).toEqual({
      type: 'straight_wire',
      benchId: 'current-bench-1',
      current: 10,
      probeDistance: 0.05,
      comparisonDistance: 0.1,
    })
  })

  it('reads 40 µT at 5 cm and 20 µT at 10 cm — the π in μ₀ cancels against 2πr', () => {
    const reading = straightWireFieldOf({
      type: 'straight_wire',
      benchId: 'current-bench-1',
      current: 10,
      probeDistance: 0.05,
      comparisonDistance: 0.1,
    })
    expect(reading.field).toBeCloseTo(4e-5, 12)
    expect(reading.comparisonField).toBeCloseTo(2e-5, 12)
    /* Half the distance, twice the field: the product B·r is the invariant. */
    expect(reading.field * 0.05).toBeCloseTo((reading.comparisonField ?? 0) * 0.1, 15)
  })

  it('reaches the infinite-wire reading from a finite segment of the same wire', () => {
    /* 100 probe radii of wire: the Biot–Savart bracket 2L/√(r²+L²) is 1.99990,
       so the shortcut is good to 5×10⁻⁵ — well inside the 10⁻³ the check asks. */
    const fromSegment = finiteSegmentFieldMagnitude(10, 0.05, 100 * 0.05)
    expect(fromSegment / straightWireFieldMagnitude(10, 0.05)).toBeCloseTo(0.99995, 5)
  })

  it('carries the current’s sign as the field’s circulation, and flips with it', () => {
    expect(circulationOf(10)).toBe(1)
    expect(circulationOf(-10)).toBe(-1)
    /* 安培定则 flips the direction and leaves the strength alone. */
    expect(straightWireFieldMagnitude(-10, 0.05)).toBe(straightWireFieldMagnitude(10, 0.05))
  })

  it('verifies the segment limit, the inverse-distance law and the direction rule', () => {
    const scene = wireScene()
    expect(checkPassed(scene, 'wire_field_from_finite_segment')).toBe(true)
    expect(checkPassed(scene, 'field_inverse_with_distance')).toBe(true)
    expect(checkPassed(scene, 'field_direction_follows_current')).toBe(true)
    expect(simulated(scene).verification.status).toBe('passed')
  })

  it('reports B, the probe distance and the circulation as derived quantities', () => {
    const scene = wireScene()
    expect(scalarOf(scene, 'wire_current')).toBe(10)
    expect(scalarOf(scene, 'probe_distance')).toBe(0.05)
    expect(scalarOf(scene, 'magnetic_flux_density')).toBeCloseTo(4e-5, 12)
    expect(scalarOf(scene, 'comparison_field')).toBeCloseTo(2e-5, 12)
    expect(scalarOf(scene, 'field_circulation')).toBe(1)
    const density = simulated(scene).derivedQuantities.find(
      (entry) => entry.key === 'magnetic_flux_density',
    )
    expect(density?.formula?.expression).toBe('B = μ₀I/(2πr)')
  })
})

describe('solenoid field model', () => {
  it('resolves the winding, the turn count and the length into SI', () => {
    const model = resolveCurrentModel(solenoidScene())
    expect(model).toEqual({
      type: 'solenoid',
      benchId: 'current-bench-1',
      current: 5,
      turns: 400,
      comparisonTurns: 800,
      coilLength: 0.2,
    })
  })

  it('reads 4π×10⁻³ T inside a 2000 匝/米 coil, and half of it at the mouth', () => {
    const reading = solenoidFieldOf({
      type: 'solenoid',
      benchId: 'current-bench-1',
      current: 5,
      turns: 400,
      comparisonTurns: 800,
      coilLength: 0.2,
    })
    expect(turnDensityOf(400, 0.2)).toBe(2000)
    expect(reading.field).toBeCloseTo(4 * Math.PI * 1e-3, 12)
    expect(reading.field).toBeCloseTo(1.2566370614359173e-2, 15)
    expect(reading.endField).toBeCloseTo(2 * Math.PI * 1e-3, 12)
    expect(reading.comparisonField).toBeCloseTo(2 * reading.field, 12)
  })

  it('doubles the field when the same former is wound with twice the turns', () => {
    const once = solenoidFieldMagnitude(5, 400, 0.2)
    const twice = solenoidFieldMagnitude(5, 800, 0.2)
    expect(twice / once).toBeCloseTo(2, 12)
    expect(twice / once).toBeCloseTo(800 / 400, 15)
  })

  it('points the north pole by 安培定则, and swaps it when the current reverses', () => {
    expect(northPoleOf(5)).toBe(1)
    expect(northPoleOf(-5)).toBe(-1)
    expect(solenoidFieldMagnitude(-5, 400, 0.2)).toBe(solenoidFieldMagnitude(5, 400, 0.2))
  })

  it('verifies the turn density against the mouth field, the turn ratio and the pole rule', () => {
    const scene = solenoidScene()
    expect(checkPassed(scene, 'solenoid_field_from_turn_density')).toBe(true)
    expect(checkPassed(scene, 'field_proportional_to_turns')).toBe(true)
    expect(checkPassed(scene, 'north_pole_follows_current')).toBe(true)
    expect(simulated(scene).verification.status).toBe('passed')
  })

  it('the mouth field is exactly half the interior field, which is what the check compares', () => {
    expect(solenoidEndFieldMagnitude(5, 400, 0.2) * 2).toBeCloseTo(
      solenoidFieldMagnitude(5, 400, 0.2),
      15,
    )
  })

  it('reports the turn count, the length, the interior field and the pole as derived quantities', () => {
    const scene = solenoidScene()
    expect(scalarOf(scene, 'coil_current')).toBe(5)
    expect(scalarOf(scene, 'coil_turns')).toBe(400)
    expect(scalarOf(scene, 'coil_length')).toBe(0.2)
    expect(scalarOf(scene, 'magnetic_flux_density')).toBeCloseTo(4 * Math.PI * 1e-3, 12)
    expect(scalarOf(scene, 'end_field')).toBeCloseTo(2 * Math.PI * 1e-3, 12)
    expect(scalarOf(scene, 'north_pole')).toBe(1)
    expect(scalarOf(scene, 'comparison_field')).toBeCloseTo(8 * Math.PI * 1e-3, 12)
    const density = simulated(scene).derivedQuantities.find(
      (entry) => entry.key === 'magnetic_flux_density',
    )
    expect(density?.formula?.expression).toBe('B = μ₀(N/L)I')
  })
})

describe('current engine support', () => {
  it('names the rig it will solve', () => {
    expect(currentFieldEngine.engineId).toBe(CURRENT_ENGINE_ID)
    expect(currentFieldEngine.canHandle(wireScene())).toMatchObject({
      supported: true,
      modelId: STRAIGHT_WIRE_FIELD_MODEL,
    })
    expect(currentFieldEngine.canHandle(solenoidScene())).toMatchObject({
      supported: true,
      modelId: SOLENOID_FIELD_MODEL,
    })
  })

  it('rejects a scene with no current bench and one with two', () => {
    const empty = { ...wireScene(), currentBenches: [] }
    expect(currentFieldEngine.canHandle(empty).supported).toBe(false)
    const bench = currentBenchesOf(wireScene())[0]
    if (bench === undefined) throw new Error('fixture has no bench')
    const doubled = { ...wireScene(), currentBenches: [bench, { ...bench, id: 'second' }] }
    expect(currentFieldEngine.canHandle(doubled).supported).toBe(false)
  })

  it('rejects a zero current at both gates — a dead conductor is not a rig', () => {
    const scene = { ...wireScene(), currentBenches: [{ ...currentBenchesOf(wireScene())[0]!, current: undefined }] }
    expect(currentFieldEngine.canHandle(scene).supported).toBe(false)

    const zero = createStraightWireFieldScene({ current: 0 })
    expect(currentFieldEngine.canHandle(zero).supported).toBe(false)
    expect(currentFieldEngine.validate(zero).status).toBe('failed')
  })

  it('rejects an incomplete rig: no probe distance, no turns, no coil length', () => {
    const bench = currentBenchesOf(wireScene())[0]!
    const noProbe = { ...wireScene(), currentBenches: [{ ...bench, probeDistance: undefined }] }
    expect(currentFieldEngine.canHandle(noProbe).supported).toBe(false)

    const solenoid = currentBenchesOf(solenoidScene())[0]!
    const noTurns = { ...solenoidScene(), currentBenches: [{ ...solenoid, turns: undefined }] }
    expect(currentFieldEngine.canHandle(noTurns).supported).toBe(false)
    const noLength = { ...solenoidScene(), currentBenches: [{ ...solenoid, coilLength: undefined }] }
    expect(currentFieldEngine.canHandle(noLength).supported).toBe(false)
  })

  it('rejects a scene carrying another bench or the Lorentz particle alongside', () => {
    /* The two magnetic models are disjoint by apparatus: one solves a particle
       in a field, the other the field a current makes. Neither may claim the
       other's scene, and the registry relies on that. */
    const lorentz = createMagneticScene()
    expect(currentFieldEngine.canHandle(lorentz).supported).toBe(false)
    expect(new MagneticEngine().canHandle(wireScene()).supported).toBe(false)
    expect(new CurrentFieldEngine().canHandle(wireScene()).supported).toBe(true)
  })

  it('reports the same reading at every instant, because the current is steady', () => {
    const scene = wireScene()
    const later = currentFieldEngine.stateAt(scene, quantity(9, 's', 'time'))
    expect(later.objects[0]?.id).toBe('current-bench-1')
    /* A trajectory would be an invented curve: the settled reading is the state. */
    expect(simulated(scene).states).toHaveLength(1)
    expect(simulated(scene).states[0]?.time.value).toBe(0)
  })

  it('emits a single settled event rather than a timeline', () => {
    const events = simulated(wireScene()).events
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('CurrentFieldSettled')
  })

  it('refuses a request that references a different revision', () => {
    const scene = wireScene()
    const stale = { ...scene, revision: scene.revision + 1 }
    expect(() =>
      currentFieldEngine.simulate(stale, createCurrentSimulationRequest(scene, 'sim', 'trace')),
    ).toThrowError(/must reference the exact PhysicsScene revision/)
  })

  it('keeps the Lorentz model’s constants out of the way of the new one', () => {
    /* The vacuum permeability is written as the exact product, not a rounded
       decimal: 4π×10⁻⁷, which is what makes the wire reading a round 40 µT. */
    expect(VACUUM_PERMEABILITY).toBeCloseTo(1.2566370614359173e-6, 18)
  })
})

describe('electromagnet rig', () => {
  it('resolves the winding, the core and the pole face into SI', () => {
    const model = resolveCurrentModel(electromagnetScene())
    expect(model).toEqual({
      type: 'electromagnet',
      benchId: 'current-bench-1',
      current: 1,
      turns: 200,
      coilLength: 0.2,
      coreRelativePermeability: 200,
      comparisonCoreRelativePermeability: 800,
      coreArea: 4e-4,
      gravity: 9.8,
    })
  })

  it('multiplies the coil’s own air-cored field by μ_r: 1.257 mT → 0.2513 T', () => {
    const reading = electromagnetFieldOf({
      type: 'electromagnet',
      benchId: 'current-bench-1',
      current: 1,
      turns: 200,
      coilLength: 0.2,
      coreRelativePermeability: 200,
      comparisonCoreRelativePermeability: 800,
      coreArea: 4e-4,
      gravity: 9.8,
    })
    expect(reading.turnDensity).toBe(1000)
    /* The air-cored baseline is the same coil's solenoid field, not a second
       formula: μ₀nI with n = 1000 and I = 1. */
    expect(reading.airField).toBeCloseTo(4 * Math.PI * 1e-4, 15)
    expect(reading.airField).toBeCloseTo(solenoidFieldMagnitude(1, 200, 0.2), 18)
    expect(reading.field).toBeCloseTo(8 * Math.PI * 1e-2, 15)
    expect(reading.field / reading.airField).toBeCloseTo(200, 12)
  })

  it('holds 3.2π N over a 4 cm² pole face — about a kilogram', () => {
    const reading = electromagnetFieldOf({
      type: 'electromagnet',
      benchId: 'current-bench-1',
      current: 1,
      turns: 200,
      coilLength: 0.2,
      coreRelativePermeability: 200,
      comparisonCoreRelativePermeability: 800,
      coreArea: 4e-4,
      gravity: 9.8,
    })
    /* B²A/(2μ₀) = (8π×10⁻²)²·4×10⁻⁴/(8π×10⁻⁷) = 3.2π N exactly. */
    expect(reading.pull).toBeCloseTo(3.2 * Math.PI, 12)
    expect(reading.pull).toBeCloseTo(10.053096491487338, 12)
    expect(reading.heldMass).toBeCloseTo(3.2 * Math.PI / 9.8, 12)
    /* The air-cored coil of the same winding holds a quarter of a millinewton:
       the core is the whole reason the rig lifts anything. */
    expect(reading.airHeldMass).toBeCloseTo(reading.heldMass / 40000, 12)
  })

  it('quadruples the pull when the current doubles, because F ∝ B²', () => {
    const once = poleFacePull(coreFieldMagnitude(1, 200, 0.2, 200), 4e-4)
    const twice = poleFacePull(coreFieldMagnitude(2, 200, 0.2, 200), 4e-4)
    expect(twice / once).toBeCloseTo(4, 12)
    /* B itself only doubles — the square is the pull's, not the field's. */
    expect(coreFieldMagnitude(2, 200, 0.2, 200) / coreFieldMagnitude(1, 200, 0.2, 200)).toBeCloseTo(2, 12)
  })

  it('multiplies the pull by 16 when the core’s μ_r is multiplied by 4', () => {
    const reading = electromagnetFieldOf({
      type: 'electromagnet',
      benchId: 'current-bench-1',
      current: 1,
      turns: 200,
      coilLength: 0.2,
      coreRelativePermeability: 200,
      comparisonCoreRelativePermeability: 800,
      coreArea: 4e-4,
      gravity: 9.8,
    })
    expect(reading.comparisonField).toBeCloseTo(4 * reading.field, 12)
    expect((reading.comparisonPull ?? 0) / reading.pull).toBeCloseTo(16, 12)
  })

  it('verifies the permeability, the square in B and the square in μ_r', () => {
    const scene = electromagnetScene()
    expect(checkPassed(scene, 'core_field_from_permeability')).toBe(true)
    expect(checkPassed(scene, 'pull_proportional_to_field_squared')).toBe(true)
    expect(checkPassed(scene, 'pull_proportional_to_core_squared')).toBe(true)
    expect(simulated(scene).verification.status).toBe('passed')
  })

  it('reports the field, the pull and the held mass as derived quantities', () => {
    const scene = electromagnetScene()
    expect(scalarOf(scene, 'coil_turns')).toBe(200)
    expect(scalarOf(scene, 'core_permeability')).toBe(200)
    expect(scalarOf(scene, 'magnetic_flux_density')).toBeCloseTo(8 * Math.PI * 1e-2, 15)
    expect(scalarOf(scene, 'air_cored_field')).toBeCloseTo(4 * Math.PI * 1e-4, 15)
    expect(scalarOf(scene, 'pole_face_pull')).toBeCloseTo(3.2 * Math.PI, 12)
    expect(scalarOf(scene, 'held_mass')).toBeCloseTo((3.2 * Math.PI) / 9.8, 12)
    expect(scalarOf(scene, 'comparison_pull')).toBeCloseTo(51.2 * Math.PI, 12)
    const pull = simulated(scene).derivedQuantities.find(entry => entry.key === 'pole_face_pull')
    expect(pull?.formula?.expression).toBe('F = B²A/(2μ₀)')
  })

  it('names its model, and refuses a coreless or pointless rig', () => {
    expect(currentFieldEngine.canHandle(electromagnetScene())).toMatchObject({
      supported: true,
      modelId: ELECTROMAGNET_MODEL,
    })

    const bench = currentBenchesOf(electromagnetScene())[0]!
    const coreless = {
      ...electromagnetScene(),
      currentBenches: [{ ...bench, coreRelativePermeability: undefined }],
    }
    expect(currentFieldEngine.canHandle(coreless).supported).toBe(false)

    const pointless = { ...electromagnetScene(), currentBenches: [{ ...bench, coreArea: undefined }] }
    expect(currentFieldEngine.canHandle(pointless).supported).toBe(false)

    /* μ_r = 1 is the air-cored coil — a legitimate rig — but zero is not a core. */
    expect(currentFieldEngine.canHandle(createElectromagnetScene({ coreRelativePermeability: 1 })).supported).toBe(true)
    expect(currentFieldEngine.canHandle(createElectromagnetScene({ coreRelativePermeability: 0 })).supported).toBe(false)
    expect(currentFieldEngine.validate(createElectromagnetScene({ coreRelativePermeability: 0 })).status).toBe('failed')
  })

  it('takes the coil commands as well as the core ones', () => {
    /* An electromagnet IS a solenoid with a core, so the winding commands have
       to reach it — a guard that only knew about `solenoid` would leave the
       inspector's 匝数 row showing a number it could never commit. */
    const runtime = new SceneRuntime(electromagnetScene())
    const before = scalarOf(runtime.getScene(), 'magnetic_flux_density')

    const moreTurns = execute(runtime, 'SetSolenoidTurns', {
      benchId: 'current-bench-1',
      turns: quantity(400, '', 'dimensionless'),
    })
    expect(moreTurns.ok).toBe(true)
    expect(scalarOf(runtime.getScene(), 'magnetic_flux_density') / before).toBeCloseTo(2, 12)
  })

  it('re-solves from the inspector: a better core and a bigger pole face', () => {
    const runtime = new SceneRuntime(electromagnetScene())
    const airCored = scalarOf(runtime.getScene(), 'air_cored_field')

    const core = execute(runtime, 'SetCorePermeability', {
      benchId: 'current-bench-1',
      relativePermeability: quantity(400, '', 'dimensionless'),
    })
    expect(core.ok).toBe(true)
    /* μ_r = 400 doubles the field but quadruples the pull — the square. */
    expect(scalarOf(runtime.getScene(), 'magnetic_flux_density')).toBeCloseTo(400 * airCored, 9)

    const wide = execute(runtime, 'SetCoreArea', {
      benchId: 'current-bench-1',
      area: quantity(8, 'cm^2', 'area'),
    })
    expect(wide.ok).toBe(true)
    /* Twice the pole face, twice the pull. */
    expect(scalarOf(runtime.getScene(), 'pole_face_pull')).toBeCloseTo(
      2 * poleFacePull(400 * airCored, 4e-4),
      9,
    )
  })

  it('refuses a core command on a rig that has no core', () => {
    const runtime = new SceneRuntime(wireScene())
    const result = execute(runtime, 'SetCorePermeability', {
      benchId: 'current-bench-1',
      relativePermeability: quantity(200, '', 'dimensionless'),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CURRENT_WRONG_SUBMODEL')
  })
})

describe('motor rig', () => {
  it('resolves the rotor, the stator field and the coil geometry into SI', () => {
    expect(resolveCurrentModel(motorScene())).toEqual({
      type: 'motor',
      benchId: 'current-bench-1',
      current: 2,
      turns: 100,
      magneticFluxDensity: 0.5,
      sideLength: 0.06,
      coilWidth: 0.04,
      coilAngle: 0,
    })
  })

  it('puts 0.06 N on each side and 0.24 N·m on the coil', () => {
    const reading = motorReadingOf({
      type: 'motor',
      benchId: 'current-bench-1',
      current: 2,
      turns: 100,
      magneticFluxDensity: 0.5,
      sideLength: 0.06,
      coilWidth: 0.04,
      coilAngle: 0,
    })
    expect(reading.coilArea).toBeCloseTo(2.4e-3, 15)
    expect(reading.sideForce).toBeCloseTo(0.06, 15)
    expect(reading.torque).toBeCloseTo(0.24, 15)
    /* The sign is the turning direction, not a magnitude artefact: the same
       rig with the current reversed turns the other way. */
    expect(
      motorReadingOf({
        type: 'motor',
        benchId: 'current-bench-1',
        current: -2,
        turns: 100,
        magneticFluxDensity: 0.5,
        sideLength: 0.06,
        coilWidth: 0.04,
        coilAngle: 0,
      }).torque,
    ).toBeCloseTo(-0.24, 15)
    expect(reading.peakTorque).toBeCloseTo(0.24, 15)
    /* The couple route and the nBIA route are the same number. */
    expect(
      reading.turns * reading.sideForce * reading.coilWidth * Math.cos(reading.angle),
    ).toBeCloseTo(reading.torque, 15)
  })

  it('falls to 0.12 N·m at 60° and to nothing at the dead point', () => {
    const area = coilAreaOf(0.06, 0.04)
    expect(motorTorqueAt(0.5, 2, 100, area, Math.PI / 3)).toBeCloseTo(0.12, 12)
    /* 平衡位置: the forces are still there, they just bend nothing. */
    expect(Math.abs(motorTorqueAt(0.5, 2, 100, area, Math.PI / 2))).toBeLessThan(1e-9)
    expect(ampereForceOnSide(0.5, 2, 0.06)).toBeCloseTo(0.06, 15)
  })

  it('reverses the bare coil past the dead point, and the commutator undoes that', () => {
    const area = coilAreaOf(0.06, 0.04)
    const step = Math.PI / 36
    const before = motorTorqueAt(0.5, 2, 100, area, Math.PI / 2 - step)
    const afterBare = motorTorqueAt(0.5, 2, 100, area, Math.PI / 2 + step)
    const afterCommutated = motorTorqueAt(0.5, -2, 100, area, Math.PI / 2 + step)
    expect(before).toBeGreaterThan(0)
    expect(afterBare).toBeLessThan(0)
    expect(afterCommutated).toBeCloseTo(before, 12)
  })

  it('doubles the torque when the current doubles — linear, unlike the electromagnet', () => {
    const area = coilAreaOf(0.06, 0.04)
    expect(motorTorqueAt(0.5, 4, 100, area, 0) / motorTorqueAt(0.5, 2, 100, area, 0)).toBeCloseTo(2, 12)
  })

  it('verifies the ampere couple, the dead point, the commutator and the linearity', () => {
    const scene = motorScene()
    expect(checkPassed(scene, 'torque_from_ampere_force')).toBe(true)
    expect(checkPassed(scene, 'torque_vanishes_at_dead_point')).toBe(true)
    expect(checkPassed(scene, 'commutator_keeps_torque_one_signed')).toBe(true)
    expect(checkPassed(scene, 'torque_proportional_to_current')).toBe(true)
    expect(simulated(scene).verification.status).toBe('passed')
    expect(currentFieldEngine.canHandle(scene)).toMatchObject({
      supported: true,
      modelId: MOTOR_MODEL,
    })
  })

  it('reports the couple, the torque and its peak as derived quantities', () => {
    const scene = motorScene()
    expect(scalarOf(scene, 'rotor_current')).toBe(2)
    expect(scalarOf(scene, 'rotor_turns')).toBe(100)
    expect(scalarOf(scene, 'stator_field')).toBe(0.5)
    expect(scalarOf(scene, 'coil_area')).toBeCloseTo(2.4e-3, 15)
    expect(scalarOf(scene, 'side_force')).toBeCloseTo(0.06, 15)
    expect(scalarOf(scene, 'motor_torque')).toBeCloseTo(0.24, 15)
    expect(scalarOf(scene, 'peak_torque')).toBeCloseTo(0.24, 15)
    expect(scalarOf(scene, 'rotation_sense')).toBe(1)
    const torque = simulated(scene).derivedQuantities.find(entry => entry.key === 'motor_torque')
    expect(torque?.formula?.expression).toBe('τ = n·B·I·A·cosθ')
  })

  it('re-solves from the inspector: the field, the angle and both coil sides', () => {
    const runtime = new SceneRuntime(motorScene())

    const stronger = execute(runtime, 'SetRotorField', {
      benchId: 'current-bench-1',
      field: quantity(1, 'T', 'magnetic_flux_density'),
    })
    expect(stronger.ok).toBe(true)
    expect(scalarOf(runtime.getScene(), 'motor_torque')).toBeCloseTo(0.48, 12)

    /* Turning the coil to the dead point takes the torque to zero while the
       side force stays exactly where it was — that IS the dead point. */
    const turned = execute(runtime, 'SetRotorAngle', {
      benchId: 'current-bench-1',
      angle: quantity(90, 'deg', 'angle'),
    })
    expect(turned.ok).toBe(true)
    expect(Math.abs(scalarOf(runtime.getScene(), 'motor_torque'))).toBeLessThan(1e-9)
    /* The field is 1 T by now, so the couple on each side is 0.12 N — the
       dead point removes the TORQUE, not the force. */
    expect(scalarOf(runtime.getScene(), 'side_force')).toBeCloseTo(0.12, 12)

    /* A wider coil is a longer lever arm and a bigger area: both routes double. */
    const wider = execute(runtime, 'SetRotorCoilWidth', {
      benchId: 'current-bench-1',
      width: quantity(8, 'cm', 'length'),
    })
    expect(wider.ok).toBe(true)
    expect(scalarOf(runtime.getScene(), 'coil_area')).toBeCloseTo(4.8e-3, 12)

    const longer = execute(runtime, 'SetRotorSideLength', {
      benchId: 'current-bench-1',
      length: quantity(12, 'cm', 'length'),
    })
    expect(longer.ok).toBe(true)
    /* 1 T × 2 A × 0.12 m: doubling the side doubles the force on it. */
    expect(scalarOf(runtime.getScene(), 'side_force')).toBeCloseTo(0.24, 12)
  })

  it('refuses a rotor command on a rig that has no rotor', () => {
    const runtime = new SceneRuntime(wireScene())
    const result = execute(runtime, 'SetRotorAngle', {
      benchId: 'current-bench-1',
      angle: quantity(30, 'deg', 'angle'),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CURRENT_WRONG_SUBMODEL')
  })

  it('refuses a rotor with no field, no sides or no turns', () => {
    const bench = currentBenchesOf(motorScene())[0]!
    for (const missing of ['magneticFluxDensity', 'sideLength', 'coilWidth', 'turns'] as const) {
      const broken = { ...motorScene(), currentBenches: [{ ...bench, [missing]: undefined }] }
      expect(currentFieldEngine.canHandle(broken).supported, missing).toBe(false)
    }
    const noField = motorScene({ magneticFluxDensity: 0 })
    expect(currentFieldEngine.canHandle(noField).supported).toBe(false)
  })
})

describe('current scenes', () => {
  it('is recognised as a pure current scene, and not as anything else', () => {
    expect(isCurrentScene(wireScene())).toBe(true)
    expect(isCurrentScene(solenoidScene())).toBe(true)
    expect(isCurrentScene(createMagneticScene())).toBe(false)
    expect(currentBenchesOf(createMagneticScene())).toEqual([])
  })

  it('falls back to an empty bench list for scenes persisted before the slice', () => {
    const legacy = { ...wireScene() } as Record<string, unknown>
    delete legacy.currentBenches
    expect(currentBenchesOf(legacy as unknown as PhysicsScene)).toEqual([])
    expect(isCurrentScene(legacy as unknown as PhysicsScene)).toBe(false)
  })

  it('derives the field from a scene rather than reading one off it', () => {
    const scene = wireScene()
    expect(scene.metadata.description).toContain('B = μ₀I/(2πr)')
    expect(
      derivedScalar(simulated(scene).states[0]!.derived, 'magnetic_flux_density')?.value,
    ).toBeCloseTo(4e-5, 12)
  })
})

describe('current scene commands', () => {
  it('doubles the field when the current is doubled, through a real revision bump', () => {
    const runtime = new SceneRuntime(wireScene())
    expect(fieldOf(runtime.getScene())).toBeCloseTo(4e-5, 12)

    const result = execute(runtime, 'SetCurrent', {
      benchId: 'current-bench-1',
      current: quantity(20, 'A', 'electric_current'),
    })
    expect(result.ok).toBe(true)
    expect(runtime.getScene().revision).toBe(1)
    expect(fieldOf(runtime.getScene())).toBeCloseTo(8e-5, 12)
  })

  it('reverses the field when the current reverses, without changing its strength', () => {
    const runtime = new SceneRuntime(wireScene())
    const before = fieldOf(runtime.getScene())

    expect(
      execute(runtime, 'SetCurrent', {
        benchId: 'current-bench-1',
        current: quantity(-10, 'A', 'electric_current'),
      }).ok,
    ).toBe(true)
    expect(fieldOf(runtime.getScene())).toBeCloseTo(before, 15)
    expect(scalarOf(runtime.getScene(), 'field_circulation')).toBe(-1)
  })

  it('moves the probe and the reading follows the inverse-distance law', () => {
    const runtime = new SceneRuntime(wireScene())
    expect(
      execute(runtime, 'SetProbeDistance', {
        benchId: 'current-bench-1',
        distance: quantity(10, 'cm', 'length'),
      }).ok,
    ).toBe(true)
    expect(scalarOf(runtime.getScene(), 'probe_distance')).toBeCloseTo(0.1, 12)
    expect(fieldOf(runtime.getScene())).toBeCloseTo(2e-5, 12)
  })

  it('winds more turns on the coil and the field scales with them', () => {
    const runtime = new SceneRuntime(solenoidScene())
    const before = fieldOf(runtime.getScene())

    expect(
      execute(runtime, 'SetSolenoidTurns', {
        benchId: 'current-bench-1',
        turns: quantity(800, '', 'dimensionless'),
      }).ok,
    ).toBe(true)
    expect(runtime.getScene().revision).toBe(1)
    expect(fieldOf(runtime.getScene()) / before).toBeCloseTo(2, 12)
  })

  it('shortens the coil and the same turns make a stronger field', () => {
    const runtime = new SceneRuntime(solenoidScene())
    const before = fieldOf(runtime.getScene())
    expect(
      execute(runtime, 'SetSolenoidLength', {
        benchId: 'current-bench-1',
        length: quantity(10, 'cm', 'length'),
      }).ok,
    ).toBe(true)
    expect(fieldOf(runtime.getScene()) / before).toBeCloseTo(2, 12)
  })

  it('refuses a zero current, a zero distance and a zero turn count', () => {
    const wire = new SceneRuntime(wireScene())
    const zeroCurrent = execute(wire, 'SetCurrent', {
      benchId: 'current-bench-1',
      current: quantity(0, 'A', 'electric_current'),
    })
    expect(zeroCurrent.ok).toBe(false)
    expect(wire.getScene().revision).toBe(0)

    const zeroDistance = execute(wire, 'SetProbeDistance', {
      benchId: 'current-bench-1',
      distance: quantity(0, 'cm', 'length'),
    })
    expect(zeroDistance.ok).toBe(false)

    const solenoid = new SceneRuntime(solenoidScene())
    expect(
      execute(solenoid, 'SetSolenoidTurns', {
        benchId: 'current-bench-1',
        turns: quantity(0, '', 'dimensionless'),
      }).ok,
    ).toBe(false)
  })

  it('refuses a command addressed to the other rig', () => {
    /* The two rigs share a bench id and a current, so a probe distance has to be
       refused on a coil rather than silently stored and ignored. */
    const solenoid = new SceneRuntime(solenoidScene())
    const onCoil = execute(solenoid, 'SetProbeDistance', {
      benchId: 'current-bench-1',
      distance: quantity(5, 'cm', 'length'),
    })
    expect(onCoil.ok).toBe(false)
    if (!onCoil.ok) expect(onCoil.error.code).toBe('CURRENT_WRONG_SUBMODEL')

    const wire = new SceneRuntime(wireScene())
    const onWire = execute(wire, 'SetSolenoidTurns', {
      benchId: 'current-bench-1',
      turns: quantity(800, '', 'dimensionless'),
    })
    expect(onWire.ok).toBe(false)
    if (!onWire.ok) expect(onWire.error.code).toBe('CURRENT_WRONG_SUBMODEL')
  })

  it('refuses an unknown bench and a stale revision', () => {
    const runtime = new SceneRuntime(wireScene())
    const unknown = execute(runtime, 'SetCurrent', {
      benchId: 'no-such-bench',
      current: quantity(5, 'A', 'electric_current'),
    })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.error.code).toBe('CURRENT_BENCH_NOT_FOUND')

    const scene = runtime.getScene()
    const stale = runtime.execute(
      createSceneCommand({
        commandId: 'cmd-stale',
        sceneId: String(scene.id),
        expectedRevision: scene.revision + 5,
        type: 'SetCurrent',
        payload: { benchId: 'current-bench-1', current: quantity(5, 'A', 'electric_current') },
        traceId: 'trace-stale',
      }) as SceneCommand,
    )
    expect(stale.ok).toBe(false)
  })
})
