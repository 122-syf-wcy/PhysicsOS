import { describe, expect, it } from 'vitest'
import { createDiffractionScene, createDopplerScene, createStandingWaveScene, createTravellingWaveScene, createWaveInterferenceScene } from '@physicsos/physics-scene'
import { resolveWaveModel } from '@physicsos/engine-wave'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import { createWaveWorkspaceRuntime } from '../src/client/physics/wave-workspace-runtime.ts'
import { waveSceneVisual } from '../src/client/physics/wave-visual-bridge.ts'
import { universalContributionSnapshot } from '../src/client/experiments/contribution-protocol.ts'
import { isUniversalSnapshot } from '../src/client/experiments/universal-contract.ts'

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
    expect(runtime.seek(4).clock.time).toBe(4)
    expect(runtime.setObservable('waveform', false).clock.time).toBe(4)
    expect(runtime.setObservable('waveform', true).clock.time).toBe(4)
  })

  it('keeps a late standing-wave formation instant when only visibility changes', () => {
    const runtime = createWaveWorkspaceRuntime(createStandingWaveScene({ harmonic: 1, frequency: 0.5 }))
    runtime.setChoice('standing-mode', 'formation')
    expect(runtime.seek(4).clock.time).toBe(4)
    expect(runtime.setObservable('nodes', false).clock.time).toBe(4)
    expect(runtime.setObservable('nodes', true).clock.time).toBe(4)
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

const diffractionFacts = () => {
  const runtime = createWaveWorkspaceRuntime(createDiffractionScene({ now: '2026-11-08T00:00:00.000Z' }))
  runtime.seek(runtime.getSnapshot().clock.total)
  const raw = runtime.captureRaw()
  if (raw.state === undefined || raw.result === undefined) throw new Error('Expected the actual held diffraction frame.')
  return { runtime, scene: raw.scene, simulation: raw.result, state: raw.state, model: resolveWaveModel(raw.scene), raw }
}

describe('trusted diffraction apparatus frame', () => {
  it('publishes all 129 raw intensity samples in scene cm without changing held scientific evidence', () => {
    const { runtime, scene, model, state, raw } = diffractionFacts()
    const before = structuredClone(raw)
    const view = runtime.getSnapshot().view
    const rig = view.waveDiffraction!
    const slit = state.objects.find(object => object.id === `${model.benchId}.slit`)!
    const screen = state.objects.find(object => object.id === `${model.benchId}.screen`)!
    const objects = state.objects.filter(object => object.id.startsWith(`${model.benchId}.intensity.`))
    expect(objects).toHaveLength(129)
    expect(rig.id).toBe(model.benchId)
    expect(rig.slitAt).toEqual({ x: slit.position!.vector.x * 100, y: slit.position!.vector.y * 100 })
    expect(rig.screenAt).toEqual({ x: screen.position!.vector.x * 100, y: screen.position!.vector.y * 100 })
    expect(rig.slitWidth).toBe(model.slitWidth! * 100)
    expect(rig.intensitySamples).toHaveLength(objects.length)
    rig.intensitySamples.forEach((sample, index) => {
      const object = objects[index]!
      const ratio = object.values!['intensity_ratio']!
      const illumination = object.values!['illumination']!
      if ('vector' in ratio || 'vector' in illumination) throw new Error('Expected raw scalar intensity facts.')
      expect(sample).toEqual({
        id: object.id,
        y: object.position!.vector.y * 100,
        intensity: canonicalValue(ratio) * canonicalValue(illumination),
      })
    })
    expect(rig.screenHalfHeight).toBe(Math.max(50, ...rig.intensitySamples.map(sample => Math.abs(sample.y))))
    expect(view.origin.y).toBe(-rig.screenHalfHeight * 1.125)
    expect(view.extent.height).toBe(rig.screenHalfHeight * 2.25)
    const snapshot = universalContributionSnapshot(runtime.getSnapshot(), 'wave-diffraction')
    expect(isUniversalSnapshot(snapshot, 'wave-diffraction')).toBe(true)
    const legacy = structuredClone(snapshot)
    Reflect.deleteProperty(legacy.view, 'waveDiffraction')
    expect(isUniversalSnapshot(legacy, 'wave-diffraction')).toBe(true)
    expect(runtime.captureRaw()).toEqual(before)
    expect(raw.scene.metadata).toEqual(scene.metadata)
  })

  it('keeps a dark frame exactly zero, with the same apparatus and bounds after arrival', () => {
    const runtime = createWaveWorkspaceRuntime(createDiffractionScene())
    const dark = runtime.getSnapshot().view
    expect(dark.waveDiffraction!.intensitySamples).toHaveLength(129)
    expect(dark.waveDiffraction!.intensitySamples.every(sample => sample.intensity === 0)).toBe(true)
    const lit = runtime.seek(runtime.getSnapshot().clock.total).view
    expect(lit.waveDiffraction!.intensitySamples.some(sample => sample.intensity > 0)).toBe(true)
    expect(lit.waveDiffraction!.slitAt).toEqual(dark.waveDiffraction!.slitAt)
    expect(lit.waveDiffraction!.screenAt).toEqual(dark.waveDiffraction!.screenAt)
    expect(lit.waveDiffraction!.screenHalfHeight).toBe(dark.waveDiffraction!.screenHalfHeight)
    expect(lit.origin).toEqual(dark.origin)
    expect(lit.extent).toEqual(dark.extent)
  })

  it('preserves zero and sub-display-resolution intensity rather than inverting the drawn curve', () => {
    const { scene, simulation, model, state } = diffractionFacts()
    const ids = state.objects.filter(object => object.id.startsWith(`${model.benchId}.intensity.`)).slice(0, 2).map(object => object.id)
    const values = [0, 7.654321098765432e-29]
    const preciseState = {
      ...state,
      objects: state.objects.map(object => {
        const index = ids.indexOf(object.id)
        return index < 0 ? object : {
          ...object,
          values: { ...object.values, intensity_ratio: quantity(values[index]!, '', 'dimensionless'), illumination: quantity(1, '', 'dimensionless') },
        }
      }),
    }
    const before = structuredClone(preciseState)
    const view = waveSceneVisual({ scene, simulation, model, state: preciseState, time: canonicalValue(state.time) })
    expect(view.waveDiffraction!.intensitySamples.slice(0, 2).map(sample => sample.intensity)).toEqual(values)
    const curve = view.trajectories.find(path => path.id === 'wave-diffraction-intensity')!
    // Both x offsets round to the same double; the raw intensity still survives.
    expect(curve.points[0]!.x).toBe(curve.points[1]!.x)
    const tinySlit = waveSceneVisual({ scene, simulation, model: { ...model, slitWidth: 1.234567890123456e-18 }, state, time: 0 })
    expect(tinySlit.waveDiffraction!.slitWidth).toBe(1.234567890123456e-18 * 100)
    const zeroSlit = waveSceneVisual({ scene, simulation, model: { ...model, slitWidth: 0 }, state, time: 0 })
    expect(zeroSlit.waveDiffraction!.slitWidth).toBe(0)
    expect(preciseState).toEqual(before)
  })

  it('omits missing facts instead of publishing a made-up slit, screen or dark intensity sample', () => {
    const { scene, simulation, model, state } = diffractionFacts()
    const input = { scene, simulation, model, state, time: canonicalValue(state.time) }
    const { slitWidth: _slitWidth, ...noSlitWidth } = model
    expect(waveSceneVisual({ ...input, model: noSlitWidth }).waveDiffraction).toBeUndefined()
    for (const suffix of ['slit', 'screen']) {
      const partialState = { ...state, objects: state.objects.filter(object => object.id !== `${model.benchId}.${suffix}`) }
      expect(waveSceneVisual({ ...input, state: partialState }).waveDiffraction).toBeUndefined()
    }
    const sample = state.objects.find(object => object.id.startsWith(`${model.benchId}.intensity.`))!
    const noSampleFacts = {
      ...state,
      objects: state.objects.map(object => object.id === sample.id ? { ...object, values: {} } : object),
    }
    const rig = waveSceneVisual({ ...input, state: noSampleFacts }).waveDiffraction!
    expect(rig.intensitySamples).toHaveLength(128)
    expect(rig.intensitySamples.some(entry => entry.id === sample.id)).toBe(false)
  })

  it('converts equivalent non-SI slit and screen quantities exactly once', () => {
    const si = createDiffractionScene({ now: '2026-11-08T00:00:00.000Z' })
    const alternate = structuredClone(si)
    alternate.waveBenches![0]!.slitWidth = quantity(100, 'cm', 'length')
    alternate.waveBenches![0]!.screenDistance = quantity(200, 'cm', 'length')
    const before = structuredClone(alternate)
    const first = createWaveWorkspaceRuntime(si)
    const second = createWaveWorkspaceRuntime(alternate)
    first.seek(first.getSnapshot().clock.total)
    second.seek(second.getSnapshot().clock.total)
    expect(second.getSnapshot().view.waveDiffraction).toEqual(first.getSnapshot().view.waveDiffraction)
    expect(second.captureRaw().scene.waveBenches).toEqual(before.waveBenches)
    expect(alternate).toEqual(before)
  })
})
