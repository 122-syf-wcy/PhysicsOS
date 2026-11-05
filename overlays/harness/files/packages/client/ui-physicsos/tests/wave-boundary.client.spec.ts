import { describe, expect, it } from 'vitest'
import { createReflectionRefractionScene } from '@physicsos/physics-scene'

import { createWaveWorkspaceRuntime } from '../src/client/physics/wave-workspace-runtime.ts'

describe('wave workspace runtime · boundary ray geometry', () => {
  it.each([0, 30])('puts the transmitted endpoint in the other medium at %s degrees', incidentAngle => {
    const runtime = createWaveWorkspaceRuntime(createReflectionRefractionScene({
      amplitude: 1, frequency: 2, incidentSpeed: 4, transmittedSpeed: 2, incidentAngle,
    }))
    const view = runtime.getSnapshot().view
    const incident = view.trajectories.find(path => path.id === 'wave-incident-ray')
    const reflected = view.trajectories.find(path => path.id === 'wave-reflected-ray')
    const transmitted = view.trajectories.find(path => path.id === 'wave-refracted-ray')
    const boundary = incident?.points.at(-1)
    if (!incident || !reflected || !transmitted || !boundary) throw new Error('missing boundary rays')
    expect(reflected.points[0]).toEqual(boundary)
    expect(transmitted.points[0]).toEqual(boundary)
    expect(incident.points[0]!.y).toBeLessThan(boundary.y)
    expect(reflected.points.at(-1)!.y).toBeLessThan(boundary.y)
    expect(transmitted.points.at(-1)!.y).toBeGreaterThan(boundary.y)
    if (incidentAngle === 0) expect(transmitted.points.at(-1)!.x).toBeCloseTo(boundary.x, 12)
    else expect(transmitted.points.at(-1)!.x).toBeLessThan(boundary.x)
  })

  it('draws no transmitted trajectory beyond the critical angle', () => {
    const runtime = createWaveWorkspaceRuntime(createReflectionRefractionScene({
      amplitude: 1, frequency: 2, incidentSpeed: 2, transmittedSpeed: 4, incidentAngle: 45,
    }))
    expect(runtime.getSnapshot().view.trajectories.map(path => path.id)).toEqual([
      'wave-incident-ray', 'wave-reflected-ray',
    ])
  })
})
