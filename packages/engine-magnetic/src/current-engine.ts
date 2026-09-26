import {
  check,
  invalidModelCondition,
  summarizeVerification,
  supported,
  unsupportedModel,
  type DerivedQuantity,
  type ModelSupport,
  type PhysicsEngine,
  type PhysicsEventLike,
  type QuantityVector,
  type SimulationRequest,
  type SimulationResult,
  type SimulationState,
  type VerificationCheck,
  type VerificationResult,
} from '@physicsos/physics-core'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'
import { currentBenchesOf, validateScene, type PhysicsScene } from '@physicsos/physics-scene'
import { asPhysicsEventId, asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'

import { resolveCurrentModel, type ResolvedCurrentModel } from './current-model.ts'
import {
  CURRENT_RELATIVE_TOLERANCE,
  coilAreaOf,
  coreFieldMagnitude,
  electromagnetFieldOf,
  finiteSegmentFieldMagnitude,
  motorReadingOf,
  motorTorqueAt,
  poleFacePull,
  solenoidFieldMagnitude,
  straightWireFieldOf,
  straightWireFieldMagnitude,
  solenoidFieldOf,
} from './current.ts'

export const CURRENT_ENGINE_ID = 'engine-current-magnetic'
export const CURRENT_ENGINE_VERSION = '1.0.0'
export const STRAIGHT_WIRE_FIELD_MODEL = 'straight_wire_magnetic_field'
export const SOLENOID_FIELD_MODEL = 'uniform_solenoid_field'
export const ELECTROMAGNET_MODEL = 'cored_electromagnet'
export const MOTOR_MODEL = 'ampere_force_motor'

/**
 * How many probe radii of wire the finite-segment cross-check is run over.
 *
 * The infinite-wire formula is the limit of the finite one, so the check has to
 * say how far along that limit the bench wire is. A segment this long stands in
 * for "long compared with the probe distance" and the agreement it buys is
 * documented on the check itself.
 */
const FINITE_SEGMENT_RADII = 100

const CURRENT_ASSUMPTIONS = [
  'steady current: the field is the same at every instant, so nothing here depends on the clock',
  'the straight conductor is long compared with the probe distance, so B = μ₀I/(2πr) applies',
  'the solenoid is long compared with its radius, so the field along the axis is uniform',
  'a core stays in its linear regime: μ_r is a constant, and the core never saturates',
  'the rotor turns slowly enough that the current through it is the steady value the bench states',
  'vacuum surroundings: μ = μ₀ everywhere except inside the core',
] as const

const failure = (condition: string, message: string) => ({ condition, message })

const teslas = (value: number): Quantity<'magnetic_flux_density'> =>
  quantity(value, 'T', 'magnetic_flux_density')
const amperes = (value: number): Quantity<'electric_current'> =>
  quantity(value, 'A', 'electric_current')
const metres = (value: number): Quantity<'length'> => quantity(value, 'm', 'length')
const newtons = (value: number): Quantity<'force'> => quantity(value, 'N', 'force')
const kilograms = (value: number): Quantity<'mass'> => quantity(value, 'kg', 'mass')
const squareMetres = (value: number): Quantity<'area'> => quantity(value, 'm^2', 'area')
const newtonMetres = (value: number): Quantity<'torque'> => quantity(value, 'N*m', 'torque')
const Radians = (value: number): Quantity<'angle'> => quantity(value, 'rad', 'angle')
const turnsQuantity = (value: number): Quantity<'dimensionless'> =>
  quantity(value, '', 'dimensionless')

/** Solve the scene's current bench; the single entry point UI layers reuse. */
export const resolveCurrent = (scene: PhysicsScene): ResolvedCurrentModel =>
  resolveCurrentModel(scene)

/* ------------------------------------------------------------- state/dqs -- */

const derivedOf = (model: ResolvedCurrentModel): DerivedQuantity[] => {
  const assumptions = [...CURRENT_ASSUMPTIONS]
  if (model.type === 'straight_wire') {
    const reading = straightWireFieldOf(model)
    const entries: DerivedQuantity[] = [
      {
        key: 'wire_current',
        targetId: model.benchId,
        value: amperes(reading.current),
        formula: { expression: 'I' },
        assumptions,
      },
      {
        key: 'probe_distance',
        targetId: model.benchId,
        value: metres(reading.probeDistance),
        formula: { expression: 'r' },
        assumptions,
      },
      {
        key: 'magnetic_flux_density',
        targetId: model.benchId,
        value: teslas(reading.field),
        formula: { expression: 'B = μ₀I/(2πr)' },
        assumptions,
      },
      {
        key: 'field_circulation',
        targetId: model.benchId,
        value: turnsQuantity(reading.circulation),
        formula: { expression: '安培定则：右手握导线，拇指指电流，四指绕磁场' },
        assumptions,
      },
    ]
    if (reading.comparisonDistance !== undefined && reading.comparisonField !== undefined) {
      entries.push(
        {
          key: 'comparison_distance',
          targetId: model.benchId,
          value: metres(reading.comparisonDistance),
          formula: { expression: 'r₂' },
          assumptions,
        },
        {
          key: 'comparison_field',
          targetId: model.benchId,
          value: teslas(reading.comparisonField),
          formula: { expression: 'B₂ = μ₀I/(2πr₂)' },
          assumptions,
        },
      )
    }
    return entries
  }

  if (model.type === 'motor') {
    const reading = motorReadingOf(model)
    return [
      {
        key: 'rotor_current',
        targetId: model.benchId,
        value: amperes(reading.current),
        formula: { expression: 'I' },
        assumptions,
      },
      {
        key: 'rotor_turns',
        targetId: model.benchId,
        value: turnsQuantity(reading.turns),
        formula: { expression: 'n' },
        assumptions,
      },
      {
        key: 'stator_field',
        targetId: model.benchId,
        value: teslas(reading.field),
        formula: { expression: 'B' },
        assumptions,
      },
      {
        key: 'coil_area',
        targetId: model.benchId,
        value: squareMetres(reading.coilArea),
        formula: { expression: 'A = L·W' },
        assumptions,
      },
      {
        key: 'coil_angle',
        targetId: model.benchId,
        value: Radians(reading.angle),
        formula: { expression: 'θ（线圈平面与 B 的夹角）' },
        assumptions,
      },
      {
        key: 'side_force',
        targetId: model.benchId,
        value: newtons(reading.sideForce),
        formula: { expression: 'F = B·I·L' },
        assumptions,
      },
      {
        key: 'motor_torque',
        targetId: model.benchId,
        value: newtonMetres(reading.torque),
        formula: { expression: 'τ = n·B·I·A·cosθ' },
        assumptions,
      },
      {
        key: 'peak_torque',
        targetId: model.benchId,
        value: newtonMetres(reading.peakTorque),
        formula: { expression: 'τ_max = n·B·I·A（θ = 0）' },
        assumptions,
      },
      {
        key: 'rotation_sense',
        targetId: model.benchId,
        value: turnsQuantity(reading.sense),
        formula: { expression: '左手定则：电流反向，转动方向反向' },
        assumptions,
      },
    ]
  }

  if (model.type === 'electromagnet') {
    const reading = electromagnetFieldOf(model)
    const entries: DerivedQuantity[] = [
      {
        key: 'coil_current',
        targetId: model.benchId,
        value: amperes(reading.current),
        formula: { expression: 'I' },
        assumptions,
      },
      {
        key: 'coil_turns',
        targetId: model.benchId,
        value: turnsQuantity(reading.turns),
        formula: { expression: 'N' },
        assumptions,
      },
      {
        key: 'coil_length',
        targetId: model.benchId,
        value: metres(reading.coilLength),
        formula: { expression: 'L' },
        assumptions,
      },
      {
        key: 'core_permeability',
        targetId: model.benchId,
        value: turnsQuantity(reading.coreRelativePermeability),
        formula: { expression: 'μ_r' },
        assumptions,
      },
      {
        key: 'magnetic_flux_density',
        targetId: model.benchId,
        value: teslas(reading.field),
        formula: { expression: 'B = μ_r·μ₀(N/L)I' },
        assumptions,
      },
      /* The air-cored field is the baseline the core multiplies, not a second
         rig: without it the μ_r in the headline number has nothing to be 200
         TIMES. */
      {
        key: 'air_cored_field',
        targetId: model.benchId,
        value: teslas(reading.airField),
        formula: { expression: 'B₀ = μ₀(N/L)I（无铁芯）' },
        assumptions,
      },
      {
        key: 'pole_face_pull',
        targetId: model.benchId,
        value: newtons(reading.pull),
        formula: { expression: 'F = B²A/(2μ₀)' },
        assumptions,
      },
      {
        key: 'held_mass',
        targetId: model.benchId,
        value: kilograms(reading.heldMass),
        formula: { expression: 'm = F/g' },
        assumptions,
      },
      {
        key: 'north_pole',
        targetId: model.benchId,
        value: turnsQuantity(reading.northPole),
        formula: { expression: '安培定则：四指顺电流环绕方向，拇指指 N 极' },
        assumptions,
      },
    ]
    if (
      reading.comparisonCoreRelativePermeability !== undefined &&
      reading.comparisonField !== undefined &&
      reading.comparisonPull !== undefined
    ) {
      entries.push(
        {
          key: 'comparison_core_permeability',
          targetId: model.benchId,
          value: turnsQuantity(reading.comparisonCoreRelativePermeability),
          formula: { expression: 'μ_r₂' },
          assumptions,
        },
        {
          key: 'comparison_field',
          targetId: model.benchId,
          value: teslas(reading.comparisonField),
          formula: { expression: 'B₂ = μ_r₂·μ₀(N/L)I' },
          assumptions,
        },
        {
          key: 'comparison_pull',
          targetId: model.benchId,
          value: newtons(reading.comparisonPull),
          formula: { expression: 'F₂ = B₂²A/(2μ₀)' },
          assumptions,
        },
      )
    }
    return entries
  }

  const reading = solenoidFieldOf(model)
  const entries: DerivedQuantity[] = [
    {
      key: 'coil_current',
      targetId: model.benchId,
      value: amperes(reading.current),
      formula: { expression: 'I' },
      assumptions,
    },
    {
      key: 'coil_turns',
      targetId: model.benchId,
      value: turnsQuantity(reading.turns),
      formula: { expression: 'N' },
      assumptions,
    },
    {
      key: 'coil_length',
      targetId: model.benchId,
      value: metres(reading.coilLength),
      formula: { expression: 'L' },
      assumptions,
    },
    {
      key: 'magnetic_flux_density',
      targetId: model.benchId,
      value: teslas(reading.field),
      formula: { expression: 'B = μ₀(N/L)I' },
      assumptions,
    },
    {
      key: 'end_field',
      targetId: model.benchId,
      value: teslas(reading.endField),
      formula: { expression: 'B_端 = B/2' },
      assumptions,
    },
    {
      key: 'north_pole',
      targetId: model.benchId,
      value: turnsQuantity(reading.northPole),
      formula: { expression: '安培定则：右手握螺线管，四指顺电流，拇指指 N 极' },
      assumptions,
    },
  ]
  if (reading.comparisonTurns !== undefined && reading.comparisonField !== undefined) {
    entries.push(
      {
        key: 'comparison_turns',
        targetId: model.benchId,
        value: turnsQuantity(reading.comparisonTurns),
        formula: { expression: 'N₂' },
        assumptions,
      },
      {
        key: 'comparison_field',
        targetId: model.benchId,
        value: teslas(reading.comparisonField),
        formula: { expression: 'B₂ = μ₀(N₂/L)I' },
        assumptions,
      },
    )
  }
  return entries
}

/**
 * The current is steady, so the rig is in the same configuration at every
 * instant and the state is the settled reading rather than a snapshot of a
 * changing one. `time` is accepted so the engine satisfies the same interface
 * as the timed benches, and it does not change a single value.
 */
const stateOf = (model: ResolvedCurrentModel, timeSeconds: number): SimulationState => {
  const values: Record<string, Quantity | QuantityVector> = {}
  for (const entry of derivedOf(model)) values[entry.key] = entry.value
  return {
    time: quantity(timeSeconds, 's', 'time'),
    objects: [{ id: model.benchId, values }],
    derived: derivedOf(model),
  }
}

/* ---------------------------------------------------------- verification -- */

/**
 * Agreement within the engine's tolerance.
 *
 * The tolerance has a RELATIVE term and an ABSOLUTE floor, and the floor is what
 * makes the dead point checkable: two computations of a torque that is exactly
 * zero agree to within rounding noise (≈10⁻¹⁷) rather than to a fraction of
 * nothing. Without it, a check that compares 1.5×10⁻¹⁷ against 0 would fail on
 * the one angle the rig exists to demonstrate.
 */
const within = (actual: number, expected: number, scale: number): boolean =>
  Math.abs(actual - expected) <=
  Math.max(CURRENT_RELATIVE_TOLERANCE, CURRENT_RELATIVE_TOLERANCE * Math.abs(scale))

const buildVerification = (
  scene: PhysicsScene,
  model: ResolvedCurrentModel,
): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]

  if (model.type === 'straight_wire') {
    const reading = straightWireFieldOf(model)

    /* B = μ₀I/(2πr) is the infinite-wire limit of the Biot–Savart result for a
       finite segment. Running that integral for a segment 100 probe radii long
       and comparing it with the reading is what licenses the shortcut for the
       wire actually on the bench — a slipped 2π in the reading would not
       survive the comparison. */
    const fromSegment = finiteSegmentFieldMagnitude(
      model.current,
      model.probeDistance,
      FINITE_SEGMENT_RADII * model.probeDistance,
    )
    checks.push(
      check(
        'wire_field_from_finite_segment',
        'constraint',
        Math.abs(fromSegment / reading.field - 1) <= 1e-3,
        {
          message: `无限长直导线公式 B = μ₀I/(2πr) 是毕奥–萨伐尔有限长结果的极限：取 ${FINITE_SEGMENT_RADII} 倍探测距离长的导线，两者的差不到千分之一。`,
          targetId: model.benchId,
          details: {
            fromInfiniteWire: reading.field,
            fromFiniteSegment: fromSegment,
            segmentRadii: FINITE_SEGMENT_RADII,
            probeDistance: reading.probeDistance,
          },
        },
      ),
    )

    if (reading.comparisonDistance !== undefined && reading.comparisonField !== undefined) {
      /* The law the experiment exists to show: B is inversely proportional to r,
         so the product B·r is the same at both probes. Checked as that invariant
         and against a fresh evaluation, not by re-reading one product twice. */
      const rederived = straightWireFieldMagnitude(model.current, reading.comparisonDistance)
      checks.push(
        check(
          'field_inverse_with_distance',
          'constraint',
          reading.probeDistance > 0 &&
            Math.abs(
              reading.comparisonField / reading.field -
                reading.probeDistance / reading.comparisonDistance,
            ) <=
              CURRENT_RELATIVE_TOLERANCE * (reading.probeDistance / reading.comparisonDistance) &&
            within(rederived, reading.comparisonField, reading.comparisonField),
          {
            message: '磁场与距离成反比：B·r 在两处探测点上相同，距离加倍磁场就减半。',
            targetId: model.benchId,
            details: {
              probeDistance: reading.probeDistance,
              comparisonDistance: reading.comparisonDistance,
              field: reading.field,
              comparisonField: reading.comparisonField,
            },
          },
        ),
      )
    }

    /* 安培定则 as a computable claim rather than a picture: the circulation sign
       is the current's sign, and reversing the current reverses the field. */
    checks.push(
      check(
        'field_direction_follows_current',
        'constraint',
        reading.circulation === (model.current > 0 ? 1 : -1) &&
          -reading.circulation ===
            (straightWireFieldOf({ ...model, current: -model.current }).circulation as number) &&
          within(
            straightWireFieldMagnitude(-model.current, model.probeDistance),
            reading.field,
            reading.field,
          ),
        {
          message:
            '安培定则：右手握住导线、拇指指向电流方向，四指弯曲的方向就是磁场方向；电流反向，磁场也反向，而强弱不变。',
          targetId: model.benchId,
          details: { current: model.current, circulation: reading.circulation },
        },
      ),
    )

    return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
  }

  if (model.type === 'motor') {
    const reading = motorReadingOf(model)
    const area = coilAreaOf(model.sideLength, model.coilWidth)

    /* The couple, computed from the FORCES rather than from nBIA: two sides
       carrying F = BIL the other way round, each half a coil-width from the
       axis, makes τ = n·F·W·cosθ. A rig that lost the lever arm, or counted the
       sides twice, cannot land on the same number by both routes. */
    /* `sideForce` is a magnitude — the two sides carry it the other way round —
       so the couple's DIRECTION comes from the current's sign, exactly as the
       torque's does. */
    const fromForces =
      Math.sign(model.current) *
      model.turns *
      reading.sideForce *
      model.coilWidth *
      Math.cos(reading.angle)
    checks.push(
      check(
        'torque_from_ampere_force',
        'constraint',
        within(fromForces, reading.torque, reading.torque),
        {
          message:
            '安培力与力矩：两条受力的边各受 F = B·I·L，方向相反、相距一个线圈宽度，于是 τ = n·F·W·cosθ，与 τ = n·B·I·A·cosθ 一致。',
          targetId: model.benchId,
          details: {
            sideForce: reading.sideForce,
            coilWidth: reading.coilWidth,
            fromForces,
            fromTorqueFormula: reading.torque,
          },
        },
      ),
    )

    /* The 平衡位置: the forces are still there, but they pull straight out of the
       plane, so the coil bends nothing. This is why a bare coil stalls — and
       why a real motor has a commutator. */
    const atDeadPoint = motorTorqueAt(
      model.magneticFluxDensity,
      model.current,
      model.turns,
      area,
      Math.PI / 2,
    )
    checks.push(
      check(
        'torque_vanishes_at_dead_point',
        'constraint',
        Math.abs(atDeadPoint) <= CURRENT_RELATIVE_TOLERANCE,
        {
          message:
            '平衡位置：线圈平面与 B 垂直（θ = 90°）时两条边受的力都垂直于线圈平面，力矩恰好为零 —— 线圈在这里卡住。',
          targetId: model.benchId,
          details: { angle: reading.angle, torqueAtDeadPoint: atDeadPoint },
        },
      ),
    )

    /* What the commutator does, as a computation: just past the dead point the
       bare coil's torque has changed sign, and reversing the current there
       restores the sign it had just before. Checked across the two sides of 90°
       so it is about the sign, not about a coincidentally positive number. */
    const step = Math.PI / 36
    const before = motorTorqueAt(
      model.magneticFluxDensity,
      model.current,
      model.turns,
      area,
      Math.PI / 2 - step,
    )
    const afterBare = motorTorqueAt(
      model.magneticFluxDensity,
      model.current,
      model.turns,
      area,
      Math.PI / 2 + step,
    )
    const afterCommutated = motorTorqueAt(
      model.magneticFluxDensity,
      -model.current,
      model.turns,
      area,
      Math.PI / 2 + step,
    )
    /* Stated on SIGNS, not on "positive": the rig works with the current either
       way round, and what the commutator preserves is the direction of turning,
       not a particular one. */
    const turnsForward = Math.sign(before)
    checks.push(
      check(
        'commutator_keeps_torque_one_signed',
        'constraint',
        turnsForward !== 0 &&
          Math.sign(afterBare) === -turnsForward &&
          Math.sign(afterCommutated) === turnsForward &&
          within(afterCommutated, before, before),
        {
          message:
            '换向器的作用：过了平衡位置之后裸线圈的力矩会反向，换向器把电流反向一次，力矩就回到原来的方向 —— 所以直流电动机能一直朝一个方向转。',
          targetId: model.benchId,
          details: {
            beforeDeadPoint: before,
            afterDeadPoint: afterBare,
            afterCommutating: afterCommutated,
          },
        },
      ),
    )

    /* Linear here, unlike the electromagnet's square: the torque is ∝ B·I·A. */
    const doubled = motorTorqueAt(
      model.magneticFluxDensity,
      model.current * 2,
      model.turns,
      area,
      reading.angle,
    )
    checks.push(
      check(
        'torque_proportional_to_current',
        'constraint',
        within(doubled, 2 * reading.torque, 2 * reading.torque),
        {
          message: '力矩与电流成正比：τ = n·B·I·A·cosθ，电流加倍力矩加倍。',
          targetId: model.benchId,
          details: { torque: reading.torque, torqueAtDoubleCurrent: doubled },
        },
      ),
    )

    return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
  }

  if (model.type === 'electromagnet') {
    const reading = electromagnetFieldOf(model)

    /* Two computations of the same field: the core multiplies the coil's own
       air-cored field by μ_r, and μ_r is what the bench says it threaded. A rig
       that dropped the permeability, or applied it to the current instead of
       the field, cannot satisfy both halves of this. */
    const airFromCoil = solenoidFieldMagnitude(model.current, model.turns, model.coilLength)
    checks.push(
      check(
        'core_field_from_permeability',
        'constraint',
        within(reading.airField, airFromCoil, airFromCoil) &&
          within(
            reading.field / reading.airField,
            model.coreRelativePermeability,
            model.coreRelativePermeability,
          ),
        {
          message:
            '铁芯的作用：B = μ_r·μ₀(N/L)I —— 同一个线圈，空气芯是 μ₀(N/L)I，插上 μ_r 的铁芯后磁感应强度正好乘 μ_r。',
          targetId: model.benchId,
          details: {
            coreRelativePermeability: model.coreRelativePermeability,
            airCoredField: reading.airField,
            coredField: reading.field,
          },
        },
      ),
    )

    /* The pull goes as B², so doubling the current must quadruple it — the
       check that catches a missing square, which is the one error that would
       make the iron look like a modest improvement instead of a 40000× one. */
    const doubledField = coreFieldMagnitude(
      model.current * 2,
      model.turns,
      model.coilLength,
      model.coreRelativePermeability,
    )
    const doubledPull = poleFacePull(doubledField, model.coreArea)
    checks.push(
      check(
        'pull_proportional_to_field_squared',
        'constraint',
        within(doubledPull, 4 * reading.pull, 4 * reading.pull),
        {
          message: '吸力与磁感应强度的平方成正比：F = B²A/(2μ₀)，电流加倍 B 加倍、吸力变为四倍。',
          targetId: model.benchId,
          details: {
            current: model.current,
            pull: reading.pull,
            pullAtDoubleCurrent: doubledPull,
            poleFaceArea: reading.coreArea,
          },
        },
      ),
    )

    if (
      reading.comparisonCoreRelativePermeability === undefined ||
      reading.comparisonPull === undefined
    ) {
      return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
    }

    /* The same square, on the core: μ_r doubles the FIELD and quadruples the
       PULL. This is the surprising consequence of F ∝ B² and the reason the rig
       is worth building — checked as a ratio, so it holds whatever the coil. */
    const coreRatio = reading.comparisonCoreRelativePermeability / model.coreRelativePermeability
    checks.push(
      check(
        'pull_proportional_to_core_squared',
        'constraint',
        within(reading.comparisonPull / reading.pull, coreRatio * coreRatio, coreRatio * coreRatio),
        {
          message:
            '吸力与铁芯磁导率的平方成正比：换一个 μ_r 大多少倍的核心，吸力就变成那个倍数的平方 —— 因为 μ_r 只把 B 乘以 μ_r，而 F ∝ B²。',
          targetId: model.benchId,
          details: {
            coreRelativePermeability: model.coreRelativePermeability,
            comparisonCoreRelativePermeability: reading.comparisonCoreRelativePermeability,
            pull: reading.pull,
            comparisonPull: reading.comparisonPull,
          },
        },
      ),
    )

    return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
  }

  const reading = solenoidFieldOf(model)

  /* B = μ₀nI is the interior field. The field at the mouth of the same coil is
     half of it — a different superposition, not the same formula rearranged —
     so a reading that has lost its factor of one half, or gained a stray one,
     cannot satisfy both. */
  const interiorFromMouth = reading.endField * 2
  checks.push(
    check(
      'solenoid_field_from_turn_density',
      'constraint',
      within(interiorFromMouth, reading.field, reading.field) &&
        within(
          solenoidFieldMagnitude(model.current, model.turns, model.coilLength) / reading.field,
          1,
          1,
        ),
      {
        message:
          '螺线管内部磁场 B = μ₀(N/L)I：管内是匀强磁场，管口处的磁场恰好是管内的一半，两者互相印证。',
        targetId: model.benchId,
        details: {
          turns: reading.turns,
          coilLength: reading.coilLength,
          turnDensity: reading.turnDensity,
          field: reading.field,
          endField: reading.endField,
        },
      },
    ),
  )

  if (reading.comparisonTurns !== undefined && reading.comparisonField !== undefined) {
    /* Same former, same length, more turns: the field scales with N alone. */
    const rederived = solenoidFieldMagnitude(
      model.current,
      reading.comparisonTurns,
      model.coilLength,
    )
    checks.push(
      check(
        'field_proportional_to_turns',
        'constraint',
        Math.abs(
          reading.comparisonTurns / reading.turns - reading.comparisonField / reading.field,
        ) <=
          CURRENT_RELATIVE_TOLERANCE * (reading.comparisonTurns / reading.turns) &&
          within(rederived, reading.comparisonField, reading.comparisonField),
        {
          message: '磁场与匝数成正比：同一个线圈骨架上线圈绕得越多，磁场越强，B₂/B 等于 N₂/N。',
          targetId: model.benchId,
          details: {
            turns: reading.turns,
            comparisonTurns: reading.comparisonTurns,
            field: reading.field,
            comparisonField: reading.comparisonField,
          },
        },
      ),
    )
  }

  /* 安培定则 for the coil: the end the right-hand rule points at is north, and
     reversing the current swaps the poles. */
  checks.push(
    check(
      'north_pole_follows_current',
      'constraint',
      reading.northPole === (model.current > 0 ? 1 : -1) &&
        -reading.northPole ===
          (solenoidFieldOf({ ...model, current: -model.current }).northPole as number) &&
        within(
          solenoidFieldMagnitude(-model.current, model.turns, model.coilLength),
          reading.field,
          reading.field,
        ),
      {
        message:
          '安培定则：右手握住螺线管、四指顺着电流环绕方向，拇指指向的那端是 N 极；电流反向，南北极互换，而磁场强弱不变。',
        targetId: model.benchId,
        details: { current: model.current, northPole: reading.northPole },
      },
    ),
  )

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

/* ------------------------------------------------------- simulation req -- */

export function createCurrentSimulationRequest(
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
): SimulationRequest {
  return {
    schemaVersion: 'simulation-request/1.0',
    simulationId: asSimulationId(simulationId),
    sceneId: scene.id,
    sceneRevision: scene.revision,
    requestedDomain: 'magnetic',
    options: {},
    trace: {
      traceId: asTraceId(traceId),
      sceneId: scene.id,
      sceneRevision: scene.revision,
    },
  }
}

/* ----------------------------------------------------------- the engine -- */

const modelNameOf = (type: ResolvedCurrentModel['type']): string => {
  switch (type) {
    case 'straight_wire':
      return STRAIGHT_WIRE_FIELD_MODEL
    case 'solenoid':
      return SOLENOID_FIELD_MODEL
    case 'electromagnet':
      return ELECTROMAGNET_MODEL
    case 'motor':
      return MOTOR_MODEL
  }
}

export class CurrentFieldEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = CURRENT_ENGINE_ID
  readonly engineVersion = CURRENT_ENGINE_VERSION
  readonly domain = 'magnetic' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    if (currentBenchesOf(scene).length !== 1) {
      return unsupportedModel(
        [failure('single_bench', 'Current Engine requires exactly one current-magnetic bench.')],
        CURRENT_ENGINE_ID,
      )
    }
    if (
      scene.particles.length > 0 ||
      scene.bodies.length > 0 ||
      scene.fields.length > 0 ||
      scene.forces.length > 0 ||
      scene.regions.length > 0 ||
      scene.boundaries.length > 0 ||
      scene.constraints.length > 0 ||
      scene.circuits.length > 0 ||
      (scene.opticalBenches ?? []).length > 0 ||
      (scene.acousticBenches ?? []).length > 0 ||
      (scene.fluidTanks ?? []).length > 0 ||
      (scene.thermalBenches ?? []).length > 0 ||
      (scene.leverBenches ?? []).length > 0 ||
      (scene.pressureBenches ?? []).length > 0 ||
      (scene.inductionBenches ?? []).length > 0 ||
      (scene.waveBenches ?? []).length > 0
    ) {
      return unsupportedModel(
        [
          failure(
            'pure_current_scene',
            'Current Engine models pure current-magnetic benches without motion objects, fields, circuits, optics or other benches.',
          ),
        ],
        CURRENT_ENGINE_ID,
      )
    }

    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(CURRENT_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        CURRENT_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }

    try {
      const model = resolveCurrentModel(scene)
      return supported(modelNameOf(model.type), this.domain)
    } catch (error: unknown) {
      return invalidModelCondition(CURRENT_ENGINE_ID, [
        failure(
          'current_model_resolvable',
          error instanceof Error ? error.message : 'The bench cannot be resolved for a field.',
        ),
      ])
    }
  }

  validate(scene: PhysicsScene): VerificationResult {
    const support = this.canHandle(scene)
    if (support.supported) {
      return { status: 'passed', checks: [], warnings: [], errors: [] }
    }
    return {
      status: 'failed',
      checks: support.failedConditions.map((entry) => ({
        id: entry.condition,
        type: 'constraint',
        passed: false,
        message: entry.message,
      })),
      warnings: [],
      errors: support.failedConditions.map((entry) => ({
        code: entry.condition,
        severity: 'error',
        message: entry.message,
      })),
    }
  }

  stateAt(scene: PhysicsScene, time: Quantity<'time'>): SimulationState {
    const timeSeconds = canonicalValue(time)
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
      throw new PhysicsOSError(
        'INVALID_SIMULATION_TIME',
        'Simulation time must be finite and non-negative.',
      )
    }
    return stateOf(resolveCurrentModel(scene), timeSeconds)
  }

  simulate(scene: PhysicsScene, request: SimulationRequest): SimulationResult<PhysicsEventLike> {
    if (request.sceneId !== scene.id || request.sceneRevision !== scene.revision) {
      throw new PhysicsOSError(
        'SIMULATION_SCENE_MISMATCH',
        'SimulationRequest must reference the exact PhysicsScene revision being simulated.',
        {
          details: {
            requestSceneId: request.sceneId,
            sceneId: scene.id,
            requestRevision: request.sceneRevision,
            sceneRevision: scene.revision,
          },
        },
      )
    }

    const startedAt = new Date().toISOString()
    const model = resolveCurrentModel(scene)

    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      /* One state, because nothing about this apparatus depends on the clock.
         A trajectory longer than a single instant would be an invented curve. */
      states: [stateOf(model, 0)],
      events: [
        {
          eventId: asPhysicsEventId(`event-current-field-settled-${model.benchId}`),
          sceneId: scene.id,
          revision: scene.revision,
          type: 'CurrentFieldSettled',
          time: 0,
        },
      ],
      measurements: [],
      derivedQuantities: derivedOf(model),
      verification: buildVerification(scene, model),
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'magnetostatics-closed-form',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const currentFieldEngine = new CurrentFieldEngine()
