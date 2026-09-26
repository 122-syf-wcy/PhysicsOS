/**
 * parts3d sprite catalog — the renderer-side copy of
 * `apps/web/public/physicsos/parts3d/manifest.json`, kept static so the canvas
 * never waits on a fetch to draw a part (same pattern as RASTER_ART for
 * experiment artwork).
 *
 * Studio sprites carry visually measured binding posts and control geometry in
 * normalized image coordinates. The renderer maps those posts onto the scene's
 * terminals; `solidBox` and `axis` remain the placement fallback for legacy art.
 *
 * Keep this table and the shipped manifest in parity, including measured
 * terminals, dial layout and slider rails. Old PNG files remain available.
 */
export interface Part3dEntry {
  /** File under `/physicsos/parts3d/`. */
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
  readonly axis: 'axial' | 'base'
  /** Rotate the image in-plane when photographed posts oppose scene polarity. */
  readonly terminalOrder?: 'reversed'
  readonly terminals?: {
    readonly a: { readonly x: number; readonly y: number }
    readonly b: { readonly x: number; readonly y: number }
  }
  readonly sliderRail?: {
    readonly start: { readonly x: number; readonly y: number }
    readonly end: { readonly x: number; readonly y: number }
  }
  /** Dial layout only; this catalog does not define a physical meter range. */
  readonly dial?: { readonly pivot: { readonly x: number; readonly y: number }; readonly radius: number }
}

/**
 * The parts3d catalog helper `PARTS3D`.
 */
export const PARTS3D: Readonly<Record<string, Part3dEntry>> = {
  ammeter: {
    file: 'ammeter.png',
    pixels: { w: 389, h: 414 },
    solidBox: { left: 0.0591, top: 0.0338, width: 0.8817, height: 0.9275 },
    axis: 'base',
  },
  battery: {
    file: 'studio-v2/battery.png',
    pixels: { w: 574, h: 203 },
    solidBox: { left: 0.053886, top: 0.152493, width: 0.892228, height: 0.692082 },
    axis: 'axial',
    terminalOrder: 'reversed',
    terminals: { a: { x: 0.121244, y: 0.501466 }, b: { x: 0.878756, y: 0.501466 } },
  },
  'lamp-off': {
    file: 'lamp-off.png',
    pixels: { w: 262, h: 430 },
    solidBox: { left: 0.0878, top: 0.0535, width: 0.8244, height: 0.893 },
    axis: 'base',
  },
  'lamp-on': {
    file: 'lamp-on.png',
    pixels: { w: 269, h: 428 },
    solidBox: { left: 0.0855, top: 0.0491, width: 0.829, height: 0.8972 },
    axis: 'base',
  },
  resistor: {
    file: 'studio-v2/resistor.png',
    pixels: { w: 573, h: 197 },
    solidBox: { left: 0.054255, top: 0.157407, width: 0.892553, height: 0.685185 },
    axis: 'axial',
    terminals: { a: { x: 0.145745, y: 0.496914 }, b: { x: 0.854255, y: 0.496914 } },
  },
  rheostat: {
    file: 'studio-v2/rheostat.png',
    pixels: { w: 574, h: 210 },
    solidBox: { left: 0.054672, top: 0.146341, width: 0.890656, height: 0.704607 },
    axis: 'axial',
    terminals: { a: { x: 0.094433, y: 0.506775 }, b: { x: 0.904573, y: 0.506775 } },
    sliderRail: { start: { x: 0.203777, y: 0.205962 }, end: { x: 0.795229, y: 0.205962 } },
  },
  'switch-closed': {
    file: 'studio-v2/switch-closed.png',
    pixels: { w: 573, h: 304 },
    solidBox: { left: 0.054526, top: 0.277207, width: 0.890949, height: 0.61807 },
    axis: 'axial',
    terminals: { a: { x: 0.114504, y: 0.587269 }, b: { x: 0.883315, y: 0.587269 } },
  },
  'switch-open': {
    file: 'studio-v2/switch-open.png',
    pixels: { w: 573, h: 304 },
    solidBox: { left: 0.054526, top: 0.102669, width: 0.890949, height: 0.794661 },
    axis: 'axial',
    terminals: { a: { x: 0.114504, y: 0.587269 }, b: { x: 0.883315, y: 0.587269 } },
  },
  terminal: {
    file: 'terminal.png',
    pixels: { w: 224, h: 430 },
    solidBox: { left: 0.1027, top: 0.0535, width: 0.7946, height: 0.893 },
    axis: 'base',
  },
  voltmeter: {
    file: 'voltmeter.png',
    pixels: { w: 407, h: 430 },
    solidBox: { left: 0.0565, top: 0.0535, width: 0.8858, height: 0.893 },
    axis: 'base',
  },
  meter: {
    file: 'studio-v2/meter.png',
    pixels: { w: 574, h: 282 },
    solidBox: { left: 0.055118, top: 0.112128, width: 0.889764, height: 0.775744 },
    axis: 'axial',
    terminals: { a: { x: 0.138358, y: 0.494279 }, b: { x: 0.867267, y: 0.494279 } },
    dial: { pivot: { x: 0.499438, y: 0.757437 }, radius: 0.256468 },
  },
  'rheostat-knob': {
    file: 'studio-v2/rheostat-knob.png',
    pixels: { w: 113, h: 215 },
    solidBox: { left: 0.107477, top: 0.054054, width: 0.78972, height: 0.889435 },
    axis: 'axial',
  },
  /* studio-v3 批次：同一种元件的不同规格，做成看得出区别的实物，器材栏才像一
     张真实的器材盘。全部落在引擎已有的 6 种元件类型内。 */
  'battery-pack': {
    file: 'studio-v3/battery-pack.png',
    pixels: { w: 418, h: 138 },
    solidBox: { left: 0.041, top: 0.1656, width: 0.9187, height: 0.6713 },
    axis: 'axial',
    terminalOrder: 'reversed',
    terminals: { a: { x: 0.07084, y: 0.492351 }, b: { x: 0.928038, y: 0.493043 } },
  },
  'cell-aa': {
    file: 'studio-v3/cell-aa.png',
    pixels: { w: 405, h: 84 },
    solidBox: { left: 0.0264, top: 0.2733, width: 0.9481, height: 0.4571 },
    axis: 'axial',
    terminalOrder: 'reversed',
    terminals: { a: { x: 0.038441, y: 0.517507 }, b: { x: 0.959392, y: 0.511692 } },
  },
  'resistor-5': {
    file: 'studio-v3/resistor-5.png',
    pixels: { w: 428, h: 148 },
    solidBox: { left: 0.0508, top: 0.1554, width: 0.8972, height: 0.6868 },
    axis: 'axial',
    terminals: { a: { x: 0.079174, y: 0.48491 }, b: { x: 0.91618, y: 0.480619 } },
  },
  'resistor-50': {
    file: 'studio-v3/resistor-50.png',
    pixels: { w: 430, h: 137 },
    solidBox: { left: 0.0531, top: 0.1667, width: 0.893, height: 0.6668 },
    axis: 'axial',
    terminals: { a: { x: 0.067406, y: 0.458485 }, b: { x: 0.926594, y: 0.462337 } },
  },
  'rheostat-50': {
    file: 'studio-v3/rheostat-50.png',
    pixels: { w: 411, h: 135 },
    solidBox: { left: 0.0342, top: 0.1696, width: 0.9343, height: 0.6605 },
    axis: 'axial',
    terminals: { a: { x: 0.04335, y: 0.529383 }, b: { x: 0.956073, y: 0.548949 } },
    sliderRail: { start: { x: 0.055961, y: 0.362963 }, end: { x: 0.944039, y: 0.362963 } },
  },
  'supply-dc': {
    file: 'studio-v3/supply-dc.png',
    pixels: { w: 429, h: 179 },
    solidBox: { left: 0.0528, top: 0.1265, width: 0.8951, height: 0.7494 },
    axis: 'axial',
    terminalOrder: 'reversed',
    terminals: { a: { x: 0.097115, y: 0.496376 }, b: { x: 0.905684, y: 0.478298 } },
  },
  'switch-button': {
    file: 'studio-v3/switch-button.png',
    pixels: { w: 429, h: 335 },
    solidBox: { left: 0.0531, top: 0.0679, width: 0.8951, height: 0.8632 },
    axis: 'axial',
  },
}

/**
 * The parts3d catalog helper `part3dUrl`.
 * @returns the formatted string.
 * @param part - the catalog part to place.
 */
export const part3dUrl = (part: Part3dEntry): string => `/physicsos/parts3d/${part.file}`
