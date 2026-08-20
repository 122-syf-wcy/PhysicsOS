/**
 * Session-header profile name. Shadows the Harness agent-preset label so a
 * started Session still shows PhysicsOS copy.
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ProfileIcon } from './ProfileIcons.tsx'
import { STUDENT_PROFILES } from './profiles.ts'
import type { PhysicsProfileState } from './profile-store.ts'
import type { PhysicsosKey } from './locales.ts'
import css from './PhysicsProfileLabel.module.css'

const NAME: Record<string, PhysicsosKey> = {
  'physics-experiment': 'profile.experiment',
  'physics-question': 'profile.question',
  'physics-tutor': 'profile.tutor',
}

/** Registration-side face for {@link PhysicsProfileLabel}. */
export interface PhysicsProfileLabelInjected {
  hooks: {
    physicsProfile: SnapshotStore<PhysicsProfileState>
  }
}

/** Slot props for the header profile label. */
export type PhysicsProfileLabelProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'physicsos'>
  & InjectFace<PhysicsProfileLabelInjected>

/**
 * Render the PhysicsOS name for the Session's mapped profile.
 * @param props - local profile snapshot and product copy.
 */
export function PhysicsProfileLabel({ usePhysicsProfile, t }: PhysicsProfileLabelProps) {
  const current = usePhysicsProfile(snapshot => snapshot.current)
  const profile = STUDENT_PROFILES.find(entry => entry.id === current) ?? STUDENT_PROFILES[0]
  return (
    <span className={css.label} title={t('profile.aria')}>
      <ProfileIcon id={profile.id} />
      {t(NAME[profile.id] ?? 'profile.experiment')}
    </span>
  )
}
