import { describe, expect, it } from 'vitest'
import { planScene, PlannerError } from '../src/planner.ts'
import type { FrameSource, SnapshotLike } from '../src/frame-plan.ts'
import { isUniversalSnapshot } from '../../../vendor/deepseek-harness/packages/client/ui-physicsos/src/client/experiments/universal-contract.ts'

const experimentId = 'projectile-oblique'
const scene = (overrides: Record<string, unknown> = {}) => ({ id: 's1', revision: 1, domain: 'mechanics', ...overrides })
const snapshot = (time: number): SnapshotLike => ({
  sceneRevision: 1, status: 'ready', domain: 'mechanics', title: 'Engine frame', ariaLabel: 'Engine frame',
  clock: { time, total: 4, running: false, rate: 1 },
  view: { bodies: [{ at: { x: time, y: time } }] },
  inspector: [{ id: 'm', parameters: [{ id: 'speed', value: 10, min: 0, max: 100, step: 5 }] }],
  table: { columns: [], rows: [] }, charts: [], verification: [], events: [], trajectoryTimes: [],
  sampleReadout: () => ({ time }), scene: { id: 'private-scene' }, ownerSessionId: 'private-owner',
})

describe('worker frame planner', () => {
  it('plans frames from the supplied domain runtime', () => {
    const runtime = (): FrameSource => ({
      getSnapshot: () => snapshot(0),
      seek: (time: number) => snapshot(time),
      editParameter: () => ({ ...snapshot(0), sceneRevision: 2 }),
    })
    const plan = planScene(scene(), runtime, experimentId)
    expect(plan.frames.map(frame => frame.frameId)).toEqual(['f0', 'f1'])
    expect(plan.changedFrame?.frameId).toBe('f-changed')
    expect(plan.notes).toEqual([])
    for (const frame of [...plan.frames, plan.changedFrame!]) {
      expect(isUniversalSnapshot(frame.snapshot, experimentId)).toBe(true)
      expect(isUniversalSnapshot(frame.snapshot, 'another-experiment')).toBe(false)
      expect(frame.snapshot.source).toBe('platform-engine')
      for (const key of ['sampleReadout', 'scene', 'ownerSessionId', 'sceneRevision', 'status']) {
        expect(frame.snapshot).not.toHaveProperty(key)
      }
    }
    expect(plan.frames.map(frame => frame.snapshot.revision)).toEqual([1, 1])
    expect(plan.changedFrame?.snapshot.revision).toBe(2)
    expect(plan.frames[1]?.snapshot.view).toEqual(snapshot(4).view)
    expect(plan.frames[1]?.snapshot.clock).toEqual(snapshot(4).clock)
  })

  it.each([{ status: 'failed' }, { sceneRevision: undefined }, { sceneRevision: -1 }, { sceneRevision: 1.5 }])('refuses invalid runtime identity or failed facts: %j', invalid => {
    expect(() => planScene(scene(), () => ({ getSnapshot: () => ({ ...snapshot(0), ...invalid }) }), experimentId))
      .toThrow(expect.objectContaining({ code: 'INVALID_SNAPSHOT' }))
  })

  it('does not serialize non-finite engine facts', () => {
    expect(() => planScene(scene(), () => ({ getSnapshot: () => ({ ...snapshot(0), view: { bodies: [{ at: { x: 0, y: Number.NaN } }] } }) }), experimentId))
      .toThrow('Invalid engine value')
  })

  it('requires an exact portable template identity instead of using the scene id', () => {
    expect(() => planScene(scene(), () => ({ getSnapshot: () => snapshot(0) }), ''))
      .toThrow(expect.objectContaining({ code: 'INVALID_SNAPSHOT' }))
  })

  it('refuses an unknown domain instead of guessing a runtime', () => {
    expect(() => planScene(scene({ domain: 'astrology' }), null, experimentId)).toThrow(PlannerError)
  })

  it('refuses when the domain module is missing (configuration, not a judgement)', () => {
    expect(() => planScene(scene(), null, experimentId)).toThrow(expect.objectContaining({ code: 'RUNTIME_UNAVAILABLE' }))
  })

  it('surfaces a runtime construction failure as unavailable', () => {
    expect(() => planScene(scene(), () => { throw new Error('boom') }, experimentId))
      .toThrow(expect.objectContaining({ code: 'RUNTIME_UNAVAILABLE' }))
  })
})
