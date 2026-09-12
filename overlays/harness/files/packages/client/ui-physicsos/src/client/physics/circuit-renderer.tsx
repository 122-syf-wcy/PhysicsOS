/**
 * Circuit renderer: textbook schematic symbols on the shared canvas.
 *
 * Draws wires, junction dots and GB-style component symbols (resistor box,
 * battery long/short plates, switch lever, circled A/V meters, rheostat with a
 * slider arrow) from {@link SceneVisualModel.circuitComponents} — never from a
 * PhysicsScene. Every string it places (readings, U/I/P annotations) was
 * formatted upstream by the runtime bridge from the verified operating point.
 *
 * Symbol geometry lives in the local a→b frame and is rotated as one group;
 * text stays upright, placed above/below a horizontal symbol and beside a
 * vertical one, so the schematic reads like a printed diagram at any rotation.
 */

import type { CircuitComponentVisual, ScenePoint } from './scene-visual-model.ts'
import type { RendererProps } from './renderer-registry.tsx'
import { clsxJoin } from './primitives.tsx'
import css from './renderers.module.css'

/** Half the symbol length in scene units; matches the scene-side constant. */
const HALF = 0.75

/* Charge-carrier drift: one bead every ~14 px of wire; the advance rate is
   ∝ |I| (px/s per ampere), floored so a small current still visibly drifts
   and capped so a strong one stays readable. */
const CHARGE_SPACING_PX = 14
const CHARGE_SPEED_PER_AMP = 110
const CHARGE_SPEED_MIN = 8
const CHARGE_SPEED_MAX = 90

const isVertical = (rotation: number): boolean => Math.abs(rotation % 180) === 90

/** Screen-space point at arc length `s` along a projected polyline. */
const pointAlong = (
  screen: readonly { x: number; y: number }[],
  lengths: readonly number[],
  s: number,
): { x: number; y: number } => {
  const first = screen[0] ?? { x: 0, y: 0 }
  let walked = 0
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index] ?? 0
    const a = screen[index]
    const b = screen[index + 1]
    if (a === undefined || b === undefined) break
    if (s <= walked + length || index === lengths.length - 1) {
      const t = length <= 0 ? 0 : Math.min(1, Math.max(0, (s - walked) / length))
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    walked += length
  }
  return first
}

interface SymbolProps {
  readonly component: CircuitComponentVisual
  readonly cx: number
  readonly cy: number
  /** px per scene unit. */
  readonly scale: number
}

/** Symbol geometry in the rotated local frame (+x = terminal b / positive). */
function SymbolGeometry({ component, cx, cy, scale }: SymbolProps) {
  const half = HALF * scale
  switch (component.kind) {
    case 'resistor':
    case 'variable_resistor': {
      const bodyHalf = 0.5 * scale
      const height = 0.36 * scale
      const slider = component.sliderPosition ?? 0.5
      return (
        <>
          <line className={css.circuitSymbol} x1={cx - half} y1={cy} x2={cx - bodyHalf} y2={cy} />
          <line className={css.circuitSymbol} x1={cx + bodyHalf} y1={cy} x2={cx + half} y2={cy} />
          <rect
            className={css.circuitSymbol}
            x={cx - bodyHalf}
            y={cy - height / 2}
            width={bodyHalf * 2}
            height={height}
          />
          {component.kind === 'variable_resistor' ? (() => {
            const sx = cx - bodyHalf + slider * bodyHalf * 2
            const tipY = cy - height / 2 - 0.06 * scale
            const head = 0.11 * scale
            return (
              <g data-testid={`slider-${component.id}`}>
                <line
                  className={css.circuitSymbol}
                  x1={sx}
                  y1={cy - 0.62 * scale}
                  x2={sx}
                  y2={tipY - head}
                />
                <path
                  className={css.circuitSymbolFill}
                  d={`M${sx} ${tipY} L${sx - head * 0.72} ${tipY - head} L${sx + head * 0.72} ${tipY - head} Z`}
                />
              </g>
            )
          })() : null}
        </>
      )
    }
    case 'voltage_source': {
      const gap = 0.12 * scale
      const longHalf = 0.34 * scale
      const shortHalf = 0.15 * scale
      return (
        <>
          <line className={css.circuitSymbol} x1={cx - half} y1={cy} x2={cx - gap} y2={cy} />
          <line className={css.circuitSymbol} x1={cx + gap} y1={cy} x2={cx + half} y2={cy} />
          {/* Short thick plate = negative (axis tail), long thin plate = positive. */}
          <line
            className={css.circuitSymbolThick}
            x1={cx - gap}
            y1={cy - shortHalf}
            x2={cx - gap}
            y2={cy + shortHalf}
          />
          <line
            className={css.circuitSymbol}
            x1={cx + gap}
            y1={cy - longHalf}
            x2={cx + gap}
            y2={cy + longHalf}
          />
        </>
      )
    }
    case 'switch': {
      const pivot = 0.5 * scale
      const closed = component.closed === true
      const leverAngle = (32 * Math.PI) / 180
      const leverX = closed ? cx + pivot : cx - pivot + Math.cos(leverAngle) * pivot * 1.9
      const leverY = closed ? cy : cy - Math.sin(leverAngle) * pivot * 1.9
      return (
        <g data-testid={`switch-${component.id}`} data-closed={closed ? 'true' : 'false'}>
          <line className={css.circuitSymbol} x1={cx - half} y1={cy} x2={cx - pivot} y2={cy} />
          <line className={css.circuitSymbol} x1={cx + pivot} y1={cy} x2={cx + half} y2={cy} />
          {/* Pivot dots scale with the symbol family (meter circles use
              0.42·scale); a fixed px radius drifts off the schematic when the
              bench zooms. */}
          <circle className={css.circuitSymbolFill} cx={cx - pivot} cy={cy} r={Math.max(1.6, 0.09 * scale)} />
          <circle className={css.circuitSymbolFill} cx={cx + pivot} cy={cy} r={Math.max(1.6, 0.09 * scale)} />
          <line className={css.circuitSymbol} x1={cx - pivot} y1={cy} x2={leverX} y2={leverY} />
        </g>
      )
    }
    case 'ammeter':
    case 'voltmeter': {
      const radius = 0.42 * scale
      return (
        <>
          <line className={css.circuitSymbol} x1={cx - half} y1={cy} x2={cx - radius} y2={cy} />
          <line className={css.circuitSymbol} x1={cx + radius} y1={cy} x2={cx + half} y2={cy} />
          <circle className={clsxJoin(css.circuitSymbol, css.circuitMeterFace)} cx={cx} cy={cy} r={radius} />
        </>
      )
    }
  }
}

/** Current direction arrow beside the symbol, in the rotated local frame. */
function CurrentArrow({ component, cx, cy, scale }: SymbolProps) {
  const y = cy + 0.56 * scale
  const span = 0.38 * scale
  const forward = component.currentDirection !== 'reverse'
  const fromX = forward ? cx - span : cx + span
  const toX = forward ? cx + span : cx - span
  const head = 4.6
  const direction = forward ? 1 : -1
  return (
    <g data-testid={`current-${component.id}`}>
      <line className={css.circuitCurrent} x1={fromX} y1={y} x2={toX - direction * head * 0.6} y2={y} />
      <path
        className={css.circuitCurrentHead}
        d={`M${toX} ${y} L${toX - direction * head} ${y - head * 0.44} L${toX - direction * head} ${y + head * 0.44} Z`}
      />
    </g>
  )
}

/**
 * Circuit renderer. Registered for `domain: 'circuit'` in the renderer
 * registry; receives the shared frame and only reads the circuit primitives.
 */
export function CircuitRenderer({ view, projection, time }: RendererProps) {
  const components = view.circuitComponents ?? []
  const wires = view.circuitWires ?? []
  const junctions = view.circuitJunctions ?? []
  const chargeFlows = view.chargeFlows ?? []
  const scale = projection.scale
  const lampGlowId = `circuit-lamp-glow-${projection.uid}`

  const showCurrent = view.visible.current === true
  const showVoltage = view.visible.voltage === true
  const showPower = view.visible.power === true

  return (
    <>
      <defs>
        <radialGradient id={lampGlowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffe6a8" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#f5a524" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#f5a524" stopOpacity="0" />
        </radialGradient>
      </defs>

      {wires.map(wire => (
        <path key={wire.id} className={css.circuitWire} d={projection.path(wire.points)} />
      ))}

      {/* Drifting charge carriers on each wire with a solved current: beads
          every ~14 px advance at a rate ∝ |I| (clamped), the current's sign
          setting the travel sense along the wire's path order. The phase is
          the engine clock — pause freezes the drift, scrubbing reverses it —
          and the layer rides the 电流 observable like the direction arrows. */}
      {showCurrent
        ? chargeFlows.map((flow) => {
          const screen = flow.path.map(point => ({
            x: projection.px(point),
            y: projection.py(point),
          }))
          const lengths: number[] = []
          let total = 0
          for (let index = 1; index < screen.length; index += 1) {
            const a = screen[index - 1]
            const b = screen[index]
            if (a === undefined || b === undefined) continue
            const length = Math.hypot(b.x - a.x, b.y - a.y)
            lengths.push(length)
            total += length
          }
          if (screen.length < 2 || total <= 0) return null
          const count = Math.max(2, Math.round(total / CHARGE_SPACING_PX))
          const stepLength = total / count
          const speed = Math.min(
            CHARGE_SPEED_MAX,
            Math.max(CHARGE_SPEED_MIN, Math.abs(flow.current) * CHARGE_SPEED_PER_AMP),
          )
          const advance =
            flow.current === 0 ? 0 : Math.sign(flow.current) * speed * (time ?? 0)
          return (
            <g key={flow.id} data-charge-flow={flow.id} aria-hidden="true">
              {Array.from({ length: count }, (_, index) => {
                const s = (((index * stepLength + advance) % total) + total) % total
                const dot = pointAlong(screen, lengths, s)
                return (
                  <circle
                    key={index}
                    className={css.circuitChargeDot}
                    cx={dot.x}
                    cy={dot.y}
                    r={2.4}
                  />
                )
              })}
            </g>
          )
        })
        : null}

      {junctions.map(junction => (
        <circle
          key={junction.id}
          className={css.circuitJunction}
          cx={projection.px(junction.at)}
          cy={projection.py(junction.at)}
          r={2.8}
        />
      ))}

      {components.map((component) => {
        const cx = projection.px(component.at)
        const cy = projection.py(component.at)
        /* Scene rotation is counter-clockwise with y up; SVG rotates clockwise
           with y down, so the same angle applies with its sign flipped. */
        const svgRotation = -component.rotation
        const vertical = isVertical(component.rotation)
        const highlighted = projection.highlighted(component.id)

        const meterReading = component.kind === 'ammeter'
          ? (showCurrent ? component.reading : undefined)
          : component.kind === 'voltmeter'
            ? (showVoltage ? component.reading : undefined)
            : undefined
        const rows: readonly { text: string; className: string }[] = [
          ...(component.value === undefined ? [] : [{ text: component.value, className: css.circuitAnnotation ?? '' }]),
          ...(meterReading === undefined ? [] : [{ text: meterReading, className: css.circuitReading ?? '' }]),
          ...(showCurrent && component.currentText !== undefined
            ? [{ text: component.currentText, className: css.circuitCurrentText ?? '' }]
            : []),
          ...(showVoltage && component.voltageText !== undefined
            ? [{ text: component.voltageText, className: css.circuitAnnotation ?? '' }]
            : []),
          ...(showPower && component.powerText !== undefined
            ? [{ text: component.powerText, className: css.circuitAnnotation ?? '' }]
            : []),
        ]

        /* Text anchors: above/below a horizontal symbol, left/right of a
           vertical one, so annotations never sit on the wire. */
        const labelAt: ScenePoint = vertical
          ? { x: cx - 0.62 * scale - 4, y: cy - (rows.length > 0 ? 0 : -4) }
          : { x: cx, y: cy - 0.5 * scale - 8 }
        const rowStart: ScenePoint = vertical
          ? { x: cx + 0.62 * scale + 4, y: cy - ((rows.length - 1) * 13) / 2 + 4 }
          : { x: cx, y: cy + 0.55 * scale + 13 }

        /* A dissipating load is drawn as a lamp: a warm halo behind the
           symbol whose radius and opacity scale with the bridge's normalized
           power — a dead or unsolved load carries no `glow` and stays dark. */
        const glow = component.glow ?? 0
        return (
          <g key={component.id} className={highlighted ? css.highlightGroup : undefined} data-component-id={component.id}>
            {glow > 0 ? (
              <circle
                data-testid={`glow-${component.id}`}
                className={css.circuitLampGlow}
                cx={cx}
                cy={cy}
                r={(0.55 + 0.75 * glow) * scale}
                fill={`url(#${lampGlowId})`}
                opacity={Math.min(1, 0.85 * glow)}
              />
            ) : null}
            <g transform={`rotate(${svgRotation} ${cx} ${cy})`}>
              <SymbolGeometry component={component} cx={cx} cy={cy} scale={scale} />
              {showCurrent && component.currentText !== undefined ? (
                <CurrentArrow component={component} cx={cx} cy={cy} scale={scale} />
              ) : null}
            </g>

            {component.kind === 'ammeter' || component.kind === 'voltmeter' ? (
              <text className={css.circuitMeterLetter} x={cx} y={cy + 4} textAnchor="middle">
                {component.kind === 'ammeter' ? 'A' : 'V'}
              </text>
            ) : null}

            <text
              className={css.circuitName}
              x={labelAt.x}
              y={labelAt.y}
              textAnchor={vertical ? 'end' : 'middle'}
            >
              {component.label}
            </text>

            {rows.map((row, index) => (
              <text
                key={`${component.id}-row-${index}`}
                className={row.className}
                x={rowStart.x}
                y={rowStart.y + index * 13}
                textAnchor={vertical ? 'start' : 'middle'}
              >
                {row.text}
              </text>
            ))}
          </g>
        )
      })}
    </>
  )
}
