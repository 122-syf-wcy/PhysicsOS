/**
 * Student profile chip. Shadows the Harness agent-preset seat so coding
 * roster copy never reaches the Home surface.
 */

import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ProfileIcon } from './ProfileIcons.tsx'
import { STUDENT_PROFILES, type PhysicsProfileId } from './profiles.ts'
import type { PhysicsProfileState } from './profile-store.ts'
import type { PhysicsosKey } from './locales.ts'
import css from './PhysicsProfileSeat.module.css'

const NAME: Record<PhysicsProfileId, PhysicsosKey> = {
  'physics-experiment': 'profile.experiment',
  'physics-question': 'profile.question',
  'physics-tutor': 'profile.tutor',
}

const DESC: Record<PhysicsProfileId, PhysicsosKey> = {
  'physics-experiment': 'profile.experiment.desc',
  'physics-question': 'profile.question.desc',
  'physics-tutor': 'profile.tutor.desc',
}

/** Registration-side face for {@link PhysicsProfileSeat}. */
export interface PhysicsProfileSeatInjected {
  hooks: {
    physicsProfile: SnapshotStore<PhysicsProfileState>
  }
  select: (id: PhysicsProfileId) => Promise<void>
}

/** Slot props for the Home profile chip. */
export type PhysicsProfileSeatProps =
  PropsRuntime<'conversation.hero.agentPreset'>
  & PropsLocale<'physicsos'>
  & InjectFace<PhysicsProfileSeatInjected>

/**
 * Render the PhysicsOS profile chip and two-line menu.
 * @param props - seat snapshot, select, and product copy.
 */
export function PhysicsProfileSeat({
  usePhysicsProfile, select, t,
}: PhysicsProfileSeatProps) {
  const state = usePhysicsProfile(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const current = STUDENT_PROFILES.find(profile => profile.id === state.current) ?? STUDENT_PROFILES[0]

  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      selectedId={state.current}
      align="start"
      portal
      items={STUDENT_PROFILES.map(profile => ({
        id: profile.id,
        icon: <ProfileIcon id={profile.id} />,
        label: (
          <span className={css.item}>
            <span className={css.itemName}>{t(NAME[profile.id])}</span>
            <span className={css.itemDesc}>{t(DESC[profile.id])}</span>
          </span>
        ),
      }))}
      onSelect={(id) => {
        setOpen(false)
        if (isProfileId(id)) void select(id)
      }}
      anchor={(
        <button
          type="button"
          className={css.seat}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('profile.aria')}
          title={state.error ?? t(DESC[current.id])}
          disabled={state.busy}
          onClick={() => { setOpen(value => !value) }}
        >
          <ProfileIcon id={current.id} />
          {t(NAME[current.id])}
          <IconChevronDownOutline14 className={css.chevron} />
        </button>
      )}
    />
  )
}

function isProfileId(id: string): id is PhysicsProfileId {
  return STUDENT_PROFILES.some(profile => profile.id === id)
}
