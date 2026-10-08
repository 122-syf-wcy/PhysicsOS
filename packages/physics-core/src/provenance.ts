/**
 * The verified-quantity contract — provenance for every physics number a
 * product surface shows.
 *
 * PhysicsOS's central anti-re-skin guarantee: the model may propose, the engine
 * decides, and the product cannot render a number that did not come from the
 * engine + verifier. This module owns the single DTO the surfaces bind to
 * ({@link VerifiedQuantity}) and the single assertion that refuses a bare number
 * ({@link assertVerifiedPhysicsOutput}).
 *
 * The `verificationLevel` a value carries is *evidence-derived*: it is computed
 * from the verifier's real checks (see {@link deriveVerificationLevel}) both when
 * the verifier publishes a result and again when a gate re-checks it. Nothing
 * here ever defaults a level to a "verified" value — a value with no engine, no
 * scene revision or no verifier evidence degrades to `UNVERIFIED`.
 */
import { PhysicsOSError } from '@physicsos/shared'

import type { VerificationCheck, VerificationCheckType } from './verification.ts'

/* --------------------------------------------------------------- levels -- */

/**
 * How strongly a quantity is verified, weakest to strongest. The ordering is
 * load-bearing: see {@link VERIFICATION_LEVEL_RANK}.
 *
 * - `UNVERIFIED` — nothing behind it (a bare model/parser number).
 * - `ENGINE_COMPUTED` — an engine computed it, but no verifier check passed.
 * - `RULE_VERIFIED` — structural rules held (schema/dimension/constraint/…).
 * - `NUMERIC_VERIFIED` — a numerical law check passed.
 * - `SYMBOLIC_VERIFIED` — a symbolic/algebraic check passed.
 * - `CONSERVATION_VERIFIED` — a conservation law passed.
 * - `STRONGLY_VERIFIED` — two or more independent strong families passed.
 */
export type VerificationLevel =
  | 'UNVERIFIED'
  | 'ENGINE_COMPUTED'
  | 'RULE_VERIFIED'
  | 'NUMERIC_VERIFIED'
  | 'SYMBOLIC_VERIFIED'
  | 'CONSERVATION_VERIFIED'
  | 'STRONGLY_VERIFIED'

export const VERIFICATION_LEVEL_RANK: Readonly<Record<VerificationLevel, number>> = {
  UNVERIFIED: 0,
  ENGINE_COMPUTED: 1,
  RULE_VERIFIED: 2,
  NUMERIC_VERIFIED: 3,
  SYMBOLIC_VERIFIED: 4,
  CONSERVATION_VERIFIED: 5,
  STRONGLY_VERIFIED: 6,
}

export const verificationLevelRank = (level: VerificationLevel): number =>
  VERIFICATION_LEVEL_RANK[level]

/** True when `level` is at least as strong as `minimum`. */
export const verificationLevelAtLeast = (
  level: VerificationLevel,
  minimum: VerificationLevel,
): boolean => verificationLevelRank(level) >= verificationLevelRank(minimum)

/** The floor a caller must reach; a conclusion below this is not a claim of verification. */
export const VERIFIED_CLAIM_FLOOR: VerificationLevel = 'RULE_VERIFIED'

/* --------------------------------------------------------------- evidence -- */

type CheckFamily = 'rule' | 'numeric' | 'symbolic' | 'conservation'

/** The projection of a check that a provenance keeps: enough to re-derive the level, lossless JSON. */
export interface VerificationEvidence {
  readonly id: string
  readonly type: VerificationCheckType
  readonly passed: boolean
  readonly message?: string
}

/**
 * Project verifier checks into the compact evidence a provenance carries. The
 * raw `details` of a check can hold vectors whose `-0` is not lossless JSON, so
 * it is dropped: the level only ever needs the type and the verdict.
 */
export const toVerificationEvidence = (
  checks: readonly VerificationCheck[],
): VerificationEvidence[] =>
  checks.map((entry) => ({
    id: entry.id,
    type: entry.type,
    passed: entry.passed,
    ...(entry.message === undefined ? {} : { message: entry.message }),
  }))

/** Which family of evidence a check type contributes. Unlisted types are non-evidential. */
const CHECK_FAMILY: Readonly<Partial<Record<VerificationCheckType, CheckFamily>>> = {
  schema: 'rule',
  dimension: 'rule',
  constraint: 'rule',
  boundary: 'rule',
  trajectory: 'rule',
  continuity: 'rule',
  semantic: 'rule',
  numerical: 'numeric',
  symbolic: 'symbolic',
  conservation: 'conservation',
}

const FAMILY_RANK: Readonly<Record<CheckFamily, number>> = {
  rule: 2,
  numeric: 3,
  symbolic: 4,
  conservation: 5,
}

const FAMILY_LEVEL: Readonly<Record<CheckFamily, VerificationLevel>> = {
  rule: 'RULE_VERIFIED',
  numeric: 'NUMERIC_VERIFIED',
  symbolic: 'SYMBOLIC_VERIFIED',
  conservation: 'CONSERVATION_VERIFIED',
}

/** Families that count toward the `STRONGLY_VERIFIED` conjunction. */
const STRONG_FAMILIES: readonly CheckFamily[] = ['numeric', 'symbolic', 'conservation']

/**
 * Derive the verification level from the checks a verifier actually ran.
 *
 * Never a constant: the result is the strongest family present among the checks
 * that PASSED, escalated to `STRONGLY_VERIFIED` when two or more independent
 * strong families (numerical / symbolic / conservation) passed. A verifier that
 * ran nothing, or ran only checks that failed, cannot reach a verified level —
 * an empty or all-failing check list is `ENGINE_COMPUTED` (the engine may have
 * produced the number, but nothing confirms it).
 */
export const deriveVerificationLevel = (
  checks: readonly { readonly type: VerificationCheckType; readonly passed: boolean }[],
): VerificationLevel => {
  if (checks.length === 0) return 'ENGINE_COMPUTED'
  const passed = checks.filter((entry) => entry.passed)
  if (passed.length === 0) return 'ENGINE_COMPUTED'

  const families = new Set<CheckFamily>()
  for (const entry of passed) {
    const family = CHECK_FAMILY[entry.type]
    if (family !== undefined) families.add(family)
  }
  if (families.size === 0) return 'ENGINE_COMPUTED'

  if (STRONG_FAMILIES.filter((family) => families.has(family)).length >= 2) {
    return 'STRONGLY_VERIFIED'
  }
  let strongest: CheckFamily = 'rule'
  for (const family of families) {
    if (FAMILY_RANK[family] > FAMILY_RANK[strongest]) strongest = family
  }
  return FAMILY_LEVEL[strongest]
}

/* ------------------------------------------------------------- provenance -- */

/**
 * The trace a user-visible physics conclusion must carry: which engine computed
 * it, at which scene revision, which verifier signed off, and the verifier's own
 * checks as evidence.
 */
export interface QuantityProvenance {
  engineId: string
  engineVersion: string
  sceneId: string
  sceneRevision: number
  verifierId: string
  verificationLevel: VerificationLevel
  /** Epoch milliseconds the verification completed. */
  verifiedAt: number
  /**
   * The verifier's real checks, projected to lossless JSON. A gate re-derives
   * the level from these, so a hand-written `verificationLevel` cannot outrun
   * its evidence.
   */
  evidence: readonly VerificationEvidence[]
}

/** The one DTO a product surface binds to: a physics value with its provenance. */
export interface VerifiedQuantity {
  value: number
  unit: string
  provenance: QuantityProvenance
}

/** A verified value whose rendered form is a string (e.g. an exam answer). */
export interface VerifiedStringQuantity {
  value: string
  unit: string
  provenance: QuantityProvenance
}

/**
 * A unit-bearing, user-visible physics value: the shape the gate recognises. A
 * scalar carries `value`, a vector carries `x`; both carry `unit`.
 */
export interface VerifiedProductValue {
  readonly unit: string
  readonly value?: number | string
  readonly x?: number
  readonly provenance: QuantityProvenance
}

/**
 * The engine-derived values a surface may render. Stem-read inputs (`knowns`)
 * are deliberately NOT part of this: they are stated facts, not conclusions.
 */
export interface ProductPhysicsOutput {
  readonly values: readonly unknown[]
}

/* -------------------------------------------------------------- the gate -- */

/** Stable rejection code for a product numeric output that has no provenance. */
export const PRODUCT_NUMERIC_OUTPUT_WITHOUT_PROVENANCE =
  'PRODUCT_NUMERIC_OUTPUT_WITHOUT_PROVENANCE' as const

/** Thrown by {@link assertVerifiedPhysicsOutput}. */
export class UnverifiedPhysicsOutputError extends PhysicsOSError {
  constructor(reason: string, details: Record<string, unknown>) {
    super(
      PRODUCT_NUMERIC_OUTPUT_WITHOUT_PROVENANCE,
      `Product physics output rejected: ${reason}`,
      { details },
    )
    this.name = 'UnverifiedPhysicsOutputError'
  }
}

/**
 * One product value the gate refused: its reason, the level it claimed, and the
 * level its own evidence actually supports.
 */
export interface ProductProvenanceFailure {
  readonly index: number
  readonly reason: string
  readonly claimedLevel: VerificationLevel
  readonly supportedLevel: VerificationLevel
}

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

/** True when the object is a unit-bearing product physics value (scalar or vector). */
const isProductPhysicsValue = (
  value: unknown,
): value is { unit: string; value?: number | string; x?: number; provenance?: unknown } => {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record.unit !== 'string') return false
  return (
    typeof record.value === 'number' ||
    typeof record.value === 'string' ||
    typeof record.x === 'number'
  )
}

/**
 * The level a provenance's OWN evidence supports, or `UNVERIFIED` when the trace
 * is incomplete. This is the re-derivation that makes the stored
 * `verificationLevel` evidence-derived rather than trusted input: engine id,
 * engine version, scene id, scene revision, verifier id and an evidence array
 * must all be present, or the value is `UNVERIFIED`.
 */
export const provenanceLevel = (provenance: unknown): VerificationLevel => {
  if (typeof provenance !== 'object' || provenance === null) return 'UNVERIFIED'
  const record = provenance as Partial<QuantityProvenance>
  if (!nonEmptyString(record.engineId)) return 'UNVERIFIED'
  if (!nonEmptyString(record.engineVersion)) return 'UNVERIFIED'
  if (!nonEmptyString(record.sceneId)) return 'UNVERIFIED'
  if (!nonEmptyString(record.verifierId)) return 'UNVERIFIED'
  if (
    typeof record.sceneRevision !== 'number' ||
    !Number.isInteger(record.sceneRevision) ||
    record.sceneRevision < 0
  ) {
    return 'UNVERIFIED'
  }
  if (!Number.isFinite(record.verifiedAt)) return 'UNVERIFIED'
  if (!Array.isArray(record.evidence)) return 'UNVERIFIED'
  return deriveVerificationLevel(record.evidence)
}

/**
 * Every product value in `output` that fails the provenance contract. An empty
 * array means the output is clean.
 *
 * A value fails when it is a bare number/string (no engine ran), when its trace
 * is incomplete (no scene revision, verifier or evidence), or when it CLAIMS a
 * level stronger than its evidence supports (a forged level).
 */
export const findUnverifiedProductValues = (
  output: ProductPhysicsOutput,
  minimum: VerificationLevel = 'ENGINE_COMPUTED',
): ProductProvenanceFailure[] => {
  const failures: ProductProvenanceFailure[] = []
  output.values.forEach((entry, index) => {
    if (!isProductPhysicsValue(entry)) {
      /* A bare number or string is a product numeric output with nothing behind
         it — the exact shape the gate exists to stop. */
      if (typeof entry === 'number' || typeof entry === 'string') {
        failures.push({
          index,
          reason: 'bare numeric output with no unit and no provenance',
          claimedLevel: 'UNVERIFIED',
          supportedLevel: 'UNVERIFIED',
        })
      }
      return
    }
    const provenance = (entry as { provenance?: unknown }).provenance
    const supported = provenanceLevel(provenance)
    const claimed = (() => {
      const declared =
        typeof provenance === 'object' && provenance !== null
          ? (provenance as { verificationLevel?: unknown }).verificationLevel
          : undefined
      return typeof declared === 'string' && declared in VERIFICATION_LEVEL_RANK
        ? (declared as VerificationLevel)
        : 'UNVERIFIED'
    })()
    if (provenance === undefined || provenance === null) {
      failures.push({
        index,
        reason: 'missing provenance',
        claimedLevel: claimed,
        supportedLevel: 'UNVERIFIED',
      })
      return
    }
    if (supported === 'UNVERIFIED') {
      failures.push({
        index,
        reason: 'incomplete trace: engine, scene revision, verifier or evidence is missing',
        claimedLevel: claimed,
        supportedLevel: supported,
      })
      return
    }
    if (verificationLevelRank(claimed) > verificationLevelRank(supported)) {
      failures.push({
        index,
        reason: `forged verification level: claimed ${claimed}, evidence supports ${supported}`,
        claimedLevel: claimed,
        supportedLevel: supported,
      })
      return
    }
    if (verificationLevelRank(supported) < verificationLevelRank(minimum)) {
      failures.push({
        index,
        reason: `verification level ${supported} is below the required ${minimum}`,
        claimedLevel: claimed,
        supportedLevel: supported,
      })
    }
  })
  return failures
}

/**
 * The single assertion of the anti-re-skin guarantee: refuse any product physics
 * output that is not traceable to a specific Scene Revision, Engine, Verifier
 * and real check evidence. Throws
 * {@link UnverifiedPhysicsOutputError} (code
 * `PRODUCT_NUMERIC_OUTPUT_WITHOUT_PROVENANCE`) listing every offending value.
 *
 * @param output - the engine-derived values a surface is about to render.
 * @param minimum - the floor the evidence must reach; defaults to
 *   `ENGINE_COMPUTED` (provenance required). Pass `RULE_VERIFIED` to demand that
 *   at least one real check passed.
 */
export const assertVerifiedPhysicsOutput = (
  output: ProductPhysicsOutput,
  minimum: VerificationLevel = 'ENGINE_COMPUTED',
): void => {
  const failures = findUnverifiedProductValues(output, minimum)
  if (failures.length === 0) return
  throw new UnverifiedPhysicsOutputError(failures.map((failure) => failure.reason).join('; '), {
    minimum,
    failures,
  })
}
