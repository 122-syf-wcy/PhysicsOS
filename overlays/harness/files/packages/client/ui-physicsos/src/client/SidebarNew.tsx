/**
 * Sidebar create control. Occupies `sidebar.new` so the student never sees
 * “新会话”; only product flows with implemented destinations are enabled.
 *
 * "新建物理实验" opens the shared experiment picker (the same chooser the Home
 * quick action and the Lab empty state use), so there is ONE template list. The
 * picker builds a real PhysicsScene and hands it to the Lab, which stays the
 * single workspace shell.
 */

import { useState } from 'react'
import clsx from 'clsx'
import { IconNewChatOutline16, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PhysicsScene } from '@physicsos/physics-scene'
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
  /** With a `sceneRef` the Lab continues that scene; without one it opens the picker. */
  openSurface: (
    surface: 'lab' | 'questions' | 'home',
    sceneRef?: { sceneId: string; scene: PhysicsScene },
  ) => void
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

  /* No inline template list: "新建物理实验" opens the full experiment picker,
     which is the one place templates live. Keeping a second list here would
     drift out of sync with the registry the picker reads. */
  const entries: MenuEntry[] = ITEMS.map(item => ({
    id: item.id,
    label: t(item.label),
    disabled: item.disabled === true,
  }))

  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      align="start"
      portal
      dense
      items={entries}
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
