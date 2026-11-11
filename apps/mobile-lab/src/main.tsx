import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { mountPhysicsOSChrome } from '@lab/client/chrome.ts'
import { catalog } from 'virtual:lab-catalog'
import { LabClient } from './runtime/client.ts'
import { LocalScenes, type SavedScene } from './runtime/local-scenes.ts'
import { NativeBridge } from './shared/native-bridge.ts'
import { NOTEBOOK_LIMIT } from '@lab/client/experiments/experiment-notebook.ts'
import { PANELS, readCheckpointEnvelope, type LabCheckpoint, type Panel } from './shared/checkpoint.ts'
import { LabError, MAX_FILE_BYTES, errorPayload, type ExportFile, type ExportFormat } from './shared/protocol.ts'
import { SceneStage } from './ui/SceneStage.tsx'
import { LensStage } from './ui/LensExperiment.tsx'
import { convexLensLesson } from './ui/lens-lesson.ts'
import { ApparatusPanel, DataPanel, GuidePanel, Parameters, ReportPanel } from './ui/Panels.tsx'
import { download, exportDrawing } from './ui/export-drawing.ts'
import './ui/mobile.css'
import 'katex/dist/katex.min.css'

mountPhysicsOSChrome()
const client = new LabClient()
const localScenes = new LocalScenes()
const theme = (dark: boolean) => {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
  window.dispatchEvent(new Event('lab-theme'))
}
theme(matchMedia('(prefers-color-scheme: dark)').matches)
const exportFile = async (format: ExportFormat): Promise<ExportFile> => format === 'png' || format === 'svg'
  ? exportDrawing(format, client.frames.getSnapshot()?.title ?? 'PhysicsOS') : client.query('export', { format })
const saveForNative = async (id?: string, generation = client.getSnapshot().generation): Promise<void> => {
  const checkpoint = await client.checkpoint()
  if (generation === client.getSnapshot().generation) bridge.emit('checkpoint', { checkpoint }, id, generation)
}
const bridge = new NativeBridge({ capabilities: ['experiments', 'all-shared-templates', 'worker', 'fixed-precision', 'touch', 'timeline', 'parameters', 'circuit-builder', 'undo-redo', 'checkpoint-v1', 'full-history', 'readouts', 'charts', 'verification', 'self-check', 'report', 'export-json', 'export-csv', 'export-observations', 'export-markdown', 'export-svg', 'export-png', 'theme', 'lifecycle'],
  onCommand: async command => {
    const generation = command.payload.generation
    switch (command.type) {
      case 'load': await client.load(command.payload, generation); break
      case 'lifecycle':
        await client.setActive(command.payload.active)
        if (!command.payload.active) await saveForNative(command.id, generation)
        break
      case 'theme': theme(command.payload.dark); break
      case 'checkpoint': await saveForNative(command.id, generation); break
      case 'export': bridge.export(await exportFile(command.payload.format), command.id, generation); break
      default: throw new LabError('LAB_COMMAND', '数学内容请使用独立的 document.html 入口。')
    }
  },
  onError: error => window.dispatchEvent(new CustomEvent('lab-error', { detail: errorPayload(error) })),
})
const publishSummary = () => {
  const snapshot = client.getSnapshot(), frame = snapshot.frame, summary = snapshot.summary
  if (!frame || !summary || snapshot.loading || snapshot.generation !== bridge.currentGeneration) return
  bridge.state({ sceneId: summary.sceneId, revision: frame.sceneRevision, title: frame.title, dirty: snapshot.dirty,
    running: frame.clock.running, time: frame.clock.time, duration: frame.clock.total,
    canUndo: summary.history.canUndo, canRedo: summary.history.canRedo }, snapshot.generation)
}
client.subscribe(publishSummary)
let savingLifecycle = false
const suspend = async () => {
  if (savingLifecycle || !client.getSnapshot().summary) return
  savingLifecycle = true
  try { await client.setActive(false); if (bridge.connected) await saveForNative() }
  catch (error) { bridge.error(error) }
  finally { savingLifecycle = false }
}
window.addEventListener('pagehide', () => { void suspend() })
window.addEventListener('pageshow', () => { if (!document.hidden) void client.setActive(true).catch(error => bridge.error(error)) })
document.addEventListener('visibilitychange', () => { if (document.hidden) void suspend(); else void client.setActive(true).catch(error => bridge.error(error)) })
if (__LAB_TEST__) window.__physicsLab = client
const panelTitle: Record<Panel, string> = { parameters: '参数与场景', apparatus: '器材与搭建', data: '读数与曲线', guide: '验证与自测', report: '观察与报告' }
const panelShort: Record<Panel, string> = { parameters: '参数', apparatus: '器材', data: '数据', guide: '验证', report: '报告' }
const domainTitle: Record<string, string> = { mechanics: '力学', electric: '电场', magnetic: '磁场', circuit: '电路', composite: '复合场', optics: '光学', acoustics: '声学', fluid: '流体', thermal: '热学', induction: '电磁感应', wave: '波动', modern: '近代物理' }

function App() {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot), frame = snapshot.frame, summary = snapshot.summary
  const [picker, setPicker] = useState(!bridge.connected)
  const [filter, setFilter] = useState(''), [domain, setDomain] = useState(''), [stage, setStage] = useState('')
  const [saved, setSaved] = useState<Omit<SavedScene, 'checkpoint'>[]>([])
  const [error, setError] = useState<{ code: string; message: string }>(), [notice, setNotice] = useState('')
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark')
  const [format, setFormat] = useState<ExportFormat>('json')
  const [busy, setBusy] = useState(false), [inspectorOpen, setInspectorOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const [seek, setSeek] = useState<number | undefined>()
  const generation = snapshot.generation
  useEffect(() => {
    const onError = (event: Event) => setError((event as CustomEvent<{ code: string; message: string }>).detail)
    const onTheme = () => setDark(document.documentElement.dataset.theme === 'dark')
    window.addEventListener('lab-error', onError); window.addEventListener('lab-theme', onTheme)
    return () => { window.removeEventListener('lab-error', onError); window.removeEventListener('lab-theme', onTheme) }
  }, [])
  useEffect(() => { setInspectorOpen(false); setError(undefined); setNotice(''); setSeek(undefined) }, [generation])
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(undefined)
    try { await action() }
    catch (error) { if (!(error instanceof LabError) || !['LOAD_REPLACED', 'DISPOSED'].includes(error.code)) setError(errorPayload(error)) }
    finally { setBusy(false) }
  }
  const load = async (payload: { templateId?: string; checkpoint?: LabCheckpoint; scene?: unknown }) => {
    if (snapshot.dirty && !confirm('当前实验有修改。请先保存或导出；仍要切换吗？')) return
    const gen = bridge.connected ? bridge.currentGeneration : crypto.randomUUID()
    if (!gen) throw new LabError('NATIVE_LOAD_REQUIRED', '请由原生实验目录先加载场景。')
    bridge.adoptGeneration(gen)
    await client.load(payload, gen); setPicker(false); setNotice(''); setSeek(undefined)
  }
  const act = (name: 'setRunning' | 'setRate' | 'step' | 'seek' | 'reset' | 'undo' | 'redo' | 'restoreOrigin', argument?: number | boolean) => {
    void run(() => (client.action as (name: string, ...args: unknown[]) => Promise<void>)(name, ...(argument === undefined ? [] : [argument])))
  }
  const changePanel = (panel: Panel) => {
    setInspectorOpen(panel !== snapshot.presentation.activePanel || !inspectorOpen)
    if (panel !== snapshot.presentation.activePanel) void run(() => client.setPresentation({ ...snapshot.presentation, activePanel: panel }))
  }
  const save = async () => {
    if (bridge.connected) { await saveForNative(); setNotice('完整检查点已交给原生存档，持久化结果由原生页面确认。') }
    else { await localScenes.save(await client.checkpoint()); setSaved(await localScenes.list()); setNotice('完整场景、来源、时间、视口及撤销重做历史已保存到此浏览器。') }
  }
  const visible = catalog.experiments.filter(item => (!domain || item.domain === domain) && (!stage || item.stage === stage) && `${item.title} ${item.subtitle} ${item.tags.join(' ')}`.includes(filter.trim()))
  const panel = snapshot.presentation.activePanel
  const lens = frame !== undefined && convexLensLesson(frame)
  const standaloneFiles = !bridge.connected && <><button data-testid="save-scene" onClick={() => void run(save)} disabled={busy}>保存场景</button><label>导出格式<select value={format} onChange={event => setFormat(event.currentTarget.value as ExportFormat)}><option value="json">完整 JSON</option><option value="csv">权威数据 CSV</option><option value="observations">多组观察记录 CSV</option><option value="markdown">实验报告 Markdown</option><option value="png">画布 PNG</option><option value="svg">画布 SVG</option></select></label><button data-testid="export-scene" disabled={busy} onClick={() => void run(async () => { download(await exportFile(format)); setNotice('导出已生成，请查看浏览器下载。') })}>导出 / 分享</button></>
  return <main className={`lab-app${bridge.connected ? ' native-host' : ''}`} data-testid="lab-app" data-generation={generation}>
    {!bridge.connected && <header className="lab-header">
      <div className="lab-brand"><img src="./assets/physicsos-brand.png" width="30" height="30" alt="" /><span>PhysicsOS</span></div>
      <div className="button-row"><button data-testid="open-catalog" onClick={() => setPicker(!picker)} aria-expanded={picker}>实验与场景</button><button aria-pressed={dark} onClick={() => theme(!dark)}>{dark ? '浅色界面' : '深色界面'}</button></div>
    </header>}
    {(error ?? snapshot.error) && <div className="error-banner" role="alert"><strong>{(error ?? snapshot.error)!.code}</strong><p>{(error ?? snapshot.error)!.message}</p><button onClick={() => { setError(undefined); client.clearError() }}>关闭错误</button>{!bridge.connected && <button onClick={() => setPicker(true)}>选择场景恢复</button>}</div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {picker && <section className="catalog-panel" aria-label="实验与场景目录"><h1>探索物理的每一种可能。</h1><p className="muted">从一个好奇开始，在真实实验里找到答案。</p>
      <div className="catalog-filters"><label>搜索<input type="search" value={filter} placeholder="实验名称、器材或标签" onChange={event => setFilter(event.currentTarget.value)} /></label><label>领域<select value={domain} onChange={event => setDomain(event.currentTarget.value)}><option value="">全部领域</option>{[...new Set(catalog.experiments.map(item => item.domain))].map(domain => <option value={domain} key={domain}>{domainTitle[domain] ?? domain}</option>)}</select></label><label>学段<select value={stage} onChange={event => setStage(event.currentTarget.value)}><option value="">全部学段</option><option value="junior">初中</option><option value="senior">高中</option></select></label></div>
      <p className="catalog-count">显示 {visible.length} / {catalog.experiments.length} 项本地实验</p>
      <div className="experiment-grid">{visible.map(item => <button key={item.id} className="experiment-card" data-template={item.id} disabled={busy || (bridge.connected && !generation)} onClick={() => void run(() => load({ templateId: item.id }))}><span>{domainTitle[item.domain] ?? item.domain} · {item.stage === 'junior' ? '初中' : '高中'}</span><strong>{item.title}</strong><small>{item.subtitle}</small><span className="card-arrow" aria-hidden="true">↗</span></button>)}</div>
      {visible.length === 0 && <p>没有匹配实验。请更改搜索或筛选。</p>}
      <div className="button-row"><button onClick={() => void run(() => load({ templateId: 'free-circuit' }))} disabled={busy || (bridge.connected && !generation)}>自由搭建电路</button><button onClick={() => input.current?.click()} disabled={busy}>导入 JSON</button>{!bridge.connected && <button onClick={() => void run(async () => setSaved(await localScenes.list()))}>读取本地存档</button>}</div>
      <input ref={input} type="file" accept="application/json,.json" hidden onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''
        if (!file) return
        void run(async () => { if (file.size > MAX_FILE_BYTES) throw new LabError('IMPORT_LIMIT', '导入超过 8 MiB，未截断历史。'); const data: unknown = JSON.parse(await file.text())
          if (data !== null && typeof data === 'object' && 'editing' in data) await load({ checkpoint: readCheckpointEnvelope(data) })
          else { if (!confirm('这是旧场景数据，不含播放位置、视口和撤销历史。将明确作为旧格式场景导入，继续吗？')) return; await load({ scene: data }); setNotice('已按旧场景格式导入；原文件未包含的历史无法恢复。') }
        })
      }} />
      {!bridge.connected && saved.length > 0 && <section><h3>此浏览器的存档</h3><p className="muted">安卓账户存档由原生层独立管理。</p>{saved.map(item => <div className="saved-scene" key={item.id}><span>{item.title} · {new Date(item.updatedAt).toLocaleString()}</span><button onClick={() => void run(async () => load({ checkpoint: await localScenes.get(item.id) }))}>恢复</button><button onClick={() => void run(async () => { if (confirm('删除此存档？')) { await localScenes.remove(item.id); setSaved(await localScenes.list()) } })}>删除存档</button></div>)}</section>}
    </section>}
    {snapshot.loading && <p role="status" className="loading">正在准备实验…</p>}
    {frame && summary && !snapshot.loading ? <div className="experiment-layout" data-inspector-open={inspectorOpen}>
      <section className="experiment-canvas" aria-label="实验画布与时间轴">
        {!bridge.connected && <div className="scene-heading"><div><span className="eyebrow">{domainTitle[frame.domain] ?? frame.domain}</span><h1>{frame.title}</h1></div><span className={`validation-dot ${frame.status}`} title={frame.status === 'verified' ? '引擎验证通过' : '请查看验证面板'} aria-label={frame.status === 'verified' ? '引擎验证通过' : '请查看验证面板'} /></div>}
        {lens ? <LensStage key={generation} frame={frame} client={client} />
          : <SceneStage key={generation} frame={frame} summary={summary} client={client} dark={dark} />}
        <section className="playback-panel" aria-label="实验操作">
          {lens ? <div className="playback-controls lens-actions"><button className="icon-control" aria-label="撤销透镜条件修改" disabled={!summary.history.canUndo || busy} onClick={() => act('undo')}>↶</button>
            <button className="primary play-control" disabled={busy || summary.previewing || frame.status === 'failed' || summary.notebook.length >= NOTEBOOK_LIMIT || frame.table.rows.length === 0}
              onClick={() => void run(() => client.action('recordObservation'))}>记录本次</button>
            <button className="icon-control" aria-label="重做透镜条件修改" disabled={!summary.history.canRedo || busy} onClick={() => act('redo')}>↷</button>
            <output className="playback-clock">{summary.notebook.length} 组<span>实验观察</span></output>
            {!bridge.connected && <details className="playback-more"><summary aria-label="更多实验文件选项">···</summary><div className="playback-options">{standaloneFiles}</div></details>}
          </div> : <div className="playback-controls"><button className="icon-control" data-testid="reset" aria-label="重置时间" onClick={() => act('reset')}>↺</button>
            <button className="primary play-control" data-testid="play-pause" onClick={() => act('setRunning', !frame.clock.running)}><span aria-hidden="true">{frame.clock.running ? 'Ⅱ' : '▶'}</span>{frame.clock.running ? '暂停' : '播放'}</button>
            <button className="icon-control" data-testid="step" aria-label="单步 1/60 s" onClick={() => act('step', 1 / 60)}>▷</button>
            <output className="playback-clock" data-testid="clock" aria-label={`实验时间 ${frame.clock.time.toFixed(3)} / ${frame.clock.total.toFixed(2)} s`}>{frame.clock.time.toFixed(3)} <span>/ {frame.clock.total.toFixed(2)} s</span></output>
            <details className="playback-more"><summary aria-label="更多播放选项">···</summary><div className="playback-options">
              <label>播放速率<select aria-label="播放速率" value={frame.clock.rate} onChange={event => act('setRate', Number(event.currentTarget.value))}>{[0.25, 0.5, 1, 2, 4].map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
              <div className="button-row"><button disabled={!summary.history.canUndo || busy} onClick={() => act('undo')}>撤销</button><button disabled={!summary.history.canRedo || busy} onClick={() => act('redo')}>重做</button></div>
              <button disabled={busy} onClick={() => { if (confirm('恢复来源场景的原始条件？')) act('restoreOrigin') }}>恢复原始条件</button>
              {standaloneFiles}
            </div></details>
          </div>}
          {!lens && <div className="timeline"><label className="sr-only" htmlFor="timeline">实验时间轴</label><input id="timeline" type="range" min="0" max={Math.max(0, frame.clock.total)} step="any" value={seek ?? frame.clock.time} disabled={!frame.clock.total} onChange={event => setSeek(event.currentTarget.valueAsNumber)} onPointerUp={() => { if (seek !== undefined) act('seek', seek); setSeek(undefined) }} onPointerCancel={() => setSeek(undefined)} onKeyUp={() => { if (seek !== undefined) act('seek', seek); setSeek(undefined) }} />
            {frame.events.length > 0 && <div className="event-list" aria-label="物理事件">{frame.events.map(event => <button key={event.id} onClick={() => act('seek', event.time)}>{event.label} · {event.time.toPrecision(4)} s</button>)}</div>}
          </div>}
          <p className="sr-only" data-testid="runtime-status">{domainTitle[frame.domain] ?? frame.domain} · {({ verified: '引擎验证通过', warning: '请查看验证提示', failed: '模型未通过，请调整条件' })[frame.status]} · 场景版本 {frame.sceneRevision}</p>
        </section>
      </section>
      <aside className="inspector" data-open={inspectorOpen}>
        <nav className="panel-tabs" aria-label="实验面板">{PANELS.map(item => <button key={item} aria-label={panelTitle[item]} aria-pressed={panel === item && inspectorOpen} aria-expanded={panel === item && inspectorOpen} aria-controls="inspector-content" onClick={() => changePanel(item)}>{panelShort[item]}<span aria-hidden="true" className="panel-indicator" /></button>)}</nav>
        {inspectorOpen && <section className="panel-content" id="inspector-content" key={`${generation}:${panel}`} aria-label={panelTitle[panel]}><div className="panel-heading"><h2>{panelTitle[panel]}</h2><button className="icon-control" onClick={() => setInspectorOpen(false)} aria-label="收起面板">⌄</button></div>
          {panel === 'parameters' && <Parameters frame={frame} summary={summary} client={client} />}{panel === 'apparatus' && <ApparatusPanel frame={frame} summary={summary} client={client} />}{panel === 'data' && <DataPanel key={frame.sceneRevision} frame={frame} summary={summary} client={client} />}{panel === 'guide' && <GuidePanel frame={frame} />}{panel === 'report' && <ReportPanel frame={frame} summary={summary} client={client} />}
        </section>}
      </aside>
    </div> : !snapshot.loading && !picker && <section className="waiting"><h2>等待载入实验</h2><p>请从应用的实验目录打开。</p></section>}
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
