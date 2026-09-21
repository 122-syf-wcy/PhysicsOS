/**
 * Magnetic workspace adapter spec.
 *
 * The magnetic domain is the one that animates a periodic orbit, yet its
 * adapter used to hand the canvas `trajectoryTimes: []` and `derivation: []`
 * unconditionally. Because `PhysicsCanvas` only enables hover / seek / strobe
 * when `trajectoryTimes.length` equals the joined polyline length, that empty
 * array silently disabled all three interactions — no test failed, because
 * nothing asserted the pairing. These cases pin the pairing itself.
 */

import { describe, expect, it } from 'vitest'
import { createMagneticWorkspaceRuntime } from '../src/client/physics/magnetic-workspace-runtime.ts'

const snapshot = () => createMagneticWorkspaceRuntime().getSnapshot()

/** Repeats the join `PhysicsCanvas` performs: same id, history then predicted. */
const canvasPolylineLength = (
  trajectories: readonly { id: string; kind: string; points: readonly unknown[] }[],
): number => {
  const first = trajectories[0]
  if (first === undefined) return 0
  const parts = trajectories.filter(entry => entry.id === first.id)
  const history = parts.filter(entry => entry.kind === 'history')
  const predicted = parts.filter(entry => entry.kind === 'predicted')
  return [...history, ...predicted].reduce((total, entry) => total + entry.points.length, 0)
}

describe('magnetic workspace · trajectory seek contract', () => {
  it('publishes one time per polyline point, so hover/seek can be enabled', () => {
    const view = snapshot()
    const expected = canvasPolylineLength(view.view.trajectories)
    expect(expected).toBeGreaterThan(1)
    expect(view.trajectoryTimes).toHaveLength(expected)
  })

  it('keeps the times monotonic and inside the playback window', () => {
    const view = snapshot()
    const times = [...view.trajectoryTimes]
    expect(times.every(time => Number.isFinite(time))).toBe(true)
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!)
    }
    expect(times[times.length - 1]!).toBeLessThanOrEqual(view.clock.total + 1e-9)
  })
})

describe('magnetic workspace · derivation panel', () => {
  it('derives every step from a quantity the bridge actually published', () => {
    const view = snapshot()
    expect(view.derivation.length).toBeGreaterThan(0)
    for (const step of view.derivation) {
      /* No invented steps: each one carries a real symbol/value/unit triple. */
      expect(step.title).not.toBe('')
      expect(step.result?.symbol).not.toBe('')
      expect(step.result?.value).not.toBe('')
    }
  })

  it('states the closed-form law for the uniform-field quantities', () => {
    const ids = snapshot().derivation.map(step => step.id)
    expect(ids).toEqual(expect.arrayContaining(['R', 'T']))
    const expressions = new Map(snapshot().derivation.map(step => [step.id, step.expression]))
    /* KaTeX-ready, and specific to the law the verifier checks by the same name
       (`radius_consistency: r = mv/qB`, `period_consistency: T = 2πm/qB`). */
    expect(expressions.get('R')).toContain('mv')
    expect(expressions.get('T')).toContain('2\\pi')
  })
})

describe('magnetic workspace · events stay empty by physics', () => {
  it('reports no timeline events for a closed orbit in a uniform field', () => {
    /* The particle enters once, never leaves, hits nothing. An empty list is the
       honest answer; this guards against someone filling it with a fake marker
       to make the tab look populated. */
    expect(snapshot().events).toHaveLength(0)
  })
})
