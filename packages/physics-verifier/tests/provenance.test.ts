import { describe, expect, it } from 'vitest'
import {
  assertVerifiedPhysicsOutput,
  check,
  summarizeVerification,
  type QuantityProvenance,
  type SimulationResult,
} from '@physicsos/physics-core'
import { asSceneId, asSimulationId, asTraceId } from '@physicsos/shared'

import {
  engineVerifierId,
  PHYSICS_VERIFIER_ID,
  provenanceForSimulation,
  quantityProvenance,
  SCENE_VALIDATOR_ID,
} from '../src/index.ts'

const finishedAt = '2026-09-27T09:00:00.000Z'
const finishedMs = Date.parse(finishedAt)

const simulationWith = (
  verification: SimulationResult['verification'],
  overrides: Partial<SimulationResult['metadata']> = {},
): SimulationResult => ({
  schemaVersion: 'simulation-result/1.0',
  simulationId: asSimulationId('sim-1'),
  sceneId: asSceneId('scene-1'),
  sceneRevision: 7,
  states: [],
  events: [],
  measurements: [],
  derivedQuantities: [],
  verification,
  metadata: {
    engineId: 'engine-mechanics',
    engineVersion: '9.9.9',
    startedAt: '2026-09-27T08:59:59.000Z',
    finishedAt,
    durationMs: 3,
    deterministic: true,
    ...overrides,
  },
  trace: { traceId: asTraceId('trace-1') },
})

describe('provenanceForSimulation', () => {
  it('records engine, scene revision, verifier and the evidence-derived level', () => {
    const simulation = simulationWith(
      summarizeVerification(
        [check('newton_second_law', 'numerical', true), check('speed_conservation', 'conservation', true)],
        [],
        [],
      ),
    )
    const provenance = provenanceForSimulation(simulation)
    expect(provenance.engineId).toBe('engine-mechanics')
    expect(provenance.engineVersion).toBe('9.9.9')
    expect(provenance.sceneId).toBe('scene-1')
    expect(provenance.sceneRevision).toBe(7)
    expect(provenance.verifierId).toBe(engineVerifierId('engine-mechanics'))
    /* Derived from the two strong families the verifier actually passed. */
    expect(provenance.verificationLevel).toBe('STRONGLY_VERIFIED')
    expect(provenance.verifiedAt).toBe(finishedMs)
    /* Evidence is the compact, lossless projection — never the raw check details. */
    expect(provenance.evidence).toHaveLength(2)
    expect(Object.keys(provenance.evidence[0] ?? {}).sort()).toEqual(['id', 'passed', 'type'])
  })

  it('degrades the level when the verifier passed nothing', () => {
    const provenance = provenanceForSimulation(
      simulationWith(summarizeVerification([check('newton_second_law', 'numerical', false)], [], [])),
    )
    expect(provenance.verificationLevel).toBe('ENGINE_COMPUTED')
  })

  it('names the external verifier when the caller supplies one', () => {
    const provenance = provenanceForSimulation(
      simulationWith(
        summarizeVerification([check('speed_conservation', 'conservation', true)], [], []),
      ),
      { verifierId: PHYSICS_VERIFIER_ID },
    )
    expect(provenance.verifierId).toBe(PHYSICS_VERIFIER_ID)
    expect(provenance.verificationLevel).toBe('CONSERVATION_VERIFIED')
  })

  it('is lossless JSON even when a check carried a -0 vector in its details', () => {
    const withDetails = summarizeVerification(
      [
        check('newton_second_law', 'numerical', true, {
          details: { netForce: { x: -0, y: 0, z: 0 }, diff: -0 },
        }),
      ],
      [],
      [],
    )
    const provenance = provenanceForSimulation(simulationWith(withDetails))
    expect(JSON.parse(JSON.stringify(provenance))).toEqual(provenance)
  })

  it('produces provenance the product gate accepts', () => {
    const provenance = provenanceForSimulation(
      simulationWith(
        summarizeVerification([check('newton_second_law', 'numerical', true)], [], []),
      ),
    )
    expect(() =>
      assertVerifiedPhysicsOutput({ values: [{ value: 1.5, unit: 'm', provenance }] }),
    ).not.toThrow()
  })
})

describe('quantityProvenance', () => {
  it('derives the level from evidence and honours an explicit verifier and time', () => {
    const provenance: QuantityProvenance = quantityProvenance({
      engineId: 'engine-circuit',
      engineVersion: '2.0.0',
      sceneId: 'scene-2',
      sceneRevision: 0,
      verifierId: SCENE_VALIDATOR_ID,
      evidence: [check('circuit_ohm', 'constraint', true)],
      verifiedAt: 42,
    })
    expect(provenance.verificationLevel).toBe('RULE_VERIFIED')
    expect(provenance.verifiedAt).toBe(42)
    expect(provenance.verifierId).toBe(SCENE_VALIDATOR_ID)
  })
})
