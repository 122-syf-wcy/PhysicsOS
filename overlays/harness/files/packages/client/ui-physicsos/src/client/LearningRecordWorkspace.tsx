/**
 * 学习记录 — the student's learning ledger.
 *
 * Reads the {@link LearningRecordState} the self-checks wrote and shows three
 * views over the SAME attempts: totals (练习/正确率), mistakes grouped by their
 * classified type (概念/方向/建模), and mastery per knowledge node from the
 * curriculum graph. Every row links back to its question through 重新练习 —
 * the golden stem is handed to the session's tutor, so the solved scene card
 * streams into the conversation — and the 题库练习 bank starts the same loop
 * for a question the student has not tried yet. This surface computes nothing
 * but counts.
 */

import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  GOLDEN_QUESTIONS,
  goldenQuestionDomain,
  KNOWLEDGE_NODES,
  knowledgeNodeOf,
  type GoldenQuestionDefinition,
  type MistakeType,
} from '@physicsos/question-core'

import {
  knowledgeMasteryOf,
  mistakeCountsOf,
  type LearningRecordState,
} from './learning-record-store.ts'
import { ActivityHeatmap } from './ActivityHeatmap.tsx'
import { Mascot } from './Mascot.tsx'
import { formatUpdatedAt } from './workspaceMeta.ts'
import css from './LearningRecordWorkspace.module.css'

/** Registration-side face for {@link LearningRecordWorkspace}. */
export interface LearningRecordInjected {
  hooks: {
    learningRecord: SnapshotStore<LearningRecordState>
  }
  /**
   * Practise a golden question in the conversation: the stem goes to the tutor
   * and the solved scene card streams in. Absent when no session service is
   * available; the practice entries hide themselves then.
   */
  practiceQuestion?: ((
    questionId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>) | undefined
  /** Reopen the experiment template of a lab 自测 mistake (重做实验). */
  openExperiment: (experimentId: string) => void
}

export type LearningRecordWorkspaceProps = PropsRuntime<'conversation.surface'> &
  PropsLocale<'physicsos'> &
  InjectFace<LearningRecordInjected>

export const MISTAKE_LABELS: Readonly<Record<MistakeType, string>> = {
  concept: '概念错误',
  direction: '方向错误',
  modeling: '建模错误',
}

/** Question-bank group headings, in first-seen order over GOLDEN_QUESTIONS. */
const QUESTION_DOMAIN_LABELS: Readonly<
  Record<NonNullable<GoldenQuestionDefinition['expectedDomain']>, string>
> = {
  magnetic: '磁场与洛伦兹力',
  electric: '电场',
  composite: '复合场',
  mechanics: '力学',
  circuit: '电路',
  optics: '几何光学',
  induction: '电磁感应',
  wave: '振动与波',
}

export function LearningRecordWorkspace({
  useLearningRecord,
  practiceQuestion,
  openExperiment,
  t,
}: LearningRecordWorkspaceProps) {
  const attempts = useLearningRecord(state => state.attempts)
  /* The practice hand-off is async (a session may need creating); the pending
     id keeps the clicked row honest and a failure surfaces next to it. */
  const [practising, setPractising] = useState<string | null>(null)
  const [practiceError, setPracticeError] = useState<string | null>(null)
  const practise = (questionId: string) => {
    if (practiceQuestion === undefined || practising !== null) return
    setPractising(questionId)
    setPracticeError(null)
    void practiceQuestion(questionId).then((result) => {
      setPractising(null)
      if (!result.ok) setPracticeError(result.error)
    })
  }
  const total = attempts.length
  const correct = attempts.filter(attempt => attempt.correct).length
  const mistakes = mistakeCountsOf(attempts)
  const mastery = knowledgeMasteryOf(attempts)
  /* The ledger lists every attempt, not only wrong ones — a record page that
     hides correct answers reads as empty even after the student practised. */
  const recent = attempts.slice(0, 12)
  const accuracy = total === 0 ? 0 : Math.round((correct / total) * 100)

  /* Bank order is the curriculum's own: first-seen domain, then bank order. */
  const bankGroups = new Map<
    NonNullable<GoldenQuestionDefinition['expectedDomain']>,
    GoldenQuestionDefinition[]
  >()
  for (const question of GOLDEN_QUESTIONS) {
    const domain = goldenQuestionDomain(question)
    const group = bankGroups.get(domain) ?? []
    group.push(question)
    bankGroups.set(domain, group)
  }

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

      <ActivityHeatmap attempts={attempts} />

      {practiceQuestion === undefined ? null : (
        <section className={css.panel} aria-label={t('record.practiceBank')}>
          <h2 className={css.panelTitle}>{t('record.practiceBank')}</h2>
          <p className={css.muted}>{t('record.practiceBankHint')}</p>
          {[...bankGroups.entries()].map(([domain, questions]) => (
            <div key={domain} className={css.practiceGroup}>
              <h3 className={css.practiceGroupTitle}>{QUESTION_DOMAIN_LABELS[domain]}</h3>
              <ul className={css.practiceList}>
                {questions.map(question => (
                  <li key={question.id}>
                    <button
                      type="button"
                      className={css.practiseButton}
                      data-practice={question.id}
                      disabled={practising !== null}
                      onClick={() => { practise(question.id) }}
                    >
                      {question.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {practiceError === null ? null : (
            <p className={css.practiceError} role="alert">{practiceError}</p>
          )}
        </section>
      )}

      {total === 0 ? (
        <div className={css.empty}>
          <Mascot pose="search" size={128} className={css.emptyMascot} />
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

            <h2 className={css.panelTitle}>{t('record.recentAttempts')}</h2>
            <ul className={css.mistakeList}>
              {recent.map(attempt => (
                <li key={attempt.id} className={css.mistakeItem} data-correct={attempt.correct}>
                  <div className={css.mistakeHead}>
                    <span
                      className={css.mistakeBadge}
                      data-mistake={attempt.mistakeType}
                      data-result={attempt.correct ? 'correct' : 'wrong'}
                    >
                      {attempt.correct
                        ? t('record.correctBadge')
                        : attempt.mistakeType === undefined
                          ? '错误'
                          : MISTAKE_LABELS[attempt.mistakeType]}
                    </span>
                    <span className={css.mistakeQuestion}>{attempt.questionTitle}</span>
                    <span className={css.mistakeTime}>{formatUpdatedAt(attempt.at)}</span>
                  </div>
                  <p className={css.mistakePrompt}>{attempt.prompt}</p>
                  <p className={css.mistakeAnswer}>
                    {t('record.yourAnswer')}
                    {attempt.answerLabel}
                  </p>
                  {/* A lab attempt re-practises on the apparatus itself; a
                        question attempt goes back to the conversation, where
                        the tutor re-solves it into a fresh scene card. */}
                  <button
                    type="button"
                    className={css.practiseButton}
                    data-practise={attempt.experimentId === undefined ? 'question' : 'experiment'}
                    disabled={
                      attempt.experimentId === undefined
                        ? (practiceQuestion === undefined || practising !== null)
                        : false
                    }
                    onClick={() => {
                      if (attempt.experimentId === undefined) practise(attempt.questionId)
                      else openExperiment(attempt.experimentId)
                    }}
                  >
                    {t(attempt.experimentId === undefined
                      ? 'record.practiseAgain'
                      : 'record.practiseExperiment')}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className={css.panel} aria-label={t('record.knowledge')}>
            <h2 className={css.panelTitle}>{t('record.knowledge')}</h2>
            {practisedNodes.length === 0 ? (
              <p className={css.muted}>{t('record.knowledgeEmpty')}</p>
            ) : (
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
                        <div className={css.knowledgeFill} style={{ transform: `scaleX(${rate / 100})` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
