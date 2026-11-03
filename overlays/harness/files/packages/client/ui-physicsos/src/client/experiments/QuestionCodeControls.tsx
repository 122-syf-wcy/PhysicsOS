import { useEffect, useRef, useState } from 'react'
import { zh } from '../locales.ts'
import type { QuantityParameter, SceneTreeNode } from '../physics/scene-visual-model.ts'
import type { WorkspaceSnapshot } from '../physics/workspace-runtime.ts'
import { applyUniversalContributionIntent } from './contribution-protocol.ts'
import type { ExperimentSession } from './experiment-session.ts'
import css from '../SceneChatCard.module.css'

/** Controls read the exact same inspector and frame channel the code renderer receives. */
export function QuestionCodeControls({ session, snapshot }: { session: ExperimentSession; snapshot: WorkspaceSnapshot }) {
  const labels = new Map<string, string>()
  const visit = (nodes: readonly SceneTreeNode[]): void => {
    for (const node of nodes) {
      if (node.observable !== undefined) labels.set(node.observable, node.label)
      if (node.children !== undefined) visit(node.children)
    }
  }
  visit(snapshot.tree)
  return <aside className={css.parameters} aria-label="本题实验参数">
    <h4>实验参数</h4>
    {snapshot.inspector.map(section => <fieldset key={section.id}>
      <legend>{section.title}</legend>
      {(section.parameters ?? []).map(parameter => <ParameterEditor key={parameter.id} parameter={parameter} session={session} />)}
      {(section.choices ?? []).map(choice => <label key={choice.id}>{choice.label}<select value={choice.value} onChange={(event) => {
        applyUniversalContributionIntent(session, { type: 'choice/set', protocolVersion: 3, id: choice.id, value: event.target.value })
      }}>{choice.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>)}
      {(section.derived ?? []).map(item => (
        <p className={css.reading} key={item.id}>
          <span>{item.label}</span><output>{item.value} {item.unit}</output>
        </p>
      ))}
    </fieldset>)}
    <details><summary>显示内容</summary>{Object.entries(snapshot.view.visible).map(([key, enabled]) => typeof enabled === 'boolean' ?
      <label className={css.visibility} key={key}><input type="checkbox" checked={enabled} onChange={(event) => {
        applyUniversalContributionIntent(session, { type: 'observable/set', protocolVersion: 3, key, enabled: event.target.checked })
      }} />{labels.get(key) ?? (zh as Partial<Record<string, string>>)[`lab.observable.${key}`] ?? key}</label> : null)}</details>
  </aside>
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
