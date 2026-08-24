import { describe, expect, it } from 'vitest'
import { vec3 } from '@physicsos/physics-math'
import {
  createElectricScene,
  createPointChargeScene,
  type PointChargeInput,
  type ProbeParticleInput,
} from '@physicsos/physics-scene'
import { verifyElectricSimulation } from '@physicsos/physics-verifier'

import { ElectricEngine, createElectricSimulationRequest } from '../src/index.ts'
import { resolveSourceCharges, samplePotentialGrid, solvePotentialAt } from '../src/field-solver.ts'

const probeAt = (position: { x: number; y: number; z: number }): ProbeParticleInput => ({
  id: 'probe-1',
  charge: 1e-9,
  mass: 1,
  position,
})

const runPointCharge = (charges: readonly PointChargeInput[], probe?: ProbeParticleInput) => {
  const scene = createPointChargeScene({
    sceneId: 'pc-test',
    charges,
    ...(probe === undefined ? {} : { probe }),
    now: '2026-08-21T00:00:00.000Z',
  })
  const engine = new ElectricEngine()
  const support = engine.canHandle(scene)
  const result = engine.simulate(scene, createElectricSimulationRequest(scene, 'sim-pc', 'trace-pc'))
  return { scene, support, result, engine }
}

describe('Electric Engine point-charge runtime', () => {
  it('canHandle accepts a single positive source with a probe', () => {
    const { support } = runPointCharge(
      [{ id: 'q1', charge: 5e-6, position: vec3(0, 0, 0) }],
      probeAt(vec3(0.2, 0, 0)),
    )
    expect(support.supported).toBe(true)
    expect(support.modelId).toBe('point_charge_electrostatic_field')
  })

  it('passes engine verify for a positive source and probe (E1)', () => {
    const { result } = runPointCharge(
      [{ id: 'q1', charge: 5e-6, position: vec3(0, 0, 0) }],
      probeAt(vec3(0.2, 0, 0)),
    )
    expect(result.verification.status).toBe('passed')
    expect(result.verification.checks.filter((c) => !c.passed).map((c) => c.id)).toEqual([])
  })

  it('passes verify for a negative source (direction flips, E2)', () => {
    const { result } = runPointCharge(
      [{ id: 'q1', charge: -5e-6, position: vec3(0, 0, 0) }],
      probeAt(vec3(0.2, 0, 0)),
    )
    expect(result.verification.status).toBe('passed')
  })

  it('passes verify for two sources (superposition, E3)', () => {
    const { result } = runPointCharge(
      [
        { id: 'q1', charge: 5e-6, position: vec3(-0.1, 0, 0) },
        { id: 'q2', charge: 5e-6, position: vec3(0.1, 0, 0) },
      ],
      probeAt(vec3(0, 0.2, 0)),
    )
    expect(result.verification.status).toBe('passed')
  })

  it('passes verify with no probe (field sampled at a declared point)', () => {
    const { result } = runPointCharge([{ id: 'q1', charge: 5e-6, position: vec3(0, 0, 0) }])
    expect(result.verification.status).toBe('passed')
  })

  it('reports the textbook E for q=5μC at r=20cm', () => {
    const { result } = runPointCharge([{ id: 'q1', charge: 5e-6, position: vec3(0, 0, 0) }])
    const magnitude = result.derivedQuantities.find((d) => d.key === 'electric_field_magnitude')
    /* E = kq/r² = 8.9876e9 × 5e-6 / 0.04 ≈ 1.1234e6 V/m. The textbook value
       1.125e6 is a rounded form; assert against the computed value, not the round number. */
    expect(magnitude && 'value' in magnitude.value && magnitude.value.value).toBeCloseTo(1_123_443.974, -2)
  })

  it('detects a tampered point-charge field magnitude', () => {
    const { scene, result } = runPointCharge(
      [{ id: 'q1', charge: 5e-6, position: vec3(0, 0, 0) }],
      probeAt(vec3(0.2, 0, 0)),
    )
    /* The verifier reads field magnitude from the state's derived array, not the
       result's derivedQuantities, so tampering must hit the state. */
    const field = result.states[0]?.derived.find((d) => d.key === 'electric_field_magnitude')
    if (field === undefined || !('value' in field.value)) throw new Error('Expected field magnitude.')
    field.value.value += 1e6
    const indep = verifyElectricSimulation(scene, result)
    expect(indep.status).toBe('failed')
  })

  it('does not regress the uniform-field path', () => {
    const scene = createElectricScene({ charge: 2, mass: 4, position: vec3(0, 0, 0), velocity: vec3(1, 0, 0), electricFieldStrength: 6, electricFieldDirection: 'up', duration: 2, now: '2026-08-19T00:00:00.000Z' })
    const engine = new ElectricEngine()
    const result = engine.simulate(scene, createElectricSimulationRequest(scene, 'sim-uniform', 'trace-uniform'))
    expect(result.verification.status).toBe('passed')
  })

  it('samplePotentialGrid reports zero potential at the midpoint of an unlike pair', () => {
    /* +2 μC at x = -0.1 and -2 μC at x = +0.1: V at the origin cancels (kq/r + k(-q)/r = 0). */
    const { scene } = runPointCharge(
      [
        { id: 'q1', charge: 2e-6, position: vec3(-0.1, 0, 0) },
        { id: 'q2', charge: -2e-6, position: vec3(0.1, 0, 0) },
      ],
      probeAt(vec3(0, 0, 0)),
    )
    const charges = resolveSourceCharges(scene)
    /* A 1×1 grid centered exactly at the origin: the cell center is (0, 0), so the
       symmetric pair cancels to zero. */
    const grid = samplePotentialGrid(charges, {
      origin: { x: -0.001, y: -0.001 },
      width: 0.002,
      height: 0.002,
      columns: 1,
      rows: 1,
      minRadius: 0.02,
    })
    expect(grid.values[0]).toBeCloseTo(0, 5)
    /* A point well away from both sources agrees with solvePotentialAt. A grid cell
       samples the potential at the cell CENTER (origin + cellSize/2), not the origin
       corner, so the comparison point must be the cell center — otherwise the steep
       gradient away from the sources makes a tiny corner offset diverge. */
    const farGrid = samplePotentialGrid(charges, {
      origin: { x: 0.4, y: 0.28 },
      width: 0.0001,
      height: 0.0001,
      columns: 1,
      rows: 1,
      minRadius: 0.02,
    })
    const farCenter = vec3(
      farGrid.origin.x + farGrid.cellSize.x * 0.5,
      farGrid.origin.y + farGrid.cellSize.y * 0.5,
      0,
    )
    expect(farGrid.values[0]).toBeCloseTo(solvePotentialAt(charges, farCenter), 3)
  })
})
