import { describe, expect, it } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'

import { createSnapshotObject, publicCapturedResult } from '../src/data.ts'
import { canonicalStringify, copyJsonObject, freezeData, WorkbenchDataError } from '../src/json.ts'
import { readSimulationRequest, readSimulationResult, readSimulationState } from '../src/simulation-codec.ts'
import type { AnalysisDataset, CapturedResult } from '../src/types.ts'
import { simulationRequestFixture, simulationResultFixture } from './simulation-fixtures.ts'

const capturedAt = '2026-11-08T08:00:00.000Z'
const sourceScene = { kind: 'scene', digest: 'a'.repeat(64) } as const
const capture = (): CapturedResult => {
  const result = simulationResultFixture()
  const scene = createMechanicsScene({ sceneId: 'scene-fixture', model: 'uniform_linear_motion', now: capturedAt })
  scene.revision = 7
  return {
    scene, request: simulationRequestFixture(), result, state: result.states[0]!,
    clock: { time: 0.25, total: 1.5, running: false, rate: 1 },
    cursor: { kind: 'time', time: quantity(0.25, 's', 'time') },
    engineInfo: { id: result.metadata.engineId, version: result.metadata.engineVersion },
  }
}
const analysis = (): AnalysisDataset => ({
  schemaVersion: 1, kind: 'dataset', id: 'profile-fixture',
  axes: [{ id: 'x', kind: 'space', identity: 'equilibrium-x', dimension: 'length', unit: 'm',
    origin: { kind: 'absolute', value: quantity(0, 'm', 'length'), reference: 'equilibrium-zero' } }],
  metrics: [{ id: 'displacement', semanticKey: 'wave_longitudinal_displacement', component: 'scalar',
    dimension: 'length', unit: 'm', scale: { kind: 'linear' } }],
  rows: [{ rowId: 'first', axes: { x: 0.25 }, values: { displacement: 0.05 } }], conditions: [],
  origin: { sceneId: 'scene-fixture', sceneRevision: 7, simulationId: 'simulation-fixture', collection: 'analysis', analysisId: 'profile' },
})

describe('reuse of schema-validated immutable simulation evidence', () => {
  it('freezes owned reader outputs and reuses their complete evidence without another copy', () => {
    const external = simulationResultFixture()
    const result = readSimulationResult(external, '/result')
    const request = readSimulationRequest(simulationRequestFixture(), '/request')
    const state = readSimulationState(result.states[0], '/state')
    expect(result).not.toBe(external)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.states[0]!.derived[0]!.value)).toBe(true)
    expect(Object.isFrozen(result.measurements[0]!.metadata)).toBe(true)
    expect(Object.isFrozen(request.options)).toBe(true)
    expect(Object.isFrozen(state.objects[0]!.velocity)).toBe(true)
    expect(readSimulationResult(result, '/again')).toBe(result)
    expect(readSimulationRequest(request, '/again')).toBe(request)
    expect(readSimulationState(state, '/again')).toBe(state)
    expect(state).toBe(result.states[0])
    expect(result.states).toHaveLength(2)
    expect(result.measurements[0]!.value).toEqual(quantity(36, 'km/h', 'velocity'))
  })

  it('revalidates a previously accepted mutable external identity and preserves the earlier owned output', () => {
    const external = simulationResultFixture()
    const first = readSimulationResult(external, '/result')
    external.states[0]!.time.value = 500
    const second = readSimulationResult(external, '/result')
    expect(second).not.toBe(first)
    expect(second.states[0]!.time.value).toBe(500)
    expect(first.states[0]!.time.value).toBe(250)
    external.states[0]!.time.value = Number.NaN
    expect(() => readSimulationResult(external, '/result')).toThrow(WorkbenchDataError)
    expect(Object.isFrozen(external.states[0]!.time)).toBe(false)
  })

  it('does not grant schema trust to caller-frozen or generic canonical JSON', () => {
    const result = simulationResultFixture()
    const invalid = { ...result, states: [{ ...result.states[0], time: { value: 250, unit: 'm', dimension: 'length' } }] }
    expect(() => readSimulationResult(freezeData(invalid), '/result')).toThrow(WorkbenchDataError)
    const canonical = copyJsonObject({ ...result, schemaVersion: 'simulation-result/999.0' })
    expect(Object.isFrozen(canonical)).toBe(true)
    expect(() => readSimulationResult(canonical, '/result')).toThrow(WorkbenchDataError)
  })

  it('rejects executable fields on caller-frozen inputs without invoking them', () => {
    const result = simulationResultFixture()
    let reads = 0
    Object.defineProperty(result.states[0], 'time', { enumerable: true, get: () => { reads += 1; return quantity(0.25, 's', 'time') } })
    Object.freeze(result.states[0])
    Object.freeze(result)
    expect(() => readSimulationResult(result, '/result')).toThrow(WorkbenchDataError)
    expect(reads).toBe(0)
  })

  it('reuses immutable result data across cursor envelopes while preserving historical snapshots', () => {
    const first = publicCapturedResult(capture())
    const historical = createSnapshotObject({ ...first, sceneRef: sourceScene, instanceId: 'instance-fixture',
      instanceEditRevision: 3, capturedAt, source: 'client-engine', datasets: [] })
    const bytes = canonicalStringify(historical)
    const later = publicCapturedResult({ ...first, state: first.result!.states[1]!,
      clock: { ...first.clock, time: 1.5 }, cursor: { kind: 'time', time: quantity(1.5, 's', 'time') } })
    expect(later.result).toBe(first.result)
    expect(later.request).toBe(first.request)
    expect(later.state).toBe(first.result!.states[1])
    expect(historical.result).toBe(first.result)
    expect(later.clock.time).toBe(1.5)
    expect(historical.clock.time).toBe(0.25)
    expect(historical.capturedState?.time.value).toBe(250)
    expect(canonicalStringify(historical)).toBe(bytes)
  })

  it('still validates envelope associations and object references around trusted result subtrees', () => {
    const trusted = publicCapturedResult(capture())
    expect(() => publicCapturedResult({ ...trusted, scene: { ...trusted.scene, revision: 8 } })).toThrow(WorkbenchDataError)
    expect(() => publicCapturedResult({ ...trusted, engineInfo: { ...trusted.engineInfo, version: 'different' } })).toThrow(WorkbenchDataError)
    expect(() => publicCapturedResult({ ...trusted, clock: { ...trusted.clock, time: 1.5 } })).toThrow(WorkbenchDataError)
    expect(() => createSnapshotObject({ ...trusted, sceneRef: { kind: 'scene', digest: 'not-a-digest' },
      instanceId: 'instance-fixture', instanceEditRevision: 3, capturedAt, source: 'client-engine', datasets: [] })).toThrow(WorkbenchDataError)
  })

  it('reuses already validated frozen analysis rows when republishing an immutable capture', () => {
    const first = publicCapturedResult({ ...capture(), analysis: [analysis()] })
    const profile = first.analysis![0]!
    expect(Object.isFrozen(profile.rows[0]!.values)).toBe(true)
    const again = publicCapturedResult({ ...first })
    expect(again.analysis![0]).toBe(profile)
    expect(again.analysis![0]!.rows).toBe(profile.rows)
    expect(profile.rows[0]!.values.displacement).toBe(0.05)
    expect(() => publicCapturedResult({ ...first, analysis: [{ ...profile, origin: { ...profile.origin, sceneRevision: 8 } }] })).toThrow(WorkbenchDataError)
  })

  it('revalidates mutable and caller-canonical analyses rather than trusting their previous identities or JSON provenance', () => {
    const external = analysis()
    const first = publicCapturedResult({ ...capture(), analysis: [external] })
    expect(Reflect.set(external.rows[0]!.values, 'displacement', 0.075)).toBe(true)
    const changed = publicCapturedResult({ ...capture(), analysis: [external] })
    expect(changed.analysis![0]!.rows[0]!.values.displacement).toBe(0.075)
    expect(first.analysis![0]!.rows[0]!.values.displacement).toBe(0.05)
    expect(Reflect.set(external.metrics[0]!, 'unit', 'not-a-unit')).toBe(true)
    expect(() => publicCapturedResult({ ...capture(), analysis: [external] })).toThrow(WorkbenchDataError)
    const forged = copyJsonObject({ ...analysis(), schemaVersion: 999 }) as unknown as AnalysisDataset
    expect(() => publicCapturedResult({ ...capture(), analysis: [forged] })).toThrow(WorkbenchDataError)
  })
})
