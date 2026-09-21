import clsx from 'clsx'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarBrandOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { PhysicsOSMark } from './PhysicsOSMark.tsx'
import type { AuthState } from './auth-store.ts'
import css from './SidebarBrand.module.css'

export type SidebarBrandInjected = {
  openHome: () => void
  hooks: {
    auth: SnapshotStore<AuthState>
  }
}

export type SidebarBrandProps =
  & PropsRuntime<'sidebar.brand'>
  & SidebarBrandOwnerProps
  & InjectFace<SidebarBrandInjected>
  & PropsLocale<'physicsos'>

/** Wide wordmark or rail mark for the sidebar brand hole. */
export function SidebarBrand({ wide, openHome, useAuth, t }: SidebarBrandProps) {
  const schoolName = useAuth(state => state.user?.schoolName)
  if (!wide) return <PhysicsOSMark size={24} className={css.rail} />
  return (
    <button
      type="button"
      className={clsx(css.wordmark)}
      aria-label={t('brand.home')}
      onClick={() => { openHome() }}
    >
      <PhysicsOSMark size={22} className={css.mark} />
      <span className={css.brandCol}>
        <span className={css.name}>{t('brand.name')}</span>
        {schoolName !== undefined && <span className={css.school}>{schoolName}</span>}
      </span>
    </button>
  )
}
