import { sceneRefOf } from './surface-store.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { IconPlusOutlineMedium, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId, SessionSummary, SnapshotStore } from './runtime-compat.ts'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import clsx from 'clsx'
import { IconArchive, IconChatBubble, IconPhysicsLab, IconQuestionSheet } from './icons/physics-icons.tsx'
import type { PhysicsSceneRef, PhysicsSurfaceId, RecentExperimentEntry, RecentExperimentsState } from './surface-store.ts'
import { formatUpdatedAt } from './workspaceMeta.ts'
import css from './RecentSpaces.module.css'

export interface RecentSpacesInjected {
  hooks: { recentExperiments: SnapshotStore<RecentExperimentsState> }
  openSurface: (surface: PhysicsSurfaceId, sceneRef?: PhysicsSceneRef) => void
  removeRecent: (sceneId: string) => void
  restoreRecent?: (sceneId: string) => void
  archiveRecent?: (sceneId: string) => void
  unarchiveRecent?: (sceneId: string) => void
  requestSceneInCanvas: (sceneRef: PhysicsSceneRef) => void
  openSession: (sessionId: SessionId) => void
  archiveSession: (sessionId: SessionId) => void
}
export type RecentSpacesProps = Pick<PropsRuntime<'sidebar.workspaces'>, 'wide' | 'useSessions' | 'useWorkspaces'>
  & InjectFace<RecentSpacesInjected> & PropsLocale<'physicsos'>
const HISTORY_LIMIT = 8

/** Separate, always-discoverable action targets; a scene delete is not a Session archive. */
export function RecentSpaces({ wide, useRecentExperiments, useSessions, useWorkspaces, openSurface,
  removeRecent, restoreRecent, archiveRecent, unarchiveRecent, requestSceneInCanvas, openSession, archiveSession, t }: RecentSpacesProps) {
  const [folded, setFolded] = useState<Record<string, boolean>>(() => {
    try { const value = JSON.parse(localStorage.getItem('physicsos.sidebar.recent-folds') ?? '{}'); return value !== null && typeof value === 'object' ? value : {} } catch { return {} }
  })
  const [filter, setFilter] = useState<'live' | 'archived' | 'deleted'>('live')
  const [confirm, setConfirm] = useState<{ entry: RecentExperimentEntry; accountKey?: string }>()
  const [undo, setUndo] = useState<{ sceneId: string; accountKey?: string }>()
  const rootRef = useRef<HTMLElement>(null)
  const state = useRecentExperiments(s => s)
  useEffect(() => { setConfirm(undefined); setUndo(undefined); setFilter('live') }, [state.accountKey])
  const lifecycle = state.lifecycleReadable === true || state.lifecycleEnabled === true
  const writable = state.lifecycleEnabled === true
  const items = !lifecycle || filter === 'live' ? state.items : filter === 'archived' ? state.archivedItems ?? [] : state.deletedItems ?? []
  const pending = new Set(state.pendingSceneIds ?? [])
  const toggle = (id: string): void => { setFolded(previous => {
    const next = { ...previous, [id]: previous[id] !== true }
    try { localStorage.setItem('physicsos.sidebar.recent-folds', JSON.stringify(next)) } catch {}
    return next
  }) }
  const heading = (id: string, label: string) => <h2 className={css.title}><button type="button" className={css.foldHeading}
    aria-expanded={folded[id] !== true} aria-label={`${t(folded[id] === true ? 'recent.expand' : 'recent.fold')}${label}`} onClick={() => { toggle(id) }}>
    <span>{label}</span><span aria-hidden="true">{folded[id] === true ? '›' : '⌄'}</span></button></h2>
  const sessions = useSessions(s => s)
  const archivedSessionIds = useWorkspaces(s => s.archivedSessionIds)
  const currentSessionId = useSessions(s => s.ids.find(id => (s.byId[id]?.retainedBy.mainView ?? 0) > 0))
  const history = useMemo(() => {
    const archived = new Set<string>(archivedSessionIds)
    return sessions.ids.map(id => sessions.byId[id]).filter((s): s is SessionSummary => s !== undefined
      && !s.blank && s.origin !== 'subagent' && !archived.has(s.id)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, HISTORY_LIMIT)
  }, [sessions, archivedSessionIds])
  if (!wide) return <div className={css.rail} aria-hidden="true" />
  return <section ref={rootRef} className={css.root} aria-label={t('recent.title')} data-sidebar-content="recent-spaces" tabIndex={-1}>
    {heading('experiments', t('recent.title'))}
    {lifecycle && <label className={css.filter}>最近记录状态<select value={filter} onChange={event => { setFilter(event.target.value as typeof filter) }}><option value="live">正常</option><option value="archived">已归档</option><option value="deleted">回收站</option></select></label>}
    {state.notice !== undefined && <p role="status" className={css.notice}>{state.notice}</p>}
    {undo !== undefined && undo.accountKey === state.accountKey && writable && restoreRecent !== undefined && <p role="status" className={css.notice}>已移除最近记录。<button type="button" onClick={() => { restoreRecent(undo.sceneId); setUndo(undefined) }}>撤销</button></p>}
    {folded.experiments === true ? null : items.length === 0 ? <p className={css.empty}>{filter === 'live' ? t('recent.sidebarEmpty') : filter === 'deleted' ? '回收站没有最近记录。' : '没有已归档的最近记录。'}</p> : <ul className={css.list}>
      {items.map(entry => <li key={entry.sceneId} className={css.row} data-recent-scene={entry.sceneId}>
        <button type="button" className={css.item} data-physicsos-history-open={filter === 'deleted' ? undefined : ''} disabled={filter === 'deleted'} onClick={() => { openSurface('lab', sceneRefOf(entry)) }}>
          {entry.kind === 'question' ? <IconQuestionSheet size={16} /> : <IconPhysicsLab size={16} />}<span className={css.name}>{entry.title}</span>
          <span className={css.kind}>{t(entry.kind === 'question' ? 'recent.kind.question' : 'recent.kind.experiment')}</span><span className={css.time}>{formatUpdatedAt(entry.updatedAt)}</span>
        </button>
        <div className={css.actions} role="group" aria-label={`最近记录操作 · ${entry.title}`}>
          {filter === 'deleted' ? writable && restoreRecent !== undefined && <button type="button" className={css.action} disabled={pending.has(entry.sceneId)} aria-label={`恢复最近记录 · ${entry.title}`} onClick={() => { restoreRecent(entry.sceneId) }}>恢复</button> : <>
            <button type="button" className={css.action} aria-label={`${t('canvas.addToCanvas')} · ${entry.title}`} title={t('canvas.addToCanvas')} onClick={() => { requestSceneInCanvas(sceneRefOf(entry)) }}><IconPlusOutlineMedium size={17} /></button>
            {writable && (filter === 'archived' ? unarchiveRecent !== undefined && <button type="button" className={css.action} disabled={pending.has(entry.sceneId)} aria-label={`取消归档 · ${entry.title}`} onClick={() => { unarchiveRecent(entry.sceneId) }}>还原</button>
              : archiveRecent !== undefined && <button type="button" className={css.action} disabled={pending.has(entry.sceneId)} aria-label={`归档最近记录 · ${entry.title}`} onClick={() => { archiveRecent(entry.sceneId) }}><IconArchive size={16} /></button>)}
            {(!lifecycle || writable) && <button type="button" className={css.action} disabled={pending.has(entry.sceneId)} aria-label={`${t('recent.remove')} · ${entry.title}`} title={t('recent.remove')} onClick={() => { setConfirm({ entry, ...(state.accountKey === undefined ? {} : { accountKey: state.accountKey }) }) }}><span aria-hidden="true">×</span></button>}
          </>}
        </div>
      </li>)}
    </ul>}
    {heading('sessions', t('recent.sessions'))}
    {folded.sessions === true ? null : history.length === 0 ? <p className={css.empty}>{t('recent.sessionsEmpty')}</p> : <ul className={css.list}>
      {history.map(session => <li key={session.id} className={css.row}>
        <button type="button" className={clsx(css.item, session.id === currentSessionId && css.active)} aria-current={session.id === currentSessionId ? 'true' : undefined} data-physicsos-history-open="" onClick={() => { openSession(session.id) }}>
          <IconChatBubble size={16} /><span className={css.name}>{session.displayTitle}</span><span className={css.time}>{formatUpdatedAt(new Date(session.updatedAt).toISOString())}</span>
        </button>
        <div className={css.actions}><button type="button" className={css.action} aria-label={`${t('recent.archive')} · ${session.displayTitle}`} title={t('recent.archive')} onClick={() => { archiveSession(session.id) }}><IconArchive size={16} /></button></div>
      </li>)}
    </ul>}
    {confirm !== undefined && confirm.accountKey === state.accountKey && <Modal open title="移除最近记录" closeLabel="取消" onClose={() => { setConfirm(undefined) }}>
      <p>仅从本人的最近记录移除“{confirm.entry.title}”。不会卸载实验包，也不会删除实验内容、画布或对话。</p>{lifecycle && <p>可在“回收站”恢复。</p>}
      <div className={css.confirmActions}><button type="button" onClick={() => { setConfirm(undefined) }}>取消</button><button type="button" onClick={() => {
        if (confirm.accountKey === state.accountKey) { removeRecent(confirm.entry.sceneId); setUndo({ sceneId: confirm.entry.sceneId, ...(state.accountKey === undefined ? {} : { accountKey: state.accountKey }) }) }
        setConfirm(undefined)
        queueMicrotask(() => { rootRef.current?.focus() })
      }}>确认移除</button></div>
    </Modal>}
  </section>
}
