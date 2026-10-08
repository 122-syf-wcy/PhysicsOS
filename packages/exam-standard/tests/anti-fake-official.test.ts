import { describe, expect, it } from 'vitest'
import { FAKE_OFFICIAL_ERROR_CODE, checkNotFakeOfficial, paperLabelText } from '../src/index.ts'

describe('anti-fake-official gate', () => {
  it('passes a PhysicsOS simulated paper and returns the mandated label text', () => {
    const result = checkNotFakeOfficial({ id: 'p', label: 'PHYSICSOS_SIMULATED_PAPER' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.displayText).toBe('PhysicsOS 模拟试卷')
  })

  it('passes an unofficial-labelled paper', () => {
    expect(paperLabelText('PHYSICSOS_UNOFFICIAL_PAPER')).toBe('PhysicsOS 非官方试卷')
    expect(checkNotFakeOfficial({ id: 'p', label: 'PHYSICSOS_UNOFFICIAL_PAPER' }).ok).toBe(true)
  })

  it('rejects an artefact labelled as an official paper with the stable code', () => {
    const result = checkNotFakeOfficial({ id: 'p', label: 'OFFICIAL_PAPER_CLAIM' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(FAKE_OFFICIAL_ERROR_CODE)
      expect(result.code).toBe('EXAM_FAKE_OFFICIAL_CLAIM')
    }
  })

  it('rejects attribution to an official issuing body', () => {
    const result = checkNotFakeOfficial({
      id: 'p',
      label: 'PHYSICSOS_SIMULATED_PAPER',
      attributedIssuer: { authority: 'GZ_EXAMINATION_AUTHORITY', name: '贵州省招生考试院' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(FAKE_OFFICIAL_ERROR_CODE)
      expect(result.evidence[0]).toContain('GZ_EXAMINATION_AUTHORITY')
    }
  })

  it('rejects body text claiming official issuance', () => {
    const result = checkNotFakeOfficial({
      id: 'p',
      label: 'PHYSICSOS_SIMULATED_PAPER',
      bodyText: '本卷由贵州省招生考试院命题发布，是官方真题。',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.evidence.length).toBeGreaterThan(0)
  })

  it('does not false-positive on the mandated disclaimer', () => {
    expect(
      checkNotFakeOfficial({
        id: 'p',
        label: 'PHYSICSOS_SIMULATED_PAPER',
        bodyText: 'PhysicsOS 模拟试卷（非官方试卷）· 训练卷',
      }).ok,
    ).toBe(true)
    expect(
      checkNotFakeOfficial({
        id: 'p',
        label: 'PHYSICSOS_UNOFFICIAL_PAPER',
        bodyText: '本卷为非官方模拟题。',
      }).ok,
    ).toBe(true)
  })

  it('does not false-positive on a plain curriculum citation', () => {
    expect(
      checkNotFakeOfficial({
        id: 'p',
        label: 'PHYSICSOS_SIMULATED_PAPER',
        bodyText: '依据《义务教育物理课程标准》编制。',
      }).ok,
    ).toBe(true)
  })
})
