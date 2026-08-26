// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMechanicsScene, type PhysicsScene } from '@physicsos/physics-scene'

import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'
import { zh } from '../src/client/locales.ts'

const translations: Readonly<Record<string, string>> = zh
const t: PhysicsSurfaceProps['t'] = key => translations[key] ?? key
const neverHook = (() => {
  throw new Error('unused hook')
}) as never

afterEach(cleanup)

/** A projectile scene that came from a question, at a non-zero revision. */
const questionScene = (): PhysicsScene => {
  const scene = createMechanicsScene({
    sceneId: 'scene-question-001',
    model: 'projectile_motion',
    mass: 1,
    position: { x: 0, y: 20, z: 0 },
    velocity: { x: 10, y: 0, z: 0 },
    gravity: { x: 0, y: -10, z: 0 },
    groundY: 0,
    title: '平抛运动',
    now: '2026-01-01T00:00:00.000Z',
  })
  return {
    ...scene,
    revision: 4,
    /* `@physicsos/shared` is only a transitive dependency here, so the branded id
       is cast rather than imported. */
    metadata: {
      ...scene.metadata,
      sourceQuestionId: 'golden-mech-02' as NonNullable<PhysicsScene['metadata']['sourceQuestionId']>,
    },
  }
}

describe('experimental branch', () => {
  it('does not fork for looking: playback, seek and observable toggles', () => {
    const origin = questionScene()
    const runtime = createMechanicsWorkspaceRuntime(origin)

    runtime.setRunning(true)
    runtime.advance(0.2)
    runtime.seek(0.5)
    const afterLooking = runtime.setObservable('components', true)

    /* An observable toggle IS a scene command and advances the revision, but it
       changes what is shown rather than what is true, so the question keeps its
       own identity. */
    expect(afterLooking.branch).toBeUndefined()
    expect(origin.bodies[0]?.position.vector.y).toBe(20)
  })

  it('forks on the first physics-fact edit and leaves the question intact', () => {
    const origin = questionScene()
    const runtime = createMechanicsWorkspaceRuntime(origin)
    const before = runtime.getSnapshot()
    expect(before.branch).toBeUndefined()
    expect(before.sceneRevision).toBe(4)

    const after = runtime.editParameter('height', 30)

    expect(after.branch).toEqual({
      originQuestionTitle: '平抛运动',
      parentRevision: 4,
      canRestore: true,
    })
    /* The branch is a new world: revision restarts, and the question's scene is
       byte-for-byte what the solution was verified against. */
    expect(after.sceneRevision).toBe(1)
    expect(origin.bodies[0]?.position.vector.y).toBe(20)
    expect(origin.revision).toBe(4)
    /* The edit really landed in the branch. */
    const height = after.inspector
      .flatMap(section => section.parameters ?? [])
      .find(parameter => parameter.id === 'height')
    expect(height?.value).toBe(30)
  })

  it('restores the stated conditions and drops the branch', () => {
    const runtime = createMechanicsWorkspaceRuntime(questionScene())
    runtime.editParameter('height', 30)
    const restored = runtime.restoreOrigin()

    expect(restored.branch).toBeUndefined()
    expect(restored.sceneRevision).toBe(4)
    const height = restored.inspector
      .flatMap(section => section.parameters ?? [])
      .find(parameter => parameter.id === 'height')
    expect(height?.value).toBe(20)
  })

  it('never forks a template scene, which has no stated facts to protect', () => {
    const runtime = createMechanicsWorkspaceRuntime(
      createMechanicsScene({ model: 'inclined_plane', inclineAngle: 30, mass: 2 }),
    )
    const after = runtime.editParameter('angle', 45)
    expect(after.branch).toBeUndefined()
    /* A template edit advances its own revision in place. */
    expect(after.sceneRevision).toBe(1)
  })

  it('shows branch provenance and a way back in the Lab toolbar', () => {
    const surface = createPhysicsSurfaceController()
    const origin = questionScene()
    surface.open('lab', { sceneId: String(origin.id), scene: origin })
    const { container } = render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )

    expect(container.querySelector('[data-physicsos-branch="experimental"]')).toBeNull()

    const height = screen.getByRole('textbox', { name: '初始高度' })
    fireEvent.change(height, { target: { value: '30' } })
    fireEvent.blur(height)

    expect(container.querySelector('[data-physicsos-branch="experimental"]')).toBeTruthy()
    expect(screen.getByText('实验分支')).toBeTruthy()
    /* The badge names the source question; the toolbar title carries the same
       words, so match inside the badge rather than the whole document. */
    expect(
      container.querySelector('[data-physicsos-branch="experimental"]')?.textContent,
    ).toContain('平抛运动')

    fireEvent.click(screen.getByRole('button', { name: '恢复原题条件' }))
    expect(container.querySelector('[data-physicsos-branch="experimental"]')).toBeNull()
    expect(
      container.querySelector('[data-physicsos-surface="lab"]')?.getAttribute('data-scene-revision'),
    ).toBe('4')
  })
})
