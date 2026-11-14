import { describe, expect, it } from 'vitest'
import { planScene, PlannerError } from '../src/planner.ts'
import type { FrameSource, SnapshotLike } from '../src/frame-plan.ts'

const scene = (overrides: Record<string, unknown> = {}) => ({ id: 's1', revision: 1, domain: 'mechanics', ...overrides })
const snapshot = (time: number): SnapshotLike => ({
  clock: { time, total: 4, running: false, rate: 1 },
  view: { bodies: [{ at: { x: time, y: time } }] },
  inspector: [{ id: 'm', parameters: [{ id: 'speed', value: 10, min: 0, max: 100, step: 5 }] }],
})

describe('worker frame planner', () => {
  it('plans frames from the supplied domain runtime', () => {
    const runtime = (): FrameSource => ({
      getSnapshot: () => snapshot(0),
      seek: (time: number) => snapshot(time),
      editParameter: () => snapshot(0),
    })
    const plan = planScene(scene(), runtime)
    expect(plan.frames.map(frame => frame.frameId)).toEqual(['f0', 'f1'])
    expect(plan.changedFrame?.frameId).toBe('f-changed')
    expect(plan.notes).toEqual([])
  })

  it('refuses an unknown domain instead of guessing a runtime', () => {
    expect(() => planScene(scene({ domain: 'astrology' }), null)).toThrow(PlannerError)
  })

  it('refuses when the domain module is missing (configuration, not a judgement)', () => {
    expect(() => planScene(scene(), null)).toThrow(expect.objectContaining({ code: 'RUNTIME_UNAVAILABLE' }))
  })

  it('surfaces a runtime construction failure as unavailable', () => {
    expect(() => planScene(scene(), () => { throw new Error('boom') }))
      .toThrow(expect.objectContaining({ code: 'RUNTIME_UNAVAILABLE' }))
  })
})
