import { describe, expect, it } from 'vitest'
import { createMechanicsScene, createRampFrictionScene, createCollisionScene } from '@physicsos/physics-scene'
import { MechanicsEngine, resolveMechanicsModel, EnergyEngine } from '@physicsos/engine-mechanics'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'
import { createCollisionWorkspaceRuntime } from '../src/client/physics/collision-workspace-runtime.ts'
import { createEnergyWorkspaceRuntime } from '../src/client/physics/energy-workspace-runtime.ts'

describe('lab feedback mechanics', () => {
  it('moves an Earth orbit visibly, loops only after play, and keeps physical time', () => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({ model: 'circular_orbit' }))
    const initial = runtime.getSnapshot()
    expect(runtime.advance(5).clock.time).toBe(0)
    runtime.setRunning(true)
    const quarter = runtime.advance(5)
    expect(quarter.clock.time).toBeCloseTo(initial.clock.total / 4, 6)
    expect(Math.abs(quarter.view.bodies[0]!.at.x)).toBeLessThan(initial.view.bodies[0]!.at.x * 0.01)
    expect(runtime.advance(20).clock.running).toBe(true)
    runtime.setRunning(false)
    const time = runtime.getSnapshot().clock.time
    expect(runtime.advance(20).clock.time).toBe(time)
  })

  it('edits circular speed by changing radius at the same GM and synchronizes scene initial data', () => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({ model: 'circular_orbit', gravitationalParameter: 32, orbitRadius: 2 }))
    const snapshot = runtime.editParameter('speed', 2)
    const model = resolveMechanicsModel(runtime.getScene())
    expect(model.modelId).toBe('circular_orbit')
    if (model.modelId !== 'circular_orbit') throw new Error('orbit expected')
    expect(model.gravitationalParameter).toBe(32)
    expect(model.radius).toBeCloseTo(8)
    expect(model.speed).toBeCloseTo(2)
    expect(runtime.getScene().bodies[0]!.position.vector.x).toBeCloseTo(8)
    expect(runtime.getScene().bodies[0]!.velocity.vector.y).toBeCloseTo(2)
    expect(snapshot.status).toBe('verified')
    const before = runtime.getScene()
    runtime.editParameter('speed', 0)
    expect(runtime.getScene()).toEqual(before)
  })

  it('compares three launch angles using the same engine, speed and gravity without changing the live scene', () => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({ model: 'projectile_motion', velocity: { x: 12, y: 16, z: 0 }, gravity: { x: 0, y: -10, z: 0 } }))
    runtime.seek(0.3)
    const before = runtime.getScene()
    const snapshot = runtime.setChoice('projectile-comparison', 'angles')
    expect(runtime.getScene()).toEqual(before)
    expect(snapshot.clock.time).toBe(0.3)
    for (const angle of [30, 45, 60]) {
      const path = snapshot.view.trajectories.find(row => row.id === `comparison-${angle}`)
      expect(path).toBeDefined()
      expect(path!.points.at(-1)!.x).toBeCloseTo(40 * Math.sin(2 * angle * Math.PI / 180), 7)
      expect(snapshot.view.labels.some(label => label.text.includes(`${angle}°`))).toBe(true)
    }
    expect(runtime.setChoice('projectile-comparison', 'single').view.trajectories.some(row => row.id.startsWith('comparison-'))).toBe(false)
  })

  it('edits each applied force in polar form and switches between balance and accelerated motion', () => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({ model: 'newton_second_law', mass: 2, gravity: { x: 0, y: 0, z: 0 }, appliedForce: { x: 3, y: 0, z: 0 }, appliedForces: [{ x: 0, y: 4, z: 0 }] }))
    const first = runtime.getScene().forces.find(force => force.type === 'custom')!
    runtime.editParameter(`force-magnitude:${first.id}`, 6)
    runtime.editParameter(`force-angle:${first.id}`, 90)
    const force = runtime.getScene().forces.find(row => row.id === first.id)!.vector!.vector
    expect(force.x).toBeCloseTo(0)
    expect(force.y).toBeCloseTo(6)
    expect(runtime.getSnapshot().view.guides.filter(row => row.id.startsWith('force-parallelogram')).length).toBe(2)
    runtime.setChoice('force-balance', 'balanced')
    const balanced = new MechanicsEngine().stateAt(runtime.getScene(), { value: 1, unit: 's', dimension: 'time' })
    expect(balanced.objects[0]!.velocity!.vector.y).toBeCloseTo(0)
    runtime.setChoice('force-balance', 'unbalanced')
    const unbalanced = new MechanicsEngine().stateAt(runtime.getScene(), { value: 1, unit: 's', dimension: 'time' })
    expect(Math.abs(unbalanced.objects[0]!.velocity!.vector.y)).toBeGreaterThan(0)
  })

  it('charts signed momentum for each ball and their conserved sum', () => {
    const scene = createCollisionScene({ bodies: [
      { id: 'a', mass: 1, position: [-2, 0], velocity: [2, 0] },
      { id: 'b', mass: 2, position: [2, 0], velocity: [-1, 0] },
    ] })
    const snapshot = createCollisionWorkspaceRuntime(scene).getSnapshot()
    const a = snapshot.charts.find(chart => chart.id === 'p1-t')!
    const b = snapshot.charts.find(chart => chart.id === 'p2-t')!
    const total = snapshot.charts.find(chart => chart.id === 'p-t')!
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    expect(a.points.some(point => point.value !== a.points[0]!.value)).toBe(true)
    for (let i = 0; i < total.points.length; i += 1) {
      expect(a.points[i]!.value + b.points[i]!.value).toBeCloseTo(total.points[i]!.value, 8)
      expect(total.points[i]!.value).toBeCloseTo(total.points[0]!.value, 8)
    }
  })

  it('plays ramp friction using engine positions and converts mechanical energy to heat', () => {
    const scene = createRampFrictionScene()
    const runtime = createEnergyWorkspaceRuntime(scene)
    const start = runtime.getSnapshot()
    expect(start.clock.total).toBeGreaterThan(0)
    expect(start.clock.running).toBe(false)
    const initialState = new EnergyEngine().stateAt(scene, { value: 0, unit: 's', dimension: 'time' })
    const movingState = new EnergyEngine().stateAt(scene, { value: start.clock.total / 2, unit: 's', dimension: 'time' })
    expect(initialState.objects[0]!.position).toBeDefined()
    expect(movingState.objects[0]!.position!.vector.y).toBeLessThan(initialState.objects[0]!.position!.vector.y)
    runtime.setRunning(true)
    const halfway = runtime.advance(start.clock.total / 2)
    expect(halfway.view.bodies[0]!.at.y).toBeLessThan(start.view.bodies[0]!.at.y)
    expect(halfway.view.energyBar!.segments.find(row => row.role === 'thermal')!.fraction).toBeCloseTo(0.05)
    expect(halfway.view.energyBar!.segments.reduce((sum, row) => sum + row.fraction, 0)).toBeCloseTo(1)
    const finish = runtime.advance(start.clock.total)
    expect(finish.clock.running).toBe(false)
    expect(runtime.advance(10).clock.time).toBe(finish.clock.time)
    expect(finish.view.energyBar!.segments.find(row => row.role === 'thermal')!.fraction).toBeCloseTo(0.2)
  })

  it('keeps the spring oscillator periodic while honoring pause and slow rate', () => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({ model: 'spring_oscillator', position: { x: 1, y: 0, z: 0 } }))
    const initial = runtime.getSnapshot()
    expect(runtime.advance(20).clock.time).toBe(0)
    runtime.setRate(0.1)
    runtime.setRunning(true)
    expect(runtime.advance(initial.clock.total * 11).clock.time).toBeCloseTo(initial.clock.total * 0.1)
    runtime.setRunning(false)
    const stopped = runtime.getSnapshot()
    expect(runtime.advance(20).clock.time).toBe(stopped.clock.time)
  })
})
