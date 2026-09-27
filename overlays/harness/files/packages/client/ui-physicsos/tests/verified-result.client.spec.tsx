// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deriveVerificationLevel, toVerificationEvidence,
  type QuantityProvenance, type VerificationCheck, type VerificationResult,
} from '@physicsos/physics-core'
import { VerificationBadge, VerifiedResult } from '../src/client/VerifiedResult.tsx'
import {
  runtimeStatusOf, toVerifiedResult, type VerificationLevel,
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

type CheckInput = Pick<VerificationCheck, 'id' | 'type' | 'passed'>

/**
 * A complete provenance over `evidence`, optionally with a forged
 * `verificationLevel` — the seam must re-derive the supported level from the
 * evidence and ignore the claim.
 */
const provenanceWith = (
  evidence: readonly CheckInput[],
  overrides: Partial<QuantityProvenance> = {},
): QuantityProvenance => ({
  engineId: 'engine-magnetic',
  engineVersion: '1.0.0',
  sceneId: 'scene-1',
  sceneRevision: 42,
  verifierId: 'physics-verifier',
  verificationLevel: deriveVerificationLevel(evidence),
  verifiedAt: 1_700_000_000_000,
  evidence: toVerificationEvidence(evidence),
  ...overrides,
})

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
  it('names a level only from the provenance evidence, never from the numbers', () => {
    /* No provenance at all is the honest default — a number on screen is not
       evidence that the engine checked it. */
    expect(toVerifiedResult({}).level).toBe('unverified')
    expect(toVerifiedResult({ value: '0.156', unit: 'm' }).level).toBe('unverified')
    /* The engine ran and computed, but no check passed ⇒ engine-computed. */
    expect(toVerifiedResult({ provenance: provenanceWith([]) }).level).toBe('engine-computed')
    expect(toVerifiedResult({
      provenance: provenanceWith([{ id: 'speed_conservation', type: 'numerical', passed: false }]),
    }).level).toBe('engine-computed')
    /* One real check family ⇒ physics-verified; two strong families ⇒ strong. */
    expect(toVerifiedResult({
      provenance: provenanceWith([{ id: 'dimension_check', type: 'dimension', passed: true }]),
    }).level).toBe('physics-verified')
    expect(toVerifiedResult({
      provenance: provenanceWith([{ id: 'speed_conservation', type: 'numerical', passed: true }]),
    }).level).toBe('physics-verified')
    expect(toVerifiedResult({
      provenance: provenanceWith([
        { id: 'speed_conservation', type: 'numerical', passed: true },
        { id: 'energy_conservation', type: 'conservation', passed: true },
      ]),
    }).level).toBe('strongly-verified')
    /* An incomplete trace is not a verification: no verifier ⇒ unverified. */
    expect(toVerifiedResult({
      provenance: provenanceWith(
        [{ id: 'speed_conservation', type: 'numerical', passed: true }],
        { verifierId: '' },
      ),
    }).level).toBe('unverified')
  })

  it('never renders a level above the evidence it received (negative control)', () => {
    /* The provenance CLAIMS STRONGLY_VERIFIED, but its evidence is a single
       numeric check — enough for NUMERIC_VERIFIED only. The UI must show the
       supported level, not the claim. */
    const forged = provenanceWith(
      [{ id: 'speed_conservation', type: 'numerical', passed: true }],
      { verificationLevel: 'STRONGLY_VERIFIED' },
    )
    const view = toVerifiedResult({ provenance: forged, value: '0.156', unit: 'm' })
    expect(view.level).toBe('physics-verified')

    const rendered = render(<VerifiedResult view={view} t={t} />)
    const badge = badgeOf(rendered.container)
    expect(badge.getAttribute('data-level')).toBe('physics-verified')
    expect(badge.textContent).toBe('物理已验证')
    expect(rendered.container.textContent).not.toContain('多重验证')
  })

  it('names the engine and verifier from the provenance, not the scene domain', () => {
    const view = toVerifiedResult({
      provenance: provenanceWith([{ id: 'speed_conservation', type: 'numerical', passed: true }]),
      value: '0.156', unit: 'm', checks, revision: 7,
    })
    expect(view.engine).toBe('engine-magnetic')
    expect(view.verifier).toBe('physics-verifier')
    /* The revision is the provenance's own scene revision. */
    expect(view.revision).toBe(42)
    expect(view.checks).toBe(checks)
  })

  it('never names an engine or verifier for an unverified result', () => {
    const unverified = toVerifiedResult({ value: '20.00', unit: 'm/s', checks, revision: 0 })
    expect(unverified.level).toBe('unverified')
    expect(unverified.engine).toBeNull()
    expect(unverified.verifier).toBeNull()
    /* The value and revision are still facts, so they survive. */
    expect(unverified.value).toBe('20.00')
    expect(unverified.revision).toBe(0)
  })
})

/** A verification result as the engine/verifier publishes it. */
const verificationResult = (overrides: Partial<VerificationResult> = {}): VerificationResult => ({
  status: 'passed',
  checks: [],
  warnings: [],
  errors: [],
  ...overrides,
})

describe('runtime verification-status gate (I4)', () => {
  it('a forged status=passed with no checks cannot reach the verified state', () => {
    /* The exact forged result the plan names: the engine CLAIMS it passed but
       carried no evidence. The runtime must read the status off the checks, not
       the string, so the Lab never paints 已验证 over zero evidence — the
       empty-checks placeholder an engine's `validate()` returns fails closed to
       `warning`, never `verified`. */
    const forged = verificationResult({ status: 'passed', checks: [] })
    expect(runtimeStatusOf(forged)).not.toBe('verified')
    expect(runtimeStatusOf(forged)).toBe('warning')

    /* The badge seam agrees: a result with no provenance is unverified, and the
       block names no engine. */
    const view = toVerifiedResult({ value: '0.156', unit: 'm', checks: [] })
    expect(view.level).toBe('unverified')
    const rendered = render(<VerifiedResult view={view} t={t} />)
    const badge = badgeOf(rendered.container)
    expect(badge.getAttribute('data-level')).toBe('unverified')
    expect(badge.textContent).toBe('未验证')
    expect(rendered.container.textContent).not.toContain('物理已验证')
  })

  it('derives the runtime status from the checks, never the status string', () => {
    /* One real passed check earns `verified`... */
    expect(runtimeStatusOf(verificationResult({
      checks: [{ id: 'law_check', type: 'constraint', passed: true }],
    }))).toBe('verified')
    /* ...a failed status stays `failed`... */
    expect(runtimeStatusOf(verificationResult({ status: 'failed' }))).toBe('failed')
    /* ...a warning status stays `warning`... */
    expect(runtimeStatusOf(verificationResult({
      status: 'passed_with_warnings',
      checks: [{ id: 'law_check', type: 'constraint', passed: true }],
    }))).toBe('warning')
    /* ...and an all-failing check list is not evidence of verification. */
    expect(runtimeStatusOf(verificationResult({
      checks: [{ id: 'law_check', type: 'constraint', passed: false }],
    }))).toBe('warning')
  })
})

describe('verified result block', () => {
  it('renders the verified state with value, unit, engine, verifier, checks and revision', () => {
    const view = toVerifiedResult({
      provenance: provenanceWith([
        { id: 'speed_conservation', type: 'numerical', passed: true },
        { id: 'energy_conservation', type: 'conservation', passed: true },
      ]),
      value: '0.156', unit: 'm', checks, revision: 42,
    })
    const rendered = render(<VerifiedResult view={view} t={t} />)

    const value = rendered.container.querySelector('[data-verified-value]')
    expect(value?.textContent).toContain('0.156')
    expect(value?.textContent).toContain('m')

    const badge = badgeOf(rendered.container)
    expect(badge.textContent).toBe('多重验证')
    expect(badge.getAttribute('data-level')).toBe('strongly-verified')

    expect(rendered.getByText('由磁场引擎验证')).toBeTruthy()
    expect(rendered.getByText('校验：PhysicsOS 校验器')).toBeTruthy()
    expect(rendered.container.querySelector('[data-engine="engine-magnetic"]')).not.toBeNull()
    expect(rendered.container.querySelector('[data-verifier="physics-verifier"]')).not.toBeNull()
    expect(rendered.getByText('验证项')).toBeTruthy()
    expect(rendered.getByText('F = qv×B 矢量一致')).toBeTruthy()
    expect(rendered.getByText('速率守恒（洛伦兹力不做功）')).toBeTruthy()
    expect(rendered.getByText('场景 修订 #42')).toBeTruthy()
  })

  it('renders an engine\'s own verifier as a self-check', () => {
    const view = toVerifiedResult({
      provenance: provenanceWith(
        [{ id: 'speed_conservation', type: 'numerical', passed: true }],
        { engineId: 'engine-mechanics', verifierId: 'engine-mechanics:verifier' },
      ),
      value: '20.00', unit: 'm/s',
    })
    const rendered = render(<VerifiedResult view={view} t={t} />)
    expect(rendered.getByText('由力学引擎验证')).toBeTruthy()
    expect(rendered.getByText('校验：力学引擎自校验')).toBeTruthy()
  })

  it('renders the unverified state — with no verified badge — when provenance is missing', () => {
    /* A formatted answer is NOT provenance: the block must stay honest and warn
       instead of drawing a check, and name no engine. */
    const view = toVerifiedResult({ value: '0.156', unit: 'm', revision: 7 })
    const rendered = render(<VerifiedResult view={view} t={t} />)

    const badge = badgeOf(rendered.container)
    expect(badge.textContent).toBe('未验证')
    expect(badge.getAttribute('data-level')).toBe('unverified')
    expect(rendered.container.querySelector('[data-verification-level="unverified"]')).not.toBeNull()

    /* Not one word of the block claims a verification, and no name is invented. */
    expect(rendered.container.textContent).not.toContain('物理已验证')
    expect(rendered.container.textContent).not.toContain('多重验证')
    expect(rendered.container.textContent).not.toContain('由磁场引擎验证')
    expect(rendered.container.querySelector('[data-engine]')).toBeNull()
    expect(rendered.container.querySelector('[data-verifier]')).toBeNull()
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
      provenance: provenanceWith([{ id: 'speed_conservation', type: 'numerical', passed: true }]),
      value: '0.156', unit: 'm', checks, revision: 1,
    })
    const rendered = render(<VerifiedResult view={view} t={t} />)
    const rows = rendered.getAllByRole('listitem')
    expect(rows.length).toBe(checks.length)
    for (const row of rows) expect(row.textContent).toContain('通过')
  })

  it('states the missing detail instead of inventing checks', () => {
    const view = toVerifiedResult({
      provenance: provenanceWith([{ id: 'speed_conservation', type: 'numerical', passed: true }]),
    })
    const rendered = render(<VerifiedResult view={view} t={t} />)
    expect(rendered.getByText('暂无引擎验证明细')).toBeTruthy()
  })
})
