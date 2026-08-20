// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { PhysicsCanvas } from '../src/client/physics/PhysicsCanvas.tsx'
import { createMagneticRuntime } from '../src/client/physics-runtime-bridge.ts'
import { MAGNETIC_SCENE_INPUT } from '../src/client/prototype/magnetic-scene.ts'

afterEach(cleanup)

const scalar = (
  snapshot: ReturnType<ReturnType<typeof createMagneticRuntime>['getSnapshot']>,
  key: string,
): number => {
  if (snapshot.simulation === null) throw new Error(`No simulation available for ${key}.`)
  const entry = snapshot.simulation.derivedQuantities.find(candidate => candidate.key === key)
  if (entry === undefined || !('value' in entry.value)) {
    throw new Error(`Missing scalar fact ${key}.`)
  }
  return entry.value.value
}

const arrowDirection = (
  snapshot: ReturnType<ReturnType<typeof createMagneticRuntime>['getSnapshot']>,
  observable: 'velocity' | 'force',
) => {
  const arrow = snapshot.view.vectors.find(candidate => candidate.observable === observable)
  if (arrow === undefined) throw new Error(`Missing ${observable} arrow.`)
  return { x: arrow.to.x - arrow.from.x, y: arrow.to.y - arrow.from.y }
}

describe('MagneticRuntimeBridge', () => {
  it('executes the verified B 0.50 -> 1.00 closed loop', () => {
    const runtime = createMagneticRuntime(MAGNETIC_SCENE_INPUT)
    const before = runtime.getSnapshot()
    const outcome = runtime.setMagneticFieldStrength(1)
    const after = outcome.snapshot

    expect(outcome.result.ok).toBe(true)
    expect(after.sceneRevision).toBe(before.sceneRevision + 1)
    expect(after.events.at(-1)).toEqual(
      expect.objectContaining({
        type: 'MagneticFieldStrengthChanged',
        revision: after.sceneRevision,
      }),
    )
    expect(after.status).toBe('verified')
    expect(after.verification?.status).toBe('passed')
    expect(scalar(after, 'cyclotron_radius')).toBeCloseTo(
      scalar(before, 'cyclotron_radius') / 2,
      12,
    )
    expect(scalar(after, 'cyclotron_period')).toBeCloseTo(
      scalar(before, 'cyclotron_period') / 2,
      12,
    )
    expect(scalar(after, 'angular_velocity')).toBeCloseTo(
      scalar(before, 'angular_velocity') * 2,
      12,
    )
    expect(scalar(after, 'lorentz_force_magnitude')).toBeCloseTo(
      scalar(before, 'lorentz_force_magnitude') * 2,
      12,
    )
  })

  it('reverses force and trajectory direction when charge changes sign', () => {
    const runtime = createMagneticRuntime(MAGNETIC_SCENE_INPUT)
    const before = runtime.getSnapshot()
    const beforeForce = arrowDirection(before, 'force')
    const beforeTrajectory = before.observations.observations.find(
      entry => entry.type === 'trajectory',
    )
    const beforeViewTrajectory = before.visual.trajectories[0]
    const { rerender } = render(
      <PhysicsCanvas view={before.visual} ariaLabel="磁场中的带电粒子运动" />,
    )
    expect(screen.getByLabelText(`轨迹方向：${beforeViewTrajectory?.direction === 'clockwise' ? '顺时针' : '逆时针'}`)).toBeTruthy()
    const outcome = runtime.setParticleCharge(-Math.abs(MAGNETIC_SCENE_INPUT.charge))
    const after = outcome.snapshot
    const afterForce = arrowDirection(after, 'force')
    const afterTrajectory = after.observations.observations.find(
      entry => entry.type === 'trajectory',
    )
    const afterViewTrajectory = after.visual.trajectories[0]
    rerender(<PhysicsCanvas view={after.visual} ariaLabel="磁场中的带电粒子运动" />)

    expect(outcome.result.ok).toBe(true)
    expect(after.status).toBe('verified')
    expect(scalar(after, 'cyclotron_radius')).toBeCloseTo(scalar(before, 'cyclotron_radius'), 12)
    expect(scalar(after, 'cyclotron_period')).toBeCloseTo(scalar(before, 'cyclotron_period'), 12)
    expect(scalar(after, 'rotation_direction')).toBe(-scalar(before, 'rotation_direction'))
    expect(afterForce.x).toBeCloseTo(-beforeForce.x, 12)
    expect(afterForce.y).toBeCloseTo(-beforeForce.y, 12)
    expect(afterTrajectory?.direction).not.toBe(beforeTrajectory?.direction)
    expect(afterViewTrajectory?.direction).toBe(afterTrajectory?.direction)
    expect(afterViewTrajectory?.direction).not.toBe(beforeViewTrajectory?.direction)
    expect(screen.getByLabelText(`轨迹方向：${afterViewTrajectory?.direction === 'clockwise' ? '顺时针' : '逆时针'}`)).toBeTruthy()
  })

  it('maps B direction to the Canvas ×/· glyph without string physics in the Engine', () => {
    const runtime = createMagneticRuntime(MAGNETIC_SCENE_INPUT)
    const before = runtime.getSnapshot()
    const { rerender } = render(
      <PhysicsCanvas view={before.visual} ariaLabel="磁场中的带电粒子运动" />,
    )

    expect(before.view.field.direction).toBe('into-page')
    expect(screen.getAllByText('×').length).toBeGreaterThan(0)

    const outcome = runtime.setMagneticFieldDirection('out-of-page')
    rerender(
      <PhysicsCanvas
        view={outcome.snapshot.visual}
        ariaLabel="磁场中的带电粒子运动"
      />,
    )

    expect(outcome.result.ok).toBe(true)
    expect(outcome.snapshot.view.field.direction).toBe('out-of-page')
    expect(screen.getAllByText('·').length).toBeGreaterThan(0)
    expect(outcome.snapshot.status).toBe('verified')
  })

  it('removes the Force Observation and arrow but keeps the Engine force fact', () => {
    const runtime = createMagneticRuntime(MAGNETIC_SCENE_INPUT)
    const before = runtime.getSnapshot()
    const after = runtime.setObservableEnabled('force', false)

    expect(before.observations.observations.some(entry => entry.type === 'lorentz_force')).toBe(
      true,
    )
    expect(after.sceneRevision).toBe(before.sceneRevision + 1)
    expect(after.events.at(-1)).toEqual(expect.objectContaining({ type: 'ObservableDisabled' }))
    expect(after.observations.observations.some(entry => entry.type === 'lorentz_force')).toBe(
      false,
    )
    expect(after.view.vectors.some(entry => entry.observable === 'force')).toBe(false)
    expect(
      after.simulation?.derivedQuantities.some(entry => entry.key === 'lorentz_force_vector'),
    ).toBe(true)

    const restored = runtime.setObservableEnabled('force', true)
    expect(restored.observations.observations.some(entry => entry.type === 'lorentz_force')).toBe(
      true,
    )
    expect(restored.view.vectors.some(entry => entry.observable === 'force')).toBe(true)
  })

  it('drives seek and playback from analytical stateAt with wall-clock rate semantics', () => {
    const runtime = createMagneticRuntime(MAGNETIC_SCENE_INPUT)
    const initial = runtime.getSnapshot()
    const initialParticle = initial.view.particles[0]
    const quarter = runtime.seek(initial.clock.total / 4)
    const quarterParticle = quarter.view.particles[0]

    expect(quarterParticle?.at).not.toEqual(initialParticle?.at)
    runtime.seek(0)
    runtime.setPlaybackRate(2)
    const running = runtime.setRunning(true)
    const advanced = runtime.advance(initial.clock.total / 8)

    expect(running.simulation).toBe(initial.simulation)
    expect(advanced.simulation).toBe(initial.simulation)
    expect(advanced.clock.time).toBeCloseTo(initial.clock.total / 4, 12)
    expect(advanced.clock.rate).toBe(2)
  })

  it('publishes a coherent failed snapshot instead of mixing scene revisions', () => {
    const runtime = createMagneticRuntime(MAGNETIC_SCENE_INPUT)
    const before = runtime.getSnapshot()
    const outcome = runtime.setParticleCharge(0)
    const after = outcome.snapshot

    expect(outcome.result.ok).toBe(true)
    expect(after.sceneRevision).toBe(before.sceneRevision + 1)
    expect(after.scene.revision).toBe(after.sceneRevision)
    expect(after.scene.particles[0]?.charge?.value).toBe(0)
    expect(after.status).toBe('failed')
    expect(after.error).toEqual(
      expect.objectContaining({ code: 'INVALID_MODEL_CONDITION', retryable: false }),
    )
    expect(after.simulation).toBeNull()
    expect(after.verification).toBeNull()
    expect(after.observations).toEqual({ sceneRevision: after.sceneRevision, observations: [] })
    expect(after.view.particles).toEqual([])
    expect(after.derived.items).toEqual([])
    expect(after.data).toEqual({ series: [], samples: [] })
    expect(after.clock).toEqual(expect.objectContaining({ time: 0, total: 0, running: false }))
  })
})
