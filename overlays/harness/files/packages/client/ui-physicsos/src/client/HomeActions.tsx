import { useEffect, useRef, useState } from 'react'
import { sceneRefOf } from './surface-store.ts'
import {
  IconBrowseOutlineMedium, IconFolderOpenOutlineMedium, IconChevronRightOutlineMedium, IconPlusOutlineMedium, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from './runtime-compat.ts'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { fillComposerDraft } from './fill-draft.ts'
import { IconArchive, IconPhysicsLab, IconQuestionSheet } from './icons/physics-icons.tsx'
import type { PhysicsSceneRef, RecentExperimentEntry, RecentExperimentsState } from './surface-store.ts'
import { formatUpdatedAt, workspaceKnowledge } from './workspaceMeta.ts'
import { ActivityDisplayed } from './ActivityDisplayed.tsx'
import css from './HomeActions.module.css'

export type HomeActionsInjected = {
  openSurface: (surface: 'home' | 'lab' | 'record' | 'canvas' | 'projects', sceneRef?: PhysicsSceneRef) => void
  startQuestion?: () => void
  openCanvasView: (canvasId?: string) => void
  newCanvas: (title: string) => Promise<string>
  requestSceneInCanvas: (sceneRef: PhysicsSceneRef) => void
  removeRecent: (sceneId: string) => void
  restoreRecent?: (sceneId: string) => void
  archiveRecent?: (sceneId: string) => void
  unarchiveRecent?: (sceneId: string) => void
  hooks: { recentExperiments: SnapshotStore<RecentExperimentsState> }
}
export type HomeActionsProps = InjectFace<HomeActionsInjected> & PropsLocale<'physicsos'>

/** Quick actions and the personal, recoverable recent-scene list. */
export function HomeActions({ useRecentExperiments, openSurface, requestSceneInCanvas, removeRecent,
  restoreRecent, archiveRecent, unarchiveRecent, startQuestion, t }: HomeActionsProps) {
  const state = useRecentExperiments(s => s)
  const [filter, setFilter] = useState<'live' | 'archived' | 'deleted'>('live')
  const [confirm, setConfirm] = useState<{ entry: RecentExperimentEntry; accountKey?: string }>()
  const [undo, setUndo] = useState<{ sceneId: string; accountKey?: string }>()
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { setConfirm(undefined); setUndo(undefined); setFilter('live') }, [state.accountKey])
  const lifecycle = state.lifecycleReadable === true || state.lifecycleEnabled === true
  const writable = state.lifecycleEnabled === true
  const items = !lifecycle || filter === 'live' ? state.items : filter === 'archived' ? state.archivedItems ?? [] : state.deletedItems ?? []
  const pending = new Set(state.pendingSceneIds ?? [])
  return (
    <div className={css.root}>
      {state.accountKey ? <ActivityDisplayed module="home" accountKey={state.accountKey} /> : null}
      <div className={css.quickActions} aria-label={t('home.cards.label')}>
        <button type="button" className={css.quickAction} onClick={() => { if (startQuestion !== undefined) startQuestion(); else fillComposerDraft(t('home.ask.action')) }}><IconQuestionSheet size={17} />{t('home.quick.question')}</button>
        <button type="button" className={css.quickAction} onClick={() => { openSurface('lab') }}><IconPhysicsLab size={17} />{t('home.quick.experiment')}</button>
        <button type="button" className={css.quickAction} onClick={() => { fillComposerDraft(t('home.quick.conceptPrompt')) }}><IconBrowseOutlineMedium size={17} />{t('home.quick.concept')}</button>
        <button type="button" className={css.quickAction} onClick={() => { fillComposerDraft(t('home.quick.teachingPrompt')) }}><IconFolderOpenOutlineMedium size={17} />{t('home.quick.teaching')}</button>
      </div>
      <section className={css.recent} aria-label={t('recent.title')}>
        <div className={css.recentHeading}>
          <h2 ref={headingRef} tabIndex={-1} className={css.recentTitle}>{t('home.recent.title')}</h2>
          {lifecycle && <select aria-label="最近记录状态" value={filter} onChange={event => { setFilter(event.target.value as typeof filter) }}>
            <option value="live">正常</option><option value="archived">已归档</option><option value="deleted">回收站</option>
          </select>}
        </div>
        {state.notice !== undefined && <p role="status" className={css.recentNotice}>{state.notice}</p>}
        {undo !== undefined && undo.accountKey === state.accountKey && writable && restoreRecent !== undefined && <p role="status" className={css.recentNotice}>
          已从最近记录移除，不影响实验、画布或对话。<button type="button" onClick={() => { restoreRecent(undo.sceneId); setUndo(undefined) }}>撤销</button>
        </p>}
        {items.length === 0 ? (
          filter !== 'live' && lifecycle ? <p className={css.emptyBody}>{filter === 'deleted' ? '回收站没有最近记录。' : '没有已归档的最近记录。'}</p> : <div className={css.empty}>
            <img className={css.emptyImage} src="/physicsos/lab-empty-hero.jpg" alt="" aria-hidden="true" />
            <p className={css.emptyTitle}>{t('recent.emptyTitle')}</p><p className={css.emptyBody}>{t('recent.emptyBody')}</p>
            <button type="button" className={css.emptyCta} onClick={() => { openSurface('lab') }}>{t('recent.emptyCta')}</button>
          </div>
        ) : (
          <ul className={css.list}>
            {items.slice(0, filter === 'live' ? 5 : items.length).map(entry => {
              const knowledge = workspaceKnowledge(entry.title)
              return <li key={entry.sceneId} data-recent-scene={entry.sceneId}>
                <button type="button" className={css.recentItem} disabled={filter === 'deleted'} onClick={() => { openSurface('lab', sceneRefOf(entry)) }}>
                  <span className={css.recentIcon} data-kind={entry.kind}>{entry.kind === 'question' ? <IconQuestionSheet size={22} /> : <IconPhysicsLab size={22} />}</span>
                  <span className={css.recentName}>{entry.title}</span>
                  <span className={css.recentMeta}>{knowledge.subject}{' / '}{knowledge.topic}{' · '}{t(entry.kind === 'question' ? 'recent.kind.question' : 'recent.kind.experiment')}</span>
                  <span className={css.recentTime}>{formatUpdatedAt(entry.updatedAt)}</span><IconChevronRightOutlineMedium size={16} className={css.recentChevron} />
                </button>
                <div className={css.recentActions} role="group" aria-label={`最近记录操作 · ${entry.title}`}>
                  {filter === 'deleted' ? writable && restoreRecent !== undefined && <button type="button" className={css.recentAction} disabled={pending.has(entry.sceneId)} onClick={() => { restoreRecent(entry.sceneId) }} aria-label={`恢复最近记录 · ${entry.title}`}>恢复</button> : <>
                    <button type="button" className={css.recentAction} aria-label={`${t('canvas.addToCanvas')} · ${entry.title}`} title={t('canvas.addToCanvas')} onClick={() => { requestSceneInCanvas(sceneRefOf(entry)) }}><IconPlusOutlineMedium size={18} /></button>
                    {writable && (filter === 'archived' ? unarchiveRecent !== undefined && <button type="button" className={css.recentAction} disabled={pending.has(entry.sceneId)} aria-label={`取消归档 · ${entry.title}`} onClick={() => { unarchiveRecent(entry.sceneId) }}>还原</button>
                      : archiveRecent !== undefined && <button type="button" className={css.recentAction} disabled={pending.has(entry.sceneId)} aria-label={`归档最近记录 · ${entry.title}`} onClick={() => { archiveRecent(entry.sceneId) }}><IconArchive size={17} /></button>)}
                    {(!lifecycle || writable) && <button type="button" className={css.recentAction} disabled={pending.has(entry.sceneId)} aria-label={`${t('recent.remove')} · ${entry.title}`} title={t('recent.remove')} onClick={() => { setConfirm({ entry, ...(state.accountKey === undefined ? {} : { accountKey: state.accountKey }) }) }}><span aria-hidden="true">×</span></button>}
                  </>}
                </div>
              </li>
            })}
          </ul>
        )}
      </section>
      {confirm !== undefined && confirm.accountKey === state.accountKey && <Modal open title="移除最近记录" closeLabel="取消" onClose={() => { setConfirm(undefined) }}>
        <p>仅从本人的最近记录移除“{confirm.entry.title}”。不会卸载实验包，也不会删除实验内容、画布或对话。</p>
        {lifecycle && <p>可在“回收站”恢复。</p>}
        <div className={css.confirmActions}><button type="button" onClick={() => { setConfirm(undefined) }}>取消</button>
          <button type="button" onClick={() => {
            if (confirm.accountKey === state.accountKey) {
              removeRecent(confirm.entry.sceneId)
              setUndo({ sceneId: confirm.entry.sceneId, ...(state.accountKey === undefined ? {} : { accountKey: state.accountKey }) })
            }
            setConfirm(undefined)
            queueMicrotask(() => { headingRef.current?.focus() })
          }}>确认移除</button></div>
      </Modal>}
    </div>
  )
}
