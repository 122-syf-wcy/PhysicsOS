/**
 * Thermometer renderer: the bulb, the tube, the column — and the two fixed
 * points marked where they actually are.
 *
 * The figure is drawn to scale (the bridge sized it in centimetres of glass), so
 * the distance between 0 °C and 100 °C on screen is the instrument's real span.
 * That distance IS the experiment: the span gets divided into a hundred degrees,
 * and a longer span is a finer scale.
 */

import type { RendererProps } from './renderer-registry.tsx'
import { ArrowMarkers, MathLabel } from './primitives.tsx'
import css from './renderers.module.css'

/** Where a tick's label sits, as a fraction of the scene's width. */
const TICK_LABEL_OFFSET = 0.8

export function ThermometerRenderer({ view, projection }: RendererProps) {
  const gauge = view.thermometer
  if (gauge === undefined) return null

  const cx = projection.px(gauge.at)
  const baseY = projection.py(gauge.at)
  const halfWidth = gauge.halfWidth * projection.scale
  const bulbRadius = gauge.bulbRadius * projection.scale
  const bulbY = baseY + bulbRadius * 0.7
  const tubeTopY = projection.py({ x: gauge.at.x, y: gauge.steamPoint + 1.2 })
  const columnTopY = projection.py({ x: gauge.at.x, y: gauge.columnTop })
  const iceY = projection.py({ x: gauge.at.x, y: gauge.icePoint })
  const steamY = projection.py({ x: gauge.at.x, y: gauge.steamPoint })
  const tickLength = halfWidth * 1.9

  return (
    <>
      <defs>
        <ArrowMarkers uid={projection.uid} />
      </defs>

      {/* The column first, so the glass is drawn over it. */}
      <rect
        className={css.thermometerColumn}
        data-testid="thermometer-column"
        x={cx - halfWidth}
        y={columnTopY}
        width={halfWidth * 2}
        height={baseY - columnTopY}
      />
      <circle className={css.thermometerColumn} cx={cx} cy={bulbY} r={bulbRadius} />

      {/* The glass: a tube rising from the bulb, closed at the top. */}
      <circle className={css.thermometerGlass} cx={cx} cy={bulbY} r={bulbRadius} />
      <path
        className={css.thermometerGlass}
        data-testid="thermometer-tube"
        d={`M${cx - halfWidth} ${baseY} V${tubeTopY + halfWidth} A${halfWidth} ${halfWidth} 0 0 1 ${cx + halfWidth} ${tubeTopY + halfWidth} V${baseY}`}
      />

      {/* The two fixed points, marked on the glass where they really are. */}
      {[
        { id: 'ice', y: iceY, label: '0 °C' },
        { id: 'steam', y: steamY, label: '100 °C' },
      ].map(tick => (
        <g key={tick.id} data-testid={`thermometer-tick-${tick.id}`}>
          <line
            className={css.thermometerTick}
            x1={cx + halfWidth}
            y1={tick.y}
            x2={cx + halfWidth + tickLength}
            y2={tick.y}
          />
          <MathLabel
            x={cx + halfWidth + tickLength + 4}
            y={tick.y + 4}
            anchor="start"
            symbol={tick.label}
            className={css.thermometerTickLabel}
          />
        </g>
      ))}

      {/* The reading, and the span the fixed points define. */}
      <MathLabel
        x={cx - halfWidth - 6}
        y={columnTopY + 4}
        anchor="end"
        symbol={gauge.temperatureText}
        className={css.currentReading}
      />
      <MathLabel
        x={cx - halfWidth - 6}
        y={columnTopY + 20}
        anchor="end"
        symbol={gauge.columnText}
        className={css.thermometerTickLabel}
      />
      {/* The span, drawn alongside the graduated part of the glass. */}
      <line
        className={css.thermometerSpan}
        x1={cx - halfWidth - TICK_LABEL_OFFSET * projection.scale}
        y1={iceY}
        x2={cx - halfWidth - TICK_LABEL_OFFSET * projection.scale}
        y2={steamY}
      />
      <MathLabel
        x={cx - halfWidth - TICK_LABEL_OFFSET * projection.scale - 4}
        y={(iceY + steamY) / 2}
        anchor="end"
        symbol={gauge.scaleText}
        className={css.thermometerTickLabel}
      />
    </>
  )
}
