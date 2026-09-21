/**
 * Roster integrity spec for {@link GUIZHOU_SCHOOLS}: the register flow treats
 * this list as the fixed tenant universe, so a malformed row (blank name,
 * unknown prefecture, duplicate spelling) would surface as a real user's
 * failed registration or a forked tenant. Asserts uniqueness, prefecture
 * labels, and deterministic seed-id stability.
 */
import { describe, expect, it } from 'vitest'
import { GUIZHOU_SCHOOLS } from '../src/schools-data.ts'
import { rosterSchoolId, SEED_SCHOOLS, OPEN_SCHOOL_ID } from '../src/schools.ts'

const PREFECTURES = new Set([
  '贵阳市', '遵义市', '六盘水市', '安顺市', '毕节市', '铜仁市',
  '黔西南州', '黔东南州', '黔南州',
])

describe('GUIZHOU_SCHOOLS roster integrity', () => {
  it('covers all nine prefectures with a realistic volume', () => {
    expect(GUIZHOU_SCHOOLS.length).toBeGreaterThan(1500)
    const cities = new Set(GUIZHOU_SCHOOLS.map(s => s.city))
    for (const city of PREFECTURES) expect(cities.has(city)).toBe(true)
  })

  it('has no blank or duplicated names — duplicates would fork tenants', () => {
    const names = new Set<string>()
    for (const school of GUIZHOU_SCHOOLS) {
      expect(school.name.trim().length).toBeGreaterThanOrEqual(4)
      expect(names.has(school.name)).toBe(false)
      names.add(school.name)
    }
  })

  it('labels every row with a known prefecture', () => {
    for (const school of GUIZHOU_SCHOOLS) {
      expect(PREFECTURES.has(school.city), school.name).toBe(true)
      if (school.county !== undefined) expect(school.county.trim().length).toBeGreaterThan(0)
    }
  })

  it('contains no non-secondary institutions', () => {
    for (const school of GUIZHOU_SCHOOLS) {
      expect(school.name).not.toMatch(/幼儿园|小学|大学$|学院$|培训|教育科技|公司$/)
    }
  })

  /* The 2026-09-21 additions were each verified against an official roster page
     (URLs recorded inline in the data file). They are the only rows whose
     provenance is traceable, so pin them: a future regeneration from the
     out-of-repo source TSV would otherwise drop them silently and shrink the
     high-school side back to what the 义务教育 statistics happened to cover. */
  it('keeps the verified high-school additions', () => {
    const names = new Set(GUIZHOU_SCHOOLS.map(s => s.name))
    for (const name of [
      '镇远县文德民族中学校', '贵州省镇远中学校',
      '兴义市兴铭高中', '兴义笔山中学', '望谟民族中学', '黔西南州赛文高级中学',
    ]) {
      expect(names.has(name), name).toBe(true)
    }
  })

  it('carries a senior-high cohort, not only 义务教育 rows', () => {
    /* 黔西南州 was compiled from a 义务教育 statistics table, so its rows were
       almost entirely town-level middle schools; these additions are what give
       the prefecture any senior-high tenants at all. */
    const seniorHigh = GUIZHOU_SCHOOLS.filter(s => /高级中学|高中|第[一二三四五六七八九十]+中学/.test(s.name))
    expect(seniorHigh.length).toBeGreaterThan(200)
    const qianxinanSenior = seniorHigh.filter(s => s.city === '黔西南州')
    expect(qianxinanSenior.length).toBeGreaterThanOrEqual(13)
  })
})

describe('rosterSchoolId', () => {
  it('is deterministic and unique across the roster', () => {
    const ids = new Set(GUIZHOU_SCHOOLS.map(s => rosterSchoolId(s.name)))
    expect(ids.size).toBe(GUIZHOU_SCHOOLS.length)
    expect(rosterSchoolId(GUIZHOU_SCHOOLS[0]!.name)).toBe(rosterSchoolId(GUIZHOU_SCHOOLS[0]!.name))
  })

  it('matches the schoolId wire alphabet and length bound', () => {
    for (const school of GUIZHOU_SCHOOLS) {
      expect(rosterSchoolId(school.name)).toMatch(/^[A-Za-z0-9_-]{2,32}$/)
    }
  })
})

describe('SEED_SCHOOLS', () => {
  it('keeps the ops tenant first, then one row per roster entry', () => {
    expect(SEED_SCHOOLS[0]!.id).toBe(OPEN_SCHOOL_ID)
    expect(SEED_SCHOOLS.length).toBe(GUIZHOU_SCHOOLS.length + 1)
    const ids = new Set(SEED_SCHOOLS.map(s => s.id))
    expect(ids.size).toBe(SEED_SCHOOLS.length)
  })

  it('carries roster region labels onto the tenant rows', () => {
    const withCounty = GUIZHOU_SCHOOLS.find(s => s.county !== undefined)!
    const row = SEED_SCHOOLS.find(s => s.name === withCounty.name)
    expect(row).toMatchObject({ city: withCounty.city, county: withCounty.county, status: 'active' })
  })
})
