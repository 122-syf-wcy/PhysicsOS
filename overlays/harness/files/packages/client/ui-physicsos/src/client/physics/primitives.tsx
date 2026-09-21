/**
 * Shared canvas primitives.
 *
 * Every renderer composes these instead of hand-rolling SVG, so an arrow, an
 * angle arc or a dimension line looks identical in every physics domain. Each
 * primitive receives an already-projected {@link RendererProjection} and draws
 * nothing physical of its own.
 */

import { useState } from 'react'
import type {
  AngleVisual,
  ApparatusSpriteVisual,
  BodyVisual,
  CoordinateVisual,
  DimensionVisual,
  GroundVisual,
  InclineVisual,
  KeyPointVisual,
  MotionMarkVisual,
  PendulumVisual,
  PlatformVisual,
  ScenePoint,
  SpringVisual,
  VectorVisual,
} from './scene-visual-model.ts'
import type { RendererProjection } from './renderer-registry.tsx'
import { parseMathSymbol } from './math-symbol.ts'
import { estimateLabelWidth, layoutVectorLabels, type LabelBox } from './vector-label-layout.ts'
import { MECHANICS_PARTS3D, mechanicsPart3dUrl } from './parts3d-mechanics-catalog.ts'
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
    case 'electric-force':
      return css.roleElectricForce
    case 'magnetic-force':
      return css.roleMagneticForce
    case 'gravity':
      return css.roleGravity
    case 'normal':
      return css.roleNormal
    case 'friction':
      return css.roleFriction
    case 'net-force':
      return css.roleNetForce
    case 'spring':
      return css.roleSpring
    case 'tension':
      return css.roleTension
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
  'electric-force',
  'magnetic-force',
  'gravity',
  'normal',
  'friction',
  'net-force',
  'spring',
  'tension',
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
      {/* Left end under the line: the right end already hosts the x-axis
          name and the scale bar — a surface label there piles onto both. */}
      {ground.label === undefined ? null : (
        <text className={css.surfaceLabel} x={x1 + 4} y={y + 19} textAnchor="start">
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
  const [plankFailed, setPlankFailed] = useState(false)
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
  const apexY = projection.py(apex)
  const count = Math.max(0, Math.floor((baseX2 - baseX1) / step))
  /* The plank sprite is a horizontal board whose measured top-surface line is
     scaled onto the hypotenuse and rotated about the apex — an exact affine
     transform for a strict side view. The wedge and hatch stay code-drawn:
     they carry the support the board rests on. */
  const plank = MECHANICS_PARTS3D['plank']
  const plankImage = (() => {
    if (plank === undefined || plankFailed) return undefined
    const { anchorLine } = plank
    if (anchorLine === undefined) return undefined
    const { a, b } = anchorLine
    const linePx = Math.hypot((b.x - a.x) * plank.pixels.w, (b.y - a.y) * plank.pixels.h)
    const hypotPx = Math.hypot(baseX2 - baseX1, baseY - apexY)
    if (linePx === 0 || hypotPx === 0) return undefined
    const drawScale = hypotPx / linePx
    const w = plank.pixels.w * drawScale
    const h = plank.pixels.h * drawScale
    const degrees = (Math.atan2(baseY - apexY, baseX2 - baseX1) * 180) / Math.PI
    return { a, w, h, degrees }
  })()
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
      {plank === undefined || plankImage === undefined ? null : (
        <g transform={`rotate(${plankImage.degrees.toFixed(3)} ${baseX1.toFixed(3)} ${apexY.toFixed(3)})`}>
          <image
            data-testid="sprite-plank"
            href={mechanicsPart3dUrl(plank)}
            x={baseX1 - plankImage.a.x * plankImage.w}
            y={apexY - plankImage.a.y * plankImage.h}
            width={plankImage.w}
            height={plankImage.h}
            preserveAspectRatio="none"
            className={css.partSprite}
            onError={() => { setPlankFailed(true) }}
          />
        </g>
      )}
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

/**
 * Coil spring drawn parametrically between its anchor and the body's near
 * face. The coil's drawn length equals the live extension — a compressed
 * spring reads tight, a stretched one reads open — which a bitmap cannot do.
 * A wall plate at the anchor and a rest-position tick complete the rig.
 */
export const SpringCoil = ({
  spring,
  projection,
}: {
  spring: SpringVisual
  projection: RendererProjection
}) => {
  const a = { x: projection.px(spring.anchor), y: projection.py(spring.anchor) }
  const b = { x: projection.px(spring.end), y: projection.py(spring.end) }
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length < 8) return null
  /* Unit axes along and across the coil. */
  const ux = dx / length
  const uy = dy / length
  const nx = -uy
  const ny = ux
  const coilAmp = Math.min(11, Math.max(5, length * 0.09))
  const lead = Math.min(14, length * 0.12)
  const coils = Math.max(4, Math.min(11, Math.floor(length / 26)))
  /* A wound coil reads as two serpentines in anti-phase: the front wire and
     the back wire cross at each node on the axis, so the drawn length is the
     live extension — compressed springs pack tight, stretched ones open —
     while the two strands give the helix its depth. Each half-turn is one
     quadratic whose control sits at ±2·amp so the curve crests at ±amp. */
  const span = length - 2 * lead
  const halfPitch = span / (coils * 2)
  const at = (t: number, off: number) =>
    `${a.x + ux * t + nx * off} ${a.y + uy * t + ny * off}`
  const serpentine = (phase: 1 | -1, amp: number) => {
    const segs: string[] = []
    for (let i = 1; i <= coils * 2; i += 1) {
      const sign = (i % 2 === 1 ? 1 : -1) * phase
      segs.push(`Q${at(lead + halfPitch * (i - 0.5), sign * amp * 2)} ${at(lead + halfPitch * i, 0)}`)
    }
    return segs.join(' ')
  }
  const points = [
    `M${a.x} ${a.y}`,
    `L${at(lead, 0)}`,
    serpentine(1, coilAmp),
    `L${at(length - lead, 0)}`,
    `L${b.x} ${b.y}`,
  ]
  const backPoints = [`M${at(lead, 0)}`, serpentine(-1, coilAmp * 0.92), `L${at(length - lead, 0)}`]
  /* Wall plate at the anchor: a bar perpendicular to the coil plus hatching
     on the far side, the universal "fixed end" mark. */
  const plateHalf = 16
  const hatch: string[] = []
  for (let i = -1; i <= 1; i += 1) {
    const cx = a.x + nx * plateHalf * i * 0.62 - ux * 3
    const cy = a.y + ny * plateHalf * i * 0.62 - uy * 3
    hatch.push(`M${cx} ${cy} l${-ux * 6 - nx * 5} ${-uy * 6 - ny * 5}`)
  }
  return (
    <g
      data-testid="spring-coil"
      className={projection.highlighted(spring.id) ? css.highlightGroup : undefined}
    >
      <line
        className={css.springPlate}
        x1={a.x + nx * plateHalf}
        y1={a.y + ny * plateHalf}
        x2={a.x - nx * plateHalf}
        y2={a.y - ny * plateHalf}
      />
      <path className={css.springHatch} d={hatch.join(' ')} />
      <path className={css.springCoilBack} d={backPoints.join(' ')} />
      <path className={css.springCoil} d={points.join(' ')} />
      <circle cx={a.x} cy={a.y} r={2.4} className={css.springJoint} />
      <circle cx={b.x} cy={b.y} r={2.4} className={css.springJoint} />
      {spring.equilibrium === undefined ? null : (() => {
        /* Rest-position tick perpendicular to the motion axis. */
        const centre =
          spring.axis === 'vertical'
            ? { x: spring.anchor.x, y: spring.equilibrium }
            : { x: spring.equilibrium, y: spring.anchor.y }
        const ex = projection.px(centre)
        const ey = projection.py(centre)
        const horizontal = spring.axis === 'vertical'
        return (
          <line
            className={css.pendulumRest}
            x1={horizontal ? ex - 12 : ex}
            y1={horizontal ? ey : ey - 12}
            x2={horizontal ? ex + 12 : ex}
            y2={horizontal ? ey : ey + 12}
          />
        )
      })()}
    </g>
  )
}

/**
 * Pendulum rig: ceiling mount, taut string pivot → bob, and a dashed
 * rest-position line the swing is read against.
 */
export const PendulumRig = ({
  pendulum,
  projection,
}: {
  pendulum: PendulumVisual
  projection: RendererProjection
}) => {
  const pivot = { x: projection.px(pendulum.pivot), y: projection.py(pendulum.pivot) }
  const bob = { x: projection.px(pendulum.bob), y: projection.py(pendulum.bob) }
  const rest = {
    x: projection.px({ x: pendulum.pivot.x, y: pendulum.pivot.y - pendulum.length }),
    y: projection.py({ x: pendulum.pivot.x, y: pendulum.pivot.y - pendulum.length }),
  }
  const mountHalf = 20
  const hatch: string[] = []
  for (let i = -1; i <= 1; i += 1) {
    const x = pivot.x + i * mountHalf * 0.55
    hatch.push(`M${x} ${pivot.y - 4} l-5 -7`)
  }
  return (
    <g
      data-testid="pendulum-rig"
      className={projection.highlighted(pendulum.id) ? css.highlightGroup : undefined}
    >
      <line
        className={css.springPlate}
        x1={pivot.x - mountHalf}
        y1={pivot.y - 4}
        x2={pivot.x + mountHalf}
        y2={pivot.y - 4}
      />
      <path className={css.springHatch} d={hatch.join(' ')} />
      <line className={css.pendulumRest} x1={pivot.x} y1={pivot.y} x2={rest.x} y2={rest.y} />
      <line className={css.pendulumString} x1={pivot.x} y1={pivot.y} x2={bob.x} y2={bob.y} />
      <circle cx={pivot.x} cy={pivot.y} r={2.6} className={css.springJoint} />
    </g>
  )
}

/* ------------------------------------------------------------------ bodies -- */

/**
 * Photographed apparatus sprite pinned by its catalogued anchor point. The
 * sprite is drawn under vectors and bodies — it is the instrument, not the
 * measured quantity — and renders nothing if the file fails to load, so a
 * missing asset degrades to the parametric rig rather than a broken image.
 */
export const Apparatus = ({
  sprite,
  projection,
}: {
  sprite: ApparatusSpriteVisual
  projection: RendererProjection
}) => {
  const [failed, setFailed] = useState(false)
  const entry = MECHANICS_PARTS3D[sprite.part]
  const anchor = entry?.anchorPoint
  if (entry === undefined || anchor === undefined || failed) return null
  const h = sprite.size * projection.scale
  const w = (sprite.width ?? sprite.size * (entry.pixels.w / entry.pixels.h)) * projection.scale
  const ax = projection.px(sprite.at)
  const ay = projection.py(sprite.at)
  /* Mirror about the anchor: `scale(-1)` after `translate(2ax)` keeps the
     anchor pixel fixed while the sprite body swings to the other side. */
  const flip = sprite.flip === true ? `translate(${2 * ax} 0) scale(-1 1)` : undefined
  return (
    <g
      className={projection.highlighted(sprite.id) ? css.highlightGroup : undefined}
      transform={flip}
    >
      <image
        data-testid={`apparatus-${sprite.part}`}
        href={mechanicsPart3dUrl(entry)}
        x={ax - anchor.x * w}
        y={ay - anchor.y * h}
        width={w}
        height={h}
        preserveAspectRatio="none"
        className={css.partSprite}
        onError={() => { setFailed(true) }}
      />
    </g>
  )
}

/** Solid body: block or ball, optionally rotated onto a slope. */
export const Body = ({
  body,
  projection,
}: {
  body: BodyVisual
  projection: RendererProjection
}) => {
  const [spriteFailed, setSpriteFailed] = useState(false)
  const cx = projection.px(body.at)
  const cy = projection.py(body.at)
  const radius = body.size * projection.scale
  const highlighted = projection.highlighted(body.id)
  const rotation = body.rotation ?? 0
  /* A photographed rig replaces only the body shape — the scene position `at`
     (centre of mass for the ball, COM for block/cart) and `size` (radius or
     half-edge) stay the authority. `ball` pins its measured centre+radius;
     `block`/`cart` pin their measured bottom-contact point to the point one
     half-edge below `at`, then rotate about `at` exactly like the vector body. */
  const sprite = MECHANICS_PARTS3D[body.kind]
  const spriteBox = (() => {
    if (sprite?.anchorPoint === undefined || spriteFailed) return undefined
    if (body.kind === 'ball') {
      if (sprite.radius === undefined || sprite.radius === 0) return undefined
      const drawScale = radius / (sprite.radius * sprite.pixels.w)
      const w = sprite.pixels.w * drawScale
      const h = sprite.pixels.h * drawScale
      return {
        x: cx - sprite.anchorPoint.x * w,
        y: cy - sprite.anchorPoint.y * h,
        w,
        h,
      }
    }
    const drawScale = (radius * 2) / (sprite.solidBox.height * sprite.pixels.h)
    const w = sprite.pixels.w * drawScale
    const h = sprite.pixels.h * drawScale
    return {
      x: cx - sprite.anchorPoint.x * w,
      /* Contact = one half-edge below the COM, in the body's unrotated frame;
         the group's rotate() about (cx,cy) then lays it onto the slope. */
      y: cy + radius - sprite.anchorPoint.y * h,
      w,
      h,
    }
  })()
  return (
    <g className={highlighted ? css.highlightGroup : undefined}>
      {sprite !== undefined && spriteBox !== undefined ? (
        <g transform={rotation === 0 ? undefined : `rotate(${-rotation} ${cx} ${cy})`}>
          <image
            data-testid={`sprite-${body.kind}`}
            href={mechanicsPart3dUrl(sprite)}
            x={spriteBox.x}
            y={spriteBox.y}
            width={spriteBox.w}
            height={spriteBox.h}
            preserveAspectRatio="none"
            className={clsxJoin(css.partSprite, body.live === true && css.bodyLive)}
            onError={() => { setSpriteFailed(true) }}
          />
        </g>
      ) : body.kind === 'ball' ? (
        <>
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            className={clsxJoin(css.bodyFill, body.live === true && css.bodyLive)}
            style={{ fill: `url(#pc-ball-${projection.uid})` }}
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
      ) : body.kind === 'cart' ? (
        /* A wheeled cart: box body riding on two visible wheels. The bridge
           anchors `at` at the centre of mass, so the box sits above the wheel
           line and the track passes under the wheels. */
        <>
          <rect
            x={cx - radius * 1.35}
            y={cy - radius * 0.62}
            width={radius * 2.7}
            height={radius * 1.1}
            rx={radius * 0.16}
            className={clsxJoin(css.bodyFill, body.live === true && css.bodyLive)}
          />
          <line
            className={css.cartAxle}
            x1={cx - radius * 0.85}
            y1={cy + radius * 0.68}
            x2={cx + radius * 0.85}
            y2={cy + radius * 0.68}
          />
          {[cx - radius * 0.85, cx + radius * 0.85].map((wheelX) => {
            const wheelY = cy + radius * 0.68
            const wheelRadius = radius * 0.32
            /* Rolling without slipping: the wheel turns through the arc the
               cart has covered, θ = s/R with R = body.size·0.32 in scene
               units. Position → angle is pure geometry, so pause and scrub
               need no clock — the spokes freeze and reverse for free. */
            const roll = (((body.at.x / (body.size * 0.32)) * 180) / Math.PI % 360 + 360) % 360
            return (
              <g key={wheelX}>
                <circle
                  cx={wheelX}
                  cy={wheelY}
                  r={wheelRadius}
                  className={css.cartWheel}
                />
                <g
                  data-testid="cart-spokes"
                  transform={`rotate(${roll.toFixed(2)} ${wheelX.toFixed(2)} ${wheelY.toFixed(2)})`}
                >
                  {[0, 1, 2].map((spoke) => {
                    const angle = (spoke * 2 * Math.PI) / 3 - Math.PI / 2
                    return (
                      <line
                        key={spoke}
                        className={css.cartSpoke}
                        x1={wheelX}
                        y1={wheelY}
                        x2={wheelX + wheelRadius * 0.78 * Math.cos(angle)}
                        y2={wheelY + wheelRadius * 0.78 * Math.sin(angle)}
                      />
                    )
                  })}
                </g>
                <circle
                  cx={wheelX}
                  cy={wheelY}
                  r={radius * 0.1}
                  className={css.cartHub}
                />
              </g>
            )
          })}
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

  /* Vectors are readout annotations, never hit targets: a force arrow drawn
     over a draggable body must let the press fall through to the part. */
  return (
    <g pointerEvents="none">
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
  /* `dy` on a tspan SHIFTS the running baseline, it does not set it, so a script
     run must be undone before the next normal run or the rest of the label keeps
     drifting (`v_x0` would stair-step downwards). */
  let pendingShift = 0
  return (
    <text x={x} y={y} textAnchor={anchor} className={className}>
      {parts.map((part, index) => {
        const shift = part.script === 'sub' ? 0.28 : part.script === 'super' ? -0.38 : 0
        const dy = shift - pendingShift
        pendingShift = shift
        return (
          <tspan
            key={index}
            className={
              part.script === 'sub'
                ? css.subscript
                : part.script === 'super'
                  ? css.superscript
                  : undefined
            }
            dy={dy === 0 ? undefined : `${dy.toFixed(2)}em`}
          >
            {part.text}
          </tspan>
        )
      })}
    </text>
  )
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

/** Equal-time strobe marks along the path; spacing between dots IS the physics. */
export const MotionMarks = ({
  marks,
  projection,
}: {
  marks: readonly MotionMarkVisual[]
  projection: RendererProjection
}) => (
  <g>
    {marks.map((mark) => {
      const cx = projection.px(mark.at)
      const cy = projection.py(mark.at)
      return (
        <g key={mark.id} className={projection.highlighted(mark.id) ? css.highlightGroup : undefined}>
          <circle className={css.motionMark} cx={cx} cy={cy} r="3" />
          {mark.label === undefined ? null : (
            <text className={css.motionMarkLabel} x={cx} y={cy + 14} textAnchor="middle">
              {mark.label}
            </text>
          )}
        </g>
      )
    })}
  </g>
)

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
      {/* The launch-angle label already claims the space up-right of the point;
          the launch label anchors up-left instead. Axis ticks sharing that
          row are blanked by the bridge's tickLabelAvoid, not by moving the
          label — a label far from its point stops reading as its name. */}
      <text
        className={css.keyLabel}
        x={keyPoint.kind === 'launch' ? cx - 7 : cx}
        y={cy - 9}
        textAnchor={keyPoint.kind === 'launch' ? 'end' : 'middle'}
      >
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
