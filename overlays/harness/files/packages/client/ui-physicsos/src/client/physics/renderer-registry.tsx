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
import type { TerminalRef } from './circuit-builder.ts'
import { AcousticsRenderer } from './acoustics-renderer.tsx'
import { CircuitRenderer } from './circuit-renderer.tsx'
import { FluidRenderer } from './fluid-renderer.tsx'
import { CurrentRenderer } from './current-renderer.tsx'
import { EnergyRenderer } from './energy-renderer.tsx'
import { LightRenderer } from './light-renderer.tsx'
import { TransformerRenderer } from './transformer-renderer.tsx'
import { InductionRenderer } from './induction-renderer.tsx'
import { OpticsRenderer } from './optics-renderer.tsx'
import { ThermalRenderer } from './thermal-renderer.tsx'
import { ThermometerRenderer } from './thermometer-renderer.tsx'
import { NoiseRenderer } from './noise-renderer.tsx'
import { LeverRenderer } from './lever-renderer.tsx'
import { WaveRenderer } from './wave-renderer.tsx'
import type { ScenePoint, SceneVisualModel } from './scene-visual-model.ts'
import {
  Angle,
  Apparatus,
  ArrowMarkers,
  Body,
  Coordinate,
  Dimension,
  Ground,
  Incline,
  KeyPoint,
  MathLabel,
  MotionMarks,
  PendulumRig,
  Platform,
  SpringCoil,
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
  /** SVG x → scene x (inverse of {@link RendererProjection.px}). */
  sx: (x: number) => number
  /** SVG y → scene y (inverse of {@link RendererProjection.py}). */
  sy: (y: number) => number
  /** SVG px per scene unit. */
  scale: number
  /** Canvas instance id, for unique marker/pattern ids. */
  uid: string
  /** Scene polyline → SVG path data. */
  path: (points: readonly ScenePoint[]) => string
  /** Whether a visual id is currently highlighted. */
  highlighted: (id: string) => boolean
}

/**
 * Pointer-drag channel for schematic components (circuit domain). `preview`
 * fires per pointer move with the scene-space position under the grab point;
 * `commit` fires once on release with the drop position. A domain that cannot
 * move its visuals leaves the channel undefined and its parts stay fixed.
 */
export interface ComponentDragChannel {
  readonly preview: (componentId: string, at: ScenePoint) => void
  readonly commit: (componentId: string, at: ScenePoint) => void
  /** Pointer-cancel path: abandon the in-flight preview without committing. */
  readonly cancel: () => void
}

/**
 * Build-mode wiring channel (circuit domain). Present only while the student is
 * assembling a circuit; the renderer then draws a focusable target on every
 * terminal and reports presses through `start`. The first press opens a wire,
 * the second closes it.
 */
export interface ComponentWiringChannel {
  /** Press on a terminal: opens a wire, or closes the one already open. */
  readonly start: (ref: TerminalRef) => void
  /** Terminal a wire is currently open from, for the pending highlight. */
  readonly pending?: TerminalRef | undefined
}

/**
 * Bench controls channel (circuit domain): the gestures that operate the
 * apparatus rather than rearrange it. A sub-threshold press on a switch flips
 * it; a press on the rheostat knob pushes the slider — `previewSlider` fires
 * per move, `commitSlider` once on release. Kept separate from
 * {@link ComponentDragChannel}: dragging furniture and operating it are
 * different intents, and a domain may offer one without the other.
 */
export interface ComponentControlChannel {
  readonly setSwitch: (componentId: string, state: 'open' | 'closed') => void
  readonly previewSlider: (componentId: string, position: number) => void
  readonly commitSlider: (componentId: string, position: number) => void
  /** Pointer-cancel path: abandon the in-flight preview without committing. */
  readonly cancelSlider: () => void
}

export interface RendererProps {
  view: SceneVisualModel
  projection: RendererProjection
  /** Elapsed scene time in seconds — the same clock the timeline scrubs.
   * Animations phase-locked to it freeze on pause and reverse on scrub. */
  time?: number
  /** Present when the workspace lets the student rearrange parts by pointer. */
  componentDrag?: ComponentDragChannel
  /** Present when the workspace lets the student operate parts on the bench. */
  componentControl?: ComponentControlChannel
  /** Present only while the student is assembling a circuit, by hand. */
  componentWiring?: ComponentWiringChannel
}

/* ---------------------------------------------------------------- magnetic -- */

/**
 * The magnetic domain's entry point: the Lorentz particle scene and the
 * current-magnetic benches share this shelf and this canvas, so the dispatch
 * lives here, above any hook, the way `FluidRenderer` dispatches to the
 * pressure rigs and `MechanicsRenderer` to the lever.
 */

/** Per-segment fading gradient for predicted trajectories: the road ahead
 * dims with distance so the crisp history and its runner carry the eye. */
function TrajectoryFadeDefs({ view, projection }: RendererProps) {
  const gradients = view.trajectories
    .filter(trajectory => trajectory.kind === 'predicted' && trajectory.points.length > 1)
    .map((trajectory) => {
      const first = trajectory.points[0]
      const last = trajectory.points[trajectory.points.length - 1]
      if (first === undefined || last === undefined) return null
      return (
        <linearGradient
          key={`fade-${trajectory.id}`}
          id={`trajectory-fade-${projection.uid}-${trajectory.id}`}
          gradientUnits="userSpaceOnUse"
          x1={projection.px(first)}
          y1={projection.py(first)}
          x2={projection.px(last)}
          y2={projection.py(last)}
        >
          <stop offset="0%" stopColor="var(--physics-trajectory-predicted)" stopOpacity="0.75" />
          <stop offset="100%" stopColor="var(--physics-trajectory-predicted)" stopOpacity="0.12" />
        </linearGradient>
      )
    })
  return <>{gradients}</>
}

function MagneticDomainRenderer(props: RendererProps) {
  if (props.view.currentRig !== undefined) {
    return <CurrentRenderer view={props.view} projection={props.projection} />
  }
  return <MagneticRenderer {...props} />
}

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
        <TrajectoryFadeDefs view={view} projection={projection} />
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
          /* The runner dot marks where the body IS: the last history point at
             this frame. Predicted segments have no runner — they are the road
             ahead, not something moving. */
          const runner = trajectory.kind === 'history'
            ? trajectory.points[trajectory.points.length - 1]
            : undefined
          return (
            <g key={`${trajectory.id}:${trajectory.kind}`}>
              <path
                className={
                  trajectory.kind === 'history' ? css.trajectoryHistory : css.trajectoryPredicted
                }
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
              {runner === undefined ? null : (
                <circle
                  className={css.trajectoryRunner}
                  cx={projection.px(runner)}
                  cy={projection.py(runner)}
                  r={4}
                />
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
  /* Hooks must run unconditionally — a point-charge frame and a uniform frame must
     execute the same hook count, or a scene switch throws "Rendered fewer hooks".
     The useMemo computations fall back to empty when the frame lacks the uniform
     field, so they are safe to run for both paths. */
  const field = view.electricField
  const fieldSpacing = field?.spacing ?? 0
  const fieldDirectionX = field?.direction.x ?? 0
  const fieldDirectionY = field?.direction.y ?? 0
  const hasField = field !== undefined
  const columns = hasField ? Math.max(1, Math.floor(view.extent.width / fieldSpacing)) : 0
  const rows = hasField ? Math.max(1, Math.floor(view.extent.height / fieldSpacing)) : 0
  const arrowLength = fieldSpacing * 0.58
  const arrows = useMemo(
    () =>
      !hasField
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
        ).flat(),
    [
      arrowLength,
      columns,
      fieldDirectionX,
      fieldDirectionY,
      fieldSpacing,
      hasField,
      rows,
      view.origin.x,
      view.origin.y,
    ],
  )
  const trajectoryPaths = useMemo(
    () =>
      view.trajectories.map(trajectory => ({
        id: trajectory.id,
        kind: trajectory.kind,
        path: projection.path(trajectory.points),
      })),
    [projection, view.trajectories],
  )

  if (view.pointChargeSources !== undefined) {
    return <ElectricPointChargeRenderer view={view} projection={projection} />
  }
  if (view.plates !== undefined) {
    return <ElectricRegionRenderer view={view} projection={projection} />
  }

  const particle = view.particles[0]
  const glowId = `pc-electric-glow-${projection.uid}`

  return (
    <>
      <defs>
        <ArrowMarkers uid={projection.uid} />
        <TrajectoryFadeDefs view={view} projection={projection} />
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
            key={`${trajectory.id}:${trajectory.kind}`}
            className={
              trajectory.kind === 'history' ? css.trajectoryHistory : css.trajectoryPredicted
            }
            d={trajectory.path}
            {...trajectory.kind === 'predicted'
              ? { stroke: `url(#trajectory-fade-${projection.uid}-${trajectory.id})` }
              : {}}
          />
        ))
        : null}

      <Vectors
        vectors={view.vectors.filter(vector => view.visible[vector.observable] === true)}
        projection={projection}
      />

      {/* The runner: a crisp dot on the last history point, above path and
          vectors, so the eye tracks the body rather than the road. */}
      {view.visible.trajectory === true
        ? (() => {
          const history = view.trajectories.find(trajectory => trajectory.kind === 'history')
          const point = history?.points[history.points.length - 1]
          return point === undefined ? null : (
            <circle
              className={css.trajectoryRunner}
              cx={projection.px(point)}
              cy={projection.py(point)}
              r={4}
            />
          )
        })()
        : null}

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

/* Point-charge electric: glass spheres, radial field streamlines, probe. */
function ElectricPointChargeRenderer({ view, projection }: RendererProps) {
  const positiveGlowId = `pc-point-pos-${projection.uid}`
  const negativeGlowId = `pc-point-neg-${projection.uid}`
  const streamlines = view.fieldStreamlines ?? []
  const sources = view.pointChargeSources ?? []

  return (
    <>
      <defs>
        <ArrowMarkers uid={projection.uid} />
        <TrajectoryFadeDefs view={view} projection={projection} />
        <radialGradient id={positiveGlowId} cx="34%" cy="30%" r="72%">
          <stop offset="0%" stopColor="#ffd6cc" />
          <stop offset="55%" stopColor="#ea6a5c" />
          <stop offset="100%" stopColor="#c8453a" />
        </radialGradient>
        <radialGradient id={negativeGlowId} cx="34%" cy="30%" r="72%">
          <stop offset="0%" stopColor="#cdddff" />
          <stop offset="55%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </radialGradient>
      </defs>

      <g className={css.electricFieldStreamline} aria-hidden="true">
        {streamlines.map((streamline) => {
          const midIndex = Math.floor(streamline.points.length / 2)
          const firstHalf = streamline.points.slice(0, midIndex + 1)
          const highlighted =
            streamline.sourceId !== undefined && projection.highlighted(streamline.sourceId)
          return (
            <g key={streamline.id} className={highlighted ? css.highlightGroup : undefined}>
              <path className={css.streamlinePath} d={projection.path(streamline.points)} />
              {firstHalf.length >= 2 ? (
                <path
                  className={css.streamlineArrow}
                  d={projection.path(firstHalf)}
                  markerEnd={`url(#${markerId('field', projection.uid)})`}
                />
              ) : null}
            </g>
          )
        })}
      </g>

      {view.equipotentials === undefined || view.equipotentials.length === 0 ? null : (
        <g className={css.equipotentials} aria-hidden="true">
          {view.equipotentials.map(contour => (
            <path
              key={contour.id}
              className={css.equipotentialPath}
              d={projection.path(contour.points)}
              {...(contour.closed ? { 'data-closed': 'true' } : {})}
            />
          ))}
        </g>
      )}

      <Vectors
        vectors={view.vectors.filter(vector => view.visible[vector.observable] === true)}
        projection={projection}
      />

      {sources.map((source) => {
        const cx = projection.px(source.at)
        const cy = projection.py(source.at)
        const radius = source.radius * projection.scale
        const glowId = source.sign === 'negative' ? negativeGlowId : positiveGlowId
        const highlighted = projection.highlighted(source.id)
        return (
          <g key={source.id} className={highlighted ? css.highlightGroup : undefined}>
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
                source.sign === 'negative' && css.particleLabelNegative,
              )}
              x={cx}
              y={cy + radius + 14}
              textAnchor="middle"
            >
              {source.sign === 'negative' ? '−' : '+'}
            </text>
          </g>
        )
      })}

      {view.probe === undefined
        ? null
        : (() => {
          const cx = projection.px(view.probe.at)
          const cy = projection.py(view.probe.at)
          const highlighted = projection.highlighted(view.probe.id)
          return (
            <g key={view.probe.id} className={highlighted ? css.highlightGroup : undefined}>
              <circle cx={cx} cy={cy} r={3.2} className={css.probeDot} />
            </g>
          )
        })()}
    </>
  )
}

/* --------------------------------------------------------------- mechanics -- */

/**
 * Parallel-plate (bounded field) renderer.
 *
 * Two metal-finish plates, a clipped field-line lattice between them, the
 * charged particle, its trajectory (parabola inside, straight outside), and
 * E/F/v/a vectors. The lattice is drawn only inside the bounded region so the
 * "field is zero outside" statement is visual, not just labelled.
 */
function ElectricRegionRenderer({ view, projection }: RendererProps) {
  const plates = view.plates ?? []
  const boundedField = view.boundedField
  const particle = view.particles[0]
  const glowId = `pc-region-glow-${projection.uid}`
  const clipId = `pc-region-clip-${projection.uid}`

  /* Field lines: full-span parallel strokes from plate to plate with one
     mid-line arrowhead each — the textbook reading of a bounded uniform field.
     Even spacing carries "uniform"; the region edge carries "zero outside".
     The whole layer is gated by the 电场 observable so the tree toggle hides
     both the lines and the E vector. */
  const fieldLines = useMemo(() => {
    if (boundedField === undefined) return []
    const { at, width, height, direction, spacing } = boundedField
    const xMin = at.x - width / 2
    const yMin = at.y - height / 2
    const vertical = Math.abs(direction.y) >= Math.abs(direction.x)
    const across = vertical ? width : height
    const count = Math.min(14, Math.max(4, Math.round(across / spacing)))
    const arrow = Math.min(width, height) * 0.06
    return Array.from({ length: count }, (_, index) => {
      const t = (index + 0.5) / count
      if (vertical) {
        const x = xMin + width * t
        const yStart = direction.y >= 0 ? yMin : yMin + height
        const yEnd = direction.y >= 0 ? yMin + height : yMin
        const yMid = yMin + height / 2
        const dy = direction.y >= 0 ? arrow : -arrow
        return {
          from: { x, y: yStart },
          to: { x, y: yEnd },
          arrowFrom: { x, y: yMid - dy },
          arrowTo: { x, y: yMid + dy },
        }
      }
      const y = yMin + height * t
      const xStart = direction.x >= 0 ? xMin : xMin + width
      const xEnd = direction.x >= 0 ? xMin + width : xMin
      const xMid = xMin + width / 2
      const dx = direction.x >= 0 ? arrow : -arrow
      return {
        from: { x: xStart, y },
        to: { x: xEnd, y },
        arrowFrom: { x: xMid - dx, y },
        arrowTo: { x: xMid + dx, y },
      }
    })
  }, [boundedField])

  return (
    <>
      <defs>
        <ArrowMarkers uid={projection.uid} />
        <TrajectoryFadeDefs view={view} projection={projection} />
        <radialGradient id={glowId} cx="34%" cy="30%" r="72%">
          <stop offset="0%" stopColor={particle?.sign === 'negative' ? '#9dc4ff' : '#ffb4a6'} />
          <stop offset="55%" stopColor={particle?.sign === 'negative' ? '#3b82f6' : '#ea6a5c'} />
          <stop offset="100%" stopColor={particle?.sign === 'negative' ? '#1d4ed8' : '#c8453a'} />
        </radialGradient>
        {boundedField === undefined ? null : (
          <clipPath id={clipId}>
            <rect
              x={projection.px({ x: boundedField.at.x - boundedField.width / 2, y: 0 })}
              y={projection.py({ x: 0, y: boundedField.at.y + boundedField.height / 2 })}
              width={boundedField.width * projection.scale}
              height={boundedField.height * projection.scale}
            />
          </clipPath>
        )}
      </defs>

      {/* Bounded field lines — clipped to the region rectangle, hidden when
          the 电场 observable is off */}
      {boundedField === undefined ||
      view.visible.electricField !== true ||
      fieldLines.length === 0 ? null : (
          <g className={css.electricFieldLattice} clipPath={`url(#${clipId})`} aria-hidden="true">
            {fieldLines.map((line, index) => (
              <g key={index}>
                <line
                  className={css.electricFieldLine}
                  x1={projection.px(line.from)}
                  y1={projection.py(line.from)}
                  x2={projection.px(line.to)}
                  y2={projection.py(line.to)}
                />
                <line
                  x1={projection.px(line.arrowFrom)}
                  y1={projection.py(line.arrowFrom)}
                  x2={projection.px(line.arrowTo)}
                  y2={projection.py(line.arrowTo)}
                  markerEnd={`url(#${markerId('field', projection.uid)})`}
                />
              </g>
            ))}
          </g>
        )}

      {/* Region outline with the same light electric tint the composite
          regions carry: "the field exists in here" should read as an area,
          not just a hairline box the grid shows straight through. */}
      {boundedField === undefined ? null : (
        <rect
          className={clsxJoin(css.boundedFieldRegion, css.regionTintElectric)}
          x={projection.px({ x: boundedField.at.x - boundedField.width / 2, y: 0 })}
          y={projection.py({ x: 0, y: boundedField.at.y + boundedField.height / 2 })}
          width={boundedField.width * projection.scale}
          height={boundedField.height * projection.scale}
        />
      )}

      {/* Plates: metal-finish bars */}
      {plates.map((plate) => {
        const cx = projection.px(plate.at)
        const cy = projection.py(plate.at)
        const halfLength = (plate.length * projection.scale) / 2
        return (
          <g key={plate.id} data-testid={`plate-${plate.top ? 'top' : 'bottom'}`}>
            <rect
              className={clsxJoin(css.plateBar, plate.top ? css.plateTop : css.plateBottom)}
              x={cx - halfLength}
              y={cy - 2.5}
              width={halfLength * 2}
              height={5}
              rx={1.5}
            />
            {/* Surface charge signs sit on the plate's inner face — where the
                charge physically resides — spaced along the whole bar. */}
            {plate.sign === undefined ? null : (
              <g aria-hidden="true">
                {Array.from(
                  { length: Math.max(3, Math.floor((halfLength * 2) / 26)) },
                  (_, index) => (
                    <text
                      key={index}
                      className={clsxJoin(
                        css.plateSignLabel,
                        plate.sign === 'negative' && css.particleLabelNegative,
                      )}
                      x={
                        cx -
                        halfLength +
                        ((index + 0.5) * halfLength * 2) /
                          Math.max(3, Math.floor((halfLength * 2) / 26))
                      }
                      y={cy + (plate.top ? 14 : -8)}
                      textAnchor="middle"
                    >
                      {plate.sign === 'negative' ? '−' : '+'}
                    </text>
                  ),
                )}
              </g>
            )}
          </g>
        )
      })}

      {/* Trajectory */}
      {view.visible.trajectory === true
        ? view.trajectories.map(trajectory => (
          <path
            key={`${trajectory.id}:${trajectory.kind}`}
            className={
              trajectory.kind === 'history' ? css.trajectoryHistory : css.trajectoryPredicted
            }
            d={projection.path(trajectory.points)}
            {...trajectory.kind === 'predicted'
              ? { stroke: `url(#trajectory-fade-${projection.uid}-${trajectory.id})` }
              : {}}
          />
        ))
        : null}
      {view.visible.trajectory === true
        ? (() => {
          const history = view.trajectories.find(trajectory => trajectory.kind === 'history')
          const point = history?.points[history.points.length - 1]
          return point === undefined ? null : (
            <circle
              className={css.trajectoryRunner}
              cx={projection.px(point)}
              cy={projection.py(point)}
              r={4}
            />
          )
        })()
        : null}

      {/* Vectors */}
      <Vectors
        vectors={view.vectors.filter(vector => view.visible[vector.observable] === true)}
        projection={projection}
      />

      {/* Particle */}
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

/* ---------------------------------------------------------------- composite -- */

/**
 * Composite-field renderer: a multi-region apparatus (selector E+B, drift, B-only
 * deflection) plus the charged particle, its trajectory, and the force vectors.
 *
 * Each region is a labelled rectangle; the electric-field lattice is clipped to
 * its region (the field is zero outside it) and the magnetic field shows as ×/·
 * glyphs inside the region it is bound to. A GLOBAL (regionless) field paints the
 * whole canvas instead — arrow lattice for E, ×/· glyphs for B — gated by the
 * matching observable toggle so the checkboxes control something visible. Forces
 * come from the verified composite observation, scaled by the visual bridge —
 * never recomputed here.
 */
function CompositeRenderer({ view, projection }: RendererProps) {
  const regions = view.compositeRegions ?? []
  const particle = view.particles[0]
  const glowId = `pc-composite-glow-${projection.uid}`

  /* Global field textures. Hooks run unconditionally (a regionless frame and a
     multi-region frame must execute the same hook count); the memos fall back to
     empty when the frame carries no global field. */
  const globalElectric = view.electricField
  const globalArrows = useMemo(() => {
    if (globalElectric === undefined) return []
    const spacing = globalElectric.spacing
    const columns = Math.max(1, Math.floor(view.extent.width / spacing))
    const rows = Math.max(1, Math.floor(view.extent.height / spacing))
    const arrowLength = spacing * 0.58
    const arrows: { from: ScenePoint; to: ScenePoint }[] = []
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        const center = {
          x: view.origin.x + spacing * (column + 0.5),
          y: view.origin.y + spacing * (row + 0.5),
        }
        arrows.push({
          from: {
            x: center.x - globalElectric.direction.x * arrowLength * 0.5,
            y: center.y - globalElectric.direction.y * arrowLength * 0.5,
          },
          to: {
            x: center.x + globalElectric.direction.x * arrowLength * 0.5,
            y: center.y + globalElectric.direction.y * arrowLength * 0.5,
          },
        })
      }
    }
    return arrows
  }, [globalElectric, view.extent.height, view.extent.width, view.origin.x, view.origin.y])

  const globalField = view.field
  const globalGlyphs = useMemo(() => {
    if (globalField === undefined) return []
    const spacing = globalField.spacing
    const columns = Math.max(1, Math.floor(view.extent.width / spacing))
    const rows = Math.max(1, Math.floor(view.extent.height / spacing))
    const glyphs: ScenePoint[] = []
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        glyphs.push({
          x: view.origin.x + spacing * (column + 0.5),
          y: view.origin.y + spacing * (row + 0.5),
        })
      }
    }
    return glyphs
  }, [globalField, view.extent.height, view.extent.width, view.origin.x, view.origin.y])

  /* Precompute, per region, the lattice of E-arrows (clipped) and the B-glyph
     grid — both laid out inside that region's rectangle only. */
  const regionPaint = useMemo(
    () =>
      regions.map((region) => {
        const eArrows: { from: ScenePoint; to: ScenePoint }[] = []
        const eField = region.electricField
        if (eField !== undefined) {
          const spacing = eField.spacing
          const columns = Math.max(1, Math.floor(region.width / spacing))
          const rows = Math.max(1, Math.floor(region.height / spacing))
          const arrowLength = spacing * 0.58
          const left = region.at.x - region.width / 2
          const bottom = region.at.y - region.height / 2
          for (let column = 0; column < columns; column += 1) {
            for (let row = 0; row < rows; row += 1) {
              const center = {
                x: left + spacing * (column + 0.5),
                y: bottom + spacing * (row + 0.5),
              }
              eArrows.push({
                from: {
                  x: center.x - eField.direction.x * arrowLength * 0.5,
                  y: center.y - eField.direction.y * arrowLength * 0.5,
                },
                to: {
                  x: center.x + eField.direction.x * arrowLength * 0.5,
                  y: center.y + eField.direction.y * arrowLength * 0.5,
                },
              })
            }
          }
        }
        const bGlyphs: { at: ScenePoint; glyph: string }[] = []
        const bField = region.magneticField
        if (bField !== undefined) {
          const spacing = bField.spacing
          const columns = Math.max(1, Math.floor(region.width / spacing))
          const rows = Math.max(1, Math.floor(region.height / spacing))
          const glyph = bField.direction === 'into-page' ? '×' : '·'
          const left = region.at.x - region.width / 2
          const bottom = region.at.y - region.height / 2
          for (let column = 0; column < columns; column += 1) {
            for (let row = 0; row < rows; row += 1) {
              bGlyphs.push({
                at: {
                  x: left + spacing * (column + 0.5),
                  y: bottom + spacing * (row + 0.5),
                },
                glyph,
              })
            }
          }
        }
        return { region, eArrows, bGlyphs }
      }),
    [regions],
  )

  const trajectoryPaths = useMemo(
    () =>
      view.trajectories.map(trajectory => ({
        id: trajectory.id,
        kind: trajectory.kind,
        path: projection.path(trajectory.points),
      })),
    [projection, view.trajectories],
  )

  /* Region labels stagger upward when two tops land within one text row —
     the stacked spectrometer regions would otherwise overwrite each other. */
  const regionLabelY = useMemo(() => {
    const map = new Map<string, number>()
    let lastX = Number.NEGATIVE_INFINITY
    let lastY = 0
    for (const { region } of [...regionPaint].sort((a, b) => a.region.at.x - b.region.at.x)) {
      const x = projection.px({ x: region.at.x, y: 0 })
      let y = projection.py({ x: 0, y: region.at.y + region.height / 2 }) - 6
      if (x - lastX < 96 && lastY - y < 14) y = lastY - 14
      lastX = x
      lastY = y
      map.set(region.id, y)
    }
    return map
  }, [regionPaint, projection])

  return (
    <>
      <defs>
        <ArrowMarkers uid={projection.uid} />
        <TrajectoryFadeDefs view={view} projection={projection} />
        <radialGradient id={glowId} cx="34%" cy="30%" r="72%">
          <stop offset="0%" stopColor={particle?.sign === 'negative' ? '#9dc4ff' : '#ffb4a6'} />
          <stop offset="55%" stopColor={particle?.sign === 'negative' ? '#3b82f6' : '#ea6a5c'} />
          <stop offset="100%" stopColor={particle?.sign === 'negative' ? '#1d4ed8' : '#c8453a'} />
        </radialGradient>
      </defs>

      {/* Global magnetic field: ×/· glyph grid over the whole canvas, shown
          only while its observable toggle is on. */}
      {view.visible.magneticField === true &&
      globalField !== undefined &&
      globalGlyphs.length > 0 ? (
          <g className={css.fieldGlyph} textAnchor="middle" aria-hidden="true">
            {globalGlyphs.map((at, index) => (
              <text key={index} x={projection.px(at)} y={projection.py(at)}>
                {globalField.direction === 'into-page' ? '×' : '·'}
              </text>
            ))}
          </g>
        ) : null}

      {/* Global electric field: arrow lattice over the whole canvas, same
          gating. */}
      {view.visible.electricField === true && globalArrows.length > 0 ? (
        <g className={css.electricFieldLattice} aria-hidden="true">
          {globalArrows.map((arrow, index) => (
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
      ) : null}

      {/* Regions: outline + clipped E-lattice + B-glyphs + label. The faint
          per-kind tint keeps the apparatus zones tellable apart at a glance
          without competing with vectors or the trajectory. */}
      {regionPaint.map(({ region, eArrows, bGlyphs }) => {
        const clipId = `pc-composite-clip-${projection.uid}-${region.id}`
        const left = region.at.x - region.width / 2
        const top = region.at.y + region.height / 2
        const highlighted = projection.highlighted(region.id)
        const tint =
          region.electricField !== undefined && region.magneticField !== undefined
            ? css.regionTintCrossed
            : region.magneticField !== undefined
              ? css.regionTintMagnetic
              : region.electricField !== undefined
                ? css.regionTintElectric
                : undefined
        return (
          <g key={region.id} className={highlighted ? css.highlightGroup : undefined}>
            <clipPath id={clipId}>
              <rect
                x={projection.px({ x: left, y: 0 })}
                y={projection.py({ x: 0, y: top })}
                width={region.width * projection.scale}
                height={region.height * projection.scale}
              />
            </clipPath>
            <rect
              className={clsxJoin(css.boundedFieldRegion, tint)}
              x={projection.px({ x: left, y: 0 })}
              y={projection.py({ x: 0, y: top })}
              width={region.width * projection.scale}
              height={region.height * projection.scale}
            />
            {eArrows.length > 0 ? (
              <g
                className={css.electricFieldLattice}
                clipPath={`url(#${clipId})`}
                aria-hidden="true"
              >
                {eArrows.map((arrow, index) => (
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
            ) : null}
            {bGlyphs.length > 0 ? (
              <g
                className={css.fieldGlyph}
                textAnchor="middle"
                clipPath={`url(#${clipId})`}
                aria-hidden="true"
              >
                {bGlyphs.map((glyph, index) => (
                  <text key={index} x={projection.px(glyph.at)} y={projection.py(glyph.at)}>
                    {glyph.glyph}
                  </text>
                ))}
              </g>
            ) : null}
            <text
              className={css.annotation}
              x={projection.px({ x: region.at.x, y: 0 })}
              y={regionLabelY.get(region.id) ?? projection.py({ x: 0, y: top }) - 6}
              textAnchor="middle"
            >
              {region.label}
            </text>
          </g>
        )
      })}

      {/* Trajectory */}
      {view.visible.trajectory === true
        ? trajectoryPaths.map(trajectory => (
          <path
            key={`${trajectory.id}:${trajectory.kind}`}
            className={
              trajectory.kind === 'history' ? css.trajectoryHistory : css.trajectoryPredicted
            }
            d={trajectory.path}
          />
        ))
        : null}

      {/* Vectors (velocity, electric force, magnetic force, gravity, net force) */}
      <Vectors
        vectors={view.vectors.filter(vector => view.visible[vector.observable] === true)}
        projection={projection}
      />

      {/* Particle */}
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

/**
 * Mechanics renderer.
 *
 * Draw order is deliberate and reads back-to-front: surfaces, then the path, then
 * construction geometry, then key points, then vectors, then the body last so the
 * live object is never buried under an arrow.
 */
function MechanicsRenderer({ view, projection }: RendererProps) {
  if (view.leverBeam !== undefined) {
    return <LeverRenderer view={view} projection={projection} />
  }
  /* The energy rig is the mechanics domain's third bench, and it is dispatched
     here, above any hook, the way the lever above it and the pressure rigs in
     the fluid renderer are. */
  if (view.energyRamp !== undefined) {
    return <EnergyRenderer view={view} projection={projection} />
  }
  return (
    <>
      <defs>
        <ArrowMarkers uid={projection.uid} />
        <TrajectoryFadeDefs view={view} projection={projection} />
      </defs>

      {view.incline === undefined ? null : (
        <Incline incline={view.incline} projection={projection} />
      )}
      {view.platform === undefined ? null : (
        <Platform platform={view.platform} projection={projection} />
      )}
      {view.ground === undefined ? null : <Ground ground={view.ground} projection={projection} />}

      {/* Photographed rig apparatus draws under the parametric rigs: the
          protractor disc sits behind the swinging string, the rail under the
          sliding body, and the clamp ring around the coil's top joint. */}
      {view.apparatus?.map(sprite => (
        <Apparatus key={sprite.id} sprite={sprite} projection={projection} />
      ))}
      {view.spring === undefined ? null : (
        <SpringCoil spring={view.spring} projection={projection} />
      )}
      {view.pendulum === undefined ? null : (
        <PendulumRig pendulum={view.pendulum} projection={projection} />
      )}

      {view.motionMarks === undefined || view.visible.trajectory !== true ? null : (
        <MotionMarks marks={view.motionMarks} projection={projection} />
      )}

      {view.visible.trajectory === true
        ? view.trajectories.map(trajectory => (
          <path
            key={`${trajectory.id}:${trajectory.kind}`}
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

      {view.guides
        .filter(guide => view.visible[guide.observable] === true)
        .map(guide => (
          <line
            key={guide.id}
            className={css.guideLine}
            x1={projection.px(guide.from)}
            y1={projection.py(guide.from)}
            x2={projection.px(guide.to)}
            y2={projection.py(guide.to)}
          />
        ))}

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
          className={clsxJoin(
            css.annotation,
            label.role === undefined ? undefined : roleClass(label.role),
          )}
        />
      ))}
    </>
  )
}

/** Domain → renderer. Extend here to add a physics domain. */
/** The optics domain's entry point: the imaging bench and the pinhole rig. */
function OpticsDomainRenderer(props: RendererProps) {
  /* BOTH light benches dispatch here: the pinhole rig and the refraction rig are
     two different pictures and only one of them carries `lightRig`, so a
     dispatcher that knew only that one would silently draw the imaging bench for
     a total-reflection scene — the readout would be right and the figure
     missing. */
  if (props.view.lightRig !== undefined || props.view.lightRefraction !== undefined) {
    return <LightRenderer view={props.view} projection={props.projection} />
  }
  return <OpticsRenderer {...props} />
}

/** The induction domain's entry point: the EMF rigs and the transformer. */
function InductionDomainRenderer(props: RendererProps) {
  if (props.view.transformerCoils !== undefined) {
    return <TransformerRenderer view={props.view} projection={props.projection} />
  }
  return <InductionRenderer {...props} />
}

/** The thermal domain's entry point: the heating benches and the thermometer. */
function ThermalDomainRenderer(props: RendererProps) {
  if (props.view.thermometer !== undefined) {
    return <ThermometerRenderer view={props.view} projection={props.projection} />
  }
  return <ThermalRenderer {...props} />
}

/** The acoustics domain's entry point: the echo range and the noise rig. */
function AcousticsDomainRenderer(props: RendererProps) {
  if (props.view.noiseRig !== undefined) {
    return <NoiseRenderer view={props.view} projection={props.projection} />
  }
  return <AcousticsRenderer {...props} />
}

export const RENDERERS = {
  magnetic: MagneticDomainRenderer,
  mechanics: MechanicsRenderer,
  electric: ElectricRenderer,
  circuit: CircuitRenderer,
  composite: CompositeRenderer,
  optics: OpticsDomainRenderer,
  acoustics: AcousticsDomainRenderer,
  fluid: FluidRenderer,
  thermal: ThermalDomainRenderer,
  induction: InductionDomainRenderer,
  wave: WaveRenderer,
} as const satisfies Record<SceneVisualModel['domain'], (props: RendererProps) => ReactElement>

export { CompositeRenderer, ElectricRenderer, MagneticRenderer, MechanicsRenderer }
