import { describe, expect, it } from 'vitest'

import { createPhysicsSurfaceController, PHYSICS_PANEL_IDS } from '../src/client/surface-store.ts'
import {
  createExperimentSceneRef, findExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'

const sceneRefOf = (id: string, title: string) => {
  const template = findExperimentTemplate(id)
  if (template === undefined) throw new Error(`no experiment template named ${id}`)
  return createExperimentSceneRef(template, title)
}

describe('what 最近空间 remembers', () => {
  it('keeps the agent’s own visits out of the list', () => {
    const surface = createPhysicsSurfaceController()
    const ref = sceneRefOf('projectile-oblique', '斜抛运动')
    surface.openTransient('lab', ref)
    /* The Lab still shows it… */
    expect(surface.store.getSnapshot().surface).toBe('lab')
    expect(surface.store.getSnapshot().sceneRef?.sceneId).toBe(ref.sceneId)
    /* …but a working view is not an artifact the reader restores. */
    expect(surface.recent.getSnapshot().items).toEqual([])
  })

  it('remembers the world a turn’s answer belongs to, exactly once', () => {
    const surface = createPhysicsSurfaceController()
    const ref = sceneRefOf('projectile-oblique', '斜抛运动')
    surface.remember(ref)
    surface.remember(ref)
    expect(surface.recent.getSnapshot().items.map(entry => entry.sceneId)).toEqual([ref.sceneId])
  })

  it('still records a scene the reader opens themselves', () => {
    const surface = createPhysicsSurfaceController()
    const ref = sceneRefOf('projectile-oblique', '斜抛运动')
    surface.open('lab', ref)
    expect(surface.recent.getSnapshot().items.map(entry => entry.sceneId)).toEqual([ref.sceneId])
  })
})


it('keeps transient handovers and shell panel adoption separate from persisted edits', () => {
  const selected: string[] = []
  const surface = createPhysicsSurfaceController(undefined, undefined, {
    selectSurface: (id) => { selected.push(id) },
  })
  const ref = sceneRefOf('uniform-acceleration', '匀变速运动')
  surface.openTransient('lab', ref)
  const firstGeneration = surface.store.getSnapshot().sceneGeneration
  const next = { ...ref, scene: { ...ref.scene, revision: ref.scene.revision + 1 } }
  surface.openTransient('lab', next)
  expect(surface.store.getSnapshot().sceneGeneration).not.toBe(firstGeneration)
  expect(surface.recent.getSnapshot().items).toEqual([])
  surface.remember(next)
  expect(surface.recent.getSnapshot().items[0]?.scene.revision).toBe(next.scene.revision)

  surface.openBuilder(ref)
  const buildGeneration = surface.store.getSnapshot().sceneGeneration
  const edited = { ...ref.scene, revision: ref.scene.revision + 1 }
  surface.updateScene(edited)
  surface.openExperimentPicker()
  surface.adoptPanel(PHYSICS_PANEL_IDS.library)
  surface.adoptPanel(PHYSICS_PANEL_IDS.lab)
  const resumed = surface.store.getSnapshot()
  expect(resumed.sceneGeneration).toBe(buildGeneration)
  expect(resumed.sceneRef?.scene).toEqual(edited)
  expect(resumed.buildMode).toBe(true)
  expect(resumed.experimentPicker).toBe(true)
  expect(selected).toEqual(['lab', 'lab', 'lab', 'lab'])
})
