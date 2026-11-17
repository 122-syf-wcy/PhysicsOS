/** Account workspace picker and manager — no host paths, no filesystem tree. */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useModalFocus } from './use-modal-focus.ts'
import type { SnapshotStore, WorkspaceId } from './runtime-compat.ts'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PhysicsosKey } from './locales.ts'
import type { ProductLifecycle, ProjectProductState, ProductStateMutation } from './learning-api.ts'
import type { ProjectStateBridge } from './StudyProjects.tsx'
import { useProjectWorkspaceRows } from './project-workspace-view.ts'
import css from './PlatformDialog.module.css'
import workspaceCss from './WorkspacePanel.module.css'

/** Minimal account workspace row the panel renders. The host path is absent. */
export interface AccountWorkspaceRow { readonly id: string; readonly name: string }
export interface WorkspacePanelListView {
  readonly items: readonly { readonly workspaceId: string; readonly title: string }[]
  readonly state: 'idle' | 'loading' | 'ready' | 'error'
}
export interface WorkspacePanelInjected {
  readonly hooks: { readonly workspaces: SnapshotStore<WorkspacePanelListView> }
  readonly createWorkspace: (name: string) => Promise<AccountWorkspaceRow>
  readonly renameWorkspace: (id: string, name: string) => Promise<void>
  readonly projectState?: ProjectStateBridge
}
export type WorkspacePanelProps = PropsRuntime<'conversation.hero.workspace'> & InjectFace<WorkspacePanelInjected> & PropsLocale<'physicsos'>
const OPAQUE_TITLE = /^[a-f0-9]{16,}$/i
export const accountWorkspaceName = (title: string | undefined, t: (key: PhysicsosKey) => string): string =>
  title === undefined || title.trim() === '' || OPAQUE_TITLE.test(title.trim()) ? t('workspacePanel.defaultName') : title.trim()
interface WorkspaceLifecycleIntent {
  readonly account: string
  readonly id: string
  readonly name: string
  readonly mutation: ProductStateMutation
}

/** Deletion changes the personal project lifecycle; the native workspace and all materials stay retained. */
export function WorkspacePanel({ open, selectedId, onPick, onClose, useWorkspaces, createWorkspace, renameWorkspace, projectState, t }: WorkspacePanelProps): React.ReactNode {
  const source = useWorkspaces(state => state)
  const [filter, setFilter] = useState<ProductLifecycle>('live')
  const list = useProjectWorkspaceRows(source.items, source.state, projectState, filter)
  const [creating, setCreating] = useState(false), [name, setName] = useState('')
  const [renaming, setRenaming] = useState<string>(), [renameValue, setRenameValue] = useState('')
  const [confirm, setConfirm] = useState<WorkspaceLifecycleIntent>()
  const [undo, setUndo] = useState<WorkspaceLifecycleIntent>()
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>(), [notice, setNotice] = useState<string>()
  const account = projectState?.accountKey()
  const readable = !!account && (projectState?.readable?.() ?? projectState?.enabled() ?? false)
  const writable = readable && projectState?.enabled() === true
  const owner = useRef(account), lifetime = useRef(0), operation = useRef(0), mounted = useRef(false)
  const unconfirmed = useRef(new Map<string, WorkspaceLifecycleIntent>())
  const operationKey = (request: Pick<WorkspaceLifecycleIntent, 'account' | 'id' | 'mutation'>): string => JSON.stringify([request.account, request.id, request.mutation.action])
  const latest = useRef({ account, projectState, open }); latest.current = { account, projectState, open }
  useEffect(() => {
    mounted.current = true
    const changed = (): void => {
      const next = projectState?.accountKey()
      if (next === owner.current) return
      owner.current = next; lifetime.current++; operation.current++; unconfirmed.current.clear()
      setBusy(false); setConfirm(undefined); setUndo(undefined); setError(undefined); setNotice(undefined)
      setRenaming(undefined); setCreating(false); setName(''); setFilter('live')
    }
    changed()
    const stop = projectState?.subscribe(changed)
    return () => { mounted.current = false; lifetime.current++; operation.current++; stop?.() }
  }, [projectState])
  useEffect(() => {
    if (open) { list.refresh(); return }
    operation.current++; setBusy(false); setConfirm(undefined); setRenaming(undefined); setCreating(false); setError(undefined)
  }, [open, list.refresh])
  const dismiss = (): void => { if (busy) return; if (confirm) { setConfirm(undefined); setError(undefined) } else onClose() }
  const panelRef = useModalFocus<HTMLElement>(open, busy ? undefined : dismiss)
  const focusPanel = (): void => { queueMicrotask(() => { panelRef.current?.focus({ preventScroll: true }) }) }
  if (!open) return null

  const run = async (job: (current: () => boolean) => Promise<void>): Promise<void> => {
    if (busy) return
    const sequence = ++operation.current, epoch = lifetime.current, expected = projectState?.accountKey()
    const current = (): boolean => mounted.current && latest.current.open && sequence === operation.current && epoch === lifetime.current && expected === latest.current.projectState?.accountKey()
    setBusy(true); setError(undefined)
    try { await job(current) }
    catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : t('workspacePanel.error')) }
    finally { if (current()) setBusy(false) }
  }
  const pick = (id: string): void => { onPick(id as WorkspaceId); onClose() }
  const create = (event: FormEvent): void => {
    event.preventDefault(); const title = name.trim(); if (!title) return
    void run(async current => { const created = await createWorkspace(title); if (current()) pick(created.id) })
  }
  const rename = (event: FormEvent, id: string): void => {
    event.preventDefault(); const title = renameValue.trim(); if (!title) return
    void run(async current => { await renameWorkspace(id, title); if (current()) { setRenaming(undefined); focusPanel() } })
  }
  const intent = (head: ProjectProductState, title: string, action: ProductStateMutation['action']): WorkspaceLifecycleIntent | undefined => {
    if (!writable || !account || !projectState || projectState.accountKey() !== account) return undefined
    const request = { account, id: head.projectId, name: title, mutation: { action, expectedGeneration: head.generation, expectedVersion: head.version, operationId: randomUUID() } }
    const retained = unconfirmed.current.get(operationKey(request))
    return retained && retained.mutation.expectedGeneration === head.generation && retained.mutation.expectedVersion === head.version ? retained : request
  }
  const apply = (request: WorkspaceLifecycleIntent): void => {
    if (!projectState || !writable || request.account !== account) return
    void run(async current => {
      if (!current() || !projectState.enabled() || projectState.accountKey() !== request.account) return
      const key = operationKey(request)
      if (!unconfirmed.current.has(key) && unconfirmed.current.size >= 64) throw new Error(t('workspacePanel.unconfirmedLimit'))
      unconfirmed.current.set(key, request)
      const response = await projectState.api.mutateProjectState(request.id, request.mutation)
      if (!current()) return
      const head = response.state
      if (head.projectId !== request.id || head.version !== request.mutation.expectedVersion + 1 || head.generation !== request.mutation.expectedGeneration + 1 ||
        (request.mutation.action === 'delete' ? head.state !== 'deleted' : request.mutation.action === 'unarchive' ? head.state !== 'live' : !['live', 'archived'].includes(head.state))) throw new Error(t('workspacePanel.error'))
      unconfirmed.current.delete(key)
      list.acknowledge(head, request.account)
      setConfirm(undefined); setRenaming(undefined); setCreating(false)
      if (request.mutation.action === 'delete') {
        setUndo({ ...request, mutation: { action: 'restore', expectedGeneration: head.generation, expectedVersion: head.version, operationId: randomUUID() } })
        setNotice(t('workspacePanel.deletedNotice'))
      } else {
        setUndo(undefined); setFilter(head.state)
        setNotice(t(head.state === 'archived' ? 'workspacePanel.restoredArchived' : 'workspacePanel.restoredNotice'))
      }
      focusPanel()
    })
  }
  const changeFilter = (value: ProductLifecycle): void => { setFilter(value); setRenaming(undefined); setCreating(false); setConfirm(undefined); setError(undefined) }
  const activeList = filter === 'live'
  return <div className={css.backdrop} data-physicsos-workspace-panel="">
    <section className={`${css.dialog} ${workspaceCss.dialog}`} ref={panelRef} tabIndex={-1} role={confirm ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="physicsos-workspace-title" aria-describedby={confirm ? 'physicsos-workspace-delete-hint' : undefined}>
      <header className={css.header}><div><p className={css.eyebrow}>PhysicsOS · Workspace</p><h2 id="physicsos-workspace-title" className={css.title}>{t(confirm ? 'workspacePanel.deleteTitle' : 'workspacePanel.title')}</h2><p className={css.hint}>{t(confirm ? 'workspacePanel.deleteSubtitle' : 'workspacePanel.hint')}</p></div><button type="button" className={css.iconButton} aria-label={t(confirm ? 'workspacePanel.cancelDelete' : 'workspacePanel.close')} disabled={busy} onClick={dismiss}>×</button></header>
      {confirm ? <div className={workspaceCss.confirmation}>
        <h3>{confirm.name}</h3><p id="physicsos-workspace-delete-hint">{t('workspacePanel.deleteBody')}</p>
        {confirm.id === selectedId && <p className={workspaceCss.notice}>{t('workspacePanel.deleteCurrent')}</p>}
        <div className={`${css.actions} ${workspaceCss.actions}`}><button type="button" className={css.ghost} disabled={busy} onClick={() => { setConfirm(undefined); setError(undefined); focusPanel() }}>{t('workspacePanel.cancel')}</button><button type="button" className={`${css.ghost} ${workspaceCss.danger}`} disabled={busy || !writable} onClick={() => apply(confirm)}>{t(busy ? 'workspacePanel.working' : 'workspacePanel.confirmDelete')}</button></div>
      </div> : <>
        {readable && <div className={workspaceCss.toolbar}><label htmlFor="physicsos-workspace-filter">{t('workspacePanel.filter')}</label><select id="physicsos-workspace-filter" value={filter} disabled={busy} onChange={event => changeFilter(event.target.value as ProductLifecycle)}><option value="live">{t('workspacePanel.normal')}</option><option value="archived">{t('workspacePanel.archived')}</option><option value="deleted">{t('workspacePanel.recycle')}</option></select></div>}
        {readable && !writable && <p className={workspaceCss.notice} role="status">{t('workspacePanel.bridgeReadonly')}</p>}
        {notice && <p className={workspaceCss.notice} role="status">{notice}{undo && writable && undo.account === account && <button type="button" className={css.ghost} disabled={busy} onClick={() => apply(undo)}>{t('workspacePanel.undoDelete')}</button>}</p>}
        {list.state === 'loading' || list.state === 'idle' ? <p className={css.empty} role="status">{t('workspacePanel.loading')}</p> : list.state === 'error' ? <p className={css.error} role="alert">{t('workspacePanel.loadError')}<button type="button" className={css.ghost} onClick={list.refresh}>{t('workspacePanel.retry')}</button></p> : list.items.length === 0 ? <p className={css.empty}>{t(filter === 'deleted' ? 'workspacePanel.recycleEmpty' : filter === 'archived' ? 'workspacePanel.archivedEmpty' : 'workspacePanel.empty')}</p> : <div className={css.list}>{list.items.map(workspace => {
          const title = accountWorkspaceName(workspace.title, t), current = workspace.workspaceId === selectedId, head = list.heads.get(workspace.workspaceId)
          if (renaming === workspace.workspaceId && activeList) return <form key={workspace.workspaceId} className={`${css.row} ${workspaceCss.row}`} onSubmit={event => rename(event, workspace.workspaceId)}><input className={css.input} autoFocus aria-label={t('workspacePanel.nameLabel')} maxLength={80} value={renameValue} onChange={event => setRenameValue(event.target.value)} /><div className={`${css.rowActions} ${workspaceCss.rowActions}`}><button type="submit" className={css.primary} disabled={busy || !renameValue.trim()}>{t('workspacePanel.save')}</button><button type="button" className={css.ghost} disabled={busy} onClick={() => { setRenaming(undefined); focusPanel() }}>{t('workspacePanel.cancel')}</button></div></form>
          return <div key={workspace.workspaceId} className={`${css.row} ${workspaceCss.row}`} data-workspace-id={workspace.workspaceId}><div className={css.rowBody}><p className={css.rowName}><span className={css.rowTitle}>{title}</span>{current && <span className={css.rowBadge}>{t('workspacePanel.current')}</span>}</p><p className={css.rowMeta}>{t(filter === 'deleted' ? 'workspacePanel.retained' : filter === 'archived' ? 'workspacePanel.archived' : 'workspacePanel.personal')}</p></div><div className={`${css.rowActions} ${workspaceCss.rowActions}`}>
            {activeList ? <><button type="button" className={css.primary} disabled={busy || current} onClick={() => pick(workspace.workspaceId)}>{t(current ? 'workspacePanel.opened' : 'workspacePanel.open')}</button><button type="button" className={css.ghost} disabled={busy} onClick={() => { setRenaming(workspace.workspaceId); setRenameValue(title); setNotice(undefined) }}>{t('workspacePanel.rename')}</button></> : writable && head && <button type="button" className={css.primary} disabled={busy} aria-label={`${t('workspacePanel.restore')} · ${title}`} onClick={() => { const request = intent(head, title, filter === 'deleted' ? 'restore' : 'unarchive'); if (request) apply(request) }}>{t('workspacePanel.restore')}</button>}
            {writable && head && filter !== 'deleted' && <button type="button" className={`${css.ghost} ${workspaceCss.danger}`} disabled={busy} aria-label={`${t('workspacePanel.delete')} · ${title}`} onClick={() => { const request = intent(head, title, 'delete'); if (request) { setConfirm(request); setError(undefined); focusPanel() } }}>{t('workspacePanel.delete')}</button>}
          </div></div>
        })}</div>}
        {activeList && list.state === 'ready' && list.items.length > 0 && !creating && <div className={css.actions}><button type="button" className={css.ghost} disabled={busy} onClick={() => { setCreating(true) }}>{t('workspacePanel.create')}</button></div>}
        {activeList && list.state === 'ready' && (creating || list.items.length === 0) && <form className={css.form} onSubmit={create}><label className={css.field}><span className={css.label}>{t('workspacePanel.nameLabel')}</span><input className={css.input} maxLength={80} placeholder={t('workspacePanel.namePlaceholder')} value={name} onChange={event => setName(event.target.value)} /></label><div className={css.actions}>{list.items.length > 0 && <button type="button" className={css.ghost} disabled={busy} onClick={() => { setCreating(false); setName('') }}>{t('workspacePanel.cancel')}</button>}<button type="submit" className={css.primary} disabled={busy || !name.trim()}>{t(busy ? 'workspacePanel.working' : 'workspacePanel.createRun')}</button></div></form>}
      </>}
      {error && <p className={css.error} role="alert">{error}</p>}
    </section>
  </div>
}
