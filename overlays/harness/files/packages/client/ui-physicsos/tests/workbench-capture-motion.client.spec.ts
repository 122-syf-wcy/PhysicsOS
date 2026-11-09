import { afterEach, describe, expect, it, vi } from 'vitest'
import { CollisionEngine } from '@physicsos/engine-collision'
import { MagneticEngine } from '@physicsos/engine-magnetic'
import { MechanicsEngine } from '@physicsos/engine-mechanics'
import {
  derivedScalar,
  derivedVector,
  summarizeVerification,
  type QuantityVector,
  type SimulationResult,
  type SimulationState,
} from '@physicsos/physics-core'
import {
  SceneStore,
  createCollisionScene,
  createMagneticScene,
  createMechanicsScene,
} from '@physicsos/physics-scene'
import type { PhysicalDimension } from '@physicsos/physics-units'
import type { CapturedResult } from '@physicsos/physics-workbench/types'
import { createMagneticRuntime } from '../src/client/physics-runtime-bridge.ts'
import { createCollisionWorkspaceRuntime } from '../src/client/physics/collision-workspace-runtime.ts'
import { createMagneticWorkspaceRuntime } from '../src/client/physics/magnetic-workspace-runtime.ts'
import { createMechanicsRuntime } from '../src/client/physics/mechanics-runtime-bridge.ts'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'

const NOW = '2026-11-08T00:00:00.000Z'

afterEach(() => { vi.restoreAllMocks() })

const resultOf = (capture: CapturedResult): SimulationResult => {
  if (capture.result === undefined) throw new Error('Expected a held simulation result.')
  return capture.result
}

const stateOf = (capture: CapturedResult): SimulationState => {
  if (capture.state === undefined) throw new Error('Expected a held projected state.')
  return capture.state
}

const objectOf = (state: SimulationState, id?: string) => {
  const object = id === undefined ? state.objects[0] : state.objects.find(candidate => candidate.id === id)
  if (object === undefined) throw new Error(`Missing raw object ${id ?? '0'}.`)
  return object
}

const scalarOf = (capture: CapturedResult, key: string): number =>
  derivedScalar(resultOf(capture).derivedQuantities, key).value

const expectVector = (
  actual: QuantityVector | undefined,
  expected: readonly [number, number, number],
  unit: string,
  dimension: PhysicalDimension,
): void => {
  if (actual === undefined) throw new Error(`Missing ${dimension} vector.`)
  expect(actual.unit).toBe(unit)
  expect(actual.dimension).toBe(dimension)
  for (const [index, axis] of (['x', 'y', 'z'] as const).entries()) {
    expect(Number.isFinite(actual.vector[axis])).toBe(true)
    expect(actual.vector[axis]).toBeCloseTo(expected[index]!, 9)
  }
}

const forceOf = (state: SimulationState): QuantityVector => {
  const force = objectOf(state).values?.['lorentz_force']
  if (force === undefined || !('vector' in force)) throw new Error('Missing raw Lorentz force.')
  return force
}

const expectFiniteState = (state: SimulationState): void => {
  expect(state.time.unit).toBe('s')
  expect(state.time.dimension).toBe('time')
  expect(Number.isFinite(state.time.value)).toBe(true)
  const quantities = [
    ...state.derived.map(entry => entry.value),
    ...state.objects.flatMap(object => [
      ...[object.position, object.velocity, object.acceleration].filter(value => value !== undefined),
      ...Object.values(object.values ?? {}),
    ]),
  ]
  for (const quantity of quantities) {
    expect(typeof quantity.unit).toBe('string')
    expect(quantity.dimension).not.toBe('')
    if (quantity.dimension !== 'dimensionless') expect(quantity.unit).not.toBe('')
    if ('vector' in quantity) {
      for (const axis of ['x', 'y', 'z'] as const) expect(Number.isFinite(quantity.vector[axis])).toBe(true)
    } else {
      expect(Number.isFinite(quantity.value)).toBe(true)
    }
  }
}

const expectAligned = (capture: CapturedResult): void => {
  const request = capture.request
  const result = resultOf(capture)
  if (request === undefined) throw new Error('Expected the actual simulation request.')
  expect(request.schemaVersion).toBe('simulation-request/1.0')
  expect(result.schemaVersion).toBe('simulation-result/1.0')
  expect(request.sceneId).toBe(capture.scene.id)
  expect(result.sceneId).toBe(capture.scene.id)
  expect(request.sceneRevision).toBe(capture.scene.revision)
  expect(result.sceneRevision).toBe(capture.scene.revision)
  expect(request.simulationId).toBe(result.simulationId)
  expect(request.trace.sceneId).toBe(capture.scene.id)
  expect(request.trace.sceneRevision).toBe(capture.scene.revision)
  expect(capture.engineInfo.id).toBe(result.metadata.engineId)
  expect(capture.engineInfo.version).toBe(result.metadata.engineVersion)
  expect(capture.engineInfo.release).toEqual(capture.scene.metadata.experimentRelease)
  for (const state of result.states) expectFiniteState(state)
  if (capture.state !== undefined) expectFiniteState(capture.state)
  for (const key of ['view', 'charts', 'table', 'inspector', 'sampleReadout']) expect(key in capture).toBe(false)
}

const linearScene = () => createMechanicsScene({
  sceneId: 'capture-linear', model: 'uniform_linear_motion',
  position: { x: 1, y: 2, z: 0 }, velocity: { x: 4, y: 0, z: 0 }, now: NOW,
})

const collisionScene = () => createCollisionScene({
  sceneId: 'capture-collision', now: NOW,
  bodies: [
    { id: 'left-body', mass: 1, position: [-4, 0], velocity: [3, 0], restitution: 1 },
    { id: 'right-body', mass: 3, position: [4, 0], velocity: [-1, 0], restitution: 1 },
  ],
})

const magneticScene = () => createMagneticScene({
  sceneId: 'capture-magnetic', particleId: 'particle', fieldId: 'field',
  charge: 2, mass: 1, position: { x: 0, y: 0, z: 0 }, velocity: { x: 3, y: 0, z: 0 },
  magneticFieldStrength: 0.5, magneticFieldDirection: 'into_page', now: NOW,
})

describe('motion capture uses only evidence held by the current runtime', () => {
  it('retains exact requests, complete results and the last projected states without engine calls', () => {
    const mechanicsSimulate = vi.spyOn(MechanicsEngine.prototype, 'simulate')
    const mechanicsStateAt = vi.spyOn(MechanicsEngine.prototype, 'stateAt')
    const collisionSimulate = vi.spyOn(CollisionEngine.prototype, 'simulate')
    const collisionStateAt = vi.spyOn(CollisionEngine.prototype, 'stateAt')
    const magneticSimulate = vi.spyOn(MagneticEngine.prototype, 'simulate')
    const magneticStateAt = vi.spyOn(MagneticEngine.prototype, 'stateAt')
    const magneticStateAtSeconds = vi.spyOn(MagneticEngine.prototype, 'stateAtSeconds')
    const mechanics = createMechanicsWorkspaceRuntime(linearScene())
    const collision = createCollisionWorkspaceRuntime(collisionScene())
    const magnetic = createMagneticWorkspaceRuntime(magneticScene())

    mechanics.setRate(2)
    mechanics.setRunning(true)
    mechanics.advance(0.25)
    collision.seek(0.237)
    magnetic.seek(Math.PI / 2)
    const runtimes = [mechanics, collision, magnetic]
    const captures = runtimes.map(runtime => runtime.captureRaw())
    const snapshots = runtimes.map(runtime => runtime.getSnapshot())
    for (const capture of captures) expectAligned(capture)
    expect(captures[0]!.request).toBe(mechanicsSimulate.mock.calls[0]![1])
    expect(captures[0]!.result).toBe(mechanicsSimulate.mock.results[0]!.value)
    expect(captures[0]!.state).toBe(mechanicsStateAt.mock.results.at(-1)!.value)
    const external = captures[0]!.diagnostics?.find(diagnostic => diagnostic['kind'] === 'external-verification')
    expect(external).toEqual(expect.objectContaining({ sceneId: captures[0]!.scene.id, sceneRevision: captures[0]!.scene.revision }))
    expect(external?.['report']).toEqual(expect.objectContaining({ status: 'passed', checks: expect.any(Array), errors: [], warnings: [] }))
    expect(Object.isFrozen(external)).toBe(true)
    expect(captures[1]!.request).toBe(collisionSimulate.mock.calls[0]![1])
    expect(captures[1]!.result).toBe(collisionSimulate.mock.results[0]!.value)
    expect(resultOf(captures[1]!).states).toContain(stateOf(captures[1]!))
    expect(captures[2]!.request).toBe(magneticSimulate.mock.calls[0]![1])
    expect(resultOf(captures[2]!).states).toBe(magneticSimulate.mock.results[0]!.value.states)
    expect(captures[2]!.state).toBe(magneticStateAtSeconds.mock.results.at(-1)!.value)
    expectVector(objectOf(stateOf(captures[0]!)).position, [3, 2, 0], 'm', 'length')
    expectVector(objectOf(stateOf(captures[2]!)).position, [3, 3, 0], 'm', 'length')
    expect(captures[0]!.clock).toEqual({ time: 0.5, total: 10, running: true, rate: 2 })
    expect(captures[0]!.cursor).toEqual({ kind: 'time', time: { value: 0.5, unit: 's', dimension: 'time' } })
    expect(resultOf(captures[0]!).states).toHaveLength(65)
    expect(resultOf(captures[1]!).states).toHaveLength(1024)
    expect(resultOf(captures[2]!).states).toHaveLength(65)
    for (const simulate of [mechanicsSimulate, collisionSimulate, magneticSimulate]) expect(simulate).toHaveBeenCalledTimes(1)

    const clone = vi.spyOn(SceneStore.prototype, 'getScene')
    const mechanicsSupport = vi.spyOn(MechanicsEngine.prototype, 'canHandle')
    const collisionSupport = vi.spyOn(CollisionEngine.prototype, 'canHandle')
    const magneticSupport = vi.spyOn(MagneticEngine.prototype, 'canHandle')
    const calls = [mechanicsSimulate, mechanicsStateAt, collisionSimulate, collisionStateAt,
      magneticSimulate, magneticStateAt, magneticStateAtSeconds]
    for (const spy of calls) spy.mockClear()
    for (let frame = 0; frame < 20; frame += 1) {
      for (const [index, runtime] of runtimes.entries()) {
        const capture = runtime.captureRaw()
        expect(capture.scene).toBe(captures[index]!.scene)
        expect(capture.request).toBe(captures[index]!.request)
        expect(capture.result).toBe(captures[index]!.result)
        expect(capture.state).toBe(captures[index]!.state)
        expect(capture.clock).toEqual(captures[index]!.clock)
        if (index === 0) expect(capture.diagnostics?.find(diagnostic => diagnostic['kind'] === 'external-verification')).toBe(external)
        expect(runtime.getSnapshot().view).toEqual(snapshots[index]!.view)
      }
    }
    for (const spy of [...calls, clone, mechanicsSupport, collisionSupport, magneticSupport]) expect(spy).not.toHaveBeenCalled()
  })

  it('the magnetic bridge exposes the exact verified result used by its snapshot', () => {
    const stateAt = vi.spyOn(MagneticEngine.prototype, 'stateAtSeconds')
    const bridge = createMagneticRuntime(magneticScene())
    const snapshot = bridge.seek(Math.PI / 2)
    const capture = bridge.captureRaw()
    expect(capture.scene).toBe(snapshot.scene)
    expect(capture.result).toBe(snapshot.simulation)
    expect(capture.state).toBe(stateAt.mock.results.at(-1)!.value)
    expectVector(objectOf(stateOf(capture)).velocity, [0, 3, 0], 'm/s', 'velocity')
    expectVector(forceOf(stateOf(capture)), [-3, 0, 0], 'N', 'force')
    stateAt.mockClear()
    bridge.captureRaw()
    expect(stateAt).not.toHaveBeenCalled()
  })
})

describe('mechanics capture after actual parameter commands', () => {
  it('captures mass, gravity, height, angle and speed edits as signed projectile quantities', () => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({
      sceneId: 'capture-projectile', model: 'projectile_motion', mass: 1,
      position: { x: 0, y: 20, z: 0 }, velocity: { x: 10, y: 0, z: 0 },
      gravity: { x: 0, y: -10, z: 0 }, groundY: 0, now: NOW,
    }))
    const before = runtime.captureRaw()
    const saved = JSON.stringify(before)
    runtime.editParameter('mass', 2)
    let capture = runtime.captureRaw()
    expect(capture.scene.bodies[0]!.mass.value).toBe(2)
    expectVector(derivedVector(stateOf(capture).derived, 'net_force'), [0, -20, 0], 'N', 'force')
    runtime.editParameter('gravity', 5)
    capture = runtime.captureRaw()
    expectVector(objectOf(stateOf(capture)).acceleration, [0, -5, 0], 'm/s^2', 'acceleration')
    runtime.editParameter('height', 25)
    capture = runtime.captureRaw()
    expectVector(objectOf(stateOf(capture)).position, [0, 25, 0], 'm', 'length')
    runtime.editParameter('angle', 30)
    capture = runtime.captureRaw()
    expectVector(capture.scene.bodies[0]!.velocity, [5 * Math.sqrt(3), 5, 0], 'm/s', 'velocity')
    runtime.editParameter('speed', 20)
    runtime.seek(1)
    capture = runtime.captureRaw()
    expectAligned(capture)
    expect(capture.scene.revision).toBe(5)
    expectVector(objectOf(stateOf(capture)).position, [10 * Math.sqrt(3), 32.5, 0], 'm', 'length')
    expectVector(objectOf(stateOf(capture)).velocity, [10 * Math.sqrt(3), 5, 0], 'm/s', 'velocity')
    expectVector(derivedVector(stateOf(capture).derived, 'net_force'), [0, -10, 0], 'N', 'force')
    expect(capture.clock.total).toBeCloseTo(2 + Math.sqrt(14), 9)
    expect(resultOf(capture).states).toHaveLength(65)
    expect(JSON.stringify(before)).toBe(saved)
  })

  it('capturing at zero speed preserves the launch direction for a subsequent command', () => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({
      model: 'projectile_motion', position: { x: 0, y: 20, z: 0 },
      velocity: { x: 0, y: 0, z: 0 }, now: NOW,
    }))
    runtime.editParameter('angle', 30)
    const stopped = runtime.captureRaw()
    expectVector(stopped.scene.bodies[0]!.velocity, [0, 0, 0], 'm/s', 'velocity')
    expectVector(objectOf(stateOf(stopped)).velocity, [0, 0, 0], 'm/s', 'velocity')
    runtime.captureRaw()
    runtime.editParameter('speed', 25)
    const launched = runtime.captureRaw()
    expectAligned(launched)
    expectVector(launched.scene.bodies[0]!.velocity, [25 * Math.sqrt(3) / 2, 12.5, 0], 'm/s', 'velocity')
  })

  it('keeps complete oscillator samples through mass, stiffness, amplitude and gravity edits', () => {
    const simulate = vi.spyOn(MechanicsEngine.prototype, 'simulate')
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({
      sceneId: 'capture-oscillator', model: 'spring_oscillator', mass: 1,
      position: { x: 2.4, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
      springConstant: 4, springNaturalLength: 2, springAnchor: { x: 0, y: 0, z: 0 }, now: NOW,
    }))
    expect(scalarOf(runtime.captureRaw(), 'period')).toBeCloseTo(Math.PI, 9)
    runtime.editParameter('mass', 4)
    expect(scalarOf(runtime.captureRaw(), 'period')).toBeCloseTo(2 * Math.PI, 9)
    runtime.editParameter('springConstant', 16)
    expect(scalarOf(runtime.captureRaw(), 'period')).toBeCloseTo(Math.PI, 9)
    runtime.editParameter('amplitude', 0.8)
    runtime.editParameter('gravity', 5)
    const released = runtime.captureRaw()
    expectAligned(released)
    expect(scalarOf(released, 'amplitude')).toBeCloseTo(0.8, 9)
    expect(scalarOf(released, 'angular_frequency')).toBeCloseTo(2, 9)
    expect(scalarOf(released, 'period')).toBeCloseTo(Math.PI, 9)
    expectVector(released.scene.bodies[0]!.position, [2.8, 0, 0], 'm', 'length')
    runtime.seek(Math.PI / 4)
    const quarter = runtime.captureRaw()
    expectVector(objectOf(stateOf(quarter)).position, [2, 0, 0], 'm', 'length')
    expectVector(objectOf(stateOf(quarter)).velocity, [-1.6, 0, 0], 'm/s', 'velocity')
    expectVector(objectOf(stateOf(quarter)).acceleration, [0, 0, 0], 'm/s^2', 'acceleration')
    runtime.seek(Math.PI / 2)
    const half = runtime.captureRaw()
    expectVector(objectOf(stateOf(half)).position, [1.2, 0, 0], 'm', 'length')
    expectVector(derivedVector(stateOf(half).derived, 'spring_force'), [12.8, 0, 0], 'N', 'force')
    expectVector(objectOf(stateOf(half)).acceleration, [3.2, 0, 0], 'm/s^2', 'acceleration')
    expect(resultOf(half).states).toHaveLength(65)
    expect(half.result).toBe(released.result)
    expect(half.request).toBe(released.request)
    expect(simulate).toHaveBeenCalledTimes(5)
    runtime.seek(0)
    runtime.setRate(2)
    runtime.setRunning(true)
    runtime.advance(2 * Math.PI + 0.1)
    const wrapped = runtime.captureRaw()
    expect(wrapped.clock.time).toBeCloseTo(0.2, 9)
    expect(wrapped.clock.running).toBe(true)
    expect(wrapped.cursor.kind).toBe('time')
    expect(simulate).toHaveBeenCalledTimes(5)
  })

  it('captures pendulum length and angle in their actual parameter units', () => {
    const radians = Math.PI / 18
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({
      sceneId: 'capture-pendulum', model: 'simple_pendulum', mass: 1,
      position: { x: 2 * Math.sin(radians), y: 3 - 2 * Math.cos(radians), z: 0 },
      velocity: { x: 0, y: 0, z: 0 }, gravity: { x: 0, y: -10, z: 0 },
      pendulumLength: 2, pendulumPivot: { x: 0, y: 3, z: 0 }, now: NOW,
    }))
    const initialPeriod = 2 * Math.PI * Math.sqrt(2 / 10)
    expect(scalarOf(runtime.captureRaw(), 'period')).toBeCloseTo(initialPeriod, 9)
    runtime.editParameter('mass', 2)
    expect(scalarOf(runtime.captureRaw(), 'period')).toBeCloseTo(initialPeriod, 9)
    runtime.editParameter('pendulumLength', 1)
    const shortened = runtime.captureRaw()
    expect(shortened.scene.constraints.find(constraint => constraint.type === 'rope')!.parameters['length']).toBe(1)
    expect(scalarOf(shortened, 'period')).toBeCloseTo(2 * Math.PI / Math.sqrt(10), 9)
    runtime.editParameter('gravity', 5)
    runtime.editParameter('amplitude', 20)
    const released = runtime.captureRaw()
    const period = 2 * Math.PI / Math.sqrt(5)
    expectAligned(released)
    expect(scalarOf(released, 'period')).toBeCloseTo(period, 9)
    expect(scalarOf(released, 'amplitude_deg')).toBeCloseTo(20, 9)
    expectVector(released.scene.bodies[0]!.position, [Math.sin(Math.PI / 9), 3 - Math.cos(Math.PI / 9), 0], 'm', 'length')
    runtime.seek(period / 4)
    const quarter = runtime.captureRaw()
    expectVector(objectOf(stateOf(quarter)).position, [0, 2, 0], 'm', 'length')
    expectVector(objectOf(stateOf(quarter)).velocity, [-Math.PI * Math.sqrt(5) / 9, 0, 0], 'm/s', 'velocity')
    expectVector(objectOf(stateOf(quarter)).acceleration, [0, 5 * Math.PI ** 2 / 81, 0], 'm/s^2', 'acceleration')
    expect(derivedScalar(stateOf(quarter).derived, 'tension').value).toBeCloseTo(10 * (1 + Math.PI ** 2 / 81), 9)
    expect(resultOf(quarter).states).toHaveLength(65)
    for (const state of resultOf(quarter).states) {
      const position = objectOf(state).position!.vector
      expect(Math.hypot(position.x, position.y - 3)).toBeCloseTo(1, 9)
    }
  })

  it('captures the final revision of every two-command statics reseat without changing UI clock fields', () => {
    const simulate = vi.spyOn(MechanicsEngine.prototype, 'simulate')
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({
      sceneId: 'capture-statics', model: 'spring_statics', mass: 1,
      position: { x: 0, y: 0.8, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
      springConstant: 49, springNaturalLength: 2, springAnchor: { x: 0, y: 3, z: 0 }, now: NOW,
    }))
    const initial = runtime.captureRaw()
    const saved = JSON.stringify(initial)
    const cases = [{ capture: initial, revision: 0, extension: 0.2, y: 0.8, force: 9.8 }]
    for (const edit of [
      { id: 'mass', value: 2, revision: 2, extension: 0.4, y: 0.6, force: 19.6 },
      { id: 'springConstant', value: 98, revision: 4, extension: 0.2, y: 0.8, force: 19.6 },
      { id: 'gravity', value: 4.9, revision: 6, extension: 0.1, y: 0.9, force: 9.8 },
    ]) {
      runtime.editParameter(edit.id, edit.value)
      cases.push({ capture: runtime.captureRaw(), revision: edit.revision, extension: edit.extension, y: edit.y, force: edit.force })
    }
    for (const { capture, revision, extension, y, force } of cases) {
      expectAligned(capture)
      expect(capture.scene.revision).toBe(revision)
      expect(capture.cursor).toEqual({ kind: 'static', identity: 'spring_statics' })
      expect(capture.clock).toEqual({ time: 0, total: 0, running: false, rate: 1 })
      expect(scalarOf(capture, 'spring_extension')).toBeCloseTo(extension, 9)
      expectVector(capture.scene.bodies[0]!.position, [0, y, 0], 'm', 'length')
      expectVector(objectOf(stateOf(capture)).position, [0, y, 0], 'm', 'length')
      expectVector(objectOf(stateOf(capture)).velocity, [0, 0, 0], 'm/s', 'velocity')
      expectVector(objectOf(stateOf(capture)).acceleration, [0, 0, 0], 'm/s^2', 'acceleration')
      expectVector(derivedVector(stateOf(capture).derived, 'spring_force'), [0, force, 0], 'N', 'force')
      expectVector(derivedVector(stateOf(capture).derived, 'net_force'), [0, 0, 0], 'N', 'force')
      expect(resultOf(capture).states).toHaveLength(65)
      expect(resultOf(capture).states.at(-1)!.time.value).toBe(4)
    }
    expect(simulate.mock.calls.map(([scene]) => scene.revision)).toEqual([0, 1, 2, 3, 4, 5, 6])
    runtime.setRate(3)
    runtime.seek(3)
    const displayed = runtime.setRunning(true)
    const held = runtime.captureRaw()
    expect(displayed.clock).toEqual({ time: 3, total: 4, running: true, rate: 3 })
    expect(held.clock).toEqual({ time: 0, total: 0, running: false, rate: 3 })
    expect(stateOf(held).time.value).toBe(3)
    expect(held.result).toBe(cases.at(-1)!.capture.result)
    expect(simulate).toHaveBeenCalledTimes(7)
    expect(JSON.stringify(initial)).toBe(saved)
  })

  it('keeps unclipped incline samples and actual angle/friction command results', () => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({
      sceneId: 'capture-incline', model: 'inclined_plane', mass: 0.1, inclineAngle: 30,
      position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
      gravity: { x: 0, y: -10, z: 0 }, frictionCoefficient: 0.2, now: NOW,
    }))
    const frame = runtime.seek(4)
    const capture = runtime.captureRaw()
    expectAligned(capture)
    expect(resultOf(capture).states).toHaveLength(65)
    expect(frame.trajectoryTimes.length).toBeLessThan(resultOf(capture).states.length)
    expectVector(objectOf(stateOf(capture)).position, [22.641016151377542, -13.071796769724491, 0], 'm', 'length')
    expectVector(objectOf(resultOf(capture).states.at(-1)!).position, [141.50635094610965, -81.69872981077806, 0], 'm', 'length')
    runtime.editParameter('angle', 45)
    const rotated = runtime.captureRaw()
    expectVector(objectOf(stateOf(rotated)).acceleration, [4, -4, 0], 'm/s^2', 'acceleration')
    expectVector(objectOf(stateOf(rotated)).position, [32, -32, 0], 'm', 'length')
    runtime.editParameter('friction', 0.3)
    const rough = runtime.captureRaw()
    expectAligned(rough)
    expectVector(objectOf(stateOf(rough)).acceleration, [3.5, -3.5, 0], 'm/s^2', 'acceleration')
    expectVector(objectOf(stateOf(rough)).position, [28, -28, 0], 'm', 'length')
  })

  it('captures static and kinetic friction coefficients without using formatted readouts', () => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({
      sceneId: 'capture-friction', model: 'horizontal_friction', mass: 2,
      position: { x: 0, y: 0.6, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
      gravity: { x: 0, y: -10, z: 0 }, appliedForce: { x: 0, y: 0, z: 0 },
      appliedForceRamp: 10, maxAppliedForce: 30, frictionCoefficient: 0.3, staticFrictionCoefficient: 0.5, now: NOW,
    }))
    expect(scalarOf(runtime.captureRaw(), 'slip_time')).toBeCloseTo(1, 9)
    runtime.editParameter('friction', 0.2)
    runtime.editParameter('staticFriction', 0.6)
    const edited = runtime.captureRaw()
    expectAligned(edited)
    expect(scalarOf(edited, 'normal_force')).toBe(20)
    expect(scalarOf(edited, 'static_limit')).toBe(12)
    expect(scalarOf(edited, 'slip_time')).toBeCloseTo(1.2, 9)
    runtime.seek(1)
    const staticState = stateOf(runtime.captureRaw())
    expectVector(objectOf(staticState).position, [0, 0.6, 0], 'm', 'length')
    expectVector(objectOf(staticState).velocity, [0, 0, 0], 'm/s', 'velocity')
    expect(derivedScalar(staticState.derived, 'friction_force').value).toBe(10)
    runtime.seek(2)
    const moving = runtime.captureRaw()
    expectVector(objectOf(stateOf(moving)).position, [128 / 75, 0.6, 0], 'm', 'length')
    expectVector(objectOf(stateOf(moving)).velocity, [4.8, 0, 0], 'm/s', 'velocity')
    expectVector(objectOf(stateOf(moving)).acceleration, [8, 0, 0], 'm/s^2', 'acceleration')
    expect(derivedScalar(stateOf(moving).derived, 'applied_force').value).toBe(20)
    expect(derivedScalar(stateOf(moving).derived, 'friction_force').value).toBe(4)
    expectVector(derivedVector(stateOf(moving).derived, 'net_force'), [16, 0, 0], 'N', 'force')
    expect(resultOf(moving).states).toHaveLength(65)
  })

  it('captures the real force and mass response in Newton motion', () => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({
      model: 'newton_second_law', mass: 2, position: { x: 1, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 }, appliedForce: { x: 4, y: 0, z: 0 }, now: NOW,
    }))
    runtime.seek(1)
    expectVector(objectOf(stateOf(runtime.captureRaw())).acceleration, [2, 0, 0], 'm/s^2', 'acceleration')
    runtime.editParameter('force', 6)
    const stronger = runtime.captureRaw()
    expectVector(objectOf(stateOf(stronger)).position, [2.5, 0, 0], 'm', 'length')
    expectVector(objectOf(stateOf(stronger)).velocity, [3, 0, 0], 'm/s', 'velocity')
    runtime.editParameter('mass', 3)
    const heavier = runtime.captureRaw()
    expectAligned(heavier)
    expectVector(objectOf(stateOf(heavier)).position, [2, 0, 0], 'm', 'length')
    expectVector(objectOf(stateOf(heavier)).acceleration, [2, 0, 0], 'm/s^2', 'acceleration')
    expectVector(derivedVector(stateOf(heavier).derived, 'net_force'), [6, 0, 0], 'N', 'force')
  })

  it('retains actual failed statics results and never projects a state merely to capture them', () => {
    const simulate = vi.spyOn(MechanicsEngine.prototype, 'simulate')
    const stateAt = vi.spyOn(MechanicsEngine.prototype, 'stateAt')
    const bridge = createMechanicsRuntime(createMechanicsScene({
      model: 'spring_statics', mass: 1, position: { x: 0, y: 0.5, z: 0 },
      springConstant: 49, springNaturalLength: 2, springAnchor: { x: 0, y: 3, z: 0 }, now: NOW,
    }))
    expect(bridge.getSnapshot().status).toBe('failed')
    const capture = bridge.captureRaw()
    expectAligned(capture)
    expect(capture.result).toBe(simulate.mock.results[0]!.value)
    expect(resultOf(capture).verification.status).toBe('failed')
    expect(resultOf(capture).verification.checks.find(check => check.id === 'equilibrium_position')?.passed).toBe(false)
    expect(resultOf(capture).states).toHaveLength(65)
    expect(capture.scene.bodies[0]!.position.vector.y).toBe(0.5)
    expectVector(objectOf(resultOf(capture).states[0]!).position, [0, 0.5, 0], 'm', 'length')
    expect(capture.state).toBeUndefined()
    expect(capture.diagnostics?.some(diagnostic => diagnostic['code'] === 'equilibrium_position')).toBe(true)
    simulate.mockClear()
    stateAt.mockClear()
    bridge.captureRaw()
    expect(simulate).not.toHaveBeenCalled()
    expect(stateAt).not.toHaveBeenCalled()
  })

  it('retains the full independent verifier failure without overwriting the actual engine report', () => {
    const original = MechanicsEngine.prototype.simulate
    const simulate = vi.spyOn(MechanicsEngine.prototype, 'simulate').mockImplementation(function (this: MechanicsEngine, scene, request) {
      const result = original.call(this, scene, request)
      const position = result.states[1]?.objects[0]?.position
      if (position === undefined) throw new Error('Expected a real sampled position.')
      position.vector.x += 1
      return result
    })
    const stateAt = vi.spyOn(MechanicsEngine.prototype, 'stateAt')
    const runtime = createMechanicsWorkspaceRuntime(linearScene())
    const capture = runtime.captureRaw()
    expectAligned(capture)
    expect(capture.result).toBe(simulate.mock.results[0]!.value)
    expect(resultOf(capture).verification.status).toBe('passed')
    expect(runtime.getSnapshot().status).toBe('failed')
    expect(capture.clock).toEqual({ time: 0, total: 10, running: false, rate: 1 })
    expect(capture.cursor).toEqual({ kind: 'time', time: { value: 0, unit: 's', dimension: 'time' } })
    const external = capture.diagnostics?.find(diagnostic => diagnostic['kind'] === 'external-verification')
    expect(external?.['report']).toEqual(expect.objectContaining({
      status: 'failed',
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'mechanics_kinematic_consistency', passed: false }),
        expect.objectContaining({ id: 'mechanics_numeric_states', passed: true }),
      ]),
    }))
    expect(Object.isFrozen(external)).toBe(true)
    expect(capture.state).toBeUndefined()
    simulate.mockClear()
    stateAt.mockClear()
    runtime.captureRaw()
    expect(simulate).not.toHaveBeenCalled()
    expect(stateAt).not.toHaveBeenCalled()
  })

  it('keeps question lineage and refreshes request/result identities through a fork and restore', () => {
    const origin = createMechanicsScene({
      sceneId: 'capture-origin', sourceQuestionId: 'capture-question', title: 'Original projectile',
      model: 'projectile_motion', mass: 1, position: { x: 0, y: 20, z: 0 },
      velocity: { x: 10, y: 0, z: 0 }, now: NOW,
    })
    const runtime = createMechanicsWorkspaceRuntime(origin)
    const original = runtime.captureRaw()
    const saved = JSON.stringify(original)
    runtime.seek(1)
    expect(runtime.captureRaw().scene.id).toBe(origin.id)
    runtime.editParameter('mass', 2)
    const forked = runtime.captureRaw()
    expectAligned(forked)
    expect(forked.scene.id).not.toBe(origin.id)
    expect(forked.scene.metadata.sourceQuestionId).toBe(origin.metadata.sourceQuestionId)
    expect(forked.scene.metadata.lineage).toEqual(expect.objectContaining({
      originSceneId: origin.id, originQuestionId: origin.metadata.sourceQuestionId,
      parentSceneId: origin.id, parentRevision: origin.revision, branchType: 'experimental',
    }))
    expect(forked.request).not.toBe(original.request)
    expect(forked.result).not.toBe(original.result)
    expect(forked.scene.bodies[0]!.mass.value).toBe(2)
    expect(forked.clock.time).toBe(0)
    runtime.editParameter('height', 30)
    expect(runtime.captureRaw().scene.id).toBe(forked.scene.id)
    runtime.setObservable('trajectory', false)
    const hidden = runtime.captureRaw()
    expectAligned(hidden)
    expect(resultOf(hidden).states).toHaveLength(65)
    runtime.restoreOrigin()
    const restored = runtime.captureRaw()
    expectAligned(restored)
    expect(restored.scene.id).toBe(origin.id)
    expect(restored.scene.revision).toBe(origin.revision)
    expect(restored.scene.metadata.lineage).toBeUndefined()
    expectVector(restored.scene.bodies[0]!.position, [0, 20, 0], 'm', 'length')
    expect(restored.scene.bodies[0]!.mass.value).toBe(1)
    expect(restored.result).not.toBe(original.result)
    expect(JSON.stringify(original)).toBe(saved)
  })
})

describe('collision capture keeps numerical storage, not decimated display paths', () => {
  it('captures every stored sample and mass/speed edits for hyphenated body IDs', () => {
    const runtime = createCollisionWorkspaceRuntime(collisionScene())
    const before = runtime.captureRaw()
    const saved = JSON.stringify(before)
    expectAligned(before)
    expect(resultOf(before).states).toHaveLength(1024)
    expect(runtime.getSnapshot().trajectoryTimes).toHaveLength(129)
    const last = resultOf(before).states.at(-1)!
    expectVector(objectOf(last, 'left-body').velocity, [-3, 0, 0], 'm/s', 'velocity')
    expectVector(objectOf(last, 'right-body').velocity, [1, 0, 0], 'm/s', 'velocity')
    for (const [index, state] of resultOf(before).states.entries()) {
      expect(state.time.value).toBeCloseTo(10 * index / 1023, 9)
      expectVector(derivedVector(state.derived, 'total_momentum'), [0, 0, 0], 'kg*m/s', 'momentum')
      expect(derivedScalar(state.derived, 'total_kinetic_energy').value).toBeCloseTo(6, 9)
    }
    runtime.seek(0.237)
    const frame = runtime.captureRaw()
    const nearest = resultOf(frame).states[24]!
    expect(frame.state).toBe(nearest)
    expect(frame.clock.time).toBe(0.237)
    expect(stateOf(frame).time.value).toBeCloseTo(240 / 1023, 9)
    expect(frame.cursor).toEqual({ kind: 'time', time: { value: 0.237, unit: 's', dimension: 'time' } })
    runtime.editParameter('mass-left-body', 2)
    const heavier = runtime.captureRaw()
    expectAligned(heavier)
    expectVector(objectOf(resultOf(heavier).states.at(-1)!, 'left-body').velocity, [-1.8, 0, 0], 'm/s', 'velocity')
    expectVector(objectOf(resultOf(heavier).states.at(-1)!, 'right-body').velocity, [2.2, 0, 0], 'm/s', 'velocity')
    runtime.editParameter('speed-right-body', 2)
    const faster = runtime.captureRaw()
    expectAligned(faster)
    expectVector(faster.scene.bodies.find(body => body.id === 'right-body')!.velocity, [-2, 0, 0], 'm/s', 'velocity')
    expectVector(objectOf(resultOf(faster).states.at(-1)!, 'left-body').velocity, [-3, 0, 0], 'm/s', 'velocity')
    expectVector(objectOf(resultOf(faster).states.at(-1)!, 'right-body').velocity, [2, 0, 0], 'm/s', 'velocity')
    expect(derivedScalar(resultOf(faster).states.at(-1)!.derived, 'total_kinetic_energy').value).toBeCloseTo(15, 9)
    runtime.editParameter('mass-left-body', -1)
    runtime.editParameter('radius-left-body', 2)
    runtime.setChoice('restitution', '0')
    const rejected = runtime.captureRaw()
    expect(rejected.scene).toBe(faster.scene)
    expect(rejected.request).toBe(faster.request)
    expect(rejected.result).toBe(faster.result)
    expect(JSON.stringify(before)).toBe(saved)
    runtime.seek(faster.clock.total)
    runtime.setRunning(true)
    const replayed = runtime.captureRaw()
    expect(replayed.clock.time).toBe(0)
    expect(replayed.clock.running).toBe(true)
    expect(replayed.result).toBe(faster.result)
  })

  it.each([
    { model: 'elastic', restitution: 1, massA: 1, massB: 1, speedA: 2, speedB: -1, finalA: -1, finalB: 2, momentum: 1, energy: 2.5 },
    { model: 'partial', restitution: 0.5, massA: 1, massB: 1, speedA: 3, speedB: -1, finalA: 0, finalB: 2, momentum: 2, energy: 2 },
    { model: 'perfectly inelastic', restitution: 0, massA: 1, massB: 3, speedA: 2, speedB: 0, finalA: 0.5, finalB: 0.5, momentum: 2, energy: 0.5 },
  ])('captures the real $model impulse result', ({ restitution, massA, massB, speedA, speedB, finalA, finalB, momentum, energy }) => {
    const runtime = createCollisionWorkspaceRuntime(createCollisionScene({
      now: NOW, bodies: [
        { id: 'a', mass: massA, position: [-3, 0], velocity: [speedA, 0], restitution },
        { id: 'b', mass: massB, position: [3, 0], velocity: [speedB, 0], restitution },
      ],
    }))
    const capture = runtime.captureRaw()
    expectAligned(capture)
    const last = resultOf(capture).states.at(-1)!
    expectVector(objectOf(last, 'a').velocity, [finalA, 0, 0], 'm/s', 'velocity')
    expectVector(objectOf(last, 'b').velocity, [finalB, 0, 0], 'm/s', 'velocity')
    expectVector(derivedVector(last.derived, 'total_momentum'), [momentum, 0, 0], 'kg*m/s', 'momentum')
    expect(derivedScalar(last.derived, 'total_kinetic_energy').value).toBeCloseTo(energy, 9)
    expect(resultOf(capture).events.length).toBeGreaterThan(0)
  })
})

describe('magnetic capture preserves raw SI quantities and the actual clock', () => {
  it('captures B, charge, mass, speed and field-direction commands numerically', () => {
    const runtime = createMagneticWorkspaceRuntime(magneticScene())
    const before = runtime.captureRaw()
    const saved = JSON.stringify(before)
    expect(scalarOf(before, 'cyclotron_radius')).toBe(3)
    expect(scalarOf(before, 'cyclotron_period')).toBeCloseTo(2 * Math.PI, 9)
    expectVector(derivedVector(resultOf(before).derivedQuantities, 'orbit_center'), [0, 3, 0], 'm', 'length')
    runtime.editParameter('B', 1)
    const stronger = runtime.captureRaw()
    expect(scalarOf(stronger, 'cyclotron_radius')).toBe(1.5)
    expect(scalarOf(stronger, 'cyclotron_period')).toBeCloseTo(Math.PI, 9)
    expect(scalarOf(stronger, 'lorentz_force_magnitude')).toBe(6)
    runtime.editParameter('q', -2)
    const negative = runtime.captureRaw()
    expect(scalarOf(negative, 'rotation_direction')).toBe(-1)
    expectVector(forceOf(stateOf(negative)), [0, -6, 0], 'N', 'force')
    runtime.editParameter('m', 2)
    const heavier = runtime.captureRaw()
    expect(scalarOf(heavier, 'cyclotron_radius')).toBe(3)
    expect(scalarOf(heavier, 'cyclotron_period')).toBeCloseTo(2 * Math.PI, 9)
    runtime.editParameter('v0', 6)
    runtime.setChoice('direction', 'out-of-page')
    const reversed = runtime.captureRaw()
    expectAligned(reversed)
    expect(reversed.scene.particles[0]!.charge!.value).toBe(-2)
    expect(reversed.scene.particles[0]!.mass.value).toBe(2)
    expectVector(reversed.scene.particles[0]!.velocity, [6, 0, 0], 'm/s', 'velocity')
    expect(scalarOf(reversed, 'cyclotron_radius')).toBe(6)
    expect(scalarOf(reversed, 'lorentz_force_magnitude')).toBe(12)
    expect(scalarOf(reversed, 'rotation_direction')).toBe(1)
    expectVector(derivedVector(resultOf(reversed).derivedQuantities, 'orbit_center'), [0, 6, 0], 'm', 'length')
    runtime.setObservable('force', false)
    const hidden = runtime.captureRaw()
    expectAligned(hidden)
    expectVector(forceOf(stateOf(hidden)), [0, 12, 0], 'N', 'force')
    expect(runtime.getSnapshot().view.vectors.some(vector => vector.observable === 'force')).toBe(false)
    runtime.seek(0)
    runtime.setRate(2)
    runtime.setRunning(true)
    runtime.advance(0.625)
    const quarter = runtime.captureRaw()
    expect(quarter.clock.time).toBeCloseTo(Math.PI / 2, 9)
    expect(quarter.clock.rate).toBe(2)
    expect(quarter.clock.running).toBe(true)
    expectVector(objectOf(stateOf(quarter)).position, [6, 6, 0], 'm', 'length')
    expectVector(objectOf(stateOf(quarter)).velocity, [0, 6, 0], 'm/s', 'velocity')
    expectVector(objectOf(stateOf(quarter)).acceleration, [-6, 0, 0], 'm/s^2', 'acceleration')
    expectVector(forceOf(stateOf(quarter)), [-12, 0, 0], 'N', 'force')
    expect(quarter.result).toBe(hidden.result)
    expect(quarter.request).toBe(hidden.request)
    expect(resultOf(quarter).states).toHaveLength(65)
    expect(JSON.stringify(before)).toBe(saved)
  })

  it('does not route an unknown parameter ID to the B setter', () => {
    const simulate = vi.spyOn(MagneticEngine.prototype, 'simulate')
    const runtime = createMagneticWorkspaceRuntime(magneticScene())
    const before = runtime.captureRaw()
    for (const id of ['unknown', 'radius', 'magneticFieldStrength']) {
      runtime.editParameter(id, 99)
      const capture = runtime.captureRaw()
      expect(capture.scene).toBe(before.scene)
      expect(capture.request).toBe(before.request)
      expect(capture.result).toBe(before.result)
      expect(capture.state).toBe(before.state)
      expect(scalarOf(capture, 'cyclotron_radius')).toBe(3)
    }
    expect(simulate).toHaveBeenCalledTimes(1)
  })

  it('retains the failed revision request without reusing a previous result or synthesizing a state', () => {
    const simulate = vi.spyOn(MagneticEngine.prototype, 'simulate')
    const stateAt = vi.spyOn(MagneticEngine.prototype, 'stateAtSeconds')
    const runtime = createMagneticWorkspaceRuntime(magneticScene())
    const before = runtime.captureRaw()
    runtime.editParameter('q', 0)
    const failed = runtime.captureRaw()
    expect(failed.scene.revision).toBe(before.scene.revision + 1)
    expect(failed.scene.particles[0]!.charge!.value).toBe(0)
    expect(failed.request?.sceneId).toBe(failed.scene.id)
    expect(failed.request?.sceneRevision).toBe(failed.scene.revision)
    expect(failed.result).toBeUndefined()
    expect(failed.state).toBeUndefined()
    expect(failed.clock).toEqual({ time: 0, total: 0, running: false, rate: 1 })
    expect(failed.cursor.kind).toBe('static')
    expect(failed.diagnostics?.length).toBeGreaterThan(0)
    expect(resultOf(before).states).toHaveLength(65)
    simulate.mockClear()
    stateAt.mockClear()
    runtime.captureRaw()
    expect(simulate).not.toHaveBeenCalled()
    expect(stateAt).not.toHaveBeenCalled()
  })
})

describe('failed dynamic captures keep their actual time axis and window', () => {
  it('retains a nonzero mechanics playhead before failed projection without using the empty UI clock', () => {
    const original = MechanicsEngine.prototype.simulate
    const simulate = vi.spyOn(MechanicsEngine.prototype, 'simulate').mockImplementation(function (this: MechanicsEngine, scene, request) {
      const result = original.call(this, scene, request)
      if (scene.revision > 0) {
        result.verification = summarizeVerification([
          ...result.verification.checks,
          { id: 'capture-test-engine-failure', type: 'numerical', passed: false },
        ], result.verification.warnings, result.verification.errors)
      }
      return result
    })
    const stateAt = vi.spyOn(MechanicsEngine.prototype, 'stateAt')
    const runtime = createMechanicsWorkspaceRuntime(linearScene())
    runtime.seek(4)
    runtime.setRate(2)
    runtime.editParameter('speed', 5)
    const failed = runtime.captureRaw()
    expectAligned(failed)
    expect(runtime.getSnapshot().clock).toEqual({ time: 0, total: 0, running: false, rate: 2 })
    expect(failed.clock).toEqual({ time: 4, total: 10, running: false, rate: 2 })
    expect(failed.cursor).toEqual({ kind: 'time', time: { value: 4, unit: 's', dimension: 'time' } })
    expect(failed.result).toBe(simulate.mock.results.at(-1)!.value)
    expect(resultOf(failed).verification.status).toBe('failed')
    expect(resultOf(failed).states).toHaveLength(65)
    expectVector(objectOf(resultOf(failed).states[0]!).position, [1, 2, 0], 'm', 'length')
    expectVector(objectOf(resultOf(failed).states.at(-1)!).position, [51, 2, 0], 'm', 'length')
    expect(failed.state).toBeUndefined()
    simulate.mockClear()
    stateAt.mockClear()
    runtime.captureRaw()
    expect(simulate).not.toHaveBeenCalled()
    expect(stateAt).not.toHaveBeenCalled()
  })

  it('keeps a failed collision window in SI and clamps only the capture cursor to the held range', () => {
    const original = CollisionEngine.prototype.simulate
    const simulate = vi.spyOn(CollisionEngine.prototype, 'simulate').mockImplementation(function (this: CollisionEngine, scene, request) {
      if (scene.revision > 0) request.options = {
        startTime: { value: 2000, unit: 'ms', dimension: 'time' },
        endTime: { value: 3, unit: 's', dimension: 'time' }, outputSampleRate: 7,
      }
      const result = original.call(this, scene, request)
      if (scene.revision > 0) result.verification = summarizeVerification([
        ...result.verification.checks,
        { id: 'capture-test-collision-failure', type: 'conservation', passed: false },
      ], result.verification.warnings, result.verification.errors)
      return result
    })
    const stateAt = vi.spyOn(CollisionEngine.prototype, 'stateAt')
    const runtime = createCollisionWorkspaceRuntime(collisionScene())
    runtime.seek(4)
    runtime.setRate(3)
    runtime.editParameter('mass-left-body', 2)
    const failed = runtime.captureRaw()
    expectAligned(failed)
    expect(runtime.getSnapshot().clock).toEqual({ time: 0, total: 0, running: false, rate: 3 })
    expect(failed.clock).toEqual({ time: 3, total: 3, running: false, rate: 3 })
    expect(failed.cursor).toEqual({ kind: 'time', time: { value: 3, unit: 's', dimension: 'time' } })
    expect(failed.request?.options.startTime).toEqual({ value: 2000, unit: 'ms', dimension: 'time' })
    expect(failed.result).toBe(simulate.mock.results.at(-1)!.value)
    expect(resultOf(failed).states).toHaveLength(7)
    expect(resultOf(failed).states[0]!.time.value).toBe(2)
    expect(resultOf(failed).states.at(-1)!.time.value).toBe(3)
    expectVector(objectOf(resultOf(failed).states.at(-1)!, 'left-body').velocity, [-1.8, 0, 0], 'm/s', 'velocity')
    expect(failed.state).toBeUndefined()
    simulate.mockClear()
    stateAt.mockClear()
    runtime.captureRaw()
    expect(simulate).not.toHaveBeenCalled()
    expect(stateAt).not.toHaveBeenCalled()
  })

  it('keeps the full failed magnetic result time window instead of declaring it static', () => {
    const original = MagneticEngine.prototype.simulate
    const simulate = vi.spyOn(MagneticEngine.prototype, 'simulate').mockImplementation(function (this: MagneticEngine, scene, request) {
      if (scene.revision > 0) request.options = {
        startTime: { value: 500, unit: 'ms', dimension: 'time' },
        endTime: { value: 1, unit: 's', dimension: 'time' }, outputSampleRate: 7,
      }
      const result = original.call(this, scene, request)
      if (scene.revision > 0) {
        const position = result.states[1]?.objects[0]?.position
        if (position === undefined) throw new Error('Expected a real sampled position.')
        position.vector.x += 1
      }
      return result
    })
    const stateAt = vi.spyOn(MagneticEngine.prototype, 'stateAtSeconds')
    const runtime = createMagneticWorkspaceRuntime(magneticScene())
    runtime.seek(0.25)
    runtime.setRate(2)
    runtime.editParameter('B', 1)
    const failed = runtime.captureRaw()
    expectAligned(failed)
    expect(runtime.getSnapshot().clock).toEqual({ time: 0, total: 0, running: false, rate: 2 })
    expect(failed.clock).toEqual({ time: 0.5, total: 1, running: false, rate: 2 })
    expect(failed.cursor).toEqual({ kind: 'time', time: { value: 0.5, unit: 's', dimension: 'time' } })
    expect(failed.request).toBe(simulate.mock.calls.at(-1)![1])
    expect(resultOf(failed).verification.status).toBe('failed')
    expect(resultOf(failed).states).toHaveLength(8)
    expect(resultOf(failed).states[0]!.time.value).toBe(0.5)
    expect(resultOf(failed).states.at(-1)!.time.value).toBe(1)
    expectVector(objectOf(resultOf(failed).states[0]!).position, [1.5 * Math.sin(1), 1.5 * (1 - Math.cos(1)), 0], 'm', 'length')
    expect(failed.state).toBeUndefined()
    simulate.mockClear()
    stateAt.mockClear()
    runtime.captureRaw()
    expect(simulate).not.toHaveBeenCalled()
    expect(stateAt).not.toHaveBeenCalled()
  })
})

describe('capture retains the request options and exact sample windows used by the engine', () => {
  it('retains mixed-unit mechanics options and all requested samples without re-solving', () => {
    const original = MechanicsEngine.prototype.simulate
    const simulate = vi.spyOn(MechanicsEngine.prototype, 'simulate').mockImplementation(function (this: MechanicsEngine, scene, request) {
      request.options = {
        startTime: { value: 1000, unit: 'ms', dimension: 'time' },
        endTime: { value: 2, unit: 's', dimension: 'time' },
        timeStep: { value: 5, unit: 'ms', dimension: 'time' }, outputSampleRate: 7,
        solver: 'analytical', tolerance: { absolute: 1e-9, relative: 1e-8 }, maxIterations: 20, randomSeed: 41,
      }
      return original.call(this, scene, request)
    })
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({
      model: 'uniformly_accelerated_motion', position: { x: 0, y: 0, z: 0 },
      velocity: { x: 10, y: 0, z: 0 }, acceleration: { x: 2, y: 0, z: 0 }, now: NOW,
    }))
    runtime.seek(1.5)
    const capture = runtime.captureRaw()
    expectAligned(capture)
    expect(capture.request).toBe(simulate.mock.calls[0]![1])
    expect(capture.request!.options.startTime).toEqual({ value: 1000, unit: 'ms', dimension: 'time' })
    expect(capture.request!.options.randomSeed).toBe(41)
    expect(capture.request!.options.timeStep).toEqual({ value: 5, unit: 'ms', dimension: 'time' })
    const result = resultOf(capture)
    expect(result.states).toHaveLength(7)
    for (const [index, state] of result.states.entries()) expect(state.time.value).toBeCloseTo(1 + index / 6, 9)
    expectVector(objectOf(result.states[0]!).position, [11, 0, 0], 'm', 'length')
    expectVector(objectOf(result.states.at(-1)!).position, [24, 0, 0], 'm', 'length')
    expectVector(objectOf(result.states.at(-1)!).velocity, [14, 0, 0], 'm/s', 'velocity')
    expectVector(derivedVector(result.derivedQuantities, 'displacement'), [13, 0, 0], 'm', 'length')
    expectVector(objectOf(stateOf(capture)).position, [17.25, 0, 0], 'm', 'length')
    expectVector(objectOf(stateOf(capture)).velocity, [13, 0, 0], 'm/s', 'velocity')
    expect(capture.clock).toEqual({ time: 1.5, total: 2, running: false, rate: 1 })
    expect(simulate).toHaveBeenCalledTimes(1)
  })

  it('keeps collision window samples and the actual nearest frame state', () => {
    const original = CollisionEngine.prototype.simulate
    const simulate = vi.spyOn(CollisionEngine.prototype, 'simulate').mockImplementation(function (this: CollisionEngine, scene, request) {
      request.options = {
        startTime: { value: 100, unit: 'ms', dimension: 'time' },
        endTime: { value: 203, unit: 'ms', dimension: 'time' }, outputSampleRate: 7,
        solver: 'numerical', tolerance: { absolute: 1e-8, relative: 1e-7 }, randomSeed: 19,
      }
      return original.call(this, scene, request)
    })
    const runtime = createCollisionWorkspaceRuntime(createCollisionScene({
      now: NOW, bodies: [
        { id: 'a', mass: 1, position: [-2, 0], velocity: [1, 0] },
        { id: 'b', mass: 1, position: [2, 0], velocity: [-1, 0] },
      ],
    }))
    runtime.seek(0.152)
    const capture = runtime.captureRaw()
    expectAligned(capture)
    expect(capture.request).toBe(simulate.mock.calls[0]![1])
    expect(capture.request!.options.endTime).toEqual({ value: 203, unit: 'ms', dimension: 'time' })
    const result = resultOf(capture)
    expect(result.states).toHaveLength(7)
    for (const [index, state] of result.states.entries()) expect(state.time.value).toBeCloseTo(0.1 + 0.103 * index / 6, 9)
    expectVector(objectOf(result.states[0]!, 'a').position, [-1.9, 0, 0], 'm', 'length')
    expectVector(objectOf(result.states.at(-1)!, 'a').position, [-1.797, 0, 0], 'm', 'length')
    expect(capture.state).toBe(result.states[3])
    expect(stateOf(capture).time.value).toBeCloseTo(0.1515, 9)
    expect(capture.clock.time).toBe(0.152)
    expect(simulate).toHaveBeenCalledTimes(1)
  })

  it('keeps magnetic grid-plus-checkpoint samples rather than inventing a wider request', () => {
    const original = MagneticEngine.prototype.simulate
    const simulate = vi.spyOn(MagneticEngine.prototype, 'simulate').mockImplementation(function (this: MagneticEngine, scene, request) {
      request.options = {
        startTime: { value: 0, unit: 's', dimension: 'time' },
        endTime: { value: 2 * Math.PI, unit: 's', dimension: 'time' }, outputSampleRate: 6,
        solver: 'analytical', tolerance: { absolute: 1e-9, relative: 1e-8 }, randomSeed: 23,
      }
      return original.call(this, scene, request)
    })
    const runtime = createMagneticWorkspaceRuntime(magneticScene())
    const capture = runtime.captureRaw()
    expectAligned(capture)
    expect(capture.request).toBe(simulate.mock.calls[0]![1])
    expect(capture.request!.options.outputSampleRate).toBe(6)
    const times = [0, 2 * Math.PI / 5, Math.PI / 2, 4 * Math.PI / 5, Math.PI,
      6 * Math.PI / 5, 3 * Math.PI / 2, 8 * Math.PI / 5, 2 * Math.PI]
    expect(resultOf(capture).states).toHaveLength(times.length)
    for (const [index, state] of resultOf(capture).states.entries()) {
      const time = times[index]!
      expect(state.time.value).toBeCloseTo(time, 9)
      expectVector(objectOf(state).position, [3 * Math.sin(time), 3 * (1 - Math.cos(time)), 0], 'm', 'length')
      expectVector(objectOf(state).velocity, [3 * Math.cos(time), 3 * Math.sin(time), 0], 'm/s', 'velocity')
      expectVector(forceOf(state), [-3 * Math.sin(time), 3 * Math.cos(time), 0], 'N', 'force')
    }
    expect(simulate).toHaveBeenCalledTimes(1)
  })

  it('binds the actual cropped magnetic request to verification and retains its seven samples', () => {
    const original = MagneticEngine.prototype.simulate
    const start = 0.4 * Math.PI
    const end = 0.6 * Math.PI
    const simulate = vi.spyOn(MagneticEngine.prototype, 'simulate').mockImplementation(function (this: MagneticEngine, scene, request) {
      request.options = {
        startTime: { value: start, unit: 's', dimension: 'time' },
        endTime: { value: end, unit: 's', dimension: 'time' }, outputSampleRate: 6,
      }
      return original.call(this, scene, request)
    })
    const runtime = createMagneticWorkspaceRuntime(magneticScene())
    runtime.seek(Math.PI / 2)
    const capture = runtime.captureRaw()
    expectAligned(capture)
    expect(capture.request).toBe(simulate.mock.calls[0]![1])
    expect(capture.request!.options.startTime!.value).toBe(start)
    expect(capture.request!.options.endTime!.value).toBe(end)
    expect(resultOf(capture).states).toHaveLength(7)
    expect(resultOf(capture).states[0]!.time.value).toBe(start)
    expect(resultOf(capture).states.at(-1)!.time.value).toBe(end)
    expect(resultOf(capture).states.every(state => state.time.value >= start && state.time.value <= end)).toBe(true)
    expect(resultOf(capture).verification.status).toBe('passed_with_warnings')
    expect(resultOf(capture).verification.warnings.length).toBeGreaterThan(0)
    expectVector(objectOf(stateOf(capture)).position, [3, 3, 0], 'm', 'length')
    expect(capture.clock.total).toBeCloseTo(2 * Math.PI, 9)
    expect(simulate).toHaveBeenCalledTimes(1)
  })

  it('classifies canonical zero windows as static without thinning or rewriting the actual results', () => {
    const options = {
      startTime: { value: 2000, unit: 'ms', dimension: 'time' as const },
      endTime: { value: 2, unit: 's', dimension: 'time' as const }, outputSampleRate: 7,
    }
    const mechanicsOriginal = MechanicsEngine.prototype.simulate
    const collisionOriginal = CollisionEngine.prototype.simulate
    const magneticOriginal = MagneticEngine.prototype.simulate
    const mechanicsSimulate = vi.spyOn(MechanicsEngine.prototype, 'simulate').mockImplementation(function (this: MechanicsEngine, scene, request) {
      request.options = options
      return mechanicsOriginal.call(this, scene, request)
    })
    const collisionSimulate = vi.spyOn(CollisionEngine.prototype, 'simulate').mockImplementation(function (this: CollisionEngine, scene, request) {
      request.options = options
      return collisionOriginal.call(this, scene, request)
    })
    const magneticSimulate = vi.spyOn(MagneticEngine.prototype, 'simulate').mockImplementation(function (this: MagneticEngine, scene, request) {
      request.options = options
      return magneticOriginal.call(this, scene, request)
    })
    const mechanics = createMechanicsWorkspaceRuntime(linearScene())
    const collision = createCollisionWorkspaceRuntime(collisionScene())
    const magnetic = createMagneticWorkspaceRuntime(magneticScene())
    const runtimes = [mechanics, collision, magnetic]
    const captures = runtimes.map(runtime => runtime.captureRaw())
    expect(resultOf(captures[0]!).states).toHaveLength(7)
    expect(resultOf(captures[1]!).states).toHaveLength(1)
    expect(resultOf(captures[2]!).states).toHaveLength(1)
    expect(resultOf(captures[2]!).verification.status).toBe('passed_with_warnings')
    expect(resultOf(captures[2]!).verification.warnings.length).toBeGreaterThan(0)
    expectVector(objectOf(resultOf(captures[0]!).states[0]!).position, [9, 2, 0], 'm', 'length')
    expectVector(objectOf(resultOf(captures[2]!).states[0]!).position, [3 * Math.sin(2), 3 * (1 - Math.cos(2)), 0], 'm', 'length')
    for (const capture of captures) {
      expectAligned(capture)
      expect(capture.request!.options).toEqual(options)
      expect(capture.clock).toEqual({ time: 0, total: 0, running: false, rate: 1 })
      expect(capture.cursor.kind).toBe('static')
      expect(resultOf(capture).states.every(state => state.time.value === 2)).toBe(true)
    }
    const mechanicsStateAt = vi.spyOn(MechanicsEngine.prototype, 'stateAt')
    const collisionStateAt = vi.spyOn(CollisionEngine.prototype, 'stateAt')
    const magneticStateAt = vi.spyOn(MagneticEngine.prototype, 'stateAtSeconds')
    for (const spy of [mechanicsSimulate, collisionSimulate, magneticSimulate]) spy.mockClear()
    for (const runtime of runtimes) runtime.captureRaw()
    for (const spy of [mechanicsSimulate, collisionSimulate, magneticSimulate, mechanicsStateAt, collisionStateAt, magneticStateAt]) expect(spy).not.toHaveBeenCalled()
  })
})
