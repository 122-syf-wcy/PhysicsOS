import { afterEach, describe, expect, it, vi } from 'vitest'
import { CircuitEngine } from '@physicsos/engine-circuit'
import { CollisionEngine } from '@physicsos/engine-collision'
import { CompositeEngine } from '@physicsos/engine-composite'
import { ElectricEngine } from '@physicsos/engine-electric'
import { ElectricRegionEngine } from '@physicsos/engine-electric-region'
import { InductionEngine } from '@physicsos/engine-induction'
import { MagneticEngine } from '@physicsos/engine-magnetic'
import { MechanicsEngine } from '@physicsos/engine-mechanics'
import { WaveEngine } from '@physicsos/engine-wave'
import {
  SceneStore,
  createBarMotionScene,
  createCollisionScene,
  createElectricScene,
  createEmfMeasurementScene,
  createMechanicsScene,
  createParallelPlateScene,
  createTravellingWaveScene,
  createVelocitySelectorScene,
} from '@physicsos/physics-scene'
import { createCircuitWorkspaceRuntime } from '../src/client/physics/circuit-workspace-runtime.ts'
import { createCollisionWorkspaceRuntime } from '../src/client/physics/collision-workspace-runtime.ts'
import { createCompositeWorkspaceRuntime } from '../src/client/physics/composite-workspace-runtime.ts'
import { createElectricWorkspaceRuntime } from '../src/client/physics/electric-workspace-runtime.ts'
import { createInductionWorkspaceRuntime } from '../src/client/physics/induction-workspace-runtime.ts'
import { createMagneticWorkspaceRuntime } from '../src/client/physics/magnetic-workspace-runtime.ts'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'
import { createWaveWorkspaceRuntime } from '../src/client/physics/wave-workspace-runtime.ts'
import type { WorkspaceRuntime } from '../src/client/physics/workspace-runtime.ts'

afterEach(() => { vi.restoreAllMocks() })

const FRAMES = 600

const collisionScene = () => createCollisionScene({
  bodies: [
    { id: 'a', mass: 1, position: [-2, 0], velocity: [1, 0], restitution: 1 },
    { id: 'b', mass: 1, position: [2, 0], velocity: [-1, 0], restitution: 1 },
  ],
})

type EngineClass = { prototype: { canHandle(scene: unknown): unknown; simulate(scene: unknown, request: unknown): unknown } }

/**
 * The animation loop calls `advance()` 60 times a second. Everything that is
 * a pure function of the scene — cloning it, validating it inside the engine's
 * `canHandle`, running the whole simulation — must happen once per scene
 * revision, not once per frame. Each animated runtime is driven for 600
 * frames and must neither copy the scene nor re-validate or re-simulate it.
 */
describe('the per-frame path copies and validates nothing that is frame-invariant', () => {
  it.each([
    ['electric', ElectricEngine, () => createElectricWorkspaceRuntime(createElectricScene())],
    ['electric region', ElectricRegionEngine, () => createElectricWorkspaceRuntime(createParallelPlateScene())],
    ['circuit', CircuitEngine, () => createCircuitWorkspaceRuntime(createEmfMeasurementScene())],
    ['mechanics', MechanicsEngine, () => createMechanicsWorkspaceRuntime(createMechanicsScene({ model: 'uniform_linear_motion' }))],
    ['composite', CompositeEngine, () => createCompositeWorkspaceRuntime(createVelocitySelectorScene())],
    ['collision', CollisionEngine, () => createCollisionWorkspaceRuntime(collisionScene())],
    ['magnetic', MagneticEngine, () => createMagneticWorkspaceRuntime()],
    ['wave', WaveEngine, () => createWaveWorkspaceRuntime(createTravellingWaveScene())],
    ['induction', InductionEngine, () => createInductionWorkspaceRuntime(createBarMotionScene())],
  ] as const satisfies readonly (readonly [string, EngineClass, () => WorkspaceRuntime])[])(
    '%s: 600 frames clone the scene 0 times and validate/simulate it at most once',
    (_domain, Engine, create) => {
      const runtime = create()
      const initial = runtime.getSnapshot()
      expect(initial.status).not.toBe('failed')
      /* Pressing play is a command, and commands may take a private copy; the
         spies start once the clock is running and only frames remain. */
      runtime.setRunning(true)
      const clone = vi.spyOn(SceneStore.prototype, 'getScene')
      const canHandle = vi.spyOn(Engine.prototype, 'canHandle')
      const simulate = vi.spyOn(Engine.prototype, 'simulate')
      const delta = initial.clock.total > 0 ? initial.clock.total / (FRAMES * 2) : 1 / 60
      let last = initial
      for (let frame = 0; frame < FRAMES; frame += 1) last = runtime.advance(delta)
      expect(last.clock.time).toBeGreaterThan(initial.clock.time)
      expect(clone, 'getScene() clones per frame').toHaveBeenCalledTimes(0)
      expect(canHandle.mock.calls.length, 'canHandle() per frame').toBeLessThanOrEqual(1)
      expect(simulate.mock.calls.length, 'simulate() per frame').toBeLessThanOrEqual(1)
    },
  )

  it('composite simulates once across 600 frames and again only after a fact edit', () => {
    const simulate = vi.spyOn(CompositeEngine.prototype, 'simulate')
    const runtime = createCompositeWorkspaceRuntime(createVelocitySelectorScene())
    const initial = runtime.getSnapshot()
    expect(initial.status).not.toBe('failed')
    runtime.setRunning(true)
    for (let frame = 0; frame < FRAMES; frame += 1) runtime.advance(initial.clock.total / (FRAMES * 2))
    expect(simulate).toHaveBeenCalledTimes(1)
    const editable = initial.inspector.flatMap(section => section.parameters ?? []).find(row => row.id === 'E')
    expect(editable, 'missing parameter E').toBeDefined()
    runtime.editParameter('E', editable!.value * 1.2)
    expect(simulate).toHaveBeenCalledTimes(2)
    runtime.seek(0)
    expect(simulate).toHaveBeenCalledTimes(2)
  })

  it('a frozen scene snapshot is shared across frames and replaced on commit', () => {
    const store = new SceneStore(createMechanicsScene({ model: 'uniform_linear_motion' }))
    const first = store.peekScene()
    expect(store.peekScene()).toBe(first)
    expect(Object.isFrozen(first.bodies)).toBe(true)
    expect(() => { (first.bodies as unknown[]).push({}) }).toThrow(TypeError)
    expect(store.getScene()).toEqual(first)
    expect(store.getScene()).not.toBe(first)
  })
})
