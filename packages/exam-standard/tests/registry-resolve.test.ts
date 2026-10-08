import { describe, expect, it } from 'vitest'
import {
  createExamStandardRegistry,
  examStandardRegistry,
  validatePack,
  type ProfileQuery,
} from '../src/index.ts'
import { FIXTURE_DRAFT_PACK, FIXTURE_GK_PACK, FIXTURE_ZK_PACK, makeFixturePack } from './fixtures.ts'

const zkQuery: ProfileQuery = { jurisdiction: 'CN-TF', stage: 'ZHONGKAO', subject: 'PHYSICS', year: 2026 }
const gkQuery: ProfileQuery = { jurisdiction: 'CN-TF', stage: 'GAOKAO', subject: 'PHYSICS', year: 2026 }

describe('the registry ships with no populated real pack', () => {
  it('is empty and refuses to resolve', () => {
    expect(examStandardRegistry.packs()).toEqual([])
    const resolution = examStandardRegistry.resolve(zkQuery)
    expect(resolution.status).toBe('UNCONFIRMED')
    if (resolution.status === 'UNCONFIRMED') {
      expect(resolution.code).toBe('NO_PACK_REGISTERED')
      expect(resolution.availableYears).toEqual([])
    }
  })
})

describe('profile resolution', () => {
  it('refuses an empty registry explicitly', () => {
    const registry = createExamStandardRegistry()
    expect(registry.resolve(zkQuery).status).toBe('UNCONFIRMED')
  })

  it('refuses a target that has only a draft pack', () => {
    const registry = createExamStandardRegistry([FIXTURE_DRAFT_PACK])
    const yearQuery: ProfileQuery = { ...zkQuery, year: 2027 }
    const resolution = registry.resolve(yearQuery)
    expect(resolution.status).toBe('UNCONFIRMED')
    if (resolution.status === 'UNCONFIRMED') expect(resolution.code).toBe('PACK_NOT_CONFIRMED')
  })

  it('resolves a confirmed pack by (jurisdiction, stage, subject, year)', () => {
    const registry = createExamStandardRegistry([FIXTURE_ZK_PACK])
    const resolution = registry.resolve(zkQuery)
    expect(resolution.status).toBe('CONFIRMED')
    if (resolution.status === 'CONFIRMED') {
      expect(resolution.profile.id).toBe(FIXTURE_ZK_PACK.profile?.id)
      expect(resolution.pack.id).toBe(FIXTURE_ZK_PACK.id)
      expect(resolution.profile.stage).toBe('ZHONGKAO')
    }
  })

  it('keeps 中考 and 高考 entirely separate — a stage never crosses', () => {
    const registry = createExamStandardRegistry([FIXTURE_ZK_PACK, FIXTURE_GK_PACK])
    const zhongkao = registry.resolve(zkQuery)
    const gaokao = registry.resolve(gkQuery)
    expect(zhongkao.status).toBe('CONFIRMED')
    expect(gaokao.status).toBe('CONFIRMED')
    if (zhongkao.status === 'CONFIRMED' && gaokao.status === 'CONFIRMED') {
      expect(zhongkao.profile.stage).toBe('ZHONGKAO')
      expect(gaokao.profile.stage).toBe('GAOKAO')
      expect(zhongkao.profile.id).not.toBe(gaokao.profile.id)
      expect(zhongkao.profile.paperBlueprint.totalScore).not.toBe(
        gaokao.profile.paperBlueprint.totalScore,
      )
    }
  })

  it('reports no pack for a target that has none (stage separation)', () => {
    const registry = createExamStandardRegistry([FIXTURE_ZK_PACK])
    const resolution = registry.resolve(gkQuery)
    expect(resolution.status).toBe('UNCONFIRMED')
    if (resolution.status === 'UNCONFIRMED') expect(resolution.code).toBe('NO_PACK_FOR_TARGET')
  })

  it('reports a missing year with the years that do exist', () => {
    const registry = createExamStandardRegistry([FIXTURE_ZK_PACK])
    const resolution = registry.resolve({ ...zkQuery, year: 2025 })
    expect(resolution.status).toBe('UNCONFIRMED')
    if (resolution.status === 'UNCONFIRMED') {
      expect(resolution.code).toBe('YEAR_NOT_AVAILABLE')
      expect(resolution.availableYears).toEqual([2026])
    }
  })

  it('refuses ambiguity rather than ordering silently', () => {
    const second = makeFixturePack({ id: 'TEST-FIXTURE-PACK-ZK-2026-B', stage: 'ZHONGKAO', year: 2026 })
    const registry = createExamStandardRegistry([FIXTURE_ZK_PACK, second])
    const resolution = registry.resolve(zkQuery)
    expect(resolution.status).toBe('UNCONFIRMED')
    if (resolution.status === 'UNCONFIRMED') expect(resolution.code).toBe('AMBIGUOUS_PACK')
  })

  it('refuses an invalid query', () => {
    const registry = createExamStandardRegistry([FIXTURE_ZK_PACK])
    const resolution = registry.resolve({ ...zkQuery, year: 2026.5 })
    expect(resolution.status).toBe('UNCONFIRMED')
    if (resolution.status === 'UNCONFIRMED') expect(resolution.code).toBe('INVALID_QUERY')
  })
})

describe('pack validation — the trust boundary', () => {
  it('accepts a well-formed confirmed pack', () => {
    expect(validatePack(FIXTURE_ZK_PACK).ok).toBe(true)
  })

  it('refuses a confirmed pack with no profile', () => {
    const result = validatePack({ ...FIXTURE_ZK_PACK, profile: null })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((item) => item.message.includes('必须包含档案'))).toBe(true)
  })

  it('refuses a pack whose profile target disagrees', () => {
    expect(validatePack({ ...FIXTURE_ZK_PACK, jurisdiction: 'CN-OTHER' }).ok).toBe(false)
  })

  it('refuses malformed input and does not register it', () => {
    const registry = createExamStandardRegistry()
    const result = registry.register({ id: 'x' })
    expect(result.ok).toBe(false)
    expect(registry.packs()).toEqual([])
  })

  it('throws loudly on an invalid seed rather than ignoring it', () => {
    expect(() => createExamStandardRegistry([{ id: 'x' }])).toThrow()
  })
})
