import { describe, expect, it } from 'vitest'
import type { DerivedQuantity, PhysicsEventLike, QuantityVector, SimulationResult } from '@physicsos/physics-core'
import { quantity, registeredUnits, type Quantity } from '@physicsos/physics-units'
import { asPhysicsEventId, asTraceId, asUserId } from '@physicsos/shared'

import { jsonObject, jsonValue, record, WorkbenchDataError } from '../src/json.ts'
import {
  readQuantity,
  readQuantityVector,
  readRendererRelease,
  readScalarOrVector,
  readSimulationRequest,
  readSimulationResult,
  readSimulationState,
} from '../src/simulation-codec.ts'
import {
  simulationEventFixture,
  simulationRequestFixture,
  simulationResultFixture,
  simulationStateFixture,
  simulationTraceFixture,
} from './simulation-fixtures.ts'

type Reader = (input: unknown, path: string) => unknown

const present = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('Fixture entry is missing.')
  return value
}
const wireObject = (value: unknown): Record<string, unknown> => ({ ...jsonObject(value) })
const expectIssue = (
  reader: Reader,
  input: unknown,
  expectedPath: string,
  path = '/wire',
): WorkbenchDataError => {
  try {
    reader(input, path)
  } catch (error) {
    expect(error).toBeInstanceOf(WorkbenchDataError)
    if (!(error instanceof WorkbenchDataError)) throw error
    expect(error.issues[0]?.path).toBe(expectedPath)
    return error
  }
  throw new Error('Expected the unknown-input reader to reject this value.')
}

const releaseFixture = () => ({
  kind: 'community',
  id: 'release-fixture',
  experimentId: 'experiment-fixture',
  version: '2.1.0',
  sha256: 'a'.repeat(64),
})

describe('quantity wire readers', () => {
  it('accepts every registered symbol, key and alias without rewriting the raw value or unit', () => {
    for (const definition of registeredUnits()) {
      for (const unit of [definition.symbol, definition.key, ...definition.aliases]) {
        const scalar: Quantity = { value: 0.12345678901234568, unit, dimension: definition.dimension }
        const vector: QuantityVector = {
          vector: { x: 0.12345678901234568, y: -2.5, z: 0 },
          unit,
          dimension: definition.dimension,
        }
        expect(readQuantity(scalar, '/quantity')).toEqual(scalar)
        expect(readQuantityVector(vector, '/vector')).toEqual(vector)
        expect(readScalarOrVector(scalar, '/value')).toEqual(scalar)
        expect(readScalarOrVector(vector, '/value')).toEqual(vector)
      }
    }
  })

  it('returns dimension-specific types when the expected dimension is supplied', () => {
    const scalar: Quantity<'time'> = readQuantity({ value: 250, unit: 'ms', dimension: 'time' }, '/quantity', 'time')
    const vector: QuantityVector<'length'> = readQuantityVector({
      vector: { x: 100, y: 20, z: 0 }, unit: 'cm', dimension: 'length',
    }, '/vector', 'length')
    const either: Quantity<'time'> | QuantityVector<'time'> = readScalarOrVector(scalar, '/value', 'time')
    expect(scalar).toEqual({ value: 250, unit: 'ms', dimension: 'time' })
    expect(vector.vector.x).toBe(100)
    expect(either).toEqual(scalar)
  })

  it('preserves empty dimensionless symbols and Unicode aliases', () => {
    expect(readQuantity({ value: 0.5, unit: '', dimension: 'dimensionless' }, '/quantity').unit).toBe('')
    expect(readQuantity({ value: 5, unit: 'Ω', dimension: 'resistance' }, '/quantity').unit).toBe('Ω')
    expect(readQuantity({ value: 5, unit: ' cm ', dimension: 'length' }, '/quantity').unit).toBe(' cm ')
  })

  it('detaches scalar and vector input without freezing or mutating caller data', () => {
    const scalar: Quantity = { value: 1.2345678901234567, unit: 'cm', dimension: 'length' }
    const vector: QuantityVector = { vector: { x: 1, y: 2, z: 3 }, unit: 'cm', dimension: 'length' }
    const parsedScalar = readQuantity(scalar, '/quantity')
    const parsedVector = readQuantityVector(vector, '/vector')
    const parsedEither = readScalarOrVector(vector, '/value')
    expect(parsedScalar).not.toBe(scalar)
    expect(parsedVector.vector).not.toBe(vector.vector)
    scalar.value = 90
    vector.vector.x = 90
    expect(parsedScalar.value).toBe(1.2345678901234567)
    expect(parsedVector.vector.x).toBe(1)
    expect(jsonValue(parsedEither)).toEqual({ vector: { x: 1, y: 2, z: 3 }, unit: 'cm', dimension: 'length' })
    expect(Object.isFrozen(scalar)).toBe(false)
    expect(Object.isFrozen(vector.vector)).toBe(false)
  })

  const scalarCases: readonly { name: string; input: unknown; field: string }[] = [
    { name: 'unknown unit', input: { value: 1, unit: 'furlong?', dimension: 'length' }, field: 'unit' },
    { name: 'unknown dimension', input: { value: 1, unit: 'm', dimension: 'distance' }, field: 'dimension' },
    { name: 'dimension/unit disagreement', input: { value: 1, unit: 'T', dimension: 'length' }, field: 'dimension' },
    { name: 'nonfinite positive value', input: { value: Infinity, unit: 'm', dimension: 'length' }, field: 'value' },
    { name: 'nonfinite negative value', input: { value: -Infinity, unit: 'm', dimension: 'length' }, field: 'value' },
    { name: 'NaN value', input: { value: NaN, unit: 'm', dimension: 'length' }, field: 'value' },
    { name: 'numeric string', input: { value: '1', unit: 'm', dimension: 'length' }, field: 'value' },
    { name: 'missing value', input: { unit: 'm', dimension: 'length' }, field: 'value' },
    { name: 'missing unit', input: { value: 1, dimension: 'length' }, field: 'unit' },
    { name: 'missing dimension', input: { value: 1, unit: 'm' }, field: 'dimension' },
    { name: 'extra property', input: { value: 1, unit: 'm', dimension: 'length', formatted: '1 m' }, field: 'formatted' },
    { name: 'SI conversion overflow', input: { value: Number.MAX_VALUE, unit: 'km', dimension: 'length' }, field: 'value' },
  ]
  for (const entry of scalarCases) {
    it(`rejects a scalar with ${entry.name}`, () => {
      expectIssue(readQuantity, entry.input, `/wire/${entry.field}`)
    })
  }

  const vectorCases: readonly { name: string; input: unknown; field: string }[] = [
    { name: 'unknown unit', input: { vector: { x: 0, y: 0, z: 0 }, unit: 'unknown', dimension: 'length' }, field: 'unit' },
    { name: 'unknown dimension', input: { vector: { x: 0, y: 0, z: 0 }, unit: 'm', dimension: 'distance' }, field: 'dimension' },
    { name: 'dimension/unit disagreement', input: { vector: { x: 0, y: 0, z: 0 }, unit: 'T', dimension: 'length' }, field: 'dimension' },
    { name: 'nonfinite component', input: { vector: { x: 0, y: Infinity, z: 0 }, unit: 'm', dimension: 'length' }, field: 'vector/y' },
    { name: 'missing component', input: { vector: { x: 0, y: 0 }, unit: 'm', dimension: 'length' }, field: 'vector/z' },
    { name: 'extra component', input: { vector: { x: 0, y: 0, z: 0, w: 1 }, unit: 'm', dimension: 'length' }, field: 'vector/w' },
    { name: 'array components', input: { vector: [0, 0, 0], unit: 'm', dimension: 'length' }, field: 'vector' },
    { name: 'missing vector', input: { unit: 'm', dimension: 'length' }, field: 'vector' },
    { name: 'SI conversion overflow', input: { vector: { x: Number.MAX_VALUE, y: 0, z: 0 }, unit: 'km', dimension: 'length' }, field: 'vector/x' },
  ]
  for (const entry of vectorCases) {
    it(`rejects a vector with ${entry.name}`, () => {
      expectIssue(readQuantityVector, entry.input, `/wire/${entry.field}`)
    })
  }

  it('rejects quantities of a different expected physical dimension', () => {
    expectIssue((value, at) => readQuantity(value, at, 'time'), { value: 1, unit: 'm', dimension: 'length' }, '/wire/dimension')
    expectIssue((value, at) => readQuantityVector(value, at, 'velocity'), {
      vector: { x: 1, y: 0, z: 0 }, unit: 'm', dimension: 'length',
    }, '/wire/dimension')
    expectIssue((value, at) => readScalarOrVector(value, at, 'force'), { value: 1, unit: 'J', dimension: 'energy' }, '/wire/dimension')
  })

  it('requires exactly one scalar or vector representation', () => {
    expectIssue(readScalarOrVector, { unit: 'm', dimension: 'length' }, '/wire')
    expectIssue(readScalarOrVector, { value: 1, vector: { x: 1, y: 0, z: 0 }, unit: 'm', dimension: 'length' }, '/wire')
  })
})

describe('simulation request wire reader', () => {
  it('reads a complete request from unknown wire data, including every branded trace field', () => {
    const fixture = simulationRequestFixture()
    const input: unknown = jsonValue(fixture)
    expect(readSimulationRequest(input, '/request')).toEqual(fixture)
  })

  it('accepts static requests and preserves absent optionals instead of inventing values', () => {
    const fixture = simulationRequestFixture()
    const input = wireObject(fixture)
    delete input.requestedDomain
    input.options = {}
    input.trace = { traceId: 'trace-minimal' }
    const parsed = readSimulationRequest(input, '/request')
    expect(parsed.options).toEqual({})
    expect(parsed.trace).toEqual({ traceId: 'trace-minimal' })
    expect(Object.hasOwn(parsed, 'requestedDomain')).toBe(false)
    expect(Object.hasOwn(parsed.options, 'endTime')).toBe(false)
  })

  it('accepts an omitted end time after a nonzero static start time', () => {
    const fixture = simulationRequestFixture()
    expect(readSimulationRequest({ ...fixture, options: { startTime: quantity(1, 's', 'time') } }, '/request').options).toEqual({
      startTime: quantity(1, 's', 'time'),
    })
  })

  it('checks start/end ordering in canonical units rather than comparing raw magnitudes', () => {
    const fixture = simulationRequestFixture()
    expectIssue(readSimulationRequest, {
      ...fixture,
      options: { startTime: quantity(2, 's', 'time'), endTime: quantity(500, 'ms', 'time') },
    }, '/wire/options/endTime')
    expect(readSimulationRequest({
      ...fixture,
      options: { startTime: quantity(500, 'ms', 'time'), endTime: quantity(2, 's', 'time') },
    }, '/request').options.startTime?.value).toBe(500)
  })

  it('defensively copies options, tolerance and trace', () => {
    const fixture = simulationRequestFixture()
    const expected = jsonValue(fixture)
    const parsed = readSimulationRequest(fixture, '/request')
    present(fixture.options.startTime).value = 999
    present(fixture.options.tolerance).relative = 0.9
    fixture.trace.traceId = asTraceId('trace-mutated')
    expect(jsonValue(parsed)).toEqual(expected)
    expect(parsed.options).not.toBe(fixture.options)
    expect(parsed.options.tolerance).not.toBe(fixture.options.tolerance)
    expect(parsed.trace).not.toBe(fixture.trace)
  })

  for (const field of ['schemaVersion', 'simulationId', 'sceneId', 'sceneRevision', 'options', 'trace'] as const) {
    it(`requires request ${field}`, () => {
      const input = wireObject(simulationRequestFixture())
      delete input[field]
      expectIssue(readSimulationRequest, input, `/wire/${field}`)
    })
  }

  const badOptions: readonly { field: string; value: unknown; issue: string }[] = [
    { field: 'startTime', value: quantity(1, 'm', 'length'), issue: 'startTime/dimension' },
    { field: 'startTime', value: quantity(-1, 's', 'time'), issue: 'startTime/value' },
    { field: 'endTime', value: quantity(-1, 's', 'time'), issue: 'endTime/value' },
    { field: 'timeStep', value: quantity(0, 's', 'time'), issue: 'timeStep/value' },
    { field: 'timeStep', value: quantity(-1, 's', 'time'), issue: 'timeStep/value' },
    { field: 'timeStep', value: quantity(Number.MIN_VALUE, 'us', 'time'), issue: 'timeStep/value' },
    { field: 'timeStep', value: { value: 1, unit: 'unknown', dimension: 'time' }, issue: 'timeStep/unit' },
    { field: 'outputSampleRate', value: 0, issue: 'outputSampleRate' },
    { field: 'outputSampleRate', value: -1, issue: 'outputSampleRate' },
    { field: 'outputSampleRate', value: Infinity, issue: 'outputSampleRate' },
    { field: 'solver', value: '', issue: 'solver' },
    { field: 'maxIterations', value: 0, issue: 'maxIterations' },
    { field: 'maxIterations', value: 1.5, issue: 'maxIterations' },
    { field: 'randomSeed', value: NaN, issue: 'randomSeed' },
    { field: 'randomSeed', value: 1.5, issue: 'randomSeed' },
    { field: 'tolerance', value: { absolute: -1, relative: 0.1 }, issue: 'tolerance/absolute' },
    { field: 'tolerance', value: { absolute: 0 }, issue: 'tolerance/relative' },
    { field: 'tolerance', value: { absolute: 0, relative: Infinity }, issue: 'tolerance/relative' },
    { field: 'tolerance', value: { absolute: 0, relative: 0, custom: 1 }, issue: 'tolerance/custom' },
    { field: 'unknown', value: true, issue: 'unknown' },
  ]
  for (const entry of badOptions) {
    it(`rejects invalid request option ${entry.issue}`, () => {
      const fixture = simulationRequestFixture()
      expectIssue(readSimulationRequest, { ...fixture, options: { ...fixture.options, [entry.field]: entry.value } }, `/wire/options/${entry.issue}`)
    })
  }

  it('rejects wrong request schema, domain, IDs and revisions', () => {
    const fixture = simulationRequestFixture()
    for (const [field, value] of [
      ['schemaVersion', 'simulation-result/1.0'], ['requestedDomain', 'fluid'],
      ['simulationId', ' '], ['sceneId', 123], ['sceneRevision', -1], ['sceneRevision', 0.5],
    ] as const) {
      expectIssue(readSimulationRequest, { ...fixture, [field]: value }, `/wire/${field}`)
    }
    expectIssue(readSimulationRequest, { ...fixture, extra: true }, '/wire/extra')
  })

  it('accepts every core physics domain, including legacy domain names distinct from scene domains', () => {
    const fixture = simulationRequestFixture()
    for (const requestedDomain of [
      'mechanics', 'kinematics', 'gravity', 'electric', 'magnetic', 'electromagnetic',
      'circuit', 'induction', 'optics', 'wave', 'thermal', 'modern_physics', 'composite',
    ] as const) {
      expect(readSimulationRequest({ ...fixture, requestedDomain }, '/request').requestedDomain).toBe(requestedDomain)
    }
  })
})

describe('simulation state and result wire readers', () => {
  it('reads truthful typed SimulationResult<PhysicsEvent> fixtures losslessly from unknown data', () => {
    const fixture = simulationResultFixture()
    const input: unknown = jsonValue(fixture)
    const result: SimulationResult = readSimulationResult(input, '/result')
    expect(jsonValue(result)).toEqual(jsonValue(fixture))
    expect(result.verification.status).toBe('passed_with_warnings')
    expect(result.verification.level).toBe('STRONGLY_VERIFIED')
    expect(result.measurements.map((entry) => entry.source)).toEqual(['simulation', 'derived', 'instrument', 'user'])
  })

  it('preserves sample-derived quantities independently of the result summary', () => {
    const fixture = simulationResultFixture()
    const result = readSimulationResult(jsonValue(fixture), '/result')
    expect(present(result.states[0]).derived[0]?.value).toEqual(quantity(50, 'J', 'energy'))
    expect(present(result.states[1]).derived[0]?.value).toEqual(quantity(45, 'J', 'energy'))
    expect(result.derivedQuantities[0]?.value).toEqual(quantity(45, 'J', 'energy'))
    expect(present(result.states[0]).derived).not.toBe(result.derivedQuantities)
    expect(present(result.states[1]).derived).not.toBe(result.derivedQuantities)
    expect(readSimulationState(jsonValue(fixture.states[0]), '/state')).toEqual(fixture.states[0])
  })

  it('preserves all formula variables, conditions, assumptions and confidence boundaries', () => {
    const fixture = simulationResultFixture()
    const result = readSimulationResult(fixture, '/result')
    expect(result.derivedQuantities).toEqual(fixture.derivedQuantities)
    expect(present(result.states[0]).derived).toEqual(present(fixture.states[0]).derived)
    expect(result.derivedQuantities[1]?.confidence).toBe(0)
    expect(present(result.states[0]).derived[1]?.confidence).toBe(1)
    expect(result.derivedQuantities[0]?.formula?.variables?.['v/relative~frame']).toBe('objects/body-fixture/velocity')
  })

  it('preserves failed check and issue details without summarizing them away', () => {
    const fixture = simulationResultFixture()
    const verification = {
      status: 'failed',
      checks: [{ id: 'trajectory-gap', type: 'continuity', passed: false, message: 'Gap detected.', targetId: 'body-fixture', details: { samples: [0.1, 0.2], gap: { from: 0.1, to: 0.2 } } }],
      warnings: fixture.verification.warnings,
      errors: [{ code: 'trajectory-gap', severity: 'error', message: 'Gap detected.', targetId: 'body-fixture', details: { retry: false, engine: { id: 'fixture-engine' } } }],
      level: 'ENGINE_COMPUTED',
    }
    expect(readSimulationResult({ ...fixture, verification }, '/result').verification).toEqual(verification)
  })

  it('accepts empty result collections and does not default a missing verification level', () => {
    const fixture = simulationResultFixture()
    const input = { ...fixture, states: [], events: [], measurements: [], derivedQuantities: [], verification: { status: 'passed', checks: [], warnings: [], errors: [] } }
    const result = readSimulationResult(input, '/result')
    expect(jsonValue(result)).toEqual(jsonValue(input))
    expect(Object.hasOwn(result.verification, 'level')).toBe(false)
  })

  it('keeps generic event JSON, full SceneRuntime envelopes and adapter extensions intact', () => {
    const fixture = simulationResultFixture()
    const full = simulationEventFixture()
    const extended = {
      ...full,
      time: 0.25,
      walltime: { epochMs: 1794124800000, monotonicMs: 123.456789 },
      payload: { ...full.payload, raw: { phase: ['pre', 'post'], custom: null } },
      actor: { ...full.actor, display: { name: 'Fixture author', badges: ['teacher'] } },
      trace: { ...full.trace, adapterSpan: { spanId: 'span-fixture', tags: ['worker'] } },
      adapter: { version: 2, nested: [{ untouched: true }] },
    }
    const generic = {
      eventId: 'event-future', sceneId: 'scene-fixture', revision: 7,
      type: 'FutureEngineBoundary', time: 1.5,
      schemaVersion: 'engine-event/2.0',
      payload: ['phase-ended', { coordinate: { x: 1, y: 2, z: 3 } }],
      walltime: '2026-11-08T08:00:00.100Z',
    }
    const minimal: PhysicsEventLike = {
      eventId: asPhysicsEventId('event-untimed'), sceneId: full.sceneId, revision: 7, type: 'UntimedAnalyticEvent',
    }
    const result = readSimulationResult({ ...fixture, events: [extended, generic, minimal] }, '/result')
    expect(jsonValue(result.events)).toEqual(jsonValue([extended, generic, minimal]))
    expect(Object.hasOwn(present(result.events[2]), 'time')).toBe(false)
  })

  it('defensively clones nested result data, including unknown event and metadata extensions', () => {
    const fixture = simulationResultFixture()
    const full = simulationEventFixture()
    const event = { ...full, payload: { ...full.payload, custom: { tags: ['raw'] } }, walltime: { monotonic: 3 } }
    const input = { ...fixture, events: [event] }
    const expected = jsonValue(input)
    const result = readSimulationResult(input, '/result')
    const state = present(input.states[0])
    const body = present(state.objects[0])
    present(body.position).vector.x = 999
    present(body.values).gain = quantity(1, '', 'dimensionless')
    present(present(state.derived[0]).formula).expression = 'mutated'
    present(present(present(state.derived[0]).formula).variables).m = 'mutated'
    present(present(state.derived[0]).assumptions).push('mutated')
    present(input.measurements[0]).metadata = { overwritten: true }
    present(input.verification.checks[0]).details = { overwritten: true }
    present(input.verification.warnings[0]).details = { overwritten: true }
    input.metadata.engineVersion = 'mutated'
    input.trace.userId = asUserId('user-mutated')
    event.payload.velocity.vector.y = 123
    event.payload.custom.tags.push('mutated')
    event.actor.id = 'actor-mutated'
    event.trace.traceId = asTraceId('trace-mutated')
    event.walltime.monotonic = 999
    input.events.push(event)
    expect(jsonValue(result)).toEqual(expected)
    expect(result.states).not.toBe(input.states)
    expect(present(result.events[0])).not.toBe(event)
    expect(result.metadata).not.toBe(input.metadata)
  })

  it('detaches arrays and objects nested inside raw measurement and verification evidence', () => {
    const fixture = simulationResultFixture()
    const measurementMetadata = { calibration: { samples: [1, 2, 3] }, tags: ['raw'] }
    const checkDetails = { bounds: { low: 1, high: 2 }, samples: [{ residual: 0 }] }
    const warningDetails = { raw: { assumptions: ['ideal environment'] } }
    const errorDetails = { phases: [{ id: 'boundary', accepted: false }] }
    const input = {
      ...fixture,
      measurements: [{ ...present(fixture.measurements[0]), metadata: measurementMetadata }],
      verification: {
        status: 'failed',
        checks: [{ ...present(fixture.verification.checks[0]), details: checkDetails }],
        warnings: [{ ...present(fixture.verification.warnings[0]), details: warningDetails }],
        errors: [{ code: 'BOUNDARY', severity: 'error', message: 'Boundary rejected.', details: errorDetails }],
      },
    }
    const expected = jsonValue(input)
    const result = readSimulationResult(input, '/result')
    measurementMetadata.calibration.samples.push(99)
    measurementMetadata.tags[0] = 'mutated'
    checkDetails.bounds.low = 99
    present(checkDetails.samples[0]).residual = 99
    warningDetails.raw.assumptions.push('mutated')
    present(errorDetails.phases[0]).id = 'mutated'
    expect(jsonValue(result)).toEqual(expected)
  })

  for (const field of ['schemaVersion', 'simulationId', 'sceneId', 'sceneRevision', 'states', 'events', 'measurements', 'derivedQuantities', 'verification', 'metadata', 'trace'] as const) {
    it(`requires result ${field}`, () => {
      const input = wireObject(simulationResultFixture())
      delete input[field]
      expectIssue(readSimulationResult, input, `/wire/${field}`)
    })
  }

  for (const field of ['time', 'objects', 'derived'] as const) {
    it(`requires captured-state ${field}`, () => {
      const input = wireObject(simulationStateFixture())
      delete input[field]
      expectIssue(readSimulationState, input, `/wire/${field}`)
    })
  }

  it('rejects non-array result and verification collections', () => {
    const fixture = simulationResultFixture()
    for (const field of ['states', 'events', 'measurements', 'derivedQuantities'] as const) {
      expectIssue(readSimulationResult, { ...fixture, [field]: {} }, `/wire/${field}`)
    }
    for (const field of ['checks', 'warnings', 'errors'] as const) {
      expectIssue(readSimulationResult, { ...fixture, verification: { ...fixture.verification, [field]: {} } }, `/wire/verification/${field}`)
    }
  })

  it('requires all verification collections even when they would be empty', () => {
    const fixture = simulationResultFixture()
    for (const field of ['checks', 'warnings', 'errors'] as const) {
      const verification = wireObject(fixture.verification)
      delete verification[field]
      expectIssue(readSimulationResult, { ...fixture, verification }, `/wire/verification/${field}`)
    }
  })

  it('reads minimal static states without inventing object fields or derived evidence', () => {
    const input = { time: quantity(0, 's', 'time'), objects: [{ id: 'static-object' }], derived: [] }
    const state = readSimulationState(input, '/state')
    expect(jsonValue(state)).toEqual(jsonValue(input))
    expect(Object.hasOwn(present(state.objects[0]), 'values')).toBe(false)
    expect(Object.hasOwn(present(state.objects[0]), 'velocity')).toBe(false)
  })

  it('requires each nested sample, object, derived value, measurement and check field', () => {
    const fixture = simulationResultFixture()
    const state = present(fixture.states[0])
    const object = present(state.objects[0])
    const derived = present(fixture.derivedQuantities[0])
    const measurement = present(fixture.measurements[0])
    const check = present(fixture.verification.checks[0])
    const warning = present(fixture.verification.warnings[0])
    for (const field of ['time', 'objects', 'derived'] as const) {
      const missing = wireObject(state)
      delete missing[field]
      expectIssue(readSimulationResult, { ...fixture, states: [missing] }, `/wire/states/0/${field}`)
    }
    const missingObjectId = wireObject(object)
    delete missingObjectId.id
    expectIssue(readSimulationState, { ...state, objects: [missingObjectId] }, '/wire/objects/0/id')
    for (const field of ['key', 'value'] as const) {
      const missing = wireObject(derived)
      delete missing[field]
      expectIssue(readSimulationResult, { ...fixture, derivedQuantities: [missing] }, `/wire/derivedQuantities/0/${field}`)
      expectIssue(readSimulationState, { ...state, derived: [missing] }, `/wire/derived/0/${field}`)
    }
    for (const field of ['id', 'value', 'source'] as const) {
      const missing = wireObject(measurement)
      delete missing[field]
      expectIssue(readSimulationResult, { ...fixture, measurements: [missing] }, `/wire/measurements/0/${field}`)
    }
    for (const field of ['id', 'type', 'passed'] as const) {
      const missing = wireObject(check)
      delete missing[field]
      expectIssue(readSimulationResult, { ...fixture, verification: { ...fixture.verification, checks: [missing] } }, `/wire/verification/checks/0/${field}`)
    }
    for (const field of ['code', 'severity', 'message'] as const) {
      const missing = wireObject(warning)
      delete missing[field]
      expectIssue(readSimulationResult, { ...fixture, verification: { ...fixture.verification, warnings: [missing] } }, `/wire/verification/warnings/0/${field}`)
    }
    const missingExpression = wireObject(present(derived.formula))
    delete missingExpression.expression
    expectIssue(readSimulationResult, { ...fixture, derivedQuantities: [{ ...derived, formula: missingExpression }] }, '/wire/derivedQuantities/0/formula/expression')
  })

  it('enforces scalar/vector shapes and physical dimensions in each object-state field', () => {
    const state = simulationStateFixture()
    const object = present(state.objects[0])
    for (const field of ['position', 'velocity', 'acceleration'] as const) {
      expectIssue(readSimulationState, {
        ...state, objects: [{ ...object, [field]: { vector: { x: 0, y: 0, z: 0 }, unit: 'T', dimension: 'magnetic_flux_density' } }],
      }, `/wire/objects/0/${field}/dimension`)
      expectIssue(readSimulationState, { ...state, objects: [{ ...object, [field]: quantity(1, 'm', 'length') }] }, `/wire/objects/0/${field}/value`)
    }
    expectIssue(readSimulationState, { ...state, objects: [{ ...object, values: { 'bad/key~unit': { value: 1, unit: 'unknown', dimension: 'energy' } } }] }, '/wire/objects/0/values/bad~1key~0unit/unit')
    expectIssue(readSimulationState, { ...state, objects: [{ ...object, values: [] }] }, '/wire/objects/0/values')
  })

  it('checks nested quantity dimensions, units and finiteness at their actual state/result scope', () => {
    const fixture = simulationResultFixture()
    const state = present(fixture.states[0])
    const derived = present(state.derived[0])
    const measurement = present(fixture.measurements[0])
    expectIssue(readSimulationResult, { ...fixture, states: [{ ...state, time: quantity(1, 'm', 'length') }] }, '/wire/states/0/time/dimension')
    expectIssue(readSimulationResult, { ...fixture, states: [{ ...state, time: { value: Infinity, unit: 's', dimension: 'time' } }] }, '/wire/states/0/time/value')
    expectIssue(readSimulationResult, { ...fixture, states: [{ ...state, derived: [{ ...derived, value: { value: 1, unit: 'missing', dimension: 'energy' } }] }] }, '/wire/states/0/derived/0/value/unit')
    expectIssue(readSimulationResult, { ...fixture, derivedQuantities: [{ ...derived, value: { value: 1, unit: 'J', dimension: 'force' } }] }, '/wire/derivedQuantities/0/value/dimension')
    expectIssue(readSimulationResult, { ...fixture, measurements: [{ ...measurement, value: { vector: { x: 0, y: NaN, z: 0 }, unit: 'N', dimension: 'force' } }] }, '/wire/measurements/0/value/vector/y')
    expectIssue(readSimulationResult, { ...fixture, measurements: [{ ...measurement, time: quantity(1, 'm', 'length') }] }, '/wire/measurements/0/time/dimension')
  })

  it('rejects malformed formulas and confidence instead of discarding evidence', () => {
    const fixture = simulationResultFixture()
    const derived = present(fixture.derivedQuantities[0])
    const badFields: readonly { field: string; value: unknown; issue: string }[] = [
      { field: 'confidence', value: -0.1, issue: 'confidence' },
      { field: 'confidence', value: 1.1, issue: 'confidence' },
      { field: 'confidence', value: NaN, issue: 'confidence' },
      { field: 'assumptions', value: [123], issue: 'assumptions/0' },
      { field: 'formula', value: { expression: '' }, issue: 'formula/expression' },
      { field: 'formula', value: { expression: 'm*v', variables: { m: 1 } }, issue: 'formula/variables/m' },
      { field: 'formula', value: { expression: 'm*v', conditions: [false] }, issue: 'formula/conditions/0' },
      { field: 'formula', value: { expression: 'm*v', latex: 1 }, issue: 'formula/latex' },
      { field: 'formula', value: { expression: 'm*v', extra: 1 }, issue: 'formula/extra' },
    ]
    for (const entry of badFields) {
      expectIssue(readSimulationResult, { ...fixture, derivedQuantities: [{ ...derived, [entry.field]: entry.value }] }, `/wire/derivedQuantities/0/${entry.issue}`)
    }
  })

  it('rejects invalid measurement sources and non-object metadata', () => {
    const fixture = simulationResultFixture()
    const measurement = present(fixture.measurements[0])
    expectIssue(readSimulationResult, { ...fixture, measurements: [{ ...measurement, source: 'guessed' }] }, '/wire/measurements/0/source')
    expectIssue(readSimulationResult, { ...fixture, measurements: [{ ...measurement, metadata: ['not', 'an', 'object'] }] }, '/wire/measurements/0/metadata')
  })

  it('rejects unknown verification status, check type, issue severity and level', () => {
    const fixture = simulationResultFixture()
    const check = present(fixture.verification.checks[0])
    const warning = present(fixture.verification.warnings[0])
    expectIssue(readSimulationResult, { ...fixture, verification: { ...fixture.verification, status: 'verified' } }, '/wire/verification/status')
    expectIssue(readSimulationResult, { ...fixture, verification: { ...fixture.verification, level: 'VERIFIED' } }, '/wire/verification/level')
    expectIssue(readSimulationResult, { ...fixture, verification: { ...fixture.verification, checks: [{ ...check, type: 'universal' }] } }, '/wire/verification/checks/0/type')
    expectIssue(readSimulationResult, { ...fixture, verification: { ...fixture.verification, checks: [{ ...check, passed: 1 }] } }, '/wire/verification/checks/0/passed')
    expectIssue(readSimulationResult, { ...fixture, verification: { ...fixture.verification, warnings: [{ ...warning, severity: 'notice' }] } }, '/wire/verification/warnings/0/severity')
    expectIssue(readSimulationResult, { ...fixture, verification: { ...fixture.verification, errors: [{ code: 'bad', severity: 'error', message: 'bad', details: [] }] } }, '/wire/verification/errors/0/details')
  })

  it('reads every core verification check type, status and provenance level without altering evidence', () => {
    const fixture = simulationResultFixture()
    const checkTypes = [
      'schema', 'dimension', 'symbolic', 'numerical', 'constraint', 'conservation',
      'boundary', 'trajectory', 'continuity', 'semantic',
    ] as const
    const checks = checkTypes.map((type) => ({ id: `${type}-check`, type, passed: true }))
    for (const level of [
      'UNVERIFIED', 'ENGINE_COMPUTED', 'RULE_VERIFIED', 'NUMERIC_VERIFIED',
      'SYMBOLIC_VERIFIED', 'CONSERVATION_VERIFIED', 'STRONGLY_VERIFIED',
    ] as const) {
      const verification = { ...fixture.verification, checks, level }
      expect(readSimulationResult({ ...fixture, verification }, '/result').verification).toEqual(verification)
    }
    for (const status of ['passed', 'passed_with_warnings', 'failed'] as const) {
      const verification = { ...fixture.verification, status }
      expect(readSimulationResult({ ...fixture, verification }, '/result').verification).toEqual(verification)
    }
  })

  it('rejects unknown fields in every closed nested schema', () => {
    const fixture = simulationResultFixture()
    const state = present(fixture.states[0])
    expectIssue(readSimulationState, { ...state, objects: [{ ...present(state.objects[0]), extra: true }] }, '/wire/objects/0/extra')
    expectIssue(readSimulationState, { ...state, derived: [{ ...present(state.derived[0]), extra: true }] }, '/wire/derived/0/extra')
    expectIssue(readSimulationResult, { ...fixture, measurements: [{ ...present(fixture.measurements[0]), extra: true }] }, '/wire/measurements/0/extra')
    expectIssue(readSimulationResult, { ...fixture, verification: { ...fixture.verification, extra: true } }, '/wire/verification/extra')
    expectIssue(readSimulationResult, { ...fixture, verification: { ...fixture.verification, checks: [{ ...present(fixture.verification.checks[0]), extra: true }] } }, '/wire/verification/checks/0/extra')
    expectIssue(readSimulationResult, { ...fixture, verification: { ...fixture.verification, warnings: [{ ...present(fixture.verification.warnings[0]), extra: true }] } }, '/wire/verification/warnings/0/extra')
  })

  it('rejects wrong result schema, IDs, revision and unknown closed-schema fields', () => {
    const fixture = simulationResultFixture()
    for (const [field, value] of [
      ['schemaVersion', 'simulation-request/1.0'], ['simulationId', ' '], ['sceneId', 123],
      ['sceneRevision', -1], ['sceneRevision', 0.5], ['extra', true],
    ] as const) {
      expectIssue(readSimulationResult, { ...fixture, [field]: value }, `/wire/${field}`)
    }
    expectIssue(readSimulationState, { ...simulationStateFixture(), derivedQuantities: [] }, '/wire/derivedQuantities')
  })
})

describe('simulation collection identities', () => {
  it('rejects duplicate object IDs inside one sample or a captured state', () => {
    const state = simulationStateFixture()
    const object = present(state.objects[0])
    const duplicate = { ...state, objects: [object, { ...object }] }
    const stateError = expectIssue(readSimulationState, duplicate, '/wire/objects/1')
    expect(stateError.issues[0]?.code).toBe('duplicate-id')
    expectIssue(readSimulationResult, { ...simulationResultFixture(), states: [duplicate] }, '/wire/states/0/objects/1')
  })

  it('rejects duplicate derived key/target pairs at sample and result scope', () => {
    const state = simulationStateFixture()
    const derived = present(state.derived[0])
    const duplicate = { ...derived, value: quantity(40, 'J', 'energy') }
    const invalidState = { ...state, derived: [derived, duplicate] }
    expectIssue(readSimulationState, invalidState, '/wire/derived/1')
    expectIssue(readSimulationResult, { ...simulationResultFixture(), states: [invalidState] }, '/wire/states/0/derived/1')
    const resultError = expectIssue(readSimulationResult, { ...simulationResultFixture(), derivedQuantities: [derived, duplicate] }, '/wire/derivedQuantities/1')
    expect(resultError.issues[0]?.code).toBe('duplicate-id')
  })

  it('rejects duplicate untargeted derived keys even if their declared units differ', () => {
    const entries: DerivedQuantity[] = [
      { key: 'speed', value: quantity(36, 'km/h', 'velocity') },
      { key: 'speed', value: quantity(10, 'm/s', 'velocity') },
    ]
    expectIssue(readSimulationState, { ...simulationStateFixture(), derived: entries }, '/wire/derived/1')
    expectIssue(readSimulationResult, { ...simulationResultFixture(), derivedQuantities: entries }, '/wire/derivedQuantities/1')
  })

  it('allows the same derived key for distinct targets and keeps untargeted evidence separate', () => {
    const entries: DerivedQuantity[] = [
      { key: 'speed', targetId: 'body-one', value: quantity(36, 'km/h', 'velocity') },
      { key: 'speed', targetId: 'body-two', value: quantity(72, 'km/h', 'velocity') },
      { key: 'speed', value: quantity(10, 'm/s', 'velocity') },
    ]
    expect(readSimulationState({ ...simulationStateFixture(), derived: entries }, '/state').derived).toEqual(entries)
    expect(readSimulationResult({ ...simulationResultFixture(), derivedQuantities: entries }, '/result').derivedQuantities).toEqual(entries)
  })

  it('uses unambiguous key/target identities even when native IDs contain slashes or tildes', () => {
    const entries: DerivedQuantity[] = [
      { key: 'speed/body~one', value: quantity(10, 'm/s', 'velocity') },
      { key: 'speed', targetId: 'body~one', value: quantity(10, 'm/s', 'velocity') },
      { key: 'a/b', targetId: 'c', value: quantity(1, '', 'dimensionless') },
      { key: 'a', targetId: 'b/c', value: quantity(1, '', 'dimensionless') },
    ]
    expect(readSimulationState({ ...simulationStateFixture(), derived: entries }, '/state').derived).toEqual(entries)
    expect(readSimulationResult({ ...simulationResultFixture(), derivedQuantities: entries }, '/result').derivedQuantities).toEqual(entries)
  })

  it('rejects duplicate measurement IDs even across different sample times or targets', () => {
    const fixture = simulationResultFixture()
    const measurement = present(fixture.measurements[0])
    const duplicate = { ...measurement, time: quantity(1.5, 's', 'time'), targetId: 'another-native-target' }
    const error = expectIssue(readSimulationResult, { ...fixture, measurements: [measurement, duplicate] }, '/wire/measurements/1')
    expect(error.issues[0]?.code).toBe('duplicate-id')
  })

  it('rejects duplicate event IDs without discarding their different raw envelopes', () => {
    const fixture = simulationResultFixture()
    const event = simulationEventFixture()
    const duplicate = { ...event, time: 1.5, payload: { ...event.payload, adapter: { phase: 'after' } } }
    const error = expectIssue(readSimulationResult, { ...fixture, events: [event, duplicate] }, '/wire/events/1')
    expect(error.issues[0]?.code).toBe('duplicate-id')
  })

  it('allows repeated sample timestamps and scopes object/derived identities to each sample', () => {
    const fixture = simulationResultFixture()
    const first = simulationStateFixture(250, 50)
    const second = simulationStateFixture(250, 45)
    const input = { ...fixture, states: [first, second] }
    const result = readSimulationResult(input, '/result')
    expect(jsonValue(result)).toEqual(jsonValue(input))
    expect(result.states[0]?.time).toEqual(result.states[1]?.time)
    expect(result.states[0]?.objects[0]?.id).toBe(result.states[1]?.objects[0]?.id)
    expect(result.states[0]?.derived[0]?.value).toEqual(quantity(50, 'J', 'energy'))
    expect(result.states[1]?.derived[0]?.value).toEqual(quantity(45, 'J', 'energy'))
  })

  it('allows distinct measurements and events at the same timestamp', () => {
    const fixture = simulationResultFixture()
    const measurement = present(fixture.measurements[0])
    const event = simulationEventFixture()
    const measurements = [measurement, { ...measurement, id: 'measurement-same-time' }]
    const events = [
      { ...event, time: 0.25 },
      { ...event, eventId: asPhysicsEventId('event-same-time'), time: 0.25, payload: { ...event.payload, phase: 'after' } },
    ]
    const result = readSimulationResult({ ...fixture, measurements, events }, '/result')
    expect(result.measurements).toEqual(measurements)
    expect(jsonValue(result.events)).toEqual(jsonValue(events))
  })

  it('retains native measurement target and definition IDs without requiring live scene objects', () => {
    const fixture = simulationResultFixture()
    const measurements = [{
      ...present(fixture.measurements[0]),
      targetId: 'analytic-mode/solution~one',
      definitionId: 'instrument-reading/not-an-object',
    }]
    const result = readSimulationResult({ ...fixture, states: [], measurements }, '/result')
    expect(result.measurements).toEqual(measurements)
  })
})

describe('engine time and trace validation', () => {
  it('preserves the declared numerical execution count without conflating samples or wall-clock duration', () => {
    const fixture = simulationResultFixture()
    for (const numericalIterationCount of [0, 1, 1483, Number.MAX_SAFE_INTEGER]) {
      const input: SimulationResult = { ...fixture, metadata: { ...fixture.metadata, numericalIterationCount } }
      const result = readSimulationResult(input, '/result')
      expect(result.metadata.numericalIterationCount).toBe(numericalIterationCount)
      expect(result.states).toEqual(fixture.states)
      expect(result.metadata.durationMs).toBe(fixture.metadata.durationMs)
    }
    expect(readSimulationResult(fixture, '/result').metadata).not.toHaveProperty('numericalIterationCount')
  })

  it('rejects undeclared or malformed numerical accounting metadata instead of admitting arbitrary extensions', () => {
    const fixture = simulationResultFixture()
    for (const numericalIterationCount of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1483', null]) {
      expectIssue(readSimulationResult, { ...fixture, metadata: { ...fixture.metadata, numericalIterationCount } }, '/wire/metadata/numericalIterationCount')
    }
    expectIssue(readSimulationResult, { ...fixture, metadata: { ...fixture.metadata, numericalIterationCount: 7, numericalBudget: 100 } }, '/wire/metadata/numericalBudget')
  })
  it('preserves shared date-time strings with offsets and longer fractional precision', () => {
    const fixture = simulationResultFixture()
    const event = { ...simulationEventFixture(), occurredAt: '2026-11-08T16:00:00.012345+08:00' }
    const metadata = {
      ...fixture.metadata,
      startedAt: '2026-11-08T16:00:00.000001+08:00',
      finishedAt: '2026-11-08T08:00:00.125678Z',
    }
    const result = readSimulationResult({ ...fixture, metadata, events: [event] }, '/result')
    expect(result.metadata).toEqual(metadata)
    expect(jsonValue(result.events)).toEqual(jsonValue([event]))
  })

  it('compares engine timestamp ordering as instants rather than lexicographic wall-clock strings', () => {
    const fixture = simulationResultFixture()
    const metadata = { ...fixture.metadata, startedAt: '2026-11-08T16:00:00+08:00', finishedAt: '2026-11-08T07:59:59.999Z' }
    expectIssue(readSimulationResult, { ...fixture, metadata }, '/wire/metadata/finishedAt')
  })

  it('checks state, measurement and event scene times', () => {
    const fixture = simulationResultFixture()
    expectIssue(readSimulationState, { ...simulationStateFixture(), time: quantity(-1, 's', 'time') }, '/wire/time/value')
    expectIssue(readSimulationResult, { ...fixture, measurements: [{ ...present(fixture.measurements[0]), time: quantity(-1, 's', 'time') }] }, '/wire/measurements/0/time/value')
    for (const time of [-1, Infinity, NaN, '0.25']) {
      expectIssue(readSimulationResult, { ...fixture, events: [{ ...simulationEventFixture(), time }] }, '/wire/events/0/time')
    }
  })

  const badMetadata: readonly { field: string; value: unknown }[] = [
    { field: 'engineId', value: '' },
    { field: 'engineVersion', value: 1 },
    { field: 'solver', value: ' ' },
    { field: 'startedAt', value: 'yesterday' },
    { field: 'finishedAt', value: '2026-13-08T08:00:00.000Z' },
    { field: 'finishedAt', value: '2026-11-08T07:59:59.999Z' },
    { field: 'durationMs', value: -1 },
    { field: 'durationMs', value: Infinity },
    { field: 'deterministic', value: 'true' },
    { field: 'randomSeed', value: NaN },
    { field: 'extra', value: true },
  ]
  for (const entry of badMetadata) {
    it(`rejects invalid engine metadata ${entry.field}=${String(entry.value)}`, () => {
      const fixture = simulationResultFixture()
      expectIssue(readSimulationResult, { ...fixture, metadata: { ...fixture.metadata, [entry.field]: entry.value } }, `/wire/metadata/${entry.field}`)
    })
  }

  for (const field of ['engineId', 'engineVersion', 'startedAt', 'finishedAt', 'durationMs', 'deterministic'] as const) {
    it(`requires engine metadata ${field}`, () => {
      const fixture = simulationResultFixture()
      const metadata = wireObject(fixture.metadata)
      delete metadata[field]
      expectIssue(readSimulationResult, { ...fixture, metadata }, `/wire/metadata/${field}`)
    })
  }

  it('requires event identity and revision but does not require a SceneRuntime envelope', () => {
    const fixture = simulationResultFixture()
    for (const field of ['eventId', 'sceneId', 'revision', 'type'] as const) {
      const event = wireObject(simulationEventFixture())
      delete event[field]
      expectIssue(readSimulationResult, { ...fixture, events: [event] }, `/wire/events/0/${field}`)
    }
  })

  it('validates event IDs and revisions and accepts zero-time boundary events', () => {
    const fixture = simulationResultFixture()
    const event = simulationEventFixture()
    for (const [field, value] of [
      ['eventId', ' '], ['sceneId', 123], ['revision', -1], ['revision', 0.5], ['type', ''],
    ] as const) {
      expectIssue(readSimulationResult, { ...fixture, events: [{ ...event, [field]: value }] }, `/wire/events/0/${field}`)
    }
    const zeroTime = { ...event, time: 0 }
    expect(jsonValue(readSimulationResult({ ...fixture, events: [zeroTime] }, '/result').events)).toEqual(jsonValue([zeroTime]))
  })

  it('preserves empty optional event actor IDs accepted by the core actor contract', () => {
    const event = { ...simulationEventFixture(), actor: { type: 'system', id: '', metadata: { source: 'legacy' } } }
    const result = readSimulationResult({ ...simulationResultFixture(), events: [event] }, '/result')
    expect(jsonValue(result.events)).toEqual(jsonValue([event]))
  })

  it('validates branded command IDs, actor and wall-clock fields when an event carries them', () => {
    const fixture = simulationResultFixture()
    const event = simulationEventFixture()
    expectIssue(readSimulationResult, { ...fixture, events: [{ ...event, commandId: ' ' }] }, '/wire/events/0/commandId')
    expectIssue(readSimulationResult, { ...fixture, events: [{ ...event, actor: { type: 'unknown' } }] }, '/wire/events/0/actor/type')
    expectIssue(readSimulationResult, { ...fixture, events: [{ ...event, actor: { type: 'user', id: 1 } }] }, '/wire/events/0/actor/id')
    expectIssue(readSimulationResult, { ...fixture, events: [{ ...event, occurredAt: 'not-a-date' }] }, '/wire/events/0/occurredAt')
  })

  for (const field of ['traceId', 'userId', 'sessionId', 'runId', 'turnId', 'toolCallId', 'sceneId', 'physicsEventId'] as const) {
    it(`validates branded trace ${field} at request, result and event boundaries`, () => {
      const trace = { ...simulationTraceFixture(), [field]: ' ' }
      expectIssue(readSimulationRequest, { ...simulationRequestFixture(), trace }, `/wire/trace/${field}`)
      expectIssue(readSimulationResult, { ...simulationResultFixture(), trace }, `/wire/trace/${field}`)
      expectIssue(readSimulationResult, { ...simulationResultFixture(), events: [{ ...simulationEventFixture(), trace }] }, `/wire/events/0/trace/${field}`)
    })
  }

  it('rejects missing trace IDs and noninteger trace revisions', () => {
    const trace = wireObject(simulationTraceFixture())
    delete trace.traceId
    expectIssue(readSimulationRequest, { ...simulationRequestFixture(), trace }, '/wire/trace/traceId')
    expectIssue(readSimulationResult, { ...simulationResultFixture(), trace }, '/wire/trace/traceId')
    expectIssue(readSimulationResult, { ...simulationResultFixture(), events: [{ ...simulationEventFixture(), trace }] }, '/wire/events/0/trace/traceId')
    for (const sceneRevision of [-1, 0.5, Infinity]) {
      expectIssue(readSimulationResult, { ...simulationResultFixture(), trace: { ...simulationTraceFixture(), sceneRevision } }, '/wire/trace/sceneRevision')
    }
  })

  it('allows extra trace JSON only inside an extensible event', () => {
    const trace = { ...simulationTraceFixture(), spanId: 'span-extra' }
    expectIssue(readSimulationRequest, { ...simulationRequestFixture(), trace }, '/wire/trace/spanId')
    expectIssue(readSimulationResult, { ...simulationResultFixture(), trace }, '/wire/trace/spanId')
    const event = { ...simulationEventFixture(), trace }
    expect(jsonValue(readSimulationResult({ ...simulationResultFixture(), events: [event] }, '/result').events)).toEqual(jsonValue([event]))
  })
})

describe('renderer release wire reader', () => {
  it('reads official, community and legacy community identities without adding fields', () => {
    const official = { kind: 'official', id: 'official-fixture', experimentId: 'experiment-fixture', version: '1.0.0' }
    const community = releaseFixture()
    const legacy = wireObject(community)
    delete legacy.kind
    expect(readRendererRelease(jsonValue(official), '/release')).toEqual(official)
    expect(readRendererRelease(jsonValue(community), '/release')).toEqual(community)
    const result = readRendererRelease(jsonValue(legacy), '/release')
    expect(result).toEqual(legacy)
    expect(Object.hasOwn(result, 'kind')).toBe(false)
    community.version = 'mutated'
    expect(result.version).toBe('2.1.0')
  })

  it('preserves uppercase and mixed-case renderer hashes for community and legacy releases', () => {
    for (const sha256 of ['A'.repeat(64), 'aB09'.repeat(16)]) {
      const community = { ...releaseFixture(), sha256 }
      const legacy = wireObject(community)
      delete legacy.kind
      expect(readRendererRelease(jsonValue(community), '/release')).toEqual(community)
      const result = readRendererRelease(jsonValue(legacy), '/release')
      expect(result).toEqual(legacy)
      expect(Object.hasOwn(result, 'kind')).toBe(false)
    }
  })

  it('requires community digest, validates all identity fields and forbids official digests', () => {
    for (const field of ['id', 'experimentId', 'version', 'sha256'] as const) {
      const input = wireObject(releaseFixture())
      delete input[field]
      expectIssue(readRendererRelease, input, `/wire/${field}`)
    }
    expectIssue(readRendererRelease, { ...releaseFixture(), kind: 'unknown' }, '/wire/kind')
    for (const sha256 of ['G'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), ` ${'a'.repeat(64)}`, 'a'.repeat(64) + '\n']) {
      expectIssue(readRendererRelease, { ...releaseFixture(), sha256 }, '/wire/sha256')
    }
    expectIssue(readRendererRelease, { ...releaseFixture(), kind: 'official' }, '/wire/sha256')
    expectIssue(readRendererRelease, { ...releaseFixture(), extra: true }, '/wire/extra')
    expectIssue(readRendererRelease, { ...releaseFixture(), id: ' ' }, '/wire/id')
  })
})

describe('direct unknown-input safety', () => {
  const boundaries: readonly { name: string; reader: Reader; fixture: () => unknown }[] = [
    { name: 'request', reader: readSimulationRequest, fixture: simulationRequestFixture },
    { name: 'result', reader: readSimulationResult, fixture: simulationResultFixture },
    { name: 'state', reader: readSimulationState, fixture: simulationStateFixture },
    { name: 'quantity', reader: readQuantity, fixture: () => quantity(1, 'm', 'length') },
    { name: 'vector', reader: readQuantityVector, fixture: () => ({ vector: { x: 1, y: 0, z: 0 }, unit: 'm', dimension: 'length' }) },
    { name: 'scalar/vector', reader: readScalarOrVector, fixture: () => quantity(1, 'm', 'length') },
    { name: 'renderer release', reader: readRendererRelease, fixture: releaseFixture },
  ]
  for (const entry of boundaries) {
    it(`validates the entire ${entry.name} input before accepting or dropping any extra field`, () => {
      const executable = { ...wireObject(entry.fixture()), extra: () => 'must not execute' }
      expectIssue(entry.reader, executable, '/wire/extra')
      const cyclic = wireObject(entry.fixture())
      cyclic.extra = cyclic
      expectIssue(entry.reader, cyclic, '/wire/extra')
      for (const value of [null, 'wrong', 1, [], true]) {
        expectIssue(entry.reader, value, '/wire')
      }
    })
  }

  it('rejects executable or cyclic event payloads even though their schema is open', () => {
    const fixture = simulationResultFixture()
    const event = simulationEventFixture()
    expectIssue(readSimulationResult, { ...fixture, events: [{ ...event, payload: { nested: { execute: () => 1 } } }] }, '/wire/events/0/payload/nested/execute')
    const payload: Record<string, unknown> = {}
    payload.self = payload
    expectIssue(readSimulationResult, { ...fixture, events: [{ ...event, payload }] }, '/wire/events/0/payload/self')
    const array: unknown[] = []
    array.push(array)
    expectIssue(readSimulationResult, { ...fixture, events: [{ ...event, payload: array }] }, '/wire/events/0/payload/0')
  })

  it('rejects unsafe JSON in raw metadata and check details', () => {
    const fixture = simulationResultFixture()
    const measurement = present(fixture.measurements[0])
    const check = present(fixture.verification.checks[0])
    expectIssue(readSimulationResult, { ...fixture, measurements: [{ ...measurement, metadata: { raw: { invalid: Infinity } } }] }, '/wire/measurements/0/metadata/raw/invalid')
    expectIssue(readSimulationResult, { ...fixture, verification: { ...fixture.verification, checks: [{ ...check, details: { execute: () => 1 } }] } }, '/wire/verification/checks/0/details/execute')
    const metadata: Record<string, unknown> = {}
    metadata.self = metadata
    expectIssue(readSimulationResult, { ...fixture, measurements: [{ ...measurement, metadata }] }, '/wire/measurements/0/metadata/self')
  })

  it('rejects accessors without evaluating them and does not invoke toJSON', () => {
    let executed = false
    const input = simulationResultFixture()
    Object.defineProperty(input.metadata, 'durationMs', { enumerable: true, get: () => { executed = true; return 123 } })
    expectIssue(readSimulationResult, input, '/wire/metadata/durationMs')
    const withToJson = {
      ...simulationRequestFixture(),
      toJSON: () => { executed = true; return {} },
    }
    expectIssue(readSimulationRequest, withToJson, '/wire/toJSON')
    expect(executed).toBe(false)
  })

  it('rejects non-plain objects, symbol properties, unpaired strings and unsafe record keys', () => {
    const fixture = simulationResultFixture()
    expectIssue(readSimulationResult, { ...fixture, measurements: [{ ...present(fixture.measurements[0]), metadata: new Date('2026-11-08T08:00:00Z') }] }, '/wire/measurements/0/metadata')
    const input = simulationStateFixture()
    Object.defineProperty(input, Symbol('hidden'), { value: true, enumerable: true })
    expectIssue(readSimulationState, input, '/wire')
    expectIssue(readSimulationRequest, { ...simulationRequestFixture(), simulationId: '\ud800' }, '/wire/simulationId')
    const details: Record<string, unknown> = {}
    Object.setPrototypeOf(details, null)
    Object.defineProperty(details, '__proto__', { value: { polluted: true }, enumerable: true })
    expectIssue(readSimulationResult, { ...fixture, verification: { ...fixture.verification, checks: [{ ...present(fixture.verification.checks[0]), details }] } }, '/wire/verification/checks/0/details/__proto__')
  })

  it('rejects sparse arrays, array accessors and additional array properties', () => {
    const fixture = simulationResultFixture()
    const sparse = new Array<unknown>(1)
    expectIssue(readSimulationResult, { ...fixture, states: sparse }, '/wire/states/0')
    let executed = false
    const accessor: unknown[] = []
    Object.defineProperty(accessor, '0', { enumerable: true, get: () => { executed = true; return simulationStateFixture() } })
    expectIssue(readSimulationResult, { ...fixture, states: accessor }, '/wire/states/0')
    const extra = [simulationStateFixture()]
    Object.defineProperty(extra, 'extra', { value: () => 1, enumerable: true })
    expectIssue(readSimulationResult, { ...fixture, states: extra }, '/wire/states')
    expect(executed).toBe(false)
  })

  it('rejects out-of-range numeric array properties rather than silently discarding them', () => {
    const states = [simulationStateFixture()]
    Object.defineProperty(states, '4294967295', { value: () => 1, enumerable: true })
    expectIssue(readSimulationResult, { ...simulationResultFixture(), states }, '/wire/states')
  })

  it('rejects Array subclasses instead of calling inherited custom array methods', () => {
    class ForeignArray extends Array<unknown> {}
    const states = new ForeignArray(simulationStateFixture())
    expectIssue(readSimulationResult, { ...simulationResultFixture(), states }, '/wire/states')
  })

  it('allows repeated external references while detaching and freezing both owned samples', () => {
    const state = simulationStateFixture()
    const input = { ...simulationResultFixture(), states: [state, state] }
    const result = readSimulationResult(input, '/result')
    expect(result.states[0]).toEqual(result.states[1])
    expect(result.states[0]).not.toBe(result.states[1])
    expect(present(result.states[0]).time).not.toBe(present(result.states[1]).time)
    expect(present(result.states[0]).time).not.toBe(state.time)
    expect(present(result.states[1]).time).not.toBe(state.time)
    expect(() => { present(result.states[0]).time.value = 999 }).toThrow(TypeError)
    expect(present(result.states[0]).time.value).toBe(250)
    expect(present(result.states[1]).time.value).toBe(250)
    expect(state.time.value).toBe(250)
    state.time.value = 500
    expect(present(result.states[0]).time.value).toBe(250)
    expect(present(result.states[1]).time.value).toBe(250)
  })

  it('returns a schema-owned copy when the caller used null-prototype JSON records', () => {
    const state = simulationStateFixture()
    const input = wireObject(state)
    Object.setPrototypeOf(input, null)
    expect(readSimulationState(input, '/state')).toEqual(state)
    expect(record(input, '/state')).toBe(input)
  })
})
