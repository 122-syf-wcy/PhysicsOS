import { describe, expect, it } from 'vitest'

import {
  MAX_TRAJECTORY_RENDER_POINTS,
  MAX_TRAJECTORY_STORAGE_SAMPLES,
  chunkTrajectoryPoints,
  decimateTrajectoryPoints,
  trajectorySampleTimes,
  trajectoryStorageSampleCount,
} from '../src/trajectory-sampling.ts'

describe('trajectoryStorageSampleCount (#85 outputSampleRate)', () => {
  it('falls back to the engine default when the option is absent', () => {
    expect(trajectoryStorageSampleCount(undefined, 65)).toBe(65)
    expect(trajectoryStorageSampleCount({}, 121)).toBe(121)
  })

  it('honours a caller-supplied outputSampleRate', () => {
    expect(trajectoryStorageSampleCount({ outputSampleRate: 20 }, 65)).toBe(20)
    expect(trajectoryStorageSampleCount({ outputSampleRate: 1000 }, 65)).toBe(1000)
  })

  it('clamps hostile values to the storage bound (#124 never unbounded)', () => {
    expect(trajectoryStorageSampleCount({ outputSampleRate: 1_000_000 }, 65)).toBe(
      MAX_TRAJECTORY_STORAGE_SAMPLES,
    )
    expect(trajectoryStorageSampleCount({ outputSampleRate: -5 }, 65)).toBe(2)
    expect(trajectoryStorageSampleCount({ outputSampleRate: Number.NaN }, 65)).toBe(65)
    expect(trajectoryStorageSampleCount(undefined, 1_000_000)).toBe(MAX_TRAJECTORY_STORAGE_SAMPLES)
  })

  it('never returns fewer than 2 samples', () => {
    expect(trajectoryStorageSampleCount({ outputSampleRate: 1 }, 65)).toBe(2)
    expect(trajectoryStorageSampleCount({ outputSampleRate: 0 }, 65)).toBe(2)
  })
})

describe('trajectorySampleTimes', () => {
  it('produces count strictly increasing times with endpoints included', () => {
    const times = trajectorySampleTimes(0, 10, 6)
    expect(times).toHaveLength(6)
    expect(times[0]).toBe(0)
    expect(times[times.length - 1]).toBe(10)
    for (let i = 1; i < times.length; i += 1) expect(times[i]! > times[i - 1]!).toBe(true)
  })

  it('handles a zero-length window', () => {
    const times = trajectorySampleTimes(3, 3, 5)
    expect(times).toHaveLength(5)
    expect(times.every((t) => t === 3)).toBe(true)
  })
})

describe('decimateTrajectoryPoints', () => {
  it('returns the input unchanged when already within budget', () => {
    const points = [1, 2, 3]
    expect(decimateTrajectoryPoints(points, 10)).toBe(points)
  })

  it('always keeps the first and last points', () => {
    const points = Array.from({ length: 100 }, (_, i) => i)
    const decimated = decimateTrajectoryPoints(points, 10)
    expect(decimated[0]).toBe(0)
    expect(decimated[decimated.length - 1]).toBe(99)
    expect(decimated.length).toBe(10)
  })

  it('keeps the internal ordering', () => {
    const points = Array.from({ length: 100 }, (_, i) => i)
    const decimated = decimateTrajectoryPoints(points, 12)
    expect([...decimated].sort((a, b) => a - b)).toEqual(decimated)
  })

  it('returns a single point unchanged', () => {
    expect(decimateTrajectoryPoints([42], 10)).toEqual([42])
  })

  it('is a real reduction for large inputs (render budget bound)', () => {
    const points = Array.from({ length: 5000 }, (_, i) => i)
    const decimated = decimateTrajectoryPoints(points, MAX_TRAJECTORY_RENDER_POINTS)
    expect(decimated.length).toBeLessThanOrEqual(MAX_TRAJECTORY_RENDER_POINTS)
    expect(decimated.length).toBe(MAX_TRAJECTORY_RENDER_POINTS)
  })

  it('honours maxPoints = 0 by passing the input through', () => {
    const points = [1, 2, 3, 4]
    expect(decimateTrajectoryPoints(points, 0)).toBe(points)
  })

  it('keeps protected indices that even spacing would have dropped', () => {
    const points = Array.from({ length: 100 }, (_, i) => i)
    const decimated = decimateTrajectoryPoints(points, 10, new Set([50]))
    expect(decimated).toContain(50)
    expect(decimated[0]).toBe(0)
    expect(decimated[decimated.length - 1]).toBe(99)
    expect(decimated.length).toBeLessThanOrEqual(10)
  })

  it('accepts an array form for protected indices', () => {
    const points = Array.from({ length: 100 }, (_, i) => i)
    const decimated = decimateTrajectoryPoints(points, 10, [7, 42])
    expect(decimated).toContain(7)
    expect(decimated).toContain(42)
    expect(decimated.length).toBeLessThanOrEqual(10)
  })

  it('protecting many indices still respects the render budget bound', () => {
    const points = Array.from({ length: 1000 }, (_, i) => i)
    const protectedIndices = new Set(Array.from({ length: 600 }, (_, i) => i + 1))
    const decimated = decimateTrajectoryPoints(points, 64, protectedIndices)
    expect(decimated.length).toBeLessThanOrEqual(64)
    expect(decimated[0]).toBe(0)
    expect(decimated[decimated.length - 1]).toBe(999)
  })

  it('ignores out-of-range protected indices', () => {
    const points = Array.from({ length: 50 }, (_, i) => i)
    const decimated = decimateTrajectoryPoints(points, 10, new Set([-3, 25, 500]))
    expect(decimated).toContain(25)
    expect(decimated.length).toBeLessThanOrEqual(10)
  })

  it('preserves exact original selection when nothing is protected', () => {
    const points = Array.from({ length: 101 }, (_, i) => i)
    const plain = decimateTrajectoryPoints(points, 10)
    const withEmptyProtect = decimateTrajectoryPoints(points, 10, new Set<number>())
    expect(withEmptyProtect).toEqual(plain)
  })
})

describe('chunkTrajectoryPoints (#124 chunk)', () => {
  it('returns a single chunk for a short list', () => {
    const chunks = chunkTrajectoryPoints([1, 2, 3], 4)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual([1, 2, 3])
  })

  it('splits a long list into bounded chunks preserving order', () => {
    const points = Array.from({ length: 1000 }, (_, i) => i)
    const chunks = chunkTrajectoryPoints(points, 256)
    expect(chunks.length).toBe(Math.ceil(1000 / 256))
    expect(chunks.every((chunk) => chunk.length <= 256)).toBe(true)
    expect(chunks.flat()).toEqual(points)
  })
})