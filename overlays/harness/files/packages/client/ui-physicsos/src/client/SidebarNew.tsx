/**
 * Sidebar create control. Occupies `sidebar.new` so the student never sees
 * “新会话”; only product flows with implemented destinations are enabled.
 */

import { useState } from 'react'
import clsx from 'clsx'
import { IconNewChatOutline16, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PhysicsosKey } from './locales.ts'
import css from './SidebarNew.module.css'

const ITEMS: readonly { id: string; label: PhysicsosKey; disabled?: boolean }[] = [
  { id: 'lab', label: 'create.lab' },
  { id: 'upload', label: 'create.upload' },
  { id: 'blank', label: 'create.blank', disabled: true },
  { id: 'import', label: 'create.import', disabled: true },
]

/** Registration-side face for {@link SidebarNew}. */
export interface SidebarNewInjected {
  startSession: (workspaceId?: WorkspaceId) => void
  openSurface: (surface: 'lab' | 'questions' | 'home') => void
}

/** Slot props for the sidebar create control. */
export type SidebarNewProps =
  PropsRuntime<'sidebar.new'>
  & SidebarNewInjected
  & PropsLocale<'physicsos'>

/**
 * Render the “新建” control and its create menu.
 * @param props - column width, session start, and product copy.
 */
export function SidebarNew({ wide, openSurface, t }: SidebarNewProps) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      align="start"
      portal
      items={ITEMS.map(item => ({
        id: item.id,
        label: t(item.label),
        disabled: item.disabled === true,
      }))}
      onSelect={(id) => {
        setOpen(false)
        if (id === 'lab') openSurface('lab')
        else if (id === 'upload') openSurface('questions')
      }}
      anchor={(
        <button
          type="button"
          className={clsx(css.button, !wide && css.rail)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('create.aria')}
          onClick={() => { setOpen(value => !value) }}
        >
          <IconNewChatOutline16 size={wide ? 14 : 18} />
          {wide ? <span className={css.label}>{t('create.label')}</span> : null}
        </button>
      )}
    />
  )
}
