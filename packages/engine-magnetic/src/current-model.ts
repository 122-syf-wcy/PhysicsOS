import { canonicalValue } from '@physicsos/physics-units'
import { currentBenchesOf, type PhysicsScene } from '@physicsos/physics-scene'
import { PhysicsOSError } from '@physicsos/shared'

/**
 * Canonical (SI) view of the magnetic field a current makes. Two rigs share one
 * bench type: a straight conductor probed at a distance, and a coil read along
 * its axis. Everything below is time-independent apparatus — the current is
 * steady, so nothing here is a snapshot of a changing quantity.
 *
 * Current is SIGNED and that sign is meaningful, not a direction of travel along
 * the page: it is the direction of the current through the conductor, and it is
 * the only input that decides which way the field circulates. Dropping it would
 * make 安培定则 unrepresentable.
 */
export interface ResolvedStraightWire {
  readonly type: 'straight_wire'
  readonly benchId: string
  /** Current through the conductor (A), non-zero. */
  readonly current: number
  /** Distance from the conductor to the probe (m), > 0. */
  readonly probeDistance: number
  /** A second probe distance in the same field (m), > 0 when present. */
  readonly comparisonDistance: number | undefined
}

export interface ResolvedSolenoid {
  readonly type: 'solenoid'
  readonly benchId: string
  /** Current through the winding (A), non-zero. */
  readonly current: number
  /** Turns on the former, > 0. */
  readonly turns: number
  /** A second winding on the same former, > 0 when present. */
  readonly comparisonTurns: number | undefined
  /** Coil length along the axis (m), > 0. */
  readonly coilLength: number
}

/**
 * The same coil with a core through it, plus the pole face that does the pulling.
 *
 * `coreRelativePermeability` is kept as a number rather than a material: the
 * engine models μ_r, and 1 is a real value here — the air-cored coil is the
 * baseline the iron is measured against, so "no core" is a rig rather than a
 * missing one.
 */
export interface ResolvedElectromagnet {
  readonly type: 'electromagnet'
  readonly benchId: string
  /** Current through the winding (A), non-zero. */
  readonly current: number
  /** Turns on the former, > 0. */
  readonly turns: number
  /** Coil length along the axis (m), > 0. */
  readonly coilLength: number
  /** Relative permeability of the core, > 0 (1 = air-cored). */
  readonly coreRelativePermeability: number
  /** A second core on the same coil, > 0 when present. */
  readonly comparisonCoreRelativePermeability: number | undefined
  /** Area of the pole face (m²), > 0. */
  readonly coreArea: number
  /** Gravitational field strength (m/s²), > 0 — what the held mass is weighed against. */
  readonly gravity: number
}

/**
 * A coil hung in a field so the field turns it.
 *
 * `coilAngle` is kept in RADIANS and measured from the coil's plane to the
 * field. The angle is a stated condition like any other, so it lives in the
 * scene as the fixed angle the rig is set to — the torque is derived at that
 * angle rather than integrated over a rotation the bench has no clock for.
 */
export interface ResolvedMotor {
  readonly type: 'motor'
  readonly benchId: string
  /** Current through the rotor winding (A), non-zero. */
  readonly current: number
  /** Turns on the rotor, > 0. */
  readonly turns: number
  /** Stator field the rotor turns in (T), > 0. */
  readonly magneticFluxDensity: number
  /** Length of each side that carries the force (m), > 0. */
  readonly sideLength: number
  /** Length of the other pair of sides — the lever arm (m), > 0. */
  readonly coilWidth: number
  /** Angle from the coil's plane to the field (rad), finite. */
  readonly coilAngle: number
}

/** The bench a scene describes, as SI numbers. */
export type ResolvedCurrentModel =
  | ResolvedStraightWire
  | ResolvedSolenoid
  | ResolvedElectromagnet
  | ResolvedMotor

const modelError = (code: string, message: string): PhysicsOSError =>
  new PhysicsOSError(code, message)

/**
 * A conductor with no current makes no field, so zero is a missing rig rather
 * than a weak one. The sign is kept: see {@link ResolvedStraightWire.current}.
 */
const nonZeroOrThrow = (value: number, code: string, message: string): number => {
  if (!Number.isFinite(value) || value === 0) throw modelError(code, message)
  return value
}

const positiveOrThrow = (value: number, code: string, message: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw modelError(code, message)
  return value
}

const optionalPositive = (
  value: Parameters<typeof canonicalValue>[0] | undefined,
  code: string,
  message: string,
): number | undefined =>
  value === undefined ? undefined : positiveOrThrow(canonicalValue(value), code, message)

/**
 * A number that only has to BE a number: the motor's coil angle. Any angle is a
 * rig — 0° lies along the field, 90° is the dead point, and a coil turned past
 * it is a coil turned past it — so there is no bound to enforce here.
 */
const finiteOrThrow = (value: number, code: string, message: string): number => {
  if (!Number.isFinite(value)) throw modelError(code, message)
  return value
}

/**
 * Resolve the scene's current bench into canonical SI numbers. Throws
 * `PhysicsOSError` on structural violations; `canHandle` converts those into
 * model-support failures instead of solving a rig the model cannot honour.
 */
export const resolveCurrentModel = (scene: PhysicsScene): ResolvedCurrentModel => {
  const benches = currentBenchesOf(scene)
  const bench = benches[0]
  if (bench === undefined || benches.length !== 1) {
    throw modelError(
      'CURRENT_SINGLE_BENCH',
      'Current Engine requires exactly one current-magnetic bench.',
    )
  }

  if (bench.current === undefined) {
    throw modelError(
      'CURRENT_VALUE_REQUIRED',
      `Current bench "${bench.id}" must state the current.`,
    )
  }
  const current = nonZeroOrThrow(
    canonicalValue(bench.current),
    'CURRENT_VALUE',
    `Current bench "${bench.id}" current must be finite and non-zero.`,
  )

  if (bench.type === 'motor') {
    if (
      bench.turns === undefined ||
      bench.magneticFluxDensity === undefined ||
      bench.sideLength === undefined ||
      bench.coilWidth === undefined ||
      bench.coilAngle === undefined
    ) {
      throw modelError(
        'CURRENT_MOTOR_INCOMPLETE',
        `Motor bench "${bench.id}" must state the turns, the field, both coil sides and the angle.`,
      )
    }
    return {
      type: 'motor',
      benchId: bench.id,
      current,
      turns: positiveOrThrow(
        canonicalValue(bench.turns),
        'CURRENT_TURNS',
        `Motor bench "${bench.id}" turns must be finite and > 0.`,
      ),
      magneticFluxDensity: positiveOrThrow(
        canonicalValue(bench.magneticFluxDensity),
        'CURRENT_MOTOR_FIELD',
        `Motor bench "${bench.id}" field must be finite and > 0.`,
      ),
      sideLength: positiveOrThrow(
        canonicalValue(bench.sideLength),
        'CURRENT_MOTOR_SIDE',
        `Motor bench "${bench.id}" side length must be finite and > 0.`,
      ),
      coilWidth: positiveOrThrow(
        canonicalValue(bench.coilWidth),
        'CURRENT_MOTOR_WIDTH',
        `Motor bench "${bench.id}" coil width must be finite and > 0.`,
      ),
      /* Any angle is a rig: 0° lies along the field, 90° is the dead point, and
         a coil turned past it is a coil turned past it. Only a non-number is
         refused. */
      coilAngle: finiteOrThrow(
        canonicalValue(bench.coilAngle),
        'CURRENT_MOTOR_ANGLE',
        `Motor bench "${bench.id}" angle must be a finite angle.`,
      ),
    }
  }

  if (bench.type === 'electromagnet') {
    if (
      bench.turns === undefined ||
      bench.coilLength === undefined ||
      bench.coreRelativePermeability === undefined ||
      bench.coreArea === undefined ||
      bench.gravity === undefined
    ) {
      throw modelError(
        'CURRENT_ELECTROMAGNET_INCOMPLETE',
        `Electromagnet bench "${bench.id}" must state the turns, the coil length, the core and its pole area.`,
      )
    }
    return {
      type: 'electromagnet',
      benchId: bench.id,
      current,
      turns: positiveOrThrow(
        canonicalValue(bench.turns),
        'CURRENT_TURNS',
        `Electromagnet bench "${bench.id}" turns must be finite and > 0.`,
      ),
      coilLength: positiveOrThrow(
        canonicalValue(bench.coilLength),
        'CURRENT_COIL_LENGTH',
        `Electromagnet bench "${bench.id}" coil length must be finite and > 0.`,
      ),
      coreRelativePermeability: positiveOrThrow(
        canonicalValue(bench.coreRelativePermeability),
        'CURRENT_CORE_PERMEABILITY',
        `Electromagnet bench "${bench.id}" core permeability must be finite and > 0.`,
      ),
      comparisonCoreRelativePermeability: optionalPositive(
        bench.comparisonCoreRelativePermeability,
        'CURRENT_COMPARISON_CORE_PERMEABILITY',
        `Electromagnet bench "${bench.id}" comparison core permeability must be finite and > 0.`,
      ),
      coreArea: positiveOrThrow(
        canonicalValue(bench.coreArea),
        'CURRENT_CORE_AREA',
        `Electromagnet bench "${bench.id}" pole-face area must be finite and > 0.`,
      ),
      gravity: positiveOrThrow(
        canonicalValue(bench.gravity),
        'CURRENT_GRAVITY',
        `Electromagnet bench "${bench.id}" gravity must be finite and > 0.`,
      ),
    }
  }

  if (bench.type === 'solenoid') {
    if (bench.turns === undefined || bench.coilLength === undefined) {
      throw modelError(
        'CURRENT_SOLENOID_INCOMPLETE',
        `Solenoid bench "${bench.id}" must state both the turns and the coil length.`,
      )
    }
    return {
      type: 'solenoid',
      benchId: bench.id,
      current,
      turns: positiveOrThrow(
        canonicalValue(bench.turns),
        'CURRENT_TURNS',
        `Solenoid bench "${bench.id}" turns must be finite and > 0.`,
      ),
      comparisonTurns: optionalPositive(
        bench.comparisonTurns,
        'CURRENT_COMPARISON_TURNS',
        `Solenoid bench "${bench.id}" comparison turns must be finite and > 0.`,
      ),
      coilLength: positiveOrThrow(
        canonicalValue(bench.coilLength),
        'CURRENT_COIL_LENGTH',
        `Solenoid bench "${bench.id}" coil length must be finite and > 0.`,
      ),
    }
  }

  if (bench.probeDistance === undefined) {
    throw modelError(
      'CURRENT_PROBE_DISTANCE_REQUIRED',
      `Straight-wire bench "${bench.id}" must state the probe distance.`,
    )
  }
  return {
    type: 'straight_wire',
    benchId: bench.id,
    current,
    probeDistance: positiveOrThrow(
      canonicalValue(bench.probeDistance),
      'CURRENT_PROBE_DISTANCE',
      `Straight-wire bench "${bench.id}" probe distance must be finite and > 0.`,
    ),
    comparisonDistance: optionalPositive(
      bench.comparisonDistance,
      'CURRENT_COMPARISON_DISTANCE',
      `Straight-wire bench "${bench.id}" comparison distance must be finite and > 0.`,
    ),
  }
}
