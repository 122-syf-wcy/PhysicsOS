import { describe, expect, it } from 'vitest'
import { trajectorySampleTimes, trajectoryStorageSampleCount } from '../src/index.ts'

describe('trajectory sampling exact endpoints and finite windows', () => {
  it.each([
    [0, 0.1, 4],
    [0.25, 120, 65],
    [0, Number.MAX_VALUE, 3],
    [Number.MAX_VALUE / 4, Number.MAX_VALUE, 3],
    [Number.MAX_VALUE / 2, Number.MAX_VALUE, 1024],
    [3, 3, 5],
  ])('preserves [%s, %s] endpoints at the unchanged sample count %s', (start, end, count) => {
    const values = trajectorySampleTimes(start, end, count)
    expect(values).toHaveLength(count)
    expect(values[0]).toBe(start)
    expect(values.at(-1)).toBe(end)
    expect(values.every(Number.isFinite)).toBe(true)
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(start)
      expect(value).toBeLessThanOrEqual(end)
    }
  })

  it('computes a sparse legal huge interior sample without multiplying the span by an index', () => {
    const values = trajectorySampleTimes(0, Number.MAX_VALUE, 3)
    expect(values).toEqual([0, Number.MAX_VALUE / 2, Number.MAX_VALUE])
  })

  it('does not change normal resolutions or the existing storage cap', () => {
    expect(trajectorySampleTimes(0, 10, 6)).toEqual([0, 2, 4, 6, 8, 10])
    const requested = trajectoryStorageSampleCount({ outputSampleRate: 1e9 }, 65)
    expect(requested).toBe(1024)
    expect(trajectorySampleTimes(0, 0.1, requested)).toHaveLength(1024)
    expect(trajectorySampleTimes(0, 0.1, requested).at(-1)).toBe(0.1)
  })
})
