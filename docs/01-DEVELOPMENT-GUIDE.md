# PhysicsOS 开发指南

> 文件：`docs/01-DEVELOPMENT-GUIDE.md`  
> 文档定位：PhysicsOS 工程实现总指南  
> 产品总览：`00-PRODUCT-OVERVIEW.md`  
> 工程规范：`02-ENGINEERING-STANDARDS.md`  
> 领域契约：`03-DOMAIN-CONTRACTS.md`

---

# 1. 文档目的

本文档回答一个问题：

> **PhysicsOS 应该如何被真正开发出来？**

它负责定义：

- 技术栈；
- Monorepo 组织方式；
- Web First 开发策略；
- 前端应用架构；
- Physics World Runtime；
- PhysicsScene Runtime；
- Physics Engine；
- Observation / Renderer；
- Question Space；
- Physics IR / Diagram IR；
- Agent Runtime；
- DeepSeek Harness Adapter；
- Tools / Skills / Context / Memory；
- 后端服务边界；
- 数据存储；
- 测试体系；
- Web → Windows EXE 复用策略；
- 本地开发、构建与部署方式。

本文件不负责详细定义字段级 Contract。字段级定义以 `03-DOMAIN-CONTRACTS.md` 为准。

---

# 2. 总体开发目标

PhysicsOS 是一个 **Web First 的初高中物理数字世界 + AI Agent 平台**。

当前第一主产品：

```text
PhysicsOS Web
```

未来在不复制业务代码的前提下扩展：

```text
PhysicsOS Windows Desktop
```

总体目标：

```text
                    PhysicsOS
                        │
          ┌─────────────┴─────────────┐
          │                           │
     Physics Lab                Question Space
      物理实验室                  试题空间
          │                           │
          └─────────────┬─────────────┘
                        ↓
                  Physics World
                        │
        ┌───────────────┼────────────────┐
        ↓               ↓                ↓
 PhysicsScene      Physics Engine    Observation
        │               │                │
        └───────────────┼────────────────┘
                        ↓
                  Physics Agent
                        │
                  Agent Runtime
                        │
               DeepSeek Harness
```

---

# 3. 最高技术原则

开发过程中始终遵守以下原则。

## 3.1 Web First

优先完整实现：

```text
Web
```

之后通过 Tauri 包装成：

```text
Windows EXE
```

不维护两套前端。

---

## 3.2 PhysicsScene 是物理事实源

物理世界当前是什么状态，只能由：

```text
PhysicsScene Runtime
```

决定。

不能由：

- React State；
- Agent 聊天上下文；
- LLM 输出文本；
- Renderer 内部状态；

代替。

---

## 3.3 LLM 不决定物理结果

```text
LLM
├── 理解
├── 规划
├── 调用 Tools
├── 解释
└── 教学
```

真正的：

```text
轨迹
受力
速度
加速度
场
能量
电路状态
```

由 Physics Engine 计算。

---

## 3.4 Physics Engine 与 UI 解耦

Physics Engine 不允许依赖：

```text
React
DOM
Canvas
Three.js
DeepSeek Harness
数据库
```

---

## 3.5 Renderer 不负责求解

Renderer 只把已经得到的物理状态绘制出来。

---

## 3.6 Agent Runtime 与 Harness 隔离

业务代码只依赖：

```text
PhysicsAgentRuntime API
```

DeepSeek Harness 通过 Adapter 接入：

```text
PhysicsOS
    ↓
PhysicsAgentRuntime
    ↓
DSH Adapter
    ↓
DeepSeek Harness
```

---

# 4. 总体工程结构

推荐 Monorepo：

```text
physics-os/
│
├── apps/
├── packages/
├── services/
├── skills/
├── content/
├── docs/
├── tests/
├── infra/
└── scripts/
```

包管理：

```text
pnpm workspace
```

任务编排建议：

```text
Turborepo
```

---

# 5. 推荐完整目录

```text
physics-os/
│
├── apps/
│   ├── web/
│   ├── teacher-web/
│   ├── admin-web/
│   └── desktop/
│
├── packages/
│   ├── ui/
│   ├── shared/
│   ├── config/
│   ├── platform-bridge/
│
│   ├── physics-core/
│   ├── physics-scene/
│   ├── physics-events/
│   ├── physics-units/
│   ├── physics-math-client/
│
│   ├── engine-mechanics/
│   ├── engine-kinematics/
│   ├── engine-gravity/
│   ├── engine-electric/
│   ├── engine-magnetic/
│   ├── engine-em/
│   ├── engine-circuit/
│   ├── engine-induction/
│   ├── engine-optics/
│   ├── engine-wave/
│   └── engine-thermal/
│
│   ├── physics-observation/
│   ├── physics-renderer/
│   ├── physics-verifier/
│
│   ├── physics-ir/
│   ├── diagram-ir/
│   ├── question-parser/
│   ├── question-engine/
│
│   ├── agent-runtime/
│   ├── agent-dsh-adapter/
│   ├── agent-tools/
│   ├── agent-prompt/
│   ├── agent-context/
│   ├── agent-compaction/
│   ├── agent-memory/
│   ├── agent-workflow/
│   └── agent-skills/
│
│   ├── curriculum/
│   └── learning-model/
│
├── services/
│   ├── api/
│   ├── agent/
│   ├── simulation/
│   ├── math/
│   └── document/
│
├── skills/
│   ├── junior-high/
│   └── senior-high/
│
├── content/
│   ├── experiments/
│   ├── questions/
│   └── curriculum/
│
├── tests/
│   ├── physics/
│   ├── golden/
│   ├── agent/
│   ├── question/
│   ├── simulation/
│   ├── integration/
│   └── visual/
│
├── docs/
│   ├── 00-PRODUCT-OVERVIEW.md
│   ├── 01-DEVELOPMENT-GUIDE.md
│   ├── 02-ENGINEERING-STANDARDS.md
│   └── 03-DOMAIN-CONTRACTS.md
│
├── infra/
└── scripts/
```

---

# 6. 客户端架构

## 6.1 正式 Web：vendor/deepseek-harness/apps/web

当前唯一正式 Web Runtime Host：

```text
vendor/deepseek-harness/apps/web
        +
vendor/deepseek-harness/packages/client/ui-physicsos
```

根目录 `apps/web` 是已废弃的独立原型，只保留作迁移参考，不再承载新功能、Runtime 接入或正式验收。

主要页面：

```text
首页
物理实验室
实验模板库
Physics Workspace
试题空间
试题解析
错题本
学习记录
资源库
个人中心
```

职责：

```text
Harness Web Shell：路由、会话、布局与客户端插件装配
ui-physicsos：PhysicsOS 页面、用户交互与工作区组合
共享 Runtime：PhysicsScene、Engine、Verifier、Observation
PhysicsCanvas：统一渲染磁场与力学视觉模型
```

禁止：

```text
在 React 组件中实现物理核心计算
```

---

## 6.2 apps/teacher-web

教师工作台。

主要能力：

```text
Teacher Studio
Scene Builder
实验制作
试题制作
课堂演示
作业
班级
学情分析
内容发布
```

---

## 6.3 apps/admin-web

平台运营后台。

包括：

```text
用户
角色权限
课程体系
题库
试卷
Physics Skills
实验模板
模型配置
Agent 配置
内容审核
运营数据
系统配置
```

---

## 6.4 apps/desktop

未来 Windows 客户端。

桌面端不重新开发业务 UI。

只提供：

```text
Tauri Runtime
Native File Dialog
Local File System
Windows Notification
File Drag & Drop
Auto Update
Local Physics Runtime
Local Agent Sidecar
Offline Capability
```

---

# 7. Web 技术栈

核心推荐：

```text
React
TypeScript
Vite
React Router
TanStack Query
Zustand
Tailwind CSS
Radix UI / shadcn
```

可视化：

```text
SVG
Canvas
PixiJS
Three.js
ECharts
KaTeX
```

---

# 8. 为什么使用 React + Vite

PhysicsOS 的 Web 端本质上是：

> **Browser-based Desktop Application**

它的核心不是 SSR 内容页，而是：

```text
Physics Canvas
实时仿真
拖拽
Scene Tree
Inspector
Timeline
Agent
多面板工作区
试卷解析
数据图表
```

因此主应用优先采用：

```text
React + TypeScript + Vite
```

宣传官网如果以后需要，可以单独建立 Next.js 应用，不与 Physics Workspace 强绑定。

---

# 9. 前端状态架构

前端状态必须严格划分。

## 9.1 UI State

使用：

```text
Zustand
```

例如：

```text
sidebarOpen
activePanel
selectedObjectId
workspaceLayout
zoom
theme
temporaryTool
```

---

## 9.2 Server State

使用：

```text
TanStack Query
```

例如：

```text
用户
题目
试卷
实验列表
错题
课程
学习记录
资源
```

---

## 9.3 Physics World State

使用：

```text
PhysicsScene Runtime
```

例如：

```text
Body
Particle
Field
Force
Circuit
Timeline
Revision
```

不得复制一份到 Zustand 作为第二事实源。

---

## 9.4 Agent State

由：

```text
PhysicsAgentRuntime
```

管理：

```text
Session
Run
Turn
Tool Call
Agent Status
Streaming
```

---

# 10. PlatformBridge

为 Web → Desktop 复用提前建立平台抽象。

```ts
interface PlatformBridge {
  getPlatform(): 'web' | 'windows'

  openFile(
    options?: OpenFileOptions
  ): Promise<FileRef | null>

  saveFile(
    file: BinaryFile,
    options?: SaveFileOptions
  ): Promise<void>

  notify(
    message: NotificationMessage
  ): Promise<void>

  supports(
    capability: PlatformCapability
  ): boolean
}
```

实现：

```text
BrowserPlatformBridge
TauriPlatformBridge
```

业务代码禁止到处判断：

```ts
if (window.__TAURI__) {}
```

---

# 11. Physics Workspace

核心工作页面：

```text
┌───────────────────────────────────────────────────────────────┐
│ PhysicsOS │ 场景名称 │ ▶ │ ⏸ │ 1x │ 保存 │ 分享            │
├────────────┬──────────────────────────────┬───────────────────┤
│ Scene Tree │                              │ Inspector         │
│            │                              │                   │
│ Objects    │       Physics Canvas         │ Observables       │
│            │                              │                   │
│ Layers     │                              │ Physics Agent     │
│ Tools      │                              │                   │
├────────────┴──────────────────────────────┴───────────────────┤
│ Timeline                                                      │
├───────────────────────────────────────────────────────────────┤
│ Data │ Graph │ Energy │ Velocity │ Acceleration │ Derivation  │
└───────────────────────────────────────────────────────────────┘
```

---

# 12. Physics Workspace 模块

建议拆分：

```text
workspace/
├── toolbar/
├── scene-tree/
├── object-library/
├── canvas/
├── inspector/
├── observation-panel/
├── timeline/
├── data-panel/
├── graph-panel/
├── derivation-panel/
└── agent-panel/
```

Workspace 本身只协调这些模块。

---

# 13. Physics Canvas

Canvas 必须作为独立运行子系统，而不是普通 React 组件集合。

结构：

```text
PhysicsCanvas
│
├── Camera
├── Viewport
├── CoordinateTransform
├── SelectionManager
├── HitTest
├── InteractionController
├── RenderLayerManager
└── Renderer
```

---

# 14. 2D / 3D 策略

原则：

> **2D 为主体，3D 为增强。**

使用场景：

```text
SVG
→ 静态矢量、受力图、公式辅助图

Canvas / PixiJS
→ 高频 2D 动态场景

Three.js
→ 真正需要空间理解的 3D 场景

ECharts
→ x-t / v-t / a-t / Energy 等图表
```

禁止所有实验统一使用 Three.js。

---

# 15. PhysicsScene Runtime

核心结构：

```text
PhysicsSceneRuntime
│
├── SceneGraph
├── SceneCommandBus
├── EventStore
├── Reducer
├── SnapshotStore
├── Timeline
└── SceneQueryService
```

修改链路：

```text
Command
   ↓
Validation
   ↓
Physics Event
   ↓
Reducer
   ↓
New PhysicsScene
   ↓
revision + 1
```

---

# 16. Scene Mutation

禁止：

```ts
scene.particles[0].mass = 2
```

必须：

```text
ChangeParticleMass Command
        ↓
Scene Validator
        ↓
ParticleMassChanged Event
        ↓
Scene Reducer
        ↓
Scene Revision + 1
```

这样才能支持：

```text
Undo
Redo
Replay
Branch
Audit
Agent Trace
```

---

# 17. Scene EventStore

典型事件：

```text
SceneCreated
BodyAdded
BodyRemoved
ParticleAdded
ParticleRemoved
FieldAdded
FieldChanged
ForceAdded
ConstraintAdded
ParameterChanged
TimelineSeeked
SimulationStarted
SimulationPaused
SimulationCompleted
ParticleEnteredRegion
ParticleExitedRegion
CollisionOccurred
ObservationEnabled
ObservationDisabled
```

---

# 18. SnapshotStore

Snapshot 用于：

```text
快速恢复
大跨度时间回放
Branch
Undo/Redo 优化
Agent Session 恢复
场景分享
```

Snapshot 不替代 EventStore。

---

# 19. Physics Timeline

Timeline 与 Scene Runtime 原生结合。

```text
0s ───── 1s ───── 2s ───── 3s
                ▲
              current
```

支持：

```text
play()
pause()
seek()
stepForward()
stepBackward()
setPlaybackRate()
```

用户拖动时间轴后，所有：

```text
位置
速度
加速度
力
场
能量
电路数据
轨迹
```

必须恢复到该时刻。

---

# 20. Physics Core

`physics-core` 只定义最核心的：

```text
基础类型
Engine Interface
Simulation Contract
公共计算接口
Domain Registry
```

必须保持纯净。

禁止依赖：

```text
React
PixiJS
Three.js
Agent
Harness
Spring Boot
数据库
```

---

# 21. Physics Engine Registry

统一注册不同物理领域。

```ts
interface PhysicsEngine<
  TScene = PhysicsScene,
  TResult = SimulationResult
> {
  readonly domain: PhysicsDomain

  supports(scene: TScene): boolean

  simulate(
    scene: TScene,
    options: SimulationOptions
  ): Promise<TResult>
}
```

Engine Registry：

```text
Mechanics
Kinematics
Gravity
Electric
Magnetic
EM
Circuit
Induction
Optics
Wave
Thermal
```

---

# 22. Mechanics Engine

负责：

```text
受力
牛顿定律
摩擦
弹力
支持力
连接体
约束
功与能
动量
碰撞
```

---

# 23. Kinematics Engine

负责：

```text
直线运动
匀变速运动
自由落体
竖直上抛
平抛
斜抛
圆周运动
轨迹
状态随时间变化
```

---

# 24. Electric Engine

负责：

```text
库仑力
电场
电势
电势能
电场叠加
带电粒子电场运动
```

---

# 25. Magnetic Engine

负责：

```text
洛伦兹力
安培力
匀强磁场
磁场区域
粒子圆周运动
出入场
边界问题
```

---

# 26. EM Composite Engine

处理：

```text
电场 + 磁场
电场 + 重力
磁场 + 重力
电场 + 磁场 + 重力
速度选择器
质谱仪
回旋加速器
多区域复合运动
```

---

# 27. Circuit Engine

内部使用：

```text
CircuitGraph
```

而不是“动画状态”。

结构：

```text
Node
Terminal
Component
Connection
Source
Resistor
Capacitor
Inductor
Switch
Meter
```

Circuit Engine 输出：

```text
Node Voltage
Branch Current
Component State
Energy
Power
Measurement
```

---

# 28. Induction Engine

负责：

```text
磁通量
法拉第电磁感应
楞次定律
运动导体
线框
导轨
双棒
电磁阻尼
自感
互感
交流基础
```

需要和：

```text
Mechanics
Circuit
Magnetic
```

协作。

---

# 29. Math Runtime

数学能力独立。

```text
Math Runtime
│
├── Symbolic
├── Numerical
├── Geometry
├── Equation Solver
├── ODE
├── Matrix
└── Unit System
```

复杂能力通过 Python 服务实现。

推荐：

```text
FastAPI
SymPy
NumPy
SciPy
```

TypeScript 侧通过：

```text
MathRuntimeClient
```

调用。

---

# 30. Math Runtime 原则

禁止 Physics Engine 直接依赖某个 Python 包的 HTTP 结构。

正确：

```text
Physics Engine
      ↓
MathRuntime interface
      ↓
Math Service Adapter
      ↓
Python Math Service
```

---

# 31. Physics Units

独立：

```text
physics-units
```

内部统一 SI。

UI 可显示：

```text
cm
mm
km/h
μC
mT
ns
```

进入 Engine 前转换为 Canonical SI。

---

# 32. Physics Verifier

统一验证层：

```text
Physics Verifier
│
├── Dimensional Verification
├── Symbolic Verification
├── Numerical Verification
├── Constraint Verification
├── Conservation Verification
├── Boundary Verification
├── Trajectory Verification
└── Semantic Review
```

顺序：

```text
规则
↓
单位
↓
数学
↓
数值
↓
物理不变量
↓
LLM Semantic Review
```

---

# 33. Simulation Pipeline

统一模拟管线：

```text
PhysicsScene
      ↓
Scene Validation
      ↓
Engine Selection
      ↓
Physics Engine
      ↓
Math Runtime
      ↓
Raw SimulationResult
      ↓
Physics Verifier
      ↓
Verified SimulationResult
```

---

# 34. Simulation Worker

浏览器中的高计算量 Simulation 不得阻塞 UI。

优先：

```text
Web Worker
```

主线程负责：

```text
UI
Renderer
用户操作
```

Worker 负责：

```text
数值推进
批量轨迹计算
数据采样
```

---

# 35. Observation Runtime

Observation 是独立层。

结构：

```text
Observation Runtime
│
├── Vector Layer
├── Trajectory Layer
├── Field Layer
├── Energy Layer
├── Geometry Layer
├── Measurement Layer
├── Graph Layer
└── Annotation Layer
```

---

# 36. Observation Model

Physics Engine 输出：

```text
世界是什么状态
```

Observation Runtime 转换为：

```text
用户希望看见哪些信息
```

例如：

```text
显示洛伦兹力
显示瞬时速度
显示圆心
显示轨迹半径
隐藏坐标系
显示动能曲线
```

---

# 37. Renderer Architecture

```text
Physics Engine
      ↓
SimulationResult
      ↓
Observation Model
      ↓
Visual Scene Model
      ↓
Renderer
```

Renderer 支持：

```text
SVG Renderer
Canvas Renderer
Pixi Renderer
Three Renderer
Chart Renderer
```

---

# 38. Question Space Runtime

完整链路：

```text
题目 / 图片 / PDF
      ↓
Document Parser
      ↓
OCR / VLM
      ↓
Question Segmentation
      ↓
Diagram Understanding
      ↓
Physics Semantic Parser
      ↓
Physics IR
      ↓
Scene Builder
      ↓
PhysicsScene
      ↓
Verifier
      ↓
Physics Engine
      ↓
Observation
      ↓
Physics Canvas
      ↓
Tutor Agent
```

---

# 39. Document Service

负责：

```text
PDF 解析
图片解析
扫描文档预处理
页面切分
题号检测
题目区域检测
文字识别
图片抽取
题目切分
```

不负责：

```text
物理求解
Scene Simulation
Agent 教学
```

---

# 40. Question Segmentation

整张试卷：

```text
Exam
│
├── Question 1
├── Question 2
├── Question 3
└── ...
```

每题保存：

```text
原始来源
题干
图片
Diagram IR
Physics IR
Scene
Solution
Student Attempt
Diagnostic
```

---

# 41. Physics IR

Physics IR 是正式中间层。

```text
Natural Language
      ↓
Physics IR
      ↓
PhysicsScene
```

主要包含：

```text
domain
problemType
objects
regions
knownValues
initialConditions
constraints
relations
targets
diagramRefs
knowledgeTags
confidence
```

---

# 42. Diagram IR

视觉题图先转换为：

```text
Diagram IR
```

支持：

```text
Point
Line
Arc
Arrow
Label
Body
Wire
Circuit Component
Field Region
Coordinate
Boundary
```

然后才能映射：

```text
Diagram IR
    ↓
Physics Mapping
    ↓
PhysicsScene / CircuitGraph
```

---

# 43. Question → Physics World

试题页面提供：

```text
在物理世界中打开
```

流程：

```text
Question
↓
Physics IR
↓
Scene Builder
↓
PhysicsScene
↓
Physics Workspace
```

---

# 44. Physics World → Dynamic Question

实验场景可以：

```text
基于当前场景生成试题
```

Question Engine 根据：

```text
Scene
Knowledge Point
Difficulty
Variable Policy
Question Pattern
```

生成：

```text
基础
中等
综合
考试
变式
```

题目。

---

# 45. Physics Agent Runtime

统一抽象：

```text
PhysicsAgentRuntime
│
├── Orchestrator
├── Question Parser Role
├── Scene Builder Role
├── Solver Role
├── Verifier Role
├── Observation Planner
├── Tutor Role
└── Diagnostic Role
```

---

# 46. Agent 不等于 7 个常驻模型

“角色”表示：

```text
Role
+
Prompt
+
Tool Scope
+
Context
+
Workflow
```

系统根据任务动态创建。

---

# 47. PhysicsAgentRuntime API

上层只依赖统一接口。

```ts
interface AgentRuntime {
  createSession(
    input: CreateSessionInput
  ): Promise<AgentSession>

  send(
    sessionId: string,
    message: AgentInput
  ): Promise<AgentRun>

  resume(
    runId: string
  ): Promise<AgentRun>

  cancel(
    runId: string
  ): Promise<void>
}
```

---

# 48. DeepSeek Harness Adapter

在 PhysicsOS Agent/Domain 包中，只有：

```text
agent-dsh-adapter
```

允许直接依赖 DeepSeek Harness Agent Runtime。

正式 UI 叠加层 `vendor/deepseek-harness/packages/client/ui-physicsos` 是展示集成边界，可以依赖已声明的 Harness 客户端 layout/sidebar/conversation slot contract；不得依赖 Harness Agent 内部实现，也不得把 Harness 类型扩散进 PhysicsOS Domain。

其他 PhysicsOS 领域模块禁止直接 import Harness。

结构：

```text
Physics Agent
     ↓
AgentRuntime Contract
     ↓
DSH Adapter
     ↓
DeepSeek Harness
```

---

# 49. Physics Profile

在 Harness 上组合：

```text
Physics Profile
│
├── Prompt
├── Tools
├── Skills
├── Workflow
├── Context
├── Compaction
├── Memory
└── Agents
```

---

# 50. Agent Roles

## Orchestrator

负责：

```text
识别任务
选择 Skill
选择 Tools
选择模型
选择 Workflow
调度其他角色
```

---

## Question Parser

负责：

```text
Question
↓
Physics IR
```

---

## Scene Builder

负责：

```text
Physics IR
↓
Physics Tools
↓
PhysicsScene
```

---

## Solver

负责：

```text
建立求解路径
调用 Physics Tools
调用 Math Runtime
获得确定结果
```

---

## Verifier

负责验证：

```text
单位
公式
约束
结果
轨迹
边界
```

---

## Observation Planner

负责决定：

```text
哪些物理量应该被显示
什么时候暂停
显示哪些向量
显示哪些图表
```

---

## Tutor

负责：

```text
提示
引导
提问
解释
逐步教学
规律总结
```

---

## Diagnostic

负责：

```text
发现学生错误模式
更新 Learning State
```

---

# 51. Agent Workflow

Agent Loop 与 Physics Workflow 分离。

Harness 管：

```text
Turn
↓
Step
↓
Model Request
↓
Tool Call
↓
Tool Result
↓
Next Step
```

PhysicsOS 管：

```text
INGEST
↓
UNDERSTAND
↓
FORMALIZE
↓
BUILD_SCENE
↓
VERIFY_SCENE
↓
SOLVE
↓
SIMULATE
↓
VERIFY_RESULT
↓
OBSERVE
↓
TEACH
↓
INTERACT
↓
REFINE
```

---

# 52. Tool Runtime

统一命名：

```text
physics.*
```

例如：

```text
physics.scene.create
physics.scene.get
physics.scene.patch
physics.scene.seek

physics.mechanics.net_force
physics.mechanics.acceleration

physics.kinematics.trajectory

physics.electric.field
physics.electric.particle_motion

physics.magnetic.lorentz_force
physics.magnetic.radius

physics.circuit.solve

physics.observe.force
physics.observe.velocity
physics.observe.trajectory
physics.observe.graph
```

---

# 53. Tool Call Pipeline

```text
Agent
↓
Tool Registry
↓
Schema Validation
↓
Permission Guard
↓
Unit Validation
↓
Domain Validation
↓
Physics Constraint Validation
↓
Tool Handler
↓
Physics Runtime
↓
Scene Event / Result
↓
Tool Result
```

---

# 54. Tool Result

所有 Tool Result 必须结构化。

不得只返回一段自由文本。

至少包含：

```text
ok
data/error
traceId
```

错误包含：

```text
code
message
retryable
details
```

---

# 55. Skills Runtime

目录：

```text
skills/
├── junior-high/
└── senior-high/
```

按知识点拆 Skill。

例如：

```text
senior-high/
└── magnetic/
    └── charged-particle-magnetic-field/
```

---

# 56. Skill 结构

```text
charged-particle-magnetic-field/
├── SKILL.md
├── concepts.yaml
├── rules.yaml
├── misconceptions.yaml
├── teaching-strategies.yaml
├── visualization.yaml
├── verification.yaml
├── question-patterns.yaml
├── scene-templates/
└── examples/
```

---

# 57. Skill Progressive Loading

Agent 当前处理磁场问题时：

只加载：

```text
磁场相关 Skill
相关 Tool
相关公式
相关错误模式
```

不一次注入整个初高中 Physics Knowledge。

---

# 58. Prompt Assembly

Prompt 按模块动态组装：

```text
Identity
+
Physics Constitution
+
Current Mode
+
Grade
+
Current Skill
+
Current Scene Reference
+
Current Objective
+
Student State
+
Tool Policy
+
Teaching Policy
+
Recent Context
```

禁止单个超长 `system_prompt.txt`。

---

# 59. Context Architecture

分层：

```text
L0 Constitution
L1 Domain
L2 User Learning State
L3 Physics Scene
L4 Task Working Memory
L5 Recent Conversation
L6 Retrieval
```

---

# 60. Context Compression

Physics-aware Compaction 输出至少包含：

```text
当前任务
Scene ID
Scene Revision
已经确认的事实
已经推导的结果
已经完成的步骤
当前目标
学生误区
关键 Event ID
```

Scene 本身不通过自然语言摘要替代。

---

# 61. Memory Architecture

```text
Memory
│
├── Session Memory
├── Learning Memory
├── Scene Memory
├── Error Memory
├── Knowledge Memory
└── Preference Memory
```

---

# 62. Model Router

模型层不绑定单一 Provider。

```text
Model Router
│
├── Reasoning Model
├── Fast Model
├── Vision Model
├── OCR
├── Embedding Model
└── Optional Local Model
```

Agent 根据任务选择。

---

# 63. 后端业务服务

业务后端推荐：

```text
Spring Boot
```

负责：

```text
Auth
User
Curriculum
Question
Exam
Learning
Teacher
Class
Assignment
Content
Permission
Analytics
```

---

# 64. 服务边界

逻辑上：

```text
API Gateway
│
├── Business API
├── Agent Service
├── Simulation Service
├── Math Service
└── Document Service
```

初期不强制全部独立部署，但代码边界必须存在。

---

# 65. 数据存储

## PostgreSQL

保存：

```text
User
Question
Exam
Question Attempt
Learning Record
Scene Metadata
Scene Events
Scene Snapshot Metadata
Skill Metadata
Curriculum
Class
Assignment
Permission
```

---

## Object Storage

保存：

```text
PDF
Images
Scene Assets
Large Snapshots
Export
Generated Files
```

---

## Redis

用于：

```text
Cache
Lock
Rate Limit
Queue
Temporary Runtime State
```

禁止作为唯一持久事实源。

---

## Vector Store

用于：

```text
Curriculum Retrieval
Question Retrieval
Knowledge Retrieval
```

不存 PhysicsScene 真实状态。

---

# 66. 双 Event Stream

PhysicsOS 同时存在：

```text
Agent Event Stream
+
Physics Event Stream
```

Agent Stream：

```text
Prompt
Message
Model
Tool
Context
```

Physics Stream：

```text
Scene
Mutation
Simulation
Interaction
```

---

# 67. Trace 关联

统一关联：

```text
trace_id
session_id
run_id
turn_id
tool_call_id
scene_id
scene_revision
physics_event_id
```

从而支持完整 Trace：

```text
用户问题
↓
Agent
↓
Tool
↓
Physics Event
↓
Scene Revision
↓
Simulation
↓
Observation
↓
Assistant
```

---

# 68. API 版本

业务：

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

# 69. Streaming

推荐：

```text
Agent 文本流 → SSE
```

需要双向高频协作：

```text
WebSocket
```

例如：

```text
多人 Scene Collaboration
高频 Scene Event Sync
```

---

# 70. 本地开发

建议使用：

```text
Docker Compose
```

提供：

```text
PostgreSQL
Redis
Object Storage
Vector Store
```

应用服务本机启动。

---

# 71. 推荐根命令

```bash
pnpm install

pnpm dev
pnpm dev:web
pnpm dev:teacher
pnpm dev:agent

pnpm typecheck
pnpm lint

pnpm test
pnpm test:physics
pnpm test:agent
pnpm test:e2e

pnpm build
```

Java 服务：

```bash
./mvnw test
./mvnw spring-boot:run
```

Python：

```bash
uv sync
uv run pytest
```

---

# 72. 环境变量

示例：

```env
APP_ENV=
LOG_LEVEL=

DATABASE_URL=
REDIS_URL=

OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_ACCESS_KEY=
OBJECT_STORAGE_SECRET_KEY=

AGENT_SERVICE_URL=
SIMULATION_SERVICE_URL=
MATH_SERVICE_URL=
DOCUMENT_SERVICE_URL=

MODEL_PROVIDER=
MODEL_API_KEY=
```

仓库只提交：

```text
.env.example
```

禁止提交真实 Secret。

---

# 73. 测试体系

PhysicsOS 至少包含：

```text
Unit Test
Physics Golden Test
Agent Contract Test
Integration Test
E2E Test
Visual Regression
```

---

# 74. Unit Test

适合：

```text
Units
Vector
Scene Reducer
Geometry
Formula
Parser
Tool Guard
```

---

# 75. Physics Golden Test

最关键测试。

必须为经典模型建立 Golden Case：

```text
自由落体
平抛
斜抛
圆周运动
斜面受力
摩擦
动量守恒
库仑力
电场偏转
带电粒子磁场运动
速度选择器
串并联电路
电磁感应
```

---

# 76. Agent Contract Test

测试：

```text
Tool Schema
Tool Permission
Tool Result
Physics IR 输出
Scene Builder
Compaction
Role Tool Scope
```

不能主要测试模型“说得好不好听”。

---

# 77. Integration Test

测试完整管线：

```text
Question
↓
Physics IR
↓
Scene
↓
Simulation
↓
Verifier
↓
Observation
```

---

# 78. E2E

关键流程：

```text
进入实验室
选择实验
修改参数
运行
暂停
拖动时间轴
打开 Observable
询问 Agent
```

以及：

```text
上传题目
解析题目
生成 Physics IR
建立 Scene
可视化
查看解析
进入实验世界
```

---

# 79. Visual Regression

针对：

```text
Physics Workspace
重要物理图
受力箭头
轨迹
电场线
磁场区域
电路图
```

进行视觉回归。

---

# 80. CI

PR 至少执行：

```text
format check
typecheck
lint
unit tests
physics golden tests
agent contract tests
build
```

核心模块修改追加：

```text
integration tests
e2e
visual regression
```

---

# 81. Web → Windows EXE

未来 Desktop 结构：

```text
PhysicsOS Shared React UI
        ↓
PlatformBridge
        ↓
Tauri Adapter
        ↓
Windows Native APIs
```

预计共享：

```text
UI
Physics Workspace
Physics Canvas
PhysicsScene
Physics Engine
Observation
Question Space
Agent UI
Skills
API Client
```

桌面专属：

```text
文件系统
Native Dialog
Auto Update
系统通知
本地 Runtime
Local Harness Sidecar
```

---

# 82. Desktop 本地模式

未来可以支持：

```text
PhysicsOS.exe
│
├── Shared Web UI
├── Local Physics Runtime
├── Local File System
└── Local Harness Sidecar
```

并允许：

```text
Cloud Agent
Local Agent
```

切换。

---

# 83. UI 开发方向

整体：

```text
暖白
雾白
冰蓝透明
自然蓝
少量青绿
深灰文字
少量警告橙
```

避免：

```text
暗黑科技
死紫色渐变
赛博朋克
传统教育后台
满屏卡片
```

关键原则：

> **物理世界是主视觉，UI 是容器。**

---

# 84. 性能策略

高频 Simulation：

```text
Web Worker
```

Renderer 与 React 状态更新解耦。

不要每个 Physics Frame 都触发 React 全树更新。

---

# 85. Simulation Sampling

轨迹不无限保存所有积分步。

区分：

```text
solver timestep
storage sample rate
render sample rate
chart sample rate
```

保证：

```text
计算精度
≠
存储频率
≠
显示帧率
```

---

# 86. Lazy Loading

以下能力按需加载：

```text
Three.js 场景
大型 Physics Skill
复杂题目资源
高级图表
Teacher Studio
```

降低首屏体积。

---

# 87. 安全

文件上传：

```text
MIME 验证
大小限制
恶意文件检查
隔离解析
```

Agent：

```text
Tool Permission
Rate Limit
Timeout
Audit
```

---

# 88. Observability

每个服务统一输出：

```text
timestamp
level
service
traceId
userId
sessionId
runId
sceneId
event
```

开发后台未来能够查看完整：

```text
User
↓
Agent
↓
Tool
↓
Physics Event
↓
Scene Revision
↓
Simulation
↓
Verifier
↓
Observation
```

---

# 89. 依赖方向

必须保持：

```text
Apps
 ↓
Application Packages
 ↓
Domain Packages
 ↓
Core Packages
```

禁止：

```text
Core
 ↓
UI
```

---

# 90. Package README

每个重要 Package 应包含：

```text
README.md
```

说明：

```text
职责
公开 API
允许依赖
禁止依赖
核心 Contract
示例
测试方式
```

---

# 91. 开发文档阅读顺序

所有开发人员 / AI Agent 开始任务前阅读：

```text
00-PRODUCT-OVERVIEW.md
↓
01-DEVELOPMENT-GUIDE.md
↓
02-ENGINEERING-STANDARDS.md
↓
03-DOMAIN-CONTRACTS.md
↓
目标 Package README
↓
相关 Tests
```

---

# 92. 开发阶段输出要求

每个功能开发后必须说明：

```text
修改了什么
修改哪些文件
为什么这样实现
是否改变 Contract
测试了什么
测试结果
剩余风险
```

---

# 93. 开发完成定义

一个功能只有在以下条件全部满足时才能称为完成：

```text
代码完成
真实功能接通
类型检查通过
Lint 通过
Unit Test 通过
相关 Golden Test 通过
Build 通过
必要 E2E 通过
没有核心 Mock
没有假成功路径
Contract 已同步
文档已同步
```

---

# 94. 架构红线

禁止：

```text
LLM 代替 Physics Engine
React 组件直接计算核心物理结果
Renderer 自己决定物理结果
Agent 绕过 Tool 修改 Scene
Physics Core 依赖 React
Physics Core 依赖 Harness
PhysicsScene 保存 Renderer 对象
用普通聊天 Summary 替代 Scene
Web 和 Desktop 复制两套代码
不同模块私自定义重复 Contract
```

---

# 95. 最终工程形态

PhysicsOS 最终必须形成：

```text
                PhysicsOS Applications
                         │
                         ↓
                   Application Layer
                         │
       ┌─────────────────┼──────────────────┐
       ↓                 ↓                  ↓
 Question Runtime   Physics Runtime    Agent Runtime
       │                 │                  │
       ↓                 ↓                  ↓
 Physics IR        PhysicsScene      Agent Contract
       │                 │                  │
       └─────────────────┼──────────────────┘
                         ↓
                   Physics Engine
                         ↓
                     Verifier
                         ↓
                  Observation
                         ↓
                     Renderer
```

最终达到：

> **同一套 Physics World 能够服务 Web、未来 Windows EXE、试题系统、实验系统、教师端与 Physics Agent，而不重复实现物理逻辑。**

---

# 96. 当前开发主方向

当前正式开发优先级：

```text
Web First
```

即：

```text
vendor/deepseek-harness/apps/web
+
vendor/deepseek-harness/packages/client/ui-physicsos
+
核心共享 packages
+
Agent Runtime
+
Physics Runtime
+
Question Runtime
```

根目录 `apps/web` 不在正式开发链路中。

Desktop 只做架构预留，暂不复制开发。

---

# 97. 一句话工程目标

> **把 PhysicsOS 建设成一套模块边界清晰、物理结果可验证、Agent 可替换、Web 与 Desktop 可复用、能够长期扩展完整初高中物理体系的数字物理世界工程平台。**
