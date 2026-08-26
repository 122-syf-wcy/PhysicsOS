/**
 * Agent Drawer — structured analysis card.
 *
 * Reads the live physics context, answers from facts the runtime already produced,
 * and acts only through tools. Each answer is rendered as a structured card:
 * 问题 → 分析 → 依据 chips → 操作按钮, never as free-form chat.
 *
 * A highlight is view state; a parameter change is a real SceneCommand — the
 * Drawer shows which happened by citing the revision.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconCloseOutline16, IconSparkle16 } from '@deepseek-ai/dsh-client-ui-primitives'

import {
  highlightLabel,
  physicsAgentContext,
  runPhysicsAgentTool,
  type PhysicsAgentToolCall,
} from './physics/physics-agent.ts'
import { agentSuggestions, matchIntent, type AgentAnswer } from './physics/physics-agent-answers.ts'
import { experimentSelfChecksOf } from './physics/experiment-self-checks.ts'
import { tutorScriptOf } from './physics/physics-tutor.ts'
import { LabSelfCheckCard } from './LabSelfCheckCard.tsx'
import { TutorCard } from './TutorCard.tsx'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './physics/workspace-runtime.ts'
import type { SelfCheckAttemptInput } from './QuestionWorkspace.tsx'
import type { PhysicsosKey } from './locales.ts'
import css from './LabWorkspace.module.css'

/** How long a tool-driven highlight stays before it releases the canvas. */
const DEFAULT_HIGHLIGHT_MS = 1800

interface Turn {
  readonly id: number
  readonly question: string
  readonly answer: AgentAnswer | undefined
  /** Tool results, already student-facing. */
  readonly effects: readonly { ok: boolean; detail: string }[]
}

export interface AgentDrawerProps {
  readonly snapshot: WorkspaceSnapshot
  readonly runtime: WorkspaceRuntime
  readonly onSnapshot: (snapshot: WorkspaceSnapshot) => void
  readonly onClose: () => void
  readonly t: (key: PhysicsosKey) => string
  /** Write a lab self-check answer into the learning record. */
  readonly recordAttempt?: (attempt: SelfCheckAttemptInput) => void
}

export function AgentDrawer({ snapshot, runtime, onSnapshot, onClose, t, recordAttempt }: AgentDrawerProps) {
  const [turns, setTurns] = useState<readonly Turn[]>([])
  /* 问答 answers ad-hoc questions; 引导 walks the tutor ladder; 自测 asks the
     bank's conceptual probes. One drawer, three teaching styles — all read the
     same runtime facts. */
  const [mode, setMode] = useState<'ask' | 'tutor' | 'selfcheck'>('ask')
  const turnId = useRef(0)
  const clearTimer = useRef<number | undefined>(undefined)

  const context = useMemo(() => physicsAgentContext(snapshot), [snapshot])
  const suggestions = useMemo(() => agentSuggestions(context), [context])
  const tutorScript = useMemo(() => tutorScriptOf(context), [context])
  const selfChecks = useMemo(() => experimentSelfChecksOf(context), [context])

  /* The 自测 tab exists only where the bank has probes for this frame's topic,
     so no domain ever shows an empty quiz. */
  const tabs: readonly (readonly ['ask' | 'tutor' | 'selfcheck', PhysicsosKey])[] = [
    ['ask', 'lab.agent.tab.ask'],
    ['tutor', 'lab.agent.tab.tutor'],
    ...(selfChecks === undefined
      ? []
      : [['selfcheck', 'lab.agent.tab.selfcheck'] as const]),
  ]

  /* A highlight is transient chrome: it must not outlive the drawer, or the canvas
     keeps a glow nobody asked for. Clearing the timer alone is not enough — the
     highlight itself has to be released, too. */
  useEffect(() => () => {
    if (clearTimer.current !== undefined) window.clearTimeout(clearTimer.current)
    onSnapshot(runtime.setHighlight([]))
  }, [runtime, onSnapshot])

  const runTools = useCallback(
    (tools: readonly PhysicsAgentToolCall[]): readonly { ok: boolean; detail: string }[] => {
      const effects: { ok: boolean; detail: string }[] = []
      let highlightDuration: number | undefined
      /* One answer may highlight several quantities (电场力 + 洛伦兹力 + 合力).
         Each call resolves and applies individually, then the UNION is applied
         once, so the student sees the compared vectors together — replace-only
         semantics would keep just the last target. */
      const highlighted: string[] = []
      for (const call of tools) {
        const outcome = runPhysicsAgentTool(runtime, call)
        effects.push({ ok: outcome.ok, detail: outcome.detail })
        onSnapshot(outcome.snapshot)
        if (call.tool === 'physics.ui.highlight' && outcome.ok) {
          highlightDuration = call.duration ?? DEFAULT_HIGHLIGHT_MS
          highlighted.push(...outcome.highlightIds ?? [])
        }
      }
      if (highlighted.length > 0) {
        onSnapshot(runtime.setHighlight([...new Set(highlighted)]))
      }
      if (highlightDuration !== undefined) {
        if (clearTimer.current !== undefined) window.clearTimeout(clearTimer.current)
        clearTimer.current = window.setTimeout(() => {
          onSnapshot(runtime.setHighlight([]))
        }, highlightDuration)
      }
      return effects
    },
    [runtime, onSnapshot],
  )

  const ask = useCallback(
    (question: string) => {
      const text = question.trim()
      if (text.length === 0) return
      const answer = matchIntent(text, physicsAgentContext(runtime.getSnapshot()))
      const effects = answer === undefined ? [] : runTools(answer.tools)
      turnId.current += 1
      setTurns(current => [...current, { id: turnId.current, question: text, answer, effects }])
    },
    [runtime, runTools],
  )

  /* Re-execute a single tool call from a previous turn (e.g. re-highlight after the
     glow expired, or re-apply a parameter). */
  const reRunTool = useCallback(
    (call: PhysicsAgentToolCall) => {
      runTools([call])
    },
    [runTools],
  )

  /* Losing the topic (e.g. the scene stopped being a circuit frame after a
     failure) removes the tab, so a stale 自测 selection falls back to 问答. */
  const activeMode = mode === 'selfcheck' && selfChecks === undefined ? 'ask' : mode

  return (
    <aside className={css.agentDrawer} aria-label={t('lab.agent')}>
      <div className={css.panelHead}>
        <h2 className={css.panelTitle}>{t('lab.agent')}</h2>
        <div className={css.agentModeTabs} role="tablist" aria-label={t('lab.agent')}>
          {tabs.map(
            ([id, key]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeMode === id}
                className={clsx(css.agentModeTab, activeMode === id && css.agentModeTabActive)}
                onClick={() => { setMode(id) }}
              >
                {t(key)}
              </button>
            ),
          )}
        </div>
        <button
          type="button"
          className={clsx(css.tool, css.toolIcon)}
          aria-label={t('lab.collapse')}
          onClick={onClose}
        >
          <IconCloseOutline16 size={14} />
        </button>
      </div>

      {activeMode === 'selfcheck' && selfChecks !== undefined ? (
        <div className={css.agentBody}>
          <LabSelfCheckCard
            key={selfChecks.id}
            set={selfChecks}
            sceneTitle={snapshot.title}
            verification={snapshot.verification}
            onRecord={recordAttempt}
          />
        </div>
      ) : activeMode === 'tutor' ? (
        <div className={css.agentBody}>
          {tutorScript === undefined ? (
            <div className={css.agentEmpty}>
              <span className={css.agentEmptyIcon}><IconSparkle16 size={16} /></span>
              <p className={css.agentIntro}>{t('lab.tutor.unavailable')}</p>
            </div>
          ) : (
            <TutorCard script={tutorScript} t={t} runTools={runTools} />
          )}
        </div>
      ) : (
        <div className={css.agentBody}>
          {turns.length === 0 ? (
            <div className={css.agentEmpty}>
              <span className={css.agentEmptyIcon}><IconSparkle16 size={16} /></span>
              <p className={css.agentIntro}>{t('lab.agent.intro')}</p>
            </div>
          ) : (
            turns.map(turn => (
              <article key={turn.id} className={css.agentCard}>
                <div className={css.agentCardQuestion}>
                  <span className={css.agentCardLabel}>问题</span>
                  <p>{turn.question}</p>
                </div>

                {turn.answer === undefined ? (
                  <div className={css.agentCardAnalysis}>
                    <span className={css.agentCardLabel}>分析</span>
                    <p className={css.agentUnknown}>{t('lab.agent.unknown')}</p>
                  </div>
                ) : (
                  <>
                    <div className={css.agentCardAnalysis}>
                      <span className={css.agentCardLabel}>分析</span>
                      {turn.answer.paragraphs.map((paragraph, index) => (
                        <p key={index} className={css.agentParagraph}>{paragraph}</p>
                      ))}
                    </div>

                    {turn.answer.sources.length === 0 ? null : (
                      <div className={css.agentCardSources}>
                        <span className={css.agentCardLabel}>{t('lab.agent.basis')}</span>
                        <div className={css.agentChipRow}>
                          {turn.answer.sources.map((source, index) => (
                            <span
                              key={`${source.kind}-${source.label}-${index}`}
                              className={css.agentChip}
                              data-kind={source.kind}
                            >
                              {source.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {turn.answer.tools.length === 0 ? null : (
                      <div className={css.agentCardActions}>
                        <span className={css.agentCardLabel}>操作</span>
                        <div className={css.agentActionRow}>
                          {turn.answer.tools.map((call, index) => (
                            <AgentActionButton
                              key={index}
                              call={call}
                              onRun={() => { reRunTool(call) }}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {turn.effects.length === 0 ? null : (
                      <ul className={css.agentEffects}>
                        {turn.effects.map((effect, index) => (
                          <li key={index} data-ok={effect.ok}>{effect.detail}</li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </article>
            ))
          )}

          {suggestions.length === 0 ? null : (
            <div className={css.agentSuggestions}>
              {suggestions.map(suggestion => (
                <button
                  key={suggestion.id}
                  type="button"
                  className={css.agentSuggestion}
                  onClick={() => { ask(suggestion.prompt) }}
                >
                  <IconSparkle16 size={12} />
                  {suggestion.prompt}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

/* ---------------------------------------------------------------- action button -- */

/** Structured action button for an Agent tool call (highlight or setParameter). */
function AgentActionButton({
  call,
  onRun,
}: {
  readonly call: PhysicsAgentToolCall
  readonly onRun: () => void
}) {
  const label = toolLabel(call)
  /* CSS module class names use underscores; tool strings use dots. */
  const variantKey = `agentAction_${call.tool.replace(/\./g, '_')}`
  return (
    <button
      type="button"
      className={clsx(css.agentAction, css[variantKey])}
      onClick={onRun}
    >
      {call.tool === 'physics.ui.highlight' ? '高亮：' : '设置 '}
      {label}
    </button>
  )
}

/** Student-facing label for a tool call's target. */
const toolLabel = (call: PhysicsAgentToolCall): string => {
  if (call.tool === 'physics.ui.highlight') {
    /* Shared with the tool executor, so every target the Agent can highlight —
       including the composite ones — reads in product language here. */
    return highlightLabel(call.targetId)
  }
  return `${PARAMETER_LABELS[call.parameterId] ?? call.parameterId} = ${call.value}`
}

const PARAMETER_LABELS: Readonly<Record<string, string>> = {
  angle: '倾角',
  height: '高度',
  friction: '摩擦系数',
  B: '磁感应强度',
  q: '电荷量',
  m: '质量',
  v0: '初速度',
  E: '场强',
  /* Parallel-plate scenes carry semantic parameter ids instead of the uniform
     field's short ladder above (electric-workspace-runtime.ts `regionInspectorOf`),
     because a bounded field adds the gap geometry. Without these entries an action
     button would read "设置 plateSeparation = 0.06". */
  plateSeparation: '板间距',
  plateLength: '板长',
  electricFieldStrength: '场强',
  particleCharge: '电荷量',
  particleMass: '质量',
  initialSpeed: '初速度',
}
