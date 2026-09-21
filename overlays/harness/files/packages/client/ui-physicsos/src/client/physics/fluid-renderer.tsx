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

import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { RendererProps } from './renderer-registry.tsx'
import type { ScenePoint } from './scene-visual-model.ts'
import { ArrowMarkers, Dimension, Vectors, clsxJoin } from './primitives.tsx'
import css from './renderers.module.css'

/** The spring scale: a hanging dynamometer — barrel, dial window with a
 *  needle, and the top ring it hangs from. */
const ScaleGlyph = ({
  x,
  y,
  size,
  reading,
  dialFraction,
  highlighted,
}: {
  x: number
  y: number
  size: number
  reading: string
  /** Needle deflection 0..1; undefined draws the dial without a needle. */
  dialFraction?: number | undefined
  highlighted: boolean
}) => {
  /* The needle hangs from the dial's top edge and sweeps its upper half:
     zero sits 50° left of straight down, full deflection 50° right. */
  const needleAngle = ((140 - (dialFraction ?? 0) * 100) * Math.PI) / 180
  const pivotY = y - size * 0.34
  const tip = {
    x: x + size * 0.3 * Math.cos(needleAngle),
    y: pivotY + size * 0.3 * Math.sin(needleAngle),
  }
  return (
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
    {dialFraction === undefined ? null : (
      <g data-testid="scale-needle">
        <line
          className={css.fluidScaleNeedle}
          x1={x}
          y1={pivotY}
          x2={tip.x}
          y2={tip.y}
        />
        <circle className={css.fluidScalePivot} cx={x} cy={pivotY} r={size * 0.045} />
      </g>
    )}
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
}

export function FluidRenderer({ view, projection, componentDrag }: RendererProps) {
  const showForces = view.visible.forces === true
  const showDisplaced = view.visible.displaced === true
  const liquid = view.fluidLiquid
  const block = view.fluidBlock
  const scale = view.fluidScale

  /* Block grab: the pointer pulls the block's centre along the descent line —
     a live scrub of the immersion clock, not a free reposition. grabY keeps
     the distance between the press point and the centre so the part does not
     jump to the finger; ~3 px of travel declares a drag over a click. */
  const dragRef = useRef<{ pointerId: number; grabY: number; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)

  const sceneAt = (event: ReactPointerEvent<SVGGElement>): ScenePoint | undefined => {
    const svg = event.currentTarget.ownerSVGElement
    if (svg === null) return undefined
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return undefined
    const viewBox = svg.viewBox.baseVal
    if (viewBox.width === 0 || viewBox.height === 0) return undefined
    const viewX = viewBox.x + ((event.clientX - rect.left) / rect.width) * viewBox.width
    const viewY = viewBox.y + ((event.clientY - rect.top) / rect.height) * viewBox.height
    return { x: projection.sx(viewX), y: projection.sy(viewY) }
  }

  const onBlockPointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    if (componentDrag === undefined || block === undefined) return
    const at = sceneAt(event)
    if (at === undefined) return
    /* jsdom has no pointer capture — the guard keeps the spec DOM happy. */
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    dragRef.current = { pointerId: event.pointerId, grabY: at.y - block.at.y, moved: false }
    event.stopPropagation()
  }

  const onBlockPointerMove = (event: ReactPointerEvent<SVGGElement>) => {
    const drag = dragRef.current
    if (drag === null || event.pointerId !== drag.pointerId || block === undefined) return
    const at = sceneAt(event)
    if (at === undefined) return
    const y = at.y - drag.grabY
    if (!drag.moved) {
      if (Math.abs(y - block.at.y) * projection.scale < 3) return
      drag.moved = true
      setDragging(true)
    }
    componentDrag?.preview(block.id, { x: block.at.x, y })
  }

  const endBlockDrag = (event: ReactPointerEvent<SVGGElement>) => {
    const drag = dragRef.current
    if (drag === null || event.pointerId !== drag.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (!drag.moved || block === undefined) return
    const at = sceneAt(event)
    if (at === undefined) return
    componentDrag?.commit(block.id, { x: block.at.x, y: at.y - drag.grabY })
  }

  const cancelBlockDrag = (event: ReactPointerEvent<SVGGElement>) => {
    const drag = dragRef.current
    if (drag === null || event.pointerId !== drag.pointerId) return
    dragRef.current = null
    setDragging(false)
    componentDrag?.cancel()
  }

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
            dialFraction={scale.dialFraction}
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

      {/* The block: full outline, with only the submerged slab shaded. When the
          workspace exposes the drag channel it is also the descent handle —
          pulling it scrubs the immersion clock. */}
      {block === undefined ? null : (
        <g
          className={clsxJoin(
            projection.highlighted(block.id) ? css.highlightGroup : undefined,
            componentDrag === undefined ? undefined : css.fluidDraggable,
            dragging ? css.fluidDragging : undefined,
          )}
          onPointerDown={componentDrag === undefined ? undefined : onBlockPointerDown}
          onPointerMove={componentDrag === undefined ? undefined : onBlockPointerMove}
          onPointerUp={componentDrag === undefined ? undefined : endBlockDrag}
          onPointerCancel={componentDrag === undefined ? undefined : cancelBlockDrag}
        >
          {componentDrag === undefined ? null : <title>拖动物块改变浸入深度，读数实时跟随</title>}
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
