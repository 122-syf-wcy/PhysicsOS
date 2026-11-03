import { useEffect, useMemo, useRef, useState } from 'react'
import { zh } from '../locales.ts'
import { buildWorkspaceRuntime } from '../physics/build-workspace-runtime.ts'
import { findExperimentTemplate } from '../physics/experiment-templates.ts'
import type { QuantityParameter, SceneTreeNode } from '../physics/scene-visual-model.ts'
import type { WorkspaceRuntime } from '../physics/workspace-runtime.ts'
import { CommunityExperimentFrame, type CommunityFrameStatus } from './CommunityExperimentFrame.tsx'
import { applyUniversalContributionIntent } from './contribution-protocol.ts'
import type { ExperimentSession } from './experiment-session.ts'
import { LensControls } from './LensControls.tsx'
import { useExperimentSession } from './use-experiment-session.ts'
import css from './ExperimentCandidatePreview.module.css'

const translatedLabels: Partial<Record<string, string>> = zh

interface Props {
  readonly experimentId: string
  readonly entryUrl: string
  readonly protocolVersion: 1 | 2 | 3
  readonly onStatusChange?: (status: CommunityFrameStatus) => void
}

/** A candidate never borrows the active lab scene or a different experiment's engine. */
export function ExperimentCandidatePreview(props: Props) {
  const runtime = useMemo(() => {
    const template = findExperimentTemplate(props.experimentId)
    if (template === undefined || template.comingSoon === true) return null
    const { scene } = template.createScene(zh[template.label])
    return buildWorkspaceRuntime(template.domain, scene)
  }, [props.experimentId, props.entryUrl, props.protocolVersion])
  if (runtime === null) return <p role="alert">这个实验暂时无法预览，请重新选择实验。</p>
  return <CandidateRuntimePreview key={`${props.experimentId}:${props.entryUrl}:${props.protocolVersion}`}
    {...props} runtime={runtime} />
}

function CandidateRuntimePreview({ runtime, ...props }: Props & { readonly runtime: WorkspaceRuntime }) {
  const { session, snapshot } = useExperimentSession(runtime)
  const previewView = useRef<HTMLElement>(null)
  useEffect(() => {
    // Browsers can suspend offscreen opaque renderers before their first draw.
    previewView.current?.scrollIntoView({ block: 'start' })
  }, [])
  const visibleLabels = new Map<string, string>()
  const visit = (nodes: readonly SceneTreeNode[]): (void) => {
    for (const node of nodes) {
      if (node.observable !== undefined) visibleLabels.set(node.observable, node.label)
      if (node.children !== undefined) visit(node.children)
    }
  }
  visit(snapshot.tree)
  return (
    <section ref={previewView} className={css.preview} aria-label="候选实验预览" data-experiment-id={props.experimentId}>
      <CommunityExperimentFrame
        entryUrl={props.entryUrl}
        experimentId={props.experimentId}
        session={session}
        protocolVersion={props.protocolVersion}
        title={props.protocolVersion === 3 ? `${snapshot.title} · 投稿预览` : '候选三维实验'}
        {...(props.onStatusChange === undefined ? {} : { onStatusChange: props.onStatusChange })}
      />
      <aside className={css.controls} aria-label="预览实验参数">
        <h4>{snapshot.title}</h4>
        {props.protocolVersion !== 3 && props.experimentId === 'convex-lens' ? (
          <LensControls snapshot={snapshot} preview={session.previewParameter}
            commit={session.commitParameter} cancel={session.cancelPreview} />
        ) : snapshot.inspector.map(section => (
          <fieldset key={section.id}>
            <legend>{section.title}</legend>
            {(section.parameters ?? []).map(parameter => (
              <ParameterEditor key={parameter.id} parameter={parameter} session={session} />
            ))}
            {(section.choices ?? []).map(choice => (
              <label key={choice.id}>{choice.label}
                <select value={choice.value} onChange={(event) => {
                  applyUniversalContributionIntent(session, { type: 'choice/set', protocolVersion: 3, id: choice.id, value: event.target.value })
                }}>
                  {choice.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            ))}
            {(section.derived ?? []).map(item => (
              <p className={css.reading} key={item.id}><span>{item.label}</span><output>{item.value} {item.unit}</output></p>
            ))}
          </fieldset>
        ))}
        <fieldset>
          <legend>显示内容</legend>
          {Object.entries(snapshot.view.visible).map(([key, enabled]) => typeof enabled === 'boolean' ? (
            <label className={css.visibility} key={key}>
              <input type="checkbox" checked={enabled} onChange={(event) => {
                applyUniversalContributionIntent(session, { type: 'observable/set', protocolVersion: 3, key, enabled: event.target.checked })
              }} />
              {visibleLabels.get(key) ?? translatedLabels[`lab.observable.${key}`] ?? key}
            </label>
          ) : null)}
        </fieldset>
        {snapshot.clock.total > 0 ? (
          <fieldset>
            <legend>实验播放</legend>
            <div className={css.playback}>
              <button type="button" disabled={snapshot.status === 'failed'} onClick={() => {
                applyUniversalContributionIntent(session, { type: 'playback/running', protocolVersion: 3, running: !snapshot.clock.running })
              }}>{snapshot.clock.running ? '暂停' : '播放'}</button>
              <button type="button" onClick={() => {
                applyUniversalContributionIntent(session, { type: 'playback/seek', protocolVersion: 3, time: 0 })
              }}>回到开始</button>
              <select aria-label="播放速度" value={snapshot.clock.rate} onChange={(event) => {
                applyUniversalContributionIntent(session, { type: 'playback/rate', protocolVersion: 3, rate: Number(event.target.value) })
              }}>
                {[0.25, 0.5, 1, 2].map(rate => <option value={rate} key={rate}>{rate}×</option>)}
              </select>
            </div>
            <input type="range" aria-label="实验时间" min={0} max={snapshot.clock.total}
              step={snapshot.clock.total / 1000} value={snapshot.clock.time} onChange={(event) => {
                applyUniversalContributionIntent(session, { type: 'playback/seek', protocolVersion: 3, time: Number(event.target.value) })
              }} />
          </fieldset>
        ) : null}
      </aside>
    </section>
  )
}

function ParameterEditor({ parameter, session }: { readonly parameter: QuantityParameter; readonly session: ExperimentSession }) {
  const [text, setText] = useState(String(parameter.value))
  const [invalid, setInvalid] = useState(false)
  const [rangeValue, setRangeValue] = useState(parameter.value)
  const pending = useRef<number | undefined>(undefined)
  useEffect(() => { setText(String(parameter.value)); setRangeValue(parameter.value); setInvalid(false) }, [parameter.value])
  const settle = (): (void) => {
    const value = Number(text)
    if (text.trim() === '' || !Number.isFinite(value) ||
      (parameter.min !== undefined && value < parameter.min) ||
      (parameter.max !== undefined && value > parameter.max)) { setInvalid(true); return }
    if (value !== parameter.value)
      applyUniversalContributionIntent(session, { type: 'parameter/commit', protocolVersion: 3, id: parameter.id, value })
  }
  const release = (): (void) => {
    if (pending.current === undefined) return
    const value = pending.current
    pending.current = undefined
    applyUniversalContributionIntent(session, { type: 'parameter/commit', protocolVersion: 3, id: parameter.id, value })
  }
  return (
    <div className={css.parameter}>
      <label>{parameter.label} {parameter.unit ? `(${parameter.unit})` : ''}
        <input type="number" value={text} min={parameter.min} max={parameter.max} step={parameter.step ?? 'any'}
          aria-invalid={invalid} onChange={(event) => { setText(event.target.value); setInvalid(false) }}
          onBlur={settle} onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') { session.cancelPreview(); setText(String(parameter.value)); setInvalid(false) }
          }} />
      </label>
      {parameter.min !== undefined && parameter.max !== undefined ? (
        <input type="range" aria-label={`调节${parameter.label}`} min={parameter.min} max={parameter.max}
          step={parameter.step ?? 'any'} value={rangeValue} onChange={(event) => {
            pending.current = Number(event.target.value)
            setRangeValue(pending.current)
            setText(String(pending.current))
            applyUniversalContributionIntent(session, { type: 'parameter/preview', protocolVersion: 3, id: parameter.id, value: pending.current })
          }} onPointerUp={release} onKeyUp={release} onBlur={release} onPointerCancel={() => {
            pending.current = undefined; session.cancelPreview()
          }} />
      ) : null}
      {invalid ? <span role="alert">请输入参数允许范围内的数值。</span> : null}
    </div>
  )
}
