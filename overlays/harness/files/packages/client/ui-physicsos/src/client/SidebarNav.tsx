import clsx from 'clsx'
import { IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconLibrary, IconPhysicsLab, IconQuestionSheet } from './icons/physics-icons.tsx'
import type { PhysicsSurfaceId, PhysicsSurfaceState } from './surface-store.ts'
import css from './SidebarNav.module.css'

/** Registration-side face for {@link SidebarNav}. */
export interface SidebarNavInjected {
  hooks: {
    physicsSurface: SnapshotStore<PhysicsSurfaceState>
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
