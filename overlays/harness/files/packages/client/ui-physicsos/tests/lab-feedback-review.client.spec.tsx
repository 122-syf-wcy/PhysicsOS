// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMechanicsScene, createRampFrictionScene } from '@physicsos/physics-scene'
import { MechanicsEngine } from '@physicsos/engine-mechanics'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'
import { createEnergyWorkspaceRuntime } from '../src/client/physics/energy-workspace-runtime.ts'
import { EnergyRenderer } from '../src/client/physics/energy-renderer.tsx'
import type { RendererProjection } from '../src/client/physics/renderer-registry.tsx'

afterEach(cleanup)

describe('mechanics review regressions', () => {
  it('balances every declared force on a free body without inventing a surface normal', () => {
    const input = createMechanicsScene({ model: 'newton_second_law', mass: 1,
      gravity: { x: 0, y: -10, z: 0 }, appliedForce: { x: 3, y: 0, z: 0 }, appliedForces: [{ x: 0, y: 4, z: 0 }] })
    const scene = { ...input, forces: input.forces.filter(force => force.type !== 'normal') }
    const runtime = createMechanicsWorkspaceRuntime(scene)
    expect(runtime.getSnapshot().status).toBe('verified')
    const balanced = runtime.setChoice('force-balance', 'balanced')
    expect(balanced.status).toBe('verified')
    expect(runtime.getScene().forces.some(force => force.type === 'normal')).toBe(false)
    const state = new MechanicsEngine().stateAt(runtime.getScene(), { value: 1, unit: 's', dimension: 'time' })
    expect(state.objects[0]!.acceleration!.vector.x).toBeCloseTo(0, 10)
    expect(state.objects[0]!.acceleration!.vector.y).toBeCloseTo(0, 10)
    expect(state.objects[0]!.velocity!.vector.y).toBeCloseTo(0, 10)
  })

  it.each([0, 0.5, 1])('keeps the actual SVG cart above its support at fraction %s', (fraction) => {
    const runtime = createEnergyWorkspaceRuntime(createRampFrictionScene())
    const frame = runtime.seek(runtime.getSnapshot().clock.total * fraction)
    const original = JSON.stringify(frame.view)
    const ramp = frame.view.energyRamp!
    const projection: RendererProjection = { px: point => point.x, py: point => -point.y,
      sx: x => x, sy: y => -y, scale: 1, uid: 'review-energy',
      path: points => points.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' '), highlighted: () => false }
    const { container } = render(<svg><EnergyRenderer view={frame.view} projection={projection} /></svg>)
    const cart = container.querySelector('[data-testid="energy-cart"]')!
    const x = Number(cart.getAttribute('x')), y = Number(cart.getAttribute('y'))
    const width = Number(cart.getAttribute('width')), height = Number(cart.getAttribute('height'))
    const transform = cart.getAttribute('transform')!.match(/rotate\(([-+\d.eE]+) ([-+\d.eE]+) ([-+\d.eE]+)\)/)!
    const angle = Number(transform[1]) * Math.PI / 180, cx = Number(transform[2]), cy = Number(transform[3])
    const length = Math.hypot(ramp.peak.x - ramp.base.x, ramp.peak.y - ramp.base.y)
    const tx = (ramp.peak.x - ramp.base.x) / length, ty = (ramp.peak.y - ramp.base.y) / length
    for (const vx of [x, x + width]) for (const vy of [y, y + height]) {
      const world = { x: cx + (vx - cx) * Math.cos(angle) - (vy - cy) * Math.sin(angle),
        y: -(cy + (vx - cx) * Math.sin(angle) + (vy - cy) * Math.cos(angle)) }
      const dx = world.x - ramp.base.x, dy = world.y - ramp.base.y
      expect(world.y).toBeGreaterThanOrEqual(ramp.base.y - 1e-8)
      expect(dx * -ty + dy * tx).toBeGreaterThanOrEqual(-1e-8)
      expect(dx * tx + dy * ty).toBeGreaterThanOrEqual(-1e-8)
      expect(dx * tx + dy * ty).toBeLessThanOrEqual(length + 1e-8)
    }
    expect(JSON.stringify(frame.view)).toBe(original)
  })
})
