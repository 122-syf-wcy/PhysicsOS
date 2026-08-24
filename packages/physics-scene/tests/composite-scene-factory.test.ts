import { describe, expect, it } from 'vitest'
import { vec3 } from '@physicsos/physics-math'

import {
  createCompositeFieldScene,
  createMassSpectrometerScene,
  createVelocitySelectorScene,
  isCompositeFieldScene,
  sampleFieldsAt,
  validateScene,
} from '../src/index.ts'

/**
 * Composite apparatus factories, asserted on what the apparatus IS rather than on
 * how the factory is written.
 *
 * Three regressions are pinned here, all of which shipped a scene that looked
 * right in code and was wrong in the product:
 *
 *  1. The field observables targeted a synthetic id (`composite-field-1`) that no
 *     field in the scene carried, so `validateScene` failed every composite scene.
 *  2. The velocity selector defaulted to B into the page, which makes qE and qv×B
 *     point the SAME way for q > 0 and v along +x — the selector deflected the very
 *     particle it exists to pass.
 *  3. The selector and the generic composite scene defaulted E to zero, leaving a
 *     magnetic-only world that is not a composite field at all.
 */

const selectedSpeed = 2.0e4 / 0.2

describe('composite scene factories', () => {
  it('produces scenes whose observables all resolve to real objects', () => {
    for (const scene of [
      createVelocitySelectorScene(),
      createMassSpectrometerScene(),
      createCompositeFieldScene(),
      createCompositeFieldScene({ gravity: 9.8 }),
    ]) {
      const verification = validateScene(scene)
      const unresolved = verification.checks
        .filter((entry) => !entry.passed)
        .map((entry) => entry.id)
      expect(unresolved).toEqual([])
    }
  })

  it('binds each field observable to the matching field kind', () => {
    const scene = createVelocitySelectorScene()
    const ids = new Set(scene.fields.map((field) => field.id))
    const electric = scene.observableDefinitions.find((o) => o.type === 'electric_field')
    const magnetic = scene.observableDefinitions.find((o) => o.type === 'magnetic_field')
    expect(electric?.targetId).toBeDefined()
    expect(ids.has(electric?.targetId ?? '')).toBe(true)
    expect(
      scene.fields.find((field) => field.id === electric?.targetId)?.type,
    ).toBe('uniform_electric')
    expect(
      scene.fields.find((field) => field.id === magnetic?.targetId)?.type,
    ).toBe('uniform_magnetic')
  })

  it('omits the electric observable when the scene carries no electric field', () => {
    const scene = createVelocitySelectorScene({ electricFieldStrength: 0 })
    expect(scene.fields.some((field) => field.type === 'uniform_electric')).toBe(false)
    expect(scene.observableDefinitions.some((o) => o.type === 'electric_field')).toBe(false)
    expect(validateScene(scene).checks.filter((entry) => !entry.passed)).toEqual([])
  })

  it('orients the default selector so the two forces oppose at v = E/B', () => {
    const scene = createVelocitySelectorScene()
    const particle = scene.particles[0]
    expect(particle).toBeDefined()
    const charge = particle?.charge?.value ?? 0
    expect(charge).toBeGreaterThan(0)

    /* Sample inside the selector region, where both fields act. */
    const sample = sampleFieldsAt(scene, vec3(0.2, 0, 0))
    expect(sample.electricField.y).toBeGreaterThan(0)
    /* q > 0 and v along +x ⇒ qv×B opposes qE only for Bz > 0 (out of the page). */
    expect(sample.magneticFluxDensity.z).toBeGreaterThan(0)

    /* And the balance actually holds at the selected speed: F_E + qv×B = 0. */
    const e = sample.electricField.y
    const b = sample.magneticFluxDensity.z
    expect(e / b).toBeCloseTo(selectedSpeed, 6)
    const magneticY = -charge * selectedSpeed * b
    const electricY = charge * e
    expect(electricY + magneticY).toBeCloseTo(0, 20)
  })

  it('gives the default selector and composite scene a real electric field', () => {
    expect(
      createVelocitySelectorScene().fields.some((field) => field.type === 'uniform_electric'),
    ).toBe(true)
    expect(isCompositeFieldScene(createVelocitySelectorScene())).toBe(true)
    expect(isCompositeFieldScene(createCompositeFieldScene())).toBe(true)
    expect(isCompositeFieldScene(createMassSpectrometerScene())).toBe(true)
  })

  it('lays the spectrometer out as selector → field-free gap → magnetic deflection', () => {
    const scene = createMassSpectrometerScene()
    expect(scene.regions).toHaveLength(3)

    /* Selector: both fields. Gap: none. Deflection: B only. Sampled from the
       scene, so a region bound to the wrong field would fail here. */
    const selector = sampleFieldsAt(scene, vec3(0.15, 0, 0))
    expect(selector.electricField.y).not.toBe(0)
    expect(selector.magneticFluxDensity.z).not.toBe(0)

    const gap = sampleFieldsAt(scene, vec3(0.375, 0, 0))
    expect(gap.electricField.y).toBe(0)
    expect(gap.magneticFluxDensity.z).toBe(0)

    const deflection = sampleFieldsAt(scene, vec3(0.7, 0, 0))
    expect(deflection.electricField.y).toBe(0)
    expect(deflection.magneticFluxDensity.z).not.toBe(0)
  })
})
