import { sceneRefOf } from './surface-store.ts'
import {
  IconBrowseOutlineMedium, IconChevronRightOutlineMedium, IconFolderOpenOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from './runtime-compat.ts'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { GOLDEN_QUESTIONS } from '@physicsos/question-core'
import { fillComposerDraft } from './fill-draft.ts'
import { IconPhysicsLab, IconQuestionSheet } from './icons/physics-icons.tsx'
import type { PhysicsSceneRef, RecentExperimentsState } from './surface-store.ts'
import { formatUpdatedAt, workspaceKnowledge } from './workspaceMeta.ts'
import css from './HomeActions.module.css'

export type HomeActionsInjected = {
  openSurface: (surface: 'home' | 'lab' | 'record' | 'canvas', sceneRef?: PhysicsSceneRef) => void
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
export function HomeActions({ useRecentExperiments, openSurface, openCanvasView, newCanvas, requestSceneInCanvas, t }: HomeActionsProps) {
  const items = useRecentExperiments(s => s.items)
  return (
    <div className={css.root}>
      <ul className={css.examples} aria-label={t('examples.label')}>
        {(['examples.magnet', 'examples.projectile', 'examples.work'] as const).map(key => (
          <li key={key}>
            <button
              type="button"
              className={css.example}
              onClick={() => { fillComposerDraft(t(key)) }}
            >
              {t(key)}
            </button>
          </li>
        ))}
      </ul>
      <div className={css.portals}>
        <button
          type="button"
          className={css.portal}
          aria-label={t('canvas.new')}
          onClick={() => { void newCanvas(t('canvas.untitled')).catch(() => undefined) }}
        >
          <img
            className={css.portalImage}
            src="/physicsos/lab-portal-hero.jpg"
            alt=""
            aria-hidden="true"
          />
          <span className={css.portalBody}>
            <span className={css.portalTitle}>
              <span className={css.portalIcon}><IconPhysicsLab size={18} /></span>
              {t('canvas.new')}
            </span>
            <span className={css.portalDescription}>{t('canvas.subtitle')}</span>
            <span className={css.portalMeta}>
              {t('canvas.emptyBoardHint')}
              <IconChevronRightOutlineMedium size={14} />
            </span>
          </span>
        </button>
        {/* The question bank lives on the record surface: picking one hands the
            stem to the tutor and the solved scene card lands in the chat. */}
        <button
          type="button"
          className={css.portal}
          aria-label={t('action.upload')}
          onClick={() => { openSurface('record') }}
        >
          <img
            className={css.portalImage}
            src="/physicsos/question-portal-hero.jpg"
            alt=""
            aria-hidden="true"
          />
          <span className={css.portalBody}>
            <span className={css.portalTitle}>
              <span className={css.portalIcon}><IconQuestionSheet size={18} /></span>
              {t('action.upload')}
            </span>
            <span className={css.portalDescription}>{t('home.questions.description')}</span>
            <span className={css.portalMeta}>
              {t('home.questions.meta').replace('{count}', String(GOLDEN_QUESTIONS.length))}
              <IconChevronRightOutlineMedium size={14} />
            </span>
          </span>
        </button>
      </div>
      <div className={css.utilities}>
        <button
          type="button"
          className={css.action}
          onClick={() => { openCanvasView() }}
        >
          <IconFolderOpenOutlineMedium size={16} />
          <span>{t('canvas.open')}</span>
        </button>
        <button
          type="button"
          className={css.action}
          onClick={() => { openSurface('lab') }}
        >
          <IconBrowseOutlineMedium size={16} />
          <span>{t('action.templates')}</span>
        </button>
      </div>
      <section className={css.recent} aria-label={t('recent.title')}>
        <h2 className={css.recentTitle}>{t('recent.title')}</h2>
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
