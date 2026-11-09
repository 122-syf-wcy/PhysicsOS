import type {
  QuantityVector,
  SimulationRequest,
  SimulationResult,
  SimulationState,
} from '@physicsos/physics-core'
import type { PhysicsScene, TimelineState } from '@physicsos/physics-scene'
import type { PhysicalDimension, Quantity } from '@physicsos/physics-units'

export const WORKBENCH_SCHEMA_VERSION = 1 as const
export const CANVAS_FILE_FORMAT = 'physicsos-canvas' as const

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[]
export interface JsonObject { readonly [key: string]: JsonValue }

/** Lower-case SHA256 of the canonical UTF-8 content, supplied by the storage caller. */
export type Digest = string
export type ObjectKind = 'scene' | 'snapshot' | 'dataset' | 'history'
export interface ObjectRef<K extends ObjectKind = ObjectKind> {
  readonly kind: K
  readonly digest: Digest
}

export type SupportedSceneDomain =
  | 'magnetic' | 'mechanics' | 'electric' | 'circuit' | 'composite' | 'optics'
  | 'acoustics' | 'fluid' | 'thermal' | 'induction' | 'wave' | 'modern'
export type BuildMode = 'inspect' | 'construct'
export type InstanceSourceKind =
  | 'template' | 'question' | 'community' | 'question-code' | 'import' | 'free-build'

/** Uses the scene contract, including legacy community releases without a kind. */
export type RendererReleaseIdentity = NonNullable<PhysicsScene['metadata']['experimentRelease']>
export interface TemplateReleaseIdentity {
  readonly id: string
  readonly version: string
  readonly digest?: Digest
}
export interface InstanceSource {
  readonly kind: InstanceSourceKind
  readonly id?: string
  readonly title?: string
  readonly url?: string
  readonly questionId?: string
  readonly artifactId?: string
  readonly release?: RendererReleaseIdentity
  readonly metadata?: JsonObject
}

/** Seconds in SI. A static or not-yet-solved instance has total=0 and running=false. */
export interface WorkbenchClock {
  readonly time: number
  readonly total: number
  readonly running: boolean
  readonly rate: number
}
export type CaptureCursor =
  | { readonly kind: 'time'; readonly time: Quantity<'time'> }
  | { readonly kind: 'parameter' | 'space'; readonly axisId: string; readonly value: Quantity }
  | { readonly kind: 'static'; readonly identity: string }

/** Editable instance identity is independent of template, scene, and stored-result identity. */
export interface ExperimentInstance {
  readonly instanceId: string
  readonly currentScene: ObjectRef<'scene'>
  readonly originScene: ObjectRef<'scene'>
  readonly templateId?: string
  readonly domain: SupportedSceneDomain
  readonly source: InstanceSource
  readonly buildMode: BuildMode
  readonly clock: WorkbenchClock
  readonly instanceEditRevision: number
  readonly templateRelease?: TemplateReleaseIdentity
  readonly rendererRelease?: RendererReleaseIdentity
  readonly metadata?: JsonObject
}
export type WorkbenchInstance = ExperimentInstance

export interface CanvasViewport {
  readonly x: number
  readonly y: number
  readonly zoom: number
}
export interface CanvasLayout {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly zIndex: number
}
export interface CanvasNodeBase {
  readonly id: string
  readonly title?: string
  readonly layout: CanvasLayout
  /** A single parent group; group membership is never inferred from visual overlap. */
  readonly groupId?: string
  readonly locked?: boolean
  readonly metadata?: JsonObject
}
export type CanvasNode =
  | (CanvasNodeBase & { readonly kind: 'experiment'; readonly instanceId: string })
  | (CanvasNodeBase & {
      readonly kind: 'result'
      readonly snapshotAliasId: string
      readonly view?: 'scene' | 'table' | 'chart' | 'summary'
      readonly metricIds?: readonly string[]
    })
  | (CanvasNodeBase & { readonly kind: 'note'; readonly body: string; readonly format: 'plain' | 'markdown' })
  | (CanvasNodeBase & { readonly kind: 'comparison'; readonly comparisonId: string })
  | (CanvasNodeBase & { readonly kind: 'group'; readonly collapsed: boolean })
export interface CanvasEdge {
  readonly id: string
  readonly kind: 'relation' | 'sequence' | 'comparison'
  readonly from: string
  readonly to: string
  readonly label?: string
  readonly metadata?: JsonObject
}

/** Renaming this alias does not alter a captured payload or its digest. */
export interface SnapshotAlias {
  readonly id: string
  readonly title: string
  readonly snapshot: ObjectRef<'snapshot'>
  /** Optional association with a current instance; the historical payload keeps its original identity. */
  readonly instanceId?: string
  readonly metadata?: JsonObject
}
export interface ComparisonMember {
  readonly id: string
  readonly snapshotAliasId: string
  readonly dataset: ObjectRef<'dataset'>
  readonly metricId: string
  readonly axisId?: string
  readonly label?: string
}
export interface ComparisonConfig {
  readonly id: string
  readonly title?: string
  readonly members: readonly ComparisonMember[]
  readonly mode: 'overlay' | 'difference' | 'conditions'
  readonly alignment: 'native' | 'exact-coordinate'
  readonly targetUnit?: string
  readonly axisUnit?: string
  /** Explicit physical-role bindings across different instance-local target IDs. */
  readonly targetBindings?: Readonly<Record<string, string>>
  readonly metadata?: JsonObject
}

/** The working document. schemaVersion is a format version, never a server CAS version. */
export interface CanvasManifest {
  readonly schemaVersion: 1
  readonly id: string
  readonly title: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly viewport: CanvasViewport
  readonly nodes: readonly CanvasNode[]
  readonly edges: readonly CanvasEdge[]
  readonly instances: readonly ExperimentInstance[]
  readonly snapshots: readonly SnapshotAlias[]
  readonly comparisons: readonly ComparisonConfig[]
  readonly history?: ObjectRef<'history'>
  readonly metadata?: JsonObject
}

export interface EngineIdentity {
  readonly id: string
  readonly version: string
  readonly model?: string
  readonly release?: RendererReleaseIdentity
}

/** Object constructors and parsers defensively copy and recursively freeze their content. */
export interface SceneObject {
  readonly schemaVersion: 1
  readonly kind: 'scene'
  readonly scene: PhysicsScene
}
export type CaptureSource = 'client-engine' | 'server-engine' | 'imported'
export interface SnapshotObject {
  readonly schemaVersion: 1
  readonly kind: 'snapshot'
  readonly scene: ObjectRef<'scene'>
  readonly instanceId: string
  readonly capturedAt: string
  readonly sceneRevision: number
  readonly instanceEditRevision: number
  /** Provenance only. Server certification is a separate, server-owned verification receipt. */
  readonly source: CaptureSource
  readonly engine: EngineIdentity
  readonly request?: SimulationRequest
  readonly result?: SimulationResult
  readonly capturedState?: SimulationState
  /** Domain-specific phase, immersion, rotation, and comparison state; validated plain JSON only. */
  readonly rawState?: JsonObject
  readonly clock: WorkbenchClock
  readonly cursor: CaptureCursor
  readonly datasets: readonly ObjectRef<'dataset'>[]
  readonly diagnostics: readonly JsonObject[]
  readonly metadata?: JsonObject
}

export interface QuantityReference {
  /** A physical zero/reference identity, not a localized label. */
  readonly identity: string
  readonly value: Quantity
}
export type MetricScale =
  | { readonly kind: 'linear' }
  | { readonly kind: 'temperature-absolute' }
  | { readonly kind: 'temperature-difference' }
  | {
      readonly kind: 'logarithmic'
      readonly base: number
      readonly factor: number
      readonly reference: QuantityReference
    }
  | { readonly kind: 'unresolved'; readonly reason: string }
export type MetricComponent = 'scalar' | 'x' | 'y' | 'z' | 'magnitude'
export interface MetricSemantics {
  readonly semanticKey: string
  readonly scale: MetricScale
  readonly reference?: QuantityReference
}
export interface MetricDescriptor extends MetricSemantics {
  readonly id: string
  readonly targetId?: string
  readonly component: MetricComponent
  readonly dimension: PhysicalDimension
  readonly unit: string
}
export interface AxisDescriptor {
  readonly id: string
  readonly kind: 'time' | 'parameter' | 'space' | 'static'
  /** Identifies the actual independent variable, not the chart orientation. */
  readonly identity: string
  readonly dimension: PhysicalDimension
  readonly unit: string
  readonly origin: {
    readonly kind: 'absolute' | 'relative'
    readonly value: Quantity
    readonly reference: string
  }
}
export interface MissingValue {
  readonly missing: string
  readonly details?: JsonObject
}
export type DataValue = number | MissingValue
export interface DatasetRow {
  readonly rowId: string
  readonly axes: Readonly<Record<string, DataValue>>
  readonly values: Readonly<Record<string, DataValue>>
  /** Formula, assumptions, confidence, measurement provenance, and other raw row evidence. */
  readonly evidence?: JsonObject
}
export interface ConditionValue {
  readonly semanticKey: string
  readonly targetId?: string
  readonly value: Quantity | QuantityVector | JsonPrimitive
  readonly scale?: MetricScale
  readonly reference?: QuantityReference
}
export interface DatasetOrigin {
  readonly sceneId: string
  readonly sceneRevision: number
  readonly simulationId?: string
  readonly collection: 'states' | 'measurements' | 'derived' | 'analysis' | 'captured-state'
  readonly analysisId?: string
}
export interface DatasetObject {
  readonly schemaVersion: 1
  readonly kind: 'dataset'
  readonly id: string
  /** Direct scene dependency; a dataset never points back to its containing snapshot. */
  readonly sourceScene: ObjectRef<'scene'>
  readonly axes: readonly AxisDescriptor[]
  readonly metrics: readonly MetricDescriptor[]
  readonly rows: readonly DatasetRow[]
  readonly conditions: readonly ConditionValue[]
  readonly origin: DatasetOrigin
  readonly metadata?: JsonObject
}
/** The exact dataset contract before a runtime has a content-addressed scene object. */
export type AnalysisDataset = Omit<DatasetObject, 'sourceScene'>
export type RuntimeDataset = AnalysisDataset

export interface HistoryEntry {
  readonly id: string
  readonly instanceId?: string
  readonly scene?: ObjectRef<'scene'>
  readonly snapshot?: ObjectRef<'snapshot'>
  readonly at: string
  readonly operation: 'create' | 'edit' | 'capture' | 'restore-origin' | 'clone' | 'import' | 'remove' | 'merge'
  readonly details?: JsonObject
}
export interface HistoryObject {
  readonly schemaVersion: 1
  readonly kind: 'history'
  readonly parents: readonly ObjectRef<'history'>[]
  readonly entries: readonly HistoryEntry[]
}
export type WorkbenchObject = SceneObject | SnapshotObject | DatasetObject | HistoryObject
export type CanvasStoredValue = CanvasManifest | WorkbenchObject

/** A complete portable dependency closure. Digests are checked by the caller's SHA256 implementation. */
export interface CanvasGraph {
  readonly schemaVersion: 1
  readonly manifest: CanvasManifest
  readonly objects: Readonly<Record<Digest, WorkbenchObject>>
}
export interface CanvasFile extends CanvasGraph {
  readonly format: typeof CANVAS_FILE_FORMAT
  readonly exportedAt: string
}
export interface ParseIssue {
  readonly path: string
  readonly code: string
  readonly message: string
}
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ParseIssue[] }

/** Raw data owned by a runtime; no renderer tables, callbacks, engine instances, or React values. */
export interface CapturedResult {
  readonly scene: PhysicsScene
  readonly request?: SimulationRequest
  readonly result?: SimulationResult
  readonly state?: SimulationState
  readonly rawState?: JsonObject
  readonly clock: WorkbenchClock
  readonly cursor: CaptureCursor
  /** Unhashed runtime analyses gain their source-scene reference during capture publication. */
  readonly analysis?: readonly AnalysisDataset[]
  readonly engineInfo: EngineIdentity
  readonly diagnostics?: readonly JsonObject[]
  readonly conditions?: readonly ConditionValue[]
  /** Explicit semantics for raw domain keys whose scale cannot be inferred from dimension. */
  readonly metricSemantics?: Readonly<Record<string, MetricSemantics>>
}
/** A detached JSON-safe capture. Publication never changes source authority. */
export type PublicCapturedResult = CapturedResult
export interface CreateSnapshotObjectInput extends CapturedResult {
  readonly sceneRef: ObjectRef<'scene'>
  readonly instanceId: string
  readonly instanceEditRevision: number
  readonly capturedAt: string
  readonly source: CaptureSource
  readonly datasets: readonly ObjectRef<'dataset'>[]
  readonly metadata?: JsonObject
}
export interface DatasetExtractionOptions {
  readonly sourceScene: ObjectRef<'scene'>
  readonly cursor?: CaptureCursor
  /** Keys use the raw derived key, object value key, or measurement definition/id. */
  readonly metricSemantics?: Readonly<Record<string, MetricSemantics>>
  readonly conditions?: readonly ConditionValue[]
}
export interface CloneGraphOptions {
  readonly id: (kind: 'canvas' | 'instance' | 'scene' | 'node' | 'edge' | 'snapshot-alias' | 'comparison' | 'comparison-member', oldId: string) => string
  readonly hash: (canonicalJson: string) => Digest | Promise<Digest>
  readonly title?: string
  readonly now?: string
  readonly limits?: Partial<import('./graph.ts').GraphLimits>
  /** Only a trusted server copy retains server publication provenance in a new document. */
  readonly preserveServerAuthority?: boolean
}
export interface CloneGraphResult {
  readonly graph: CanvasGraph
  /** Keys are kind + '/' + old identity; scene keys additionally contain the owning instance. */
  readonly ids: Readonly<Record<string, string>>
  /** Only unambiguous mappings are present; one source scene can produce several owned clones. */
  readonly digests: Readonly<Record<Digest, Digest>>
  readonly instanceScenes?: Readonly<Record<string, {
    readonly currentScene: ObjectRef<'scene'>
    readonly originScene: ObjectRef<'scene'>
  }>>
}
export interface MergeConflict {
  readonly path: string
  readonly kind: 'value' | 'delete-modify' | 'concurrent-add' | 'identity' | 'invalid-reference'
  readonly base?: JsonValue
  readonly local?: JsonValue
  readonly remote?: JsonValue
  readonly message: string
}
export type MergeResult =
  | { readonly ok: true; readonly manifest: CanvasManifest; readonly conflicts: readonly [] }
  | { readonly ok: false; readonly conflicts: readonly MergeConflict[] }

export interface CompatibilityResult {
  readonly compatible: boolean
  readonly reasons: readonly string[]
}
export interface PreparedSeries {
  readonly memberId: string
  readonly datasetId: string
  readonly metric: MetricDescriptor
  readonly axis?: AxisDescriptor
  readonly points: readonly {
    readonly rowId: string
    readonly coordinate?: DataValue
    readonly value: DataValue
    readonly evidence?: JsonObject
  }[]
}
export interface ComparisonPreparation {
  readonly compatible: boolean
  readonly reasons: readonly string[]
  readonly series: readonly PreparedSeries[]
}
export interface DifferencePoint {
  readonly leftRowId: string
  readonly rightRowId?: string
  readonly coordinate?: DataValue
  readonly value: DataValue
}
export interface DifferenceResult {
  readonly compatible: boolean
  readonly reasons: readonly string[]
  readonly metric?: MetricDescriptor
  readonly points: readonly DifferencePoint[]
}
export interface ConditionComparison {
  readonly semanticKey: string
  readonly targetId?: string
  readonly left?: ConditionValue
  readonly right?: ConditionValue
  readonly status: 'equal' | 'different' | 'missing-left' | 'missing-right' | 'incompatible'
  readonly difference?: Quantity | QuantityVector
  readonly reasons: readonly string[]
}

/** TimelineState is reused rather than interpreting a presentation label as a runtime state. */
export type InstanceTimelineState = TimelineState
