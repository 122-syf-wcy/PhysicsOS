import { describe, expect, it } from 'vitest'
import {
  createExamStandardRegistry,
  planPaper,
  type ConfirmedPack,
  type ExamStandardRegistry,
  type ProfileQuery,
} from '../src/index.ts'
import { FIXTURE_BLUEPRINT, FIXTURE_GK_PACK, FIXTURE_ZK_PACK, FIXTURE_ZK_PROFILE } from './fixtures.ts'

const zkQuery: ProfileQuery = { jurisdiction: 'CN-TF', stage: 'ZHONGKAO', subject: 'PHYSICS', year: 2026 }
const gkQuery: ProfileQuery = { jurisdiction: 'CN-TF', stage: 'GAOKAO', subject: 'PHYSICS', year: 2026 }

describe('paper planning', () => {
  it('refuses to plan against an empty registry', () => {
    const registry = createExamStandardRegistry()
    const result = planPaper(registry, zkQuery)
    expect(result.status).toBe('REFUSED')
    if (result.status === 'REFUSED') expect(result.code).toBe('NO_PACK_REGISTERED')
  })

  it('plans from the profile blueprint, with the non-official label', () => {
    const registry = createExamStandardRegistry([FIXTURE_ZK_PACK])
    const result = planPaper(registry, zkQuery)
    expect(result.status).toBe('READY')
    if (result.status === 'READY') {
      const { plan } = result
      expect(plan.totalScore).toBe(FIXTURE_BLUEPRINT.totalScore)
      expect(plan.durationMinutes).toBe(FIXTURE_BLUEPRINT.durationMinutes)
      expect(plan.questionCount).toBe(4)
      expect(plan.sections).toHaveLength(2)
      expect(plan.sections.map((section) => section.totalScore)).toEqual([10, 30])
      expect(plan.target.stage).toBe('ZHONGKAO')
      expect(plan.label).toBe('PHYSICSOS_SIMULATED_PAPER')
      expect(plan.labelText).toBe('PhysicsOS 模拟试卷')
    }
  })

  it('derives a different shape from a different pack — nothing is hardcoded', () => {
    const registry = createExamStandardRegistry([FIXTURE_GK_PACK])
    const result = planPaper(registry, gkQuery)
    expect(result.status).toBe('READY')
    if (result.status === 'READY') {
      expect(result.plan.totalScore).toBe(60)
      expect(result.plan.questionCount).toBe(3)
      expect(result.plan.sections).toHaveLength(1)
      expect(result.plan.target.stage).toBe('GAOKAO')
    }
  })

  it('refuses a target whose year has no pack', () => {
    const registry = createExamStandardRegistry([FIXTURE_ZK_PACK])
    const result = planPaper(registry, { ...zkQuery, year: 2025 })
    expect(result.status).toBe('REFUSED')
    if (result.status === 'REFUSED') expect(result.code).toBe('YEAR_NOT_AVAILABLE')
  })

  it('refuses when the active profile is incomplete rather than inventing a structure', () => {
    const incompleteProfile = {
      ...FIXTURE_ZK_PROFILE,
      paperBlueprint: { ...FIXTURE_BLUEPRINT, totalScore: 999 },
    }
    const fakePack: ConfirmedPack = { ...FIXTURE_ZK_PACK, profile: incompleteProfile }
    const fakeRegistry: ExamStandardRegistry = {
      register: () => ({ ok: true, value: fakePack }),
      packs: () => [fakePack],
      resolve: (_query) => ({ status: 'CONFIRMED', pack: fakePack, profile: incompleteProfile }),
    }
    const result = planPaper(fakeRegistry, zkQuery)
    expect(result.status).toBe('REFUSED')
    if (result.status === 'REFUSED') {
      expect(result.code).toBe('PROFILE_INVALID')
      expect(result.reason).toContain('分卷分值合计与总分不一致')
    }
  })
})
