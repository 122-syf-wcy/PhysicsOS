import { useEffect, useMemo, useRef, useState } from 'react'
import { IconFolderOpenOutlineMedium, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId, SessionSummary, WorkspaceId } from './runtime-compat.ts'
import { collectLearningPages } from './learning-api.ts'
import type { PersonalProductApi, ProductLifecycle, ProjectProductState, SessionProjectAssignment } from './learning-api.ts'
import { ActivityDisplayed } from './ActivityDisplayed.tsx'
import css from './StudyProjects.module.css'

export interface ProjectBoard { id: string; title: string; projectId?: string }
export interface ProjectStateBridge {
  readonly api: Pick<PersonalProductApi, 'listProjectStates' | 'getProjectState' | 'mutateProjectState' | 'listSessionAssignments' | 'getSessionAssignment' | 'assignSessionProject'>
  enabled(): boolean
  readable?(): boolean
  ready?(): boolean
  accountKey(): string | undefined
  subscribe(listener: () => void): () => void
}
export interface StudyProjectsInjected {
  createProject(name: string): Promise<{ id: string; name: string }>
  renameProject(id: string, name: string): Promise<void>
  openConversation(id: SessionId): void
  newConversation(id: WorkspaceId): Promise<void>
  renameConversation(id: SessionId, name: string): Promise<void>
  addConversation(project: WorkspaceId, session: SessionId): Promise<void>
  /** Must exhaust every server page; a failed page must reject, not return partial data. */
  listBoards(): Promise<readonly ProjectBoard[]>
  assignBoard(id: string, projectId: string | undefined): Promise<void>
  newBoard(projectId: string, title: string): Promise<void>
  openBoard(id: string): void
  projectState?: ProjectStateBridge
}
type Props = PropsRuntime<'main'> & PropsLocale<'physicsos'> & InjectFace<StudyProjectsInjected>
const newOperation = (): string => globalThis.crypto?.randomUUID?.() ?? `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

/** An override changes product grouping only; native Workspace/cwd membership is retained. */
export const sessionProjectOf = (id: string, nativeProject: string | undefined, assignments: readonly SessionProjectAssignment[]): string | undefined => {
  const override = assignments.find(value => value.sessionId === id)
  return override === undefined ? nativeProject : override.projectId ?? undefined
}
export const effectiveProjectOf = (id: string | undefined, projects: ReadonlySet<string>): string | undefined =>
  id !== undefined && projects.has(id) ? id : undefined

/** Native workspaces are never deleted here. Deletion is a recoverable personal projection. */
export function StudyProjects({ t, useWorkspaces, useSessions, createProject, renameProject, openConversation,
  newConversation, renameConversation, addConversation, listBoards, assignBoard, newBoard, openBoard, projectState }: Props) {
  const registry = useWorkspaces(s => s)
  const sessions = useSessions(s => s)
  const registryKey = JSON.stringify([registry.items.map(project => [project.workspaceId, project.sessionIds]), sessions.ids])
  const [boundaryRevision, refreshBoundary] = useState(0)
  useEffect(() => projectState?.subscribe(() => { refreshBoundary(value => value + 1) }), [projectState])
  const account = projectState?.accountKey()
  const capabilityReady = projectState?.ready?.() ?? true
  const lifecycle = (projectState?.readable?.() ?? projectState?.enabled() ?? false) && account !== undefined
  const writable = projectState?.enabled() === true && account !== undefined
  const [selected, setSelected] = useState<string | null>() // null is the real ungrouped destination.
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ProductLifecycle>('live')
  const [tab, setTab] = useState<'chats' | 'boards'>('chats')
  const [boards, setBoards] = useState<readonly ProjectBoard[]>([])
  const [states, setStates] = useState<readonly ProjectProductState[]>([])
  const [assignments, setAssignments] = useState<readonly SessionProjectAssignment[]>([])
  const [loaded, setReady] = useState(!lifecycle)
  const [loadedAccount, setLoadedAccount] = useState(account)
  const ready = loaded && capabilityReady && loadedAccount === account
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [reload, setReload] = useState(0)
  const [presentationId] = useState(newOperation)
  const [undo, setUndo] = useState<{ id: string; account?: string; generation: number; version: number }>()
  const [dialog, setDialog] = useState<{ kind: 'project' | 'rename-project' | 'rename-chat' | 'add-chat' | 'add-board' | 'delete-project' | 'move-chat' | 'move-board'; id?: string; account?: string; expectedGeneration?: number; expectedVersion?: number }>()
  const [name, setName] = useState('')
  const [item, setItem] = useState('')
  const [target, setTarget] = useState('')
  const rootRef = useRef<HTMLElement>(null)
  const loadEpoch = useRef(0)
  const sameAccount = (): boolean => projectState === undefined || projectState.accountKey() === account
  useEffect(() => {
    loadEpoch.current += 1
    setSelected(undefined); setDialog(undefined); setUndo(undefined); setBoards([]); setStates([]); setAssignments([]); setError(undefined); setBusy(false)
  }, [account])
  useEffect(() => {
    const epoch = ++loadEpoch.current
    if (!capabilityReady) { setReady(false); return }
    if (!lifecycle || projectState === undefined) { setReady(true); setLoadedAccount(account); setStates([]); setAssignments([]); return }
    setReady(false)
    void Promise.all([
      collectLearningPages(cursor => projectState.api.listProjectStates({ state: 'all', limit: 100, ...(cursor === undefined ? {} : { cursor }) })),
      collectLearningPages(cursor => projectState.api.listSessionAssignments({ limit: 100, ...(cursor === undefined ? {} : { cursor }) })),
    ]).then(([projects, members]) => {
      if (epoch !== loadEpoch.current || !sameAccount()) return
      setStates(projects); setAssignments(members); setLoadedAccount(account); setReady(true)
    }).catch(() => { if (epoch === loadEpoch.current && sameAccount()) { setError('项目状态加载失败，请重试；不会把未知状态当作正常项目。'); setReady(false) } })
    return () => { if (epoch === loadEpoch.current) loadEpoch.current += 1 }
  }, [projectState, lifecycle, capabilityReady, account, reload, registryKey, boundaryRevision])
  useEffect(() => {
    if (tab !== 'boards') return
    let stale = false
    void listBoards().then(items => { if (!stale && sameAccount()) setBoards(items) }).catch(() => { if (!stale && sameAccount()) setError(t('projects.error')) })
    return () => { stale = true }
  }, [tab, listBoards, account, reload, t])
  const stateOf = (id: string): ProductLifecycle => states.find(value => value.projectId === id)?.state ?? 'live'
  const authorizedProjects = new Set(states.map(project => project.projectId))
  const visibleProjects = ready ? registry.items.filter(project => !lifecycle || (authorizedProjects.has(project.workspaceId) && stateOf(project.workspaceId) !== 'deleted')) : []
  const groupedIds = new Set(visibleProjects.map(project => project.workspaceId))
  const normalProjects = visibleProjects.filter(project => !lifecycle || stateOf(project.workspaceId) === 'live')
  const projects = ready ? registry.items.filter(project => (!lifecycle || (authorizedProjects.has(project.workspaceId) && stateOf(project.workspaceId) === filter))
    && project.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())) : []
  const current = typeof selected === 'string' && ready ? registry.items.find(project => project.workspaceId === selected && (!lifecycle || (authorizedProjects.has(project.workspaceId) && stateOf(project.workspaceId) !== 'deleted'))) : undefined
  const ungrouped = selected === null && ready
  const currentLive = current !== undefined && (!lifecycle || stateOf(current.workspaceId) === 'live')
  const archived = useMemo(() => new Set(registry.archivedSessionIds), [registry.archivedSessionIds])
  const available = useMemo(() => {
    const authorized = new Set(assignments.map(row => row.sessionId))
    return sessions.ids.map(id => sessions.byId[id]).filter((s): s is SessionSummary =>
      s !== undefined && !s.blank && s.origin !== 'subagent' && !archived.has(s.id) && (!lifecycle || (ready && authorized.has(s.id))))
  }, [sessions, archived, assignments, lifecycle, ready])
  const projectForSession = (id: string): string | undefined => effectiveProjectOf(sessionProjectOf(id,
    registry.items.find(project => project.sessionIds.includes(id as SessionId))?.workspaceId, assignments), groupedIds)
  const members = available.filter(session => ungrouped ? projectForSession(session.id) === undefined : current !== undefined && projectForSession(session.id) === current.workspaceId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const memberBoards = boards.filter(board => ungrouped ? effectiveProjectOf(board.projectId, groupedIds) === undefined : current !== undefined && effectiveProjectOf(board.projectId, groupedIds) === current.workspaceId)
  const run = async (job: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setError(undefined)
    try { await job() } catch (failure) { if (sameAccount()) setError(failure instanceof Error ? failure.message : t('projects.error')) }
    finally { if (sameAccount()) setBusy(false) }
  }
  const begin = (next: NonNullable<typeof dialog>): void => {
    const head = next.kind === 'delete-project' ? states.find(value => value.projectId === next.id) : undefined
    setDialog({ ...next, ...(account === undefined ? {} : { account }),
      ...(head === undefined ? {} : { expectedGeneration: head.generation, expectedVersion: head.version }) }); setItem(''); setTarget('')
    setName(next.kind === 'rename-project' ? current?.title ?? '' : next.kind === 'rename-chat' ? sessions.byId[next.id as SessionId]?.displayTitle ?? '' : '')
  }
  const changeProject = async (id: string, action: 'delete' | 'restore' | 'archive' | 'unarchive', expected?: { generation: number; version: number }): Promise<void> => {
    if (!writable || projectState === undefined || !sameAccount()) throw new Error('兼容模式仅可查看项目整理状态')
    // The displayed version, not a freshly adopted one, is the user's CAS intent.
    const head = states.find(value => value.projectId === id)
    if (head === undefined) throw new Error('项目状态尚未加载，请重试')
    const result = await projectState.api.mutateProjectState(id, { action, expectedGeneration: expected?.generation ?? head.generation, expectedVersion: expected?.version ?? head.version, operationId: newOperation() })
    if (!sameAccount()) return
    setStates(previous => [...previous.filter(value => value.projectId !== id), result.state])
    if (action === 'delete') {
      setUndo({ id, generation: result.state.generation, version: result.state.version, ...(account === undefined ? {} : { account }) })
      setSelected(null) // Associated materials are immediately reachable as ungrouped.
    }
    setReload(value => value + 1)
  }
  const moveSession = async (sessionId: string, projectId: string | null): Promise<void> => {
    if (lifecycle && !writable) throw new Error('兼容模式暂不支持移动资料')
    if (writable && projectState !== undefined) {
      const previous = assignments.find(value => value.sessionId === sessionId)
      const result = await projectState.api.assignSessionProject(sessionId, { projectId, expectedVersion: previous?.version ?? 0, operationId: newOperation() })
      if (sameAccount()) setAssignments(rows => [...rows.filter(value => value.sessionId !== sessionId), result.assignment])
    } else if (projectId !== null) await addConversation(projectId as WorkspaceId, sessionId as SessionId)
    else throw new Error('未分组移动需要新版项目功能')
  }
  const confirm = (): void => {
    if (dialog === undefined || dialog.account !== account || !sameAccount()) return
    const next = dialog
    void run(async () => {
      if (next.kind === 'project') { const project = await createProject(name.trim()); if (sameAccount()) { setSelected(project.id); setReload(value => value + 1) } }
      else if (next.kind === 'rename-project') await renameProject(next.id!, name.trim())
      else if (next.kind === 'rename-chat') await renameConversation(next.id as SessionId, name.trim())
      else if (next.kind === 'delete-project') {
        if (next.expectedGeneration === undefined || next.expectedVersion === undefined) throw new Error('请刷新项目状态后重新确认')
        await changeProject(next.id!, 'delete', { generation: next.expectedGeneration, version: next.expectedVersion })
      }
      else if (next.kind === 'move-chat') await moveSession(next.id!, target === '' ? null : target)
      else if (next.kind === 'move-board') { await assignBoard(next.id!, target === '' ? undefined : target); if (sameAccount()) setBoards(await listBoards()) }
      else if (next.kind === 'add-chat' && current !== undefined) await moveSession(item, current.workspaceId)
      else if (next.kind === 'add-board' && current !== undefined) { await assignBoard(item, current.workspaceId); if (sameAccount()) setBoards(await listBoards()) }
      if (sameAccount()) { setDialog(undefined); setReload(value => value + 1); queueMicrotask(() => { rootRef.current?.focus() }) }
    })
  }
  const moveDialog = dialog?.kind === 'move-chat' || dialog?.kind === 'move-board'
  const addDialog = dialog?.kind === 'add-chat' || dialog?.kind === 'add-board'
  return <main ref={rootRef} tabIndex={-1} className={css.root} data-physicsos-projects="true" data-project-selected={selected !== undefined && (current !== undefined || ungrouped)}>
    {ready && account && !error ? <ActivityDisplayed module="projects" accountKey={account} entryId={presentationId} /> : null}
    <header className={css.header}><div><h1>{t('projects.title')}</h1><p>{t('projects.hint')}</p></div><button type="button" disabled={busy || !ready} onClick={() => { begin({ kind: 'project' }) }}>{t('projects.new')}</button></header>
    {error !== undefined && <p role="alert" className={css.error}>{error}<button type="button" onClick={() => { setReload(value => value + 1) }}>重试</button></p>}
    {!ready && <p role="status">正在核对项目状态…</p>}
    {lifecycle && !writable && <p role="status" className={css.notice}>兼容模式：保留整理状态和未分组资料；新删除、归档、恢复与移动暂未启用。</p>}
    {undo !== undefined && undo.account === account && lifecycle && <p role="status" className={css.notice}>项目已移入回收站，资料保留在“未分组”。<button type="button" disabled={busy} onClick={() => { void run(async () => {
      if (projectState === undefined || !sameAccount()) return
      await projectState.api.mutateProjectState(undo.id, { action: 'restore', expectedGeneration: undo.generation, expectedVersion: undo.version, operationId: newOperation() })
      if (sameAccount()) { setUndo(undefined); setReload(value => value + 1) }
    }) }}>撤销</button></p>}
    <div className={css.layout}><aside className={css.folders}>
      <input aria-label={t('projects.search')} placeholder={t('projects.search')} value={search} onChange={event => { setSearch(event.target.value) }} />
      {lifecycle && <label className={css.filter}>项目状态<select value={filter} onChange={event => { setFilter(event.target.value as ProductLifecycle) }}><option value="live">正常</option><option value="archived">已归档</option><option value="deleted">回收站</option></select></label>}
      <button type="button" className={css.folder} disabled={!ready} onClick={() => { setSelected(null); setError(undefined) }} aria-pressed={ungrouped}><span className={css.folderMark} aria-hidden="true"><IconFolderOpenOutlineMedium size={28} /></span><span>未分组<small>未分组及已删除项目的资料</small></span></button>
      {projects.map(project => <div key={project.workspaceId} className={css.projectCard}>
        <button type="button" aria-pressed={current?.workspaceId === project.workspaceId} disabled={lifecycle && filter === 'deleted'} className={css.folder} onClick={() => { setSelected(project.workspaceId); setError(undefined) }}>
          <span className={css.folderMark} aria-hidden="true"><IconFolderOpenOutlineMedium size={28} /></span><span>{project.title}<small>{available.filter(session => projectForSession(session.id) === project.workspaceId).length} {t('projects.conversations')}</small></span>
        </button>
        {writable && filter === 'deleted' && <button type="button" disabled={busy} aria-label={`恢复项目 · ${project.title}`} onClick={() => { void run(() => changeProject(project.workspaceId, 'restore')) }}>恢复项目</button>}
      </div>)}
      {ready && projects.length === 0 && <p>{filter === 'deleted' ? '回收站没有项目。' : filter === 'archived' ? '没有已归档的项目。' : t('projects.empty')}</p>}
    </aside><section className={css.content}>
      {current === undefined && !ungrouped ? <div className={css.empty}><h2>{t('projects.empty')}</h2><p>{t('projects.example')}</p></div> : <>
        <div className={css.projectHeader}><button type="button" className={css.back} onClick={() => { setSelected(undefined) }}>{t('projects.title')}</button><div><h2>{ungrouped ? '未分组' : current!.title}</h2><p>{ungrouped ? '原项目资料和关联保留；仅明确移动才改变分组。' : t('projects.chapterHint')}</p></div>
          {current !== undefined && <><button type="button" disabled={busy || !currentLive} onClick={() => { begin({ kind: 'rename-project', id: current.workspaceId }) }}>{t('projects.rename')}</button>{writable && <>
            <button type="button" disabled={busy} onClick={() => { void run(() => changeProject(current.workspaceId, currentLive ? 'archive' : 'unarchive')) }}>{currentLive ? '归档项目' : '取消归档'}</button>
            <button type="button" disabled={busy} onClick={() => { begin({ kind: 'delete-project', id: current.workspaceId }) }}>删除项目</button>
          </>}</>}
        </div>
        <div className={css.tabs}><button type="button" aria-pressed={tab === 'chats'} onClick={() => { setTab('chats') }}>{t('projects.conversations')}</button><button type="button" aria-pressed={tab === 'boards'} onClick={() => { setTab('boards') }}>{t('projects.boards')}</button></div>
        {tab === 'chats' ? <>
          {currentLive && <div className={css.actions}><button type="button" disabled={busy} onClick={() => { void run(() => newConversation(current!.workspaceId)) }}>{t('projects.newConversation')}</button><button type="button" disabled={busy || (lifecycle && !writable)} onClick={() => { begin({ kind: 'add-chat' }) }}>{t('projects.addConversation')}</button></div>}
          {members.length === 0 ? <p className={css.empty}>{t('projects.noConversations')}</p> : <ul className={css.list}>{members.map(session => <li key={session.id}><button type="button" className={css.open} onClick={() => { openConversation(session.id) }}>{session.displayTitle}<small>{new Date(session.updatedAt).toLocaleDateString()}</small></button><button type="button" disabled={busy} aria-label={`${t('projects.rename')} · ${session.displayTitle}`} onClick={() => { begin({ kind: 'rename-chat', id: session.id }) }}>{t('projects.rename')}</button>{writable && <button type="button" disabled={busy} aria-label={`移动对话 · ${session.displayTitle}`} onClick={() => { begin({ kind: 'move-chat', id: session.id }) }}>移动</button>}</li>)}</ul>}
        </> : <>
          {currentLive && <div className={css.actions}><button type="button" disabled={busy} onClick={() => { void run(() => newBoard(current!.workspaceId, `${current!.title} · ${t('projects.board')}`)) }}>{t('projects.newBoard')}</button><button type="button" disabled={busy || (lifecycle && !writable)} onClick={() => { begin({ kind: 'add-board' }) }}>{t('projects.addBoard')}</button></div>}
          <p>{t('projects.canvasHint')}</p><ul className={css.list}>{memberBoards.map(board => <li key={board.id}><button type="button" className={css.open} onClick={() => { openBoard(board.id) }}>{board.title}</button>{writable && <button type="button" disabled={busy} aria-label={`移动画布 · ${board.title}`} onClick={() => { begin({ kind: 'move-board', id: board.id }) }}>移动</button>}</li>)}</ul>
        </>}
      </>}
    </section></div>
    {dialog !== undefined && dialog.account === account && <Modal open title={dialog.kind === 'delete-project' ? '删除项目' : moveDialog ? '移动资料' : t(dialog.kind === 'project' ? 'projects.new' : dialog.kind.startsWith('rename') ? 'projects.rename' : dialog.kind === 'add-chat' ? 'projects.addConversation' : 'projects.addBoard')} closeLabel={t('projects.cancel')} onClose={() => { if (!busy) setDialog(undefined) }}>
      <form className={css.dialog} onSubmit={event => { event.preventDefault(); confirm() }}>
        {dialog.kind === 'delete-project' ? <p>只删除本人的项目分组，不删除工作区、对话、实验画布或日志。资料会显示在“未分组”；恢复项目不会抢回期间已明确移动的资料。</p> : moveDialog ? <select aria-label="目标项目" value={target} onChange={event => { setTarget(event.target.value) }}><option value="">未分组</option>{normalProjects.map(project => <option key={project.workspaceId} value={project.workspaceId}>{project.title}</option>)}</select>
          : addDialog ? <select aria-label={t('projects.choose')} value={item} onChange={event => { setItem(event.target.value) }}><option value="">{t('projects.choose')}</option>{dialog.kind === 'add-chat' ? available.filter(session => projectForSession(session.id) !== current?.workspaceId).map(session => <option key={session.id} value={session.id}>{session.displayTitle}</option>) : boards.filter(board => board.projectId !== current?.workspaceId).map(board => <option key={board.id} value={board.id}>{board.title}</option>)}</select>
            : <input data-modal-autofocus maxLength={80} aria-label={t('projects.name')} placeholder={t('projects.example')} value={name} onChange={event => { setName(event.target.value) }} />}
        <div className={css.actions}><button type="button" disabled={busy} onClick={() => { setDialog(undefined) }}>{t('projects.cancel')}</button><button type="submit" disabled={busy || (dialog.kind !== 'delete-project' && !moveDialog && (addDialog ? item === '' : name.trim() === ''))}>{dialog.kind === 'delete-project' ? '确认删除项目' : t('projects.save')}</button></div>
      </form>
    </Modal>}
  </main>
}
