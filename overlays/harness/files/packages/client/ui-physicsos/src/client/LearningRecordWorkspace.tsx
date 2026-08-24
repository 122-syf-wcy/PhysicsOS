/**
 * 学习记录 — the student's learning ledger.
 *
 * Reads the {@link LearningRecordState} the self-checks wrote and shows three
 * views over the SAME attempts: totals (练习/正确率), mistakes grouped by their
 * classified type (概念/方向/建模), and mastery per knowledge node from the
 * curriculum graph. Every row links back to its question through 重新练习, so a
 * mistake is one click away from being practised again. This surface computes
 * nothing but counts.
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { KNOWLEDGE_NODES, knowledgeNodeOf, type MistakeType } from '@physicsos/question-core'

import {
  knowledgeMasteryOf,
  mistakeCountsOf,
  recentMistakesOf,
  type LearningRecordState,
} from './learning-record-store.ts'
import { formatUpdatedAt } from './workspaceMeta.ts'
import css from './LearningRecordWorkspace.module.css'

/** Registration-side face for {@link LearningRecordWorkspace}. */
export interface LearningRecordInjected {
  hooks: {
    learningRecord: SnapshotStore<LearningRecordState>
  }
  /** Open Question Space on the mistake's question (重新练习). */
  openQuestion: (questionId: string) => void
}

export type LearningRecordWorkspaceProps = PropsRuntime<'conversation.surface'> &
  PropsLocale<'physicsos'> &
  InjectFace<LearningRecordInjected>

export const MISTAKE_LABELS: Readonly<Record<MistakeType, string>> = {
  concept: '概念错误',
  direction: '方向错误',
  modeling: '建模错误',
}

export function LearningRecordWorkspace({
  useLearningRecord,
  openQuestion,
  t,
}: LearningRecordWorkspaceProps) {
  const attempts = useLearningRecord(state => state.attempts)
  const total = attempts.length
  const correct = attempts.filter(attempt => attempt.correct).length
  const mistakes = mistakeCountsOf(attempts)
  const mastery = knowledgeMasteryOf(attempts)
  const recent = recentMistakesOf(attempts, 12)
  const accuracy = total === 0 ? 0 : Math.round((correct / total) * 100)

  /* Curriculum order, not first-seen order: the graph is the stable frame the
     student recognises, attempts merely fill it in. */
  const masteryByNode = new Map(mastery.map(entry => [entry.nodeId, entry]))
  const practisedNodes = KNOWLEDGE_NODES.filter(
    node => node.parentId !== undefined && masteryByNode.has(node.id),
  )

  return (
    <div className={css.cover} data-physicsos-surface="record">
      <header className={css.toolbar}>
        <div>
          <span className={css.eyebrow}>PhysicsOS / {t('record.title')}</span>
          <h1 className={css.title}>{t('record.heading')}</h1>
        </div>
        <div className={css.summaryRow}>
          <div className={css.summaryCard}>
            <span className={css.summaryValue}>{total}</span>
            <span className={css.summaryLabel}>{t('record.totalAttempts')}</span>
          </div>
          <div className={css.summaryCard}>
            <span className={css.summaryValue}>{total === 0 ? '—' : `${accuracy}%`}</span>
            <span className={css.summaryLabel}>{t('record.accuracy')}</span>
          </div>
          <div className={css.summaryCard}>
            <span className={css.summaryValue}>{total - correct}</span>
            <span className={css.summaryLabel}>{t('record.mistakes')}</span>
          </div>
        </div>
      </header>

      {total === 0 ? (
        <div className={css.empty}>
          <p className={css.emptyTitle}>{t('record.emptyTitle')}</p>
          <p className={css.emptyBody}>{t('record.emptyBody')}</p>
        </div>
      ) : (
        <div className={css.body}>
          <section className={css.panel} aria-label={t('record.mistakeTypes')}>
            <h2 className={css.panelTitle}>{t('record.mistakeTypes')}</h2>
            <div className={css.mistakeRow}>
              {(Object.keys(MISTAKE_LABELS) as MistakeType[]).map(type => (
                <div key={type} className={css.mistakeCard} data-mistake={type}>
                  <span className={css.mistakeCount}>{mistakes[type]}</span>
                  <span className={css.mistakeLabel}>{MISTAKE_LABELS[type]}</span>
                </div>
              ))}
            </div>

            <h2 className={css.panelTitle}>{t('record.recentMistakes')}</h2>
            {recent.length === 0 ? (
              <p className={css.muted}>{t('record.noMistakes')}</p>
            ) : (
              <ul className={css.mistakeList}>
                {recent.map(attempt => (
                  <li key={attempt.id} className={css.mistakeItem}>
                    <div className={css.mistakeHead}>
                      <span className={css.mistakeBadge} data-mistake={attempt.mistakeType}>
                        {attempt.mistakeType === undefined ? '错误' : MISTAKE_LABELS[attempt.mistakeType]}
                      </span>
                      <span className={css.mistakeQuestion}>{attempt.questionTitle}</span>
                      <span className={css.mistakeTime}>{formatUpdatedAt(attempt.at)}</span>
                    </div>
                    <p className={css.mistakePrompt}>{attempt.prompt}</p>
                    <p className={css.mistakeAnswer}>
                      {t('record.yourAnswer')}
                      {attempt.answerLabel}
                    </p>
                    <button
                      type="button"
                      className={css.practiseButton}
                      onClick={() => { openQuestion(attempt.questionId) }}
                    >
                      {t('record.practiseAgain')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={css.panel} aria-label={t('record.knowledge')}>
            <h2 className={css.panelTitle}>{t('record.knowledge')}</h2>
            <ul className={css.knowledgeList}>
              {practisedNodes.map((node) => {
                const entry = masteryByNode.get(node.id)
                if (entry === undefined) return null
                const parent = node.parentId === undefined ? undefined : knowledgeNodeOf(node.parentId)
                const rate = entry.total === 0 ? 0 : Math.round((entry.correct / entry.total) * 100)
                return (
                  <li key={node.id} className={css.knowledgeItem} data-node={node.id}>
                    <div className={css.knowledgeHead}>
                      <span className={css.knowledgeDomain}>{parent?.label ?? ''}</span>
                      <span className={css.knowledgeName}>{node.label}</span>
                      <span className={css.knowledgeRate}>
                        {entry.correct}/{entry.total}
                      </span>
                    </div>
                    <div className={css.knowledgeBar} role="img" aria-label={`${node.label} ${rate}%`}>
                      <div className={css.knowledgeFill} style={{ width: `${rate}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        </div>
      )}
    </div>
  )
}
