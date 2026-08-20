# PhysicsOS Physics Engine 架构设计

> 文件：`docs/05-PHYSICS-ENGINE-ARCHITECTURE.md`  
> 文档定位：PhysicsOS 物理世界运行时 / Physics Engine / Simulation / Verification / Observation 总体架构  
> 上游文档：  
> - `00-PRODUCT-OVERVIEW.md`  
> - `01-DEVELOPMENT-GUIDE.md`  
> - `02-ENGINEERING-STANDARDS.md`  
> - `03-DOMAIN-CONTRACTS.md`  
> - `04-AGENT-ARCHITECTURE.md`
>
> 本文档定义 PhysicsOS 中“物理世界如何真实运行”的核心架构。
>
> **最高原则：LLM 可以理解物理，但 Physics Engine 才负责决定物理世界真正发生什么。**

---

# 1. 文档目标

本文档回答以下问题：

```text
PhysicsScene 到底是什么
Scene 如何被修改
Physics Engine 如何选型
不同物理领域如何协同
Simulation 如何运行
时间轴如何回放
单位如何统一
数值计算如何保证稳定
Verifier 如何保证结果可信
Observation 如何把物理量变成可见内容
Renderer 与 Engine 如何解耦
2D / 3D 如何共用同一物理事实
如何测试整个 Physics Runtime
```

PhysicsOS 的技术壁垒之一，就是：

> **建立一套真正可运行、可验证、可回放、可扩展的中学物理数字世界。**

---

# 2. Physics Runtime 总体架构

```text
                         PhysicsOS Application
                                  │
                                  ↓
                           PhysicsScene API
                                  │
                                  ↓
                      ┌─────────────────────┐
                      │ PhysicsSceneRuntime │
                      └──────────┬──────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            ↓                    ↓                    ↓
      Scene Command          Scene Query         Timeline
            │                    │                    │
            ↓                    │                    │
       Validation                │                    │
            ↓                    │                    │
      Physics Event              │                    │
            ↓                    │                    │
        Reducer                  │                    │
            ↓                    │                    │
      Scene Revision ────────────┴────────────────────┘
                                 │
                                 ↓
                       Simulation Orchestrator
                                 │
                 ┌───────────────┼────────────────┐
                 ↓               ↓                ↓
             Engine Registry   Math Runtime     Units Runtime
                 │
    ┌────────────┼───────────────────────────────────────┐
    ↓            ↓            ↓            ↓             ↓
Mechanics     Electric     Magnetic       Circuit      Induction
    │            │            │            │             │
    └────────────┴────────────┴────────────┴─────────────┘
                                 │
                                 ↓
                          SimulationResult
                                 │
                                 ↓
                          Physics Verifier
                                 │
                                 ↓
                         Observation Runtime
                                 │
                                 ↓
                        Visual Scene Model
                                 │
                                 ↓
                            Renderer
```

---

# 3. Physics Runtime 的职责边界

Physics Runtime 负责：

```text
世界状态
物理规律
事件
时间演化
数值求解
场景验证
结果验证
可观测数据生成
```

Physics Runtime 不负责：

```text
页面路由
按钮
聊天 UI
账号
课程权限
Prompt
LLM Provider
数据库页面 DTO
```

---

# 4. PhysicsScene 的定位

PhysicsScene 表示：

> **某一个明确 revision 下，物理世界是什么。**

不是：

```text
页面怎么画
用户怎么操作
Agent 怎么描述
Simulation 历史的全部数据
```

PhysicsScene 保存：

```text
对象
场
区域
边界
约束
电路
时间线配置
测量定义
Observable 定义
```

---

# 5. PhysicsScene Runtime

推荐：

```text
PhysicsSceneRuntime
│
├── SceneGraph
├── CommandBus
├── Validator
├── EventStore
├── Reducer
├── SnapshotStore
├── QueryService
├── TimelineRuntime
└── BranchManager
```

---

# 6. SceneGraph

SceneGraph 是当前 Scene 的结构化表示。

至少组织：

```text
Bodies
Particles
Fields
Forces
Regions
Boundaries
Constraints
Circuits
Measurements
Observables
Annotations
```

SceneGraph 负责：

```text
对象索引
引用关系
快速查找
结构一致性
```

---

# 7. Scene 不允许直接 Mutation

禁止：

```ts
scene.particles[0].velocity = nextVelocity
```

所有变化必须经过：

```text
Command
↓
Validation
↓
Event
↓
Reducer
↓
New Scene Revision
```

---

# 8. SceneCommand

例如：

```text
AddParticle
ChangeParticleMass
AddMagneticField
ChangeMagneticFieldStrength
AddBoundary
ConnectCircuit
SeekTimeline
EnableObservable
```

Command 是：

> **对世界提出一个修改请求。**

---

# 9. PhysicsEvent

Event 是：

> **这个修改已经被验证并发生。**

例如：

```text
ParticleAdded
ParticleMassChanged
MagneticFieldAdded
MagneticFieldStrengthChanged
BoundaryAdded
CircuitConnected
TimelineSeeked
ObservationEnabled
```

---

# 10. Event Sourcing 价值

PhysicsOS 使用 Physics Event Stream 可以天然支持：

```text
Undo
Redo
Replay
Branch
Audit
Agent Trace
Teacher Playback
Debug
Scene Restore
```

---

# 11. Scene Revision

每个有效 Scene Mutation：

```text
revision + 1
```

Revision 用于：

```text
并发控制
Agent Context
Simulation Input
Result Trace
Cache Key
Snapshot
```

---

# 12. SnapshotStore

EventStore 解决：

```text
发生过什么
```

Snapshot 解决：

```text
如何快速恢复
```

Snapshot 建议在：

```text
固定 Event 数
重要用户保存点
Branch 前
大型 Simulation 前后
```

创建。

---

# 13. BranchManager

PhysicsOS 应原生支持 Scene Branch。

例如学生问：

> 如果磁感应强度变成原来的 2 倍呢？

推荐：

```text
Original Scene
     │
     ├── Branch A: B
     │
     └── Branch B: 2B
```

然后对比：

```text
轨迹
半径
周期
出场位置
```

而不是破坏原 Scene。

---

# 14. Physics Timeline

Timeline 是 PhysicsScene Runtime 的一等能力。

提供：

```text
play
pause
seek
step
setPlaybackRate
reset
```

---

# 15. Timeline 时间概念

必须区分：

```text
Wall Clock Time
Simulation Time
Render Time
```

Wall Clock：

```text
现实经过多久
```

Simulation Time：

```text
物理世界内部 t
```

Render Time：

```text
界面当前播放帧
```

三者不得混淆。

---

# 16. 时间机器

用户拖动到：

```text
t = 1.35s
```

系统必须恢复该时刻：

```text
位置
速度
加速度
受力
电流
场状态
能量
关键事件
```

不能只移动一个播放指针。

---

# 17. Event-based Seek

除了按时间：

```text
seek(t)
```

还支持按物理事件：

```text
seek(eventId)
```

例如：

```text
ParticleEnteredRegion
CollisionOccurred
SwitchClosed
```

方便 Agent 教学。

---

# 18. Physics Units Runtime

单独 package：

```text
physics-units
```

核心原则：

> **Engine 内部统一 SI。**

---

# 19. SI Canonical Units

至少：

```text
length              m
time                s
mass                kg
electric_charge     C
electric_current    A
velocity            m/s
acceleration        m/s²
force               N
energy              J
power               W
electric_potential  V
electric_field      N/C
magnetic_field      T
magnetic_flux       Wb
resistance          Ω
capacitance         F
inductance          H
frequency           Hz
angle               rad
momentum             kg·m/s
```

---

# 20. Unit Conversion Pipeline

```text
UI Input
↓
Parse Quantity
↓
Unit Validation
↓
Dimension Validation
↓
Convert to Canonical SI
↓
Physics Engine
```

输出：

```text
Canonical Result
↓
Display Unit Strategy
↓
UI
```

---

# 21. 禁止裸物理 number

例如：

```ts
mass: 2
```

无法知道：

```text
2 kg?
2 g?
```

所以跨模块必须使用：

```text
Quantity
QuantityVector
```

---

# 22. Dimension Checking

任何跨 Tool / Engine 的输入必须可验证：

```text
force = mass × acceleration
```

维度：

```text
M × LT⁻²
```

如果输入：

```text
mass = 2s
```

应在 Engine 前直接失败。

---

# 23. Math Runtime

数学层独立：

```text
Math Runtime
│
├── Symbolic
├── Numerical
├── Geometry
├── Equation Solver
├── ODE Solver
├── Matrix
├── Root Finding
├── Optimization
└── Unit Math
```

---

# 24. Math Runtime 不等于 Physics Engine

Math Runtime 只知道：

```text
数学
```

不知道：

```text
这个公式在磁场问题中是否成立
```

例如：

```text
solve(x² = 4)
```

Math Runtime 可以返回：

```text
x = ±2
```

但哪一个根符合物理条件，由：

```text
Physics Engine / Verifier
```

判断。

---

# 25. TypeScript 与 Python 数学边界

基础实时仿真优先：

```text
TypeScript
```

复杂数学：

```text
Python Math Service
```

推荐：

```text
SymPy
NumPy
SciPy
```

但 Physics Engine 只依赖：

```text
MathRuntime Interface
```

不依赖 SymPy HTTP 细节。

---

# 26. Physics Engine Registry

统一注册：

```text
Mechanics Engine
Kinematics Engine
Gravity Engine
Electric Engine
Magnetic Engine
EM Composite Engine
Circuit Engine
Induction Engine
Optics Engine
Wave Engine
Thermal Engine
Modern Physics Engine
```

---

# 27. Engine Interface

概念接口：

```ts
interface PhysicsEngine {
  readonly id: string
  readonly version: string
  readonly domain: PhysicsDomain

  supports(
    scene: PhysicsScene
  ): boolean

  validate(
    scene: PhysicsScene
  ): VerificationResult

  simulate(
    scene: PhysicsScene,
    options: SimulationOptions
  ): Promise<SimulationResult>
}
```

---

# 28. Engine Version

所有 SimulationResult 必须记录：

```text
engineId
engineVersion
```

这样以后 Engine 算法升级后仍然知道：

> 这个旧结果是用哪个版本计算的。

---

# 29. Simulation Orchestrator

场景可能同时涉及多个领域。

例如：

```text
电磁感应导轨
```

需要：

```text
Mechanics
+
Magnetic
+
Circuit
+
Induction
```

因此不能让应用层自己组合 Engine。

由：

```text
Simulation Orchestrator
```

负责领域调度。

---

# 30. Domain Detection

Simulation Orchestrator 根据：

```text
Scene Objects
Fields
Circuits
Constraints
Requested Domain
```

确定需要哪些 Engine。

例如：

```text
Particle + MagneticField
→ Magnetic

Rod + Rail + MagneticField + Circuit
→ Mechanics + Magnetic + Circuit + Induction
```

---

# 31. Composite Simulation

复合物理不能简单：

```text
先算力学
再算电学
```

而要根据依赖关系做 Coupled Simulation。

例如导体棒：

```text
velocity
↓
induced emf
↓
current
↓
ampere force
↓
acceleration
↓
velocity
```

属于反馈闭环。

---

# 32. Simulation Dependency Graph

建议构建：

```text
Simulation Dependency Graph
```

例如：

```text
Velocity
   ↓
Induced EMF
   ↓
Current
   ↓
Ampere Force
   ↓
Acceleration
   ↓
Velocity
```

每个 time step 按依赖更新。

---

# 33. Analytical Solver 优先

对于可以精确解析的中学物理模型：

优先：

```text
Analytical Solver
```

例如：

```text
匀速运动
匀变速运动
自由落体
平抛
理想圆周运动
带电粒子匀强磁场
简单串并联
```

优点：

```text
精确
快速
便于教学解释
稳定
易验证
```

---

# 34. Numerical Solver

复杂模型使用：

```text
Numerical Solver
```

例如：

```text
非线性阻力
复杂约束
耦合电磁感应
多体碰撞
复杂区域切换
```

---

# 35. Solver Strategy

每个 Engine 可以：

```text
Analytical
Numerical
Hybrid
```

由 Engine 根据 Scene 自动选择。

---

# 36. Solver Metadata

SimulationResult 记录：

```text
solver
timeStep
tolerance
iterations
deterministic
randomSeed
```

---

# 37. Mechanics Engine

主要覆盖：

```text
受力
牛顿定律
平衡
摩擦
弹力
支持力
拉力
连接体
约束
斜面
滑轮
弹簧
功
功率
能量
动量
碰撞
```

---

# 38. Mechanics Object Model

主要依赖：

```text
Body
Force
Constraint
Boundary
GravityField
Material
```

---

# 39. Force Resolution

Mechanics Engine 应能提供：

```text
force list
net force
component force
normal force
friction
constraint force
```

作为 Derived Quantity。

---

# 40. Friction Model

至少支持：

```text
static friction
kinetic friction
```

需要：

```text
μs
μk
normal force
relative motion state
```

不能简单永远：

```text
f = μN
```

---

# 41. Constraint Solver

连接体问题需要支持：

```text
fixed
rope
distance
surface
track
spring
```

约束力属于：

```text
Derived Force
```

---

# 42. Kinematics Engine

主要处理：

```text
x(t)
v(t)
a(t)
trajectory
state_at(t)
```

适合：

```text
匀速
匀变速
自由落体
竖直上抛
平抛
斜抛
圆周运动
```

---

# 43. Projectile Model

平抛：

```text
x = v0 t
y = 1/2 gt²
```

斜抛：

```text
x = v0 cosθ · t
y = v0 sinθ · t - 1/2 gt²
```

注意：

> 公式属于 Engine 内部模型，不属于 UI。

---

# 44. Gravity Engine

覆盖：

```text
near-earth uniform gravity
universal gravitation
satellite
orbital motion
escape model
```

初高中优先满足教学常见模型。

---

# 45. Electric Engine

负责：

```text
Coulomb force
electric field
field superposition
electric potential
potential energy
uniform electric field
particle motion
capacitor field
```

---

# 46. Electric Field Sampling

Observation 可请求：

```text
vector grid
field line
potential map
equipotential line
```

但 Field Sampling 是：

```text
Electric Engine / Observation Computation
```

不是 Renderer 自己猜。

---

# 47. Electric Potential

必须区分：

```text
Electric Potential
Electric Potential Energy
```

Agent / UI / Skill 都不能混为一谈。

---

# 48. Magnetic Engine

负责：

```text
Magnetic Field
Lorentz Force
Ampere Force
Charged Particle Motion
Magnetic Region
Boundary Crossing
Critical Geometry
```

---

# 49. Lorentz Force

基础：

```text
F = q(v × B)
```

需要保留：

```text
大小
方向
适用条件
```

当：

```text
v ∥ B
```

则：

```text
F = 0
```

---

# 50. Uniform Magnetic Circular Motion

在：

```text
v ⟂ B
only magnetic force
uniform B
```

条件下：

```text
r = mv / |q|B
T = 2πm / |q|B
```

Engine 必须验证成立条件。

---

# 51. Magnetic Region Boundary

高中磁场题大量依赖几何边界。

必须支持：

```text
Rectangle
Circle
Polygon
Half Plane
Segment Boundary
```

并计算：

```text
entry
exit
intersection
critical condition
```

---

# 52. EM Composite Engine

专门处理：

```text
Electric + Magnetic
Electric + Gravity
Magnetic + Gravity
Electric + Magnetic + Gravity
```

典型：

```text
速度选择器
质谱仪
回旋加速器
多场区
```

---

# 53. Region Switching

粒子从：

```text
Electric Region
↓
Vacuum Region
↓
Magnetic Region
```

时：

```text
ParticleExitedRegion
ParticleEnteredRegion
```

必须生成 Physics Event。

然后 Simulation Model 更新。

---

# 54. Circuit Engine

Circuit 使用 Graph。

```text
CircuitGraph
│
├── Nodes
├── Components
├── Terminals
└── Connections
```

禁止只维护：

```text
一张 SVG + 一组动画
```

---

# 55. Circuit Solver

至少支持：

```text
Series / Parallel
Kirchhoff
Node Voltage
Branch Current
Closed Circuit Ohm Law
Internal Resistance
Switch
Variable Resistor
Meter
Capacitor
```

---

# 56. Meter Model

电流表 / 电压表不能永远当理想值。

支持：

```text
ideal
non-ideal internal resistance
```

方便实验题。

---

# 57. Dynamic Circuit

滑动变阻器或开关变化：

```text
Circuit Parameter Changed
↓
Re-solve Circuit
↓
Current / Voltage Observable Updated
```

---

# 58. Induction Engine

负责：

```text
magnetic flux
Faraday law
Lenz law
motional emf
moving rod
moving loop
rail
double rod
self induction
mutual induction
```

---

# 59. Induction + Mechanics Coupling

例如：

```text
Rod velocity
↓
ε = BLv
↓
I = ε/R
↓
F = BIL
↓
a = F/m
↓
velocity changes
```

这是标准 Coupled Simulation。

---

# 60. Optics Engine

覆盖：

```text
reflection
refraction
plane mirror
lens
ray tracing
image formation
critical angle
total internal reflection
```

---

# 61. Optics 表达

Optics Engine 输出：

```text
Ray
Intersection
Image Point
Focal Relation
Optical Path
```

Renderer 只负责画光线。

---

# 62. Wave Engine

覆盖：

```text
simple harmonic motion
mechanical wave
wave propagation
phase
interference
standing wave
```

---

# 63. Thermal Engine

覆盖：

```text
temperature
heat
specific heat
ideal gas basic model
thermodynamic process
energy transfer
```

具体范围按初高中课程逐步扩展。

---

# 64. Modern Physics Engine

现代物理不强制使用经典连续动力学。

采用专门模型：

```text
photoelectric effect
atomic energy level
transition
radioactive decay
nuclear reaction
```

---

# 65. Geometry Runtime

几何对高中物理非常关键。

建议独立能力：

```text
Line
Segment
Circle
Arc
Polygon
Intersection
Tangency
Projection
Distance
Angle
Region Containment
```

---

# 66. Geometry 与 Physics 分离

Geometry Runtime 回答：

```text
两个圆交点在哪
线与圆是否相交
```

Physics Engine 回答：

```text
哪个交点是粒子真实出场点
```

---

# 67. Collision Runtime

碰撞至少支持：

```text
elastic
inelastic
perfectly inelastic
boundary reflection
```

验证：

```text
momentum
energy where applicable
```

---

# 68. Physics Event During Simulation

Simulation 不只输出 State。

还要输出 Event：

```text
CollisionOccurred
ParticleEnteredRegion
ParticleExitedRegion
TurningPointReached
SwitchStateChanged
PeakReached
```

这些对 Timeline 与 Tutor 很重要。

---

# 69. SimulationRequest

一个 Simulation 必须固定：

```text
sceneId
sceneRevision
engine version
options
trace
```

不能 Simulation 运行中 Scene 被静默修改。

---

# 70. Scene Mutation During Simulation

用户运行时修改参数：

推荐：

```text
Pause Current Simulation
↓
Apply Scene Command
↓
New Revision
↓
Start New Simulation
```

而不是在旧 SimulationResult 中热改事实。

---

# 71. SimulationResult

必须至少包含：

```text
sceneId
sceneRevision
simulationId
engineVersion
states
events
measurements
derived quantities
verification
metadata
```

---

# 72. State Sampling

Simulation 内部可能：

```text
dt = 0.0001s
```

但 UI 不需要保存百万帧。

区分：

```text
solver step
storage sample
render sample
chart sample
```

---

# 73. Trajectory Storage

轨迹支持：

```text
Raw high precision
Display sampled
Chart sampled
```

大型轨迹可以：

```text
chunk
compress
decimate
```

---

# 74. Adaptive Time Step

复杂 Numerical Solver 可以：

```text
adaptive timestep
```

但必须记录：

```text
solver metadata
```

方便 Debug 与 Replay。

---

# 75. Floating Point Tolerance

统一提供：

```text
absolute tolerance
relative tolerance
domain tolerance
```

不同 Domain 可以覆盖。

---

# 76. Determinism

经典教学仿真默认：

```text
deterministic = true
```

相同输入必须得到相同结果。

如果未来加入随机过程：

```text
randomSeed
```

必须保存。

---

# 77. Simulation Cache

缓存键建议包含：

```text
sceneId
sceneRevision
engine versions
simulation options
```

不能只用：

```text
sceneId
```

---

# 78. Physics Verifier

Verifier 是 Physics Runtime 的核心组成，不是附加功能。

```text
Physics Verifier
│
├── Schema
├── Units
├── Symbolic
├── Numerical
├── Constraint
├── Conservation
├── Boundary
├── Continuity
├── Trajectory
└── Semantic Review
```

---

# 79. Scene Validation

Simulation 前验证：

```text
对象引用
单位
质量
电荷
区域
边界
约束
电路拓扑
时间配置
```

失败：

```text
拒绝运行
```

不能带着非法 Scene 硬算。

---

# 80. Dimensional Verification

检查：

```text
公式两边量纲
输入量纲
输出量纲
```

这是最便宜、最稳定的第一层验证。

---

# 81. Symbolic Verification

对于解析模型：

```text
SymPy / symbolic
```

验证：

```text
表达式等价
边界条件
特殊值
```

---

# 82. Numerical Verification

数值结果验证：

```text
finite
within tolerance
no NaN
no Infinity
solver convergence
```

---

# 83. Constraint Verification

检查：

```text
rope length
surface contact
fixed point
track
circuit topology
```

是否被破坏。

---

# 84. Conservation Verification

适用时：

```text
energy
momentum
charge
```

作为 Invariant。

注意：

> 只在物理模型确实满足守恒时检查。

---

# 85. Boundary Verification

磁场 / 电场 / 光学题重点检查：

```text
entry point
exit point
intersection
inside/outside
boundary continuity
```

---

# 86. Trajectory Verification

检查：

```text
连续性
速度方向
加速度关系
曲率
区域切换
```

例如纯匀强磁场中：

```text
speed magnitude should remain constant
```

---

# 87. Semantic Review

LLM Semantic Review 仅用于：

```text
题意映射是否合理
解释是否与数学结果一致
隐含条件是否遗漏
```

不能覆盖 deterministic verifier 的失败。

---

# 88. Verification Status

统一：

```text
passed
passed_with_warnings
failed
```

---

# 89. Simulation Failure

禁止：

```text
Simulation Failed
↓
仍然返回一条“看起来合理”的轨迹
```

必须明确：

```text
failed
error code
traceId
```

---

# 90. Observation Runtime 定位

Physics Engine 解决：

> **世界发生什么。**

Observation Runtime 解决：

> **用户能够看到什么。**

---

# 91. Observable 分类

```text
Vector
Trajectory
Field
Potential
Energy
Momentum
Geometry
Measurement
Graph
Annotation
```

---

# 92. Vector Observation

支持：

```text
Force
Velocity
Acceleration
Momentum
Electric Field
Magnetic Field where meaningful
```

---

# 93. Vector Scale

矢量显示长度不能简单等于真实数值。

Observation Layer 使用：

```text
display scale
normalization
log scale if needed
```

但 Label 应显示真实值。

---

# 94. Force Observation

可以显示：

```text
gravity
normal
friction
tension
electric
lorentz
ampere
net force
```

用户自由选择。

---

# 95. Trajectory Observation

提供：

```text
full path
recent trail
predicted path
key points
entry / exit
turning points
```

预测轨迹必须明确标记为：

```text
predicted
```

不要和已发生轨迹混淆。

---

# 96. Field Observation

Electric Field：

```text
vector grid
field lines
potential map
equipotential lines
```

Magnetic Field：

```text
direction glyphs
region fill
field magnitude map
```

---

# 97. Energy Observation

至少：

```text
kinetic
potential
mechanical
electric potential energy
spring potential energy
```

支持：

```text
numeric
bar
time graph
```

---

# 98. Measurement Layer

允许：

```text
尺子
计时器
电流表
电压表
速度计
坐标读取
```

Measurement 与 Engine Result 关联。

---

# 99. Graph Layer

支持：

```text
x-t
v-t
a-t
F-t
E-t
I-t
U-t
P-t
```

图表数据来自：

```text
Measurement / SimulationResult
```

不是 UI 自算。

---

# 100. Geometry Observation

高中题特别需要：

```text
圆心
半径
角度
切线
弦
垂线
辅助线
边界交点
```

这些属于 Observation，不一定属于 PhysicsScene permanent object。

---

# 101. Annotation

Annotation 可以来自：

```text
Teacher
Agent
System
User
```

包括：

```text
公式
标签
关键点
解释箭头
```

---

# 102. ObservationPlan

Agent 可以生成：

```text
ObservationPlan
```

例如：

```text
show velocity
show lorentz force
hide acceleration
pause at region entry
highlight orbit center
```

---

# 103. Observation 不改变物理事实

开关：

```text
show force = false
```

并不表示：

```text
force 不存在
```

只是隐藏。

---

# 104. Rendering Architecture

严格：

```text
PhysicsScene / SimulationResult
          ↓
Observation Model
          ↓
Visual Scene Model
          ↓
Renderer
```

---

# 105. Visual Scene Model

这是 Renderer 的输入。

可以包含：

```text
Primitive
Vector Glyph
Trajectory Path
Field Glyph
Label
Annotation
Graph Data
Camera Hint
```

但它不反向成为 PhysicsScene。

---

# 106. Renderer 类型

```text
SVG Renderer
Canvas Renderer
Pixi Renderer
Three Renderer
Chart Renderer
```

---

# 107. SVG

优先用于：

```text
静态受力图
电路图
简单几何
辅助线
高质量导出
```

---

# 108. PixiJS / Canvas

优先：

```text
高频 2D Simulation
大量粒子
动态轨迹
交互
```

---

# 109. Three.js

只用于真正需要：

```text
3D 场
空间轨迹
立体光学
空间矢量
```

不要所有题都 Three.js。

---

# 110. 2D / 3D 同一事实源

正确：

```text
PhysicsScene
↓
2D Observation
↓
2D Renderer

PhysicsScene
↓
3D Observation
↓
3D Renderer
```

不是：

```text
2D Scene
3D Scene
```

两套。

---

# 111. Coordinate Transform

必须区分：

```text
Physics Coordinate
World Coordinate
Screen Coordinate
```

例如：

```text
Physics y ↑
Screen y ↓
```

由 CoordinateTransform 负责。

---

# 112. Renderer Interaction

用户拖动物体：

```text
Pointer
↓
Hit Test
↓
RendererInteraction
↓
Application Controller
↓
Scene Command
↓
Scene Runtime
```

Renderer 不直接修改 Scene。

---

# 113. Object Library

场景编辑器中的：

```text
物块
小球
斜面
弹簧
电荷
磁场
电源
电阻
透镜
```

本质是：

```text
Scene Template
```

而不是 Renderer-specific prefab。

---

# 114. Scene Template

模板定义：

```text
默认 Physics Object
默认属性
默认 Observable
默认 visual token
```

实例化后生成标准 PhysicsScene object。

---

# 115. Physics Skills 与 Engine

Skill 可以知道：

```text
应该调用哪个 Engine
适用公式
条件
常见误区
推荐 Observable
```

但 Skill 不复制 Engine 代码。

---

# 116. Agent 与 Physics Engine

Agent 必须通过 Tool。

例如：

```text
Agent:
“计算轨迹半径”

↓
physics.magnetic.radius

↓
Magnetic Engine

↓
DerivedQuantity
```

不能模型自己偷偷算然后当正式值。

---

# 117. Tool 与 Engine

Tool 是：

```text
Agent-facing API
```

Engine 是：

```text
Domain computation
```

一个 Tool 可以组合多个 Engine。

但 Engine 不知道 Agent Tool 的存在。

---

# 118. Simulation Service

服务端：

```text
services/simulation
```

负责：

```text
long simulation
server-side simulation
batch simulation
heavy computation
shared simulation
```

---

# 119. Browser Simulation

低中复杂度实时实验：

```text
Web Worker
+
TypeScript Physics Engine
```

优先本地浏览器运行，减少延迟。

---

# 120. Server Simulation

以下情况考虑服务端：

```text
大规模多体
复杂 ODE
批量题目
高精度长仿真
教师批量生成
```

---

# 121. Browser / Server 一致性

相同 Engine Core 尽量共享。

如果服务端有高级实现：

必须建立：

```text
cross-runtime golden tests
```

确保关键结果一致。

---

# 122. Physics Worker Architecture

```text
UI Thread
│
├── Interaction
├── React
├── Renderer
└── Agent UI

Physics Worker
│
├── Scene Slice
├── Simulation
├── Trajectory
└── Sampling
```

---

# 123. Worker Contract

Worker 输入：

```text
SimulationRequest
```

输出：

```text
SimulationProgress
SimulationResult
SimulationError
```

不能传：

```text
DOM
Function
Renderer Object
```

---

# 124. SimulationProgress

推荐：

```ts
interface SimulationProgress {
  simulationId: string
  progress: number
  simulatedTime?: number
  message?: string
}
```

---

# 125. Long-running Simulation

支持：

```text
start
progress
cancel
resume where safe
```

---

# 126. Cancellation

Simulation 被取消：

```text
不要返回 completed result
```

应明确：

```text
cancelled
```

已创建的 Scene Event 不自动回滚。

---

# 127. Physics Runtime Error Codes

至少：

```text
INVALID_SCENE
INVALID_UNIT
INVALID_DIMENSION
INVALID_PARAMETER
UNSUPPORTED_MODEL
ENGINE_NOT_FOUND
ENGINE_CONFLICT
SOLVER_DID_NOT_CONVERGE
NUMERICAL_INSTABILITY
BOUNDARY_ERROR
CONSTRAINT_VIOLATION
SIMULATION_CANCELLED
SIMULATION_TIMEOUT
VERIFICATION_FAILED
```

---

# 128. Physics Logging

每次 Simulation 至少记录：

```text
simulationId
sceneId
sceneRevision
engine
engineVersion
solver
duration
verification status
traceId
```

---

# 129. Physics Metrics

至少：

```text
simulation count
simulation duration
engine usage
verification failure rate
solver failure rate
worker duration
cache hit rate
```

---

# 130. Golden Test 是核心资产

目录：

```text
tests/golden/
```

每个经典物理模型应有：

```text
input scene
expected result
tolerance
invariants
```

---

# 131. Mechanics Golden Cases

至少：

```text
匀速直线
匀变速
自由落体
竖直上抛
平抛
斜抛
斜面静止
斜面滑动
弹簧
连接体
圆周运动
动量守恒
完全弹性碰撞
完全非弹性碰撞
```

---

# 132. Electric Golden Cases

```text
两点电荷
电场叠加
匀强电场
等势关系
带电粒子偏转
电容器基础
```

---

# 133. Magnetic Golden Cases

```text
v ∥ B
v ⟂ B
positive charge
negative charge
orbit radius
period
半圆
四分之一圆
矩形磁场出场
圆形磁场
```

---

# 134. Circuit Golden Cases

```text
series
parallel
mixed
internal resistance
variable resistor
meter ideal
meter non-ideal
switch
```

---

# 135. Induction Golden Cases

```text
moving rod
loop entering field
loop leaving field
rail rod
double rod
```

---

# 136. Golden Case 不只测数值

还要测：

```text
方向
事件
轨迹性质
守恒关系
公式
边界
```

---

# 137. Property-based Tests

适合：

```text
Unit conversion
Vector operations
Energy conservation
Momentum conservation
Rotation invariance
Symmetry
```

---

# 138. Metamorphic Testing

例如磁场圆周运动：

```text
v × 2
→ r × 2

B × 2
→ r ÷ 2

m × 2
→ r × 2

|q| × 2
→ r ÷ 2
```

这种测试非常适合 Physics Engine。

---

# 139. Conservation Tests

适用模型中自动检查：

```text
momentum
mechanical energy
charge
```

---

# 140. Boundary Tests

重点：

```text
just inside
just outside
exactly on boundary
tangent
critical angle
critical radius
```

---

# 141. Unit Tests

底层：

```text
Vector
Geometry
Unit
Quantity
Reducer
Event
Constraint
```

必须大量 Unit Test。

---

# 142. Integration Tests

典型：

```text
PhysicsScene
↓
Engine
↓
Verifier
↓
Observation
```

---

# 143. Visual Regression

只验证：

```text
渲染是否正确
```

不能替代物理准确性测试。

---

# 144. Cross-engine Tests

复合场、感应等必须覆盖：

```text
多个 Engine 同时工作
```

例如：

```text
Induction + Circuit + Mechanics
```

---

# 145. Engine Compatibility

每个 Engine 声明：

```text
supported schema version
compatible domains
dependencies
```

---

# 146. Engine Capability

建议：

```ts
interface EngineCapability {
  domain: PhysicsDomain

  models: string[]

  dimensions: ('2d' | '3d')[]

  supportsRealtime: boolean

  supportsAnalytical: boolean

  supportsNumerical: boolean
}
```

---

# 147. Unsupported Model

如果用户构建超出当前支持范围：

必须返回：

```text
UNSUPPORTED_MODEL
```

而不是“尽量算一个”。

---

# 148. Progressive Domain Support

完整产品架构覆盖整个初高中，但每个 Engine 内部功能可以按模型逐步落地。

关键是：

> **Contract 和领域边界从第一天完整。**

不能为了开发顺序临时把全部 Physics 写成一个 `simulate.ts`。

---

# 149. Engine Package 结构

例如：

```text
engine-magnetic/
├── src/
│   ├── index.ts
│   ├── engine.ts
│   ├── models/
│   ├── solvers/
│   ├── validators/
│   ├── derived/
│   └── internal/
├── tests/
└── README.md
```

---

# 150. Engine README

每个 Engine README 必须说明：

```text
支持模型
不支持模型
输入
输出
公式
成立条件
Tolerance
Solver
Golden Tests
依赖 Engine
```

---

# 151. physics-core Package

只保存共享核心：

```text
Engine Contract
Simulation Contract
Registry
Common State
Common Derived Quantity
```

不要变成：

```text
所有物理代码都塞进 physics-core
```

---

# 152. physics-scene Package

负责：

```text
Scene Contract
Scene Runtime
Command
Event
Reducer
Snapshot
Branch
Query
```

不负责真正领域求解。

---

# 153. physics-events Package

如果 Event 数量继续扩大，可以独立：

```text
Physics Event Types
Event Serialization
Event Migration
Event Query
```

---

# 154. physics-units Package

负责：

```text
Unit Registry
Dimension
Conversion
Formatting
Validation
```

---

# 155. physics-verifier Package

负责：

```text
shared verifier runtime
verification contracts
generic checks
domain verifier registry
```

Domain-specific verifier 可以留在各 Engine。

---

# 156. physics-observation Package

负责：

```text
Observable definitions
Observation Plan execution
Data projection
Vector / trajectory / graph models
```

---

# 157. physics-renderer Package

负责：

```text
Visual Scene Model
Renderer adapters
Coordinate transform
viewport
interaction mapping
```

不能依赖 Agent Runtime。

---

# 158. Math Client Package

```text
physics-math-client
```

负责统一：

```text
Symbolic
ODE
Equation
Matrix
Geometry advanced
```

远程调用。

---

# 159. Physics Data Precision

内部保存：

```text
full computational precision
```

显示：

```text
按教学需要 round
```

禁止为了 UI：

```text
先 round 再继续算
```

---

# 160. Significant Figures

未来可增加：

```text
Significant Figure Policy
```

作为：

```text
Question / Teaching Layer
```

不是底层 Engine 计算精度。

---

# 161. Formula Representation

Derived Quantity 可以保留：

```text
expression
latex
variables
conditions
```

这样 Tutor 可以可靠解释。

---

# 162. Formula 来源

公式来源于：

```text
Engine Model
Skill
Math Derivation
```

不能由 UI 硬编码一套。

---

# 163. Assumption Tracking

Simulation 使用假设：

例如：

```text
ignore air resistance
ideal meter
uniform magnetic field
```

必须可追踪。

SimulationResult 应能引用：

```text
assumptions
```

---

# 164. Model Selection

例如斜抛：

如果用户关闭空气阻力：

```text
Ideal Projectile Model
```

打开空气阻力：

```text
Numerical Drag Model
```

Engine 应明确切换模型。

---

# 165. Idealization 是教学一等能力

中学物理大量依赖：

```text
光滑
轻绳
轻滑轮
理想电表
匀强场
不计空气阻力
```

这些不能只是题目文字。

应成为：

```text
Scene / Model Assumption
```

---

# 166. Physics Assumption UI

用户应该可以看到：

```text
当前模型假设
```

例如：

```text
✓ 不计空气阻力
✓ 绳不可伸长
✓ 滑轮质量忽略
```

修改假设会触发：

```text
Scene Revision
```

---

# 167. Educational Model vs Realistic Model

PhysicsOS 可以支持：

```text
Ideal Educational Model
Realistic Extended Model
```

但考试题默认遵循：

```text
题目给定的理想化条件
```

---

# 168. World Consistency

一个 Scene 中不能存在互相冲突的模型设置。

例如：

```text
fixed body
+
free motion
```

需在 Validation 阶段发现。

---

# 169. Circuit / Mechanical Object Link

某些场景：

```text
moving rod
```

同时属于：

```text
Mechanical Body
Circuit Component
```

建议通过：

```text
CrossDomainBinding
```

关联，而不是复制两个互不相关对象。

---

# 170. CrossDomainBinding

概念：

```ts
interface CrossDomainBinding {
  id: string
  sourceId: string
  targetId: string
  relation: string
}
```

例如：

```text
rod-body-1
↔
conductor-component-1
```

---

# 171. Composite Domain Coordinator

复杂耦合由：

```text
CompositeDomainCoordinator
```

组织。

不让：

```text
engine-mechanics
```

直接 import：

```text
engine-circuit internal code
```

避免强耦合。

---

# 172. Engine Communication

通过：

```text
Domain State
Derived Quantity
CrossDomain Contract
```

协作。

---

# 173. Simulation Step Model

概念：

```text
Read current state
↓
Compute field-dependent quantities
↓
Compute forces
↓
Solve circuit if needed
↓
Resolve constraints
↓
Integrate state
↓
Detect events
↓
Verify
↓
Emit sample
```

不同 Composite Model 可覆盖顺序。

---

# 174. Event Detection

数值仿真不能只依赖：

```text
某一帧刚好越过边界
```

应使用：

```text
event detection / root finding
```

尽可能精确找到：

```text
entry time
collision time
turning point
```

---

# 175. Event Time Precision

物理关键事件应比 UI frame 更精确。

例如：

```text
粒子出磁场时刻
```

不能只取最近 60fps 帧。

---

# 176. Simulation Replay

Replay 优先：

```text
SimulationResult
+
Scene Revision
```

而不是重新实时计算。

如果需要精确重现：

```text
Engine Version + Options + Seed
```

可再次运行验证。

---

# 177. Simulation Artifact

大型 Simulation 可以持久化：

```text
metadata
states chunk
events
measurements
hash
```

Object Storage 保存大数组。

---

# 178. Scene Export

场景导出时至少包含：

```text
Scene
Schema Version
Revision
Assumptions
Optional Snapshot
Asset Refs
```

---

# 179. Reproducibility

任何“教学回放”应该能够知道：

```text
Scene
Revision
Engine Version
Options
Seed
```

以实现可复现。

---

# 180. Physics Debugger

未来开发工具建议：

```text
Physics Debug Panel
```

查看：

```text
Scene Revision
Active Engines
Simulation Step
Derived Quantities
Events
Verifier Checks
Tolerance
Assumptions
```

---

# 181. Teacher Advanced View

教师高级模式可以看到：

```text
受力来源
方程
关键 Event
模型假设
Verifier
```

学生默认只看到适合教学的内容。

---

# 182. Performance Target

PhysicsOS 主工作区应以：

```text
流畅交互
```

为目标。

原则：

```text
Renderer 60fps target
Physics solver independent
React low-frequency updates
Worker for heavy simulation
```

---

# 183. Large Particle Scenes

虽然中学题通常对象少，但场可视化可能有大量采样点。

Field Glyph 应：

```text
LOD
sampling
viewport culling
```

---

# 184. Renderer Culling

屏幕外：

```text
Field Glyph
Particle Trail
Annotation
```

可以裁剪，但不能改变 Physics State。

---

# 185. Cache Layers

可以缓存：

```text
Unit Conversion
Geometry
Field Sampling
Simulation Result
Observation Projection
```

Cache 必须基于明确 key。

---

# 186. Invalid Cache

Scene Revision 变化：

相关 cache 必须失效。

---

# 187. Thread Safety / Concurrency

Web Worker 与主线程：

必须通过 message contract。

服务端并行 Simulation：

同一个 Scene Revision 是 immutable input。

---

# 188. Scene Immutability

在某 revision 下：

```text
PhysicsScene
```

视为不可变。

修改产生：

```text
new revision
```

这是整个并发与缓存设计的基础。

---

# 189. Physics API 示例

读取：

```text
GET /simulation/v1/scenes/{sceneId}/state
```

启动：

```text
POST /simulation/v1/runs
```

结果：

```text
GET /simulation/v1/runs/{simulationId}
```

长任务：

```text
SSE / progress
```

具体 API 以 OpenAPI 为准。

---

# 190. Agent Tool 示例

```text
physics.magnetic.radius
```

输入：

```text
particleId
fieldId
sceneId
sceneRevision
```

输出：

```text
radius
formula
conditions
verification
```

---

# 191. Observation Tool 示例

```text
physics.observe.force
```

输入：

```text
targetId
forceType
visible
```

修改：

```text
Observable State
```

而不是 Force 本身。

---

# 192. Scene Query Tool

推荐细粒度：

```text
physics.scene.get_object
physics.scene.get_state_at
physics.scene.get_active_fields
physics.scene.get_events
physics.scene.get_assumptions
```

避免 Agent 每次拉整个 Scene。

---

# 193. Physics Runtime Security

虽然物理数据不是危险系统，但仍要防：

```text
极端参数导致 DoS
无限 Simulation
巨大粒子数
超小 timestep
无限 endTime
```

需要：

```text
resource limit
```

---

# 194. Simulation Limits

设置：

```text
max objects
max particles
max simulation duration
min timestep
max samples
max iterations
```

Teacher / Admin 可有更高额度。

---

# 195. Graceful Failure

超出限制：

返回：

```text
RESOURCE_LIMIT_EXCEEDED
```

不要导致浏览器崩溃。

---

# 196. Physics Engine Definition of Done

一个 Engine Model 只有在以下条件满足后才算完成：

```text
Domain Contract
Input Validation
Unit Validation
Solver
Derived Quantities
Verifier
Golden Tests
Edge Cases
Observation Support
Documentation
```

---

# 197. 新 Physics Model 开发流程

例如新增：

```text
带电粒子进入圆形磁场
```

顺序：

```text
确认 Domain Contract
↓
确认 Geometry 能力
↓
增加 Golden Cases
↓
实现 Model Validator
↓
实现 Solver
↓
实现 Event Detection
↓
实现 Derived Quantity
↓
实现 Verifier
↓
实现 Observation
↓
实现 Tool
↓
补 Skill
↓
E2E
```

---

# 198. 禁止“先画出来再说”

PhysicsOS 开发不能：

```text
先在 Canvas 上画一个看起来像圆轨迹
↓
以后再补物理
```

必须：

```text
Engine
↓
Verified Result
↓
Observation
↓
Renderer
```

---

# 199. Physics Engine 与 Question Space

Question Space 构建出的 Scene：

必须和实验室手工创建的 Scene 使用同一个 Engine。

禁止：

```text
题目专用公式逻辑
+
实验室另一套模拟逻辑
```

---

# 200. Physics Engine 与 Dynamic Question

生成变式：

```text
Scene Branch
↓
Parameter Change
↓
Simulation
↓
Verify
↓
Question Generation
```

这样变式题答案由真实 Physics Engine 保证。

---

# 201. Physics Engine 与 Teacher Studio

老师创建实验：

```text
Scene Builder
↓
PhysicsScene
↓
Engine
↓
Verifier
↓
Observation
```

与学生实验完全同底座。

---

# 202. Physics Engine 与 Desktop

未来 EXE：

```text
Shared Physics Packages
```

直接复用。

如果采用本地 Runtime：

```text
Tauri
↓
Local Physics Worker / Sidecar
```

Contract 不变。

---

# 203. Physics Engine 与 Web

当前：

```text
Web
↓
Web Worker
↓
Shared TypeScript Physics Engine
```

复杂任务：

```text
Web
↓
Simulation Service
```

---

# 204. Engine Upgrade

升级核心算法：

```text
Engine Version++
↓
Run Golden Tests
↓
Run Cross-version Regression
↓
Check Stored Scene Compatibility
↓
Release
```

---

# 205. 旧 Simulation Result

旧结果保留其：

```text
engineVersion
```

不要无条件重写。

需要重新计算时明确：

```text
recomputed with new version
```

---

# 206. Scene Migration

PhysicsScene Schema 升级：

```text
Detect Version
↓
Migration
↓
Validation
↓
Load
```

不能：

```ts
oldScene as PhysicsScene
```

硬转。

---

# 207. Physics Event Migration

Event Schema 也需要 Migration 策略。

因为 EventStore 是长期资产。

---

# 208. Unit Registry Migration

单位 Key 改动属于高风险 Breaking Change。

必须提供：

```text
compat alias
migration
tests
```

---

# 209. Formula Versioning

如果某模型公式实现或假设变化：

记录：

```text
model id
model version
engine version
```

---

# 210. Observation Design Token

颜色等视觉规则不存 Engine。

Observation 只使用：

```text
semantic token
```

例如：

```text
force.gravity
vector.velocity
field.electric
```

具体颜色由 UI Design System 决定。

---

# 211. Accessibility 与 Observation

重要物理量不能只靠颜色区分。

还应：

```text
label
shape
line style
icon
```

---

# 212. Educational Explanation Data

Engine 可以输出：

```text
formula
condition
derived quantity
event
```

但不直接生成自然语言课堂讲稿。

那是 Tutor / Skill 的职责。

---

# 213. Model Assumption Visualization

Observation 可显示：

```text
“忽略空气阻力”
“匀强磁场”
“光滑斜面”
```

帮助学生理解理想模型。

---

# 214. Current Supported Capability Registry

建议系统维护：

```text
PhysicsCapabilityRegistry
```

列出：

```text
domain
model
engine
version
2d/3d
realtime
analytical/numerical
```

Agent 在创建 Scene 前可以查询。

---

# 215. Capability Tool

未来可有：

```text
physics.capability.check
```

防止 Agent 创建当前 Runtime 不支持的模型。

---

# 216. Physics Engine Observability

开发环境应可查看：

```text
Engine chosen
Solver chosen
Simulation steps
Event detection
Verification checks
Cache usage
```

---

# 217. Engine Trace 与 Agent Trace

通过统一：

```text
traceId
sceneId
sceneRevision
simulationId
toolCallId
```

打通。

---

# 218. Physics Runtime 数据流总图

```text
User / Agent
     │
     ↓
Scene Command
     │
     ↓
Scene Validator
     │
     ↓
Physics Event
     │
     ↓
PhysicsScene Revision
     │
     ↓
Simulation Request
     │
     ↓
Simulation Orchestrator
     │
     ├── Units Runtime
     ├── Math Runtime
     ├── Domain Engines
     └── Geometry Runtime
     │
     ↓
SimulationResult
     │
     ↓
Physics Verifier
     │
     ↓
Verified Result
     │
     ↓
Observation Runtime
     │
     ↓
Visual Scene Model
     │
     ↓
Renderer
```

---

# 219. 最终分层

```text
Domain Truth
→ PhysicsScene

Domain Change
→ Command + Event

Domain Evolution
→ Physics Engine

Mathematics
→ Math Runtime

Correctness
→ Physics Verifier

Visibility
→ Observation Runtime

Presentation
→ Renderer

Understanding / Teaching
→ Physics Agent
```

各层不得越权。

---

# 220. Physics Engine 最终原则

PhysicsOS 的 Physics Engine 不追求：

> **做一个通用科研级多物理场求解器。**

它追求：

> **针对初高中物理教学与试题模型，做到足够准确、足够稳定、足够可解释、足够可验证，并能够直接支撑动态可视化教学。**

因此设计优先级是：

```text
Correctness
↓
Determinism
↓
Explainability
↓
Interactivity
↓
Performance
↓
Generality
```

而不是为了“支持所有现实物理”牺牲教学可解释性。

---

# 221. 一句话 Physics Engine 架构

> **PhysicsScene 定义世界，Physics Engine 推动世界，Math Runtime 提供数学能力，Verifier 保证世界可信，Observation 让世界可见，Renderer 只负责把已经验证过的物理事实呈现在学生眼前。**
