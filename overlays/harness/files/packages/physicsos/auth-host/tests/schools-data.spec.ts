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
