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
