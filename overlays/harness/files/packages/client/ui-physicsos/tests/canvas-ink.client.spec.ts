import { describe, expect, it } from 'vitest'
import * as geometry from '../src/client/canvas/geometry.ts'

type Sample = { clientX: number; clientY: number; pressure: number; timeStamp: number }
type Stroke = { points: readonly (readonly [number, number])[]; samples: readonly { x: number; y: number; pressure: number; time: number }[] }
type Gesture = { begin: (id: number, point: Sample) => void; append: (id: number, points: readonly Sample[]) => void;
  finish: (id: number, point: Sample) => void; cancel: () => void }
const drawing = geometry as unknown as { createInkGesture?: (options: { toWorld: (sample: Sample) => { x: number; y: number };
  requestFrame: (callback: () => void) => number; cancelFrame: (handle: number) => void; onPreview: (stroke?: Stroke) => void; onCommit: (stroke: Stroke) => void }) => Gesture }

describe('intelligent pen sampling', () => {
  it('keeps every coalesced pressure/time sample in world coordinates and commits only on pointer-up', () => {
    const previews: (Stroke | undefined)[] = []; const commits: Stroke[] = []; const frames: (() => void)[] = []
    const gesture = drawing.createInkGesture?.({ toWorld: p => ({ x: (p.clientX - 100) / 2, y: (p.clientY + 40) / 2 }),
      requestFrame: callback => { frames.push(callback); return frames.length }, cancelFrame: () => {},
      onPreview: stroke => previews.push(stroke), onCommit: stroke => commits.push(stroke) })
    expect(gesture).toBeDefined()
    const point = (i: number): Sample => ({ clientX: 100 + i * 2, clientY: i * 4, pressure: i / 100, timeStamp: i + 13 })
    gesture?.begin(7, point(0)); gesture?.append(7, Array.from({ length: 99 }, (_, i) => point(i + 1)))
    expect(frames).toHaveLength(1); expect(commits).toHaveLength(0); expect(previews).toHaveLength(0)
    frames.shift()?.(); expect(previews[0]?.samples).toHaveLength(100)
    gesture?.finish(7, point(100))
    expect(commits).toHaveLength(1); expect(commits[0]?.samples).toHaveLength(101)
    expect(commits[0]?.samples[100]).toEqual({ x: 100, y: 220, pressure: 1, time: 113 })
    expect(commits[0]?.points[100]).toEqual([100, 220])
    gesture?.finish(7, point(100)); expect(commits).toHaveLength(1)
  })
  it('discards cancellation and ignores foreign pointers without committing preview ink', () => {
    const commits: Stroke[] = []; const frames = new Map<number, () => void>(); let frameId = 0
    const gesture = drawing.createInkGesture?.({ toWorld: p => ({ x: p.clientX, y: p.clientY }),
      requestFrame: callback => { frames.set(++frameId, callback); return frameId }, cancelFrame: id => { frames.delete(id) },
      onPreview: () => {}, onCommit: stroke => commits.push(stroke) })
    expect(gesture).toBeDefined()
    const p = { clientX: 1, clientY: 2, pressure: 0.5, timeStamp: 10 }
    gesture?.begin(1, p); gesture?.append(2, [p]); gesture?.cancel(); gesture?.finish(1, p)
    expect(frames.size).toBe(0); expect(commits).toHaveLength(0)
  })
})
