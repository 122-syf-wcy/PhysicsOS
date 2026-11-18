/** Native filled-arc evidence, collected by the pre-script probe, never a DOM stamp. */
export interface DrawnBody {
  readonly source: 'canvas-2d-arc-fill'
  /** Probe-owned surface identity and fill ordinal, stable across sampled frames. */
  readonly surface: number
  readonly drawIndex: number
  /** Arguments of the actual arc, before its native Canvas CTM. */
  readonly x: number
  readonly y: number
  readonly transform: readonly [number, number, number, number, number, number]
  readonly pixelX: number
  readonly pixelY: number
  /** Surviving changed pixels in the central 5×5 patch; an overlay can erase it. */
  readonly paintedPixels: number
  /** Surviving, changed non-central 3×3 interior witnesses (at least two suffice). */
  readonly paintedPatches?: number
}

/** Independent native horizontal-line evidence; never fitted to a body position. */
export interface DrawnGround {
  readonly source: 'canvas-2d-line-stroke'
  readonly surface: number
  readonly strokeIndex: number
  readonly from: { readonly x: number; readonly y: number }
  readonly to: { readonly x: number; readonly y: number }
  readonly transform: readonly [number, number, number, number, number, number]
  readonly pixelFrom: { readonly x: number; readonly y: number }
  readonly pixelTo: { readonly x: number; readonly y: number }
  readonly paintedPatches: number
}

/** Native solid single-segment evidence, independent of any engine snapshot. */
export interface DrawnSegment {
  readonly source: 'canvas-2d-segment-stroke'
  readonly surface: number
  readonly strokeIndex: number
  readonly from: { readonly x: number; readonly y: number }
  readonly to: { readonly x: number; readonly y: number }
  readonly transform: readonly [number, number, number, number, number, number]
  readonly pixelFrom: { readonly x: number; readonly y: number }
  readonly pixelTo: { readonly x: number; readonly y: number }
  readonly paintedPatches: number
}

/** A native closed three-vertex fill with surviving interior pixel witnesses. */
export interface DrawnTriangle {
  readonly source: 'canvas-2d-triangle-fill'
  readonly surface: number
  readonly drawIndex: number
  readonly points: readonly { readonly x: number; readonly y: number }[]
  readonly transform: readonly [number, number, number, number, number, number]
  readonly pixelPoints: readonly { readonly x: number; readonly y: number }[]
  readonly paintedPatches: number
}

/** Native fillText ink, not DOM text or a renderer's semantic stamp. */
export interface DrawnText {
  readonly source: 'canvas-2d-text-fill'
  readonly surface: number
  readonly text: string
  readonly paintedPixels: number
  readonly inkHeight: number
}

/** Native backing-to-visible size: static evidence must not pass CSS distortion. */
export interface DrawnSurface {
  readonly source: 'canvas-2d-surface'
  readonly surface: number
  readonly width: number
  readonly height: number
  readonly displayWidth: number
  readonly displayHeight: number
}

/** Detached facts from the verified optics workspace snapshot, never supplied to the probe. */
export interface StaticOpticsFacts {
  readonly object: { readonly id: string; readonly at: { readonly x: number; readonly y: number }; readonly height: number; readonly label: string }
  readonly element: { readonly id: string; readonly kind: 'thin_lens'; readonly at: { readonly x: number; readonly y: number }; readonly halfAperture: number; readonly label: string }
  readonly image: { readonly id: string; readonly at: { readonly x: number; readonly y: number }; readonly height: number; readonly nature: 'real'; readonly label: string }
  readonly rays: readonly { readonly id: string; readonly kind: 'parallel' | 'central' | 'focal'; readonly points: readonly { readonly x: number; readonly y: number }[] }[]
  readonly screens: readonly { readonly id: string; readonly at: { readonly x: number; readonly y: number }; readonly halfHeight: number; readonly lit: boolean; readonly label: string }[]
  readonly marks: readonly { readonly id: string; readonly at: { readonly x: number; readonly y: number }; readonly label: string }[]
  readonly axis: { readonly from: number; readonly to: number; readonly y: number }
  readonly heightParameter: { readonly id: 'object-height'; readonly label: '物高'; readonly unit: 'cm'; readonly value: number; readonly min: 0.5; readonly step: 0.5 }
  readonly semanticText: readonly string[]
}

export interface ParameterControlEvidence {
  readonly id: string
  readonly from: number
  readonly to: number
  readonly nativeContract: boolean
  readonly intentMatched: boolean
}

/** Result shape produced inside the validation page and returned by the driver. */
export interface BrowserFrame {
  readonly time: number
  /** Revision of the V3 engine frame actually sent, not the scene metadata. */
  readonly revision?: number
  readonly engineBody?: { readonly x: number; readonly y: number }
  readonly engineGround?: { readonly from: number; readonly to: number; readonly y: number }
  readonly drawnGrounds?: readonly DrawnGround[]
  /** Actual SecurityError from native pixel readback; never a renderer report. */
  readonly taintedSurfaces?: number
  /** Legacy diagnostic only. Self-reported attributes are never acceptance evidence. */
  readonly stamped?: { readonly bodyX?: number; readonly bodyY?: number; readonly clockTime?: number }
  readonly drawnBodies?: readonly DrawnBody[]
  readonly drawnSegments?: readonly DrawnSegment[]
  readonly drawnTriangles?: readonly DrawnTriangle[]
  readonly drawnTexts?: readonly DrawnText[]
  readonly drawnSurfaces?: readonly DrawnSurface[]
  readonly optics?: StaticOpticsFacts
  readonly snapshotSha256?: string
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
  /** Static profiles re-observe the exact last engine state after native resize. */
  mobileFrame?: BrowserFrame
  parameterControl?: ParameterControlEvidence
  parameterChanged?: boolean
  changedPaintHash?: string
  originalPaintHash?: string
  mobile?: { readonly viewportWidth: number; readonly scrollWidth: number; readonly overflow: boolean }
}
