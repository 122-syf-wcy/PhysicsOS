# PhysicsOS 工程开发规范

> 文件：`docs/02-ENGINEERING-STANDARDS.md`  
> 文档定位：PhysicsOS 全项目强制工程规范  
> 上游文档：`00-PRODUCT-OVERVIEW.md`、`01-DEVELOPMENT-GUIDE.md`  
> 下游契约：`03-DOMAIN-CONTRACTS.md`
>
> 本规范对人工开发、Codex、Cursor、Claude Code、自动化 Agent、多 Agent 协同开发全部生效。

---

# 1. 文档目的

本文档回答一个问题：

> **PhysicsOS 的所有代码必须按照什么规则开发？**

PhysicsOS 不是普通 CRUD 项目。

它同时包含：

```text
物理领域模型
实时仿真
可视化
试题解析
多模态理解
Agent Runtime
Tools
Skills
上下文压缩
学习状态
Web
未来 Windows Desktop
```

如果没有统一工程规范，很容易出现：

```text
UI 自己计算物理结果
Agent 直接修改 Scene
Renderer 内部维护第二套状态
每个模块自己定义单位
每个开发者写一套 Tool
Web 与 Desktop 重复代码
LLM 直接生成假仿真结果
为了跑通测试删除失败用例
```

因此，本文件中的“禁止”“必须”“不得”均视为强制规则。

---

# 2. 规范等级

PhysicsOS 规范分为四级。

## 2.1 P0 — 架构红线

违反即必须停止合并。

包括：

```text
物理事实源
Physics Engine 边界
PhysicsScene Mutation
Agent Tool Guard
Contract
安全
测试真实性
```

---

## 2.2 P1 — 强制工程规则

原则上不得违反。

例如：

```text
命名
状态管理
日志
错误结构
单位
Git
测试
API
```

---

## 2.3 P2 — 推荐实践

无特殊理由应遵守。

例如：

```text
目录组织
组件拆分
Hook 组织
性能优化方式
```

---

## 2.4 P3 — 风格建议

可以在不影响一致性的情况下调整。

---

# 3. 第一架构原则：Physics Engine 决定物理结果

PhysicsOS 最核心规则：

> **LLM 不决定真实物理结果，Physics Engine 决定。**

LLM 负责：

```text
理解题目
提取条件
规划求解
选择 Tools
决定教学策略
解释结果
```

Physics Engine 负责：

```text
受力
轨迹
速度
加速度
场
能量
电路状态
碰撞
运动状态
```

---

# 4. 禁止 LLM 伪造真实仿真结果

禁止：

```text
LLM 根据公式直接构造 SimulationResult
LLM 生成一组轨迹坐标冒充 Physics Engine 结果
LLM 自行决定 Scene 的最终状态
```

例如以下做法禁止：

```ts
const trajectory = await llm.generate("生成一条圆周运动轨迹")
```

作为真实 Scene 结果。

允许：

```text
LLM 提议参数
↓
Tool
↓
Physics Engine
↓
SimulationResult
```

---

# 5. PhysicsScene 是唯一物理事实源

当前物理世界的正式状态必须来自：

```text
PhysicsScene Runtime
```

以下都不是事实源：

```text
React State
Zustand
Canvas Object
Pixi Sprite
Three Object3D
Agent Prompt
Chat History
Working Memory
数据库中的临时 View
```

它们只能：

```text
引用
投影
缓存
展示
```

PhysicsScene。

---

# 6. 禁止出现第二套 Scene 状态

禁止：

```text
Zustand 中保存完整 Scene
+
PhysicsScene Runtime 中再保存 Scene
```

形成“双主状态”。

允许 Zustand 保存：

```text
selectedObjectId
activeTool
sidebarWidth
canvasZoom
```

不允许保存并独立维护：

```text
particle.mass
body.velocity
field.strength
```

---

# 7. 禁止直接 Mutation PhysicsScene

禁止：

```ts
scene.particles[0].mass.value = 2
scene.fields.push(field)
scene.timeline.currentTime = 3
```

所有 Scene 修改必须经过：

```text
Command
↓
Validation
↓
Event
↓
Reducer
↓
New Revision
```

---

# 8. Scene Command 规则

Command 表示“希望发生什么”。

命名使用动词：

```text
CreateScene
AddBody
AddParticle
ChangeParameter
AddMagneticField
SeekTimeline
StartSimulation
```

Command 必须包含：

```text
commandId
sceneId
expectedRevision
type
payload
actor
traceId
```

---

# 9. Scene Event 规则

Event 表示“已经发生什么”。

事件命名必须使用过去式：

```text
SceneCreated
BodyAdded
ParticleAdded
ParameterChanged
TimelineSeeked
SimulationStarted
```

禁止：

```text
AddBodyEvent
ChangeThing
DoSimulation
```

---

# 10. Scene Revision

每个有效 Scene Mutation：

```text
revision + 1
```

Revision 必须：

```text
单调递增
不可回退
不可复用
```

写操作携带：

```text
expectedRevision
```

发生冲突返回：

```text
SCENE_REVISION_CONFLICT
```

---

# 11. Event 不可被修改

已经持久化的 Physics Event：

> **不可修改。**

发现错误时：

```text
追加新的纠正 Event
```

不要篡改历史。

这是 Replay、Audit、Undo、Branch 能成立的基础。

---

# 12. Snapshot 不替代 EventStore

Snapshot 只是：

```text
快速恢复
快速 Seek
Branch 基点
大型 Scene 加速
```

不能因为有 Snapshot 就删除关键 Event 语义。

---

# 13. Physics Core 纯净性

以下 package：

```text
physics-core
physics-scene
physics-units
各 engine-*
physics-verifier
```

禁止依赖：

```text
React
DOM
PixiJS
Three.js
DeepSeek Harness
Tauri
Spring Controller
数据库 ORM
Redis Client
具体 HTTP Framework
```

---

# 14. UI 禁止计算核心物理结果

禁止在 React：

```tsx
const radius = m * v / (q * B)
```

直接作为正式结果。

正确：

```text
UI
↓
Application
↓
Physics Runtime
↓
Physics Engine
↓
Result
↓
UI
```

UI 可以进行：

```text
格式化
单位显示
简单百分比
布局计算
```

不能承担领域求解。

---

# 15. Renderer 禁止参与物理求解

Renderer 负责：

```text
绘制
动画表现
坐标映射
Camera
Viewport
Hit Test
Selection
Render Layer
```

禁止 Renderer：

```text
判断洛伦兹力方向
计算轨迹半径
求受力合力
计算电势
计算电流
判断碰撞后的速度
```

---

# 16. Renderer 不得写回领域状态

禁止：

```text
拖动 Pixi Sprite
↓
直接修改 Particle.position
```

正确：

```text
Pointer Interaction
↓
Interaction Controller
↓
Scene Command
↓
PhysicsScene Runtime
↓
Renderer Subscription
```

---

# 17. Observation 与 Physics Engine 分离

Physics Engine 决定：

```text
现实状态
```

Observation 决定：

```text
学生当前看到什么
```

例如：

```text
洛伦兹力真实存在
```

和：

```text
界面是否显示洛伦兹力箭头
```

是两回事。

显示与隐藏必须由：

```text
Observation Layer
```

控制。

---

# 18. 2D / 3D 数据模型统一

不能为 2D 和 3D 分别做两套 PhysicsScene。

领域统一使用：

```text
Vector3
```

2D 场景：

```text
z = 0
```

Renderer 决定以 2D 或 3D 展现。

---

# 19. 单位体系最高规则

PhysicsOS 内部计算统一使用：

> **SI Canonical Units**

包括：

```text
长度 m
时间 s
质量 kg
电荷 C
电流 A
力 N
能量 J
电压 V
磁感应强度 T
速度 m/s
加速度 m/s²
```

UI 可显示：

```text
cm
mm
km
km/h
μC
mC
mT
ms
μs
ns
```

进入 Engine 前必须转换。

---

# 20. 禁止重要物理量使用裸 number

不推荐：

```ts
interface Particle {
  mass: number
}
```

应使用：

```ts
interface Quantity<D extends PhysicalDimension> {
  value: number
  unit: UnitSymbol
  dimension: D
}
```

或 Canonical Quantity。

---

# 21. 量纲检查

任何公式、Tool、Simulation 输入应能够执行：

```text
Dimension Validation
```

例如：

```text
质量 + 时间
```

应在进入 Physics Engine 前被拒绝。

---

# 22. 浮点比较

禁止：

```ts
a === b
```

用于物理浮点结果判断。

统一使用：

```text
absoluteTolerance
relativeTolerance
domainTolerance
```

示意：

```ts
isClose(actual, expected, {
  absolute: 1e-9,
  relative: 1e-6
})
```

---

# 23. 数值稳定性

Engine 必须明确：

```text
timeStep
solver
tolerance
maxIterations
convergence condition
```

禁止使用无法解释的魔法常数。

---

# 24. 仿真确定性

相同：

```text
Scene
Scene Revision
Engine Version
Simulation Options
Random Seed
```

应得到可重复结果。

任何随机过程必须保存：

```text
randomSeed
```

---

# 25. 时间步与显示帧率分离

必须区分：

```text
solver timestep
storage sample rate
render frame rate
chart sample rate
```

禁止：

```text
60fps = Physics Solver 只算 60 次每秒
```

这种耦合。

---

# 26. 性能计算禁止阻塞 UI

高耗时浏览器 Simulation：

```text
Web Worker
```

主线程：

```text
UI
Interaction
Renderer
```

Worker：

```text
Physics Calculation
Trajectory Generation
Large Sampling
```

---

# 27. React 状态规范

状态明确分四类。

## UI State

Zustand：

```text
sidebarOpen
activeTab
selectedObjectId
workspaceLayout
zoom
temporarySelection
```

---

## Server State

TanStack Query：

```text
user
questions
exams
learning records
experiments
resources
```

---

## Physics State

PhysicsScene Runtime：

```text
body
particle
field
force
circuit
timeline
revision
```

---

## Agent State

Agent Runtime：

```text
session
run
turn
tool call
stream
status
```

禁止混成一个 Store。

---

# 28. Zustand 使用规范

禁止创建：

```text
useEverythingStore
```

包含整个系统。

Store 按 UI 领域拆。

例如：

```text
useWorkspaceLayoutStore
useCanvasUIStore
useQuestionUIStore
```

---

# 29. TanStack Query 使用规范

后端资源读取通过 Query。

Mutation 完成后：

```text
invalidate / update cache
```

不要将服务端数据复制进 Zustand 长期维护。

---

# 30. React 组件职责

组件分为：

```text
Page
Feature
Container
Presentational
Primitive
```

Page 负责组合。

禁止页面文件包含：

```text
巨大领域逻辑
复杂计算
大量 API 细节
大量 Engine 逻辑
```

---

# 31. React Component 大小

没有绝对行数限制，但出现以下情况必须拆：

```text
同时处理多个业务领域
超过 3 层嵌套副作用
大量条件渲染
同时管理 API、Canvas、Agent、表单
难以单独测试
```

---

# 32. Hook 规范

复杂逻辑优先拆 Hook：

```text
usePhysicsWorkspace
useTimeline
useSceneSelection
useObservablePanel
useAgentSession
```

禁止创建：

```text
useEverything()
```

1000 行大 Hook。

---

# 33. TypeScript 严格模式

必须：

```json
{
  "strict": true
}
```

原则上禁止：

```ts
any
// @ts-ignore
// @ts-nocheck
```

优先：

```text
unknown
generic
type guard
discriminated union
```

---

# 34. any 例外

如果第三方库边界确实只能使用 any：

必须：

```text
限制在 Adapter
写注释说明原因
尽快转换为内部安全类型
```

禁止 any 向领域层扩散。

---

# 35. ID 类型

禁止整个项目都用普通：

```ts
string
```

表达 ID。

推荐 branded type：

```ts
type SceneId = Brand<string, 'SceneId'>
type ParticleId = Brand<string, 'ParticleId'>
type FieldId = Brand<string, 'FieldId'>
type ToolCallId = Brand<string, 'ToolCallId'>
```

---

# 36. Discriminated Union

领域对象优先使用：

```ts
type Field =
  | UniformElectricField
  | UniformMagneticField
  | GravityField
```

以 `type` 作为 discriminator。

避免：

```text
大量 optional 字段
```

构造模糊对象。

---

# 37. 函数设计

一个函数只做一个主要工作。

禁止：

```text
parseQuestionAndBuildSceneAndSolveAndSave()
```

拆成：

```text
parseQuestion()
buildPhysicsIR()
buildScene()
simulateScene()
saveResult()
```

---

# 38. 纯函数优先

以下逻辑优先纯函数：

```text
单位转换
Vector
Geometry
Scene Reducer
Formula
Parser Normalize
Verifier
```

便于测试和复现。

---

# 39. 禁止 Magic Number

禁止：

```ts
if (speed > 999999) {}
```

没有解释。

必须通过：

```text
named constant
config
domain rule
```

定义。

---

# 40. 文件命名

TypeScript：

```text
kebab-case.ts
kebab-case.tsx
```

例如：

```text
physics-workspace.tsx
scene-reducer.ts
magnetic-engine.ts
```

React Component 导出仍使用 PascalCase。

---

# 41. Java 命名

遵守标准 Java：

```text
PascalCase class
camelCase method
UPPER_SNAKE_CASE constant
```

数据库：

```text
snake_case
```

---

# 42. Python 命名

遵守：

```text
PEP 8
snake_case
PascalCase class
```

---

# 43. Package API

Package 对外 API 必须集中暴露。

例如：

```text
packages/physics-scene/src/index.ts
```

禁止其他 package 深层 import：

```ts
import x from '@physics/scene/src/internal/reducer/private'
```

---

# 44. internal 目录

不稳定内部实现可以放：

```text
internal/
```

其他 package 不得依赖。

---

# 45. 循环依赖

禁止 package 循环依赖。

正确：

```text
renderer
↓
observation
↓
physics contracts
```

禁止：

```text
renderer ↔ physics-core
```

互相引用。

---

# 46. 依赖方向

长期保持：

```text
Apps
 ↓
Application
 ↓
Domain
 ↓
Core
```

底层不得反向依赖上层。

---

# 47. Platform 隔离

业务代码禁止直接依赖：

```text
Tauri API
Node fs
Browser 特殊 API
```

统一通过：

```text
PlatformBridge
```

---

# 48. BrowserPlatformBridge

处理：

```text
File API
Download
Clipboard
Browser Notification
```

---

# 49. TauriPlatformBridge

处理：

```text
Native File Dialog
Local FS
Windows Notification
Sidecar
Auto Update
```

---

# 50. DeepSeek Harness 隔离

正式 Web 展示集成边界只有：

```text
vendor/deepseek-harness/apps/web
vendor/deepseek-harness/packages/client/ui-physicsos
```

它们可以依赖已声明的 Harness 客户端插件、layout、sidebar 与 conversation slot contract。

PhysicsOS Agent/Domain 包中只有：

```text
agent-dsh-adapter
```

允许直接依赖 DeepSeek Harness Agent Runtime。

禁止：

```text
physics-core
question-parser
physics-scene
physics-verifier
physics-observation
```

直接依赖 Harness。客户端展示契约与 Agent Runtime 内部 API 不得扩散到上述领域包。

根目录 `apps/web` 是废弃的独立原型，不得继续新增正式功能或作为发布入口。

---

# 51. Agent 不允许直接修改 Scene

禁止：

```text
Agent
↓
SceneStore.patch()
```

必须：

```text
Agent
↓
Physics Tool
↓
Tool Guard
↓
Scene Command
↓
Scene Runtime
```

---

# 52. Tool 命名规范

统一：

```text
physics.<domain>.<action>
```

例如：

```text
physics.scene.create
physics.scene.seek
physics.mechanics.net_force
physics.magnetic.lorentz_force
physics.circuit.solve
physics.observe.force
```

---

# 53. 禁止万能 Tool

禁止：

```text
physics.solve_everything
simulate_physics(prompt)
modify_scene(any)
do_physics()
```

Tool 必须：

```text
职责单一
输入明确
输出明确
副作用明确
```

---

# 54. Tool Schema

每个 Tool 必须有：

```text
name
description
inputSchema
outputSchema
permission
timeout
error codes
```

禁止输入只定义：

```json
{
  "prompt": "string"
}
```

然后内部随意解析一切。

---

# 55. Tool Guard

所有写操作至少经过：

```text
Schema Validation
Permission Validation
Unit Validation
Domain Validation
Physics Constraint Validation
Revision Validation
Timeout
Audit
```

---

# 56. Tool Error

统一结构：

```json
{
  "code": "INVALID_PHYSICS_PARAMETER",
  "message": "Mass must be greater than zero.",
  "retryable": false,
  "details": {}
}
```

标准错误至少覆盖：

```text
INVALID_UNIT
INVALID_PARAMETER
OBJECT_NOT_FOUND
SCENE_REVISION_CONFLICT
PHYSICS_CONSTRAINT_VIOLATION
UNSUPPORTED_MODEL
SIMULATION_FAILED
VERIFICATION_FAILED
TOOL_PERMISSION_DENIED
TOOL_TIMEOUT
```

---

# 57. Tool Result 禁止自由文本化

Tool 的真实结果必须结构化。

允许附加：

```text
humanReadableSummary
```

但不能只有：

```text
“半径大约是 2cm。”
```

---

# 58. Prompt 管理

禁止：

```text
一个 system_prompt.txt 放整个项目所有规则
```

Prompt 必须模块化：

```text
Identity
Constitution
Mode
Domain
Skill
Scene Reference
Objective
Student State
Tool Policy
Teaching Policy
Recent Context
```

---

# 59. Prompt 版本化

关键 Prompt 必须有：

```text
id
version
change log
tests
```

Agent 行为改变时必须可追踪。

---

# 60. Prompt 不散落在代码中

禁止几十个：

```ts
const prompt = `你是...`
```

散落页面和 service。

统一进入：

```text
agent-prompt
```

---

# 61. Context 分层

严格使用：

```text
L0 Constitution
L1 Domain
L2 Learning State
L3 Scene Reference
L4 Working Memory
L5 Recent Conversation
L6 Retrieval
```

---

# 62. Scene 不塞进 Prompt

禁止每轮将整个：

```json
PhysicsScene
```

序列化塞给模型。

Context 只保存：

```text
sceneId
revision
snapshotId
必要 Observation
当前任务相关 Slice
```

---

# 63. Context Compaction

压缩必须保留结构化事实：

```text
task
scene
confirmedFacts
derivedFacts
completedSteps
pendingSteps
misconceptions
importantEvents
```

禁止只生成：

```text
用户正在学习磁场。
```

---

# 64. Memory 分类

Memory 必须分类：

```text
Session Memory
Learning Memory
Scene Memory
Error Memory
Knowledge Memory
Preference Memory
```

禁止一个 Vector Store 全塞进去就叫 Memory。

---

# 65. Learning Memory

Learning Memory 应保存：

```text
知识点
错误模式
掌握程度
置信度
证据
更新时间
```

不要只保存一句模糊文本。

---

# 66. Solver 与 Tutor 分离

Solver 回答：

> **怎么正确得到结果。**

Tutor 回答：

> **怎么让学生理解。**

禁止 Solver 为了“教学体验”修改真实答案。

禁止 Tutor 自己重新推导出与 Solver 不一致的物理事实。

---

# 67. Verifier 优先规则

验证顺序：

```text
Schema
↓
Unit
↓
Math
↓
Physics Constraint
↓
Conservation / Invariant
↓
Numerical
↓
LLM Semantic Review
```

LLM 只能做最后补充。

---

# 68. Question Parser 原则

Question Parser 输出：

```text
Physics IR
```

不得直接输出：

```text
最终 Canvas 坐标
SimulationResult
Renderer Object
```

---

# 69. Physics IR 必须保留证据

从题目抽取的关键条件尽量关联：

```text
text range
page
bounding box
diagram element
confidence
```

避免 Agent 不知道：

> 这个 B=0.5T 是哪里来的。

---

# 70. Diagram Parser 原则

图像识别不能止于：

```text
“图中有一个斜面和小球。”
```

需要结构化成：

```text
Diagram IR
```

再映射 PhysicsScene。

---

# 71. Question → Scene 必须可检查

Scene Builder 完成后必须可输出：

```text
对象
条件
假设
未确定项
映射证据
Scene Validation
```

不允许黑箱生成 Scene 后直接运行。

---

# 72. 动态题生成原则

Dynamic Question 必须以：

```text
PhysicsScene
+
Question Pattern
+
Variable Policy
```

为基础。

不能纯 LLM 随机编数字。

---

# 73. API 路径规范

业务 API：

```text
/api/v1/*
```

Agent：

```text
/agent/v1/*
```

Simulation：

```text
/simulation/v1/*
```

Document：

```text
/document/v1/*
```

Math：

```text
/math/v1/*
```

---

# 74. REST 命名

推荐：

```text
GET /api/v1/questions/{id}
POST /api/v1/scenes
PATCH /api/v1/scenes/{id}
```

禁止：

```text
/api/getQuestion
/api/createSceneNow
```

---

# 75. API DTO

对外接口必须使用：

```text
Request DTO
Response DTO
```

禁止直接暴露：

```text
Database Entity
ORM Model
Internal Scene Aggregate
```

---

# 76. API Error

统一：

```json
{
  "error": {
    "code": "SCENE_REVISION_CONFLICT",
    "message": "Scene revision conflict.",
    "traceId": "trace_xxx",
    "details": {}
  }
}
```

---

# 77. HTTP Status

基本约定：

```text
200 成功查询
201 创建成功
204 无响应体成功
400 请求结构错误
401 未认证
403 无权限
404 资源不存在
409 Revision / Conflict
422 领域验证失败
429 Rate Limit
500 内部错误
503 下游不可用
```

---

# 78. Java 分层

Spring Boot 业务服务：

```text
controller
application
domain
infrastructure
```

Controller 负责：

```text
HTTP
Validation
DTO conversion
```

禁止 Controller 写领域业务。

---

# 79. Java Entity

数据库 Entity 不直接作为 Response DTO。

Domain Model 与 Persistence Model 可根据复杂度隔离。

---

# 80. 数据库 Migration

所有 Schema 修改必须：

```text
migration
```

推荐：

```text
Flyway
```

禁止手工修改生产数据库后不留记录。

---

# 81. 数据库命名

统一：

```text
snake_case
```

例如：

```text
scene_id
scene_revision
physics_event_id
created_at
```

---

# 82. 时间规范

后端与数据库统一：

```text
UTC
```

客户端转换本地时间。

字段命名：

```text
created_at
updated_at
started_at
finished_at
```

---

# 83. 文件上传

上传必须检查：

```text
MIME
extension consistency
size
hash
malware / dangerous format
owner
```

复杂文档解析应隔离运行。

---

# 84. Object Storage

大型文件不要直接存数据库 BLOB。

数据库存：

```text
object_key
sha256
size
content_type
owner
metadata
```

---

# 85. Redis 规范

Redis 只适合：

```text
Cache
Lock
Queue
Rate Limit
Temporary Runtime
```

禁止唯一保存：

```text
PhysicsScene Event
Question
Learning Record
```

等永久数据。

---

# 86. Vector Store 规范

Vector Store 用于：

```text
Retrieval
Semantic Search
```

不是关系数据库替代品。

---

# 87. 日志结构

日志必须结构化。

至少支持：

```text
timestamp
level
service
event
traceId
userId
sessionId
runId
sceneId
sceneRevision
toolCallId
```

---

# 88. 禁止日志敏感信息

禁止输出：

```text
Password
API Key
完整 Access Token
Authorization Header
身份证原文
私密文件完整内容
```

---

# 89. console.log

正式业务代码禁止无控制：

```ts
console.log(...)
```

统一使用 Logger。

浏览器开发日志需支持：

```text
level
namespace
environment control
```

---

# 90. Trace ID

跨服务链路必须沿用：

```text
traceId
```

Agent 追加：

```text
sessionId
runId
turnId
toolCallId
```

Physics 追加：

```text
sceneId
sceneRevision
physicsEventId
```

---

# 91. 错误处理

禁止：

```text
catch (e) {}
```

吞掉异常。

必须：

```text
处理
转换
记录
重新抛出
```

三选一或组合。

---

# 92. 用户错误与系统错误分离

例如：

```text
INVALID_PARAMETER
```

属于用户/模型输入错误。

```text
SIMULATION_INTERNAL_ERROR
```

属于系统错误。

不要统一显示：

```text
Something went wrong
```

而后台无可追踪信息。

---

# 93. Graceful Degradation

非核心能力失败时可降级。

例如：

```text
Agent 暂时不可用
```

不应阻止用户手工使用已有 PhysicsScene 实验。

但：

```text
Physics Engine 验证失败
```

不能伪装成功继续展示假结果。

---

# 94. 测试最高规则

以下 package 无测试不得合并：

```text
physics-core
physics-scene
physics-units
physics-verifier
physics-ir
agent-tools
question-parser
```

---

# 95. Unit Tests

应覆盖：

```text
Vector
Unit Conversion
Scene Reducer
Command Validation
Geometry
Formula
Tool Guard
Parser Normalization
```

---

# 96. Physics Golden Tests

必须为经典模型建立稳定 Golden Case。

至少包括：

```text
匀速直线运动
匀变速运动
自由落体
竖直上抛
平抛
斜抛
圆周运动
斜面受力
摩擦
弹簧
动量守恒
完全弹性碰撞
库仑力
匀强电场偏转
带电粒子匀强磁场运动
速度选择器
简单串并联
闭合电路
法拉第电磁感应
```

---

# 97. Golden Test 原则

Golden Test 不只是：

```text
snapshot 一个大 JSON
```

核心物理量要明确断言：

```text
公式
数值范围
守恒量
方向
运动类型
周期
轨迹性质
```

---

# 98. Bug 修复规范

修复核心 Physics Bug：

> **先增加失败的回归测试，再修复代码。**

禁止只改代码不留测试。

---

# 99. Agent Contract Test

重点测试：

```text
Tool Schema
Tool Permission
Tool Output
Context Compaction
Role Tool Scope
Scene Builder Contract
Physics IR Contract
```

不要把主要测试目标设为：

```text
模型措辞是否漂亮
```

---

# 100. Integration Test

覆盖：

```text
Question
↓
Physics IR
↓
Scene Builder
↓
PhysicsScene
↓
Simulation
↓
Verifier
↓
Observation
```

---

# 101. E2E Test

Web 核心流程使用 Playwright。

至少：

```text
进入实验室
打开实验
修改参数
运行
暂停
Seek Timeline
切换 Observable
询问 Agent
```

试题：

```text
上传题目
解析
生成 Scene
进入可视化
查看解析
在物理世界中打开
```

---

# 102. Visual Regression

适合：

```text
Physics Workspace
受力图
磁场区域
电场线
轨迹
电路图
核心 UI
```

视觉测试不替代 Physics Golden Test。

---

# 103. Snapshot Test

禁止滥用 Snapshot Test。

核心 Physics Result 应明确断言。

UI Primitive 可合理 Snapshot。

---

# 104. Test Mock

允许 Mock：

```text
不可控第三方模型
网络
Object Storage
```

禁止 Mock：

```text
本来应该实现的 Physics Engine
真实 Tool Handler
核心领域功能
```

然后宣称开发完成。

---

# 105. 禁止删除失败测试

AI 或人工不得：

```text
删测试
.skip
.only
修改 expected 为错误结果
```

只是为了 CI 通过。

---

# 106. CI 必须通过

PR 最少：

```text
format check
typecheck
lint
unit tests
physics golden tests
agent contract tests
build
```

核心改动追加：

```text
integration
e2e
visual regression
```

---

# 107. Git 主分支

长期主分支：

```text
main
```

必须保持：

```text
可构建
核心测试通过
```

---

# 108. Git 分支命名

```text
feat/physics-scene
feat/magnetic-engine
feat/question-parser
fix/lorentz-direction
refactor/agent-runtime
docs/domain-contract
```

---

# 109. Commit 规范

使用 Conventional Commits。

例如：

```text
feat(scene): add field region model
feat(magnetic): support uniform field particle motion
fix(units): correct microcoulomb conversion
refactor(agent): isolate harness adapter
test(mechanics): add projectile golden cases
docs(contract): define simulation result schema
```

---

# 110. 禁止巨型 Commit

禁止：

```text
feat: update project
```

包含几百个无关文件。

Commit 应表达单一逻辑目的。

---

# 111. PR 内容

必须说明：

```text
What
Why
Affected Modules
Contract Changes
Tests
Risks
Screenshots / Recording
Migration
```

---

# 112. Breaking Change

以下修改视为 Breaking：

```text
PhysicsScene 字段
Physics IR 字段
Tool Schema
Physics Event
SimulationResult
公共 Package API
服务 API
```

必须：

```text
明确标记 BREAKING CHANGE
更新 Contract
更新 Migration
更新 Tests
```

---

# 113. 文档同步

修改以下内容必须同步文档：

```text
架构
Contract
Public Tool
Public API
Physics Domain
状态机
上下文层
重大目录
```

---

# 114. TODO 规范

禁止使用 TODO 代替核心实现，然后宣称完成。

TODO 必须：

```text
描述具体
标 Issue / task
不影响当前功能完整性
```

---

# 115. Feature Flag

未完成但需要合并的实验能力：

应放 Feature Flag 后。

禁止半成品直接暴露正式用户。

---

# 116. UI 视觉规范

PhysicsOS 主视觉：

```text
暖白
雾白
自然蓝
冰蓝透明层
少量青绿
极少量警告橙
深灰文字
```

禁止：

```text
大面积死紫色
紫色渐变满屏
暗黑赛博朋克
廉价发光
传统政务/教育后台蓝
```

---

# 117. UI 层级

优先：

```text
留白
内容层级
物理世界主视觉
细线
轻阴影
克制 Glass
```

不要所有内容都做卡片。

---

# 118. Glass 使用

液态玻璃只用于：

```text
导航
浮层
Inspector
Toolbar
重要 Overlay
```

禁止每一层都 Blur。

---

# 119. 颜色语义

建议：

```text
Blue    = Primary / Physics
Green   = Success / Valid
Orange  = Warning / Energy
Red     = Error / Danger
Gray    = Neutral
```

颜色不能随页面随意改变语义。

---

# 120. Physics 可视化颜色

Force、Velocity、Acceleration 等应建立统一设计 Token。

设计 Token 在 UI Design System 中定义。

业务代码不得随意：

```ts
color: '#ff00ff'
```

---

# 121. Accessibility

重要操作必须支持：

```text
Keyboard
Focus
ARIA
High Contrast consideration
```

颜色不能作为唯一状态表达方式。

---

# 122. Responsive 范围

主攻：

```text
1366×768
1440×900
1600×900
1920×1080
```

Physics Workspace 优先桌面横屏体验。

移动端暂不作为核心工作台目标。

---

# 123. Canvas 性能

禁止 React 每个 Frame 更新整棵组件树。

Renderer 应有独立更新循环。

React 只订阅：

```text
低频摘要
Selection
Panel Data
Status
```

---

# 124. 大数据轨迹

长时间 Simulation 必须：

```text
sampling
decimation
chunk
```

不能无限保留每个 solver step。

---

# 125. Worker 通信

Worker 消息必须使用明确 Contract。

禁止传：

```text
任意对象
function
DOM reference
```

---

# 126. 安全权限

Tool 权限至少分类：

```text
read
scene-write
content-write
teacher-write
admin
dangerous
```

默认最小权限。

---

# 127. Agent 权限继承

Agent 不拥有高于当前用户的权限。

禁止：

```text
学生通过 Agent 调用 Teacher/Admin Tool
```

---

# 128. Rate Limit

至少针对：

```text
LLM
OCR
VLM
Document Parsing
Heavy Simulation
Export
```

设置合理限流。

---

# 129. Timeout

所有：

```text
Tool
Model
Document Parse
Simulation
Math Service
```

必须定义 Timeout。

不能无限等待。

---

# 130. Retry

只对：

```text
可重试的网络错误
临时服务错误
```

自动 Retry。

领域验证失败不能无限 Retry。

---

# 131. Idempotency

以下操作应支持 Idempotency：

```text
文件上传初始化
任务创建
支付类未来功能
重要 Scene Command
```

---

# 132. 数据隐私

学生：

```text
试卷
学习记录
聊天
上传文件
```

必须按用户和权限隔离。

开发日志不输出完整私密内容。

---

# 133. 数据删除

用户删除资源后，应有明确：

```text
metadata delete
object delete
derived data cleanup
```

策略。

---

# 134. AI 开发 Agent 必须先阅读文档

任何 Codex / Cursor / Claude Code / Agent 在修改代码前：

必须按顺序阅读：

```text
00-PRODUCT-OVERVIEW.md
01-DEVELOPMENT-GUIDE.md
02-ENGINEERING-STANDARDS.md
03-DOMAIN-CONTRACTS.md
目标 Package README
相关 Tests
```

---

# 135. AI Agent 禁止私自重构总架构

没有明确任务，不得：

```text
更换技术栈
删除领域层
改状态架构
重写 Contract
替换 Agent Runtime
把多个 package 合并成一个
```

---

# 136. AI Agent 禁止重复造轮子

修改前必须搜索：

```text
已有 package
已有 type
已有 util
已有 tool
已有 schema
已有 test helper
```

禁止出现：

```text
PhysicsScene2
NewPhysicsScene
AnotherUnitSystem
ToolRegistryV2
```

只因为没有先阅读代码。

---

# 137. AI Agent 禁止无关修改

任务：

```text
修复磁场轨迹
```

禁止顺手：

```text
重写首页
升级全部依赖
格式化整个仓库
重构 Agent
```

---

# 138. AI Agent 禁止假完成

不能称为完成：

```text
UI 有按钮但没功能
返回 Hard-coded Result
Simulation 使用 Mock
Agent 使用预设回复
Tool 没接 Runtime
只实现 Happy Path
```

---

# 139. AI Agent 必须真实验证

任务完成前至少执行相关：

```text
typecheck
lint
unit tests
golden tests
build
```

根据范围追加：

```text
integration
e2e
```

---

# 140. AI Agent 完成报告

必须输出：

```text
完成内容
修改文件
关键设计
Contract 是否变化
测试命令
测试结果
未完成内容
风险
```

---

# 141. 多 Agent 协同

并行开发前必须明确：

```text
Owner Module
Allowed Files
Shared Contracts
Integration Point
```

避免多个 Agent 同时修改核心 Contract。

---

# 142. Shared Contract 修改锁

以下文件/模块修改需串行协调：

```text
03-DOMAIN-CONTRACTS.md
physics-scene public API
physics-ir public API
Tool Schema
Physics Event Schema
SimulationResult
```

---

# 143. Definition of Done

功能只有满足以下全部条件才算完成：

```text
真实代码完成
真实功能接通
类型检查通过
Lint 通过
Unit Test 通过
相关 Physics Golden Test 通过
必要 Contract Test 通过
Build 通过
必要 E2E 通过
无核心 Mock
无假成功
无隐藏失败
Contract 已同步
文档已同步
```

---

# 144. 不算完成的情况

以下明确不算完成：

```text
页面做完但没后端
Tool 注册了但 execute 是 TODO
Agent 回复看起来对但没调用 Physics Engine
Scene 可以显示但不能保存/replay
测试被 skip
接口用固定 JSON
```

---

# 145. Package README 要求

重要 package 必须有 README，说明：

```text
Purpose
Responsibilities
Public API
Allowed Dependencies
Forbidden Dependencies
Contracts
Usage Example
Test Command
```

---

# 146. Code Review 检查表

Review 至少检查：

```text
是否违反领域边界
是否产生第二事实源
是否绕过 Tool
是否单位安全
是否改变 Contract
是否存在 any
是否有测试
是否有回归风险
是否有安全问题
是否有无关改动
```

---

# 147. Physics Review 检查表

Physics Engine PR 额外检查：

```text
公式成立条件
单位
方向
边界条件
极端输入
数值误差
守恒关系
Golden Case
```

---

# 148. Agent Review 检查表

Agent PR 额外检查：

```text
Prompt Scope
Tool Scope
Permission
Structured Output
Context Size
Compaction
Retry
Trace
是否让 LLM 决定物理事实
```

---

# 149. UI Review 检查表

UI PR 额外检查：

```text
是否符合浅色视觉
是否出现大面积紫色
是否让 Physics Canvas 成为主体
是否过度卡片化
是否可键盘操作
是否正确响应主流桌面分辨率
```

---

# 150. 性能 Review

高频模块检查：

```text
是否导致 React 高频重渲染
是否主线程长任务
是否无限存储轨迹
是否存在 O(n²) 无界增长
是否可 Worker 化
```

---

# 151. Contract First

跨模块新能力优先顺序：

```text
先定义 Contract
↓
写 Contract Test
↓
实现 Producer
↓
实现 Consumer
```

不要两边各自猜数据格式。

---

# 152. Versioning

公共 Contract 必须具有：

```text
schemaVersion
```

例如：

```text
physics-scene/1.0
physics-ir/1.0
diagram-ir/1.0
```

---

# 153. Migration

Breaking Contract 修改必须提供：

```text
Migration
```

不能要求所有历史数据直接失效。

---

# 154. Deprecation

公共 API 删除前：

```text
deprecated
migration path
removal version
```

明确告知。

---

# 155. Feature 开发标准流程

推荐统一流程：

```text
理解需求
↓
确认 Domain
↓
确认 Contract
↓
确认依赖方向
↓
补测试
↓
实现
↓
验证
↓
文档
↓
Review
```

---

# 156. Physics 功能开发标准流程

例如新增：

```text
带电粒子进入矩形磁场
```

开发顺序：

```text
定义 Scene 能力
↓
定义 Region / Boundary Contract
↓
增加 Golden Case
↓
实现 Magnetic Engine
↓
实现 Verifier
↓
增加 Observation
↓
Renderer 展示
↓
Tool 接口
↓
Skill
↓
Question Pattern
↓
E2E
```

---

# 157. Question 功能标准流程

```text
定义题型
↓
Physics IR
↓
Diagram IR 支持
↓
Parser
↓
Scene Builder
↓
Engine
↓
Verifier
↓
Tutor
↓
Dynamic Variation
```

---

# 158. Tool 开发流程

```text
Tool Contract
↓
Schema
↓
Permission
↓
Handler
↓
Domain Validation
↓
Contract Test
↓
Agent Scope
↓
Documentation
```

---

# 159. Skill 开发流程

```text
Concept
↓
Rules
↓
Prerequisites
↓
Misconceptions
↓
Visualization
↓
Tools
↓
Teaching Strategy
↓
Verification
↓
Question Pattern
↓
Examples
```

---

# 160. 最终架构红线清单

以下任何一项出现都必须修复：

1. LLM 直接决定真实物理结果；
2. UI 直接计算核心 Physics Result；
3. Renderer 计算物理规律；
4. Agent 绕过 Tool 修改 PhysicsScene；
5. Physics Core 依赖 React；
6. Physics Core 依赖 DeepSeek Harness；
7. PhysicsScene 保存 Pixi/Three 对象；
8. Zustand 成为第二个 PhysicsScene；
9. 不带单位管理核心物理量；
10. 2D 与 3D 各自维护不同物理事实；
11. Tool 使用一个 prompt 参数包办所有事情；
12. Context Summary 替代 Scene；
13. Web 与 Desktop 复制业务代码；
14. 模块私自定义重复 Contract；
15. Redis 成为永久数据唯一事实源；
16. LLM 作为第一 Physics Verifier；
17. 删除失败测试让 CI 通过；
18. 用 Mock 冒充完成；
19. Agent 修改无关模块；
20. Contract 改变但不更新文档和 Migration。

---

# 161. 工程质量目标

PhysicsOS 不以：

> **“功能暂时能跑”**

作为工程标准。

长期必须做到：

```text
Correct
Deterministic
Traceable
Replayable
Testable
Verifiable
Extensible
Replaceable
Maintainable
```

即：

```text
正确
确定
可追踪
可回放
可测试
可验证
可扩展
可替换
可维护
```

---

# 162. 最终规范原则

所有模块都必须能够明确回答两个问题：

> **我负责什么？**

以及：

> **我绝对不负责什么？**

只有这样，PhysicsOS 才能在完整覆盖初高中物理、Agent、试卷理解、实时仿真和未来 Desktop 的情况下，仍然保持长期可维护。

---

# 163. 一句话工程规范

> **任何开发都不得以“快速实现”为理由破坏 PhysicsScene 单一事实源、Physics Engine 的确定性、跨模块 Contract 以及 Agent 与物理世界之间的 Tool Guard 边界。**
