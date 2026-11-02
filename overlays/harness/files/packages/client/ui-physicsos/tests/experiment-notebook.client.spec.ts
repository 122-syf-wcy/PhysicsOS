import { expect, it } from 'vitest'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { createOpticsWorkspaceRuntime } from '../src/client/physics/optics-workspace-runtime.ts'
import { createExperimentSession } from '../src/client/experiments/experiment-session.ts'
import { readNotebook, notebookTable } from '../src/client/experiments/experiment-notebook.ts'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { tableToCsv } from '../src/client/physics/export-csv.ts'

it('records immutable engine readings, persists without changing physics, and survives edits and reload', () => {
  const surface = createPhysicsSurfaceController()
  const scene = createConvexLensScene()
  surface.open('lab', { sceneId: String(scene.id), scene })
  const runtime = createOpticsWorkspaceRuntime(scene)
  const session = createExperimentSession(runtime, surface.updateScene)
  session.recordObservation()
  expect(session.getSnapshot().sceneRevision).toBe(0)
  const first = readNotebook(surface.store.getSnapshot().sceneRef?.scene)
  expect(first).toHaveLength(1)
  expect(notebookTable(first).rows[0]?.values).toContain('15')
  session.commitParameter('object-distance', 15)
  session.recordObservation()
  const saved = surface.store.getSnapshot().sceneRef!.scene
  expect(readNotebook(saved)).toHaveLength(2)
  const reopened = createExperimentSession(createOpticsWorkspaceRuntime(saved))
  expect(notebookTable(reopened.getNotebook()).rows.map(row => row.values)).toEqual(notebookTable(readNotebook(saved)).rows.map(row => row.values))
  const csv = tableToCsv(notebookTable(readNotebook(saved)))
  expect(csv).toContain('"30","15"')
  expect(csv).toContain('"15","30"')
  expect(first[0]?.sceneRevision).toBe(0)
})

it('ignores malformed persisted notebooks and never records an uncommitted preview', () => {
  const scene = createConvexLensScene()
  expect(readNotebook({...scene, metadata:{...scene.metadata, experimentNotebook:{version:99,entries:[]}}} as never)).toEqual([])
  const session = createExperimentSession(createOpticsWorkspaceRuntime(scene))
  session.previewParameter('object-distance', 15)
  session.recordObservation()
  expect(session.getNotebook()).toHaveLength(0)
  session.cancelPreview()
  session.recordObservation()
  expect(session.getNotebook()).toHaveLength(1)
})
