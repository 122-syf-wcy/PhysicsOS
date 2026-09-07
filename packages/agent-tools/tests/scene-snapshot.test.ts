import { PhysicsToolRuntime, ToolRuntimeError } from '../src/index.ts'

describe('PhysicsToolRuntime.sceneSnapshot', () => {
  it('returns a deep copy of the live scene at its current revision', () => {
    const runtime = new PhysicsToolRuntime()
    const description = runtime.createExperiment('magnetic-circular')
    const snapshot = runtime.sceneSnapshot(description.sceneId)
    expect(String(snapshot.id)).toBe(description.sceneId)
    expect(snapshot.revision).toBe(0)
    expect(snapshot.schemaVersion).toBe('physics-scene/1.0')
    /* JSON round trip: the snapshot is what a harness binding can put on a session log. */
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
  })

  it('follows the revision after a command and cannot be used to bypass the command gate', () => {
    const runtime = new PhysicsToolRuntime()
    const description = runtime.createExperiment('magnetic-circular')
    const field = description.objects.find((object) => object.kind === 'uniform_magnetic')!
    const before = runtime.sceneSnapshot(description.sceneId)
    before.particles[0]!.mass.value = 42 // mutating the copy must not touch the runtime
    runtime.applyCommand(description.sceneId, 'SetMagneticFieldStrength', {
      fieldId: field.id,
      strength: { value: 1, unit: 'T' },
    })
    const after = runtime.sceneSnapshot(description.sceneId)
    expect(after.revision).toBe(1)
    expect(after.particles[0]!.mass.value).not.toBe(42)
    const magnetic = after.fields.find((entry) => entry.type === 'uniform_magnetic')
    expect(magnetic?.type === 'uniform_magnetic' ? Math.abs(magnetic.magneticFluxDensity.vector.z) : undefined).toBe(1)
  })

  it('rejects an unknown scene with the coded error', () => {
    const runtime = new PhysicsToolRuntime()
    expect(() => runtime.sceneSnapshot('ghost')).toThrowError(ToolRuntimeError)
  })
})
