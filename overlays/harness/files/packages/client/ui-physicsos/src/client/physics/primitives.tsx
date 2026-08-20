/**
 * Shared canvas primitives.
 *
 * Every renderer composes these instead of hand-rolling SVG, so an arrow, an
 * angle arc or a dimension line looks identical in every physics domain. Each
 * primitive receives an already-projected {@link RendererProjection} and draws
 * nothing physical of its own.
 */

import type {
  AngleVisual,
  BodyVisual,
  CoordinateVisual,
  DimensionVisual,
  GroundVisual,
  InclineVisual,
  KeyPointVisual,
  PlatformVisual,
  ScenePoint,
  VectorVisual,
} from './scene-visual-model.ts'
import type { RendererProjection } from './renderer-registry.tsx'
import { estimateLabelWidth, layoutVectorLabels, type LabelBox } from './vector-label-layout.ts'
import css from './primitives.module.css'

const LABEL_FONT = 11.5

/** CSS class for a semantic role's stroke colour. */
export const roleClass = (role: VectorVisual['role']): string | undefined => {
  switch (role) {
    case 'velocity':
      return css.roleVelocity
    case 'velocity-component':
      return css.roleVelocityComponent
    case 'force':
      return css.roleForce
    case 'gravity':
      return css.roleGravity
    case 'normal':
      return css.roleNormal
    case 'friction':
      return css.roleFriction
    case 'net-force':
      return css.roleNetForce
    case 'acceleration':
      return css.roleAcceleration
    case 'trajectory':
      return css.roleTrajectory
    case 'field':
      return css.roleField
    case 'measurement':
      return css.roleMeasurement
    default:
      return css.roleNeutral
  }
}

/** Arrowhead marker id for a role, unique per canvas instance. */
export const markerId = (role: VectorVisual['role'], uid: string): string =>
  `pc-arrow-${role}-${uid}`

const MARKER_ROLES: readonly VectorVisual['role'][] = [
  'velocity',
  'velocity-component',
  'force',
  'gravity',
  'normal',
  'friction',
  'net-force',
  'acceleration',
  'field',
  'measurement',
  'neutral',
]

/**
 * Arrowhead markers for every semantic role.
 *
 * `markerUnits="userSpaceOnUse"` keeps the head a fixed size regardless of the
 * line's stroke width, so a subordinate component arrow and a primary vector get
 * heads that read as the same family.
 */
export const ArrowMarkers = ({ uid }: { uid: string }) => (
  <>
    {MARKER_ROLES.map(role => (
      <marker
        key={role}
        id={markerId(role, uid)}
        markerWidth="9"
        markerHeight="9"
        refX="7.4"
        refY="3.6"
        orient="auto"
        markerUnits="userSpaceOnUse"
      >
        <path d="M0 0.4 L8 3.6 L0 6.8 Z" className={roleClass(role)} fillOpacity="1" />
      </marker>
    ))}
    <marker
      id={`pc-tick-${uid}`}
      markerWidth="6"
      markerHeight="8"
      refX="3"
      refY="4"
      orient="auto"
      markerUnits="userSpaceOnUse"
    >
      <path d="M3 0.6 V7.4" className={css.dimensionTick} />
    </marker>
  </>
)

/* --------------------------------------------------------------- surfaces -- */

/** Ground line with hatching underneath. */
export const Ground = ({
  ground,
  projection,
}: {
  ground: GroundVisual
  projection: RendererProjection
}) => {
  const y = projection.py({ x: 0, y: ground.y })
  const x1 = projection.px({ x: ground.from, y: ground.y })
  const x2 = projection.px({ x: ground.to, y: ground.y })
  const step = 13
  const count = Math.max(0, Math.floor((x2 - x1) / step))
  return (
    <g>
      <line className={css.groundLine} x1={x1} y1={y} x2={x2} y2={y} />
      {Array.from({ length: count }, (_, index) => {
        const x = x1 + index * step
        return (
          <line
            key={x}
            className={css.hatch}
            x1={x}
            y1={y + 8}
            x2={x + 7}
            y2={y + 1}
          />
        )
      })}
      {ground.label === undefined ? null : (
        <text className={css.surfaceLabel} x={x2 - 4} y={y + 19} textAnchor="end">
          {ground.label}
        </text>
      )}
    </g>
  )
}

/** Inclined plane wedge: right angle at the base, slope rising to the left. */
export const Incline = ({
  incline,
  projection,
}: {
  incline: InclineVisual
  projection: RendererProjection
}) => {
  const radians = (incline.angle * Math.PI) / 180
  const rise = incline.base * Math.tan(radians)
  /* Base corner at `origin`, running +x; apex sits above the origin. */
  const corner: ScenePoint = incline.origin
  const foot: ScenePoint = { x: incline.origin.x + incline.base, y: incline.origin.y }
  const apex: ScenePoint = { x: incline.origin.x, y: incline.origin.y + rise }
  const points = [corner, foot, apex]
  const step = 13
  const baseX1 = projection.px(corner)
  const baseX2 = projection.px(foot)
  const baseY = projection.py(corner)
  const count = Math.max(0, Math.floor((baseX2 - baseX1) / step))
  return (
    <g>
      <path
        className={css.inclineBody}
        d={`${projection.path(points)} Z`}
      />
      <line className={css.groundLine} x1={baseX1} y1={baseY} x2={baseX2} y2={baseY} />
      {Array.from({ length: count }, (_, index) => {
        const x = baseX1 + index * step
        return <line key={x} className={css.hatch} x1={x} y1={baseY + 8} x2={x + 7} y2={baseY + 1} />
      })}
    </g>
  )
}

/** Raised launch platform, drawn as a slab with a hatched underside. */
export const Platform = ({
  platform,
  projection,
}: {
  platform: PlatformVisual
  projection: RendererProjection
}) => {
  const topY = projection.py(platform.at)
  const x1 = projection.px({ x: platform.at.x - platform.width, y: platform.at.y })
  const x2 = projection.px(platform.at)
  const bottomY = projection.py({ x: platform.at.x, y: platform.at.y - platform.height })
  return (
    <g>
      <path
        className={css.platformBody}
        d={`M${x1} ${topY} H${x2} V${bottomY} H${x2 - 9} V${topY + 7} H${x1} Z`}
      />
      <line className={css.platformEdge} x1={x1} y1={topY} x2={x2} y2={topY} />
    </g>
  )
}

/* ------------------------------------------------------------------ bodies -- */

/** Solid body: block or ball, optionally rotated onto a slope. */
export const Body = ({
  body,
  projection,
}: {
  body: BodyVisual
  projection: RendererProjection
}) => {
  const cx = projection.px(body.at)
  const cy = projection.py(body.at)
  const radius = body.size * projection.scale
  const highlighted = projection.highlighted(body.id)
  const rotation = body.rotation ?? 0
  return (
    <g className={highlighted ? css.highlightGroup : undefined}>
      {body.kind === 'ball' ? (
        <>
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            className={clsxJoin(css.bodyFill, body.live === true && css.bodyLive)}
          />
          {/* A single soft specular dot reads as a physical object without
              turning the marker into a glossy 3D ball. */}
          <circle
            cx={cx - radius * 0.32}
            cy={cy - radius * 0.34}
            r={radius * 0.24}
            className={css.bodyGloss}
          />
        </>
      ) : (
        <rect
          x={cx - radius}
          y={cy - radius}
          width={radius * 2}
          height={radius * 2}
          rx={radius * 0.18}
          transform={rotation === 0 ? undefined : `rotate(${-rotation} ${cx} ${cy})`}
          className={clsxJoin(css.bodyFill, body.live === true && css.bodyLive)}
        />
      )}
      {body.label === undefined ? null : (
        <text className={css.bodyLabel} x={cx} y={cy - radius - 6} textAnchor="middle">
          {body.label}
        </text>
      )}
    </g>
  )
}

/* ----------------------------------------------------------------- vectors -- */

/**
 * Vector arrows with collision-resolved labels.
 *
 * All arrows are laid out together, because the whole point of the layout pass is
 * to see every label at once — on an incline mg, N, f and a share one origin.
 */
export const Vectors = ({
  vectors,
  projection,
}: {
  vectors: readonly VectorVisual[]
  projection: RendererProjection
}) => {
  const boxes: LabelBox[] = vectors.map((vector) => {
    const x1 = projection.px(vector.from)
    const y1 = projection.py(vector.from)
    const x2 = projection.px(vector.to)
    const y2 = projection.py(vector.to)
    const dirX = x2 - x1
    const dirY = y2 - y1
    /* Anchor on the side the arrow points, so text grows away from the shaft. */
    const anchor = vector.labelHint === 'start' ? 'end' : dirX >= 0 ? 'start' : 'end'
    return {
      id: vector.id,
      x: x2,
      y: y2,
      width: estimateLabelWidth(vector.symbol, LABEL_FONT),
      height: LABEL_FONT,
      dirX,
      dirY,
      anchor,
    }
  })
  const placed = layoutVectorLabels(boxes)

  return (
    <g>
      {vectors.map((vector, index) => {
        const label = placed[index]
        const stroke = roleClass(vector.role)
        const highlighted = projection.highlighted(vector.id)
        return (
          <g key={vector.id} className={highlighted ? css.highlightGroup : undefined}>
            <line
              className={clsxJoin(
                css.vectorLine,
                stroke,
                vector.subordinate === true && css.vectorSubordinate,
              )}
              x1={projection.px(vector.from)}
              y1={projection.py(vector.from)}
              x2={projection.px(vector.to)}
              y2={projection.py(vector.to)}
              markerEnd={`url(#${markerId(vector.role, projection.uid)})`}
            />
            {label?.leader === undefined ? null : (
              <line
                className={css.labelLeader}
                x1={label.leader.x1}
                y1={label.leader.y1}
                x2={label.leader.x2}
                y2={label.leader.y2}
              />
            )}
            {label === undefined ? null : (
              <MathLabel
                x={label.x}
                y={label.y}
                anchor={label.anchor}
                symbol={vector.symbol}
                className={clsxJoin(
                  css.vectorLabel,
                  stroke,
                  vector.subordinate === true && css.vectorLabelSubordinate,
                )}
              />
            )}
          </g>
        )
      })}
    </g>
  )
}

/**
 * Italic math label with real sub/superscripts.
 *
 * Physics symbols are `v_x`, `v_0`, `mg\sin\theta` — flattening them to "vx"
 * would be wrong typography, so `_x` becomes a `<tspan>` baseline shift and a few
 * common TeX names map to their glyph.
 */
export const MathLabel = ({
  x,
  y,
  anchor,
  symbol,
  className,
}: {
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  symbol: string
  className?: string | undefined
}) => {
  const parts = parseMathSymbol(symbol)
  return (
    <text x={x} y={y} textAnchor={anchor} className={className}>
      {parts.map((part, index) =>
        part.script === undefined ? (
          <tspan key={index}>{part.text}</tspan>
        ) : (
          <tspan
            key={index}
            className={part.script === 'sub' ? css.subscript : css.superscript}
            dy={part.script === 'sub' ? '0.28em' : '-0.38em'}
          >
            {part.text}
          </tspan>
        ),
      )}
      {/* Reset the baseline so a following label is unaffected. */}
    </text>
  )
}

interface MathPart {
  text: string
  script?: 'sub' | 'super'
}

const GREEK: Record<string, string> = {
  theta: 'θ',
  mu: 'μ',
  alpha: 'α',
  omega: 'ω',
  Delta: 'Δ',
  Sigma: 'Σ',
  pi: 'π',
}

/** Split a light TeX subset into runs with optional script level. */
export const parseMathSymbol = (input: string): readonly MathPart[] => {
  const expanded = input
    .replace(/\\(theta|mu|alpha|omega|Delta|Sigma|pi)/g, (_, name: string) => GREEK[name] ?? name)
    .replace(/\\sin/g, 'sin')
    .replace(/\\cos/g, 'cos')
    .replace(/\\Sigma/g, 'Σ')
  const parts: MathPart[] = []
  let buffer = ''
  let index = 0
  while (index < expanded.length) {
    const char = expanded.charAt(index)
    if (char === '_' || char === '^') {
      if (buffer.length > 0) {
        parts.push({ text: buffer })
        buffer = ''
      }
      index += 1
      let script = ''
      if (expanded[index] === '{') {
        index += 1
        while (index < expanded.length && expanded[index] !== '}') {
          script += expanded.charAt(index)
          index += 1
        }
        index += 1
      } else if (index < expanded.length) {
        script += expanded.charAt(index)
        index += 1
      }
      parts.push({ text: script, script: char === '_' ? 'sub' : 'super' })
      continue
    }
    buffer += char
    index += 1
  }
  if (buffer.length > 0) parts.push({ text: buffer })
  return parts
}

/* ---------------------------------------------------------------- geometry -- */

/** Angle arc with two faint bounding rays and a symbol on the bisector. */
export const Angle = ({
  angle,
  projection,
}: {
  angle: AngleVisual
  projection: RendererProjection
}) => {
  const cx = projection.px(angle.at)
  const cy = projection.py(angle.at)
  const radius = angle.radius * projection.scale
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180
  /* Scene angles are counter-clockwise from +x; screen y is flipped. */
  const point = (degrees: number) => ({
    x: cx + Math.cos(toRadians(degrees)) * radius,
    y: cy - Math.sin(toRadians(degrees)) * radius,
  })
  const start = point(angle.startAngle)
  const end = point(angle.endAngle)
  const sweep = Math.abs(angle.endAngle - angle.startAngle)
  const largeArc = sweep > 180 ? 1 : 0
  const bisector = point((angle.startAngle + angle.endAngle) / 2)
  const labelX = cx + (bisector.x - cx) * 1.44
  const labelY = cy + (bisector.y - cy) * 1.44
  return (
    <g>
      <line className={css.angleRay} x1={cx} y1={cy} x2={point(angle.startAngle).x} y2={point(angle.startAngle).y} />
      <line className={css.angleRay} x1={cx} y1={cy} x2={point(angle.endAngle).x} y2={point(angle.endAngle).y} />
      <path
        className={css.angleArc}
        d={`M${start.x.toFixed(2)} ${start.y.toFixed(2)} A${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${largeArc} ${angle.endAngle > angle.startAngle ? 0 : 1} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`}
      />
      <MathLabel
        x={labelX}
        y={labelY + 4}
        anchor="middle"
        symbol={angle.value === undefined ? angle.symbol : `${angle.symbol}=${angle.value}`}
        className={css.angleLabel}
      />
    </g>
  )
}

/** Dimension line with end ticks and a centred label. */
export const Dimension = ({
  dimension,
  projection,
}: {
  dimension: DimensionVisual
  projection: RendererProjection
}) => {
  const x1 = projection.px(dimension.from)
  const y1 = projection.py(dimension.from)
  const x2 = projection.px(dimension.to)
  const y2 = projection.py(dimension.to)
  const highlighted = projection.highlighted(dimension.id)
  /* Offset the label perpendicular to the line so it never sits on the rule. */
  const length = Math.hypot(x2 - x1, y2 - y1) || 1
  const side = dimension.side === 'right' ? -1 : 1
  const nx = (-(y2 - y1) / length) * 11 * side
  const ny = ((x2 - x1) / length) * 11 * side
  return (
    <g className={highlighted ? css.highlightGroup : undefined}>
      <line
        className={clsxJoin(css.dimensionLine, highlighted && css.dimensionHighlighted)}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        markerStart={`url(#pc-tick-${projection.uid})`}
        markerEnd={`url(#pc-tick-${projection.uid})`}
      />
      <MathLabel
        x={(x1 + x2) / 2 + nx}
        y={(y1 + y2) / 2 + ny + 3.6}
        anchor="middle"
        symbol={dimension.label}
        className={clsxJoin(css.dimensionLabel, highlighted && css.dimensionLabelHighlighted)}
      />
    </g>
  )
}

/** Key point marker: a small precise ring, not a big coloured dot. */
export const KeyPoint = ({
  keyPoint,
  projection,
}: {
  keyPoint: KeyPointVisual
  projection: RendererProjection
}) => {
  const cx = projection.px(keyPoint.at)
  const cy = projection.py(keyPoint.at)
  const kindClass =
    keyPoint.kind === 'launch'
      ? css.keyLaunch
      : keyPoint.kind === 'apex'
        ? css.keyApex
        : keyPoint.kind === 'impact'
          ? css.keyImpact
          : css.keySample
  return (
    <g className={projection.highlighted(keyPoint.id) ? css.highlightGroup : undefined}>
      <title>
        {keyPoint.readout === undefined || keyPoint.readout.length === 0
          ? keyPoint.label
          : `${keyPoint.label} · ${keyPoint.readout.map(row => `${row.label} ${row.value}`).join(' · ')}`}
      </title>
      {keyPoint.kind === 'apex' ? (
        <path className={kindClass} d={`M${cx} ${cy - 4.6} L${cx + 4.2} ${cy + 3.2} L${cx - 4.2} ${cy + 3.2} Z`} />
      ) : keyPoint.kind === 'impact' ? (
        <path
          className={kindClass}
          d={`M${cx} ${cy - 4.8} L${cx + 4.8} ${cy} L${cx} ${cy + 4.8} L${cx - 4.8} ${cy} Z`}
        />
      ) : (
        <circle className={kindClass} cx={cx} cy={cy} r="3.5" />
      )}
      <text className={css.keyLabel} x={cx} y={cy - 9} textAnchor="middle">
        {keyPoint.label}
      </text>
    </g>
  )
}

/** Local coordinate basis: a small two-arrow cross. */
export const Coordinate = ({
  coordinate,
  projection,
}: {
  coordinate: CoordinateVisual
  projection: RendererProjection
}) => {
  const cx = projection.px(coordinate.at)
  const cy = projection.py(coordinate.at)
  const arm = coordinate.length * projection.scale
  const radians = ((coordinate.rotation ?? 0) * Math.PI) / 180
  const xEnd = { x: cx + Math.cos(radians) * arm, y: cy - Math.sin(radians) * arm }
  const yEnd = { x: cx - Math.sin(radians) * arm, y: cy - Math.cos(radians) * arm }
  return (
    <g>
      <line
        className={clsxJoin(css.basisLine, css.roleMeasurement)}
        x1={cx}
        y1={cy}
        x2={xEnd.x}
        y2={xEnd.y}
        markerEnd={`url(#${markerId('measurement', projection.uid)})`}
      />
      <line
        className={clsxJoin(css.basisLine, css.roleMeasurement)}
        x1={cx}
        y1={cy}
        x2={yEnd.x}
        y2={yEnd.y}
        markerEnd={`url(#${markerId('measurement', projection.uid)})`}
      />
      <MathLabel x={xEnd.x + 6} y={xEnd.y + 4} anchor="start" symbol={coordinate.xLabel} className={css.basisLabel} />
      <MathLabel x={yEnd.x} y={yEnd.y - 5} anchor="middle" symbol={coordinate.yLabel} className={css.basisLabel} />
    </g>
  )
}

/** Join truthy class names; local so primitives stay dependency-free. */
const clsxJoin = (...values: readonly (string | false | undefined)[]): string =>
  values.filter((value): value is string => typeof value === 'string' && value.length > 0).join(' ')

export { clsxJoin }
