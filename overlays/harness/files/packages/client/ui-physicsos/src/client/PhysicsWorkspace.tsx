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
  IconEllipsisOutline16,
  IconPauseOutline16,
  IconPlayOutline16,
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
import { ExperimentReportPanel } from './ExperimentReportPanel.tsx'
import { IconVariable, IconVerified } from './icons/physics-icons.tsx'
import { PhysicsCanvas } from './physics/PhysicsCanvas.tsx'
import type { ObservableKey } from './physics/scene-visual-model.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './physics/workspace-runtime.ts'
import type { SelfCheckAttemptInput } from './QuestionWorkspace.tsx'
import {
  DataPanelBody,
  InspectorSections,
  SceneTreePanel,
  TimelineMarkers,
  VerificationList,
  type DataTab,
} from './workspace-parts.tsx'
import type { PhysicsosKey } from './locales.ts'
import css from './LabWorkspace.module.css'

type Translate = (key: PhysicsosKey) => string

const PLAYBACK_RATES = [0.25, 0.5, 1, 2] as const

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
   * Write an AI 助教 自测 answer into the learning record. Optional because the
   * shell is also mounted standalone (tests, embeds) without a record store.
   */
  readonly recordAttempt?: (attempt: SelfCheckAttemptInput) => void
}

export function PhysicsWorkspace({
  runtime, t, toolbarExtra, onSwitchExperiment, recordAttempt,
}: PhysicsWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(() => runtime.getSnapshot())
  const [selected, setSelected] = useState('scene')
  const [dataOpen, setDataOpen] = useState(false)
  const [dataTab, setDataTab] = useState<DataTab>('charts')
  const [agentOpen, setAgentOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const inspector = useResponsiveInspector()
  /* Hover highlight is transient chrome, so it is kept out of the runtime until
     it actually needs to reach the canvas. */
  const highlightRef = useRef<string | undefined>(undefined)

  const clock = snapshot.clock
  const running = clock.running
  /* One unit for the whole timeline, chosen from the run window, so the moving
     clock and its total stay comparable — `3.75 µs / 10.00 µs`, never `1e-5s`. */
  const clockScale = timeScaleOf(clock.total)

  useAnimationClock(running, useCallback((elapsed: number) => {
    setSnapshot(runtime.advance(elapsed))
  }, [runtime]))

  /* A new runtime instance (different scene) must not keep the previous frame. */
  useEffect(() => {
    setSnapshot(runtime.getSnapshot())
  }, [runtime])

  const highlight = useCallback((id: string | undefined) => {
    if (highlightRef.current === id) return
    highlightRef.current = id
    setSnapshot(runtime.setHighlight(id === undefined ? [] : [id]))
  }, [runtime])

  const seek = useCallback((time: number) => {
    setSnapshot(runtime.seek(time))
  }, [runtime])

  const statusLabel =
    snapshot.status === 'verified'
      ? t('lab.mechanics.verified')
      : snapshot.status === 'warning'
        ? t('lab.status.warning')
        : t('lab.status.failed')

  const failed = snapshot.status === 'failed'

  const observables = useMemo(() => collectObservables(snapshot), [snapshot])

  return (
    <div
      className={css.cover}
      data-physicsos-surface="lab"
      data-physicsos-domain={snapshot.domain}
      data-scene-revision={snapshot.sceneRevision}
      data-verification-status={snapshot.status}
    >
      <header className={css.toolbar}>
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
                    if (next !== undefined) setSnapshot(next)
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
          <span className={css.divider} />
          <button
            type="button"
            className={css.primary}
            disabled={failed || clock.total <= 0}
            onClick={() => { setSnapshot(runtime.setRunning(true)) }}
          >
            <IconPlayOutline16 size={13} />
            {t('lab.run')}
          </button>
          <button
            type="button"
            className={css.secondary}
            disabled={failed}
            onClick={() => { setSnapshot(runtime.setRunning(false)) }}
          >
            <IconPauseOutline16 size={13} />
            {t('lab.pause')}
          </button>
          <button
            type="button"
            className={css.ghost}
            disabled={failed}
            onClick={() => { setSnapshot(runtime.step(clock.total * STEP_FRACTION)) }}
          >
            <IconChevronRightOutline14 size={13} />
            {t('lab.step')}
          </button>
          <button
            type="button"
            className={css.ghost}
            disabled={failed}
            onClick={() => { setSnapshot(runtime.seek(0)) }}
          >
            <IconRefreshOutline16 size={13} />
            {t('lab.reset')}
          </button>
          <span className={css.divider} />
          {toolbarExtra}
          <button
            type="button"
            className={css.tool}
            disabled={failed}
            onClick={() => { setReportOpen(true) }}
          >
            {t('lab.report.open')}
          </button>
          <ResponsiveInspectorToggle controller={inspector} label={t('lab.inspector')} />
          <button type="button" className={clsx(css.tool, css.toolIcon)} aria-label={t('lab.more')} disabled>
            <IconEllipsisOutline16 size={14} />
          </button>
        </div>
      </header>

      {reportOpen ? (
        <ExperimentReportPanel
          snapshot={snapshot}
          t={t}
          onClose={() => { setReportOpen(false) }}
        />
      ) : null}

      {failed ? (
        <div className={css.emptyRuntime} role="alert">
          <strong>{snapshot.error?.code === 'UNSUPPORTED_MODEL' ? t('lab.status.unsupported') : t('lab.mechanics.runtimeFailed')}</strong>
          <span>{snapshot.error?.message ?? t('lab.dataStub')}</span>
          {snapshot.error?.recognized === undefined || snapshot.error.recognized.length === 0 ? null : (
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
        <div className={css.body}>
          <section className={clsx(css.panel, css.scenePanel)} aria-label={t('lab.scene')}>
            <div className={css.panelHead}>
              <h2 className={css.panelTitle}>{t('lab.scene')}</h2>
            </div>
            <div className={css.panelBody}>
              <SceneTreePanel
                nodes={snapshot.tree}
                visible={observables}
                selected={selected}
                onSelect={setSelected}
                onToggle={(observable: ObservableKey, next: boolean) => {
                  setSnapshot(runtime.setObservable(observable, next))
                }}
                onHover={(id) => { highlight(id ?? undefined) }}
              />
            </div>
          </section>

          <div className={css.stage}>
            <section className={css.canvas} aria-label={t('lab.canvas')}>
              <PhysicsCanvas
                view={snapshot.view}
                ariaLabel={snapshot.ariaLabel}
                trajectoryTimes={snapshot.trajectoryTimes}
                {...snapshot.sampleReadout === undefined ? {} : { sampleReadout: snapshot.sampleReadout }}
                onSeekTime={seek}
              />
            </section>

            <div className={css.timeline} aria-label={t('lab.timeline')}>
              <button
                type="button"
                className={clsx(css.transport, css.transportPrimary)}
                aria-label={t('lab.playPause')}
                onClick={() => { setSnapshot(runtime.setRunning(!running)) }}
              >
                {running ? <IconPauseOutline16 size={14} /> : <IconPlayOutline16 size={14} />}
              </button>
              <button
                type="button"
                className={css.transport}
                aria-label={t('lab.stepBack')}
                onClick={() => { setSnapshot(runtime.step(-clock.total * STEP_FRACTION)) }}
              >
                <IconChevronLeftOutline14 size={13} />
              </button>
              <button
                type="button"
                className={css.transport}
                aria-label={t('lab.step')}
                onClick={() => { setSnapshot(runtime.step(clock.total * STEP_FRACTION)) }}
              >
                <IconChevronRightOutline14 size={13} />
              </button>
              <span className={css.clock}>{formatTimeIn(clock.time, clockScale)}</span>
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
              <span className={clsx(css.clock, css.clockEnd)}>{formatTimeIn(clock.total, clockScale)}</span>
              <select
                className={css.rate}
                aria-label={t('lab.rate')}
                value={clock.rate}
                onChange={(event) => { setSnapshot(runtime.setRate(Number(event.target.value))) }}
              >
                {PLAYBACK_RATES.map(rate => (
                  <option key={rate} value={rate}>{`${rate}x`}</option>
                ))}
              </select>
            </div>

            <section className={clsx(css.dataPanel, dataOpen && css.dataPanelOpen)}>
              <div className={css.dataHead}>
                {([
                  ['data', t('lab.tab.data')],
                  ['charts', t('lab.tab.charts')],
                  ['derivation', t('lab.tab.derivation')],
                  ['events', t('lab.tab.events')],
                ] as const).map(([id, label]) => (
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
                <button
                  type="button"
                  className={css.tab}
                  aria-expanded={dataOpen}
                  onClick={() => { setDataOpen(open => !open) }}
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
                    onSeek={seek}
                  />
                </div>
              ) : null}
            </section>
          </div>

          <ResponsiveInspector
            controller={inspector}
            label={t('lab.inspector')}
            closeLabel={t('lab.closeInspector')}
          >
            <InspectorSections
              sections={snapshot.inspector}
              note={t('lab.derivedNote')}
              onEdit={(id, value) => { setSnapshot(runtime.editParameter(id, value)) }}
              onChoice={(id, value) => { setSnapshot(runtime.setChoice(id, value)) }}
              onHighlight={highlight}
            />
            <p className={css.sectionLabel}>{t('lab.verification')}</p>
            <VerificationList checks={snapshot.verification} emptyLabel={t('lab.dataStub')} />
          </ResponsiveInspector>
        </div>
      )}

      {agentOpen ? (
        <AgentDrawer
          snapshot={snapshot}
          runtime={runtime}
          onSnapshot={setSnapshot}
          onClose={() => { setAgentOpen(false) }}
          t={t}
          {...(recordAttempt === undefined ? {} : { recordAttempt })}
        />
      ) : (
        <button type="button" className={css.agentDock} onClick={() => { setAgentOpen(true) }}>
          <IconSparkle16 size={14} />
          {t('lab.agent')}
        </button>
      )}
    </div>
  )
}

/** Observable visibility, read off the frame the runtime already reported. */
const collectObservables = (
  snapshot: WorkspaceSnapshot,
): Readonly<Partial<Record<ObservableKey, boolean>>> => snapshot.view.visible
