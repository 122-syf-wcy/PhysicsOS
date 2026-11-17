import { describe, expect, it } from 'vitest'
import { coursewarePoint, coursewareSamples, coursewareShape, coursewareHit, fitCoursewareStage } from '../src/client/courseware/geometry.ts'
import { annotationDelta, applyAnnotationDelta } from '../src/client/courseware/annotation-history.ts'
import { cwInk } from './courseware-fixture.client.ts'
describe('courseware actual-stage coordinates and original pressure ink', () => {
  it('uses stage rect + CSS scale, not the iframe frame or DPR, including letterbox and fullscreen', () => {
    const stage = { width: 1920, height: 1080 }
    expect(coursewarePoint({ clientX: 520, clientY: 300 }, { left: 40, top: 30, width: 960, height: 540 }, stage)).toEqual({ x: 960, y: 540 })
    expect(coursewarePoint({ clientX: 1000, clientY: 570 }, { left: 40, top: 30, width: 1920, height: 1080 }, stage)).toEqual({ x: 960, y: 540 })
    const fit = fitCoursewareStage(1000, 800)
    expect(fit.rect.x).toBe(0); expect(fit.rect.y).toBeCloseTo(118.75)
    expect(coursewarePoint({ clientX: fit.rect.x + fit.rect.width / 2, clientY: fit.rect.y + fit.rect.height / 2 }, { left: fit.rect.x, top: fit.rect.y, width: fit.rect.width, height: fit.rect.height }, stage)).toEqual({ x: 960, y: 540 })
  })
  it('preserves every coalesced coordinate, raw pressure zero and timestamp without resampling', () => {
    const samples = [{ clientX: 10, clientY: 20, pressure: 0, timeStamp: 1 }, { clientX: 20, clientY: 30, pressure: .17, timeStamp: 2 }]
    const event = { clientX: 30, clientY: 40, pressure: .93, timeStamp: 3, getCoalescedEvents: () => samples }
    const raw = coursewareSamples(event, { left: 0, top: 0, width: 960, height: 540 }, { width: 1920, height: 1080 })
    expect(raw).toEqual([{ x: 20, y: 40, pressure: 0, time: 1 }, { x: 40, y: 60, pressure: .17, time: 2 }, { x: 60, y: 80, pressure: .93, time: 3 }])
    expect(coursewareShape('pen', raw, 'ink', '#263f4a', 4)).toMatchObject({ samples: raw, points: [[20, 40], [40, 60], [60, 80]] })
  })
  it('erases whole strokes/shapes and uses edge hit tests rather than destroying filled bounding boxes', () => {
    expect(coursewareHit(cwInk(), 20, 30, 3)).toBe(true)
    const shape = { id: 'rect', type: 'rectangle' as const, x: 0, y: 0, width: 100, height: 100 }
    expect(coursewareHit(shape, 1, 50, 3)).toBe(true); expect(coursewareHit(shape, 50, 50, 3)).toBe(false)
  })
  it('stores per-ID deltas and rejects conflicting replay, without copying the growing layer', () => {
    const initial = { schemaVersion: 1 as const, primitives: [cwInk('first')] }
    const after = { ...initial, primitives: [...initial.primitives, cwInk('second')] }
    const delta = annotationDelta(initial, after)!
    expect(delta.changes).toHaveLength(1); expect(delta.changes[0]!.id).toBe('second')
    expect(applyAnnotationDelta(initial, delta)).toEqual(after); expect(applyAnnotationDelta(after, delta, true)).toEqual(initial)
    const removal = annotationDelta(after, initial)!
    const modified = { ...after, primitives: [cwInk('first'), { ...cwInk('second'), style: { strokeWidth: 10 } }] }
    expect(() => applyAnnotationDelta(modified, removal, false, true)).toThrow()
  })
})
