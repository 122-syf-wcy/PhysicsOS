/**
 * Physics Icon Set V1.
 *
 * Hand-drawn SVG on a 24x24 grid with a 1.75px optical stroke, informed by the
 * generated concept sheet in UI/generated/. Raster art is never shipped at 24px:
 * these are stroke-based components so they inherit `currentColor`, respond to
 * theme, and stay crisp at any zoom.
 *
 * Every glyph: 24x24 viewBox, round caps and joins, no fill unless it carries
 * meaning, no text. `size` scales uniformly; stroke width is compensated so a
 * 14px icon still reads at the same optical weight as a 24px one.
 */

export interface PhysicsIconProps {
  /** Square edge in px. Defaults to 16. */
  size?: number | undefined
  className?: string | undefined
}

/** Nominal stroke at 24px; scaled up for small sizes to hold optical weight. */
const strokeFor = (size: number): number => {
  const nominal = 1.75
  /* Below ~18px a straight 1.75/24 scale goes visually thin, so lift it. */
  if (size >= 22) return nominal
  if (size >= 18) return nominal * 1.08
  if (size >= 15) return nominal * 1.2
  return nominal * 1.34
}

interface GlyphProps extends PhysicsIconProps {
  children: React.ReactNode
  /** Accessible label; omitted means decorative. */
  label?: string
}

const Glyph = ({ size = 16, className, children, label }: GlyphProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeFor(size)}
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
    {...label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label }}
  >
    {children}
  </svg>
)

/* ------------------------------------------------------------- workspaces -- */

/** Physics laboratory: a flask crossed by an orbit path. */
export const IconPhysicsLab = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M9 3h6" />
    <path d="M10 3v5.2L5.6 17.4A2.2 2.2 0 0 0 7.6 20.6h8.8a2.2 2.2 0 0 0 2-3.2L14 8.2V3" />
    <path d="M7.4 14h9.2" />
  </Glyph>
)

/** Question sheet: a page with rule lines and a folded corner. */
export const IconQuestionSheet = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" />
    <path d="M14 3v3.5A1.5 1.5 0 0 0 15.5 8H19" />
    <path d="M8.5 12.5h7M8.5 16.5h4.5" />
  </Glyph>
)

/* -------------------------------------------------------------- kinematics -- */

/** Kinematics: stroboscopic samples with widening spacing. */
export const IconKinematics = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M3 18h18" />
    <circle cx="5" cy="12.5" r="1.35" />
    <circle cx="9.5" cy="12.5" r="1.35" />
    <circle cx="16" cy="12.5" r="1.35" />
    <path d="M3 6.5h4" />
  </Glyph>
)

/** Velocity: a single tangent arrow. */
export const IconVelocity = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M4 17.5 18.5 7" />
    <path d="M13.2 6.4h5.6v5.4" />
  </Glyph>
)

/** Acceleration: a growing double chevron along a shaft. */
export const IconAcceleration = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M3.5 12h14" />
    <path d="M12.5 7.2 17.8 12l-5.3 4.8" />
    <path d="M7.5 8.8 10.4 12l-2.9 3.2" />
  </Glyph>
)

/** Trajectory: a parabolic arc with a launch dot. */
export const IconTrajectory = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M3.5 19.5C6 8.5 12 5 20.5 5.5" />
    <circle cx="3.6" cy="19.4" r="1.5" fill="currentColor" stroke="none" />
  </Glyph>
)

/* ------------------------------------------------------------------ forces -- */

/** Gravity: a body with a downward arrow. */
export const IconGravity = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <circle cx="12" cy="5.4" r="2.4" />
    <path d="M12 9.4v9.4" />
    <path d="M8.6 15.4 12 19.2l3.4-3.8" />
  </Glyph>
)

/** Single force: an arrow acting on a face. */
export const IconForce = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M4.5 12h12" />
    <path d="M12.6 7.6 17.6 12l-5 4.4" />
    <path d="M20.5 5v14" />
  </Glyph>
)

/** Resultant force: two components resolving into one diagonal. */
export const IconNetForce = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M4 20h11.5" strokeOpacity="0.45" />
    <path d="M4 20V8.5" strokeOpacity="0.45" />
    <path d="M4 20 17.5 6.5" />
    <path d="M11.9 6.2h5.9v5.7" />
  </Glyph>
)

/** Newton's second law: a block driven by a force over a support line. */
export const IconNewtonLaw = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <rect x="4" y="8.5" width="7.5" height="7.5" rx="1.1" />
    <path d="M13.5 12.2h6.6" />
    <path d="M17.3 9.3l2.9 2.9-2.9 2.9" />
    <path d="M2.5 19.5h19" strokeOpacity="0.5" />
  </Glyph>
)

/** Horizontal projectile: launch from a platform, then a falling arc. */
export const IconProjectileHorizontal = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M2.5 5.5h6.5" />
    <path d="M9 5.5c6.4 0.3 10.2 5.1 11.4 14" />
    <circle cx="8.9" cy="5.5" r="1.45" fill="currentColor" stroke="none" />
    <path d="M14 20.5h7.5" strokeOpacity="0.5" />
  </Glyph>
)

/** Oblique projectile: a full arc with an angle mark at the launch point. */
export const IconProjectileOblique = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M3.5 19.5C5.2 8 10.4 4.5 20.5 8.4" />
    <path d="M3.5 19.5 10 13.2" strokeOpacity="0.42" />
    <path d="M3.5 19.5h6.5" strokeOpacity="0.42" />
    <path d="M9.4 19.5a6 6 0 0 0-1.8-4.2" strokeWidth="1.2" />
  </Glyph>
)

/** Inclined plane: a wedge with a block resting on the slope. */
export const IconInclinedPlane = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M3 19.5h18L3 6.5z" />
    <rect x="8.1" y="10.6" width="4.6" height="4.6" rx="0.9" transform="rotate(35.8 10.4 12.9)" />
  </Glyph>
)

/** Friction: a contact surface with opposing drag. */
export const IconFriction = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <rect x="6" y="6.5" width="12" height="6.5" rx="1.1" />
    <path d="M3 16.8h18" />
    <path d="M4.5 20.4l2-3.2M9 20.4l2-3.2M13.5 20.4l2-3.2M18 20.4l2-3.2" strokeWidth="1.2" />
  </Glyph>
)

/** Normal force: an upward arrow off a support surface. */
export const IconNormalForce = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M3 20h18" />
    <path d="M12 18V6.2" />
    <path d="M8.6 9.6 12 5.8l3.4 3.8" />
  </Glyph>
)

/* ------------------------------------------------------- time and analysis -- */

/** Time: a clock with hands. */
export const IconTime = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7.4V12l3.4 2.3" />
  </Glyph>
)

/** Timeline: a track with an event tick above it. */
export const IconTimeline = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M3 15h18" />
    <path d="M7.5 15v-4M13 15v-6.5M18.5 15v-3" />
    <circle cx="13" cy="7" r="1.4" fill="currentColor" stroke="none" />
  </Glyph>
)

/** Chart: axes with a rising curve. */
export const IconChart = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M4.5 3.5v16.5H21" />
    <path d="M7.5 16.2c2.6-0.3 4-2.2 5.2-4.6 1.1-2.3 2.4-4 5.1-4.4" />
  </Glyph>
)

/** Measurement: a dimension line with end serifs. */
export const IconMeasurement = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M4.5 12h15" />
    <path d="M4.5 7.5v9M19.5 7.5v9" />
  </Glyph>
)

/** Verification: a check inside a rounded shield. */
export const IconVerified = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M12 2.8 20 6v6.2c0 4.3-3.2 7.6-8 9-4.8-1.4-8-4.7-8-9V6z" />
    <path d="M8.6 11.9 11.2 14.5 15.8 9.9" />
  </Glyph>
)

/* --------------------------------------------------------- scene structure -- */

/** Scene: stacked layers. */
export const IconScene = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M12 3 21 7.6 12 12.2 3 7.6z" />
    <path d="M3 12.4l9 4.6 9-4.6" />
    <path d="M3 16.9l9 4.6 9-4.6" strokeOpacity="0.5" />
  </Glyph>
)

/** Observable: an eye. */
export const IconObservable = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M1.9 12S5.4 5.8 12 5.8 22.1 12 22.1 12 18.6 18.2 12 18.2 1.9 12 1.9 12z" />
    <circle cx="12" cy="12" r="2.7" />
  </Glyph>
)

/** Variable: an italic slot with a value handle. */
export const IconVariable = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M4 20.5 13.5 3.5" />
    <path d="M17 8.5h3.5M17 15.5h3.5" />
  </Glyph>
)

/** Key point: a target ring. */
export const IconKeyPoint = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <circle cx="12" cy="12" r="7.6" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </Glyph>
)

/** Ground: a baseline with hatching beneath. */
export const IconGround = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M2.5 10h19" />
    <path d="M4 14.6l2.4-3.2M9 14.6l2.4-3.2M14 14.6l2.4-3.2M19 14.6l2.4-3.2" strokeWidth="1.2" />
  </Glyph>
)

/* ---------------------------------------------------------------- transport -- */

/** Play. */
export const IconPhysicsPlay = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M7.5 4.8 19 12 7.5 19.2z" />
  </Glyph>
)

/** Pause. */
export const IconPhysicsPause = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M8.8 4.8v14.4M15.2 4.8v14.4" />
  </Glyph>
)

/** Reset: a counter-clockwise loop back to the start. */
export const IconPhysicsReset = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M3.9 12a8.1 8.1 0 1 0 2.6-5.9" />
    <path d="M3.4 4.4v4.3h4.3" />
  </Glyph>
)

/** Single step forward. */
export const IconPhysicsStep = (props: PhysicsIconProps) => (
  <Glyph {...props}>
    <path d="M6.5 5.2 15 12l-8.5 6.8z" />
    <path d="M18.2 4.8v14.4" />
  </Glyph>
)

/* ------------------------------------------------------------------ mapping -- */

/** Icon for a scene-tree node kind. */
export const SCENE_TREE_ICONS = {
  folder: IconScene,
  field: IconGravity,
  particle: IconKeyPoint,
  body: IconNewtonLaw,
  ground: IconGround,
  incline: IconInclinedPlane,
  gravity: IconGravity,
  velocity: IconVelocity,
  acceleration: IconAcceleration,
  force: IconForce,
  trajectory: IconTrajectory,
  observable: IconObservable,
  variable: IconVariable,
  keyPoint: IconKeyPoint,
} as const
