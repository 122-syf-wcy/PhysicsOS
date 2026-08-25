// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAGNETIC_CYCLE_WALL_SECONDS,
  magneticPhysicalDelta,
  MICRO_WINDOW_WALL_SECONDS,
  microWindowPhysicalDelta,
  nearestTimedStateIndex,
  useAnimationClock,
} from '../src/client/animation-clock.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('animation clock', () => {
  it('presents one microscopic magnetic period over a stable wall-clock cycle', () => {
    const period = 1.31e-7

    expect(magneticPhysicalDelta(MAGNETIC_CYCLE_WALL_SECONDS, period)).toBeCloseTo(period, 15)
    expect(magneticPhysicalDelta(1 / 60, period)).toBeGreaterThan(0)
  })

  it('presents a full microscopic window over the micro presentation window', () => {
    const window = 4.1e-6

    expect(microWindowPhysicalDelta(MICRO_WINDOW_WALL_SECONDS, window)).toBeCloseTo(window, 15)
    const frame = microWindowPhysicalDelta(1 / 60, window)
    expect(frame).toBeGreaterThan(0)
    expect(frame).toBeLessThan(window)
  })

  it('ignores invalid or unavailable timing inputs', () => {
    expect(magneticPhysicalDelta(-1, 1)).toBe(0)
    expect(magneticPhysicalDelta(1, 0)).toBe(0)
    expect(magneticPhysicalDelta(Number.NaN, 1)).toBe(0)
    expect(microWindowPhysicalDelta(-1, 1)).toBe(0)
    expect(microWindowPhysicalDelta(1, 0)).toBe(0)
    expect(microWindowPhysicalDelta(Number.NaN, 1)).toBe(0)
  })

  it('finds the nearest sampled state with stable boundary behavior', () => {
    const states = [0, 0.5, 1].map(value => ({ time: { value } }))
    expect(nearestTimedStateIndex(states, -1)).toBe(0)
    expect(nearestTimedStateIndex(states, 0.49)).toBe(1)
    expect(nearestTimedStateIndex(states, 3)).toBe(2)
  })

  it('emits the actual elapsed time once per requested animation frame', () => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextId = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextId += 1
      frames.set(nextId, callback)
      return nextId
    })
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id)
    })
    const onFrame = vi.fn()
    const { unmount } = renderHook(() => { useAnimationClock(true, onFrame) })

    act(() => { frames.get(1)?.(100) })
    act(() => { frames.get(2)?.(116.67) })
    act(() => { frames.get(3)?.(1116.67) })

    expect(onFrame).toHaveBeenCalledTimes(2)
    expect(onFrame).toHaveBeenNthCalledWith(1, expect.closeTo(0.01667, 5))
    expect(onFrame).toHaveBeenNthCalledWith(2, 0.1)
    unmount()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('does not advance while hidden and re-baselines on the first visible frame', () => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextId = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextId += 1
      frames.set(nextId, callback)
      return nextId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id)
    })
    let hidden = false
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    const onFrame = vi.fn()
    const { unmount } = renderHook(() => { useAnimationClock(true, onFrame) })

    act(() => { frames.get(1)?.(100) })
    act(() => { frames.get(2)?.(116.67) })
    expect(onFrame).toHaveBeenCalledTimes(1)

    hidden = true
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    act(() => { frames.get(3)?.(1016.67) })
    act(() => { frames.get(4)?.(1033.34) })
    expect(onFrame).toHaveBeenCalledTimes(1)

    hidden = false
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    act(() => { frames.get(5)?.(2000) })
    expect(onFrame).toHaveBeenCalledTimes(1)
    act(() => { frames.get(6)?.(2016.67) })
    expect(onFrame).toHaveBeenCalledTimes(2)
    expect(onFrame).toHaveBeenLastCalledWith(expect.closeTo(0.01667, 5))

    unmount()
  })

  it('ignores non-finite RAF timestamps without poisoning the next frame', () => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextId = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextId += 1
      frames.set(nextId, callback)
      return nextId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id)
    })
    const onFrame = vi.fn()
    const { unmount } = renderHook(() => { useAnimationClock(true, onFrame) })

    act(() => { frames.get(1)?.(100) })
    act(() => { frames.get(2)?.(Number.NaN) })
    act(() => { frames.get(3)?.(116.67) })

    expect(onFrame).toHaveBeenCalledTimes(1)
    expect(onFrame).toHaveBeenCalledWith(expect.closeTo(0.01667, 5))
    unmount()
  })
})
