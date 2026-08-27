/**
 * Experiment artwork: one hand-drawn scene per template.
 *
 * Each piece is a miniature of the REAL experiment — the incline art is a wedge
 * with a resting block and its force pair, the spectrometer art is a selector
 * feeding a half-circle into a detector — not an abstract logo. All pieces share
 * one 120x68 stage, one stroke grammar (2.2px primary path, 1.6px secondary
 * structure, dashed guides, filled particles) and paint in `currentColor`, so
 * the card that hosts them sets the subject colour and the artwork follows.
 *
 * The host paints the tinted backdrop (see `.art` in ExperimentPicker.module.css);
 * the SVG itself stays transparent so one composition works at every card size.
 */

import type { ReactElement } from 'react'

/* ------------------------------------------------------------------ helpers -- */

interface ArrowProps {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  readonly width?: number
  readonly opacity?: number
  readonly head?: number
}

/** A stroked shaft with a filled tip; the shaft stops short so the tip stays sharp. */
const Arrow = ({ x1, y1, x2, y2, width = 2.2, opacity = 1, head = 5 }: ArrowProps) => {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const bx = x2 - ux * head
  const by = y2 - uy * head
  const px = -uy * head * 0.42
  const py = ux * head * 0.42
  return (
    <g opacity={opacity}>
      <line
        x1={x1}
        y1={y1}
        x2={x2 - ux * head * 0.6}
        y2={y2 - uy * head * 0.6}
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap="round"
      />
      <path
        d={`M${x2} ${y2} L${bx + px} ${by + py} L${bx - px} ${by - py} Z`}
        fill="currentColor"
      />
    </g>
  )
}

interface CrossProps {
  readonly x: number
  readonly y: number
  readonly s?: number
  readonly opacity?: number
}

/** A ×: the into-the-page magnetic field mark. */
const Cross = ({ x, y, s = 2.6, opacity = 0.38 }: CrossProps) => (
  <g opacity={opacity} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
    <line x1={x - s} y1={y - s} x2={x + s} y2={y + s} />
    <line x1={x - s} y1={y + s} x2={x + s} y2={y - s} />
  </g>
)

interface LineProps {
  readonly d: string
  readonly width?: number
  readonly opacity?: number
  readonly dash?: string
}

/** A stroked open path; `dash` switches it to a guide. */
const Stroke = ({ d, width = 2.2, opacity = 1, dash }: LineProps) => (
  <path
    d={d}
    fill="none"
    stroke="currentColor"
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
    opacity={opacity}
    {...dash === undefined ? {} : { strokeDasharray: dash }}
  />
)

interface DotProps {
  readonly x: number
  readonly y: number
  readonly r?: number
  readonly opacity?: number
}

const Dot = ({ x, y, r = 2.6, opacity = 1 }: DotProps) => (
  <circle cx={x} cy={y} r={r} fill="currentColor" opacity={opacity} />
)

interface ChargeProps {
  readonly x: number
  readonly y: number
  readonly sign: '+' | '-'
  readonly r?: number
}

/** A filled source charge with its polarity knocked out of the fill. */
const Charge = ({ x, y, sign, r = 4.4 }: ChargeProps) => (
  <g>
    <circle cx={x} cy={y} r={r} fill="currentColor" />
    <g stroke="var(--dsw-alias-bg-base, #fff)" strokeWidth={1.5} strokeLinecap="round">
      <line x1={x - r * 0.45} y1={y} x2={x + r * 0.45} y2={y} />
      {sign === '+' ? <line x1={x} y1={y - r * 0.45} x2={x} y2={y + r * 0.45} /> : null}
    </g>
  </g>
)

/* ----------------------------------------------------------------- mechanics -- */

const UniformLinearArt = () => (
  <>
    <Stroke d="M10 47 H110" width={1.6} opacity={0.35} />
    {[26, 50, 74, 98].map((x, index) => (
      <g key={x}>
        <Dot x={x} y={40} r={3} opacity={0.3 + index * 0.23} />
        <Stroke d={`M${x} 45 V49`} width={1.4} opacity={0.3} />
      </g>
    ))}
    <Arrow x1={98} y1={28} x2={114} y2={28} width={2.4} />
    <Stroke d="M10 21 H30" width={1.6} opacity={0.25} />
  </>
)

const UniformAccelerationArt = () => (
  <>
    <Stroke d="M10 47 H110" width={1.6} opacity={0.35} />
    {[18, 34, 56, 86].map((x, index) => (
      <g key={x}>
        <Dot x={x} y={40} r={3} opacity={0.3 + index * 0.23} />
        <Stroke d={`M${x} 45 V49`} width={1.4} opacity={0.3} />
      </g>
    ))}
    <Arrow x1={78} y1={26} x2={108} y2={26} width={2.4} />
    <Stroke d="M84 20.5 L90 26 L84 31.5" width={2} opacity={0.55} />
  </>
)

const PROJECTILE_TRAIL: readonly (readonly [number, number])[] =
  [[52, 25.5], [70, 32], [87, 42], [100, 53]]

const ProjectileHorizontalArt = () => (
  <>
    <Stroke d="M8 22 H34 V27" width={2} opacity={0.5} />
    <Dot x={32} y={18.5} r={3} />
    <Arrow x1={36} y1={18.5} x2={54} y2={18.5} width={2} opacity={0.8} />
    <Stroke d="M34 22 C58 25 84 36 104 58" dash="1 6" width={2.2} opacity={0.75} />
    {PROJECTILE_TRAIL.map(([x, y], index) => (
      <Dot key={x} x={x} y={y} r={2.2} opacity={0.35 + index * 0.2} />
    ))}
    <Stroke d="M46 60 H112" width={1.6} opacity={0.3} />
  </>
)

const ProjectileObliqueArt = () => (
  <>
    <Stroke d="M8 56 H112" width={1.6} opacity={0.35} />
    <Stroke d="M14 56 C34 14 76 12 106 56" dash="1 6" width={2.2} opacity={0.75} />
    <Dot x={59} y={23.5} r={2.4} opacity={0.85} />
    <Stroke d="M14 56 L36 34" width={1.4} opacity={0.3} />
    <Stroke d="M26 56 A12 12 0 0 0 22.5 47.5" width={1.4} opacity={0.45} />
    <Arrow x1={14} y1={56} x2={31} y2={39} width={2.4} />
  </>
)

const NewtonLawArt = () => (
  <>
    <Stroke d="M8 52 H112" width={1.6} opacity={0.4} />
    {[20, 44, 68, 92].map(x => (
      <Stroke key={x} d={`M${x} 60 l6 -8`} width={1.3} opacity={0.22} />
    ))}
    <rect x={48} y={30} width={26} height={22} rx={3} fill="currentColor" fillOpacity={0.14} stroke="currentColor" strokeWidth={2} />
    <Arrow x1={18} y1={41} x2={46} y2={41} width={2.6} />
    <Arrow x1={80} y1={24} x2={100} y2={24} width={2} opacity={0.55} head={4.2} />
  </>
)

const InclineArt = () => (
  <>
    <Stroke d="M14 56 H106 V22 Z" width={2} opacity={0.6} />
    <rect x={46} y={26.5} width={17} height={17} rx={2.4} transform="rotate(-20.3 54.5 35)" fill="currentColor" fillOpacity={0.14} stroke="currentColor" strokeWidth={2} />
    <Arrow x1={57} y1={44} x2={57} y2={60} width={1.8} opacity={0.6} head={4.4} />
    <Arrow x1={52} y1={28} x2={46.5} y2={13} width={1.8} opacity={0.6} head={4.4} />
  </>
)

/* ------------------------------------------------------------------ electric -- */

const PointChargeArt = () => (
  <>
    <circle cx={60} cy={34} r={19} fill="none" stroke="currentColor" strokeWidth={1.3} strokeDasharray="1 5" opacity={0.5} />
    {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
      const ux = Math.cos((deg * Math.PI) / 180)
      const uy = Math.sin((deg * Math.PI) / 180)
      return (
        <Arrow
          key={deg}
          x1={60 + ux * 8}
          y1={34 + uy * 8}
          x2={60 + ux * 27}
          y2={34 + uy * 27}
          width={1.7}
          opacity={deg % 90 === 0 ? 0.85 : 0.45}
          head={4.2}
        />
      )
    })}
    <Charge x={60} y={34} sign="+" />
  </>
)

const MultiPointChargeArt = () => (
  <>
    <Stroke d="M42 27 C52 17 68 17 78 27" width={1.7} opacity={0.55} />
    <Stroke d="M42 41 C52 51 68 51 78 41" width={1.7} opacity={0.55} />
    <Arrow x1={44} y1={34} x2={74} y2={34} width={1.7} opacity={0.8} head={4.4} />
    <Stroke d="M30 26 L22 18" width={1.4} opacity={0.3} />
    <Stroke d="M30 42 L22 50" width={1.4} opacity={0.3} />
    <Stroke d="M90 26 L98 18" width={1.4} opacity={0.3} />
    <Stroke d="M90 42 L98 50" width={1.4} opacity={0.3} />
    <Charge x={36} y={34} sign="+" />
    <Charge x={84} y={34} sign="-" />
  </>
)

const UniformElectricArt = () => (
  <>
    <circle cx={60} cy={36} r={19} fill="none" stroke="currentColor" strokeWidth={1.6} strokeDasharray="2 5" opacity={0.6} />
    <Charge x={60} y={36} sign="+" r={4} />
    <Dot x={76.3} y={26.4} r={2.8} />
    <Arrow x1={78} y1={24.5} x2={90} y2={14.5} width={2} head={4.6} />
    <Stroke d="M60 36 L74 27.5" width={1.3} opacity={0.35} dash="1 4" />
  </>
)

const ParallelPlateArt = () => (
  <>
    <Stroke d="M22 16 H98" width={2.6} />
    <Stroke d="M22 52 H98" width={2.6} opacity={0.55} />
    {[38, 60, 82].map(x => (
      <Arrow key={x} x1={x} y1={22} x2={x} y2={45} width={1.5} opacity={0.35} head={4} />
    ))}
    <Dot x={12} y={32} r={2.8} />
    <Stroke d="M8 32 H30 C56 32 76 36 96 47" width={2.4} />
    <Arrow x1={88} y1={44.2} x2={98} y2={48} width={2.4} head={5} />
  </>
)

/* ------------------------------------------------------------------ magnetic -- */

const MagneticCircularArt = () => (
  <>
    {[38, 60, 82].flatMap(x => [22, 46].map(y => <Cross key={`${x}-${y}`} x={x} y={y} />))}
    <circle cx={60} cy={34} r={21} fill="none" stroke="currentColor" strokeWidth={2.2} opacity={0.85} />
    <Dot x={81} y={34} r={3} />
    <Arrow x1={81} y1={30} x2={81} y2={14} width={2.2} />
    <Arrow x1={77} y1={34} x2={66} y2={34} width={1.5} opacity={0.45} head={4} />
  </>
)

/* ----------------------------------------------------------------- composite -- */

const VelocitySelectorArt = () => (
  <>
    <rect x={28} y={16} width={64} height={36} rx={4} fill="none" stroke="currentColor" strokeWidth={1.6} opacity={0.45} />
    {[42, 78].map(x => (
      <Arrow key={x} x1={x} y1={21} x2={x} y2={33} width={1.4} opacity={0.35} head={3.6} />
    ))}
    <Cross x={42} y={44} />
    <Cross x={78} y={44} />
    <Dot x={18} y={34} r={2.8} />
    <Stroke d="M8 34 H104" width={2.4} />
    <Arrow x1={100} y1={34} x2={112} y2={34} width={2.4} />
    <Arrow x1={60} y1={29} x2={60} y2={19} width={1.8} opacity={0.75} head={4.2} />
    <Arrow x1={60} y1={39} x2={60} y2={49} width={1.8} opacity={0.75} head={4.2} />
  </>
)

const MassSpectrometerArt = () => (
  <>
    <Stroke d="M10 28 H34 M10 40 H34" width={1.7} opacity={0.45} />
    <Dot x={14} y={34} r={2.6} />
    <Stroke d="M8 34 H48" width={2.2} />
    <Stroke d="M48 34 A19 19 0 0 1 86 34" width={2.4} />
    <Arrow x1={86} y1={30} x2={86} y2={36} width={2.4} head={4.6} />
    <Stroke d="M40 34 H100" width={1.7} opacity={0.4} />
    {[92, 98].map(x => (
      <Stroke key={x} d={`M${x} 34 V29`} width={1.4} opacity={0.5} />
    ))}
    <Cross x={60} y={22} />
    <Cross x={74} y={26} />
  </>
)

const CompositeEBArt = () => (
  <>
    <rect x={26} y={14} width={68} height={40} rx={4} fill="none" stroke="currentColor" strokeWidth={1.6} opacity={0.4} />
    <Arrow x1={40} y1={20} x2={40} y2={32} width={1.4} opacity={0.35} head={3.6} />
    <Arrow x1={66} y1={20} x2={66} y2={32} width={1.4} opacity={0.35} head={3.6} />
    <Cross x={52} y={44} />
    <Cross x={80} y={44} />
    <Dot x={12} y={34} r={2.8} />
    <Stroke d="M8 34 C22 34 26 26 40 26 C54 26 54 42 68 42 C82 42 84 27 98 27" width={2.4} />
    <Arrow x1={94} y1={27.6} x2={106} y2={26.5} width={2.4} />
  </>
)

const CompositeEBGArt = () => (
  <>
    <rect x={26} y={12} width={68} height={44} rx={4} fill="none" stroke="currentColor" strokeWidth={1.6} opacity={0.4} />
    <Arrow x1={42} y1={18} x2={42} y2={29} width={1.4} opacity={0.35} head={3.6} />
    <Cross x={66} y={22} />
    <Cross x={44} y={42} />
    <Dot x={12} y={28} r={2.8} />
    <Stroke d="M8 28 C24 28 32 22 44 27 C58 33 62 44 76 48 C86 51 92 52 100 54" width={2.4} />
    <Arrow x1={96} y1={53} x2={107} y2={55.5} width={2.4} />
    <Arrow x1={84} y1={30} x2={84} y2={42} width={1.8} opacity={0.7} head={4.2} />
  </>
)

const MultiRegionArt = () => (
  <>
    <Stroke d="M44 12 V56" width={1.4} opacity={0.35} dash="3 4" />
    <Stroke d="M78 12 V56" width={1.4} opacity={0.35} dash="3 4" />
    <Cross x={56} y={20} />
    <Cross x={68} y={44} />
    <Arrow x1={88} y1={18} x2={88} y2={30} width={1.4} opacity={0.35} head={3.6} />
    <Arrow x1={102} y1={18} x2={102} y2={30} width={1.4} opacity={0.35} head={3.6} />
    <Dot x={12} y={30} r={2.8} />
    <Stroke d="M8 30 H44" width={2.4} />
    <Stroke d="M44 30 A15 15 0 0 1 78 41" width={2.4} />
    <Stroke d="M78 41 C88 46 96 50 104 55" width={2.4} />
    <Arrow x1={100} y1={52.7} x2={109} y2={57.5} width={2.4} />
  </>
)

const CyclotronArt = () => (
  <>
    <Stroke d="M56 12 A22 22 0 0 0 56 56" width={1.8} opacity={0.5} />
    <Stroke d="M56 12 V56" width={1.8} opacity={0.5} />
    <Stroke d="M64 12 A22 22 0 0 1 64 56" width={1.8} opacity={0.5} />
    <Stroke d="M64 12 V56" width={1.8} opacity={0.5} />
    <Stroke d="M60 34 a5 5 0 0 1 5 -5 a7.5 7.5 0 0 1 7.5 7.5 a11 11 0 0 1 -11 11 a15 15 0 0 1 -15 -15 a19 19 0 0 1 19 -19" width={2.2} />
    <Arrow x1={62} y1={13.6} x2={68} y2={15} width={2.2} head={4.6} />
  </>
)

/* ------------------------------------------------------------------- circuit -- */

interface BatteryProps {
  /** Centre of the plate pair on a horizontal bottom wire. */
  readonly x: number
  readonly y: number
}

/** Battery on a horizontal wire: long thin positive plate right, short thick −. */
const BatteryPlates = ({ x, y }: BatteryProps) => (
  <g stroke="currentColor" strokeLinecap="round">
    <line x1={x + 3} y1={y - 8} x2={x + 3} y2={y + 8} strokeWidth={2} />
    <line x1={x - 3} y1={y - 4.4} x2={x - 3} y2={y + 4.4} strokeWidth={3.6} strokeLinecap="butt" />
  </g>
)

interface MeterProps {
  readonly x: number
  readonly y: number
}

/** Round meter face with a needle; the letter stays off artwork (no text rule). */
const MeterFace = ({ x, y }: MeterProps) => (
  <>
    <circle cx={x} cy={y} r={7} fill="none" stroke="currentColor" strokeWidth={2} />
    <Stroke d={`M${x} ${y + 3} L${x + 3.4} ${y - 3.4}`} width={1.5} opacity={0.75} />
  </>
)

interface BoxProps {
  readonly x: number
  readonly y: number
  readonly w?: number
  readonly h?: number
}

/** Resistor body centred at (x, y). */
const ResistorBox = ({ x, y, w = 20, h = 9 }: BoxProps) => (
  <rect
    x={x - w / 2}
    y={y - h / 2}
    width={w}
    height={h}
    rx={1}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
  />
)

const SeriesCircuitArt = () => (
  <>
    <Stroke d="M22 14 H34 M54 14 H66 M86 14 H98 V54 H64" width={2} opacity={0.85} />
    <ResistorBox x={44} y={14} />
    <ResistorBox x={76} y={14} />
    <BatteryPlates x={61} y={54} />
    <Stroke d="M58 54 H22 V41 M22 27 V14" width={2} opacity={0.85} />
    <MeterFace x={22} y={34} />
  </>
)

const ParallelCircuitArt = () => (
  <>
    <Stroke d="M26 18 H94 V50 H26 M26 18 V29 M26 39 V50" width={2} opacity={0.85} />
    <Stroke d="M18 31 H34" width={2} />
    <line x1={22} y1={37} x2={30} y2={37} stroke="currentColor" strokeWidth={3.6} />
    <Stroke d="M46 18 V25 M46 43 V50 M74 18 V25 M74 43 V50" width={2} opacity={0.85} />
    <ResistorBox x={46} y={34} w={9} h={18} />
    <ResistorBox x={74} y={34} w={9} h={18} />
    <Dot x={46} y={18} r={2} />
    <Dot x={74} y={18} r={2} />
    <Dot x={46} y={50} r={2} />
    <Dot x={74} y={50} r={2} />
  </>
)

const MixedCircuitArt = () => (
  <>
    <Stroke d="M14 22 H26 M44 22 H56" width={2} opacity={0.85} />
    <ResistorBox x={35} y={22} w={18} />
    <Stroke d="M56 22 V12 H64 M82 12 H94 V22 M56 22 V32 H64 M82 32 H94 V22" width={2} opacity={0.85} />
    <ResistorBox x={73} y={12} w={18} />
    <ResistorBox x={73} y={32} w={18} />
    <Dot x={56} y={22} r={2} />
    <Dot x={94} y={22} r={2} />
    <Stroke d="M94 22 V54 H64" width={2} opacity={0.85} />
    <BatteryPlates x={61} y={54} />
    <Stroke d="M58 54 H14 V22" width={2} opacity={0.85} />
  </>
)

const RheostatCircuitArt = () => (
  <>
    <Stroke d="M22 14 H38 M64 14 H98 V54 H64" width={2} opacity={0.85} />
    <ResistorBox x={51} y={14} w={26} />
    <Arrow x1={42} y1={24} x2={59} y2={5.5} width={1.7} head={4.2} />
    <BatteryPlates x={61} y={54} />
    <Stroke d="M58 54 H22 V41 M22 27 V14" width={2} opacity={0.85} />
    <MeterFace x={22} y={34} />
  </>
)

const EmfMeasurementArt = () => (
  <>
    <Stroke d="M98 54 H64" width={2} opacity={0.85} />
    <BatteryPlates x={61} y={54} />
    <Stroke d="M58 54 H22 V14 H36 M60 14 H98 V27 M98 41 V54" width={2} opacity={0.85} />
    <ResistorBox x={48} y={14} w={24} />
    <Arrow x1={40} y1={24} x2={55} y2={5.5} width={1.7} head={4.2} />
    <MeterFace x={98} y={34} />
    <MeterFace x={61} y={36} />
    <Stroke d="M54 36 H47 V54 M68 36 H75 V54" width={1.5} opacity={0.6} />
    <Dot x={47} y={54} r={2} />
    <Dot x={75} y={54} r={2} />
  </>
)

/* -------------------------------------------------------------- junior high -- */

/** 测平均速度: a gentle ramp, the cart sampled at widening spacing, a stopwatch. */
const AverageSpeedArt = () => (
  <>
    <Stroke d="M14 24 L106 54 H14 Z" width={2.2} />
    <Stroke d="M20 18 v9 M100 46 v9" width={1.5} opacity={0.5} />
    <Dot x={32} y={27} r={2.4} opacity={0.55} />
    <Dot x={56} y={35} r={2.4} opacity={0.75} />
    <Dot x={82} y={44} r={2.4} />
    <circle cx={96} cy={17} r={9} fill="none" stroke="currentColor" strokeWidth={1.8} />
    <Stroke d="M96 11.5 V17 l4 2.6" width={1.5} />
    <Stroke d="M96 6.4 v2 M92.5 7.2 l1.4 1.6" width={1.4} opacity={0.6} />
  </>
)

/** 伏安法测电阻: the Rx box in a loop with the series meter and the tapped voltmeter. */
const VaResistanceArt = () => (
  <>
    <Stroke d="M16 16 H46 M74 16 H104 M16 16 V52 H51.5 M104 16 V52 H68.5" width={2} />
    <rect x={46} y={10.5} width={28} height={11} fill="none" stroke="currentColor" strokeWidth={2.2} />
    <circle cx={60} cy={52} r={8.5} fill="none" stroke="currentColor" strokeWidth={2} />
    <Stroke d="M60 56 l4.4-6.6" width={1.6} />
    <Stroke d="M50 21.5 V33.5 M70 21.5 V33.5" width={1.5} opacity={0.5} />
    <circle cx={60} cy={37} r={7} fill="none" stroke="currentColor" strokeWidth={1.8} />
    <Stroke d="M60 40.2 l3.4-5.2" width={1.4} />
    <Stroke d="M50 33.5 h20" width={1.5} opacity={0.5} />
  </>
)

/** 测小灯泡电功率: the circle-cross bulb fed through a rheostat, meter in loop. */
const BulbPowerArt = () => (
  <>
    <Stroke d="M14 18 H44 M68 18 H106 M14 18 V52 H36 M106 18 V52 H86" width={2} />
    <circle cx={56} cy={18} r={12} fill="none" stroke="currentColor" strokeWidth={2.2} />
    <Stroke d="M47.8 9.8 64.2 26.2 M64.2 9.8 47.8 26.2" width={1.8} />
    <rect x={36} y={47} width={28} height={10} fill="none" stroke="currentColor" strokeWidth={2} />
    <Arrow x1={42} y1={38} x2={54} y2={44.5} width={1.6} head={4} />
    <circle cx={75} cy={52} r={7} fill="none" stroke="currentColor" strokeWidth={1.8} />
    <Stroke d="M75 55.4 l3.4-5.2" width={1.4} />
  </>
)

/** 杠杆平衡: a tilted beam on its fulcrum, unequal loads at unequal arms. */
const LeverBalanceArt = () => (
  <>
    <Stroke d="M14 26 L106 38" width={2.4} />
    <Stroke d="M60 33 L48 58 H72 Z" width={2} />
    <Stroke d="M24 27.5 V38" width={1.5} opacity={0.6} />
    <rect x={17} y={38} width={14} height={12} fill="none" stroke="currentColor" strokeWidth={2} />
    <Stroke d="M96 36.8 V44" width={1.5} opacity={0.6} />
    <rect x={91.5} y={44} width={9} height={8} fill="none" stroke="currentColor" strokeWidth={1.8} />
    <Stroke d="M60 22 V30" width={1.4} opacity={0.4} dash="1 3" />
  </>
)

/** 浮力: a beaker, the waterline, a submerged block with upthrust vs. weight. */
const BuoyancyArt = () => (
  <>
    <Stroke d="M32 12 V56 H88 V12" width={2.2} />
    <Stroke d="M34 24 H86" width={1.5} opacity={0.5} dash="4 3" />
    <rect x={50} y={30} width={20} height={16} fill="none" stroke="currentColor" strokeWidth={2.2} />
    <Arrow x1={60} y1={29} x2={60} y2={15} width={2} />
    <Arrow x1={60} y1={47} x2={60} y2={55} width={1.6} opacity={0.6} />
    <Dot x={42} y={34} r={1.4} opacity={0.4} />
    <Dot x={78} y={40} r={1.4} opacity={0.4} />
  </>
)

/* -------------------------------------------------------------------- optics -- */

/** 平面镜成像: candle before the glass plate, mirrored dashes behind it. */
const PlaneMirrorArt = () => (
  <>
    <Stroke d="M10 52 H110" width={1.6} opacity={0.35} />
    <Stroke d="M60 12 V52" width={2.6} />
    {[17, 27, 37, 47].map(y => (
      <Stroke key={y} d={`M61.5 ${y + 4} L68 ${y - 3}`} width={1.3} opacity={0.4} />
    ))}
    <Stroke d="M34 30 V52" width={2.4} />
    <Stroke d="M34 30 c-3.5 -4.5 3.5 -7.5 0 -12 c5 3 4.5 8 0 12" width={1.8} />
    <Stroke d="M86 30 V52" width={2.4} opacity={0.5} dash="4 3" />
    <Stroke d="M86 30 c-3.5 -4.5 3.5 -7.5 0 -12" width={1.6} opacity={0.5} dash="3 3" />
    <Stroke d="M36 34 L60 26 M60 26 L42 20" width={1.4} opacity={0.55} />
    <Stroke d="M60 26 L84 33.5" width={1.3} opacity={0.4} dash="2 3" />
  </>
)

/** 凸透镜成像: candle, lens with F marks, inverted image caught on the screen. */
const ConvexLensArt = () => (
  <>
    <Stroke d="M8 36 H112" width={1.5} opacity={0.35} dash="5 4" />
    <Stroke d="M60 12 V60" width={2.4} />
    <Stroke d="M56.5 16 L60 12 L63.5 16 M56.5 56 L60 60 L63.5 56" width={2} />
    {[42, 78].map(x => (
      <Stroke key={x} d={`M${x} 33 V39`} width={1.5} opacity={0.5} />
    ))}
    <Stroke d="M24 36 V18" width={2.4} />
    <Stroke d="M20.8 22 L24 18 L27.2 22" width={2} />
    <Stroke d="M24 18 H60 L96 47 M24 18 L96 47" width={1.4} opacity={0.55} />
    <Stroke d="M96 47 V36" width={2.4} opacity={0.85} />
    <Stroke d="M92.8 43 L96 47 L99.2 43" width={2} opacity={0.85} />
    <Stroke d="M103 20 V54" width={2.6} opacity={0.6} />
  </>
)

/** 凹面镜成像: candle, concave mirror with F/C marks, inverted image in front. */
const ConcaveMirrorArt = () => (
  <>
    <Stroke d="M8 36 H112" width={1.5} opacity={0.35} dash="5 4" />
    <Stroke d="M92 14 q9 22 0 44" width={2.4} />
    {([[20, 94.1], [29, 96], [43, 96], [52, 94.4]] as const).map(([y, x]) => (
      <Stroke key={y} d={`M${x + 1.5} ${y + 3} L${x + 6.5} ${y - 3}`} width={1.2} opacity={0.4} />
    ))}
    {[73, 50].map(x => (
      <Stroke key={x} d={`M${x} 33 V39`} width={1.5} opacity={0.5} />
    ))}
    <Stroke d="M30 36 V18" width={2.4} />
    <Stroke d="M26.8 22 L30 18 L33.2 22" width={2} />
    <Stroke d="M30 18 H93.5 L60 47 M30 18 L96.5 36 L60 47" width={1.4} opacity={0.55} />
    <Stroke d="M60 36 V47" width={2.4} opacity={0.85} />
    <Stroke d="M56.8 43 L60 47 L63.2 43" width={2} opacity={0.85} />
  </>
)

/** 凸面镜后视镜: object, diverging mirror, small upright virtual image behind. */
const ConvexMirrorArt = () => (
  <>
    <Stroke d="M8 36 H112" width={1.5} opacity={0.35} dash="5 4" />
    <Stroke d="M92 14 q-9 22 0 44" width={2.4} />
    {([[20, 89.9], [29, 87.9], [43, 87.9], [52, 89.9]] as const).map(([y, x]) => (
      <Stroke key={y} d={`M${x + 1.5} ${y + 3} L${x + 6.5} ${y - 3}`} width={1.2} opacity={0.4} />
    ))}
    <Stroke d="M30 36 V24" width={2.4} />
    <Stroke d="M26.8 28 L30 24 L33.2 28" width={2} />
    <Stroke d="M30 24 H90.7 L70 10" width={1.4} opacity={0.55} />
    <Stroke d="M30 24 L92 36 L34 47.2" width={1.4} opacity={0.55} />
    <Stroke d="M90.7 24 L104 33 M92 36 L104 33" width={1.2} opacity={0.4} dash="4 3" />
    <Stroke d="M104 36 V33" width={2.4} opacity={0.85} />
    <Stroke d="M102.4 35 L104 33 L105.6 35" width={2} opacity={0.85} />
  </>
)

/* ----------------------------------------------------------------- acoustics -- */

/** 回声测距: speaker on open ground, wave arcs out to the hatched cliff. */
const EchoRangingArt = () => (
  <>
    <Stroke d="M10 54 H110" width={1.6} opacity={0.35} />
    <Stroke d="M16 44 h7 l8 -6 v16 l-8 -6 h-7 z" width={2.2} />
    <Stroke d="M40 39 a8 8 0 0 1 0 12" width={1.7} opacity={0.5} />
    <Stroke d="M48 35.5 a13.5 13.5 0 0 1 0 19" width={1.7} opacity={0.65} />
    <Stroke d="M56 32 a19 19 0 0 1 0 26" width={1.7} opacity={0.8} />
    <Stroke d="M96 14 V54" width={2.6} />
    {[19, 28, 37, 46].map(y => (
      <Stroke key={y} d={`M97.5 ${y + 4} L104 ${y - 3}`} width={1.3} opacity={0.4} />
    ))}
    <Arrow x1={64} y1={38} x2={92} y2={38} width={1.7} opacity={0.75} head={4.4} />
    <Arrow x1={92} y1={48} x2={64} y2={48} width={1.7} opacity={0.55} head={4.4} />
    <Dot x={78} y={38} r={2.6} />
  </>
)

/* ----------------------------------------------------------------- fallbacks -- */

/** A custom or agent-built scene: the lab flask crossed by an orbit. */
const LabSceneArt = () => (
  <>
    <Stroke d="M52 14 h16 M55 14 v10 L41 47 a5 5 0 0 0 4.6 7 h28.8 a5 5 0 0 0 4.6 -7 L65 24 v-10" width={2.2} />
    <Stroke d="M46 40 h28" width={1.7} opacity={0.5} />
    <ellipse cx={60} cy={36} rx={34} ry={12} fill="none" stroke="currentColor" strokeWidth={1.4} strokeDasharray="1 5" opacity={0.55} transform="rotate(-14 60 36)" />
    <Dot x={88} y={26} r={2.6} />
  </>
)

/** A question-sourced scene: the sheet with a worked trajectory. */
const QuestionSceneArt = () => (
  <>
    <Stroke d="M42 12 h26 l12 12 v32 h-38 z" width={2} opacity={0.85} />
    <Stroke d="M68 12 v12 h12" width={2} opacity={0.85} />
    <Stroke d="M49 34 h22 M49 41 h14" width={1.7} opacity={0.45} />
    <Stroke d="M49 50 C55 44 63 44 71 49" width={1.7} opacity={0.7} dash="1 4" />
  </>
)

/* ------------------------------------------------------------------ registry -- */

/** Scene art for every experiment template, keyed by template id. */
export const TEMPLATE_ART: Readonly<Record<string, () => ReactElement>> = {
  'uniform-linear': UniformLinearArt,
  'uniform-acceleration': UniformAccelerationArt,
  'projectile-horizontal': ProjectileHorizontalArt,
  'projectile-oblique': ProjectileObliqueArt,
  'newton-second-law': NewtonLawArt,
  incline: InclineArt,
  'point-charge': PointChargeArt,
  'multi-point-charge': MultiPointChargeArt,
  'uniform-electric': UniformElectricArt,
  'parallel-plate': ParallelPlateArt,
  'magnetic-circular': MagneticCircularArt,
  'velocity-selector': VelocitySelectorArt,
  'mass-spectrometer': MassSpectrometerArt,
  'composite-eb': CompositeEBArt,
  'composite-ebg': CompositeEBGArt,
  'multi-region-field': MultiRegionArt,
  cyclotron: CyclotronArt,
  'series-circuit': SeriesCircuitArt,
  'parallel-circuit': ParallelCircuitArt,
  'mixed-circuit': MixedCircuitArt,
  'rheostat-circuit': RheostatCircuitArt,
  'emf-measurement': EmfMeasurementArt,
  'average-speed': AverageSpeedArt,
  'va-resistance': VaResistanceArt,
  'bulb-power': BulbPowerArt,
  'lever-balance': LeverBalanceArt,
  buoyancy: BuoyancyArt,
  'plane-mirror': PlaneMirrorArt,
  'convex-lens': ConvexLensArt,
  'concave-mirror': ConcaveMirrorArt,
  'convex-mirror': ConvexMirrorArt,
  'echo-ranging': EchoRangingArt,
}

/* Scene ids are stamped as `${base}-${time}-${serial}` by the template registry;
   the trailing dash keeps `composite-eb-…` from matching composite-ebg. */
const SCENE_ID_BASES: readonly (readonly [templateId: string, base: string])[] = [
  ['uniform-linear', 'mechanics-uniform-linear'],
  ['uniform-acceleration', 'mechanics-uniform-acceleration'],
  ['projectile-horizontal', 'mechanics-projectile-horizontal'],
  ['projectile-oblique', 'mechanics-projectile-oblique'],
  ['newton-second-law', 'mechanics-newton-second-law'],
  ['incline', 'mechanics-incline'],
  ['point-charge', 'electric-point-charge'],
  ['multi-point-charge', 'electric-multi-point-charge'],
  ['uniform-electric', 'electric-uniform-particle'],
  ['parallel-plate', 'electric-parallel-plate'],
  ['magnetic-circular', 'magnetic-circular'],
  ['velocity-selector', 'composite-velocity-selector'],
  ['mass-spectrometer', 'composite-mass-spectrometer'],
  ['composite-eb', 'composite-eb'],
  ['composite-ebg', 'composite-ebg'],
  ['multi-region-field', 'composite-multi-region'],
  ['series-circuit', 'circuit-series'],
  ['parallel-circuit', 'circuit-parallel'],
  ['mixed-circuit', 'circuit-mixed'],
  ['rheostat-circuit', 'circuit-rheostat'],
  ['emf-measurement', 'circuit-emf'],
  ['average-speed', 'mechanics-average-speed'],
  ['va-resistance', 'circuit-va-resistance'],
  ['bulb-power', 'circuit-bulb-power'],
  ['plane-mirror', 'optics-plane-mirror'],
  ['convex-lens', 'optics-convex-lens'],
  ['concave-mirror', 'optics-concave-mirror'],
  ['convex-mirror', 'optics-convex-mirror'],
  ['echo-ranging', 'acoustics-echo-ranging'],
  ['buoyancy', 'fluid-buoyancy'],
]

/** Recover the source template of a stored scene from its stamped scene id. */
export const artTemplateIdOfSceneId = (sceneId: string): string | undefined =>
  SCENE_ID_BASES.find(([, base]) => sceneId.startsWith(`${base}-`))?.[0]

export interface ExperimentArtProps {
  /** Template whose dedicated scene art to draw; unknown ids fall back. */
  readonly templateId?: string | undefined
  /** Distinguishes the fallback for scenes without a template. */
  readonly kind?: 'experiment' | 'question' | undefined
  /** `cover` crops into a wider banner box; `contain` (default) letterboxes. */
  readonly fit?: 'contain' | 'cover' | undefined
  readonly className?: string | undefined
}

/** Resolve which artwork a card shows; exported so tests can pin the mapping. */
export const resolveArtKey = (
  templateId: string | undefined,
  kind: 'experiment' | 'question' | undefined,
): string => {
  if (templateId !== undefined && TEMPLATE_ART[templateId] !== undefined) return templateId
  return kind === 'question' ? 'question' : 'lab'
}

/** The scene artwork itself: a transparent 120x68 stage painted in currentColor. */
export function ExperimentArt({ templateId, kind, fit = 'contain', className }: ExperimentArtProps) {
  const key = resolveArtKey(templateId, kind)
  const Art = TEMPLATE_ART[key] ?? (key === 'question' ? QuestionSceneArt : LabSceneArt)
  return (
    <svg
      viewBox="0 0 120 68"
      preserveAspectRatio={fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}
      className={className}
      data-physicsos-art={key}
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      <Art />
    </svg>
  )
}
