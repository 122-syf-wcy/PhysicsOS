import { describe, expect, it } from 'vitest'
import { inkElementPoints, readInkSamples } from '../src/client/whiteboard/ink.ts'
describe('full native pen capture', () => {
  it('keeps coalesced coincident points and pressure changes with exact board coordinates at any zoom', () => {
    const event = { clientX: 180, clientY: 160, pressure: 0.9, timeStamp: 12, getCoalescedEvents: () => [
      { clientX: 160, clientY: 140, pressure: 0.1, timeStamp: 10 },
      { clientX: 160, clientY: 140, pressure: 0.7, timeStamp: 11 },
      { clientX: 180, clientY: 160, pressure: 0.9, timeStamp: 12 },
    ] }
    const samples = readInkSamples(event, { offsetLeft: 100, offsetTop: 100, scrollX: -20, scrollY: 10, zoom: { value: 2 } })
    expect(samples).toEqual([{ x: 50, y: 10, pressure: 0.1, time: 10 }, { x: 50, y: 10, pressure: 0.7, time: 11 }, { x: 60, y: 20, pressure: 0.9, time: 12 }])
    expect(inkElementPoints(samples, { x: 50, y: 10 })).toEqual({ points: [[0, 0], [0, 0], [10, 10]], pressures: [0.1, 0.7, 0.9] })
  })
  it('retains the final pointer event when it follows the coalesced sample sequence', () => {
    const samples = readInkSamples({ clientX: 22, clientY: 31, pressure: 0, timeStamp: 4, getCoalescedEvents: () => [{ clientX: 20, clientY: 30, pressure: 0.8, timeStamp: 3 }] },
      { offsetLeft: 0, offsetTop: 0, scrollX: 0, scrollY: 0, zoom: { value: 1 } })
    expect(samples).toEqual([{ x: 20, y: 30, pressure: 0.8, time: 3 }, { x: 22, y: 31, pressure: 0, time: 4 }])
  })
})
