/**
 * The one physics workspace.
 *
 * There is deliberately no `MechanicsLabWorkspace` / `ElectricLabWorkspace`: a
 * domain is a {@link WorkspaceRuntime} plus a renderer in the registry, never a
 * new page. This shell owns layout, playback and panel state; the runtime owns
 * every physical fact. Adding `circuit` or `induction` later means one runtime
 * adapter and one renderer, with no change here.
 *
 * Geometry contract: the cover fills the Harness conversation column and never
 * scrolls the page — Scene / Canvas / Inspector are fixed-flex tracks and each
 * panel scrolls internally.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconChevronDownOutline14,
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconDownloadOutline16,
  IconEllipsisOutline16,
  IconFullscreenOutline16,
  IconListPenOutline16,
  IconPauseOutline16,
  IconPlayOutline16,
  IconQuestionOutline14,
  IconRefreshOutline16,
  IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'

import { STEP_FRACTION, useAnimationClock } from './animation-clock.ts'
import { formatTimeIn, timeScaleOf } from './physics/time-format.ts'
import {
  ResponsiveInspector,
  ResponsiveInspectorToggle,
  useResponsiveInspector,
} from './ResponsiveInspector.tsx'
import { TimelineScrubber } from './TimelineScrubber.tsx'
import { AgentDrawer } from './AgentDrawer.tsx'
import { ExperimentGuidePanel } from './ExperimentGuidePanel.tsx'
import { ExperimentReportPanel } from './ExperimentReportPanel.tsx'
import { WorkspaceScenePanel } from './WorkspaceScenePanel.tsx'
import { IconScene, IconVariable, IconVerified } from './icons/physics-icons.tsx'
import { Mascot } from './Mascot.tsx'
import { useEventEffects } from './physics/event-effects.ts'
import { createFrameSource, useFrameSource, type FrameSource } from './physics/frame-source.ts'
import { PhysicsCanvas } from './physics/PhysicsCanvas.tsx'
import type { ComponentControlChannel, ComponentDragChannel } from './physics/renderer-registry.tsx'
import type { ObservableKey } from './physics/scene-visual-model.ts'
import type { ExperimentMeta } from './physics/experiment-summaries.ts'
import { exportTableCsv } from './physics/export-csv.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './physics/workspace-runtime.ts'
import type { SelfCheckAttemptInput } from './learning-record-store.ts'
import {
  DataPanelBody,
  InspectorTabs,
  SceneTreePanel,
  TimelineMarkers,
  type DataTab,
} from './workspace-parts.tsx'
import type { PhysicsosKey } from './locales.ts'
import { CircuitBuilderPanel, type BuilderEditing } from './physics/CircuitBuilderPanel.tsx'
import type { ComponentWiringChannel } from './physics/renderer-registry.tsx'
import {
  beginHistory,
  canRedo,
  canUndo,
  commit as commitHistory,
  redo as redoHistory,
  undo as undoHistory,
  type CircuitDraft,
  type DraftHistory,
  type TerminalRef,
} from './physics/circuit-builder.ts'
import css from './LabWorkspace.module.css'

type Translate = (key: PhysicsosKey) => string

/**
 * Engine preconditions the shell can name in the product language. Anything
 * outside this set falls back to the engine's own wording, so a new engine
 * condition degrades to a less polished message rather than to no message.
 */
const FAILURE_CONDITION_KEYS = [
  'single_voltage_source',
  'dc_components_only',
  'dc_solvable',
  'single_circuit',
  'scene_valid',
] as const

const failureMessage = (
  t: Translate,
  error: { condition?: string; message: string } | undefined,
): string => {
  if (error === undefined) return t('lab.dataStub')
  for (const key of FAILURE_CONDITION_KEYS) {
    if (error.condition === key) return t(`lab.condition.${key}`)
  }
  return error.message
}

const PLAYBACK_RATES = [0.25, 0.5, 1, 2] as const

/** Wall-clock interval at which the React tree refreshes its summary while the
    animation loop publishes every frame to the renderer channel (#123). */
const SUMMARY_INTERVAL_MS = 250

export interface PhysicsWorkspaceProps {
  readonly runtime: WorkspaceRuntime
  readonly t: Translate
  /** Rendered in the toolbar's overflow area; the Lab passes its template menu. */
  readonly toolbarExtra?: React.ReactNode
  /**
   * Open the experiment chooser from the toolbar. When set, the scene title
   * becomes the switch control, so changing experiments never requires the
   * sidebar; the chooser keeps this scene resumable.
   */
  readonly onSwitchExperiment?: () => void
  /**
   * Dismiss the lab cover back to the conversation transcript. Optional because
   * the shell also mounts standalone (tests, embeds) outside a surface.
   */
  readonly onReturnToChat?: () => void
  /**
   * Write an AI 助教 自测 answer into the learning record. Optional because the
   * shell is also mounted standalone (tests, embeds) without a record store.
   */
  readonly recordAttempt?: (attempt: SelfCheckAttemptInput) => void
  /**
   * Free-build mode: the student is assembling the circuit, so the shell keeps
   * the drawing on screen while a circuit is still unsolvable and reports the
   * engine's reason inline. Replacing the canvas with an alert here would hide
   * the schematic being built at the moment it is most needed.
   */
  readonly buildMode?: boolean
  /**
   * Teaching metadata of the template that created this scene (要点 cards,
   * 实验指南 steps). Absent for free builds and problem scenes handed over
   * from Question Space — the summary tab then shows the empty stub.
   */
  readonly experimentMeta?: ExperimentMeta | undefined
}

/**
 * The one physics workspace.
 *
 * Rendering is decoupled per #123: the animation clock publishes every frame to
 * a {@link FrameSource} that only the canvas subscribes to, so per-frame updates
 * re-render the canvas alone. The React shell (toolbar, tree, inspector, data
 * panel, status) refreshes from a throttled summary, so a 60 fps playback never
 * re-renders the whole tree.
 */
export function PhysicsWorkspace({
  runtime,
  t,
  toolbarExtra,
  onSwitchExperiment,
  onReturnToChat,
  recordAttempt,
  buildMode,
  experimentMeta,
}: PhysicsWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(() => runtime.getSnapshot())
  const [selected, setSelected] = useState('scene')
  /* The canvas owns the bench: the data strip stays a handle until asked.
     The tab still defaults to charts when they exist, so expanding lands
     directly on the curves. */
  const [dataOpen, setDataOpen] = useState(false)
  const [dataTab, setDataTab] = useState<DataTab>(() =>
    snapshot.charts.length > 0 ? 'charts' : 'data',
  )
  /* Focus mode drops the side panels so the canvas owns the bench; every tool
     (playback, report, agent) stays in the toolbar. */
  const [focused, setFocused] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  /* The dock button unmounts while the drawer is open, so closing hands
     focus to the re-mounted button — same pattern as the inspector's. */
  const agentTriggerRef = useRef<HTMLButtonElement>(null)
  const closeAgent = useCallback(() => {
    setAgentOpen(false)
    queueMicrotask(() => { agentTriggerRef.current?.focus() })
  }, [])
  const [reportOpen, setReportOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const inspector = useResponsiveInspector()
  const sceneDrawer = useResponsiveInspector()
  /* Wide-layout panel folds: at track widths each side panel carries a
     chevron that drops its grid column; the toolbar toggle restores it. At
     drawer widths the flags stay inert — the drawer open state owns
     visibility there, and the same toggle clears a stale flag first. */
  const [sceneCollapsed, setSceneCollapsed] = useState(false)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  /* Hover highlight is transient chrome, so it is kept out of the runtime until
     it actually needs to reach the canvas. */
  const highlightRef = useRef<string | undefined>(undefined)

  /* The renderer channel: the canvas subscribes to the latest frame directly.
     Created once per workspace instance (the Lab remounts this shell per scene). */
  const [frameSource] = useState(() => createFrameSource<WorkspaceSnapshot>(runtime.getSnapshot()))
  /* Latest frame already reflected in React state, for change detection. */
  const summaryRef = useRef(snapshot)
  const lastSummaryAt = useRef(0)

  const clock = snapshot.clock
  const running = clock.running
  /* A finished run offers "replay", not a dead play button: the runtime
     rewinds to t = 0 on the next run press, and the shell says so. */
  const ended = clock.total > 0 && !running && clock.time >= clock.total
  /* One unit for the whole timeline, chosen from the run window, so the moving
     clock and its total stay comparable — `3.75 µs / 10.00 µs`, never `1e-5s`. */
  const clockScale = timeScaleOf(clock.total)

  /** Publish a frame to the renderer channel AND to React. Used by discrete
      user actions so the canvas and the panels agree immediately. */
  const commit = useCallback(
    (next: WorkspaceSnapshot) => {
      frameSource.set(next)
      summaryRef.current = next
      setSnapshot(next)
    },
    [frameSource],
  )

  /* The animation loop is the renderer's independent update loop (#123): every
     frame goes straight to the canvas channel; React only gets a throttled
     summary, or an immediate refresh when Status / Selection / Panel Data /
     revision actually changed. */
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
          next.sceneRevision !== previous.sceneRevision ||
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

  /* A new runtime instance (different scene) must not keep the previous frame. */
  useEffect(() => {
    const next = runtime.getSnapshot()
    frameSource.set(next)
    summaryRef.current = next
    setSnapshot(next)
  }, [runtime, frameSource])

  const highlight = useCallback(
    (id: string | undefined) => {
      if (highlightRef.current === id) return
      highlightRef.current = id
      commit(runtime.setHighlight(id === undefined ? [] : [id]))
    },
    [runtime, commit],
  )

  const seek = useCallback(
    (time: number) => {
      commit(runtime.seek(time))
    },
    [runtime, commit],
  )

  /* Playback keyboard: Space toggles, ←/→ step a tenth of the window, Home
     rewinds. Document-level so it works without focusing the canvas first, but
     it yields to editable and activatable targets — those keys belong to the
     control under focus. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        /* Editable controls own every key. Buttons and links own only their
           activation keys — an ArrowRight focused on 运行 should still step. */
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return
        }
        if ((tag === 'BUTTON' || tag === 'A') && (event.key === ' ' || event.key === 'Enter')) return
      }
      const failedRun = snapshot.status === 'failed'
      if (event.key === ' ') {
        event.preventDefault()
        if (!failedRun && clock.total > 0) commit(runtime.setRunning(!running))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (!failedRun) commit(runtime.step(clock.total * STEP_FRACTION))
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        if (!failedRun) commit(runtime.step(-clock.total * STEP_FRACTION))
      } else if (event.key === 'Home') {
        event.preventDefault()
        if (!failedRun) commit(runtime.seek(0))
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [runtime, commit, running, snapshot.status, clock.total])

  /* Schematic drag (circuit domain): the channel exists only when the runtime
     implements it. Preview frames ride the canvas channel only — a pointermove
     storm must not re-render the React shell; the drop commits through React
     like every other discrete edit. */
  const componentDrag = useMemo(
    () =>
      runtime.previewComponentPlacement === undefined ||
      runtime.commitComponentPlacement === undefined ||
      runtime.cancelComponentPlacement === undefined
        ? undefined
        : {
          preview: (componentId: string, at: { x: number; y: number }) => {
            frameSource.set(
              runtime.previewComponentPlacement?.(componentId, at) ?? runtime.getSnapshot(),
            )
          },
          commit: (componentId: string, at: { x: number; y: number }) => {
            const next = runtime.commitComponentPlacement?.(componentId, at)
            if (next !== undefined) commit(next)
          },
          cancel: () => {
            frameSource.set(runtime.cancelComponentPlacement?.() ?? runtime.getSnapshot())
          },
        },
    [runtime, frameSource, commit],
  )

  /* Bench controls (switch flip, rheostat knob): previews ride the canvas
     channel like the drag preview — a pointermove storm never re-renders the
     React shell; the release commits through React like any other edit. */
  const componentControl = useMemo<ComponentControlChannel | undefined>(
    () =>
      runtime.setSwitchState === undefined ||
      runtime.previewSliderPosition === undefined ||
      runtime.commitSliderPosition === undefined ||
      runtime.cancelSliderPosition === undefined
        ? undefined
        : {
          setSwitch: (componentId, state) => {
            const next = runtime.setSwitchState?.(componentId, state)
            if (next !== undefined) commit(next)
          },
          previewSlider: (componentId, position) => {
            frameSource.set(
              runtime.previewSliderPosition?.(componentId, position) ?? runtime.getSnapshot(),
            )
          },
          commitSlider: (componentId, position) => {
            const next = runtime.commitSliderPosition?.(componentId, position)
            if (next !== undefined) commit(next)
          },
          cancelSlider: () => {
            frameSource.set(runtime.cancelSliderPosition?.() ?? runtime.getSnapshot())
          },
        },
    [runtime, frameSource, commit],
  )

  const statusLabel =
    snapshot.status === 'verified'
      ? t('lab.mechanics.verified')
      : snapshot.status === 'warning'
        ? t('lab.status.warning')
        : t('lab.status.failed')

  const failed = snapshot.status === 'failed'
  /* While building, an unsolvable circuit is a state on the way to a circuit,
     not a dead end: keep the canvas and say what the engine is missing. */
  const showSchematic = !failed || buildMode === true

  /* ------------------------------------------------ free-build bench state */
  /* Entering the bench reads the circuit back out of the live scene, so the
     panel shows what is actually on the canvas rather than an empty grid. */
  /* Entering the bench reads the circuit back out of the live scene, so the
     panel shows what is actually on the canvas rather than an empty grid. */
  useEffect(() => {
    if (buildMode !== true) {
      /* Leaving the bench keeps the assembled circuit; the frame only changes
         if a build was actually in progress, so a plain template mount does
         not spend a render on it. */
      if (runtime.circuitDraft?.() === undefined) return
      const left = runtime.leaveBuilder?.()
      if (left !== undefined) commit(left)
      setDraft(undefined)
      setHistory(undefined)
      return
    }
    /* The bench lives in the scene panel. On a narrow window that panel is a
       drawer, so a student who chose 自由搭建 would otherwise land on a canvas
       with no parts to place — open it for them. On a wide window the panel is
       a permanent track and this costs nothing (the backdrop only exists under
       the drawer breakpoint). */
    sceneDrawer.reveal()
    const frame = runtime.enterBuilder?.()
    if (frame === undefined) return
    commit(frame)
    const initial = runtime.circuitDraft?.()
    setDraft(initial)
    setHistory(initial === undefined ? undefined : beginHistory(initial))
  }, [buildMode, runtime, commit, sceneDrawer.reveal])

  const [draft, setDraft] = useState<CircuitDraft | undefined>(() => runtime.circuitDraft?.())
  /* Terminal awaiting its partner in the wiring gesture: a click-to-connect
     gesture is the accessible, touch-friendly twin of the drag. */
  const [pendingTerminal, setPendingTerminal] = useState<TerminalRef | undefined>(undefined)
  const [history, setHistory] = useState<DraftHistory | undefined>(() => {
    const initial = runtime.circuitDraft?.()
    return initial === undefined ? undefined : beginHistory(initial)
  })

  /** Adopt a frame the runtime produced, keeping the shell and panel in step. */
  const adoptFrame = useCallback(
    (next: WorkspaceSnapshot | undefined) => {
      if (next === undefined) return
      commit(next)
      setDraft(runtime.circuitDraft?.())
    },
    [commit, runtime],
  )

  /**
   * Wiring (build mode): a press on one terminal opens a wire, the next press
   * closes it. Only offered while assembling — reading a template keeps the
   * plain bench, where terminals are not interactive.
   */
  const componentWiring = useMemo<ComponentWiringChannel | undefined>(() => {
    if (buildMode !== true || runtime.applyDraftEdit === undefined) return undefined
    return {
      start: (ref) => {
        if (pendingTerminal === undefined) {
          runtime.beginWire?.(ref)
          setPendingTerminal(ref)
          return
        }
        if (
          pendingTerminal.componentId === ref.componentId &&
          pendingTerminal.terminalKey === ref.terminalKey
        ) {
          runtime.cancelWire?.()
          setPendingTerminal(undefined)
          return
        }
        const next = runtime.completeWire?.(ref)
        setPendingTerminal(undefined)
        setDraft(runtime.circuitDraft?.())
        if (next !== undefined) {
          commit(next)
          const produced = runtime.circuitDraft?.()
          setHistory(current =>
            current === undefined || produced === undefined
              ? current
              : commitHistory(current, produced),
          )
        }
      },
      pending: pendingTerminal,
    }
  }, [buildMode, runtime, pendingTerminal, commit])

  const builderEditing = useMemo<BuilderEditing>(
    () => ({
      apply: (edit) => {
        const next = runtime.applyDraftEdit?.(edit)
        if (next === undefined) return
        const produced = runtime.circuitDraft?.()
        setHistory((current) => {
          if (current === undefined || produced === undefined) return current
          return commitHistory(current, produced)
        })
        adoptFrame(next)
      },
      undo: () => {
        setHistory((current) => {
          if (current === undefined) return current
          const back = undoHistory(current)
          adoptFrame(runtime.applyDraftEdit?.(() => back.present))
          return back
        })
      },
      redo: () => {
        setHistory((current) => {
          if (current === undefined) return current
          const forward = redoHistory(current)
          adoptFrame(runtime.applyDraftEdit?.(() => forward.present))
          return forward
        })
      },
      canUndo: history !== undefined && canUndo(history),
      canRedo: history !== undefined && canRedo(history),
    }),
    [runtime, adoptFrame, history],
  )

  const observables = useMemo(() => collectObservables(snapshot), [snapshot])

  /* The cover is absolutely positioned inside the host's scroll body, whose
     content (the home hero and recent list) is taller than the viewport. Any
     scroll of that body — a card click's scrollIntoView is enough — drags the
     whole lab up and clips the toolbar. While a lab is mounted the body has
     nothing visible to scroll to, so lock it and pin it to the top. */
  const coverRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const cover = coverRef.current
    if (cover === null) return
    let node: HTMLElement | null = cover.parentElement
    /* The marker, not overflow state: a short conversation never overflows,
       so scrollHeight > clientHeight misses the body and the cover would
       stay shrink-to-fit instead of covering the column. */
    while (node !== null && !node.hasAttribute('data-conversation-scroll')) {
      node = node.parentElement
    }
    if (node === null) return
    const scroller = node
    const previousOverflow = scroller.style.overflowY
    scroller.scrollTop = 0
    scroller.style.overflowY = 'hidden'
    return () => {
      scroller.style.overflowY = previousOverflow
    }
  }, [])

  return (
    <div
      ref={coverRef}
      className={css.cover}
      data-physicsos-surface="lab"
      data-physicsos-domain={snapshot.domain}
      data-physicsos-running={running ? 'true' : 'false'}
      data-scene-revision={snapshot.sceneRevision}
      data-verification-status={snapshot.status}
      data-scene-collapsed={sceneCollapsed ? 'true' : undefined}
      data-inspector-collapsed={inspectorCollapsed ? 'true' : undefined}
      data-agent-open={agentOpen ? 'true' : undefined}
      data-scene-drawer-open={sceneDrawer.open ? 'true' : undefined}
      data-inspector-drawer-open={inspector.open ? 'true' : undefined}
    >
      <header className={css.toolbar}>
        {onReturnToChat === undefined ? null : (
          <button type="button" className={css.tool} onClick={onReturnToChat}>
            <IconChevronLeftOutline14 size={13} />
            {t('lab.backToChat')}
          </button>
        )}
        <div className={css.sceneIdentity}>
          {/* The scene name is the switch affordance; the chevron button carries
              the keyboard/AT path because a heading may not live inside a button. */}
          <h1
            className={clsx(css.title, onSwitchExperiment !== undefined && css.titleClickable)}
            onClick={onSwitchExperiment}
          >
            {snapshot.title}
          </h1>
          {onSwitchExperiment === undefined ? null : (
            <button
              type="button"
              className={css.titleSwitch}
              title={t('lab.toolbar.switch')}
              aria-label={t('lab.toolbar.switch')}
              onClick={onSwitchExperiment}
            >
              <IconChevronDownOutline14 size={13} />
            </button>
          )}
          <span className={css.saveState}>{snapshot.subtitle}</span>
        </div>
        <div className={css.toolGroup}>
          {snapshot.branch === undefined ? null : (
            <span className={css.branchBadge} data-physicsos-branch="experimental">
              <IconVariable size={12} />
              {t('lab.branch.experimental')}
              {snapshot.branch.originQuestionTitle === undefined ? null : (
                <span className={css.branchOrigin}>
                  {t('lab.branch.from')}
                  {snapshot.branch.originQuestionTitle}
                </span>
              )}
              {snapshot.branch.canRestore && runtime.restoreOrigin !== undefined ? (
                <button
                  type="button"
                  className={css.branchRestore}
                  onClick={() => {
                    const next = runtime.restoreOrigin?.()
                    if (next !== undefined) commit(next)
                  }}
                >
                  {t('lab.branch.restore')}
                </button>
              ) : null}
            </span>
          )}
          <span
            className={clsx(css.verifiedState, failed && css.verifiedStateFailed)}
            data-status={snapshot.status}
          >
            <IconVerified size={13} />
            {statusLabel}
          </span>
          <div className={css.playbackTools}>
            <button
              type="button"
              className={clsx(css.primary, running && css.primaryRunning)}
              disabled={failed || clock.total <= 0}
              aria-pressed={running}
              onClick={() => {
                commit(runtime.setRunning(true))
              }}
            >
              {ended ? <IconRefreshOutline16 size={13} /> : <IconPlayOutline16 size={13} />}
              {ended ? t('lab.replay') : t('lab.run')}
            </button>
            <button
              type="button"
              className={css.secondary}
              disabled={failed}
              onClick={() => {
                commit(runtime.setRunning(false))
              }}
            >
              <IconPauseOutline16 size={13} />
              {t('lab.pause')}
            </button>
            <button
              type="button"
              className={css.ghost}
              disabled={failed}
              onClick={() => {
                commit(runtime.step(clock.total * STEP_FRACTION))
              }}
            >
              <IconChevronRightOutline14 size={13} />
              {t('lab.step')}
            </button>
            <button
              type="button"
              className={css.ghost}
              disabled={failed}
              onClick={() => {
                commit(runtime.seek(0))
              }}
            >
              <IconRefreshOutline16 size={13} />
              {t('lab.reset')}
            </button>
          </div>
          {toolbarExtra}
          {experimentMeta === undefined ? null : (
            <button
              type="button"
              className={css.tool}
              onClick={() => {
                setGuideOpen(true)
              }}
            >
              <IconQuestionOutline14 size={13} />
              {t('lab.guide')}
            </button>
          )}
          <button
            type="button"
            className={css.tool}
            disabled={failed}
            onClick={() => {
              setReportOpen(true)
            }}
          >
            <IconListPenOutline16 size={13} />
            {t('lab.report.open')}
          </button>
          <button
            type="button"
            className={clsx(css.tool, focused && css.toolActive)}
            aria-pressed={focused}
            onClick={() => {
              setFocused(value => !value)
              /* Mode changes keep focus on the active toolbar control. */
              if (inspector.open) inspector.toggle()
              if (sceneDrawer.open) sceneDrawer.toggle()
            }}
          >
            <IconFullscreenOutline16 size={13} />
            {focused ? t('lab.focus.exit') : t('lab.focus.enter')}
          </button>
          {focused ? null : (
            <>
              <button
                ref={sceneDrawer.triggerRef}
                type="button"
                className={clsx(css.tool, css.sceneToggle, sceneDrawer.open && css.toolActive)}
                aria-controls={sceneDrawer.id}
                aria-expanded={sceneDrawer.open}
                onClick={() => {
                  /* A folded track restores without touching drawer state; a
                     live flag is the only case where the toggle means that. */
                  if (sceneCollapsed) {
                    setSceneCollapsed(false)
                    return
                  }
                  if (inspector.open) inspector.toggle()
                  if (agentOpen) setAgentOpen(false)
                  sceneDrawer.toggle()
                }}
              >
                <IconScene size={14} />
                {t('lab.scene.toggle')}
              </button>
              <ResponsiveInspectorToggle
                controller={{
                  ...inspector,
                  toggle: () => {
                    /* Inspector and agent share the right rail: either claim
                       releases the other. */
                    if (inspectorCollapsed) {
                      setInspectorCollapsed(false)
                      setAgentOpen(false)
                      return
                    }
                    if (sceneDrawer.open) sceneDrawer.toggle()
                    if (agentOpen) setAgentOpen(false)
                    inspector.toggle()
                  },
                }}
                label={t('lab.inspectorPanel')}
              />
            </>
          )}
          {agentOpen ? null : (
            <button
              ref={agentTriggerRef}
              type="button"
              className={css.agentDock}
              onClick={() => {
                /* The agent claims the right rail — open drawers there first
                   release it, then the dock hands over. */
                if (inspector.open) inspector.toggle()
                if (sceneDrawer.open) sceneDrawer.toggle()
                setAgentOpen(true)
              }}
            >
              <Mascot pose="think" variant="avatar" size={26} className={css.agentDockMascot} />
              <IconSparkle16 size={12} className={css.agentDockSpark} />
              {t('lab.agent')}
            </button>
          )}
          <button
            type="button"
            className={clsx(css.tool, css.toolIcon)}
            aria-label={t('lab.more')}
            disabled
          >
            <IconEllipsisOutline16 size={14} />
          </button>
        </div>
      </header>

      {reportOpen ? (
        <ExperimentReportPanel
          snapshot={snapshot}
          t={t}
          onClose={() => {
            setReportOpen(false)
          }}
        />
      ) : null}

      {guideOpen && experimentMeta !== undefined ? (
        <ExperimentGuidePanel
          meta={experimentMeta}
          title={snapshot.title}
          t={t}
          onClose={() => {
            setGuideOpen(false)
          }}
        />
      ) : null}

      {failed && !showSchematic ? (
        <div className={css.emptyRuntime} role="alert">
          <strong>
            {snapshot.error?.code === 'UNSUPPORTED_MODEL'
              ? t('lab.status.unsupported')
              : t('lab.mechanics.runtimeFailed')}
          </strong>
          <span>{snapshot.error?.message ?? t('lab.dataStub')}</span>
          {snapshot.error?.recognized === undefined ||
          snapshot.error.recognized.length === 0 ? null : (
              <dl className={css.recognizedList}>
                {snapshot.error.recognized.map(row => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
        </div>
      ) : (
        <div className={clsx(css.body, focused && css.bodyFocused)}>
          {focused ? null : (
            <WorkspaceScenePanel
              controller={sceneDrawer}
              label={t('lab.scene')}
              closeLabel={t('lab.scene.close')}
              collapseLabel={t('lab.scene.collapse')}
              onCollapse={() => { setSceneCollapsed(true) }}
            >
              {buildMode === true && draft !== undefined && runtime.applyDraftEdit !== undefined ? (
                <CircuitBuilderPanel
                  t={t}
                  draft={draft}
                  editing={builderEditing}
                  pendingTerminal={pendingTerminal}
                  solvable={snapshot.status !== 'failed'}
                />
              ) : (
                <SceneTreePanel
                  nodes={snapshot.tree}
                  visible={observables}
                  selected={selected}
                  onSelect={setSelected}
                  onToggle={(observable: ObservableKey, next: boolean) => {
                    commit(runtime.setObservable(observable, next))
                  }}
                  onHover={(id) => {
                    highlight(id ?? undefined)
                  }}
                />
              )}
            </WorkspaceScenePanel>
          )}

          <div className={css.stage}>
            {failed && buildMode === true ? (
              <p className={css.buildDiagnostic} role="status" data-build-diagnostic="true">
                {failureMessage(t, snapshot.error)}
              </p>
            ) : null}
            <section
              /* Remount on an experiment switch so the canvas fade runs once
                 per scene — parameter edits keep the same scene and do not
                 re-trigger it. */
              key={`${snapshot.domain}:${snapshot.title}`}
              className={css.canvas}
              aria-label={t('lab.canvas')}
            >
              {/* The canvas is the renderer: it subscribes to the frame source
                  directly, so animation frames re-render only this subtree (#123). */}
              <CanvasFrame
                source={frameSource}
                ariaLabel={snapshot.ariaLabel}
                onSeekTime={seek}
                {...(componentDrag === undefined ? {} : { componentDrag })}
                {...(componentControl === undefined ? {} : { componentControl })}
                {...(componentWiring === undefined ? {} : { componentWiring })}
              />
            </section>

            <div className={css.timeline} aria-label={t('lab.timeline')}>
              <button
                type="button"
                className={clsx(css.transport, css.transportPrimary)}
                aria-label={ended ? t('lab.replay') : t('lab.playPause')}
                disabled={failed || clock.total <= 0}
                onClick={() => {
                  commit(runtime.setRunning(!running))
                }}
              >
                {running ? (
                  <IconPauseOutline16 size={14} />
                ) : ended ? (
                  <IconRefreshOutline16 size={14} />
                ) : (
                  <IconPlayOutline16 size={14} />
                )}
              </button>
              <button
                type="button"
                className={css.transport}
                aria-label={t('lab.stepBack')}
                onClick={() => {
                  commit(runtime.step(-clock.total * STEP_FRACTION))
                }}
              >
                <IconChevronLeftOutline14 size={13} />
              </button>
              <button
                type="button"
                className={css.transport}
                aria-label={t('lab.step')}
                onClick={() => {
                  commit(runtime.step(clock.total * STEP_FRACTION))
                }}
              >
                <IconChevronRightOutline14 size={13} />
              </button>
              <LiveClock source={frameSource} scale={clockScale} />
              <div className={css.trackWrap}>
                <TimelineScrubber
                  label={t('lab.timeline')}
                  min={0}
                  max={clock.total}
                  value={clock.time}
                  valueText={`${formatTimeIn(clock.time, clockScale)} / ${formatTimeIn(clock.total, clockScale)}`}
                  onChange={seek}
                />
                <TimelineMarkers events={snapshot.events} total={clock.total} onSeek={seek} />
              </div>
              <span className={clsx(css.clock, css.clockEnd)}>
                {formatTimeIn(clock.total, clockScale)}
              </span>
              <select
                className={css.rate}
                aria-label={t('lab.rate')}
                value={clock.rate}
                onChange={(event) => {
                  commit(runtime.setRate(Number(event.target.value)))
                }}
              >
                {PLAYBACK_RATES.map(rate => (
                  <option key={rate} value={rate}>{`${rate}x`}</option>
                ))}
              </select>
            </div>

            <section className={clsx(css.dataPanel, dataOpen && css.dataPanelOpen)}>
              <div className={css.dataHead}>
                {(
                  [
                    ['summary', t('lab.tab.summary')],
                    ['data', t('lab.tab.data')],
                    ['charts', t('lab.tab.charts')],
                    ['derivation', t('lab.tab.derivation')],
                    ['events', t('lab.tab.events')],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={clsx(css.tab, dataOpen && dataTab === id && css.tabActive)}
                    onClick={() => {
                      setDataTab(id)
                      setDataOpen(true)
                    }}
                  >
                    {label}
                  </button>
                ))}
                <span className={css.dataSpacer} />
                {dataTab === 'data' && snapshot.table.rows.length > 0 ? (
                  <button
                    type="button"
                    className={css.tab}
                    onClick={() => {
                      exportTableCsv(snapshot.title, snapshot.table)
                    }}
                  >
                    <IconDownloadOutline16 size={12} />
                    {t('lab.exportCsv')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={css.tab}
                  aria-expanded={dataOpen}
                  onClick={() => {
                    setDataOpen(open => !open)
                  }}
                >
                  {dataOpen ? t('lab.collapse') : t('lab.expand')}
                </button>
              </div>
              {dataOpen ? (
                <div className={css.dataBody}>
                  <DataPanelBody
                    tab={dataTab}
                    table={snapshot.table}
                    charts={snapshot.charts}
                    derivation={snapshot.derivation}
                    events={snapshot.events}
                    clock={clock}
                    emptyLabel={t('lab.dataStub')}
                    {...(experimentMeta === undefined ? {} : { experimentMeta })}
                    summaryLabels={{
                      coreModel: t('lab.summary.coreModel'),
                      parameters: t('lab.summary.parameters'),
                      feedback: t('lab.summary.feedback'),
                      errors: t('lab.summary.errors'),
                      textbook: t('lab.summary.textbook'),
                    }}
                    onSeek={seek}
                  />
                </div>
              ) : null}
            </section>
          </div>

          {agentOpen ? (
            /* The drawer docks in the inspector's rail at track widths; at
               drawer widths its absolute positioning turns it into the same
               overlay the inspector drawer uses. One element, both modes. */
            <AgentDrawer
              snapshot={snapshot}
              runtime={runtime}
              onSnapshot={commit}
              onClose={closeAgent}
              t={t}
              {...(recordAttempt === undefined ? {} : { recordAttempt })}
            />
          ) : focused ? null : (
            <ResponsiveInspector
              controller={inspector}
              label={t('lab.inspectorPanel')}
              closeLabel={t('lab.closeInspector')}
              collapseLabel={t('lab.inspector.collapse')}
              onCollapse={() => { setInspectorCollapsed(true) }}
            >
              <InspectorTabs
                sections={snapshot.inspector}
                checks={snapshot.verification}
                note={t('lab.derivedNote')}
                emptyLabel={t('lab.dataStub')}
                label={t('lab.inspectorPanel')}
                labels={{
                  properties: t('lab.inspectorTab.properties'),
                  readings: t('lab.inspectorTab.readings'),
                  checks: t('lab.inspectorTab.checks'),
                }}
                onEdit={(id, value) => {
                  commit(runtime.editParameter(id, value))
                }}
                onChoice={(id, value) => {
                  commit(runtime.setChoice(id, value))
                }}
                onHighlight={highlight}
              />
            </ResponsiveInspector>
          )}
        </div>
      )}

    </div>
  )
}

/** Observable visibility, read off the frame the runtime already reported. */
const collectObservables = (
  snapshot: WorkspaceSnapshot,
): Readonly<Partial<Record<ObservableKey, boolean>>> => snapshot.view.visible

/**
 * The renderer's independent update loop (#123).
 *
 * Subscribes to the frame source, so every animation frame re-renders ONLY this
 * canvas subtree: the surrounding React shell (toolbar, tree, inspector, panels)
 * stays on the throttled summary. Event bursts are derived here from the live
 * frame, so a collision is still seen the exact frame it happens.
 */
/* The timeline's current-time label reads the same per-frame source the
   canvas HUD does, so the two clocks can never disagree — the summary clock
   the rest of the shell uses is throttled to 250 ms and would lag the
   canvas by up to a quarter second while running. Only this tiny span
   subscribes; the scrubber keeps the summary clock so a drag is never
   fighting per-frame writes. */
function LiveClock({
  source,
  scale,
}: {
  source: FrameSource<WorkspaceSnapshot>
  scale: ReturnType<typeof timeScaleOf>
}) {
  const frame = useFrameSource(source)
  return <span className={css.clock}>{formatTimeIn(frame.clock.time, scale)}</span>
}

function CanvasFrame({
  source,
  ariaLabel,
  onSeekTime,
  componentDrag,
  componentControl,
  componentWiring,
}: {
  source: FrameSource<WorkspaceSnapshot>
  ariaLabel: string
  onSeekTime: (time: number) => void
  componentDrag?: ComponentDragChannel
  componentControl?: ComponentControlChannel
  componentWiring?: ComponentWiringChannel
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
      {...(componentDrag === undefined ? {} : { componentDrag })}
      {...(componentControl === undefined ? {} : { componentControl })}
      {...(componentWiring === undefined ? {} : { componentWiring })}
      effects={effects}
      clockTime={frame.clock.time}
    />
  )
}
