// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createConcaveMirrorScene, createMechanicsScene } from '@physicsos/physics-scene'
import { QuestionCodeControls } from '../src/client/experiments/QuestionCodeControls.tsx'
import { createExperimentSession, type ExperimentSession } from '../src/client/experiments/experiment-session.ts'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'
import { createOpticsWorkspaceRuntime } from '../src/client/physics/optics-workspace-runtime.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const sceneSha = (scene: unknown) => {
  const json = JSON.stringify(scene)
  if (json === undefined) throw new Error('Missing scene for SHA-256')
  return createHash('sha256').update(json).digest('hex')
}

function inclineSession(sourceQuestionId?: string) {
  return createExperimentSession(createMechanicsWorkspaceRuntime(createMechanicsScene({
    ...(sourceQuestionId === undefined ? {} : { sourceQuestionId }),
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
  fireEvent.click(view.getByText('显示内容'))
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
  const session = inclineSession('question-code-controls-incline')
  const origin = session.runtime.getScene?.()
  if (origin === undefined) throw new Error('Missing original question scene')
  const originalSha = sceneSha(origin), originalSnapshot = session.getSnapshot()
  const view = render(<LiveControls session={session} compact />)
  const more = view.getByText('更多控制').closest('details')
  if (more === null) throw new Error('Missing more-controls disclosure')
  expect(more.open).toBe(false)
  const editors = view.getAllByRole('spinbutton').filter(input => !more.contains(input))
  expect(editors).toHaveLength(2)
  const preview = vi.spyOn(session, 'previewParameter'), commit = vi.spyOn(session, 'commitParameter')
  const slider = view.getByRole('slider', { name: '调节倾角' }) as HTMLInputElement
  const initial = slider.value, value = String(Number(initial) + 1)
  fireEvent.change(slider, { target: { value } })
  expect(preview).toHaveBeenCalledWith('angle', Number(value))
  expect(commit).not.toHaveBeenCalled()
  expect(sceneSha(session.runtime.getScene?.())).toBe(originalSha)
  fireEvent.pointerUp(slider)
  expect(commit).toHaveBeenLastCalledWith('angle', Number(value))
  expect(session.getSnapshot().branch?.canRestore).toBe(true)
  fireEvent.click(view.getByRole('button', { name: '恢复原题' }))
  expect(sceneSha(session.runtime.getScene?.())).toBe(originalSha)
  preview.mockClear(); commit.mockClear()

  const input = view.getByRole('spinbutton', { name: '质量 (kg)' }) as HTMLInputElement
  const original = input.value, edited = String(Number(original) + 1)
  fireEvent.change(input, { target: { value: edited } })
  expect(input.value).toBe(edited)
  expect(preview).not.toHaveBeenCalled()
  expect(commit).not.toHaveBeenCalled()
  expect(sceneSha(session.runtime.getScene?.())).toBe(originalSha)
  fireEvent.blur(input)
  expect(commit).toHaveBeenLastCalledWith('mass', Number(edited))
  expect(session.getSnapshot().sceneRevision).toBe(1)
  expect(session.getSnapshot().branch?.canRestore).toBe(true)
  expect((view.getByRole('button', { name: '恢复原题' }) as HTMLButtonElement).disabled).toBe(false)
  expect(sceneSha(origin)).toBe(originalSha)
  fireEvent.click(view.getByText('更多控制'))
  expect(more.open).toBe(true)
  expect(view.getByRole('spinbutton', { name: '重力加速度 (m/s²)' })).toBeTruthy()
  const display = view.getByText('显示内容').closest('details')
  expect(display?.open).toBe(false)
  fireEvent.click(view.getByText('显示内容'))
  expect(display?.open).toBe(true)
  expect(view.getByRole('checkbox', { name: '合力' })).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '恢复原题' }))
  expect(input.value).toBe(original)
  expect(session.getSnapshot().sceneRevision).toBe(originalSnapshot.sceneRevision)
  expect(session.getSnapshot().view).toEqual(originalSnapshot.view)
  expect(sceneSha(session.runtime.getScene?.())).toBe(originalSha)
  expect((view.getByRole('button', { name: '恢复原题' }) as HTMLButtonElement).disabled).toBe(true)
  view.unmount()
  session.runtime.dispose?.()
})

it('keeps a template draft editable without offering a nonexistent question restore', () => {
  const session = inclineSession(), view = render(<LiveControls session={session} compact />)
  const input = view.getByRole('spinbutton', { name: '质量 (kg)' }) as HTMLInputElement
  const committedSha = sceneSha(session.runtime.getScene?.())
  const commit = vi.spyOn(session, 'commitParameter')
  for (const draft of ['', '-1']) {
    fireEvent.change(input, { target: { value: draft } })
    expect(input.value).toBe(draft)
    fireEvent.blur(input)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(commit).not.toHaveBeenCalled()
    expect(sceneSha(session.runtime.getScene?.())).toBe(committedSha)
  }
  fireEvent.change(input, { target: { value: '3' } })
  expect(input.value).toBe('3')
  expect(commit).not.toHaveBeenCalled()
  expect(sceneSha(session.runtime.getScene?.())).toBe(committedSha)
  fireEvent.blur(input)
  expect(commit).toHaveBeenLastCalledWith('mass', 3)
  expect(session.getSnapshot().sceneRevision).toBe(1)
  expect(session.getSnapshot().branch).toBeUndefined()
  expect((view.getByRole('button', { name: '恢复原题' }) as HTMLButtonElement).disabled).toBe(true)
  view.unmount()
  session.runtime.dispose?.()
})

it('previews, cancels and commits a range through the real optics runtime', () => {
  const session = createExperimentSession(createOpticsWorkspaceRuntime(createConcaveMirrorScene()))
  const originalSha = sceneSha(session.runtime.getScene?.()), originalSnapshot = session.getSnapshot()
  const preview = vi.spyOn(session, 'previewParameter'), commit = vi.spyOn(session, 'commitParameter')
  const view = render(<LiveControls session={session} />)
  const slider = view.getByRole('slider', { name: '调节焦距（>0 凹面镜，<0 凸面镜）' }) as HTMLInputElement
  fireEvent.change(slider, { target: { value: '12' } })
  expect(preview).toHaveBeenLastCalledWith('mirror-focal-length', 12)
  expect(commit).not.toHaveBeenCalled()
  expect(session.isPreviewing()).toBe(true)
  expect(session.getSnapshot().view).not.toEqual(originalSnapshot.view)
  expect(session.getSnapshot().sceneRevision).toBe(originalSnapshot.sceneRevision)
  expect(sceneSha(session.runtime.getScene?.())).toBe(originalSha)
  fireEvent.pointerCancel(slider)
  expect(session.isPreviewing()).toBe(false)
  expect(session.getSnapshot().view).toEqual(originalSnapshot.view)
  expect(slider.value).toBe('10')
  fireEvent.pointerUp(slider)
  expect(commit).not.toHaveBeenCalled()

  fireEvent.change(slider, { target: { value: '12' } })
  fireEvent.blur(slider)
  expect(commit).toHaveBeenLastCalledWith('mirror-focal-length', 12)
  expect(session.isPreviewing()).toBe(false)
  expect(session.getSnapshot().sceneRevision).toBe(1)
  expect(sceneSha(session.runtime.getScene?.())).not.toBe(originalSha)
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
  fireEvent.click(view.getByText('显示内容'))
  expect(view.getByRole('checkbox', { name: '本题合力方向' })).toBeTruthy()
  expect(view.queryByRole('checkbox', { name: '合力' })).toBeNull()
  expect(view.getByRole('checkbox', { name: 'customTrail' })).toBeTruthy()
})
