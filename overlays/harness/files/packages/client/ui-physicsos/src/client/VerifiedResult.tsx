/**
 * Verification / provenance block for a physics result.
 *
 * The brand signature that makes the product legible as engine-backed rather
 * than a re-skinned chat model: next to a numeric answer it shows WHO computed
 * it, WHO verified it, WHICH checks passed, and WHICH scene revision the verdict
 * belongs to.
 *
 * It renders the facts the seam derived — never a judgement of its own. The
 * engine and verifier names come from the answer's own provenance, so the block
 * never attributes a number to the scene's domain. When the provenance is absent
 * it shows the honest `unverified` state with a warning mark; it never draws a
 * verified badge from numbers that merely look right. The state is carried by
 * the glyph AND the label, so it never depends on colour alone.
 */

import type { ReactElement } from 'react'

import type { PhysicsosKey } from './locales.ts'
import { IconComputed, IconUnverified, IconVerified, IconVerifiedStrong } from './icons/physics-icons.tsx'
import type { VerificationLevel, VerifiedResultView } from './physics/verified-result.ts'
import { VerificationList } from './workspace-parts.tsx'
import css from './VerifiedResult.module.css'

type Translate = (key: PhysicsosKey, params?: Record<string, unknown>) => string

/** Level → its user-visible label. Copy lives in the locale table. */
const LEVEL_LABELS: Readonly<Record<VerificationLevel, PhysicsosKey>> = {
  unverified: 'sceneCard.verify.unverified',
  'engine-computed': 'sceneCard.verify.engineComputed',
  'physics-verified': 'sceneCard.verify.physicsVerified',
  'strongly-verified': 'sceneCard.verify.stronglyVerified',
}

/** Level → its glyph, all from the code-drawn PhysicsOS icon set. */
const LEVEL_ICONS: Readonly<Record<VerificationLevel, (props: { size?: number | undefined }) => ReactElement>> = {
  unverified: IconUnverified,
  'engine-computed': IconComputed,
  'physics-verified': IconVerified,
  'strongly-verified': IconVerifiedStrong,
}

/**
 * Engine id (`QuantityProvenance.engineId`) → the engine that solves and
 * verifies it. Keyed by the engine's OWN id, so the line names the engine that
 * produced the number rather than the scene's teaching domain.
 */
const ENGINE_LABELS: Readonly<Record<string, PhysicsosKey>> = {
  'engine-magnetic': 'sceneCard.verify.engine.magnetic',
  'engine-current-magnetic': 'sceneCard.verify.engine.currentMagnetic',
  'engine-mechanics': 'sceneCard.verify.engine.mechanics',
  'engine-energy': 'sceneCard.verify.engine.energy',
  'engine-collision': 'sceneCard.verify.engine.collision',
  'engine-lever': 'sceneCard.verify.engine.lever',
  'engine-electric': 'sceneCard.verify.engine.electric',
  'engine-electric-region': 'sceneCard.verify.engine.electricRegion',
  'engine-composite': 'sceneCard.verify.engine.composite',
  'engine-circuit': 'sceneCard.verify.engine.circuit',
  'engine-optics': 'sceneCard.verify.engine.optics',
  'engine-light': 'sceneCard.verify.engine.light',
  'engine-acoustics': 'sceneCard.verify.engine.acoustics',
  'engine-noise-level': 'sceneCard.verify.engine.noiseLevel',
  'engine-fluid': 'sceneCard.verify.engine.fluid',
  'engine-pressure': 'sceneCard.verify.engine.pressure',
  'engine-thermal': 'sceneCard.verify.engine.thermal',
  'engine-thermometer': 'sceneCard.verify.engine.thermometer',
  'engine-induction': 'sceneCard.verify.engine.induction',
  'engine-transformer': 'sceneCard.verify.engine.transformer',
  'engine-wave': 'sceneCard.verify.engine.wave',
  'engine-modern': 'sceneCard.verify.engine.modern',
}

/** The external Physics Verifier that signs off the magnetic team's scenes. */
const EXTERNAL_VERIFIER_ID = 'physics-verifier'
/** Suffix an engine's own verifier id carries (`<engineId>:verifier`). */
const ENGINE_VERIFIER_SUFFIX = ':verifier'

/** Verifier id → its own display name, when it has one. */
const VERIFIER_LABELS: Readonly<Record<string, PhysicsosKey>> = {
  [EXTERNAL_VERIFIER_ID]: 'sceneCard.verify.verifierExternal',
}

/** The display name of the engine behind a value, or undefined when unknown. */
const engineLabelOf = (engineId: string, t: Translate): string | undefined => {
  const key = ENGINE_LABELS[engineId]
  return key === undefined ? undefined : t(key)
}

/**
 * The verifier's display name: the external verifier by its own name, an
 * engine's own verifier as "<engine> 自校验". An unknown id hides the line
 * instead of printing a raw identifier.
 */
const verifierLabelOf = (
  verifierId: string,
  engineName: string | undefined,
  t: Translate,
): string | null => {
  const named = VERIFIER_LABELS[verifierId]
  if (named !== undefined) return t(named)
  if (verifierId.endsWith(ENGINE_VERIFIER_SUFFIX) && engineName !== undefined) {
    return t('sceneCard.verify.verifierEngine', { engine: engineName })
  }
  return null
}

/**
 * The status badge: a glyph plus its label. The glyph is decorative, so the
 * state is always readable as text and never depends on colour alone.
 */
export function VerificationBadge({
  level,
  t,
}: {
  readonly level: VerificationLevel
  readonly t: Translate
}) {
  const Icon = LEVEL_ICONS[level]
  return (
    <span className={css.badge} data-verification-badge="true" data-level={level}>
      <Icon size={13} />
      <span className={css.badgeLabel}>{t(LEVEL_LABELS[level])}</span>
    </span>
  )
}

/**
 * The full provenance block: value + unit, the four-level status, the engine
 * that computed the value and the verifier that signed off, the engine's named
 * checks, and the scene revision.
 */
export function VerifiedResult({
  view,
  t,
}: {
  readonly view: VerifiedResultView
  readonly t: Translate
}) {
  const engineName = view.engine === null ? undefined : engineLabelOf(view.engine, t)
  const verifierName = view.verifier === null ? null : verifierLabelOf(view.verifier, engineName, t)
  return (
    <div className={css.block} data-verification-level={view.level}>
      {view.value === null ? null : (
        <output className={css.value} data-verified-value="true">
          <span className={css.valueNumber}>{view.value}</span>
          {view.unit === '' ? null : <span className={css.valueUnit}>{view.unit}</span>}
        </output>
      )}
      <div className={css.statusRow}>
        <VerificationBadge level={view.level} t={t} />
        {view.engine === null || engineName === undefined ? null : (
          <span className={css.engine} data-engine={view.engine}>
            {t('sceneCard.verify.verifiedBy', { engine: engineName })}
          </span>
        )}
        {view.verifier === null || verifierName === null ? null : (
          <span className={css.verifier} data-verifier={view.verifier}>
            {t('sceneCard.verify.verifier', { verifier: verifierName })}
          </span>
        )}
      </div>
      <p className={css.checksLabel}>{t('sceneCard.verify.checks')}</p>
      <VerificationList checks={view.checks} emptyLabel={t('sceneCard.verify.pendingChecks')} />
      {view.revision === null ? null : (
        <p className={css.revision}>{t('sceneCard.verify.revision', { revision: view.revision })}</p>
      )}
    </div>
  )
}
