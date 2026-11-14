/** PhysicsOS header selects account workspaces; it never offers host directory browsing. */
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  IconChevronDownOutlineMedium, IconFolderOpenOutlineMedium, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceId } from './runtime-compat.ts'
import { accountWorkspaceName, WorkspacePanel, type WorkspacePanelInjected } from './WorkspacePanel.tsx'
import css from './HeaderWorkspace.module.css'

/** The exact same account actions as the existing product WorkspacePanel. */
export type HeaderWorkspaceInjected = Omit<WorkspacePanelInjected, 'hooks'> & {
  readonly selectWorkspace: (workspaceId: WorkspaceId) => Promise<void>
}
export type HeaderWorkspaceProps = PropsRuntime<'sidebar.workspacePicker'>
  & InjectFace<HeaderWorkspaceInjected>
  & PropsLocale<'physicsos'>

/** Framework standing hooks carry the current account list and retained main session. */
export function HeaderWorkspace(props: HeaderWorkspaceProps) {
  const { useWorkspaces, useSessions, selectWorkspace, t } = props
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const workspaces = useWorkspaces(snapshot => snapshot.items)
  const currentSessionId = useSessions(snapshot =>
    snapshot.ids.find(id => (snapshot.byId[id]?.retainedBy.mainView ?? 0) > 0))
  const selected = currentSessionId === undefined ? undefined
    : workspaces.find(workspace => workspace.sessionIds.includes(currentSessionId))
  const title = selected === undefined ? t('workspacePanel.title') : accountWorkspaceName(selected.title, t)
  const close = (): void => {
    setOpen(false)
    queueMicrotask(() => { trigger.current?.focus() })
  }
  return (
    <div className={css.root}>
      <Tooltip label={title} side="bottom" portal delayMs={500}>
        <button ref={trigger} type="button" className={css.trigger} disabled={busy} aria-busy={busy}
          aria-label={selected === undefined ? t('workspacePanel.title') : `${t('workspacePanel.title')} · ${title}`}
          aria-haspopup="dialog" aria-expanded={open} onClick={() => { setFailed(false); setOpen(true) }}>
          <IconFolderOpenOutlineMedium size={15} /><span>{title}</span><IconChevronDownOutlineMedium size={12} />
        </button>
      </Tooltip>
      {typeof document === 'undefined' ? null : createPortal(<WorkspacePanel {...props} open={open} anchorRef={trigger} selectedId={selected?.workspaceId} onClose={close}
        onPick={(workspaceId) => {
          close()
          setBusy(true)
          setFailed(false)
          void selectWorkspace(workspaceId).catch(() => { setFailed(true) }).finally(() => { setBusy(false) })
        }} />, document.body)}
      {failed ? <span className={css.error} role="alert">{t('workspacePanel.error')}</span> : null}
    </div>
  )
}
