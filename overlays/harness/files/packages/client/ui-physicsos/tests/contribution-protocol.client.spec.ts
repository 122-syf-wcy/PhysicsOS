import { describe, expect, it } from 'vitest'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { createOpticsWorkspaceRuntime } from '../src/client/physics/optics-workspace-runtime.ts'
import { createExperimentSession } from '../src/client/experiments/experiment-session.ts'
import {
  contributionSnapshot,
  applyContributionIntent,
} from '../src/client/experiments/contribution-protocol.ts'

describe('contributed lens files use the platform engine', () => {
  it('sends real, infinite and virtual imaging without exposing account or scene contents', () => {
    const runtime = createOpticsWorkspaceRuntime(createConvexLensScene())
    const frame = contributionSnapshot(runtime.getSnapshot())
    expect(frame.source).toBe('platform-engine')
    expect(frame.result.imageDistanceCm).toBeCloseTo(15)
    expect(frame.result.imageHeightCm).toBeLessThan(0)
    expect(Object.keys(frame).sort()).toEqual([
      'parameters',
      'rays',
      'result',
      'revision',
      'source',
      'visible',
    ])
    runtime.editParameter('object-distance', 10)
    expect(contributionSnapshot(runtime.getSnapshot()).result).toMatchObject({
      imageDistanceCm: null,
      imageHeightCm: null,
      imageKind: 'none',
      screenSharp: false,
    })
    runtime.editParameter('object-distance', 5)
    expect(contributionSnapshot(runtime.getSnapshot()).result).toMatchObject({
      imageKind: 'virtual',
      screenSharp: false,
    })
    expect(contributionSnapshot(runtime.getSnapshot()).result.imageDistanceCm).toBeCloseTo(-10)
  })

  it('carries platform height, layer flags and the actual engine ray paths in lens-relative centimetres', () => {
    const runtime = createOpticsWorkspaceRuntime(createConvexLensScene())
    runtime.editParameter('object-height', 9)
    const engine = runtime.getSnapshot()
    const frame = contributionSnapshot(engine)
    expect(frame.parameters.objectHeightCm).toBe(9)
    expect(frame.result.imageHeightCm).toBeCloseTo(-4.5)
    expect(frame.rays).toHaveLength(3)
    expect(frame.rays[0]?.points[0]).toEqual({ x: -30, y: 9 })
    expect(frame.rays.map((ray) => ray.points)).toEqual(
      engine.view.opticalRays?.map((ray) => ray.points),
    )
    runtime.setObservable('image', false)
    runtime.setObservable('rays', false)
    const hidden = contributionSnapshot(runtime.getSnapshot())
    expect(hidden.visible).toEqual({ image: false, rays: false })
    expect(hidden.result).toEqual(frame.result)
    expect(hidden.rays).toEqual(frame.rays)
    const session = createExperimentSession(runtime)
    expect(
      applyContributionIntent(session, {
        type: 'parameter/commit',
        id: 'objectHeightCm',
        value: 2,
      }),
    ).toBe(false)
  })

  it('previews without persistence, cancels, then commits one scene revision', () => {
    const runtime = createOpticsWorkspaceRuntime(createConvexLensScene())
    const saves: unknown[] = []
    const session = createExperimentSession(runtime, (scene) => saves.push(scene))
    expect(
      applyContributionIntent(session, {
        type: 'parameter/preview',
        id: 'objectDistanceCm',
        value: 15,
      }),
    ).toBe(true)
    expect(contributionSnapshot(session.getSnapshot()).result.imageDistanceCm).toBeCloseTo(30)
    expect(saves).toHaveLength(0)
    applyContributionIntent(session, { type: 'parameter/cancel' })
    expect(contributionSnapshot(session.getSnapshot()).result.imageDistanceCm).toBeCloseTo(15)
    applyContributionIntent(session, {
      type: 'parameter/commit',
      id: 'objectDistanceCm',
      value: 15,
    })
    expect(saves).toHaveLength(1)
    expect(runtime.getScene().revision).toBe(1)
  })

  it('ignores unknown, out-of-bounds and nonfinite commands without changing the experiment', () => {
    const runtime = createOpticsWorkspaceRuntime(createConvexLensScene())
    const session = createExperimentSession(runtime)
    const original = runtime.getScene()
    for (const data of [
      null,
      [],
      { type: 'navigate', url: '/admin' },
      { type: 'parameter/commit', id: '__proto__', value: 2 },
      { type: 'parameter/commit', id: 'objectDistanceCm', value: -1 },
      { type: 'parameter/preview', id: 'focalLengthCm', value: Infinity },
      { type: 'parameter/commit', id: 'objectDistanceCm', value: 1e9 },
      { type: 'parameter/commit', id: 'screenDistanceCm', value: '15' },
    ])
      expect(applyContributionIntent(session, data)).toBe(false)
    expect(runtime.getScene()).toEqual(original)
  })
})
