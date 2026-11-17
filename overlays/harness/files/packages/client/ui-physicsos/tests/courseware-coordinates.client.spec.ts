import { describe, expect, it } from 'vitest'
import { coursewarePoint, coursewareSamples, coursewareShape, coursewareHit, fitCoursewareStage } from '../src/client/courseware/geometry.ts'
import { annotationDelta, applyAnnotationDelta, rebaseAnnotationDelta } from '../src/client/courseware/annotation-history.ts'
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
  it('keeps the limiting CSS dimension and zero letterbox margin exact on either axis', () => {
    const wide = fitCoursewareStage(1000, 800)
    expect(wide.rect.width).toBe(1000); expect(wide.rect.x).toBe(0)
    const tall = fitCoursewareStage(1000, 500)
    expect(tall.rect.height).toBe(500); expect(tall.rect.y).toBe(0)
    expect(wide.scale).toBe(1000 / 1920); expect(tall.scale).toBe(500 / 1080)
    expect(coursewarePoint({ clientX: wide.rect.x, clientY: wide.rect.y }, { left: wide.rect.x, top: wide.rect.y, width: wide.rect.width, height: wide.rect.height }, wide)).toEqual({ x: 0, y: 0 })
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
  it('rebases absent additions after the latest head without moving existing IDs or changing local restore order', () => {
    const a = cwInk('a'); const b = cwInk('b'); const mine = cwInk('mine')
    const latest = { schemaVersion: 1 as const, primitives: [a, b] }
    const addition = annotationDelta({ schemaVersion: 1, primitives: [] }, { schemaVersion: 1, primitives: [mine] })!
    const replay = rebaseAnnotationDelta(latest, addition)
    expect(applyAnnotationDelta(latest, replay, false, true).primitives).toEqual([a, b, mine])
    expect(addition.changes[0]!.afterIndex).toBe(0); expect(replay.changes[0]!.afterIndex).toBe(2)
    const alreadyApplied = { ...latest, primitives: [a, mine, b] }
    expect(applyAnnotationDelta(alreadyApplied, rebaseAnnotationDelta(alreadyApplied, addition), false, true)).toEqual(alreadyApplied)
    const removal = annotationDelta(alreadyApplied, latest)!
    expect(applyAnnotationDelta(latest, removal, true, true)).toEqual(alreadyApplied)
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
