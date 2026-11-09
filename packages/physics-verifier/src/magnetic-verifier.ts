import {
  DEFAULT_TOLERANCE,
  check,
  isQuantityVector,
  isScalarQuantity,
  summarizeVerification,
  toCanonicalVector,
  withinTolerance,
  type ObjectState,
  type PhysicsTolerance,
  type SimulationRequest,
  type SimulationResult,
  type SimulationState,
  type VerificationCheck,
  type VerificationIssue,
  type VerificationResult,
} from '@physicsos/physics-core'
import { add, cross, dot, magnitude, scale, subtract, type Vector3 } from '@physicsos/physics-math'
import {
  canonicalValue,
  dimensionOf,
  isCanonicalUnit,
  isKnownUnit,
  validateQuantity,
  type PhysicalDimension,
  type Quantity,
} from '@physicsos/physics-units'
import {
  validateScene,
  type PhysicsScene,
  type UniformMagneticField,
} from '@physicsos/physics-scene'

/** The assumptions emitted by the frozen analytical magnetic engine. */
export const MAGNETIC_VERIFIER_ASSUMPTIONS = [
  'uniform magnetic field',
  'velocity perpendicular B',
  'magnetic force only',
  'ignore electric field',
  'ignore gravity',
] as const

export type MagneticVerifierAssumption = (typeof MAGNETIC_VERIFIER_ASSUMPTIONS)[number]

export interface MagneticVerifierOptions {
  readonly tolerance?: PhysicsTolerance
  /** The exact engine request; only its requested window is required to contain evidence. */
  readonly request?: SimulationRequest
}

export type MagneticVerifierConfiguration = MagneticVerifierOptions | PhysicsTolerance

interface ComparisonDetails {
  readonly expected: unknown
  readonly actual: unknown
  readonly tolerance: PhysicsTolerance
  readonly [key: string]: unknown
}

interface ModelValues {
  readonly particleId: string | undefined
  readonly mass: number | undefined
  readonly charge: number | undefined
  readonly speed: number | undefined
  readonly fieldMagnitude: number | undefined
  readonly magneticField: Vector3 | undefined
}

interface SamplePoint {
  readonly id: 't0' | 'tQuarter' | 'tHalf' | 'tThreeQuarter' | 'tPeriod'
  readonly label: string
  readonly fraction: number
}

interface ForceVectorSources {
  readonly derivedPresent: boolean
  readonly objectPresent: boolean
  readonly derived: Vector3 | undefined
  readonly object: Vector3 | undefined
}

const SAMPLE_POINTS: readonly SamplePoint[] = [
  { id: 't0', label: '0', fraction: 0 },
  { id: 'tQuarter', label: 'T/4', fraction: 0.25 },
  { id: 'tHalf', label: 'T/2', fraction: 0.5 },
  { id: 'tThreeQuarter', label: '3T/4', fraction: 0.75 },
  { id: 'tPeriod', label: 'T', fraction: 1 },
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const TRACE_IDENTIFIERS = ['traceId', 'userId', 'sessionId', 'runId', 'turnId', 'toolCallId', 'physicsEventId'] as const
const traceIdentifiersValid = (trace: unknown): trace is Record<string, unknown> => isRecord(trace) &&
  typeof trace.traceId === 'string' && trace.traceId.trim().length > 0 &&
  TRACE_IDENTIFIERS.every(key => trace[key] === undefined || (typeof trace[key] === 'string' && trace[key].trim().length > 0))

const makeDetails = (
  expected: unknown,
  actual: unknown,
  tolerance: PhysicsTolerance,
  extra: Record<string, unknown> = {},
): ComparisonDetails => ({
  ...extra,
  expected,
  actual,
  tolerance,
})

const makeCheck = (
  id: string,
  type: VerificationCheck['type'],
  passed: boolean,
  message: string,
  expected: unknown,
  actual: unknown,
  tolerance: PhysicsTolerance,
  extra: Record<string, unknown> = {},
): VerificationCheck =>
  check(id, type, passed, {
    message,
    details: makeDetails(expected, actual, tolerance, extra),
  })

const normalizeIssue = (
  issue: VerificationIssue,
  tolerance: PhysicsTolerance,
): VerificationIssue => ({
  ...issue,
  details: makeDetails('scene validation', issue.code, tolerance, issue.details ?? {}),
})

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const vectorDistance = (left: Vector3, right: Vector3): number =>
  Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)

const rotateAroundAxis = (vector: Vector3, axis: Vector3, angle: number): Vector3 => {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return add(
    add(scale(vector, cosine), scale(cross(axis, vector), sine)),
    scale(axis, dot(axis, vector) * (1 - cosine)),
  )
}

const quantitiesWithinTolerance = (
  actual: number,
  expected: number,
  tolerance: PhysicsTolerance,
): boolean => {
  if (expected === 0) return withinTolerance(actual, expected, tolerance)
  const ratio = actual / expected
  return finiteNumber(ratio) && withinTolerance(ratio, 1, tolerance)
}

const vectorsWithinTolerance = (
  actual: Vector3,
  expected: Vector3,
  tolerance: PhysicsTolerance,
): boolean => {
  const reference = Math.max(magnitude(actual), magnitude(expected))
  const limit = Math.max(tolerance.absolute, tolerance.relative * reference)
  return vectorDistance(actual, expected) <= limit
}

const directedVectorsWithinTolerance = (
  actual: Vector3,
  expected: Vector3,
  tolerance: PhysicsTolerance,
): boolean => {
  const actualMagnitude = magnitude(actual)
  const expectedMagnitude = magnitude(expected)
  if (expectedMagnitude === 0) return vectorsWithinTolerance(actual, expected, tolerance)
  if (actualMagnitude === 0) return false
  const magnitudeMatches = quantitiesWithinTolerance(actualMagnitude, expectedMagnitude, tolerance)
  const directionSine = magnitude(cross(actual, expected)) / (actualMagnitude * expectedMagnitude)
  return (
    magnitudeMatches &&
    dot(actual, expected) > 0 &&
    finiteNumber(directionSine) &&
    directionSine <= tolerance.angular
  )
}

const normalizedDot = (left: Vector3, right: Vector3): number | undefined => {
  const denominator = magnitude(left) * magnitude(right)
  if (denominator === 0 || !finiteNumber(denominator)) return undefined
  const value = Math.abs(dot(left, right)) / denominator
  return finiteNumber(value) ? value : undefined
}

const findParticleObject = (
  state: SimulationState,
  particleId: string | undefined,
): ObjectState | undefined => {
  if (particleId === undefined) return state.objects[0]
  return state.objects.find((object) => object.id === particleId)
}

const canonicalStateVector = (
  state: SimulationState | undefined,
  particleId: string | undefined,
  kind: 'velocity' | 'position',
): Vector3 | undefined => {
  if (state === undefined) return undefined
  const object = findParticleObject(state, particleId)
  const value = object?.[kind]
  if (value === undefined || value.dimension !== (kind === 'position' ? 'length' : 'velocity')) return undefined
  try {
    return toCanonicalVector(value).vectorSI
  } catch {
    return undefined
  }
}

const forceVectorSources = (
  state: SimulationState | undefined,
  particleId: string | undefined,
): ForceVectorSources => {
  if (state === undefined) {
    return {
      derivedPresent: false,
      objectPresent: false,
      derived: undefined,
      object: undefined,
    }
  }
  const object = findParticleObject(state, particleId)
  const derived = state.derived.find((entry) => entry.key === 'lorentz_force_vector')
  let derivedVector: Vector3 | undefined
  if (derived !== undefined && isQuantityVector(derived.value) && derived.value.dimension === 'force') {
    try {
      derivedVector = toCanonicalVector(derived.value).vectorSI
    } catch {
      derivedVector = undefined
    }
  }
  const objectValue = object?.values?.lorentz_force
  let objectVector: Vector3 | undefined
  if (objectValue !== undefined && isQuantityVector(objectValue) && objectValue.dimension === 'force') {
    try {
      objectVector = toCanonicalVector(objectValue).vectorSI
    } catch {
      objectVector = undefined
    }
  }
  return {
    derivedPresent: derived !== undefined,
    objectPresent: objectValue !== undefined,
    derived: derivedVector,
    object: objectVector,
  }
}

const canonicalForceVector = (
  state: SimulationState | undefined,
  particleId: string | undefined,
): Vector3 | undefined => {
  const sources = forceVectorSources(state, particleId)
  return sources.derived ?? sources.object
}

const canonicalScalar = (value: Quantity | undefined): number | undefined => {
  if (value === undefined) return undefined
  try {
    const result = canonicalValue(value)
    return finiteNumber(result) ? result : undefined
  } catch {
    return undefined
  }
}

const canonicalTime = (value: Quantity | undefined): number | undefined => {
  if (value === undefined) return undefined
  try {
    const seconds = canonicalValue(validateQuantity(value, 'time'))
    return finiteNumber(seconds) ? seconds : undefined
  } catch {
    return undefined
  }
}

const derivedScalarValue = (result: SimulationResult, key: string): Quantity | undefined => {
  const entry = result.derivedQuantities.find((candidate) => candidate.key === key)
  if (entry === undefined || !isRecord(entry.value) || !isScalarQuantity(entry.value)) {
    return undefined
  }
  return entry.value
}

const derivedVectorValue = (result: SimulationResult, key: string): Vector3 | undefined => {
  const entry = result.derivedQuantities.find((candidate) => candidate.key === key)
  if (entry === undefined || !isRecord(entry.value) || !isQuantityVector(entry.value)) {
    return undefined
  }
  try {
    return toCanonicalVector(entry.value).vectorSI
  } catch {
    return undefined
  }
}

const derivedVectorUnitState = (
  result: SimulationResult,
  key: string,
  expectedDimension: PhysicalDimension,
  expectedUnit: string,
): { readonly valid: boolean; readonly actual: unknown } => {
  const entry = result.derivedQuantities.find((candidate) => candidate.key === key)
  if (entry === undefined || !isRecord(entry.value) || !isQuantityVector(entry.value)) {
    return { valid: false, actual: undefined }
  }
  let unitValid: boolean
  try {
    unitValid =
      isKnownUnit(entry.value.unit) &&
      dimensionOf(entry.value.unit) === expectedDimension &&
      entry.value.unit === expectedUnit
  } catch {
    unitValid = false
  }
  return {
    valid:
      entry.value.dimension === expectedDimension &&
      unitValid &&
      finiteNumber(entry.value.vector.x) &&
      finiteNumber(entry.value.vector.y) &&
      finiteNumber(entry.value.vector.z),
    actual: { unit: entry.value.unit, dimension: entry.value.dimension },
  }
}

const derivedUnitState = (
  result: SimulationResult,
  key: string,
  expectedDimension: PhysicalDimension,
  expectedUnit: string,
): { readonly valid: boolean; readonly actual: unknown } => {
  const value = derivedScalarValue(result, key)
  if (value === undefined) {
    return { valid: false, actual: undefined }
  }
  let unitValid: boolean
  try {
    unitValid =
      isKnownUnit(value.unit) &&
      dimensionOf(value.unit) === expectedDimension &&
      isCanonicalUnit(value)
  } catch {
    unitValid = false
  }
  const valid =
    finiteNumber(value.value) &&
    value.dimension === expectedDimension &&
    unitValid &&
    (value.unit === expectedUnit || unitValid)
  return {
    valid,
    actual: { value: value.value, unit: value.unit, dimension: value.dimension },
  }
}

const findStateAt = (
  result: SimulationResult,
  timeSeconds: number | undefined,
  tolerance: PhysicsTolerance,
  absoluteTimeTolerance?: number,
): SimulationState | undefined => {  if (timeSeconds === undefined || !finiteNumber(timeSeconds)) return undefined
  let closest: SimulationState | undefined
  let closestDistance = Number.POSITIVE_INFINITY
  for (const state of result.states) {
    try {
      const stateTime = canonicalTime(state.time)
      if (stateTime === undefined) continue
      const distance = Math.abs(stateTime - timeSeconds)
      /* Linear scan per requested key time. The analytical engines emit a bounded
         trajectory (docs/02 §124 decimation), so verifying one result stays
         O(states × keyTimes); a future stream of unboundedly long trajectories
         should carry decimated states into this verifier rather than pushing the
         scan cost back here (docs/02 §150). */
      const timeMatches = absoluteTimeTolerance === undefined
        ? withinTolerance(stateTime, timeSeconds, tolerance)
        : distance <= absoluteTimeTolerance
      if (timeMatches && distance < closestDistance) {
        closest = state
        closestDistance = distance
      }
    } catch {
      continue
    }
  }
  return closest
}

const collectNonFinite = (
  value: unknown,
  path: string,
  output: string[],
  seen: WeakSet<object>,
): void => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) output.push(`${path}=${String(value)}`)
    return
  }
  if (!isRecord(value)) return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectNonFinite(entry, `${path}[${index}]`, output, seen))
    return
  }
  Object.entries(value).forEach(([key, entry]) =>
    collectNonFinite(entry, `${path}.${key}`, output, seen),
  )
}

const assumptionsFromResult = (result: SimulationResult): string[] => {
  /* A Set keeps de-duplication linear in the total number of assumptions. The
     previous `assumptions.includes(...)` inside the loop scanned the growing
     list for every entry — O(total²) once a result carries many derived entries,
     e.g. a long simulation aggregating per-state assumption sets. */
  const seen = new Set<string>()
  const assumptions: string[] = []
  for (const entry of result.derivedQuantities) {
    if (!Array.isArray(entry.assumptions)) continue
    for (const assumption of entry.assumptions) {
      if (typeof assumption === 'string' && !seen.has(assumption)) {
        seen.add(assumption)
        assumptions.push(assumption)
      }
    }
  }
  return assumptions
}

const canonicalSceneParticleVector = (
  scene: PhysicsScene,
  kind: 'position' | 'velocity',
): Vector3 | undefined => {
  if (scene.particles.length !== 1) return undefined
  const vector = scene.particles[0]?.[kind]
  if (vector === undefined || vector.dimension !== (kind === 'position' ? 'length' : 'velocity')) return undefined
  try {
    return toCanonicalVector(vector).vectorSI
  } catch {
    return undefined
  }
}

interface RequestedWindow {
  readonly startTime: number
  readonly endTime: number
}

const canonicalRequestedTime = (value: unknown): number | undefined => {
  if (!isRecord(value) || Array.isArray(value) || typeof value.value !== 'number' ||
    typeof value.unit !== 'string' || value.dimension !== 'time') return undefined
  try {
    return canonicalValue(validateQuantity({ value: value.value, unit: value.unit, dimension: 'time' }, 'time'))
  } catch { return undefined }
}

const requestedWindowOf = (request: SimulationRequest, fallbackEnd: number | undefined): RequestedWindow | undefined => {
  try {
    if (!isRecord(request.options) || Array.isArray(request.options)) return undefined
    const startTime = request.options.startTime === undefined
      ? 0
      : canonicalRequestedTime(request.options.startTime)
    const endTime = request.options.endTime === undefined
      ? fallbackEnd
      : canonicalRequestedTime(request.options.endTime)
    return finiteNumber(startTime) && finiteNumber(endTime) && startTime >= 0 && endTime >= startTime
      ? { startTime, endTime }
      : undefined
  } catch {
    return undefined
  }
}

const timeInWindow = (time: number, window: RequestedWindow): boolean =>
  time >= window.startTime && time <= window.endTime

const requestedTimeTolerance = (
  period: number | undefined,
  window: RequestedWindow | undefined,
  tolerance: PhysicsTolerance,
): number => {
  const periodScale = period !== undefined && period > 0 ? period : Number.POSITIVE_INFINITY
  const windowSpan = window === undefined ? Number.POSITIVE_INFINITY : window.endTime - window.startTime
  const scale = Math.min(periodScale, windowSpan > 0 ? windowSpan : periodScale)
  return Number.isFinite(scale) ? scale * Math.min(tolerance.relative, 1e-6) : 0
}

const modelValues = (
  scene: PhysicsScene,
  result: SimulationResult,
  tolerance: PhysicsTolerance,
  requestAware = false,
): ModelValues => {
  const particle = scene.particles.length === 1 ? scene.particles[0] : undefined
  const field = scene.fields.find(
    (candidate): candidate is UniformMagneticField => candidate.type === 'uniform_magnetic',
  )
  const initialState = findStateAt(result, 0, tolerance)
  const mass = particle === undefined ? undefined : canonicalScalar(particle.mass)
  const charge =
    particle === undefined || particle.charge === undefined
      ? undefined
      : canonicalScalar(particle.charge)
  const magneticField =
    field === undefined
      ? undefined
      : (() => {
          try {
            return toCanonicalVector(field.magneticFluxDensity).vectorSI
          } catch {
            return undefined
          }
        })()
  const speedVector = requestAware
    ? canonicalSceneParticleVector(scene, 'velocity')
    : canonicalStateVector(initialState, particle?.id, 'velocity')
  const speed = speedVector === undefined ? undefined : magnitude(speedVector)
  const fieldMagnitude = magneticField === undefined ? undefined : magnitude(magneticField)
  return {
    particleId: particle?.id,
    mass,
    charge,
    speed: finiteNumber(speed) ? speed : undefined,
    fieldMagnitude: finiteNumber(fieldMagnitude) ? fieldMagnitude : undefined,
    magneticField,
  }
}

const validateTolerance = (tolerance: PhysicsTolerance): void => {
  if (
    !finiteNumber(tolerance.relative) ||
    !finiteNumber(tolerance.absolute) ||
    !finiteNumber(tolerance.angular) ||
    tolerance.relative < 0 ||
    tolerance.absolute < 0 ||
    tolerance.angular < 0
  ) {
    throw new RangeError('PhysicsTolerance values must be finite and non-negative.')
  }
}

/**
 * Verifies a magnetic `SimulationResult` against a `PhysicsScene`.
 *
 * The verifier deliberately never calls an engine or regenerates a trajectory:
 * all trajectory, force and state observations come from the supplied result.
 */
export class MagneticPhysicsVerifier {
  readonly tolerance: PhysicsTolerance
  private readonly request: SimulationRequest | undefined

  constructor(options: MagneticVerifierConfiguration = {}) {
    const configuredTolerance =
      'relative' in options && 'absolute' in options && 'angular' in options
        ? options
        : options.tolerance
    this.tolerance = configuredTolerance ?? DEFAULT_TOLERANCE
    this.request = 'request' in options ? options.request : undefined
    validateTolerance(this.tolerance)
  }

  static verify(
    scene: PhysicsScene,
    result: SimulationResult,
    options: MagneticVerifierConfiguration = {},
  ): VerificationResult {
    return new MagneticPhysicsVerifier(options).verify(scene, result)
  }

  verify(scene: PhysicsScene, result: SimulationResult): VerificationResult {
    const checks: VerificationCheck[] = []
    const warnings: VerificationIssue[] = []
    const errors: VerificationIssue[] = []
    const tolerance = this.tolerance

    const nonFinite: string[] = []
    collectNonFinite(scene, 'scene', nonFinite, new WeakSet<object>())
    collectNonFinite(result, 'result', nonFinite, new WeakSet<object>())
    checks.push(
      makeCheck(
        'all_finite',
        'numerical',
        nonFinite.length === 0,
        nonFinite.length === 0
          ? 'Scene and simulation result contain only finite numbers.'
          : `Non-finite numbers found: ${nonFinite.join(', ')}.`,
        true,
        nonFinite.length === 0,
        tolerance,
        { nonFinite },
      ),
    )

    try {
      const sceneValidation = validateScene(scene)
      for (const entry of sceneValidation.checks) {
        checks.push(
          makeCheck(
            entry.id,
            entry.type,
            entry.passed,
            entry.message ?? `Scene check "${entry.id}" completed.`,
            true,
            entry.passed,
            tolerance,
            entry.details ?? {},
          ),
        )
      }
      warnings.push(...sceneValidation.warnings.map((issue) => normalizeIssue(issue, tolerance)))
      errors.push(...sceneValidation.errors.map((issue) => normalizeIssue(issue, tolerance)))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Scene validation failed.'
      checks.push(
        makeCheck('scene_validity', 'schema', false, message, 'valid', 'invalid', tolerance),
      )
    }

    const revisionValid = Number.isInteger(scene.revision) && scene.revision >= 0
    checks.push(
      makeCheck(
        'scene_revision_validity',
        'schema',
        revisionValid,
        'Scene revision must be a non-negative integer.',
        'non-negative integer',
        scene.revision,
        tolerance,
      ),
    )
    checks.push(
      makeCheck(
        'result_schema_version',
        'schema',
        result.schemaVersion === 'simulation-result/1.0',
        'SimulationResult must use schema simulation-result/1.0.',
        'simulation-result/1.0',
        result.schemaVersion,
        tolerance,
      ),
    )
    checks.push(
      makeCheck(
        'result_scene_id_match',
        'schema',
        result.sceneId === scene.id,
        'SimulationResult must reference the supplied scene id.',
        scene.id,
        result.sceneId,
        tolerance,
      ),
    )
    checks.push(
      makeCheck(
        'result_scene_revision_match',
        'schema',
        result.sceneRevision === scene.revision,
        'SimulationResult must reference the supplied scene revision.',
        scene.revision,
        result.sceneRevision,
        tolerance,
      ),
    )

    const request = this.request
    const requestAware = request !== undefined
    if (request !== undefined) {
      const trace = isRecord(request.trace) ? request.trace : undefined
      const identityValid =
        request.schemaVersion === 'simulation-request/1.0' &&
        typeof request.simulationId === 'string' && request.simulationId.trim().length > 0 &&
        request.sceneId === scene.id &&
        Number.isSafeInteger(request.sceneRevision) && request.sceneRevision >= 0 &&
        request.sceneRevision === scene.revision &&
        request.simulationId === result.simulationId &&
        (request.requestedDomain === undefined || request.requestedDomain === 'magnetic') &&
        traceIdentifiersValid(trace) && traceIdentifiersValid(result.trace) &&
        trace.traceId === result.trace.traceId &&
        TRACE_IDENTIFIERS.every(key => trace[key] === undefined || result.trace[key] === undefined || trace[key] === result.trace[key]) &&
        (trace.sceneId === undefined || trace.sceneId === scene.id) &&
        (trace.sceneRevision === undefined || trace.sceneRevision === scene.revision)
      checks.push(makeCheck(
        'request_scene_result_identity', 'schema', identityValid,
        'The supplied request must reference this exact scene and simulation result.',
        { sceneId: scene.id, sceneRevision: scene.revision, simulationId: result.simulationId },
        { sceneId: request.sceneId, sceneRevision: request.sceneRevision, simulationId: request.simulationId },
        tolerance,
      ))
    }
    checks.push(makeCheck(
      'result_trace_scene_match', 'schema',
      traceIdentifiersValid(result.trace) &&
        (result.trace.sceneId === undefined || result.trace.sceneId === scene.id) &&
        (result.trace.sceneRevision === undefined || result.trace.sceneRevision === scene.revision),
      'Any supplied result trace scene identity and revision must match the scene.',
      { sceneId: scene.id, sceneRevision: scene.revision },
      result.trace ?? {},
      tolerance,
    ))

    const model = modelValues(scene, result, tolerance, requestAware)
    const magneticField = model.magneticField
    const speedVector = requestAware
      ? canonicalSceneParticleVector(scene, 'velocity')
      : canonicalStateVector(findStateAt(result, 0, tolerance), model.particleId, 'velocity')
    const fieldInPlaneRatio =
      magneticField === undefined ||
      model.fieldMagnitude === undefined ||
      model.fieldMagnitude === 0
        ? undefined
        : Math.hypot(magneticField.x, magneticField.y) / model.fieldMagnitude
    const velocityParallelRatio =
      speedVector === undefined || magneticField === undefined || model.fieldMagnitude === undefined
        ? undefined
        : normalizedDot(speedVector, magneticField)
    const preconditions = {
      sceneIs2d: scene.dimension === '2d',
      singleParticle: scene.particles.length === 1,
      singleUniformMagneticField:
        scene.fields.length === 1 && scene.fields[0]?.type === 'uniform_magnetic',
      fieldHasGlobalExtent:
        scene.fields.length === 1 &&
        scene.fields[0]?.type === 'uniform_magnetic' &&
        scene.fields[0].regionId === undefined,
      magneticForceOnly:
        scene.forces.length === 0 &&
        scene.boundaries.length === 0 &&
        scene.constraints.length === 0,
      nonZeroCharge: model.charge !== undefined && model.charge !== 0,
      nonZeroSpeed: model.speed !== undefined && model.speed > 0,
      nonZeroField: model.fieldMagnitude !== undefined && model.fieldMagnitude > 0,
      fieldPerpendicularToScene:
        fieldInPlaneRatio !== undefined && fieldInPlaneRatio <= tolerance.angular,
      velocityPerpendicularToField:
        velocityParallelRatio !== undefined && velocityParallelRatio <= tolerance.angular,
    }
    checks.push(
      makeCheck(
        'magnetic_model_preconditions',
        'constraint',
        Object.values(preconditions).every((value) => value),
        'Scene satisfies the frozen uniform-magnetic circular-motion preconditions.',
        Object.keys(preconditions).reduce<Record<string, boolean>>(
          (expected, key) => ({ ...expected, [key]: true }),
          {},
        ),
        preconditions,
        tolerance,
        { fieldInPlaneRatio, velocityParallelRatio },
      ),
    )

    const assumptions = assumptionsFromResult(result)
    const expectedAssumptions = [...MAGNETIC_VERIFIER_ASSUMPTIONS]
    checks.push(
      makeCheck(
        'model_assumptions',
        'semantic',
        expectedAssumptions.every((assumption) => assumptions.includes(assumption)),
        'SimulationResult must carry every frozen magnetic model assumption in derivedQuantities.',
        expectedAssumptions,
        assumptions,
        tolerance,
      ),
    )
    for (const assumption of MAGNETIC_VERIFIER_ASSUMPTIONS) {
      const present = assumptions.includes(assumption)
      checks.push(
        makeCheck(
          `assumption:${assumption}`,
          'semantic',
          present,
          `Required model assumption "${assumption}" is ${present ? 'present' : 'missing'}.`,
          assumption,
          present,
          tolerance,
          { observedAssumptions: assumptions },
        ),
      )
    }

    const unitSpecifications: readonly [string, string, PhysicalDimension, string][] = [
      ['cyclotron_radius', 'radius_unit', 'length', 'm'],
      ['cyclotron_period', 'period_unit', 'time', 's'],
      ['angular_velocity', 'angular_velocity_unit', 'angular_velocity', 'rad/s'],
      ['lorentz_force_magnitude', 'force_unit', 'force', 'N'],
    ]
    for (const [key, id, dimension, unit] of unitSpecifications) {
      const state = derivedUnitState(result, key, dimension, unit)
      checks.push(
        makeCheck(
          id,
          'dimension',
          state.valid,
          `Derived quantity "${key}" must use ${unit} (${dimension}).`,
          { key, unit, dimension },
          state.actual,
          tolerance,
        ),
      )
    }
    const centerUnit = derivedVectorUnitState(result, 'orbit_center', 'length', 'm')
    checks.push(
      makeCheck(
        'orbit_center_unit',
        'dimension',
        centerUnit.valid,
        'Orbit center must use m and length dimension.',
        { unit: 'm', dimension: 'length' },
        centerUnit.actual,
        tolerance,
      ),
    )
    const rotationUnit = derivedUnitState(result, 'rotation_direction', 'dimensionless', '')
    checks.push(
      makeCheck(
        'rotation_direction_unit',
        'dimension',
        rotationUnit.valid,
        'Rotation direction must be a canonical dimensionless scalar.',
        { unit: '', dimension: 'dimensionless' },
        rotationUnit.actual,
        tolerance,
      ),
    )
    const forceVectorEntry = result.derivedQuantities.find(
      (entry) => entry.key === 'lorentz_force_vector',
    )
    const forceVectorActual =
      forceVectorEntry !== undefined &&
      isRecord(forceVectorEntry.value) &&
      isQuantityVector(forceVectorEntry.value)
        ? {
            unit: forceVectorEntry.value.unit,
            dimension: forceVectorEntry.value.dimension,
          }
        : undefined
    let forceVectorUnitValid = false
    if (
      forceVectorEntry !== undefined &&
      isRecord(forceVectorEntry.value) &&
      isQuantityVector(forceVectorEntry.value)
    ) {
      try {
        forceVectorUnitValid =
          forceVectorEntry.value.dimension === 'force' &&
          isKnownUnit(forceVectorEntry.value.unit) &&
          dimensionOf(forceVectorEntry.value.unit) === 'force' &&
          isCanonicalUnit({
            value: 0,
            unit: forceVectorEntry.value.unit,
            dimension: forceVectorEntry.value.dimension,
          })
      } catch {
        forceVectorUnitValid = false
      }
    }
    checks.push(
      makeCheck(
        'force_vector_unit',
        'dimension',
        forceVectorUnitValid,
        'Lorentz force vector must use N and force dimension.',
        { unit: 'N', dimension: 'force' },
        forceVectorActual,
        tolerance,
      ),
    )

    const period = canonicalScalar(derivedScalarValue(result, 'cyclotron_period'))
    const radius = canonicalScalar(derivedScalarValue(result, 'cyclotron_radius'))
    const angularVelocity = canonicalScalar(derivedScalarValue(result, 'angular_velocity'))
    const forceMagnitude = canonicalScalar(derivedScalarValue(result, 'lorentz_force_magnitude'))
    const mass = model.mass
    const chargeMagnitude = model.charge === undefined ? undefined : Math.abs(model.charge)
    const expectedRadius =
      mass !== undefined &&
      model.speed !== undefined &&
      chargeMagnitude !== undefined &&
      model.fieldMagnitude !== undefined &&
      chargeMagnitude > 0 &&
      model.fieldMagnitude > 0
        ? (mass * model.speed) / (chargeMagnitude * model.fieldMagnitude)
        : undefined
    const expectedPeriod =
      mass !== undefined &&
      chargeMagnitude !== undefined &&
      model.fieldMagnitude !== undefined &&
      chargeMagnitude > 0 &&
      model.fieldMagnitude > 0
        ? (2 * Math.PI * mass) / (chargeMagnitude * model.fieldMagnitude)
        : undefined
    const expectedAngularVelocity =
      mass !== undefined &&
      chargeMagnitude !== undefined &&
      model.fieldMagnitude !== undefined &&
      mass > 0
        ? (chargeMagnitude * model.fieldMagnitude) / mass
        : undefined
    const expectedForceMagnitude =
      chargeMagnitude !== undefined &&
      model.speed !== undefined &&
      model.fieldMagnitude !== undefined
        ? chargeMagnitude * model.speed * model.fieldMagnitude
        : undefined

    const scenePosition = canonicalSceneParticleVector(scene, 'position')
    const sceneVelocity = canonicalSceneParticleVector(scene, 'velocity')
    const expectedCenter =
      scenePosition !== undefined &&
      sceneVelocity !== undefined &&
      magneticField !== undefined &&
      model.fieldMagnitude !== undefined &&
      model.fieldMagnitude > 0 &&
      mass !== undefined &&
      model.charge !== undefined &&
      model.charge !== 0
        ? subtract(
            scenePosition,
            scale(
              cross(scale(magneticField, 1 / model.fieldMagnitude), sceneVelocity),
              mass / (model.charge * model.fieldMagnitude),
            ),
          )
        : undefined
    const actualCenter = derivedVectorValue(result, 'orbit_center')
    const expectedRotation =
      model.charge === undefined || magneticField === undefined
        ? undefined
        : -model.charge * magneticField.z > 0
          ? 1
          : -1
    const actualRotation = canonicalScalar(derivedScalarValue(result, 'rotation_direction'))

    checks.push(
      makeCheck(
        'radius_consistency',
        'constraint',
        expectedRadius !== undefined &&
          radius !== undefined &&
          withinTolerance(radius, expectedRadius, tolerance),
        'Cyclotron radius must satisfy r = mv / (|q|B).',
        expectedRadius,
        radius,
        tolerance,
        { formula: 'r = mv / |q|B' },
      ),
      makeCheck(
        'period_consistency',
        'constraint',
        expectedPeriod !== undefined &&
          period !== undefined &&
          withinTolerance(period, expectedPeriod, tolerance),
        'Cyclotron period must satisfy T = 2πm / (|q|B).',
        expectedPeriod,
        period,
        tolerance,
        { formula: 'T = 2πm / |q|B' },
      ),
      makeCheck(
        'angular_velocity_consistency',
        'constraint',
        expectedAngularVelocity !== undefined &&
          angularVelocity !== undefined &&
          withinTolerance(angularVelocity, expectedAngularVelocity, tolerance),
        'Angular velocity must satisfy ω = |q|B / m.',
        expectedAngularVelocity,
        angularVelocity,
        tolerance,
        { formula: 'ω = |q|B / m' },
      ),
      makeCheck(
        'force_magnitude_consistency',
        'constraint',
        expectedForceMagnitude !== undefined &&
          forceMagnitude !== undefined &&
          withinTolerance(forceMagnitude, expectedForceMagnitude, tolerance),
        'Lorentz force magnitude must satisfy |F| = |q|vB.',
        expectedForceMagnitude,
        forceMagnitude,
        tolerance,
        { formula: '|F| = |q|vB' },
      ),
      makeCheck(
        'orbit_center_consistency',
        'constraint',
        expectedCenter !== undefined &&
          actualCenter !== undefined &&
          vectorsWithinTolerance(actualCenter, expectedCenter, tolerance),
        'Orbit center must match the initial state and magnetic model.',
        expectedCenter,
        actualCenter,
        tolerance,
        { formula: 'c = r0 - (m/qB)(Bhat x v0)' },
      ),
      makeCheck(
        'rotation_direction_consistency',
        'constraint',
        expectedRotation !== undefined && actualRotation === expectedRotation,
        'Rotation direction must satisfy sign(-qBz).',
        expectedRotation,
        actualRotation,
        tolerance,
        { formula: 'direction = sign(-qBz)' },
      ),
    )

    const trajectoryRadii = result.states.map((state) => {
      const position = canonicalStateVector(state, model.particleId, 'position')
      return position === undefined || expectedCenter === undefined
        ? undefined
        : magnitude(subtract(position, expectedCenter))
    })
    checks.push(
      makeCheck(
        'trajectory_radius_consistency',
        'trajectory',
        expectedRadius !== undefined &&
          result.states.length > 0 &&
          trajectoryRadii.every(
            (stateRadius) =>
              stateRadius !== undefined && withinTolerance(stateRadius, expectedRadius, tolerance),
          ),
        'Every supplied trajectory position must lie on the verified circular orbit.',
        expectedRadius,
        trajectoryRadii,
        tolerance,
        { sampleCount: result.states.length },
      ),
    )

    const expectedInitialForce =
      speedVector === undefined || magneticField === undefined || model.charge === undefined
        ? undefined
        : scale(cross(speedVector, magneticField), model.charge)
    const derivedInitialForce = derivedVectorValue(result, 'lorentz_force_vector')
    checks.push(
      makeCheck(
        'lorentz_force_vector_consistency',
        'constraint',
        expectedInitialForce !== undefined &&
          derivedInitialForce !== undefined &&
          directedVectorsWithinTolerance(derivedInitialForce, expectedInitialForce, tolerance),
        'The derived Lorentz force vector must satisfy F = q(v × B).',
        expectedInitialForce,
        derivedInitialForce,
        tolerance,
        { formula: 'F = q(v × B)' },
      ),
    )

    const window = request === undefined ? undefined : requestedWindowOf(request, expectedPeriod)
    const timeTolerance = requestAware ? requestedTimeTolerance(expectedPeriod, window, tolerance) : undefined
    if (requestAware) {
      checks.push(makeCheck(
        'requested_window_valid', 'schema', window !== undefined,
        'The requested window must use finite time quantities with 0 <= start <= end.',
        'finite ordered non-negative time window', window ?? 'invalid', tolerance,
      ))
      const sampleTimes = result.states.map(state => canonicalTime(state.time))
      const samplesInRange = window !== undefined && result.states.length > 0 && sampleTimes.every(
        time => time !== undefined && timeInWindow(time, window),
      )
      checks.push(makeCheck(
        'requested_window_samples', 'trajectory', samplesInRange,
        'Every supplied state must be timed inside the actual requested window.',
        window ?? 'valid requested window', sampleTimes, tolerance,
      ))
      const firstEndpoint = window === undefined ? undefined : findStateAt(result, window.startTime, tolerance, timeTolerance)
      const lastEndpoint = window === undefined ? undefined : findStateAt(result, window.endTime, tolerance, timeTolerance)
      checks.push(makeCheck(
        'requested_window_endpoints', 'boundary', window !== undefined &&
          firstEndpoint !== undefined && lastEndpoint !== undefined &&
          (window.startTime === window.endTime || firstEndpoint !== lastEndpoint),
        'The result must contain the requested start and end states.',
        window ?? 'valid requested window',
        { first: sampleTimes[0], last: sampleTimes.at(-1) }, tolerance,
      ))
      const expectedStates = result.states.map(state => {
        const time = canonicalTime(state.time)
        if (
          time === undefined || scenePosition === undefined || sceneVelocity === undefined ||
          expectedCenter === undefined || magneticField === undefined || model.fieldMagnitude === undefined ||
          model.fieldMagnitude <= 0 || mass === undefined || mass <= 0 || model.charge === undefined
        ) return undefined
        const axis = scale(magneticField, 1 / model.fieldMagnitude)
        const angle = -model.charge * model.fieldMagnitude * time / mass
        const velocity = rotateAroundAxis(sceneVelocity, axis, angle)
        return {
          position: add(expectedCenter, rotateAroundAxis(subtract(scenePosition, expectedCenter), axis, angle)),
          velocity,
          acceleration: scale(cross(velocity, magneticField), model.charge / mass),
        }
      })
      const stateMatches = result.states.map((state, index) => {
        const expected = expectedStates[index]
        const position = canonicalStateVector(state, model.particleId, 'position')
        const velocity = canonicalStateVector(state, model.particleId, 'velocity')
        const suppliedAcceleration = findParticleObject(state, model.particleId)?.acceleration
        let accelerationMatches = suppliedAcceleration === undefined
        if (suppliedAcceleration !== undefined && expected !== undefined && suppliedAcceleration.dimension === 'acceleration') {
          try {
            accelerationMatches = directedVectorsWithinTolerance(toCanonicalVector(suppliedAcceleration).vectorSI, expected.acceleration, tolerance)
          } catch {
            accelerationMatches = false
          }
        }
        return expected !== undefined && position !== undefined && velocity !== undefined && accelerationMatches &&
          vectorsWithinTolerance(position, expected.position, tolerance) &&
          directedVectorsWithinTolerance(velocity, expected.velocity, tolerance)
      })
      checks.push(makeCheck(
        'requested_window_analytic_states', 'trajectory', result.states.length > 0 && stateMatches.every(Boolean),
        'Each supplied position, velocity and optional acceleration must match the magnetic trajectory at its absolute sample time.',
        'analytical state at each supplied time', stateMatches, tolerance,
        { sampleCount: result.states.length, formula: 'r(t) = c + R_B(-qBt/m)(r0-c); v(t) = R_B(-qBt/m)v0' },
      ))
    }

    const sampleStates: Array<{
      readonly point: { readonly id: string; readonly label: string }
      readonly state: SimulationState | undefined
    }> = []
    for (const point of SAMPLE_POINTS) {
      const time = (requestAware ? expectedPeriod : period) === undefined
        ? undefined
        : (requestAware ? expectedPeriod : period)! * point.fraction
      if (requestAware && (window === undefined || time === undefined || !timeInWindow(time, window))) {
        warnings.push({
          code: `magnetic_checkpoint_not_requested:${point.id}`,
          severity: 'warning',
          message: `Checkpoint t=${point.label} was not evaluated because it is outside the requested window.`,
          details: makeDetails('checkpoint inside requested window', 'not requested', tolerance, { time, window, evaluated: false }),
        })
        continue
      }
      sampleStates.push({ point, state: findStateAt(result, time, tolerance, timeTolerance) })
    }
    if (requestAware) {
      // Actual window samples supply conservation and force evidence even when no canonical checkpoint was requested.
      result.states.forEach((state, index) => sampleStates.push({
        point: { id: `sample${index}`, label: String(canonicalTime(state.time)) }, state,
      }))
    }

    const initialSpeed = requestAware
      ? model.speed
      : (() => {
          const vector = canonicalStateVector(sampleStates[0]?.state, model.particleId, 'velocity')
          return vector === undefined ? undefined : magnitude(vector)
        })()
    const speedActuals: Array<number | undefined> = []
    for (const sample of sampleStates) {
      const velocity = canonicalStateVector(sample.state, model.particleId, 'velocity')
      const speed = velocity === undefined ? undefined : magnitude(velocity)
      speedActuals.push(finiteNumber(speed) ? speed : undefined)
      const passed =
        initialSpeed !== undefined &&
        speed !== undefined &&
        withinTolerance(speed, initialSpeed, tolerance)
      checks.push(
        makeCheck(
          `speed_conservation_${sample.point.id}`,
          'conservation',
          passed,
          `Speed at t=${sample.point.label} must equal the initial speed.`,
          initialSpeed,
          speed,
          tolerance,
          { timeLabel: sample.point.label },
        ),
      )
    }
    checks.push(
      makeCheck(
        'speed_conservation',
        'conservation',
        initialSpeed !== undefined && sampleStates.length > 0 &&
          speedActuals.every(
            (speed) => speed !== undefined && withinTolerance(speed, initialSpeed, tolerance),
          ),
        requestAware
          ? 'Speed must equal the scene initial speed at every requested verification sample.'
          : 'Speed must be conserved at 0, T/4, T/2, 3T/4 and T.',
        initialSpeed,
        speedActuals,
        tolerance,
        { sampleTimes: sampleStates.map((sample) => sample.point.label) },
      ),
    )

    const forceRepresentations: Array<Record<string, unknown>> = []
    const expectedForceVectors: Array<Vector3 | undefined> = []
    const actualForceVectors: Array<Vector3 | undefined> = []
    const forceVectorMatches: boolean[] = []
    for (const sample of sampleStates) {
      const sources = forceVectorSources(sample.state, model.particleId)
      const representationsConsistent =
        sources.derivedPresent && sources.objectPresent
          ? sources.derived !== undefined &&
            sources.object !== undefined &&
            directedVectorsWithinTolerance(sources.derived, sources.object, tolerance)
          : sources.derivedPresent
            ? sources.derived !== undefined
            : sources.objectPresent && sources.object !== undefined
      forceRepresentations.push({
        timeLabel: sample.point.label,
        derivedPresent: sources.derivedPresent,
        objectPresent: sources.objectPresent,
        derived: sources.derived,
        object: sources.object,
        consistent: representationsConsistent,
      })

      const velocity = canonicalStateVector(sample.state, model.particleId, 'velocity')
      const expectedForce =
        velocity === undefined || magneticField === undefined || model.charge === undefined
          ? undefined
          : scale(cross(velocity, magneticField), model.charge)
      const actualForce = sources.derived ?? sources.object
      expectedForceVectors.push(expectedForce)
      actualForceVectors.push(actualForce)
      forceVectorMatches.push(
        expectedForce !== undefined &&
          actualForce !== undefined &&
          directedVectorsWithinTolerance(actualForce, expectedForce, tolerance),
      )
    }
    checks.push(
      makeCheck(
        'force_state_representations',
        'semantic',
        sampleStates.length > 0 && forceRepresentations.every((entry) => entry.consistent === true),
        'Duplicate state force representations must agree when both are present.',
        true,
        forceRepresentations,
        tolerance,
      ),
      makeCheck(
        'lorentz_force_vector_samples',
        'constraint',
        sampleStates.length > 0 && forceVectorMatches.every((matches) => matches),
        'Sampled Lorentz force vectors must satisfy F = q(v × B).',
        expectedForceVectors,
        actualForceVectors,
        tolerance,
        { sampleTimes: sampleStates.map((sample) => sample.point.label), formula: 'F = q(v × B)' },
      ),
    )

    const orthogonalityActuals: Array<number | undefined> = []
    for (const sample of sampleStates) {
      const velocity = canonicalStateVector(sample.state, model.particleId, 'velocity')
      const force = canonicalForceVector(sample.state, model.particleId)
      const normalized =
        velocity === undefined || force === undefined ? undefined : normalizedDot(force, velocity)
      orthogonalityActuals.push(normalized)
      checks.push(
        makeCheck(
          `force_velocity_orthogonality_${sample.point.id}`,
          'constraint',
          normalized !== undefined && normalized <= tolerance.angular,
          `Lorentz force must be perpendicular to velocity at t=${sample.point.label}.`,
          0,
          normalized,
          tolerance,
          { timeLabel: sample.point.label, comparison: 'absolute normalized |F·v|' },
        ),
      )
    }
    checks.push(
      makeCheck(
        'force_velocity_orthogonality',
        'constraint',
        sampleStates.length > 0 && orthogonalityActuals.every((value) => value !== undefined && value <= tolerance.angular),
        'Lorentz force must satisfy F · v ≈ 0 at every verification sample.',
        0,
        orthogonalityActuals,
        tolerance,
        {
          sampleTimes: sampleStates.map((sample) => sample.point.label),
          angularTolerance: tolerance.angular,
        },
      ),
    )

    const forceMagnitudeActuals: Array<number | undefined> = []
    for (const sample of sampleStates) {
      const force = canonicalForceVector(sample.state, model.particleId)
      const value = force === undefined ? undefined : magnitude(force)
      forceMagnitudeActuals.push(finiteNumber(value) ? value : undefined)
    }
    checks.push(
      makeCheck(
        'force_magnitude_samples',
        'constraint',
        expectedForceMagnitude !== undefined && sampleStates.length > 0 &&
          forceMagnitudeActuals.every(
            (value) =>
              value !== undefined && withinTolerance(value, expectedForceMagnitude, tolerance),
          ),
        'Force magnitude must satisfy |F| ≈ |q|vB at every verification sample.',
        expectedForceMagnitude,
        forceMagnitudeActuals,
        tolerance,
        { sampleTimes: sampleStates.map((sample) => sample.point.label) },
      ),
    )

    const initialState = sampleStates.find(sample => sample.point.id === 't0')?.state
    const finalState = sampleStates.find(sample => sample.point.id === 'tPeriod')?.state
    const initialPosition = canonicalStateVector(initialState, model.particleId, 'position')
    const finalPosition = canonicalStateVector(finalState, model.particleId, 'position')
    const initialVelocity = canonicalStateVector(initialState, model.particleId, 'velocity')
    const finalVelocity = canonicalStateVector(finalState, model.particleId, 'velocity')
    const initialRequested = !requestAware || (window !== undefined && timeInWindow(0, window))
    if (initialRequested) {
      const initialMatchesScene =
        scenePosition !== undefined &&
        sceneVelocity !== undefined &&
        initialPosition !== undefined &&
        initialVelocity !== undefined &&
        vectorsWithinTolerance(initialPosition, scenePosition, tolerance) &&
        vectorsWithinTolerance(initialVelocity, sceneVelocity, tolerance)
      checks.push(makeCheck(
        'initial_state_matches_scene', 'boundary', initialMatchesScene,
        'The supplied t=0 state must match the particle initial position and velocity in the scene.',
        { position: scenePosition, velocity: sceneVelocity },
        { position: initialPosition, velocity: initialVelocity }, tolerance,
        { source: 'PhysicsScene and SimulationResult.states' },
      ))
    } else {
      warnings.push({
        code: 'initial_state_not_requested', severity: 'warning',
        message: 'The t=0 initial-state check was not executed because t=0 is outside the requested window.',
        details: makeDetails('requested t=0 state', 'not requested', tolerance, { evaluated: false }),
      })
    }
    const periodRequested = !requestAware || (window !== undefined && expectedPeriod !== undefined && timeInWindow(expectedPeriod, window))
    if (initialRequested && periodRequested) {
      const positionClosed = initialPosition !== undefined && finalPosition !== undefined &&
        vectorsWithinTolerance(finalPosition, initialPosition, tolerance)
      const velocityClosed = initialVelocity !== undefined && finalVelocity !== undefined &&
        vectorsWithinTolerance(finalVelocity, initialVelocity, tolerance)
      checks.push(makeCheck(
        'state_at_period_matches_initial', 'trajectory', positionClosed && velocityClosed,
        'The supplied state at T must return to the supplied initial position and velocity.',
        { position: initialPosition, velocity: initialVelocity },
        { position: finalPosition, velocity: finalVelocity }, tolerance,
        { positionClosed, velocityClosed, source: 'SimulationResult.states' },
      ))
    } else {
      warnings.push({
        code: 'period_closure_not_requested', severity: 'warning',
        message: 'Period closure was not executed because the requested window does not contain both 0 and T.',
        details: makeDetails('supplied states at 0 and T', 'not requested', tolerance, { evaluated: false, window }),
      })
    }

    return summarizeVerification(checks, warnings, errors)
  }

  validate(scene: PhysicsScene, result: SimulationResult): VerificationResult {
    return this.verify(scene, result)
  }
}

export const verifyMagneticScene = (
  scene: PhysicsScene,
  result: SimulationResult,
  options: MagneticVerifierConfiguration = {},
): VerificationResult => new MagneticPhysicsVerifier(options).verify(scene, result)

export const verifyMagneticSimulation = verifyMagneticScene
export const verifyMagneticResult = verifyMagneticScene
export const verifyMagnetic = verifyMagneticScene
export const verifySimulationResult = verifyMagneticScene
export const verify = verifyMagneticScene
