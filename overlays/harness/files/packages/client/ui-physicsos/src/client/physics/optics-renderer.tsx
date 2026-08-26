/**
 * Optics renderer. Registered for `domain: 'optics'` in the renderer registry.
 *
 * Draws the textbook single-axis bench: principal axis with F/2F ticks, the
 * upright object arrow, the imaging element (convex lens double-arrow or plane
 * mirror plate), the principal rays with their dashed virtual extensions, the
 * image arrow (solid = real, dashed = virtual) and the screen. It reads ONLY
 * the shared visual model — every position, height and ray vertex was produced
 * by the engine and converted upstream by the optics visual bridge; nothing is
 * imaged here.
 *
 * Draw order is back-to-front: axis and marks, ray extensions, rays, element,
 * screen, object and image last so the pieces a student reasons about are
 * never buried under a ray.
 */

import type { ScenePoint } from './scene-visual-model.ts'
import type { RendererProjection, RendererProps } from './renderer-registry.tsx'
import { clsxJoin } from './primitives.tsx'
import css from './renderers.module.css'

/** Arrowhead polygon at the tip of a screen-space segment. */
const headAt = (x: number, y: number, ux: number, uy: number, size: number): string => {
  const bx = x - ux * size
  const by = y - uy * size
  const px = -uy * size * 0.46
  const py = ux * size * 0.46
  return `M${x} ${y} L${bx + px} ${by + py} L${bx - px} ${by - py} Z`
}

/** Direction chevron at the midpoint of one ray segment; null when too short. */
const rayChevron = (
  from: ScenePoint,
  to: ScenePoint,
  projection: RendererProjection,
): string | null => {
  const x1 = projection.px(from)
  const y1 = projection.py(from)
  const x2 = projection.px(to)
  const y2 = projection.py(to)
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy)
  if (length < 30) return null
  const ux = dx / length
  const uy = dy / length
  return headAt((x1 + x2) / 2, (y1 + y2) / 2, ux, uy, 7)
}

/** Vertical arrow (object / image): shaft plus a filled head at the tip. */
const VerticalArrow = ({
  x,
  footY,
  topY,
  lineClass,
  headClass,
}: {
  x: number
  footY: number
  topY: number
  lineClass: string | undefined
  headClass: string | undefined
}) => {
  const up = topY < footY
  const shaftEnd = topY + (up ? 8 : -8)
  return (
    <>
      <line className={lineClass} x1={x} y1={footY} x2={x} y2={shaftEnd} />
      <path className={headClass} d={headAt(x, topY, 0, up ? -1 : 1, 9)} />
    </>
  )
}

export function OpticsRenderer({ view, projection }: RendererProps) {
  const axisY = projection.py({ x: 0, y: 0 })
  const left = projection.px({ x: view.origin.x, y: 0 })
  const right = projection.px({ x: view.origin.x + view.extent.width, y: 0 })
  const showRays = view.visible.rays === true
  const showImage = view.visible.image === true

  return (
    <>
      {/* Principal axis */}
      <line className={css.opticalAxis} x1={left} y1={axisY} x2={right} y2={axisY} />

      {/* F / 2F ticks */}
      {(view.opticalAxisMarks ?? []).map((mark) => {
        const x = projection.px(mark.at)
        return (
          <g key={mark.id}>
            <line className={css.focalTick} x1={x} y1={axisY - 5} x2={x} y2={axisY + 5} />
            <text className={css.focalLabel} x={x} y={axisY + 18} textAnchor="middle">
              {mark.label}
            </text>
          </g>
        )
      })}

      {/* Dashed virtual back-extensions, under the physical rays */}
      {showRays
        ? (view.opticalRays ?? []).map(ray =>
          ray.extension === undefined ? null : (
            <path
              key={`${ray.id}-extension`}
              className={css.opticalRayExtension}
              d={projection.path(ray.extension)}
            />
          ))
        : null}

      {/* Physical light paths with direction chevrons before and after the element */}
      {showRays
        ? (view.opticalRays ?? []).map((ray) => {
          const chevrons: string[] = []
          const first = ray.points[0]
          const second = ray.points[1]
          const third = ray.points[2]
          if (first !== undefined && second !== undefined) {
            const chevron = rayChevron(first, second, projection)
            if (chevron !== null) chevrons.push(chevron)
          }
          if (second !== undefined && third !== undefined) {
            const chevron = rayChevron(second, third, projection)
            if (chevron !== null) chevrons.push(chevron)
          }
          return (
            <g key={ray.id}>
              <path className={css.opticalRay} d={projection.path(ray.points)} />
              {chevrons.map((chevron, index) => (
                <path key={index} className={css.opticalRayHead} d={chevron} />
              ))}
            </g>
          )
        })
        : null}

      {/* Imaging elements */}
      {(view.opticalElements ?? []).map((element) => {
        const x = projection.px(element.at)
        const topY = projection.py({ x: 0, y: element.at.y + element.halfAperture })
        const bottomY = projection.py({ x: 0, y: element.at.y - element.halfAperture })
        const highlighted = projection.highlighted(element.id)
        if (element.kind === 'thin_lens') {
          return (
            <g key={element.id} className={highlighted ? css.highlightGroup : undefined}>
              <ellipse
                className={css.lensBody}
                cx={x}
                cy={(topY + bottomY) / 2}
                rx={Math.max(5, (bottomY - topY) * 0.09)}
                ry={(bottomY - topY) / 2}
              />
              <line className={css.lensAxisLine} x1={x} y1={topY + 2} x2={x} y2={bottomY - 2} />
              <path className={css.lensHead} d={headAt(x, topY, 0, -1, 8)} />
              <path className={css.lensHead} d={headAt(x, bottomY, 0, 1, 8)} />
              {element.label === undefined ? null : (
                <text className={css.annotation} x={x} y={topY - 8} textAnchor="middle">
                  {element.label}
                </text>
              )}
            </g>
          )
        }
        /* Plane mirror: reflective face towards the object (−x); hatching marks
           the silvered back on the +x side. */
        const hatchCount = Math.max(4, Math.floor((bottomY - topY) / 12))
        return (
          <g key={element.id} className={highlighted ? css.highlightGroup : undefined}>
            <line className={css.mirrorPlate} x1={x} y1={topY} x2={x} y2={bottomY} />
            {Array.from({ length: hatchCount }, (_, index) => {
              const y = topY + ((index + 0.5) / hatchCount) * (bottomY - topY)
              return (
                <line
                  key={index}
                  className={css.mirrorHatch}
                  x1={x + 1.5}
                  y1={y + 4}
                  x2={x + 8}
                  y2={y - 4}
                />
              )
            })}
            {element.label === undefined ? null : (
              <text className={css.annotation} x={x} y={topY - 8} textAnchor="middle">
                {element.label}
              </text>
            )}
          </g>
        )
      })}

      {/* Screens */}
      {(view.opticalScreens ?? []).map((screen) => {
        const x = projection.px(screen.at)
        const topY = projection.py({ x: 0, y: screen.at.y + screen.halfHeight })
        const bottomY = projection.py({ x: 0, y: screen.at.y - screen.halfHeight })
        const highlighted = projection.highlighted(screen.id)
        return (
          <g key={screen.id} className={highlighted ? css.highlightGroup : undefined}>
            {screen.lit ? (
              <line className={css.screenGlow} x1={x} y1={topY} x2={x} y2={bottomY} />
            ) : null}
            <line
              className={clsxJoin(css.screenPlate, screen.lit && css.screenPlateLit)}
              x1={x}
              y1={topY}
              x2={x}
              y2={bottomY}
            />
            <line className={css.screenFoot} x1={x - 9} y1={axisY + 1} x2={x + 9} y2={axisY + 1} />
            {screen.label === undefined ? null : (
              <text className={css.annotation} x={x} y={topY - 8} textAnchor="middle">
                {screen.label}
              </text>
            )}
          </g>
        )
      })}

      {/* Luminous objects */}
      {(view.opticalObjects ?? []).map((object) => {
        const x = projection.px(object.at)
        const footY = projection.py(object.at)
        const topY = projection.py({ x: 0, y: object.at.y + object.height })
        const highlighted = projection.highlighted(object.id)
        return (
          <g key={object.id} className={highlighted ? css.highlightGroup : undefined}>
            <VerticalArrow
              x={x}
              footY={footY}
              topY={topY}
              lineClass={css.opticalObjectLine}
              headClass={css.opticalObjectHead}
            />
            {object.label === undefined ? null : (
              <text className={css.annotation} x={x} y={footY + 18} textAnchor="middle">
                {object.label}
              </text>
            )}
          </g>
        )
      })}

      {/* Formed images — dashes carry the virtual/real statement */}
      {showImage
        ? (view.opticalImages ?? []).map((image) => {
          const x = projection.px(image.at)
          const footY = projection.py(image.at)
          const topY = projection.py({ x: 0, y: image.at.y + image.height })
          const inverted = image.height < 0
          const highlighted = projection.highlighted(image.id)
          return (
            <g key={image.id} className={highlighted ? css.highlightGroup : undefined}>
              <VerticalArrow
                x={x}
                footY={footY}
                topY={topY}
                lineClass={clsxJoin(
                  css.opticalImageLine,
                  image.nature === 'virtual' && css.opticalImageVirtual,
                )}
                headClass={css.opticalImageHead}
              />
              {image.label === undefined ? null : (
                <text
                  className={clsxJoin(css.annotation, css.opticalImageLabel)}
                  x={x}
                  y={inverted ? footY - 8 : footY + 18}
                  textAnchor="middle"
                >
                  {image.label}
                </text>
              )}
            </g>
          )
        })
        : null}
    </>
  )
}
