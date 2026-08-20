/**
 * Renderer registry.
 *
 * `PhysicsCanvas` looks a renderer up by `view.domain`. A renderer receives the
 * shared visual model plus a projection helper and composes primitives — it never
 * imports an engine, never reads a `PhysicsScene`, and never computes a physical
 * fact. Registering `electric`, `circuit` or `induction` later is an entry here
 * plus one file, with no change to the canvas host.
 */

import { useMemo } from 'react'
import type { ReactElement } from 'react'
import type { ScenePoint, SceneVisualModel } from './scene-visual-model.ts'
import {
  Angle,
  ArrowMarkers,
  Body,
  Coordinate,
  Dimension,
  Ground,
  Incline,
  KeyPoint,
  MathLabel,
  Platform,
  Vectors,
  clsxJoin,
  markerId,
  roleClass,
} from './primitives.tsx'
import css from './renderers.module.css'

/** Scene→screen projection handed to every renderer by the canvas host. */
export interface RendererProjection {
  /** Scene x → SVG x. */
  px: (point: ScenePoint) => number
  /** Scene y → SVG y (flipped). */
  py: (point: ScenePoint) => number
  /** SVG px per scene unit. */
  scale: number
  /** Canvas instance id, for unique marker/pattern ids. */
  uid: string
  /** Scene polyline → SVG path data. */
  path: (points: readonly ScenePoint[]) => string
  /** Whether a visual id is currently highlighted. */
  highlighted: (id: string) => boolean
}

export interface RendererProps {
  view: SceneVisualModel
  projection: RendererProjection
}

/* ---------------------------------------------------------------- magnetic -- */

/**
 * Magnetic renderer: uniform field lattice, charged particle, orbit.
 *
 * Kept behaviourally identical to the accepted Magnetic UI — same ×/· glyphs,
 * same rotation-direction glyph, same radius guide — so sharing the canvas does
 * not regress a verified surface.
 */
function MagneticRenderer({ view, projection }: RendererProps) {
  const field = view.field
  const glyph = field?.direction === 'into-page' ? '×' : '·'
  const columns = field === undefined ? 0 : Math.floor(view.extent.width / field.spacing)
  const rows = field === undefined ? 0 : Math.floor(view.extent.height / field.spacing)
  const marks =
    field === undefined
      ? []
      : Array.from({ length: columns }, (_, column) =>
        Array.from({ length: rows }, (_, row) => ({
          x: projection.px({
            x: view.origin.x + field.spacing * (column + 0.5),
            y: view.origin.y,
          }),
          y: projection.py({
            x: view.origin.x,
            y: view.origin.y + view.extent.height - field.spacing * (row + 0.5),
          }),
        })),
      ).flat()

  const particle = view.particles[0]
  const glowId = `pc-glow-${projection.uid}`

  return (
    <>
      <defs>
        <ArrowMarkers uid={projection.uid} />
        <radialGradient id={glowId} cx="34%" cy="30%" r="72%">
          <stop offset="0%" stopColor={particle?.sign === 'negative' ? '#9dc4ff' : '#ffb4a6'} />
          <stop offset="55%" stopColor={particle?.sign === 'negative' ? '#3b82f6' : '#ea6a5c'} />
          <stop offset="100%" stopColor={particle?.sign === 'negative' ? '#1d4ed8' : '#c8453a'} />
        </radialGradient>
      </defs>

      <g className={css.fieldGlyph} textAnchor="middle">
        {marks.map(mark => (
          <text key={`${mark.x}-${mark.y}`} x={mark.x} y={mark.y}>
            {glyph}
          </text>
        ))}
      </g>

      {view.visible.trajectory === true
        ? view.trajectories.map((trajectory) => {
          const marker = trajectory.points[Math.floor(trajectory.points.length / 4)]
          return (
            <g key={trajectory.id}>
              <path
                className={trajectory.kind === 'history' ? css.trajectoryHistory : css.trajectoryPredicted}
                d={projection.path(trajectory.points)}
              />
              {marker === undefined || trajectory.direction === undefined ? null : (
                <text
                  className={css.trajectoryDirection}
                  x={projection.px(marker) + 8}
                  y={projection.py(marker) - 8}
                  aria-label={
                    trajectory.direction === 'clockwise' ? '轨迹方向：顺时针' : '轨迹方向：逆时针'
                  }
                >
                  {trajectory.direction === 'clockwise' ? '↻' : '↺'}
                </text>
              )}
            </g>
          )
        })
        : null}

      {view.guides
        .filter(guide => view.visible[guide.observable] === true)
        .map(guide => (
          <g key={guide.id}>
            <line
              className={css.guideLine}
              x1={projection.px(guide.from)}
              y1={projection.py(guide.from)}
              x2={projection.px(guide.to)}
              y2={projection.py(guide.to)}
            />
            {guide.label === undefined ? null : (
              <MathLabel
                x={(projection.px(guide.from) + projection.px(guide.to)) / 2 + 6}
                y={(projection.py(guide.from) + projection.py(guide.to)) / 2 - 6}
                anchor="start"
                symbol={guide.label}
                className={css.guideLabel}
              />
            )}
          </g>
        ))}

      {view.visible.center === true && view.center !== undefined ? (
        <circle
          className={css.orbitCenter}
          cx={projection.px(view.center)}
          cy={projection.py(view.center)}
          r="3"
        />
      ) : null}

      <Vectors
        vectors={view.vectors.filter(vector => view.visible[vector.observable] === true)}
        projection={projection}
      />

      {view.particles.map((item) => {
        const cx = projection.px(item.at)
        const cy = projection.py(item.at)
        const radius = item.radius * projection.scale
        return (
          <g key={item.id}>
            <circle cx={cx} cy={cy} r={radius} fill={`url(#${glowId})`} />
            <circle
              cx={cx - radius * 0.3}
              cy={cy - radius * 0.34}
              r={radius * 0.24}
              fill="rgba(255, 255, 255, 0.62)"
            />
            <text
              className={clsxJoin(
                css.particleLabel,
                item.sign === 'negative' && css.particleLabelNegative,
              )}
              x={cx - radius - 6}
              y={cy - radius - 5}
              textAnchor="end"
            >
              {item.symbol}
            </text>
          </g>
        )
      })}
    </>
  )
}

/* ---------------------------------------------------------------- electric -- */

function ElectricRenderer({ view, projection }: RendererProps) {
  const field = view.electricField
  const fieldSpacing = field?.spacing ?? 0
  const fieldDirectionX = field?.direction.x ?? 0
  const fieldDirectionY = field?.direction.y ?? 0
  const hasField = field !== undefined
  const columns = hasField ? Math.max(1, Math.floor(view.extent.width / fieldSpacing)) : 0
  const rows = hasField ? Math.max(1, Math.floor(view.extent.height / fieldSpacing)) : 0
  const arrowLength = fieldSpacing * 0.58
  const arrows = useMemo(() => !hasField
    ? []
    : Array.from({ length: columns }, (_, column) =>
      Array.from({ length: rows }, (_, row) => {
        const center = {
          x: view.origin.x + fieldSpacing * (column + 0.5),
          y: view.origin.y + fieldSpacing * (row + 0.5),
        }
        return {
          from: {
            x: center.x - fieldDirectionX * arrowLength * 0.5,
            y: center.y - fieldDirectionY * arrowLength * 0.5,
          },
          to: {
            x: center.x + fieldDirectionX * arrowLength * 0.5,
            y: center.y + fieldDirectionY * arrowLength * 0.5,
          },
        }
      }),
    ).flat(), [
    arrowLength,
    columns,
    fieldDirectionX,
    fieldDirectionY,
    fieldSpacing,
    hasField,
    rows,
    view.origin.x,
    view.origin.y,
  ])
  const trajectoryPaths = useMemo(() => view.trajectories.map(trajectory => ({
    id: trajectory.id,
    kind: trajectory.kind,
    path: projection.path(trajectory.points),
  })), [projection, view.trajectories])
  const particle = view.particles[0]
  const glowId = `pc-electric-glow-${projection.uid}`

  return (
    <>
      <defs>
        <ArrowMarkers uid={projection.uid} />
        <radialGradient id={glowId} cx="34%" cy="30%" r="72%">
          <stop offset="0%" stopColor={particle?.sign === 'negative' ? '#9dc4ff' : '#ffb4a6'} />
          <stop offset="55%" stopColor={particle?.sign === 'negative' ? '#3b82f6' : '#ea6a5c'} />
          <stop offset="100%" stopColor={particle?.sign === 'negative' ? '#1d4ed8' : '#c8453a'} />
        </radialGradient>
      </defs>

      <g className={css.electricFieldLattice} aria-hidden="true">
        {arrows.map((arrow, index) => (
          <line
            key={index}
            x1={projection.px(arrow.from)}
            y1={projection.py(arrow.from)}
            x2={projection.px(arrow.to)}
            y2={projection.py(arrow.to)}
            markerEnd={`url(#${markerId('field', projection.uid)})`}
          />
        ))}
      </g>

      {view.visible.trajectory === true
        ? trajectoryPaths.map(trajectory => (
          <path
            key={trajectory.id}
            className={trajectory.kind === 'history' ? css.trajectoryHistory : css.trajectoryPredicted}
            d={trajectory.path}
          />
        ))
        : null}

      <Vectors
        vectors={view.vectors.filter(vector => view.visible[vector.observable] === true)}
        projection={projection}
      />

      {view.particles.map((item) => {
        const cx = projection.px(item.at)
        const cy = projection.py(item.at)
        const radius = item.radius * projection.scale
        return (
          <g key={item.id}>
            <circle cx={cx} cy={cy} r={radius} fill={`url(#${glowId})`} />
            <circle cx={cx - radius * 0.3} cy={cy - radius * 0.34} r={radius * 0.24} fill="rgba(255, 255, 255, 0.62)" />
            <text
              className={clsxJoin(css.particleLabel, item.sign === 'negative' && css.particleLabelNegative)}
              x={cx - radius - 6}
              y={cy - radius - 5}
              textAnchor="end"
            >
              {item.symbol}
            </text>
          </g>
        )
      })}
    </>
  )
}

/* --------------------------------------------------------------- mechanics -- */

/**
 * Mechanics renderer.
 *
 * Draw order is deliberate and reads back-to-front: surfaces, then the path, then
 * construction geometry, then key points, then vectors, then the body last so the
 * live object is never buried under an arrow.
 */
function MechanicsRenderer({ view, projection }: RendererProps) {
  return (
    <>
      <defs>
        <ArrowMarkers uid={projection.uid} />
      </defs>

      {view.incline === undefined ? null : <Incline incline={view.incline} projection={projection} />}
      {view.platform === undefined ? null : (
        <Platform platform={view.platform} projection={projection} />
      )}
      {view.ground === undefined ? null : <Ground ground={view.ground} projection={projection} />}

      {view.visible.trajectory === true
        ? view.trajectories.map(trajectory => (
          <path
            key={trajectory.id}
            className={
              trajectory.kind === 'history' ? css.trajectoryHistory : css.trajectoryPredicted
            }
            d={projection.path(trajectory.points)}
          />
        ))
        : null}

      {view.dimensions.map(dimension => (
        <Dimension key={dimension.id} dimension={dimension} projection={projection} />
      ))}

      {view.angles.map(angle => (
        <Angle key={angle.id} angle={angle} projection={projection} />
      ))}

      {view.coordinate === undefined ? null : (
        <Coordinate coordinate={view.coordinate} projection={projection} />
      )}

      {view.visible.keyPoints === true
        ? view.keyPoints.map(keyPoint => (
          <KeyPoint key={keyPoint.id} keyPoint={keyPoint} projection={projection} />
        ))
        : null}

      <Vectors
        vectors={view.vectors.filter(vector => view.visible[vector.observable] === true)}
        projection={projection}
      />

      {view.bodies.map(body => (
        <Body key={body.id} body={body} projection={projection} />
      ))}

      {view.labels.map(label => (
        <MathLabel
          key={label.id}
          x={projection.px(label.at)}
          y={projection.py(label.at)}
          anchor={label.anchor ?? 'middle'}
          symbol={label.text}
          className={clsxJoin(css.annotation, label.role === undefined ? undefined : roleClass(label.role))}
        />
      ))}
    </>
  )
}

/** Domain → renderer. Extend here to add a physics domain. */
export const RENDERERS = {
  magnetic: MagneticRenderer,
  mechanics: MechanicsRenderer,
  electric: ElectricRenderer,
} as const satisfies Record<SceneVisualModel['domain'], (props: RendererProps) => ReactElement>

export { ElectricRenderer, MagneticRenderer, MechanicsRenderer }
