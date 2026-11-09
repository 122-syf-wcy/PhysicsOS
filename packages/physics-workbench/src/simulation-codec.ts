import type {
  ActorRef,
  DerivedQuantity,
  FormulaRef,
  Measurement,
  ObjectState,
  PhysicsDomain,
  PhysicsEventLike,
  QuantityVector,
  SimulationMetadata,
  SimulationOptions,
  SimulationRequest,
  SimulationResult,
  SimulationState,
  TraceContext,
  VerificationCheck,
  VerificationCheckType,
  VerificationIssue,
  VerificationLevel,
  VerificationResult,
} from '@physicsos/physics-core'
import {
  canonicalValue,
  findUnit,
  physicalDimensions,
  type PhysicalDimension,
  type Quantity,
} from '@physicsos/physics-units'
import {
  asCommandId,
  asPhysicsEventId,
  asRunId,
  asSceneId,
  asSessionId,
  asSimulationId,
  asToolCallId,
  asTraceId,
  asTurnId,
  asUserId,
  isIsoDateTime,
  type IsoDateTime,
} from '@physicsos/shared'

import {
  boolean,
  copyJsonObject,
  exactKeys,
  fail,
  finite,
  integer,
  jsonObject,
  jsonValue,
  list,
  nonnegative,
  oneOf,
  optional,
  pointer,
  positive,
  record,
  text,
  unique,
} from './json.ts'
import type { RendererReleaseIdentity } from './types.ts'

const DOMAINS: readonly PhysicsDomain[] = [
  'mechanics', 'kinematics', 'gravity', 'electric', 'magnetic', 'electromagnetic',
  'circuit', 'induction', 'optics', 'wave', 'thermal', 'modern_physics', 'composite',
]
const CHECK_TYPES: readonly VerificationCheckType[] = [
  'schema', 'dimension', 'symbolic', 'numerical', 'constraint', 'conservation',
  'boundary', 'trajectory', 'continuity', 'semantic',
]
const VERIFICATION_LEVELS: readonly VerificationLevel[] = [
  'UNVERIFIED', 'ENGINE_COMPUTED', 'RULE_VERIFIED', 'NUMERIC_VERIFIED',
  'SYMBOLIC_VERIFIED', 'CONSERVATION_VERIFIED', 'STRONGLY_VERIFIED',
]
const TRACE_KEYS = [
  'traceId', 'userId', 'sessionId', 'runId', 'turnId', 'toolCallId', 'sceneId',
  'sceneRevision', 'physicsEventId',
] as const

// JSON provenance alone does not prove a simulation schema. Only successful
// readers register their detached, recursively frozen outputs in these sets.
// Mutable caller identities and caller-frozen graphs are never memoized.
const validatedRequests = new WeakSet<object>()
const validatedResults = new WeakSet<object>()
const validatedStates = new WeakSet<object>()
const ownedSimulationData = <T extends object>(value: T): T => copyJsonObject(value) as unknown as T

const identity = (input: unknown, path: string): string => text(input, path, true)
const timestamp = (input: unknown, path: string): IsoDateTime => {
  const value = identity(input, path)
  // Domain timestamps follow shared validation, not canvas calendar restrictions.
  return isIsoDateTime(value) ? value : fail(path, 'date', 'Expected a valid shared date-time.')
}
const seed = (input: unknown, path: string): number => integer(input, path, Number.MIN_SAFE_INTEGER)
const strings = (input: unknown, path: string): string[] => list(input, path, text)

const dictionary = <T>(
  input: unknown,
  path: string,
  read: (value: unknown, path: string) => T,
): Record<string, T> => {
  const object = record(input, path)
  const output: Record<string, T> = {}
  for (const [key, value] of Object.entries(object)) {
    output[key] = read(value, pointer(path, key))
  }
  return output
}

const quantityUnit = (
  object: Record<string, unknown>,
  path: string,
  expected?: PhysicalDimension,
): { unit: string; dimension: PhysicalDimension; toSI: number } => {
  // The dimensionless registry entry deliberately has an empty unit symbol.
  const unit = text(object.unit, pointer(path, 'unit'))
  const dimension = oneOf(object.dimension, physicalDimensions(), pointer(path, 'dimension'))
  const definition = findUnit(unit)
  if (definition === undefined) {
    return fail(pointer(path, 'unit'), 'unit', 'Expected a unit registered in physics-units.')
  }
  if (definition.dimension !== dimension) {
    return fail(pointer(path, 'dimension'), 'dimension', `Unit '${unit}' has dimension '${definition.dimension}', not '${dimension}'.`)
  }
  if (expected !== undefined && dimension !== expected) {
    return fail(pointer(path, 'dimension'), 'dimension', `Expected dimension '${expected}', not '${dimension}'.`)
  }
  return { unit, dimension, toSI: definition.toSI }
}

function quantityFromJson<D extends PhysicalDimension>(input: unknown, path: string, expected: D): Quantity<D>
function quantityFromJson(input: unknown, path: string, expected?: PhysicalDimension): Quantity
function quantityFromJson(input: unknown, path: string, expected?: PhysicalDimension): Quantity {
  const object = record(input, path)
  exactKeys(object, ['value', 'unit', 'dimension'], path)
  const { unit, dimension, toSI } = quantityUnit(object, path, expected)
  const value = finite(object.value, pointer(path, 'value'))
  finite(value * toSI, pointer(path, 'value'))
  return { value, unit, dimension }
}

function vectorFromJson<D extends PhysicalDimension>(input: unknown, path: string, expected: D): QuantityVector<D>
function vectorFromJson(input: unknown, path: string, expected?: PhysicalDimension): QuantityVector
function vectorFromJson(input: unknown, path: string, expected?: PhysicalDimension): QuantityVector {
  const object = record(input, path)
  exactKeys(object, ['vector', 'unit', 'dimension'], path)
  const { unit, dimension, toSI } = quantityUnit(object, path, expected)
  const vectorPath = pointer(path, 'vector')
  const components = record(object.vector, vectorPath)
  exactKeys(components, ['x', 'y', 'z'], vectorPath)
  const vector = {
    x: finite(components.x, pointer(vectorPath, 'x')),
    y: finite(components.y, pointer(vectorPath, 'y')),
    z: finite(components.z, pointer(vectorPath, 'z')),
  }
  finite(vector.x * toSI, pointer(vectorPath, 'x'))
  finite(vector.y * toSI, pointer(vectorPath, 'y'))
  finite(vector.z * toSI, pointer(vectorPath, 'z'))
  return { vector, unit, dimension }
}

function scalarOrVectorFromJson<D extends PhysicalDimension>(input: unknown, path: string, expected: D): Quantity<D> | QuantityVector<D>
function scalarOrVectorFromJson(input: unknown, path: string, expected?: PhysicalDimension): Quantity | QuantityVector
function scalarOrVectorFromJson(input: unknown, path: string, expected?: PhysicalDimension): Quantity | QuantityVector {
  const object = record(input, path)
  const scalar = Object.hasOwn(object, 'value')
  const vector = Object.hasOwn(object, 'vector')
  if (scalar === vector) {
    return fail(path, 'quantity', 'Expected exactly one scalar value or vector.')
  }
  return scalar ? quantityFromJson(object, path, expected) : vectorFromJson(object, path, expected)
}

/** Direct readers validate and detach the entire input, including otherwise unknown properties. */
export function readQuantity<D extends PhysicalDimension>(input: unknown, path: string, expected: D): Quantity<D>
export function readQuantity(input: unknown, path: string, expected?: PhysicalDimension): Quantity
export function readQuantity(input: unknown, path: string, expected?: PhysicalDimension): Quantity {
  return quantityFromJson(jsonValue(input, path), path, expected)
}

export function readQuantityVector<D extends PhysicalDimension>(input: unknown, path: string, expected: D): QuantityVector<D>
export function readQuantityVector(input: unknown, path: string, expected?: PhysicalDimension): QuantityVector
export function readQuantityVector(input: unknown, path: string, expected?: PhysicalDimension): QuantityVector {
  return vectorFromJson(jsonValue(input, path), path, expected)
}

export function readScalarOrVector<D extends PhysicalDimension>(input: unknown, path: string, expected: D): Quantity<D> | QuantityVector<D>
export function readScalarOrVector(input: unknown, path: string, expected?: PhysicalDimension): Quantity | QuantityVector
export function readScalarOrVector(input: unknown, path: string, expected?: PhysicalDimension): Quantity | QuantityVector {
  return scalarOrVectorFromJson(jsonValue(input, path), path, expected)
}

const timeFromJson = (input: unknown, path: string): Quantity<'time'> => {
  const value = quantityFromJson(input, path, 'time')
  nonnegative(value.value, pointer(path, 'value'))
  return value
}
const timeStepFromJson = (input: unknown, path: string): Quantity<'time'> => {
  const value = timeFromJson(input, path)
  positive(canonicalValue(value), pointer(path, 'value'))
  return value
}

const traceFromJson = (input: unknown, path: string, eventExtensions = false): TraceContext => {
  const object = record(input, path)
  if (!eventExtensions) exactKeys(object, TRACE_KEYS, path)
  const traceId = asTraceId(identity(object.traceId, pointer(path, 'traceId')))
  const userId = optional(object.userId, pointer(path, 'userId'), (value, at) => asUserId(identity(value, at)))
  const sessionId = optional(object.sessionId, pointer(path, 'sessionId'), (value, at) => asSessionId(identity(value, at)))
  const runId = optional(object.runId, pointer(path, 'runId'), (value, at) => asRunId(identity(value, at)))
  const turnId = optional(object.turnId, pointer(path, 'turnId'), (value, at) => asTurnId(identity(value, at)))
  const toolCallId = optional(object.toolCallId, pointer(path, 'toolCallId'), (value, at) => asToolCallId(identity(value, at)))
  const sceneId = optional(object.sceneId, pointer(path, 'sceneId'), (value, at) => asSceneId(identity(value, at)))
  const sceneRevision = optional(object.sceneRevision, pointer(path, 'sceneRevision'), integer)
  const physicsEventId = optional(object.physicsEventId, pointer(path, 'physicsEventId'), (value, at) => asPhysicsEventId(identity(value, at)))
  return {
    ...(eventExtensions ? object : {}),
    traceId,
    ...(userId === undefined ? {} : { userId }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(runId === undefined ? {} : { runId }),
    ...(turnId === undefined ? {} : { turnId }),
    ...(toolCallId === undefined ? {} : { toolCallId }),
    ...(sceneId === undefined ? {} : { sceneId }),
    ...(sceneRevision === undefined ? {} : { sceneRevision }),
    ...(physicsEventId === undefined ? {} : { physicsEventId }),
  }
}

const optionsFromJson = (input: unknown, path: string): SimulationOptions => {
  const object = record(input, path)
  exactKeys(object, [
    'startTime', 'endTime', 'timeStep', 'outputSampleRate', 'solver', 'tolerance',
    'maxIterations', 'randomSeed',
  ], path)
  const startTime = optional(object.startTime, pointer(path, 'startTime'), timeFromJson)
  const endTime = optional(object.endTime, pointer(path, 'endTime'), timeFromJson)
  if (endTime !== undefined && canonicalValue(endTime) < (startTime === undefined ? 0 : canonicalValue(startTime))) {
    fail(pointer(path, 'endTime'), 'time-order', 'Simulation end time cannot precede start time.')
  }
  const timeStep = optional(object.timeStep, pointer(path, 'timeStep'), timeStepFromJson)
  const outputSampleRate = optional(object.outputSampleRate, pointer(path, 'outputSampleRate'), positive)
  const solver = optional(object.solver, pointer(path, 'solver'), identity)
  const tolerance = optional(object.tolerance, pointer(path, 'tolerance'), (value, at) => {
    const entry = record(value, at)
    exactKeys(entry, ['absolute', 'relative'], at)
    return {
      absolute: nonnegative(entry.absolute, pointer(at, 'absolute')),
      relative: nonnegative(entry.relative, pointer(at, 'relative')),
    }
  })
  const maxIterations = optional(object.maxIterations, pointer(path, 'maxIterations'), (value, at) => integer(value, at, 1))
  const randomSeed = optional(object.randomSeed, pointer(path, 'randomSeed'), seed)
  return {
    ...(startTime === undefined ? {} : { startTime }),
    ...(endTime === undefined ? {} : { endTime }),
    ...(timeStep === undefined ? {} : { timeStep }),
    ...(outputSampleRate === undefined ? {} : { outputSampleRate }),
    ...(solver === undefined ? {} : { solver }),
    ...(tolerance === undefined ? {} : { tolerance }),
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(randomSeed === undefined ? {} : { randomSeed }),
  }
}

/** Returns schema-owned, deeply frozen evidence; previously validated outputs are reusable. */
export const readSimulationRequest = (input: unknown, path: string): SimulationRequest => {
  if (input !== null && typeof input === 'object' && validatedRequests.has(input)) return input as SimulationRequest
  const object = record(jsonValue(input, path), path)
  exactKeys(object, [
    'schemaVersion', 'simulationId', 'sceneId', 'sceneRevision', 'requestedDomain', 'options', 'trace',
  ], path)
  const requestedDomain = optional(object.requestedDomain, pointer(path, 'requestedDomain'), (value, at) => oneOf(value, DOMAINS, at))
  const request: SimulationRequest = {
    schemaVersion: oneOf(object.schemaVersion, ['simulation-request/1.0'], pointer(path, 'schemaVersion')),
    simulationId: asSimulationId(identity(object.simulationId, pointer(path, 'simulationId'))),
    sceneId: asSceneId(identity(object.sceneId, pointer(path, 'sceneId'))),
    sceneRevision: integer(object.sceneRevision, pointer(path, 'sceneRevision')),
    ...(requestedDomain === undefined ? {} : { requestedDomain }),
    options: optionsFromJson(object.options, pointer(path, 'options')),
    trace: traceFromJson(object.trace, pointer(path, 'trace')),
  }
  const owned = ownedSimulationData(request)
  validatedRequests.add(owned)
  return owned
}

const formulaFromJson = (input: unknown, path: string): FormulaRef => {
  const object = record(input, path)
  exactKeys(object, ['id', 'expression', 'latex', 'variables', 'conditions'], path)
  const id = optional(object.id, pointer(path, 'id'), identity)
  const latex = optional(object.latex, pointer(path, 'latex'), text)
  const variables = optional(object.variables, pointer(path, 'variables'), (value, at) => dictionary(value, at, text))
  const conditions = optional(object.conditions, pointer(path, 'conditions'), strings)
  return {
    ...(id === undefined ? {} : { id }),
    expression: identity(object.expression, pointer(path, 'expression')),
    ...(latex === undefined ? {} : { latex }),
    ...(variables === undefined ? {} : { variables }),
    ...(conditions === undefined ? {} : { conditions }),
  }
}

const derivedFromJson = (input: unknown, path: string): DerivedQuantity => {
  const object = record(input, path)
  exactKeys(object, ['key', 'targetId', 'value', 'formula', 'assumptions', 'confidence'], path)
  const targetId = optional(object.targetId, pointer(path, 'targetId'), identity)
  const formula = optional(object.formula, pointer(path, 'formula'), formulaFromJson)
  const assumptions = optional(object.assumptions, pointer(path, 'assumptions'), strings)
  const confidence = optional(object.confidence, pointer(path, 'confidence'), (value, at) => {
    const number = finite(value, at)
    return number >= 0 && number <= 1 ? number : fail(at, 'confidence', 'Expected confidence between zero and one.')
  })
  return {
    key: identity(object.key, pointer(path, 'key')),
    ...(targetId === undefined ? {} : { targetId }),
    value: scalarOrVectorFromJson(object.value, pointer(path, 'value')),
    ...(formula === undefined ? {} : { formula }),
    ...(assumptions === undefined ? {} : { assumptions }),
    ...(confidence === undefined ? {} : { confidence }),
  }
}

/** Escaped segments keep native keys and optional target IDs unambiguous. */
const derivedIdentity = (entry: DerivedQuantity): string =>
  entry.targetId === undefined ? pointer('', entry.key) : pointer(pointer('', entry.key), entry.targetId)

const objectStateFromJson = (input: unknown, path: string): ObjectState => {
  const object = record(input, path)
  exactKeys(object, ['id', 'position', 'velocity', 'acceleration', 'values'], path)
  const position = optional(object.position, pointer(path, 'position'), (value, at) => vectorFromJson(value, at, 'length'))
  const velocity = optional(object.velocity, pointer(path, 'velocity'), (value, at) => vectorFromJson(value, at, 'velocity'))
  const acceleration = optional(object.acceleration, pointer(path, 'acceleration'), (value, at) => vectorFromJson(value, at, 'acceleration'))
  const values = optional(object.values, pointer(path, 'values'), (value, at) => dictionary(value, at, scalarOrVectorFromJson))
  return {
    id: identity(object.id, pointer(path, 'id')),
    ...(position === undefined ? {} : { position }),
    ...(velocity === undefined ? {} : { velocity }),
    ...(acceleration === undefined ? {} : { acceleration }),
    ...(values === undefined ? {} : { values }),
  }
}

const stateFromJson = (input: unknown, path: string): SimulationState => {
  const object = record(input, path)
  exactKeys(object, ['time', 'objects', 'derived'], path)
  const state: SimulationState = {
    time: timeFromJson(object.time, pointer(path, 'time')),
    objects: list(object.objects, pointer(path, 'objects'), objectStateFromJson),
    derived: list(object.derived, pointer(path, 'derived'), derivedFromJson),
  }
  unique(state.objects, (entry) => entry.id, pointer(path, 'objects'))
  unique(state.derived, derivedIdentity, pointer(path, 'derived'))
  return state
}

/** Returns schema-owned, deeply frozen evidence; previously validated outputs are reusable. */
export const readSimulationState = (input: unknown, path: string): SimulationState => {
  if (input !== null && typeof input === 'object' && validatedStates.has(input)) return input as SimulationState
  const owned = ownedSimulationData(stateFromJson(jsonValue(input, path), path))
  validatedStates.add(owned)
  return owned
}

const measurementFromJson = (input: unknown, path: string): Measurement => {
  const object = record(input, path)
  exactKeys(object, ['id', 'definitionId', 'time', 'targetId', 'value', 'source', 'metadata'], path)
  const definitionId = optional(object.definitionId, pointer(path, 'definitionId'), identity)
  const time = optional(object.time, pointer(path, 'time'), timeFromJson)
  const targetId = optional(object.targetId, pointer(path, 'targetId'), identity)
  const metadata = optional(object.metadata, pointer(path, 'metadata'), jsonObject)
  return {
    id: identity(object.id, pointer(path, 'id')),
    ...(definitionId === undefined ? {} : { definitionId }),
    ...(time === undefined ? {} : { time }),
    ...(targetId === undefined ? {} : { targetId }),
    value: scalarOrVectorFromJson(object.value, pointer(path, 'value')),
    source: oneOf(object.source, ['simulation', 'derived', 'instrument', 'user'], pointer(path, 'source')),
    ...(metadata === undefined ? {} : { metadata }),
  }
}

const checkFromJson = (input: unknown, path: string): VerificationCheck => {
  const object = record(input, path)
  exactKeys(object, ['id', 'type', 'passed', 'message', 'targetId', 'details'], path)
  const message = optional(object.message, pointer(path, 'message'), text)
  const targetId = optional(object.targetId, pointer(path, 'targetId'), identity)
  const details = optional(object.details, pointer(path, 'details'), jsonObject)
  return {
    id: identity(object.id, pointer(path, 'id')),
    type: oneOf(object.type, CHECK_TYPES, pointer(path, 'type')),
    passed: boolean(object.passed, pointer(path, 'passed')),
    ...(message === undefined ? {} : { message }),
    ...(targetId === undefined ? {} : { targetId }),
    ...(details === undefined ? {} : { details }),
  }
}

const issueFromJson = (input: unknown, path: string): VerificationIssue => {
  const object = record(input, path)
  exactKeys(object, ['code', 'severity', 'message', 'targetId', 'details'], path)
  const targetId = optional(object.targetId, pointer(path, 'targetId'), identity)
  const details = optional(object.details, pointer(path, 'details'), jsonObject)
  return {
    code: identity(object.code, pointer(path, 'code')),
    severity: oneOf(object.severity, ['warning', 'error'], pointer(path, 'severity')),
    message: text(object.message, pointer(path, 'message')),
    ...(targetId === undefined ? {} : { targetId }),
    ...(details === undefined ? {} : { details }),
  }
}

const verificationFromJson = (input: unknown, path: string): VerificationResult => {
  const object = record(input, path)
  exactKeys(object, ['status', 'checks', 'warnings', 'errors', 'level'], path)
  const level = optional(object.level, pointer(path, 'level'), (value, at) => oneOf(value, VERIFICATION_LEVELS, at))
  // Parsing preserves recorded evidence; it neither upgrades nor certifies the claimed level.
  return {
    status: oneOf(object.status, ['passed', 'passed_with_warnings', 'failed'], pointer(path, 'status')),
    checks: list(object.checks, pointer(path, 'checks'), checkFromJson),
    warnings: list(object.warnings, pointer(path, 'warnings'), issueFromJson),
    errors: list(object.errors, pointer(path, 'errors'), issueFromJson),
    ...(level === undefined ? {} : { level }),
  }
}

const metadataFromJson = (input: unknown, path: string): SimulationMetadata => {
  const object = record(input, path)
  exactKeys(object, [
    'engineId', 'engineVersion', 'solver', 'startedAt', 'finishedAt', 'durationMs',
    'deterministic', 'randomSeed', 'numericalIterationCount',
  ], path)
  const startedAt = timestamp(object.startedAt, pointer(path, 'startedAt'))
  const finishedAt = timestamp(object.finishedAt, pointer(path, 'finishedAt'))
  if (Date.parse(finishedAt) < Date.parse(startedAt)) {
    fail(pointer(path, 'finishedAt'), 'time-order', 'Engine finish time cannot precede start time.')
  }
  const solver = optional(object.solver, pointer(path, 'solver'), identity)
  const randomSeed = optional(object.randomSeed, pointer(path, 'randomSeed'), seed)
  const numericalIterationCount = optional(object.numericalIterationCount, pointer(path, 'numericalIterationCount'), integer)
  return {
    engineId: identity(object.engineId, pointer(path, 'engineId')),
    engineVersion: identity(object.engineVersion, pointer(path, 'engineVersion')),
    ...(solver === undefined ? {} : { solver }),
    startedAt,
    finishedAt,
    durationMs: nonnegative(object.durationMs, pointer(path, 'durationMs')),
    deterministic: boolean(object.deterministic, pointer(path, 'deterministic')),
    ...(randomSeed === undefined ? {} : { randomSeed }),
    ...(numericalIterationCount === undefined ? {} : { numericalIterationCount }),
  }
}

const eventActorFromJson = (input: unknown, path: string): ActorRef => {
  const object = record(input, path)
  const id = optional(object.id, pointer(path, 'id'), text)
  return {
    ...object,
    type: oneOf(object.type, ['user', 'agent', 'system', 'teacher', 'migration'], pointer(path, 'type')),
    ...(id === undefined ? {} : { id }),
  }
}

const eventFromJson = (input: unknown, path: string): PhysicsEventLike => {
  const object = record(input, path)
  const eventId = asPhysicsEventId(identity(object.eventId, pointer(path, 'eventId')))
  const sceneId = asSceneId(identity(object.sceneId, pointer(path, 'sceneId')))
  const revision = integer(object.revision, pointer(path, 'revision'))
  const type = identity(object.type, pointer(path, 'type'))
  const time = optional(object.time, pointer(path, 'time'), nonnegative)
  const commandId = optional(object.commandId, pointer(path, 'commandId'), (value, at) => asCommandId(identity(value, at)))
  const actor = optional(object.actor, pointer(path, 'actor'), eventActorFromJson)
  const occurredAt = optional(object.occurredAt, pointer(path, 'occurredAt'), timestamp)
  const trace = optional(object.trace, pointer(path, 'trace'), (value, at) => traceFromJson(value, at, true))
  // PhysicsEventLike is a minimal constraint, not a closed event envelope. The
  // public result reader has already validated and copied every extension value.
  return {
    ...object,
    eventId,
    sceneId,
    revision,
    type,
    ...(time === undefined ? {} : { time }),
    ...(commandId === undefined ? {} : { commandId }),
    ...(actor === undefined ? {} : { actor }),
    ...(occurredAt === undefined ? {} : { occurredAt }),
    ...(trace === undefined ? {} : { trace }),
  }
}

/** Returns schema-owned, deeply frozen evidence; previously validated outputs are reusable. */
export const readSimulationResult = (input: unknown, path: string): SimulationResult => {
  if (input !== null && typeof input === 'object' && validatedResults.has(input)) return input as SimulationResult
  const object = record(jsonValue(input, path), path)
  exactKeys(object, [
    'schemaVersion', 'simulationId', 'sceneId', 'sceneRevision', 'states', 'events',
    'measurements', 'derivedQuantities', 'verification', 'metadata', 'trace',
  ], path)
  const result: SimulationResult = {
    schemaVersion: oneOf(object.schemaVersion, ['simulation-result/1.0'], pointer(path, 'schemaVersion')),
    simulationId: asSimulationId(identity(object.simulationId, pointer(path, 'simulationId'))),
    sceneId: asSceneId(identity(object.sceneId, pointer(path, 'sceneId'))),
    sceneRevision: integer(object.sceneRevision, pointer(path, 'sceneRevision')),
    states: list(object.states, pointer(path, 'states'), stateFromJson),
    events: list(object.events, pointer(path, 'events'), eventFromJson),
    measurements: list(object.measurements, pointer(path, 'measurements'), measurementFromJson),
    derivedQuantities: list(object.derivedQuantities, pointer(path, 'derivedQuantities'), derivedFromJson),
    verification: verificationFromJson(object.verification, pointer(path, 'verification')),
    metadata: metadataFromJson(object.metadata, pointer(path, 'metadata')),
    trace: traceFromJson(object.trace, pointer(path, 'trace')),
  }
  unique(result.events, (entry) => entry.eventId, pointer(path, 'events'))
  unique(result.measurements, (entry) => entry.id, pointer(path, 'measurements'))
  unique(result.derivedQuantities, derivedIdentity, pointer(path, 'derivedQuantities'))
  const owned = ownedSimulationData(result)
  validatedResults.add(owned)
  for (const state of owned.states) validatedStates.add(state)
  return owned
}

const rendererSha256 = (input: unknown, path: string): string => {
  const value = text(input, path)
  // Release hashes are historical domain evidence, not lower-case object digests.
  return value.length === 64 && /^[a-fA-F0-9]{64}$/.test(value)
    ? value
    : fail(path, 'sha256', 'Expected a 64-character SHA256 hex digest.')
}

export const readRendererRelease = (input: unknown, path: string): RendererReleaseIdentity => {
  const object = record(jsonValue(input, path), path)
  const kind = optional(object.kind, pointer(path, 'kind'), (value, at) => oneOf<'official' | 'community'>(value, ['official', 'community'], at))
  if (kind === 'official') {
    exactKeys(object, ['kind', 'id', 'experimentId', 'version'], path)
    return {
      kind,
      id: identity(object.id, pointer(path, 'id')),
      experimentId: identity(object.experimentId, pointer(path, 'experimentId')),
      version: identity(object.version, pointer(path, 'version')),
    }
  }
  exactKeys(object, ['kind', 'id', 'experimentId', 'version', 'sha256'], path)
  return {
    ...(kind === undefined ? {} : { kind }),
    id: identity(object.id, pointer(path, 'id')),
    experimentId: identity(object.experimentId, pointer(path, 'experimentId')),
    version: identity(object.version, pointer(path, 'version')),
    sha256: rendererSha256(object.sha256, pointer(path, 'sha256')),
  }
}
