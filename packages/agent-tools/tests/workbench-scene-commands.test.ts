import { describe, expect, it } from 'vitest'
import { SceneRuntime, createMechanicsScene, createPhotoelectricEffectScene, createSceneCommand, type SceneCommand, type SceneCommandInput, type SceneCommandPayloadMap, type SceneCommandType } from '@physicsos/physics-scene'
import { derivedScalar } from '@physicsos/physics-core'
import { ModernPhysicsEngine, createModernSimulationRequest } from '@physicsos/engine-modern'
import { MechanicsEngine, createMechanicsSimulationRequest } from '@physicsos/engine-mechanics'
import { COMMAND_SPECS, commandReferenceText, normalizeCommandPayload } from '../src/scene-commands.ts'

const types = [
  'SetOrbitRadius', 'SetOrbitalGravitationalParameter', 'SetPhotoelectricWorkFunction',
  'SetPhotonWavelength', 'SetLightIntensity', 'SetCathodeArea', 'SetQuantumEfficiency',
] as const satisfies readonly SceneCommandType[]

const execute = (runtime: SceneRuntime, type: SceneCommandType, payload: Record<string, unknown>) => {
  const scene = runtime.getScene()
  /* The test drives heterogeneous commands through one helper; the envelope
     is asserted at this boundary, which is exactly where the runtime proves
     the payload. */
  const input: SceneCommandInput<SceneCommandType> = {
    commandId: `tool-${type}-${scene.revision}`, sceneId: String(scene.id), expectedRevision: scene.revision,
    type, payload: payload as SceneCommandPayloadMap[SceneCommandType], traceId: `tool-trace-${scene.revision}`,
  }
  /* `execute` narrows on a discriminated union, which a runtime-selected
     command type cannot satisfy statically. The helper asserts the envelope
     here; every call site still proves the payload through execution. */
  return runtime.execute(createSceneCommand(input) as Parameters<SceneRuntime['execute']>[0])
}

describe('workbench fact commands remain discoverable and exhaustively typed', () => {
  it('includes all seven commands with exact payload fields and unit/range descriptions', () => {
    const reference = commandReferenceText()
    for (const type of types) {
      expect(COMMAND_SPECS[type]).toBeDefined()
      expect(reference).toContain(`- ${type} [`)
      expect(Object.values(COMMAND_SPECS[type].fields).every(field => field.description.length > 0)).toBe(true)
    }
    expect(COMMAND_SPECS.SetOrbitRadius.fields.radius).toMatchObject({ kind: 'quantity', dimension: 'length' })
    expect(COMMAND_SPECS.SetOrbitalGravitationalParameter.fields.gravitationalParameter!.description).toContain('m³/s²')
    expect(COMMAND_SPECS.SetPhotoelectricWorkFunction.fields.workFunction).toMatchObject({ kind: 'quantity', dimension: 'energy' })
    expect(COMMAND_SPECS.SetPhotonWavelength.fields.wavelength).toMatchObject({ kind: 'quantity', dimension: 'length' })
    expect(COMMAND_SPECS.SetLightIntensity.fields.intensity).toMatchObject({ kind: 'quantity', dimension: 'intensity' })
    expect(COMMAND_SPECS.SetCathodeArea.fields.area).toMatchObject({ kind: 'quantity', dimension: 'area' })
    expect(COMMAND_SPECS.SetQuantumEfficiency.fields.efficiency!.description).toContain('0 ≤ η ≤ 1')
  })

  it('normalizes optical material units then recomputes through the real engine', () => {
    const runtime = new SceneRuntime(createPhotoelectricEffectScene())
    const benchId = String(runtime.getScene().modernPhysicsBenches![0]!.id)
    const wavelength = normalizeCommandPayload('SetPhotonWavelength', { benchId, wavelength: { value: 400, unit: 'nm' } })
    expect(wavelength).toEqual({ benchId, wavelength: { value: 400, unit: 'nm', dimension: 'length' } })
    expect(execute(runtime, 'SetPhotonWavelength', wavelength).ok).toBe(true)
    expect(execute(runtime, 'SetPhotoelectricWorkFunction', normalizeCommandPayload('SetPhotoelectricWorkFunction', { benchId, workFunction: { value: 2, unit: 'eV' } })).ok).toBe(true)
    expect(execute(runtime, 'SetLightIntensity', normalizeCommandPayload('SetLightIntensity', { benchId, intensity: { value: 10, unit: 'W/m^2' } })).ok).toBe(true)
    expect(execute(runtime, 'SetCathodeArea', normalizeCommandPayload('SetCathodeArea', { benchId, area: { value: 1, unit: 'cm^2' } })).ok).toBe(true)
    expect(execute(runtime, 'SetQuantumEfficiency', normalizeCommandPayload('SetQuantumEfficiency', { benchId, efficiency: 0.5 })).ok).toBe(true)
    const scene = runtime.getScene()
    const engine = new ModernPhysicsEngine()
    const result = engine.simulate(scene, createModernSimulationRequest(scene, 'tool-modern-result', 'trace'))
    expect(result.verification.status).not.toBe('failed')
    expect(result.sceneRevision).toBe(5)
    expect(derivedScalar(result.derivedQuantities, 'photon_energy').value).toBeGreaterThan(3e-19)
  })

  it('normalizes orbital radius as a quantity and GM as explicit SI, without confusing mass with GM', () => {
    const runtime = new SceneRuntime(createMechanicsScene({ model: 'circular_orbit', orbitRadius: 2, gravitationalParameter: 32 }))
    const observableId = String(runtime.getScene().observableDefinitions.find(definition => definition.parameters?.kind === 'orbit')!.id)
    expect(execute(runtime, 'SetOrbitRadius', normalizeCommandPayload('SetOrbitRadius', { observableId, radius: { value: 8, unit: 'm' } })).ok).toBe(true)
    expect(execute(runtime, 'SetOrbitalGravitationalParameter', normalizeCommandPayload('SetOrbitalGravitationalParameter', { observableId, gravitationalParameter: 128 })).ok).toBe(true)
    const scene = runtime.getScene()
    const engine = new MechanicsEngine()
    const result = engine.simulate(scene, createMechanicsSimulationRequest(scene, 'tool-orbit-result', 'trace'))
    expect(derivedScalar(result.derivedQuantities, 'orbital_speed').value).toBe(4)
    expect(derivedScalar(result.derivedQuantities, 'orbital_period').value).toBeCloseTo(4 * Math.PI, 12)
    expect(scene.revision).toBe(2)
  })

  it('refuses malformed field shapes and delegates physical bounds to the actual command gate', () => {
    expect(() => normalizeCommandPayload('SetQuantumEfficiency', { benchId: 'bench', efficiency: Number.NaN })).toThrow()
    expect(() => normalizeCommandPayload('SetPhotonWavelength', { benchId: 'bench' })).toThrow()
    const runtime = new SceneRuntime(createPhotoelectricEffectScene())
    const benchId = String(runtime.getScene().modernPhysicsBenches![0]!.id)
    const before = runtime.getScene()
    expect(execute(runtime, 'SetQuantumEfficiency', normalizeCommandPayload('SetQuantumEfficiency', { benchId, efficiency: 2 })).ok).toBe(false)
    expect(execute(runtime, 'SetPhotonWavelength', normalizeCommandPayload('SetPhotonWavelength', { benchId, wavelength: { value: -1, unit: 'm' } })).ok).toBe(false)
    expect(runtime.getScene()).toEqual(before)
  })
})
