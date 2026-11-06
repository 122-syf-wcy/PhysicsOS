import { describe, expect, it } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { MechanicsEngine, createMechanicsSimulationRequest, resolveMechanicsModel } from '@physicsos/engine-mechanics'
import { observeMechanicsScene } from '@physicsos/physics-observation'
import { verifyMechanicsSimulation } from '@physicsos/physics-verifier'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'
import { buildSnapshot } from '../src/client/physics/mechanics-view-builders.ts'

const runtimeFor = (angle: number, speed: number, friction: number) => {
  const radians = angle * Math.PI / 180
  return createMechanicsWorkspaceRuntime(createMechanicsScene({
    model: 'inclined_plane', mass: 0.1, inclineAngle: angle,
    position: { x: 0, y: 0, z: 0 }, gravity: { x: 0, y: -10, z: 0 },
    velocity: { x: speed * Math.cos(radians), y: -speed * Math.sin(radians), z: 0 },
    frictionCoefficient: friction,
  }))
}

describe('incline motion in the mechanics workspace', () => {
  it('keeps force visibility controlled by the scene observable after a user toggle', () => {
    const runtime = runtimeFor(30, 0, 0.2)
    const original = runtime.getSnapshot()
    expect(original.view.visible.forces).toBe(true)
    expect(original.view.visible.netForce).toBe(true)
    const hidden = runtime.setObservable('forces', false)
    expect(hidden.view.visible.forces).toBe(false)
    expect(hidden.view.visible.netForce).toBe(true)
    expect(runtime.getScene().observableDefinitions.find(item => item.type === 'force')?.visible).toBe(false)
    expect(hidden.view.bodies[0]?.at).toEqual(original.view.bodies[0]?.at)
    const restored = runtime.setObservable('forces', true)
    expect(restored.view.visible.forces).toBe(true)
    expect(restored.view.visible.netForce).toBe(true)
  })

  it('toggles the resultant independently and keeps that display choice across timeline changes', () => {
    const runtime = runtimeFor(30, 0, 0.2)
    const original = runtime.getScene()
    const hidden = runtime.setObservable('netForce', false)
    expect(hidden.view.visible.forces).toBe(true)
    expect(hidden.view.visible.netForce).toBe(false)
    expect(runtime.seek(4).view.visible.netForce).toBe(false)
    const restored = runtime.setObservable('netForce', true)
    expect(restored.view.visible.forces).toBe(true)
    expect(restored.view.visible.netForce).toBe(true)
    expect(runtime.getScene()).toEqual(original)
  })

  it('keeps supplied key-point geometry hidden after its observable is disabled', () => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({
      model: 'projectile_motion', position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 20, z: 0 }, groundY: 0,
    }))
    const original = runtime.getSnapshot()
    expect(original.view.keyPoints.length).toBeGreaterThan(0)
    expect(original.view.visible.keyPoints).toBe(true)
    const hidden = runtime.setObservable('keyPoints', false)
    expect(hidden.view.visible.keyPoints).toBe(false)
    const restored = runtime.setObservable('keyPoints', true)
    expect(restored.view.visible.keyPoints).toBe(true)
  })

  it.each([0, 15, 30, 60])('keeps a readable moving surface window on the unbounded %i° plane', (angle) => {
    const runtime = runtimeFor(angle, 3, 0.2)
    const original = JSON.stringify(runtime.getScene())
    const first = runtime.getSnapshot().view
    const firstBody = first.bodies[0]!
    const firstPlane = first.incline!
    const radians = angle * Math.PI / 180
    for (const time of [0, 4, 10]) {
      const frame = runtime.seek(time)
      const view = frame.view, body = view.bodies[0]!, plane = view.incline!
      expect(frame.clock.time).toBe(time)
      expect(view.extent.width).toBeCloseTo(first.extent.width, 9)
      expect(view.extent.height).toBeCloseTo(first.extent.height, 9)
      expect(body.size).toBeCloseTo(firstBody.size, 9)
      expect(plane.base).toBe(6)
      expect(plane.angle).toBe(angle)
      expect(body.at.x - view.origin.x).toBeCloseTo(firstBody.at.x - first.origin.x, 9)
      expect(body.at.y - view.origin.y).toBeCloseTo(firstBody.at.y - first.origin.y, 9)
      expect(plane.origin.x - view.origin.x).toBeCloseTo(firstPlane.origin.x - first.origin.x, 9)
      expect(plane.origin.y - view.origin.y).toBeCloseTo(firstPlane.origin.y - first.origin.y, 9)
      // The patch moves along the same physical plane, keeping its normal
      // offset from the engine COM exactly one displayed block half-edge.
      const apex = { x: plane.origin.x, y: plane.origin.y + plane.base * Math.tan(radians) }
      expect(plane.points).toEqual([
        plane.origin,
        { x: plane.origin.x + 6, y: plane.origin.y },
        apex,
      ])
      const distance = (body.at.x - apex.x) * Math.sin(radians) + (body.at.y - apex.y) * Math.cos(radians)
      expect(distance).toBeCloseTo(body.size, 9)
      const along = (body.at.x - apex.x) * Math.cos(radians)
        - (body.at.y - apex.y) * Math.sin(radians)
      expect(along).toBeGreaterThan(0)
      expect(along).toBeLessThan(plane.base / Math.cos(radians))
      expect(body.at.x).toBeGreaterThanOrEqual(plane.origin.x)
      expect(body.at.x).toBeLessThanOrEqual(plane.origin.x + plane.base)
    }
    expect(JSON.stringify(runtime.getScene())).toBe(original)
  })

  it('keeps the engine position beyond the initial drawn patch instead of clamping the block', () => {
    const runtime = runtimeFor(30, 0, 0.2)
    const atFour = runtime.seek(4).view.bodies[0]!.at
    // g=10, μ=0.2: a=5−√3; x(4)=20√3−12, y(4)=−20+4√3.
    expect(atFour.x).toBeCloseTo(22.641016151377542, 9)
    expect(atFour.y).toBeCloseTo(-13.071796769724491, 9)
    const atTen = runtime.seek(10).view.bodies[0]!.at
    expect(atTen.x).toBeCloseTo(141.50635094610965, 9)
    expect(atTen.y).toBeCloseTo(-81.69872981077806, 9)
  })

  it('plots signed frame acceleration instead of repeating its initial magnitude', () => {
    const scene = createMechanicsScene({ model: 'inclined_plane', inclineAngle: 0,
      gravity: { x: 0, y: -10, z: 0 }, velocity: { x: 3, y: 0, z: 0 }, frictionCoefficient: 0.4 })
    const engine = new MechanicsEngine()
    const simulation = engine.simulate(scene, createMechanicsSimulationRequest(scene, 'chart', 'chart'))
    const state = simulation.states[0]!
    const snapshot = buildSnapshot({ scene, modelId: 'inclined_plane', model: resolveMechanicsModel(scene),
      simulation, state, observations: observeMechanicsScene({ scene, simulation, state }),
      verification: verifyMechanicsSimulation(scene, simulation), visibility: {},
      clock: { time: 0, total: 10, running: false, rate: 1 }, status: 'verified' })
    const chart = snapshot.charts.find(item => item.id === 'a-t')!
    expect(chart.points[0]!.value).toBe(-4)
    expect(chart.points.at(-1)!.value).toBe(0)
    expect(Number(snapshot.derivation.find(step => step.result?.symbol === 'a')?.result?.value)).toBe(-4)
  })

  it('publishes negative initial acceleration and stops a horizontal sliding block', () => {
    const runtime = runtimeFor(0, 3, 0.4)
    const initial = runtime.getSnapshot()
    expect(initial.status, JSON.stringify(initial.error)).toBe('verified')
    const acceleration = initial.derivation.find(step => step.result?.symbol === 'a')!
    // Independently: a = -μg = -4 m/s²; stopping distance = 3² / (2 × 4).
    expect(Number(acceleration.result?.value)).toBe(-4)
    const stopped = runtime.seek(2)
    const rows = stopped.inspector.flatMap(section => section.derived ?? [])
    expect(Number(rows.find(row => row.id === 'a')?.value)).toBe(0)
    expect(Number(rows.find(row => row.id === 'f')?.value)).toBe(0)
    expect(Number(stopped.table.rows.at(-1)!.values[2])).toBeCloseTo(1.125, 2)
    const accelerationChart = stopped.charts.find(chart => chart.id === 'a-t')!
    expect(accelerationChart.points[0]!.value).toBe(-4)
    expect(accelerationChart.points.at(-1)!.value).toBe(0)
    expect(stopped.view.vectors.some(vector => vector.id === 'force-friction')).toBe(false)
  })

  it('adds friction to gravity while moving uphill', () => {
    const snapshot = runtimeFor(30, -3, 0.1).getSnapshot()
    expect(snapshot.status, JSON.stringify(snapshot.error)).toBe('verified')
    const acceleration = snapshot.derivation.find(step => step.result?.symbol === 'a')!
    expect(Number(acceleration.result?.value)).toBeCloseTo(5.87, 2)
    expect(acceleration.expression).toContain('+')
  })

  it('shows static balance instead of a sliding formula for a resting shallow slope', () => {
    const snapshot = runtimeFor(10, 0, 0.4).getSnapshot()
    const acceleration = snapshot.derivation.find(step => step.result?.symbol === 'a')!
    expect(Number(acceleration.result?.value)).toBe(0)
    expect(acceleration.expression).toBe('a = 0')
    expect(snapshot.status).toBe('verified')
  })
})
