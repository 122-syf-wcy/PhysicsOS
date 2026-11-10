import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { applyScenePatch, diffScene, type JsonObject, type WhiteboardHistory, type WhiteboardScene } from '@physicsos/physics-whiteboard'
import type { WhiteboardKey } from './locales.ts'
import { inkElementPoints, readInkSamples, type InkSample } from './ink.ts'
import { elementBounds, hitElement, numeric, sceneBounds } from './editor-model.ts'
import { WhiteboardElements } from './Elements.tsx'
import css from './Whiteboard.module.css'
export interface NativeEditorProps { readonly documentId: string; readonly scene: WhiteboardScene; readonly history: WhiteboardHistory; readonly onUndo: () => void; readonly onRedo: () => void; readonly onChange: (scene: WhiteboardScene) => void; readonly images: Readonly<Record<string, string>>; readonly t: (key: WhiteboardKey) => string; readonly revealId?: string | undefined; readonly clearRequest: number; readonly onSave: () => void }
type Tool = 'select' | 'freedraw' | 'eraser' | 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'text' | 'pan'
const tools: readonly { id: Tool; symbol: string }[] = [{ id: 'select', symbol: '↖' }, { id: 'freedraw', symbol: '✎' }, { id: 'eraser', symbol: '⌫' }, { id: 'line', symbol: '╱' }, { id: 'arrow', symbol: '↗' }, { id: 'rectangle', symbol: '▭' }, { id: 'ellipse', symbol: '○' }, { id: 'text', symbol: 'T' }, { id: 'pan', symbol: '✥' }]
interface Gesture { readonly pointerId: number; readonly tool: Tool; readonly before: WhiteboardScene; readonly start: InkSample; readonly elementId: string; readonly selected: readonly string[]; readonly mouse: boolean; samples: InkSample[]; scene: WhiteboardScene }
export function NativeEditor({ scene, history, onUndo, onRedo, onChange, images, t, revealId, clearRequest, onSave }: NativeEditorProps) {
  const svg = useRef<SVGSVGElement>(null)
  const current = useRef(scene); current.current = scene
  const gesture = useRef<Gesture | undefined>()
  const [tool, setTool] = useState<Tool>('freedraw')
  const [color, setColor] = useState('#1e293b')
  const [width, setWidth] = useState(3)
  const [selection, setSelection] = useState<readonly string[]>([])
  const [draft, setDraft] = useState<WhiteboardScene | undefined>()
  const [text, setText] = useState<{ id: string; x: number; y: number; value: string; before: WhiteboardScene } | undefined>()
  const [view, setView] = useState(() => ({ x: numeric(scene.appState, 'scrollX'), y: numeric(scene.appState, 'scrollY'), zoom: typeof scene.appState.zoom === 'object' && scene.appState.zoom !== null && !Array.isArray(scene.appState.zoom) ? numeric(scene.appState.zoom as JsonObject, 'value', 1) : 1 }))
  const viewRef = useRef(view); viewRef.current = view
  const commit = (next: WhiteboardScene, before = current.current) => {
    if (JSON.stringify(before) === JSON.stringify(next)) return
    const change = diffScene(before, next)
    const merged = applyScenePatch(current.current, change.forward)
    current.current = merged; onChange(merged)
  }
  const undo = (redo = false) => { setSelection([]); if (redo) onRedo(); else onUndo() }
  const previousClear = useRef(clearRequest)
  useEffect(() => { if (clearRequest !== previousClear.current) { previousClear.current = clearRequest; commit({ ...current.current, elements: [] }); setSelection([]) } }, [clearRequest])
  useEffect(() => { if (revealId) fit() }, [revealId])
  const samples = (event: ReactPointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect(); const viewport = viewRef.current
    return readInkSamples(event.nativeEvent, { offsetLeft: bounds.left, offsetTop: bounds.top, scrollX: viewport.x, scrollY: viewport.y, zoom: { value: viewport.zoom } })
  }
  const finishText = () => {
    if (!text) return
    const latest = current.current
    const existing = latest.elements.find(element => element.id === text.id)
    const element: JsonObject = { ...(existing ?? {}), id: text.id, type: 'text', x: text.x, y: text.y, text: text.value, fontSize: existing?.fontSize ?? 28, strokeColor: existing?.strokeColor ?? color }
    const next = { ...latest, elements: existing ? latest.elements.map(item => item.id === text.id ? element : item) : [...latest.elements, element] }
    if (text.value.trim()) commit(next)
    setText(undefined); svg.current?.focus()
  }
  const editText = (element: JsonObject) => { setText({ id: String(element.id), x: numeric(element, 'x'), y: numeric(element, 'y'), value: String(element.text ?? ''), before: current.current }); setSelection([String(element.id)]) }
  const down = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (gesture.current || (event.button !== 0 && event.button !== 1 && event.button !== 5)) return
    finishText(); event.currentTarget.focus(); event.preventDefault()
    const captured = samples(event); const first = captured[0]; if (!first) return
    const activeTool = event.button === 1 ? 'pan' : event.button === 5 || event.buttons === 32 ? 'eraser' : tool
    const element = hitElement(current.current.elements, first.x, first.y, 7 / view.zoom)
    if (activeTool === 'text') {
      if (element?.type === 'text') editText(element)
      else setText({ id: crypto.randomUUID(), x: first.x, y: first.y, value: '', before: current.current })
      return
    }
    let selected = selection
    if (activeTool === 'select') { selected = element ? event.shiftKey ? [...new Set([...selection, String(element.id)])] : selection.includes(String(element.id)) ? selection : [String(element.id)] : []; setSelection(selected) }
    else setSelection([])
    event.currentTarget.setPointerCapture(event.pointerId)
    const g: Gesture = { pointerId: event.pointerId, tool: activeTool, before: current.current, start: first, samples: [...captured], elementId: crypto.randomUUID(), selected, mouse: event.pointerType !== 'pen', scene: current.current }
    gesture.current = g; updateGesture(g, first)
  }
  const updateGesture = (g: Gesture, last: InkSample) => {
    if (g.tool === 'pan') return
    const dx = last.x - g.start.x; const dy = last.y - g.start.y
    let elements = g.before.elements
    if (g.tool === 'select') elements = elements.map(element => g.selected.includes(String(element.id)) ? { ...element, x: numeric(element, 'x') + dx, y: numeric(element, 'y') + dy } : element)
    else if (g.tool === 'eraser') {
      const hit = hitElement(g.scene.elements, last.x, last.y, 12 / view.zoom)
      elements = hit ? g.scene.elements.filter(element => element.id !== hit.id) : g.scene.elements
    } else {
      let shape: JsonObject = { id: g.elementId, type: g.tool, x: g.start.x, y: g.start.y, strokeColor: color, strokeWidth: width, backgroundColor: 'transparent' }
      if (g.tool === 'freedraw') shape = { ...shape, ...inkElementPoints(g.samples, g.start), simulatePressure: g.mouse, customData: { physicsosInk: { samples: g.samples.map(sample => ({ ...sample })) } } }
      else if (g.tool === 'line' || g.tool === 'arrow') shape = { ...shape, points: [[0, 0], [dx, dy]], width: Math.abs(dx), height: Math.abs(dy), ...(g.tool === 'arrow' ? { endArrowhead: 'arrow' } : {}) }
      else shape = { ...shape, x: Math.min(g.start.x, last.x), y: Math.min(g.start.y, last.y), width: Math.abs(dx), height: Math.abs(dy) }
      elements = [...elements, shape]
    }
    g.scene = { ...g.before, elements }; setDraft(g.scene)
  }
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current; if (!g || g.pointerId !== event.pointerId) return
    if (g.tool === 'pan') { setView(previous => ({ ...previous, x: previous.x + event.movementX / previous.zoom, y: previous.y + event.movementY / previous.zoom })); return }
    const captured = samples(event); g.samples.push(...captured)
    if (g.tool === 'eraser') for (const sample of captured) updateGesture(g, sample)
    else if (captured.at(-1)) updateGesture(g, captured.at(-1)!)
  }
  const up = (event: ReactPointerEvent<SVGSVGElement>, cancelled = false) => {
    const g = gesture.current; if (!g || g.pointerId !== event.pointerId) return
    if (!cancelled) move(event)
    gesture.current = undefined; setDraft(undefined)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!cancelled && g.tool !== 'pan') commit(g.scene, g.before)
    if (g.tool === 'pan') storeView(viewRef.current)
  }
  const storeView = (next: typeof view) => {
    setView(next)
    const updated = { ...current.current, appState: { ...current.current.appState, scrollX: next.x, scrollY: next.y, zoom: { value: next.zoom } } }
    current.current = updated; onChange(updated)
  }
  const zoom = (factor: number) => {
    const bounds = svg.current?.getBoundingClientRect(); const previous = viewRef.current
    const nextZoom = Math.max(.1, Math.min(8, previous.zoom * factor))
    const x = (bounds?.width ?? 800) / 2; const y = (bounds?.height ?? 600) / 2
    storeView({ zoom: nextZoom, x: previous.x + x / nextZoom - x / previous.zoom, y: previous.y + y / nextZoom - y / previous.zoom })
  }
  function fit() {
    const box = sceneBounds(current.current); const rect = svg.current?.getBoundingClientRect()
    if (!rect?.width || !rect.height) return
    const nextZoom = Math.max(.1, Math.min(2, (rect.width - 64) / box.width, (rect.height - 64) / box.height))
    storeView({ x: -box.x + (rect.width / nextZoom - box.width) / 2, y: -box.y + (rect.height / nextZoom - box.height) / 2, zoom: nextZoom })
  }
  const remove = () => { commit({ ...current.current, elements: current.current.elements.filter(element => !selection.includes(String(element.id))) }); setSelection([]) }
  const selected = scene.elements.find(element => selection.includes(String(element.id)))
  const styleSelected = (key: string, value: string | number) => { if (selection.length) commit({ ...current.current, elements: current.current.elements.map(element => selection.includes(String(element.id)) ? { ...element, [key]: value } : element) }) }
  const displayed = draft ?? scene
  return <div className={css.editor} data-history-revision={history.undo.length + history.redo.length}>
    <div className={css.tools} role="toolbar" aria-label={t('whiteboard.canvasLabel')}>
      {tools.map(item => <button key={item.id} type="button" data-testid={`toolbar-${item.id}`} aria-label={t(`whiteboard.${item.id}`)} title={t(`whiteboard.${item.id}`)} aria-pressed={tool === item.id} onClick={() => { finishText(); setTool(item.id) }}><span aria-hidden="true">{item.symbol}</span><span className={css.toolName}>{t(`whiteboard.${item.id}`)}</span></button>)}
      <span className={css.divider} />
      <label title={t('whiteboard.color')}><input type="color" value={color} aria-label={t('whiteboard.color')} onChange={event => { setColor(event.target.value); styleSelected('strokeColor', event.target.value) }} /></label>
      <label className={css.strokeWidth}>{t('whiteboard.width')}<input type="range" min="1" max="20" value={width} aria-label={t('whiteboard.width')} onChange={event => { setWidth(Number(event.target.value)) }} onPointerUp={() => styleSelected('strokeWidth', width)} /></label>
      <button type="button" aria-label={t('whiteboard.undo')} title={t('whiteboard.undo')} onClick={() => undo()} disabled={!history.undo.length}>↶</button>
      <button type="button" aria-label={t('whiteboard.redo')} title={t('whiteboard.redo')} onClick={() => undo(true)} disabled={!history.redo.length}>↷</button>
      <button type="button" aria-label={t('whiteboard.delete')} title={t('whiteboard.delete')} onClick={remove} disabled={!selection.length}>⌫</button>
    </div>
    <div className={css.stage}>
      <svg ref={svg} className={css.canvas} data-whiteboard-canvas="true" role="application" aria-label={t('whiteboard.canvasLabel')} tabIndex={0}
        onPointerDown={down} onPointerMove={move} onPointerUp={event => up(event)} onPointerCancel={event => up(event, true)} onLostPointerCapture={event => up(event, true)}
        onDoubleClick={event => { const id = (event.target as Element).closest('[data-element-id]')?.getAttribute('data-element-id'); const element = current.current.elements.find(item => item.id === id); if (element?.type === 'text') editText(element) }}
        onWheel={event => { event.preventDefault(); if (event.ctrlKey || event.metaKey) zoom(Math.exp(-event.deltaY * .002)); else storeView({ ...view, x: view.x - event.deltaX / view.zoom, y: view.y - event.deltaY / view.zoom }) }}
        onKeyDown={event => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(event.shiftKey) }
          else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); onSave() }
          else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove() }
          else if (event.key === 'Escape') setSelection([])
          else if (!event.ctrlKey && !event.metaKey) { const shortcuts: Record<string, Tool> = { v: 'select', p: 'freedraw', e: 'eraser', l: 'line', a: 'arrow', r: 'rectangle', o: 'ellipse', t: 'text', h: 'pan' }; const next = shortcuts[event.key]; if (next) setTool(next) }
        }}>
        <g transform={`scale(${view.zoom}) translate(${view.x} ${view.y})`} data-whiteboard-elements="true">
          <WhiteboardElements elements={displayed.elements} images={images} revealId={revealId} />
          {displayed.elements.filter(element => selection.includes(String(element.id))).map(element => { const box = elementBounds(element); return <rect key={String(element.id)} data-editor-selection="true" x={box.x - 5} y={box.y - 5} width={Math.max(1, box.width) + 10} height={Math.max(1, box.height) + 10} stroke="#2563eb" fill="none" strokeWidth={1.5 / view.zoom} strokeDasharray={`${5 / view.zoom} ${4 / view.zoom}`} pointerEvents="none" /> })}
        </g>
      </svg>
      {!displayed.elements.length && !text ? <div className={css.boardHint}><strong>{t('whiteboard.emptyBoard')}</strong><span>{t('whiteboard.strokeHint')}</span></div> : null}
      {text ? <textarea autoFocus className={css.textEditor} aria-label={t('whiteboard.editText')} value={text.value} style={{ left: (text.x + view.x) * view.zoom, top: (text.y + view.y) * view.zoom, fontSize: Math.max(16, numeric(selected ?? {}, 'fontSize', 28) * view.zoom) }} onChange={event => setText({ ...text, value: event.target.value })} onBlur={finishText} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key === 'Enter')) { event.preventDefault(); finishText() } }} /> : null}
      <div className={css.viewportControls}>
        <button type="button" onClick={() => zoom(1 / 1.2)} aria-label={t('whiteboard.zoomOut')}>−</button><span>{Math.round(view.zoom * 100)}%</span><button type="button" onClick={() => zoom(1.2)} aria-label={t('whiteboard.zoomIn')}>＋</button><button type="button" onClick={fit}>{t('whiteboard.fit')}</button>
      </div>
      {selected && tool === 'select' ? <div className={css.inspector}>
        {(['x', 'y', ...(selected.type === 'rectangle' || selected.type === 'ellipse' || selected.type === 'image' ? ['width', 'height'] : [])] as const).map(key => <label key={key}>{key}<input type="number" aria-label={key} value={numeric(selected, key)} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && ((key !== 'width' && key !== 'height') || value > 0)) styleSelected(key, value) }} /></label>)}
        {selected.type === 'text' ? <><button type="button" onClick={() => editText(selected)}>{t('whiteboard.editText')}</button><label>{t('whiteboard.fontSize')}<input type="number" min="1" max="500" value={numeric(selected, 'fontSize', 24)} onChange={event => { const value = Number(event.target.value); if (value > 0 && value <= 500) styleSelected('fontSize', value) }} /></label></> : null}
      </div> : null}
    </div>
  </div>
}
