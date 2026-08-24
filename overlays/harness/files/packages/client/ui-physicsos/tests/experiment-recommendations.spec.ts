import { describe, expect, it } from 'vitest'
import { knowledgeNodeOf } from '@physicsos/question-core'

import {
  CLASSIC_EXPERIMENT_IDS,
  KNOWLEDGE_EXPERIMENT,
  recommendExperiments,
} from '../src/client/physics/experiment-recommendations.ts'
import { findExperimentTemplate } from '../src/client/physics/experiment-templates.ts'

const wrong = (...knowledge: string[]) => ({ correct: false, knowledge })
const right = (...knowledge: string[]) => ({ correct: true, knowledge })

describe('recommendExperiments', () => {
  it('recommends the classic set, in 力→电→磁 domain order, on an empty record', () => {
    const picks = recommendExperiments({ attempts: [] })
    expect(picks.map(pick => pick.template.id))
      .toEqual(['projectile-horizontal', 'parallel-plate', 'magnetic-circular'])
    expect(picks.every(pick => pick.reason === 'classic')).toBe(true)
    expect(picks.every(pick => pick.nodeId === undefined)).toBe(true)
  })

  it('puts the most-missed knowledge first and dedups nodes sharing a template', () => {
    const picks = recommendExperiments({
      attempts: [wrong('em-velocity-selector'), wrong('em-lorentz', 'em-circular'), wrong('em-lorentz')],
    })
    /* em-lorentz missed twice → its experiment leads; em-circular maps to the
       SAME template and must not produce a duplicate card. */
    expect(picks[0]).toMatchObject({ reason: 'weakness', nodeId: 'em-lorentz' })
    expect(picks[0]!.template.id).toBe('magnetic-circular')
    expect(picks[1]).toMatchObject({ reason: 'weakness', nodeId: 'em-velocity-selector' })
    expect(picks[1]!.template.id).toBe('velocity-selector')
    expect(picks[2]!.reason).toBe('classic')
    expect(new Set(picks.map(pick => pick.template.id)).size).toBe(3)
  })

  it('never treats a fully-correct node as a weakness', () => {
    const picks = recommendExperiments({ attempts: [right('em-lorentz'), right('em-lorentz')] })
    expect(picks.every(pick => pick.reason === 'classic')).toBe(true)
  })

  it('classic fill skips excluded recently-used ids; weakness ignores the exclusion', () => {
    const picks = recommendExperiments({
      attempts: [wrong('em-mass-spectrometer')],
      excludeClassicIds: ['projectile-horizontal', 'mass-spectrometer'],
    })
    /* Targeted re-practice beats recency: the weak template stays even though
       it is excluded from the discovery fill. */
    expect(picks[0]!.template.id).toBe('mass-spectrometer')
    expect(picks[0]!.reason).toBe('weakness')
    expect(picks.map(pick => pick.template.id)).not.toContain('projectile-horizontal')
    expect(picks).toHaveLength(3)
  })

  it('respects the limit', () => {
    expect(recommendExperiments({ attempts: [], limit: 2 })).toHaveLength(2)
    expect(recommendExperiments({ attempts: [], limit: 0 })).toHaveLength(0)
  })

  it('drops knowledge with no experiment mapping instead of guessing one', () => {
    const picks = recommendExperiments({ attempts: [wrong('method-units')] })
    expect(picks.every(pick => pick.reason === 'classic')).toBe(true)
  })

  it('maps every table entry to a declared node and a creatable template', () => {
    for (const [nodeId, templateId] of Object.entries(KNOWLEDGE_EXPERIMENT)) {
      expect(knowledgeNodeOf(nodeId), `node ${nodeId} must exist`).toBeDefined()
      const template = findExperimentTemplate(templateId)
      expect(template, `template ${templateId} must exist`).toBeDefined()
      expect(template!.comingSoon, `template ${templateId} must be creatable`).toBeUndefined()
    }
    for (const id of CLASSIC_EXPERIMENT_IDS) {
      const template = findExperimentTemplate(id)
      expect(template, `classic ${id} must exist`).toBeDefined()
      expect(template!.comingSoon).toBeUndefined()
    }
  })
})
