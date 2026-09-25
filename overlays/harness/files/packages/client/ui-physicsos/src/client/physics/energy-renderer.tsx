/**
 * Mechanical-energy rig renderer.
 *
 * Draws the ramp the cart is released on, the cart itself at the top, the two
 * dimensions that fix the geometry, and the LEDGER BAR underneath — three
 * segments whose widths are the shares of the energy the cart started with.
 *
 * The bar is the figure's whole argument, so it is drawn from the visual model's
 * fractions and never rescaled here: a bar that added up to the wrong length
 * would be claiming a conservation the engine had not verified.
 */

import type { RendererProps } from './renderer-registry.tsx'
import { Dimension, MathLabel } from './primitives.tsx'
import css from './renderers.module.css'

/** Which ink a ledger segment takes. One class per role, never a literal hex. */
/** How far the cart is held off the peak, on top of its own half-length (cm). */
const INK_MARGIN = 3.5

const SEGMENT_CLASS = {
  potential: css.energySegmentPotential,
  kinetic: css.energySegmentKinetic,
  thermal: css.energySegmentThermal,
} as const

export function EnergyRenderer({ view, projection }: RendererProps) {
  const ramp = view.energyRamp
  const bar = view.energyBar
  if (ramp === undefined) return null

  const footX = projection.px(ramp.base)
  const footY = projection.py(ramp.base)
  const peakX = projection.px(ramp.peak)
  const peakY = projection.py(ramp.peak)

  /* The cart sits ON the slope at the release point, tilted with it: the angle
     comes from the two corners the engine placed, not from a stored rotation. */
  const slope = Math.atan2(ramp.peak.y - ramp.base.y, ramp.peak.x - ramp.base.x)
  const cartLength = ramp.cartLength * projection.scale
  const cartHalf = ramp.cartHalfHeight * projection.scale
  /* Set back from the peak by half its own length AND a margin, so the tilted
     box stays on the slope: centred on the peak the cart's top corner hangs
     past the end of the ramp, which is a body drawn where the ramp is not. */
  const cartSetback = cartLength * 0.5 + INK_MARGIN * projection.scale
  const cartCentre = {
    x: peakX - Math.cos(slope) * cartSetback,
    y: peakY + Math.sin(slope) * cartSetback,
  }
  const tilt = (-slope * 180) / Math.PI

  return (
    <>
      {/* The ramp: a surface with thickness, and the ground it stands on. */}
      <path
        className={css.energyRampBody}
        data-testid="energy-ramp"
        d={`M${footX} ${footY} L${peakX} ${peakY} L${peakX} ${footY} Z`}
      />
      <line
        className={css.energyRampSurface}
        x1={footX}
        y1={footY}
        x2={peakX}
        y2={peakY}
      />

      {/* The cart, released from the top. */}
      <rect
        className={css.energyCart}
        data-testid="energy-cart"
        x={cartCentre.x - cartLength / 2}
        y={cartCentre.y - cartHalf}
        width={cartLength}
        height={cartHalf * 2}
        rx={1.4}
        transform={`rotate(${tilt} ${cartCentre.x} ${cartCentre.y})`}
      />

      {/* The dials the rig is read for, at the two ends of the trip. */}
      <MathLabel
        x={peakX + 8}
        y={peakY + 4}
        anchor="start"
        symbol={ramp.potentialText}
        className={css.currentReading}
      />
      <MathLabel
        x={footX - 8}
        y={footY + 4}
        anchor="end"
        symbol={`${ramp.kineticText} · ${ramp.speedText}`}
        className={css.currentReading}
      />

      {bar === undefined ? null : (() => {
        const barX = projection.px(bar.at)
        const barY = projection.py(bar.at)
        const barWidth = bar.width * projection.scale
        const barHeight = bar.height * projection.scale
        /* Widths come from the fractions, cumulatively — the segments stack. */
        let cursor = barX
        const rects = bar.segments.map((segment) => {
          const width = barWidth * segment.fraction
          const rect = (
            <rect
              key={segment.id}
              className={SEGMENT_CLASS[segment.role]}
              data-testid={`energy-segment-${segment.id}`}
              x={cursor}
              y={barY - barHeight}
              width={width}
              height={barHeight}
            />
          )
          cursor += width
          return rect
        })
        return (
          <g data-testid="energy-bar">
            <rect
              className={css.energyBarFrame}
              x={barX}
              y={barY - barHeight}
              width={barWidth}
              height={barHeight}
              rx={1.2}
            />
            {rects}
            <MathLabel
              x={barX + barWidth / 2}
              y={barY + 22}
              anchor="middle"
              symbol={bar.totalText}
              className={css.currentReading}
            />
            {bar.segments.map((segment, index) => (
              <MathLabel
                key={segment.id}
                x={index === 0 ? barX : barX + barWidth}
                y={barY + 40}
                anchor={index === 0 ? 'start' : 'end'}
                symbol={segment.text}
                className={css.currentReading}
              />
            ))}
          </g>
        )
      })()}

      {view.dimensions.map(dimension => (
        <Dimension key={dimension.id} dimension={dimension} projection={projection} />
      ))}

      {/* The surface itself is a dimension's worth of apparatus, so it is drawn
          last: nothing the ledger says may end up under it. */}
      <title>{ramp.label ?? '斜面'}</title>
    </>
  )
}
