// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'

import { PhysicsCanvas } from '../src/client/physics/PhysicsCanvas.tsx'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'

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

/** Rotation angle of the first wheel's spoke group, parsed out of `rotate(θ cx cy)`. */
const spokeAngle = (container: HTMLElement): number => {
  const spokes = container.querySelectorAll('[data-testid="cart-spokes"]')
  expect(spokes.length).toBe(2)
  const transform = spokes[0]?.getAttribute('transform') ?? ''
  const angle = Number(/^rotate\(([-\d.eE]+)/.exec(transform)?.[1])
  expect(Number.isFinite(angle)).toBe(true)
  return angle
}

describe('mechanics cart wheels', () => {
  it('rotates the wheel spokes through the arc the cart has covered, θ = s/R', () => {
    const runtime = cartRuntime()
    const total = runtime.getSnapshot().clock.total
    const early = runtime.seek(total * 0.25)
    const late = runtime.seek(total * 0.75)
    expect(early.view.bodies[0]?.kind).toBe('cart')

    const first = render(<PhysicsCanvas view={early.view} ariaLabel="匀速直线运动" />)
    const angleEarly = spokeAngle(first.container)
    first.unmount()

    const second = render(<PhysicsCanvas view={late.view} ariaLabel="匀速直线运动" />)
    const angleLate = spokeAngle(second.container)
    expect(late.view.bodies[0]?.at.x).toBeGreaterThan(early.view.bodies[0]?.at.x ?? 0)
    expect(angleLate).not.toBe(angleEarly)

    /* Rolling without slipping: the drawn angle equals the rolled arc over the
       wheel radius — the glyph's wheel is size·0.32 in scene units. */
    const body = late.view.bodies[0]
    const rolled = (((body?.at.x ?? 0) / ((body?.size ?? 1) * 0.32)) * 180) / Math.PI
    expect(angleLate).toBeCloseTo(((rolled % 360) + 360) % 360, 1)
  })

  it('draws no spokes on bodies that have no wheels', () => {
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
    expect(container.querySelector('[data-testid="cart-spokes"]')).toBeNull()
  })
})
