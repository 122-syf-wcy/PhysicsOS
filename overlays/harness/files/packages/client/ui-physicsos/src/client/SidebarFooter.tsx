import { useState } from 'react'
import clsx from 'clsx'
import {
  IconListPenOutlineMedium, IconUserOutlineMedium, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from './runtime-compat.ts'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { buildStamp } from './build-stamp.ts'
import type { AuthState } from './auth-store.ts'
import css from './SidebarFooter.module.css'

export type SidebarFooterInjected = {
  startSession: () => void
  /** Open the 学习记录 surface. */
  openRecord?: () => void
  /** Open the 学习空间 (PhysicsOS home) surface. */
  openHome: () => void
  /** Open the 管理后台 surface — offered only to SCHOOL_ADMIN/SUPER_ADMIN. */
  openAdmin?: () => void
  /** Revoke the server session and return to the auth gate. */
  logout: () => Promise<void>
  hooks: {
    auth: SnapshotStore<AuthState>
  }
}

export type SidebarFooterProps =
  SidebarFooterActionOwnerProps
  & InjectFace<SidebarFooterInjected>
  & PropsLocale<'physicsos'>

/** Learning history and library seats above Settings, plus the account menu. */
export function SidebarFooter({ wide, openRecord, openHome, openAdmin, logout, useAuth, t }: SidebarFooterProps) {
  const user = useAuth(state => state.user)
  const [menuOpen, setMenuOpen] = useState(false)

  /* The menu only OFFERS the admin entry — the host re-checks the role on
     every call, so hiding it here is convenience, never the security check. */
  const isAdmin = user?.role === 'SCHOOL_ADMIN' || user?.role === 'SUPER_ADMIN'

  const accountItems: MenuEntry[] = user === undefined ? [] : [
    { type: 'label', id: 'identity', text: `${user.displayName} · ${user.username}` },
    { type: 'label', id: 'school', text: user.schoolName },
    { type: 'separator', id: 'sep-1' },
    { id: 'space', label: t('auth.menu.space') },
    ...(isAdmin && openAdmin !== undefined
      ? [{ id: 'admin', label: t('auth.menu.admin') } satisfies MenuEntry]
      : []),
    { type: 'separator', id: 'sep-2' },
    { id: 'logout', label: t('auth.menu.logout'), danger: true },
    /* 版本戳放在菜单最下面:用户报障时被问的就是「你用的是哪个版本」,而这里
       是他已经知道要打开的地方。它是 label 而不是可点项 —— 没有可做的动作。 */
    { type: 'separator', id: 'sep-3' },
    { type: 'label', id: 'version', text: `${t('auth.menu.version')} ${buildStamp()}` },
  ]

  const onAccountSelect = (id: string): void => {
    setMenuOpen(false)
    if (id === 'space') openHome()
    if (id === 'admin') openAdmin?.()
    if (id === 'logout') void logout()
  }

  return (
    <div className={clsx(css.root, !wide && css.rail)}>
      <button
        type="button"
        className={css.item}
        aria-label={t('nav.history')}
        title={wide ? undefined : t('nav.history')}
        onClick={() => { openRecord?.() }}
      >
        <IconListPenOutlineMedium size={wide ? 16 : 18} />
        {wide && <span>{t('nav.history')}</span>}
      </button>
      {user !== undefined && (
        <Menu
          open={menuOpen}
          side="top"
          align="start"
          portal
          items={accountItems}
          onSelect={onAccountSelect}
          onClose={() => { setMenuOpen(false) }}
          anchor={(
            <button
              type="button"
              className={clsx(css.item, css.account)}
              aria-label={t('auth.menu.aria')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title={wide ? undefined : `${user.displayName} · ${user.schoolName}`}
              onClick={() => { setMenuOpen(current => !current) }}
            >
              <span className={css.avatar} aria-hidden>
                {user.avatarUrl === undefined
                  ? (user.displayName.trim().charAt(0) || <IconUserOutlineMedium size={14} />)
                  : <img src={user.avatarUrl} alt="" className={css.avatarImg} />}
              </span>
              {wide && <span className={css.accountName}>{user.displayName}</span>}
            </button>
          )}
        />
      )}
    </div>
  )
}
