/** Native filled-arc evidence, collected by the pre-script probe, never a DOM stamp. */
export interface DrawnBody {
  readonly source: 'canvas-2d-arc-fill'
  /** Probe-owned surface identity and fill ordinal, stable across sampled frames. */
  readonly surface: number
  readonly drawIndex: number
  /** Arguments of the actual world-coordinate arc, before its native Canvas CTM. */
  readonly x: number
  readonly y: number
  readonly transform: readonly [number, number, number, number, number, number]
  readonly pixelX: number
  readonly pixelY: number
  /** Pixels visibly changed by this fill and still present when sampled (5×5 patch). */
  readonly paintedPixels: number
}

/** Result shape produced inside the validation page and returned by the driver. */
export interface BrowserFrame {
  readonly time: number
  /** Revision of the V3 engine frame actually sent, not the scene metadata. */
  readonly revision?: number
  readonly engineBody?: { readonly x: number; readonly y: number }
  /** Legacy diagnostic only. Self-reported attributes are never acceptance evidence. */
  readonly stamped?: { readonly bodyX?: number; readonly bodyY?: number; readonly clockTime?: number }
  readonly drawnBodies?: readonly DrawnBody[]
  readonly paintHash: string
  readonly geometryCount: number
  readonly opaquePixels: number
  readonly distinctColors: number
}

export interface BrowserResult {
  ready: boolean
  firstFrameAcknowledged: boolean
  runtimeError?: string
  nativeSurface: boolean
  frames: BrowserFrame[]
  /** The parameter-change paint is subject to the same native geometry checks. */
  changedFrame?: BrowserFrame
  parameterChanged?: boolean
  changedPaintHash?: string
  originalPaintHash?: string
  mobile?: { readonly viewportWidth: number; readonly scrollWidth: number; readonly overflow: boolean }
}
