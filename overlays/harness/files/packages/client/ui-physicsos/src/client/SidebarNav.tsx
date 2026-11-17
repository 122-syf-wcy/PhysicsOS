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
  IconNewChatOutlineMedium, Menu, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { isTeachingRole, type AuthState } from './auth-store.ts'
import {
  IconPhysicsLab, IconCourseware,
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

const navigationIconClasses = {
  projects: css.projectsIcon,
  canvas: css.canvasIcon,
  whiteboard: css.whiteboardIcon,
}

/** Generated alpha masks inherit the row's theme, hover, and active colors. */
function NavigationIcon({ name, size }: { name: keyof typeof navigationIconClasses; size: number }) {
  return (
    <span
      aria-hidden="true"
      className={clsx(css.generatedIcon, navigationIconClasses[name])}
      style={{ width: size, height: size }}
    />
  )
}

/**
 * Render the product navigation column.
 * @param props - the sidebar fold state, the current surface, and the account.
 * @returns the sectioned product rail, or the icon rail when collapsed.
 */
export function SidebarNav({ panels = [], selectPanel, openSurface, usePhysicsSurface, useAuth, t }: SidebarNavProps) {
  const surface = usePhysicsSurface(snapshot => snapshot.surface)
  const role = useAuth(state => state.user?.role)
  const teaching = isTeachingRole(role)
  const [moreOpen, setMoreOpen] = useState(false)
  const iconSize = 20
  const moreItems = [
    { id: 'whiteboard', label: t('whiteboard.title') },
    ...(teaching ? [{ id: 'paper', label: t('nav.paper') }] : []),
    { id: 'notice', label: t('nav.notice') },
    { id: 'contribute', label: t('nav.contribute') },
    ...panels.map(panel => ({ id: `panel:${panel.id}`, label: panel.label })),
  ]

  const item = (
    id: PhysicsSurfaceId,
    label: PhysicsosKey,
    glyph: ReactNode,
  ): ReactNode => (
    <Tooltip key={id} label={t(label)} side="right" portal>
      <button
        type="button"
        className={clsx(css.item, surface === id && css.active)}
        aria-label={t(label)}
        aria-current={surface === id ? 'page' : undefined}
        title={t(label)}
        onClick={() => { openSurface(id) }}
      >
        {glyph}
      </button>
    </Tooltip>
  )

  return (
    <nav className={clsx(css.root, css.rail)} aria-label={t('brand.name')} data-physicsos-navigation>
      {item('home', 'nav.home', <IconNewChatOutlineMedium size={iconSize} />)}
      {item('lab', 'nav.lab', <IconPhysicsLab size={iconSize} />)}
      {item('projects', 'nav.projects', <NavigationIcon name="projects" size={iconSize} />)}
      {item('canvas', 'nav.canvas', <NavigationIcon name="canvas" size={iconSize} />)}
      {item('courseware', 'nav.courseware', <IconCourseware size={iconSize} />)}
      <Menu open={moreOpen} items={moreItems} portal side="right" align="end"
        onClose={() => { setMoreOpen(false) }}
        onSelect={(id) => {
          setMoreOpen(false)
          const panel = panels.find(item => `panel:${item.id}` === id)
          if (panel !== undefined) selectPanel?.(panel.id)
          else if (id === 'notice' || id === 'contribute' || id === 'whiteboard' || (id === 'paper' && teaching)) openSurface(id)
        }}
        anchor={<button type="button" className={clsx(css.item, (surface === 'whiteboard' || surface === 'paper') && css.active)} aria-label={t('nav.more')} aria-current={surface === 'whiteboard' || surface === 'paper' ? 'page' : undefined} aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => { setMoreOpen(value => !value) }}><span aria-hidden="true">···</span></button>} />
    </nav>
  )
}
