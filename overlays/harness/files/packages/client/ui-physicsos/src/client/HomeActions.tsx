import {
  IconBrowseOutline16, IconChevronRightOutline14, IconFolderOpen16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { GOLDEN_QUESTIONS } from '@physicsos/question-core'
import { fillComposerDraft } from './fill-draft.ts'
import { IconPhysicsLab, IconQuestionSheet } from './icons/physics-icons.tsx'
import { formatUpdatedAt, workspaceKnowledge } from './workspaceMeta.ts'
import css from './HomeActions.module.css'

export type HomeActionsInjected = {
  startSession: (workspaceId?: WorkspaceId) => void
  openSurface: (surface: 'home' | 'lab' | 'questions') => void
}

export type HomeActionsProps =
  & PropsRuntime<'conversation.hero.actions'>
  & HomeActionsInjected
  & PropsLocale<'physicsos'>

/** Quick actions and recent workspaces under the hero composer. */
export function HomeActions({ useWorkspaces, startSession, openSurface, t }: HomeActionsProps) {
  const items = useWorkspaces(s => s.items)
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
          aria-label={t('action.newLab')}
          onClick={() => { openSurface('lab') }}
        >
          <img
            className={css.portalImage}
            src="/physicsos/magnetic-lab-hero.jpg"
            alt=""
            aria-hidden="true"
          />
          <span className={css.portalBody}>
            <span className={css.portalTitle}>
              <span className={css.portalIcon}><IconPhysicsLab size={18} /></span>
              {t('action.newLab')}
            </span>
            <span className={css.portalDescription}>{t('home.lab.description')}</span>
            <span className={css.portalMeta}>
              {t('home.lab.meta')}
              <IconChevronRightOutline14 size={14} />
            </span>
          </span>
        </button>
        <button
          type="button"
          className={css.portal}
          aria-label={t('action.upload')}
          onClick={() => { openSurface('questions') }}
        >
          <img
            className={css.portalImage}
            src="/physicsos/magnetic-question-hero.jpg"
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
              <IconChevronRightOutline14 size={14} />
            </span>
          </span>
        </button>
      </div>
      <div className={css.utilities}>
        <button
          type="button"
          className={css.action}
          disabled
          title={t('feature.unavailable')}
        >
          <IconFolderOpen16 size={16} />
          <span>{t('action.openScene')}</span>
        </button>
        <button
          type="button"
          className={css.action}
          disabled
          title={t('feature.unavailable')}
        >
          <IconBrowseOutline16 size={16} />
          <span>{t('action.templates')}</span>
        </button>
      </div>
      <section className={css.recent} aria-label={t('recent.title')}>
        <h2 className={css.recentTitle}>{t('recent.title')}</h2>
        {items.length === 0 ? (
          <div className={css.empty}>
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
            {items.slice(0, 5).map((workspace) => {
              const knowledge = workspaceKnowledge(workspace.title)
              return (
                <li key={workspace.workspaceId}>
                  <button
                    type="button"
                    className={css.recentItem}
                    onClick={() => { startSession(workspace.workspaceId) }}
                  >
                    <IconFolderOpen16 size={16} />
                    <span className={css.recentName}>{workspace.title}</span>
                    <span className={css.recentMeta}>
                      {knowledge.subject}
                      {' / '}
                      {knowledge.topic}
                    </span>
                    <span className={css.recentTime}>{formatUpdatedAt(workspace.updatedAt)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
