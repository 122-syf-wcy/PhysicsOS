/** Result shape produced inside the validation page and returned by the driver. */
export interface BrowserFrame {
  readonly time: number
  readonly engineBody?: { readonly x: number; readonly y: number }
  readonly stamped?: { readonly bodyX?: number; readonly bodyY?: number; readonly clockTime?: number }
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
  parameterChanged?: boolean
  changedPaintHash?: string
  originalPaintHash?: string
  mobile?: { readonly viewportWidth: number; readonly scrollWidth: number; readonly overflow: boolean }
}
