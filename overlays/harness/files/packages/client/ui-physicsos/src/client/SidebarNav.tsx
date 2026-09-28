/**
 * PhysicsOS product navigation.
 *
 * The target shell renders `sidebar.panellist` as one icon row per registered
 * main panel and owns those rows' labels, so it cannot express a sectioned
 * product rail or an entry that is not a panel — 首页 is the blank-Session
 * Conversation, not a `main` key. This column renders the product's own
 * structure into `sidebar.nav`; the panel rows stay below it for the surfaces
 * the rail does not present itself (学习记录 / 管理后台 / the shell's own).
 *
 * 出卷专区 is a teacher surface — the host refuses a student's writes and the
 * page refuses itself — so offering the entry would invite a door that does not
 * open. Everything else on this rail is for everyone.
 */

import clsx from 'clsx'
import { IconNewChatOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { isTeachingRole, type AuthState } from './auth-store.ts'
import {
  IconAnnouncement, IconLibrary, IconPhysicsLab, IconQuestionSheet,
} from './icons/physics-icons.tsx'
import type { SnapshotStore } from './runtime-compat.ts'
import type { PhysicsSurfaceId, PhysicsSurfaceState } from './surface-store.ts'
import css from './SidebarNav.module.css'

/** Registration-side face for {@link SidebarNav}. */
export interface SidebarNavInjected {
  hooks: {
    physicsSurface: SnapshotStore<PhysicsSurfaceState>
    /** Session principal — decides which entries this account is offered. */
    auth: SnapshotStore<AuthState>
  }
  /** Open a product surface (首页 is the blank-Session Conversation). */
  openSurface: (surface: PhysicsSurfaceId) => void
}

/** Slot props for product navigation. */
export type SidebarNavProps =
  & PropsRuntime<'sidebar.nav'>
  & PropsLocale<'physicsos'>
  & InjectFace<SidebarNavInjected>

/**
 * Render the product navigation column.
 * @param props - the sidebar fold state, the current surface, and the account.
 * @returns the sectioned product rail, or the icon rail when collapsed.
 */
export function SidebarNav({ wide, openSurface, usePhysicsSurface, useAuth, t }: SidebarNavProps) {
  const surface = usePhysicsSurface(snapshot => snapshot.surface)
  const role = useAuth(state => state.user?.role)
  const teaching = isTeachingRole(role)
  const iconSize = wide ? 16 : 18
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
        <IconNewChatOutlineMedium size={iconSize} />
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
        <IconPhysicsLab size={iconSize} />
        {wide && <span>{t('nav.lab')}</span>}
      </button>
      {teaching && (
        <button
          type="button"
          className={clsx(css.item, surface === 'paper' && css.active)}
          aria-label={t('nav.paper')}
          aria-current={surface === 'paper' ? 'page' : undefined}
          title={wide ? undefined : t('nav.paper')}
          onClick={() => { openSurface('paper') }}
        >
          <IconQuestionSheet size={iconSize} />
          {wide && <span>{t('nav.paper')}</span>}
        </button>
      )}
      <button
        type="button"
        className={clsx(css.item, surface === 'notice' && css.active)}
        aria-label={t('nav.notice')}
        aria-current={surface === 'notice' ? 'page' : undefined}
        title={wide ? undefined : t('nav.notice')}
        onClick={() => { openSurface('notice') }}
      >
        <IconAnnouncement size={iconSize} />
        {wide && <span>{t('nav.notice')}</span>}
      </button>
      <button
        type="button"
        className={clsx(css.item, surface === 'library' && css.active)}
        aria-label={t('nav.library')}
        aria-current={surface === 'library' ? 'page' : undefined}
        title={wide ? undefined : t('nav.library')}
        onClick={() => { openSurface('library') }}
      >
        <IconLibrary size={iconSize} />
        {wide && <span>{t('nav.library')}</span>}
      </button>
    </nav>
  )
}
