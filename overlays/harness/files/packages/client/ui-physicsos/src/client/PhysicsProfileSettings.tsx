import clsx from 'clsx'
import { ProfileIcon } from './ProfileIcons.tsx'
import type { PhysicsProfileSeatProps } from './PhysicsProfileSeat.tsx'
import { STUDENT_PROFILES, type PhysicsProfileId } from './profiles.ts'
import type { PhysicsosKey } from './locales.ts'
import css from './PhysicsProfileSettings.module.css'

const copy: Record<PhysicsProfileId, { name: PhysicsosKey; description: PhysicsosKey }> = {
  'physics-experiment': { name: 'profile.experiment', description: 'profile.experiment.desc' },
  'physics-question': { name: 'profile.question', description: 'profile.question.desc' },
  'physics-tutor': { name: 'profile.tutor', description: 'profile.tutor.desc' },
}

/**
 * Product modes reuse the same account-scoped controller as the composer.
 * @param props - Account-scoped mode state, selection action and product copy.
 * @returns The mode controls and account permission explanation.
 */
export function PhysicsProfileSettings({ usePhysicsProfile, select, t }: PhysicsProfileSeatProps) {
  const state = usePhysicsProfile(value => value)
  return (
    <section className={css.root}>
      <h2>{t('profile.settings.title')}</h2>
      <p className={css.intro}>{t('profile.settings.description')}</p>
      <div className={css.modes} role="group" aria-label={t('profile.settings.title')}>
        {STUDENT_PROFILES.map(profile => (
          <button key={profile.id} type="button" aria-pressed={state.current === profile.id}
            disabled={state.busy} className={clsx(css.mode, state.current === profile.id && css.selected)}
            onClick={() => { void select(profile.id) }}>
            <ProfileIcon id={profile.id} />
            <strong>{t(copy[profile.id].name)}</strong>
            <span>{t(copy[profile.id].description)}</span>
          </button>
        ))}
      </div>
      {state.error !== null && <p role="alert">{state.error}</p>}
      <aside className={css.policy}>
        <h3>{t('profile.settings.permissions')}</h3>
        <p>{t('profile.settings.workspacePolicy')}</p>
        <p>{t('profile.settings.modelPolicy')}</p>
      </aside>
    </section>
  )
}
