/**
 * parts3d mechanics sprite catalog — the renderer-side copy of
 * `apps/web/public/physicsos/parts3d/mechanics/manifest.json`, kept static so
 * the canvas never waits on a fetch to draw a body.
 *
 * Unlike the circuit parts, these are strict side-elevation rigs: no binding
 * posts, no dials. Placement is driven by an anchor the photograph itself
 * carries in normalized image coordinates:
 *
 * - `anchorPoint` is the point that must land on the scene position. For a
 *   `ball` it is the drawn centre (paired with `radius`, the ball's outline
 *   radius normalized over the image width). For `block`/`cart`/`weight-hook`
 *   it is the bottom-centre contact point — the spot that touches the track.
 * - `anchorLine` is the plank's top surface: the renderer scales and rotates
 *   the image so that segment lies exactly on the incline's hypotenuse.
 *
 * Keep this table and the shipped manifest in parity; the parity test in
 * `mechanics-parts3d.client.spec.ts` is the guard.
 */

export interface MechanicsPart3dEntry {
  /** File under `/physicsos/parts3d/mechanics/`. */
  readonly file: string
  /** Cropped sprite size in pixels. */
  readonly pixels: { readonly w: number; readonly h: number }
  /** Solid-body box, normalized 0..1 over the cropped file. */
  readonly solidBox: {
    readonly left: number
    readonly top: number
    readonly width: number
    readonly height: number
  }
  readonly anchorKind: 'point' | 'line'
  readonly anchorPoint?: { readonly x: number; readonly y: number }
  readonly anchorLine?: {
    readonly a: { readonly x: number; readonly y: number }
    readonly b: { readonly x: number; readonly y: number }
  }
  /** Outline radius normalized over image width (balls only). */
  readonly radius?: number
}

/**
 * The parts3d mechanics catalog helper `MECHANICS_PARTS3D`.
 */
export const MECHANICS_PARTS3D: Readonly<Record<string, MechanicsPart3dEntry>> = {
  ball: {
    file: 'ball.png',
    pixels: { w: 421, h: 429 },
    solidBox: { left: 0.0532, top: 0.0523, width: 0.8932, height: 0.8951 },
    anchorKind: 'point',
    anchorPoint: { x: 0.497625, y: 0.5 },
    radius: 0.445368,
  },
  block: {
    file: 'block.png',
    pixels: { w: 430, h: 181 },
    solidBox: { left: 0.0532, top: 0.1263, width: 0.893, height: 0.7476 },
    anchorKind: 'point',
    anchorPoint: { x: 0.498837, y: 0.867403 },
  },
  cart: {
    file: 'cart.png',
    pixels: { w: 426, h: 173 },
    solidBox: { left: 0.0498, top: 0.1323, width: 0.9014, height: 0.7359 },
    anchorKind: 'point',
    anchorPoint: { x: 0.5, y: 0.861272 },
  },
  plank: {
    file: 'plank.png',
    pixels: { w: 415, h: 111 },
    solidBox: { left: 0.0371, top: 0.2044, width: 0.9253, height: 0.5912 },
    anchorKind: 'line',
    anchorLine: { a: { x: 0.038554, y: 0.405405 }, b: { x: 0.959036, y: 0.405405 } },
  },
  'weight-hook': {
    file: 'weight-hook.png',
    pixels: { w: 171, h: 430 },
    solidBox: { left: 0.1335, top: 0.0531, width: 0.731, height: 0.893 },
    anchorKind: 'point',
    anchorPoint: { x: 0.494152, y: 0.944186 },
  },
  'spring-scale': {
    file: 'spring-scale.png',
    pixels: { w: 413, h: 100 },
    solidBox: { left: 0.0335, top: 0.2272, width: 0.9298, height: 0.55 },
    anchorKind: 'point',
    anchorPoint: { x: 0.9613, y: 0.51 },
  },
  'support-clamp': {
    file: 'support-clamp.png',
    pixels: { w: 164, h: 407 },
    solidBox: { left: 0.1391, top: 0, width: 0.7191, height: 0.9435 },
    anchorKind: 'point',
    anchorPoint: { x: 0.326, y: 0.91 },
  },
  'protractor': {
    file: 'protractor.png',
    pixels: { w: 430, h: 178 },
    solidBox: { left: 0.0535, top: 0.1292, width: 0.8907, height: 0.8652 },
    anchorKind: 'point',
    anchorPoint: { x: 0.499, y: 0.129 },
  },
  'track-rail': {
    file: 'track-rail.png',
    pixels: { w: 406, h: 134 },
    solidBox: { left: 0.0271, top: 0.1716, width: 0.9433, height: 0.6493 },
    anchorKind: 'point',
    anchorPoint: { x: 0.5, y: 0.388 },
  },
  'ruler-vertical': {
    file: 'ruler-vertical.png',
    pixels: { w: 64, h: 424 },
    solidBox: { left: 0.3594, top: 0.0472, width: 0.2656, height: 0.9033 },
    anchorKind: 'point',
    anchorPoint: { x: 0.49, y: 0.047 },
  },
}

const PARTS3D_BASE = '/physicsos/parts3d/mechanics'

/**
 * Public URL for a mechanics sprite file.
 * @returns the formatted string.
 * @param entry - the entry.
 */
export const mechanicsPart3dUrl = (entry: MechanicsPart3dEntry): string =>
  `${PARTS3D_BASE}/${entry.file}`
