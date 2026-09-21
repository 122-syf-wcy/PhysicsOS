// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'

import { PhysicsCanvas } from '../src/client/physics/PhysicsCanvas.tsx'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'
import {
  MECHANICS_PARTS3D,
  mechanicsPart3dUrl,
} from '../src/client/physics/parts3d-mechanics-catalog.ts'
import type { ScenePoint, SceneVisualModel } from '../src/client/physics/scene-visual-model.ts'

afterEach(cleanup)

/* PhysicsCanvas fits the view extent into the nominal 720×405 plot with PAD
   {left 46, top 18, right 24, bottom 36} — in jsdom no ResizeObserver fires, so
   this is the exact projection the renderer uses. */
const project = (view: SceneVisualModel) => {
  const plotW = 720
  const plotH = 405
  const scale = Math.min(plotW / view.extent.width, plotH / view.extent.height)
  const insetX = (plotW - view.extent.width * scale) / 2
  const insetY = (plotH - view.extent.height * scale) / 2
  const originY = 18 + plotH - insetY
  return {
    scale,
    px: (p: ScenePoint) => 46 + insetX + (p.x - view.origin.x) * scale,
    py: (p: ScenePoint) => originY - (p.y - view.origin.y) * scale,
  }
}

const imageOf = (container: HTMLElement, testId: string): Element => {
  const node = container.querySelector(`[data-testid="${testId}"]`)
  expect(node, testId).toBeTruthy()
  if (node === null || node.tagName !== 'image') throw new Error(`${testId} is not an image element.`)
  return node
}

const cartRuntime = () =>
  createMechanicsWorkspaceRuntime(
    createMechanicsScene({
      sceneId: 'cart-sprite-test',
      model: 'uniform_linear_motion',
      velocity: { x: 4, y: 0, z: 0 },
      now: '2026-08-21T00:00:00.000Z',
    }),
  )

describe('mechanics parts3d sprites', () => {
  it('draws the cart sprite pinned by its bottom-contact anchor', () => {
    const snapshot = cartRuntime().getSnapshot()
    const body = snapshot.view.bodies[0]
    expect(body?.kind).toBe('cart')

    const { container } = render(<PhysicsCanvas view={snapshot.view} ariaLabel="匀速直线运动" />)
    const image = imageOf(container, 'sprite-cart')
    expect(image.getAttribute('href')).toBe('/physicsos/parts3d/mechanics/cart.png')

    const part = MECHANICS_PARTS3D['cart']!
    const projection = project(snapshot.view)
    const x = Number(image.getAttribute('x'))
    const y = Number(image.getAttribute('y'))
    const w = Number(image.getAttribute('width'))
    const h = Number(image.getAttribute('height'))
    /* The anchor lands on the contact point one half-edge below the COM. */
    expect(x + part.anchorPoint!.x * w).toBeCloseTo(projection.px(body!.at), 4)
    expect(y + part.anchorPoint!.y * h).toBeCloseTo(projection.py(body!.at) + body!.size * projection.scale, 4)
    /* And the solid body stands exactly 2·size tall, as the vector body did. */
    expect(h * part.solidBox.height).toBeCloseTo(2 * body!.size * projection.scale, 4)
  })

  it('draws the projectile ball sprite centred on the COM with the drawn radius', () => {
    const snapshot = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'projectile_motion',
        position: { x: 0, y: 20, z: 0 },
        velocity: { x: 10, y: 0, z: 0 },
        groundY: 0,
        now: '2026-08-21T00:00:00.000Z',
      }),
    ).getSnapshot()
    const body = snapshot.view.bodies[0]
    expect(body?.kind).toBe('ball')

    const { container } = render(<PhysicsCanvas view={snapshot.view} ariaLabel="平抛运动" />)
    const image = imageOf(container, 'sprite-ball')
    expect(image.getAttribute('href')).toBe('/physicsos/parts3d/mechanics/ball.png')

    const part = MECHANICS_PARTS3D['ball']!
    const projection = project(snapshot.view)
    const x = Number(image.getAttribute('x'))
    const y = Number(image.getAttribute('y'))
    const w = Number(image.getAttribute('width'))
    const h = Number(image.getAttribute('height'))
    /* Measured centre anchor lands on the projected COM. */
    expect(x + part.anchorPoint!.x * w).toBeCloseTo(projection.px(body!.at), 4)
    expect(y + part.anchorPoint!.y * h).toBeCloseTo(projection.py(body!.at), 4)
    /* Measured outline radius lands on the scene radius. */
    expect(w * part.radius!).toBeCloseTo(body!.size * projection.scale, 4)
  })

  it('rotates the incline plank onto the wedge hypotenuse by the scene angle', () => {
    const snapshot = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'inclined_plane',
        inclineAngle: 30,
        mass: 2,
        frictionCoefficient: 0.2,
        now: '2026-08-21T00:00:00.000Z',
      }),
    ).getSnapshot()
    const incline = snapshot.view.incline
    expect(incline).toBeDefined()

    const { container } = render(<PhysicsCanvas view={snapshot.view} ariaLabel="斜面" />)
    const image = imageOf(container, 'sprite-plank')
    const group = image.closest('g')
    const transform = group?.getAttribute('transform') ?? ''
    const match = /^rotate\(([-\d.eE]+) ([-\d.eE]+) ([-\d.eE]+)\)/.exec(transform)
    expect(match).toBeTruthy()
    /* The transform serialises to 3 decimals — assert at that resolution. */
    const degrees = Number(match![1])
    const pivotX = Number(match![2])
    const pivotY = Number(match![3])
    const projection = project(snapshot.view)
    /* Pivot is the apex; screen-clockwise by the incline angle. */
    expect(pivotX).toBeCloseTo(projection.px(incline!.origin), 2)
    const rise = incline!.base * Math.tan((incline!.angle * Math.PI) / 180)
    const apex = { x: incline!.origin.x, y: incline!.origin.y + rise }
    expect(pivotY).toBeCloseTo(projection.py(apex), 2)
    const foot = { x: incline!.origin.x + incline!.base, y: incline!.origin.y }
    const expected = (Math.atan2(projection.py(foot) - projection.py(apex), projection.px(foot) - projection.px(apex)) * 180) / Math.PI
    expect(degrees).toBeCloseTo(expected, 2)

    /* Inside the rotated frame, anchor point a sits exactly on the apex. */
    const part = MECHANICS_PARTS3D['plank']!
    const w = Number(image.getAttribute('width'))
    const h = Number(image.getAttribute('height'))
    expect(Number(image.getAttribute('x')) + part.anchorLine!.a.x * w).toBeCloseTo(pivotX, 2)
    expect(Number(image.getAttribute('y')) + part.anchorLine!.a.y * h).toBeCloseTo(pivotY, 2)
  })

  it('falls back to the vector body when the sprite fails to load', () => {
    const snapshot = cartRuntime().getSnapshot()
    const { container } = render(<PhysicsCanvas view={snapshot.view} ariaLabel="匀速直线运动" />)
    const image = imageOf(container, 'sprite-cart')
    fireEvent.error(image)
    expect(container.querySelector('[data-testid="sprite-cart"]')).toBeNull()
    /* The vector cart — wheels and all — takes back over. */
    expect(container.querySelectorAll('[data-testid="cart-spokes"]').length).toBe(2)
  })

  it('pins the suspension clamp on the spring anchor of a Hooke rig', () => {
    const snapshot = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'spring_statics',
        mass: 1,
        springConstant: 49,
        springNaturalLength: 2,
        springAnchor: { x: 0, y: 3, z: 0 },
        /* Verified equilibrium: the body must start where mg = k·Δx lands it —
           y = anchor.y − L₀ − mg/k = 3 − 2 − 0.2. */
        position: { x: 0, y: 0.8, z: 0 },
        now: '2026-08-21T00:00:00.000Z',
      }),
    ).getSnapshot()
    const sprite = snapshot.view.apparatus?.find(item => item.part === 'support-clamp')
    expect(sprite).toBeTruthy()
    expect(sprite?.at).toEqual({ x: 0, y: 3 })

    const { container } = render(<PhysicsCanvas view={snapshot.view} ariaLabel="胡克定律" />)
    const image = imageOf(container, 'apparatus-support-clamp')
    expect(image.getAttribute('href')).toBe('/physicsos/parts3d/mechanics/support-clamp.png')
    const part = MECHANICS_PARTS3D['support-clamp']!
    const projection = project(snapshot.view)
    const x = Number(image.getAttribute('x'))
    const y = Number(image.getAttribute('y'))
    const w = Number(image.getAttribute('width'))
    const h = Number(image.getAttribute('height'))
    /* The ring's inner-bottom lands exactly on the spring anchor. */
    expect(x + part.anchorPoint!.x * w).toBeCloseTo(projection.px(sprite!.at), 4)
    expect(y + part.anchorPoint!.y * h).toBeCloseTo(projection.py(sprite!.at), 4)
  })

  it('pins the suspension clamp on the pendulum pivot', () => {
    const snapshot = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'simple_pendulum',
        pendulumLength: 2,
        pendulumPivot: { x: 0, y: 3, z: 0 },
        position: { x: 0.5, y: 1, z: 0 },
        now: '2026-08-21T00:00:00.000Z',
      }),
    ).getSnapshot()
    const sprite = snapshot.view.apparatus?.find(item => item.part === 'support-clamp')
    expect(sprite?.at).toEqual({ x: 0, y: 3 })
    const { container } = render(<PhysicsCanvas view={snapshot.view} ariaLabel="单摆" />)
    imageOf(container, 'apparatus-support-clamp')
  })

  it('draws the puller scale mirrored with its hook on the block face', () => {
    const snapshot = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'horizontal_friction',
        mass: 2,
        frictionCoefficient: 0.3,
        staticFrictionCoefficient: 0.5,
        appliedForce: { x: 0, y: 0, z: 0 },
        appliedForceRamp: 2,
        maxAppliedForce: 30,
        now: '2026-08-21T00:00:00.000Z',
      }),
    ).getSnapshot()
    const sprite = snapshot.view.apparatus?.find(item => item.part === 'spring-scale')
    const body = snapshot.view.bodies[0]!
    expect(sprite?.flip).toBe(true)
    /* The hook tip pins to the block's pull-side face and tracks it. */
    expect(sprite?.at.x).toBeCloseTo(body.at.x + body.size, 6)

    const { container } = render(<PhysicsCanvas view={snapshot.view} ariaLabel="摩擦" />)
    const image = imageOf(container, 'apparatus-spring-scale')
    expect(image.getAttribute('href')).toBe('/physicsos/parts3d/mechanics/spring-scale.png')
    /* Mirrored about the anchor: the hook ends up on the block side. */
    const group = image.closest('g')
    expect(group?.getAttribute('transform')).toContain('scale(-1 1)')
    const part = MECHANICS_PARTS3D['spring-scale']!
    const projection = project(snapshot.view)
    const w = Number(image.getAttribute('width'))
    const x = Number(image.getAttribute('x'))
    /* Inside the mirrored group the image still sits at the unflipped box;
       the flipped left edge lands (1 − anchor.x)·w left of the anchor. */
    expect(x + part.anchorPoint!.x * w).toBeCloseTo(projection.px(sprite!.at), 4)
  })

  it('hangs the protractor disc behind the pendulum pivot', () => {
    const snapshot = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'simple_pendulum',
        pendulumLength: 2,
        pendulumPivot: { x: 0, y: 3, z: 0 },
        position: { x: 0.5, y: 1, z: 0 },
        now: '2026-08-21T00:00:00.000Z',
      }),
    ).getSnapshot()
    const sprite = snapshot.view.apparatus?.find(item => item.part === 'protractor')
    /* The flat-edge midpoint pins to the pivot: the bob swings across the arc. */
    expect(sprite?.at).toEqual({ x: 0, y: 3 })
    const { container } = render(<PhysicsCanvas view={snapshot.view} ariaLabel="单摆" />)
    imageOf(container, 'apparatus-protractor')
  })

  it('mounts the extension ruler beside the Hooke spring at anchor height', () => {
    const snapshot = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'spring_statics',
        mass: 1,
        springConstant: 49,
        springNaturalLength: 2,
        springAnchor: { x: 0, y: 3, z: 0 },
        position: { x: 0, y: 0.8, z: 0 },
        now: '2026-08-21T00:00:00.000Z',
      }),
    ).getSnapshot()
    const ruler = snapshot.view.apparatus?.find(item => item.part === 'ruler-vertical')
    expect(ruler?.at.y).toBeCloseTo(3, 6)
    expect(ruler?.at.x).toBeGreaterThan(0)
    /* The hanging weight sprite replaces the abstract block. */
    expect(snapshot.view.bodies[0]?.kind).toBe('weight-hook')
    const { container } = render(<PhysicsCanvas view={snapshot.view} ariaLabel="胡克" />)
    imageOf(container, 'apparatus-ruler-vertical')
    imageOf(container, 'sprite-weight-hook')
  })

  it('spans a rail under the friction track and rides the oscillator cart on it', () => {
    const friction = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'horizontal_friction',
        mass: 2,
        frictionCoefficient: 0.3,
        staticFrictionCoefficient: 0.5,
        appliedForce: { x: 0, y: 0, z: 0 },
        appliedForceRamp: 2,
        maxAppliedForce: 30,
        now: '2026-08-21T00:00:00.000Z',
      }),
    ).getSnapshot()
    const rail = friction.view.apparatus?.find(item => item.part === 'track-rail')
    const ground = friction.view.ground!
    /* The rail's top edge is the surface line, stretched over the whole span. */
    expect(rail?.at.y).toBeCloseTo(ground.y, 6)
    expect(rail?.width).toBeCloseTo(ground.to - ground.from, 6)

    const oscillator = createMechanicsWorkspaceRuntime(
      createMechanicsScene({
        model: 'spring_oscillator',
        mass: 0.5,
        springConstant: 8,
        springAnchor: { x: -2, y: 0, z: 0 },
        springNaturalLength: 1,
        position: { x: 0.4, y: 0, z: 0 },
        now: '2026-08-21T00:00:00.000Z',
      }),
    ).getSnapshot()
    expect(oscillator.view.bodies[0]?.kind).toBe('cart')
    expect(oscillator.view.apparatus?.some(item => item.part === 'track-rail')).toBe(true)
    const { container } = render(<PhysicsCanvas view={oscillator.view} ariaLabel="振子" />)
    imageOf(container, 'apparatus-track-rail')
    imageOf(container, 'sprite-cart')
  })
})

describe('mechanics parts3d catalog', () => {
  it('keeps the static catalog in parity with the shipped mechanics manifest', () => {
    const manifestPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../apps/web/public/physicsos/parts3d/mechanics/manifest.json',
    )
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      parts: {
        id: string
        file: string
        pixels: string
        solidBox: { left: number; top: number; width: number; height: number }
        anchorKind: 'point' | 'line'
        anchorPoint?: ScenePoint
        anchorLine?: { a: ScenePoint; b: ScenePoint }
        radius?: number
      }[]
    }

    expect(Object.keys(MECHANICS_PARTS3D).sort()).toEqual(manifest.parts.map(part => part.id).sort())
    for (const entry of manifest.parts) {
      const catalog = MECHANICS_PARTS3D[entry.id]
      const [w, h] = entry.pixels.split('x').map(Number)
      expect(catalog?.file, entry.id).toBe(entry.file)
      expect(catalog?.pixels, entry.id).toEqual({ w, h })
      expect(catalog?.solidBox, entry.id).toEqual(entry.solidBox)
      expect(catalog?.anchorKind, entry.id).toBe(entry.anchorKind)
      expect(catalog?.anchorPoint, entry.id).toEqual(entry.anchorPoint)
      expect(catalog?.anchorLine, entry.id).toEqual(entry.anchorLine)
      expect(catalog?.radius, entry.id).toBe(entry.radius)
      const png = readFileSync(resolve(dirname(manifestPath), entry.file))
      expect(png.subarray(1, 4).toString(), entry.id).toBe('PNG')
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], entry.id).toEqual([w, h])
    }
    expect(mechanicsPart3dUrl(MECHANICS_PARTS3D['ball']!)).toBe('/physicsos/parts3d/mechanics/ball.png')
  })
})
