import { describe, expect, it } from 'vitest'
import { CompositeEngine, createCompositeSimulationRequest } from '@physicsos/engine-composite'
import { observeCompositeScene } from '@physicsos/physics-observation'
import {
  createCompositeFieldScene,
  createCyclotronScene,
  createMassSpectrometerScene,
  createMultiRegionFieldScene,
  createVelocitySelectorScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'

import { compositeSceneVisualAt } from '../src/client/physics/composite-visual-bridge.ts'
import { createCompositeWorkspaceRuntime } from '../src/client/physics/composite-workspace-runtime.ts'
import type { ScenePoint, SceneVisualModel } from '../src/client/physics/scene-visual-model.ts'

const multiRegionScene = (duration = 1e-5) => createMultiRegionFieldScene({
  charge: 1.6e-19, mass: 1.67e-27, velocity: { x: 1e5, y: 0, z: 0 },
  electricFieldStrength: 2e4, electricFieldDirection: 'up',
  magneticFieldStrength: 0.2, magneticFieldOrientation: 'out_of_page', duration,
})

function expectInFrame(view: SceneVisualModel, point: ScenePoint, radius = 0) {
  expect(point.x - radius).toBeGreaterThanOrEqual(view.origin.x)
  expect(point.x + radius).toBeLessThanOrEqual(view.origin.x + view.extent.width)
  expect(point.y - radius).toBeGreaterThanOrEqual(view.origin.y)
  expect(point.y + radius).toBeLessThanOrEqual(view.origin.y + view.extent.height)
}

function expectApparatusInFrame(view: SceneVisualModel) {
  for (const region of view.compositeRegions ?? []) {
    expectInFrame(view, { x: region.at.x - region.width / 2, y: region.at.y - region.height / 2 })
    expectInFrame(view, { x: region.at.x + region.width / 2, y: region.at.y + region.height / 2 })
  }
  for (const particle of view.particles) expectInFrame(view, particle.at, particle.radius)
}

function visualInput(scene: PhysicsScene, time: number) {
  const engine = new CompositeEngine()
  const simulation = engine.simulate(scene, createCompositeSimulationRequest(scene, 'viewport-simulation', 'viewport-trace'))
  expect(simulation.verification.status).not.toBe('failed')
  const state = engine.stateAtSeconds(scene, time)
  const observations = observeCompositeScene({ scene, simulation, state }).observations
  return { scene, simulation, state, observations }
}

describe('composite apparatus viewport', () => {
  it('keeps the real three-region apparatus readable before its predicted path escapes', () => {
    const snapshot = createCompositeWorkspaceRuntime(multiRegionScene()).getSnapshot()
    const view = snapshot.view
    expect(snapshot.status).toBe('verified')
    expect(view.compositeRegions?.map(region => [region.width, region.height])).toEqual([[0.2, 0.3], [0.2, 0.3], [0.2, 0.3]])
    expect(view.trajectories.find(path => path.kind === 'predicted')?.points.at(-1)?.y).toBeGreaterThan(7)
    // The whole apparatus is 0.72 m wide. A 17 m overview made its three
    // regions only a few pixels wide on the real 682 px product canvas.
    expect(view.extent.width).toBeLessThan(1.5)
    expect(view.extent.height).toBeLessThan(1)
    expect(view.particles[0]?.radius).toBeGreaterThan(0)
    expect(view.particles[0]?.radius).toBeLessThan(0.05)
    expectApparatusInFrame(view)
  })

  it('does not let a longer future run change the same current apparatus frame', () => {
    const short = visualInput(multiRegionScene(1e-5), 6.666666666666667e-7)
    const long = visualInput(multiRegionScene(1e-4), 6.666666666666667e-7)
    const shortView = compositeSceneVisualAt(short), longView = compositeSceneVisualAt(long)
    expect(longView.trajectories.at(-1)?.points.at(-1)?.y).toBeGreaterThan(50)
    for (const axis of ['x', 'y'] as const) {
      expect(longView.particles[0]?.at[axis]).toBeCloseTo(shortView.particles[0]!.at[axis], 10)
    }
    expect(longView.origin).toEqual(shortView.origin)
    expect(longView.extent).toEqual(shortView.extent)
  })

  it('retains every engine trajectory sample and leaves the verified input untouched', () => {
    const input = visualInput(multiRegionScene(), 6.666666666666667e-7)
    const before = structuredClone(input)
    const view = compositeSceneVisualAt(input)
    const expected = input.simulation.states.map(state => {
      const position = state.objects.find(object => object.id === input.scene.particles[0]?.id)?.position
      expect(position?.unit).toBe('m')
      if (!position) throw new Error('Verified sample has no particle position')
      return { x: position.vector.x, y: position.vector.y }
    })
    expect(view.trajectories.flatMap(path => path.points)).toEqual(expected)
    expect(view.trajectories.find(path => path.kind === 'history')?.points.length).toBeGreaterThan(0)
    expect(view.trajectories.find(path => path.kind === 'predicted')?.points.length).toBeGreaterThan(200)
    expect(input).toEqual(before)
  })

  it('expands to the actual escaped particle without changing coordinates, timelines or answers', () => {
    const runtime = createCompositeWorkspaceRuntime(multiRegionScene())
    const before = runtime.getSnapshot(), scene = structuredClone(runtime.getScene())
    const points = before.view.trajectories.flatMap(path => path.points)
    const last = points.at(-1)!
    expect(last.y).toBeGreaterThan(7)
    const after = runtime.seek(before.clock.total)
    expect(after.view.particles[0]?.at).toEqual(last)
    expectApparatusInFrame(after.view)
    expect(after.view.trajectories.flatMap(path => path.points)).toEqual(points)
    expect(after.trajectoryTimes).toEqual(before.trajectoryTimes)
    expect(after.trajectoryTimes).toHaveLength(points.length)
    expect(after.table).toEqual(before.table)
    expect(after.charts).toEqual(before.charts)
    expect(after.derivation).toEqual(before.derivation)
    expect(after.verification).toEqual(before.verification)
    expect(after.events).toEqual(before.events)
    expect(runtime.getScene()).toEqual(scene)
  })

  it('retains trajectory-based framing for global fields without finite apparatus regions', () => {
    const snapshot = createCompositeWorkspaceRuntime(createCompositeFieldScene()).getSnapshot()
    expect(snapshot.view.compositeRegions).toEqual([])
    const points = snapshot.view.trajectories.flatMap(path => path.points)
    expect(points.length).toBeGreaterThan(100)
    for (const point of points) expectInFrame(snapshot.view, point)
    expect(snapshot.view.extent.width).toBeGreaterThan(0.1)
    expectApparatusInFrame(snapshot.view)
  })

  it.each([
    ['velocity selector', createVelocitySelectorScene],
    ['mass spectrometer', createMassSpectrometerScene],
    ['cyclotron', createCyclotronScene],
  ] as const)('keeps the %s apparatus and real particle visible throughout playback', (_name, createScene) => {
    const runtime = createCompositeWorkspaceRuntime(createScene())
    const total = runtime.getSnapshot().clock.total
    for (const time of [0, total / 2, total]) {
      const snapshot = runtime.seek(time)
      expect(snapshot.status).not.toBe('failed')
      expect(snapshot.view.compositeRegions?.length).toBeGreaterThan(0)
      expect(snapshot.view.particles).toHaveLength(1)
      expectApparatusInFrame(snapshot.view)
      const points = snapshot.view.trajectories.flatMap(path => path.points)
      expect(points).toHaveLength(snapshot.trajectoryTimes.length)
      if (time === total) expect(snapshot.view.particles[0]?.at).toEqual(points.at(-1))
    }
  })
})
