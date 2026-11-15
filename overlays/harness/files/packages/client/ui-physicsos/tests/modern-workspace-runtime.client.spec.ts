import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModernPhysicsEngine } from '@physicsos/engine-modern'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import { createPhotoelectricEffectScene, type PhysicsScene } from '@physicsos/physics-scene'
import type { CapturedResult } from '@physicsos/physics-workbench/types'

import { createModernPhysicsWorkspaceRuntime } from '../src/client/physics/modern-workspace-runtime.ts'
import { modernSceneVisual } from '../src/client/physics/modern-visual-bridge.ts'
import { createWorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'
import { universalContributionSnapshot } from '../src/client/experiments/contribution-protocol.ts'
import { isUniversalSnapshot } from '../src/client/experiments/universal-contract.ts'
import { formatSignificant } from '../src/client/physics/number-format.ts'

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

const schematicGeometry = (view: ReturnType<typeof modernSceneVisual>) => ({
  origin: view.origin,
  extent: view.extent,
  id: view.photoelectricRig?.id,
  cathodeAt: view.photoelectricRig?.cathodeAt,
  collectorAt: view.photoelectricRig?.collectorAt,
  sourceAt: view.photoelectricRig?.sourceAt,
  halfHeight: view.photoelectricRig?.halfHeight,
})

describe('trusted photoelectric apparatus frame', () => {
  it('keeps its fixed schematic electrodes and camera bounds when emission changes or efficiency is zero', () => {
    const runtime = createModernPhysicsWorkspaceRuntime(createPhotoelectricEffectScene({ now }))
    const first = runtime.getSnapshot().view
    expect(first.photoelectricRig).toMatchObject({
      id: 'modern-photoelectric-bench', cathodeAt: { x: 0, y: 0 },
      collectorAt: { x: 160, y: 0 }, sourceAt: { x: -170, y: 0 }, halfHeight: 60,
    })
    const below = runtime.editParameter('photonWavelength', 700e-9).view
    expect(schematicGeometry(below)).toEqual(schematicGeometry(first))
    expect(below.trajectories.filter(path => path.id.startsWith('modern-electron-'))).toEqual([])
    expect(below.photoelectricRig!.photocurrentText).toBe('光电流 I = 0 A')
    expect(below.photoelectricRig!.stoppingPotentialText).toBe('遏止电压 Us = 0 V')
    runtime.editParameter('photonWavelength', 300e-9)
    const zeroEfficiency = runtime.editParameter('quantumEfficiency', 0).view
    expect(schematicGeometry(zeroEfficiency)).toEqual(schematicGeometry(first))
    expect(zeroEfficiency.photoelectricRig!.photocurrentText).toBe('光电流 I = 0 A')
    const raw = runtime.captureRaw()
    expect(scalar(raw, 'photocurrent')).toBe(0)
    expect(scalar(raw, 'stopping_potential')).toBeGreaterThan(0)
    expect(zeroEfficiency.overlay.readout).toContain(zeroEfficiency.photoelectricRig!.stoppingPotentialText)
  })

  it('formats tiny trusted current without rounding it to zero and retains all raw metadata', () => {
    const runtime = createModernPhysicsWorkspaceRuntime(createPhotoelectricEffectScene({ now, lightIntensity: 1.234567890123456e-20 }))
    const before = runtime.captureRaw()
    const current = scalar(before, 'photocurrent')
    expect(current).toBeGreaterThan(0)
    expect(current).toBeLessThan(1e-20)
    const snapshot = runtime.getSnapshot()
    expect(snapshot.view.photoelectricRig!.photocurrentText).toBe(`光电流 I = ${formatSignificant(current)} A`)
    expect(snapshot.view.photoelectricRig!.photocurrentText).not.toBe('光电流 I = 0 A')
    expect(snapshot.view.overlay.readout).toContain(snapshot.view.photoelectricRig!.photocurrentText)
    expect(snapshot.view.overlay.readout).toContain(snapshot.view.photoelectricRig!.stoppingPotentialText)
    const serialized = universalContributionSnapshot(snapshot, 'photoelectric-effect')
    expect(isUniversalSnapshot(serialized, 'photoelectric-effect')).toBe(true)
    const legacy = structuredClone(serialized)
    Reflect.deleteProperty(legacy.view, 'photoelectricRig')
    expect(isUniversalSnapshot(legacy, 'photoelectric-effect')).toBe(true)
    expect(runtime.captureRaw()).toEqual(before)
    expect(before.request?.sceneRevision).toBe(before.scene.revision)
    expect(before.result?.sceneRevision).toBe(before.scene.revision)
    expect(before.state).toEqual(before.result?.states[0])
  })

  it('accepts equivalent non-SI input in the bridge itself without canonicalizing or mutating captured scene facts', () => {
    const alternate = createPhotoelectricEffectScene({ now })
    alternate.modernPhysicsBenches![0]!.workFunction = quantity(2, 'eV', 'energy')
    alternate.modernPhysicsBenches![0]!.photonWavelength = quantity(0.00004, 'cm', 'length')
    alternate.modernPhysicsBenches![0]!.cathodeArea = quantity(1, 'cm²', 'area')
    const before = structuredClone(alternate)
    const runtime = createModernPhysicsWorkspaceRuntime(alternate)
    const capture = runtime.captureRaw()
    if (capture.result === undefined) throw new Error('Expected verified non-SI photoelectric result.')
    const direct = modernSceneVisual(alternate, capture.result)
    expect(direct).toEqual(runtime.getSnapshot().view)
    expect(direct.overlay.readout).toContain('λ = 4.000e-7 m')
    expect(direct.overlay.readout).toContain(`逸出功 W = ${formatSignificant(2 * e)} J`)
    expect(direct.photoelectricRig!.photocurrentText).toBe(`光电流 I = ${formatSignificant(scalar(capture, 'photocurrent'))} A`)
    expect(capture.scene.modernPhysicsBenches).toEqual(before.modernPhysicsBenches)
    expect(alternate).toEqual(before)
  })

  it('does not publish schematic apparatus on an unsupported or identity-mismatched runtime frame', () => {
    const bad = createPhotoelectricEffectScene({ now })
    bad.modernPhysicsBenches![0]!.workFunction = quantity(0, 'J', 'energy')
    expect(createModernPhysicsWorkspaceRuntime(bad).getSnapshot().view.photoelectricRig).toBeUndefined()
    const actual = ModernPhysicsEngine.prototype.simulate
    vi.spyOn(ModernPhysicsEngine.prototype, 'simulate').mockImplementation(function(this: ModernPhysicsEngine, scene, request) {
      const result = actual.call(this, scene, request)
      result.sceneRevision += 1
      return result
    })
    expect(createModernPhysicsWorkspaceRuntime(createPhotoelectricEffectScene({ now })).getSnapshot().view.photoelectricRig).toBeUndefined()
  })
})

const preciseEdits = [
  ['workFunction', 3.456789012345678e-19, 'J'],
  ['photonWavelength', 3.456789012345678e-7, 'm'],
  ['photonFrequency', 8.765432109876543e14, 'Hz'],
  ['lightIntensity', 1.234567890123456e-20, 'W/m²'],
  ['cathodeArea', 1.234567890123456e-12, 'm²'],
  ['quantumEfficiency', 0.12345678901234566, ''],
] as const

const parameterOf = (runtime: ReturnType<typeof createWorkbenchInstanceRuntime>, id: string) =>
  runtime.frames.getSnapshot().inspector.flatMap(section => section.parameters ?? []).find(parameter => parameter.id === id)!

const expectPrecise = (actual: number, expected: number): void => {
  expect(actual).toBeGreaterThan(0)
  expect(Math.abs((actual - expected) / expected)).toBeLessThan(4 * Number.EPSILON)
}

describe('photoelectric six-parameter round trips', () => {
  it.each(preciseEdits)('keeps %s SI precision through preview, cancel, commit, reopening and origin restore', (id, value, unit) => {
    const source = sourceScene()
    source.modernPhysicsBenches![0]!.workFunction = quantity(2, 'eV', 'energy')
    source.modernPhysicsBenches![0]!.photonWavelength = quantity(0.00004, 'cm', 'length')
    source.modernPhysicsBenches![0]!.cathodeArea = quantity(1, 'cm²', 'area')
    const original = structuredClone(source)
    const onCommitted = vi.fn()
    const onPersist = vi.fn()
    const owner = createWorkbenchInstanceRuntime({
      scene: source, originScene: source, source: { kind: 'question', questionId: 'modern-question-1' },
      templateId: 'photoelectric-effect', scheduler: null, onCommitted, onPersist,
    })
    let reopened: ReturnType<typeof createWorkbenchInstanceRuntime> | undefined
    try {
      const before = owner.serialize()
      const rawBefore = owner.captureRaw()
      expect(parameterOf(owner, id).unit).toBe(unit)
      const initialGeometry = schematicGeometry(owner.frames.getSnapshot().view)
      owner.previewParameter(id, value)
      expect(owner.getSnapshot().previewing).toBe(true)
      expectPrecise(parameterOf(owner, id).value, value)
      expect(owner.serialize()).toEqual(before)
      expect(onCommitted).not.toHaveBeenCalled()
      expect(onPersist).not.toHaveBeenCalled()
      expect(() => owner.captureRaw()).toThrow(/CAPTURE_UNAVAILABLE/)
      owner.cancelParameterPreview()
      expect(owner.captureRaw()).toEqual(rawBefore)
      expect(owner.serialize()).toEqual(before)
      owner.commitParameter(id, value)
      expect(owner.getSnapshot().previewing).toBe(false)
      expectPrecise(parameterOf(owner, id).value, value)
      expect(onCommitted).toHaveBeenCalledTimes(1)
      expect(onPersist).toHaveBeenCalledTimes(1)
      const saved = owner.serialize()
      expect(saved.history.past).toHaveLength(1)
      expect(schematicGeometry(owner.frames.getSnapshot().view)).toEqual(initialGeometry)
      const raw = owner.captureRaw()
      expect(raw.result?.sceneRevision).toBe(raw.scene.revision)
      expect(raw.request?.sceneRevision).toBe(raw.scene.revision)
      expect(raw.result?.verification.status).toBe('passed')
      if (id !== 'photonFrequency') {
        const bench = raw.scene.modernPhysicsBenches![0]!
        const fact = bench[id]
        expect(typeof fact === 'number' ? fact : canonicalValue(fact)).toBe(value)
      } else {
        expectPrecise(c / canonicalValue(raw.scene.modernPhysicsBenches![0]!.photonWavelength), value)
      }
      const wire = universalContributionSnapshot(owner.frames.getSnapshot(), 'photoelectric-effect')
      expect(isUniversalSnapshot(wire, 'photoelectric-effect')).toBe(true)
      const wireParameter = wire.inspector.flatMap(section => (section as { parameters?: { id: string; value: number }[] }).parameters ?? []).find(parameter => parameter.id === id)!
      expectPrecise(wireParameter.value, value)
      const persisted = JSON.parse(JSON.stringify(saved)) as typeof saved
      reopened = createWorkbenchInstanceRuntime({
        instanceKey: persisted.instanceKey, sceneId: String(persisted.scene.id), scene: persisted.scene,
        ...(persisted.originScene === undefined ? {} : { originScene: persisted.originScene }),
        templateId: 'photoelectric-effect', source: persisted.source, buildMode: persisted.buildMode,
        clock: persisted.clock, instanceEditRevision: persisted.instanceEditRevision,
        persistedHistory: persisted.history, scheduler: null,
      })
      expectPrecise(parameterOf(reopened, id).value, value)
      expect(reopened.captureRaw().scene.modernPhysicsBenches).toEqual(raw.scene.modernPhysicsBenches)
      owner.restoreOrigin()
      expect(owner.captureRaw().scene.modernPhysicsBenches).toEqual(original.modernPhysicsBenches)
      expect(source).toEqual(original)
    } finally {
      reopened?.dispose()
      owner.dispose()
    }
  })
})
