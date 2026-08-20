import clsx from 'clsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarBrandOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { PhysicsOSMark } from './PhysicsOSMark.tsx'
import css from './SidebarBrand.module.css'

export type SidebarBrandInjected = {
  openHome: () => void
}

export type SidebarBrandProps =
  & PropsRuntime<'sidebar.brand'>
  & SidebarBrandOwnerProps
  & SidebarBrandInjected
  & PropsLocale<'physicsos'>

/** Wide wordmark or rail mark for the sidebar brand hole. */
export function SidebarBrand({ wide, openHome, t }: SidebarBrandProps) {
  if (!wide) return <PhysicsOSMark size={24} className={css.rail} />
  return (
    <button
      type="button"
      className={clsx(css.wordmark)}
      aria-label={t('brand.home')}
      onClick={() => { openHome() }}
    >
      <PhysicsOSMark size={22} className={css.mark} />
      <span className={css.name}>{t('brand.name')}</span>
    </button>
  )
}
