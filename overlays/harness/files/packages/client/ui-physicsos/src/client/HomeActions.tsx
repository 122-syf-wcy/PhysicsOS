/**
 * Home content below the hero — the product modules, not one-off actions.
 *
 * Section by section: the two primary entry cards (物理实验室 / 题目空间), the
 * student's OWN real PhysicsScenes under 继续探索, and 今日物理挑战 over the
 * curated experiment recommendations. Nothing here is a Harness workspace,
 * folder or conversation row: every card is a PhysicsScene or an experiment
 * template, and every action lands on a product surface.
 */

import { useMemo } from 'react'
import clsx from 'clsx'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronRightOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from './runtime-compat.ts'
import { ExperimentArt, artTemplateIdOfSceneId } from './physics/experiment-artwork.tsx'
import { experimentMetaOf } from './physics/experiment-summaries.ts'
import { recommendExperiments } from './physics/experiment-recommendations.ts'
import { createExperimentSceneRef } from './physics/experiment-templates.ts'
import { IconPhysicsLab, IconPhysicsPlay, IconQuestionSheet } from './icons/physics-icons.tsx'
import type {
  PhysicsSceneRef, RecentExperimentEntry, RecentExperimentsState,
} from './surface-store.ts'
import { formatUpdatedAt, workspaceKnowledge } from './workspaceMeta.ts'
import css from './HomeActions.module.css'

export type HomeActionsInjected = {
  openSurface: (surface: 'home' | 'lab' | 'record', sceneRef?: PhysicsSceneRef) => void
  hooks: {
    recentExperiments: SnapshotStore<RecentExperimentsState>
  }
}

export type HomeActionsProps =
  & InjectFace<HomeActionsInjected>
  & PropsLocale<'physicsos'>

/** How many real scenes 继续探索 lists before the Lab's own list takes over. */
const RECENT_LIMIT = 4

/**
 * Whether a stored scene carries verification evidence.
 *
 * DERIVED, never claimed as engine output: a question-sourced scene states its
 * conditions as facts and its solution was verified when it was built
 * (docs/04 §Practice), and a scene forked from one inherits that provenance in
 * `metadata.lineage`. Anything else is honestly labelled 待验证 — the card never
 * asserts a check the engine did not run.
 *
 * @param entry - one stored recent scene.
 * @returns true when the scene descends from verified material.
 */
function sceneVerified(entry: RecentExperimentEntry): boolean {
  if (entry.kind === 'question') return true
  return entry.scene.metadata.lineage !== undefined
}

/** One 继续探索 card: a real PhysicsScene with its type, knowledge point and state. */
function RecentCard({ entry, openSurface, t }: {
  entry: RecentExperimentEntry
  openSurface: HomeActionsInjected['openSurface']
  t: HomeActionsProps['t']
}) {
  const knowledge = workspaceKnowledge(entry.title)
  const verified = sceneVerified(entry)
  return (
    <li>
      <button
        type="button"
        className={css.recentCard}
        aria-label={entry.title}
        onClick={() => {
          openSurface('lab', { sceneId: entry.sceneId, scene: entry.scene })
        }}
      >
        <span className={css.recentArt} aria-hidden="true">
          <ExperimentArt templateId={artTemplateIdOfSceneId(entry.sceneId)} kind={entry.kind} />
        </span>
        <span className={css.recentBody}>
          <span className={css.recentTop}>
            <span className={css.recentName}>{entry.title}</span>
            <span className={css.recentKind}>
              {t(entry.kind === 'question' ? 'recent.kind.question' : 'recent.kind.experiment')}
            </span>
          </span>
          <span className={css.recentKnowledge}>{knowledge.subject} / {knowledge.topic}</span>
          <span className={css.recentFoot}>
            <span className={clsx(css.verified, verified ? css.verifiedOk : css.verifiedPending)}>
              {t(verified ? 'home.recent.verified' : 'home.recent.unverified')}
            </span>
            <span className={css.recentTime}>{formatUpdatedAt(entry.updatedAt)}</span>
          </span>
        </span>
      </button>
    </li>
  )
}

/**
 * Render the Home content below the hero.
 * @param props - surface navigation, the student's recent scenes, product copy.
 */
export function HomeActions({ openSurface, useRecentExperiments, t }: HomeActionsProps) {
  const items = useRecentExperiments(s => s.items)
  const recent = items.slice(0, RECENT_LIMIT)
  /* Curated recommendations need no personal record: the classic set is the
     今日挑战 a first-time student sees, in 力→电→磁 order (docs/04 §Picker). */
  const recommendations = useMemo(() => recommendExperiments({ attempts: [], limit: 3 }), [])

  return (
    <div className={css.root}>
      <section className={css.entries} aria-label={t('home.cards.label')}>
        <button
          type="button"
          className={clsx(css.entry, css.entryLab)}
          aria-label={t('home.card.lab.title')}
          onClick={() => { openSurface('lab') }}
        >
          <span className={css.portalImage} aria-hidden="true">
            <ExperimentArt templateId="magnetic-circular" kind="experiment" />
          </span>
          <span className={css.entryBody}>
            <span className={css.entryTitle}>
              <span className={css.portalIcon}><IconPhysicsLab size={18} /></span>
              {t('home.card.lab.title')}
            </span>
            <span className={css.entryTagline}>{t('home.card.lab.tagline')}</span>
            <span className={css.entryAction}>
              {t('home.card.lab.action')}
              <IconChevronRightOutlineMedium size={14} />
            </span>
          </span>
        </button>

        <button
          type="button"
          className={clsx(css.entry, css.entryQuestion)}
          aria-label={t('home.card.question.title')}
          onClick={() => { openSurface('record') }}
        >
          <span className={css.portalImage} aria-hidden="true">
            <ExperimentArt templateId="magnetic-circular" kind="question" />
          </span>
          <span className={css.entryBody}>
            <span className={css.entryTitle}>
              <span className={css.portalIcon}><IconQuestionSheet size={18} /></span>
              {t('home.card.question.title')}
            </span>
            <span className={css.entryTagline}>{t('home.card.question.tagline')}</span>
            <span className={css.entryAction}>
              {t('home.card.question.action')}
              <IconChevronRightOutlineMedium size={14} />
            </span>
          </span>
        </button>
      </section>

      <section className={css.section} aria-label={t('home.recent.title')}>
        <header className={css.sectionHead}>
          <h2 className={css.sectionTitle}>{t('home.recent.title')}</h2>
        </header>
        {recent.length === 0 ? (
          <div className={css.recentEmpty}>
            <p className={css.emptyBody}>{t('home.recent.empty')}</p>
            <button
              type="button"
              className={css.emptyCta}
              onClick={() => { openSurface('lab') }}
            >
              {t('recent.emptyCta')}
            </button>
          </div>
        ) : (
          <ul className={css.recentList}>
            {recent.map(entry => (
              <RecentCard key={entry.sceneId} entry={entry} openSurface={openSurface} t={t} />
            ))}
          </ul>
        )}
      </section>

      <section className={css.section} aria-label={t('home.challenge.title')}>
        <header className={css.sectionHead}>
          <h2 className={css.sectionTitle}>{t('home.challenge.title')}</h2>
          <span className={css.sectionTag}>{t('home.challenge.recommended')}</span>
        </header>
        <ul className={css.challengeList}>
          {recommendations.map((pick) => {
            const meta = experimentMetaOf(pick.template.id)
            const chapter = meta?.textbook?.[0]?.chapter
            return (
              <li key={pick.template.id}>
                <button
                  type="button"
                  className={css.challengeCard}
                  aria-label={t(pick.template.label)}
                  onClick={() => {
                    openSurface(
                      'lab',
                      createExperimentSceneRef(pick.template, t(pick.template.label)),
                    )
                  }}
                >
                  <span className={css.challengeArt} aria-hidden="true">
                    <ExperimentArt templateId={pick.template.id} kind="experiment" />
                  </span>
                  <span className={css.challengeBody}>
                    <span className={css.challengeReason}>
                      {t(pick.reason === 'weakness'
                        ? 'home.challenge.weakness'
                        : 'home.challenge.classic')}
                    </span>
                    <span className={css.challengeTitle}>{t(pick.template.label)}</span>
                    {chapter === undefined ? null : (
                      <span className={css.challengeMeta}>{chapter}</span>
                    )}
                    <span className={css.challengeCta}>
                      {t('home.challenge.open')}
                      <IconPhysicsPlay size={12} />
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
