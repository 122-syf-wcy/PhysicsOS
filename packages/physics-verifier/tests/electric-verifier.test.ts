import { describe, expect, it } from 'vitest'
import { vec3 } from '@physicsos/physics-math'
import {
  createPointChargeScene,
  type PointChargeInput,
  type ProbeParticleInput,
} from '@physicsos/physics-scene'
import type { SimulationResult, VerificationResult } from '@physicsos/physics-core'

import { ElectricEngine, createElectricSimulationRequest } from '../../engine-electric/src/index.ts'
import { verifyElectricSimulation } from '../src/index.ts'

/**
 * Electric verifier per-check-id coverage. The four spec-point-5 checks
 * (`electric_field_1_over_r2`, `electric_field_direction`,
 * `electric_field_superposition`, `electric_force_qE`) are asserted by name, and
 * each is shown to FAIL under targeted corruption — proving the check genuinely
 * consumes the engine output rather than self-comparing a library constant.
 */

const probeAt = (position: { x: number; y: number; z: number }): ProbeParticleInput => ({
  id: 'probe-1',
  charge: 1e-9,
  mass: 1,
  position,
})

const run = (charges: readonly PointChargeInput[], probe?: ProbeParticleInput, now = '2026-08-22T00:00:00.000Z') => {
  const scene = createPointChargeScene({
    sceneId: 'verifier-test',
    charges,
    ...(probe === undefined ? {} : { probe }),
    now,
  })
  const engine = new ElectricEngine()
  const result = engine.simulate(scene, createElectricSimulationRequest(scene, 'sim-v', 'trace-v'))
  return { scene, result }
}

const checkIdOf = (verification: VerificationResult, id: string) =>
  verification.checks.find((c) => c.id === id)

const failingIdsOf = (verification: VerificationResult): string[] =>
  verification.checks.filter((c) => !c.passed).map((c) => c.id)

/** Tamper a derived vector on the state's derived array (where the verifier reads from). */
const tamperVector = (result: SimulationResult, key: string, vector: { x: number; y: number; z: number }): SimulationResult => ({
  ...result,
  states: result.states.map((state) => ({
    ...state,
    derived: state.derived.map((entry) =>
      entry.key !== key || !('vector' in entry.value)
        ? entry
        : { ...entry, value: { ...entry.value, vector } },
    ),
  })),
})

/** Tamper a derived scalar on the state's derived array. */
const tamperScalar = (result: SimulationResult, key: string, value: number): SimulationResult => ({
  ...result,
  states: result.states.map((state) => ({
    ...state,
    derived: state.derived.map((entry) =>
      entry.key !== key || !('value' in entry.value)
        ? entry
        : { ...entry, value: { ...entry.value, value } },
    ),
  })),
})

describe('verifyElectricSimulation — point-charge per-check coverage', () => {
  it('passes all four named checks for a clean single positive charge (E1)', () => {
    const { result } = run(
      [{ id: 'q1', charge: 5e-6, position: vec3(0, 0, 0) }],
      probeAt(vec3(0.2, 0, 0)),
    )
    const v = result.verification
    expect(v.status).toBe('passed')
    expect(failingIdsOf(v)).toEqual([])
    expect(checkIdOf(v, 'electric_field_1_over_r2')?.passed).toBe(true)
    expect(checkIdOf(v, 'electric_field_direction')?.passed).toBe(true)
    expect(checkIdOf(v, 'electric_force_qE')?.passed).toBe(true)
  })

  it('passes the direction check for a negative charge (field points toward, E2)', () => {
    const { result } = run(
      [{ id: 'q1', charge: -5e-6, position: vec3(0, 0, 0) }],
      probeAt(vec3(0.2, 0, 0)),
    )
    const v = result.verification
    expect(v.status).toBe('passed')
    expect(checkIdOf(v, 'electric_field_direction')?.passed).toBe(true)
  })

  it('passes for an asymmetric two-charge superposition (the E3 regression)', () => {
    /* This scene previously failed verification because the direction check
       compared the superposed total field against the radial ray of one source.
       The engine reports the physically correct E = (-3.24e7, 0, 0) V/m here. */
    const { result } = run(
      [
        { id: 'q1', charge: 1e-6, position: vec3(0, 0, 0) },
        { id: 'q2', charge: 10e-6, position: vec3(0.1, 0, 0) },
      ],
      probeAt(vec3(0.05, 0, 0)),
    )
    const v = result.verification
    expect(v.status).toBe('passed')
    expect(failingIdsOf(v)).toEqual([])
  })

  it('detects a tampered electric_field_magnitude (fails 1/r² + magnitude_matches)', () => {
    const { scene, result } = run(
      [{ id: 'q1', charge: 5e-6, position: vec3(0, 0, 0) }],
      probeAt(vec3(0.2, 0, 0)),
    )
    const dirty = verifyElectricSimulation(scene, tamperScalar(result, 'electric_field_magnitude', 42))
    expect(dirty.status).toBe('failed')
    expect(checkIdOf(dirty, 'electric_field_1_over_r2')?.passed).toBe(false)
    expect(checkIdOf(dirty, 'electric_field_magnitude_matches')?.passed).toBe(false)
  })

  it('detects a tampered electric_field_vector (fails superposition + vector_matches)', () => {
    const { scene, result } = run(
      [
        { id: 'q1', charge: 5e-6, position: vec3(-0.1, 0, 0) },
        { id: 'q2', charge: 5e-6, position: vec3(0.1, 0, 0) },
      ],
      probeAt(vec3(0, 0.2, 0)),
    )
    const dirty = verifyElectricSimulation(scene, tamperVector(result, 'electric_field_vector', { x: 12345, y: -999, z: 7 }))
    expect(dirty.status).toBe('failed')
    /* Superposition only runs for ≥2 sources; this scene has two, so it must fail. */
    expect(checkIdOf(dirty, 'electric_field_superposition')?.passed).toBe(false)
    expect(checkIdOf(dirty, 'electric_field_vector_matches')?.passed).toBe(false)
  })

  it('detects a tampered electric_field_vector on a single source (fails direction)', () => {
    const { scene, result } = run(
      [{ id: 'q1', charge: 5e-6, position: vec3(0, 0, 0) }],
      probeAt(vec3(0.2, 0, 0)),
    )
    /* Rotate the field 90° off the radial: direction check should fail. */
    const dirty = verifyElectricSimulation(scene, tamperVector(result, 'electric_field_vector', { x: 0, y: 1e6, z: 0 }))
    expect(dirty.status).toBe('failed')
    expect(checkIdOf(dirty, 'electric_field_direction')?.passed).toBe(false)
    expect(checkIdOf(dirty, 'electric_field_vector_matches')?.passed).toBe(false)
  })

  it('detects a tampered electric_force_vector (fails F=qE)', () => {
    const { scene, result } = run(
      [{ id: 'q1', charge: 5e-6, position: vec3(0, 0, 0) }],
      probeAt(vec3(0.2, 0, 0)),
    )
    const dirty = verifyElectricSimulation(scene, tamperVector(result, 'electric_force_vector', { x: 0, y: 999, z: 0 }))
    expect(dirty.status).toBe('failed')
    expect(checkIdOf(dirty, 'electric_force_qE')?.passed).toBe(false)
  })

  it('verifies a no-probe scene (field sampled at a declared point)', () => {
    const { result } = run([{ id: 'q1', charge: 5e-6, position: vec3(0, 0, 0) }])
    const v = result.verification
    expect(v.status).toBe('passed')
    expect(checkIdOf(v, 'electric_field_1_over_r2')?.passed).toBe(true)
    expect(checkIdOf(v, 'electric_field_direction')?.passed).toBe(true)
  })
})
