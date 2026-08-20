import clsx from 'clsx'
import { IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarNavOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { IconPhysicsLab, IconQuestionSheet } from './icons/physics-icons.tsx'
import type { PhysicsSurfaceId, PhysicsSurfaceState } from './surface-store.ts'
import css from './SidebarNav.module.css'

/** Registration-side face for {@link SidebarNav}. */
export interface SidebarNavInjected {
  hooks: {
    physicsSurface: SnapshotStore<PhysicsSurfaceState>
  }
  openSurface: (surface: PhysicsSurfaceId) => void
}

/** Slot props for product navigation. */
export type SidebarNavProps =
  & PropsRuntime<'sidebar.nav'>
  & SidebarNavOwnerProps
  & PropsLocale<'physicsos'>
  & InjectFace<SidebarNavInjected>

/** PhysicsOS product navigation. */
export function SidebarNav({ wide, openSurface, usePhysicsSurface, t }: SidebarNavProps) {
  const surface = usePhysicsSurface(snapshot => snapshot.surface)
  return (
    <nav className={clsx(css.root, !wide && css.rail)} aria-label={t('brand.name')}>
      {wide && <p className={css.group}>{t('nav.group.home')}</p>}
      <button
        type="button"
        className={clsx(css.item, surface === 'home' && css.active)}
        aria-label={t('nav.home')}
        aria-current={surface === 'home' ? 'page' : undefined}
        title={wide ? undefined : t('nav.home')}
        onClick={() => { openSurface('home') }}
      >
        <IconNewChatOutline16 size={wide ? 16 : 18} />
        {wide && <span>{t('nav.home')}</span>}
      </button>
      {wide && <p className={css.group}>{t('nav.group.explore')}</p>}
      <button
        type="button"
        className={clsx(css.item, surface === 'lab' && css.active)}
        aria-label={t('nav.lab')}
        aria-current={surface === 'lab' ? 'page' : undefined}
        title={wide ? undefined : t('nav.lab')}
        onClick={() => { openSurface('lab') }}
      >
        <IconPhysicsLab size={wide ? 16 : 18} />
        {wide && <span>{t('nav.lab')}</span>}
      </button>
      <button
        type="button"
        className={clsx(css.item, surface === 'questions' && css.active)}
        aria-label={t('nav.questions')}
        aria-current={surface === 'questions' ? 'page' : undefined}
        title={wide ? undefined : t('nav.questions')}
        onClick={() => { openSurface('questions') }}
      >
        <IconQuestionSheet size={wide ? 16 : 18} />
        {wide && <span>{t('nav.questions')}</span>}
      </button>
    </nav>
  )
}
