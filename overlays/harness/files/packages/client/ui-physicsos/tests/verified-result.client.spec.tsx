// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { VerificationBadge, VerifiedResult } from '../src/client/VerifiedResult.tsx'
import {
  toVerifiedResult, type VerificationLevel,
} from '../src/client/physics/verified-result.ts'
import { zh } from '../src/client/locales.ts'
import type { VerificationCheckView } from '../src/client/physics/scene-visual-model.ts'

afterEach(cleanup)

/** The real locale table with `{name}` interpolation, like the slot `t`. */
const t = (key: string, params?: Record<string, unknown>): string => {
  const raw = (zh as Record<string, string>)[key] ?? key
  if (params === undefined) return raw
  return raw.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name]
    if (typeof value === 'number') return String(value)
    return typeof value === 'string' ? value : ''
  })
}

/** Two physical-law checks (never the structural preconditions the list folds). */
const checks: readonly VerificationCheckView[] = [
  { id: 'lorentz_force_vector_consistency', label: 'F = qv×B 矢量一致', status: 'passed' },
  { id: 'speed_conservation', label: '速率守恒（洛伦兹力不做功）', status: 'passed' },
]

const badgeOf = (container: HTMLElement): Element => {
  const badge = container.querySelector('[data-verification-badge]')
  if (badge === null) throw new Error('verification badge missing')
  return badge
}

describe('verified-result seam', () => {
  it('names a level only from the engine status, never from the numbers', () => {
    /* No verification fact at all is the honest default — a number on screen
       is not evidence that the engine checked it. */
    expect(toVerifiedResult({}).level).toBe('unverified')
    expect(toVerifiedResult({ value: '0.156', unit: 'm' }).level).toBe('unverified')
    expect(toVerifiedResult({ status: 'passed' }).level).toBe('physics-verified')
    expect(toVerifiedResult({ status: 'passed_with_warnings' }).level).toBe('physics-verified')
    /* The engine checked and REJECTED ⇒ never promoted to a ✓ level. */
    expect(toVerifiedResult({ status: 'failed' }).level).toBe('unverified')
    /* An unknown status is not guessed at; the canonical DTO adds the cases. */
    expect(toVerifiedResult({ status: 'strongly_verified' }).level).toBe('unverified')
  })

  it('never names a verifier for an unverified result', () => {
    const unverified = toVerifiedResult({
      domain: 'mechanics', value: '20.00', unit: 'm/s', checks, revision: 0,
    })
    expect(unverified.level).toBe('unverified')
    expect(unverified.engine).toBeNull()
    /* The value and revision are still facts, so they survive. */
    expect(unverified.value).toBe('20.00')
    expect(unverified.revision).toBe(0)

    const verified = toVerifiedResult({
      status: 'passed', domain: 'mechanics', value: '20.00', unit: 'm/s', checks, revision: 0,
    })
    expect(verified.engine).toBe('mechanics')
    expect(verified.checks).toBe(checks)
  })
})

describe('verified result block', () => {
  it('renders the verified state with value, unit, verifier, checks and revision', () => {
    const view = toVerifiedResult({
      status: 'passed', domain: 'magnetic', value: '0.156', unit: 'm', checks, revision: 42,
    })
    const view2 = render(<VerifiedResult view={view} t={t} />)

    const value = view2.container.querySelector('[data-verified-value]')
    expect(value?.textContent).toContain('0.156')
    expect(value?.textContent).toContain('m')

    const badge = badgeOf(view2.container)
    expect(badge.textContent).toBe('物理已验证')
    expect(badge.getAttribute('data-level')).toBe('physics-verified')

    expect(view2.getByText('由磁场引擎验证')).toBeTruthy()
    expect(view2.getByText('验证项')).toBeTruthy()
    expect(view2.getByText('F = qv×B 矢量一致')).toBeTruthy()
    expect(view2.getByText('速率守恒（洛伦兹力不做功）')).toBeTruthy()
    expect(view2.getByText('场景 修订 #42')).toBeTruthy()
  })

  it('renders the unverified state — with no verified badge — when provenance is missing', () => {
    /* A formatted answer and a domain are NOT provenance: the block must stay
       honest and warn instead of drawing a check. */
    const view = toVerifiedResult({ value: '0.156', unit: 'm', domain: 'magnetic', revision: 7 })
    const rendered = render(<VerifiedResult view={view} t={t} />)

    const badge = badgeOf(rendered.container)
    expect(badge.textContent).toBe('未验证')
    expect(badge.getAttribute('data-level')).toBe('unverified')
    expect(rendered.container.querySelector('[data-verification-level="unverified"]')).not.toBeNull()

    /* Not one word of the block claims a verification, and no verifier is named. */
    expect(rendered.container.textContent).not.toContain('物理已验证')
    expect(rendered.container.textContent).not.toContain('多重验证')
    expect(rendered.container.textContent).not.toContain('由磁场引擎验证')
    /* The scene revision is still a fact worth stating. */
    expect(rendered.getByText('场景 修订 #7')).toBeTruthy()
  })

  it('renders all four levels as text, with a decorative glyph', () => {
    const levels: readonly (readonly [VerificationLevel, string])[] = [
      ['unverified', '未验证'],
      ['engine-computed', '引擎已计算'],
      ['physics-verified', '物理已验证'],
      ['strongly-verified', '多重验证'],
    ]
    for (const [level, label] of levels) {
      const rendered = render(<VerificationBadge level={level} t={t} />)
      const badge = badgeOf(rendered.container)
      /* The state is the label, so it never depends on colour alone. */
      expect(badge.textContent).toBe(label)
      expect(badge.getAttribute('data-level')).toBe(level)
      /* The glyph is decorative: aria-hidden, so AT reads the label only. */
      expect(badge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
      rendered.unmount()
    }
  })

  it('gives the strongest level its own glyph, not the single-check shield', () => {
    const physics = render(<VerificationBadge level="physics-verified" t={t} />)
    const strong = render(<VerificationBadge level="strongly-verified" t={t} />)
    expect(strong.container.querySelector('svg')?.innerHTML)
      .not.toBe(physics.container.querySelector('svg')?.innerHTML)
  })

  it('backs each check row with text, not just a mark', () => {
    const view = toVerifiedResult({
      status: 'passed', domain: 'magnetic', value: '0.156', unit: 'm', checks, revision: 1,
    })
    const rendered = render(<VerifiedResult view={view} t={t} />)
    const rows = rendered.getAllByRole('listitem')
    expect(rows.length).toBe(checks.length)
    for (const row of rows) expect(row.textContent).toContain('通过')
  })

  it('states the missing detail instead of inventing checks', () => {
    const view = toVerifiedResult({ status: 'passed', domain: 'mechanics' })
    const rendered = render(<VerifiedResult view={view} t={t} />)
    expect(rendered.getByText('暂无引擎验证明细')).toBeTruthy()
  })
})
