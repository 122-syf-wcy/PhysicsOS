// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'
import { PhysicsWorkspace } from '../src/client/PhysicsWorkspace.tsx'
import { zh } from '../src/client/locales.ts'

const translations: Readonly<Record<string, string>> = zh
const t: PhysicsSurfaceProps['t'] = key => translations[key] ?? key
const neverHook = (() => { throw new Error('unused hook') }) as never
afterEach(cleanup)

it('persists a real inspector edit without rebuilding runtime, then resumes and reloads revision 1', () => {
  const storage = new Map<string, string>()
  const local = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value) } }
  const controller = createPhysicsSurfaceController(local)
  const scene = createMechanicsScene({ model: 'uniform_linear_motion', mass: 1, title: 'Saved bench' })
  controller.open('lab', { sceneId: String(scene.id), scene })
  const useSurface: PhysicsSurfaceProps['usePhysicsSurface'] = selector => selector(useSyncExternalStore(listener => controller.store.subscribe(listener), () => controller.store.getSnapshot()))
  const { container } = render(<PhysicsSurface usePhysicsSurface={useSurface}
    useLearningRecord={selector => selector({ attempts: [] })}
    useRecentExperiments={selector => selector(controller.recent.getSnapshot())}
    useSessions={neverHook} useWorkspaces={neverHook} useAuth={neverHook} t={t}
    updateScene={controller.updateScene} openSurface={controller.open} openExperimentPicker={controller.openExperimentPicker} />)
  const originalLab = container.querySelector('[data-physicsos-surface="lab"]')
  const input = screen.getByRole('textbox', { name: '质量' })
  fireEvent.change(input, { target: { value: '2' } })
  fireEvent.blur(input)
  expect(controller.store.getSnapshot().sceneRef?.scene.bodies[0]?.mass.value).toBe(2)
  expect(controller.store.getSnapshot().sceneRef?.scene.revision).toBe(1)
  expect(container.querySelector('[data-physicsos-surface="lab"]')).toBe(originalLab)
  act(() => { controller.openExperimentPicker() })
  expect(screen.getByText('返回当前实验')).toBeTruthy()
  act(() => { controller.open('lab') })
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '质量' }).value).toBe('2')
  expect(container.querySelector('[data-scene-revision="1"]')).toBeTruthy()
  expect(createPhysicsSurfaceController(local).recent.getSnapshot().items[0]?.scene.bodies[0]?.mass.value).toBe(2)
})

it('background playback yields to modal dialogs and already handled keyboard events', () => {
  const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({ model: 'uniform_linear_motion' }))
  render(<PhysicsWorkspace runtime={runtime} t={t} />)
  const modal = document.createElement('div')
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  document.body.append(modal)
  fireEvent.keyDown(document, { key: 'ArrowRight' })
  expect(runtime.getSnapshot().clock.time).toBe(0)
  modal.remove()
  const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
  event.preventDefault()
  document.dispatchEvent(event)
  expect(runtime.getSnapshot().clock.time).toBe(0)
  fireEvent.keyDown(document, { key: 'ArrowRight' })
  expect(runtime.getSnapshot().clock.time).toBeGreaterThan(0)
})


it('never paints a green workspace badge when a claimed verified frame has no checks', () => {
  const runtime = createMechanicsWorkspaceRuntime(createMechanicsScene({ model: 'uniform_linear_motion' }))
  const snapshot = { ...runtime.getSnapshot(), status: 'verified' as const, verification: [] }
  const read = vi.spyOn(runtime, 'getSnapshot').mockReturnValue(snapshot)
  try {
    const { container } = render(<PhysicsWorkspace runtime={runtime} t={t} />)
    expect(container.querySelector('[data-physicsos-surface="lab"]')?.getAttribute('data-verification-status')).toBe('warning')
    expect(container.querySelector('[data-status="verified"]')).toBeNull()
  } finally {
    read.mockRestore()
  }
})
