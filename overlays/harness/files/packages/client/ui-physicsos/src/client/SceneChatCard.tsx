/**
 * Inline physics-scene card in the conversation flow.
 *
 * Rendered for every durable `physics/scene` snapshot (see scene-chat-node.ts),
 * so the physical world the agent built is visible where the tool call left it
 * instead of only behind 最近空间. The card owns a LOCAL playback runtime built
 * from the snapshot — it replays the published scene, it never mutates it; the
 * authoritative scene still lives in the host's EventStore.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconChevronLeftOutlineMedium,
  IconChevronRightOutlineMedium,
  IconPauseOutlineMedium,
  IconPlayOutlineMedium,
  IconRefreshOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
/* Type-only: pulls the Chat target's SlotMap entry, its `ChatNodeDataMap`
   merge (the card's kind), and the Session-scoped `useChat` standard hook. */
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PhysicsScene } from '@physicsos/physics-scene'
import type { PhysicsSceneSolveSummary } from '@deepseek-ai/dsh-tool-physicsos/types'

import { STEP_FRACTION, useAnimationClock } from './animation-clock.ts'
import { buildWorkspaceRuntime } from './LabWorkspace.tsx'
import { domainOfScene } from './physics/domain-of-scene.ts'
import { useEventEffects } from './physics/event-effects.ts'
import { createFrameSource, useFrameSource, type FrameSource } from './physics/frame-source.ts'
import { PhysicsCanvas } from './physics/PhysicsCanvas.tsx'
import { MathText } from './physics/MathText.tsx'
import { formatTimeIn, timeScaleOf } from './physics/time-format.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './physics/workspace-runtime.ts'
import { drawnIds, highlightableIds } from './question-highlights.ts'
import { VerificationList } from './workspace-parts.tsx'
import { LabSelfCheckCard } from './LabSelfCheckCard.tsx'
import type { SelfCheckAttemptInput } from './learning-record-store.ts'
import { QUESTION_KNOWLEDGE, selfChecksOfQuestion } from '@physicsos/question-core'
import type { PhysicsSceneCardData } from './scene-chat-node.ts'
import type { PhysicsSceneRef } from './surface-store.ts'
import { IconPhysicsLab } from './icons/physics-icons.tsx'
import { TimelineScrubber } from './TimelineScrubber.tsx'
import type { PhysicsosKey } from './locales.ts'
import css from './SceneChatCard.module.css'

type Translate = (key: PhysicsosKey, params?: Record<string, unknown>) => string

/** Registration-side face for {@link SceneChatCard}. */
export interface SceneChatCardInjected {
  /** Hand the card's scene to the Lab — the same verb 最近空间 rows use. */
  openSceneInLab: (ref: PhysicsSceneRef) => void
  /**
   * Write a self-check answer into the learning record. Absent where no
   * learning-record store exists; the self-check block hides itself then.
   */
  recordAttempt?: (attempt: SelfCheckAttemptInput) => void
}

/** Slot props for the inline scene card. */
export type SceneChatCardProps =
  Pick<PropsRuntime<'conversation.chat.node', 'physics-scene-card'>, 'node' | 'useSession' | 'useChat'>
  & InjectFace<SceneChatCardInjected>
  & PropsLocale<'physicsos'>

const SUMMARY_INTERVAL_MS = 250

/* One answer flow may publish several scenes — an abandoned first attempt
   and the corrected one the agent settles on. Cards are keyed per scene, so
   the supersede check lives here: a card yields to a newer scene card that
   lands in the same answer block (before the next user message). */
const ANSWER_BOUNDARY = new Set(['user', 'steering'])

export const SceneChatCard = memo(function SceneChatCard({
  node, t, openSceneInLab, recordAttempt, useChat,
}: SceneChatCardProps) {
  const data: PhysicsSceneCardData = node.data
  /* Supersede rule reads the Chat target's materialized Nodes (the Session
     snapshot carries no `chat` slice any more). */
  const superseded = useChat((snapshot) => {
    let horizon = Number.POSITIVE_INFINITY
    for (const candidate of snapshot.nodes.values()) {
      if (
        ANSWER_BOUNDARY.has(candidate.kind)
        && candidate.anchorSeq > node.anchorSeq
        && candidate.anchorSeq < horizon
      ) {
        horizon = candidate.anchorSeq
      }
    }
    for (const candidate of snapshot.nodes.values()) {
      if (
        candidate.kind === 'physics-scene-card'
        && candidate.anchorSeq > node.anchorSeq
        && candidate.anchorSeq < horizon
      ) {
        return true
      }
    }
    return false
  })
  /* The snapshot invariant guarantees `scene` is the whole PhysicsScene at
     this revision (`scene.id === sceneId`, `scene.revision === revision`). */
  const scene = data.scene as unknown as PhysicsScene
  const domain = domainOfScene(scene)
  const runtimeKey = `${domain}:${data.sceneId}:${data.revision}`
  const runtime = useMemo<WorkspaceRuntime | null>(
    () => buildWorkspaceRuntime(domain, scene),
    /* runtimeKey encodes domain + scene identity; `scene` is a fresh JSON
       view per node build, so keying on it would rebuild the runtime every
       materialization. */
    [runtimeKey],
  )

  if (superseded) return null

  return (
    <div className={css.card} data-scene-card={data.sceneId}>
      <header className={css.head}>
        <span className={css.badge}>
          <IconPhysicsLab size={14} />
          {t('sceneCard.badge')}
        </span>
        <span className={css.title} title={data.title}>{data.title}</span>
        {/* The card folds every later revision of this scene — the badge
            says which one is on stage. */}
        <span className={css.rev}>rev. {data.revision}</span>
        <button
          type="button"
          className={css.open}
          onClick={() => {
            openSceneInLab({ sceneId: data.sceneId, scene })
          }}
        >
          {t('sceneCard.openInLab')}
        </button>
      </header>
      {runtime === null ? (
        <p className={css.unsupported} role="status">{t('sceneCard.unsupported')}</p>
      ) : (
        <CardStage
          key={runtimeKey}
          runtime={runtime}
          t={t}
          {...(data.solve === undefined ? {} : {
            solve: data.solve,
            domain,
            bodyId: scene.bodies[0]?.id,
            sceneTitle: data.title,
            recordAttempt,
          })}
        />
      )}
    </div>
  )
})

/** The card's playback half: same frame-source + clock discipline as the Lab
    shell, minus the panels — a card is a canvas plus a transport. When the
    snapshot came from `physics_solve_question` it also carries the structured
    solve, which the card renders as the same understanding/derivation/verdict
    sections Question Space had — knowns stay CONTROLS through the card's local
    `setHighlight`, never through a scene command. */
function CardStage({
  runtime,
  t,
  solve,
  domain,
  bodyId,
  sceneTitle,
  recordAttempt,
}: {
  runtime: WorkspaceRuntime
  t: Translate
  solve?: PhysicsSceneSolveSummary | undefined
  domain?: string | undefined
  bodyId?: string | undefined
  sceneTitle?: string | undefined
  recordAttempt?: ((attempt: SelfCheckAttemptInput) => void) | undefined
}) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(() => runtime.getSnapshot())
  const [frameSource] = useState(() => createFrameSource<WorkspaceSnapshot>(runtime.getSnapshot()))
  const summaryRef = useRef(snapshot)
  const lastSummaryAt = useRef(0)
  const [highlightToken, setHighlightToken] = useState<string | null>(null)

  const clock = snapshot.clock
  const running = clock.running
  const failed = snapshot.status === 'failed'
  const clockScale = timeScaleOf(clock.total)

  const commit = useCallback(
    (next: WorkspaceSnapshot) => {
      frameSource.set(next)
      summaryRef.current = next
      setSnapshot(next)
    },
    [frameSource],
  )

  useAnimationClock(
    running,
    useCallback(
      (elapsed: number) => {
        const next = runtime.advance(elapsed)
        frameSource.set(next)
        const previous = summaryRef.current
        const now = typeof performance === 'undefined' ? 0 : performance.now()
        const significant =
          next.status !== previous.status ||
          next.clock.running !== previous.clock.running
        if (significant || now - lastSummaryAt.current >= SUMMARY_INTERVAL_MS) {
          lastSummaryAt.current = now
          summaryRef.current = next
          setSnapshot(next)
        }
      },
      [runtime, frameSource],
    ),
  )

  /* A rebuilt runtime (new revision card data) must not keep the last frame. */
  useEffect(() => {
    const next = runtime.getSnapshot()
    frameSource.set(next)
    summaryRef.current = next
    setSnapshot(next)
  }, [runtime, frameSource])

  const seek = useCallback(
    (time: number) => {
      commit(runtime.seek(time))
    },
    [runtime, commit],
  )

  /* The drawn-id set is recomputed per summary frame; primitives do not appear
     or vanish mid-animation, so this stays cheap. */
  const drawn = useMemo(
    () => (solve === undefined ? EMPTY_DRAWN : drawnIds(snapshot.view)),
    [solve, snapshot.view],
  )
  const toggleKnown = useCallback(
    (token: string, ids: readonly string[]) => {
      const clearing = highlightToken === token
      setHighlightToken(clearing ? null : token)
      commit(runtime.setHighlight(clearing ? [] : ids))
    },
    [runtime, commit, highlightToken],
  )

  return (
    <>
      {solve === undefined ? null : (
        <SolveSection
          solve={solve}
          verification={snapshot.verification}
          domain={domain}
          bodyId={bodyId}
          drawn={drawn}
          activeToken={highlightToken}
          onToggle={toggleKnown}
          sceneTitle={sceneTitle ?? ''}
          recordAttempt={recordAttempt}
          t={t}
        />
      )}
      <div className={css.stage}>
        <CardCanvas source={frameSource} ariaLabel={snapshot.ariaLabel} onSeekTime={seek} />
      </div>
      <div className={css.transport} aria-label={t('lab.timeline')}>
        <button
          type="button"
          className={clsx(css.control, css.controlPrimary)}
          disabled={failed || clock.total <= 0}
          aria-label={t('lab.playPause')}
          aria-pressed={running}
          onClick={() => {
            commit(runtime.setRunning(!running))
          }}
        >
          {running ? <IconPauseOutlineMedium size={14} /> : <IconPlayOutlineMedium size={14} />}
        </button>
        <button
          type="button"
          className={css.control}
          disabled={failed}
          aria-label={t('lab.stepBack')}
          onClick={() => {
            commit(runtime.step(-clock.total * STEP_FRACTION))
          }}
        >
          <IconChevronLeftOutlineMedium size={13} />
        </button>
        <button
          type="button"
          className={css.control}
          disabled={failed}
          aria-label={t('lab.step')}
          onClick={() => {
            commit(runtime.step(clock.total * STEP_FRACTION))
          }}
        >
          <IconChevronRightOutlineMedium size={13} />
        </button>
        <button
          type="button"
          className={css.control}
          disabled={failed}
          aria-label={t('lab.reset')}
          onClick={() => {
            commit(runtime.seek(0))
          }}
        >
          <IconRefreshOutlineMedium size={13} />
        </button>
        <CardClock source={frameSource} scale={clockScale} />
        <div className={css.trackWrap}>
          <TimelineScrubber
            label={t('lab.timeline')}
            min={0}
            max={clock.total}
            value={clock.time}
            valueText={`${formatTimeIn(clock.time, clockScale)} / ${formatTimeIn(clock.total, clockScale)}`}
            onChange={seek}
          />
        </div>
        <span className={css.clockEnd}>{formatTimeIn(clock.total, clockScale)}</span>
      </div>
    </>
  )
}

/** Per-frame current-time readout — subscribes to the frame channel like the
    Lab's LiveClock so the card's React clock never lags the canvas HUD. */
function CardClock({
  source,
  scale,
}: {
  source: FrameSource<WorkspaceSnapshot>
  scale: ReturnType<typeof timeScaleOf>
}) {
  const frame = useFrameSource(source)
  return <span className={css.clock}>{formatTimeIn(frame.clock.time, scale)}</span>
}

/* ---------------------------------------------------------------- solve --- */

const EMPTY_DRAWN: ReadonlySet<string> = new Set()

/**
 * Presentation only: the IR stores flat symbols (`v0`, `vx`) while MathText
 * wants the script (`v_0`, `v_x`). Two-character quantities are the whole
 * vocabulary here, so this stays a regex rather than a symbol table.
 */
const mathSymbol = (symbol: string): string =>
  /^[A-Za-z][0-9xyz]$/.test(symbol) ? `${symbol[0] ?? ''}_${symbol[1] ?? ''}` : symbol

const formatKnownValue = (value: number | null, unit: string): string => {
  if (value === null) return 'n/a'
  const digits = Math.max(0, 3 - Math.floor(Math.log10(Math.abs(value) || 1)))
  const text = Number(value.toFixed(digits)).toString()
  return unit === '' ? text : `${text} ${unit}`
}

/**
 * The structured half of a solved question, folded into the card: knowns as
 * controls (a click lights the drawn primitive, exactly the Question Space
 * contract), targets, answers, worked steps, and the engine's verdict.
 * Steps render inside their own collapsed block — a student reads the scene
 * first, the derivation on demand.
 */
function SolveSection({
  solve,
  verification,
  domain,
  bodyId,
  drawn,
  activeToken,
  onToggle,
  sceneTitle,
  recordAttempt,
  t,
}: {
  solve: PhysicsSceneSolveSummary
  /** Named checks the LOCAL runtime already derived — same list the Lab shows. */
  verification: WorkspaceSnapshot['verification']
  domain: string | undefined
  bodyId: string | undefined
  drawn: ReadonlySet<string>
  activeToken: string | null
  onToggle: (token: string, ids: readonly string[]) => void
  sceneTitle: string
  recordAttempt: ((attempt: SelfCheckAttemptInput) => void) | undefined
  t: Translate
}) {
  const verified = solve.verification?.status
  /* A golden question carries its self-check bank: answering in the card is
     the same practice loop Question Space ran, recorded identically. */
  const goldenId = solve.goldenQuestionId
  const selfCheckItems = goldenId === undefined ? [] : selfChecksOfQuestion(goldenId)
  return (
    <details className={css.solve} open data-solve-section>
      <summary className={css.solveSummary}>
        {t('sceneCard.solveTitle')}
        <span className={css.solveSummaryMeta}>
          {solve.knowns.length === 0 ? '' : t('sceneCard.solveKnownsCount', { count: solve.knowns.length })}
          {verified === undefined ? '' : (
            <span className={css.solveVerdict} data-status={verified}>{t('sceneCard.solveVerified')}</span>
          )}
        </span>
      </summary>
      {solve.knowns.length === 0 ? null : (
        <section className={css.solveBlock} aria-label={t('sceneCard.solveKnowns')}>
          <h4 className={css.solveHeading}>{t('sceneCard.solveKnowns')}</h4>
          <ul className={css.knownList}>
            {solve.knowns.map((known) => {
              const ids = highlightableIds([known.key, known.symbol], domain, bodyId, drawn)
              const token = `known:${known.key}`
              const active = activeToken === token
              const body = (
                <>
                  <MathText expression={mathSymbol(known.symbol)} />
                  <span className={css.knownValue}>{' = '}{formatKnownValue(known.value, known.unit)}</span>
                </>
              )
              return (
                <li key={known.key}>
                  {ids.length === 0 ? (
                    <span className={css.knownStatic}>{body}</span>
                  ) : (
                    <button
                      type="button"
                      className={clsx(css.knownButton, active && css.knownButtonActive)}
                      aria-pressed={active}
                      aria-label={t(
                        active ? 'sceneCard.knownHighlightClear' : 'sceneCard.knownHighlight',
                        { symbol: known.symbol },
                      )}
                      onClick={() => { onToggle(token, ids) }}
                    >
                      {body}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          <p className={css.solveHint}>{t('sceneCard.knownsHint')}</p>
        </section>
      )}
      {solve.targets.length === 0 ? null : (
        <section className={css.solveBlock} aria-label={t('sceneCard.solveTargets')}>
          <h4 className={css.solveHeading}>{t('sceneCard.solveTargets')}</h4>
          <ul className={css.targetList}>
            {solve.targets.map(target => <li key={target}>{target}</li>)}
          </ul>
        </section>
      )}
      {solve.answers.length === 0 ? null : (
        <section className={css.solveBlock} aria-label={t('sceneCard.solveAnswers')}>
          <h4 className={css.solveHeading}>{t('sceneCard.solveAnswers')}</h4>
          <ul className={css.answerList}>
            {solve.answers.map(answer => (
              <li key={answer.key}>
                <span>{answer.label} </span>
                <MathText expression={mathSymbol(answer.symbol)} />
                {' = '}{answer.value}{answer.unit === '' ? '' : ` ${answer.unit}`}
              </li>
            ))}
          </ul>
        </section>
      )}
      {solve.steps.length === 0 ? null : (
        <section className={css.solveBlock} aria-label={t('sceneCard.solveSteps')}>
          <h4 className={css.solveHeading}>{t('sceneCard.solveSteps')}</h4>
          <ol className={css.stepList}>
            {solve.steps.map((step) => {
              const formula = /[=√]/.test(step.title) ? step.title : null
              return (
                <li key={step.index} className={css.step}>
                  <div className={css.stepBody}>
                    {formula === null
                      ? <strong>{step.title}</strong>
                      : <strong className={css.stepFormula}><MathText expression={formula} /></strong>}
                    {step.description === '' ? null : <p>{step.description}</p>}
                    {step.substitution === undefined ? null : (
                      <p className={css.stepSubstitution}><MathText expression={step.substitution} /></p>
                    )}
                    {step.result === undefined ? null : (
                      <output className={css.stepResult}><MathText expression={step.result} /></output>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      )}
      {verification.length === 0 ? null : (
        <section className={css.solveBlock} aria-label={t('sceneCard.solveVerification')}>
          <h4 className={css.solveHeading}>{t('sceneCard.solveVerification')}</h4>
          <VerificationList checks={verification} emptyLabel={t('sceneCard.solveVerification')} />
        </section>
      )}
      {solve.issues.length === 0 ? null : (
        <section className={css.solveBlock} aria-label={t('sceneCard.solveIssues')}>
          <h4 className={css.solveHeading}>{t('sceneCard.solveIssues')}</h4>
          <ul className={css.issueList}>
            {solve.issues.map(issue => (
              <li key={`${issue.code}:${issue.message}`} data-severity={issue.severity}>
                [{issue.severity}] {issue.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      {goldenId === undefined || selfCheckItems.length === 0 ? null : (
        <section className={css.solveBlock} aria-label={t('sceneCard.solveSelfCheck')}>
          <h4 className={css.solveHeading}>{t('sceneCard.solveSelfCheck')}</h4>
          <LabSelfCheckCard
            set={{
              id: goldenId,
              topic: sceneTitle,
              knowledge: QUESTION_KNOWLEDGE[goldenId] ?? [],
              items: selfCheckItems,
            }}
            sceneTitle={sceneTitle}
            verification={verification}
            onRecord={recordAttempt}
          />
        </section>
      )}
    </details>
  )
}

/** The renderer half: only this subtree re-renders per animation frame. */
function CardCanvas({
  source,
  ariaLabel,
  onSeekTime,
}: {
  source: FrameSource<WorkspaceSnapshot>
  ariaLabel: string
  onSeekTime: (time: number) => void
}) {
  const frame = useFrameSource(source)
  const effects = useEventEffects(frame.clock, frame.events, frame.view)
  return (
    <PhysicsCanvas
      view={frame.view}
      ariaLabel={ariaLabel}
      trajectoryTimes={frame.trajectoryTimes}
      {...(frame.sampleReadout === undefined ? {} : { sampleReadout: frame.sampleReadout })}
      onSeekTime={onSeekTime}
      effects={effects}
      clockTime={frame.clock.time}
    />
  )
}
