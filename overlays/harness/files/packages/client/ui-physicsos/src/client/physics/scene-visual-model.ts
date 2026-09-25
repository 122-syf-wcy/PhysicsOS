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
  | 'thermal'
  | 'induction'
  | 'wave'

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
  /* Connector forces on mechanics rigs: spring restoring pull and rope
     tension get their own ink so the free-body reading names them apart. */
  | 'spring'
  | 'tension'

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
  // pressure rigs (fluid domain): the primary reading and the comparison
  // reading. Which apparatus each key shows is the sub-model's business — the
  // bench factory stamps the same two ids for all three rigs.
  | 'pressure'
  | 'pressureComparison'
  // thermal
  | 'thermometer'
  | 'phase'
  // lever statics (mechanics domain)
  | 'moments'
  | 'arms'
  // induction
  | 'emf'
  | 'inductionCurrent'
  | 'flux'
  | 'barMotion'
  // wave
  | 'waveform'
  | 'waveSpeed'
  | 'superposition'
  | 'nodes'
  // current-magnetic rigs (magnetic domain): the field the bench's current
  // makes, and the second measurement beside it. Named for the field rather
  // than for the current, because `current` already means the arrows on a
  // circuit schematic — a different drawing of a different thing.
  | 'fieldLines'
  | 'fieldComparison'
  // mechanical-energy rig (mechanics domain): the ledger bar, and the ramp the
  // cart slides down. `energy` is reused from the electric group — it means the
  // same thing there: a layer that shows energy rather than forces.
  | 'energyConversion'
  // light-propagation rig (optics domain): the rays through the hole, and the
  // image they build on the screen.
  | 'lightRays'

export type ObservableVisibility = Readonly<Partial<Record<ObservableKey, boolean>>>

/* ------------------------------------------------------------- primitives -- */

/** Solid body: block or ball. */
export interface BodyVisual {
  id: string
  kind: 'block' | 'ball' | 'cart' | 'weight-hook'
  at: ScenePoint
  /** Radius (ball) or half-edge (block); for a cart, half the axle spacing. */
  size: number
  /** Body rotation in degrees, counter-clockwise. Used on an incline. */
  rotation?: number
  /** Highlighted while it is the live simulated position. */
  live?: boolean
  label?: string
}

/**
 * One strobe mark: the body's position at an equal-time sample. The spacing
 * between marks IS the physics lesson — constant for uniform motion, widening
 * for acceleration — so every sampled frame earns a dot, and sparse marks carry
 * a `t` label.
 */
export interface MotionMarkVisual {
  id: string
  at: ScenePoint
  /** Elapsed scene time at this mark, e.g. `t = 2 s`. Undefined hides the label. */
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

/**
 * A coil spring between its anchor and the body's near edge. The renderer
 * draws the coil parametrically — its length IS the physics (stretch =
 * x − L₀), so it is a drawn primitive, never a bitmap.
 */
export interface SpringVisual {
  /** Scene constraint id — the element key the inspector highlights. */
  id: string
  /** Fixed wall/support end. */
  anchor: ScenePoint
  /** End attached to the body at the current frame. */
  end: ScenePoint
  /** Relaxed length in scene units — drawn as a faint reference mark. */
  naturalLength: number
  /** 'horizontal' stretches sideways; 'vertical' hangs. */
  axis: 'horizontal' | 'vertical'
  /** Equilibrium position on the motion axis, for the rest-position tick. */
  equilibrium?: number
}

/** Pendulum rig: pivot mount, taut string, and the rest-position marker. */
export interface PendulumVisual {
  /** Scene constraint id — the element key the inspector highlights. */
  id: string
  pivot: ScenePoint
  /** Bob centre at the current frame — the string runs pivot → bob. */
  bob: ScenePoint
  /** String length in scene units. */
  length: number
}

/**
 * A photographed apparatus sprite placed by its catalogued anchor: the
 * spring scale hooked to a friction block, the boss-head clamp a coil or
 * string hangs from. `at` is the scene point the sprite's `anchorPoint`
 * lands on; `size` is its drawn height in scene units. `flip` mirrors the
 * sprite horizontally — e.g. the scale's hook must face the block. The
 * sprite moves with the scene point it is anchored to, so a puller tracks
 * its body every frame.
 */
export interface ApparatusSpriteVisual {
  /** Element key — inspector highlights can target it. */
  id: string
  /** Key into the mechanics parts3d catalog. */
  part: string
  at: ScenePoint
  /** Drawn height in scene units; width follows the sprite aspect. */
  size: number
  /** Explicit width in scene units — stretches the sprite for extent-spanning parts (rails). */
  width?: number
  /** Mirror horizontally about the anchor point. */
  flip?: boolean
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
  /**
   * The rating behind {@link value} as a number: volts for a source, ohms for a
   * resistor or rheostat. The canvas picks which catalogued apparatus to draw
   * from it, so the part shown is the part the student set.
   */
  ratingValue?: number
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
  /** Dissipated power normalized 0..1 across the circuit's loads; the bridge
     * emits it only on components drawn as lamps, which light by Joule heat. */
  glow?: number
}

/** One wire polyline between two terminals, waypoints included. */
export interface CircuitWireVisual {
  id: string
  points: readonly ScenePoint[]
}

/**
 * Charge-carrier drift along one conductor run: a polyline in current order
 * plus the signed current the engine solved for it. `current` sign is the
 * direction along `path` order — the renderer turns it into a dot advance
 * rate and never re-derives direction.
 */
export interface ChargeFlowVisual {
  id: string
  /** Polyline in conductor order; a closed loop repeats its first point. */
  path: readonly ScenePoint[]
  /** Signed current in amperes along `path` order. */
  current: number
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
  /** Needle deflection 0..1 across the dial; matches `reading`. */
  dialFraction?: number
  label?: string
}

/* ----------------------------------------------------------------- pressure -- */

/**
 * Which pressure rig a frame is showing. Carried explicitly rather than inferred
 * from which picture fields are present, so the renderer picks a drawing without
 * probing the frame — and so a frame that lost its picture still knows what it
 * was.
 */
export type PressureRigKind = 'solid' | 'liquid' | 'atmospheric'

/**
 * One contact face of a solid-pressure rig: the plate the force presses on, with
 * the pressure it reads there. The widths are the SQUARE ROOTS of the authored
 * areas, so two faces drawn 2:1 are 4:1 in area — the ratio the lesson is about.
 */
export interface PressureFaceVisual {
  id: string
  /** Centre of the face, on the table line. */
  at: ScenePoint
  halfWidth: number
  /** Formatted pressure under the face, e.g. `1000 Pa`. */
  pressureText: string
  /** The face the rig is loaded on; the others are comparisons. */
  loaded: boolean
}

/**
 * The press block on a solid-pressure rig. `faces` holds the contact faces the
 * single force is shared between: the loaded one and, when authored and asked
 * for, the tipped one — the same F over a smaller area, which is the whole point
 * of separating 压力 from 压强.
 */
export interface PressureSolidVisual {
  id: string
  /** Centre of the block sitting on its loaded face. */
  at: ScenePoint
  halfWidth: number
  halfHeight: number
  /** Slab the block presses on, drawn below the contact plane at `at.y`. */
  plateDepth: number
  /** Formatted force carried by every face, e.g. `20 N`. */
  forceText: string
  faces: readonly PressureFaceVisual[]
  label?: string
}

/** The liquid column a pressure probe sits in. */
export interface PressureLiquidVisual {
  id: string
  left: number
  right: number
  /** Liquid surface level; the vessel floor is `floor`. */
  surface: number
  floor: number
  /** Glass drawn above the surface, so the vessel reads as an open vessel. */
  rim: number
  /** Formatted density, e.g. `1000 kg/m³`. */
  densityText: string
  label?: string
}

/**
 * One probe under the surface. `depth` is drawn as a dimension from `surface`
 * down to `at`, so the number in the label is the length on screen.
 */
export interface PressureProbeVisual {
  id: string
  /** Centre of the probe's sensing disc. */
  at: ScenePoint
  /** Formatted reading at the probe, e.g. `1960 Pa`. */
  readingText: string
  /** Depth below the surface in scene units. */
  depth: number
  /** Surface level the depth is measured from. */
  surface: number
  /** The rig's own probe (the one its density and depth parameters drive). */
  primary: boolean
}

/** The Torricelli tube standing in its mercury dish. */
export interface PressureBarometerVisual {
  id: string
  /** Centre of the tube bore. */
  at: ScenePoint
  halfWidth: number
  /** Half width of the dish the tube stands in. */
  dishHalfWidth: number
  /** Depth of the dish's mercury pool below the open surface. */
  dishDepth: number
  /** Mercury level in the open dish. */
  surface: number
  /** Top of the standing column — the height the balance fixes. */
  columnTop: number
  /** Top of the sealed glass tube, always above `columnTop`. */
  tubeTop: number
  /** Formatted column height, e.g. `760 mm`. */
  columnText: string
  /** Formatted pressure the column is holding up, e.g. `101300 Pa`. */
  pressureText: string
  label?: string
}

/** The Magdeburg hemisphere pair and the pull that separates it. */
export interface PressureHemisphereVisual {
  id: string
  at: ScenePoint
  radius: number
  /** Formatted pull on each side, e.g. `796 N`. */
  forceText: string
  label?: string
}

/* ------------------------------------------------------ current-magnetic -- */

/** Which current-magnetic rig this frame is. */
export type CurrentRigKind = 'straight_wire' | 'solenoid' | 'electromagnet' | 'motor'

/**
 * The conductor of a straight-wire rig, drawn END-ON: the wire pierces the page
 * at `at`, which is the only way a 2D figure can show the field circling it.
 * 安培定则 then reads off the drawing — thumb out of the page, fingers curl
 * counter-clockwise — so `direction` is what the symbol and the arrows follow.
 */
export interface CurrentWireVisual {
  id: string
  /** Where the conductor pierces the page. */
  at: ScenePoint
  /** Formatted current, e.g. `I = 10 A`. */
  currentText: string
  /** +1 = current out of the page (drawn ⊙), −1 = into the page (drawn ⊗). */
  direction: 1 | -1
  label?: string
}

/** One concentric field circle around the conductor. */
export interface CurrentFieldCircleVisual {
  id: string
  center: ScenePoint
  radius: number
  /** +1 = counter-clockwise (current out of the page), −1 = clockwise. */
  circulation: 1 | -1
  /** True for the circle the headline reading is taken on. */
  probe: boolean
}

/** A probe sitting on a field circle, reading the field there. */
export interface CurrentProbeVisual {
  id: string
  at: ScenePoint
  /** Formatted field at the probe, e.g. `40 µT`. */
  readingText: string
  /** The rig's own probe (the one its distance parameter drives). */
  primary: boolean
}

/**
 * The coil of a solenoid rig, drawn as a row of turn loops around the axis.
 * `northPole` is which end 安培定则 puts N on, and it is drawn as a letter at
 * that end so the rule is readable without the paragraph that explains it.
 */
export interface CurrentCoilVisual {
  id: string
  /** Centre of the coil axis. */
  at: ScenePoint
  /** Half the coil length along the axis — the `L` of B = μ₀(N/L)I. */
  halfLength: number
  /** Drawn radius of a turn loop. */
  radius: number
  /** Turn loops drawn (ink, not the electrical turn count). */
  loopCount: number
  /** Formatted current, e.g. `I = 5 A`. */
  currentText: string
  /** Formatted interior field, e.g. `B = 12.57 mT`. */
  fieldText: string
  /** +1 = N pole at the +axis end, −1 = at the −axis end. */
  northPole: 1 | -1
  /** Formatted turn counts of the two windings, e.g. `N = 400` / `N₂ = 800`. */
  turnsText: string
  comparisonTurnsText?: string
  label?: string
}

/**
 * The core threaded through a coil, with the armature its pole face holds.
 *
 * The core is drawn as a bar through the winding because that is the whole
 * difference between this rig and the solenoid beside it on the shelf — and the
 * armature is drawn as a fixed-size block, because the size of a drawn object
 * is not a measurement. What the rig HOLDS is the formatted mass, which is
 * text: an armature whose height scaled with the mass would be a second,
 * unstated claim about the physics.
 */
export interface CurrentCoreVisual {
  id: string
  /** Centre of the core bar. */
  at: ScenePoint
  /** Half length along the axis; the bar protrudes past the winding. */
  halfLength: number
  /** Drawn half-height of the bar. */
  halfHeight: number
  /** The end the right-hand rule points at, where the armature is held. */
  northPole: 1 | -1
  /**
   * Drawn size of the armature the pole holds. It travels in the visual rather
   * than living in the renderer because the FRAME has to leave room for it and
   * for the labels beside it — a size only the renderer knew would be a size the
   * layout could not account for.
   */
  armatureHalfWidth: number
  armatureHalfHeight: number
  /** Formatted relative permeability of the core, e.g. `μ_r = 200`. */
  coreText: string
  /** Formatted field the SAME coil would make air-cored, e.g. `B₀ = 1.257 mT`. */
  airFieldText: string
  /** Formatted pull the pole face holds, e.g. `F = 10.05 N`. */
  pullText: string
  /** Formatted mass that pull balances, e.g. `m = 1.026 kg`. */
  heldMassText: string
  comparisonCoreText?: string
  comparisonPullText?: string
  label?: string
}

/**
 * The rotor of a motor, seen END-ON down its own axis.
 *
 * Along the axis the two sides that carry the force are two POINTS, and that is
 * the view in which the couple is legible: the forces on them are equal,
 * opposite and vertical (perpendicular to B, which is horizontal), so the torque
 * is whatever leverage the coil's own angle gives them. At θ = 0 the two points
 * are level with each other and the couple is at full strength; at θ = 90° they
 * are one above the other, the two forces pull along the same line, and the coil
 * tears rather than turns — the 平衡位置, drawn instead of described.
 */
export interface MotorRotorVisual {
  id: string
  /** The axis the rotor turns about, where the commutator sits. */
  at: ScenePoint
  /** The two force-carrying sides, seen end-on. */
  sides: readonly ScenePoint[]
  /** The couple: one arrow per side, equal and opposite. */
  forces: readonly { readonly id: string; readonly from: ScenePoint; readonly to: ScenePoint }[]
  /** Half the coil's width — the lever arm the couple acts across (cm). */
  halfWidth: number
  /** Angle from the coil's plane to the field (rad), for the label. */
  angle: number
  /** +1 = the rotor turns counter-clockwise on the page. */
  sense: 1 | -1
  /** Formatted torque, e.g. `τ = 0.24 N·m`. */
  torqueText: string
  /** Formatted force on each side, e.g. `F = BIL = 0.06 N`. */
  forceText: string
  currentText: string
  turnsText: string
  angleText: string
  fieldText: string
  label?: string
}

/** One drawn field line of a coil rig: axial inside, looping back outside. */export interface CurrentFieldLineVisual {
  id: string
  /**
   * Points along the line, in scene coordinates, ordered ALONG THE FIELD. The
   * order is the direction: a line drawn from the south end to the north end
   * carries its arrows that way, so reversing the current reverses the line
   * rather than needing a second direction field.
   */
  points: readonly ScenePoint[]
  /** True for the axial line the headline reading is taken on. */
  probe: boolean
  /**
   * Where the direction arrows go, as fractions along the polyline. A long
   * uniform field needs more than one to read as uniform; a closed loop needs
   * one on each side to read as a loop.
   */
  arrowAt?: readonly number[]
}

/* ------------------------------------------------------- mechanical energy -- */

/** Where a slice of the energy ledger came from — it decides the ink. */
export type EnergyRole = 'potential' | 'kinetic' | 'thermal'

/**
 * One segment of the energy bar.
 *
 * `fraction` is the segment's share of the total the cart started with, so the
 * bar always adds up to the same 100%: the picture's whole claim is that the
 * segments REDISTRIBUTE and the bar does not change length.
 */
export interface EnergySegmentVisual {
  id: string
  role: EnergyRole
  /** Formatted energy, e.g. `Ep = 17.64 J`. */
  text: string
  /** Share of the release-time total, 0..1. */
  fraction: number
}

/**
 * The ledger drawn as one stacked bar: potential on the left, kinetic in the
 * middle, the heat friction made on the right. A rig whose ledger did not
 * balance would draw a bar of the wrong length, which is a fault the eye
 * catches before any number is read.
 */
export interface EnergyBarVisual {
  id: string
  /** Bottom-left corner of the bar, in scene units. */
  at: ScenePoint
  width: number
  height: number
  segments: readonly EnergySegmentVisual[]
  /** Formatted total under the bar, e.g. `E = 17.64 J`. */
  totalText: string
  label?: string
}

/** The cart, the ramp it slides down, and the ledger it feeds. */
export interface EnergyRampVisual {
  id: string
  /** Bottom corner of the ramp — where the cart ends up. */
  base: ScenePoint
  /** Top corner of the ramp — where the cart is released. */
  peak: ScenePoint
  /** Height of the release point above the base (scene units, = cm). */
  height: number
  /** Drawn length of the cart along the slope, in scene units. */
  cartLength: number
  /** Drawn half-height of the cart, in scene units. */
  cartHalfHeight: number
  /** Formatted release height, e.g. `h = 90 cm`. */
  heightText: string
  /** Formatted ramp length, e.g. `L = 127.3 cm`. */
  rampText: string
  /** Formatted potential energy at the release point, e.g. `Ep = 17.64 J`. */
  potentialText: string
  /** Formatted kinetic energy at the bottom. */
  kineticText: string
  /** Formatted heat friction made on the way, e.g. `Q = 0` / `Q = 3.528 J`. */
  thermalText: string
  /** Formatted speed at the bottom, e.g. `v = 4.2 m/s`. */
  speedText: string
  label?: string
}

/* --------------------------------------------------- rectilinear light -- */

/**
 * The pinhole rig, drawn the way the textbook draws it: the object standing on
 * the axis at −u, the card with its hole at the origin, the screen at +v, and
 * two rays that cross AT the hole and keep going.
 *
 * Both arrows are drawn at their TRUE scene size — the object at h, the image at
 * h′ — because the figure's whole claim is the ratio between them. A drawing
 * that rescaled either one would be the one place the experiment could lie.
 */
export interface LightRigVisual {
  id: string
  /** The hole, which is also the frame's origin of rays. */
  at: ScenePoint
  /** The object: where it stands and how tall it is (scene units = cm). */
  objectAt: ScenePoint
  objectHalfHeight: number
  /** The receiving screen, and how tall it is drawn (ink, not a measurement). */
  screenAt: ScenePoint
  screenHalfHeight: number
  /** The hole's card: how far it is drawn above and below the hole. */
  cardHalfHeight: number
  /** The image: bottom and top of the arrow the screen shows, at true size. */
  imageFrom: ScenePoint
  imageTo: ScenePoint
  /** The two rays, each a polyline object-point → hole → image-point. */
  rays: readonly { readonly id: string; readonly points: readonly ScenePoint[] }[]
  /** Formatted object height, e.g. `h = 6 cm`. */
  objectText: string
  /** Formatted image height, e.g. `h′ = 3 cm`. */
  imageText: string
  /** Formatted magnification, e.g. `v/u = 0.5`. */
  magnificationText: string
  /** Formatted object distance, e.g. `u = 30 cm`. */
  distanceText: string
  /** Formatted screen distance, e.g. `v = 15 cm`. */
  screenText: string
  label?: string
}

/**
 * The refraction rig: a boundary between two media, the normal, and the three
 * rays light can take at it.
 *
 * `refractedTo` is ABSENT rather than drawn grazing along the boundary when the
 * light is past the critical angle: 全反射 is the disappearance of that ray, so
 * a figure that drew it skimmed along the surface would be showing the one
 * thing that is not happening. `total` is what that absence means.
 */
export interface LightRefractionVisual {
  id: string
  /** Where the ray meets the boundary. */
  at: ScenePoint
  boundaryFrom: ScenePoint
  boundaryTo: ScenePoint
  /** The normal, drawn dashed through the point of incidence. */
  normalFrom: ScenePoint
  normalTo: ScenePoint
  /** The incoming ray, ending at the point of incidence. */
  incidentFrom: ScenePoint
  /** The ray sent back into the first medium. */
  reflectedTo: ScenePoint
  /** The ray through the boundary — absent past the critical angle. */
  refractedTo?: ScenePoint
  /** Where the critical angle's own ray would go, dashed: the threshold. */
  criticalTo?: ScenePoint
  /** True when nothing refracts. */
  total: boolean
  incidentText: string
  refractedText: string
  criticalText: string
  indicesText: string
  label?: string
}

/* --------------------------------------------------------------- noise -- */

/**
 * The noise rig, drawn TO SCALE in metres: the source, the listener where it
 * actually stands, and the barrier between them. The arc radii are the
 * wavefronts the source has sent out, drawn where they would be at that
 * distance — so walking the listener back visibly moves it beyond the near
 * fronts and nearer the far ones, which is the whole of −6 dB.
 */
export interface NoiseRigVisual {
  id: string
  /** The source, at the origin. */
  sourceAt: ScenePoint
  /** Where the listener stands, in scene metres. */
  listenerAt: ScenePoint
  /** Source-to-listener distance (m) — the drawn distance, to scale. */
  distance: number
  /** Where the barrier stands, when there is one. */
  barrierAt?: ScenePoint
  /** Radii of the drawn wavefronts (m), nearer first. */
  wavefronts: readonly number[]
  /** Formatted level at the listener, e.g. `L = 83.0 dB`. */
  levelText: string
  /** Formatted source rating, e.g. `Lw = 100 dB`. */
  sourceText: string
  /** Formatted distance. */
  distanceText: string
  /** Formatted barrier, e.g. `隔声量 15 dB`. */
  barrierText: string
  /** The control: what it would read with no barrier. */
  comparisonText: string
  label?: string
}

/* --------------------------------------------------------- thermometer -- */

/**
 * A liquid-in-glass thermometer, drawn TO SCALE: the distances on the glass are
 * the distances the engine computed, in centimetres. That is the whole point of
 * the figure — 0 °C and 100 °C are marked where they actually are, so the span
 * between them is the instrument's real span rather than a drawn symbol of one.
 */
export interface ThermometerVisual {
  id: string
  /** Foot of the tube, in scene centimetres from the bulb. */
  at: ScenePoint
  /** Half-width of the tube (ink, not a measurement). */
  halfWidth: number
  /** Drawn radius of the bulb (ink). */
  bulbRadius: number
  /** Top of the liquid column (cm) — where the temperature puts it. */
  columnTop: number
  /** Where the lower fixed point is marked (cm). */
  icePoint: number
  /** Where the upper fixed point is marked (cm). */
  steamPoint: number
  /** Length of the whole graduated span (cm). */
  span: number
  /** Formatted temperature the bulb sits in, e.g. `t = 25 °C`. */
  temperatureText: string
  /** Formatted sensitivity, e.g. `k = 0.9947 mm/°C`. */
  scaleText: string
  /** Formatted fixed points, e.g. `0 °C → 2 cm · 100 °C → 11.95 cm`. */
  fixedPointsText: string
  /** Formatted span, e.g. `0–100 °C 之间 9.947 cm`. */
  spanText: string
  /** Formatted column, e.g. `液柱 4.49 cm`. */
  columnText: string
  label?: string
}

/* --------------------------------------------------------- transformer -- */

/**
 * The transformer, drawn the way the schematic does: one core, two windings,
 * and the readings written beside each.
 *
 * `turnsLoops` is INK — how many loops are drawn to suggest a winding — while
 * `primaryTurns`/`secondaryTurns` are the machine. They are separate on purpose:
 * a drawing that showed one loop per turn would need a thousand loops, and a
 * reader who counted them would be reading the ink rather than the rig.
 */
export interface TransformerCoilVisual {
  id: string
  /** Centre of the winding. */
  at: ScenePoint
  /** Half-width of the coil body. */
  halfWidth: number
  halfHeight: number
  /** Loops drawn, and the loop spacing. */
  turnsLoops: number
  spacing: number
  /** Formatted voltage across this winding, e.g. `U₁ = 220 V`. */
  voltageText: string
  /** Formatted current through it. */
  currentText: string
  /** Formatted turn count. */
  turnsText: string
  /** The driven winding, drawn with the source's ink. */
  primary: boolean
}

/** The core both windings share, and what the machine does as a whole. */
export interface TransformerCoreVisual {
  id: string
  /** Left and right ends of the core bar. */
  from: ScenePoint
  to: ScenePoint
  /** Drawn half-height of the bar. */
  halfHeight: number
  /** Formatted readings: the ratio and the power. */
  ratioText: string
  powerText: string
  /** True when the rig steps the voltage UP. */
  stepsUp: boolean
  label?: string
}

/* ------------------------------------------------------------------ thermal -- */

/**
 * The heated sample in its beaker at the current frame. `meltedFraction` drives
 * how much of the beaker is drawn as liquid rather than solid, so the phase
 * change is visible on the apparatus and not only on the graph.
 */
export interface ThermalSampleVisual {
  id: string
  /** Centre of the beaker interior. */
  at: ScenePoint
  halfWidth: number
  halfHeight: number
  /** Fraction of the sample that has melted, 0…1. */
  meltedFraction: number
  /**
   * Which segment of the curve the sample is on. `boiling` is the second
   * plateau: the same "changing phase, absorbing heat, temperature flat" as
   * melting, at a different temperature.
   */
  phase: 'solid' | 'melting' | 'liquid' | 'boiling'
  label?: string
}

/** The thermometer beside the beaker, drawn with its live reading. */
export interface ThermalThermometerVisual {
  id: string
  /** Foot of the thermometer bulb. */
  at: ScenePoint
  /** Column height in scene units, already scaled from the temperature. */
  columnHeight: number
  /** Formatted reading shown next to the tube, e.g. `0.0 ℃`. */
  reading: string
  label?: string
}

/** The heat source under the beaker, drawn with its power label. */
export interface ThermalHeaterVisual {
  id: string
  at: ScenePoint
  halfWidth: number
  /** Formatted power, e.g. `50 W`. */
  power: string
  label?: string
}

/* -------------------------------------------------------------------- lever -- */

/** The rigid beam of a class-1 lever, already rotated to the engine's tilt. */
export interface LeverBeamVisual {  id: string
  from: ScenePoint
  to: ScenePoint
  /** Rotation from horizontal, positive = CCW = left down (rad). */
  tilt: number
}

/** The fulcrum under the beam. */
export interface LeverFulcrumVisual {
  id: string
  at: ScenePoint
}

/** One hanging load: attach point on the beam, mass hanging vertically below. */
export interface LeverHangerVisual {
  id: string
  side: 'left' | 'right'
  attach: ScenePoint
  massAt: ScenePoint
  label: string
  /** Formatted mass shown under the blob, e.g. `200 g`. */
  massText: string
}

/* ---------------------------------------------------------------- induction -- */

/**
 * The uniform field region of an induction bench. The field is drawn as the
 * textbook dotted plane; B's magnitude rides the readout, not the ink.
 */
export interface InductionFieldVisual {
  id: string
  /** Field box: lower-left corner and size, in scene units (cm). */
  origin: ScenePoint
  size: { width: number; height: number }
  /** Field-direction marks per grid cell (✕ = into page, · = out of page). */
  marks: 'into' | 'out'
}

/** The conducting rod of a bar_motion rig, at its swept position. */
export interface InductionBarVisual {
  id: string
  /** Centre of the rod at this frame; the rod spans the field height. */
  at: ScenePoint
  length: number
  label: string
  /** Slide direction along the rails: the sign of the rod's velocity. */
  direction: 1 | -1
}

/**
 * The resistor that closes the rail loop of a bar_motion rig: a vertical wire
 * bridging the two rails at one end, with the resistor zigzag in the middle.
 */
export interface InductionResistorVisual {
  id: string
  /** Centre of the closure wire. */
  at: ScenePoint
  /** Rail spacing the wire spans (cm). */
  span: number
  label: string
}

/** One rail line of a double_bar_rail rig (a straight conductor both bars slide on). */
export interface InductionRailVisual {
  id: string
  from: ScenePoint
  to: ScenePoint
}

/** One conducting bar of a double_bar_rail rig at its current position. */
export interface InductionPairBarVisual {
  id: string
  /** Centre of the bar at this frame; the bar spans the two rails. */
  at: ScenePoint
  length: number
  label: string
}

/**
 * Magnetic force on one bar of a double_bar_rail rig, drawn as a short arrow
 * along the rails. The magnitude is the engine's BIL fact scaled into scene
 * units; the direction carries the engine's sign (Lenz: opposes relative
 * motion).
 */
export interface InductionForceArrowVisual {
  id: string
  /** Tail of the arrow at the bar centre. */
  at: ScenePoint
  /** +x or -x along the rails. */
  direction: 1 | -1
  /** Arrow length in scene units (cm). */
  length: number
  label: string
}

/** The coil of a flux_change rig (a flat loop seen edge-on). */
export interface InductionCoilVisual {
  id: string
  at: ScenePoint
  /** Coil diameter, drawn as the loop's visible width. */
  diameter: number
  label: string
}

/** Current-direction arrow around the loop; sign comes from the engine's lenz readout. */
export interface InductionCurrentVisual {
  id: string
  from: ScenePoint
  to: ScenePoint
  /** +1 / -1: the engine's lenz_direction sign. */
  sign: number
}

/* --------------------------------------------------------------------- wave -- */

/**
 * The rope / string profile at the current frame: the engine's sampled points
 * in rope order, plus the equilibrium line they oscillate about. Displacements
 * are already scaled by the bridge's vertical gain (see the overlay readout),
 * so the renderer only projects them.
 */
export interface WaveProfileVisual {
  id: string
  kind: 'rope' | 'string'
  points: readonly ScenePoint[]
  /** Equilibrium line the profile oscillates about. */
  equilibrium: { from: ScenePoint; to: ScenePoint }
}

/**
 * A marked rope particle: fixed x, transverse SHM in y. Its velocity is drawn
 * from the shared `vectors` array so the arrow follows the vector grammar.
 */
export interface WaveMarkerVisual {
  id: string
  at: ScenePoint
  label: string
}

/** One of the two coherent sources of an interference rig. */
export interface WaveSourceVisual {
  id: string
  at: ScenePoint
  label: string
}

/**
 * The observation point P of an interference rig. `verdict` is the engine's
 * classification of Δ/λ (published as interference_type); `readout` is the
 * formatted Δ / A_P line the renderer places beside the point.
 */
export interface WavePointVisual {
  id: string
  at: ScenePoint
  verdict: 'constructive' | 'destructive' | 'partial'
  readout: string
}

/** Node (still) or antinode (largest swing) on a standing-wave string. */
export interface WaveNodeVisual {
  id: string
  kind: 'node' | 'antinode'
  at: ScenePoint
  label?: string
}

/**
 * Amplitude envelope of a standing wave: the profile at t = 0 (cos ωt = 1) and
 * its mirror. Two dashed curves the string never leaves — produced by asking the
 * engine for its t = 0 state, never by evaluating sin here.
 */
export interface WaveEnvelopeVisual {
  id: string
  upper: readonly ScenePoint[]
  lower: readonly ScenePoint[]
}

/**
 * One circular crest spreading from a source at the current frame. Radii are
 * the crests' distances r = v·t − kλ the bridge read off the engine's λ, v and
 * t — presentation of where the in-phase fronts sit, not a new physical claim.
 */
export interface WaveFrontVisual {
  id: string
  center: ScenePoint
  /** Crest radius in scene units. */
  radius: number
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
  /**
   * Scene-coordinate ranges whose tick LABELS are dropped (tick marks stay).
   * A bounded field's axis crosses the apparatus, so the labels inside the
   * region print on top of plates and field ink; the bridge names the band and
   * the canvas keeps the flanking labels.
   */
  tickLabelAvoid?: { x?: readonly [number, number]; y?: readonly [number, number] }

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
  /** Coil spring rig (mechanics spring_oscillator / spring_statics). */
  spring?: SpringVisual
  /** String + pivot of a simple_pendulum rig. */
  pendulum?: PendulumVisual
  /** Photographed rig apparatus (puller scale, suspension clamp). */
  apparatus?: readonly ApparatusSpriteVisual[]
  /** Equal-time strobe marks along the path (ticker-tape style). */
  motionMarks?: readonly MotionMarkVisual[]
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
  /** Charge-carrier drift runs (circuit wires, induction rail loops). */
  chargeFlows?: readonly ChargeFlowVisual[]
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
  /** Which pressure rig this frame is; absent on every non-pressure scene. */
  pressureRig?: PressureRigKind
  /** Press block of a solid rig. */
  pressureSolid?: PressureSolidVisual
  /** The liquid column of a liquid rig. */
  pressureLiquid?: PressureLiquidVisual
  /** A second vessel holding the comparison liquid, drawn beside the first. */
  pressureComparisonLiquid?: PressureLiquidVisual
  /** Probes under those surfaces, primary first. */
  pressureProbes?: readonly PressureProbeVisual[]
  /** Torricelli tube of an atmospheric rig. */
  pressureBarometer?: PressureBarometerVisual
  /** Magdeburg hemispheres of an atmospheric rig. */
  pressureHemispheres?: PressureHemisphereVisual
  /** Which current-magnetic rig this frame is; absent on every other scene. */
  currentRig?: CurrentRigKind
  /** Conductor of a straight-wire rig, drawn end-on. */
  currentWire?: CurrentWireVisual
  /** Concentric field circles around that conductor, innermost first. */
  currentFieldCircles?: readonly CurrentFieldCircleVisual[]
  /** Probes on those circles, primary first. */
  currentProbes?: readonly CurrentProbeVisual[]
  /** Coil of a solenoid rig. */
  currentCoil?: CurrentCoilVisual
  /** Core and armature of an electromagnet rig. */
  currentCore?: CurrentCoreVisual
  /** Rotor of a motor rig, seen end-on down its axis. */
  currentRotor?: MotorRotorVisual
  /** The ramp of a mechanical-energy rig. */
  energyRamp?: EnergyRampVisual
  /** The energy bar those energies stack into. */
  energyBar?: EnergyBarVisual
  /** The pinhole rig of a light-propagation scene. */
  lightRig?: LightRigVisual
  /** The refraction rig of a light-propagation scene. */
  lightRefraction?: LightRefractionVisual
  /** The two windings of a transformer scene. */
  transformerCoils?: readonly TransformerCoilVisual[]
  /** The core they share. */
  transformerCore?: TransformerCoreVisual
  /** The thermometer of a thermometer scene. */
  thermometer?: ThermometerVisual
  /** The source, listener and barrier of a noise scene. */
  noiseRig?: NoiseRigVisual
  /** Field lines of a solenoid rig: axial inside, looping outside. */
  currentFieldLines?: readonly CurrentFieldLineVisual[]
  /** The heated sample in its beaker (thermal domain). */
  thermalSample?: ThermalSampleVisual
  /** The thermometer reading the sample; gated by the `thermometer` observable. */
  thermalThermometer?: ThermalThermometerVisual
  /** The heat source under the beaker. */
  thermalHeater?: ThermalHeaterVisual
  /** Second sample on the comparison rig (水和油). */
  thermalComparisonSample?: ThermalSampleVisual
  /** Second thermometer on the comparison rig. */
  thermalComparisonThermometer?: ThermalThermometerVisual
  /** Second heater on the comparison rig. */
  thermalComparisonHeater?: ThermalHeaterVisual
  /** Class-1 lever beam (mechanics domain, lever runtime). */
  leverBeam?: LeverBeamVisual
  /** Fulcrum under the beam. */
  leverFulcrum?: LeverFulcrumVisual
  /** Hanging loads on opposite arms. */
  leverHangers?: readonly LeverHangerVisual[]
  /** Uniform field region of an induction bench. */
  inductionField?: InductionFieldVisual
  /** Conducting rod of a bar_motion rig at its swept position. */
  inductionBar?: InductionBarVisual
  /** The rail-loop closure resistor of a bar_motion rig. */
  inductionResistor?: InductionResistorVisual
  /** Rails and two bars of a double_bar_rail rig. */
  inductionRails?: readonly InductionRailVisual[]
  inductionPairBars?: readonly InductionPairBarVisual[]
  /** Magnetic force arrows on each bar; values come from the engine's BIL fact. */
  inductionForceArrows?: readonly InductionForceArrowVisual[]
  /** Coil of a flux_change rig. */
  inductionCoil?: InductionCoilVisual
  /** Current-direction arrow around the induction loop. */
  inductionCurrent?: InductionCurrentVisual
  /** Sampled rope / string profile (wave domain); gated by the `waveform` observable. */
  waveProfile?: WaveProfileVisual
  /** Marked rope particle of a travelling wave. */
  waveMarker?: WaveMarkerVisual
  /** The two coherent sources of an interference rig. */
  waveSources?: readonly WaveSourceVisual[]
  /** Observation point of an interference rig; gated by the `superposition` observable. */
  wavePoint?: WavePointVisual
  /** Nodes and antinodes of a standing wave; gated by the `nodes` observable. */
  waveNodes?: readonly WaveNodeVisual[]
  /** Standing-wave amplitude envelope. */
  waveEnvelope?: WaveEnvelopeVisual
  /** Circular crests spreading from the interference sources at this frame. */
  waveFronts?: readonly WaveFrontVisual[]
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
  /**
   * Engine precondition that failed, when the failure was a named one (e.g.
   * `single_voltage_source`). The shell localizes this; `message` stays the
   * engine's own wording, for cases no key covers.
   */
  condition?: string
  /** Conditions the parser did recognise, so the student is not stranded. */
  recognized?: readonly { label: string; value: string }[]
}
