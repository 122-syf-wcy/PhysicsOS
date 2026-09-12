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
  const lampBloomId = `circuit-lamp-bloom-${projection.uid}`
  const lampCoreId = `circuit-lamp-core-${projection.uid}`

  const showCurrent = view.visible.current === true
  const showVoltage = view.visible.voltage === true
  const showPower = view.visible.power === true

  return (
    <>
      <defs>
        {/* Three stops of one warm ramp: the core blows out near-white, the
            glow disc carries the body of the light, the bloom is the wide
            falloff that spills onto the wires around the bulb. Stops stay
            literal rather than token-driven — this gradient is the one place
            a missing var() would silently paint nothing, and it already
            worked that way. */}
        <radialGradient id={lampGlowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffe6a8" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#f5a524" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#f5a524" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={lampBloomId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ff9d2e" stopOpacity="0.42" />
          <stop offset="60%" stopColor="#ff9d2e" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#ff9d2e" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={lampCoreId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff8e6" stopOpacity="1" />
          <stop offset="70%" stopColor="#fff8e6" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#fff8e6" stopOpacity="0" />
        </radialGradient>
      </defs>

      {wires.map(wire => (
        <path key={wire.id} className={css.circuitWire} d={projection.path(wire.points)} />
      ))}

      {/* Current as travelling light: one dashed path per conducting run, the
          pattern advanced by stroke-dashoffset each frame. The advance is ∝ |I|
          (clamped) and its SIGN follows the solved current, so a run carrying
          reversed current streams the other way. Only the dash phase moves —
          the geometry is the wire's own polyline — which is how the drawing
          stays per-segment KCL-honest while reading as charge in motion. */}
      {showCurrent
        ? chargeFlows.map((flow) => {
          const speed = Math.min(
            CHARGE_SPEED_MAX,
            Math.max(CHARGE_SPEED_MIN, Math.abs(flow.current) * CHARGE_SPEED_PER_AMP),
          )
          /* Decreasing dashoffset walks the pattern forward along the path. */
          const advance =
            flow.current === 0 ? 0 : -Math.sign(flow.current) * speed * (time ?? 0)
          return (
            <path
              key={flow.id}
              className={css.circuitChargeFlow}
              data-charge-flow={flow.id}
              data-current-sign={
                flow.current > 0 ? 'forward' : flow.current < 0 ? 'reverse' : 'idle'
              }
              d={projection.path(flow.path)}
              strokeDasharray={`0.1 ${CHARGE_SPACING_PX}`}
              strokeDashoffset={advance}
              aria-hidden="true"
            />
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
            {/* Light, laid down before the part: the bloom is thrown widest and
                softest, the disc carries the body of the light, the core is the
                hot centre. Bloom and core blend in `screen` (see the CSS) so
                they add light to the bench instead of painting a disc over it.
                The disc keeps the measured `r`/`opacity` that the glow tests
                read, so brightness still tracks dissipation exactly. */}
            {glow > 0 ? (
              <>
                <circle
                  className={css.circuitLampBloom}
                  cx={cx}
                  cy={cy}
                  r={(1.5 + 2.6 * glow) * scale}
                  fill={`url(#${lampBloomId})`}
                  opacity={Math.min(1, 0.9 * glow)}
                />
                <circle
                  data-testid={`glow-${component.id}`}
                  className={css.circuitLampGlow}
                  cx={cx}
                  cy={cy}
                  r={(0.55 + 0.75 * glow) * scale}
                  fill={`url(#${lampGlowId})`}
                  opacity={Math.min(1, 0.85 * glow)}
                />
                <circle
                  className={css.circuitLampCore}
                  cx={cx}
                  cy={cy}
                  r={(0.32 + 0.3 * glow) * scale}
                  fill={`url(#${lampCoreId})`}
                  opacity={Math.min(1, 1.05 * glow)}
                />
              </>
            ) : null}
            <g transform={`rotate(${svgRotation} ${cx} ${cy})`}>
              <SymbolGeometry component={component} cx={cx} cy={cy} scale={scale} />
              {/* Hot wire, behind nothing: the filament is what separates a lit
                  load from a dead one. Its brightness rides the same normalized
                  glow the halo uses, so the two can never disagree about how
                  hard the element is working. */}
              {component.glow !== undefined ? (
                <path
                  data-testid={`filament-${component.id}`}
                  className={css.circuitLampFilament}
                  d={
                    `M${cx - 0.62 * scale} ${cy}`
                    + ` L${cx - 0.42 * scale} ${cy - 0.2 * scale}`
                    + ` L${cx - 0.2 * scale} ${cy + 0.2 * scale}`
                    + ` L${cx} ${cy - 0.14 * scale}`
                    + ` L${cx + 0.2 * scale} ${cy + 0.2 * scale}`
                    + ` L${cx + 0.42 * scale} ${cy - 0.2 * scale}`
                    + ` L${cx + 0.62 * scale} ${cy}`
                  }
                  opacity={Math.min(1, 0.25 + 0.75 * glow)}
                />
              ) : null}
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
