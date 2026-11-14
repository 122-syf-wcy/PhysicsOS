import { describe, expect, it } from 'vitest'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import {
  SceneRuntime,
  createMechanicsScene,
  createSceneCommand,
  forkExperimentalScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '../src/index.ts'

const now = '2026-11-08T00:00:00.000Z'
const sceneOf = () => createMechanicsScene({ model: 'circular_orbit', gravitationalParameter: 32, orbitRadius: 2, mass: 3, now })
const orbitOf = (runtime: SceneRuntime) => runtime.peekScene().observableDefinitions.find(observable => observable.parameters?.kind === 'orbit')!
const execute = <T extends SceneCommandType>(runtime: SceneRuntime, type: T, payload: SceneCommandPayloadMap[T]) => {
  const scene = runtime.peekScene()
  return runtime.execute(createSceneCommand({
    commandId: `orbit-${type}-${scene.revision}`, sceneId: String(scene.id), expectedRevision: scene.revision,
    type, payload, traceId: `orbit-${type}`, issuedAt: now,
  }) as SceneCommand)
}

describe('circular orbit physical scene commands', () => {
  it('sets canonical radius from a non-SI quantity and synchronizes the declared t=0 geometry', () => {
    const source = sceneOf()
    const before = structuredClone(source)
    const runtime = new SceneRuntime(source, { now: () => now })
    const observableId = orbitOf(runtime).id
    const radius = quantity(800, 'cm', 'length')
    const result = execute(runtime, 'SetOrbitRadius', { observableId, radius })
    expect(result.ok).toBe(true)
    expect(orbitOf(runtime).parameters).toMatchObject({ radius: 8, gravitationalParameter: 32 })
    expect(runtime.peekScene().bodies[0]!.position.vector).toEqual({ x: 8, y: 0, z: 0 })
    expect(runtime.peekScene().bodies[0]!.velocity.vector).toEqual({ x: 0, y: 2, z: 0 })
    expect(runtime.getEvents()[0]).toMatchObject({ type: 'OrbitRadiusChanged', payload: { observableId, radius } })
    expect(runtime.peekScene().revision).toBe(1)
    expect(source).toEqual(before)
    radius.value = 999
    expect(orbitOf(runtime).parameters?.radius).toBe(8)
  })

  it('sets explicit SI GM and leaves radius as the sole other orbit fact', () => {
    const runtime = new SceneRuntime(sceneOf(), { now: () => now })
    const observableId = orbitOf(runtime).id
    const result = execute(runtime, 'SetOrbitalGravitationalParameter', { observableId, gravitationalParameter: 128 })
    expect(result.ok).toBe(true)
    expect(orbitOf(runtime).parameters).toMatchObject({ radius: 2, gravitationalParameter: 128 })
    expect(runtime.peekScene().bodies[0]!.velocity.vector).toEqual({ x: 0, y: 8, z: 0 })
    expect(canonicalValue(runtime.peekScene().bodies[0]!.mass)).toBe(3)
    expect(runtime.getEvents()[0]).toMatchObject({ type: 'OrbitalGravitationalParameterChanged', payload: { observableId, gravitationalParameter: 128 } })
  })

  it.each([0, -1, NaN, Infinity, -Infinity])('rejects invalid orbit radius %s atomically', value => {
    const runtime = new SceneRuntime(sceneOf(), { now: () => now })
    const before = runtime.peekScene()
    const result = execute(runtime, 'SetOrbitRadius', { observableId: orbitOf(runtime).id, radius: { value, unit: 'm', dimension: 'length' } })
    expect(result.ok).toBe(false)
    expect(runtime.peekScene()).toBe(before)
    expect(runtime.getEvents()).toEqual([])
  })

  it.each([0, -1, NaN, Infinity, -Infinity, '32'])('rejects invalid GM %s without number coercion', value => {
    const runtime = new SceneRuntime(sceneOf(), { now: () => now })
    const before = runtime.peekScene()
    const result = execute(runtime, 'SetOrbitalGravitationalParameter', { observableId: orbitOf(runtime).id, gravitationalParameter: value as number })
    expect(result.ok).toBe(false)
    expect(runtime.peekScene()).toBe(before)
    expect(runtime.getEvents()).toEqual([])
  })

  it('rejects facts whose otherwise positive inputs overflow the actual orbit solution', () => {
    const runtime = new SceneRuntime(sceneOf(), { now: () => now })
    const before = runtime.peekScene()
    const result = execute(runtime, 'SetOrbitRadius', { observableId: orbitOf(runtime).id, radius: quantity(Number.MIN_VALUE, 'm', 'length') })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected an unrepresentable orbital solution rejection.')
    expect(result.error.code).toBe('INVALID_ORBIT_FACTS')
    expect(runtime.peekScene()).toBe(before)
  })

  it('rejects a non-orbit target without turning it into an orbital model', () => {
    const runtime = new SceneRuntime(sceneOf(), { now: () => now })
    const before = runtime.peekScene()
    const observableId = before.observableDefinitions.find(observable => observable.parameters?.kind !== 'orbit')!.id
    const result = execute(runtime, 'SetOrbitRadius', { observableId, radius: quantity(8, 'm', 'length') })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected a wrong orbital submodel rejection.')
    expect(result.error.code).toBe('ORBIT_WRONG_SUBMODEL')
    expect(runtime.peekScene()).toBe(before)
  })

  it('rejects an orbit-shaped observable in a competing spring model rather than editing an ignored parameter', () => {
    const scene = sceneOf()
    scene.constraints.push({ id: 'spring', type: 'spring', targets: [scene.bodies[0]!.id], parameters: { stiffness: 10, naturalLength: 1, axis: 'horizontal' } })
    const runtime = new SceneRuntime(scene, { now: () => now })
    const before = runtime.peekScene()
    expect(execute(runtime, 'SetOrbitRadius', { observableId: orbitOf(runtime).id, radius: quantity(8, 'm', 'length') }).ok).toBe(false)
    expect(runtime.peekScene()).toBe(before)
  })

  it('leaves an original scene untouched when a fork changes GM or radius', () => {
    const source = sceneOf()
    const before = structuredClone(source)
    const fork = forkExperimentalScene({ scene: source, sceneId: 'orbit-fork', now })
    const runtime = new SceneRuntime(fork, { now: () => now })
    expect(execute(runtime, 'SetOrbitRadius', { observableId: orbitOf(runtime).id, radius: quantity(8, 'm', 'length') }).ok).toBe(true)
    expect(execute(runtime, 'SetOrbitalGravitationalParameter', { observableId: orbitOf(runtime).id, gravitationalParameter: 128 }).ok).toBe(true)
    expect(runtime.peekScene().revision).toBe(2)
    expect(runtime.peekScene().metadata.lineage?.originSceneId).toBe(source.id)
    expect(source).toEqual(before)
  })
})
