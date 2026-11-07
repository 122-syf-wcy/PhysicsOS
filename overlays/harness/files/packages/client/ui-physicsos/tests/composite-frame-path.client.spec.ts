import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompositeEngine, createCompositeSimulationRequest } from '@physicsos/engine-composite'
import { observeCompositeScene } from '@physicsos/physics-observation'
import {
  createCompositeFieldScene,
  createCyclotronScene,
  createVelocitySelectorScene,
} from '@physicsos/physics-scene'

import { compositeSceneVisualAt } from '../src/client/physics/composite-visual-bridge.ts'
import { createCompositeWorkspaceRuntime } from '../src/client/physics/composite-workspace-runtime.ts'
import type { ScenePoint } from '../src/client/physics/scene-visual-model.ts'
import type { WorkspaceSnapshot } from '../src/client/physics/workspace-runtime.ts'

afterEach(() => { vi.restoreAllMocks() })

const FRAMES = 120
const pointsOf = (snapshot: WorkspaceSnapshot) =>
  snapshot.view.trajectories.flatMap(path => path.points)

describe('composite playback reuses private simulation geometry', () => {
  it.each([
    ['velocity selector', createVelocitySelectorScene],
    ['global composite field', createCompositeFieldScene],
    ['cyclotron', createCyclotronScene],
  ] as const)('%s does not rescan stored samples after the first frame', (name, createScene) => {
    // Keep the real solver and every returned value. Accessors only count
    // reads of stored states, distinguishing full-trajectory work from the
    // freshly computed current state that must change on every frame.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- The call-through below supplies the original engine receiver.
    const simulate = CompositeEngine.prototype.simulate
    let sampleReads = 0
    let sampleCount = 0
    vi.spyOn(CompositeEngine.prototype, 'simulate').mockImplementation(function (this: CompositeEngine, scene, request) {
      const simulation = simulate.call(this, scene, request)
      sampleCount = simulation.states.length
      for (const state of simulation.states) {
        const objects = state.objects
        Object.defineProperty(state, 'objects', {
          configurable: true,
          get: () => { sampleReads += 1; return objects },
        })
      }
      return simulation
    })
    const runtime = createCompositeWorkspaceRuntime(createScene())
    runtime.seek(0)
    const before = runtime.setRunning(true)
    expect(before.status).not.toBe('failed')
    expect(sampleCount).toBeGreaterThan(100)
    sampleReads = 0
    let after = before
    const started = performance.now()
    for (let frame = 0; frame < FRAMES; frame += 1) after = runtime.advance(1 / 120)
    const elapsedMs = performance.now() - started
    console.info(JSON.stringify({ benchmark: 'composite-frame-path', name, frames: FRAMES, sampleCount, sampleReads, elapsedMs }))
    expect(after.status).not.toBe('failed')
    expect(after.clock.time).toBeGreaterThan(before.clock.time)
    expect(after.view.particles[0]?.at).not.toEqual(before.view.particles[0]?.at)
    expect(pointsOf(after)).toEqual(pointsOf(before))
    expect(sampleReads, 'playback rereads frame-invariant stored sample objects').toBe(0)
  })

  it('rebuilds trajectory geometry after a parameter edit', () => {
    const runtime = createCompositeWorkspaceRuntime(createVelocitySelectorScene())
    const before = runtime.getSnapshot()
    const strength = before.inspector.flatMap(section => section.parameters ?? []).find(row => row.id === 'E')
    expect(strength).toBeDefined()
    if (strength === undefined) throw new Error('The velocity selector must expose its electric field')
    const after = runtime.editParameter('E', strength.value * 1.2)
    expect(after.status).not.toBe('failed')
    expect(after.sceneRevision).toBeGreaterThan(before.sceneRevision)
    expect(pointsOf(after)).not.toEqual(pointsOf(before))
    expect(pointsOf(after)).toHaveLength(after.trajectoryTimes.length)
    const atEnd = runtime.seek(after.clock.total)
    expect(atEnd.view.particles[0]?.at).toEqual(pointsOf(after).at(-1))
  })

  it('does not let an exposed point corrupt later playback frames', () => {
    const runtime = createCompositeWorkspaceRuntime(createVelocitySelectorScene())
    const before = runtime.getSnapshot()
    const points = pointsOf(before)
    const expected = structuredClone(points)
    const first = points[0]
    expect(first).toBeDefined()
    if (first === undefined) throw new Error('The velocity selector must expose a trajectory')
    // Readonly snapshots may reject writes. If a consumer circumvents the
    // type, either rejecting or isolating that write must protect the cache.
    try { (first as { x: number }).x = 123456 } catch { /* Frozen output is safe. */ }
    const next = runtime.seek(before.clock.total / 2)
    expect(pointsOf(next)).toEqual(expected)
  })

  it('does not let exposed apparatus geometry corrupt later playback frames', () => {
    const runtime = createCompositeWorkspaceRuntime(createVelocitySelectorScene())
    const before = runtime.getSnapshot()
    const expected = structuredClone(before.view.compositeRegions)
    const region = before.view.compositeRegions?.[0]
    if (region === undefined) throw new Error('The velocity selector must expose its apparatus')
    try { region.at.x = 123456 } catch { /* Frozen output is safe. */ }
    const next = runtime.seek(before.clock.total / 2)
    expect(next.view.compositeRegions).toEqual(expected)
  })

  it('keeps direct visual projection fresh for caller-owned mutable inputs', () => {
    const scene = createVelocitySelectorScene()
    const engine = new CompositeEngine()
    const simulation = engine.simulate(scene, createCompositeSimulationRequest(scene, 'mutable-view', 'mutable-view-trace'))
    // Shallow freezing does not make nested engine output immutable.
    Object.freeze(scene)
    Object.freeze(simulation)
    const state = engine.stateAtSeconds(scene, 0)
    const observations = observeCompositeScene({ scene, simulation, state }).observations
    const input = { scene, simulation, state, observations }
    const before = compositeSceneVisualAt(input)
    const sample = simulation.states.at(-1)?.objects[0]?.position
    if (sample === undefined) throw new Error('The verified simulation must end at a particle position')
    const originalX = sample.vector.x
    const mutableVector = sample.vector as { x: number }
    mutableVector.x = originalX + 0.125
    const after = compositeSceneVisualAt(input)
    const beforeLast = before.trajectories.flatMap(path => path.points).at(-1) as ScenePoint
    const afterLast = after.trajectories.flatMap(path => path.points).at(-1) as ScenePoint
    expect(beforeLast.x).toBe(originalX)
    expect(afterLast.x).toBe(originalX + 0.125)
  })
})
