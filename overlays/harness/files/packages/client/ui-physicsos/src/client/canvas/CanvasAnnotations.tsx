import { memo, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { readCanvasAnnotations, type CanvasAnnotationPrimitive, type CanvasAnnotationScene } from '@physicsos/physics-whiteboard'
import type { CanvasViewport } from '@physicsos/physics-workbench/types'
import type { CanvasCommands } from './contract.ts'
import type { CanvasAnnotationRevision, CanvasDocumentState } from './types.ts'
import type { CanvasViewState } from './view-store.ts'
import { createInkGesture, shapeFromStroke, suggestInkShape, type CanvasInkPointer, type CanvasInkStroke } from './geometry.ts'
import { inkOutline } from '../whiteboard/ink.ts'
import css from './CanvasWorkspace.module.css'

export const AnnotationPrimitive = memo(function AnnotationPrimitive({ primitive: p, preview = false }: { readonly primitive: CanvasAnnotationPrimitive; readonly preview?: boolean }) {
  const color = p.style?.strokeColor ?? '#273b49'; const width = p.style?.strokeWidth ?? 3
  let element
  if (p.type === 'polyline' && p.samples) element = <path d={inkOutline(p.points, p.samples.map(sample => sample.pressure), width)} fill={color} stroke="none" />
  else if (p.type === 'line' || p.type === 'arrow' || p.type === 'polyline') {
    const last = p.points.at(-1)!; const before = p.points.at(-2) ?? last
    element = <>{p.type === 'polyline' && p.closed ? <polygon points={p.points.map(point => point.join(',')).join(' ')} /> : <polyline points={p.points.map(point => point.join(',')).join(' ')} fill="none" />}
      {p.type === 'arrow' ? <path d={`M ${-width * 4} ${-width * 2} L 0 0 L ${-width * 4} ${width * 2}`} transform={`translate(${last.join(' ')}) rotate(${Math.atan2(last[1] - before[1], last[0] - before[0]) * 180 / Math.PI})`} fill="none" /> : null}</>
  } else if (p.type === 'rectangle') element = <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={2} />
  else if (p.type === 'ellipse') element = <ellipse cx={p.x + p.width / 2} cy={p.y + p.height / 2} rx={p.width / 2} ry={p.height / 2} />
  else if (p.type === 'arc') {
    const sweep = p.endAngle - p.startAngle
    // Two arcs also preserve a complete circle, whose endpoints would otherwise coincide.
    const at = (angle: number) => `${p.cx + p.radius * Math.cos(angle)} ${p.cy + p.radius * Math.sin(angle)}`
    const half = p.startAngle + sweep / 2
    element = <path d={`M ${at(p.startAngle)} A ${p.radius} ${p.radius} 0 0 ${sweep >= 0 ? 1 : 0} ${at(half)} A ${p.radius} ${p.radius} 0 0 ${sweep >= 0 ? 1 : 0} ${at(p.endAngle)}`} fill="none" />
  } else if (p.type === 'text') element = <text x={p.x} y={p.y} fill={color} stroke="none" fontSize={p.fontSize} fontFamily="sans-serif" textAnchor={p.textAlign === 'center' ? 'middle' : p.textAlign === 'right' ? 'end' : 'start'}>{p.text.split('\n').map((line, index) => <tspan key={index} x={p.x} dy={index ? '1.3em' : '1em'}>{line}</tspan>)}</text>
  return <g data-annotation-id={p.id} opacity={preview ? 0.65 : 1} stroke={color} strokeWidth={width} fill={p.style?.backgroundColor ?? 'none'} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={preview || p.style?.strokeStyle === 'dashed' ? '8 6' : p.style?.strokeStyle === 'dotted' ? '1 5' : undefined}>{element}</g>
})

const distanceToSegment = (x: number, y: number, a: readonly number[], b: readonly number[]): number => {
  const dx = b[0]! - a[0]!; const dy = b[1]! - a[1]!; const length = dx * dx + dy * dy
  const fraction = length ? Math.max(0, Math.min(1, ((x - a[0]!) * dx + (y - a[1]!) * dy) / length)) : 0
  return Math.hypot(x - a[0]! - fraction * dx, y - a[1]! - fraction * dy)
}
function hit(p: CanvasAnnotationPrimitive, x: number, y: number, tolerance: number): boolean {
  if (p.type === 'line' || p.type === 'arrow' || p.type === 'polyline') return p.points.some((point, index) => distanceToSegment(x, y, p.points[Math.max(0, index - 1)]!, point) <= tolerance + (p.style?.strokeWidth ?? 3))
  if (p.type === 'arc') return Math.abs(Math.hypot(x - p.cx, y - p.cy) - p.radius) <= tolerance
  if (p.type === 'text') return x >= p.x - tolerance && y >= p.y - tolerance && x <= p.x + p.text.length * p.fontSize * 0.6 + tolerance && y <= p.y + p.fontSize * 1.3 + tolerance
  if (p.type === 'rectangle' || p.type === 'ellipse') return x >= p.x - tolerance && y >= p.y - tolerance && x <= p.x + p.width + tolerance && y <= p.y + p.height + tolerance
  return false
}
export function CanvasAnnotations(props: {
  readonly document?: CanvasDocumentState | undefined; readonly viewport: CanvasViewport; readonly tool: CanvasViewState['tool']; readonly active: boolean
  readonly commands: CanvasCommands; readonly toWorld: (point: CanvasInkPointer) => { readonly x: number; readonly y: number }
  readonly candidate?: CanvasAnnotationScene | undefined; readonly onError: (error: unknown) => void
  readonly onSuggestion: (proposal: { readonly originalId: string; readonly primitive: CanvasAnnotationPrimitive } | undefined) => void
}) {
  const [preview, setPreview] = useState<CanvasInkStroke>(); const [pending, setPending] = useState<CanvasAnnotationPrimitive[]>([])
  const [erased, setErased] = useState<Set<string>>(new Set())
  const latest = useRef(props); latest.current = props
  const gestureOwner = useRef<{ canvasId: string; revision: CanvasAnnotationRevision; pointerId: number; token: number; tool: CanvasViewState['tool'] }>()
  const gestureToken = useRef(0)
  const mounted = useRef(true)
  type CommitSession = { confirmedSequence?: number; running: boolean; tasks: ((session: CommitSession) => Promise<void>)[] }
  const commits = useRef<CommitSession>({ running: false, tasks: [] })
  const pendingRef = useRef<CanvasAnnotationPrimitive[]>([])
  const erasedCommits = useRef(new Map<string, Set<string>>())
  const erasedIds = useRef(new Set<string>()); const svg = useRef<SVGSVGElement>(null)
  const layer = useMemo(() => { try { return { scene: readCanvasAnnotations(props.document?.manifest?.metadata), error: undefined } } catch (error) { return { scene: { schemaVersion: 1, primitives: [] } as CanvasAnnotationScene, error } } }, [props.document?.manifest?.metadata])
  useEffect(() => { if (layer.error !== undefined) props.onError(layer.error) }, [layer.error, props.onError])
  const scene = layer.scene
  const refreshErased = (): void => setErased(new Set([...erasedIds.current, ...[...erasedCommits.current.values()].flatMap(ids => [...ids])]))
  const enqueue = (task: (session: CommitSession) => Promise<void>): void => {
    const session = commits.current; session.tasks.push(task)
    if (session.running) return
    const drain = async (): Promise<void> => {
      session.running = true
      while (session === commits.current && session.tasks.length) await session.tasks.shift()!(session)
      session.running = false
    }
    void drain()
  }
  const gesture = useMemo(() => createInkGesture({
    toWorld: point => latest.current.toWorld(point), requestFrame: callback => requestAnimationFrame(callback), cancelFrame: handle => cancelAnimationFrame(handle),
    onPreview: setPreview,
    onCommit: stroke => {
      const owner = gestureOwner.current; gestureOwner.current = undefined
      if (!owner) return
      const owned = (): boolean => mounted.current && latest.current.document?.canvasId === owner.canvasId && latest.current.document.namespace === owner.revision.namespace
      if (!owned()) return
      const id = `ink:${randomUUID()}`
      const removed = owner.tool === 'eraser' ? new Set(erasedIds.current) : undefined
      if (removed) {
        erasedIds.current.clear()
        if (!removed.size) { refreshErased(); return }
        erasedCommits.current.set(id, removed); refreshErased()
      }
      const primitive: CanvasAnnotationPrimitive | undefined = removed ? undefined : owner.tool === 'pen' ? { id, type: 'polyline', ...stroke, style: { strokeColor: '#273b49', strokeWidth: 4 } }
        : { ...shapeFromStroke(stroke, owner.tool as 'line' | 'rectangle' | 'ellipse', id), style: { strokeColor: '#273b49', strokeWidth: 3 } }
      if (primitive) { pendingRef.current.push(primitive); setPending([...pendingRef.current]) }
      enqueue(async session => {
        if (!owned()) return
        // Advance only by successfully committed operations from this owner.
        // An unrelated queued edit still makes the controller's exact check fail.
        const expected = { ...owner.revision, editSequence: Math.max(owner.revision.editSequence, session.confirmedSequence ?? owner.revision.editSequence) }
        try {
          const current = latest.current
          const sequence = removed ? await current.commands.removeAnnotations(owner.canvasId, [...removed], expected)
            : await current.commands.appendAnnotations(owner.canvasId, { schemaVersion: 1, primitives: [primitive!] }, expected)
          session.confirmedSequence = typeof sequence === 'number' ? sequence : expected.editSequence + 1
          if (owned() && owner.token === gestureToken.current && primitive) {
            const suggestion = owner.tool === 'pen' ? suggestInkShape(stroke, id) : undefined
            latest.current.onSuggestion(suggestion ? { originalId: id, primitive: { ...suggestion, ...(primitive.style ? { style: primitive.style } : {}) } } : undefined)
          }
        } catch (error) { if (owned()) latest.current.onError(error) }
        finally {
          if (owned()) {
            pendingRef.current = pendingRef.current.filter(p => p.id !== id); setPending([...pendingRef.current])
            erasedCommits.current.delete(id); refreshErased()
          }
        }
      })
    },
  }), [])
  const cancel = (): void => { gestureOwner.current = undefined; gesture.cancel(); erasedIds.current.clear(); refreshErased() }
  useEffect(() => { cancel() }, [props.tool, props.active])
  useEffect(() => { cancel(); commits.current = { running: false, tasks: [] }; pendingRef.current = []; erasedCommits.current.clear(); setPending([]); setErased(new Set()) }, [props.document?.canvasId, props.document?.namespace])
  useEffect(() => { mounted.current = true; const blur = () => cancel(); window.addEventListener('blur', blur); return () => { mounted.current = false; commits.current = { running: false, tasks: [] }; window.removeEventListener('blur', blur); gesture.cancel() } }, [gesture])
  const coalesced = (event: PointerEvent<SVGSVGElement>): readonly CanvasInkPointer[] => {
    const captured = event.nativeEvent.getCoalescedEvents?.() ?? []
    const samples = [...captured]; const last = samples.at(-1)
    if (!last || last.clientX !== event.clientX || last.clientY !== event.clientY || last.pressure !== event.pressure || last.timeStamp !== event.timeStamp) samples.push(event.nativeEvent)
    return samples
  }
  const eraseAt = (points: readonly CanvasInkPointer[]): void => {
    for (const point of points) { const world = props.toWorld(point); for (const p of [...scene.primitives, ...pendingRef.current]) if (hit(p, world.x, world.y, 8 / props.viewport.zoom)) erasedIds.current.add(p.id) }
    refreshErased()
  }
  const drawing = props.active && !['select', 'hand'].includes(props.tool)
  const displayed = [...scene.primitives, ...pending.filter(p => !scene.primitives.some(existing => existing.id === p.id))].filter(p => !erased.has(p.id))
  const previewPrimitive = preview ? props.tool === 'pen' ? { id: 'active-ink', type: 'polyline' as const, ...preview, style: { strokeWidth: 4 } } : props.tool === 'eraser' ? undefined : shapeFromStroke(preview, props.tool as 'line' | 'rectangle' | 'ellipse', 'active-shape') : undefined
  return <svg ref={svg} className={`${css.annotationLayer} ${drawing ? css.annotationDrawing : ''}`} aria-label="Canvas annotations" data-testid="canvas-annotation-layer"
    onPointerDown={event => {
      if (!drawing || event.button !== 0 || gestureOwner.current || !props.document?.namespace) return
      event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture?.(event.pointerId)
      const main = event.currentTarget.closest('main') as HTMLElement | null
      main?.focus({ preventScroll: true })
      props.onSuggestion(undefined)
      gestureOwner.current = { canvasId: props.document.canvasId, revision: { namespace: props.document.namespace, editSequence: props.document.editSequence }, pointerId: event.pointerId, token: ++gestureToken.current, tool: props.tool }
      gesture.begin(event.pointerId, event.nativeEvent); if (props.tool === 'eraser') eraseAt([event.nativeEvent])
    }}
    onPointerMove={event => { if (!gestureOwner.current || gestureOwner.current.pointerId !== event.pointerId) return; const points = coalesced(event); gesture.append(event.pointerId, points); if (props.tool === 'eraser') eraseAt(points) }}
    onPointerUp={event => {
      if (gestureOwner.current?.pointerId !== event.pointerId) return
      const final = coalesced(event); gesture.append(event.pointerId, final.slice(0, -1))
      if (props.tool === 'eraser') eraseAt(final)
      gesture.finish(event.pointerId, event.nativeEvent)
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onPointerCancel={event => { if (gestureOwner.current?.pointerId === event.pointerId) cancel() }} onLostPointerCapture={event => { if (gestureOwner.current?.pointerId === event.pointerId) cancel() }}>
    <g transform={`translate(${props.viewport.x} ${props.viewport.y}) scale(${props.viewport.zoom})`}>
      {displayed.map(primitive => <AnnotationPrimitive key={primitive.id} primitive={primitive} />)}
      {props.candidate?.primitives.map(primitive => <AnnotationPrimitive key={`candidate:${primitive.id}`} primitive={primitive} preview />)}
      {previewPrimitive ? <AnnotationPrimitive primitive={previewPrimitive} /> : null}
    </g>
  </svg>
}
