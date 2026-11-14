import { describe, expect, it } from 'vitest'
import { planFrames, sampleTimes, type FrameSource, type SnapshotLike } from '../src/frame-plan.ts'

const snapshot = (time: number, total: number, overrides: Partial<SnapshotLike> = {}): SnapshotLike => ({
  clock: { time, total, running: false, rate: 1 },
  view: { bodies: [{ at: { x: time * 2, y: 0 } }] },
  inspector: [{ id: 'motion', parameters: [{ id: 'speed', value: 20, min: 5, max: 40, step: 5 }] }],
  ...overrides,
})

describe('frame planning', () => {
  it('samples t0, apex, impact and the end without duplicates', () => {
    expect(sampleTimes(snapshot(0, 4, {
      events: [{ kind: 'apex', time: 1.5 }, { kind: 'impact', time: 3 }],
    } as Partial<SnapshotLike>))).toEqual([0, 1.5, 3, 4])
  })

  it('never returns a single time, even for a static scene', () => {
    const times = sampleTimes(snapshot(0, 0))
    expect(times.length).toBeGreaterThanOrEqual(2)
    expect(new Set(times).size).toBeGreaterThanOrEqual(2)
  })

  it('uses the runtime seek and leaves the engine output untouched', () => {
    const base = snapshot(0, 3)
    const source: FrameSource = {
      getSnapshot: () => base,
      seek: time => snapshot(time, 3),
    }
    const plan = planFrames(source)
    expect(plan.frames.map(frame => frame.snapshot.clock.time)).toEqual([0, 3])
    expect(plan.frames[1]?.snapshot.view.bodies?.[0]?.at.x).toBe(6)
  })

  it('moves one numeric parameter inside its range for the changed frame', () => {
    const source: FrameSource = {
      getSnapshot: () => snapshot(0, 3),
      seek: time => snapshot(time, 3),
      editParameter: (id, value) => snapshot(0, 3, {
        inspector: [{ id: 'motion', parameters: [{ id, value, min: 5, max: 40, step: 5 }] }],
      }),
    }
    const plan = planFrames(source)
    expect(plan.parameter).toEqual({ id: 'speed', from: 20, to: 25 })
    expect(plan.changedFrame?.snapshot.inspector?.[0]?.parameters?.[0]?.value).toBe(25)
  })

  it('reports honestly when there is no editable parameter instead of faking one', () => {
    const source: FrameSource = {
      getSnapshot: () => snapshot(0, 3, { inspector: [{ id: 'motion' }] }),
      seek: time => snapshot(time, 3, { inspector: [{ id: 'motion' }] }),
    }
    const plan = planFrames(source)
    expect(plan.changedFrame).toBeUndefined()
    expect(plan.notes.join(' ')).toContain('无法通过')
  })

  it('reports when the runtime cannot seek', () => {
    const plan = planFrames({ getSnapshot: () => snapshot(0, 3) })
    expect(plan.frames).toHaveLength(1)
    expect(plan.notes.join(' ')).toContain('seek')
  })
})
