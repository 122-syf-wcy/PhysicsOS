import { describe, expect, it } from 'vitest'
import { vec3 } from '@physicsos/physics-math'
import {
  createMassSpectrometerScene,
  createVelocitySelectorScene,
} from '@physicsos/physics-scene'

import { CompositeEngine, createCompositeSimulationRequest } from '../../engine-composite/src/index.ts'
import {
  isCompositeVerifiableScene,
  reportCompositeSelection,
  verifyCompositeApparatus,
} from '../src/index.ts'

/**
 * Composite apparatus verifier.
 *
 * The point of these tests is the separation the product depends on: the
 * selection condition is a READOUT that legitimately fails when v ≠ E/B, while
 * the ENGINE's own law verification stays passed in both cases. A test that only
 * asserted "balanced when balanced" would not catch a verifier that had been
 * wired into the status gate.
 */

const engine = new CompositeEngine()

const run = (scene: ReturnType<typeof createVelocitySelectorScene>) => {
  const request = createCompositeSimulationRequest(scene, 'sim-verifier', 'trace-verifier')
  return engine.simulate(scene, request)
}

/* E = 2.0e4 V/m, B = 0.20 T ⇒ the apparatus selects v = 1.0e5 m/s. */
const SELECTED_SPEED = 2.0e4 / 0.2

describe('composite apparatus verifier', () => {
  it('recognizes a crossed-field scene as verifiable', () => {
    expect(isCompositeVerifiableScene(createVelocitySelectorScene())).toBe(true)
    expect(isCompositeVerifiableScene(createMassSpectrometerScene())).toBe(true)
  })

  it('passes the selection condition exactly at v = E/B', () => {
    const scene = createVelocitySelectorScene({
      velocity: vec3(SELECTED_SPEED, 0, 0),
      electricFieldStrength: 2.0e4,
      magneticFieldStrength: 0.2,
    })
    const simulation = run(scene)
    const report = reportCompositeSelection(scene, simulation)

    expect(report.evaluated).toBe(true)
    expect(report.selectedVelocity).toBeCloseTo(SELECTED_SPEED, 6)
    expect(report.particleSpeed).toBeCloseTo(SELECTED_SPEED, 6)
    expect(report.balanced).toBe(true)
    /* |qE| and |qvB| are equal and opposite, so the net force vanishes. */
    expect(report.netForceMagnitude).toBeLessThan(report.electricForceMagnitude * 1e-6)

    const verification = verifyCompositeApparatus(scene, simulation)
    const selection = verification.checks.find((c) => c.id === 'velocity_selection_condition')
    expect(selection?.passed).toBe(true)
  })

  it('fails the selection condition when the particle is too fast, without failing the engine', () => {
    const scene = createVelocitySelectorScene({
      velocity: vec3(SELECTED_SPEED * 2, 0, 0),
      electricFieldStrength: 2.0e4,
      magneticFieldStrength: 0.2,
    })
    const simulation = run(scene)
    const report = reportCompositeSelection(scene, simulation)

    expect(report.evaluated).toBe(true)
    expect(report.balanced).toBe(false)
    /* Too fast ⇒ the magnetic force wins, so the residual is negative. */
    expect(report.magneticForceMagnitude).toBeGreaterThan(report.electricForceMagnitude)
    expect(report.relativeResidual).toBeLessThan(0)

    const verification = verifyCompositeApparatus(scene, simulation)
    expect(verification.checks.find((c) => c.id === 'velocity_selection_condition')?.passed).toBe(false)
    /* The physics is still right: a deflecting beam is a correct outcome, so the
       engine's own verification must not be dragged down by the readout. */
    expect(simulation.verification.status === 'passed' || simulation.verification.status === 'passed_with_warnings').toBe(true)
  })

  it('fails the selection condition when the particle is too slow', () => {
    const scene = createVelocitySelectorScene({
      velocity: vec3(SELECTED_SPEED / 2, 0, 0),
      electricFieldStrength: 2.0e4,
      magneticFieldStrength: 0.2,
    })
    const simulation = run(scene)
    const report = reportCompositeSelection(scene, simulation)

    expect(report.balanced).toBe(false)
    /* Too slow ⇒ the electric force wins, so the residual is positive. */
    expect(report.electricForceMagnitude).toBeGreaterThan(report.magneticForceMagnitude)
    expect(report.relativeResidual).toBeGreaterThan(0)
  })

  it('reports the deflection radius for a mass spectrometer', () => {
    const scene = createMassSpectrometerScene({
      velocity: vec3(SELECTED_SPEED, 0, 0),
      electricFieldStrength: 2.0e4,
      magneticFieldStrength: 0.2,
    })
    const simulation = run(scene)
    const verification = verifyCompositeApparatus(scene, simulation)

    const radius = verification.checks.find((c) => c.id === 'magnetic_deflection_radius_defined')
    expect(radius?.passed).toBe(true)
    /* r = mv/|q|B with the proton defaults: 1.67e-27 × 1e5 / (1.6e-19 × 0.2). */
    const expected = (1.67e-27 * SELECTED_SPEED) / (1.6e-19 * 0.2)
    expect(radius?.details?.['radius']).toBeCloseTo(expected, 6)
  })

  it('does not judge a balance the particle never experienced', () => {
    /* A scene whose particle never reaches the crossed-field region: the report
       must say "not evaluated" rather than reporting a balanced zero measured in
       empty space. */
    const scene = createVelocitySelectorScene({
      position: vec3(-10, 0, 0),
      velocity: vec3(1, 0, 0),
      duration: 1e-6,
    })
    const simulation = run(scene)
    const report = reportCompositeSelection(scene, simulation)
    expect(report.evaluated).toBe(false)
    expect(report.balanced).toBe(false)
    const verification = verifyCompositeApparatus(scene, simulation)
    expect(verification.checks.find((c) => c.id === 'velocity_selection_condition')).toBeUndefined()
  })
})
