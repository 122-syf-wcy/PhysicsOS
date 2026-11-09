/** Server-only numerical replay of an authorized immutable capture, never a replacement for saved client data. */
import type { SimulationPlan, SimulationRequest, SimulationResult, SimulationState } from '@physicsos/physics-core'
import { ENGINES, getSimulationPlan, simulateScene } from '@physicsos/physics-runtime'
import { canonicalValue } from '@physicsos/physics-units'
import { conditionsFromScene, createSnapshotObject, datasetFromSimulationResult } from '@physicsos/physics-workbench/data'
import { jsonObject, jsonValue } from '@physicsos/physics-workbench/json'
import type { CanvasVerificationReceipt } from '@physicsos/physics-workbench/protocol'
import type { DatasetObject, JsonValue, SceneObject, SnapshotObject } from '@physicsos/physics-workbench/types'
import type { CanvasLimits } from './canvas-config.ts'

/** Independent server outcome and exact newly computed raw evidence. */
export interface CanvasVerificationOutcome {
  readonly receipt: CanvasVerificationReceipt
  readonly snapshot?: SnapshotObject
  readonly datasets: readonly DatasetObject[]
}

/** Server-chosen receipt identity and verification timestamp. */
export interface CanvasVerificationInput {
  readonly id: string
  readonly canvasId: string
  readonly captureDigest: string
  readonly sceneDigest: string
  readonly checkedAt: string
}

interface Difference { readonly path: string; readonly reason: string; readonly expected: JsonValue; readonly actual: JsonValue }
const pointer = (path: string, key: string | number): string => `${path}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`
const jsonRecord = (value: JsonValue): value is { readonly [key: string]: JsonValue } => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Stop at the first actual mismatch; acceptance requires every raw field to match. */
function mismatch(expected: JsonValue, actual: JsonValue, limits: CanvasLimits, path = ''): Difference | undefined {
  if (typeof expected === 'number' && typeof actual === 'number') {
    const scale = Math.max(Math.abs(expected), Math.abs(actual))
    const scaledDifference = scale === 0 ? 0 : Math.abs(expected / scale - actual / scale)
    const scaledTolerance = scale === 0 ? limits.absoluteTolerance : limits.absoluteTolerance / scale + limits.relativeTolerance
    return scaledDifference <= scaledTolerance ? undefined : { path, reason: 'numeric-value', expected, actual }
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) return { path, reason: 'array-length', expected: expected.length, actual: actual.length }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = mismatch(expected[index]!, actual[index]!, limits, pointer(path, index))
      if (difference !== undefined) return difference
    }
    return undefined
  }
  if (jsonRecord(expected) && jsonRecord(actual)) {
    const expectedKeys = Object.keys(expected).sort()
    const actualKeys = Object.keys(actual).sort()
    if (expectedKeys.join('\u0000') !== actualKeys.join('\u0000')) {
      return { path, reason: 'field-inventory', expected: expectedKeys, actual: actualKeys }
    }
    for (const key of expectedKeys) {
      const difference = mismatch(expected[key]!, actual[key]!, limits, pointer(path, key))
      if (difference !== undefined) return difference
    }
    return undefined
  }
  return expected === actual ? undefined : { path, reason: 'value-or-type', expected, actual }
}

/** Generated event/measurement identifiers are not readings; all other raw evidence is compared. */
function numericalEvidence(result: SimulationResult): JsonValue {
  return jsonValue({
    sceneId: result.sceneId,
    sceneRevision: result.sceneRevision,
    states: result.states,
    events: result.events.map(({ eventId: _eventId, ...event }) => event),
    measurements: result.measurements.map(({ id: _id, ...measurement }) => measurement),
    derivedQuantities: result.derivedQuantities,
  })
}

function replayBound(request: SimulationRequest, limits: CanvasLimits): string | undefined {
  if (request.options.outputSampleRate !== undefined && request.options.outputSampleRate > limits.maxSimulationSamples) {
    return 'Capture requested sample count exceeds the configured server replay limit.'
  }
  return undefined
}

/**
 * Re-run the real selected engine with the capture's exact accepted request and compare raw values.
 * @param source - Authorized immutable PhysicsScene object.
 * @param capture - Original saved capture; client verification flags are not trusted.
 * @param input - Server-owned receipt identity and association.
 * @param limits - Explicit replay and numerical-comparison bounds.
 * @param signal - Cancellation checked before and after the synchronous engine.
 * @returns Independent receipt and real new evidence; unsupported or failed replay never verifies.
 */
export function verifyCanvasCapture(
  source: SceneObject,
  capture: SnapshotObject,
  input: CanvasVerificationInput,
  limits: CanvasLimits,
  signal: AbortSignal,
): CanvasVerificationOutcome {
  signal.throwIfAborted()
  const base = { ...input, engineId: capture.engine.id, engineVersion: capture.engine.version }
  if (capture.scene.digest !== input.sceneDigest || capture.sceneRevision !== source.scene.revision) {
    return { receipt: { ...base, status: 'rejected', details: { reason: 'Capture does not reference the authorized immutable scene revision.' } }, datasets: [] }
  }
  if (capture.request === undefined) {
    return { receipt: { ...base, status: 'unsupported', details: { reason: 'Capture has no retained accepted SimulationRequest; default options cannot reproduce it.' } }, datasets: [] }
  }
  const bound = replayBound(capture.request, limits)
  if (bound !== undefined) return { receipt: { ...base, status: 'unsupported', details: { reason: bound } }, datasets: [] }
  const selected = ENGINES.find(entry => entry.engine.engineId === capture.engine.id)
  if (selected === undefined) return { receipt: { ...base, status: 'unsupported', details: { reason: 'Saved capture engine is not registered on this server.', capturedEngineId: capture.engine.id, capturedEngineVersion: capture.engine.version } }, datasets: [] }
  const engine = selected.engine
  const serverBase = { ...input, engineId: engine.engineId, engineVersion: engine.engineVersion }
  if (engine.engineVersion !== capture.engine.version) {
    return { receipt: { ...serverBase, status: 'unsupported', details: { reason: 'Saved capture engine or version differs from the server engine.', capturedEngineId: capture.engine.id, capturedEngineVersion: capture.engine.version } }, datasets: [] }
  }
  let plan: SimulationPlan
  try { plan = getSimulationPlan(source.scene, selected, capture.request) } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'ENGINE_PLAN_FAILED'
    return { receipt: { ...serverBase, status: code === 'SIMULATION_PLAN_UNAVAILABLE' ? 'unsupported' : 'error', details: { code, message: error instanceof Error ? error.message : 'Engine preflight failed.' } }, datasets: [] }
  }
  if (plan.endTime - plan.startTime > limits.maxSimulationDurationSeconds || plan.storageSampleCountBound > limits.maxSimulationSamples || plan.numericalIterationCountBound > limits.maxSimulationIterations) {
    return { receipt: { ...serverBase, status: 'unsupported', details: jsonObject({ reason: 'The engine\'s execution bounds exceed server replay policy.', plan, maxDurationSeconds: limits.maxSimulationDurationSeconds, maxSamples: limits.maxSimulationSamples, maxIterations: limits.maxSimulationIterations }) }, datasets: [] }
  }
  let result: SimulationResult
  let accepted: SimulationRequest
  try {
    const support = engine.canHandle(source.scene)
    if (!support.supported) return { receipt: { ...serverBase, status: 'unsupported', details: jsonObject({ reason: 'Saved capture engine does not support its authorized immutable scene.', failedConditions: support.failedConditions }) }, datasets: [] }
    const replay = simulateScene(source.scene, selected, capture.request)
    result = replay.simulation
    accepted = replay.request
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'ENGINE_REPLAY_FAILED'
    return { receipt: { ...serverBase, status: 'error', details: { code, message: error instanceof Error ? error.message : 'Engine replay failed.' } }, datasets: [] }
  }
  signal.throwIfAborted()
  if (result.states.length + result.measurements.length + result.derivedQuantities.length > limits.maxSimulationSamples) {
    return { receipt: { ...serverBase, status: 'rejected', details: { reason: 'Actual server replay exceeds its configured complete sample limit.' } }, datasets: [] }
  }
  let heldState: SimulationState | undefined
  if (capture.capturedState !== undefined) {
    const heldTime = canonicalValue(capture.capturedState.time)
    heldState = result.states.find(state => canonicalValue(state.time) === heldTime)
  }
  const inPlan = (time: number): boolean => Number.isFinite(time) && time >= plan.startTime && time <= plan.endTime
  const planRejected = result.states.length > plan.storageSampleCountBound
    || result.states.some(state => !inPlan(canonicalValue(state.time)))
    || result.events.some(event => event.time !== undefined && !inPlan(event.time))
    || result.measurements.some(measurement => measurement.time !== undefined && !inPlan(canonicalValue(measurement.time)))
  let difference: Difference | undefined
  let verifiedSubject: string
  if (capture.result !== undefined) {
    difference = mismatch(numericalEvidence(capture.result), numericalEvidence(result), limits)
    verifiedSubject = 'complete-simulation-raw-evidence'
  } else if (capture.capturedState !== undefined && heldState !== undefined) {
    difference = mismatch(jsonValue(capture.capturedState), jsonValue(heldState), limits)
    verifiedSubject = 'exact-captured-state-only'
  } else {
    return { receipt: { ...serverBase, status: 'unsupported', details: { reason: 'Capture retains no replay-comparable raw result or exact sampled state. Raw presentation state is not engine evidence.' } }, datasets: [] }
  }
  if (capture.capturedState !== undefined) {
    if (heldState === undefined) {
      difference = { path: '/capturedState/time', reason: 'exact-captured-instant-missing', expected: jsonValue(capture.capturedState.time), actual: null }
    } else {
      difference ??= mismatch(jsonValue(capture.capturedState), jsonValue(heldState), limits, '/capturedState')
    }
  }
  const engineRejected = result.verification.status === 'failed' || result.verification.errors.length > 0 || result.verification.checks.some(check => !check.passed)
  const hasEngineEvidence = result.verification.checks.some(check => check.passed && ['numerical', 'symbolic', 'constraint', 'conservation', 'boundary', 'trajectory', 'continuity'].includes(check.type))
  const status = engineRejected || planRejected || difference !== undefined ? 'rejected' : hasEngineEvidence ? 'verified' : 'unsupported'
  const receipt: CanvasVerificationReceipt = {
    ...serverBase, status,
    details: jsonObject({
      subject: verifiedSubject,
      unverifiedComponents: ['client-analysis-datasets', 'client-raw-presentation-state', 'client-diagnostics'],
      plan,
      actualResultWithinPlan: !planRejected,
      engineVerification: result.verification,
      physicalEvidenceSupported: hasEngineEvidence,
      comparedStates: capture.result?.states.length ?? (capture.capturedState === undefined ? 0 : 1),
      absoluteTolerance: limits.absoluteTolerance,
      relativeTolerance: limits.relativeTolerance,
      sampling: {
        requestedCursor: capture.cursor,
        actualStoredStateTime: capture.capturedState?.time ?? null,
        replayStoredStateTime: heldState?.time ?? null,
      },
      ...(difference === undefined ? {} : { mismatch: difference }),
    }),
  }
  const sourceRef = { kind: 'scene' as const, digest: input.sceneDigest }
  const datasets = datasetFromSimulationResult(result, { sourceScene: sourceRef, conditions: conditionsFromScene(source.scene) })
  const snapshot = createSnapshotObject({
    scene: source.scene, sceneRef: sourceRef, instanceId: capture.instanceId,
    instanceEditRevision: capture.instanceEditRevision, capturedAt: input.checkedAt,
    source: 'server-engine', engineInfo: { id: engine.engineId, version: engine.engineVersion },
    request: accepted, result, clock: capture.clock, cursor: capture.cursor,
    datasets: [], diagnostics: [jsonObject({ originalCaptureDigest: input.captureDigest, receiptId: input.id, receiptStatus: status })],
    ...(heldState === undefined ? {} : { state: heldState }),
    metadata: { originalCaptureDigest: input.captureDigest, verificationReceiptId: input.id },
  })
  return { receipt, snapshot, datasets }
}
