/**
 * PhysicsOS scene visual contract — the ONLY input a renderer consumes.
 *
 * A renderer never imports an engine, never reads a PhysicsScene and never
 * computes a physical fact. Everything below is produced upstream by a runtime
 * bridge from verified Engine + Observation output, so the canvas stays a pure
 * projection of physics that has already been checked.
 *
 * Coordinates are SCENE units with y pointing UP. Each renderer owns the single
 * flip into SVG space, so nothing here has to think about screen orientation.
 *
 * Vector LENGTHS are display lengths in scene units, already scaled upstream: a
 * renderer must never rescale a vector, because the arrow length is a physical
 * statement the bridge is responsible for.
 */

/** Point in scene units, y up. */
export interface ScenePoint {
  x: number
  y: number
}

/** Physics domain, selecting a renderer from the registry. */
export type PhysicsDomainId =
  | 'magnetic'
  | 'mechanics'
  | 'electric'
  | 'circuit'
  | 'composite'
  | 'optics'
  | 'acoustics'
  | 'fluid'

/**
 * Semantic role of a drawn quantity. This drives colour through the physics
 * token set — never a literal hex in a renderer.
 */
export type PhysicsSemanticRole =
  | 'velocity'
  | 'velocity-component'
  | 'force'
  | 'gravity'
  | 'normal'
  | 'friction'
  | 'net-force'
  | 'acceleration'
  | 'trajectory'
  | 'field'
  | 'measurement'
  | 'neutral'
  /* Composite-field force contributions. Kept distinct from the generic `force`
     so the renderer can paint each by its own colour token: electric force blue,
     magnetic force cobalt, gravity slate, net force orange. */
  | 'electric-force'
  | 'magnetic-force'

/** Observable layers a student can switch on and off. */
export type ObservableKey =
  // magnetic
  | 'velocity'
  | 'force'
  | 'trajectory'
  | 'center'
  | 'radius'
  | 'guides'
  // mechanics
  | 'acceleration'
  | 'components'
  | 'keyPoints'
  | 'forces'
  | 'netForce'
  | 'decomposition'
  // electric
  | 'electricField'
  | 'energy'
  | 'potential'
  | 'equipotentials'
  // composite
  | 'electricForce'
  | 'magneticForce'
  | 'gravityForce'
  | 'magneticField'
  | 'regions'
  // circuit
  | 'current'
  | 'voltage'
  | 'power'
  // optics
  | 'rays'
  | 'image'
  // acoustics
  | 'wavefronts'
  | 'path'
  // fluid statics
  | 'displaced'

export type ObservableVisibility = Readonly<Partial<Record<ObservableKey, boolean>>>

/* ------------------------------------------------------------- primitives -- */

/** Solid body: block or ball. */
export interface BodyVisual {
  id: string
  kind: 'block' | 'ball'
  at: ScenePoint
  /** Radius (ball) or half-edge (block) in scene units. */
  size: number
  /** Body rotation in degrees, counter-clockwise. Used on an incline. */
  rotation?: number
  /** Highlighted while it is the live simulated position. */
  live?: boolean
  label?: string
}

/** Ground line with hatching below it. */
export interface GroundVisual {
  y: number
  from: number
  to: number
  label?: string
}

/** Inclined plane wedge, right angle at the bottom-right of the rise. */
export interface InclineVisual {
  /** Corner where the slope meets the horizontal base. */
  origin: ScenePoint
  /** Base length along +x in scene units. */
  base: number
  /** Incline angle in degrees. */
  angle: number
}

/** Raised launch platform for a horizontal projectile. */
export interface PlatformVisual {
  at: ScenePoint
  width: number
  /** Drop from the platform top down to the ground, in scene units. */
  height: number
}

/** One trajectory polyline. `history` is solid, `predicted` is a faint dash. */
export interface TrajectoryVisual {
  id: string
  kind: 'history' | 'predicted'
  points: readonly ScenePoint[]
  /** Rotation sense, drawn as a small glyph. Magnetic orbits only. */
  direction?: 'clockwise' | 'counterclockwise'
}

/**
 * Arrow for a physical quantity. `from`/`to` are already in scene units, so the
 * renderer only projects them — the physical scaling happened upstream.
 */
export interface VectorVisual {
  id: string
  role: PhysicsSemanticRole
  observable: ObservableKey
  from: ScenePoint
  to: ScenePoint
  /** Rendered as italic math, e.g. `v`, `v_x`, `mg\\sin\\theta`. */
  symbol: string
  /** One visual step weaker than a primary vector. */
  subordinate?: boolean
  /** Preferred label side; the layout pass may override it to avoid overlap. */
  labelHint?: 'auto' | 'start' | 'end'
}

/** Angle arc with two bounding rays and a symbol at the bisector. */
export interface AngleVisual {
  id: string
  at: ScenePoint
  /** Arc radius in scene units. */
  radius: number
  /** Arc start angle in degrees, measured from +x counter-clockwise. */
  startAngle: number
  /** Arc end angle in degrees. */
  endAngle: number
  symbol: string
  value?: string
}

/** Dimension line with tick serifs at both ends. */
export interface DimensionVisual {
  id: string
  from: ScenePoint
  to: ScenePoint
  label: string
  /** Which way the ticks and label sit relative to the line. */
  side?: 'left' | 'right'
}

/** Named point of physical interest, drawn as a small precise marker. */
export interface KeyPointVisual {
  id: string
  kind: 'launch' | 'apex' | 'impact' | 'sample'
  at: ScenePoint
  label: string
  /** Hover readout rows, each already formatted upstream. */
  readout?: readonly { label: string; value: string }[]
}

/** Local coordinate basis drawn as a small two-arrow cross. */
export interface CoordinateVisual {
  at: ScenePoint
  /** Arm length in scene units. */
  length: number
  xLabel: string
  yLabel: string
  /** Rotation in degrees; an incline basis is rotated with the slope. */
  rotation?: number
}

/** Free-standing text annotation anchored to a scene point. */
export interface LabelVisual {
  id: string
  at: ScenePoint
  text: string
  role?: PhysicsSemanticRole
  /** Placement relative to the anchor. */
  anchor?: 'start' | 'middle' | 'end'
}

/** Scale bar / measurement readout in the canvas gutter. */
export interface MeasurementVisual {
  label: string
  /** Bar length in scene units, so the bar stays honest under any zoom. */
  length: number
}

/** Uniform field region drawn as a low-saturation glyph lattice. */
export interface FieldVisual {
  direction: 'into-page' | 'out-of-page'
  /** Lattice spacing in scene units. */
  spacing: number
}

/** Uniform in-plane electric field. The vector is normalized upstream. */
export interface ElectricFieldVisual {
  direction: ScenePoint
  /** Lattice spacing in scene units. */
  spacing: number
}

/** Point-charge source: a glass sphere, red for +, blue for −. */
export interface PointChargeSourceVisual {
  id: string
  at: ScenePoint
  sign: 'positive' | 'negative'
  /** Drawn radius in scene units. Presentation only, never read by a solver. */
  radius: number
  /** Signed charge value, for the +/− label and readout. */
  chargeValue: number
}

/**
 * One field streamline (spec §7): a polyline traced along the field direction
 * away from a source, with an arrowhead partway. Points are in scene units.
 */
export interface FieldStreamlineVisual {
  id: string
  points: readonly ScenePoint[]
  /** Where the direction arrow sits on the line, in scene units. */
  arrowAt: ScenePoint
  /** Source this streamline originates from, for highlight. */
  sourceId?: string
}

/**
 * One equipotential contour: a polyline (closed when the contour loops back on
 * itself) along which V is constant. Points are in scene units; `level` is the
 * potential value the contour traces, kept only for the readout label, never as a
 * verified assertion (the precise V at a point already lives in the derived
 * `potential`). Multi-source only: a single source's equipotentials are concentric
 * circles, already conveyed by the streamlines.
 */
export interface EquipotentialVisual {
  id: string
  /** The potential value this contour traces, in volts. Presentation only. */
  level: number
  points: readonly ScenePoint[]
  /** Whether the contour closes on itself (a loop) or terminates at the frame. */
  closed: boolean
}

/** Probe particle in a point-charge scene. Drawn as a small dot. */
export interface ProbeVisual {
  id: string
  at: ScenePoint
}

/**
 * One plate of a parallel-plate capacitor. Drawn as a metal-finish bar. `top`
 * is true for the upper plate (y > 0), false for the lower. `sign` is the
 * plate's charge polarity when the question specifies it, for the +/− label;
 * it is presentation only — the field direction is the physical statement.
 */
export interface PlateVisual {
  id: string
  /** Centre of the plate. */
  at: ScenePoint
  /** Plate length along x in scene units. */
  length: number
  top: boolean
  sign?: 'positive' | 'negative'
}

/**
 * A bounded uniform electric field region (between two parallel plates). The
 * renderer draws the field-line lattice only inside this rectangle. Outside it
 * the field is zero. `direction` is the in-plane field unit vector (already
 * normalized upstream).
 */
export interface BoundedFieldVisual {
  /** Region centre. */
  at: ScenePoint
  /** Region width (plate length) and height (plate separation) in scene units. */
  width: number
  height: number
  /** In-plane field direction, normalized. */
  direction: ScenePoint
  /** Lattice spacing in scene units. */
  spacing: number
}

/** Charged particle marker (magnetic domain). */
export interface ParticleVisual {
  id: string
  at: ScenePoint
  sign: 'positive' | 'negative'
  radius: number
  symbol: string
}

/**
 * One region of a composite-field apparatus.
 *
 * A composite scene binds different fields to different regions (a selector
 * region with E+B, a deflection region with B only, a field-free gap), so the
 * renderer draws each region as its own rectangle with the field lattice clipped
 * to it. `kind` is the role the region plays, so a student can read "选择器区" vs
 * "磁偏转区" off the canvas; the field visuals inside are presentation only.
 */
export interface CompositeRegionVisual {
  id: string
  /** Region centre. */
  at: ScenePoint
  /** Region width and height in scene units. */
  width: number
  height: number
  /** Student-facing role of this region. */
  kind: 'selector' | 'transition' | 'deflection' | 'generic'
  label: string
  /** In-plane electric field acting inside this region, when present. */
  electricField?: ElectricFieldVisual
  /** Magnetic field acting inside this region (×/· glyph), when present. */
  magneticField?: FieldVisual
}

/* ------------------------------------------------------------------ circuit -- */

/** Kind of schematic symbol to draw; mirrors the scene's DC component types. */
export type CircuitSymbolKind =
  | 'resistor'
  | 'voltage_source'
  | 'switch'
  | 'ammeter'
  | 'voltmeter'
  | 'variable_resistor'

/**
 * One schematic symbol on the abstract circuit grid.
 *
 * `at` is the symbol centre; `rotation` orients the local a→b (negative→positive
 * for a source) axis counter-clockwise from +x, in multiples of 90°. Every text
 * is formatted UPSTREAM by the runtime bridge — the renderer places strings and
 * never computes or formats a physical value.
 */
export interface CircuitComponentVisual {
  id: string
  kind: CircuitSymbolKind
  at: ScenePoint
  /** Rotation in degrees counter-clockwise; multiples of 90. */
  rotation: number
  /** Component name, e.g. `R₁`, `E`, `S`. */
  label: string
  /** Nameplate rating, e.g. `10 Ω` or `E=6 V · r=0.5 Ω`. */
  value?: string
  /** Live meter face, e.g. `0.20 A`. Ammeter gated by `current`, voltmeter by `voltage`. */
  reading?: string
  /** Voltage across the component, gated by the `voltage` observable. */
  voltageText?: string
  /** Power on the component, gated by the `power` observable. */
  powerText?: string
  /** Formatted current through the component, gated by the `current` observable. */
  currentText?: string
  /** Current direction along the local axis: `forward` = a→b. */
  currentDirection?: 'forward' | 'reverse'
  /** Switch only: whether the lever is closed. */
  closed?: boolean
  /** Variable resistor only: slider position 0..1 at the current frame. */
  sliderPosition?: number
}

/** One wire polyline between two terminals, waypoints included. */
export interface CircuitWireVisual {
  id: string
  points: readonly ScenePoint[]
}

/** Junction dot where conductors meet on the schematic. */
export interface CircuitJunctionVisual {
  id: string
  at: ScenePoint
  /**
   * Present when ≥3 power-carrying conductors share this dot's electrical net —
   * a real branch point. A voltmeter tap joining a series loop draws a dot but
   * carries no flag, so the teaching layer can tell topology from wiring dots.
   */
  branch?: true
}

/** Straight construction line (orbit radius, guides). */
export interface GuideVisual {
  id: string
  observable: ObservableKey
  from: ScenePoint
  to: ScenePoint
  label?: string
}

/* ------------------------------------------------------------------- optics -- */

/**
 * Luminous object on the optical bench, drawn as the textbook upright arrow.
 * `at` is the foot on the principal axis; `height` is scene units above it.
 */
export interface OpticalObjectVisual {
  id: string
  at: ScenePoint
  /** Height above the axis in scene units, > 0. */
  height: number
  label?: string
}

/** Imaging element: convex thin lens (double-arrow), plane or curved mirror. */
export interface OpticalElementVisual {
  id: string
  kind: 'thin_lens' | 'plane_mirror' | 'curved_mirror'
  /** Centre of the element on the principal axis. */
  at: ScenePoint
  /** Half-aperture (lens) or half-height (mirror) in scene units. */
  halfAperture: number
  /** Curved mirror only: which face meets the light (concave ⇔ f > 0). */
  curvature?: 'concave' | 'convex'
  label?: string
}

/** F / 2F tick on the principal axis. Presentation of an upstream fact. */
export interface OpticalAxisMarkVisual {
  id: string
  at: ScenePoint
  label: string
}

/**
 * The formed image, drawn as an arrow like the object. `height` is SIGNED:
 * negative means inverted (drawn below the axis). A virtual image is dashed —
 * the dash pattern is the physical statement that no light converges there.
 */
export interface OpticalImageVisual {
  id: string
  at: ScenePoint
  /** Signed height in scene units; < 0 = inverted. */
  height: number
  nature: 'real' | 'virtual'
  label?: string
}

/**
 * One light ray. `points` are the physical light path in travel order;
 * `extension` is the dashed backward extension towards a virtual image point.
 * All geometry comes from the engine's principal-ray construction.
 */
export interface OpticalRayVisual {
  id: string
  kind: 'parallel' | 'central' | 'focal' | 'incident'
  points: readonly ScenePoint[]
  extension?: readonly ScenePoint[]
}

/** Screen plate standing on the bench. `lit` = a sharp real image lands on it. */
export interface OpticalScreenVisual {
  id: string
  at: ScenePoint
  /** Half-height in scene units. */
  halfHeight: number
  lit: boolean
  label?: string
}

/* ---------------------------------------------------------------- acoustics -- */

/** Sound source standing on the range axis, drawn as a loudspeaker horn. */
export interface AcousticSourceVisual {
  id: string
  /** Foot of the source on the range axis. */
  at: ScenePoint
  label?: string
}

/** Reflecting wall / cliff face, drawn as a hatched vertical barrier. */
export interface AcousticReflectorVisual {
  id: string
  /** Foot of the reflecting face on the range axis. */
  at: ScenePoint
  /** Half-height in scene units. */
  halfHeight: number
  label?: string
}

/**
 * The travelling sound pulse at the current frame. `phase` is the leg of the
 * round trip the engine reported — outbound towards the wall, return towards
 * the source, or received (parked back at the source).
 */
export interface AcousticPulseVisual {
  id: string
  at: ScenePoint
  phase: 'outbound' | 'return' | 'received'
}

/**
 * One trailing wavefront arc behind the pulse; `direction` is the travel sense
 * the arcs open against. Presentation of the verified pulse state — the arcs
 * carry no independent physics.
 */
export interface AcousticWavefrontVisual {
  id: string
  at: ScenePoint
  /** Arc radius in scene units. */
  radius: number
  direction: 'forward' | 'backward'
}

/* -------------------------------------------------------------------- fluid -- */

/** The liquid body in the tank, drawn as a filled rectangle with a surface line. */
export interface FluidLiquidVisual {
  id: string
  /** Left edge of the tank interior. */
  left: number
  /** Right edge of the tank interior. */
  right: number
  /** Liquid surface level; the tank floor is `floor`. */
  surface: number
  floor: number
  label?: string
}

/**
 * The hanging block at the current frame. `submergedTop` is the level the
 * liquid reaches on the block, so the renderer can shade only the part that is
 * actually under — that shaded slab IS the displaced volume.
 */
export interface FluidBlockVisual {
  id: string
  /** Centre of the block. */
  at: ScenePoint
  halfWidth: number
  halfHeight: number
  /** Liquid level across the block face; equals the block bottom when dry. */
  submergedTop: number
  phase: 'dry' | 'entering' | 'submerged' | 'floating'
  label?: string
}

/** The spring scale above the tank, drawn with its reading on the dial. */
export interface FluidScaleVisual {
  id: string
  /** Hook point the block hangs from. */
  at: ScenePoint
  /** Formatted reading shown on the dial, e.g. `1.67 N`. */
  reading: string
  label?: string
}

/* ------------------------------------------------------------ view model --- */

/** Canvas-internal readouts. Never a floating toolbar over the scene. */
export interface CanvasOverlay {
  /** Top-left readout lines. */
  readout: readonly string[]
  /** Bottom-right scale bar. */
  scale: MeasurementVisual
}

/**
 * One frame for one renderer. `domain` selects the renderer; every renderer
 * reads the shared frame fields and only the primitive arrays it understands.
 */
export interface SceneVisualModel {
  domain: PhysicsDomainId
  /** Visible scene box in scene units. */
  extent: { width: number; height: number }
  /** Scene-unit offset of the box's lower-left corner. */
  origin: ScenePoint
  grid: { minor: number; major: number }
  axes: { x: string; y: string }
  /** Scene units per axis tick label; omitted hides numeric ticks. */
  tickStep?: number

  bodies: readonly BodyVisual[]
  particles: readonly ParticleVisual[]
  vectors: readonly VectorVisual[]
  trajectories: readonly TrajectoryVisual[]
  keyPoints: readonly KeyPointVisual[]
  angles: readonly AngleVisual[]
  dimensions: readonly DimensionVisual[]
  labels: readonly LabelVisual[]
  guides: readonly GuideVisual[]

  ground?: GroundVisual
  incline?: InclineVisual
  platform?: PlatformVisual
  coordinate?: CoordinateVisual
  field?: FieldVisual
  electricField?: ElectricFieldVisual
  /** Point-charge sources (electric point-charge domain). */
  pointChargeSources?: readonly PointChargeSourceVisual[]
  /** Field streamlines radiating from point-charge sources. */
  fieldStreamlines?: readonly FieldStreamlineVisual[]
  /** Probe particle in a point-charge scene. */
  probe?: ProbeVisual
  /** Equipotential contours for a multi-source point-charge field. */
  equipotentials?: readonly EquipotentialVisual[]
  /** The two plates of a parallel-plate capacitor (bounded-field scene). */
  plates?: readonly PlateVisual[]
  /** Bounded uniform field region between the plates. */
  boundedField?: BoundedFieldVisual
  /** Composite-field apparatus regions (selector / drift / deflection). */
  compositeRegions?: readonly CompositeRegionVisual[]
  /** Circuit schematic symbols (circuit domain). */
  circuitComponents?: readonly CircuitComponentVisual[]
  /** Circuit wires connecting the symbols. */
  circuitWires?: readonly CircuitWireVisual[]
  /** Circuit junction dots. */
  circuitJunctions?: readonly CircuitJunctionVisual[]
  /** Optical bench primitives (optics domain). */
  opticalObjects?: readonly OpticalObjectVisual[]
  /** Imaging elements: thin lenses / plane mirrors. */
  opticalElements?: readonly OpticalElementVisual[]
  /** Formed images; gated by the `image` observable. */
  opticalImages?: readonly OpticalImageVisual[]
  /** Principal rays; gated by the `rays` observable. */
  opticalRays?: readonly OpticalRayVisual[]
  /** Screens on the bench. */
  opticalScreens?: readonly OpticalScreenVisual[]
  /** F / 2F axis ticks. */
  opticalAxisMarks?: readonly OpticalAxisMarkVisual[]
  /** Sound sources on the echo range (acoustics domain). */
  acousticSources?: readonly AcousticSourceVisual[]
  /** Reflecting walls on the echo range. */
  acousticReflectors?: readonly AcousticReflectorVisual[]
  /** The travelling pulse at the current frame. */
  acousticPulse?: AcousticPulseVisual
  /** Trailing wavefront arcs; gated by the `wavefronts` observable. */
  acousticWavefronts?: readonly AcousticWavefrontVisual[]
  /** The liquid in the tank (fluid domain). */
  fluidLiquid?: FluidLiquidVisual
  /** The hanging block at the current frame. */
  fluidBlock?: FluidBlockVisual
  /** The spring scale the block hangs from. */
  fluidScale?: FluidScaleVisual
  /** Orbit centre (magnetic domain). */
  center?: ScenePoint

  overlay: CanvasOverlay
  visible: ObservableVisibility

  /**
   * Highlighted visual ids. Clicking a Known in Question Space, or a variable in
   * a solution step, lights up the matching primitive here — the canvas does not
   * decide what is interesting.
   */
  highlighted?: readonly string[]
}

/** Empty frame factory so a failed runtime still renders honest chrome. */
export const emptyVisualModel = (
  domain: PhysicsDomainId,
  overrides: Partial<SceneVisualModel> = {},
): SceneVisualModel => ({
  domain,
  extent: { width: 24, height: 13.5 },
  origin: { x: 0, y: 0 },
  grid: { minor: 1, major: 5 },
  axes: { x: 'x', y: 'y' },
  bodies: [],
  particles: [],
  vectors: [],
  trajectories: [],
  keyPoints: [],
  angles: [],
  dimensions: [],
  labels: [],
  guides: [],
  overlay: { readout: [], scale: { label: '1', length: 1 } },
  visible: {},
  ...overrides,
})

/* ------------------------------------------------- panels and inspectors --- */

/** Editable scene parameter, owned by the Inspector. */
export interface QuantityParameter {
  id: string
  label: string
  symbol: string
  unit: string
  value: number
  /** Inclusive input bounds, enforced by the field before dispatching. */
  min?: number
  max?: number
  step?: number
  /** Visual id lit up in the canvas while this row is focused. */
  highlights?: string
}

/** Read-only quantity produced upstream from the editable parameters. */
export interface DerivedQuantityView {
  id: string
  label: string
  symbol: string
  value: string
  unit: string
  highlights?: string
}

/** One inspector section: a heading plus editable or derived rows. */
export interface InspectorSection {
  id: string
  title: string
  parameters?: readonly QuantityParameter[]
  derived?: readonly DerivedQuantityView[]
  /** Enumerated choice, e.g. field direction. */
  choices?: readonly {
    id: string
    label: string
    value: string
    options: readonly { value: string; label: string }[]
  }[]
}

/** Scene tree row. Formulas do NOT belong here. */
export interface SceneTreeNode {
  id: string
  label: string
  secondary?: string
  icon: SceneTreeIcon
  kind: 'group' | 'object' | 'observable'
  observable?: ObservableKey
  children?: readonly SceneTreeNode[]
}

export type SceneTreeIcon =
  | 'folder'
  | 'field'
  | 'particle'
  | 'body'
  | 'ground'
  | 'incline'
  | 'gravity'
  | 'velocity'
  | 'acceleration'
  | 'force'
  | 'trajectory'
  | 'observable'
  | 'variable'
  | 'keyPoint'

/** One Engine/Observation-backed chart series for the data panel. */
export interface ChartSeries {
  id: string
  title: string
  /** Axis captions, e.g. `t / s` and `v / (m/s)`. */
  xLabel: string
  yLabel: string
  points: readonly { t: number; value: number }[]
  role: PhysicsSemanticRole
}

/** Sampled runtime row. Formatting is presentation-only. */
export interface DataSampleRow {
  step: number
  values: readonly string[]
}

/** Column headings matching {@link DataSampleRow.values}. */
export interface DataTableView {
  columns: readonly string[]
  rows: readonly DataSampleRow[]
}

/** Timeline event marker (launch, apex, impact, field entry/exit, plate hit). */
export interface TimelineEvent {
  id: string
  /** Scene time in seconds. */
  time: number
  label: string
  kind:
    | 'launch'
    | 'apex'
    | 'impact'
    | 'enter'
    | 'exit'
    | 'plate-impact'
    | 'generic'
}

/** Playback clock shared by the timeline and the canvas. */
export interface PlaybackClock {
  /** Elapsed scene time in seconds. */
  time: number
  /** Total scene time in seconds. */
  total: number
  running: boolean
  rate: number
}

/** One derivation step surfaced in the bottom panel. */
export interface DerivationStepView {
  id: string
  title: string
  /** KaTeX-ready expression. */
  expression: string
  detail?: string
  result?: { symbol: string; value: string; unit: string }
}

/** One verification check, student-readable. Never raw JSON. */
export interface VerificationCheckView {
  id: string
  label: string
  status: 'passed' | 'warning' | 'failed'
  detail?: string
}

/** Runtime status shared by every workspace surface. */
export type RuntimeStatus = 'verified' | 'warning' | 'failed'

/** Structured runtime failure, explained rather than dumped. */
export interface RuntimeErrorView {
  code: string
  /** Student-facing explanation in the product language. */
  message: string
  retryable: boolean
  /** Conditions the parser did recognise, so the student is not stranded. */
  recognized?: readonly { label: string; value: string }[]
}
