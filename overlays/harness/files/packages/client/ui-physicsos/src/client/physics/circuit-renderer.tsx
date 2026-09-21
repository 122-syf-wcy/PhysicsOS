/**
 * Circuit renderer: textbook schematic symbols on the shared canvas.
 *
 * Draws wires, junction dots and GB-style component symbols (resistor box,
 * battery long/short plates, switch lever, circled A/V meters, rheostat with a
 * slider arrow) from {@link SceneVisualModel.circuitComponents} — never from a
 * PhysicsScene. Every string it places (readings, U/I/P annotations) was
 * formatted upstream by the runtime bridge from the verified operating point.
 *
 * Symbol geometry lives in the local a→b frame and is rotated as one group;
 * text stays upright, placed above/below a horizontal symbol and beside a
 * vertical one, so the schematic reads like a printed diagram at any rotation.
 */

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { circuitTerminalPoint } from '@physicsos/physics-scene'

import type { CircuitComponentVisual, ScenePoint } from './scene-visual-model.ts'
import type { RendererProjection, RendererProps } from './renderer-registry.tsx'
import { clsxJoin } from './primitives.tsx'
import { PARTS3D, part3dUrl, type Part3dEntry } from './parts3d-catalog.ts'
import { terminalKeysOf } from './circuit-builder.ts'
import { spriteIdFor } from './circuit-builder-labels.ts'
import css from './renderers.module.css'

/** Half the symbol length in scene units; matches the scene-side constant. */
const HALF = 0.75

/* Charge-carrier drift: one bead every ~14 px of wire; the advance rate is
   ∝ |I| (px/s per ampere), floored so a small current still visibly drifts
   and capped so a strong one stays readable. */
const CHARGE_SPACING_PX = 14
const CHARGE_SPEED_PER_AMP = 110
const CHARGE_SPEED_MIN = 8
const CHARGE_SPEED_MAX = 90

/** Minimum horizontal grab radius around the rheostat knob, in scene units. */
const SLIDER_GRAB = 0.28
/** Keyboard step for the rheostat slider: 5% per arrow, like a native range. */
const SLIDER_KEY_STEP = 0.05

/** Hit radius of a build-mode terminal target, in scene units. Wide enough to
    press on a touch screen without covering the symbol it belongs to. */
const TERMINAL_GRAB = 0.3

const isVertical = (rotation: number): boolean => Math.abs(rotation % 180) === 90

/** Corner radius where a wire turns, in px — the cable bend, not a miter. */
const WIRE_BEND_PX = 7

/**
 * Wire polyline with its corners rounded: each interior vertex becomes a
 * quadratic through the bend, clipped to half of the shorter adjacent leg so
 * short segments never overshoot. Wires keep their schematic routing; only
 * the corner reads as a real cable bend. Charge beads ride the same curve.
 */
const wirePath = (
  points: readonly { readonly x: number; readonly y: number }[],
  projection: RendererProjection,
): string => {
  const px = points.map(point => ({ x: projection.px(point), y: projection.py(point) }))
  const first = px[0]
  const last = px[px.length - 1]
  if (first === undefined || last === undefined) return ''
  let d = `M${first.x.toFixed(2)} ${first.y.toFixed(2)}`
  for (let i = 1; i < px.length - 1; i += 1) {
    const prev = px[i - 1]
    const corner = px[i]
    const next = px[i + 1]
    if (prev === undefined || corner === undefined || next === undefined) continue
    const dIn = Math.hypot(corner.x - prev.x, corner.y - prev.y)
    const dOut = Math.hypot(next.x - corner.x, next.y - corner.y)
    const r = Math.min(WIRE_BEND_PX, dIn / 2, dOut / 2)
    if (r < 0.5 || dIn === 0 || dOut === 0) {
      d += ` L${corner.x.toFixed(2)} ${corner.y.toFixed(2)}`
      continue
    }
    const eIn = {
      x: corner.x - ((corner.x - prev.x) / dIn) * r,
      y: corner.y - ((corner.y - prev.y) / dIn) * r,
    }
    const eOut = {
      x: corner.x + ((next.x - corner.x) / dOut) * r,
      y: corner.y + ((next.y - corner.y) / dOut) * r,
    }
    d += ` L${eIn.x.toFixed(2)} ${eIn.y.toFixed(2)}`
      + ` Q${corner.x.toFixed(2)} ${corner.y.toFixed(2)} ${eOut.x.toFixed(2)} ${eOut.y.toFixed(2)}`
  }
  d += ` L${last.x.toFixed(2)} ${last.y.toFixed(2)}`
  return d
}

/**
 * Where a terminal sits in projected px, using the scene's own terminal
 * geometry — so the drawn target and the electrical node it wires are the same
 * point, not two approximations of it.
 */
const wireTerminalPoint = (
  component: CircuitComponentVisual,
  terminalKey: string,
  projection: RendererProjection,
): { x: number; y: number } => {
  const point = circuitTerminalPoint(
    { x: component.at.x, y: component.at.y, rotation: component.rotation as 0 | 90 | 180 | 270 },
    terminalKey,
  )
  return { x: projection.px(point), y: projection.py(point) }
}

interface SymbolProps {
  readonly component: CircuitComponentVisual
  readonly cx: number
  readonly cy: number
  /** px per scene unit. */
  readonly scale: number
}

/** Symbol geometry in the rotated local frame (+x = terminal b / positive). */
function SymbolGeometry({ component, cx, cy, scale }: SymbolProps) {
  const half = HALF * scale
  switch (component.kind) {
    case 'resistor':
    case 'variable_resistor': {
      const bodyHalf = 0.5 * scale
      const height = 0.36 * scale
      const slider = component.sliderPosition ?? 0.5
      return (
        <>
          <line className={css.circuitSymbol} x1={cx - half} y1={cy} x2={cx - bodyHalf} y2={cy} />
          <line className={css.circuitSymbol} x1={cx + bodyHalf} y1={cy} x2={cx + half} y2={cy} />
          <rect
            className={css.circuitSymbol}
            x={cx - bodyHalf}
            y={cy - height / 2}
            width={bodyHalf * 2}
            height={height}
          />
          {component.kind === 'variable_resistor'
            ? (() => {
              const sx = cx - bodyHalf + slider * bodyHalf * 2
              const tipY = cy - height / 2 - 0.06 * scale
              const head = 0.11 * scale
              return (
                <g data-testid={`slider-${component.id}`}>
                  <line
                    className={css.circuitSymbol}
                    x1={sx}
                    y1={cy - 0.62 * scale}
                    x2={sx}
                    y2={tipY - head}
                  />
                  <path
                    className={css.circuitSymbolFill}
                    d={`M${sx} ${tipY} L${sx - head * 0.72} ${tipY - head} L${sx + head * 0.72} ${tipY - head} Z`}
                  />
                </g>
              )
            })()
            : null}
        </>
      )
    }
    case 'voltage_source': {
      const gap = 0.12 * scale
      const longHalf = 0.34 * scale
      const shortHalf = 0.15 * scale
      return (
        <>
          <line className={css.circuitSymbol} x1={cx - half} y1={cy} x2={cx - gap} y2={cy} />
          <line className={css.circuitSymbol} x1={cx + gap} y1={cy} x2={cx + half} y2={cy} />
          {/* Short thick plate = negative (axis tail), long thin plate = positive. */}
          <line
            className={css.circuitSymbolThick}
            x1={cx - gap}
            y1={cy - shortHalf}
            x2={cx - gap}
            y2={cy + shortHalf}
          />
          <line
            className={css.circuitSymbol}
            x1={cx + gap}
            y1={cy - longHalf}
            x2={cx + gap}
            y2={cy + longHalf}
          />
        </>
      )
    }
    case 'switch': {
      const pivot = 0.5 * scale
      const closed = component.closed === true
      const leverAngle = (32 * Math.PI) / 180
      const leverX = closed ? cx + pivot : cx - pivot + Math.cos(leverAngle) * pivot * 1.9
      const leverY = closed ? cy : cy - Math.sin(leverAngle) * pivot * 1.9
      return (
        <g data-testid={`switch-${component.id}`} data-closed={closed ? 'true' : 'false'}>
          <line className={css.circuitSymbol} x1={cx - half} y1={cy} x2={cx - pivot} y2={cy} />
          <line className={css.circuitSymbol} x1={cx + pivot} y1={cy} x2={cx + half} y2={cy} />
          {/* Pivot dots scale with the symbol family (meter circles use
              0.42·scale); a fixed px radius drifts off the schematic when the
              bench zooms. */}
          <circle
            className={css.circuitSymbolFill}
            cx={cx - pivot}
            cy={cy}
            r={Math.max(1.6, 0.09 * scale)}
          />
          <circle
            className={css.circuitSymbolFill}
            cx={cx + pivot}
            cy={cy}
            r={Math.max(1.6, 0.09 * scale)}
          />
          <line className={css.circuitSymbol} x1={cx - pivot} y1={cy} x2={leverX} y2={leverY} />
        </g>
      )
    }
    case 'ammeter':
    case 'voltmeter': {
      const radius = 0.42 * scale
      return (
        <>
          <line className={css.circuitSymbol} x1={cx - half} y1={cy} x2={cx - radius} y2={cy} />
          <line className={css.circuitSymbol} x1={cx + radius} y1={cy} x2={cx + half} y2={cy} />
          <circle
            className={clsxJoin(css.circuitSymbol, css.circuitMeterFace)}
            cx={cx}
            cy={cy}
            r={radius}
          />
        </>
      )
    }
  }
}

/** Current direction arrow beside the symbol, in the rotated local frame. */
function CurrentArrow({
  component,
  cx,
  cy,
  scale,
  offset,
}: SymbolProps & { readonly offset?: number }) {
  const y = cy + (offset ?? 0.56 * scale)
  const span = 0.38 * scale
  const forward = component.currentDirection !== 'reverse'
  const fromX = forward ? cx - span : cx + span
  const toX = forward ? cx + span : cx - span
  const head = 4.6
  const direction = forward ? 1 : -1
  return (
    <g data-testid={`current-${component.id}`}>
      <line
        className={css.circuitCurrent}
        x1={fromX}
        y1={y}
        x2={toX - direction * head * 0.6}
        y2={y}
      />
      <path
        className={css.circuitCurrentHead}
        d={`M${toX} ${y} L${toX - direction * head} ${y - head * 0.44} L${toX - direction * head} ${y + head * 0.44} Z`}
      />
    </g>
  )
}

/* ------------------------------------------------------------- part sprites -- */

/** Catalog sprite for a component kind; `undefined` keeps the vector symbol. */
/**
 * Which catalogued sprite a component draws as.
 *
 * A rated part carries the rating the renderer can choose on — a bench stocked
 * with a dry cell, a battery pack and a supply draws whichever one the student
 * actually set. A component visual without those fields (an agent-authored or
 * restored scene) keeps the original one-sprite-per-kind behaviour.
 */
const spriteIdOf = (component: CircuitComponentVisual): string | undefined => {
  const preferred = spriteIdFor(component.kind, component.ratingValue, component.closed)
  return PARTS3D[preferred] === undefined ? undefined : preferred
}

/**
 * Where a drawn sprite lands around the wire point, in px, in the local
 * (pre-rotation) frame. `x`/`y`/`width`/`height` position the `<image>`; the
 * extents tell labels, halo and arrows how far the sprite leans past the wire
 * so nothing anchors against the smaller vector body it replaces.
 */
interface SpritePlacement {
  readonly rotation: 0 | 180
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** px the sprite reaches above the wire point. */
  readonly above: number
  /** px the sprite reaches below the wire point. */
  readonly below: number
  /** px above the wire point of the solid body's centre — where light sits. */
  readonly body: number
  /** px above the wire point of a base part's dial — where the letter sits. */
  readonly dial: number
}

/* Measured posts define the transform. Legacy art keeps its original solid-box
   convention until measured coordinates exist for that asset. */
const spritePlacement = (
  part: Part3dEntry,
  cx: number,
  cy: number,
  scale: number,
): SpritePlacement => {
  const span = 2 * HALF * scale
  const reversed = part.terminalOrder === 'reversed'
  const anchor =
    part.terminals === undefined
      ? undefined
      : reversed
        ? { x: 1 - part.terminals.b.x, y: 1 - part.terminals.b.y }
        : part.terminals.a
  const terminalWidth =
    part.terminals === undefined ? part.solidBox.width : part.terminals.b.x - part.terminals.a.x
  const width = span / terminalWidth
  const height = width * (part.pixels.h / part.pixels.w)
  const x = cx - span / 2 - (anchor?.x ?? part.solidBox.left) * width
  const solidTop =
    (reversed ? 1 - part.solidBox.top - part.solidBox.height : part.solidBox.top) * height
  const solidHeight = part.solidBox.height * height
  const above =
    anchor === undefined
      ? part.axis === 'axial'
        ? solidTop + solidHeight / 2
        : solidTop + solidHeight
      : anchor.y * height
  return {
    rotation: reversed ? 180 : 0,
    x,
    y: cy - above,
    width,
    height,
    above,
    below: height - above,
    body: above - solidTop - solidHeight / 2,
    dial: solidTop + solidHeight * 0.32,
  }
}

/* ------------------------------------------------------- label placement -- */

/** Axis-aligned screen box of something drawn in a rotated local frame. */
interface ScreenRect {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

/**
 * Screen box of a sprite. The image frame is authored in the local a→b frame
 * and the whole group is turned by the branch angle, so the corners are mapped
 * through that rotation rather than read off the frame directly.
 */
const screenRectOf = (
  box: SpritePlacement,
  cx: number,
  cy: number,
  svgRotation: number,
): ScreenRect => {
  const radians = (svgRotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const xs: number[] = []
  const ys: number[] = []
  for (const [x, y] of [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ] as const) {
    xs.push(cx + (x - cx) * cos - (y - cy) * sin)
    ys.push(cy + (x - cx) * sin + (y - cy) * cos)
  }
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  }
}

/**
 * Which side of a symbol is free of the other parts' bodies. A voltmeter wired
 * across a resistor is drawn in the same corridor as that resistor's values, so
 * the free side is a property of the whole schematic and not of the symbol
 * alone: without this, a vertical branch prints its U/I/P rows across the
 * instrument. `preferred` keeps the existing side when both are equally open.
 */
const freeSide = (
  cx: number,
  band: { readonly top: number; readonly bottom: number },
  neighbours: readonly ScreenRect[],
  preferred: 1 | -1,
): 1 | -1 => {
  const clearance = (side: 1 | -1): number => {
    let nearest = Number.POSITIVE_INFINITY
    for (const rect of neighbours) {
      if (rect.bottom <= band.top || rect.top >= band.bottom) continue
      const gap = side > 0 ? rect.left - cx : cx - rect.right
      if (gap >= 0 && gap < nearest) nearest = gap
    }
    return nearest
  }
  const flipped: 1 | -1 = preferred === 1 ? -1 : 1
  return clearance(flipped) > clearance(preferred) ? flipped : preferred
}

interface SliderLayout {
  readonly start: number
  readonly end: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Local scene coordinates shared by the drawn knob and all input handles. */
const sliderLayout = (
  part: Part3dEntry | undefined,
  box: SpritePlacement | undefined,
  cx: number,
  cy: number,
  scale: number,
): SliderLayout => {
  const rail = part?.sliderRail
  if (rail === undefined || box === undefined) {
    return { start: -0.5, end: 0.5, y: 0.48, width: 0.34, height: 0.46 }
  }
  const height = (box.height / scale) * 0.72
  const knob = PARTS3D['rheostat-knob']
  return {
    start: (box.x + rail.start.x * box.width - cx) / scale,
    end: (box.x + rail.end.x * box.width - cx) / scale,
    y: (cy - box.y - rail.start.y * box.height) / scale,
    width: height * (knob === undefined ? 0.5 : knob.pixels.w / knob.pixels.h),
    height,
  }
}

interface ComponentSpriteProps extends SymbolProps {
  readonly part: Part3dEntry
  readonly box: SpritePlacement
  readonly slider: SliderLayout
  readonly reading: string | undefined
  readonly onSpriteError: (id: string) => void
}

/**
 * The raster body of a wired component, drawn inside the rotated local frame
 * so it turns with the branch exactly like the vector symbol it replaces.
 * Meter text stays upright on the blank dial; the rheostat knob follows its
 * measured rail. Meter text is the upstream formatted
 * reading; dial measurements place text but never imply a physical range.
 */
function ComponentSprite({
  component,
  part,
  box,
  slider,
  reading,
  cx,
  cy,
  scale,
  onSpriteError,
}: ComponentSpriteProps) {
  const isSwitch = component.kind === 'switch'
  const isMeter = component.kind === 'ammeter' || component.kind === 'voltmeter'
  const [knobFailed, setKnobFailed] = useState(false)
  const dialX = part.dial === undefined ? cx : box.x + part.dial.pivot.x * box.width
  const dialY = part.dial === undefined ? cy - box.dial : box.y + part.dial.pivot.y * box.height
  const dialRadius = part.dial === undefined ? 0 : part.dial.radius * box.width
  const textY = dialY - dialRadius * 0.55
  return (
    <g
      data-testid={isSwitch ? `switch-${component.id}` : undefined}
      data-closed={isSwitch ? (component.closed === true ? 'true' : 'false') : undefined}
    >
      <image
        data-testid={`sprite-${component.id}`}
        className={css.circuitPartSprite}
        href={part3dUrl(part)}
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        transform={
          box.rotation === 0
            ? undefined
            : `rotate(${box.rotation} ${box.x + box.width / 2} ${box.y + box.height / 2})`
        }
        preserveAspectRatio="none"
        aria-hidden="true"
        onError={() => {
          onSpriteError(component.id)
        }}
      />
      {isMeter ? (
        <text
          data-testid={reading === undefined ? undefined : `dial-reading-${component.id}`}
          className={reading === undefined ? css.circuitMeterLetter : css.circuitDialReading}
          x={dialX}
          y={textY}
          textAnchor="middle"
          transform={`rotate(${component.rotation} ${dialX} ${textY})`}
        >
          {reading ?? (component.kind === 'ammeter' ? 'A' : 'V')}
        </text>
      ) : null}
      {component.kind === 'variable_resistor'
        ? (() => {
          const sx =
            cx +
              (slider.start + (component.sliderPosition ?? 0.5) * (slider.end - slider.start)) *
                scale
          const sy = cy - slider.y * scale
          const knob = PARTS3D['rheostat-knob']
          const width = slider.width * scale
          const height = slider.height * scale
          return (
            <g data-testid={`slider-${component.id}`}>
              {knob === undefined || knobFailed ? (
                <path
                  className={css.circuitSliderFallback}
                  d={`M${sx - width / 2} ${sy - height / 2} h${width} v${height} h${-width} Z`}
                />
              ) : (
                <image
                  data-testid={`slider-knob-${component.id}`}
                  className={css.circuitPartSprite}
                  href={part3dUrl(knob)}
                  x={sx - width / 2}
                  y={sy - height / 2}
                  width={width}
                  height={height}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  onError={() => {
                    setKnobFailed(true)
                  }}
                />
              )}
            </g>
          )
        })()
        : null}
    </g>
  )
}

/**
 * Circuit renderer. Registered for `domain: 'circuit'` in the renderer
 * registry; receives the shared frame and only reads the circuit primitives.
 */
export function CircuitRenderer({
  view,
  projection,
  time,
  componentDrag,
  componentControl,
  componentWiring,
}: RendererProps) {
  /* A sprite that fails to load (missing file, network) drops its component
     back to the vector symbol — the same fallback rule experiment artwork uses. */
  const [failedSprites, setFailedSprites] = useState<ReadonlySet<string>>(() => new Set())
  const onSpriteError = (id: string) => {
    setFailedSprites(previous => new Set(previous).add(id))
  }

  /* A wire being dragged from a terminal: the release may land on another
     terminal (capture handles that) or anywhere else (the window listener
     ends the gesture there), so the flag routes the one that fires first. */
  const wiringRef = useRef<{ active: boolean }>({ active: false })
  useEffect(() => {
    if (componentWiring === undefined) return undefined
    const end = () => {
      wiringRef.current.active = false
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [componentWiring])

  /* Pointer gestures: a press on a part starts as an ambiguous press. Past the
     ~3 px threshold it becomes a placement drag (preview + commit through the
     runtime's placement command); a sub-threshold release stays a click — and
     on a switch that click flips the blade through `componentControl`. A press
     that lands on the rheostat's knob column is never ambiguous: it is a
     slider push from the first move. */
  const dragRef = useRef<{
    componentId: string
    pointerId: number
    /** 'move' rearranges the bench; 'slider' operates the rheostat's knob. */
    mode: 'move' | 'slider'
    /** Scene-space grab point inside the component, so the part does not jump. */
    offsetX: number
    offsetY: number
    /** Component centre when the drag began; the threshold measures from it. */
    startX: number
    startY: number
    moved: boolean
    /* Slider mode: the part's pose is fixed for the gesture (the part cannot
       be dragged while its own knob is held), so the press-time transform is
       stored rather than looked up per move. */
    baseX: number
    baseY: number
    rotation: number
    rail: SliderLayout
    /** Local-x distance between the press point and the knob, kept so the
        knob follows the finger without snapping to the press point. */
    grabOffset: number
    /** Last previewed position — the value committed on release. */
    position: number
    /** Switch only: the state a no-travel release flips to. */
    toggleTo?: 'open' | 'closed'
  } | null>(null)
  const [draggingId, setDraggingId] = useState<string | undefined>(undefined)

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

  /* Scene point → the component's local frame (+x = terminal b, the direction
     the slider rail runs). Inverse of the group's rotate() transform. */
  const localPoint = (
    at: ScenePoint,
    baseX: number,
    baseY: number,
    rotation: number,
  ): ScenePoint => {
    const rad = (rotation * Math.PI) / 180
    const dx = at.x - baseX
    const dy = at.y - baseY
    return {
      x: dx * Math.cos(rad) + dy * Math.sin(rad),
      y: -dx * Math.sin(rad) + dy * Math.cos(rad),
    }
  }

  const sliderPositionOf = (localX: number, grabOffset: number, rail: SliderLayout): number => {
    const raw = (localX - grabOffset - rail.start) / (rail.end - rail.start)
    return Math.min(1, Math.max(0, raw))
  }

  /* Keyboard operation rides the same channel as the pointer: Enter/Space
     flips a switch; arrows step the rheostat 5%, Home/End jump to the rail
     ends — every keypress commits one formal command, like a native range. */
  const onSwitchKeyDown = (
    component: CircuitComponentVisual,
    event: ReactKeyboardEvent<SVGRectElement>,
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    componentControl?.setSwitch(component.id, component.closed === true ? 'open' : 'closed')
  }

  const onSliderKeyDown = (
    component: CircuitComponentVisual,
    event: ReactKeyboardEvent<SVGRectElement>,
  ) => {
    const current = component.sliderPosition ?? 0.5
    let next: number | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = current + SLIDER_KEY_STEP
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown')
      next = current - SLIDER_KEY_STEP
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = 1
    if (next === undefined) return
    event.preventDefault()
    componentControl?.commitSlider(component.id, Math.min(1, Math.max(0, next)))
  }

  const onComponentPointerDown = (
    component: CircuitComponentVisual,
    event: ReactPointerEvent<SVGGElement>,
    rail: SliderLayout,
  ) => {
    if (event.button !== 0) return
    const at = sceneAt(event)
    if (at === undefined) return

    /* Match the two-dimensional focus handle, not the entire knob column. */
    if (component.kind === 'variable_resistor' && componentControl !== undefined) {
      const local = localPoint(at, component.at.x, component.at.y, component.rotation)
      const knobX = rail.start + (component.sliderPosition ?? 0.5) * (rail.end - rail.start)
      if (
        Math.abs(local.x - knobX) <= Math.max(SLIDER_GRAB, rail.width / 2) &&
        Math.abs(local.y - rail.y) <= rail.height / 2 + 0.06
      ) {
        if (typeof event.currentTarget.setPointerCapture === 'function') {
          event.currentTarget.setPointerCapture(event.pointerId)
        }
        dragRef.current = {
          componentId: component.id,
          pointerId: event.pointerId,
          mode: 'slider',
          offsetX: 0,
          offsetY: 0,
          startX: component.at.x,
          startY: component.at.y,
          moved: false,
          baseX: component.at.x,
          baseY: component.at.y,
          rotation: component.rotation,
          rail,
          grabOffset: local.x - knobX,
          position: component.sliderPosition ?? 0.5,
        }
        event.stopPropagation()
        return
      }
    }

    /* A switch keeps its click-to-flip even when the bench is not draggable —
       the press is recorded so the release can toggle below the threshold. */
    const toggleTo =
      component.kind === 'switch' && componentControl !== undefined
        ? component.closed === true
          ? 'open'
          : 'closed'
        : undefined
    if (componentDrag === undefined && toggleTo === undefined) return
    /* jsdom has no pointer capture — the guard keeps the spec DOM happy. */
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    dragRef.current = {
      componentId: component.id,
      pointerId: event.pointerId,
      mode: 'move',
      offsetX: at.x - component.at.x,
      offsetY: at.y - component.at.y,
      startX: component.at.x,
      startY: component.at.y,
      moved: false,
      baseX: component.at.x,
      baseY: component.at.y,
      rotation: component.rotation,
      rail,
      grabOffset: 0,
      position: 0,
      ...(toggleTo === undefined ? {} : { toggleTo }),
    }
    event.stopPropagation()
  }

  const onComponentPointerMove = (event: ReactPointerEvent<SVGGElement>) => {
    const drag = dragRef.current
    if (drag === null || event.pointerId !== drag.pointerId) return
    const at = sceneAt(event)
    if (at === undefined) return
    if (drag.mode === 'slider') {
      /* No click/drag threshold on a grabbed knob: the intent was declared by
         where the press landed, so the slider tracks the pointer immediately. */
      const local = localPoint(at, drag.baseX, drag.baseY, drag.rotation)
      drag.position = sliderPositionOf(local.x, drag.grabOffset, drag.rail)
      drag.moved = true
      componentControl?.previewSlider(drag.componentId, drag.position)
      return
    }
    const x = at.x - drag.offsetX
    const y = at.y - drag.offsetY
    if (!drag.moved) {
      /* ~3 px of travel before the press becomes a drag. */
      if (Math.hypot(x - drag.startX, y - drag.startY) * projection.scale < 3) return
      drag.moved = true
      setDraggingId(drag.componentId)
    }
    componentDrag?.preview(drag.componentId, { x, y })
  }

  const endComponentDrag = (event: ReactPointerEvent<SVGGElement>) => {
    const drag = dragRef.current
    if (drag === null || event.pointerId !== drag.pointerId) return
    dragRef.current = null
    setDraggingId(undefined)
    if (drag.mode === 'slider') {
      /* A knob press released without travel is a click, not a position
         change — committing it would spend a revision on no physics. */
      if (drag.moved) componentControl?.commitSlider(drag.componentId, drag.position)
      return
    }
    if (!drag.moved) {
      if (drag.toggleTo !== undefined) componentControl?.setSwitch(drag.componentId, drag.toggleTo)
      return
    }
    const at = sceneAt(event)
    if (at === undefined) return
    componentDrag?.commit(drag.componentId, { x: at.x - drag.offsetX, y: at.y - drag.offsetY })
  }
  const components = view.circuitComponents ?? []
  const wires = view.circuitWires ?? []
  const junctions = view.circuitJunctions ?? []
  const chargeFlows = view.chargeFlows ?? []
  const scale = projection.scale
  const lampGlowId = `circuit-lamp-glow-${projection.uid}`
  const lampBloomId = `circuit-lamp-bloom-${projection.uid}`
  const lampCoreId = `circuit-lamp-core-${projection.uid}`

  const showCurrent = view.visible.current === true
  const showVoltage = view.visible.voltage === true
  const showPower = view.visible.power === true

  /* Bodies the annotations have to steer around. A part cannot know what its
     neighbours occupy while it is being laid out, so every drawn sprite is
     measured first; a part whose image failed keeps its smaller vector body
     and is therefore not an obstacle. */
  const bodies = components.flatMap((component) => {
    const spriteId = spriteIdOf(component)
    if (spriteId === undefined || failedSprites.has(component.id)) return []
    const part = PARTS3D[spriteId]
    if (part === undefined) return []
    const cx = projection.px(component.at)
    const cy = projection.py(component.at)
    return [
      {
        id: component.id,
        rect: screenRectOf(spritePlacement(part, cx, cy, scale), cx, cy, -component.rotation),
      },
    ]
  })

  return (
    <>
      <defs>
        {/* Three stops of one warm ramp: the core blows out near-white, the
            glow disc carries the body of the light, the bloom is the wide
            falloff that spills onto the wires around the bulb. Stops stay
            literal rather than token-driven — this gradient is the one place
            a missing var() would silently paint nothing, and it already
            worked that way. */}
        <radialGradient id={lampGlowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffe6a8" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#f5a524" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#f5a524" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={lampBloomId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ff9d2e" stopOpacity="0.42" />
          <stop offset="60%" stopColor="#ff9d2e" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#ff9d2e" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={lampCoreId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff8e6" stopOpacity="1" />
          <stop offset="70%" stopColor="#fff8e6" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#fff8e6" stopOpacity="0" />
        </radialGradient>
      </defs>

      {wires.map(wire => (
        <path key={wire.id} className={css.circuitWire} d={wirePath(wire.points, projection)} />
      ))}

      {/* Current as travelling light: one dashed path per conducting run, the
          pattern advanced by stroke-dashoffset each frame. The advance is ∝ |I|
          (clamped) and its SIGN follows the solved current, so a run carrying
          reversed current streams the other way. Only the dash phase moves —
          the geometry is the wire's own polyline — which is how the drawing
          stays per-segment KCL-honest while reading as charge in motion. */}
      {showCurrent
        ? chargeFlows.map((flow) => {
          const speed = Math.min(
            CHARGE_SPEED_MAX,
            Math.max(CHARGE_SPEED_MIN, Math.abs(flow.current) * CHARGE_SPEED_PER_AMP),
          )
          /* Decreasing dashoffset walks the pattern forward along the path. */
          const advance = flow.current === 0 ? 0 : -Math.sign(flow.current) * speed * (time ?? 0)
          return (
            <path
              key={flow.id}
              className={css.circuitChargeFlow}
              data-charge-flow={flow.id}
              data-current-sign={
                flow.current > 0 ? 'forward' : flow.current < 0 ? 'reverse' : 'idle'
              }
              d={wirePath(flow.path, projection)}
              strokeDasharray={`0.1 ${CHARGE_SPACING_PX}`}
              strokeDashoffset={advance}
              aria-hidden="true"
            />
          )
        })
        : null}

      {junctions.map(junction => (
        <circle
          key={junction.id}
          className={css.circuitJunction}
          cx={projection.px(junction.at)}
          cy={projection.py(junction.at)}
          r={2.8}
        />
      ))}

      {components.map((component) => {
        const cx = projection.px(component.at)
        const cy = projection.py(component.at)
        /* Scene rotation is counter-clockwise with y up; SVG rotates clockwise
           with y down, so the same angle applies with its sign flipped. */
        const svgRotation = -component.rotation
        const vertical = isVertical(component.rotation)
        const highlighted = projection.highlighted(component.id)

        /* A catalogued sprite takes over the symbol body; anything missing from
           the catalog or failed to load keeps the vector drawing. */
        const spriteId = spriteIdOf(component)
        const part =
          spriteId === undefined || failedSprites.has(component.id) ? undefined : PARTS3D[spriteId]
        const box = part === undefined ? undefined : spritePlacement(part, cx, cy, scale)
        const sprite = part !== undefined && box !== undefined ? { part, box } : undefined

        const rail = sliderLayout(part, box, cx, cy, scale)
        const slider = component.sliderPosition ?? 0.5
        const knobX = cx + (rail.start + slider * (rail.end - rail.start)) * scale
        const knobY = cy - rail.y * scale
        const handleWidth = Math.max(SLIDER_GRAB * 2, rail.width) * scale
        const handleHeight = (rail.height + 0.12) * scale

        const meterReading =
          component.kind === 'ammeter'
            ? showCurrent
              ? component.reading
              : undefined
            : component.kind === 'voltmeter'
              ? showVoltage
                ? component.reading
                : undefined
              : undefined
        const rows: readonly { text: string; className: string }[] = [
          ...(component.value === undefined
            ? []
            : [{ text: component.value, className: css.circuitAnnotation ?? '' }]),
          ...(meterReading === undefined || sprite !== undefined
            ? []
            : [{ text: meterReading, className: css.circuitReading ?? '' }]),
          ...(showCurrent && component.currentText !== undefined
            ? [{ text: component.currentText, className: css.circuitCurrentText ?? '' }]
            : []),
          ...(showVoltage && component.voltageText !== undefined
            ? [{ text: component.voltageText, className: css.circuitAnnotation ?? '' }]
            : []),
          ...(showPower && component.powerText !== undefined
            ? [{ text: component.powerText, className: css.circuitAnnotation ?? '' }]
            : []),
        ]

        /* Text anchors: above/below a horizontal symbol, left/right of a
           vertical one, so annotations never sit on the wire. A sprite leans
           farther than the vector body it replaces — a base part reaches its
           full height above the wire, and rotated onto a vertical branch that
           lean lands on the left or right — so the anchors track the sprite's
           own extents rather than the vector constants. On a vertical branch
           the two sides are also contested by the neighbours, so the values
           take whichever side the other bodies leave open and the name takes
           the other one; a parallel voltmeter otherwise sits exactly where the
           U/I/P rows would be printed. */
        const normalRotation = ((component.rotation % 360) + 360) % 360
        const above = Math.max(
          box?.above ?? 0,
          component.kind === 'variable_resistor' ? (rail.y + rail.height / 2) * scale : 0,
        )
        const below = Math.max(
          box?.below ?? 0,
          component.kind === 'variable_resistor' ? (-rail.y + rail.height / 2) * scale : 0,
        )
        const leanLeft = normalRotation === 90 ? above : below
        const leanRight = normalRotation === 90 ? below : above
        const rowBand = {
          top: cy - ((rows.length - 1) * 13) / 2 - 9,
          bottom: cy + ((rows.length - 1) * 13) / 2 + 13,
        }
        const rowSide: 1 | -1 = vertical
          ? freeSide(
            cx,
            rowBand,
            bodies.filter(body => body.id !== component.id).map(body => body.rect),
            1,
          )
          : 1
        /* The name shares the symbol's open side and stacks one line above the
           values. Splitting the two across opposite sides instead only moves
           the collision onto the neighbour: a corridor between two parallel
           branches is narrower than the name plus a four-row value block, so
           whichever label is left in it lands on the other part's. A part with
           no values keeps its name on the classic left side. */
        const labelSide: 1 | -1 = rows.length > 0 && vertical ? rowSide : -1
        const rowLean = rowSide === 1 ? leanRight : leanLeft
        const labelLean = labelSide === 1 ? leanRight : leanLeft
        const labelAt: ScenePoint = vertical
          ? {
            x: cx + labelSide * (Math.max(0.62 * scale, labelLean) + 4),
            y: rows.length > 0 ? cy - ((rows.length - 1) * 13) / 2 - 12 : cy + 4,
          }
          : { x: cx, y: cy - Math.max(0.5 * scale, above) - 8 }
        const rowStart: ScenePoint = vertical
          ? {
            x: cx + rowSide * (Math.max(0.62 * scale, rowLean) + 4),
            y: cy - ((rows.length - 1) * 13) / 2 + 4,
          }
          : { x: cx, y: cy + Math.max(0.55 * scale, below) + 14 }

        /* A dissipating load is drawn as a lamp: a warm halo behind the
           symbol whose radius and opacity scale with the bridge's normalized
           power — a dead or unsolved load carries no `glow` and stays dark. */
        const glow = component.glow ?? 0
        /* Light belongs on the part's body, not the wire point: a base sprite
           stands on the wire so its centre sits half a body above it. */
        const glowCy = cy - (box?.body ?? 0)
        return (
          <g
            key={component.id}
            className={clsxJoin(
              highlighted ? css.highlightGroup : undefined,
              componentDrag === undefined ? undefined : css.circuitDraggable,
              draggingId === component.id ? css.circuitDragging : undefined,
            )}
            data-component-id={component.id}
            onPointerDown={(event) => {
              onComponentPointerDown(component, event, rail)
            }}
            onPointerMove={onComponentPointerMove}
            onPointerUp={endComponentDrag}
            onPointerCancel={(event) => {
              const drag = dragRef.current
              if (drag === null || event.pointerId !== drag.pointerId) return
              dragRef.current = null
              setDraggingId(undefined)
              if (drag.mode === 'slider') componentControl?.cancelSlider()
              else componentDrag?.cancel()
            }}
          >
            {/* Light, laid down before the part: the bloom is thrown widest and
                softest, the disc carries the body of the light, the core is the
                hot centre. Bloom and core blend in `screen` (see the CSS) so
                they add light to the bench instead of painting a disc over it.
                The disc keeps the measured `r`/`opacity` that the glow tests
                read, so brightness still tracks dissipation exactly. */}
            {glow > 0 ? (
              <>
                <circle
                  className={css.circuitLampBloom}
                  cx={cx}
                  cy={glowCy}
                  r={(1.5 + 2.6 * glow) * scale}
                  fill={`url(#${lampBloomId})`}
                  opacity={Math.min(1, 0.9 * glow)}
                />
                <circle
                  data-testid={`glow-${component.id}`}
                  className={css.circuitLampGlow}
                  cx={cx}
                  cy={glowCy}
                  r={(0.55 + 0.75 * glow) * scale}
                  fill={`url(#${lampGlowId})`}
                  opacity={Math.min(1, 0.85 * glow)}
                />
                <circle
                  className={css.circuitLampCore}
                  cx={cx}
                  cy={glowCy}
                  r={(0.32 + 0.3 * glow) * scale}
                  fill={`url(#${lampCoreId})`}
                  opacity={Math.min(1, 1.05 * glow)}
                />
              </>
            ) : null}
            <g transform={`rotate(${svgRotation} ${cx} ${cy})`}>
              {/* Hit area for the drag gesture: the raster sprite opts out of
                  pointer events (its alpha edge is not a handle), so an
                  invisible rect the size of the drawn part catches the press
                  and lets the whole body — body, halo, labels — be grabbed. */}
              {componentDrag === undefined && componentControl === undefined ? null : (
                <rect
                  className={css.circuitHitArea}
                  x={box === undefined ? cx - HALF * scale : box.x}
                  y={box === undefined ? cy - 0.45 * scale : box.y}
                  width={box === undefined ? 2 * HALF * scale : box.width}
                  height={box === undefined ? 0.9 * scale : box.height}
                />
              )}
              {/* Keyboard bench controls: invisible, focusable handles that map
                  onto the part they operate — the switch blade across the
                  body, the rheostat knob on its column. Pointer presses pass
                  through to the group handler above (same gesture, same
                  channel); these exist so Tab + keys can drive the bench. */}
              {componentControl === undefined ? null : component.kind === 'switch' ? (
                <rect
                  data-control={`switch-${component.id}`}
                  className={css.circuitControl}
                  x={box === undefined ? cx - HALF * scale : box.x}
                  y={box === undefined ? cy - 0.45 * scale : box.y}
                  width={box === undefined ? 2 * HALF * scale : box.width}
                  height={box === undefined ? 0.9 * scale : box.height}
                  tabIndex={0}
                  role="switch"
                  aria-checked={component.closed === true}
                  aria-label={component.label}
                  onKeyDown={(event) => {
                    onSwitchKeyDown(component, event)
                  }}
                />
              ) : component.kind === 'variable_resistor' ? (
                <rect
                  data-control={`slider-${component.id}`}
                  className={css.circuitControl}
                  x={knobX - handleWidth / 2}
                  y={knobY - handleHeight / 2}
                  width={handleWidth}
                  height={handleHeight}
                  tabIndex={0}
                  role="slider"
                  aria-orientation={vertical ? 'vertical' : 'horizontal'}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(slider * 100)}
                  aria-label={component.label}
                  onKeyDown={(event) => {
                    onSliderKeyDown(component, event)
                  }}
                />
              ) : null}
              {sprite === undefined ? (
                <>
                  <SymbolGeometry component={component} cx={cx} cy={cy} scale={scale} />
                  {/* Hot wire, behind nothing: the filament is what separates a
                      lit load from a dead one. Its brightness rides the same
                      normalized glow the halo uses, so the two can never
                      disagree about how hard the element is working. The
                      filament is part of the vector body — a raster part lights
                      by its halo alone. */}
                  {component.glow !== undefined ? (
                    <path
                      data-testid={`filament-${component.id}`}
                      className={css.circuitLampFilament}
                      d={
                        `M${cx - 0.62 * scale} ${cy}` +
                        ` L${cx - 0.42 * scale} ${cy - 0.2 * scale}` +
                        ` L${cx - 0.2 * scale} ${cy + 0.2 * scale}` +
                        ` L${cx} ${cy - 0.14 * scale}` +
                        ` L${cx + 0.2 * scale} ${cy + 0.2 * scale}` +
                        ` L${cx + 0.42 * scale} ${cy - 0.2 * scale}` +
                        ` L${cx + 0.62 * scale} ${cy}`
                      }
                      opacity={Math.min(1, 0.25 + 0.75 * glow)}
                    />
                  ) : null}
                </>
              ) : (
                <ComponentSprite
                  component={component}
                  part={sprite.part}
                  box={sprite.box}
                  slider={rail}
                  reading={meterReading}
                  cx={cx}
                  cy={cy}
                  scale={scale}
                  onSpriteError={onSpriteError}
                />
              )}
              {showCurrent && component.currentText !== undefined ? (
                <CurrentArrow
                  component={component}
                  cx={cx}
                  cy={cy}
                  scale={scale}
                  offset={Math.max(0.56 * scale, below + 6)}
                />
              ) : null}
            </g>

            {/* The vector meter face is blank, so the letter draws beside it;
                on a sprite it moves inside the rotated group onto the dial. */}
            {sprite === undefined &&
            (component.kind === 'ammeter' || component.kind === 'voltmeter') ? (
                <text className={css.circuitMeterLetter} x={cx} y={cy} textAnchor="middle">
                  {component.kind === 'ammeter' ? 'A' : 'V'}
                </text>
              ) : null}

            {/* Build-mode wiring: every terminal is a real, focusable target,
                drawn after the part so a press that starts on a post never
                turns into a component move. Keyboard activation makes the
                wiring reachable without a pointer at all. */}
            {componentWiring === undefined ? null : (
              <g className={css.circuitTerminals}>
                {terminalKeysOf(component.kind).map((terminalKey) => {
                  const point = wireTerminalPoint(component, terminalKey, projection)
                  const pending =
                    componentWiring.pending?.componentId === component.id &&
                    componentWiring.pending.terminalKey === terminalKey
                  return (
                    <circle
                      key={terminalKey}
                      className={clsxJoin(
                        css.circuitTerminal,
                        pending ? css.circuitTerminalPending : undefined,
                      )}
                      data-terminal={`${component.id}.${terminalKey}`}
                      cx={point.x}
                      cy={point.y}
                      r={TERMINAL_GRAB * scale}
                      tabIndex={0}
                      role="button"
                      aria-label={`${component.label} ${terminalKey}`}
                      onPointerDown={(event) => {
                        event.stopPropagation()
                        /* Touch and pen need the capture to see the release;
                           a mouse reports its position on the window anyway. */
                        if (event.pointerType !== 'mouse') event.currentTarget.setPointerCapture(event.pointerId)
                        wiringRef.current.active = true
                        componentWiring.start({ componentId: component.id, terminalKey })
                      }}
                      onPointerUp={(event) => {
                        if (!wiringRef.current.active) return
                        event.stopPropagation()
                        componentWiring.start({ componentId: component.id, terminalKey })
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        componentWiring.start({ componentId: component.id, terminalKey })
                      }}
                    />
                  )
                })}
              </g>
            )}

            <text
              className={css.circuitName}
              x={labelAt.x}
              y={labelAt.y}
              textAnchor={vertical ? (labelSide === 1 ? 'start' : 'end') : 'middle'}
            >
              {component.label}
            </text>

            {rows.map((row, index) => (
              <text
                key={`${component.id}-row-${index}`}
                className={row.className}
                x={rowStart.x}
                y={rowStart.y + index * 13}
                textAnchor={vertical ? (rowSide === 1 ? 'start' : 'end') : 'middle'}
              >
                {row.text}
              </text>
            ))}
          </g>
        )
      })}
    </>
  )
}
