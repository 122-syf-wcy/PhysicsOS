// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { QuestionCodeControls } from '../src/client/experiments/QuestionCodeControls.tsx'
import { createExperimentSession, type ExperimentSession } from '../src/client/experiments/experiment-session.ts'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'

afterEach(cleanup)

function inclineSession() {
  return createExperimentSession(createMechanicsWorkspaceRuntime(createMechanicsScene({
    sceneId: 'observable-labels', model: 'inclined_plane', mass: 2,
    position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
    gravity: { x: 0, y: -10, z: 0 }, inclineAngle: 30, frictionCoefficient: 0.2,
  })))
}

function LiveControls({ session, compact = false }: { session: ExperimentSession; compact?: boolean }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot)
  return <QuestionCodeControls session={session} snapshot={snapshot} compact={compact} />
}

it('names incline layers omitted from the tree and toggles the original netForce key', () => {
  const session = inclineSession(), before = session.getSnapshot().view.visible
  const view = render(<LiveControls session={session} />)
  for (const name of ['轨迹', '关键点', '合力', '速度分量']) {
    expect(view.getByRole('checkbox', { name })).toBeTruthy()
  }
  const netForce = view.getByRole('checkbox', { name: '合力' }) as HTMLInputElement
  expect(netForce.checked).toBe(true)
  fireEvent.click(netForce)
  expect(session.getSnapshot().view.visible).toEqual({ ...before, netForce: false })
  expect(netForce.checked).toBe(false)
})

it('keeps two editable conditions in the preview and exposes remaining controls on demand', () => {
  const session = inclineSession()
  const view = render(<LiveControls session={session} compact />)
  const more = view.getByText('更多控制').closest('details')
  expect(more?.open).toBe(false)
  const editors = view.getAllByRole('spinbutton').filter(input => !more?.contains(input))
  expect(editors).toHaveLength(2)
  const preview = vi.spyOn(session, 'previewParameter'), commit = vi.spyOn(session, 'commitParameter')
  const slider = view.getAllByRole('slider').find(input => !more?.contains(input)) as HTMLInputElement
  const initial = slider.value, value = String(Number(initial) + 1)
  fireEvent.change(slider, { target: { value } })
  expect(preview).toHaveBeenCalled()
  expect(commit).not.toHaveBeenCalled()
  fireEvent.pointerUp(slider)
  expect(commit).toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: '恢复原题' }))
  const input = editors[0] as HTMLInputElement, original = input.value
  fireEvent.change(input, { target: { value: String(Number(original) + 1) } })
  fireEvent.blur(input)
  expect((view.getByRole('button', { name: '恢复原题' }) as HTMLButtonElement).disabled).toBe(false)
  if (more === null) throw new Error('Missing more-controls disclosure')
  fireEvent.click(view.getByText('更多控制'))
  expect(more.open).toBe(true)
  expect(more.querySelectorAll('input[type="number"]').length).toBeGreaterThan(0)
  expect(more.querySelector('input[type="checkbox"]')).not.toBeNull()
  fireEvent.click(view.getByRole('button', { name: '恢复原题' }))
  expect((editors[0] as HTMLInputElement).value).toBe(original)
  expect((view.getByRole('button', { name: '恢复原题' }) as HTMLButtonElement).disabled).toBe(true)
  view.unmount()
  session.runtime.dispose?.()
})

it('prefers the snapshot tree label and keeps unknown extension labels available', () => {
  const session = inclineSession(), snapshot = session.getSnapshot()
  const visible = { ...snapshot.view.visible, customTrail: true }
  const view = render(<QuestionCodeControls session={session} snapshot={{
    ...snapshot,
    tree: [{ id: 'question-force', label: '本题合力方向', kind: 'observable', icon: 'force', observable: 'netForce' }],
    view: { ...snapshot.view, visible },
  }} />)
  expect(view.getByRole('checkbox', { name: '本题合力方向' })).toBeTruthy()
  expect(view.queryByRole('checkbox', { name: '合力' })).toBeNull()
  expect(view.getByRole('checkbox', { name: 'customTrail' })).toBeTruthy()
})
