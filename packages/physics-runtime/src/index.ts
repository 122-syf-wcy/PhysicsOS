/**
 * Engine dispatch for the tool runtime.
 *
 * Every PhysicsOS engine implements the same `PhysicsEngine` contract and ships
 * its own `create*SimulationRequest`. The tool runtime never guesses a domain
 * from titles: it asks each engine `canHandle(scene)` and runs the first one
 * that accepts, exactly as the Lab does through its per-domain runtimes. The
 * engines are mutually exclusive by construction (each rejects the apparatus
 * collections it does not model), so "first accepting engine" is deterministic.
 */

import type {
  PhysicsEngine,
  PhysicsEventLike,
  SimulationOptions,
  SimulationPlan,
  SimulationRequest,
  SimulationResult,
  VerificationCheck,
} from '@physicsos/physics-core'
import { canonicalValue, validateQuantity, type Quantity } from '@physicsos/physics-units'
import { PhysicsOSError } from '@physicsos/shared'
import type { PhysicsScene } from '@physicsos/physics-scene'
import { verifyMagneticScene, verifyMechanicsSimulation } from '@physicsos/physics-verifier'
import { MagneticEngine, createMagneticSimulationRequest } from '@physicsos/engine-magnetic'
import { CurrentFieldEngine, createCurrentSimulationRequest } from '@physicsos/engine-magnetic'
import { MechanicsEngine, createMechanicsSimulationRequest } from '@physicsos/engine-mechanics'
import { EnergyEngine, createEnergySimulationRequest } from '@physicsos/engine-mechanics'
import { CollisionEngine, createCollisionSimulationRequest } from '@physicsos/engine-collision'
import { ElectricEngine, createElectricSimulationRequest } from '@physicsos/engine-electric'
import {
  ElectricRegionEngine,
  createElectricRegionSimulationRequest,
} from '@physicsos/engine-electric-region'
import { CompositeEngine, createCompositeSimulationRequest } from '@physicsos/engine-composite'
import { CircuitEngine, createCircuitSimulationRequest } from '@physicsos/engine-circuit'
import { OpticsEngine, createOpticsSimulationRequest } from '@physicsos/engine-optics'
import { LightEngine, createLightSimulationRequest } from '@physicsos/engine-optics'
import { AcousticsEngine, createAcousticsSimulationRequest } from '@physicsos/engine-acoustics'
import { NoiseEngine, createNoiseSimulationRequest } from '@physicsos/engine-acoustics'
import {
  FluidEngine,
  PressureEngine,
  createFluidSimulationRequest,
  createPressureSimulationRequest,
} from '@physicsos/engine-fluid'
import { ThermalEngine, createThermalSimulationRequest } from '@physicsos/engine-thermal'
import { ThermometerEngine, createThermometerSimulationRequest } from '@physicsos/engine-thermal'
import { LeverEngine, createLeverSimulationRequest } from '@physicsos/engine-lever'
import { InductionEngine, createInductionSimulationRequest } from '@physicsos/engine-induction'
import { TransformerEngine, createTransformerSimulationRequest } from '@physicsos/engine-induction'
import { WaveEngine, createWaveSimulationRequest } from '@physicsos/engine-wave'
import { ModernPhysicsEngine, createModernSimulationRequest } from '@physicsos/engine-modern'
import { assertSimulationPlan, check, summarizeVerification } from '@physicsos/physics-core'

type AnyEngine = PhysicsEngine<PhysicsScene, PhysicsEventLike>
type RequestBuilder = (
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
) => SimulationRequest

export interface EngineEntry {
  readonly engine: AnyEngine
  readonly createRequest: RequestBuilder
}

const entry = (engine: unknown, createRequest: unknown): EngineEntry => ({
  engine: engine as AnyEngine,
  createRequest: createRequest as RequestBuilder,
})

/**
 * Order matters only where two engines could both accept: the composite engine
 * must be asked before the single-field engines (it models E and B together),
 * and the bounded electric engine before the unbounded one. Every other pair is
 * disjoint by apparatus.
 */
export const ENGINES: readonly EngineEntry[] = [
  entry(new CompositeEngine(), createCompositeSimulationRequest),
  entry(new ElectricRegionEngine(), createElectricRegionSimulationRequest),
  entry(new ElectricEngine(), createElectricSimulationRequest),
  entry(new MagneticEngine(), createMagneticSimulationRequest),
  /* The current-magnetic rigs are the second magnetic model: disjoint from the
     Lorentz solver by apparatus (a bench instead of a particle), so the order
     between the two is not load-bearing. */
  entry(new CurrentFieldEngine(), createCurrentSimulationRequest),
  entry(new MechanicsEngine(), createMechanicsSimulationRequest),
  /* The energy ledger is the mechanics domain's second bench: a cart on a ramp
     with no bodies and no fields, so it is disjoint from the solver above by
     apparatus and the order between them is not load-bearing. */
  entry(new EnergyEngine(), createEnergySimulationRequest),
  entry(new CollisionEngine(), createCollisionSimulationRequest),
  entry(new LeverEngine(), createLeverSimulationRequest),
  entry(new CircuitEngine(), createCircuitSimulationRequest),
  entry(new OpticsEngine(), createOpticsSimulationRequest),
  /* The pinhole rig is the optics domain's second bench, disjoint from the
     imaging bench above it by apparatus (no lens, no mirror, no screen). */
  entry(new LightEngine(), createLightSimulationRequest),
  entry(new AcousticsEngine(), createAcousticsSimulationRequest),
  /* The noise rig is the acoustics domain's second bench: a level calculation
     rather than an echo, disjoint by apparatus. */
  entry(new NoiseEngine(), createNoiseSimulationRequest),
  entry(new FluidEngine(), createFluidSimulationRequest),
  entry(new PressureEngine(), createPressureSimulationRequest),
  entry(new ThermalEngine(), createThermalSimulationRequest),
  /* The thermometer is the thermal domain's second bench: it models the
     INSTRUMENT (bulb, bore, fixed points) rather than a sample being heated. */
  entry(new ThermometerEngine(), createThermometerSimulationRequest),
  entry(new InductionEngine(), createInductionSimulationRequest),
  /* The transformer is the induction domain's second bench, disjoint from the
     motional-EMF rigs above by apparatus (no moving rod, no flux rate to state). */
  entry(new TransformerEngine(), createTransformerSimulationRequest),
  entry(new WaveEngine(), createWaveSimulationRequest),
  entry(new ModernPhysicsEngine(), createModernSimulationRequest),
]

/** The engine that accepts the scene, with the conditions the others failed on when none does. */
export const pickEngine = (
  scene: PhysicsScene,
): { entry: EngineEntry } | { entry: undefined; reasons: readonly string[] } => {
  const reasons: string[] = []
  for (const candidate of ENGINES) {
    const support = candidate.engine.canHandle(scene)
    if (support.supported) return { entry: candidate }
    reasons.push(
      `${candidate.engine.engineId}: ${support.failedConditions.map((failure) => failure.condition).join(', ')}`,
    )
  }
  return { entry: undefined, reasons }
}

/**
 * The teaching domain a scene belongs to, as the Lab shelves it. Engines report
 * the physics they model (`PhysicsDomainId`), which is broader than the shelf in
 * two places: the echo range says `wave` but is taught as acoustics, and both
 * the buoyancy tank and the pressure rigs say `mechanics` but are taught as
 * fluid statics. Everything else coincides.
 */
export const domainOfEngine = (engine: AnyEngine): string => {
  switch (engine.engineId) {
    case 'engine-acoustics':
      return 'acoustics'
    case 'engine-fluid':
    case 'engine-pressure':
      return 'fluid'
    default:
      return engine.domain
  }
}

export interface SimulatedScene {
  readonly engineId: string
  readonly domain: string
  /** The exact request passed to the selected engine, including the accepted options. */
  readonly request: SimulationRequest
  readonly simulation: SimulationResult<PhysicsEventLike>
}

const recordOf = (value: unknown, path: string): Record<string, unknown> => {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new PhysicsOSError('INVALID_SIMULATION_REQUEST', `${path} must be a plain object.`)
  }
  return value as Record<string, unknown>
}

const exactKeys = (value: Record<string, unknown>, allowed: readonly string[], path: string): void => {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) {
      throw new PhysicsOSError('INVALID_SIMULATION_REQUEST', `${path} contains an unknown property.`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor?.get !== undefined || descriptor?.set !== undefined || descriptor?.enumerable !== true) {
      throw new PhysicsOSError('INVALID_SIMULATION_REQUEST', `${path}.${key} must be an enumerable data property.`)
    }
  }
}

const nonemptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const revisionValid = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const timeOption = (value: unknown, path: string, positive: boolean): number => {
  const input = recordOf(value, path)
  exactKeys(input, ['value', 'unit', 'dimension'], path)
  if (typeof input.value !== 'number' || typeof input.unit !== 'string' || input.dimension !== 'time') {
    throw new PhysicsOSError('INVALID_SIMULATION_OPTIONS', `${path} must be a time Quantity.`)
  }
  const seconds = canonicalValue(validateQuantity(input as unknown as Quantity, 'time'))
  if (positive ? seconds <= 0 : seconds < 0) {
    throw new PhysicsOSError('INVALID_SIMULATION_OPTIONS', `${path} must be ${positive ? 'positive' : 'non-negative'}.`)
  }
  return seconds
}

const validateOptions = (options: unknown): void => {
  const value = recordOf(options, 'request.options')
  exactKeys(value, ['startTime', 'endTime', 'timeStep', 'outputSampleRate', 'solver', 'tolerance', 'maxIterations', 'randomSeed'], 'request.options')
  const start = value.startTime === undefined ? 0 : timeOption(value.startTime, 'request.options.startTime', false)
  const end = value.endTime === undefined ? undefined : timeOption(value.endTime, 'request.options.endTime', false)
  if (end !== undefined && end < start) {
    throw new PhysicsOSError('INVALID_SIMULATION_RANGE', 'Simulation endTime cannot precede startTime.')
  }
  if (value.timeStep !== undefined) timeOption(value.timeStep, 'request.options.timeStep', true)
  if (value.outputSampleRate !== undefined && (typeof value.outputSampleRate !== 'number' || !Number.isFinite(value.outputSampleRate) || value.outputSampleRate <= 0)) {
    throw new PhysicsOSError('INVALID_SIMULATION_OPTIONS', 'outputSampleRate must be a finite positive number.')
  }
  if (value.solver !== undefined && !nonemptyString(value.solver)) {
    throw new PhysicsOSError('INVALID_SIMULATION_OPTIONS', 'solver must be a non-empty string.')
  }
  if (value.tolerance !== undefined) {
    const tolerance = recordOf(value.tolerance, 'request.options.tolerance')
    exactKeys(tolerance, ['absolute', 'relative'], 'request.options.tolerance')
    for (const key of ['absolute', 'relative']) {
      const component = tolerance[key]
      if (typeof component !== 'number' || !Number.isFinite(component) || component < 0) {
        throw new PhysicsOSError('INVALID_SIMULATION_OPTIONS', `tolerance.${key} must be finite and non-negative.`)
      }
    }
  }
  if (value.maxIterations !== undefined && (typeof value.maxIterations !== 'number' || !Number.isSafeInteger(value.maxIterations) || value.maxIterations < 1)) {
    throw new PhysicsOSError('INVALID_SIMULATION_OPTIONS', 'maxIterations must be a positive safe integer.')
  }
  if (value.randomSeed !== undefined && (typeof value.randomSeed !== 'number' || !Number.isSafeInteger(value.randomSeed))) {
    throw new PhysicsOSError('INVALID_SIMULATION_OPTIONS', 'randomSeed must be a safe integer.')
  }
}

const TRACE_KEYS = ['traceId', 'userId', 'sessionId', 'runId', 'turnId', 'toolCallId', 'sceneId', 'sceneRevision', 'physicsEventId'] as const

const validateRequest = (scene: PhysicsScene, selected: EngineEntry, input: unknown): void => {
  const request = recordOf(input, 'request')
  exactKeys(request, ['schemaVersion', 'simulationId', 'sceneId', 'sceneRevision', 'requestedDomain', 'options', 'trace'], 'request')
  if (request.schemaVersion !== 'simulation-request/1.0' || !nonemptyString(request.simulationId)) {
    throw new PhysicsOSError('INVALID_SIMULATION_REQUEST', 'SimulationRequest needs its supported schema and a non-empty simulationId.')
  }
  if (!nonemptyString(scene.id) || !revisionValid(scene.revision) || !nonemptyString(request.sceneId) || !revisionValid(request.sceneRevision) || request.sceneId !== scene.id || request.sceneRevision !== scene.revision) {
    throw new PhysicsOSError('SIMULATION_SCENE_MISMATCH', 'SimulationRequest must reference the exact legal PhysicsScene identity and revision.')
  }
  // Engine domains are physics domains, not teaching shelves (echo is wave; fluid statics is mechanics).
  if (request.requestedDomain !== undefined && request.requestedDomain !== selected.engine.domain) {
    throw new PhysicsOSError('SIMULATION_DOMAIN_MISMATCH', 'requestedDomain does not match the selected engine physics domain.')
  }
  const trace = recordOf(request.trace, 'request.trace')
  exactKeys(trace, TRACE_KEYS, 'request.trace')
  if (!nonemptyString(trace.traceId)) {
    throw new PhysicsOSError('INVALID_SIMULATION_REQUEST', 'SimulationRequest traceId must be a non-empty string.')
  }
  for (const key of TRACE_KEYS) {
    if (key === 'sceneRevision') continue
    if (trace[key] !== undefined && !nonemptyString(trace[key])) {
      throw new PhysicsOSError('INVALID_SIMULATION_REQUEST', `SimulationRequest trace.${key} must be a non-empty string.`)
    }
  }
  if ((trace.sceneId !== undefined && trace.sceneId !== scene.id) || (trace.sceneRevision !== undefined && (!revisionValid(trace.sceneRevision) || trace.sceneRevision !== scene.revision))) {
    throw new PhysicsOSError('SIMULATION_TRACE_MISMATCH', 'SimulationRequest trace must conform to its scene identity and revision when present.')
  }
  validateOptions(request.options)
}

const CHECK_TYPES = new Set(['schema', 'dimension', 'symbolic', 'numerical', 'constraint', 'conservation', 'boundary', 'trajectory', 'continuity', 'semantic'])

const plainData = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  return Reflect.ownKeys(value).every(key => {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable
  })
}

const plainTree = (value: unknown, ancestors = new Set<object>(), depth = 0): boolean => {
  if (depth > 512) return false
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return true
  if (typeof value !== 'object' || ancestors.has(value)) return false
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return Object.getPrototypeOf(value) === Array.prototype &&
        Reflect.ownKeys(value).every(key => key === 'length' || (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length)) &&
        Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index))).every(
          descriptor => descriptor !== undefined && 'value' in descriptor && descriptor.enumerable && plainTree(descriptor.value, ancestors, depth + 1),
        )
    }
    if (!plainData(value)) return false
    return Object.values(value).every(child => plainTree(child, ancestors, depth + 1))
  } finally {
    ancestors.delete(value)
  }
}

const scalarShape = (value: unknown): boolean => plainData(value) &&
  typeof value.value === 'number' &&
  typeof value.unit === 'string' && typeof value.dimension === 'string'

const vectorShape = (value: unknown): boolean => plainData(value) &&
  typeof value.unit === 'string' && typeof value.dimension === 'string' &&
  plainData(value.vector) && ['x', 'y', 'z'].every(key => {
    const components = value.vector as Record<string, unknown>
    return typeof components[key] === 'number'
  })

const derivedShape = (value: unknown): boolean => plainData(value) && typeof value.key === 'string' &&
  (scalarShape(value.value) || vectorShape(value.value))

const stateShape = (value: unknown): boolean => plainData(value) && scalarShape(value.time) &&
  Array.isArray(value.objects) && value.objects.every(object => plainData(object) && nonemptyString(object.id) &&
    ['position', 'velocity', 'acceleration'].every(key => object[key] === undefined || vectorShape(object[key])) &&
    (object.values === undefined || (plainData(object.values) && Object.values(object.values).every(item => scalarShape(item) || vectorShape(item))))) &&
  Array.isArray(value.derived) && value.derived.every(derivedShape)

const traceShape = (value: unknown): boolean => plainData(value) && nonemptyString(value.traceId) &&
  TRACE_KEYS.every(key => value[key] === undefined || (key === 'sceneRevision' ? revisionValid(value[key]) : nonemptyString(value[key])))

const resultShapeValid = (value: unknown): value is SimulationResult => {
  if (!plainData(value)) return false
  const verification = value.verification
  const metadata = value.metadata
  return typeof value.schemaVersion === 'string' && nonemptyString(value.simulationId) &&
    nonemptyString(value.sceneId) && revisionValid(value.sceneRevision) &&
    Array.isArray(value.states) && value.states.every(stateShape) &&
    Array.isArray(value.events) && value.events.every(event => plainData(event) && nonemptyString(event.eventId) && nonemptyString(event.sceneId) && revisionValid(event.revision) && typeof event.type === 'string') &&
    Array.isArray(value.measurements) && value.measurements.every(measurement => plainData(measurement) &&
      nonemptyString(measurement.id) && (measurement.definitionId === undefined || nonemptyString(measurement.definitionId)) &&
      (scalarShape(measurement.value) || vectorShape(measurement.value))) &&
    Array.isArray(value.derivedQuantities) && value.derivedQuantities.every(derivedShape) &&
    plainData(verification) && typeof verification.status === 'string' && ['passed', 'passed_with_warnings', 'failed'].includes(verification.status) &&
    Array.isArray(verification.checks) && verification.checks.every(entry => plainData(entry) &&
      nonemptyString(entry.id) && typeof entry.type === 'string' && CHECK_TYPES.has(entry.type) && typeof entry.passed === 'boolean') &&
    ['warnings', 'errors'].every(key => Array.isArray(verification[key]) && verification[key].every(issue =>
      plainData(issue) && nonemptyString(issue.code) && typeof issue.message === 'string' && issue.severity === (key === 'warnings' ? 'warning' : 'error'))) &&
    plainData(metadata) && nonemptyString(metadata.engineId) && nonemptyString(metadata.engineVersion) &&
    typeof metadata.startedAt === 'string' && typeof metadata.finishedAt === 'string' &&
    typeof metadata.durationMs === 'number' && metadata.durationMs >= 0 && typeof metadata.deterministic === 'boolean' &&
    traceShape(value.trace) && plainTree(value)
}

function assertResultShape(scene: PhysicsScene, selected: EngineEntry, request: SimulationRequest, value: unknown): asserts value is SimulationResult {
  if (!resultShapeValid(value)) {
    throw new PhysicsOSError('INVALID_SIMULATION_RESULT', 'The engine returned a malformed SimulationResult; it cannot be verified.', {
      details: { rawResult: value, sceneId: scene.id, sceneRevision: scene.revision, simulationId: request.simulationId, engineId: selected.engine.engineId },
    })
  }
}

const hasNonFiniteNumber = (value: unknown): boolean => {
  if (typeof value === 'number') return !Number.isFinite(value)
  if (value === null || typeof value !== 'object') return false
  return Object.values(value).some(hasNonFiniteNumber)
}

const resultContractChecks = (scene: PhysicsScene, selected: EngineEntry, request: SimulationRequest, result: SimulationResult): VerificationCheck[] => {
  const trace = result.trace
  const conditions = [
    ['simulation_result_schema', result.schemaVersion === 'simulation-result/1.0'],
    ['simulation_result_identity', result.simulationId === request.simulationId && result.sceneId === scene.id && result.sceneRevision === scene.revision],
    ['simulation_result_trace', trace !== undefined && trace !== null && trace.traceId === request.trace.traceId && (trace.sceneId === undefined || trace.sceneId === scene.id) && (trace.sceneRevision === undefined || trace.sceneRevision === scene.revision) && TRACE_KEYS.every(key => trace[key] === undefined || request.trace[key] === undefined || trace[key] === request.trace[key])],
    ['simulation_result_engine', result.metadata?.engineId === selected.engine.engineId && result.metadata.engineVersion === selected.engine.engineVersion],
  ] as const
  // Contract failures are schema evidence, never numerical proof or a replacement for engine checks.
  return conditions.filter(([, passed]) => !passed).map(([id]) => check(id, 'schema', false, {
    message: 'SimulationResult does not conform to the scene, request, trace or selected engine.',
    details: { sceneId: scene.id, sceneRevision: scene.revision, simulationId: request.simulationId, engineId: selected.engine.engineId },
  }))
}

/** Exact engine-owned preflight bounds for an unchanged, legal request; never computes a result. */
export const getSimulationPlan = (scene: PhysicsScene, selected: EngineEntry, request: SimulationRequest): SimulationPlan => {
  validateRequest(scene, selected, request)
  const prepare = selected.engine.prepareSimulationPlan
  if (prepare === undefined) {
    throw new PhysicsOSError('SIMULATION_PLAN_UNAVAILABLE', 'The selected engine does not expose execution bounds.')
  }
  const plan = prepare.call(selected.engine, scene, request)
  if (!plainData(plan)) {
    throw new PhysicsOSError('INVALID_SIMULATION_PLAN', 'An engine plan must be a plain data object.')
  }
  assertSimulationPlan(plan)
  const requestedStart = request.options.startTime === undefined ? 0 : canonicalValue(request.options.startTime)
  const requestedEnd = request.options.endTime === undefined ? undefined : canonicalValue(request.options.endTime)
  if (
    plan.startTime !== requestedStart || (requestedEnd !== undefined && plan.endTime !== requestedEnd) ||
    (plan.endTimeExact === false && (requestedEnd !== undefined || plan.kind !== 'iterative')) ||
    plan.engineId !== selected.engine.engineId || plan.engineVersion !== selected.engine.engineVersion ||
    plan.sceneId !== scene.id || plan.sceneRevision !== scene.revision || plan.simulationId !== request.simulationId ||
    !['static', 'analytic', 'iterative'].includes(plan.kind) ||
    (plan.modelId !== undefined && !nonemptyString(plan.modelId))
  ) {
    throw new PhysicsOSError('SIMULATION_PLAN_MISMATCH', 'The engine plan must match the exact selected engine, scene and request identities.')
  }
  return plan
}

/**
 * Shared simulation and verification path for questions and model-facing tools.
 * Independent mechanics/magnetic checks supplement engine checks; an existing
 * failed engine verdict can never be erased by a successful external verifier.
 */
export function simulateScene(
  scene: PhysicsScene,
  entryFor: EngineEntry,
  simulationId: string,
  traceId: string,
  options?: SimulationOptions,
): SimulatedScene
export function simulateScene(
  scene: PhysicsScene,
  entryFor: EngineEntry,
  request: SimulationRequest,
): SimulatedScene
export function simulateScene(
  scene: PhysicsScene,
  entryFor: EngineEntry,
  simulationIdOrRequest: string | SimulationRequest,
  traceId?: string,
  options?: SimulationOptions,
): SimulatedScene {
  let request: SimulationRequest
  if (typeof simulationIdOrRequest === 'string') {
    if (!nonemptyString(traceId)) throw new PhysicsOSError('INVALID_SIMULATION_REQUEST', 'A non-empty traceId is required.')
    request = entryFor.createRequest(scene, simulationIdOrRequest, traceId)
    if (options !== undefined) {
      validateOptions(options)
      request = { ...request, options: { ...request.options, ...options } }
    }
  } else {
    if (traceId !== undefined || options !== undefined) {
      throw new PhysicsOSError('INVALID_SIMULATION_REQUEST', 'A supplied SimulationRequest cannot be combined with extra request arguments.')
    }
    request = simulationIdOrRequest
  }
  validateRequest(scene, entryFor, request)
  let simulation = entryFor.engine.simulate(scene, request)
  assertResultShape(scene, entryFor, request, simulation)
  const contractChecks = resultContractChecks(scene, entryFor, request, simulation)
  if (hasNonFiniteNumber(simulation)) {
    contractChecks.push(check('simulation_result_finite', 'schema', false, { message: 'SimulationResult contains non-finite numeric evidence and cannot be accepted as valid.' }))
  }
  const verdictHasFailures = simulation.verification.checks.some(entry => !entry.passed) || simulation.verification.errors.length > 0
  if (verdictHasFailures && simulation.verification.status !== 'failed') {
    contractChecks.push(check('simulation_result_verdict', 'schema', false, { message: 'SimulationResult status contradicts its failed checks or errors.' }))
  }
  if (contractChecks.length > 0) {
    // Keep the returned states and failed evidence inspectable, but never verify a mismatched result.
    simulation = {
      ...simulation,
      verification: summarizeVerification(
        [...simulation.verification.checks, ...contractChecks],
        simulation.verification.warnings,
        simulation.verification.errors,
      ),
    }
  }
  if (
    entryFor.engine.engineId === 'engine-magnetic' ||
    entryFor.engine.engineId === 'engine-mechanics'
  ) {
    const independent =
      entryFor.engine.engineId === 'engine-magnetic'
        ? verifyMagneticScene(scene, simulation, { request })
        : verifyMechanicsSimulation(scene, simulation)
    simulation = {
      ...simulation,
      verification: summarizeVerification(
        [
          ...simulation.verification.checks,
          ...independent.checks,
          ...(simulation.verification.status === 'failed' ? [check('engine_verification', 'schema', false)] : []),
          ...(independent.status === 'failed' ? [check('independent_verification', 'schema', false)] : []),
        ],
        [...simulation.verification.warnings, ...independent.warnings],
        [...simulation.verification.errors, ...independent.errors],
      ),
    }
  }
  return { engineId: entryFor.engine.engineId, domain: domainOfEngine(entryFor.engine), request, simulation }
}

/** Question parsing deliberately exposes fewer models than the exploratory Lab. */
const QUESTION_MODELS: Readonly<Record<string, { domain?: string; models?: readonly string[] }>> = {
  'engine-composite': {
    models: [
      'velocity_selector',
      'mass_spectrometer',
      'cyclotron',
      'charged_particle_composite_field',
    ],
  },
  'engine-electric-region': {
    domain: 'electric',
    models: ['charged_particle_bounded_electric_field'],
  },
  'engine-electric': {
    domain: 'electric',
    models: ['charged_particle_uniform_electric_field', 'point_charge_electrostatic_field'],
  },
  'engine-magnetic': { domain: 'magnetic', models: ['charged_particle_uniform_magnetic_field'] },
  'engine-mechanics': {
    domain: 'mechanics',
    models: [
      'uniform_linear_motion',
      'uniformly_accelerated_motion',
      'projectile_motion',
      'newton_second_law',
      'inclined_plane',
      'spring_oscillator',
      'spring_statics',
      'simple_pendulum',
      'horizontal_friction',
      'circular_orbit',
    ],
  },
  'engine-collision': { domain: 'mechanics', models: ['one_dimensional_collision'] },
  'engine-optics': { domain: 'optics' },
  'engine-circuit': { domain: 'circuit', models: ['dc_steady_state_mna'] },
  'engine-induction': { domain: 'induction', models: ['bar_motion_emf', 'flux_change_emf'] },
  'engine-wave': {
    domain: 'wave',
    models: [
      'travelling_wave',
      'wave_interference',
      'standing_wave',
      'longitudinal_wave',
      'reflection_refraction',
      'wave_diffraction',
      'wave_doppler',
    ],
  },
  'engine-modern': { domain: 'modern_physics', models: ['photoelectric_effect'] },
}

export interface EngineCapability extends EngineEntry {
  readonly engineId: string
  readonly domain: string
  readonly verification: 'engine' | 'magnetic-independent' | 'mechanics-independent'
  readonly supportsQuestion: (domain: string, model: string) => boolean
}

/** One inventory for engine, request, verification and advertised question support. */
export const ENGINE_CAPABILITIES: readonly EngineCapability[] = ENGINES.map((candidate) => {
  const engineId = candidate.engine.engineId
  const question = QUESTION_MODELS[engineId]
  return {
    ...candidate,
    engineId,
    domain: domainOfEngine(candidate.engine),
    verification:
      engineId === 'engine-magnetic'
        ? 'magnetic-independent'
        : engineId === 'engine-mechanics'
          ? 'mechanics-independent'
          : 'engine',
    supportsQuestion: (domain, model) =>
      question !== undefined &&
      (question.domain === undefined || question.domain === domain) &&
      (question.models === undefined || question.models.includes(model)),
  }
})

export const questionEngine = (domain: string, model: string): EngineCapability | undefined =>
  ENGINE_CAPABILITIES.find((capability) => capability.supportsQuestion(domain, model))
