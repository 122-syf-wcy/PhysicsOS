/**
 * The verified-result seam.
 *
 * THE ONE PLACE the client turns the provenance it receives about a physics
 * answer into the fact-only view the badge renders. The UI never decides
 * whether a result is verified: it renders the level the engine's OWN evidence
 * supports, the checks the engine ran, the engine and verifier it names, and
 * the scene revision — or the honest `unverified` state when the trace is
 * missing.
 *
 * The seam binds to the canonical contract (`QuantityProvenance` from
 * `@physicsos/physics-core`): the level is re-derived from the provenance's own
 * evidence with that package's `provenanceLevel`, so a value that CLAIMS a level
 * its evidence does not support (a forged `verificationLevel`) renders the
 * supported level, never the claim. Only this module may read provenance; the
 * component consumes {@link VerifiedResultView} only.
 */

import {
  provenanceLevel,
  type QuantityProvenance,
  type VerificationLevel as ProvenanceLevel,
} from '@physicsos/physics-core'

import type { VerificationCheckView } from './scene-visual-model.ts'

/** The four user-visible verification states. */
export type VerificationLevel =
  | 'unverified'
  | 'engine-computed'
  | 'physics-verified'
  | 'strongly-verified'

/**
 * What the verification block renders. Every field is a fact: `level` is the
 * level the provenance's evidence supports, never inferred here from the
 * numbers and never taken on the provenance's word.
 */
export interface VerifiedResultView {
  readonly level: VerificationLevel
  /** The numeric result, already formatted, or null when the surface has none. */
  readonly value: string | null
  readonly unit: string
  /**
   * The engine that computed the value (`QuantityProvenance.engineId`), or null
   * when the result is unverified. The block resolves its display name through
   * the locale table, so an unknown id hides the "verified by" line instead of
   * printing a raw id.
   */
  readonly engine: string | null
  /**
   * The verifier that signed off (`QuantityProvenance.verifierId`), or null when
   * the result is unverified. Named separately from the engine so the surface
   * can say WHO checked, not only who computed.
   */
  readonly verifier: string | null
  /** The engine's named checks, exactly as the workspace runtime publishes them. */
  readonly checks: readonly VerificationCheckView[]
  /** Scene revision the result belongs to, or null when the surface has none. */
  readonly revision: number | null
}

/**
 * The verification facts the client can receive: the canonical provenance the
 * answer carries, plus the display fields the surface already has.
 */
export interface VerifiedResultFacts {
  readonly value?: string | null | undefined
  readonly unit?: string | undefined
  /** The engine's trace, straight off the answer. Null/absent ⇒ unverified. */
  readonly provenance?: QuantityProvenance | null | undefined
  /** The engine's check list as the workspace runtime presents it. */
  readonly checks?: readonly VerificationCheckView[] | undefined
  /** Display revision fallback for surfaces with no provenance (never a level). */
  readonly revision?: number | null | undefined
}

/*
 * The canonical level → the four states the card renders. The four mid-levels
 * (rule/numeric/symbolic/conservation) all name one real check family, which
 * the card shows as "physics verified"; `STRONGLY_VERIFIED` needs two strong
 * families and earns its own state; `ENGINE_COMPUTED` means the engine ran but
 * nothing passed. Nothing here promotes a level: the mapping is total over the
 * canonical enum and `UNVERIFIED` stays `unverified`.
 */
const UI_LEVEL: Readonly<Record<ProvenanceLevel, VerificationLevel>> = {
  UNVERIFIED: 'unverified',
  ENGINE_COMPUTED: 'engine-computed',
  RULE_VERIFIED: 'physics-verified',
  NUMERIC_VERIFIED: 'physics-verified',
  SYMBOLIC_VERIFIED: 'physics-verified',
  CONSERVATION_VERIFIED: 'physics-verified',
  STRONGLY_VERIFIED: 'strongly-verified',
}

/**
 * Map the received provenance to the fact-only view.
 *
 * The level is `provenanceLevel(provenance)` — the level the provenance's OWN
 * evidence supports — so an incomplete trace is `unverified` and a forged
 * `verificationLevel` cannot outrun its checks.
 * @param facts - the verification fields the surface received.
 * @returns the view the block renders.
 */
export const toVerifiedResult = (facts: VerifiedResultFacts): VerifiedResultView => {
  const provenance = facts.provenance ?? null
  const level = UI_LEVEL[provenanceLevel(provenance)]
  /* Naming an engine or a verifier is itself a verification claim: an
     unverified result never says who "verified" it. */
  const verified = level !== 'unverified'
  return {
    level,
    value: facts.value ?? null,
    unit: facts.unit ?? '',
    engine: verified ? provenance?.engineId ?? null : null,
    verifier: verified ? provenance?.verifierId ?? null : null,
    checks: facts.checks ?? [],
    revision: provenance?.sceneRevision ?? facts.revision ?? null,
  }
}
