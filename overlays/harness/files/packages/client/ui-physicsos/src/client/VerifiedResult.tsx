/**
 * Verification / provenance block for a physics result.
 *
 * The brand signature that makes the product legible as engine-backed rather
 * than a re-skinned chat model: next to a numeric answer it shows WHO verified
 * it, WHICH checks passed, and WHICH scene revision the verdict belongs to.
 *
 * It renders the facts the seam derived — never a judgement of its own. When
 * the engine's provenance is absent the block shows the honest `unverified`
 * state with a warning mark; it never draws a verified badge from numbers that
 * merely look right. The state is carried by the glyph AND the label, so it
 * never depends on colour alone.
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

/** Scene domain → the engine that solves and verifies it. */
const ENGINE_LABELS: Readonly<Record<string, PhysicsosKey>> = {
  magnetic: 'sceneCard.verify.engine.magnetic',
  mechanics: 'sceneCard.verify.engine.mechanics',
  electric: 'sceneCard.verify.engine.electric',
  circuit: 'sceneCard.verify.engine.circuit',
  composite: 'sceneCard.verify.engine.composite',
  optics: 'sceneCard.verify.engine.optics',
  acoustics: 'sceneCard.verify.engine.acoustics',
  fluid: 'sceneCard.verify.engine.fluid',
  thermal: 'sceneCard.verify.engine.thermal',
  induction: 'sceneCard.verify.engine.induction',
  wave: 'sceneCard.verify.engine.wave',
  modern: 'sceneCard.verify.engine.modern',
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
 * The full provenance block: value + unit, the four-level status, the verifying
 * engine when known, the engine's named checks, and the scene revision.
 */
export function VerifiedResult({
  view,
  t,
}: {
  readonly view: VerifiedResultView
  readonly t: Translate
}) {
  const engineKey = view.engine === null ? undefined : ENGINE_LABELS[view.engine]
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
        {engineKey === undefined || view.engine === null ? null : (
          <span className={css.engine} data-verifier={view.engine}>
            {t('sceneCard.verify.verifiedBy', { engine: t(engineKey) })}
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
