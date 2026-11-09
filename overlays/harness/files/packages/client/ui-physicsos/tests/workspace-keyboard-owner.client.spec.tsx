// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Modal, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { PhysicsWorkspace } from '../src/client/PhysicsWorkspace.tsx'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'
import { zh } from '../src/client/locales.ts'

const t: Parameters<typeof PhysicsWorkspace>[0]['t'] = key => zh[key]
const runtime = () => createMechanicsWorkspaceRuntime(createMechanicsScene({ model: 'uniform_linear_motion' }))
beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('single workspace keyboard modal ownership', () => {
  it('keeps an outside control from stepping a workspace that does not own its focus', () => {
    const world = runtime()
    render(<><PhysicsWorkspace runtime={world} t={t} /><button>Sidebar navigation</button></>)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Sidebar navigation' }), { key: 'ArrowRight' })
    expect(world.getSnapshot().clock.time).toBe(0)
  })

  it('lets the experiment inside its focus modal own playback while the background experiment stays paused', () => {
    const foreground = runtime()
    const background = runtime()
    render(<>
      <PhysicsWorkspace runtime={background} t={t} />
      <Modal open title="Focused single experiment" closeLabel="Close" onClose={() => undefined}>
        <PhysicsWorkspace runtime={foreground} t={t} />
      </Modal>
    </>)
    const owner = screen.getByRole('dialog', { name: 'Focused single experiment' }).querySelector('[data-physicsos-surface="lab"]')!
    const canvas = owner.querySelector('[role="img"]')!
    fireEvent.keyDown(canvas, { key: 'ArrowRight' })
    expect(foreground.getSnapshot().clock.time).toBeGreaterThan(0)
    expect(background.getSnapshot().clock.time).toBe(0)
    fireEvent.keyDown(canvas, { key: ' ' })
    expect(owner.getAttribute('data-physicsos-running')).toBe('true')
    const backgroundOwner = [...document.querySelectorAll('[data-physicsos-surface="lab"]')].find(element => element !== owner)
    expect(backgroundOwner?.getAttribute('data-physicsos-running')).toBe('false')
  })

  it.each(['report', 'menu'])('yields playback keys to a foreground portaled %s within the focus modal', kind => {
    const world = runtime()
    function FocusedHost() {
      const [open, setOpen] = useState(false)
      return <Modal open title="Focused single experiment" closeLabel="Close" onClose={() => undefined}>
        <PhysicsWorkspace runtime={world} t={t} />
        {kind === 'report' ? <>
          <button onClick={() => { setOpen(true) }}>Open report</button>
          <Modal open={open} title="Experimental report" closeLabel="Close" onClose={() => { setOpen(false) }}>
            <button>Report action</button>
          </Modal>
        </> : <Menu open={open} portal autoFocus onClose={() => { setOpen(false) }}
          anchor={<button onClick={() => { setOpen(true) }}>Open menu</button>}
          items={[{ id: 'display', label: 'Display mode' }]} onSelect={() => undefined} />}
      </Modal>
    }
    render(<FocusedHost />)
    fireEvent.click(screen.getByRole('button', { name: kind === 'report' ? 'Open report' : 'Open menu' }))
    const target = kind === 'report' ? screen.getByRole('button', { name: 'Report action' })
      : screen.getByRole('menuitem', { name: 'Display mode' })
    fireEvent.keyDown(target, { key: 'ArrowRight' })
    fireEvent.keyDown(target, { key: ' ' })
    expect(world.getSnapshot().clock.time).toBe(0)
    expect(document.querySelector('[data-physicsos-surface="lab"]')?.getAttribute('data-physicsos-running')).toBe('false')
  })

  it('preserves text editing and IME keys within its focused experiment', () => {
    const world = runtime()
    render(<Modal open title="Focused single experiment" closeLabel="Close" onClose={() => undefined}>
      <PhysicsWorkspace runtime={world} t={t} />
    </Modal>)
    const owner = screen.getByRole('dialog', { name: 'Focused single experiment' }).querySelector('[data-physicsos-surface="lab"]')!
    const input = owner.querySelector('input:not([type="range"])')!
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    fireEvent.keyDown(input, { key: ' ' })
    fireEvent.keyDown(owner.querySelector('[role="img"]')!, { key: 'ArrowRight', isComposing: true })
    expect(world.getSnapshot().clock.time).toBe(0)
  })
})
