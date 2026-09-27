// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createCollisionScene,
  createMechanicsScene,
  createMechanicsSimulationRequest,
} from '@physicsos/physics-scene'
import { MechanicsEngine, resolveMechanicsModel } from '@physicsos/engine-mechanics'
import { observeMechanicsScene } from '@physicsos/physics-observation'
import { verifyMechanicsSimulation } from '@physicsos/physics-verifier'

import { PhysicsCanvas } from '../src/client/physics/PhysicsCanvas.tsx'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'
import { createCollisionRuntime } from '../src/client/physics/collision-runtime-bridge.ts'
import {
  buildSnapshot,
  type SnapshotInput,
} from '../src/client/physics/mechanics-view-builders.ts'

afterEach(cleanup)

const cartRuntime = () =>
  createMechanicsWorkspaceRuntime(
    createMechanicsScene({
      sceneId: 'cart-wheel-test',
      model: 'uniform_linear_motion',
      velocity: { x: 4, y: 0, z: 0 },
      now: '2026-08-21T00:00:00.000Z',
    }),
  )

describe('mechanics cart body', () => {
  it('draws the photographed cart body and still translates it frame to frame', () => {
    const runtime = cartRuntime()
    const total = runtime.getSnapshot().clock.total
    const early = runtime.seek(total * 0.25)
    const late = runtime.seek(total * 0.75)
    expect(early.view.bodies[0]?.kind).toBe('cart')
    expect(late.view.bodies[0]?.at.x).toBeGreaterThan(early.view.bodies[0]?.at.x ?? 0)

    const { container } = render(<PhysicsCanvas view={early.view} ariaLabel="匀速直线运动" />)
    const image = container.querySelector('[data-testid="sprite-cart"]')
    expect(image).toBeTruthy()
    /* The sprite is one flat image — the rolling-spoke glyph that read off the
       covered arc lives only on the vector fallback now; translation plus the
       strobe marks carry the motion on the photographed body. */
    expect(container.querySelector('[data-testid="cart-spokes"]')).toBeNull()
  })

  it('draws the projectile ball as a sprite and leaves the vector path to fallback', () => {
    const projectile = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'projectile_motion',
        position: { x: 0, y: 20, z: 0 },
        velocity: { x: 10, y: 0, z: 0 },
        groundY: 0,
        now: '2026-08-21T00:00:00.000Z',
      }),
    ).getSnapshot()
    const { container } = render(<PhysicsCanvas view={projectile.view} ariaLabel="平抛运动" />)
    expect(projectile.view.bodies[0]?.kind).toBe('ball')
    expect(container.querySelector('[data-testid="sprite-ball"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="cart-spokes"]')).toBeNull()
  })
})

describe('P3-a mechanics expansion scenes', () => {
  it('force-composition draws indexed F₁ F₂ arrows plus the resultant', () => {
    const snapshot = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'newton_second_law',
        mass: 1,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        appliedForce: { x: 3, y: 0, z: 0 },
        appliedForces: [{ x: 0, y: 4, z: 0 }],
        now: '2026-08-21T00:00:00.000Z',
      }),
    ).getSnapshot()
    const applied = snapshot.view.vectors.filter(vector => vector.id.startsWith('force-applied'))
    expect(applied.map(vector => vector.id)).toEqual(['force-applied-0', 'force-applied-1'])
    expect(applied.map(vector => vector.symbol)).toEqual(['F_1', 'F_2'])
    /* Resultant (3,4) points up-right at 5 N. */
    const net = snapshot.view.vectors.find(vector => vector.id === 'net-force')
    expect(net).toBeDefined()
    const netRow = snapshot.inspector
      .flatMap(section => section.derived ?? [])
      .find(row => row.id === 'F')
    expect(netRow?.value).toBe('5')
  })

  it('concurrent-equilibrium sums to zero net force and the body stays put', () => {
    const side = 4 * Math.sqrt(3)
    const runtime = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'newton_second_law',
        mass: 2,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        appliedForce: { x: 8, y: 0, z: 0 },
        appliedForces: [
          { x: -4, y: side, z: 0 },
          { x: -4, y: -side, z: 0 },
        ],
        now: '2026-08-21T00:00:00.000Z',
      }),
    )
    const snapshot = runtime.getSnapshot()
    expect(snapshot.view.vectors.filter(vector => vector.id.startsWith('force-applied')).length).toBe(3)
    /* Zero net force means no ΣF arrow; the clock runs but the body does not move. */
    expect(snapshot.view.vectors.find(vector => vector.id === 'net-force')).toBeUndefined()
    const end = runtime.seek(snapshot.clock.total)
    expect(end.view.bodies[0]?.at.x).toBeCloseTo(0, 8)
  })

  it('apparent-weight run rises vertically without a track and reports N = m(g + a)', () => {
    const snapshot = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'uniformly_accelerated_motion',
        mass: 60,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 1, z: 0 },
        acceleration: { x: 0, y: 2, z: 0 },
        now: '2026-08-21T00:00:00.000Z',
      }),
    ).getSnapshot()
    expect(snapshot.view.bodies[0]?.kind).toBe('block')
    expect(snapshot.view.ground).toBeUndefined()
    const weightRow = snapshot.inspector
      .flatMap(section => section.derived ?? [])
      .find(row => row.id === 'N')
    /* m(g + a) = 60 × (9.8 + 2) = 708 N — 超重. */
    expect(weightRow?.value).toBe('708')
    expect(weightRow?.unit).toBe('N')
  })
})

describe('playback contract', () => {
  it('loops a nominal-window model instead of dead-ending at the clock edge', () => {
    const runtime = cartRuntime()
    const total = runtime.getSnapshot().clock.total
    runtime.setRunning(true)
    const wrapped = runtime.advance(total + 0.4)
    expect(wrapped.clock.running).toBe(true)
    expect(wrapped.clock.time).toBeGreaterThanOrEqual(0)
    expect(wrapped.clock.time).toBeLessThan(total)
  })

  it('stops a projectile at impact, then run replays from t = 0', () => {
    const runtime = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'projectile_motion',
        position: { x: 0, y: 20, z: 0 },
        velocity: { x: 10, y: 0, z: 0 },
        groundY: 0,
        now: '2026-08-21T00:00:00.000Z',
      }),
    )
    const total = runtime.getSnapshot().clock.total
    runtime.setRunning(true)
    const end = runtime.advance(total + 1)
    expect(end.clock.time).toBe(total)
    expect(end.clock.running).toBe(false)

    const replay = runtime.setRunning(true)
    expect(replay.clock.time).toBe(0)
    expect(replay.clock.running).toBe(true)
  })

  it('stops a uniformly-accelerated run at the window edge and replays', () => {
    const runtime = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'uniformly_accelerated_motion',
        velocity: { x: 2, y: 0, z: 0 },
        acceleration: { x: 1, y: 0, z: 0 },
        now: '2026-08-21T00:00:00.000Z',
      }),
    )
    const total = runtime.getSnapshot().clock.total
    runtime.setRunning(true)
    const end = runtime.advance(total + 1)
    expect(end.clock.running).toBe(false)
    expect(end.clock.time).toBe(total)

    const replay = runtime.setRunning(true)
    expect(replay.clock.time).toBe(0)
    expect(replay.clock.running).toBe(true)
  })

  it('spring oscillator loops and the coil tracks the live extension', () => {
    const runtime = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'spring_oscillator',
        mass: 1,
        position: { x: -0.5, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        springConstant: 50,
        springNaturalLength: 2,
        springAnchor: { x: -3, y: 0, z: 0 },
        now: '2026-08-21T00:00:00.000Z',
      }),
    )
    const snapshot = runtime.getSnapshot()
    expect(snapshot.view.spring).toBeDefined()
    expect(snapshot.view.spring?.anchor.x).toBe(-3)
    /* Released 0.5 m right of equilibrium x = −1: the coil ends at the body's
       near face, so its drawn length shrinks and grows with the swing. */
    const start = snapshot.view.spring!
    expect(start.end.x - start.anchor.x).toBeGreaterThan(0)

    const periodRow = snapshot.inspector
      .flatMap(section => section.derived ?? [])
      .find(row => row.id === 'T')
    expect(Number(periodRow?.value)).toBeCloseTo(2 * Math.PI * Math.sqrt(1 / 50), 1)

    /* Periodic model: the playhead wraps instead of dead-ending. */
    runtime.setRunning(true)
    const wrapped = runtime.advance(snapshot.clock.total + 0.4)
    expect(wrapped.clock.running).toBe(true)
    expect(wrapped.clock.time).toBeLessThan(snapshot.clock.total)

    const { container } = render(<PhysicsCanvas view={snapshot.view} ariaLabel="弹簧振子" />)
    expect(container.querySelector('[data-testid="spring-coil"]')).toBeTruthy()
  })

  it('simple pendulum draws pivot + string and loops its swing', () => {
    const length = 2
    const pivot = { x: 0, y: 3, z: 0 }
    const radians = (15 * Math.PI) / 180
    const runtime = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'simple_pendulum',
        mass: 0.5,
        position: {
          x: pivot.x + length * Math.sin(radians),
          y: pivot.y - length * Math.cos(radians),
          z: 0,
        },
        velocity: { x: 0, y: 0, z: 0 },
        pendulumLength: length,
        pendulumPivot: pivot,
        now: '2026-08-21T00:00:00.000Z',
      }),
    )
    const snapshot = runtime.getSnapshot()
    expect(snapshot.view.pendulum?.pivot).toEqual({ x: 0, y: 3 })
    expect(snapshot.view.pendulum?.length).toBe(2)
    expect(snapshot.view.bodies[0]?.kind).toBe('ball')
    /* T = 2π√(2/9.8) ≈ 2.84 s, and the run window is two periods. */
    const period = 2 * Math.PI * Math.sqrt(length / 9.8)
    expect(snapshot.clock.total).toBeCloseTo(2 * period, 6)

    /* Half a period in, the bob sits on the opposite side of the rest line. */
    const half = runtime.seek(period / 2)
    expect(half.view.pendulum?.bob.x ?? 0).toBeLessThan(pivot.x)

    const { container } = render(<PhysicsCanvas view={snapshot.view} ariaLabel="单摆" />)
    expect(container.querySelector('[data-testid="pendulum-rig"]')).toBeTruthy()
  })

  it('horizontal friction holds still then slips at μsN', () => {
    const runtime = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'horizontal_friction',
        mass: 2,
        position: { x: 0, y: 0.6, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        appliedForce: { x: 0, y: 0, z: 0 },
        frictionCoefficient: 0.3,
        staticFrictionCoefficient: 0.5,
        appliedForceRamp: 2,
        maxAppliedForce: 30,
        now: '2026-08-21T00:00:00.000Z',
      }),
    )
    const snapshot = runtime.getSnapshot()
    expect(snapshot.view.ground?.label).toBe('水平面')
    /* μsN = 0.5 × 2 × 9.8 = 9.8 N at ramp 2 N/s → slip at t = 4.9 s. */
    const slipRow = snapshot.inspector
      .flatMap(section => section.derived ?? [])
      .find(row => row.id === 'tslip')
    expect(Number(slipRow?.value)).toBeCloseTo(4.9, 1)

    const before = runtime.seek(2)
    expect(before.view.bodies[0]?.at.x ?? 1).toBeCloseTo(0, 8)
    const after = runtime.seek(8)
    expect(after.view.bodies[0]?.at.x ?? 0).toBeGreaterThan(0)
  })

  it('spring statics hangs at equilibrium with Δx = mg/k published', () => {
    const runtime = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'spring_statics',
        mass: 1,
        position: { x: 0, y: 0.8, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        springConstant: 49,
        springNaturalLength: 2,
        springAnchor: { x: 0, y: 3, z: 0 },
        now: '2026-08-21T00:00:00.000Z',
      }),
    )
    const snapshot = runtime.getSnapshot()
    expect(snapshot.status).toBe('verified')
    expect(snapshot.view.spring?.axis).toBe('vertical')
    const extRow = snapshot.inspector
      .flatMap(section => section.derived ?? [])
      .find(row => row.id === 'dx')
    expect(Number(extRow?.value)).toBeCloseTo(0.2, 3)
    /* Nothing moves: body stays at equilibrium through the window. */
    const end = runtime.seek(snapshot.clock.total)
    expect(end.view.bodies[0]?.at.y ?? 0).toBeCloseTo(0.8, 6)
  })

  it('collision replay: run pressed after the end restarts from t = 0', () => {
    const runtime = createCollisionRuntime(
      createCollisionScene({
        bodies: [
          { id: 'a', mass: 1, position: [-3, 0], velocity: [2, 0] },
          { id: 'b', mass: 1, position: [3, 0], velocity: [-2, 0] },
        ],
        now: '2026-08-21T00:00:00.000Z',
      }),
    )
    const total = runtime.getSnapshot().clock.total
    runtime.setRunning(true)
    const end = runtime.advance(total + 1)
    expect(end.clock.time).toBe(total)
    expect(end.clock.running).toBe(false)

    const replay = runtime.setRunning(true)
    expect(replay.clock.time).toBe(0)
    expect(replay.clock.running).toBe(true)
  })
})

describe('projectile apex timeline event', () => {
  /* Assemble the exact SnapshotInput the runtime builds, so a builder-level
     assertion exercises the same engine facts the product surface consumes. */
  const projectileInput = (velocity: { x: number; y: number; z: number }): SnapshotInput => {
    const scene = createMechanicsScene({
      sceneId: 'apex-view-test',
      model: 'projectile_motion',
      position: { x: 0, y: 20, z: 0 },
      velocity,
      gravity: { x: 0, y: -10, z: 0 },
      groundY: 0,
      now: '2026-08-21T00:00:00.000Z',
    })
    const engine = new MechanicsEngine()
    const simulation = engine.simulate(
      scene,
      createMechanicsSimulationRequest(scene, 'sim-apex', 'trace-apex'),
    )
    const model = resolveMechanicsModel(scene)
    const state = engine.stateAt(scene, { value: 0, unit: 's', dimension: 'time' })
    return {
      scene,
      modelId: 'projectile_motion',
      model,
      simulation,
      state,
      observations: observeMechanicsScene({ scene, simulation, state }),
      verification: verifyMechanicsSimulation(scene, simulation),
      visibility: {},
      clock: {
        time: 0,
        total: model.modelId === 'projectile_motion' ? model.flightTime : 10,
        running: false,
        rate: 1,
      },
      status: 'verified',
    }
  }

  it('places 最高点 at the engine apex time, not flightTime / 2', () => {
    const input = projectileInput({ x: 12, y: 8, z: 0 })
    if (input.model.modelId !== 'projectile_motion') throw new Error('expected projectile')
    const apex = buildSnapshot(input).events.find(event => event.id === 'apex')
    /* vy0 = 8, g = 10 → apex at 0.8 s; flightTime ≈ 2.954 s, so the old
       midpoint fallback would have placed it at ≈ 1.477 s. */
    expect(apex?.time).toBeCloseTo(8 / 10, 9)
    expect(apex?.time ?? 0).not.toBeCloseTo(input.model.flightTime / 2, 1)
  })

  it('emits no 最高点 when the launch has no upward component', () => {
    /* Includes the leftward horizontal throw (vx < 0, vy0 = 0) that the old
       view guard let fall through to a fabricated flightTime / 2 apex. */
    for (const [vx, vy] of [[10, 0], [-10, 0], [10, -5]] as const) {
      const snapshot = buildSnapshot(projectileInput({ x: vx, y: vy, z: 0 }))
      expect(snapshot.events.find(event => event.id === 'apex')).toBeUndefined()
      /* The honest absence is only for the apex: launch and impact remain. */
      expect(snapshot.events.some(event => event.id === 'impact')).toBe(true)
    }
    /* End to end through the runtime a student actually drives. */
    const runtime = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'projectile_motion',
        position: { x: 0, y: 20, z: 0 },
        velocity: { x: 10, y: 0, z: 0 },
        groundY: 0,
        now: '2026-08-21T00:00:00.000Z',
      }),
    )
    expect(runtime.getSnapshot().events.find(event => event.id === 'apex')).toBeUndefined()
  })

  it('reads the apex from the engine model instead of re-deriving vy0 / g', () => {
    const input = projectileInput({ x: 12, y: 8, z: 0 })
    if (input.model.modelId !== 'projectile_motion') throw new Error('expected projectile')
    /* A value the view could never produce by computing vy0/g (which is 0.8):
       if the event follows the sentinel, the builder is consuming, not deriving. */
    const sentinel = 1.2345
    const snapshot = buildSnapshot({
      ...input,
      model: { ...input.model, apexTime: sentinel },
    })
    const apex = snapshot.events.find(event => event.id === 'apex')
    expect(apex?.time).toBeCloseTo(sentinel, 9)
  })
})
