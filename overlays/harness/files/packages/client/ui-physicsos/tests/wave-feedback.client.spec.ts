import { describe, expect, it } from 'vitest'
import { createDiffractionScene, createDopplerScene, createStandingWaveScene, createTravellingWaveScene, createWaveInterferenceScene } from '@physicsos/physics-scene'
import { createWaveWorkspaceRuntime } from '../src/client/physics/wave-workspace-runtime.ts'

describe('wave lesson playback', () => {
  it('wraps an edited fractional frequency on whole periods and keeps its chart aligned', () => {
    const runtime = createWaveWorkspaceRuntime(createTravellingWaveScene())
    const start = runtime.editParameter('frequency', 1.5)
    expect(start.clock.total).toBeCloseTo(4 / 3, 12)
    expect(start.charts[0]!.points.at(-1)!.t).toBeCloseTo(start.clock.total, 12)
    const last = runtime.seek(start.clock.total)
    last.view.waveProfile!.points.forEach((point, i) => {
      expect(point.y).toBeCloseTo(start.view.waveProfile!.points[i]!.y, 10)
    })
    runtime.setRunning(true)
    const next = runtime.advance(0.001)
    expect(next.clock.time).toBeCloseTo(0.001, 12)
  })

  it('keeps a late diffraction instant when only visibility changes', () => {
    const runtime = createWaveWorkspaceRuntime(createDiffractionScene())
    runtime.seek(4)
    expect(runtime.setObservable('waveform', false).clock.time).toBe(4)
    expect(runtime.setObservable('waveform', true).clock.time).toBe(4)
  })

  it('replays the formation lesson from rest while steady mode wraps without a phase jump', () => {
    const runtime = createWaveWorkspaceRuntime(createStandingWaveScene({ harmonic: 1, frequency: 2 }))
    const formation = runtime.setChoice('standing-mode', 'formation')
    expect(formation.charts[0]!.points.at(-1)!.t).toBeCloseTo(formation.clock.total, 12)
    runtime.setRunning(true)
    const replay = runtime.advance(formation.clock.total)
    expect(replay.clock.running).toBe(true)
    expect(replay.view.waveProfile!.points.every(point => point.y === 0)).toBe(true)
    const steady = runtime.setChoice('standing-mode', 'steady')
    const end = runtime.seek(steady.clock.total)
    end.view.waveProfile!.points.forEach((point, i) => {
      expect(point.y).toBeCloseTo(steady.view.waveProfile!.points[i]!.y, 10)
    })
  })

  it('preserves the endpoint of a nonperiodic Doppler journey', () => {
    const runtime = createWaveWorkspaceRuntime(createDopplerScene())
    runtime.setRunning(true)
    const end = runtime.advance(runtime.getSnapshot().clock.total + 1)
    expect(end.clock.running).toBe(false)
    expect(end.clock.time).toBe(end.clock.total)
  })
  it.each([createTravellingWaveScene, createWaveInterferenceScene, createStandingWaveScene])('loops only after play and preserves pause, seek and slow rate', (createScene) => {
    const runtime = createWaveWorkspaceRuntime(createScene())
    expect(runtime.advance(10).clock.time).toBe(0)
    runtime.setRate(0.01)
    runtime.setRunning(true)
    expect(runtime.advance(2).clock.time).toBeCloseTo(0.02, 12)
    const total = runtime.getSnapshot().clock.total
    const looped = runtime.advance((total + 0.03) / 0.01)
    expect(looped.clock.running).toBe(true)
    expect(looped.clock.time).toBeCloseTo(0.05, 9)
    runtime.setRunning(false)
    expect(runtime.advance(10).clock.time).toBe(looped.clock.time)
    const sought = runtime.seek(0.01)
    expect(sought.clock.running).toBe(false)
    expect(runtime.advance(10).view).toEqual(sought.view)
    runtime.seek(0)
    expect(runtime.advance(10).clock.time).toBe(0)
  })

  it('selects formation or steady state without editing the physical scene, and replay is deterministic', () => {
    const runtime = createWaveWorkspaceRuntime(createStandingWaveScene())
    const start = runtime.setChoice('standing-mode', 'formation')
    expect(start.inspector.flatMap(section => section.choices ?? []).find(choice => choice.id === 'standing-mode')?.value).toBe('formation')
    expect(start.view.waveProfile?.points.every(point => point.y === 0)).toBe(true)
    const halfway = runtime.seek(0.009)
    expect(halfway.view.trajectories.filter(path => path.id.startsWith('wave-formation-'))).toHaveLength(2)
    const steady = runtime.setChoice('standing-mode', 'steady')
    expect(steady.sceneRevision).toBe(start.sceneRevision)
    expect(steady.view.waveProfile?.points.some(point => Math.abs(point.y) > 0)).toBe(true)
    runtime.setChoice('standing-mode', 'formation')
    expect(runtime.seek(0.009).view).toEqual(halfway.view)
    expect(runtime.getSnapshot().clock.running).toBe(false)
  })

  it('shows the exact central boundaries alongside the labelled paraxial approximation', () => {
    const runtime = createWaveWorkspaceRuntime(createDiffractionScene())
    const initial = runtime.getSnapshot()
    expect(initial.clock.total).toBeGreaterThan(3)
    const view = runtime.seek(initial.clock.total * 0.9).view
    expect(view.trajectories.some(path => path.id === 'wave-diffraction-intensity')).toBe(true)
    const band = view.dimensions.find(dimension => dimension.id === 'wave-central-width')!
    expect(band.to.y - band.from.y).toBeCloseTo(230.94010767585033, 7)
    expect(view.overlay.readout.some(text => text.includes('≈') || text.includes('近轴'))).toBe(true)
    const broader = runtime.editParameter('frequency', 1)
    expect(broader.status).toBe('verified')
    expect(broader.view.dimensions.some(dimension => dimension.id === 'wave-central-width')).toBe(false)
  })
})
