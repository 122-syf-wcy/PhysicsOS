import {
  quantityVector,
  summarizeVerification,
  type DerivedQuantity,
  type ObjectState,
  type SimulationRequest,
  type SimulationResult,
  type SimulationState,
  type TraceContext,
} from '@physicsos/physics-core'
import type { PhysicsEvent } from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'
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
} from '@physicsos/shared'

/** Fixed clocks and fresh nested data make these fixtures safe to mutate in rejection tests. */
export const simulationTraceFixture = (): TraceContext => ({
  traceId: asTraceId('trace-fixture'),
  userId: asUserId('user-fixture'),
  sessionId: asSessionId('session-fixture'),
  runId: asRunId('run-fixture'),
  turnId: asTurnId('turn-fixture'),
  toolCallId: asToolCallId('tool-call-fixture'),
  sceneId: asSceneId('scene-fixture'),
  sceneRevision: 7,
  physicsEventId: asPhysicsEventId('event-fixture'),
})

export const simulationRequestFixture = (): SimulationRequest => ({
  schemaVersion: 'simulation-request/1.0',
  simulationId: asSimulationId('simulation-fixture'),
  sceneId: asSceneId('scene-fixture'),
  sceneRevision: 7,
  requestedDomain: 'mechanics',
  options: {
    startTime: quantity(250, 'ms', 'time'),
    endTime: quantity(1.5, 's', 'time'),
    timeStep: quantity(25, 'ms', 'time'),
    outputSampleRate: 40,
    solver: 'analytic',
    tolerance: { absolute: 0, relative: 1e-9 },
    maxIterations: 128,
    randomSeed: 7,
  },
  trace: simulationTraceFixture(),
})

export const derivedQuantityFixture = (value = 50): DerivedQuantity => ({
  key: 'kinetic-energy',
  targetId: 'body-fixture',
  value: quantity(value, 'J', 'energy'),
  formula: {
    id: 'kinetic-energy-law',
    expression: 'm * v^2 / 2',
    latex: '\\frac{1}{2} m v^2',
    variables: {
      m: 'objects/body-fixture/mass',
      'v/relative~frame': 'objects/body-fixture/velocity',
    },
    conditions: ['constant mass', 'inertial reference frame'],
  },
  assumptions: ['No relativistic correction.', 'No rotation.'],
  confidence: 0.875,
})

export const objectStateFixture = (): ObjectState => ({
  id: 'body-fixture',
  position: quantityVector({ x: 100, y: 20, z: 0 }, 'cm', 'length'),
  velocity: quantityVector({ x: 36, y: 0, z: 0 }, 'km/h', 'velocity'),
  acceleration: quantityVector({ x: 0, y: -9.81, z: 0 }, 'm/s^2', 'acceleration'),
  values: {
    temperature: quantity(300, 'K', 'temperature'),
    gain: quantity(0.25, '', 'dimensionless'),
    'phase/speed~native': quantity(36, 'km/h', 'velocity'),
    momentum: quantityVector({ x: 10, y: 0, z: 0 }, 'kg*m/s', 'momentum'),
    torque: quantity(2, 'N*m', 'torque'),
  },
})

export const simulationStateFixture = (timeMs = 250, energy = 50): SimulationState => ({
  time: quantity(timeMs, 'ms', 'time'),
  objects: [objectStateFixture()],
  derived: [
    derivedQuantityFixture(energy),
    {
      key: 'momentum',
      targetId: 'body-fixture',
      value: quantityVector({ x: 10, y: 0, z: 0 }, 'kg*m/s', 'momentum'),
      formula: {
        expression: 'm * velocity',
        variables: { m: 'mass', velocity: 'velocity' },
        conditions: [],
      },
      assumptions: [],
      confidence: 1,
    },
  ],
})

export const simulationEventFixture = (): PhysicsEvent<'BodyVelocityChanged'> => ({
  schemaVersion: 'physics-event/1.0',
  eventId: asPhysicsEventId('event-fixture'),
  commandId: asCommandId('command-fixture'),
  sceneId: asSceneId('scene-fixture'),
  revision: 7,
  type: 'BodyVelocityChanged',
  payload: {
    bodyId: 'body-fixture',
    velocity: quantityVector({ x: 36, y: 0, z: 0 }, 'km/h', 'velocity'),
  },
  actor: { type: 'user', id: 'user-fixture' },
  occurredAt: '2026-11-08T08:00:00.000Z',
  trace: simulationTraceFixture(),
})

/** This is an actual SimulationResult<PhysicsEvent>, not a schema-shaped assertion. */
export const simulationResultFixture = (): SimulationResult<PhysicsEvent> => ({
  schemaVersion: 'simulation-result/1.0',
  simulationId: asSimulationId('simulation-fixture'),
  sceneId: asSceneId('scene-fixture'),
  sceneRevision: 7,
  states: [simulationStateFixture(), simulationStateFixture(1500, 45)],
  events: [simulationEventFixture()],
  measurements: [
    {
      id: 'measurement-speed',
      definitionId: 'speed-meter',
      time: quantity(250, 'ms', 'time'),
      targetId: 'body-fixture',
      value: quantity(36, 'km/h', 'velocity'),
      source: 'simulation',
      metadata: {
        calibration: { offset: 0, samples: [35.5, 36, 36.5] },
        provenance: { engineId: 'fixture-engine', sceneRevision: 7 },
        notes: ['native units are retained', null],
      },
    },
    {
      id: 'measurement-force',
      definitionId: 'force-meter',
      time: quantity(1.5, 's', 'time'),
      targetId: 'body-fixture',
      value: quantityVector({ x: -5, y: 0, z: 0 }, 'N', 'force'),
      source: 'derived',
      metadata: { formula: { expression: 'm * a', assumptions: ['constant mass'] } },
    },
    {
      id: 'measurement-position',
      targetId: 'body-fixture',
      value: quantity(100, 'cm', 'length'),
      source: 'instrument',
      metadata: { instrument: { id: 'ruler', resolution: 0.1, unit: 'cm' } },
    },
    {
      id: 'measurement-gain',
      value: quantity(0.25, '', 'dimensionless'),
      source: 'user',
      metadata: { input: { text: '0.25', confirmed: true } },
    },
  ],
  derivedQuantities: [
    derivedQuantityFixture(45),
    {
      key: 'net-force',
      targetId: 'body-fixture',
      value: quantityVector({ x: -5, y: 0, z: 0 }, 'N', 'force'),
      formula: { id: 'newton-second-law', expression: 'm * a', latex: 'F = ma', variables: { m: 'mass', a: 'acceleration' } },
      assumptions: ['constant mass'],
      confidence: 0,
    },
  ],
  verification: summarizeVerification(
    [
      {
        id: 'schema-check',
        type: 'schema',
        passed: true,
        message: 'Contract fields are present.',
        targetId: 'body-fixture',
        details: { paths: ['/states/0', '/measurements/0'], schema: { version: 1 } },
      },
      {
        id: 'numeric-check',
        type: 'numerical',
        passed: true,
        details: { actual: 45, expected: 45, residual: 0, formula: { expression: 'm*v^2/2' } },
      },
      {
        id: 'conservation-check',
        type: 'conservation',
        passed: true,
        details: { before: [50, 0], after: [45, 5], tolerances: { absolute: 1e-9 } },
      },
    ],
    [{
      code: 'IDEAL_MODEL',
      severity: 'warning',
      message: 'An idealized environment was used.',
      targetId: 'body-fixture',
      details: { omitted: ['drag'], source: { kind: 'engine', version: '2.1.0' } },
    }],
    [],
  ),
  metadata: {
    engineId: 'fixture-engine',
    engineVersion: '2.1.0',
    solver: 'analytic',
    startedAt: '2026-11-08T08:00:00.000Z',
    finishedAt: '2026-11-08T08:00:00.125Z',
    durationMs: 123.4,
    deterministic: true,
    randomSeed: 7,
  },
  trace: simulationTraceFixture(),
})
