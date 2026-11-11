export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject
export interface JsonObject { readonly [key: string]: JsonValue }
export interface ViewBox { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export type Point = readonly [number, number]
export interface SourceImage {
  readonly id: string
  readonly sha256: string
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  readonly width: number
  readonly height: number
  readonly byteLength: number
  readonly viewBox: ViewBox
}
export interface WhiteboardScene { readonly elements: readonly JsonObject[]; readonly appState: JsonObject }
export interface WhiteboardDocument {
  readonly schemaVersion: 1
  readonly id: string
  readonly title: string
  readonly scene: WhiteboardScene
  readonly sourceImages: readonly SourceImage[]
  readonly appliedGenerationIds: readonly string[]
  readonly history?: WhiteboardHistory
}
export interface PrimitiveStyle {
  readonly strokeColor?: string
  readonly backgroundColor?: string
  readonly strokeWidth?: number
  readonly strokeStyle?: 'solid' | 'dashed' | 'dotted'
}
interface PrimitiveBase { readonly id: string; readonly style?: PrimitiveStyle }
export type DrawingPrimitive = PrimitiveBase & (
  | { readonly type: 'line' | 'arrow'; readonly points: readonly [Point, Point] }
  | { readonly type: 'polyline'; readonly points: readonly Point[]; readonly closed?: boolean }
  | { readonly type: 'rectangle' | 'ellipse'; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly type: 'arc'; readonly cx: number; readonly cy: number; readonly radius: number; readonly startAngle: number; readonly endAngle: number }
  | { readonly type: 'text'; readonly x: number; readonly y: number; readonly text: string; readonly fontSize: number; readonly textAlign?: 'left' | 'center' | 'right' }
)
export interface DrawingUncertainty {
  readonly kind: 'illegible' | 'not-to-scale' | 'missing-measurement'
  readonly message: string
  readonly primitiveIds: readonly string[]
}
export interface DrawingDiagram {
  readonly schemaVersion: 1
  readonly sourceImageId: string
  readonly sourceImageSha256: string
  readonly viewBox: ViewBox
  readonly primitives: readonly DrawingPrimitive[]
  readonly uncertainties: readonly DrawingUncertainty[]
}
export interface ScenePatch {
  readonly upsert: readonly JsonObject[]
  readonly remove: readonly string[]
  readonly order: readonly string[]
  readonly appState: JsonObject
}
export interface SceneChange { readonly forward: ScenePatch; readonly backward: ScenePatch }
export interface WhiteboardHistory { readonly undo: readonly SceneChange[]; readonly redo: readonly SceneChange[] }
