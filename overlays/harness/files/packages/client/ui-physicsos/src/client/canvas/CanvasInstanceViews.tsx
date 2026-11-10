import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button, MarkdownText, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { KeyboardEvent } from 'react'
import type { CanvasFrameProps, CanvasInstanceProps } from './contract.ts'
import { PLAYBACK_RATES } from '../animation-clock.ts'
import type { CanvasInstanceActionArguments, CanvasInstanceActionName } from './types.ts'
import { PhysicsCanvas } from '../physics/PhysicsCanvas.tsx'
import { CircuitBuilderPanel } from '../physics/CircuitBuilderPanel.tsx'
import { placeBuilderPart } from '../physics/circuit-part-drag.ts'
import { BUILDER_PARTS, type CircuitDraft, type TerminalRef } from '../physics/circuit-builder.ts'
import type { ComponentEditCommand } from '../physics/renderer-registry.tsx'
import { DataPanelBody, InspectorTabs, SceneTreePanel, type DataTab } from '../workspace-parts.tsx'
import { TimelineScrubber } from '../TimelineScrubber.tsx'
import { formatTimeIn, timeScaleOf } from '../physics/time-format.ts'
import { experimentMetaOf } from '../physics/experiment-summaries.ts'
import { buildExperimentReport } from '../physics/experiment-report.ts'
import { downloadCanvasFile } from './download.ts'
import { CanvasRendererFrame } from './CanvasRendererFrame.tsx'
import { LensBench2D } from '../experiments/LensBench2D.tsx'
import { OptionalLensBench } from '../experiments/OptionalLensBench.tsx'
import { lensBenchSnapshot } from './lens-bench-view.ts'
import rendererCss from './CanvasRendererFrame.module.css'
import css from './CanvasWorkspace.module.css'
import principlesCss from './CanvasPrinciples.module.css'

const circuitEditRejected = (value: { readonly diagnostics: readonly { readonly code: string }[] }): boolean =>
  value.diagnostics.some(item => item.code === 'INVALID_DRAFT' || item.code === 'WORKBENCH_EDIT_REJECTED')

/** The stage alone consumes high-frequency frames; neighboring parameter panels use summaries. */
export function CanvasFrameStage(props: CanvasFrameProps) {
  const { canvasId, instanceId, instanceKey, displayKey, canvasCommands } = props
  const frame = props.useCanvasFrame(instanceKey)
  const summary = props.useCanvasInstance(instanceKey)
  const renderer = props.useCanvasRenderer(instanceKey)
  const [failedUrl, setFailedUrl] = useState<string | undefined>()
  const [lensMode, setLensMode] = useState<'native' | '2d' | '3d'>('2d')
  const document = props.useCanvasDocument(canvasId)
  const readOnly = document?.status === 'deleted' || document?.status === 'auth-required' || document?.loading === true
  const root = useRef<HTMLDivElement>(null)
  const [narrowStage, setNarrowStage] = useState(false)
  useEffect(() => {
    const element = root.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const resized = (): void => {
      if (element.clientWidth > 0) setNarrowStage(element.clientWidth < 480)
    }
    resized()
    const observer = new ResizeObserver(resized)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [])
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const act = useCallback(<K extends CanvasInstanceActionName>(action: K, ...args: CanvasInstanceActionArguments<K>): void => {
    void props.applyCanvasNativeAction(instanceKey, displayKey, action, ...args).catch(error => {
      if (mounted.current) props.actions.showToast('canvas.error.generic', error instanceof Error ? error.message : undefined, true)
    })
  }, [props.applyCanvasNativeAction, instanceKey, displayKey, props.actions])
  useEffect(() => props.attachCanvasRenderer(canvasId, instanceId, instanceKey, displayKey),
    [props.attachCanvasRenderer, canvasId, instanceId, instanceKey, displayKey])
  useEffect(() => {
    const release = canvasCommands.attachDisplay(instanceKey, displayKey)
    const element = root.current
    const observer = typeof IntersectionObserver === 'undefined' || element === null ? undefined : new IntersectionObserver(entries => {
      canvasCommands.setDisplayVisible(instanceKey, displayKey, entries.some(entry => entry.isIntersecting))
    })
    if (element !== null) observer?.observe(element)
    return () => { observer?.disconnect(); release() }
  }, [canvasCommands, instanceKey, displayKey])
  const drag = useMemo(() => summary?.capabilities.componentPlacement !== true ? undefined : {
    preview: (id: string, at: { x: number; y: number }) => { act('previewComponentPlacement', id, at) },
    commit: (id: string, at: { x: number; y: number }) => { act('commitComponentPlacement', id, at) },
    nudge: (id: string, delta: { x: number; y: number }) => { act('nudgeComponentPlacement', id, delta) },
    cancel: () => { act('cancelComponentPlacement') },
  }, [summary?.capabilities.componentPlacement, act])
  const controls = useMemo(() => summary?.capabilities.switch !== true && summary?.capabilities.slider !== true ? undefined : {
    setSwitch: (id: string, state: 'open' | 'closed') => { act('setSwitchState', id, state) },
    previewSlider: (id: string, position: number) => { act('previewSliderPosition', id, position) },
    commitSlider: (id: string, position: number) => { act('commitSliderPosition', id, position) },
    cancelSlider: () => { act('cancelSliderPosition') },
  }, [summary?.capabilities.switch, summary?.capabilities.slider, act])
  const wiring = summary?.buildMode !== 'construct' ? undefined : {
    start: (terminal: TerminalRef) => {
      if (summary.pendingWire === undefined) act('beginWire', terminal)
      else act('completeWire', terminal)
    },
    cancel: () => { act('cancelWire') },
    complete: (terminal: TerminalRef) => { act('completeWire', terminal) },
    ...(summary.pendingWire === undefined ? {} : { pending: summary.pendingWire }),
  }
  const constructing = summary?.buildMode === 'construct'
  const editApparatus = (id: string, command: ComponentEditCommand): void => {
    if (!constructing || readOnly) return
    act('editBuilderComponent', id, command)
  }
  const dockReadings = narrowStage
  const failedRenderer = !constructing && (renderer?.status === 'error' || (renderer?.entryUrl !== undefined && failedUrl === renderer.entryUrl))
  const bench = useMemo(() => summary === undefined || frame === undefined ? undefined
    : lensBenchSnapshot({ ...summary.workspace, view: frame.view }), [summary, frame])
  const showBench = props.presentation === 'focus' && bench !== undefined && (renderer?.status !== 'ready' || failedRenderer)
  const benchProps = bench === undefined ? undefined : { snapshot: bench,
    preview: (id: string, value: number) => { if (!readOnly) act('previewParameter', id, value) },
    commit: (id: string, value: number) => { if (!readOnly) act('commitParameter', id, value) },
    cancel: () => { props.cancelCanvasRendererPreview(instanceKey, displayKey) },
  }
  const platform = frame === undefined ? <div className={css.loading} role="status">{props.t('canvas.loadingExperiment')}</div>
    : showBench && benchProps !== undefined && lensMode !== 'native'
      ? lensMode === '2d' ? <LensBench2D {...benchProps} /> : <OptionalLensBench {...benchProps} />
      :
      <PhysicsCanvas view={frame.view} ariaLabel={frame.ariaLabel} showReadout={!dockReadings} trajectoryTimes={frame.trajectoryTimes}
        sampleReadout={index => props.getCanvasReadout(instanceKey, index)} onSeekTime={time => { if (!readOnly) act('seek', time) }}
        clockTime={frame.clock.time}
        {...(!constructing || readOnly ? {} : {
          componentSelection: { selected: summary?.workspace.view.highlighted?.[0], select: (id: string) => { act('setHighlight', [id]) }, edit: editApparatus },
          onDropPart: (partId: string, at: { x: number; y: number }) => {
            const part = BUILDER_PARTS.find(item => item.id === partId)
            if (part === undefined) return
            let selectedId: string | undefined
            void canvasCommands.instanceAction(instanceKey, 'applyDraftEdit', draft => {
              const placed = placeBuilderPart(draft, part, at)
              selectedId = placed.componentId
              return placed.draft
            }).then(result => {
              if (circuitEditRejected(result)) throw new Error(props.t('lab.builder.editFailed'))
              if (selectedId !== undefined) act('setHighlight', [selectedId])
            }).catch(error => { props.actions.showToast('canvas.error.generic', error instanceof Error ? error.message : undefined, true) })
          },
        })}
        {...(drag === undefined || readOnly ? {} : { componentDrag: drag })}
        {...(controls === undefined || readOnly ? {} : { componentControl: controls })}
        {...(wiring === undefined || readOnly ? {} : { componentWiring: wiring })} />
  return <div ref={root} className={`${css.physicsStage} ${rendererCss.stack} ${showBench ? css.lensStage : ''} ${constructing ? css.constructionStage : ''} ${dockReadings ? css.narrowConstructionStage : ''} nodrag nopan nowheel`} data-canvas-instance-stage={instanceKey}
    onKeyDown={event => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing || !props.ownsCanvasNativePreview(instanceKey, displayKey)) return
      event.preventDefault(); event.stopPropagation(); props.cancelCanvasRendererPreview(instanceKey, displayKey)
    }}>
    {showBench ? <div className={css.instanceToolbar}>{(['native', '2d', '3d'] as const).map(mode => <Button key={mode} variant={mode === lensMode ? 'primary' : 'toolbar'}
      aria-pressed={mode === lensMode} onClick={() => { props.cancelCanvasRendererPreview(instanceKey, displayKey); setLensMode(mode) }}>{props.t(mode === 'native' ? 'canvas.lens.native' : mode === '2d' ? 'canvas.lens.twoD' : 'canvas.lens.threeD')}</Button>)}</div> : null}
    {showBench ? <div className={css.lensStageBody}>{platform}</div> : constructing
      ? <div className={css.buildDiagramRegion} data-canvas-diagram="">{platform}</div> : platform}
    {dockReadings && frame !== undefined && frame.view.overlay.readout.length > 0 ? <div
      className={css.dockedReadings} data-canvas-readouts="docked" role="group" aria-label={props.t('lab.inspectorTab.readings')}>
      {frame.view.overlay.readout.map((reading, index) => <span key={index}>{reading}</span>)}
    </div> : null}
    {!constructing && renderer?.status === 'ready' && frame !== undefined && !failedRenderer && !readOnly ?
      <CanvasRendererFrame renderer={renderer} frame={frame}
        onIntent={value => props.applyCanvasRendererIntent(instanceKey, displayKey, value)}
        onCancel={() => { props.cancelCanvasRendererPreview(instanceKey, displayKey) }}
        onFailure={() => { setFailedUrl(renderer.entryUrl) }} /> : null}
    {failedRenderer ? <div className={rendererCss.notice} role="status">
      <span>{props.t('canvas.rendererUnavailable')}</span>
      <Button size="sm" variant="ghost" onClick={() => { setFailedUrl(undefined); props.retryCanvasRenderer(instanceKey) }}>{props.t('canvas.retry')}</Button>
    </div> : null}
  </div>
}

/** One instance is shared by its compact card and its focused editor. */
export function CanvasInstanceView(props: CanvasInstanceProps) {
  const { t, instanceKey, presentation, canvasCommands } = props
  const document = props.useCanvasDocument(props.canvasId)
  const readOnly = document?.status === 'deleted' || document?.status === 'auth-required' || document?.loading === true
  const summary = props.useCanvasInstance(instanceKey)
  const displayKey = useId()
  const [dataTab, setDataTab] = useState<DataTab>('data')
  const [dataOpen, setDataOpen] = useState(false)
  const [principlesOpen, setPrinciplesOpen] = useState(false)
  const [guide, setGuide] = useState(false)
  const [report, setReport] = useState(false)
  const [treeSelection, setTreeSelection] = useState('scene')
  const meta = summary?.templateId === undefined ? undefined : experimentMetaOf(summary.templateId)
  const act = useCallback(<K extends CanvasInstanceActionName>(action: K, ...args: CanvasInstanceActionArguments<K>): void => {
    const result = action === 'undo' || action === 'redo'
      ? props.applyCanvasNativeAction(instanceKey, displayKey, action, ...args)
      : canvasCommands.instanceAction(instanceKey, action, ...args)
    void result.catch(error => {
      props.actions.showToast('canvas.error.generic', error instanceof Error ? error.message : undefined, true)
    })
  }, [canvasCommands, instanceKey, displayKey, props.applyCanvasNativeAction, props.actions])
  const keyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return
    const target = event.target
    if (target instanceof Node && !event.currentTarget.contains(target)) return
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input,textarea,select,[role="menu"]') !== null)) return
    if (target instanceof HTMLElement && target.closest('button,a,summary') !== null && (event.key === ' ' || event.key === 'Enter')) return
    if (summary === undefined) return
    if (event.key === 'Escape' && props.ownsCanvasNativePreview(instanceKey, displayKey)) {
      event.preventDefault(); event.stopPropagation(); props.cancelCanvasRendererPreview(instanceKey, displayKey); return
    }
    if (event.key === 'Escape' && summary.pendingWire !== undefined) {
      event.preventDefault(); event.stopPropagation(); act('cancelWire'); return
    }
    if (event.key === ' ' && summary.clock.total > 0) { event.preventDefault(); act('setRunning', !summary.clock.running) }
    if (event.key === 'ArrowRight') { event.preventDefault(); act('step', summary.clock.total / 10) }
    if (event.key === 'ArrowLeft') { event.preventDefault(); act('step', -summary.clock.total / 10) }
    if (event.key === 'Home') { event.preventDefault(); act('seek', 0) }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); act(event.shiftKey ? 'redo' : 'undo')
    }
  }
  if (summary === undefined) return <div className={css.loading} role="status">{t('canvas.loadingExperiment')}</div>
  const snapshot = summary.workspace
  const constructing = summary.buildMode === 'construct' && summary.draft !== undefined
  const selectedComponent = snapshot.view.highlighted?.[0]
  const selectComponent = (id: string | undefined): void => { act('setHighlight', id === undefined ? [] : [id]) }
  const editing = {
    apply: async (edit: (draft: CircuitDraft) => CircuitDraft): Promise<void> => {
      const result = await canvasCommands.instanceAction(instanceKey, 'applyDraftEdit', edit)
      if (circuitEditRejected(result)) throw new Error(t('lab.builder.editFailed'))
    },
    undo: () => { act('undo') }, redo: () => { act('redo') }, canUndo: summary.history.canUndo, canRedo: summary.history.canRedo,
  }
  const clockScale = timeScaleOf(summary.clock.total)
  const markdownLabels = { code: { copyLabel: t('markdown.copy'), copiedLabel: t('canvas.copied') }, footnotes: t('canvas.data') }
  const capture = (): void => {
    void canvasCommands.capture(props.canvasId, props.instanceId).then(() => {
      props.actions.showToast('canvas.captured', undefined)
    }).catch(error => { props.actions.showToast('canvas.error.capture', error instanceof Error ? error.message : undefined, true) })
  }
  return <section className={`${css.instance} ${presentation === 'focus' ? css.instanceFocused : ''} ${constructing ? css.instanceConstructing : ''} nodrag nopan nowheel`}
    onKeyDown={keyDown} data-workbench-instance={instanceKey} data-scene-revision={snapshot.sceneRevision} tabIndex={0}>
    <div className={css.instanceToolbar}>
      {summary.clock.total > 0 ? <>
        <Button variant="toolbar" aria-label={summary.clock.running ? t('lab.pause') : t('lab.run')}
          onClick={() => { act('setRunning', !summary.clock.running) }}>{summary.clock.running ? t('lab.pause') : t('lab.run')}</Button>
        <span className={css.clock}>{formatTimeIn(summary.clock.time, clockScale)} / {formatTimeIn(summary.clock.total, clockScale)}</span>
        <select aria-label={t('lab.rate')} value={summary.clock.rate} onChange={event => { act('setRate', Number(event.target.value)) }}>
          {PLAYBACK_RATES.map(rate => <option key={rate} value={rate}>{rate}×</option>)}
        </select>
      </> : <span className={constructing ? css.benchStatus : css.muted}>{t(constructing ? snapshot.status === 'failed' ? 'canvas.benchDraft' : 'canvas.benchLive' : 'canvas.staticResult')}</span>}
      <Tooltip label={t('canvas.capture')} portal><Button variant="toolbar" disabled={readOnly || summary.previewing || !summary.capabilities.capture}
        onClick={capture}>{t('canvas.capture')}</Button></Tooltip>
      {summary.capabilities.construct ? <Button variant={constructing ? 'primary' : 'outline'} aria-pressed={constructing} disabled={readOnly}
        onClick={() => { act(constructing ? 'leaveBuilder' : 'enterBuilder') }}>{t(constructing ? 'canvas.leaveBuilder' : 'canvas.builder')}</Button> : null}
      {presentation === 'card' ? <Button variant="toolbar" onClick={() => { props.actions.focus(instanceKey) }}>{t('canvas.focus')}</Button> : null}
    </div>
    {constructing && presentation === 'card' ? <div className={css.apparatusEditor}>
      <fieldset className={css.apparatusObjects} aria-label={t('lab.builder.parts')} disabled={readOnly}>
        <CircuitBuilderPanel t={t} draft={summary.draft!} editing={editing} solvable={snapshot.status !== 'failed'}
          pendingTerminal={summary.pendingWire} selectedComponentId={selectedComponent} onSelectComponent={selectComponent} variant="compact" />
      </fieldset>
      <div className={css.apparatusCenter}>
        <div className={css.benchGuide} title={t('canvas.benchKeyboardHint')}><span className={css.benchBadge}>{t('canvas.benchLabel')}</span><span>{t('canvas.benchHint')}</span></div>
        {props.renderSlot('physicsos.canvas.frame', { canvasId: props.canvasId, instanceId: props.instanceId, instanceKey, displayKey, presentation })}
      </div>
    </div> : presentation === 'focus' ? <div className={css.instanceEditor}>
      <aside className={css.instanceObjects}>
        {summary.buildMode === 'construct' && summary.draft !== undefined ? <fieldset className={css.builderControls} disabled={readOnly}><CircuitBuilderPanel t={t} draft={summary.draft}
          editing={editing} variant="compact" selectedComponentId={selectedComponent} onSelectComponent={selectComponent} pendingTerminal={summary.pendingWire}
          solvable={snapshot.status !== 'failed'} /></fieldset> : <SceneTreePanel nodes={snapshot.tree} selected={treeSelection}
          onSelect={id => { setTreeSelection(id); act('setHighlight', [id]) }}
          onToggle={(key, enabled) => { act('setObservable', key, enabled) }} visible={snapshot.view.visible}
          onHover={id => { act('setHighlight', id === null ? [] : [id]) }} />}
        <div className={css.actionRow}>
          <Button variant="ghost" disabled={!summary.history.canUndo} onClick={() => { act('undo') }}>{t('canvas.experimentUndo')}</Button>
          <Button variant="ghost" disabled={!summary.history.canRedo} onClick={() => { act('redo') }}>{t('canvas.experimentRedo')}</Button>
          <Button variant="ghost" onClick={() => { act('restoreOrigin') }}>{t('canvas.restoreOrigin')}</Button>
          {summary.capabilities.construct ? <Button variant="ghost" onClick={() => { act(summary.buildMode === 'construct' ? 'leaveBuilder' : 'enterBuilder') }}>
            {summary.buildMode === 'construct' ? t('canvas.leaveBuilder') : t('canvas.builder')}
          </Button> : null}
        </div>
      </aside>
      <div className={css.instanceCenter}>{props.renderSlot('physicsos.canvas.frame', { canvasId: props.canvasId, instanceId: props.instanceId, instanceKey, displayKey, presentation })}</div>
      <aside className={css.instanceProperties}>
        <InspectorTabs sections={snapshot.inspector} checks={snapshot.verification} note={t('canvas.inspectorNote')}
          emptyLabel={t('canvas.noValue')} label={t('canvas.parameters')}
          labels={{ properties: t('canvas.parameters'), readings: t('lab.inspectorTab.readings'), checks: t('lab.inspectorTab.checks') }}
          onEdit={(id, value) => { act('editParameter', id, value) }} onChoice={(id, value) => { act('setChoice', id, value) }}
          onHighlight={id => { act('setHighlight', id === undefined ? [] : [id]) }} />
      </aside>
    </div> : props.renderSlot('physicsos.canvas.frame', { canvasId: props.canvasId, instanceId: props.instanceId, instanceKey, displayKey, presentation })}
    {presentation === 'card' ? <details className={css.instanceData}>
      <summary>{t('canvas.parameters')}</summary>
      <InspectorTabs sections={snapshot.inspector} checks={snapshot.verification} note={t('canvas.inspectorNote')}
        emptyLabel={t('canvas.noValue')} label={t('canvas.parameters')}
        labels={{ properties: t('canvas.parameters'), readings: t('lab.inspectorTab.readings'), checks: t('lab.inspectorTab.checks') }}
        onEdit={(id, value) => { act('editParameter', id, value) }} onChoice={(id, value) => { act('setChoice', id, value) }}
        onHighlight={id => { act('setHighlight', id === undefined ? [] : [id]) }} />
    </details> : null}
    {presentation === 'card' && snapshot.derivation.length > 0 ? <details className={principlesCss.panel}
      onToggle={event => { setPrinciplesOpen(event.currentTarget.open) }}>
      <summary>{t('canvas.principles')}</summary>
      {principlesOpen ? <DataPanelBody tab="derivation" table={snapshot.table} charts={snapshot.charts} derivation={snapshot.derivation}
        events={snapshot.events} clock={snapshot.clock} emptyLabel={t('canvas.noValue')} /> : null}
    </details> : null}
    {snapshot.error === undefined || constructing ? null : <div className={css.notice} role="alert">{snapshot.error.message}</div>}
    {summary.clock.total > 0 ? <div className={css.timeline}>
      <TimelineScrubber label={t('lab.timeline')} min={0} max={summary.clock.total} value={summary.clock.time}
        valueText={formatTimeIn(summary.clock.time, clockScale)} onChange={value => { act('seek', value) }} />
    </div> : null}
    {presentation === 'focus' ? <>
      <div className={css.actionRow}>
        <Button variant="ghost" aria-expanded={dataOpen} onClick={() => { setDataOpen(!dataOpen) }}>{t('canvas.data')}</Button>
        {meta === undefined ? null : <Button variant="ghost" onClick={() => { setGuide(true) }}>{t('canvas.guide')}</Button>}
        <Button variant="ghost" onClick={() => { setReport(true) }}>{t('canvas.report')}</Button>
      </div>
      {dataOpen ? <div className={css.instanceData}>
        <div className={css.tabs}>
          {(['data', 'charts', 'derivation', 'events', 'summary'] as const).map(tab => <Button key={tab} variant={tab === dataTab ? 'primary' : 'ghost'}
            onClick={() => { setDataTab(tab) }}>{t(`lab.tab.${tab}`)}</Button>)}
        </div>
        <DataPanelBody tab={dataTab} table={snapshot.table} charts={snapshot.charts} derivation={snapshot.derivation}
          events={snapshot.events} clock={snapshot.clock} emptyLabel={t('canvas.noValue')} experimentMeta={meta}
          summaryLabels={{ coreModel: t('lab.summary.coreModel'), parameters: t('lab.summary.parameters'), feedback: t('lab.summary.feedback'), errors: t('lab.summary.errors'), textbook: t('lab.summary.textbook') }}
          onSeek={time => { act('seek', time) }} />
      </div> : null}
      <Modal open={guide} onClose={() => { setGuide(false) }} title={t('canvas.guide')} closeLabel={t('canvas.close')}>
        {meta === undefined ? null : <><p>{meta.summary.coreModel}</p><ol>{meta.guide?.map(step => <li key={step}>{step}</li>)}</ol>
          <ul>{meta.summary.errors.map(item => <li key={item}>{item}</li>)}</ul></>}
      </Modal>
      <Modal open={report} onClose={() => { setReport(false) }} title={t('canvas.report')} closeLabel={t('canvas.close')}
        footer={<Button variant="outline" onClick={() => {
          const value = buildExperimentReport(snapshot, new Date(), summary.notebook)
          downloadCanvasFile(value.markdown, `${snapshot.title}.md`, 'text/markdown')
        }}>{t('canvas.export')}</Button>}>
        <MarkdownText text={buildExperimentReport(snapshot, new Date(), summary.notebook).markdown} labels={markdownLabels} />
      </Modal>
    </> : null}
  </section>
}
