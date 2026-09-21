/**
 * Known-quantity → canvas highlight mapping.
 *
 * A Known in a solved question is a CONTROL, not a caption: clicking it lights
 * the matching primitive in the canvas, so the symbol in the text and the arrow
 * in the picture are the same object. Both Question Space and the conversation
 * scene card share this table — a second copy would drift the moment a bridge
 * renamed an id.
 *
 * Ids are the ones each domain's visual bridge actually emits:
 * `mechanics-visual-bridge.ts` for mechanics, `electric-visual-bridge.ts` for
 * electric, `physics-runtime-bridge.ts` for magnetic. A quantity with no drawn
 * counterpart (`B`, a mass in a point-particle scene, an elapsed time) is
 * deliberately absent — {@link highlightableIds} then returns an empty list
 * and the caller renders a plain row rather than a button that does nothing.
 */

import type { SceneVisualModel } from './physics/scene-visual-model.ts'

const MECHANICS_HIGHLIGHTS: Readonly<Record<string, readonly string[]>> = {
  h: ['launch-height'],
  height: ['launch-height'],
  v: ['velocity'],
  v0: ['velocity'],
  vx: ['velocity'],
  initial_velocity: ['velocity'],
  horizontal_speed: ['velocity'],
  final_velocity: ['velocity'],
  g: ['net-force', 'acceleration'],
  gravity: ['net-force', 'acceleration'],
  a: ['acceleration'],
  acceleration: ['acceleration'],
  θ: ['launch-angle', 'incline-angle'],
  theta: ['launch-angle', 'incline-angle'],
  launch_angle: ['launch-angle', 'incline-angle'],
  incline_angle: ['launch-angle', 'incline-angle'],
  R: ['range'],
  range: ['range'],
  H: ['apex'],
  max_height: ['apex'],
  t: ['impact'],
  flight_time: ['impact'],
  F: ['net-force'],
  N: ['net-force'],
  net_force: ['net-force'],
  normal_force: ['net-force'],
}

const ELECTRIC_HIGHLIGHTS: Readonly<Record<string, readonly string[]>> = {
  E: ['electric-field-vector'],
  electric_field_strength: ['electric-field-vector'],
  q: ['electric-force-vector'],
  charge: ['electric-force-vector'],
  F: ['electric-force-vector'],
  v: ['electric-velocity-vector'],
  v0: ['electric-velocity-vector'],
  initial_velocity: ['electric-velocity-vector'],
  a: ['electric-acceleration-vector'],
  /* Multi-source point-charge: each named source charge highlights its own
     sphere, and the sampling point highlights the probe. Separation (d) has no
     single drawable object so it stays a static known, which is honest. */
  q1: ['source-1'],
  q2: ['source-2'],
  source_charge_1: ['source-1'],
  source_charge_2: ['source-2'],
  P: ['probe-1'],
  sample_position: ['probe-1'],
}

const MAGNETIC_HIGHLIGHTS: Readonly<Record<string, readonly string[]>> = {
  v: ['v'],
  velocity: ['v'],
  F: ['F'],
  R: ['radius'],
}

const HIGHLIGHTS_BY_DOMAIN: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  mechanics: MECHANICS_HIGHLIGHTS,
  electric: ELECTRIC_HIGHLIGHTS,
  magnetic: MAGNETIC_HIGHLIGHTS,
}

/** Set equality for the drawn-id Selection summary (content, not reference). */
export const sameDrawnSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
  if (a.size !== b.size) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
}

/** Every id the current frame can actually light up. */
export const drawnIds = (view: SceneVisualModel | null): ReadonlySet<string> => {
  if (view === null) return new Set()
  return new Set([
    ...view.bodies.map(entry => entry.id),
    ...view.particles.map(entry => entry.id),
    ...view.vectors.map(entry => entry.id),
    ...view.dimensions.map(entry => entry.id),
    ...view.keyPoints.map(entry => entry.id),
    ...view.angles.map(entry => entry.id),
    ...view.guides.map(entry => entry.id),
    /* Point-charge primitives: the source sphere, streamlines and probe are the
       drawable objects of an electric point-charge frame, so a known-quantity
       highlight must be able to target them — mirroring the Agent's drawnVisualIds. */
    ...(view.pointChargeSources ?? []).map(entry => entry.id),
    ...(view.fieldStreamlines ?? []).map(entry => entry.id),
    ...(view.probe === undefined ? [] : [view.probe.id]),
  ])
}

/**
 * Ids a symbol may highlight, filtered against what is drawn. Returning an empty
 * list is the signal to render a caption instead of a button: a control that
 * changes nothing on screen teaches the student that clicking is pointless.
 */
export const highlightableIds = (
  symbols: readonly string[],
  domain: string | undefined,
  bodyId: string | undefined,
  drawn: ReadonlySet<string>,
): readonly string[] => {
  const table = domain === undefined ? undefined : HIGHLIGHTS_BY_DOMAIN[domain]
  const candidates = symbols.flatMap((symbol) => {
    /* A mass has no arrow — it is the body itself, whose id is scene-specific. */
    if (domain === 'mechanics' && (symbol === 'm' || symbol === 'mass')) {
      return bodyId === undefined ? [] : [bodyId]
    }
    return [...(table?.[symbol] ?? [])]
  })
  return [...new Set(candidates)].filter(id => drawn.has(id))
}
