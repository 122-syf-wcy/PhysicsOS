import { describe, expect, it } from 'vitest'
import { createCompositeFieldScene, createVelocitySelectorScene } from '@physicsos/physics-scene'

import { createCompositeWorkspaceRuntime } from '../src/client/physics/composite-workspace-runtime.ts'

describe('composite workspace runtime · magnetic field visual presence', () => {
  it.each(['into_page', 'out_of_page'] as const)(
    'omits the zero-strength region lattice for %s while retaining its apparatus and E field',
    magneticFieldOrientation => {
      const runtime = createCompositeWorkspaceRuntime(createVelocitySelectorScene({
        magneticFieldStrength: 0,
        magneticFieldOrientation,
      }))
      const regions = runtime.getSnapshot().view.compositeRegions
      expect(regions).toHaveLength(1)
      const selector = regions?.[0]
      expect(selector?.id).toBe('selector-region-1')
      expect(selector?.at).toEqual({ x: 0.2, y: 0 })
      expect(selector?.width).toBe(0.4)
      expect(selector?.height).toBe(0.2)
      expect(selector?.electricField?.direction).toEqual({ x: 0, y: 1 })
      expect(selector?.magneticField).toBeUndefined()
    },
  )

  it.each([
    ['into_page', 'into-page'],
    ['out_of_page', 'out-of-page'],
  ] as const)('preserves the nonzero %s direction', (magneticFieldOrientation, direction) => {
    const runtime = createCompositeWorkspaceRuntime(createVelocitySelectorScene({
      magneticFieldStrength: 0.2,
      magneticFieldOrientation,
    }))
    const field = runtime.getSnapshot().view.compositeRegions?.[0]?.magneticField
    expect(field?.direction).toBe(direction)
    expect(field?.spacing).toBeGreaterThan(0)
  })

  it('keeps the existing zero-strength global-field omission', () => {
    const runtime = createCompositeWorkspaceRuntime(createCompositeFieldScene({ magneticFieldStrength: 0 }))
    expect(runtime.getSnapshot().view.field).toBeUndefined()
  })
})
