# PhysicsOS Development Roadmap

> 文件：`docs/14-DEVELOPMENT-ROADMAP.md`  
> 文档定位：PhysicsOS 完整产品工程实现顺序、依赖、阶段目标与验收标准
>
> **本 Roadmap 是实现顺序，不是 MVP 产品裁剪。最终产品范围仍以 `00-PRODUCT-OVERVIEW.md` 为准。**

---

# 0. 当前工程落点

正式产品唯一 Web 入口：

```text
vendor/deepseek-harness/apps/web
        +
vendor/deepseek-harness/packages/client/ui-physicsos
```

根目录 `apps/web` 是已废弃的独立原型，只保留作迁移参考。

截至当前代码基线，已经形成可运行链路：

```text
Harness Web Shell + PhysicsOS 导航与响应式工作区
磁场 Vertical Slice：Engine → Verifier → Observation → PhysicsCanvas
五类力学场景：Engine stateAt → Observation → PhysicsCanvas
Question Space：16 道确定性题目 → Question Runtime → Question → Lab
requestAnimationFrame 展示时钟、暂停、倍速、单步与终点重播
```

以下仍属于 Roadmap 未完成范围，不得以现有按钮或占位界面视为完成：

```text
图片/PDF/OCR/VLM 试题识别
AI 助教与保存/更多菜单业务闭环
模板库、学习记录与持久化
Electric / Circuit / Induction / Optics / Wave
教师端、发布协作与 Desktop
```

---

# 1. 开发原则

统一：

```text
Contract First
Physics Core First
Vertical Slice
Real Integration
Continuous Verification
```

禁止：

```text
先把所有页面画完
↓
最后再想物理引擎怎么接
```

---

# 2. 总依赖图

```text
Repository Foundation
        ↓
UI Foundation + Contracts
        ↓
Units / Math / Geometry
        ↓
PhysicsScene Runtime
        ↓
Core Physics Engines
        ↓
Verifier
        ↓
Observation
        ↓
Renderer
        ↓
Physics Workspace
        ↓
Agent Runtime
        ↓
Question Pipeline
        ↓
Dynamic Question
        ↓
Learning Model
        ↓
Teacher Studio
        ↓
Desktop
```

---

# 3. Phase 0 — Repository Foundation

目标：

```text
Monorepo
pnpm workspace
Turborepo
TypeScript
Lint
Format
Test Runner
CI
Docs
```

建立：

```text
apps/
packages/
services/
skills/
tests/
docs/
```

验收：

```text
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

全部通过。

---

# 4. Phase 1 — UI Foundation

建立：

```text
packages/ui
tokens
primitives
domain components
```

先完成：

```text
Top Navigation
Sidebar
Button
Input
Select
Tabs
Panel
Card
Table
Toolbar
```

并搭出：

```text
Home Shell
Workspace Shell
Question Shell
```

验收：

```text
1440×900
1600×900
1920×1080
```

与原型高度一致。

---

# 5. Phase 2 — Core Contracts

实现：

```text
PhysicsScene
Quantity
Vector
Event
Simulation
Physics IR
Diagram IR
Tool Contract
Agent Context
```

输出：

```text
TS Types
Zod
JSON Schema
Contract Tests
```

---

# 6. Phase 3 — Units / Math / Geometry

实现：

```text
Unit Registry
SI Conversion
Dimension
Vector
Basic Geometry
Math Runtime Interface
```

验收：

```text
Unit Tests
Dimension Tests
Geometry Tests
```

---

# 7. Phase 4 — PhysicsScene Runtime

实现：

```text
SceneGraph
CommandBus
Validation
EventStore
Reducer
Revision
Snapshot
Timeline
Branch
Query
```

验收：

```text
Create
Mutate
Undo
Redo
Replay
Seek
Branch
Revision Conflict
```

---

# 8. Phase 5 — 第一批 Physics Engine

优先：

```text
Kinematics
Mechanics
Magnetic
```

原因：

```text
覆盖当前核心原型
适合形成第一条完整系统链
```

不是意味着其他领域不做。

---

# 9. Phase 6 — Physics Verifier

实现：

```text
Schema
Unit
Dimension
Numerical
Constraint
Boundary
Trajectory
```

---

# 10. Phase 7 — Observation Runtime

先：

```text
Force
Velocity
Acceleration
Trajectory
Geometry
Measurement
Graph
```

---

# 11. Phase 8 — Renderer

实现：

```text
Coordinate Transform
Grid
Canvas / Pixi
SVG
Vector
Trajectory
Field
Timeline
Chart Adapter
```

---

# 12. Phase 9 — Physics Workspace

真实接通：

```text
Scene Tree
Canvas
Inspector
Observation
Timeline
Data
Chart
```

禁止 Mock Scene 作为最终实现。

---

# 13. Phase 10 — 第一条完整 Vertical Slice

推荐：

> **带电粒子在匀强磁场中做圆周运动**

它覆盖：

```text
Particle
Magnetic Field
Velocity
Lorentz Force
Trajectory
Radius
Period
Timeline
Observation
Renderer
Verifier
```

验收：

```text
修改 B
修改 q
修改 m
修改 v
轨迹实时更新
公式与数值一致
Timeline 可回放
Golden Test 通过
```

---

# 14. Phase 11 — 第二条 Vertical Slice

```text
平抛运动
```

覆盖：

```text
Kinematics
Mechanics
Trajectory
x-t
v-t
a-t
```

---

# 15. Phase 12 — Electric Engine

实现：

```text
Coulomb
Uniform Electric
Potential
Particle Deflection
```

---

# 16. Phase 13 — Circuit Engine

实现：

```text
CircuitGraph
Series
Parallel
Mixed
Switch
Variable Resistor
Meter
Internal Resistance
```

---

# 17. Phase 14 — Induction / EM Composite

实现：

```text
Motional EMF
Rail
Loop
Coupled Mechanics + Circuit
Electric + Magnetic
```

---

# 18. Phase 15 — Agent Runtime Foundation

实现：

```text
PhysicsAgentRuntime Contract
DSH Adapter
Session
Run
Streaming
Cancel
Resume
Fork
```

---

# 19. Phase 16 — Tool Runtime

先实现：

```text
physics.scene.*
physics.kinematics.*
physics.mechanics.*
physics.magnetic.*
physics.observe.*
physics.math.*
physics.verify.*
```

---

# 20. Phase 17 — Agent Context / Workflow

实现：

```text
L0-L6
Working Memory
Physics Workflow
Role Registry
Context Budget
```

---

# 21. Phase 18 — Agent Roles

依次：

```text
Orchestrator
Scene Builder
Solver
Verifier
Observation Planner
Tutor
Diagnostic
```

---

# 22. Phase 19 — Skills

第一批：

```text
kinematics
mechanics
magnetic
```

每个 Skill 完整包含：

```text
concept
rules
misconceptions
visualization
verification
question patterns
```

---

# 23. Phase 20 — Context Compaction

实现：

```text
Physics-aware Structured Compaction
Tool Result Pruning
Scene Reference Preservation
Recovery
```

---

# 24. Phase 21 — Memory

实现：

```text
Learning Memory
Error Memory
Preference Memory
```

---

# 25. Phase 22 — Question Ingest

实现：

```text
Upload
PDF
Image
Normalization
OCR
Document Job
```

---

# 26. Phase 23 — Question Segmentation

实现：

```text
整卷拆题
题图归属
子问
选项
```

---

# 27. Phase 24 — Diagram IR

第一批支持：

```text
磁场区域图
受力图
电路图
坐标图
```

---

# 28. Phase 25 — Physics IR Parser

实现：

```text
Question
↓
Physics IR
```

带：

```text
Evidence
Confidence
Assumption
```

---

# 29. Phase 26 — Scene Builder

实现：

```text
Physics IR
↓
Scene Candidate
↓
Validation
↓
PhysicsScene
```

---

# 30. Phase 27 — Question Space

真实接通原型：

```text
上传
历史
题目正文
已知条件
求解目标
解析步骤
可视化
相关题
```

---

# 31. Phase 28 — Question → Experiment

正式实现：

```text
在物理世界中打开
```

直接打开同一个 PhysicsScene Runtime。

---

# 32. Phase 29 — Dynamic Question

实现：

```text
Scene Branch
↓
Variable Policy
↓
Simulation
↓
Verify
↓
Question Generate
```

---

# 33. Phase 30 — Learning Model

实现：

```text
Knowledge Mastery
Misconception
Attempt
Evidence
Diagnostic Update
```

---

# 34. Phase 31 — Teacher Studio Foundation

实现：

```text
Scene Builder
Experiment Authoring
Question Authoring
Classroom Presentation
```

---

# 35. Phase 32 — Teacher Business

扩展：

```text
Class
Assignment
Publish
Learning Analytics
```

---

# 36. Phase 33 — Remaining Physics Domains

扩展：

```text
Gravity Advanced
Collision
Optics
Wave
Thermal
Modern Physics
```

---

# 37. Phase 34 — Curriculum Coverage

建立初高中完整：

```text
Skills
Experiment Templates
Question Patterns
Golden Cases
```

---

# 38. Phase 35 — Desktop Shell

建立：

```text
Tauri
PlatformBridge
Native File
Window
Notification
Auto Update
```

---

# 39. Phase 36 — Local Runtime

后续：

```text
Local Physics Runtime
Local Agent Sidecar
Offline Scene
Local File Project
```

---

# 40. 每阶段任务模板

每个开发阶段都必须有：

```text
Goal
Scope
Allowed Files
Dependencies
Contracts
Tests
Acceptance
Risks
```

---

# 41. 多 Agent 协作

适合并行：

```text
UI Components
独立 Engine
Test Dataset
Docs
```

不适合多人同时改：

```text
PhysicsScene Contract
Physics IR Contract
Tool Contract
SimulationResult
```

---

# 42. Shared Contract Lock

核心公共 Contract 修改需要：

```text
单一 Owner
串行 Review
同步所有 Consumer
```

---

# 43. AI Worker 开工前

必须读：

```text
00
01
02
03
相关专项文档
Package README
Tests
```

---

# 44. AI Worker 交付

必须汇报：

```text
完成内容
修改文件
关键设计
测试
风险
Contract Change
```

---

# 45. 第一条系统级验收链

```text
磁场带电粒子
```

必须真正打通：

```text
UI
Scene
Engine
Verifier
Observation
Renderer
Timeline
Tool
Agent
```

---

# 46. 第二条系统级验收链

```text
平抛
```

---

# 47. 第三条系统级验收链

```text
动态电路
```

---

# 48. 第四条系统级验收链

```text
电磁感应导轨
```

---

# 49. 不允许 Fake Demo

任何 Phase 禁止：

```text
固定 JSON
写死结果
Agent 假回复
Mock Simulation
```

冒充正式完成。

---

# 50. UI Skeleton

早期允许 Skeleton。

但功能验收时必须接真实 Runtime。

---

# 51. Contract First

跨模块能力：

```text
Contract
↓
Test
↓
Producer
↓
Consumer
```

---

# 52. Golden First

Physics 新模型：

```text
Golden Case
↓
Implementation
```

---

# 53. Milestone A — Physics World Foundation

达到：

```text
PhysicsScene
Timeline
Kinematics
Mechanics
Magnetic
Verifier
Observation
Renderer
Workspace
```

---

# 54. Milestone B — Physics Agent

达到：

```text
Agent Runtime
Harness Adapter
Tools
Context
Workflow
Tutor
```

---

# 55. Milestone C — Question World

达到：

```text
Document
OCR
Diagram IR
Physics IR
Scene Builder
Question Space
Question → Experiment
```

---

# 56. Milestone D — Complete Core Domains

达到：

```text
Electric
Circuit
Induction
EM Composite
Dynamic Question
Learning Model
```

---

# 57. Milestone E — Teacher / Curriculum

达到：

```text
Teacher Studio
完整 Skills
实验模板
题型模板
```

---

# 58. Milestone F — Desktop

达到：

```text
Tauri Shell
PlatformBridge
Native Files
Update
Optional Local Runtime
```

---

# 59. 产品级验收指标

持续关注：

```text
Physics Accuracy
Scene Reliability
Question Parse Accuracy
Agent Tool Accuracy
Tutor Quality
UI Fidelity
Performance
Recovery
```

---

# 60. 永久不可牺牲

任何进度压力下都不能牺牲：

```text
PhysicsScene 单一事实源
Physics Engine 决定结果
Tool Guard
Contract
Golden Test
真实集成
```

---

# 61. 文档完成后的第一工程任务

```text
初始化 Monorepo
↓
建立 UI / Contracts / Core Skeleton
↓
建立第一条 Magnetic Vertical Slice
```

---

# 62. 一句话路线原则

> **PhysicsOS 必须从稳定 Contract 与真实 Physics Runtime 向上生长，每个阶段都形成可测试、可复现、可继续扩展的真实工程资产，而不是堆叠看起来完成的页面和 Mock。**
