// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { CanvasInstanceView } from '../src/client/canvas/CanvasInstanceViews.tsx'
import type { CanvasInstanceProps } from '../src/client/canvas/contract.ts'
import { createWorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'
import { createCanvasNodeTestProps, keyedSelectorHook } from './canvas-ui-fixtures.client.ts'

/* The instance view resolves its node factory through the slot hook; these
   tests render the view directly and mount no flow node. */
const useUnrenderedFactorySlot = (): (() => null) => () => null
const useFactorySlot = (() => useUnrenderedFactorySlot()) as CanvasInstanceProps['useFactorySlot']


afterEach(cleanup)

const horizontalScene = () => createMechanicsScene({
  model: 'projectile_motion', position: { x: 0, y: 20, z: 0 }, velocity: { x: 10, y: 0, z: 0 },
  gravity: { x: 0, y: -9.8, z: 0 }, groundY: 0,
})

describe('motion principles in the experiment card', () => {
  it('opens current projectile formulas without changing playback, and follows real parameter edits', async () => {
    const runtime = createWorkbenchInstanceRuntime({ scene: horizontalScene(), source: { kind: 'import', id: 'projectile-formulas' }, scheduler: null })
    onTestFinished(() => { runtime.dispose() })
    const base = createCanvasNodeTestProps('experiment', {
      commands: { instanceAction: async () => { throw new Error('Opening formulas must not invoke an experiment command.') } },
      overrides: {
      useCanvasInstance: keyedSelectorHook(key => key === runtime.instanceKey ? runtime.summaries : undefined),
    } })
    const props = { ...base.props, canvasId: base.props.data.canvasId, instanceId: 'projectile-formulas',
      instanceKey: runtime.instanceKey, presentation: 'card', renderSlot: () => <div data-experiment-frame />,
      useFactorySlot,
    } satisfies CanvasInstanceProps
    runtime.setRunning(true)
    runtime.seek(0.5)
    const before = runtime.getSnapshot()
    const view = render(<CanvasInstanceView {...props} />)
    const summary = screen.getByText('Principles and formulas')
    const panel = summary.closest('details')!
    expect(panel.open).toBe(false)
    expect(panel.querySelector('ol')).toBeNull()
    expect(fireEvent.keyDown(summary, { key: ' ' })).toBe(true)
    fireEvent.click(summary)
    expect(panel.open).toBe(true)
    await waitFor(() => expect(panel.textContent).toContain('忽略空气阻力'))
    expect(runtime.getSnapshot().clock).toEqual(before.clock)
    expect(runtime.getSnapshot().instanceEditRevision).toBe(before.instanceEditRevision)
    expect(view.container.querySelectorAll('[data-experiment-frame]')).toHaveLength(1)
    expect(panel.textContent).toContain('忽略空气阻力')
    expect(panel.textContent).toContain('h = 20 m')
    expect(panel.textContent).toContain('vₓ₀ = 10 m/s')
    expect(panel.textContent).toContain('g = 9.8 m/s²')
    expect(within(panel).getAllByRole('status').map(output => output.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('2.02 s'), expect.stringContaining('20.2 m'),
    ]))
    act(() => { runtime.editParameter('speed', 20) })
    expect(panel.textContent).toContain('vₓ₀ = 20 m/s')
    expect(panel.textContent).toContain('40.41 m')
    act(() => { runtime.editParameter('height', 45); runtime.editParameter('gravity', 10) })
    expect(panel.open).toBe(true)
    expect(panel.textContent).toContain('h = 45 m')
    expect(panel.textContent).toContain('g = 10 m/s²')
    expect(within(panel).getAllByRole('status').map(output => output.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('3 s'), expect.stringContaining('60 m'),
    ]))
  })

  it('shows oblique flight formulas relative to a raised ground and includes the initial height in the maximum', () => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({ model: 'projectile_motion',
      position: { x: 7, y: 25, z: 0 }, velocity: { x: 8, y: 10, z: 0 },
      gravity: { x: 0, y: -10, z: 0 }, groundY: 5,
    }))
    expect(runtime.getSnapshot().status).toBe('verified')
    const steps = runtime.getSnapshot().derivation
    expect(steps.find(step => step.id === 'trajectory')?.expression).toBe('x = x_0 + v_{x0}t,\\quad y = y_0 + v_{y0}t - \\tfrac{1}{2}gt^2')
    const flight = steps.find(step => step.id === 'flight')!
    expect(flight.expression).toBe('T = \\frac{v_{y0} + \\sqrt{v_{y0}^2 + 2gh}}{g}')
    expect(flight.detail).toContain('h = y₀ − y地面 = 25 − 5 = 20 m')
    expect(flight.detail).toContain('vᵧ₀ = 10 m/s')
    expect(Number(flight.result!.value)).toBeCloseTo(1 + Math.sqrt(5), 3)
    expect(Number(steps.find(step => step.id === 'range')!.result!.value)).toBeCloseTo(8 * (1 + Math.sqrt(5)), 2)
    expect(steps.find(step => step.id === 'height')!.result).toEqual({ symbol: 'H', value: '25', unit: 'm' })
    expect(steps.find(step => step.id === 'height')!.expression).toContain('h +')
  })

  it('does not present an arbitrary zero-gravity playback duration as a ground impact', () => {
    const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({ model: 'projectile_motion',
      position: { x: 0, y: 20, z: 0 }, velocity: { x: 10, y: 0, z: 0 }, gravity: { x: 0, y: 0, z: 0 }, groundY: 0,
    }))
    const steps = runtime.getSnapshot().derivation
    expect(steps).toEqual([])
    expect(steps.flatMap(step => step.result === undefined ? [] : [step.result])).toEqual([])
  })
})
