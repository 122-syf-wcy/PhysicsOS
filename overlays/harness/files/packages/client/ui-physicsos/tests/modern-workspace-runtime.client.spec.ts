import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModernPhysicsEngine } from '@physicsos/engine-modern'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import { createPhotoelectricEffectScene, type PhysicsScene } from '@physicsos/physics-scene'
import type { CapturedResult } from '@physicsos/physics-workbench/types'

import { createModernPhysicsWorkspaceRuntime } from '../src/client/physics/modern-workspace-runtime.ts'

const h = 6.62607015e-34
const c = 2.99792458e8
const e = 1.602176634e-19
const now = '2026-11-08T00:00:00.000Z'

const scalar = (capture: CapturedResult, key: string): number => {
  const value = capture.result?.derivedQuantities.find(entry => entry.key === key)?.value
  if (value === undefined || !('value' in value)) throw new Error(`Missing raw scalar ${key}.`)
  return canonicalValue(value)
}

const sourceScene = (): PhysicsScene => {
  const scene = createPhotoelectricEffectScene({ revision: 4, now, title: 'Question photoelectric bench' })
  scene.metadata.sourceQuestionId = 'modern-question-1' as NonNullable<PhysicsScene['metadata']['sourceQuestionId']>
  return scene
}

afterEach(() => vi.restoreAllMocks())

describe('modern workspace physical edits', () => {
  it('exposes the five actual bench fields and a frequency editor without invented material choices', () => {
    const runtime = createModernPhysicsWorkspaceRuntime(createPhotoelectricEffectScene({ now }))
    const snapshot = runtime.getSnapshot()
    expect(snapshot.status).toBe('verified')
    const parameters = snapshot.inspector.flatMap(section => section.parameters ?? [])
    expect(parameters.map(parameter => parameter.id)).toEqual([
      'workFunction', 'photonWavelength', 'photonFrequency', 'lightIntensity', 'cathodeArea', 'quantumEfficiency',
    ])
    expect(parameters.find(parameter => parameter.id === 'photonFrequency')?.value).toBeCloseTo(c / 400e-9, 0)
    expect(parameters.find(parameter => parameter.id === 'lightIntensity')?.min).toBeGreaterThan(0)
    expect(snapshot.inspector.flatMap(section => section.choices ?? [])).toEqual([])
    const before = runtime.captureRaw()
    runtime.setChoice('material', 'sodium')
    expect(runtime.captureRaw()).toEqual(before)
  })

  it('reads non-SI scene quantities in canonical inspector units without changing captured facts', () => {
    const scene = createPhotoelectricEffectScene({ now })
    scene.modernPhysicsBenches![0]!.photonWavelength = quantity(0.00004, 'cm', 'length')
    scene.modernPhysicsBenches![0]!.cathodeArea = quantity(1, 'cm²', 'area')
    const before = structuredClone(scene)
    const runtime = createModernPhysicsWorkspaceRuntime(scene)
    const snapshot = runtime.getSnapshot()
    const parameters = snapshot.inspector.flatMap(section => section.parameters ?? [])
    expect(parameters.find(parameter => parameter.id === 'photonWavelength')?.value).toBeCloseTo(400e-9, 20)
    expect(parameters.find(parameter => parameter.id === 'cathodeArea')?.value).toBeCloseTo(1e-4, 12)
    expect(snapshot.view.overlay.readout).toContain('λ = 4.000e-7 m')
    expect(runtime.captureRaw().scene.modernPhysicsBenches).toEqual(before.modernPhysicsBenches)
    expect(scene).toEqual(before)
  })

  it('recomputes wavelength, photon energy, threshold, stopping potential and current from edited facts', () => {
    const runtime = createModernPhysicsWorkspaceRuntime(createPhotoelectricEffectScene({ now }))
    const initial = runtime.captureRaw()
    const revision = initial.scene.revision
    runtime.editParameter('photonFrequency', c / 300e-9)
    const frequencyEdit = runtime.captureRaw()
    expect(frequencyEdit.scene.revision).toBe(revision + 1)
    expect(canonicalValue(frequencyEdit.scene.modernPhysicsBenches![0]!.photonWavelength)).toBeCloseTo(300e-9, 20)
    expect(scalar(frequencyEdit, 'photon_energy')).toBeCloseTo(h * c / 300e-9, 31)
    expect(frequencyEdit.result?.sceneRevision).toBe(frequencyEdit.scene.revision)
    expect(frequencyEdit.request?.sceneRevision).toBe(frequencyEdit.scene.revision)

    runtime.editParameter('workFunction', 2.5 * e)
    const workEdit = runtime.captureRaw()
    expect(scalar(workEdit, 'threshold_frequency')).toBeCloseTo(2.5 * e / h, 0)
    expect(scalar(workEdit, 'max_kinetic_energy')).toBeCloseTo(h * c / 300e-9 - 2.5 * e, 31)
    expect(scalar(workEdit, 'stopping_potential')).toBeCloseTo((h * c / 300e-9 - 2.5 * e) / e, 12)

    runtime.editParameter('lightIntensity', 20)
    const intensityEdit = runtime.captureRaw()
    expect(scalar(intensityEdit, 'photocurrent') / scalar(workEdit, 'photocurrent')).toBeCloseTo(2, 12)
    expect(scalar(intensityEdit, 'max_kinetic_energy')).toBe(scalar(workEdit, 'max_kinetic_energy'))
    runtime.editParameter('cathodeArea', 2e-4)
    const areaEdit = runtime.captureRaw()
    expect(scalar(areaEdit, 'photocurrent') / scalar(intensityEdit, 'photocurrent')).toBeCloseTo(2, 12)
    runtime.editParameter('quantumEfficiency', 0.25)
    const efficiencyEdit = runtime.captureRaw()
    expect(scalar(efficiencyEdit, 'photocurrent') / scalar(areaEdit, 'photocurrent')).toBeCloseTo(0.25, 12)
    expect(efficiencyEdit.scene.revision).toBe(revision + 5)
    expect(efficiencyEdit.result?.verification.status).toBe('passed')
  })

  it('keeps below-threshold kinetic energy and photocurrent exactly zero after an actual wavelength edit', () => {
    const runtime = createModernPhysicsWorkspaceRuntime(createPhotoelectricEffectScene({ now }))
    runtime.editParameter('photonWavelength', 700e-9)
    const capture = runtime.captureRaw()
    expect(canonicalValue(capture.scene.modernPhysicsBenches![0]!.photonWavelength)).toBe(700e-9)
    expect(scalar(capture, 'emits_photoelectrons')).toBe(0)
    expect(scalar(capture, 'max_kinetic_energy')).toBe(0)
    expect(scalar(capture, 'photocurrent')).toBe(0)
    expect(capture.result?.verification.status).toBe('passed')
  })

  it('runs SetObservableEnabled and recomputes the result at that new revision without a question fork', () => {
    const source = sourceScene()
    const before = structuredClone(source)
    const spy = vi.spyOn(ModernPhysicsEngine.prototype, 'simulate')
    const runtime = createModernPhysicsWorkspaceRuntime(source)
    expect(spy).toHaveBeenCalledTimes(1)
    const frame = runtime.setObservable('photocurrent', false)
    const capture = runtime.captureRaw()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(frame.branch).toBeUndefined()
    expect(capture.scene.id).toBe(source.id)
    expect(capture.scene.revision).toBe(5)
    expect(capture.result?.sceneRevision).toBe(5)
    expect(capture.request?.trace.sceneRevision).toBe(5)
    expect(frame.view.visible.photocurrent).toBe(false)
    expect(capture.scene.observableDefinitions.find(entry => entry.type === 'current')?.visible).toBe(false)
    expect(scalar(capture, 'photocurrent')).toBeGreaterThan(0)
    expect(source).toEqual(before)
  })

  it('forks a question on a successful fact edit and restores protected facts at a new revision', () => {
    const source = sourceScene()
    const before = structuredClone(source)
    const runtime = createModernPhysicsWorkspaceRuntime(source)
    const edited = runtime.editParameter('lightIntensity', 20)
    const branch = runtime.captureRaw()
    expect(edited.branch).toMatchObject({ originQuestionTitle: source.metadata.title, parentRevision: 4, canRestore: true })
    expect(branch.scene.id).not.toBe(source.id)
    expect(branch.scene.revision).toBe(1)
    expect(branch.scene.modernPhysicsBenches![0]!.lightIntensity.value).toBe(20)
    expect(source).toEqual(before)
    source.modernPhysicsBenches![0]!.workFunction.value = 999
    const restored = runtime.restoreOrigin()
    const capture = runtime.captureRaw()
    expect(restored.branch).toBeUndefined()
    expect(capture.scene.id).toBe(before.id)
    expect(capture.scene.revision).toBeGreaterThan(Math.max(before.revision, branch.scene.revision))
    expect(capture.scene.modernPhysicsBenches).toEqual(before.modernPhysicsBenches)
    expect(capture.request?.sceneRevision).toBe(capture.scene.revision)
    expect(capture.result?.sceneRevision).toBe(capture.scene.revision)
    expect(capture.result?.verification.status).toBe('passed')
    expect(branch.scene.modernPhysicsBenches![0]!.lightIntensity.value).toBe(20)
  })

  it.each([
    ['workFunction', 0], ['photonWavelength', -1], ['lightIntensity', 0], ['cathodeArea', 0],
    ['quantumEfficiency', 1.1], ['photonFrequency', 0], ['photonFrequency', NaN], ['workFunction', Infinity],
  ] as const)('rejects %s=%s without publishing a tentative fork or stale evidence', (id, value) => {
    const source = sourceScene()
    const runtime = createModernPhysicsWorkspaceRuntime(source)
    const before = runtime.captureRaw()
    const spy = vi.spyOn(ModernPhysicsEngine.prototype, 'simulate')
    const frame = runtime.editParameter(id, value)
    const after = runtime.captureRaw()
    expect(frame.error).toBeDefined()
    expect(frame.branch).toBeUndefined()
    expect(after.scene).toEqual(before.scene)
    expect(after.request).toEqual(before.request)
    expect(after.result).toEqual(before.result)
    expect(after.state).toEqual(before.state)
    expect(after.scene.id).toBe(source.id)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('modern held raw capture', () => {
  it('captures detached engine data and static cursor without re-running or inventing time', () => {
    const spy = vi.spyOn(ModernPhysicsEngine.prototype, 'simulate')
    const runtime = createModernPhysicsWorkspaceRuntime(createPhotoelectricEffectScene({ now }))
    const first = runtime.captureRaw()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(first.clock).toEqual({ time: 0, total: 0, running: false, rate: 1 })
    expect(first.cursor).toEqual({ kind: 'static', identity: `${first.scene.id}@${first.scene.revision}` })
    expect(first.request?.options).toEqual({ startTime: quantity(0, 's', 'time'), endTime: quantity(0, 's', 'time') })
    expect(first.state).toEqual(first.result?.states[0])
    expect(first.result?.states.every(state => canonicalValue(state.time) === 0)).toBe(true)
    expect(first.engineInfo).toMatchObject({ id: 'engine-modern', version: '1.0.0', model: 'photoelectric_effect' })
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.result?.derivedQuantities)).toBe(true)
    runtime.setRunning(true)
    runtime.advance(10)
    runtime.setRate(4)
    runtime.seek(10)
    runtime.step(1)
    expect(runtime.captureRaw()).toEqual(first)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(runtime.captureRaw()).not.toBe(first)
  })

  it('retains a failed returned SimulationResult and its raw state, request and diagnostics', () => {
    const actual = ModernPhysicsEngine.prototype.simulate
    let returned: ReturnType<typeof actual> | undefined
    const spy = vi.spyOn(ModernPhysicsEngine.prototype, 'simulate').mockImplementation(function(this: ModernPhysicsEngine, scene, request) {
      returned = actual.call(this, scene, request)
      returned.verification = {
        status: 'failed',
        checks: [{ id: 'injected-real-failure', type: 'constraint', passed: false, details: { expected: 1, actual: 2 } }],
        errors: [{ code: 'injected-real-failure', severity: 'error', message: 'Raw engine verification failed.' }],
        warnings: [],
      }
      return returned
    })
    const runtime = createModernPhysicsWorkspaceRuntime(createPhotoelectricEffectScene({ now }))
    const frame = runtime.getSnapshot()
    const capture = runtime.captureRaw()
    expect(frame.status).toBe('failed')
    expect(frame.verification).toContainEqual(expect.objectContaining({ id: 'injected-real-failure', status: 'failed' }))
    expect(capture.result).toEqual(returned)
    expect(Object.isFrozen(returned)).toBe(false)
    expect(capture.state).toEqual(returned?.states[0])
    expect(capture.request?.simulationId).toBe(returned?.simulationId)
    expect(capture.diagnostics).toContainEqual(expect.objectContaining({ code: 'MODERN_SIMULATION_FAILED' }))
    expect(scalar(capture, 'photon_energy')).toBeCloseTo(h * c / 400e-9, 31)
    expect(spy).toHaveBeenCalledTimes(1)
    if (returned === undefined) throw new Error('Expected a real returned engine result.')
    returned.derivedQuantities[0]!.key = 'changed-after-capture'
    expect(runtime.captureRaw().result).toEqual(capture.result)
  })

  it('captures unsupported scene facts and raw support diagnostics without fabricating a result', () => {
    const scene = createPhotoelectricEffectScene({ now })
    scene.modernPhysicsBenches![0]!.lightIntensity = quantity(0, 'W/m²', 'intensity')
    const spy = vi.spyOn(ModernPhysicsEngine.prototype, 'simulate')
    const runtime = createModernPhysicsWorkspaceRuntime(scene)
    const frame = runtime.getSnapshot()
    const capture = runtime.captureRaw()
    expect(frame.status).toBe('failed')
    expect(capture.scene).toEqual(scene)
    expect(capture.result).toBeUndefined()
    expect(capture.request).toBeUndefined()
    expect(capture.state).toBeUndefined()
    expect(capture.diagnostics?.length).toBeGreaterThan(0)
    expect(capture.clock).toEqual({ time: 0, total: 0, running: false, rate: 1 })
    expect(spy).not.toHaveBeenCalled()
  })

  it('does not accept a passed status that contradicts an actual failed check', () => {
    const actual = ModernPhysicsEngine.prototype.simulate
    vi.spyOn(ModernPhysicsEngine.prototype, 'simulate').mockImplementation(function(this: ModernPhysicsEngine, scene, request) {
      const result = actual.call(this, scene, request)
      result.verification.checks.push({ id: 'contradictory-verdict', type: 'constraint', passed: false })
      return result
    })
    const runtime = createModernPhysicsWorkspaceRuntime(createPhotoelectricEffectScene({ now }))
    expect(runtime.getSnapshot().status).toBe('failed')
    const capture = runtime.captureRaw()
    expect(capture.result?.verification.status).toBe('passed')
    expect(capture.result?.verification.checks.find(check => check.id === 'contradictory-verdict')?.passed).toBe(false)
    expect(capture.diagnostics).toContainEqual(expect.objectContaining({ code: 'MODERN_SIMULATION_FAILED' }))
  })

  it('preserves a finite failed engine result with malformed verification as raw diagnostics instead of rendering it', () => {
    const actual = ModernPhysicsEngine.prototype.simulate
    vi.spyOn(ModernPhysicsEngine.prototype, 'simulate').mockImplementation(function(this: ModernPhysicsEngine, scene, request) {
      const result = actual.call(this, scene, request)
      Reflect.set(result, 'verification', { status: 'passed', warnings: [], errors: [] })
      return result
    })
    const runtime = createModernPhysicsWorkspaceRuntime(createPhotoelectricEffectScene({ now }))
    const frame = runtime.getSnapshot()
    const capture = runtime.captureRaw()
    expect(frame.status).toBe('failed')
    expect(frame.error?.code).toBe('MODERN_SIMULATION_IDENTITY_MISMATCH')
    expect(frame.verification).toEqual([])
    expect(frame.view.particles).toEqual([])
    expect(capture.result?.verification).toEqual({ status: 'passed', warnings: [], errors: [] })
    expect(capture.diagnostics).toContainEqual(expect.objectContaining({ code: 'MODERN_SIMULATION_IDENTITY_MISMATCH' }))
  })

  it('accepts a real result whose trace only declares traceId', () => {
    const actual = ModernPhysicsEngine.prototype.simulate
    vi.spyOn(ModernPhysicsEngine.prototype, 'simulate').mockImplementation(function(this: ModernPhysicsEngine, scene, request) {
      const result = actual.call(this, scene, request)
      result.trace = { traceId: request.trace.traceId }
      return result
    })
    const runtime = createModernPhysicsWorkspaceRuntime(createPhotoelectricEffectScene({ now }))
    expect(runtime.getSnapshot().status).toBe('verified')
    expect(runtime.captureRaw().result?.trace).toEqual({ traceId: runtime.captureRaw().request?.trace.traceId })
  })

  it('keeps an identity-mismatched result only as failed raw evidence, not a valid visual frame', () => {
    const actual = ModernPhysicsEngine.prototype.simulate
    const spy = vi.spyOn(ModernPhysicsEngine.prototype, 'simulate').mockImplementation(function(this: ModernPhysicsEngine, scene, request) {
      const result = actual.call(this, scene, request)
      result.sceneRevision += 1
      return result
    })
    const runtime = createModernPhysicsWorkspaceRuntime(createPhotoelectricEffectScene({ now }))
    const frame = runtime.getSnapshot()
    const capture = runtime.captureRaw()
    expect(frame.status).toBe('failed')
    expect(frame.error?.code).toBe('MODERN_SIMULATION_IDENTITY_MISMATCH')
    expect(frame.view.particles).toEqual([])
    expect(capture.result?.sceneRevision).not.toBe(capture.scene.revision)
    expect(capture.diagnostics).toContainEqual(expect.objectContaining({ code: 'MODERN_SIMULATION_IDENTITY_MISMATCH' }))
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
