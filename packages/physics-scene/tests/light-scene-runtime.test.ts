import { describe, expect, it } from 'vitest'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'

import {
  SceneRuntime,
  createPinholeScene,
  createSceneCommand,
  createTotalReflectionScene,
  validateScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '../src/index.ts'

const now = '2026-11-08T00:00:00.000Z'
const execute = <T extends SceneCommandType>(runtime: SceneRuntime, type: T, payload: SceneCommandPayloadMap[T]) => {
  const scene = runtime.peekScene()
  return runtime.execute(createSceneCommand({
    commandId: `light-${type}-${scene.revision}`,
    sceneId: String(scene.id), expectedRevision: scene.revision,
    type, payload, traceId: `light-${type}`, issuedAt: now,
  }) as SceneCommand)
}
const benchIdOf = (runtime: SceneRuntime) => runtime.peekScene().lightBenches![0]!.id

describe('light scene angle command bounds', () => {
  it.each(['deg', 'rad'])('accepts true normal incidence at zero %s and records a revisioned event', unit => {
    const source = createTotalReflectionScene({ incidentAngle: 45, now })
    const before = structuredClone(source)
    const runtime = new SceneRuntime(source, { now: () => now })
    const angle = quantity(0, unit, 'angle')
    const benchId = benchIdOf(runtime)
    const result = execute(runtime, 'SetIncidentAngle', { benchId, angle })
    expect(result.ok).toBe(true)
    expect(runtime.peekScene().revision).toBe(source.revision + 1)
    expect(runtime.peekScene().lightBenches![0]!.incidentAngle).toEqual(angle)
    expect(canonicalValue(runtime.peekScene().lightBenches![0]!.incidentAngle!)).toBe(0)
    expect(runtime.getEvents()).toContainEqual(expect.objectContaining({
      type: 'IncidentAngleChanged', payload: { benchId, angle }, revision: source.revision + 1,
    }))
    expect(validateScene(runtime.peekScene()).status).toBe('passed')
    expect(source).toEqual(before)
  })

  it.each([
    { value: -1, unit: 'deg', dimension: 'angle' },
    { value: -0.01, unit: 'rad', dimension: 'angle' },
    { value: 90, unit: 'deg', dimension: 'angle' },
    { value: Math.PI / 2, unit: 'rad', dimension: 'angle' },
    { value: 180, unit: 'deg', dimension: 'angle' },
    { value: NaN, unit: 'deg', dimension: 'angle' },
    { value: Infinity, unit: 'rad', dimension: 'angle' },
  ] as const)('rejects invalid incidence %j without committing or emitting an event', angle => {
    const runtime = new SceneRuntime(createTotalReflectionScene({ now }), { now: () => now })
    const before = runtime.peekScene()
    expect(execute(runtime, 'SetIncidentAngle', { benchId: benchIdOf(runtime), angle }).ok).toBe(false)
    expect(runtime.peekScene()).toBe(before)
    expect(runtime.getEvents()).toEqual([])
  })

  it('still rejects a non-angle quantity and a pinhole target without coercion', () => {
    const refraction = new SceneRuntime(createTotalReflectionScene({ now }), { now: () => now })
    const before = refraction.peekScene()
    const wrongDimension = execute(refraction, 'SetIncidentAngle', {
      benchId: benchIdOf(refraction), angle: quantity(0, 'm', 'length') as unknown as Quantity<'angle'>,
    })
    expect(wrongDimension.ok).toBe(false)
    if (wrongDimension.ok) throw new Error('Expected a dimension rejection.')
    expect(wrongDimension.error.code).toBe('DIMENSION_MISMATCH')
    expect(refraction.peekScene()).toBe(before)
    const pinhole = new SceneRuntime(createPinholeScene({ now }), { now: () => now })
    const pinholeBefore = pinhole.peekScene()
    expect(execute(pinhole, 'SetIncidentAngle', { benchId: benchIdOf(pinhole), angle: quantity(0, 'deg', 'angle') }).ok).toBe(false)
    expect(pinhole.peekScene()).toBe(pinholeBefore)
  })

  it.each(['SetObjectHeight', 'SetObjectDistance', 'SetScreenDistance'] as const)(
    'keeps %s lengths strictly positive', type => {
      const runtime = new SceneRuntime(createPinholeScene({ now }), { now: () => now })
      const before = runtime.peekScene()
      const benchId = benchIdOf(runtime)
      const zero = quantity(0, 'cm', 'length')
      const payload = type === 'SetObjectHeight' ? { benchId, height: zero } : { benchId, distance: zero }
      expect(execute(runtime, type, payload).ok).toBe(false)
      expect(runtime.peekScene()).toBe(before)
      expect(runtime.getEvents()).toEqual([])
    },
  )

  it.each(['SetIncidentIndex', 'SetRefractedIndex'] as const)('keeps %s zero indices invalid', type => {
    const runtime = new SceneRuntime(createTotalReflectionScene({ now }), { now: () => now })
    const before = runtime.peekScene()
    expect(execute(runtime, type, { benchId: benchIdOf(runtime), index: quantity(0, '', 'dimensionless') }).ok).toBe(false)
    expect(runtime.peekScene()).toBe(before)
    expect(runtime.getEvents()).toEqual([])
  })
})
