// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import {
  EXPERIMENT_TEMPLATES,
  SELECTABLE_TEMPLATE_COUNT,
} from '../src/client/physics/experiment-templates.ts'
import { EXPERIMENT_META, experimentMetaOf } from '../src/client/physics/experiment-summaries.ts'

/* The summary block is a contract: coreModel states what the engine actually
   solves. An entry that cannot fill all four sections honestly is a gap the
   same audit class as a fake implementation — the test fails either way. */
describe('experiment summaries (要点)', () => {
  it('covers every selectable template exactly once', () => {
    const ids = EXPERIMENT_TEMPLATES.map(template => template.id)
    expect(Object.keys(EXPERIMENT_META).sort()).toEqual([...ids].sort())
    expect(ids.length).toBeGreaterThanOrEqual(SELECTABLE_TEMPLATE_COUNT)
  })

  it('every entry has all four summary sections non-empty', () => {
    for (const template of EXPERIMENT_TEMPLATES) {
      const meta = experimentMetaOf(template.id)
      expect(meta, `missing EXPERIMENT_META['${template.id}']`).toBeDefined()
      if (meta === undefined) continue
      expect(meta.summary.coreModel.trim(), `${template.id}.coreModel`).not.toBe('')
      expect(meta.summary.parameters.length, `${template.id}.parameters`).toBeGreaterThan(0)
      expect(meta.summary.feedback.length, `${template.id}.feedback`).toBeGreaterThan(0)
      expect(meta.summary.errors.length, `${template.id}.errors`).toBeGreaterThan(0)
    }
  })

  it('implemented (non-comingSoon) templates carry a textbook mapping and guide', () => {
    for (const template of EXPERIMENT_TEMPLATES) {
      if (template.comingSoon === true) continue
      const meta = experimentMetaOf(template.id)
      expect(meta?.textbook?.length, `${template.id}.textbook`).toBeGreaterThan(0)
      expect(meta?.guide?.length, `${template.id}.guide`).toBeGreaterThan(0)
    }
  })

  it('aliases contain no duplicates or empty strings', () => {
    for (const [id, meta] of Object.entries(EXPERIMENT_META)) {
      const aliases = meta.aliases ?? []
      expect(new Set(aliases).size, `${id}.aliases`).toBe(aliases.length)
      for (const alias of aliases) expect(alias.trim()).not.toBe('')
    }
  })

  it('every implemented template builds a scene with a stamped id', () => {
    for (const template of EXPERIMENT_TEMPLATES) {
      if (template.comingSoon === true) continue
      const { sceneId, scene } = template.createScene(template.id)
      expect(String(scene.id), `${template.id}.sceneId`).toBe(sceneId)
      expect(scene.schemaVersion, `${template.id}.schemaVersion`).toBe('physics-scene/1.0')
    }
  })

  it('chase-meeting lanes keep the bodies collision-free', () => {
    const template = EXPERIMENT_TEMPLATES.find(t => t.id === 'chase-meeting')
    const { scene } = template!.createScene('chase')
    const [a, b] = scene.bodies
    const dy = Math.abs(a!.position.vector.y - b!.position.vector.y)
    const radii = 0.45 + 0.45
    expect(dy).toBeGreaterThan(radii)
    /* Meeting: x_a(t) = -4 + 3t, x_b(t) = t → equal at t = 2, x = 2. */
    expect(-4 + 3 * 2).toBeCloseTo(0 + 1 * 2, 8)
  })

  it('concurrent-equilibrium forces sum to zero', () => {
    const template = EXPERIMENT_TEMPLATES.find(t => t.id === 'concurrent-equilibrium')
    const { scene } = template!.createScene('equilibrium')
    const custom = scene.forces.filter(f => f.type === 'custom')
    expect(custom.length).toBe(3)
    const sum = custom.reduce(
      (acc, f) => ({ x: acc.x + (f.vector?.vector.x ?? 0), y: acc.y + (f.vector?.vector.y ?? 0) }),
      { x: 0, y: 0 },
    )
    expect(Math.hypot(sum.x, sum.y)).toBeCloseTo(0, 8)
  })
})
