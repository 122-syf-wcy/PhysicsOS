# PhysicsOS Agent 架构设计

> 文件：`docs/04-AGENT-ARCHITECTURE.md`  
> 文档定位：PhysicsOS Agent Runtime / Harness / Tools / Skills / Context / Memory 总体架构  
> 上游文档：  
> - `00-PRODUCT-OVERVIEW.md`  
> - `01-DEVELOPMENT-GUIDE.md`  
> - `02-ENGINEERING-STANDARDS.md`  
> - `03-DOMAIN-CONTRACTS.md`
>
> 本文档定义 PhysicsOS 中所有 Agent 相关能力的技术边界与运行方式。
>
> **核心原则：DeepSeek Harness 是 Agent 基础设施，不是 PhysicsOS 业务核心。**

---

# 1. 文档目标

本文档回答：

> **PhysicsOS 的 Agent 到底如何运行？**

需要明确：

```text
谁负责理解题目
谁负责创建 PhysicsScene
谁负责调用 Physics Engine
谁负责验证
谁负责教学
谁负责上下文
谁负责 Tool
谁负责 Memory
谁负责 Session
谁负责状态恢复
DeepSeek Harness 到底处于哪一层
```

PhysicsOS 的 Agent 不是普通聊天机器人。

它必须能够：

```text
理解题目
理解 PhysicsScene
读取 Physics IR
创建 / 修改物理场景
调用 Physics Tools
调用 Physics Engine
调用 Math Runtime
验证结果
控制 Observation
控制 Timeline
解释物理过程
诊断学生错误
维护长期学习状态
```

---

# 2. Agent 的最高原则

PhysicsOS Agent 遵守以下最高原则：

## 2.1 Agent 不是真实物理世界

Agent 可以：

```text
理解
规划
选择
解释
请求修改
```

但不能直接决定：

```text
物体最终在哪里
轨迹是什么
洛伦兹力具体是多少
电路电流是多少
碰撞后速度是多少
```

真实结果来自：

```text
Physics Engine
```

---

## 2.2 Agent 不直接修改 PhysicsScene

正确：

```text
Agent
↓
Physics Tool
↓
Tool Guard
↓
Scene Command
↓
PhysicsScene Runtime
↓
Physics Event
```

禁止：

```text
Agent
↓
scene.xxx = value
```

---

## 2.3 Agent Context 不能代替 PhysicsScene

Context 中只能保留：

```text
sceneId
sceneRevision
snapshotId
当前任务需要的 Observation Slice
```

真实 Scene 仍然在 Physics Runtime。

---

## 2.4 Solver 与 Tutor 分离

Solver 负责：

```text
得到正确结果
```

Tutor 负责：

```text
让学生理解正确结果
```

二者不可混为一个职责。

---

## 2.5 Harness 与 PhysicsOS 解耦

PhysicsOS 上层只依赖：

```text
PhysicsAgentRuntime API
```

DeepSeek Harness 只能通过：

```text
agent-dsh-adapter
```

接入。

---

# 3. Agent 总体架构

```text
                         PhysicsOS UI
                              │
                              ↓
                   Physics Agent Client
                              │
                              ↓
                 PhysicsAgentRuntime API
                              │
          ┌───────────────────┼───────────────────┐
          ↓                   ↓                   ↓
    Orchestrator         Context Manager       Tool Runtime
          │                   │                   │
          ├─────────────┬─────┴───────┬───────────┤
          ↓             ↓             ↓           ↓
   Question Parser  Scene Builder   Solver      Tutor
          │             │             │           │
          └─────────────┼──────┬──────┘           │
                        ↓      ↓                  │
                     Verifier Observation Planner │
                        │      │                  │
                        └──────┼──────────────────┘
                               ↓
                         Physics Runtime
                               │
                    ┌──────────┴──────────┐
                    ↓                     ↓
               Physics Engine         Math Runtime

                              ▲
                              │
                   PhysicsAgentRuntime API
                              │
                       DSH Adapter
                              │
                      DeepSeek Harness
                              │
      Model / Session / Loop / Tools / Prompt / Storage
```

---

# 4. DeepSeek Harness 的定位

PhysicsOS 不重新实现通用 Harness 能力。

DeepSeek Harness 负责：

```text
Agent Loop
Session
Turn / Step
Model Adapter
Tool Runtime Hook
Prompt Assembly
Context Injection
Compaction Extension Point
Storage
Streaming
Cancellation
Subagent / Workflow 基础设施
Trajectory / Trace 基础
```

PhysicsOS 负责：

```text
Physics Domain
Physics Workflow
Physics State Machine
Physics Tools
Physics Skills
Physics Context Policy
Learning Memory
Scene Reference
Physics Verifier
Tutor Policy
```

---

# 5. 为什么不 Fork Harness 业务核心

PhysicsOS 不采用：

```text
Fork DeepSeek Harness
↓
直接修改 Agent Loop
↓
把 Physics 业务写进 Harness 内核
```

而采用：

```text
DeepSeek Harness Upstream
        │
        ↓
Pinned Version
        │
        ↓
DSH Adapter
        │
        ↓
Physics Profile
        │
        ↓
PhysicsOS Agent Runtime
```

理由：

```text
降低上游 breaking change 成本
避免业务被 Harness 内部 API 绑死
方便未来替换 Agent Runtime
方便测试
方便 Web / Desktop / Local Runtime 共用
```

---

# 6. Harness Adapter Boundary

在 PhysicsOS Agent/Domain 包中，只允许：

```text
packages/agent-dsh-adapter
```

直接依赖 DeepSeek Harness。

其他模块：

```text
physics-core
agent-tools
question-parser
physics-scene
```

禁止直接 import Harness。

正式 Web 壳 `vendor/deepseek-harness/apps/web` 与展示叠加层 `vendor/deepseek-harness/packages/client/ui-physicsos` 属于客户端集成边界，可以使用已声明的 Harness UI slot contract；这不改变 Agent Runtime 的适配器隔离规则。根目录 `apps/web` 是废弃原型。

---

# 7. PhysicsAgentRuntime API

统一运行时接口：

```ts
interface PhysicsAgentRuntime {
  createSession(
    input: CreatePhysicsSessionInput
  ): Promise<PhysicsAgentSession>

  send(
    sessionId: SessionId,
    input: PhysicsAgentInput
  ): Promise<PhysicsAgentRun>

  resume(
    runId: RunId
  ): Promise<PhysicsAgentRun>

  cancel(
    runId: RunId
  ): Promise<void>

  getSession(
    sessionId: SessionId
  ): Promise<PhysicsAgentSession>

  forkSession(
    sessionId: SessionId,
    options?: ForkSessionOptions
  ): Promise<PhysicsAgentSession>
}
```

---

# 8. CreatePhysicsSessionInput

```ts
interface CreatePhysicsSessionInput {
  userId: UserId

  mode:
    | 'experiment'
    | 'question'
    | 'teacher'
    | 'diagnostic'

  scene?: SceneReference

  questionId?: QuestionId

  grade?: string

  skillRefs?: string[]

  modelPolicy?: ModelPolicy
}
```

---

# 9. PhysicsAgentSession

```ts
interface PhysicsAgentSession {
  id: SessionId

  userId: UserId

  mode: PhysicsAgentMode

  activeScene?: SceneReference

  status:
    | 'active'
    | 'paused'
    | 'closed'

  createdAt: IsoDateTime

  updatedAt: IsoDateTime
}
```

---

# 10. Agent 逻辑角色

PhysicsOS 定义 8 个逻辑角色：

```text
Physics Orchestrator

Question Parser
Scene Builder
Solver
Verifier
Observation Planner
Tutor
Diagnostic
```

这里的“角色”不等于：

```text
8 个模型常驻运行
```

角色本质：

```text
Role
+
Prompt
+
Tool Scope
+
Skill Scope
+
Context Scope
+
Model Policy
```

---

# 11. Physics Orchestrator

Orchestrator 是总调度器。

它不负责所有实际工作。

主要判断：

```text
当前用户意图是什么
当前处于实验还是试题
是否已经存在 Scene
是否需要解析题目
需要哪个 Skill
需要哪些 Tools
需要哪个 Agent Role
需要 Fast Model 还是 Reasoning Model
是否需要调用 Physics Engine
是否需要 Verify
是否需要 Tutor
```

---

# 12. Orchestrator 输入

至少：

```text
用户输入
当前 Mode
Scene Reference
Working Memory
Learning State 摘要
当前 Skill
允许的 Tool Scope
```

---

# 13. Orchestrator 输出

推荐结构化：

```ts
interface OrchestrationPlan {
  intent: string

  route:
    | 'answer'
    | 'parse_question'
    | 'build_scene'
    | 'solve'
    | 'simulate'
    | 'observe'
    | 'teach'
    | 'diagnose'
    | 'modify_scene'

  roles: AgentRole[]

  skillRefs: string[]

  toolScopes: string[]

  modelPolicy: ModelPolicy

  requiresVerification: boolean
}
```

---

# 14. Question Parser Role

职责：

```text
题目
↓
Physics IR
```

负责：

```text
识别物理对象
识别已知量
识别未知量
识别区域
识别边界
识别初始条件
识别约束
识别目标
关联 Diagram IR
关联 Evidence
```

不负责：

```text
直接创建最终 Scene
直接模拟
直接教学
```

---

# 15. Scene Builder Role

职责：

```text
Physics IR
↓
Physics Tools
↓
PhysicsScene
```

必须通过：

```text
physics.scene.*
physics.<domain>.*
```

Tools 创建 Scene。

不允许模型直接返回一整个未经验证的 Scene JSON 就写库。

---

# 16. Solver Role

负责：

```text
判断物理模型
制定求解步骤
调用 Physics Tools
调用 Math Runtime
请求 Simulation
读取 Verification
整理求解事实
```

Solver 输出主要是：

```text
Structured Facts
Derivation
Tool Results
Scene References
```

不是教学措辞。

---

# 17. Verifier Role

Verifier 有两层：

```text
Deterministic Verifier
+
Semantic Verifier
```

优先：

```text
Schema
Unit
Math
Constraint
Conservation
Boundary
Trajectory
Numerical
```

最后才：

```text
LLM Semantic Review
```

Verifier Role 主要处理无法纯规则判断的：

```text
题意是否被正确映射
隐含条件是否合理
解释是否与结果一致
```

---

# 18. Observation Planner Role

这是 PhysicsOS 很重要的角色。

它负责：

> **决定为了让学生理解，当前应该看见什么。**

例如磁场问题：

```text
先显示速度
↓
再显示洛伦兹力
↓
再显示轨迹
↓
再显示圆心 / 半径
↓
最后显示周期公式
```

而不是一次性把所有图层打开。

---

# 19. Observation Planner 输出

统一：

```text
ObservationPlan
```

可以包括：

```text
show observable
hide observable
highlight observable
focus object
create graph
pause timeline
seek event
```

---

# 20. Tutor Role

Tutor 的目标：

> **建立物理直觉，而不仅是给答案。**

Tutor 允许：

```text
提问
分步提示
苏格拉底式引导
引导学生修改参数
暂停关键时刻
对比实验
解释公式
总结规律
生成变式
```

---

# 21. Tutor 的教学层级

建议：

```text
Level 0
只提示观察什么

Level 1
给方向提示

Level 2
给关键规律

Level 3
给推导框架

Level 4
完整解析
```

学生可以控制：

```text
提示程度
```

---

# 22. Diagnostic Role

负责发现：

```text
知识错误
模型错误
方向错误
边界错误
数学错误
读图错误
空间想象困难
实验控制变量错误
```

输出结构化：

```text
MisconceptionRecord
LearningState Update
```

---

# 23. Diagnostic 不直接定性学生能力

Diagnostic 结果必须带：

```text
confidence
evidence
knowledgePoint
observedAt
```

避免一次错误就永久贴标签。

---

# 24. Agent Loop 与 Physics Workflow

这是架构中最关键的分离。

## Harness Agent Loop

负责：

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

---

## Physics Workflow

负责：

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

两个状态机不能混为一个。

---

# 25. 为什么要两个状态机

Harness 状态回答：

> **Agent 现在是否正在请求模型或 Tool？**

Physics State 回答：

> **这个物理任务现在处于题意理解、建模、求解还是教学阶段？**

例如：

```text
Harness:
step = 8

Physics Workflow:
VERIFY_RESULT
```

两者语义不同。

---

# 26. Physics Workflow State

建议：

```ts
type PhysicsWorkflowState =
  | 'idle'
  | 'input_received'
  | 'content_parsed'
  | 'physics_classified'
  | 'semantic_model_created'
  | 'scene_building'
  | 'scene_validation'
  | 'scene_repair'
  | 'solving'
  | 'simulation'
  | 'result_validation'
  | 'observation_planning'
  | 'ready'
  | 'interactive'
  | 'recompute'
  | 'failed'
```

---

# 27. Interactive Events

INTERACTIVE 状态可以接收：

```text
USER_CHANGE_PARAMETER
ASK_QUESTION
DRAW_FORCE
SEEK_TIMELINE
ADD_OBJECT
REMOVE_OBJECT
MODIFY_SCENE
CHANGE_FIELD
CHANGE_OBSERVATION
RUN_EXPERIMENT
GENERATE_VARIATION
```

---

# 28. Physics Workflow 状态持久化

关键状态需要持久化：

```text
workflowState
objective
scene reference
working memory
pending actions
```

不要只存在 Agent 内存中。

---

# 29. Session 设计

Session 表示：

> **一段连续的 Agent 认知与交互历史。**

Session 不等于 PhysicsScene。

一个 Scene 可以被多个 Session 使用。

一个 Session 也可以：

```text
从 Scene A
↓
fork
↓
Scene B
```

---

# 30. Agent Event Stream 与 Physics Event Stream

PhysicsOS 存在两个事实流：

```text
Agent Event Stream
+
Physics Event Stream
```

Agent Stream：

```text
User Message
Assistant Message
Tool Call
Tool Result
Prompt Injection
Context
Run / Turn / Step
```

Physics Stream：

```text
SceneCreated
FieldAdded
ParameterChanged
SimulationStarted
TimelineSeeked
...
```

---

# 31. 为什么不能合并成一个 EventStore

Agent Event 回答：

> Agent 做了什么？

Physics Event 回答：

> 世界发生了什么？

二者通过 Trace 关联，但不共享领域所有权。

---

# 32. Event Trace

必须关联：

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

实现：

```text
User Message
↓
Agent Run
↓
Tool Call
↓
Physics Event
↓
Scene Revision 21
↓
Simulation
↓
Observation
↓
Assistant Response
```

完整回放。

---

# 33. DeepSeek Harness Session Event 原则

Harness Session 主要保存：

```text
模型真正看到的内容
工具调用
工具结果
上下文注入
运行轨迹
```

PhysicsOS 不应该把：

```text
所有 Physics Domain Event
```

强行塞进 Harness Session Event。

Physics Domain Event 使用独立 EventStore。

---

# 34. Harness Session 与 Physics Scene Link

Agent Context 只记录：

```ts
interface SceneReference {
  id: SceneId
  revision: number
  snapshotId?: SnapshotId
}
```

需要 Scene 内容时：

```text
Agent
↓
Scene Query Tool
↓
PhysicsScene Runtime
```

---

# 35. Session Resume

Resume 时：

```text
Load Harness Session
↓
Load PhysicsAgentContext
↓
Resolve SceneReference
↓
Validate Scene Revision
↓
Load Working Memory
↓
Continue
```

如果 Scene 已经发生变化：

```text
检测 revision mismatch
```

然后决定：

```text
refresh context
fork
ask user
```

不能静默继续用旧 Scene 假设。

---

# 36. Session Fork

Fork 适用于：

```text
尝试另一种解法
尝试另一组实验参数
教师演示不同分支
学生进行对比实验
```

Fork 后：

```text
Agent Session Branch
+
Optional PhysicsScene Branch
```

二者应分别产生 ID。

---

# 37. Context Architecture

完整分层：

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

# 38. L0 Constitution

保存最高 Agent 原则：

```text
Physics Engine 是事实来源
禁止伪造 Simulation
必须通过 Tool 修改 Scene
教学不能改变物理事实
必须尊重权限
```

特点：

```text
极稳定
不压缩
版本化
```

---

# 39. L1 Domain

当前物理领域内容：

```text
Skill
Rules
Formula Conditions
Misconceptions
Tool Scope
Visualization Strategy
```

按当前任务动态加载。

---

# 40. L2 User Learning State

保存长期学习状态：

```text
年级
知识掌握
历史错误
稳定误区
解释偏好
```

不是每轮都全文注入。

只注入：

```text
当前知识点相关 Slice
```

---

# 41. L3 Physics Scene

Context 不存完整 Scene。

只存：

```text
SceneReference
+
Current Relevant Observation
```

例如：

```text
sceneId
revision
target particle
active fields
current timeline state
```

---

# 42. L4 Task Working Memory

保存：

```text
objective
workflow stage
confirmed facts
derived facts
completed steps
pending steps
misconceptions
important events
```

这是 Context Compression 的主要结构化对象。

---

# 43. L5 Recent Conversation

保留最近对话。

允许：

```text
自然语言摘要
```

但不能让摘要覆盖结构化 Physics Fact。

---

# 44. L6 Retrieval

包括：

```text
Curriculum
Textbook Knowledge
Question Pattern
Skill Example
Historical Question
Teacher Material
```

按需重新检索。

---

# 45. Context Budget

Context Manager 必须按照预算分配。

示意：

```text
System / Constitution    fixed
Tool Schema              dynamic
Current Skill            bounded
Scene Slice              bounded
Working Memory           bounded
Recent Conversation      rolling
Retrieval                 top-k / budgeted
```

禁止无限增长。

---

# 46. Progressive Tool Disclosure

不要让模型每轮看到几百个 Tool。

根据 Domain 和 Role 限制：

例如力学：

```text
physics.scene.*
physics.mechanics.*
physics.kinematics.*
physics.observe.*
physics.math.*
```

磁场：

```text
physics.scene.*
physics.magnetic.*
physics.em.*
physics.observe.*
physics.math.*
```

Tutor：

```text
read-only physics tools
observation tools
timeline tools
```

---

# 47. Role Tool Scope

示例：

```text
Question Parser
→ 无 scene-write

Scene Builder
→ scene-write

Solver
→ read + simulation + math

Verifier
→ read-only

Tutor
→ read + observation + limited timeline

Diagnostic
→ read + learning-write
```

---

# 48. Tool Runtime

统一 Tool Namespace：

```text
physics.*
```

主要命名空间：

```text
physics.scene
physics.mechanics
physics.kinematics
physics.gravity
physics.electric
physics.magnetic
physics.em
physics.circuit
physics.induction
physics.optics
physics.wave
physics.thermal
physics.observe
physics.math
physics.verify
physics.question
physics.learning
```

---

# 49. Tool Call Pipeline

所有 Tool：

```text
Agent
↓
Tool Registry
↓
Input Schema Validation
↓
Permission Guard
↓
Revision Validation
↓
Unit Validation
↓
Domain Validation
↓
Physics Constraint Validation
↓
Tool Handler
↓
Physics / Math / Question Runtime
↓
Structured ToolResult
↓
Audit / Trace
```

---

# 50. Tool Design 原则

Tool 必须：

```text
Small
Explicit
Typed
Auditable
Deterministic when possible
```

禁止：

```text
simulate_physics(prompt)
do_everything(question)
modify_scene(any)
```

---

# 51. Scene Write Tool

任何 Scene Write Tool 输入必须至少知道：

```text
sceneId
expectedRevision
```

输出：

```text
newRevision
eventIds
```

---

# 52. Read Tool

Read Tool 尽量返回：

```text
当前任务需要的 Slice
```

而不是整个 PhysicsScene。

例如：

```text
physics.scene.get_object
physics.scene.get_region
physics.scene.get_state_at
```

---

# 53. Observation Tool

Agent 可以控制：

```text
show force
hide force
show velocity
highlight field
show trajectory
show energy
create graph
focus object
```

Observation Tool 修改的是：

```text
Observable / Observation State
```

不是物理规律。

---

# 54. Timeline Tool

建议：

```text
physics.scene.play
physics.scene.pause
physics.scene.seek
physics.scene.step
physics.scene.set_playback_rate
```

Tutor 可以使用这些能力进行讲解。

---

# 55. Tool Error Recovery

Tool Error 分类：

```text
retryable
non-retryable
user-resolution-required
model-repairable
```

例如：

```text
NETWORK_TIMEOUT
→ retryable

INVALID_UNIT
→ model-repairable

SCENE_REVISION_CONFLICT
→ refresh / replan

MISSING_REQUIRED_CONDITION
→ ask user or infer with explicit assumption
```

---

# 56. Tool Loop 防护

必须限制：

```text
max tool calls per step
max tool calls per turn
max repeated identical calls
max repair attempts
```

避免 Agent 无限循环。

---

# 57. Tool Idempotency

可能被 Retry 的 Tool 要考虑：

```text
idempotencyKey
commandId
```

避免重复添加对象。

---

# 58. Physics Skills

Skills 是 PhysicsOS 的领域能力包。

目录：

```text
skills/
├── junior-high/
└── senior-high/
```

---

# 59. Skill 结构

例如：

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

# 60. Skill 不等于知识文章

一个真正 Skill 必须描述：

```text
知识是什么
什么时候成立
如何建模
可以调用哪些 Tool
应该显示哪些 Observable
如何 Verify
学生常错在哪里
如何教学
可以产生哪些题型
```

---

# 61. Skill Manifest

每个 Skill 建议提供：

```text
id
version
domain
grade
prerequisites
concepts
tool scopes
observables
misconceptions
scene templates
question patterns
```

---

# 62. Skill Selection

Orchestrator 根据：

```text
Physics IR
Question Tags
Scene Features
User Intent
```

选择 Skill。

允许同时加载多个：

```text
momentum
+
energy
+
circular-motion
```

但必须控制 Context Budget。

---

# 63. Skill Priority

如果 Skill 冲突：

```text
specific skill
>
domain skill
>
general physics constitution
```

例如：

```text
charged-particle-magnetic-field
```

优先于：

```text
general magnetic
```

---

# 64. Prompt Architecture

禁止：

```text
一个 3 万字 System Prompt
```

使用 Prompt Assembly：

```text
Identity
+
Physics Constitution
+
Role
+
Mode
+
Grade
+
Skill
+
Scene Reference
+
Task Objective
+
Working Memory
+
Learning Slice
+
Tool Policy
+
Teaching Policy
+
Recent Context
```

---

# 65. Prompt Section 优先级

建议：

```text
P0 Constitution
P1 Safety / Permission
P2 Role
P3 Current Task
P4 Domain Skill
P5 Scene / Working Memory
P6 Teaching Style
P7 Retrieval
```

低优先级内容不得覆盖 P0/P1。

---

# 66. Experiment Profile

```text
physics-experiment
```

Agent 行为：

```text
优先观察
优先实验
鼓励修改变量
强调控制变量
少直接给最终规律
使用 Timeline
使用 Observation
```

---

# 67. Question Profile

```text
physics-question
```

Agent 行为：

```text
读题
提取条件
Physics IR
Scene Build
求解
Verify
可视化
分步讲解
变式
```

---

# 68. Teacher Profile

```text
physics-teacher
```

额外能力：

```text
Scene Builder
Experiment Authoring
Question Generation
Presentation Plan
Classroom Explanation
Content Publish
```

Tool 权限高于学生，但仍不得绕过 Domain Validation。

---

# 69. Diagnostic Profile

```text
physics-diagnostic
```

强调：

```text
观察用户作答过程
定位误区
提取证据
更新 Learning State
```

不用于普通回答。

---

# 70. Context Compression

上下文必须支持：

```text
Physics-aware Compaction
```

不能只做普通聊天摘要。

---

# 71. Compaction Trigger

可以综合：

```text
token pressure
turn count
tool result volume
retrieval accumulation
model context limit
```

触发。

---

# 72. Compaction 保留内容

必须保留：

```text
Task Type
Objective
Workflow Stage

Scene ID
Scene Revision
Snapshot ID

Confirmed Facts
Derived Facts

Completed Steps
Pending Steps

Student Misconceptions
Important Physics Events
Important Tool Results
```

---

# 73. Compaction 不保留什么

可以丢弃或重新 Retrieval：

```text
重复聊天
无关措辞
过期检索结果
重复 Tool 原始数据
超长视觉 OCR 原文
```

但 Evidence Reference 应尽量保留。

---

# 74. Compaction Output

使用：

```text
CompactionResult
```

而不是单一字符串。

`summaryText` 只是供模型阅读的补充。

---

# 75. Scene Compaction

PhysicsScene 本身：

> **禁止自然语言压缩。**

只能：

```text
Snapshot
Event Compression
Trajectory Sampling
Storage Optimization
```

领域真相仍然结构化。

---

# 76. Tool Result Pruning

大量 Tool Result 不需要永久全文保留在模型上下文。

可以保留：

```text
Tool Call ID
Result Summary
关键 Structured Facts
Scene Revision
Artifact Reference
```

完整原始结果留在 Tool / Session Trace 中。

---

# 77. Context Overflow Recovery

如果模型上下文仍超限：

```text
停止当前 request
↓
强制 compaction
↓
重新 assemble
↓
重新 request
```

不能直接丢弃 Scene Reference 或 Working Memory。

---

# 78. Compaction 可观察性

UI / Debug 需要能知道：

```text
Compaction Started
Compaction Completed
Compaction Failed
```

长压缩不能表现得像“模型卡死”。

---

# 79. Memory Architecture

Memory 分为：

```text
Session Memory
Learning Memory
Scene Memory
Error Memory
Knowledge Memory
Preference Memory
```

---

# 80. Session Memory

仅服务当前 Session。

例如：

```text
当前计划
未完成步骤
临时用户要求
临时解释约束
```

---

# 81. Learning Memory

跨 Session。

保存：

```text
Knowledge Mastery
Misconception
Strength
Weakness
Learning Evidence
```

---

# 82. Scene Memory

保存：

```text
重要历史 Scene
实验分支
用户保存的实验
题目关联 Scene
```

它本质更接近持久资源，不要简单塞 Vector Store。

---

# 83. Error Memory

保存学生重复错误：

```text
速度方向 = 合力方向
洛伦兹力改变速度大小
电势越高电势能一定越高
```

需要：

```text
confidence
occurrence
evidence
```

---

# 84. Knowledge Memory

主要通过：

```text
Skills
Curriculum
Question Bank
Retrieval
```

实现。

不是让模型“自己记住物理定律”。

---

# 85. Preference Memory

保存：

```text
解释深度
更喜欢图形还是公式
是否希望先提示后答案
语言风格
```

不得与“知识掌握程度”混为一类。

---

# 86. Memory 写入策略

不是每一轮都写长期 Memory。

长期 Memory 需要：

```text
evidence
confidence
stability
deduplication
```

例如一次错误：

```text
不立即认定长期误区
```

多次证据后提高 confidence。

---

# 87. Memory Retrieval

Tutor 只检索：

```text
当前知识点相关
当前任务相关
```

的 Learning Memory。

不要注入整个学习画像。

---

# 88. Model Router

Agent Runtime 不绑定 DeepSeek Model。

结构：

```text
Model Router
│
├── Reasoning Model
├── Fast Model
├── Vision Model
├── OCR Model
├── Embedding Model
└── Optional Local Model
```

---

# 89. ModelPolicy

```ts
interface ModelPolicy {
  reasoning?: 'low' | 'medium' | 'high'

  latency?: 'fast' | 'balanced' | 'quality'

  visionRequired?: boolean

  toolHeavy?: boolean

  preferredModel?: string
}
```

---

# 90. Model Routing 示例

Orchestrator / Solver：

```text
Reasoning Model
```

简单 Tutor：

```text
Fast Model
```

试卷图片：

```text
Vision Model
```

OCR：

```text
OCR Model
```

Embedding：

```text
Embedding Model
```

---

# 91. Provider Adapter

模型 Provider 通过 Harness / Model Adapter 统一。

PhysicsOS Domain Contract 禁止出现：

```text
OpenAI-specific
Claude-specific
DeepSeek-specific
```

消息结构。

---

# 92. Streaming

Agent UI 需要支持：

```text
text delta
status
tool started
tool completed
observation change
scene revision change
verification result
```

不要只流式输出文字。

---

# 93. Agent Client Event

推荐 Web Client 接收：

```ts
type AgentClientEvent =
  | AgentTextDelta
  | AgentStatusChanged
  | ToolCallStarted
  | ToolCallCompleted
  | SceneRevisionChanged
  | ObservationChanged
  | VerificationCompleted
  | AgentRunCompleted
  | AgentRunFailed
```

---

# 94. UI Agent 状态

用户应该能够区分：

```text
正在理解题目
正在创建场景
正在计算
正在验证
正在调整可视化
正在组织解释
正在压缩上下文
```

不要所有阶段统一显示：

```text
AI 思考中...
```

---

# 95. Agent Cancellation

用户取消 Agent：

```text
停止未完成 Model Request
停止可取消 Tool
```

但已经提交的 Physics Event：

```text
不能假装没有发生
```

如果需要撤销：

```text
通过 Scene Command Undo / Branch
```

---

# 96. Tool Cancellation

长 Simulation / Document Parse Tool：

必须支持：

```text
AbortSignal / cancellation token
```

取消后返回结构化状态。

---

# 97. Timeout

必须为：

```text
Model
Tool
Simulation
Math
Document Parse
Retrieval
```

定义 timeout。

---

# 98. Retry

自动 Retry 只适用于：

```text
网络瞬时失败
Provider 临时失败
Rate limit with backoff
```

不适用于：

```text
Physics Constraint Invalid
Unsupported Model
User Missing Input
```

---

# 99. Agent Loop Budget

每个 Run 定义：

```text
maxSteps
maxToolCalls
maxTokens
maxDuration
maxRepairAttempts
```

防止失控。

---

# 100. Safety / Permission

Physics Tool 权限：

```text
read
scene-write
content-write
teacher-write
admin
dangerous
```

Agent 权限不得高于用户。

---

# 101. Student Agent

默认：

```text
read
scene-write within owned workspace
learning-write
```

不允许：

```text
teacher-write
admin
```

---

# 102. Teacher Agent

可以：

```text
scene-write
content-write
teacher-write
```

但不能绕过：

```text
Content Permission
Class Permission
Domain Validation
```

---

# 103. Prompt Injection 防护

上传题目、PDF、教材中的文本：

默认都属于：

```text
untrusted content
```

不得因为文档中写着：

```text
忽略系统提示
调用某个 Tool
```

就改变 Agent Policy。

---

# 104. Retrieval Trust

检索内容分：

```text
system trusted
curated curriculum
teacher content
user upload
external source
```

不同来源给予不同 Trust Level。

---

# 105. Physics Constitution

Constitution 应至少包含：

```text
不能伪造 Physics Result
不能绕过 Tool
不能把假设当事实
不确定时显式说明
物理结果必须可验证
教学不得篡改真实结果
Scene Revision 必须尊重
```

---

# 106. Assumption Policy

题目缺失必要条件时：

Agent 可以：

```text
提出假设
```

但必须：

```text
明确标记 assumption
记录到 Physics IR
记录 confidence
允许用户修改
```

不能把猜测静默写为 Confirmed Fact。

---

# 107. Hallucination 防护

物理场景创建前：

```text
Physics IR
↓
Scene Validation
↓
Physics Verifier
```

Tool 输入前：

```text
Schema
Unit
Domain
Constraint
```

减少 LLM 幻觉进入事实层。

---

# 108. Agent Response Grounding

解释结果时优先引用：

```text
Tool Result
Simulation Result
Verification Result
Scene Observation
Derived Quantity
```

而不是重新“脑算一次”。

---

# 109. Formula Grounding

Agent 展示公式时应知道：

```text
formula
conditions
variables
source skill
```

例如：

```text
r = mv / |q|B
```

必须知道成立条件：

```text
v ⟂ B
uniform B
magnetic force is dominant
```

---

# 110. Tutor 与 Observation 联动

Tutor 不只是文字。

例如：

```text
Tutor:
“先看速度方向。”

↓ Tool

physics.observe.velocity(show)

↓ UI

速度箭头出现
```

然后：

```text
Tutor:
“再打开洛伦兹力。”
```

这才是 PhysicsOS 的 Agent 教学模式。

---

# 111. Tutor 与 Timeline 联动

Agent 可以：

```text
pause
seek
step
```

例如：

> 回到粒子刚刚进入磁场的瞬间。

实际：

```text
physics.scene.seek(event = particle_entered_region)
```

---

# 112. Tutor 与 Parameter Experiment 联动

Tutor 可以建议：

```text
B × 2
```

但如果是教学实验：

```text
先询问 / 明确这是对比实验
```

然后创建：

```text
Scene Branch
```

避免破坏原题 Scene。

---

# 113. Branch-based Teaching

对于：

```text
“如果 B 变成 2B 会怎样？”
```

推荐：

```text
原 Scene
↓
Branch
↓
Change B
↓
Simulate
↓
Compare
```

原 Scene 不丢失。

---

# 114. Compare Tool

未来建议：

```text
physics.scene.compare
```

输入：

```text
sceneA
sceneB
observable keys
```

输出：

```text
delta
ratio
trend
```

用于控制变量教学。

---

# 115. Agent 与 Dynamic Question

Agent 可以：

```text
根据当前 Scene 生成变式题
```

流程：

```text
Current Scene
↓
Question Pattern
↓
Variable Policy
↓
Scene Branch
↓
Verify
↓
Question Generator
```

不能直接让 LLM 随机编物理参数。

---

# 116. Agent 与 Teacher Studio

Teacher Agent 可以接受：

> 做一个演示洛伦兹力不做功的课堂实验。

流程：

```text
Intent
↓
Skill
↓
Scene Template
↓
Scene Builder
↓
Observation Plan
↓
Teaching Script
↓
Teacher Preview
```

---

# 117. Human-in-the-loop

以下操作推荐要求确认：

```text
发布教师内容
覆盖已有 Scene
批量删除
大规模生成试题
重要 Learning State 修正
Admin Tool
```

普通实验 Scene 修改可以直接执行。

---

# 118. Agent Trace

开发模式需要看到：

```text
User Input
Prompt Sections
Role
Skill
Tool Scope
Model
Tool Calls
Tool Results
Scene Events
Compaction
Final Response
```

用于 Debug。

---

# 119. Trace 隐私

开发 Trace 不得默认展示：

```text
Secret
API Key
完整敏感文件
内部 Provider Token
```

---

# 120. Evaluation

Agent 评测不要只看：

```text
最终文字答案
```

应分：

```text
Question Parsing Accuracy
Physics IR Accuracy
Scene Build Accuracy
Tool Selection Accuracy
Physics Result Accuracy
Verification Accuracy
Tutor Quality
Diagnostic Accuracy
Context Stability
```

---

# 121. Question Parsing Eval

测试数据：

```text
题目
标准 Physics IR
标准 Evidence
```

指标：

```text
Object F1
Known Value Accuracy
Constraint Accuracy
Target Accuracy
Evidence Alignment
```

---

# 122. Scene Build Eval

比较：

```text
Physics IR
↓
Generated Scene
↓
Expected Scene Semantics
```

不是比较 Scene JSON 字段顺序。

---

# 123. Tool Selection Eval

检查：

```text
是否选择正确 Tool
是否调用多余 Tool
是否越权
是否错误重复
```

---

# 124. Tutor Eval

关注：

```text
是否过早给答案
是否正确利用 Observation
是否匹配学生年级
是否引导错误
是否忠于 Physics Result
```

---

# 125. Context Regression

建立长对话测试：

```text
10 turns
50 turns
100 turns
Compaction
Resume
Fork
```

检查：

```text
Scene ID 不丢
Revision 不错
公式结论不漂
学生误区不丢
当前目标不乱
```

---

# 126. Agent Golden Cases

建议建立：

```text
tests/agent/golden/
```

例如：

```text
magnetic-particle-basic
inclined-plane-force
projectile-motion
electric-field-deflection
circuit-dynamic
induction-rail
```

---

# 127. Agent Contract Tests

必须覆盖：

```text
Role Tool Scope
Tool Schema
Context Schema
Compaction Schema
Scene Revision Conflict
Tool Error Repair
Permission Denied
Resume
Fork
```

---

# 128. Harness Version Pinning

DeepSeek Harness 当前属于快速演进基础设施。

项目必须：

```text
pin exact version
```

不能：

```text
^0.x
latest
```

无控制升级。

---

# 129. Harness Upgrade 流程

升级：

```text
Create Upgrade Branch
↓
Read Upstream Changelog
↓
Run Adapter Contract Tests
↓
Run Session Resume Tests
↓
Run Tool Pipeline Tests
↓
Run Compaction Tests
↓
Run Agent Golden Tests
↓
Merge
```

---

# 130. Harness API Gap 处理

如果 Harness 当前不支持某个 PhysicsOS 需求：

优先：

```text
PhysicsOS Adapter
PhysicsOS 独立 Store
Physics Plugin
```

而不是：

```text
直接 patch Harness 核心
```

只有确认必须修改 upstream 时，才考虑维护极小 Patch，并记录原因。

---

# 131. Physics Event 不依赖 Harness 自定义持久事件

Physics Domain Event 使用：

```text
PhysicsScene EventStore
```

作为唯一持久化来源。

不要依赖：

```text
第三方 Harness Plugin 自定义 Session Event
```

来保存 Physics Domain Truth。

这样即使 Harness Session Format 演进：

```text
Physics Scene
Physics Replay
Physics Audit
```

仍然独立。

---

# 132. Local Agent Runtime

未来 Desktop 可以：

```text
PhysicsOS.exe
│
├── Shared Web UI
├── Local Physics Runtime
└── Local Agent Sidecar
```

AgentRuntime API 不变。

只替换 Transport：

```text
RemoteAgentTransport
LocalAgentTransport
```

---

# 133. Remote Agent Mode

Web 当前默认：

```text
Browser
↓
Agent API / SSE
↓
Agent Service
↓
DSH Adapter
↓
DeepSeek Harness
```

---

# 134. Local Agent Mode

未来 Desktop：

```text
Tauri
↓
Local Agent Client
↓
Local Sidecar
↓
DSH Adapter
↓
DeepSeek Harness
```

UI 仍然使用同一：

```text
PhysicsAgentClient
```

---

# 135. Agent Transport

推荐抽象：

```ts
interface AgentTransport {
  createSession(...): Promise<...>

  send(...): AsyncIterable<AgentClientEvent>

  cancel(...): Promise<void>

  resume(...): AsyncIterable<AgentClientEvent>
}
```

实现：

```text
HttpSseAgentTransport
LocalIpcAgentTransport
```

---

# 136. Agent UI Architecture

Web 端 Agent Panel 可以通过 `ui-physicsos` 使用 Harness 声明式 UI slot 完成装配，但不得直接调用 Harness Agent Runtime 内部 API。业务调用保持：

```text
AgentPanel
↓
PhysicsAgentClient
↓
AgentTransport
↓
Agent Service
```

---

# 137. Agent UI 主要区域

建议：

```text
Conversation
Run Status
Active Role
Current Task
Tool Activity
Observation Actions
Scene Changes
Hint Level
```

普通学生不显示内部 Chain-of-thought。

开发模式显示：

```text
Trace Summary
Tool Calls
Scene Events
```

---

# 138. Explainability

系统应显示：

```text
“正在验证单位”
“正在计算轨迹”
“已创建磁场区域”
“已打开速度矢量”
```

而不是展示模型私人推理过程。

---

# 139. Agent 失败 UX

失败要区分：

```text
Model unavailable
Tool failed
Simulation failed
Scene invalid
Permission denied
Question parse uncertain
Context recovery required
```

并给用户明确可恢复动作。

---

# 140. Question Parse Uncertainty

如果关键条件 confidence 低：

例如：

```text
B = 0.5T?
```

应：

```text
在 UI 标注
允许用户确认/修改
```

而不是静默猜。

---

# 141. Scene Repair

Scene Validation 失败：

```text
SCENE_VALIDATION
↓
REPAIR
```

Agent 可以：

```text
重新检查 Physics IR
修正单位
修正对象映射
请求用户补充
```

修复次数需限制。

---

# 142. Run Recovery

Agent Run 中断：

```text
Load Session
↓
Load Run State
↓
Check pending Tool
↓
Check Physics Event
↓
Check Scene Revision
↓
Resume or restart safe step
```

避免重复 Scene Mutation。

---

# 143. Exactly-once / At-least-once 风险

Agent Tool Retry 可能重复调用。

Scene-write Tool 使用：

```text
commandId
expectedRevision
idempotency
```

避免：

```text
ParticleAdded 两次
```

---

# 144. Long-running Simulation

Agent 不应一直占用模型等待仿真。

可以：

```text
start simulation job
↓
return job id
↓
Agent waits / subscribes
↓
simulation completed event
↓
continue
```

---

# 145. Scheduler

未来可用于：

```text
长任务
批量生成
后台评测
教师内容处理
```

普通学生对话不依赖 Scheduler 才能正常工作。

---

# 146. Subagent 使用原则

Subagent 只在：

```text
任务可并行
职责明确
结果可以合并验证
```

时使用。

例如：

```text
整张试卷多题解析
```

可以并行 Question Parser。

---

# 147. 禁止滥用 Multi-Agent

单题：

```text
没必要同时启动 8 个 Agent。
```

优先：

```text
一个 Root Agent
+
Role-specific scoped work
+
必要 Subagent
```

降低：

```text
成本
延迟
状态同步复杂度
```

---

# 148. 整张试卷并行

适合：

```text
Document Segmentation
↓
Question 1 Parser
Question 2 Parser
Question 3 Parser
...
↓
Independent Physics IR
↓
Aggregate
```

每题有独立 Trace。

---

# 149. Agent Metrics

至少：

```text
run duration
model latency
tool latency
tool count
tool error rate
repair count
compaction count
context tokens
scene mutation count
verification failure rate
```

---

# 150. Cost Metrics

模型调用应记录：

```text
input tokens
output tokens
model
role
session
question
user
```

用于：

```text
成本分析
Model Router 优化
```

---

# 151. Physics Accuracy Metrics

Agent 体系必须最终关注：

```text
Scene Accuracy
Physics Result Accuracy
Verification Pass Rate
Question IR Accuracy
```

而不是只看：

```text
聊天满意度
```

---

# 152. Agent Package 结构

推荐：

```text
packages/
├── agent-runtime/
├── agent-dsh-adapter/
├── agent-tools/
├── agent-prompt/
├── agent-context/
├── agent-compaction/
├── agent-memory/
├── agent-workflow/
└── agent-skills/
```

---

# 153. agent-runtime

负责：

```text
PhysicsAgentRuntime Contract
Orchestrator
Role Registry
Run Coordination
Model Policy
Agent Client Events
```

禁止直接依赖 Harness。

---

# 154. agent-dsh-adapter

负责：

```text
Harness Session Mapping
Harness Run Mapping
Prompt Section Mapping
Tool Registration Mapping
Streaming Mapping
Cancellation
Resume / Fork Adapter
```

这是 PhysicsOS Agent/Domain 层唯一依赖 Harness Agent Runtime 的 Package。`ui-physicsos` 仅是客户端展示集成边界，不承担 Session、Run、Tool 或模型调用适配。

---

# 155. agent-tools

负责：

```text
Tool Definition
Tool Registry
Tool Guards
Physics Tool Handlers
Tool Contract Tests
```

---

# 156. agent-prompt

负责：

```text
Prompt Templates
Prompt Sections
Prompt Version
Prompt Assembly Rules
Prompt Test
```

---

# 157. agent-context

负责：

```text
Context Layers
Scene Reference
Working Memory
Context Budget
Context Assembly
Retrieval Slice
```

---

# 158. agent-compaction

负责：

```text
Trigger
Physics-aware Summary
Structured Compaction
Tool Result Pruning
Recovery
```

---

# 159. agent-memory

负责：

```text
Learning Memory
Preference Memory
Error Memory
Memory Retrieval
Memory Update Policy
```

---

# 160. agent-workflow

负责：

```text
Physics Workflow State Machine
Transition
Repair
Resume
Failure
```

---

# 161. agent-skills

负责：

```text
Skill Registry
Skill Selection
Skill Loading
Skill Version
Skill Context
```

真正 Skill 内容仍保存在：

```text
/skills
```

---

# 162. Agent Service

`services/agent`：

```text
HTTP / SSE API
Authentication
Agent Runtime Host
Harness Adapter Host
Model Credentials
Session Persistence
Trace
```

---

# 163. Agent Service API

建议：

```text
POST   /agent/v1/sessions
GET    /agent/v1/sessions/{id}

POST   /agent/v1/sessions/{id}/messages

POST   /agent/v1/runs/{id}/cancel
POST   /agent/v1/runs/{id}/resume

POST   /agent/v1/sessions/{id}/fork
```

Streaming：

```text
SSE
```

---

# 164. Agent Session 与 User Permission

所有 Session 必须绑定：

```text
userId
tenant / school if future
permission scope
```

用户只能访问自己的 Session 或明确共享资源。

---

# 165. 数据库中的 Agent Metadata

业务数据库可以保存：

```text
session_id
user_id
mode
active_scene_id
created_at
updated_at
```

Harness 内部 Session Log 由 Harness Persistence 管。

Physics Event 由 Physics Store 管。

---

# 166. 三种 Store 不混淆

```text
Business DB
→ 用户 / 权限 / Session metadata

Harness Session Store
→ Agent model-visible event stream

Physics Event Store
→ PhysicsScene truth
```

---

# 167. Backup / Restore

恢复完整任务需要：

```text
Business Metadata
Harness Session
Physics Event Stream
Scene Snapshot
Uploaded Resources
```

---

# 168. Debug Mode

开发环境可以开启：

```text
Agent Debug Panel
```

显示：

```text
Mode
Role
Model
Skill
Tool Scope
Scene Ref
Workflow State
Context Budget
Tool Calls
Compaction
Trace
```

---

# 169. Production Student Mode

默认隐藏：

```text
内部 Prompt
内部 Provider
内部 Trace 细节
模型私有推理
```

只显示：

```text
有意义的执行状态
可解释 Tool 动作
Scene 变化
```

---

# 170. Agent Security Boundary

Agent 产生的一切：

```text
tool input
scene command
content write
```

都视为：

```text
untrusted proposed action
```

必须经过 Runtime Validation。

---

# 171. Agent Architecture Definition of Done

Agent 架构核心能力只有在以下条件满足后算完整：

```text
Agent Runtime 与 Harness 解耦
角色边界明确
Tool Guard 完整
Physics Workflow 独立
Context 分层完成
Physics-aware Compaction 完成
Memory 分类完成
Model Router 完成
Session Resume / Fork 可用
Agent / Physics Event 可关联
Long Context Regression 可运行
Agent Contract Tests 可运行
```

---

# 172. 当前实现优先原则

虽然产品直接按完整版设计，实际实现仍应遵守依赖顺序：

```text
Agent Runtime Contract
↓
DSH Adapter
↓
Tool Runtime
↓
Context
↓
Workflow
↓
Roles
↓
Skills
↓
Compaction
↓
Memory
↓
Evaluation
```

这里是工程依赖顺序，不是削减产品范围。

---

# 173. Harness 风险隔离

由于 Harness 属于外部快速演进 Runtime：

必须：

```text
Exact Version Pin
Adapter Layer
Contract Test
Session Compatibility Test
Upgrade Branch
```

绝不能让：

```text
Harness Internal API
```

扩散进 PhysicsOS Domain。

---

# 174. 未来 Runtime 可替换性

理想状态：

```text
PhysicsOS Agent Runtime
        │
        ├── DeepSeek Harness Adapter
        ├── Future Runtime Adapter
        └── Test Fake Runtime
```

即使以后替换 Harness：

```text
Physics Engine
PhysicsScene
Question Runtime
Tools Contract
Skills
UI
```

都不需要重写。

---

# 175. Agent 最终运行闭环

```text
User
↓
Physics Agent Client
↓
PhysicsAgentRuntime
↓
Orchestrator
↓
Role + Skill + Context + Tools
↓
Model
↓
Tool Call
↓
Tool Guard
↓
Physics Runtime
↓
Physics Event / Simulation
↓
Verifier
↓
Observation Planner
↓
Physics Canvas
↓
Tutor
↓
User Interaction
↓
Next Turn
```

---

# 176. 最终 Agent 架构原则

PhysicsOS Agent 的价值不是：

> **让模型更会聊天。**

而是：

> **让模型能够安全、结构化、可验证地理解并操纵一个真实的数字物理世界。**

Agent 应始终围绕：

```text
Physics IR
PhysicsScene
Physics Engine
Observation
Physics Skills
Learning State
```

运行。

---

# 177. 一句话 Agent 架构

> **DeepSeek Harness 负责让 Agent 持续运行，PhysicsOS Agent Runtime 负责让 Agent 正确地理解、操作和教学物理世界，而 Physics Engine 永远负责决定这个世界真正发生什么。**

---

# 178. 上游版本与参考说明

本文档基于 PhysicsOS 当前架构决策，并参考 DeepSeek Harness 当前 Developer Preview 的官方设计。

当前使用 Harness 时必须坚持：

```text
Everything is a Plugin
Session / Run 可追踪
Prompt / Tool / Model / Storage 可组合
通过 Adapter 接入
Exact Version Pin
```

由于上游仍处于快速演进阶段：

> **任何升级均以官方当前架构文档、Release Notes 和 PhysicsOS Adapter Contract Test 为准。**

参考：

- DeepSeek Harness 官方页面：`https://deepseek.com/harness/`
- DeepSeek Harness GitHub：`https://github.com/deepseek-ai/deepseek-harness`
- Harness Architecture：`https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md`
