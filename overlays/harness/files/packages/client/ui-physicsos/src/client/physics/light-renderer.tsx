/**
 * Pinhole rig renderer.
 *
 * Draws the object, the card with its hole, the screen behind it, and the two
 * rays that cross at the hole — which is the entire content of 光的直线传播, so
 * nothing here is decoration.
 *
 * The object and the image are drawn at their TRUE scene sizes (the bridge sized
 * them): the picture's claim is the RATIO between the two arrows, and an arrow
 * rescaled for looks would be the one place the experiment could lie. The
 * image's head points DOWN, because it does.
 */

import type { RendererProps } from './renderer-registry.tsx'
import { ArrowMarkers, Dimension, MathLabel } from './primitives.tsx'
import css from './renderers.module.css'

export function LightRenderer({ view, projection }: RendererProps) {
  const refraction = view.lightRefraction
  if (refraction !== undefined) return <RefractionRenderer refraction={refraction} projection={projection} />
  const rig = view.lightRig
  if (rig === undefined) return null

  const holeX = projection.px(rig.at)
  const holeY = projection.py(rig.at)
  const objectX = projection.px(rig.objectAt)
  const screenX = projection.px(rig.screenAt)
  const cardHalf = rig.cardHalfHeight * projection.scale
  const screenHalf = rig.screenHalfHeight * projection.scale
  const objectTop = projection.py({ x: rig.objectAt.x, y: rig.objectHalfHeight })
  const objectBottom = projection.py({ x: rig.objectAt.x, y: -rig.objectHalfHeight })
  const imageTop = projection.py(rig.imageTo)
  const imageBottom = projection.py(rig.imageFrom)

  return (
    <>
      <defs>
        <ArrowMarkers uid={projection.uid} />
      </defs>

      {/* The card the hole is punched in: two segments with the hole between
          them, so the light is visibly stopped everywhere except at the hole. */}
      <path
        className={css.holeCard}
        data-testid="light-card"
        d={`M${holeX} ${holeY - cardHalf} V${holeY - 3} M${holeX} ${holeY + 3} V${holeY + cardHalf}`}
      />

      {/* The rays first, so the apparatus is drawn over them. */}
      {rig.rays.map(ray => (
        <polyline
          key={ray.id}
          className={css.lightRay}
          data-testid={`light-${ray.id}`}
          points={ray.points
            .map(point => `${projection.px(point)},${projection.py(point)}`)
            .join(' ')}
        />
      ))}

      {/* The object: an arrow standing on the axis, head up. */}
      <path
        className={css.lightObject}
        data-testid="light-object"
        d={`M${objectX} ${objectBottom} V${objectTop}`}
      />
      {/* The image: the same arrow, inverted, on the screen. The head is at the
          BOTTOM because that is where the tip's ray lands. */}
      <path
        className={css.lightImage}
        data-testid="light-image"
        d={`M${screenX} ${imageTop} V${imageBottom}`}
      />

      {/* The screen itself, behind the image it receives. */}
      <path
        className={css.lightScreen}
        data-testid="light-screen"
        d={`M${screenX + 3} ${holeY - screenHalf} V${holeY + screenHalf}`}
      />

      <MathLabel
        x={screenX + 10}
        y={holeY + 4}
        anchor="start"
        symbol={rig.imageText}
        className={css.currentReading}
      />
      <MathLabel
        x={objectX - 6}
        y={holeY + 4}
        anchor="end"
        symbol={rig.magnificationText}
        className={css.currentReading}
      />

      {view.dimensions.map(dimension => (
        <Dimension key={dimension.id} dimension={dimension} projection={projection} />
      ))}
    </>
  )
}

/**
 * The refraction figure: boundary, normal, and the rays that leave the point of
 * incidence. The refracted ray is drawn ONLY when it exists — past the critical
 * angle the figure shows the light going back and says so, because drawing a
 * ray that skimmed the surface would be showing the one thing 全反射 is not.
 */
function RefractionRenderer({ refraction, projection }: {
  refraction: NonNullable<RendererProps['view']['lightRefraction']>
  projection: RendererProps['projection']
}) {
  const at = { x: projection.px(refraction.at), y: projection.py(refraction.at) }
  const line = (from: { x: number; y: number }, to: { x: number; y: number }) =>
    `M${projection.px(from)} ${projection.py(from)} L${projection.px(to)} ${projection.py(to)}`

  return (
    <>
      <defs>
        <ArrowMarkers uid={projection.uid} />
      </defs>

      {/* The boundary between the two media, and the normal it is measured
         against. */}
      <path
        className={css.lightBoundary}
        data-testid="light-boundary"
        d={line(refraction.boundaryFrom, refraction.boundaryTo)}
      />
      <path
        className={css.lightNormal}
        data-testid="light-normal"
        d={line(refraction.normalFrom, refraction.normalTo)}
      />
      {/* Where the critical angle would send a ray, when there is one. */}
      {refraction.criticalTo === undefined ? null : (
        <path
          className={css.lightCriticalRay}
          data-testid="light-critical"
          d={line(refraction.at, refraction.criticalTo)}
        />
      )}
      <path
        className={css.lightRay}
        data-testid="light-incident"
        d={line(refraction.incidentFrom, refraction.at)}
      />
      <path
        className={css.lightImage}
        data-testid="light-reflected"
        d={line(refraction.at, refraction.reflectedTo)}
      />
      {refraction.refractedTo === undefined ? null : (
        <path
          className={css.lightRefractedRay}
          data-testid="light-refracted"
          d={line(refraction.at, refraction.refractedTo)}
        />
      )}

      <MathLabel
        x={at.x + 10}
        y={at.y - 10}
        anchor="start"
        symbol={refraction.incidentText}
        className={css.currentReading}
      />
      <MathLabel
        x={at.x + 10}
        y={at.y + 8}
        anchor="start"
        symbol={refraction.criticalText}
        className={css.currentReading}
      />
      <MathLabel
        x={at.x + 10}
        y={at.y + 26}
        anchor="start"
        symbol={refraction.refractedText}
        className={css.currentReading}
      />
    </>
  )
}
