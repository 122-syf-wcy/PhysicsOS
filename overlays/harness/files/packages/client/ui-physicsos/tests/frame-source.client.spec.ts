// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { createFrameSource, useFrameSource } from '../src/client/physics/frame-source.ts'

describe('frame source (#123 renderer channel)', () => {
  it('serves the initial frame and publishes updates', () => {
    const source = createFrameSource(0)
    expect(source.get()).toBe(0)
    source.set(1)
    expect(source.get()).toBe(1)
  })

  it('notifies subscribers only when the frame actually changes', () => {
    const source = createFrameSource(0)
    const seen: number[] = []
    source.subscribe(() => { seen.push(source.get()) })
    source.set(0) // same value → no publish
    source.set(1)
    source.set(2)
    expect(seen).toEqual([1, 2])
  })

  it('unsubscribes cleanly', () => {
    const source = createFrameSource(0)
    const seen: number[] = []
    const off = source.subscribe(() => { seen.push(source.get()) })
    off()
    source.set(1)
    expect(seen).toEqual([])
  })

  it('re-renders only the subscribing component', () => {
    const source = createFrameSource({ time: 0 })
    const renders: number[] = []
    const { result } = renderHook(() => {
      renders.push(source.get().time)
      return useFrameSource(source)
    })
    expect(result.current.time).toBe(0)
    act(() => { source.set({ time: 0.5 }) })
    expect(result.current.time).toBe(0.5)
    expect(renders).toEqual([0, 0.5])
  })
})
