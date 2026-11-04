import { useEffect, useRef, useState } from 'react'
import { zh } from '../locales.ts'
import { GlassSelect } from '../GlassSelect.tsx'
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
  return <section className={css.parameters} aria-label="本题实验参数" data-question-code-controls>
    <div className={css.controlsHead}>
      <h4>实验条件</h4>
      <button type="button" className={css.restore} disabled={snapshot.branch?.canRestore !== true || session.runtime.restoreOrigin === undefined}
        onClick={() => {
          const restored = session.runtime.restoreOrigin?.()
          if (restored !== undefined) session.commit(restored)
        }}>恢复原题</button>
    </div>
    <details className={css.conditions} open><summary>调整条件<span>探索变化，保留原题</span></summary>
      <div className={css.conditionGroups}>{snapshot.inspector.map(section =>
        (section.parameters?.length ?? 0) + (section.choices?.length ?? 0) > 0 ?
          <fieldset key={section.id}><legend>{section.title}</legend><div className={css.parameterGrid}>
            {(section.parameters ?? []).map(parameter => <ParameterEditor key={parameter.id} parameter={parameter} session={session} />)}
            {(section.choices ?? []).map(choice => <div className={css.choice} key={choice.id}><span>{choice.label}</span>
              <GlassSelect value={choice.value} options={choice.options} ariaLabel={choice.label} onChange={(value) => {
                applyUniversalContributionIntent(session, { type: 'choice/set', protocolVersion: 3, id: choice.id, value })
              }} />
            </div>)}
          </div></fieldset> : null)}</div>
    </details>
    {snapshot.inspector.some(section => (section.derived?.length ?? 0) > 0) ? <div className={css.readings} aria-label="实验读数">
      {snapshot.inspector.flatMap(section => (section.derived ?? []).map(item => <div className={css.reading} key={`${section.id}:${item.id}`}>
        <span>{item.label}</span><output>{item.value}<small>{item.unit}</small></output>
      </div>))}
    </div> : null}
    <details className={css.displayOptions}><summary>显示内容</summary><div className={css.visibilityOptions}>{Object.entries(snapshot.view.visible).map(([key, enabled]) => typeof enabled === 'boolean' ?
      <label className={css.visibility} key={key}><input type="checkbox" checked={enabled} onChange={(event) => {
        applyUniversalContributionIntent(session, { type: 'observable/set', protocolVersion: 3, key, enabled: event.target.checked })
      }} /><span>{labels.get(key) ?? (zh as Partial<Record<string, string>>)[`lab.observable.${key}`] ?? key}</span></label> : null)}</div></details>
  </section>
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
