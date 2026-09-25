/**
 * Transformer renderer: one core, two windings, and the readings beside each.
 *
 * The loop counts are INK — a thousand turns cannot be drawn as a thousand
 * loops, and a reader who counted them would be reading the drawing rather than
 * the machine. What the rig actually states is the numbers, which are drawn as
 * text.
 */

import type { RendererProps } from './renderer-registry.tsx'
import { MathLabel } from './primitives.tsx'
import css from './renderers.module.css'

export function TransformerRenderer({ view, projection }: RendererProps) {
  const coils = view.transformerCoils ?? []
  const core = view.transformerCore
  if (core === undefined || coils.length === 0) return null

  const coreY = projection.py(core.from)
  const halfHeight = core.halfHeight * projection.scale

  return (
    <>
      {/* The core both windings share — the one thing that makes them one
          machine rather than two coils. */}
      <rect
        className={css.transformerCore}
        data-testid="transformer-core"
        x={projection.px(core.from)}
        y={coreY - halfHeight}
        width={projection.px(core.to) - projection.px(core.from)}
        height={2 * halfHeight}
        rx={1}
      />

      {coils.map((coil) => {
        const cx = projection.px(coil.at)
        const cy = projection.py(coil.at)
        const halfWidth = coil.halfWidth * projection.scale
        const coilHeight = coil.halfHeight * projection.scale
        const spacing = (2 * halfWidth) / coil.turnsLoops
        const loops = Array.from({ length: coil.turnsLoops }, (_, index) => index)
        /* The driven winding takes the source's ink; the output winding the
           measurement ink — which one is driving is the rig's own statement. */
        const loopClass = coil.primary ? css.transformerPrimaryLoop : css.transformerSecondaryLoop
        return (
          <g key={coil.id} data-testid={`transformer-${coil.primary ? 'primary' : 'secondary'}`}>
            {loops.map(index => (
              <ellipse
                key={index}
                className={loopClass}
                cx={cx - halfWidth + spacing * (index + 0.5)}
                cy={cy}
                rx={spacing * 0.34}
                ry={coilHeight}
              />
            ))}
            <MathLabel
              x={cx - halfWidth}
              y={cy - coilHeight - 24}
              anchor="start"
              symbol={coil.voltageText}
              className={css.currentReading}
            />
            <MathLabel
              x={cx - halfWidth}
              y={cy - coilHeight - 6}
              anchor="start"
              symbol={coil.turnsText}
              className={css.currentReading}
            />
            <MathLabel
              x={cx - halfWidth}
              y={cy + coilHeight + 14}
              anchor="start"
              symbol={coil.currentText}
              className={css.currentReading}
            />
          </g>
        )
      })}

      {/* The machine's own two numbers, above the core between the windings. */}
      <MathLabel
        x={projection.px({ x: 0, y: 0 })}
        y={coreY - 4}
        anchor="middle"
        symbol={core.ratioText}
        className={css.currentReading}
      />
      <MathLabel
        x={projection.px({ x: 0, y: 0 })}
        y={coreY + 16}
        anchor="middle"
        symbol={core.powerText}
        className={css.currentReading}
      />
    </>
  )
}
