/**
 * Inline physics-scene card in the conversation flow.
 *
 * Rendered for every durable `physics/scene` snapshot (see scene-chat-node.ts),
 * so the physical world the agent built is visible where the tool call left it
 * instead of only behind 最近空间. The card owns a LOCAL playback runtime built
 * from the snapshot — it replays the published scene, it never mutates it; the
 * authoritative scene still lives in the host's EventStore.
 */

import { memo, useCallback, useMemo, useState } from 'react'
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
import type { CodeVisualizationState, PhysicsSceneSolveSummary } from '@deepseek-ai/dsh-tool-physicsos/types'

import { STEP_FRACTION } from './animation-clock.ts'
import { buildWorkspaceRuntime } from './physics/build-workspace-runtime.ts'
import { domainOfScene } from './physics/domain-of-scene.ts'
import { useFrameSource, type FrameSource } from './physics/frame-source.ts'
import { QuestionCodeCanvas } from './experiments/QuestionCodeCanvas.tsx'
import { useExperimentSession } from './experiments/use-experiment-session.ts'
import { QuestionCodeControls } from './experiments/QuestionCodeControls.tsx'
import type { QuestionCodeOwnerStore } from './experiments/question-code-context.ts'
import { withQuestionCodeVisualization, questionCodeSceneIdentity, type QuestionCodeRegenerate } from './experiments/question-code-api.ts'
import { MathText } from './physics/MathText.tsx'
import { formatTimeIn, timeScaleOf } from './physics/time-format.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './physics/workspace-runtime.ts'
import { drawnIds, highlightableIds } from './question-highlights.ts'
import { toVerifiedResult } from './physics/verified-result.ts'
import { VerifiedResult } from './VerifiedResult.tsx'
import { LabSelfCheckCard } from './LabSelfCheckCard.tsx'
import type { SelfCheckAttemptInput } from './learning-record-store.ts'
import { QUESTION_KNOWLEDGE, selfChecksOfQuestion } from '@physicsos/question-core'
import { PHYSICS_SCENE_TURN_KEY, type PhysicsSceneCardData } from './scene-chat-node.ts'
import type { PhysicsSceneRef } from './surface-store.ts'
import { IconPhysicsLab } from './icons/physics-icons.tsx'
import { TimelineScrubber } from './TimelineScrubber.tsx'
import { GlassSelect } from './GlassSelect.tsx'
import type { PhysicsosKey } from './locales.ts'
import css from './SceneChatCard.module.css'

type Translate = (key: PhysicsosKey, params?: Record<string, unknown>) => string

/** Registration-side face for {@link SceneChatCard}. */
export interface SceneChatCardInjected {
  /** Hand the card's scene to the Lab — the same verb 最近空间 rows use. */
  openSceneInLab: (ref: PhysicsSceneRef) => void
  questionCodeOwner?: QuestionCodeOwnerStore
  /** Explicit user action queues generation in the selected owning chat. */
  regenerateQuestionCode?: QuestionCodeRegenerate
  /**
   * Close an agent-opened Lab and drop the turn's scaffolding scenes. Called
   * once per turn by the turn-tail seat, which only mounts after the turn ends.
   */
  endTurnHygiene?: () => void
  /**
   * Write a self-check answer into the learning record. Absent where no
   * learning-record store exists; the self-check block hides itself then.
   */
  recordAttempt?: (attempt: SelfCheckAttemptInput) => void
}

/** Slot props for the inline scene card in the conversation flow. */
export type SceneChatCardProps =
  Pick<PropsRuntime<'conversation.chat.node', 'physics-scene-card'>, 'node' | 'useSession' | 'useChat'>
  & InjectFace<SceneChatCardInjected>
  & PropsLocale<'physicsos'>

/** Props of the card body, shared by both entry points. */
export type SceneCardBodyProps =
  & { readonly data: PhysicsSceneCardData }
  & InjectFace<SceneChatCardInjected>
  & PropsLocale<'physicsos'>

/* One answer flow may publish several scenes — an abandoned first attempt
   and the corrected one the agent settles on. Cards are keyed per scene, so
   the supersede check lives here: a card yields to a newer scene card that
   lands in the same answer block (before the next user message). */
const ANSWER_BOUNDARY = new Set(['user', 'steering'])

export const SceneCardBody = memo(function SceneCardBody({
  data, t, openSceneInLab, recordAttempt, regenerateQuestionCode, questionCodeOwner,
}: SceneCardBodyProps) {
  /* The snapshot invariant guarantees `scene` is the whole PhysicsScene at
     this revision (`scene.id === sceneId`, `scene.revision === revision`). */
  const scene = data.scene as unknown as PhysicsScene
  const independent = data.visualization?.status === 'ready' && data.visualization.rendererKind === 'independent'
  const experimentTitle = independent ? data.visualization.title : data.title
  const domain = domainOfScene(scene)
  const runtimeKey = `${domain}:${data.sceneId}:${data.revision}:${questionCodeSceneIdentity(scene)}`
  const runtime = useMemo<WorkspaceRuntime | null>(
    () => {
      try { return buildWorkspaceRuntime(domain, scene) } catch { return null }
    },
    /* runtimeKey encodes domain + scene identity; `scene` is a fresh JSON
       view per node build, so keying on it would rebuild the runtime every
       materialization. */
    [runtimeKey],
  )

  return (
    <div className={css.card} data-scene-card={data.sceneId} data-code-experiment-shell>
      <header className={css.head}>
        <div className={css.heading}>
          <span className={css.badge}><IconPhysicsLab size={14} />本题代码实验</span>
          <h3 className={css.title} title={experimentTitle}>{experimentTitle}</h3>
        </div>
        <button
          type="button"
          className={css.open}
          disabled={!independent}
          onClick={() => {
            openSceneInLab({
              sceneId: data.sceneId,
              scene: data.visualization === undefined ? scene : withQuestionCodeVisualization(scene, data.visualization),
              ...(data.visualization === undefined ? {} : { originScene: scene }),
            })
          }}
        >
          在实验室中探索
        </button>
      </header>
      {runtime === null ? (
        <><QuestionCodeCanvas scene={scene} hasVerifiedSolution={data.solve?.verification?.status === 'passed'}
          {...(questionCodeOwner === undefined ? {} : { questionCodeOwner })}
          {...(data.visualization === undefined ? {} : { visualization: data.visualization })}
          {...(regenerateQuestionCode === undefined ? {} : { regenerateQuestionCode })} />
        {data.solve === undefined ? null : <SolveSection solve={data.solve} verification={[]} domain={domain}
          bodyId={scene.bodies[0]?.id} drawn={EMPTY_DRAWN} activeToken={null} onToggle={() => {}}
          sceneTitle={data.title} revision={data.revision} recordAttempt={recordAttempt} t={t} />}</>
      ) : (
        <CardStage
          key={runtimeKey}
          runtime={runtime}
          scene={scene}
          {...(questionCodeOwner === undefined ? {} : { questionCodeOwner })}
          {...(data.visualization === undefined ? {} : { visualization: data.visualization })}
          {...(regenerateQuestionCode === undefined ? {} : { regenerateQuestionCode })}
          t={t}
          {...(data.solve === undefined ? {} : {
            solve: data.solve,
            domain,
            bodyId: scene.bodies[0]?.id,
            sceneTitle: data.title,
            revision: data.revision,
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
  scene,
  visualization,
  questionCodeOwner,
  regenerateQuestionCode,
  t,
  solve,
  domain,
  bodyId,
  sceneTitle,
  revision,
  recordAttempt,
}: {
  runtime: WorkspaceRuntime
  scene: PhysicsScene
  visualization?: CodeVisualizationState
  questionCodeOwner?: QuestionCodeOwnerStore
  regenerateQuestionCode?: QuestionCodeRegenerate
  t: Translate
  solve?: PhysicsSceneSolveSummary | undefined
  domain?: string | undefined
  bodyId?: string | undefined
  sceneTitle?: string | undefined
  revision?: number | undefined
  recordAttempt?: ((attempt: SelfCheckAttemptInput) => void) | undefined
}) {
  const { session, snapshot, commit, frameSource } = useExperimentSession(runtime)
  const [highlightToken, setHighlightToken] = useState<string | null>(null)
  const clock = snapshot.clock
  const running = clock.running
  const failed = snapshot.status === 'failed'
  const clockScale = timeScaleOf(clock.total)

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
      <div className={css.codeBench}>
        <QuestionCodeCanvas scene={scene} session={session} hasVerifiedSolution={solve?.verification?.status === 'passed'} {...(questionCodeOwner === undefined ? {} : { questionCodeOwner })}
          {...(visualization === undefined ? {} : { visualization })}
          {...(regenerateQuestionCode === undefined ? {} : { regenerateQuestionCode })} />
      </div>
      <div className={css.transport} aria-label={t('lab.timeline')} data-running={running}>
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
        <GlassSelect className={css.rate} ariaLabel={t('lab.rate')} value={String(clock.rate)} disabled={failed || clock.total <= 0}
          options={[0.25, 0.5, 1, 2].map(rate => ({ value: String(rate), label: `${rate}×` }))}
          onChange={(value) => { commit(runtime.setRate(Number(value))) }} />
      </div>
      <QuestionCodeControls session={session} snapshot={snapshot} />
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
          revision={revision}
          recordAttempt={recordAttempt}
          t={t}
        />
      )}
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
  revision,
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
  revision: number | undefined
  recordAttempt: ((attempt: SelfCheckAttemptInput) => void) | undefined
  t: Translate
}) {
  /* The verification block's ONE consumption point: the seam turns the answer's
     own provenance into the view, and nothing below re-derives a level. The
     engine/verifier names come from that provenance, never from `domain`. */
  const primary = solve.answers[0]
  const result = toVerifiedResult({
    ...(primary === undefined
      ? {}
      : { value: primary.value, unit: primary.unit, provenance: primary.provenance }),
    checks: verification,
    ...(revision === undefined ? {} : { revision }),
  })
  const verified = result.level !== 'unverified'
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
          {verified ? (
            <span className={css.solveVerdict} data-level={result.level}>{t('sceneCard.solveVerified')}</span>
          ) : null}
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
      {/* Always shown on a solved card: an unverified answer must say so, not
          stay silent — that silence is what a re-skinned chat bot would do. */}
      <section className={css.solveBlock} aria-label={t('sceneCard.solveVerification')}>
        <h4 className={css.solveHeading}>{t('sceneCard.solveVerification')}</h4>
        <VerifiedResult view={result} t={t} />
      </section>
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

/**
 * The conversation-flow entry point: one card per scene node, yielding to the
 * Turn's own card once that Turn has closed, and to a newer scene card in the
 * same answer block while it is still running.
 */
export const SceneChatCard = memo(function SceneChatCard({
  node, t, openSceneInLab, recordAttempt, regenerateQuestionCode, questionCodeOwner, useChat,
}: SceneChatCardProps) {
  const superseded = useChat((snapshot) => {
    /* The Turn card covers this answer once the Turn closes. This card is what
       a log gets when the Turn's boundaries are not loaded, so it yields
       wherever the Turn published a scene of its own — but only at `closed`:
       the Turn card is built from `turn/end` and is not drawn at all while the
       Turn runs, so yielding earlier would blank the scene mid-solve. */
    const placed = node.location.kind === 'turn' || node.location.kind === 'step'
      ? node.location.turn.turn
      : undefined
    const turn = placed === undefined ? undefined : snapshot.timeline.turns.get(placed)
    if (turn !== undefined
      && turn.status === 'closed'
      && turn.data.get(PHYSICS_SCENE_TURN_KEY) !== undefined) return true
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
  if (superseded) return null
  return <SceneCardBody data={node.data} t={t} openSceneInLab={openSceneInLab}
    {...(questionCodeOwner === undefined ? {} : { questionCodeOwner })}
    {...(regenerateQuestionCode === undefined ? {} : { regenerateQuestionCode })}
    {...(recordAttempt === undefined ? {} : { recordAttempt })} />
})
