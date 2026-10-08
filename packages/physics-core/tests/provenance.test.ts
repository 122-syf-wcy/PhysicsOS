import { describe, expect, it } from 'vitest'

import {
  assertVerifiedPhysicsOutput,
  check,
  deriveVerificationLevel,
  findUnverifiedProductValues,
  PRODUCT_NUMERIC_OUTPUT_WITHOUT_PROVENANCE,
  provenanceLevel,
  summarizeVerification,
  toVerificationEvidence,
  UnverifiedPhysicsOutputError,
  verificationLevelAtLeast,
  type QuantityProvenance,
  type VerificationCheck,
  type VerificationEvidence,
  type VerifiedQuantity,
} from '../src/index.ts'

const numerical = (passed = true): VerificationCheck =>
  check('newton_second_law', 'numerical', passed, { message: 'ΣF = ma' })
const conservation = (passed = true): VerificationCheck =>
  check('speed_conservation', 'conservation', passed)
const schema = (passed = true): VerificationCheck =>
  check('scene_valid', 'schema', passed)

const evidenceOf = (...checks: readonly VerificationCheck[]): VerificationEvidence[] =>
  toVerificationEvidence(checks)

const provenanceWith = (overrides: Partial<QuantityProvenance> = {}): QuantityProvenance => ({
  engineId: 'engine-mechanics',
  engineVersion: '1.0.0',
  sceneId: 'scene-1',
  sceneRevision: 4,
  verifierId: 'engine-mechanics:verifier',
  verificationLevel: 'STRONGLY_VERIFIED',
  verifiedAt: 1_730_000_000_000,
  evidence: evidenceOf(numerical(), conservation()),
  ...overrides,
})

/* ------------------------------------------------------------------ levels -- */

describe('deriveVerificationLevel', () => {
  it('is ENGINE_COMPUTED when the verifier ran nothing or nothing passed', () => {
    expect(deriveVerificationLevel([])).toBe('ENGINE_COMPUTED')
    expect(deriveVerificationLevel([numerical(false)])).toBe('ENGINE_COMPUTED')
  })

  it('maps each check family to the level it evidences', () => {
    expect(deriveVerificationLevel([schema()])).toBe('RULE_VERIFIED')
    expect(deriveVerificationLevel([numerical()])).toBe('NUMERIC_VERIFIED')
    expect(deriveVerificationLevel([check('algebra', 'symbolic', true)])).toBe('SYMBOLIC_VERIFIED')
    expect(deriveVerificationLevel([conservation()])).toBe('CONSERVATION_VERIFIED')
  })

  it('escalates to STRONGLY_VERIFIED only when two strong families passed', () => {
    expect(deriveVerificationLevel([numerical(), conservation()])).toBe('STRONGLY_VERIFIED')
    expect(deriveVerificationLevel([numerical(), schema()])).toBe('NUMERIC_VERIFIED')
  })

  it('lets a failed check lower the level instead of being averaged away', () => {
    expect(deriveVerificationLevel([conservation(), numerical(false)])).toBe(
      'CONSERVATION_VERIFIED',
    )
    expect(deriveVerificationLevel([numerical(false), conservation(false)])).toBe('ENGINE_COMPUTED')
  })

  it('orders levels and exposes the claim floor', () => {
    expect(verificationLevelAtLeast('STRONGLY_VERIFIED', 'RULE_VERIFIED')).toBe(true)
    expect(verificationLevelAtLeast('ENGINE_COMPUTED', 'RULE_VERIFIED')).toBe(false)
    expect(verificationLevelAtLeast('UNVERIFIED', 'ENGINE_COMPUTED')).toBe(false)
  })

  it('is what summarizeVerification stamps on every result', () => {
    const result = summarizeVerification([numerical(), conservation()], [], [])
    expect(result.level).toBe('STRONGLY_VERIFIED')
    const failed = summarizeVerification([numerical(false)], [], [])
    expect(failed.level).toBe('ENGINE_COMPUTED')
  })
})

/* -------------------------------------------------------------- provenance -- */

describe('provenanceLevel', () => {
  it('re-derives from the evidence, ignoring the declared level', () => {
    expect(provenanceLevel(provenanceWith({ verificationLevel: 'RULE_VERIFIED' }))).toBe(
      'STRONGLY_VERIFIED',
    )
  })

  it('degrades to UNVERIFIED when any trace field is missing', () => {
    expect(provenanceLevel(undefined)).toBe('UNVERIFIED')
    expect(provenanceLevel(provenanceWith({ engineId: '' }))).toBe('UNVERIFIED')
    expect(provenanceLevel(provenanceWith({ engineVersion: '' }))).toBe('UNVERIFIED')
    expect(provenanceLevel(provenanceWith({ sceneId: '' }))).toBe('UNVERIFIED')
    expect(provenanceLevel(provenanceWith({ verifierId: '' }))).toBe('UNVERIFIED')
    expect(provenanceLevel(provenanceWith({ sceneRevision: -1 }))).toBe('UNVERIFIED')
    expect(provenanceLevel(provenanceWith({ sceneRevision: 1.5 }))).toBe('UNVERIFIED')
    expect(provenanceLevel(provenanceWith({ verifiedAt: Number.NaN }))).toBe('UNVERIFIED')
    expect(
      provenanceLevel(provenanceWith({ evidence: undefined as unknown as VerificationEvidence[] })),
    ).toBe('UNVERIFIED')
  })
})

describe('assertVerifiedPhysicsOutput', () => {
  it('accepts a fully traced value', () => {
    expect(() =>
      assertVerifiedPhysicsOutput({
        values: [{ value: 4.2, unit: 'm', provenance: provenanceWith() }],
      }),
    ).not.toThrow()
  })

  it('accepts a verified string answer (a paper answer, not a bare string)', () => {
    expect(() =>
      assertVerifiedPhysicsOutput({
        values: [
          {
            value: '4.17×10⁻²',
            unit: 'm',
            provenance: provenanceWith({ evidence: evidenceOf(numerical(), conservation()) }),
          },
        ],
      }),
    ).not.toThrow()
  })

  it('rejects a value that claims more verification than its evidence supports', () => {
    const failures = findUnverifiedProductValues({
      values: [
        {
          value: 1,
          unit: 'm',
          provenance: provenanceWith({
            verificationLevel: 'STRONGLY_VERIFIED',
            evidence: evidenceOf(numerical()),
          }),
        },
      ],
    })
    expect(failures).toHaveLength(1)
    expect(failures[0]?.reason).toContain('forged verification level')
    expect(failures[0]?.claimedLevel).toBe('STRONGLY_VERIFIED')
    expect(failures[0]?.supportedLevel).toBe('NUMERIC_VERIFIED')
  })

  it('demands at least one passed check when the caller asks for a claim floor', () => {
    expect(() =>
      assertVerifiedPhysicsOutput(
        { values: [{ value: 1, unit: 'm', provenance: provenanceWith({ evidence: [] }) }] },
        'RULE_VERIFIED',
      ),
    ).toThrowError(UnverifiedPhysicsOutputError)
  })

  it('carries the stable rejection code', () => {
    try {
      assertVerifiedPhysicsOutput({ values: [42] })
      throw new Error('expected the gate to reject a bare number')
    } catch (error) {
      expect(error).toBeInstanceOf(UnverifiedPhysicsOutputError)
      expect((error as UnverifiedPhysicsOutputError).code).toBe(
        PRODUCT_NUMERIC_OUTPUT_WITHOUT_PROVENANCE,
      )
    }
  })
})

/* --------------------------------------------- static constraint (type-level) -- */

/**
 * The static half of the contract: a raw `number`/`string` must not be usable
 * where a `VerifiedQuantity` is required. Each `@ts-expect-error` is a gate —
 * if the assignment ever starts compiling, the directive becomes unused and
 * `tsc` fails the build.
 */
describe('static constraint — only a traced VerifiedQuantity satisfies the DTO', () => {
  it('a bare number, bare string, or value without provenance is rejected at compile time', () => {
    // @ts-expect-error a raw number is not a VerifiedQuantity
    const asNumber: VerifiedQuantity = 3.14
    // @ts-expect-error a raw string is not a VerifiedQuantity
    const asString: VerifiedQuantity = '3.14'
    // @ts-expect-error a value with no provenance is not a VerifiedQuantity
    const withoutProvenance: VerifiedQuantity = { value: 1, unit: 'm' }
    void asNumber
    void asString
    void withoutProvenance

    /* And the fully traced value does compile — the gate is not vacuous. */
    const good: VerifiedQuantity = { value: 3.14, unit: 'm', provenance: provenanceWith() }
    expect(good.provenance.verificationLevel).toBe('STRONGLY_VERIFIED')
  })
})

/* ------------------------------------------------- negative controls (must FAIL) -- */

/**
 * The three fixtures the gate MUST refuse. Each prints its rejection verbatim so
 * the CI log shows the gate doing its job rather than a constant passing. The
 * third is the important one: a hand-written `verificationLevel` is not trusted,
 * it is re-derived from the checks the verifier actually ran.
 */
describe('gate negative controls', () => {
  const rejectionOf = (values: readonly unknown[]): string => {
    try {
      assertVerifiedPhysicsOutput({ values })
      return 'NO REJECTION (the gate failed to fail)'
    } catch (error) {
      const failure = error as UnverifiedPhysicsOutputError
      const detail = JSON.stringify(failure.details, null, 2)
      return `[${failure.name}] code=${failure.code}\nmessage=${failure.message}\n${detail}`
    }
  }

  it('NEGATIVE 1: a bare model-produced number with no engine run is rejected', () => {
    const output = rejectionOf([2.5e-7])
    console.log(`\n--- NEGATIVE 1: bare model number ---\n${output}`)
    expect(output).toContain('bare numeric output with no unit and no provenance')
  })

  it('NEGATIVE 2: a value missing sceneRevision is rejected', () => {
    const provenance = provenanceWith()
    delete (provenance as { sceneRevision?: number }).sceneRevision
    const output = rejectionOf([{ value: 3.5, unit: 'm', provenance }])
    console.log(`\n--- NEGATIVE 2: missing sceneRevision ---\n${output}`)
    expect(output).toContain('incomplete trace')
  })

  it('NEGATIVE 3: a forged STRONGLY_VERIFIED level is rejected', () => {
    const output = rejectionOf([
      {
        value: 3.5,
        unit: 'm',
        provenance: provenanceWith({
          verificationLevel: 'STRONGLY_VERIFIED',
          evidence: evidenceOf(numerical()),
        }),
      },
    ])
    console.log(`\n--- NEGATIVE 3: forged STRONGLY_VERIFIED ---\n${output}`)
    expect(output).toContain('forged verification level: claimed STRONGLY_VERIFIED')
    expect(output).toContain('evidence supports NUMERIC_VERIFIED')
  })
})
