import { useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  IconEllipsisOutlineRegular, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from './runtime-compat.ts'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { buildStamp } from './build-stamp.ts'
import type { AuthController, AuthState } from './auth-store.ts'
import { AvatarImage, AvatarPicker } from './AvatarPicker.tsx'
import css from './SidebarFooter.module.css'

export type SidebarFooterInjected = {
  /** Open the 学习记录 surface. */
  openRecord?: () => void
  /** Open the 管理后台 surface — offered only to SCHOOL_ADMIN/SUPER_ADMIN. */
  openAdmin?: () => void
  /** Revoke the server session and return to the auth gate. */
  logout: () => Promise<void>
  /** Absent on seats without a cookie-backed avatar controller. */
  setAvatar?: AuthController['setAvatar']
  hooks: {
    auth: SnapshotStore<AuthState>
  }
}

export type SidebarFooterProps =
  SidebarFooterActionOwnerProps
  & InjectFace<SidebarFooterInjected>
  & PropsLocale<'physicsos'>

/** Separate self-avatar and account-menu targets remain discoverable in rail mode. */
export function SidebarFooter({ wide, openRecord, openAdmin, logout, setAvatar, useAuth, t }: SidebarFooterProps) {
  const user = useAuth(state => state.status === 'authed' ? state.user : undefined)
  const owner = user === undefined ? undefined : JSON.stringify([user.id, user.schoolId, user.username])
  const [menuOwner, setMenuOwner] = useState<string | undefined>()
  const [pickerOwner, setPickerOwner] = useState<string | undefined>()
  const menuOpen = owner !== undefined && menuOwner === owner
  const pickerOpen = owner !== undefined && pickerOwner === owner
  useEffect(() => { setMenuOwner(undefined); setPickerOwner(undefined) }, [owner])
  const openPicker = (): void => { setMenuOwner(undefined); setPickerOwner(owner) }

  /* The host re-checks the role on every admin call; offering a menu is not authority. */
  const isAdmin = user?.role === 'SCHOOL_ADMIN' || user?.role === 'SUPER_ADMIN'
  const accountItems: MenuEntry[] = user === undefined ? [] : [
    { type: 'label', id: 'identity', text: `${user.displayName} · ${user.username}` },
    { type: 'label', id: 'school', text: user.schoolName },
    { type: 'separator', id: 'sep-1' },
    ...(setAvatar === undefined ? [] : [{ id: 'avatar', label: '更换头像' } satisfies MenuEntry]),
    /* 学习记录 belongs in this user's account menu, not another footer row. */
    ...(openRecord === undefined ? [] : [{ id: 'record', label: t('nav.history') } satisfies MenuEntry]),
    ...(isAdmin && openAdmin !== undefined
      ? [{ id: 'admin', label: t('auth.menu.admin') } satisfies MenuEntry]
      : []),
    { type: 'separator', id: 'sep-2' },
    { id: 'logout', label: t('auth.menu.logout'), danger: true },
    { type: 'separator', id: 'sep-3' },
    { type: 'label', id: 'version', text: `${t('auth.menu.version')} ${buildStamp()}` },
  ]
  const onAccountSelect = (id: string): void => {
    setMenuOwner(undefined)
    if (id === 'avatar') openPicker()
    if (id === 'record') openRecord?.()
    if (id === 'admin') openAdmin?.()
    if (id === 'logout') void logout()
  }

  return (
    <div className={clsx(css.root, !wide && css.rail)}>
      {user !== undefined && (
        <div className={css.accountRow}>
          {setAvatar !== undefined && <button
            type="button"
            className={css.avatarButton}
            aria-label="更换头像"
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            title={`${user.displayName} · 更换头像`}
            onClick={openPicker}
          ><AvatarImage src={user.avatarUrl} name={user.displayName} size={32} eager /></button>}
          <Menu
            className={css.accountMenu}
            open={menuOpen}
            side="bottom"
            align="start"
            portal
            items={accountItems}
            onSelect={onAccountSelect}
            onClose={() => { setMenuOwner(undefined) }}
            anchor={(
              <button
                type="button"
                className={css.item}
                aria-label={t('auth.menu.aria')}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title={wide ? undefined : `${user.displayName} · ${user.schoolName}`}
                onClick={() => { setMenuOwner(menuOpen ? undefined : owner) }}
              >
                {setAvatar === undefined && <AvatarImage src={user.avatarUrl} name={user.displayName} size={28} eager />}
                {wide && <span className={css.accountName}>{user.displayName}</span>}
                {setAvatar !== undefined && <IconEllipsisOutlineRegular size={16} />}
              </button>
            )}
          />
        </div>
      )}
      {user !== undefined && setAvatar !== undefined && <AvatarPicker
        open={pickerOpen}
        user={user}
        setAvatar={setAvatar}
        onClose={() => { setPickerOwner(undefined) }}
      />}
    </div>
  )
}
