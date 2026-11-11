import type { JsonObject } from '@physicsos/physics-whiteboard'
import { numeric, pointsOf, pressurePath } from './editor-model.ts'
export function WhiteboardElements({ elements, images, revealId }: { readonly elements: readonly JsonObject[]; readonly images: Readonly<Record<string, string>>; readonly revealId?: string | undefined }) {
  return <>{elements.filter(element => !element.isDeleted).map(element => {
    const x = numeric(element, 'x'); const y = numeric(element, 'y'); const width = numeric(element, 'width'); const height = numeric(element, 'height')
    const color = typeof element.strokeColor === 'string' ? element.strokeColor : '#1e293b'
    const strokeWidth = numeric(element, 'strokeWidth', 2)
    const points = pointsOf(element)
    const pointsString = points.map(point => point.join(',')).join(' ')
    const custom = element.customData as JsonObject | undefined
    const last = points.at(-1); const prior = points.at(-2)
    const angle = last && prior ? Math.atan2(last[1] - prior[1], last[0] - prior[0]) * 180 / Math.PI : 0
    return <g key={String(element.id)} data-element-id={String(element.id)} data-revealed={revealId !== undefined && custom?.generationId === revealId ? 'true' : undefined}
      transform={`translate(${x} ${y})`} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill={typeof element.backgroundColor === 'string' ? element.backgroundColor : 'none'}
      strokeDasharray={element.strokeStyle === 'dashed' ? '8 6' : element.strokeStyle === 'dotted' ? '1 5' : undefined}>
      {element.type === 'freedraw' ? points.every(point => point[0] === points[0]?.[0] && point[1] === points[0]?.[1]) ? <circle cx={points[0]?.[0] ?? 0} cy={points[0]?.[1] ?? 0} r={strokeWidth / 2} fill={color} stroke="none" /> : <path d={pressurePath(element)} fill={color} stroke="none" /> : null}
      {element.type === 'rectangle' ? <rect width={Math.abs(width)} height={Math.abs(height)} /> : null}
      {element.type === 'ellipse' ? <ellipse cx={width / 2} cy={height / 2} rx={Math.abs(width / 2)} ry={Math.abs(height / 2)} /> : null}
      {element.type === 'line' || element.type === 'arrow' ? <>{element.closed ? <polygon points={pointsString} /> : <polyline points={pointsString} fill="none" />}{element.type === 'arrow' && last ? <path d="M -12 -6 L 0 0 L -12 6" transform={`translate(${last.join(' ')}) rotate(${angle})`} fill="none" /> : null}</> : null}
      {element.type === 'text' ? <text fill={color} stroke="none" fontSize={numeric(element, 'fontSize', 24)} fontFamily="sans-serif" textAnchor={element.textAlign === 'center' ? 'middle' : element.textAlign === 'right' ? 'end' : 'start'}>
        {String(element.text ?? '').split('\n').map((line, index) => <tspan key={index} x="0" dy={index ? '1.3em' : '1em'}>{line}</tspan>)}
      </text> : null}
      {element.type === 'image' && images[String(element.fileId)] ? <image href={images[String(element.fileId)]} width={width} height={height} preserveAspectRatio="xMidYMid meet" /> : null}
    </g>
  })}</>
}
