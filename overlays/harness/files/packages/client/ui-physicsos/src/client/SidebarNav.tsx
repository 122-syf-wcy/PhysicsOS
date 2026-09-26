import clsx from 'clsx'
import { IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconAnnouncement, IconClassUsers, IconLibrary, IconPhysicsLab, IconQuestionSheet,
} from './icons/physics-icons.tsx'
import { isTeachingRole, type AuthState } from './auth-store.ts'
import type { PhysicsSurfaceId, PhysicsSurfaceState } from './surface-store.ts'
import css from './SidebarNav.module.css'

/** Registration-side face for {@link SidebarNav}. */
export interface SidebarNavInjected {
  hooks: {
    physicsSurface: SnapshotStore<PhysicsSurfaceState>
    /** Session principal — decides which entries this account is offered. */
    auth: SnapshotStore<AuthState>
  }
  /**
   * Open a product surface. `drawerOpen` reports whether the click came from
   * the expanded sidebar rather than the resting rail, which is what decides
   * if the click should also close the narrow-viewport drawer.
   */
  openSurface: (surface: PhysicsSurfaceId, drawerOpen: boolean) => void
}

/**
 * Slot props for product navigation. `PropsRuntime` already carries the slot
 * owner's props (the sidebar's `wide`), so intersecting `SidebarNavOwnerProps`
 * again would demand it from the registration's inject face instead.
 */
export type SidebarNavProps =
  & PropsRuntime<'sidebar.nav'>
  & PropsLocale<'physicsos'>
  & InjectFace<SidebarNavInjected>

/** PhysicsOS product navigation. */
export function SidebarNav({ wide, openSurface, usePhysicsSurface, useAuth, t }: SidebarNavProps) {
  const surface = usePhysicsSurface(snapshot => snapshot.surface)
  const role = useAuth(state => state.user?.role)
  /* 出卷专区 is a teacher surface — the host refuses a student's writes and the
     page refuses itself — so offering the entry would be an invitation to a
     door that does not open. Everything else on this rail is for everyone. */
  const teaching = isTeachingRole(role)
  /* One surface, two greetings: the same room is 班级教学 to a teacher and
     我的班级 to a student. The host re-checks the role on every call. */
  const classLabel = teaching ? t('nav.class') : t('nav.class.mine')
  return (
    <nav className={clsx(css.root, !wide && css.rail)} aria-label={t('brand.name')}>
      {wide && <p className={css.group}>{t('nav.group.home')}</p>}
      <button
        type="button"
        className={clsx(css.item, surface === 'home' && css.active)}
        aria-label={t('nav.home')}
        aria-current={surface === 'home' ? 'page' : undefined}
        title={wide ? undefined : t('nav.home')}
        onClick={() => { openSurface('home', wide) }}
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
        onClick={() => { openSurface('lab', wide) }}
      >
        <IconPhysicsLab size={wide ? 16 : 18} />
        {wide && <span>{t('nav.lab')}</span>}
      </button>
      {teaching && (
        <button
          type="button"
          className={clsx(css.item, surface === 'paper' && css.active)}
          aria-label={t('nav.paper')}
          aria-current={surface === 'paper' ? 'page' : undefined}
          title={wide ? undefined : t('nav.paper')}
          onClick={() => { openSurface('paper', wide) }}
        >
          <IconQuestionSheet size={wide ? 16 : 18} />
          {wide && <span>{t('nav.paper')}</span>}
        </button>
      )}
      <button
        type="button"
        className={clsx(css.item, surface === 'class' && css.active)}
        aria-label={classLabel}
        aria-current={surface === 'class' ? 'page' : undefined}
        title={wide ? undefined : classLabel}
        onClick={() => { openSurface('class', wide) }}
      >
        <IconClassUsers size={wide ? 16 : 18} />
        {wide && <span>{classLabel}</span>}
      </button>
      <button
        type="button"
        className={clsx(css.item, surface === 'notice' && css.active)}
        aria-label={t('nav.notice')}
        aria-current={surface === 'notice' ? 'page' : undefined}
        title={wide ? undefined : t('nav.notice')}
        onClick={() => { openSurface('notice', wide) }}
      >
        <IconAnnouncement size={wide ? 16 : 18} />
        {wide && <span>{t('nav.notice')}</span>}
      </button>
      <button
        type="button"
        className={clsx(css.item, surface === 'library' && css.active)}
        aria-label={t('nav.library')}
        aria-current={surface === 'library' ? 'page' : undefined}
        title={wide ? undefined : t('nav.library')}
        onClick={() => { openSurface('library', wide) }}
      >
        <IconLibrary size={wide ? 16 : 18} />
        {wide && <span>{t('nav.library')}</span>}
      </button>
    </nav>
  )
}
