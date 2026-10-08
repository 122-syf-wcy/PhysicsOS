/**
 * Provenance composition for the Physics Verifier.
 *
 * The verifiers already return a {@link VerificationResult}; `summarizeVerification`
 * now also stamps the evidence-derived `level` on it (see physics-core's
 * `provenance.ts`). This module turns that result into the {@link QuantityProvenance}
 * a product surface attaches to a value — the trace from a specific scene
 * revision and engine to the checks that passed. It adds no second verification
 * system: the level it records is the level the verifiers already computed, and
 * the evidence is the checks they already ran.
 */
import {
  deriveVerificationLevel,
  toVerificationEvidence,
  type QuantityProvenance,
  type SimulationResult,
  type VerificationCheck,
} from '@physicsos/physics-core'

/** The external Physics Verifier (the package that signs off on scenes). */
export const PHYSICS_VERIFIER_ID = 'physics-verifier'

/** The scene validator, used as the verifier for engine state reads. */
export const SCENE_VALIDATOR_ID = 'physics-scene:validator'

/** The id a verifier is known by when it is the engine's own checks. */
export const engineVerifierId = (engineId: string): string => `${engineId}:verifier`

export interface ProvenanceParts {
  engineId: string
  engineVersion: string
  sceneId: string
  sceneRevision: number
  verifierId: string
  /**
   * The checks the verifier actually ran. The level is re-derived from these at
   * every gate, so a caller cannot assert a level its evidence does not support.
   */
  evidence: readonly VerificationCheck[]
  /** Epoch milliseconds verification completed; defaults to now. */
  verifiedAt?: number
}

/**
 * Build a {@link QuantityProvenance} from explicit parts. The recorded
 * `verificationLevel` is always {@link deriveVerificationLevel} of `evidence` —
 * never supplied by the caller — so it cannot be defaulted or forged here.
 */
export const quantityProvenance = (parts: ProvenanceParts): QuantityProvenance => ({
  engineId: parts.engineId,
  engineVersion: parts.engineVersion,
  sceneId: parts.sceneId,
  sceneRevision: parts.sceneRevision,
  verifierId: parts.verifierId,
  verificationLevel: deriveVerificationLevel(parts.evidence),
  verifiedAt: parts.verifiedAt ?? Date.now(),
  evidence: toVerificationEvidence(parts.evidence),
})

export interface ProvenanceForSimulationOptions {
  /** Overrides the verifier id; defaults to the engine's own verifier. */
  verifierId?: string
  verifiedAt?: number
}

/** The moment the simulation finished, as epoch milliseconds. */
const finishedAtOf = (simulation: SimulationResult): number => {
  const parsed = Date.parse(simulation.metadata.finishedAt)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

/**
 * Provenance for values read off a {@link SimulationResult}: the engine id and
 * version from its metadata, the scene id/revision, the Physics Verifier's own
 * checks as evidence, and the evidence-derived level.
 */
export const provenanceForSimulation = (
  simulation: SimulationResult,
  options: ProvenanceForSimulationOptions = {},
): QuantityProvenance =>
  quantityProvenance({
    engineId: simulation.metadata.engineId,
    engineVersion: simulation.metadata.engineVersion,
    sceneId: String(simulation.sceneId),
    sceneRevision: simulation.sceneRevision,
    verifierId: options.verifierId ?? engineVerifierId(simulation.metadata.engineId),
    evidence: simulation.verification.checks,
    verifiedAt: options.verifiedAt ?? finishedAtOf(simulation),
  })
