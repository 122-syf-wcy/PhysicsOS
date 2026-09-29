import { describe, expect, it } from 'vitest'

import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
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
