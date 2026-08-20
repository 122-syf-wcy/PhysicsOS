import { IconFolderOpen16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { formatUpdatedAt } from './workspaceMeta.ts'
import css from './RecentSpaces.module.css'

/** Registration-side face for {@link RecentSpaces}. */
export interface RecentSpacesInjected {
  startSession: (workspaceId?: WorkspaceId) => void
}

/** Slot props for the sidebar recent-space list. */
export type RecentSpacesProps =
  PropsRuntime<'sidebar.workspaces'>
  & RecentSpacesInjected
  & PropsLocale<'physicsos'>

/**
 * Compact recent Scene / Question Workspace list. Replaces the Harness
 * session browser so students never see workspace/session management chrome.
 * @param props - column width, workspace list, and product copy.
 */
export function RecentSpaces({ wide, startSession, useWorkspaces, t }: RecentSpacesProps) {
  const items = useWorkspaces(s => s.items)
  if (!wide) return <div className={css.rail} aria-hidden="true" />
  return (
    <section className={css.root} aria-label={t('recent.title')}>
      <h2 className={css.title}>{t('recent.title')}</h2>
      {items.length === 0 ? (
        <p className={css.empty}>{t('recent.sidebarEmpty')}</p>
      ) : (
        <ul className={css.list}>
          {items.slice(0, 8).map(workspace => (
            <li key={workspace.workspaceId as string}>
              <button
                type="button"
                className={css.item}
                onClick={() => { startSession(workspace.workspaceId) }}
              >
                <IconFolderOpen16 size={16} />
                <span className={css.name}>{workspace.title}</span>
                <span className={css.time}>{formatUpdatedAt(workspace.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
