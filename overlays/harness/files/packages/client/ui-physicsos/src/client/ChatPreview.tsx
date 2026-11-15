/** One experiment preview per Conversation, hosted by the existing right sidebar. */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { isBehindModal, observeComposition } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PhysicsSceneSnapshot } from '@deepseek-ai/dsh-tool-physicsos/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AuthState } from './auth-store.ts'
import { chatPreviewOwner, chatPreviewAccount, type createChatPreviewStore } from './chat-preview-store.ts'
import type { SceneChatCardInjected } from './SceneChatCard.tsx'
import type { PhysicsSceneCardData } from './scene-chat-node.ts'
import { OptionalSceneCardBody } from './optional-surfaces.tsx'
import { GlassSelect } from './GlassSelect.tsx'
import { IconPhysicsLab } from './icons/physics-icons.tsx'
import css from './ChatPreview.module.css'

export const CHAT_PREVIEW_KIND = 'physicsos-experiment-preview'
export const CHAT_PREVIEW_ID = '@deepseek-ai/dsh-client-ui-physicsos/experiment-preview'

export interface ChatPreviewInjected extends SceneChatCardInjected {
  readonly hooks: {
    readonly auth: ObservableSnapshot<AuthState>
    readonly previewSession: ObservableSnapshot<SessionId | undefined>
  }
  /** Returns false while another Session or product panel owns the visible surface. */
  readonly revealPreview: (automatic?: boolean) => boolean
}

type Shared = PropsStore<ReturnType<typeof createChatPreviewStore>> & InjectFace<ChatPreviewInjected> & PropsLocale<'physicsos'>
export type ChatPreviewEntryProps = PropsRuntime<'conversation.session.header.utilities'> & Shared
export type ChatPreviewProps = PropsRuntime<'sidebar.right.pane.tab'> & Shared

/** Preserve the published solve and visualization while the projection moves to a new revision. */
export function previewCardData(scene: PhysicsSceneSnapshot): PhysicsSceneCardData {
  return { sceneId: scene.sceneId, revision: scene.revision, title: scene.title, domain: scene.domain,
    cause: scene.cause, commandType: scene.commandType, solve: scene.solve, scene: scene.scene,
    ...(scene.visualization === undefined ? {} : { visualization: scene.visualization }) }
}

/** Resident header entry observes new scene identities and restores a closed or collapsed preview. */
export function ChatPreviewEntry({ sessionId, useProjection, useAuth, usePreviewSession, useStore, actions, revealPreview, t }: ChatPreviewEntryProps) {
  const auth = useAuth(value => value)
  const owner = chatPreviewOwner(auth)
  const account = chatPreviewAccount(auth)
  const mountedSession = usePreviewSession(value => value)
  const state = useStore(value => value)
  const latestSceneId = useProjection('physicsScenes', value => value?.latest ?? undefined)
  const hasScenes = useProjection('physicsScenes', value => value !== undefined && Object.keys(value.scenes).length > 0)
  const permitted = owner !== undefined && owner === state.owner && !state.revoked
  useEffect(() => { actions.bindOwner(owner, account) }, [actions, owner, account])
  useEffect(() => {
    if (permitted) actions.observeLatest(latestSceneId)
  }, [actions, permitted, latestSceneId])
  useEffect(() => {
    if (!permitted || !state.pendingReveal || mountedSession !== sessionId) return
    revealPreview(true)
    actions.revealed()
  }, [actions, permitted, state.pendingReveal, mountedSession, sessionId, revealPreview])
  if (!permitted || !hasScenes) return null
  return <button type="button" className={css.entry} onClick={() => { revealPreview() }} aria-label={t('chatPreview.open')}>
    <IconPhysicsLab size={16} /><span>{t('chatPreview.title')}</span>
  </button>
}

/** The tab's own title remains compact; the scene title appears once inside its body. */
export function ChatPreviewTitle({ t }: PropsLocale<'physicsos'>) {
  return <span className={css.tabTitle}><IconPhysicsLab size={15} />{t('chatPreview.title')}</span>
}

/** Selection is shared viewing state; the selected scene stays in the Session projection. */
export function ChatPreview({ sessionId, useProjection, useStore, actions, useAuth, usePreviewSession, useTabInfo, t,
  openSceneInLab, requestSceneInCanvas, questionCodeOwner, regenerateQuestionCode, recordAttempt,
}: ChatPreviewProps) {
  const tab = useTabInfo()
  const preview = useRef<HTMLElement>(null)
  const composition = useRef<ReturnType<typeof observeComposition>>()
  useLayoutEffect(() => {
    const watcher = observeComposition(document)
    composition.current = watcher
    return () => { composition.current = undefined; watcher.dispose() }
  }, [])
  const auth = useAuth(value => value)
  const owner = chatPreviewOwner(auth)
  const account = chatPreviewAccount(auth)
  const mountedSession = usePreviewSession(value => value)
  const state = useStore(value => value)
  const projection = useProjection('physicsScenes')
  const selected = projection?.scenes[state.selectedSceneId ?? projection.latest ?? '']
  const data = useMemo(() => selected === undefined ? undefined : previewCardData(selected), [selected])
  const permitted = owner !== undefined && owner === state.owner && !state.revoked
  useEffect(() => { actions.bindOwner(owner, account) }, [actions, owner, account])
  // Retained background tabs must not load private artifacts under the newly selected Session.
  if (!permitted || mountedSession !== sessionId || data === undefined || projection === undefined) return null
  const scenes = Object.values(projection.scenes)
  const title = data.visualization?.status === 'ready' && data.visualization.rendererKind === 'independent'
    ? data.visualization.title : data.title
  return <section ref={preview} className={css.preview} aria-label={t('chatPreview.title')} data-chat-preview data-preview-scene={data.sceneId}
    onKeyDown={event => {
      const composing = composition.current?.guards(event.nativeEvent) === true
      if (event.key !== 'Escape' || event.defaultPrevented || composing || isBehindModal(preview.current)
        || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || !tab.tab.visible || tab.tab.signal.aborted
        || !(event.target instanceof Node) || preview.current?.contains(event.target) !== true) return
      event.preventDefault(); event.stopPropagation()
      if (!event.repeat) tab.tab.actions.close()
    }}>
    <div className={css.sections} role="tablist" aria-label={t('chatPreview.sections')}>
      <button type="button" role="tab" aria-selected={state.section === 'experiment'} onClick={() => { actions.setSection('experiment') }}>
        {t('chatPreview.experiment')}
      </button>
      <button type="button" role="tab" aria-selected={state.section === 'notes'} onClick={() => { actions.setSection('notes') }}>
        {t('chatPreview.notes')}
      </button>
    </div>
    <div className={css.sceneHeading}>
      {scenes.length > 1 ? <GlassSelect className={css.sceneSelect} ariaLabel={t('chatPreview.history')} value={data.sceneId}
        options={scenes.map(scene => ({ value: scene.sceneId, label: scene.visualization?.status === 'ready'
          && scene.visualization.rendererKind === 'independent' ? scene.visualization.title : scene.title }))}
        onChange={sceneId => { actions.select(sceneId) }} /> : <h3>{title}</h3>}
    </div>
    <div className={css.experiment} hidden={state.section !== 'experiment'} role="tabpanel" aria-label={t('chatPreview.experiment')}>
      <OptionalSceneCardBody key={`${owner}:${data.sceneId}`} data={data} presentation="preview" t={t} openSceneInLab={openSceneInLab}
        {...(requestSceneInCanvas === undefined ? {} : { requestSceneInCanvas })}
        {...(questionCodeOwner === undefined ? {} : { questionCodeOwner })}
        {...(regenerateQuestionCode === undefined ? {} : { regenerateQuestionCode })}
        {...(recordAttempt === undefined ? {} : { recordAttempt })} />
    </div>
    <div className={css.notes} hidden={state.section !== 'notes'} role="tabpanel" aria-label={t('chatPreview.notes')}>
      <label htmlFor={`experiment-note-${sessionId}`}>{t('chatPreview.noteLabel')}</label>
      <textarea id={`experiment-note-${sessionId}`} value={state.notes[data.sceneId] ?? ''}
        placeholder={t('chatPreview.notePlaceholder')} onChange={event => { actions.writeNote(data.sceneId, event.target.value) }} />
      <p>{t('chatPreview.noteScope')}</p>
    </div>
  </section>
}
