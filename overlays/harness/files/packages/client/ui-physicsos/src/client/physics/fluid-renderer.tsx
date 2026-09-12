/**
 * Fluid statics renderer. Registered for `domain: 'fluid'` in the renderer
 * registry.
 *
 * Draws the textbook buoyancy rig: the tank with its liquid body, the surface
 * line, the spring scale with its live dial reading, the block hanging on the
 * wire with only its submerged part shaded, the V_排 dimension beside it, and
 * the free-body arrows. It reads ONLY the shared visual model — how deep the
 * block is and how long each arrow runs were produced by the engine and framed
 * upstream by the fluid visual bridge; nothing is computed here.
 *
 * Draw order is back-to-front: tank walls, liquid, surface guide, dimension,
 * scale and wire, then the block, then the force arrows on top so the reading
 * being explained is never buried.
 */

import type { RendererProps } from './renderer-registry.tsx'
import { ArrowMarkers, Dimension, Vectors, clsxJoin } from './primitives.tsx'
import css from './renderers.module.css'

/** The spring scale: a hanging dynamometer — barrel, dial window with a
 *  needle, and the top ring it hangs from. */
const ScaleGlyph = ({
  x,
  y,
  size,
  reading,
  highlighted,
}: {
  x: number
  y: number
  size: number
  reading: string
  highlighted: boolean
}) => (
  <g className={highlighted ? css.highlightGroup : undefined}>
    {/* Suspension ring the instrument hangs from; its bottom edge touches the
        barrel top. */}
    <circle
      className={css.fluidScaleRing}
      cx={x}
      cy={y - size * 0.86}
      r={size * 0.24}
    />
    {/* Barrel */}
    <rect
      className={css.fluidScaleBody}
      x={x - size * 0.9}
      y={y - size * 0.62}
      width={size * 1.8}
      height={size * 1.24}
      rx={size * 0.26}
    />
    {/* Dial window with the live reading */}
    <rect
      className={css.fluidScaleDial}
      x={x - size * 0.68}
      y={y - size * 0.4}
      width={size * 1.36}
      height={size * 0.8}
      rx={size * 0.14}
    />
    <text className={css.fluidScaleReading} x={x} y={y + size * 0.16} textAnchor="middle">
      {reading}
    </text>
    {/* Bottom hook the wire attaches to */}
    <path
      className={css.fluidScaleRing}
      d={`M${x} ${y + size * 0.62} v${size * 0.1} a${size * 0.16} ${size * 0.16} 0 1 0 ${size * 0.02} ${size * 0.24}`}
    />
  </g>
)

export function FluidRenderer({ view, projection }: RendererProps) {
  const showForces = view.visible.forces === true
  const showDisplaced = view.visible.displaced === true
  const liquid = view.fluidLiquid
  const block = view.fluidBlock
  const scale = view.fluidScale

  return (
    <>
      <defs>
        <ArrowMarkers uid={projection.uid} />
      </defs>

      {/* Tank: liquid body first (gradient depth), then the glass walls with
          rim lips, then the surface line — the level the displaced volume is
          measured against. */}
      {liquid === undefined ? null : (() => {
        const left = projection.px({ x: liquid.left, y: 0 })
        const right = projection.px({ x: liquid.right, y: 0 })
        const surfaceY = projection.py({ x: 0, y: liquid.surface })
        const floorY = projection.py({ x: 0, y: liquid.floor })
        const lipY = projection.py({ x: 0, y: liquid.surface + (liquid.surface - liquid.floor) * 0.18 })
        return (
        <g className={projection.highlighted(liquid.id) ? css.highlightGroup : undefined}>
          <defs>
            <linearGradient id={`fluid-liquid-${projection.uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#dcedf9" />
              <stop offset="1" stopColor="#a8cbe8" />
            </linearGradient>
          </defs>
          <rect
            className={css.fluidLiquidBody}
            x={left}
            y={surfaceY}
            width={right - left}
            height={floorY - surfaceY}
            style={{ fill: `url(#fluid-liquid-${projection.uid})` }}
          />
          {/* Meniscus: the surface line across the whole tank */}
          <line
            className={css.fluidSurface}
            x1={left}
            y1={surfaceY}
            x2={right}
            y2={surfaceY}
          />
          <path
            className={css.fluidTankWall}
            d={[
              `M${left - 4} ${lipY - 3}`,
              `L${left} ${lipY}`,
              `V${floorY - 6}`,
              `Q${left} ${floorY} ${left + 6} ${floorY}`,
              `H${right - 6}`,
              `Q${right} ${floorY} ${right} ${floorY - 6}`,
              `V${lipY}`,
              `L${right + 4} ${lipY - 3}`,
            ].join(' ')}
          />
          {liquid.label === undefined ? null : (
            <text
              className={css.annotation}
              x={projection.px({ x: liquid.right, y: 0 }) - 8}
              y={projection.py({ x: 0, y: liquid.floor }) - 8}
              textAnchor="end"
            >
              {liquid.label}
            </text>
          )}
        </g>
        )
      })()}

      {/* Surface line continued across the whole tank */}
      {showDisplaced
        ? view.guides.map(guide => (
          <g key={guide.id}>
            <line
              className={css.fluidSurfaceLine}
              x1={projection.px(guide.from)}
              y1={projection.py(guide.from)}
              x2={projection.px(guide.to)}
              y2={projection.py(guide.to)}
            />
            {guide.label === undefined ? null : (
              <text
                className={css.fluidSurfaceLabel}
                x={projection.px(guide.to) - 6}
                y={projection.py(guide.to) - 6}
                textAnchor="end"
              >
                {guide.label}
              </text>
            )}
          </g>
        ))
        : null}

      {showDisplaced
        ? view.dimensions.map(dimension => (
          <Dimension key={dimension.id} dimension={dimension} projection={projection} />
        ))
        : null}

      {/* Spring scale and the wire down to the block */}
      {scale === undefined || block === undefined ? null : (() => {
        const size = Math.max(16, Math.min(38, block.halfHeight * projection.scale * 0.9))
        return (
        <g>
          <line
            className={css.fluidWire}
            x1={projection.px(scale.at)}
            y1={projection.py(scale.at) + size * 0.72}
            x2={projection.px(block.at)}
            y2={projection.py({ x: block.at.x, y: block.at.y + block.halfHeight })}
          />
          <ScaleGlyph
            x={projection.px(scale.at)}
            y={projection.py(scale.at)}
            size={size}
            reading={scale.reading}
            highlighted={projection.highlighted(scale.id)}
          />
          {scale.label === undefined ? null : (
            <text
              className={css.annotation}
              x={projection.px(scale.at)}
              y={projection.py(scale.at) - Math.max(16, block.halfHeight * projection.scale) - 6}
              textAnchor="middle"
            >
              {scale.label}
            </text>
          )}
        </g>
        )
      })()}

      {/* The block: full outline, with only the submerged slab shaded */}
      {block === undefined ? null : (
        <g className={projection.highlighted(block.id) ? css.highlightGroup : undefined}>
          <rect
            className={clsxJoin(
              css.fluidBlockBody,
              block.phase === 'floating' && css.fluidBlockFloating,
            )}
            x={projection.px({ x: block.at.x - block.halfWidth, y: 0 })}
            y={projection.py({ x: 0, y: block.at.y + block.halfHeight })}
            width={block.halfWidth * 2 * projection.scale}
            height={block.halfHeight * 2 * projection.scale}
          />
          {block.submergedTop <= block.at.y - block.halfHeight ? null : (
            <rect
              className={css.fluidBlockSubmerged}
              x={projection.px({ x: block.at.x - block.halfWidth, y: 0 })}
              y={projection.py({ x: 0, y: block.submergedTop })}
              width={block.halfWidth * 2 * projection.scale}
              height={
                projection.py({ x: 0, y: block.at.y - block.halfHeight }) -
                projection.py({ x: 0, y: block.submergedTop })
              }
            />
          )}
          {block.label === undefined ? null : (
            <text
              className={css.annotation}
              x={projection.px({ x: block.at.x - block.halfWidth, y: 0 }) - 8}
              y={projection.py(block.at)}
              textAnchor="end"
            >
              {block.label}
            </text>
          )}
        </g>
      )}

      {/* Free-body arrows last so G / F_浮 / F_示 read over the apparatus */}
      {showForces ? <Vectors vectors={view.vectors} projection={projection} /> : null}
    </>
  )
}
