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

describe('projectile initial-speed edits', () => {
  it.each([
    { angle: 90, velocity: { x: 0, y: 20, z: 0 }, expected: { x: 0, y: 25, z: 0 } },
    {
      angle: 30,
      velocity: { x: 17.32050807568877, y: 10, z: 0 },
      expected: { x: 21.65063509461097, y: 12.5, z: 0 },
    },
    { angle: 0, velocity: { x: 20, y: 0, z: 0 }, expected: { x: 25, y: 0, z: 0 } },
  ])(
    'keeps the $angle° launch direction when speed changes, including through zero',
    ({ angle, velocity, expected }) => {
      const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({
        model: 'projectile_motion',
        position: { x: 0, y: 20, z: 0 },
        velocity,
        groundY: 0,
        now: '2026-08-21T00:00:00.000Z',
      }))
      for (const speed of [25, 0, 25]) {
        const snapshot = runtime.editParameter('speed', speed)
        const vector = runtime.getScene().bodies[0]!.velocity.vector
        const parameters = snapshot.inspector.flatMap(section => section.parameters ?? [])
        expect(snapshot.status).toBe('verified')
        expect(parameters.find(row => row.id === 'speed')?.value).toBeCloseTo(speed, 9)
        expect(vector.x).toBeCloseTo(speed === 0 ? 0 : expected.x, 9)
        expect(vector.y).toBeCloseTo(speed === 0 ? 0 : expected.y, 9)
        expect(vector.z).toBe(0)
        expect(parameters.find(row => row.id === 'angle')?.value).toBeCloseTo(angle, 9)
      }
    },
  )

  it('keeps zero speed while selecting the direction for the next launch', () => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({
      model: 'projectile_motion',
      position: { x: 0, y: 20, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      now: '2026-08-21T00:00:00.000Z',
    }))
    const stopped = runtime.editParameter('angle', 30)
    const parameters = stopped.inspector.flatMap(section => section.parameters ?? [])
    expect(parameters.find(row => row.id === 'speed')?.value).toBe(0)
    expect(parameters.find(row => row.id === 'angle')?.value).toBeCloseTo(30, 9)
    expect(runtime.getScene().bodies[0]!.velocity.vector).toEqual({ x: 0, y: 0, z: 0 })
    const launched = runtime.editParameter('speed', 25)
    expect(launched.status).toBe('verified')
    expect(runtime.getScene().bodies[0]!.velocity.vector.x).toBeCloseTo(21.65063509461097, 9)
    expect(runtime.getScene().bodies[0]!.velocity.vector.y).toBeCloseTo(12.5, 9)
  })

  it('restores the original question launch direction before a zero-speed edit', () => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({
      model: 'projectile_motion',
      sourceQuestionId: 'vertical-speed-question',
      velocity: { x: 0, y: 20, z: 0 },
      now: '2026-08-21T00:00:00.000Z',
    }))
    expect(runtime.editParameter('angle', 30).branch?.canRestore).toBe(true)
    runtime.restoreOrigin()
    runtime.editParameter('speed', 0)
    const relaunched = runtime.editParameter('speed', 25)
    expect(relaunched.status).toBe('verified')
    expect(runtime.getScene().bodies[0]!.velocity.vector).toEqual({ x: 0, y: 25, z: 0 })
    expect(relaunched.events.find(event => event.id === 'apex')?.time)
      .toBeCloseTo(2.5510204081632653, 9)
  })
})

describe('P3-a mechanics expansion scenes', () => {
  it.each([15, 30, 60])('aligns the block rotation with a descending %i° incline', angle => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({ model: 'inclined_plane', inclineAngle: angle }))
    for (const snapshot of [runtime.getSnapshot(), runtime.seek(0.25)]) {
      const body = snapshot.view.bodies[0]
      const incline = snapshot.view.incline
      expect(body?.rotation).toBeCloseTo(-angle, 10)
      if (body?.rotation === undefined || incline === undefined) throw new Error('Incline body is absent.')
      const rotation = body.rotation * Math.PI / 180
      const radians = incline.angle * Math.PI / 180
      const slope = { x: incline.base, y: -incline.base * Math.tan(radians) }
      expect(Math.cos(rotation) * slope.y - Math.sin(rotation) * slope.x).toBeCloseTo(0, 10)
      const peak = { x: incline.origin.x, y: incline.origin.y - slope.y }
      const normalDistance = (body.at.x - peak.x) * Math.sin(radians) + (body.at.y - peak.y) * Math.cos(radians)
      expect(normalDistance).toBeCloseTo(body.size, 10)
      const angleArc = snapshot.view.angles.find(item => item.id === 'incline-angle')
      expect(angleArc?.at).toEqual({ x: incline.origin.x + incline.base, y: incline.origin.y })
    }
  })

  it.each([
    { fraction: 0, direction: [-1, 0] },
    { fraction: 0.25, direction: [0, -1] },
    { fraction: 0.5, direction: [1, 0] },
    { fraction: 0.75, direction: [0, 1] },
  ])('draws orbital gravity inward at $fraction turns without a second resultant', ({ fraction, direction }) => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({ model: 'circular_orbit', gravitationalParameter: 32, orbitRadius: 2, mass: 3 }))
    const snapshot = runtime.seek(runtime.getSnapshot().clock.total * fraction)
    const gravity = snapshot.view.vectors.find(vector => vector.id === 'force-gravity')
    expect(gravity).toBeDefined()
    if (gravity === undefined) throw new Error('Orbital gravity is absent.')
    const dx = gravity.to.x - gravity.from.x
    const dy = gravity.to.y - gravity.from.y
    expect(dx * direction[0]! + dy * direction[1]!).toBeGreaterThan(0)
    expect(dx * direction[1]! - dy * direction[0]!).toBeCloseTo(0, 8)
    expect(snapshot.view.vectors.find(vector => vector.id === 'net-force')).toBeUndefined()
  })

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

  it.each([
    { label: 'ramped pull', force: 0, ramp: 2, level: 0.6 },
    { label: 'constant pull', force: 15, ramp: 0, level: -1.2 },
  ])('keeps the friction contact plane below the COM for $label', ({ force, ramp, level }) => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({
      model: 'horizontal_friction', mass: 2,
      position: { x: 0, y: level, z: 0 },
      appliedForce: { x: force, y: 0, z: 0 }, appliedForceRamp: ramp, maxAppliedForce: ramp === 0 ? force : 30,
      frictionCoefficient: 0.3, staticFrictionCoefficient: 0.5,
    }))
    const initial = runtime.getSnapshot()
    const moved = runtime.seek(initial.clock.total * 0.9)
    const edited = runtime.editParameter('mass', 3)
    for (const snapshot of [initial, moved, edited]) {
      const body = snapshot.view.bodies[0]
      const ground = snapshot.view.ground
      const rail = snapshot.view.apparatus?.find(item => item.part === 'track-rail')
      const puller = snapshot.view.apparatus?.find(item => item.part === 'spring-scale')
      if (body === undefined || ground === undefined) throw new Error('Friction apparatus is absent.')
      expect(body.at.y).toBeCloseTo(level, 10)
      expect(ground.y).toBeCloseTo(body.at.y - body.size, 10)
      expect(rail?.at.y).toBeCloseTo(ground.y, 10)
      expect(puller?.at.x).toBeCloseTo(body.at.x + body.size, 10)
      expect(puller?.at.y).toBeCloseTo(body.at.y, 10)
    }
    expect(moved.view.bodies[0]?.at.x).toBeGreaterThan(initial.view.bodies[0]?.at.x ?? 0)
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

  it('measures Hooke extension between matching coil-tip anchors after parameter edits', () => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({
      model: 'spring_statics', mass: 1, position: { x: 0, y: 0.8, z: 0 },
      springConstant: 49, springNaturalLength: 2, springAnchor: { x: 0, y: 3, z: 0 },
    }))
    const cases = [
      { snapshot: runtime.getSnapshot(), extension: 0.2 },
      { snapshot: runtime.editParameter('mass', 2), extension: 0.4 },
      { snapshot: runtime.editParameter('springConstant', 98), extension: 0.2 },
      { snapshot: runtime.editParameter('gravity', 4.9), extension: 0.1 },
    ]
    for (const { snapshot, extension } of cases) {
      const body = snapshot.view.bodies[0]
      const spring = snapshot.view.spring
      if (body === undefined || spring?.equilibrium === undefined) throw new Error('Spring reference is absent.')
      expect(snapshot.status).toBe('verified')
      expect(body.at.y).toBeCloseTo(1 - extension, 10)
      expect(spring.end.y).toBeCloseTo(body.at.y + body.size, 10)
      expect(spring.equilibrium - spring.end.y).toBeCloseTo(extension, 10)
      // Translate the displayed tip back to the point-mass constraint anchor.
      expect(spring.equilibrium - body.size).toBeCloseTo(1, 10)
      expect(spring.naturalLength).toBe(2)
    }
  })

  it.each([-1, 1])('keeps horizontal spring tip references on mounting side %i', side => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({
      model: 'spring_oscillator', mass: 1, position: { x: side * 2.4, y: 0, z: 0 },
      springConstant: 4, springNaturalLength: 2, springAnchor: { x: 0, y: 0, z: 0 },
    }))
    const initial = runtime.getSnapshot()
    const opposite = runtime.seek(Math.PI / 2)
    for (const [snapshot, displacement] of [[initial, 0.4], [opposite, -0.4]] as const) {
      const body = snapshot.view.bodies[0]
      const spring = snapshot.view.spring
      if (body === undefined || spring?.equilibrium === undefined) throw new Error('Spring reference is absent.')
      expect(spring.end.x).toBeCloseTo(body.at.x - side * body.size, 10)
      expect(side * (spring.end.x - spring.equilibrium)).toBeCloseTo(displacement, 10)
    }
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
