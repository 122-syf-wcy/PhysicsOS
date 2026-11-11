import { useEffect, useRef, useState } from 'react'
import { BUILDER_PARTS } from '@lab/physics/circuit-builder.ts'
import type { BuilderComponent, TerminalRef } from '@lab/physics/circuit-builder.ts'
import { experimentSelfChecksOf } from '@lab/physics/experiment-self-checks.ts'
import { physicsAgentContext } from '@lab/physics/physics-agent.ts'
import type { QuantityParameter, SceneTreeNode } from '@lab/physics/scene-visual-model.ts'
import type { WorkspaceFrame } from '@lab/physics/workspace-runtime.ts'
import type { LabClient } from '../runtime/client.ts'
import type { WireSummary } from '../runtime/transport.ts'
import { renderMarkdown, renderMath } from '../document/markdown.ts'
import { Curve } from './Curve.tsx'
import { LensLesson } from './LensExperiment.tsx'
import { convexLensLesson } from './lens-lesson.ts'
import { notebookTable, NOTEBOOK_LIMIT } from '@lab/client/experiments/experiment-notebook.ts'

export function Markdown({ source, math = false }: { source: string; math?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => { host.current?.replaceChildren(math ? renderMath(source, true) : renderMarkdown(source)) }, [source, math])
  return <div ref={host} className="markdown" />
}
export function Parameter({ parameter: p, client }: { parameter: QuantityParameter; client: LabClient }) {
  const [value, setValue] = useState(String(p.value))
  const [invalid, setInvalid] = useState(false)
  const editing = useRef(false)
  useEffect(() => { if (!editing.current) { setValue(String(p.value)); setInvalid(false) } }, [p.value])
  const number = Number(value)
  const valid = value.trim() !== '' && Number.isFinite(number) && (p.min === undefined || number >= p.min) && (p.max === undefined || number <= p.max)
  const commit = () => {
    editing.current = false
    if (!valid) { setInvalid(true); return }
    setInvalid(false)
    void client.action('commitParameter', p.id, number).catch(() => undefined)
  }
  const cancel = () => { editing.current = false; setValue(String(p.value)); setInvalid(false); void client.action('cancelParameterPreview').catch(() => undefined) }
  const description = `p-value-${p.id}`
  return <div className="parameter"><label htmlFor={`p-${p.id}`}>{p.label} <span>{p.symbol} / {p.unit}</span>
      <output id={description} className="parameter-value">{(valid ? number : p.value).toPrecision(8)} {p.unit}</output></label>
    <input id={`p-${p.id}`} type="number" value={value} min={p.min} max={p.max} step={p.step ?? 'any'} aria-invalid={invalid} aria-describedby={description}
      onFocus={() => { editing.current = true }} onChange={event => { editing.current = true; setValue(event.currentTarget.value); setInvalid(false) }}
      onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') cancel() }} />
    {invalid && <p className="parameter-error" role="alert">请输入有效数值{p.min === undefined ? '' : `，不小于 ${p.min}`}{p.max === undefined ? '' : `，不大于 ${p.max}`}。未修改实验条件。</p>}
    {p.min !== undefined && p.max !== undefined && <input type="range" aria-label={`${p.label}滑块`} min={p.min} max={p.max} step={p.step ?? 'any'} value={valid ? number : p.value}
      onChange={event => { editing.current = true; const next = event.currentTarget.valueAsNumber; setValue(String(next)); setInvalid(false); void client.action('previewParameter', p.id, next).catch(() => undefined) }}
      onPointerUp={commit} onPointerCancel={cancel}
      onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commit() }} onBlur={() => { if (editing.current) commit() }} />}
  </div>
}
function Tree({ nodes, frame, client }: { nodes: readonly SceneTreeNode[]; frame: WorkspaceFrame; client: LabClient }) {
  return <ul className="scene-tree">{nodes.map(node => <li key={node.id}>
    {node.observable ? <label><input type="checkbox" checked={frame.view.visible[node.observable] === true} onChange={event => void client.action('setObservable', node.observable!, event.currentTarget.checked).catch(() => undefined)} />{node.label}</label>
      : node.kind === 'object' ? <button aria-pressed={frame.view.highlighted?.includes(node.id) === true} onClick={() => void client.action('setHighlight', [node.id]).catch(() => undefined)}>{node.label}</button> : <strong>{node.label}</strong>}
    {node.secondary && <small>{node.secondary}</small>}
    {node.children && <Tree nodes={node.children} frame={frame} client={client} />}
  </li>)}</ul>
}
export function Parameters({ frame, client, summary }: { frame: WorkspaceFrame; client: LabClient; summary: WireSummary }) {
  return <>{convexLensLesson(frame) && <LensLesson frame={frame} summary={summary} client={client} />}
    <p className="muted">参数改变由同一共享引擎重新计算并验证；滑动预览松手后只提交一项历史。</p>
    {frame.inspector.map(section => <section key={section.id} className="panel-section"><h3>{section.title}</h3>
      {section.parameters?.map(parameter => <Parameter key={parameter.id} parameter={parameter} client={client} />)}
      {section.choices?.map(choice => <label className="field" key={choice.id}>{choice.label}<select value={choice.value} onChange={event => void client.action('setChoice', choice.id, event.currentTarget.value).catch(() => undefined)}>{choice.options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>)}
      {section.derived && <dl className="readings">{section.derived.map((row, index) => <div key={index}><dt>{row.label} {row.symbol}</dt><dd>{row.value} {row.unit}</dd></div>)}</dl>}
    </section>)}
    <section className="panel-section"><h3>场景与可观察量</h3><Tree nodes={frame.tree} frame={frame} client={client} /></section>
  </>
}
const partName: Record<string, string> = { 'battery-1.5': '1.5 V 电池', 'battery-6': '6 V 电池组', 'supply-12': '12 V 电源', switch: '开关', 'resistor-5': '5 Ω 电阻', 'resistor-10': '10 Ω 电阻', 'resistor-20': '20 Ω 电阻', 'resistor-50': '50 Ω 电阻', 'rheostat-20': '20 Ω 滑动变阻器', 'rheostat-50': '50 Ω 滑动变阻器', ammeter: '电流表', voltmeter: '电压表' }
function ComponentEditor({ component, client, summary }: { component: BuilderComponent; client: LabClient; summary: WireSummary }) {
  const [from, setFrom] = useState(Object.keys(component.nets)[0] ?? '')
  const [target, setTarget] = useState('')
  const act = (name: 'rotateComponent' | 'removeComponent' | 'editBuilderComponent', command?: 'duplicate') => {
    if (name === 'editBuilderComponent') void client.action(name, component.id, command!).catch(() => undefined)
    else void client.action(name, component.id).catch(() => undefined)
  }
  const targets = summary.draft?.components.flatMap(item => Object.keys(item.nets).map(terminalKey => ({ componentId: item.id, terminalKey }))) ?? []
  return <section className="panel-section component-editor"><h3>编辑 {component.id}</h3>
    <div className="button-row"><button onClick={() => act('rotateComponent')}>旋转 90°</button><button onClick={() => act('editBuilderComponent', 'duplicate')}>复制器材</button><button onClick={() => act('removeComponent')}>移除器材</button></div>
    <div className="button-row" aria-label="移动器材">{[['左', -0.5, 0], ['右', 0.5, 0], ['上', 0, 0.5], ['下', 0, -0.5]].map(([label, x, y]) => <button key={label} onClick={() => void client.action('moveComponent', component.id, { x: component.placement.x + Number(x), y: component.placement.y + Number(y) }).catch(() => undefined)}>{label}移</button>)}</div>
    {Object.entries(component.params).map(([key, value]) => key === 'state'
      ? <label className="field" key={key}>开关状态<select value={String(value)} onChange={event => void client.action('setSwitchState', component.id, event.currentTarget.value as 'open' | 'closed').catch(() => undefined)}><option value="closed">闭合</option><option value="open">断开</option></select></label>
      : <label className="field" key={key}>{({ resistance: '电阻 / Ω', voltage: '电压 / V', internalResistance: '内阻 / Ω', totalResistance: '最大电阻 / Ω', sliderPosition: '滑片位置 0–1' } as Record<string, string>)[key] ?? key}<input type="number" defaultValue={String(value)} key={`${component.id}:${key}:${value}`} step="any" onBlur={event => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) void client.action('setComponentParams', component.id, { [key]: value }).catch(() => undefined) }} /></label>)}
    <p>画布端子可点击或拖动接线。也可用以下可访问控件连接/断开同一真实端子。</p>
    <label className="field">本器材端子<select value={from} onChange={event => setFrom(event.currentTarget.value)}>{Object.entries(component.nets).map(([key, net]) => <option key={key} value={key}>{key} · 网络 {net}</option>)}</select></label>
    <label className="field">连接目标<select value={target} onChange={event => setTarget(event.currentTarget.value)}><option value="">选择目标端子</option>{targets.filter(ref => ref.componentId !== component.id).map(ref => <option key={`${ref.componentId}:${ref.terminalKey}`} value={JSON.stringify(ref)}>{ref.componentId} / {ref.terminalKey}</option>)}</select></label>
    <div className="button-row"><button disabled={!target} onClick={() => void client.action('connectTerminals', { componentId: component.id, terminalKey: from }, JSON.parse(target) as TerminalRef).catch(() => undefined)}>连接端子</button><button onClick={() => void client.action('disconnectTerminal', { componentId: component.id, terminalKey: from }).catch(() => undefined)}>断开此端子</button></div>
  </section>
}
export function ApparatusPanel({ frame, summary, client }: { frame: WorkspaceFrame; summary: WireSummary; client: LabClient }) {
  const selected = summary.draft?.components.find(component => frame.view.highlighted?.includes(component.id))
  return <><p>直接点击器材可选择，拖动可移动；画布支持双指缩放和平移。</p>
    {summary.capabilities.construct ? <><button className="primary" onClick={() => void client.action(summary.buildMode === 'construct' ? 'leaveBuilder' : 'enterBuilder').catch(() => undefined)}>{summary.buildMode === 'construct' ? '完成搭建，保留电路' : '进入自由搭建'}</button>
      {summary.buildMode === 'construct' && <><h3>器材架</h3><div className="parts-shelf">{BUILDER_PARTS.map(part => <button key={part.id} data-part={part.id} onClick={() => void client.action('addPart', part.id, { x: 0, y: 2 }).catch(() => undefined)}>{partName[part.id] ?? part.id}</button>)}</div>
        {summary.pendingWire && <p role="status">待接线 {summary.pendingWire.componentId} / {summary.pendingWire.terminalKey} <button onClick={() => void client.action('cancelWire').catch(() => undefined)}>取消接线</button></p>}
        <label className="field">选择器材<select value={selected?.id ?? ''} onChange={event => void client.action('setHighlight', event.currentTarget.value ? [event.currentTarget.value] : []).catch(() => undefined)}><option value="">选择以编辑</option>{summary.draft?.components.map(component => <option key={component.id} value={component.id}>{component.id} · {component.type}</option>)}</select></label>
        {selected && <ComponentEditor key={selected.id} component={selected} summary={summary} client={client} />}</>}
    </> : <p>此实验使用共享目录定义的专用器材。可在参数和场景树中调整已有模型；共享引擎没有定义任意器材拼装，不伪造额外物理能力。自由电路入口提供完整接线搭建。</p>}
    <h3>编辑历史</h3><ol>{summary.history.past.map(item => <li key={item.id}>{item.label}</li>)}</ol>
  </>
}
export function DataPanel({ frame, client, summary }: { frame: WorkspaceFrame; client: LabClient; summary: WireSummary }) {
  const [table, setTable] = useState<{ columns: readonly string[]; rows: WorkspaceFrame['table']['rows']; start: number; total: number }>()
  const [error, setError] = useState('')
  const load = async (start: number) => { try { setTable(await client.query('table', { start })); setError('') } catch (error) { setError(String(error)) } }
  return <><ObservationComparison frame={frame} summary={summary} client={client} />
    <p className="muted">显示曲线采样有界，物理计算精度不变。完整数据可分页读取，CSV 导出不会使用显示降采样。</p>{frame.charts.map(chart => <Curve key={`${frame.sceneRevision}:${chart.id}`} chart={chart} client={client} />)}
    <h3>实验数据表</h3><button onClick={() => void load(0)}>读取完整数据表</button>{error && <p role="alert">{error}</p>}
    <div className="table-scroll"><table><caption>{table ? `第 ${table.start + 1}–${table.start + table.rows.length} / ${table.total} 行` : '显示样本（点击读取完整数据表查看全部行）'}</caption><thead><tr><th>步</th>{(table?.columns ?? frame.table.columns).map((column, index) => <th key={index}>{column}</th>)}</tr></thead><tbody>{(table?.rows ?? frame.table.rows).map((row, index) => <tr key={index}><td>{row.step}</td>{row.values.map((value, index) => <td key={index}>{value}</td>)}</tr>)}</tbody></table></div>
    {table && <div className="button-row"><button disabled={!table.start} onClick={() => void load(Math.max(0, table.start - 200))}>上一页</button><button disabled={table.start + table.rows.length >= table.total} onClick={() => void load(table.start + 200)}>下一页</button></div>}
  </>
}
function ObservationComparison({ frame, summary, client }: { frame: WorkspaceFrame; summary: WireSummary; client: LabClient }) {
  const table = notebookTable(summary.notebook)
  return <section className="observation-comparison" aria-label="多组实验观察对照">
    <div className="panel-heading"><h3>我的实验记录</h3><button data-testid="record-comparison" disabled={summary.previewing || frame.status === 'failed' || summary.notebook.length >= NOTEBOOK_LIMIT || frame.table.rows.length === 0}
      onClick={() => void client.action('recordObservation').catch(() => undefined)}>记录本次</button></div>
    <p className="muted">每组保留记录时的参数、场景修订和引擎读数，随完整 JSON 与报告一同保存。设备观察记录不代表服务器权威评分。</p>
    {frame.table.rows.length === 0 && <p>当前场景没有可记录的读数行，因此不能生成观察记录；没有伪造数据。</p>}
    {summary.notebook.length === 0 ? <p>先调整实验条件，再记录几组数据，观察它们怎样变化。</p> : <div className="table-scroll"><table data-testid="observation-table"><caption>共 {summary.notebook.length} 组记录；左右滑动查看全部列</caption><thead><tr>{table.columns.map(column => <th key={column} scope="col">{column}</th>)}<th scope="col">操作</th></tr></thead><tbody>{table.rows.map((row, index) => {
      const entry = summary.notebook[index]!
      return <tr key={entry.id}>{row.values.map((value, cell) => <td key={cell}>{value}</td>)}<td><button aria-label={`删除第 ${index + 1} 组观察`} onClick={() => { if (confirm('删除这组观察？可通过撤销恢复。')) void client.action('removeObservation', entry.id).catch(() => undefined) }}>删除</button></td></tr>
    })}</tbody></table></div>}
    {summary.notebook.length >= NOTEBOOK_LIMIT && <p role="status">已达到 100 组记录上限，请先导出或删除不需要的记录。</p>}
  </section>
}
function SelfCheck({ frame }: { frame: WorkspaceFrame }) {
  const set = experimentSelfChecksOf(physicsAgentContext(frame))
  const [answers, setAnswers] = useState<Record<string, string>>({})
  if (!set) return <p>共享题库未为当前模型定义自测题。下方验证仍使用真实引擎检查，不会生成假题或假评分。</p>
  return <section className="self-check"><h3>实验自测 · {set.topic}</h3>{set.items.map(item => {
    const chosen = item.options.find(option => option.id === answers[item.id])
    return <fieldset key={item.id}><legend>{item.prompt}</legend>{item.options.map(option => <label key={option.id}><input type="radio" name={item.id} checked={answers[item.id] === option.id} onChange={() => setAnswers({ ...answers, [item.id]: option.id })} />{option.label}</label>)}{chosen && <p className={chosen.correct ? 'status-passed' : 'status-warning'} role="status">{chosen.correct ? '回答正确' : '再想一想'} · {chosen.correct ? item.takeaway : chosen.mistake?.explanation ?? item.takeaway}</p>}</fieldset>
  })}</section>
}
export function GuidePanel({ frame }: { frame: WorkspaceFrame }) {
  return <><h3>共享引擎验证</h3><ul className="verification">{frame.verification.map(check => <li key={check.id} className={`status-${check.status}`}><strong>{({ passed: '通过', warning: '提示', failed: '失败' })[check.status]} · {check.label}</strong>{check.detail && <p>{check.detail}</p>}</li>)}</ul>
    {frame.error && <section role="alert"><h3>{frame.error.code}</h3><p>{frame.error.message}</p>{frame.error.recognized?.map(row => <p key={row.label}>{row.label} {row.value}</p>)}</section>}
    <h3>推导与结论</h3>{frame.derivation.map(step => <section key={step.id} className="panel-section"><h4>{step.title}</h4><Markdown source={step.expression} math />{step.detail && <p>{step.detail}</p>}{step.result && <p>{step.result.symbol} = {step.result.value} {step.result.unit}</p>}</section>)}
    <SelfCheck key={`${frame.domain}:${frame.title}`} frame={frame} />
  </>
}
export function ReportPanel({ frame, summary, client }: { frame: WorkspaceFrame; summary: WireSummary; client: LabClient }) {
  const [report, setReport] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { let live = true; void client.query<{ markdown: string }>('report').then(result => { if (live) setReport(result.markdown) }).catch(error => { if (live) setError(String(error)) }); return () => { live = false } }, [client, frame.sceneRevision, summary.notebook])
  return <><div className="button-row"><button onClick={() => void client.action('recordObservation').catch(() => undefined)}>记录此刻观察</button><button onClick={() => void client.query<{ markdown: string }>('report').then(result => setReport(result.markdown)).catch(error => setError(String(error)))}>刷新报告</button></div>
    <p>{summary.notebook.length} 条真实观察；报告包含场景、参数、数据、验证与记录时间。使用顶部导出保存 Markdown / CSV / 完整 JSON。</p>
    {summary.notebook.map((item, index) => <div key={item.id} className="button-row"><span>观察 {index + 1}</span><button onClick={() => void client.action('removeObservation', item.id).catch(() => undefined)}>删除此观察</button></div>)}
    {error && <p role="alert">{error}</p>}<Markdown source={report} />
  </>
}
