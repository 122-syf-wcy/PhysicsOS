import { describe, expect, it } from 'vitest'
import { createBarMotionScene } from '@physicsos/physics-scene'

import { createInductionWorkspaceRuntime } from '../src/client/physics/induction-workspace-runtime.ts'

describe('induction bar rig · fixed laboratory apparatus', () => {
  it.each([2, -2, 0])('keeps the closure, rails and uniform field fixed for v = %s m/s', barVelocity => {
    const runtime = createInductionWorkspaceRuntime(createBarMotionScene({ barVelocity }))
    const before = runtime.getSnapshot().view
    const initialBar = before.inductionBar!
    const initialClosure = before.inductionResistor!
    const side = barVelocity < 0 ? -1 : 1
    expect(initialClosure.at.x).toBe(initialBar.at.x - side * 45)

    for (const time of [0.05, 2.1, 5]) {
      runtime.seek(time)
      const view = runtime.getSnapshot().view
      const bar = view.inductionBar!
      const closure = view.inductionResistor!
      const displacement = barVelocity * time * 100
      expect(bar.at.x - initialBar.at.x).toBeCloseTo(displacement, 9)
      expect(closure).toEqual(initialClosure)
      expect(view.inductionRails).toEqual(before.inductionRails)
      expect(view.inductionField).toEqual(before.inductionField)
      // The displayed loop must grow by the actual rod displacement, including
      // when the camera follows it far beyond the original viewport.
      expect((bar.at.x - closure.at.x) - (initialBar.at.x - initialClosure.at.x)).toBeCloseTo(displacement, 9)
      expect(Math.abs(bar.at.x - closure.at.x)).toBeCloseTo(45 + Math.abs(displacement), 9)
      expect(view.origin.x - before.origin.x).toBeCloseTo(displacement, 9)
      expect(view.extent).toEqual(before.extent)
      expect((closure.at.x - view.origin.x) - (initialClosure.at.x - before.origin.x)).toBeCloseTo(-displacement, 9)
      for (const rail of view.inductionRails ?? []) {
        expect(rail.from.x).toBeLessThanOrEqual(bar.at.x)
        expect(rail.to.x).toBeGreaterThanOrEqual(bar.at.x)
      }
      const field = view.inductionField!
      expect(field.origin.x).toBeLessThanOrEqual(bar.at.x)
      expect(field.origin.x + field.size.width).toBeGreaterThanOrEqual(bar.at.x)
      expect(view.inductionCurrent?.sign).toBe(Math.sign(barVelocity))
      for (const at of [view.inductionCurrent!.from, view.inductionCurrent!.to]) {
        expect(at.x).toBeGreaterThan(view.origin.x)
        expect(at.x).toBeLessThan(view.origin.x + view.extent.width)
        expect(at.y).toBe(-bar.length / 2)
      }
      if (barVelocity === 0) expect(view.chargeFlows ?? []).toHaveLength(0)
      else {
        const flow = view.chargeFlows?.[0]
        expect(flow?.path.map(at => at.x)).toEqual([closure.at.x, bar.at.x, bar.at.x, closure.at.x, closure.at.x])
        expect(Math.sign(flow!.current)).toBe(Math.sign(barVelocity))
      }
    }
  })

  it('preserves fixed apparatus after the browser acceptance field-strength edit', () => {
    const runtime = createInductionWorkspaceRuntime(createBarMotionScene())
    runtime.editParameter('field-strength', 0.6)
    const before = runtime.getSnapshot().view
    runtime.seek(runtime.getSnapshot().clock.total * 0.42)
    const after = runtime.getSnapshot().view
    expect(after.inductionBar?.at.x).toBeCloseTo(420, 9)
    expect(after.inductionResistor?.at.x).toBe(before.inductionResistor?.at.x)
    expect(after.inductionRails).toEqual(before.inductionRails)
    expect(after.inductionField).toEqual(before.inductionField)
    expect(after.chargeFlows?.[0]?.current).toBeCloseTo(0.048, 12)
  })
})
