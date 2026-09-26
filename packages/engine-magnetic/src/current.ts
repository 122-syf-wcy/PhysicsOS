import type {
  ResolvedCurrentModel,
  ResolvedElectromagnet,
  ResolvedMotor,
  ResolvedSolenoid,
  ResolvedStraightWire,
} from './current-model.ts'

/**
 * The magnetostatics this engine is allowed to state, as closed-form functions.
 *
 * Kept apart from the engine class for the same reason the pressure rigs keep
 * theirs apart: the golden tests import these directly, so the number a student
 * reads and the number a test asserts come from one implementation.
 */

/**
 * Vacuum permeability μ₀ = 4π×10⁻⁷ T·m/A.
 *
 * Fixed by the definition of the ampere rather than measured, so it is written
 * as the exact product and not as a decimal that has quietly been rounded.
 */
export const VACUUM_PERMEABILITY = 4 * Math.PI * 1e-7

export const CURRENT_RELATIVE_TOLERANCE = 1e-9

/** Which way the field circulates: +1 = out of the page (CCW), −1 = into it. */
export type Circulation = -1 | 1

export interface StraightWireFieldReading {
  readonly current: number
  readonly probeDistance: number
  /** Field magnitude at the probe (T). */
  readonly field: number
  readonly comparisonDistance: number | undefined
  /** Field magnitude at the second probe (T), when the rig has one. */
  readonly comparisonField: number | undefined
  readonly circulation: Circulation
}

export interface SolenoidFieldReading {
  readonly current: number
  readonly turns: number
  readonly coilLength: number
  /** Turns per metre along the axis (1/m). */
  readonly turnDensity: number
  /** Uniform field along the axis (T). */
  readonly field: number
  readonly comparisonTurns: number | undefined
  /** Field of the second winding on the same former (T), when present. */
  readonly comparisonField: number | undefined
  /** Field at the mouth of the coil (T): half the interior value. */
  readonly endField: number
  /** Which end is north: +1 for the end the right-hand rule points at. */
  readonly northPole: Circulation
}

/* ------------------------------------------------------------ the physics -- */

/**
 * Field of an infinitely long straight conductor, B = μ₀I/(2πr).
 *
 * The magnitude, so the caller decides what the sign means; the direction of a
 * circulating field is not a real number and is carried by
 * {@link circulationOf} instead.
 */
export const straightWireFieldMagnitude = (current: number, distance: number): number =>
  (VACUUM_PERMEABILITY * Math.abs(current)) / (2 * Math.PI * distance)

/**
 * Field of a FINITE straight segment of half-length `halfLength`, at
 * perpendicular distance `r` from its midpoint — the Biot–Savart result
 * B = μ₀I/(4πr)·(sinθ₁ + sinθ₂), with both angles equal here.
 *
 * This is the honest origin of the infinite-wire formula above: as the segment
 * grows the two sines tend to 1 and the bracket tends to 2, which is where the
 * 2π in μ₀I/(2πr) comes from. The engine checks the two agree for a wire long
 * enough to be the one on the bench, which is what makes the shortcut safe.
 */
export const finiteSegmentFieldMagnitude = (
  current: number,
  distance: number,
  halfLength: number,
): number =>
  ((VACUUM_PERMEABILITY * Math.abs(current)) / (4 * Math.PI * distance)) *
  ((2 * halfLength) / Math.hypot(distance, halfLength))

/**
 * 安培定则 for a straight conductor: right thumb along the current, fingers
 * curl the way the field goes. Current out of the page circulates the field
 * counter-clockwise in the plane, current into the page clockwise.
 */
export const circulationOf = (current: number): Circulation => (current > 0 ? 1 : -1)

/** Turns per metre along the axis, n = N/L. */
export const turnDensityOf = (turns: number, coilLength: number): number => turns / coilLength

/**
 * Uniform field inside a long solenoid, B = μ₀nI = μ₀(N/L)I.
 *
 * `current` is signed but the field magnitude is a magnitude; the direction
 * along the axis is carried by {@link northPoleOf}.
 */
export const solenoidFieldMagnitude = (
  current: number,
  turns: number,
  coilLength: number,
): number => VACUUM_PERMEABILITY * turnDensityOf(turns, coilLength) * Math.abs(current)

/**
 * Field at the mouth of a long solenoid: half the interior value.
 *
 * Not a second law — it is what the same superposition gives when only one side
 * of the coil is still contributing. The engine uses it to check the interior
 * field against a computation that does not start from μ₀nI.
 */
export const solenoidEndFieldMagnitude = (
  current: number,
  turns: number,
  coilLength: number,
): number => solenoidFieldMagnitude(current, turns, coilLength) / 2

/**
 * 安培定则 for a coil: right hand grips the solenoid, fingers follow the current
 * around the turns, and the thumb points at the north end.
 */
export const northPoleOf = (current: number): Circulation => (current > 0 ? 1 : -1)

/* ----------------------------------------------------------------- motor -- */

/** Area of the rotor coil (m²). */
export const coilAreaOf = (sideLength: number, coilWidth: number): number => sideLength * coilWidth

/**
 * Force on each side of the coil that lies ACROSS the field: F = B·I·L.
 *
 * The other two sides carry a force too, but they are parallel to B, so the
 * force on them is zero and they contribute nothing to the couple. Only these
 * two matter, and they matter as a PAIR: equal, opposite, and separated by the
 * coil's width — which is what turns a force into a torque.
 *
 * A MAGNITUDE, because the two sides carry it in opposite senses and one signed
 * number cannot be both. Which way the pair turns the coil is the torque's
 * sign, and that comes from the signed current.
 */
export const ampereForceOnSide = (
  magneticFluxDensity: number,
  current: number,
  sideLength: number,
): number => magneticFluxDensity * Math.abs(current) * sideLength

/**
 * Torque on the coil: τ = n·B·I·A·cosθ, with θ measured from the coil's plane
 * to the field.
 *
 * θ = 0 (coil lying along B) is full strength; θ = 90° is the 平衡位置 where the
 * two forces are still there but pull straight out of the plane, so they bend
 * nothing. Past it the bare coil's torque REVERSES — which is the whole reason
 * a real motor has a commutator, and what the engine's sign check is about.
 */
export const motorTorqueAt = (
  magneticFluxDensity: number,
  current: number,
  turns: number,
  area: number,
  angleRadians: number,
): number =>
  /* The current is NOT taken as a magnitude here: its sign is the direction the
     coil turns, and taking |I| would make the torque unable to reverse — which
     is exactly the state the commutator exists to fix. */
  turns * magneticFluxDensity * current * area * Math.cos(angleRadians)

/**
 * A torque smaller than the tolerance the dead-point check uses IS zero.
 *
 * cos(90°) is 6.1×10⁻¹⁷ in floating point, so the exact closed form reports
 * 1.5×10⁻¹⁷ N·m at the 平衡位置 — a number the engine's own check already
 * asserts is zero. Publishing it would make the canvas contradict the check, so
 * the reading snaps to the same tolerance.
 */
const snapToZero = (value: number): number =>
  Math.abs(value) <= CURRENT_RELATIVE_TOLERANCE ? 0 : value

/** What the rotor reads at the angle the bench is set to. */
export interface MotorReading {
  readonly current: number
  readonly turns: number
  readonly field: number
  readonly sideLength: number
  readonly coilWidth: number
  readonly coilArea: number
  /** Angle from the coil's plane to the field (rad). */
  readonly angle: number
  /** Force on each of the two sides that carry the force (N). */
  readonly sideForce: number
  /**
   * Torque at that angle, τ = n·B·I·A·cosθ (N·m). SIGNED: the sign is the
   * direction the coil turns, and it follows the current.
   */
  readonly torque: number
  /** The largest this rig can make, at θ = 0 (N·m). */
  readonly peakTorque: number
  /** +1 = the rotor turns counter-clockwise on the page. */
  readonly sense: Circulation
}

export const motorReadingOf = (model: ResolvedMotor): MotorReading => {
  const area = coilAreaOf(model.sideLength, model.coilWidth)
  return {
    current: model.current,
    turns: model.turns,
    field: model.magneticFluxDensity,
    sideLength: model.sideLength,
    coilWidth: model.coilWidth,
    coilArea: area,
    angle: model.coilAngle,
    sideForce: ampereForceOnSide(model.magneticFluxDensity, model.current, model.sideLength),
    torque: snapToZero(
      motorTorqueAt(model.magneticFluxDensity, model.current, model.turns, area, model.coilAngle),
    ),
    peakTorque: motorTorqueAt(model.magneticFluxDensity, model.current, model.turns, area, 0),
    sense: model.current > 0 ? 1 : -1,
  }
}

/* --------------------------------------------- the electromagnet physics -- */

/**
 * Field inside a coil with a core in it: B = μ_r·μ₀(N/L)I.
 *
 * Linear-regime only, which is the assumption the engine states out loud: a
 * real iron core saturates somewhere under 2 T, and above that μ_r stops being
 * a constant. Below it, this is the whole reason an electromagnet is worth
 * building — μ_r is a multiplier on the field, not a small correction.
 */
export const coreFieldMagnitude = (
  current: number,
  turns: number,
  coilLength: number,
  relativePermeability: number,
): number => relativePermeability * solenoidFieldMagnitude(current, turns, coilLength)

/**
 * Pull a pole face of area A holds: F = B²A/(2μ₀), the Maxwell stress.
 *
 * The square is what makes the electromagnet useful: a core multiplies the
 * FIELD by μ_r and the PULL by μ_r². A 200× field is a 40000× lift, which is
 * the difference between a coil that drops paper clips and one that lifts a
 * kilogram — and the reason this number, not the field, is what the rig shows.
 */
export const poleFacePull = (field: number, area: number): number =>
  (field * field * area) / (2 * VACUUM_PERMEABILITY)

/** The field an electromagnet's core carries, with everything else it reads. */
export interface ElectromagnetReading {
  readonly current: number
  readonly turns: number
  readonly coilLength: number
  readonly turnDensity: number
  readonly coreRelativePermeability: number
  /** Field in the core, B = μ_r·μ₀(N/L)I (T). */
  readonly field: number
  /** Field the SAME coil would make air-cored, B₀ = μ₀(N/L)I (T). */
  readonly airField: number
  readonly comparisonCoreRelativePermeability: number | undefined
  readonly comparisonField: number | undefined
  readonly comparisonPull: number | undefined
  /** Area of the pole face (m²). */
  readonly coreArea: number
  /** Pull the pole face holds, F = B²A/(2μ₀) (N). */
  readonly pull: number
  /** Pull the SAME coil would hold air-cored (N) — the baseline, not a second rig. */
  readonly airPull: number
  /** Mass the pull balances against gravity (kg). */
  readonly heldMass: number
  /** Mass the air-cored coil would hold (kg) — the baseline, not a second rig. */
  readonly airHeldMass: number
  /** Which end is north: +1 for the end the right-hand rule points at. */
  readonly northPole: Circulation
}

/* ------------------------------------------------------------- readings -- */

export const electromagnetFieldOf = (model: ResolvedElectromagnet): ElectromagnetReading => {
  const airField = solenoidFieldMagnitude(model.current, model.turns, model.coilLength)
  const field = model.coreRelativePermeability * airField
  const pull = poleFacePull(field, model.coreArea)
  const airPull = poleFacePull(airField, model.coreArea)
  const comparisonField =
    model.comparisonCoreRelativePermeability === undefined
      ? undefined
      : model.comparisonCoreRelativePermeability * airField
  return {
    current: model.current,
    turns: model.turns,
    coilLength: model.coilLength,
    turnDensity: turnDensityOf(model.turns, model.coilLength),
    coreRelativePermeability: model.coreRelativePermeability,
    field,
    airField,
    comparisonCoreRelativePermeability: model.comparisonCoreRelativePermeability,
    comparisonField,
    comparisonPull:
      comparisonField === undefined ? undefined : poleFacePull(comparisonField, model.coreArea),
    coreArea: model.coreArea,
    pull,
    airPull,
    heldMass: pull / model.gravity,
    airHeldMass: airPull / model.gravity,
    northPole: northPoleOf(model.current),
  }
}

export const straightWireFieldOf = (model: ResolvedStraightWire): StraightWireFieldReading => {
  const field = straightWireFieldMagnitude(model.current, model.probeDistance)
  return {
    current: model.current,
    probeDistance: model.probeDistance,
    field,
    comparisonDistance: model.comparisonDistance,
    comparisonField:
      model.comparisonDistance === undefined
        ? undefined
        : straightWireFieldMagnitude(model.current, model.comparisonDistance),
    circulation: circulationOf(model.current),
  }
}

export const solenoidFieldOf = (model: ResolvedSolenoid): SolenoidFieldReading => {
  const field = solenoidFieldMagnitude(model.current, model.turns, model.coilLength)
  return {
    current: model.current,
    turns: model.turns,
    coilLength: model.coilLength,
    turnDensity: turnDensityOf(model.turns, model.coilLength),
    field,
    comparisonTurns: model.comparisonTurns,
    comparisonField:
      model.comparisonTurns === undefined
        ? undefined
        : solenoidFieldMagnitude(model.current, model.comparisonTurns, model.coilLength),
    endField: solenoidEndFieldMagnitude(model.current, model.turns, model.coilLength),
    northPole: northPoleOf(model.current),
  }
}

/** The rig's headline number, whichever rig it is. */
export const currentFieldMagnitudeOf = (model: ResolvedCurrentModel): number => {
  switch (model.type) {
    case 'straight_wire':
      return straightWireFieldOf(model).field
    case 'solenoid':
      return solenoidFieldOf(model).field
    case 'electromagnet':
      return electromagnetFieldOf(model).field
    case 'motor':
      /* The rotor's headline number is not a field it makes but the field it
         sits in — the one the bench states. */
      return model.magneticFluxDensity
  }
}
