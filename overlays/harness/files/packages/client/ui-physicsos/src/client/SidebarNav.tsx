/**
 * PhysicsOS product navigation.
 *
 * The target shell renders `sidebar.panellist` as one icon row per registered
 * main panel and owns those rows' labels, so it cannot express a sectioned
 * product rail or an entry that is not a panel — 首页 is the blank-Session
 * Conversation, not a `main` key. This column renders the product's own
 * structure into `sidebar.nav`; the panel rows stay below it for the surfaces
 * the rail does not present itself (the shell's own plugins).
 *
 * Rows take the shell's own row metrics (8px inset, 12px radius, 36px tall), so
 * a shell-drawn row below them lands on the same axis rather than 2px off.
 *
 * 出卷专区 is a teacher surface — the host refuses a student's writes and the
 * page refuses itself — so offering the entry would invite a door that does not
 * open. Everything else on this rail is for everyone.
 */

import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconChevronDownOutlineMedium, IconNewChatOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { isTeachingRole, type AuthState } from './auth-store.ts'
import {
  IconAnnouncement, IconLibrary, IconPhysicsLab, IconQuestionSheet,
} from './icons/physics-icons.tsx'
import type { PhysicsosKey } from './locales.ts'
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

/** Where the folded groups are remembered, per browser. */
const COLLAPSED_STORAGE_KEY = 'physicsos.sidebar.collapsed-groups'

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY)
    return raw === null ? {} : JSON.parse(raw) as Record<string, boolean>
  } catch {
    /* Private mode and a hostile value both mean "nothing folded yet". */
    return {}
  }
}

/**
 * Render the product navigation column.
 * @param props - the sidebar fold state, the current surface, and the account.
 * @returns the sectioned product rail, or the icon rail when collapsed.
 */
export function SidebarNav({ wide, openSurface, usePhysicsSurface, useAuth, t }: SidebarNavProps) {
  const surface = usePhysicsSurface(snapshot => snapshot.surface)
  const role = useAuth(state => state.user?.role)
  const teaching = isTeachingRole(role)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed)
  const iconSize = wide ? 16 : 18

  /* The rail has no labels, so a folded group there would be unreachable: the
     fold only applies to the expanded column. */
  const isOpen = (group: string): boolean => !wide || collapsed[group] !== true
  const toggleGroup = (group: string): void => {
    setCollapsed((previous) => {
      const next = { ...previous, [group]: previous[group] !== true }
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* A browser that refuses storage still gets the fold for this page. */
      }
      return next
    })
  }

  const groupHeader = (group: string, label: PhysicsosKey): ReactNode => (
    <p className={css.group}>
      <span>{t(label)}</span>
      <button
        type="button"
        className={clsx(css.groupToggle, !isOpen(group) && css.groupToggleFolded)}
        aria-expanded={isOpen(group)}
        aria-label={t(isOpen(group) ? 'nav.group.fold' : 'nav.group.unfold')}
        onClick={() => { toggleGroup(group) }}
      >
        <IconChevronDownOutlineMedium size={14} />
      </button>
    </p>
  )

  const item = (
    id: PhysicsSurfaceId,
    label: PhysicsosKey,
    glyph: ReactNode,
  ): ReactNode => (
    <button
      key={id}
      type="button"
      className={clsx(css.item, surface === id && css.active)}
      aria-label={t(label)}
      aria-current={surface === id ? 'page' : undefined}
      title={wide ? undefined : t(label)}
      onClick={() => { openSurface(id) }}
    >
      {glyph}
      {wide && <span>{t(label)}</span>}
    </button>
  )

  return (
    <nav className={clsx(css.root, !wide && css.rail)} aria-label={t('brand.name')}>
      {wide && groupHeader('home', 'nav.group.home')}
      {isOpen('home') && item('home', 'nav.home', <IconNewChatOutlineMedium size={iconSize} />)}

      {wide && groupHeader('explore', 'nav.group.explore')}
      {isOpen('explore') && (
        <>
          {item('lab', 'nav.lab', <IconPhysicsLab size={iconSize} />)}
          {teaching && item('paper', 'nav.paper', <IconQuestionSheet size={iconSize} />)}
          {item('notice', 'nav.notice', <IconAnnouncement size={iconSize} />)}
          {item('library', 'nav.library', <IconLibrary size={iconSize} />)}
        </>
      )}
    </nav>
  )
}
