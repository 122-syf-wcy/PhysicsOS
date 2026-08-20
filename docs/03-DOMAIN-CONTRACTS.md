# PhysicsOS 核心领域契约

> 文件：`docs/03-DOMAIN-CONTRACTS.md`  
> 文档定位：PhysicsOS 跨模块核心 Contract / Schema 总规范  
> 上游文档：`00-PRODUCT-OVERVIEW.md`、`01-DEVELOPMENT-GUIDE.md`、`02-ENGINEERING-STANDARDS.md`
>
> 本文档定义 PhysicsOS 中跨应用、跨 package、跨服务、跨语言共享的数据契约。
>
> **Contract 的稳定性高于单个模块内部实现。**

---

# 1. 文档目标

本文档回答一个问题：

> **PhysicsOS 的不同模块之间究竟使用什么数据结构进行协作？**

PhysicsOS 包含：

```text
Web UI
PhysicsScene Runtime
Physics Engine
Observation Runtime
Renderer
Question Parser
Diagram Parser
Agent Runtime
DeepSeek Harness Adapter
Spring Boot API
Python Math Runtime
未来 Tauri Desktop
```

这些模块不能各自定义一套对象。

必须共享统一 Contract。

---

# 2. Contract First

跨模块功能开发必须遵守：

```text
先定义 Contract
↓
定义 Schema
↓
写 Contract Test
↓
实现 Producer
↓
实现 Consumer
```

禁止：

```text
前端先写一个 JSON
后端再猜字段
Agent 又返回另一套结构
```

---

# 3. Contract 表达形式

TypeScript Interface 只是参考实现。

正式 Contract 应能够生成或映射：

```text
JSON Schema
Zod Schema
OpenAPI Schema
Java DTO
Python Pydantic Model
TypeScript Type
```

推荐：

```text
Schema Source of Truth
↓
Code Generation / Validation
↓
Multiple Runtimes
```

---

# 4. Schema Version

所有关键顶层 Contract 必须包含：

```text
schemaVersion
```

例如：

```text
physics-scene/1.0
physics-ir/1.0
diagram-ir/1.0
simulation-result/1.0
agent-context/1.0
```

---

# 5. Breaking Change

以下属于 Breaking Change：

```text
删除字段
修改字段语义
修改单位语义
修改 ID 含义
修改 Event 含义
修改 Tool 输入输出
修改必填/可选关系
修改枚举语义
修改 PhysicsScene Invariant
```

Breaking Change 必须：

```text
升级 schemaVersion
增加 Migration
增加兼容测试
更新本文档
更新 Consumer
```

---

# 6. ID Contract

所有领域对象拥有稳定 ID。

逻辑类型：

```ts
type SceneId = string
type SnapshotId = string
type PhysicsEventId = string
type CommandId = string

type BodyId = string
type ParticleId = string
type FieldId = string
type ForceId = string
type RegionId = string
type BoundaryId = string
type ConstraintId = string
type CircuitId = string
type ComponentId = string
type ObservableId = string

type QuestionId = string
type ExamId = string
type DocumentId = string
type DiagramId = string

type SessionId = string
type RunId = string
type TurnId = string
type ToolCallId = string
type TraceId = string

type UserId = string
```

实际 TypeScript 推荐使用 Brand。

```ts
type Brand<T, B extends string> = T & {
  readonly __brand: B
}

type SceneId = Brand<string, 'SceneId'>
type ParticleId = Brand<string, 'ParticleId'>
type FieldId = Brand<string, 'FieldId'>
```

---

# 7. ID 规则

ID 必须：

```text
全局唯一或领域内稳定唯一
不可根据展示名称生成
不可因为 Rename 改变
不可复用被删除对象的 ID
```

建议：

```text
UUIDv7
ULID
```

任选一种统一。

---

# 8. 时间 Contract

跨服务时间使用：

```text
ISO 8601 UTC
```

例如：

```text
2026-08-16T03:24:00.000Z
```

TypeScript：

```ts
type IsoDateTime = string
```

---

# 9. PhysicalDimension

统一物理量纲。

```ts
type PhysicalDimension =
  | 'dimensionless'
  | 'length'
  | 'time'
  | 'mass'
  | 'electric_current'
  | 'temperature'
  | 'electric_charge'
  | 'velocity'
  | 'acceleration'
  | 'force'
  | 'energy'
  | 'power'
  | 'electric_field'
  | 'electric_potential'
  | 'magnetic_flux_density'
  | 'magnetic_flux'
  | 'resistance'
  | 'capacitance'
  | 'inductance'
  | 'frequency'
  | 'angle'
  | 'angular_velocity'
  | 'momentum'
  | 'pressure'
  | 'density'
```

后续扩展统一修改 Contract。

---

# 10. Quantity

所有具有物理意义的标量统一使用：

```ts
interface Quantity<D extends PhysicalDimension = PhysicalDimension> {
  value: number

  unit: string

  dimension: D
}
```

示例：

```json
{
  "value": 0.5,
  "unit": "T",
  "dimension": "magnetic_flux_density"
}
```

---

# 11. CanonicalQuantity

Physics Engine 内部可以使用 Canonical SI：

```ts
interface CanonicalQuantity<D extends PhysicalDimension = PhysicalDimension> {
  valueSI: number
  dimension: D
}
```

UI-facing Contract 可以保留 display unit。

---

# 12. Unit Contract

所有 Unit 必须来自统一 Unit Registry。

禁止：

```text
"tesla"
"T "
"特斯拉"
"Tesla"
```

同时作为系统内部 Unit ID。

推荐：

```text
m
s
kg
C
A
N
J
V
T
W
Ω
F
H
rad
Hz
```

显示层可以本地化。

---

# 13. Scalar Precision

重要计算结果可以附带：

```ts
interface NumericMetadata {
  precision?: number
  absoluteTolerance?: number
  relativeTolerance?: number
}
```

不要把展示小数位等同于计算精度。

---

# 14. Vector2

```ts
interface Vector2 {
  x: number
  y: number
}
```

---

# 15. Vector3

PhysicsOS 统一领域向量使用：

```ts
interface Vector3 {
  x: number
  y: number
  z: number
}
```

2D 世界：

```text
z = 0
```

---

# 16. QuantityVector

```ts
interface QuantityVector<D extends PhysicalDimension = PhysicalDimension> {
  vector: Vector3

  unit: string

  dimension: D
}
```

---

# 17. Angle

角度内部推荐：

```text
rad
```

UI 可显示：

```text
°
```

Contract：

```ts
type AngleQuantity = Quantity<'angle'>
```

---

# 18. ActorRef

任何修改 Scene 的主体都必须标明来源。

```ts
interface ActorRef {
  type: 'user' | 'agent' | 'system' | 'teacher' | 'migration'

  id?: string
}
```

---

# 19. TraceContext

跨模块 Trace：

```ts
interface TraceContext {
  traceId: TraceId

  userId?: UserId

  sessionId?: SessionId
  runId?: RunId
  turnId?: TurnId
  toolCallId?: ToolCallId

  sceneId?: SceneId
  sceneRevision?: number
  physicsEventId?: PhysicsEventId
}
```

---

# 20. PhysicsDomain

```ts
type PhysicsDomain =
  | 'mechanics'
  | 'kinematics'
  | 'gravity'
  | 'electric'
  | 'magnetic'
  | 'electromagnetic'
  | 'circuit'
  | 'induction'
  | 'optics'
  | 'wave'
  | 'thermal'
  | 'modern_physics'
  | 'composite'
```

---

# 21. SceneDimension

```ts
type SceneDimension = '2d' | '3d'
```

---

# 22. CoordinateSystem

```ts
interface CoordinateSystem {
  type: 'cartesian'

  origin: Vector3

  axes: {
    x: Vector3
    y: Vector3
    z: Vector3
  }

  lengthUnit: string
}
```

---

# 23. TimelineState

```ts
type TimelineState = 'idle' | 'running' | 'paused' | 'completed' | 'error'
```

---

# 24. Timeline

```ts
interface Timeline {
  currentTime: Quantity<'time'>

  startTime: Quantity<'time'>

  endTime?: Quantity<'time'>

  state: TimelineState

  playbackRate: number

  simulationTimeStep?: Quantity<'time'>
}
```

---

# 25. SceneMetadata

```ts
interface SceneMetadata {
  createdAt: IsoDateTime
  updatedAt: IsoDateTime

  createdBy?: ActorRef

  title?: string
  description?: string

  curriculumTags?: string[]
  knowledgeTags?: string[]

  sourceQuestionId?: QuestionId

  engineVersion?: string
}
```

---

# 26. PhysicsScene

PhysicsOS 最核心 Contract：

```ts
interface PhysicsScene {
  schemaVersion: 'physics-scene/1.0'

  id: SceneId
  revision: number

  dimension: SceneDimension

  coordinateSystem: CoordinateSystem

  timeline: Timeline

  bodies: Body[]
  particles: Particle[]
  fields: Field[]
  forces: Force[]
  regions: Region[]
  boundaries: Boundary[]
  constraints: Constraint[]
  circuits: Circuit[]

  measurementDefinitions: MeasurementDefinition[]

  observableDefinitions: ObservableDefinition[]

  annotations: SceneAnnotation[]

  metadata: SceneMetadata
}
```

---

# 27. Scene Revision Invariant

`revision` 必须：

```text
整数
>= 0
单调递增
```

每次成功 Scene Mutation：

```text
revision + 1
```

---

# 28. PhysicsObjectBase

```ts
interface PhysicsObjectBase {
  id: string

  name?: string

  enabled?: boolean

  tags?: string[]

  metadata?: Record<string, unknown>
}
```

---

# 29. ShapeDefinition

```ts
type ShapeDefinition = CircleShape | RectangleShape | PolygonShape | SegmentShape | PointShape
```

示例：

```ts
interface CircleShape {
  type: 'circle'
  radius: Quantity<'length'>
}
```

---

# 30. MaterialDefinition

```ts
interface MaterialDefinition {
  density?: Quantity<'density'>

  frictionCoefficient?: number

  restitution?: number

  custom?: Record<string, unknown>
}
```

---

# 31. Body

```ts
interface Body extends PhysicsObjectBase {
  type: 'rigid_body'

  mass: Quantity<'mass'>

  position: QuantityVector<'length'>

  velocity: QuantityVector<'velocity'>

  acceleration?: QuantityVector<'acceleration'>

  shape: ShapeDefinition

  material?: MaterialDefinition

  fixed?: boolean
}
```

---

# 32. Particle

```ts
interface Particle extends PhysicsObjectBase {
  type: 'particle'

  mass: Quantity<'mass'>

  charge?: Quantity<'electric_charge'>

  position: QuantityVector<'length'>

  velocity: QuantityVector<'velocity'>

  acceleration?: QuantityVector<'acceleration'>

  species?: string
}
```

---

# 33. Body / Particle Invariant

必须：

```text
mass > 0
position finite
velocity finite
所有 Unit 有效
ID 唯一
```

---

# 34. Field Base

```ts
interface FieldBase extends PhysicsObjectBase {
  regionId?: RegionId
}
```

---

# 35. UniformElectricField

```ts
interface UniformElectricField extends FieldBase {
  type: 'uniform_electric'

  fieldStrength: QuantityVector<'electric_field'>
}
```

---

# 36. UniformMagneticField

```ts
interface UniformMagneticField extends FieldBase {
  type: 'uniform_magnetic'

  magneticFluxDensity: QuantityVector<'magnetic_flux_density'>
}
```

---

# 37. GravityField

```ts
interface GravityField extends FieldBase {
  type: 'uniform_gravity'

  acceleration: QuantityVector<'acceleration'>
}
```

---

# 38. PointChargeField

```ts
interface PointChargeField extends FieldBase {
  type: 'point_charge'

  sourceParticleId: ParticleId
}
```

---

# 39. Field Union

```ts
type Field = UniformElectricField | UniformMagneticField | GravityField | PointChargeField
```

未来扩展必须通过新 discriminated type。

---

# 40. ForceType

```ts
type ForceType =
  | 'gravity'
  | 'normal'
  | 'friction'
  | 'tension'
  | 'spring'
  | 'electric'
  | 'lorentz'
  | 'ampere'
  | 'drag'
  | 'custom'
```

---

# 41. Force

```ts
interface Force extends PhysicsObjectBase {
  type: ForceType

  targetId: string

  sourceId?: string

  vector?: QuantityVector<'force'>

  derived?: boolean

  model?: string
}
```

---

# 42. Derived Force

例如：

```text
Lorentz Force
Gravity
Normal Force
```

可以由 Engine 动态计算。

`vector` 可以不持久化。

如果 `derived = true`：

```text
PhysicsScene 保存模型关系
SimulationResult 保存某时刻结果
```

---

# 43. RegionShape

```ts
type RegionShape = RectangleRegion | CircleRegion | PolygonRegion | HalfPlaneRegion
```

---

# 44. Region

```ts
interface Region extends PhysicsObjectBase {
  type: 'region'

  shape: RegionShape

  properties?: Record<string, unknown>
}
```

Region 可表示：

```text
磁场区域
电场区域
介质区域
碰撞区域
光学介质
```

---

# 45. BoundaryType

```ts
type BoundaryType = 'line' | 'segment' | 'circle' | 'rectangle' | 'polygon'
```

---

# 46. Boundary

```ts
interface Boundary extends PhysicsObjectBase {
  type: BoundaryType

  geometry: GeometryDefinition

  behavior?: BoundaryBehavior
}
```

---

# 47. BoundaryBehavior

```ts
type BoundaryBehavior =
  | {
      type: 'pass_through'
    }
  | {
      type: 'reflect'
      restitution?: number
    }
  | {
      type: 'stop'
    }
  | {
      type: 'custom'
      model: string
    }
```

---

# 48. ConstraintType

```ts
type ConstraintType =
  'fixed' | 'distance' | 'rope' | 'hinge' | 'surface' | 'spring' | 'track' | 'custom'
```

---

# 49. Constraint

```ts
interface Constraint extends PhysicsObjectBase {
  type: ConstraintType

  targets: string[]

  parameters: Record<string, unknown>
}
```

---

# 50. Circuit

```ts
interface Circuit extends PhysicsObjectBase {
  type: 'circuit'

  nodes: CircuitNode[]

  components: CircuitComponent[]

  connections: CircuitConnection[]
}
```

---

# 51. CircuitNode

```ts
interface CircuitNode {
  id: string
  label?: string
}
```

---

# 52. CircuitTerminal

```ts
interface CircuitTerminal {
  id: string

  componentId: ComponentId

  terminalKey: string
}
```

---

# 53. CircuitConnection

```ts
interface CircuitConnection {
  id: string

  from: CircuitTerminal

  to: CircuitTerminal
}
```

---

# 54. CircuitComponent Base

```ts
interface CircuitComponentBase {
  id: ComponentId

  name?: string

  enabled?: boolean
}
```

---

# 55. Resistor

```ts
interface Resistor extends CircuitComponentBase {
  type: 'resistor'

  resistance: Quantity<'resistance'>
}
```

---

# 56. VoltageSource

```ts
interface VoltageSource extends CircuitComponentBase {
  type: 'voltage_source'

  voltage: Quantity<'electric_potential'>

  internalResistance?: Quantity<'resistance'>
}
```

---

# 57. Switch

```ts
interface CircuitSwitch extends CircuitComponentBase {
  type: 'switch'

  state: 'open' | 'closed'
}
```

---

# 58. Ammeter

```ts
interface Ammeter extends CircuitComponentBase {
  type: 'ammeter'

  internalResistance?: Quantity<'resistance'>
}
```

---

# 59. Voltmeter

```ts
interface Voltmeter extends CircuitComponentBase {
  type: 'voltmeter'

  internalResistance?: Quantity<'resistance'>
}
```

---

# 60. VariableResistor

```ts
interface VariableResistor extends CircuitComponentBase {
  type: 'variable_resistor'

  totalResistance: Quantity<'resistance'>

  sliderPosition: number
}
```

`sliderPosition`：

```text
0 <= sliderPosition <= 1
```

---

# 61. Capacitor

```ts
interface Capacitor extends CircuitComponentBase {
  type: 'capacitor'

  capacitance: Quantity<'capacitance'>

  initialVoltage?: Quantity<'electric_potential'>
}
```

---

# 62. Inductor

```ts
interface Inductor extends CircuitComponentBase {
  type: 'inductor'

  inductance: Quantity<'inductance'>
}
```

---

# 63. CircuitComponent Union

```ts
type CircuitComponent =
  | Resistor
  | VoltageSource
  | CircuitSwitch
  | Ammeter
  | Voltmeter
  | VariableResistor
  | Capacitor
  | Inductor
```

---

# 64. MeasurementDefinition

```ts
interface MeasurementDefinition {
  id: string

  type:
    | 'position'
    | 'velocity'
    | 'acceleration'
    | 'force'
    | 'energy'
    | 'current'
    | 'voltage'
    | 'electric_field'
    | 'magnetic_field'
    | 'custom'

  targetId?: string

  componentId?: ComponentId

  enabled: boolean
}
```

---

# 65. ObservableType

```ts
type ObservableType =
  | 'force'
  | 'velocity'
  | 'acceleration'
  | 'momentum'
  | 'trajectory'
  | 'electric_field'
  | 'electric_potential'
  | 'magnetic_field'
  | 'energy'
  | 'current'
  | 'voltage'
  | 'measurement'
  | 'graph'
  | 'geometry'
  | 'annotation'
```

---

# 66. ObservableDefinition

```ts
interface ObservableDefinition {
  id: ObservableId

  type: ObservableType

  targetId?: string

  visible: boolean

  style?: ObservationStyle

  parameters?: Record<string, unknown>
}
```

---

# 67. ObservationStyle

领域 Contract 只保存语义化 Style，不保存 Pixi/Three 对象。

```ts
interface ObservationStyle {
  emphasis?: 'normal' | 'highlight'

  labelVisible?: boolean

  scale?: number

  token?: string
}
```

`token` 对应 UI Design Token。

---

# 68. SceneAnnotation

```ts
interface SceneAnnotation {
  id: string

  type: 'label' | 'formula' | 'marker' | 'guide' | 'teacher_note'

  targetId?: string

  content: string

  visible: boolean
}
```

---

# 69. SceneCommand

```ts
type SceneCommandType =
  | 'SetParticleCharge'
  | 'SetParticleMass'
  | 'SetParticleVelocity'
  | 'SetMagneticFieldStrength'
  | 'SetMagneticFieldDirection'
  | 'SetObservableEnabled'

interface SceneCommand<TType extends SceneCommandType = SceneCommandType, TPayload = unknown> {
  schemaVersion: 'scene-command/1.0'

  commandId: CommandId

  sceneId: SceneId

  expectedRevision: number

  type: TType

  payload: TPayload

  actor: ActorRef

  trace: TraceContext

  issuedAt: IsoDateTime
}
```

当前 Magnetic Runtime 的 payload 锁定为：

```ts
interface SceneCommandPayloadMap {
  SetParticleCharge: {
    particleId: string
    charge: Quantity<'electric_charge'>
  }
  SetParticleMass: {
    particleId: string
    mass: Quantity<'mass'>
  }
  SetParticleVelocity: {
    particleId: string
    velocity: QuantityVector<'velocity'>
  }
  SetMagneticFieldStrength: {
    fieldId: string
    strength: Quantity<'magnetic_flux_density'>
  }
  SetMagneticFieldDirection: {
    fieldId: string
    direction: 'into_page' | 'out_of_page'
  }
  SetObservableEnabled: {
    observableId: ObservableId
    enabled: boolean
  }
}
```

---

# 70. SceneCommandResult

```ts
type SceneCommandResult =
  | {
      ok: true

      sceneId: SceneId

      previousRevision: number

      newRevision: number

      eventIds: PhysicsEventId[]

      traceId: TraceId
    }
  | {
      ok: false

      error: DomainError

      traceId: TraceId
    }
```

---

# 71. PhysicsEvent

```ts
interface PhysicsEvent<TPayload = unknown> {
  schemaVersion: 'physics-event/1.0'

  eventId: PhysicsEventId

  commandId: CommandId

  sceneId: SceneId

  revision: number

  type: string

  payload: TPayload

  actor: ActorRef

  occurredAt: IsoDateTime

  trace: TraceContext
}
```

---

# 72. Physics Event 类型

核心事件包括：

```text
SceneCreated

BodyAdded
BodyRemoved
BodyParameterChanged

ParticleAdded
ParticleRemoved
ParticleParameterChanged
ParticleChargeChanged
ParticleMassChanged
ParticleVelocityChanged

FieldAdded
FieldRemoved
FieldChanged
MagneticFieldStrengthChanged
MagneticFieldDirectionChanged

ForceAdded
ForceRemoved

RegionAdded
RegionChanged
RegionRemoved

BoundaryAdded
BoundaryChanged
BoundaryRemoved

ConstraintAdded
ConstraintRemoved

CircuitAdded
CircuitChanged

TimelineSeeked
SimulationStarted
SimulationPaused
SimulationCompleted
SimulationFailed

ParticleEnteredRegion
ParticleExitedRegion
CollisionOccurred

ObservableEnabled
ObservableDisabled
```

---

# 73. SceneSnapshot

```ts
interface SceneSnapshot {
  schemaVersion: 'scene-snapshot/1.0'

  id: SnapshotId

  sceneId: SceneId

  revision: number

  scene: PhysicsScene

  createdAt: IsoDateTime

  hash: string
}
```

---

# 74. Snapshot Hash

推荐：

```text
SHA-256
```

用于：

```text
Integrity
Cache
Replay Verification
Export Validation
```

---

# 75. SimulationId

```ts
type SimulationId = Brand<string, 'SimulationId'>
```

---

# 76. SimulationRequest

```ts
interface SimulationRequest {
  schemaVersion: 'simulation-request/1.0'

  simulationId: SimulationId

  sceneId: SceneId

  sceneRevision: number

  requestedDomain?: PhysicsDomain

  options: SimulationOptions

  trace: TraceContext
}
```

---

# 77. SimulationOptions

```ts
interface SimulationOptions {
  startTime?: Quantity<'time'>

  endTime?: Quantity<'time'>

  timeStep?: Quantity<'time'>

  outputSampleRate?: number

  solver?: string

  tolerance?: {
    absolute: number
    relative: number
  }

  maxIterations?: number

  randomSeed?: number
}
```

---

# 78. ObjectState

```ts
interface ObjectState {
  id: string

  position?: QuantityVector<'length'>

  velocity?: QuantityVector<'velocity'>

  acceleration?: QuantityVector<'acceleration'>

  values?: Record<string, Quantity | QuantityVector>
}
```

---

# 79. SimulationState

```ts
interface SimulationState {
  time: Quantity<'time'>

  objects: ObjectState[]

  derived: DerivedQuantity[]
}
```

---

# 80. DerivedQuantity

```ts
interface DerivedQuantity {
  key: string

  targetId?: string

  value: Quantity | QuantityVector

  formula?: FormulaRef

  assumptions?: string[]

  confidence?: number
}
```

`SimulationResult` 的模型假设不另建重复字段。Engine 必须把实际采用的假设写入
`derivedQuantities[].assumptions`；Verifier 从这些 Physics Fact 聚合并验证。当前
Magnetic Runtime 至少携带：

```text
uniform magnetic field
velocity perpendicular B
magnetic force only
ignore electric field
ignore gravity
```

例如：

```text
net_force
orbit_radius
period
angular_velocity
kinetic_energy
electric_potential_energy
branch_current
induced_emf
```

---

# 81. FormulaRef

```ts
interface FormulaRef {
  id?: string

  expression: string

  latex?: string

  variables?: Record<string, string>

  conditions?: string[]
}
```

---

# 82. Measurement

```ts
interface Measurement {
  id: string

  definitionId?: string

  time?: Quantity<'time'>

  targetId?: string

  value: Quantity | QuantityVector

  source: 'simulation' | 'derived' | 'instrument' | 'user'

  metadata?: Record<string, unknown>
}
```

---

# 83. SimulationMetadata

```ts
interface SimulationMetadata {
  engineId: string

  engineVersion: string

  solver?: string

  startedAt: IsoDateTime

  finishedAt: IsoDateTime

  durationMs: number

  deterministic: boolean

  randomSeed?: number
}
```

---

# 84. SimulationResult

```ts
interface SimulationResult {
  schemaVersion: 'simulation-result/1.0'

  simulationId: SimulationId

  sceneId: SceneId

  sceneRevision: number

  states: SimulationState[]

  events: PhysicsEvent[]

  measurements: Measurement[]

  derivedQuantities: DerivedQuantity[]

  verification: VerificationResult

  metadata: SimulationMetadata

  trace: TraceContext
}
```

---

# 85. VerificationStatus

```ts
type VerificationStatus = 'passed' | 'passed_with_warnings' | 'failed'
```

---

# 86. VerificationCheckType

```ts
type VerificationCheckType =
  | 'schema'
  | 'dimension'
  | 'symbolic'
  | 'numerical'
  | 'constraint'
  | 'conservation'
  | 'boundary'
  | 'trajectory'
  | 'continuity'
  | 'semantic'
```

---

# 87. VerificationCheck

```ts
interface VerificationCheck {
  id: string

  type: VerificationCheckType

  passed: boolean

  message?: string

  targetId?: string

  details?: Record<string, unknown>
}
```

---

# 88. VerificationIssue

```ts
interface VerificationIssue {
  code: string

  severity: 'warning' | 'error'

  message: string

  targetId?: string

  details?: Record<string, unknown>
}
```

---

# 89. VerificationResult

```ts
interface VerificationResult {
  status: VerificationStatus

  checks: VerificationCheck[]

  warnings: VerificationIssue[]

  errors: VerificationIssue[]
}
```

---

# 90. Physics IR 定位

Physics IR 是：

> **自然语言 / 试卷世界 → PhysicsScene 世界的正式中间层。**

禁止：

```text
Question
↓
LLM
↓
直接 Canvas
```

必须：

```text
Question
↓
Physics IR
↓
Scene Builder
↓
PhysicsScene
```

---

# 91. PhysicsIR

```ts
interface PhysicsIR {
  schemaVersion: 'physics-ir/1.0'

  problemId: string

  domain: PhysicsDomain

  problemType: string

  objects: PhysicsObjectIR[]

  regions: PhysicsRegionIR[]

  knownValues: KnownValueIR[]

  unknownValues: UnknownValueIR[]

  initialConditions: InitialConditionIR[]

  constraints: PhysicsConstraintIR[]

  relations: PhysicsRelationIR[]

  targets: PhysicsTargetIR[]

  diagramRefs: DiagramId[]

  knowledgeTags: string[]

  assumptions: PhysicsAssumptionIR[]

  confidence: number

  source: IRSourceMetadata
}
```

---

# 92. IRSourceMetadata

```ts
interface IRSourceMetadata {
  questionId?: QuestionId

  documentId?: DocumentId

  parserVersion?: string

  createdAt: IsoDateTime
}
```

---

# 93. PhysicsObjectIR

```ts
interface PhysicsObjectIR {
  id: string

  type:
    | 'body'
    | 'particle'
    | 'field'
    | 'region'
    | 'boundary'
    | 'circuit_component'
    | 'optical_element'
    | 'wave_source'

  attributes: Record<string, unknown>

  sourceEvidence?: EvidenceRef[]

  confidence: number
}
```

---

# 94. PhysicsRegionIR

```ts
interface PhysicsRegionIR {
  id: string

  type: string

  geometryRef?: string

  attributes: Record<string, unknown>

  sourceEvidence?: EvidenceRef[]

  confidence: number
}
```

---

# 95. KnownValueIR

```ts
interface KnownValueIR {
  id: string

  symbol?: string

  property: string

  targetId?: string

  value: Quantity

  sourceEvidence?: EvidenceRef[]

  confidence: number
}
```

---

# 96. UnknownValueIR

```ts
interface UnknownValueIR {
  id: string

  symbol?: string

  property: string

  targetId?: string

  expectedDimension?: PhysicalDimension
}
```

---

# 97. InitialConditionIR

```ts
interface InitialConditionIR {
  id: string

  targetId: string

  property: string

  value: Quantity | QuantityVector | string | boolean

  sourceEvidence?: EvidenceRef[]

  confidence: number
}
```

---

# 98. PhysicsConstraintIR

```ts
interface PhysicsConstraintIR {
  id: string

  type: string

  targets: string[]

  expression?: string

  parameters?: Record<string, unknown>

  sourceEvidence?: EvidenceRef[]

  confidence: number
}
```

---

# 99. PhysicsRelationIR

```ts
interface PhysicsRelationIR {
  id: string

  type: string

  targets: string[]

  expression?: string

  parameters?: Record<string, unknown>

  confidence: number
}
```

---

# 100. PhysicsTargetIR

```ts
interface PhysicsTargetIR {
  id: string

  key: string

  targetId?: string

  expectedDimension?: PhysicalDimension
}
```

---

# 101. PhysicsAssumptionIR

```ts
interface PhysicsAssumptionIR {
  id: string

  description: string

  type: 'explicit' | 'implicit' | 'modeling'

  sourceEvidence?: EvidenceRef[]

  confidence: number
}
```

---

# 102. Confidence

统一：

```text
0 <= confidence <= 1
```

不得：

```text
95
```

和：

```text
0.95
```

混用。

---

# 103. EvidenceRef

Physics IR 中关键判断尽量可追溯。

```ts
interface EvidenceRef {
  source: 'text' | 'image' | 'diagram' | 'metadata'

  documentId?: DocumentId

  page?: number

  textRange?: {
    start: number
    end: number
  }

  boundingBox?: BoundingBox

  diagramElementId?: string

  excerpt?: string
}
```

---

# 104. BoundingBox

统一使用归一化坐标：

```ts
interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}
```

约束：

```text
0 <= x,y,width,height <= 1
```

---

# 105. Diagram IR 定位

Diagram IR 用于把：

```text
斜面图
电路图
磁场区域图
光路图
坐标图
受力图
```

转成结构化图形。

---

# 106. DiagramIR

```ts
interface DiagramIR {
  schemaVersion: 'diagram-ir/1.0'

  id: DiagramId

  canvas: DiagramCanvas

  elements: DiagramElement[]

  relations: DiagramRelation[]

  source: DiagramSource

  confidence: number
}
```

---

# 107. DiagramCanvas

```ts
interface DiagramCanvas {
  width: number

  height: number

  coordinateSpace: 'pixel' | 'normalized'
}
```

---

# 108. DiagramSource

```ts
interface DiagramSource {
  documentId?: DocumentId

  page?: number

  boundingBox?: BoundingBox
}
```

---

# 109. DiagramPoint

```ts
interface DiagramPoint {
  id: string

  type: 'point'

  x: number
  y: number

  label?: string

  confidence: number
}
```

---

# 110. DiagramLine

```ts
interface DiagramLine {
  id: string

  type: 'line'

  start: Vector2
  end: Vector2

  style?: string

  confidence: number
}
```

---

# 111. DiagramArc

```ts
interface DiagramArc {
  id: string

  type: 'arc'

  center: Vector2

  radius: number

  startAngle?: number

  endAngle?: number

  confidence: number
}
```

---

# 112. DiagramArrow

```ts
interface DiagramArrow {
  id: string

  type: 'arrow'

  start: Vector2

  end: Vector2

  label?: string

  confidence: number
}
```

---

# 113. DiagramLabel

```ts
interface DiagramLabel {
  id: string

  type: 'label'

  text: string

  position: Vector2

  confidence: number
}
```

---

# 114. DiagramBody

```ts
interface DiagramBody {
  id: string

  type: 'body'

  shape: string

  boundingBox: BoundingBox

  label?: string

  confidence: number
}
```

---

# 115. DiagramFieldRegion

```ts
interface DiagramFieldRegion {
  id: string

  type: 'field_region'

  fieldType: 'electric' | 'magnetic' | 'unknown'

  shape: string

  boundingBox?: BoundingBox

  directionHint?: string

  confidence: number
}
```

---

# 116. DiagramWire

```ts
interface DiagramWire {
  id: string

  type: 'wire'

  points: Vector2[]

  confidence: number
}
```

---

# 117. DiagramComponent

```ts
interface DiagramComponent {
  id: string

  type: 'circuit_component'

  componentType: string

  boundingBox: BoundingBox

  label?: string

  confidence: number
}
```

---

# 118. DiagramCoordinate

```ts
interface DiagramCoordinate {
  id: string

  type: 'coordinate'

  origin: Vector2

  xDirection: Vector2

  yDirection: Vector2

  labels?: string[]

  confidence: number
}
```

---

# 119. DiagramElement Union

```ts
type DiagramElement =
  | DiagramPoint
  | DiagramLine
  | DiagramArc
  | DiagramArrow
  | DiagramLabel
  | DiagramBody
  | DiagramFieldRegion
  | DiagramWire
  | DiagramComponent
  | DiagramCoordinate
```

---

# 120. DiagramRelation

```ts
interface DiagramRelation {
  id: string

  type:
    | 'connected_to'
    | 'inside'
    | 'intersects'
    | 'parallel'
    | 'perpendicular'
    | 'tangent'
    | 'labeled_by'
    | 'points_to'
    | 'custom'

  sourceId: string

  targetId: string

  confidence: number
}
```

---

# 121. QuestionDocument

```ts
interface QuestionDocument {
  schemaVersion: 'question-document/1.0'

  id: QuestionId

  type: 'single_question' | 'exam_question'

  source: QuestionSource

  stem: string

  options?: QuestionOption[]

  images: QuestionImage[]

  diagramRefs: DiagramId[]

  physicsIR?: PhysicsIR

  solution?: QuestionSolution

  metadata: QuestionMetadata
}
```

---

# 122. QuestionSource

```ts
interface QuestionSource {
  type: 'manual' | 'image' | 'pdf' | 'scan' | 'question_bank' | 'teacher'

  documentId?: DocumentId

  examId?: ExamId

  page?: number
}
```

---

# 123. QuestionImage

```ts
interface QuestionImage {
  id: string

  objectKey: string

  contentType: string

  boundingBox?: BoundingBox

  page?: number
}
```

---

# 124. QuestionOption

```ts
interface QuestionOption {
  key: string

  content: string

  imageRefs?: string[]
}
```

---

# 125. QuestionMetadata

```ts
interface QuestionMetadata {
  grade?: string

  difficulty?: 'basic' | 'medium' | 'advanced' | 'exam'

  knowledgeTags?: string[]

  createdAt: IsoDateTime

  updatedAt: IsoDateTime
}
```

---

# 126. QuestionSolution

```ts
interface QuestionSolution {
  schemaVersion: 'question-solution/1.0'

  strategy: string[]

  steps: SolutionStep[]

  finalAnswer?: AnswerValue

  formulas: FormulaRef[]

  verification?: VerificationResult
}
```

---

# 127. AnswerValue

```ts
type AnswerValue =
  | string
  | Quantity
  | QuantityVector
  | string[]
  | {
      expression: string
      latex?: string
    }
```

---

# 128. SolutionStep

```ts
interface SolutionStep {
  id: string

  title: string

  explanation: string

  formula?: FormulaRef

  sceneRevision?: number

  observationIds?: ObservableId[]

  evidenceRefs?: EvidenceRef[]
}
```

---

# 129. ExamDocument

```ts
interface ExamDocument {
  schemaVersion: 'exam-document/1.0'

  id: ExamId

  title?: string

  sourceDocumentId: DocumentId

  questionIds: QuestionId[]

  metadata: {
    grade?: string
    subject: 'physics'
    createdAt: IsoDateTime
  }
}
```

---

# 130. StudentAttempt

```ts
interface StudentAttempt {
  id: string

  userId: UserId

  questionId: QuestionId

  answer: AnswerValue

  submittedAt: IsoDateTime

  result?: AttemptResult

  diagnosticRefs?: string[]
}
```

---

# 131. AttemptResult

```ts
interface AttemptResult {
  correct?: boolean

  score?: number

  maxScore?: number

  feedback?: string
}
```

---

# 132. DynamicQuestion

```ts
interface DynamicQuestion {
  schemaVersion: 'dynamic-question/1.0'

  baseSceneId: SceneId

  baseSceneRevision: number

  difficulty: 'basic' | 'medium' | 'advanced' | 'exam'

  variablePolicy: VariablePolicy

  questionPatternId: string

  generatedQuestionId: QuestionId
}
```

---

# 133. VariablePolicy

```ts
interface VariablePolicy {
  mutableKeys: string[]

  fixedKeys?: string[]

  ranges?: Record<
    string,
    {
      min?: number
      max?: number
      values?: unknown[]
    }
  >

  preserveDifficulty?: boolean
}
```

---

# 134. Physics Tool Definition

所有 Tool 使用统一 Contract。

```ts
interface PhysicsToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string

  version: string

  description: string

  inputSchema: JsonSchema

  outputSchema: JsonSchema

  permission: ToolPermission

  timeoutMs: number

  mutatesScene: boolean

  execute(context: ToolContext, input: TInput): Promise<ToolResult<TOutput>>
}
```

---

# 135. ToolPermission

```ts
type ToolPermission =
  'read' | 'scene-write' | 'content-write' | 'teacher-write' | 'admin' | 'dangerous'
```

---

# 136. ToolContext

```ts
interface ToolContext {
  userId: UserId

  sessionId: SessionId

  runId: RunId

  turnId?: TurnId

  toolCallId: ToolCallId

  sceneId?: SceneId

  sceneRevision?: number

  permissions: ToolPermission[]

  traceId: TraceId
}
```

---

# 137. ToolResult

```ts
type ToolResult<T> =
  | {
      ok: true

      data: T

      traceId: TraceId

      sceneMutation?: {
        previousRevision: number
        newRevision: number
        eventIds: PhysicsEventId[]
      }
    }
  | {
      ok: false

      error: PhysicsToolError

      traceId: TraceId
    }
```

---

# 138. PhysicsToolError

```ts
interface PhysicsToolError {
  code: ToolErrorCode

  message: string

  retryable: boolean

  details?: Record<string, unknown>
}
```

---

# 139. ToolErrorCode

```ts
type ToolErrorCode =
  | 'INVALID_UNIT'
  | 'INVALID_PARAMETER'
  | 'OBJECT_NOT_FOUND'
  | 'SCENE_NOT_FOUND'
  | 'SCENE_REVISION_CONFLICT'
  | 'PHYSICS_CONSTRAINT_VIOLATION'
  | 'UNSUPPORTED_MODEL'
  | 'SIMULATION_FAILED'
  | 'VERIFICATION_FAILED'
  | 'TOOL_PERMISSION_DENIED'
  | 'TOOL_TIMEOUT'
  | 'INTERNAL_TOOL_ERROR'
```

---

# 140. Tool Naming

统一：

```text
physics.<domain>.<action>
```

例如：

```text
physics.scene.create
physics.scene.seek
physics.mechanics.net_force
physics.kinematics.trajectory
physics.electric.field
physics.magnetic.lorentz_force
physics.circuit.solve
physics.observe.force
```

---

# 141. PhysicsAgentMode

```ts
type PhysicsAgentMode = 'experiment' | 'question' | 'teacher' | 'diagnostic'
```

---

# 142. AgentRole

```ts
type AgentRole =
  | 'orchestrator'
  | 'question_parser'
  | 'scene_builder'
  | 'solver'
  | 'verifier'
  | 'observation_planner'
  | 'tutor'
  | 'diagnostic'
```

---

# 143. SceneReference

Agent Context 不直接保存完整 Scene。

```ts
interface SceneReference {
  id: SceneId

  revision: number

  snapshotId?: SnapshotId
}
```

---

# 144. StructuredFact

```ts
interface StructuredFact {
  id: string

  key: string

  value: unknown

  status: 'confirmed' | 'derived' | 'hypothesis'

  evidenceRefs?: EvidenceRef[]

  sceneRevision?: number
}
```

---

# 145. PhysicsWorkingMemory

```ts
interface PhysicsWorkingMemory {
  taskType: string

  objective: string

  stage?: string

  confirmedFacts: StructuredFact[]

  derivedFacts: StructuredFact[]

  completedSteps: string[]

  pendingSteps: string[]

  misconceptions: string[]

  importantEventIds: PhysicsEventId[]
}
```

---

# 146. PhysicsAgentContext

```ts
interface PhysicsAgentContext {
  schemaVersion: 'agent-context/1.0'

  constitutionVersion: string

  mode: PhysicsAgentMode

  role: AgentRole

  grade?: string

  skillRefs: string[]

  learningStateRef?: string

  scene?: SceneReference

  workingMemory: PhysicsWorkingMemory

  recentConversationRef?: string

  retrievalRefs?: string[]

  trace: TraceContext
}
```

---

# 147. Context Layer 对应 Contract

```text
L0 Constitution
→ constitutionVersion

L1 Domain
→ skillRefs

L2 Learning State
→ learningStateRef

L3 Physics Scene
→ SceneReference

L4 Working Memory
→ PhysicsWorkingMemory

L5 Recent Conversation
→ recentConversationRef

L6 Retrieval
→ retrievalRefs
```

---

# 148. CompactionResult

```ts
interface CompactionResult {
  schemaVersion: 'physics-compaction/1.0'

  sessionId: SessionId

  createdAt: IsoDateTime

  scene?: SceneReference

  task: {
    type: string
    objective: string
  }

  confirmedFacts: StructuredFact[]

  derivedFacts: StructuredFact[]

  completedSteps: string[]

  pendingSteps: string[]

  misconceptions: string[]

  importantEventIds: PhysicsEventId[]

  summaryText?: string
}
```

`summaryText` 只是补充。

结构化字段才是主要事实。

---

# 149. LearningStateRef

```ts
interface LearningStateRef {
  id: string

  userId: UserId

  revision: number
}
```

---

# 150. LearningState

```ts
interface LearningState {
  schemaVersion: 'learning-state/1.0'

  id: string

  userId: UserId

  revision: number

  grade?: string

  mastery: KnowledgeMastery[]

  misconceptions: MisconceptionRecord[]

  strengths: string[]

  weaknesses: string[]

  preferences?: LearningPreference

  updatedAt: IsoDateTime
}
```

---

# 151. KnowledgeMastery

```ts
interface KnowledgeMastery {
  knowledgePointId: string

  score: number

  confidence: number

  attempts: number

  evidenceCount: number

  updatedAt: IsoDateTime
}
```

约束：

```text
0 <= score <= 1
0 <= confidence <= 1
```

---

# 152. MisconceptionRecord

```ts
interface MisconceptionRecord {
  id: string

  knowledgePointId?: string

  code: string

  description: string

  confidence: number

  evidenceQuestionIds?: QuestionId[]

  firstObservedAt: IsoDateTime

  lastObservedAt: IsoDateTime
}
```

---

# 153. LearningPreference

```ts
interface LearningPreference {
  explanationDepth?: 'brief' | 'standard' | 'detailed'

  hintStyle?: 'socratic' | 'direct' | 'visual_first'

  formulaPreference?: 'early' | 'after_intuition'

  visualizationPreference?: string[]
}
```

---

# 154. MemoryRecord Base

```ts
interface MemoryRecord {
  id: string

  userId?: UserId

  sessionId?: SessionId

  type: 'session' | 'learning' | 'scene' | 'error' | 'knowledge' | 'preference'

  createdAt: IsoDateTime

  updatedAt: IsoDateTime

  metadata?: Record<string, unknown>
}
```

---

# 155. Error Memory

用于记录可复用错误模式。

```ts
interface ErrorMemory extends MemoryRecord {
  type: 'error'

  code: string

  description: string

  domain?: PhysicsDomain

  knowledgePointId?: string

  confidence: number

  occurrences: number
}
```

---

# 156. SkillReference

```ts
interface SkillReference {
  id: string

  version: string

  domain: PhysicsDomain

  gradeRange?: string[]

  path: string
}
```

---

# 157. SkillManifest

```ts
interface SkillManifest {
  schemaVersion: 'physics-skill/1.0'

  id: string

  version: string

  title: string

  domain: PhysicsDomain

  prerequisites: string[]

  concepts: string[]

  toolScopes: string[]

  observableRecommendations: string[]

  misconceptionCodes: string[]

  sceneTemplateRefs: string[]

  questionPatternRefs: string[]
}
```

---

# 158. QuestionPattern

```ts
interface QuestionPattern {
  id: string

  version: string

  domain: PhysicsDomain

  problemType: string

  difficulty: 'basic' | 'medium' | 'advanced' | 'exam'

  requiredSceneFeatures: string[]

  variablePolicy: VariablePolicy

  targets: string[]

  templateRef: string
}
```

---

# 159. ObservationPlan

Agent Observation Planner 输出统一结构。

```ts
interface ObservationPlan {
  schemaVersion: 'observation-plan/1.0'

  scene: SceneReference

  actions: ObservationAction[]

  pausePoints?: TimelinePausePoint[]

  explanationGoal?: string
}
```

---

# 160. ObservationAction

```ts
type ObservationAction =
  | {
      type: 'show'
      observableId: ObservableId
    }
  | {
      type: 'hide'
      observableId: ObservableId
    }
  | {
      type: 'highlight'
      observableId: ObservableId
    }
  | {
      type: 'create_graph'
      measurementIds: string[]
    }
  | {
      type: 'focus_object'
      targetId: string
    }
```

---

# 161. TimelinePausePoint

```ts
interface TimelinePausePoint {
  time?: Quantity<'time'>

  eventId?: PhysicsEventId

  reason: string
}
```

---

# 162. VisualSceneModel 定位

VisualSceneModel 是 Observation → Renderer 的中间层。

它可以包含：

```text
VisualPrimitive
RenderLayer
Labels
Trajectories
Vectors
Field Glyphs
Graph Data
```

但：

> **不属于 PhysicsScene Contract。**

Renderer Contract 单独维护，不允许反向污染 PhysicsScene。

---

# 163. DomainError

所有领域服务统一错误基础结构。

```ts
interface DomainError {
  code: string

  message: string

  category:
    'validation' | 'not_found' | 'conflict' | 'unsupported' | 'permission' | 'timeout' | 'internal'

  retryable: boolean

  details?: Record<string, unknown>
}
```

---

# 164. API Error

对外：

```ts
interface ApiErrorResponse {
  error: {
    code: string

    message: string

    traceId: TraceId

    details?: unknown
  }
}
```

---

# 165. Pagination

统一：

```ts
interface PageRequest {
  page: number
  pageSize: number
}
```

返回：

```ts
interface PageResponse<T> {
  items: T[]

  page: number
  pageSize: number

  totalItems: number
  totalPages: number
}
```

---

# 166. Cursor Pagination

高频 Event / Log 推荐 Cursor。

```ts
interface CursorPage<T> {
  items: T[]

  nextCursor?: string
}
```

---

# 167. DocumentParseJob

长任务统一 Job Contract。

```ts
interface DocumentParseJob {
  id: string

  documentId: DocumentId

  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

  progress: number

  createdAt: IsoDateTime

  updatedAt: IsoDateTime

  error?: DomainError
}
```

---

# 168. AgentRun

```ts
interface AgentRun {
  id: RunId

  sessionId: SessionId

  status: 'queued' | 'running' | 'waiting_tool' | 'completed' | 'failed' | 'cancelled'

  role: AgentRole

  mode: PhysicsAgentMode

  startedAt?: IsoDateTime

  finishedAt?: IsoDateTime

  traceId: TraceId
}
```

---

# 169. AgentMessage

```ts
interface AgentMessage {
  id: string

  sessionId: SessionId

  role: 'user' | 'assistant' | 'system' | 'tool'

  content: AgentContent[]

  createdAt: IsoDateTime

  traceId: TraceId
}
```

---

# 170. AgentContent

```ts
type AgentContent =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'image_ref'
      objectKey: string
    }
  | {
      type: 'question_ref'
      questionId: QuestionId
    }
  | {
      type: 'scene_ref'
      scene: SceneReference
    }
  | {
      type: 'tool_result_ref'
      toolCallId: ToolCallId
    }
```

---

# 171. ToolCallRecord

```ts
interface ToolCallRecord {
  toolCallId: ToolCallId

  sessionId: SessionId

  runId: RunId

  toolName: string

  toolVersion: string

  input: unknown

  output?: unknown

  status: 'requested' | 'running' | 'succeeded' | 'failed'

  startedAt?: IsoDateTime

  finishedAt?: IsoDateTime

  trace: TraceContext
}
```

---

# 172. 双 Event Stream Link

Agent Event 与 Physics Event 通过：

```text
traceId
sessionId
runId
turnId
toolCallId
sceneId
sceneRevision
physicsEventId
```

关联。

---

# 173. EventTraceLink

```ts
interface EventTraceLink {
  traceId: TraceId

  sessionId?: SessionId

  runId?: RunId

  turnId?: TurnId

  toolCallId?: ToolCallId

  sceneId?: SceneId

  sceneRevision?: number

  physicsEventId?: PhysicsEventId
}
```

---

# 174. PhysicsScene Invariants

任何持久化 Scene 都必须满足：

```text
schemaVersion 可识别
scene id 有效
revision >= 0
对象 ID 唯一
所有引用存在
Quantity 单位合法
Quantity 量纲合法
Vector finite
mass > 0
Timeline 合法
Circuit Connection 有效
Region Geometry 有效
```

---

# 175. Magnetic Invariants

例如纯匀强磁场圆周模型：

```text
Particle charge != 0
Particle mass > 0
B != 0
v perpendicular B
无额外做功力
```

满足这些条件才可以应用：

```text
r = mv / |q|B
T = 2πm / |q|B
```

---

# 176. Electric Invariants

匀强电场粒子模型至少验证：

```text
field uniform
charge defined
mass > 0
field vector valid
```

---

# 177. Circuit Invariants

至少验证：

```text
node id unique
component id unique
terminal exists
connection valid
resistance >= 0
capacitance > 0
inductance >= 0
slider position in [0,1]
```

---

# 178. Scene Builder Contract

输入：

```text
PhysicsIR
```

输出：

```ts
interface SceneBuildResult {
  scene: PhysicsScene

  mapping: SceneBuildMapping[]

  unresolved: SceneBuildIssue[]

  assumptions: PhysicsAssumptionIR[]

  verification: VerificationResult
}
```

---

# 179. SceneBuildMapping

```ts
interface SceneBuildMapping {
  irObjectId: string

  sceneObjectId: string

  evidenceRefs?: EvidenceRef[]
}
```

---

# 180. SceneBuildIssue

```ts
interface SceneBuildIssue {
  code: string

  message: string

  severity: 'warning' | 'error'

  evidenceRefs?: EvidenceRef[]

  requiresUserInput?: boolean
}
```

---

# 181. Question Parser Contract

```ts
interface QuestionParseResult {
  question: QuestionDocument

  diagramIRs: DiagramIR[]

  physicsIR: PhysicsIR

  warnings: ParserWarning[]

  traceId: TraceId
}
```

---

# 182. ParserWarning

```ts
interface ParserWarning {
  code: string

  message: string

  confidence?: number

  evidenceRefs?: EvidenceRef[]
}
```

---

# 183. OCR / VLM Contract 边界

OCR / VLM 原始输出：

```text
不得作为 Physics IR 本身
```

必须经过：

```text
Normalization
Semantic Parsing
Validation
```

后才成为领域 Contract。

---

# 184. Math Runtime Contract

所有数学服务通过统一请求。

```ts
interface MathRequest<TInput = unknown> {
  operation: string

  input: TInput

  precision?: number

  traceId: TraceId
}
```

返回：

```ts
interface MathResult<TOutput = unknown> {
  ok: boolean

  output?: TOutput

  error?: DomainError

  metadata?: {
    engine: string
    version: string
    durationMs: number
  }
}
```

---

# 185. Symbolic Expression

推荐统一：

```ts
interface SymbolicExpression {
  source: string

  format: 'plain' | 'latex' | 'sympy'
}
```

---

# 186. Renderer Interaction Contract

Renderer 用户交互不能直接 Mutation Scene。

输出：

```ts
interface RendererInteraction {
  type: 'select' | 'drag' | 'resize' | 'rotate' | 'seek' | 'connect'

  targetId?: string

  payload?: unknown
}
```

Application 层将其转换 Scene Command。

---

# 187. Platform FileRef

Web / Desktop 统一：

```ts
interface FileRef {
  id: string

  name: string

  size: number

  contentType?: string

  source: 'browser' | 'desktop' | 'object_storage'

  path?: string

  objectKey?: string
}
```

浏览器不应假设存在本地 path。

---

# 188. Export Contract

```ts
interface ExportRequest {
  type: 'scene' | 'report' | 'question' | 'experiment_data'

  sourceId: string

  format: 'json' | 'pdf' | 'csv' | 'png'

  options?: Record<string, unknown>
}
```

---

# 189. Contract Test

每个公共 Contract 至少测试：

```text
Valid Example
Invalid Example
Backward Compatibility
Serialization
Deserialization
Unit Validation
Enum Validation
Required Fields
```

---

# 190. Schema Registry

推荐建立：

```text
packages/contracts/
```

或由现有领域 packages 暴露 Schema。

但必须有统一 Registry：

```text
Schema ID
Version
Owner Package
JSON Schema
Examples
Migration
```

---

# 191. Contract Owner

每个 Contract 必须有唯一 Owner。

例如：

```text
PhysicsScene
→ physics-scene

Physics IR
→ physics-ir

Diagram IR
→ diagram-ir

SimulationResult
→ physics-core / simulation contracts

Tool Contract
→ agent-tools

Agent Context
→ agent-context
```

其他模块只能消费，不得复制定义。

---

# 192. Contract 文件位置

推荐：

```text
packages/physics-scene/src/contracts/
packages/physics-ir/src/contracts/
packages/diagram-ir/src/contracts/
packages/physics-core/src/contracts/
packages/agent-tools/src/contracts/
packages/agent-context/src/contracts/
```

---

# 193. 禁止重复类型

禁止出现：

```text
PhysicsSceneDto
PhysicsSceneData
SceneModel
SceneSchema
```

四套语义近似结构互相手写转换。

必要的 Transport DTO 应明确命名：

```text
PhysicsSceneApiResponse
```

并直接映射统一 Domain Contract。

---

# 194. Persistence Model

数据库表结构可以与 Domain Contract 不完全相同。

但必须存在明确 Mapper：

```text
Persistence
↓
Mapper
↓
Domain Contract
```

禁止 ORM Entity 渗透到整个系统。

---

# 195. Public Contract 与 Internal Model

允许内部模型不同。

例如 Engine 内部：

```text
CanonicalParticleState
```

但跨 package 公开输入输出必须回到公共 Contract。

---

# 196. Contract Compatibility

消费者至少保证：

```text
读取当前版本
读取上一兼容 Minor 版本
```

Breaking Major Version 通过 Migration 转换。

---

# 197. Minor Version

可以在兼容情况下：

```text
新增 optional 字段
新增 enum 但 Consumer 有 fallback
新增 metadata
```

具体仍需 Contract Test。

---

# 198. Major Version

需要：

```text
字段删除
语义改变
默认单位改变
必填条件改变
Event 解释改变
```

升级 Major。

---

# 199. Migration Contract

```ts
interface ContractMigration<TFrom, TTo> {
  fromVersion: string

  toVersion: string

  migrate(input: TFrom): TTo
}
```

---

# 200. Scene Import

导入旧 Scene：

```text
Detect Schema Version
↓
Migrate
↓
Validate
↓
Load PhysicsScene
```

禁止旧 JSON 直接强转最新 Type。

---

# 201. Export Scene 包

未来 `.physics` / `.scene` 文件建议包含：

```text
manifest.json
scene.json
events.jsonl
snapshot.json
assets/
```

Manifest：

```ts
interface ScenePackageManifest {
  formatVersion: string

  sceneSchemaVersion: string

  sceneId: SceneId

  revision: number

  createdAt: IsoDateTime

  hashes: Record<string, string>
}
```

---

# 202. Domain Contract 与 UI 文案分离

Contract 使用稳定英文 Key：

```text
magnetic_flux_density
```

UI 中文显示：

```text
磁感应强度
```

禁止使用中文字段名作为跨服务 Schema。

---

# 203. Domain Contract 与 Model Provider 分离

Contract 中禁止出现：

```text
deepseek_message_id
claude_tool
openai_response
```

等 Provider 特定结构。

这些只能存在 Adapter 内。

---

# 204. Domain Contract 与 Renderer 分离

PhysicsScene 禁止出现：

```text
pixiSprite
mesh
materialColorHex
cssClass
domId
```

可视化语义通过：

```text
Observable
Visual Model
Design Token
```

管理。

---

# 205. Domain Contract 与 Database 分离

PhysicsScene 不出现：

```text
hibernateLazyProxy
rowVersion
databaseId
```

等 persistence-specific 内容。

---

# 206. Domain Contract 与 Platform 分离

File Contract 不应假设：

```text
Windows path
Browser Blob
```

统一通过 `FileRef` 与 PlatformBridge。

---

# 207. 最关键 Contract 链

PhysicsOS 最核心链路：

```text
QuestionDocument
        ↓
Diagram IR
        ↓
Physics IR
        ↓
SceneBuildResult
        ↓
PhysicsScene
        ↓
SimulationRequest
        ↓
SimulationResult
        ↓
VerificationResult
        ↓
ObservationPlan
        ↓
Visual Scene Model
```

Agent：

```text
PhysicsAgentContext
        ↓
ToolCall
        ↓
ToolResult
        ↓
Physics Event
        ↓
Scene Revision
```

---

# 208. Contract Debugging

任何跨模块异常优先检查：

```text
schemaVersion
producer version
consumer version
traceId
scene revision
tool call id
unit
evidence
```

不要第一时间在 Consumer 写临时兼容代码。

---

# 209. Contract 修改流程

任何公共 Contract 修改：

```text
提出 Change
↓
确认 Owner
↓
评估 Breaking
↓
修改 Schema
↓
增加 Migration
↓
更新 Contract Tests
↓
更新 Producer
↓
更新 Consumer
↓
更新本文档
```

---

# 210. AI Agent 修改 Contract 规则

Codex / Cursor / Claude Code / 自动 Agent 不得自行修改：

```text
PhysicsScene
Physics IR
Diagram IR
SimulationResult
Physics Event
Tool Schema
Agent Context
```

除非任务明确授权。

---

# 211. Contract Review

Review 必须检查：

```text
字段是否重复
字段语义是否明确
是否携带单位
是否可序列化
是否包含 Provider-specific 数据
是否破坏已有 Consumer
是否需要 Migration
是否有 Contract Test
```

---

# 212. Contract Definition of Done

新的公共 Contract 只有同时满足以下条件才完成：

```text
TypeScript Type
JSON Schema
Validation
Valid Example
Invalid Example
Contract Tests
Owner
Version
Documentation
Migration Strategy
```

---

# 213. PhysicsScene 最终原则

PhysicsScene 表达：

> **世界是什么。**

不是：

```text
页面怎么画
Agent 怎么说
数据库怎么存
```

---

# 214. Physics IR 最终原则

Physics IR 表达：

> **题目在物理语义上说了什么。**

不是：

```text
答案
动画
最终 Simulation
```

---

# 215. SimulationResult 最终原则

SimulationResult 表达：

> **在某一个明确 Scene Revision 与 Engine Version 下，物理世界如何演化。**

必须可追溯、可复现。

---

# 216. Tool Contract 最终原则

Tool 表达：

> **Agent 被允许对 PhysicsOS 做什么结构化动作。**

不是万能 Prompt 通道。

---

# 217. Agent Context 最终原则

Agent Context 保存：

> **完成当前任务所需的最小结构化认知状态。**

不能代替 PhysicsScene。

---

# 218. 最终跨模块原则

任何跨模块传输的数据都应该能够回答：

```text
它是什么？
谁拥有它？
哪个版本？
使用什么单位？
来自哪里？
当前 Scene Revision 是什么？
能否验证？
能否追踪？
```

---

# 219. 一句话领域契约原则

> **PhysicsOS 的所有模块必须通过明确、版本化、可验证的 Contract 协作；任何模块不得通过共享隐式状态、自由文本猜测或重复定义领域对象来耦合。**
