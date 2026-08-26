/**
 * Lab self-check card — the 自测 tab of the AI 助教 drawer.
 *
 * Renders the experiment self-check set the current frame's topic selected
 * (see physics/experiment-self-checks.ts): conceptual probes about THIS
 * apparatus. A wrong pick opens the same diagnosis shape Question Space uses —
 * mistake class, explanation, the LIVE Verifier check backing the fact, and
 * review pointers — and every answer is written to the learning record with
 * the topic's knowledge nodes and its re-practice experiment. The card owns
 * only the chosen answers; all content is bank data, all evidence is the
 * runtime's own checks.
 */

import { useState } from 'react'
import clsx from 'clsx'
import { IconCheckOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { knowledgeNodeOf } from '@physicsos/question-core'
import type {
  ExperimentSelfCheckSet,
  SelfCheckItem,
  SelfCheckOption,
} from '@physicsos/question-core'

import { SELF_CHECK_EXPERIMENT } from './physics/experiment-self-checks.ts'
import type { VerificationCheckView } from './physics/scene-visual-model.ts'
import type { SelfCheckAttemptInput } from './QuestionWorkspace.tsx'
import css from './LabWorkspace.module.css'

const MISTAKE_TYPE_LABELS: Record<string, string> = {
  concept: '概念错误',
  direction: '方向错误',
  modeling: '建模错误',
}

/**
 * Resolve a bank evidence id against the frame's checks. The circuit engine
 * stamps per-source ids (`terminal_voltage_law:bat`), so a bank citation of
 * the family name matches by prefix; exact ids resolve literally.
 */
const resolveEvidence = (
  checks: readonly VerificationCheckView[],
  factId: string | undefined,
): VerificationCheckView | undefined => {
  if (factId === undefined) return undefined
  return checks.find(check => check.id === factId || check.id.startsWith(`${factId}:`))
}

export interface LabSelfCheckCardProps {
  readonly set: ExperimentSelfCheckSet
  /** Scene title, recorded as the attempt's 场景 name. */
  readonly sceneTitle: string
  /** Live checks of the current frame, cited as diagnosis evidence. */
  readonly verification: readonly VerificationCheckView[]
  readonly onRecord: ((attempt: SelfCheckAttemptInput) => void) | undefined
}

export function LabSelfCheckCard({
  set,
  sceneTitle,
  verification,
  onRecord,
}: LabSelfCheckCardProps) {
  /* Answers keyed by item id; the drawer remounts the card per topic via key. */
  const [answers, setAnswers] = useState<Readonly<Record<string, string>>>({})

  const answer = (item: SelfCheckItem, option: SelfCheckOption) => {
    if (answers[item.id] !== undefined) return
    setAnswers(current => ({ ...current, [item.id]: option.id }))
    const experimentId = SELF_CHECK_EXPERIMENT[set.id]
    onRecord?.({
      questionId: set.id,
      questionTitle: sceneTitle,
      selfCheckId: item.id,
      prompt: item.prompt,
      answerId: option.id,
      answerLabel: option.label,
      correct: option.correct === true,
      ...(option.mistake === undefined ? {} : { mistakeType: option.mistake.type }),
      knowledge: set.knowledge,
      ...(experimentId === undefined ? {} : { experimentId }),
    })
  }

  return (
    <article className={css.agentCard} data-physicsos-lab-selfcheck={set.id}>
      <div className={css.tutorTopic}>{set.topic}</div>
      <div className={css.quizKnowledgeRow}>
        {set.knowledge.map((nodeId) => {
          const node = knowledgeNodeOf(nodeId)
          return node === undefined ? null : (
            <span key={nodeId} className={css.agentChip} data-kind="scene">
              {node.label}
            </span>
          )
        })}
      </div>
      {set.items.map((item) => {
        const chosenId = answers[item.id]
        const chosen = item.options.find(option => option.id === chosenId)
        return (
          <div key={item.id} className={css.quizItem} data-lab-selfcheck-item={item.id}>
            <p className={css.quizPrompt}>{item.prompt}</p>
            <div className={css.quizOptions}>
              {item.options.map(option => (
                <button
                  key={option.id}
                  type="button"
                  className={clsx(
                    css.quizOption,
                    chosenId === option.id && option.correct === true && css.quizOptionCorrect,
                    chosenId === option.id && option.correct !== true && css.quizOptionWrong,
                    chosenId !== undefined && chosenId !== option.id && option.correct === true && css.quizOptionReveal,
                  )}
                  disabled={chosenId !== undefined}
                  onClick={() => { answer(item, option) }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {chosen === undefined ? null : chosen.correct === true ? (
              <div className={css.quizTakeaway} data-selfcheck-result="correct">
                <IconCheckOutline14 size={12} />
                {item.takeaway}
              </div>
            ) : (
              <LabDiagnosis option={chosen} verification={verification} />
            )}
          </div>
        )
      })}
    </article>
  )
}

/** The diagnosis a wrong option opens: 类型 → 解释 → Verifier 证据 → 复习建议. */
function LabDiagnosis({
  option,
  verification,
}: {
  readonly option: SelfCheckOption
  readonly verification: readonly VerificationCheckView[]
}) {
  const mistake = option.mistake
  if (mistake === undefined) return null
  const evidence = resolveEvidence(verification, mistake.evidenceCheckId)
  return (
    <div className={css.quizDiagnosis} data-selfcheck-result="wrong" data-mistake={mistake.type}>
      <span className={css.quizBadge} data-mistake={mistake.type}>
        {MISTAKE_TYPE_LABELS[mistake.type] ?? mistake.type}
      </span>
      <p className={css.quizExplanation}>{mistake.explanation}</p>
      {evidence === undefined ? null : (
        <p className={css.quizEvidence} data-passed={evidence.status === 'passed'}>
          Verifier：{evidence.id}
          {' '}
          {evidence.status === 'passed' ? 'PASS' : evidence.status === 'failed' ? 'FAIL' : '警告'}
        </p>
      )}
      <div className={css.quizReview}>
        <span>建议复习</span>
        {mistake.review.map(topic => (
          <span key={topic} className={css.quizReviewChip}>{topic}</span>
        ))}
      </div>
    </div>
  )
}
