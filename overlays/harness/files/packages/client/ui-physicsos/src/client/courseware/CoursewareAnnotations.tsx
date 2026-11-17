import { memo, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { CanvasAnnotationPrimitive, CanvasAnnotationScene } from '@physicsos/physics-whiteboard'
import { inkOutline, type InkSample } from '../whiteboard/ink.ts'
import type { CoursewareController, CoursewareEditOwner } from './controller.ts'
import { coursewareHit, coursewareSamples, coursewareShape, type CoursewareStageBounds } from './geometry.ts'
import type { CoursewareStage, CoursewareTool } from './types.ts'
import css from './Courseware.module.css'
export const CoursewarePrimitive = memo(function CoursewarePrimitive({ primitive: p }: { readonly primitive: CanvasAnnotationPrimitive }) {
  const color = p.style?.strokeColor ?? '#263f4a'; const width = p.style?.strokeWidth ?? 4
  let node
  if (p.type === 'polyline' && p.samples) node = <path d={inkOutline(p.points, p.samples.map(s => s.pressure), width)} fill={color} stroke="none" />
  else if (p.type === 'polyline' || p.type === 'line' || p.type === 'arrow') {
    const end = p.points.at(-1)!; const before = p.points.at(-2) ?? end
    node = <>{p.type === 'polyline' && p.closed ? <polygon points={p.points.map(p => p.join(',')).join(' ')} /> : <polyline points={p.points.map(p => p.join(',')).join(' ')} fill="none" />}{p.type === 'arrow' ? <path d={`M ${-width * 4} ${-width * 2} L 0 0 L ${-width * 4} ${width * 2}`} transform={`translate(${end.join(' ')}) rotate(${Math.atan2(end[1] - before[1], end[0] - before[0]) * 180 / Math.PI})`} fill="none" /> : null}</>
  } else if (p.type === 'rectangle') node = <rect x={p.x} y={p.y} width={p.width} height={p.height} />
  else if (p.type === 'ellipse') node = <ellipse cx={p.x + p.width / 2} cy={p.y + p.height / 2} rx={p.width / 2} ry={p.height / 2} />
  else if (p.type === 'arc') { const at = (a: number): string => `${p.cx + p.radius * Math.cos(a)} ${p.cy + p.radius * Math.sin(a)}`; const sweep = p.endAngle >= p.startAngle ? 1 : 0; node = <path d={`M ${at(p.startAngle)} A ${p.radius} ${p.radius} 0 0 ${sweep} ${at((p.startAngle + p.endAngle) / 2)} A ${p.radius} ${p.radius} 0 0 ${sweep} ${at(p.endAngle)}`} fill="none" /> }
  else if (p.type === 'text') node = <text x={p.x} y={p.y} stroke="none" fill={color} fontSize={p.fontSize}>{p.text}</text>
  return <g data-annotation-id={p.id} stroke={color} strokeWidth={width} fill={p.style?.backgroundColor ?? 'none'} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={p.style?.strokeStyle === 'dashed' ? '8 6' : p.style?.strokeStyle === 'dotted' ? '1 5' : undefined}>{node}</g>
})
interface Gesture { readonly owner: CoursewareEditOwner; readonly pointerId: number; readonly tool: CoursewareTool; readonly bounds: CoursewareStageBounds; readonly stage: CoursewareStage; readonly color: string; readonly width: number; samples: InkSample[]; readonly erased: Set<string> }
export function CoursewareAnnotations(props: { readonly controller: CoursewareController; readonly stage: CoursewareStage; readonly scene: CanvasAnnotationScene; readonly generation: number; readonly tool: CoursewareTool; readonly color: string; readonly width: number; readonly spotlightRadius: number; readonly enabled: boolean; readonly visible: boolean }) {
  const svg = useRef<SVGSVGElement>(null); const gesture = useRef<Gesture | undefined>(undefined); const previewFrame = useRef<number | undefined>(undefined)
  const latest = useRef(props); latest.current = props
  const [preview, setPreview] = useState<CanvasAnnotationPrimitive>(); const [erased, setErased] = useState<ReadonlySet<string>>(new Set())
  const [temporary, setTemporary] = useState<{ readonly x: number; readonly y: number }>(); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const maskId = `courseware-spot-${useId().replace(/:/g, '')}`
  const clear = (): void => { gesture.current = undefined; if (previewFrame.current !== undefined) cancelAnimationFrame(previewFrame.current); previewFrame.current = undefined; setPreview(undefined); setErased(new Set()); setTemporary(undefined); clearTimeout(timer.current) }
  useEffect(() => { clear() }, [props.generation, props.enabled, props.visible, props.tool])
  useEffect(() => { const blur = (): void => clear(); window.addEventListener('blur', blur); return () => { window.removeEventListener('blur', blur); clearTimeout(timer.current); if (previewFrame.current !== undefined) cancelAnimationFrame(previewFrame.current); gesture.current = undefined } }, [])
  const sample = (event: ReactPointerEvent<SVGSVGElement>, g: Gesture): void => {
    const points = coursewareSamples(event.nativeEvent, g.bounds, g.stage)
    for (const point of points) {
      const last = g.samples.at(-1)
      if (!last || last.x !== point.x || last.y !== point.y || last.pressure !== point.pressure || last.time !== point.time) g.samples.push(point)
      if (g.tool === 'eraser') for (const primitive of latest.current.scene.primitives) if (coursewareHit(primitive, point.x, point.y, 10 / g.stage.scale)) g.erased.add(primitive.id)
    }
    if (previewFrame.current === undefined) previewFrame.current = requestAnimationFrame(() => {
      previewFrame.current = undefined
      if (gesture.current !== g) return
      if (g.tool === 'eraser') setErased(new Set(g.erased))
      else setPreview(coursewareShape(g.tool, [...g.samples], 'active_preview', g.color, g.width))
    })
  }
  const temporaryAt = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect(); const point = coursewareSamples(event.nativeEvent, rect, props.stage).at(-1)
    if (point) setTemporary(point)
    if (props.tool === 'laser') { clearTimeout(timer.current); timer.current = setTimeout(() => setTemporary(undefined), 700) }
  }
  const drawing = props.visible && props.enabled && props.tool !== 'interaction'
  const temporaryTool = props.tool === 'laser' || props.tool === 'spotlight'
  return <svg ref={svg} aria-label="课件批注层" data-testid="courseware-annotations" data-generation={props.generation} data-logical-width={props.stage.width} data-logical-height={props.stage.height} className={`${css.annotationLayer} ${drawing ? css.drawing : ''}`} viewBox={`0 0 ${props.stage.width} ${props.stage.height}`} style={{ left: props.stage.rect.x, top: props.stage.rect.y, width: props.stage.rect.width, height: props.stage.rect.height, visibility: props.visible ? 'visible' : 'hidden' }}
    onPointerDown={event => {
      if (!drawing || event.button !== 0 || gesture.current) return
      if (temporaryTool) { event.preventDefault(); temporaryAt(event); return }
      const owner = props.controller.editOwner(); if (!owner) return
      event.preventDefault(); event.stopPropagation()
      const main = event.currentTarget.closest('main') as HTMLElement | null; main?.focus({ preventScroll: true })
      const rect = event.currentTarget.getBoundingClientRect()
      const g: Gesture = { owner, pointerId: event.pointerId, tool: props.tool, bounds: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, stage: props.stage, color: props.color, width: props.width, samples: [], erased: new Set() }
      gesture.current = g; event.currentTarget.setPointerCapture?.(event.pointerId); sample(event, g)
    }}
    onPointerMove={event => { if (!drawing) return; if (temporaryTool) { temporaryAt(event); return }; const g = gesture.current; if (g?.pointerId === event.pointerId) sample(event, g) }}
    onPointerUp={event => {
      const g = gesture.current; if (!g || g.pointerId !== event.pointerId) return
      sample(event, g); gesture.current = undefined
      try { if (g.tool === 'eraser') props.controller.remove([...g.erased], g.owner); else { const primitive = coursewareShape(g.tool, g.samples, `ink_${randomUUID()}`, g.color, g.width); if (primitive) props.controller.append([primitive], g.owner) } }
      catch (error) { props.controller.reportError(error) }
      setPreview(undefined); setErased(new Set()); if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onPointerCancel={event => { if (gesture.current?.pointerId === event.pointerId) clear() }} onLostPointerCapture={event => { if (gesture.current?.pointerId === event.pointerId) clear() }} onPointerLeave={() => { if (!gesture.current) setTemporary(undefined) }}>
    {props.scene.primitives.filter(p => !erased.has(p.id)).map(p => <CoursewarePrimitive key={p.id} primitive={p} />)}
    {preview ? <CoursewarePrimitive primitive={preview} /> : null}
    {props.tool === 'spotlight' && temporary ? <><defs><mask id={maskId}><rect width={props.stage.width} height={props.stage.height} fill="white" /><circle cx={temporary.x} cy={temporary.y} r={props.spotlightRadius} fill="black" /></mask></defs><rect width={props.stage.width} height={props.stage.height} fill="#071116" opacity={.7} mask={`url(#${maskId})`} /></> : null}
    {props.tool === 'laser' && temporary ? <g className={css.laser}><circle cx={temporary.x} cy={temporary.y} r={10} fill="#ee513b" opacity={.25} /><circle cx={temporary.x} cy={temporary.y} r={4} fill="#f84835" /></g> : null}
  </svg>
}
