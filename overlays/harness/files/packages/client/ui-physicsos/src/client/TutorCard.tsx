/**
 * Tutor Mode card — the 引导 tab of the AI 助教 drawer.
 *
 * Renders one {@link TutorScript} as a progressive ladder: 观察 → 问题 →
 * 提示 1..n → 答案. The student climbs one rung per click; revealing a rung
 * fires its canvas highlights through the SAME tool path the Q&A agent uses,
 * and the answer cites the Verifier checks with their live status. The card
 * owns only the reveal progress — every physical fact comes from the script,
 * which reads the runtime context.
 */

import { useEffect, useState } from 'react'
import { IconSparkle16 } from '@deepseek-ai/dsh-client-ui-primitives'

import type { PhysicsAgentToolCall } from './physics/physics-agent.ts'
import type { TutorScript, TutorStage } from './physics/physics-tutor.ts'
import type { PhysicsosKey } from './locales.ts'
import css from './LabWorkspace.module.css'

type Translate = (key: PhysicsosKey) => string

export interface TutorCardProps {
  readonly script: TutorScript
  readonly t: Translate
  /** Shared tool runner from the drawer; highlights merge and expire there. */
  readonly runTools: (tools: readonly PhysicsAgentToolCall[]) => unknown
}

const highlightCalls = (stage: TutorStage): PhysicsAgentToolCall[] =>
  (stage.highlights ?? []).map(targetId => ({
    tool: 'physics.ui.highlight',
    targetId,
    duration: 2600,
  }))

export function TutorCard({ script, t, runTools }: TutorCardProps) {
  const [revealed, setRevealed] = useState(0)
  const [answered, setAnswered] = useState(false)

  /* A different lesson (other apparatus, or the balance flipped after an edit)
     restarts the ladder — half-revealed hints for a stale lesson would lie. */
  useEffect(() => {
    setRevealed(0)
    setAnswered(false)
  }, [script.id])

  const revealNext = () => {
    const stage = script.hints[revealed]
    if (stage === undefined) return
    setRevealed(count => count + 1)
    if (stage.highlights !== undefined && stage.highlights.length > 0) {
      runTools(highlightCalls(stage))
    }
  }

  const revealAnswer = () => {
    setAnswered(true)
    if (script.answer.highlights !== undefined && script.answer.highlights.length > 0) {
      runTools(highlightCalls(script.answer))
    }
  }

  const restart = () => {
    setRevealed(0)
    setAnswered(false)
  }

  return (
    <article className={css.agentCard} data-physicsos-tutor={script.id}>
      <div className={css.tutorTopic}>
        <IconSparkle16 size={13} />
        {script.topic}
      </div>

      {script.observation.length === 0 ? null : (
        <div className={css.agentCardAnalysis}>
          <span className={css.agentCardLabel}>{t('lab.tutor.observe')}</span>
          <ul className={css.tutorObserveList}>
            {script.observation.map(line => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={css.agentCardQuestion}>
        <span className={css.agentCardLabel}>{t('lab.tutor.question')}</span>
        <p>{script.question}</p>
      </div>

      {script.hints.slice(0, revealed).map(stage => (
        <div key={stage.id} className={css.tutorHint} data-tutor-stage={stage.id}>
          <span className={css.agentCardLabel}>{stage.title}</span>
          {stage.paragraphs.map((paragraph, index) => (
            <p key={index} className={css.agentParagraph}>{paragraph}</p>
          ))}
        </div>
      ))}

      {answered ? (
        <div className={css.tutorAnswer} data-tutor-stage="answer">
          <span className={css.agentCardLabel}>{t('lab.tutor.answer')}</span>
          {script.answer.paragraphs.map((paragraph, index) => (
            <p key={index} className={css.agentParagraph}>{paragraph}</p>
          ))}
          {script.evidence.length === 0 ? null : (
            <>
              <span className={css.agentCardLabel}>{t('lab.agent.basis')}</span>
              <div className={css.agentChipRow}>
                {script.evidence.map(evidence => (
                  <span
                    key={evidence.label}
                    className={css.agentChip}
                    data-kind="verification"
                    data-status={evidence.status}
                  >
                    {evidence.label}
                    {' · '}
                    {evidence.status === 'passed' ? 'PASS' : evidence.status === 'failed' ? 'FAIL' : '警告'}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}

      <div className={css.tutorControls}>
        {revealed < script.hints.length && !answered ? (
          <button type="button" className={css.agentAction} onClick={revealNext}>
            {t('lab.tutor.nextHint')}
            {` ${revealed + 1}/${script.hints.length}`}
          </button>
        ) : null}
        {!answered ? (
          <button type="button" className={css.agentAction} onClick={revealAnswer}>
            {t('lab.tutor.showAnswer')}
          </button>
        ) : (
          <button type="button" className={css.agentAction} onClick={restart}>
            {t('lab.tutor.restart')}
          </button>
        )}
      </div>
    </article>
  )
}
