import { afterEach, describe, expect, it, vi } from 'vitest'
import { WaveEngine } from '@physicsos/engine-wave'
import {
  createDiffractionScene, createReflectionRefractionScene, createStandingWaveScene, createWaveInterferenceScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import { captureDatasets } from '@physicsos/physics-workbench/data'
import type { CapturedResult } from '@physicsos/physics-workbench/types'

import { createWaveWorkspaceRuntime } from '../src/client/physics/wave-workspace-runtime.ts'
import {
  createWorkbenchInstanceRuntime, type WorkbenchCommittedState, type WorkbenchInstanceRuntime,
} from '../src/client/physics/workbench-instance-runtime.ts'

const owners = new Set<WorkbenchInstanceRuntime>()
afterEach(() => { for (const owner of owners) owner.dispose(); owners.clear(); vi.restoreAllMocks() })
const own = (scene: PhysicsScene, templateId: string) => {
  const owner = createWorkbenchInstanceRuntime({ scene, originScene: scene, templateId,
    source: { kind: 'template', id: templateId }, scheduler: null })
  owners.add(owner)
  return owner
}
const reopen = (state: WorkbenchCommittedState) => {
  const owner = createWorkbenchInstanceRuntime({ ...state, sceneId: String(state.scene.id),
    persistedHistory: state.history, scheduler: null })
  owners.add(owner)
  return owner
}
const near = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(1e-12, Math.abs(expected) * 1e-11))
const captureWithoutFailure = (get: () => CapturedResult): CapturedResult => {
  let result: CapturedResult | undefined
  expect(() => { result = get() }).not.toThrow()
  if (result === undefined) throw new Error('The held wave capture was unavailable')
  return result
}

describe('main wave behavior and same-owner capture compatibility', () => {
  it('captures the held interference age after several chart periods without retiming it or solving again', () => {
    const stateAt = vi.spyOn(WaveEngine.prototype, 'stateAt')
    const simulate = vi.spyOn(WaveEngine.prototype, 'simulate')
    const runtime = createWaveWorkspaceRuntime(createWaveInterferenceScene())
    runtime.editParameter('wave-speed', 0.5)
    runtime.setRunning(true)
    const frame = runtime.advance(3.1)
    near(frame.clock.time, 0.1)
    const held = stateAt.mock.results.at(-1)?.value
    if (held === undefined) throw new Error('The live frame did not retain its actual engine state')
    near(canonicalValue(held.time), 3.1)
    const calls = [stateAt.mock.calls.length, simulate.mock.calls.length]
    const raw = captureWithoutFailure(() => runtime.captureRaw())
    near(raw.clock.time, 3.1)
    expect(raw.cursor).toEqual({ kind: 'time', time: quantity(3.1, 's', 'time') })
    expect(canonicalStringify(raw.state)).toBe(canonicalStringify(held))
    // The stored history remains the real submitted window, plus an honest
    // separate current-state dataset at the held age.
    const historyEnd = canonicalValue(raw.result!.states.at(-1)!.time)
    near(historyEnd, canonicalValue(raw.request!.options.endTime!))
    expect(historyEnd).toBeLessThan(raw.clock.time)
    const datasets = captureDatasets(raw, { sourceScene: { kind: 'scene', digest: 'a'.repeat(64) } })
    near(datasets.find(dataset => dataset.origin.collection === 'captured-state')!.rows[0]!.axes.time as number, 3.1)
    expect([stateAt.mock.calls.length, simulate.mock.calls.length]).toEqual(calls)
  })

  it('saves and restores the owned physical interference age rather than its periodic chart cursor', () => {
    const owner = own(createWaveInterferenceScene(), 'wave-interference')
    owner.commitParameter('wave-speed', 0.5)
    owner.setRunning(true)
    owner.advance(3.1, 3100)
    owner.setRunning(false)
    const saved = owner.serialize()
    near(saved.clock.time, 3.1)
    const displayed = canonicalStringify(owner.frames.getSnapshot().view)
    const restored = reopen(JSON.parse(canonicalStringify(saved)) as WorkbenchCommittedState)
    near(restored.serialize().clock.time, 3.1)
    expect(restored.getSnapshot().clock.running).toBe(false)
    expect(canonicalStringify(restored.frames.getSnapshot().view)).toBe(displayed)
    const raw = captureWithoutFailure(() => restored.captureRaw())
    near(raw.clock.time, 3.1)
    near(canonicalValue(raw.state!.time), 3.1)
    expect(owner.serialize()).toEqual(saved)
  })

  it('runs and captures the actual diffraction screen arrival and fronts on its owner without a zero-time substitute', () => {
    const source = createDiffractionScene({ wavelength: 0.2, frequency: 5, slitWidth: 1, screenDistance: 2 })
    const owner = own(source, 'wave-diffraction')
    const initial = owner.frames.getSnapshot().view
    owner.setRunning(true)
    owner.advance(3.5, 3500)
    near(owner.serialize().clock.time, 3.5)
    expect(owner.frames.getSnapshot().view).not.toEqual(initial)
    const stateAt = vi.spyOn(WaveEngine.prototype, 'stateAt')
    const simulate = vi.spyOn(WaveEngine.prototype, 'simulate')
    const raw = captureWithoutFailure(() => owner.captureRaw())
    near(raw.clock.time, 3.5)
    near(canonicalValue(raw.state!.time), 3.5)
    const intensity = raw.state!.objects.find(object => object.id.includes('.intensity.64'))
    expect(intensity?.values?.illumination).toEqual(quantity(1, '', 'dimensionless'))
    expect(raw.state!.objects.some(object => object.id.includes('.diffraction-front.'))).toBe(true)
    expect(stateAt).not.toHaveBeenCalled()
    expect(simulate).not.toHaveBeenCalled()
  })

  it('captures the live formation window after the shorter steady-state export range without dropping its component waves', () => {
    const runtime = createWaveWorkspaceRuntime(createStandingWaveScene({ stringLength: 2, waveSpeed: 2, harmonic: 1 }))
    runtime.setChoice('standing-mode', 'formation')
    runtime.seek(5)
    const stateAt = vi.spyOn(WaveEngine.prototype, 'stateAt')
    const simulate = vi.spyOn(WaveEngine.prototype, 'simulate')
    const raw = captureWithoutFailure(() => runtime.captureRaw())
    near(raw.clock.time, 5)
    near(canonicalValue(raw.state!.time), 5)
    expect(raw.state!.objects.some(object => object.id.includes('.formation-left.'))).toBe(true)
    expect(raw.state!.objects.some(object => object.id.includes('.formation-right.'))).toBe(true)
    expect(raw.state!.objects.some(object => object.id.includes('.formation-sum.'))).toBe(true)
    expect(canonicalValue(raw.result!.states.at(-1)!.time)).toBeLessThan(raw.clock.time)
    expect(stateAt).not.toHaveBeenCalled()
    expect(simulate).not.toHaveBeenCalled()
  })

  it('keeps the geometrically static reflection and refraction owner paused while retaining all boundary readings', () => {
    const owner = own(createReflectionRefractionScene(), 'wave-reflection-refraction')
    owner.setRunning(true)
    owner.advance(3, 3000)
    const raw = owner.captureRaw()
    expect(owner.serialize().clock).toMatchObject({ time: 0, total: 0, running: false })
    expect(raw.cursor.kind).toBe('static')
    expect(raw.result!.derivedQuantities.some(quantity => quantity.key === 'refracted_angle')).toBe(true)
    expect(raw.state!.objects.some(object => object.id.includes('.incident'))).toBe(true)
    expect(raw.state!.objects.some(object => object.id.includes('.reflected'))).toBe(true)
  })
})
