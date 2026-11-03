import { describe, expect, it } from 'vitest'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { asQuestionId } from '@physicsos/shared'
import { createOpticsWorkspaceRuntime } from '../src/client/physics/optics-workspace-runtime.ts'
import { createExperimentSession } from '../src/client/experiments/experiment-session.ts'

const imageX = (runtime: ReturnType<typeof createOpticsWorkspaceRuntime>) => runtime.getSnapshot().view.opticalImages?.[0]?.at.x

describe('transactional optics controls', () => {
  it('previews verified optics without committing a revision, cancels, and commits exactly once', () => {
    const runtime = createOpticsWorkspaceRuntime(createConvexLensScene())
    const scene = runtime.getScene()
    expect(typeof runtime.previewParameter).toBe('function')
    runtime.previewParameter!('object-distance', 15)
    expect(imageX(runtime)).toBeCloseTo(30)
    expect(runtime.getScene()).toEqual(scene)
    expect(runtime.getSnapshot().sceneRevision).toBe(0)
    runtime.cancelParameterPreview!()
    expect(imageX(runtime)).toBeCloseTo(15)
    runtime.previewParameter!('object-distance', 20)
    runtime.previewParameter!('object-distance', 15)
    runtime.commitParameter!('object-distance', 15)
    expect(runtime.getScene().revision).toBe(1)
    expect(imageX(runtime)).toBeCloseTo(30)
  })

  it('does not fork a question until release and refuses non-finite preview values', () => {
    const scene = createConvexLensScene()
    scene.metadata.sourceQuestionId = asQuestionId('lens-origin')
    const runtime = createOpticsWorkspaceRuntime(scene)
    expect(typeof runtime.previewParameter).toBe('function')
    runtime.previewParameter!('object-distance', 15)
    expect(runtime.getScene().id).toBe(scene.id)
    runtime.cancelParameterPreview!()
    runtime.previewParameter!('object-distance', Number.NaN)
    expect(imageX(runtime)).toBeCloseTo(15)
    runtime.commitParameter!('object-distance', 15)
    expect(runtime.getScene().id).not.toBe(scene.id)
    expect(runtime.getScene().metadata.lineage?.originSceneId).toBe(scene.id)
    expect(scene.revision).toBe(0)
  })
})

it('persists only committed conditions while both views consume the preview frame', () => {
  const runtime = createOpticsWorkspaceRuntime(createConvexLensScene())
  const saved: unknown[] = []
  const session = createExperimentSession(runtime, scene => saved.push(scene))
  session.previewParameter('object-distance', 15)
  expect(session.frames.get().view.opticalImages?.[0]?.at.x).toBeCloseTo(30)
  expect(saved).toHaveLength(0)
  session.cancelPreview()
  expect(session.frames.get().view.opticalImages?.[0]?.at.x).toBeCloseTo(15)
  session.commitParameter('object-distance', 15)
  expect(saved).toHaveLength(1)
  expect(session.getSnapshot().sceneRevision).toBe(1)
})

it('pins the displayed package in saved scenes and each captured observation', () => {
  const runtime = createOpticsWorkspaceRuntime(createConvexLensScene())
  const session = createExperimentSession(runtime)
  const release = { id: 'pkg_1', experimentId: 'convex-lens', version: '1.0.0', sha256: 'a'.repeat(64) }
  session.setRelease(release)
  session.recordObservation()
  expect(session.getScene()?.metadata.experimentRelease).toEqual(release)
  expect(session.getNotebook()[0]?.experimentRelease).toEqual(release)
  session.setRelease({ ...release, id: 'pkg_2', version: '2.0.0' })
  expect(session.getNotebook()[0]?.experimentRelease?.id).toBe('pkg_1')
})
