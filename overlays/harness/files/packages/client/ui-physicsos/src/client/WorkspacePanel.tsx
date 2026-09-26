/** Account workspace picker and manager — no host paths, no filesystem tree. */

import { useState } from 'react'
import type { FormEvent } from 'react'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { IconFolderOpen16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { PhysicsosKey } from './locales.ts'
import css from './PlatformDialog.module.css'

/** Minimal account workspace row the panel renders. The host path is absent. */
export interface AccountWorkspaceRow {
  readonly id: string
  readonly name: string
}

/** The account-scoped workspace feed projected for the panel. */
export interface WorkspacePanelListView {
  readonly items: readonly { readonly workspaceId: string; readonly title: string }[]
  readonly state: 'idle' | 'loading' | 'ready' | 'error'
}

export interface WorkspacePanelState {
  open: boolean
}

export interface WorkspacePanelController {
  readonly store: SnapshotStore<WorkspacePanelState>
  open: () => void
  close: () => void
}

/** Build one panel controller per client composition. */
export function createWorkspacePanelController(): WorkspacePanelController {
  const store = createSnapshotStore<WorkspacePanelState>({ open: false })
  return {
    store,
    open: () => { store.set({ open: true }) },
    close: () => { store.set({ open: false }) },
  }
}

export interface WorkspacePanelInjected {
  readonly hooks: {
    readonly panel: SnapshotStore<WorkspacePanelState>
    readonly workspaces: SnapshotStore<WorkspacePanelListView>
  }
  readonly createWorkspace: (name: string) => Promise<AccountWorkspaceRow>
  readonly renameWorkspace: (id: string, name: string) => Promise<void>
  readonly openWorkspace: (id: string) => Promise<void>
  readonly close: () => void
}

export type WorkspacePanelProps =
  & PropsRuntime<'shell.overlay'>
  & InjectFace<WorkspacePanelInjected>
  & PropsLocale<'physicsos'>

const OPAQUE_TITLE = /^[a-f0-9]{16,}$/i

const humanName = (title: string | undefined, t: (key: PhysicsosKey) => string): string => {
  if (title === undefined || title.trim() === '' || OPAQUE_TITLE.test(title.trim())) {
    return t('workspacePanel.defaultName')
  }
  return title.trim()
}

/** Render the current account's workspace list and create/rename controls. */
export function WorkspacePanel({
  usePanel, useWorkspaces, createWorkspace, renameWorkspace, openWorkspace, close, t,
}: WorkspacePanelProps): React.ReactNode {
  const open = usePanel(state => state.open)
  const list = useWorkspaces(state => state)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<string | undefined>()
  const [renameValue, setRenameValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  if (!open) return null

  const run = async (job: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await job()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('workspacePanel.error'))
    } finally {
      setBusy(false)
    }
  }

  const create = (event: FormEvent): void => {
    event.preventDefault()
    const nextName = name.trim()
    if (nextName === '') return
    void run(async () => {
      const created = await createWorkspace(nextName)
      await openWorkspace(created.id)
      close()
    })
  }

  const rename = (event: FormEvent, id: string): void => {
    event.preventDefault()
    const nextName = renameValue.trim()
    if (nextName === '') return
    void run(async () => {
      await renameWorkspace(id, nextName)
      setRenaming(undefined)
    })
  }

  return (
    <div className={css.backdrop} data-physicsos-workspace-panel="">
      <section
        className={css.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="physicsos-workspace-title"
      >
        <header className={css.header}>
          <div>
            <p className={css.eyebrow}>PhysicsOS · Workspace</p>
            <h2 id="physicsos-workspace-title" className={css.title}>{t('workspacePanel.title')}</h2>
            <p className={css.hint}>{t('workspacePanel.hint')}</p>
          </div>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('workspacePanel.close')}
            disabled={busy}
            onClick={close}
          >
            ×
          </button>
        </header>

        {list.items.length === 0 ? (
          <p className={css.empty}>{t('workspacePanel.empty')}</p>
        ) : (
          <div className={css.list}>
            {list.items.map((workspace) => {
              const displayName = humanName(workspace.title, t)
              if (renaming === workspace.workspaceId) {
                return (
                  <form
                    key={workspace.workspaceId}
                    className={css.row}
                    onSubmit={(event) => { rename(event, workspace.workspaceId) }}
                  >
                    <input
                      className={css.input}
                      autoFocus
                      maxLength={80}
                      value={renameValue}
                      onChange={(event) => { setRenameValue(event.target.value) }}
                    />
                    <div className={css.rowActions}>
                      <button type="submit" className={css.primary} disabled={busy}>
                        {t('workspacePanel.save')}
                      </button>
                      <button
                        type="button"
                        className={css.ghost}
                        disabled={busy}
                        onClick={() => { setRenaming(undefined) }}
                      >
                        {t('workspacePanel.cancel')}
                      </button>
                    </div>
                  </form>
                )
              }
              return (
                <div key={workspace.workspaceId} className={css.row}>
                  <div className={css.rowBody}>
                    <p className={css.rowTitle}>{displayName}</p>
                    <p className={css.rowMeta}>{t('workspacePanel.personal')}</p>
                  </div>
                  <div className={css.rowActions}>
                    <button
                      type="button"
                      className={css.primary}
                      disabled={busy}
                      onClick={() => { void run(async () => { await openWorkspace(workspace.workspaceId); close() }) }}
                    >
                      {t('workspacePanel.open')}
                    </button>
                    <button
                      type="button"
                      className={css.ghost}
                      disabled={busy}
                      onClick={() => {
                        setRenaming(workspace.workspaceId)
                        setRenameValue(displayName)
                      }}
                    >
                      {t('workspacePanel.rename')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {list.items.length > 0 && !creating && (
          <div className={css.actions}>
            <button
              type="button"
              className={css.ghost}
              disabled={busy}
              onClick={() => { setCreating(true) }}
            >
              {t('workspacePanel.create')}
            </button>
          </div>
        )}

        {(creating || list.items.length === 0) && (
          <form className={css.form} onSubmit={create}>
            <label className={css.field}>
              <span className={css.label}>{t('workspacePanel.nameLabel')}</span>
              <input
                className={css.input}
                maxLength={80}
                placeholder={t('workspacePanel.namePlaceholder')}
                value={name}
                onChange={(event) => { setName(event.target.value) }}
              />
            </label>
            <div className={css.actions}>
              {list.items.length > 0 && (
                <button
                  type="button"
                  className={css.ghost}
                  disabled={busy}
                  onClick={() => { setCreating(false); setName('') }}
                >
                  {t('workspacePanel.cancel')}
                </button>
              )}
              <button type="submit" className={css.primary} disabled={busy || name.trim() === ''}>
                {busy ? t('workspacePanel.working') : t('workspacePanel.createRun')}
              </button>
            </div>
          </form>
        )}

        {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
      </section>
    </div>
  )
}

export interface WorkspacePickerTriggerInjected {
  readonly hooks: {
    readonly panel: SnapshotStore<WorkspacePanelState>
    readonly workspaces: SnapshotStore<WorkspacePanelListView>
  }
  readonly openPanel: () => void
}

export type WorkspacePickerTriggerProps =
  & PropsRuntime<'conversation.hero.workspace'>
  & InjectFace<WorkspacePickerTriggerInjected>
  & PropsLocale<'physicsos'>

/** Compact composer trigger that opens the product panel. */
export function WorkspacePickerTrigger({
  useWorkspaces, openPanel, t,
}: WorkspacePickerTriggerProps): React.ReactNode {
  const first = useWorkspaces(state => state.items[0])
  return (
    <button
      type="button"
      className={css.pick}
      aria-label={t('workspacePanel.title')}
      onClick={openPanel}
    >
      <IconFolderOpen16 size={15} />
      <span className={css.pickName}>{humanName(first?.title, t)}</span>
    </button>
  )
}
