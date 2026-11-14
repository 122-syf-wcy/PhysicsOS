// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { createOpticsWorkspaceRuntime } from '../src/client/physics/optics-workspace-runtime.ts'
import { createExperimentSession } from '../src/client/experiments/experiment-session.ts'
import { contributionSnapshot } from '../src/client/experiments/contribution-protocol.ts'
import { LensControls } from '../src/client/experiments/LensControls.tsx'

afterEach(cleanup)
it('Escape cancels the focused numeric draft without changing engine, revision or persistence; Enter and blur still commit', () => {
  const runtime = createOpticsWorkspaceRuntime(createConvexLensScene())
  const saves: unknown[] = []
  const session = createExperimentSession(runtime, (scene) => saves.push(scene))
  function Controls() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot)
    return (
      <LensControls
        snapshot={snapshot}
        preview={session.previewParameter}
        commit={session.commitParameter}
        cancel={session.cancelPreview}
      />
    )
  }
  render(<Controls />)
  const original = runtime.getScene()
  const input = screen.getByRole('textbox', { name: '物距' })
  input.focus()
  fireEvent.change(input, { target: { value: '20' } })
  fireEvent.keyDown(input, { key: 'Escape' })
  expect((input as HTMLInputElement).value).toBe('30')
  expect(runtime.getScene()).toEqual(original)
  expect(session.getSnapshot().sceneRevision).toBe(0)
  expect(contributionSnapshot(session.getSnapshot()).parameters.objectDistanceCm).toBe(30)
  expect(saves).toHaveLength(0)
  input.focus()
  fireEvent.change(input, { target: { value: '20' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(contributionSnapshot(session.getSnapshot()).parameters.objectDistanceCm).toBe(20)
  expect(runtime.getScene().revision).toBe(1)
  expect(saves).toHaveLength(1)
  input.focus()
  fireEvent.change(input, { target: { value: '15' } })
  fireEvent.blur(input)
  expect(contributionSnapshot(session.getSnapshot()).result.imageDistanceCm).toBeCloseTo(30)
  expect(runtime.getScene().revision).toBe(2)
  expect(saves).toHaveLength(2)
})
