import { sceneRefOf } from './surface-store.ts'
import {
  IconBrowseOutlineMedium, IconFolderOpenOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from './runtime-compat.ts'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { fillComposerDraft } from './fill-draft.ts'
import { IconPhysicsLab, IconQuestionSheet } from './icons/physics-icons.tsx'
import type { PhysicsSceneRef, RecentExperimentsState } from './surface-store.ts'
import { formatUpdatedAt, workspaceKnowledge } from './workspaceMeta.ts'
import css from './HomeActions.module.css'

export type HomeActionsInjected = {
  openSurface: (surface: 'home' | 'lab' | 'record' | 'canvas' | 'projects', sceneRef?: PhysicsSceneRef) => void
  startQuestion?: () => void
  openCanvasView: (canvasId?: string) => void
  newCanvas: (title: string) => Promise<string>
  requestSceneInCanvas: (sceneRef: PhysicsSceneRef) => void
  hooks: {
    recentExperiments: SnapshotStore<RecentExperimentsState>
  }
}

export type HomeActionsProps =
  & InjectFace<HomeActionsInjected>
  & PropsLocale<'physicsos'>

/** Quick actions and the recent real-scene list under the hero composer. */
export function HomeActions({ useRecentExperiments, openSurface, requestSceneInCanvas, startQuestion, t }: HomeActionsProps) {
  const items = useRecentExperiments(s => s.items)
  return (
    <div className={css.root}>
      <div className={css.quickActions} aria-label={t('home.cards.label')}>
        <button type="button" className={css.quickAction} onClick={() => { if (startQuestion !== undefined) startQuestion(); else fillComposerDraft(t('home.ask.action')) }}><IconQuestionSheet size={17} />{t('home.quick.question')}</button>
        <button type="button" className={css.quickAction} onClick={() => { openSurface('lab') }}><IconPhysicsLab size={17} />{t('home.quick.experiment')}</button>
        <button type="button" className={css.quickAction} onClick={() => { fillComposerDraft(t('home.quick.conceptPrompt')) }}><IconBrowseOutlineMedium size={17} />{t('home.quick.concept')}</button>
        <button type="button" className={css.quickAction} onClick={() => { fillComposerDraft(t('home.quick.teachingPrompt')) }}><IconFolderOpenOutlineMedium size={17} />{t('home.quick.teaching')}</button>
      </div>
      <section className={css.recent} aria-label={t('recent.title')}>
        <h2 className={css.recentTitle}>{t('home.recent.title')}</h2>
        {items.length === 0 ? (
          <div className={css.empty}>
            <img
              className={css.emptyImage}
              src="/physicsos/lab-empty-hero.jpg"
              alt=""
              aria-hidden="true"
            />
            <p className={css.emptyTitle}>{t('recent.emptyTitle')}</p>
            <p className={css.emptyBody}>{t('recent.emptyBody')}</p>
            <button
              type="button"
              className={css.emptyCta}
              onClick={() => { openSurface('lab') }}
            >
              {t('recent.emptyCta')}
            </button>
          </div>
        ) : (
          <ul className={css.list}>
            {items.slice(0, 5).map((entry) => {
              const knowledge = workspaceKnowledge(entry.title)
              return (
                <li key={entry.sceneId}>
                  <button
                    type="button"
                    className={css.recentItem}
                    onClick={() => {
                      openSurface('lab', sceneRefOf(entry))
                    }}
                  >
                    <IconFolderOpenOutlineMedium size={16} />
                    <span className={css.recentName}>{entry.title}</span>
                    <span className={css.recentMeta}>
                      {knowledge.subject}
                      {' / '}
                      {knowledge.topic}
                      {' · '}
                      {t(entry.kind === 'question' ? 'recent.kind.question' : 'recent.kind.experiment')}
                    </span>
                    <span className={css.recentTime}>{formatUpdatedAt(entry.updatedAt)}</span>
                  </button>
                  <button type="button" className={css.action} aria-label={`${t('canvas.addToCanvas')} · ${entry.title}`}
                    onClick={() => { requestSceneInCanvas(sceneRefOf(entry)) }}>{t('canvas.addToCanvas')}</button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
