import clsx from 'clsx'
import {
  IconFolderOpenOutline16, IconListPenOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './SidebarFooter.module.css'

export type SidebarFooterInjected = {
  startSession: () => void
  /** Open the 学习记录 surface. */
  openRecord?: () => void
}

export type SidebarFooterProps =
  & PropsRuntime<'sidebar.footer.action'>
  & SidebarFooterActionOwnerProps
  & SidebarFooterInjected
  & PropsLocale<'physicsos'>

/** Learning history and library seats above Settings. */
export function SidebarFooter({ wide, openRecord, t }: SidebarFooterProps) {
  return (
    <div className={clsx(css.root, !wide && css.rail)}>
      <button
        type="button"
        className={css.item}
        aria-label={t('nav.history')}
        title={wide ? undefined : t('nav.history')}
        onClick={() => { openRecord?.() }}
      >
        <IconListPenOutline16 size={wide ? 16 : 18} />
        {wide && <span>{t('nav.history')}</span>}
      </button>
      <button
        type="button"
        className={css.item}
        aria-label={t('nav.library')}
        disabled
        title={t('feature.unavailable')}
      >
        <IconFolderOpenOutline16 size={wide ? 16 : 18} />
        {wide && <span>{t('nav.library')}</span>}
      </button>
    </div>
  )
}
