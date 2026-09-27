/**
 * The verified-result seam.
 *
 * THE ONE PLACE the client turns the fields it receives about engine
 * verification into the fact-only view the badge renders. The UI never decides
 * whether a result is verified: it renders the level the engine published, the
 * checks the engine ran, the verifier it names, and the scene revision — or the
 * honest `unverified` state when any of those facts is missing.
 *
 * When the domain workstream's canonical `VerifiedQuantity` + provenance
 * contract lands, `toVerifiedResult` is re-pointed to it and nothing downstream
 * of this module changes — the component consumes {@link VerifiedResultView}
 * only, so the switch stays one function wide.
 */

import type { VerificationCheckView } from './scene-visual-model.ts'

/** The four user-visible verification states. */
export type VerificationLevel =
  | 'unverified'
  | 'engine-computed'
  | 'physics-verified'
  | 'strongly-verified'

/**
 * What the verification block renders. Every field is a fact: `level` is named
 * by the engine, never inferred here from the numbers or the check list.
 */
export interface VerifiedResultView {
  readonly level: VerificationLevel
  /** The numeric result, already formatted, or null when the surface has none. */
  readonly value: string | null
  readonly unit: string
  /**
   * Stable engine key — today the scene domain id (`magnetic`, `mechanics`, …).
   * The block resolves its display name through the locale table, so an unknown
   * key hides the "verified by" line instead of printing a raw id.
   */
  readonly engine: string | null
  /** The engine's named checks, exactly as the workspace runtime publishes them. */
  readonly checks: readonly VerificationCheckView[]
  /** Scene revision the result belongs to, or null when the surface has none. */
  readonly revision: number | null
}

/**
 * The verification facts the client can receive TODAY: the solve summary's
 * `verification.status`, the scene domain, the primary answer and the revision.
 * This is exactly the shape the canonical contract will replace.
 */
export interface VerifiedResultFacts {
  readonly status?: string | undefined
  readonly value?: string | null | undefined
  readonly unit?: string | undefined
  readonly domain?: string | null | undefined
  readonly checks?: readonly VerificationCheckView[] | undefined
  readonly revision?: number | null | undefined
}

/*
 * The engine's aggregate status → the level it names. `failed` is absent on
 * purpose: a result the engine checked and rejected is NOT verified, so it
 * falls through to `unverified` rather than being promoted. The canonical
 * contract's explicit `engine-computed` / `strongly-verified` levels will arrive
 * as their own cases here, not be guessed from check counts.
 */
const LEVEL_BY_STATUS: Readonly<Record<string, VerificationLevel>> = {
  passed: 'physics-verified',
  passed_with_warnings: 'physics-verified',
}

/**
 * Map the received verification facts to the fact-only view.
 * @param facts - the verification fields the surface received.
 * @returns the view the block renders.
 */
export const toVerifiedResult = (facts: VerifiedResultFacts): VerifiedResultView => {
  const level: VerificationLevel = facts.status === undefined
    ? 'unverified'
    : LEVEL_BY_STATUS[facts.status] ?? 'unverified'
  return {
    level,
    value: facts.value ?? null,
    unit: facts.unit ?? '',
    /* Naming a verifier is itself a verification claim: an unverified result
       never says who "verified" it. */
    engine: level === 'unverified' ? null : facts.domain ?? null,
    checks: facts.checks ?? [],
    revision: facts.revision ?? null,
  }
}
