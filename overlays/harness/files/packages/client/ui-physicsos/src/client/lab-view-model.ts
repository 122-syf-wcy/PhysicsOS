/**
 * Physics Lab render contract.
 *
 * The canvas renderer consumes ONLY this view model. Scene numbers, units and
 * derived quantities are produced upstream (today by a prototype fixture, later
 * by the Magnetic Engine), never by the renderer or the panels.
 *
 * Coordinates are scene units (cm) with y pointing UP. The renderer owns the
 * flip into SVG space.
 */

/** Point in scene units, y up. */
export interface LabPoint {
  x: number
  y: number
}

/** Observable layers the student can switch on and off. */
export type LabObservableId = 'velocity' | 'force' | 'trajectory' | 'center' | 'radius' | 'guides'

/** Which way a uniform field points relative to the drawing plane. */
export type LabFieldDirection = 'into-page' | 'out-of-page'

/** Uniform field region drawn as a low-saturation glyph lattice. */
export interface LabFieldView {
  direction: LabFieldDirection
  /** Lattice spacing in scene units. */
  spacing: number
}

/** Charged particle marker. */
export interface LabParticleView {
  id: string
  at: LabPoint
  /** Sign drives the palette: positive is warm coral, negative is physics blue. */
  sign: 'positive' | 'negative'
  /** Radius in scene units. */
  radius: number
  symbol: string
}

/** Arrow drawn from a physics quantity, already scaled for display. */
export interface LabVectorView {
  id: string
  observable: Extract<LabObservableId, 'velocity' | 'force'>
  from: LabPoint
  to: LabPoint
  symbol: string
}

/** One trajectory polyline. */
export interface LabTrajectoryView {
  id: string
  kind: 'history' | 'predicted'
  direction: 'clockwise' | 'counterclockwise'
  points: readonly LabPoint[]
}

/** Straight construction line (radius, guides). */
export interface LabGuideView {
  id: string
  observable: Extract<LabObservableId, 'radius' | 'guides'>
  from: LabPoint
  to: LabPoint
  label?: string
}

/** Canvas-internal readouts. Never a floating toolbar over the scene. */
export interface LabCanvasOverlay {
  /** Top-left field readout lines. */
  field: readonly string[]
  /** Bottom-right scale bar. */
  scale: {
    label: string
    /** Bar length in scene units. */
    length: number
  }
}

/** Everything the canvas needs for one frame. */
export interface LabCanvasViewModel {
  /** Visible scene box in scene units. */
  extent: {
    width: number
    height: number
  }
  grid: {
    minor: number
    major: number
  }
  axes: {
    x: string
    y: string
  }
  field: LabFieldView
  particles: readonly LabParticleView[]
  vectors: readonly LabVectorView[]
  trajectories: readonly LabTrajectoryView[]
  guides: readonly LabGuideView[]
  center?: LabPoint
  overlay: LabCanvasOverlay
  visible: Readonly<Record<LabObservableId, boolean>>
}

/** Editable scene parameter, owned by the Inspector. */
export interface LabParameter {
  id: string
  label: string
  symbol: string
  unit: string
  value: number
}

/** Read-only quantity produced upstream from the editable parameters. */
export interface LabDerived {
  id: string
  label: string
  symbol: string
  value: string
  unit: string
}

/** One Engine/Observation-backed series for the data panel. */
export interface LabSeries {
  id: 'speed' | 'force' | 'radius'
  title: string
  points: readonly { t: number; value: number }[]
}

/** One sampled runtime row; formatting is presentation-only. */
export interface LabSample {
  step: number
  t: string
  theta: string
  speed: string
  force: string
  radius: string
}

/** Scene tree row. Formulas do NOT belong here. */
export interface LabTreeNode {
  id: string
  label: string
  secondary?: string
  icon: 'field' | 'particle' | 'velocity' | 'observable' | 'folder'
  kind: 'group' | 'object' | 'observable'
  observable?: LabObservableId
  children?: readonly LabTreeNode[]
}

/** Playback clock state shared by the timeline and the canvas. */
export interface LabClock {
  /** Elapsed scene time in seconds. */
  time: number
  /** Total scene time in seconds. */
  total: number
  running: boolean
  rate: number
}
