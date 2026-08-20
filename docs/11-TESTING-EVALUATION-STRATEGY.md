# PhysicsOS Testing & Evaluation Strategy

> 文件：`docs/11-TESTING-EVALUATION-STRATEGY.md`  
> 文档定位：PhysicsOS 代码、物理、Agent、试题解析、UI 与系统质量验证体系

---

# 1. 核心目标

PhysicsOS 不仅要测试“代码能不能跑”。

必须同时证明：

```text
物理算得对
Scene 可重放
题目解析得对
Agent 选 Tool 得对
Tutor 没有教错
UI 与原型一致
服务可恢复
```

---

# 2. 测试层级

```text
Unit Test
Contract Test
Physics Golden Test
Property Test
Metamorphic Test
Integration Test
Question Golden Eval
Agent Eval
E2E
Visual Regression
Performance
Security
Reliability
```

---

# 3. Unit Test

重点：

```text
Vector
Quantity
Unit
Dimension
Geometry
Scene Reducer
Command Validation
Parser Normalize
Tool Guard
```

---

# 4. Contract Test

必须覆盖：

```text
PhysicsScene
Physics IR
Diagram IR
Simulation
Tool
Agent Context
API
```

---

# 5. Physics Golden Test

这是 PhysicsOS 最重要测试资产之一。

每个 Case：

```text
Input Scene
Expected Formula
Expected Numeric Result
Tolerance
Expected Events
Expected Invariants
```

---

# 6. Mechanics Golden

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
动量守恒
弹性碰撞
完全非弹性碰撞
```

---

# 7. Electric Golden

```text
两点电荷
多点叠加
匀强电场
电势
带电粒子偏转
```

---

# 8. Magnetic Golden

```text
v ∥ B
v ⟂ B
正电荷
负电荷
半径
周期
半圆
矩形区域
圆形区域
临界问题
```

---

# 9. Circuit Golden

```text
串联
并联
混联
闭合电路
内阻
滑动变阻器
理想电表
非理想电表
开关
```

---

# 10. Induction Golden

```text
运动导体
线框进入
线框离开
导轨
双棒
```

---

# 11. Property-based Test

适合：

```text
Unit Conversion
Vector Algebra
Scene Serialization
Geometry
Conservation
```

---

# 12. Metamorphic Test

例：匀强磁场圆周运动。

```text
v × 2 → r × 2
B × 2 → r ÷ 2
m × 2 → r × 2
|q| × 2 → r ÷ 2
```

这种关系测试比只测几个固定数更强。

---

# 13. Boundary Test

必须覆盖：

```text
zero
near-zero
exact boundary
just inside
just outside
tangent
critical radius
critical angle
very large
```

---

# 14. Numerical Test

检查：

```text
NaN
Infinity
Convergence
Tolerance
Step Stability
```

---

# 15. Integration Test

Physics：

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

# 16. Question Pipeline Test

```text
Input
↓
OCR
↓
Segmentation
↓
Diagram IR
↓
Physics IR
↓
Scene
↓
Physics Result
```

---

# 17. Question Golden Dataset

每道题保存：

```text
Original Source
Ground Truth Text
Ground Truth Diagram IR
Ground Truth Physics IR
Ground Truth Scene Semantics
Expected Answer
```

---

# 18. OCR 指标

例如：

```text
CER
Formula Accuracy
Reading Order Accuracy
```

---

# 19. Parser 指标

```text
Question Segmentation Accuracy
Object F1
Known Value Accuracy
Constraint Accuracy
Target Accuracy
Evidence Alignment
```

---

# 20. Diagram Eval

```text
Element Detection F1
Relation Accuracy
Circuit Topology Accuracy
Boundary Geometry Accuracy
```

---

# 21. Scene Build Eval

比较的是：

```text
Scene Semantics
```

而不是 JSON 字段顺序。

---

# 22. Agent Contract Test

至少：

```text
Role Tool Scope
Tool Schema
Permission
Error Handling
Scene Revision Conflict
Context Schema
Compaction
Resume
Fork
```

---

# 23. Agent Golden Cases

例如：

```text
magnetic-particle-basic
inclined-plane-force
projectile-motion
electric-deflection
circuit-dynamic
induction-rail
```

---

# 24. Agent Eval 维度

```text
Intent Routing
Question Understanding
Tool Selection
Tool Efficiency
Scene Accuracy
Physics Accuracy
Verification
Tutor Quality
Diagnostic Quality
Context Stability
```

---

# 25. Tool Selection Eval

检查：

```text
是否正确
是否重复
是否越权
是否漏掉必要 Verify
```

---

# 26. Tutor Eval

检查：

```text
是否过早给答案
是否正确使用 Observation
是否和 Physics Result 一致
是否匹配学生水平
是否制造错误概念
```

---

# 27. Diagnostic Eval

需要：

```text
Ground Truth Misconception
Evidence
Confidence
```

避免过度诊断。

---

# 28. Long Context Regression

场景：

```text
10 turns
50 turns
100 turns
```

包含：

```text
Compaction
Resume
Fork
Scene Revision Change
```

必须检查：

```text
sceneId
revision
current goal
confirmed facts
misconceptions
```

不漂移。

---

# 29. E2E

核心实验链：

```text
进入实验室
创建场景
修改参数
运行
暂停
Timeline Seek
打开 Observable
询问 Agent
```

---

# 30. Question E2E

```text
上传题目
解析
确认条件
生成 Scene
可视化
查看解析
在物理世界中打开
```

---

# 31. Teacher E2E

后续：

```text
创建 Scene
发布实验
生成题目
布置作业
```

---

# 32. Playwright

Web E2E 统一采用 Playwright 或项目确定的等价方案。

---

# 33. Visual Regression

重点：

```text
Home
Physics Workspace
Question Space
Scene Tree
Inspector
Force Arrow
Trajectory
Field
Circuit
Chart
```

---

# 34. Visual 不替代 Physics

截图一样：

> 不代表物理结果正确。

---

# 35. UI Fidelity

可以使用截图 Diff 检查：

```text
布局
尺寸
颜色
状态
```

---

# 36. Performance Test

至少：

```text
Canvas FPS
Main Thread Long Task
Simulation Latency
Agent First Event
Document Parse Duration
Memory
```

---

# 37. Performance Baseline

在固定硬件 / 浏览器 / Scene 建立基准。

避免模糊写：

```text
“感觉挺流畅”
```

---

# 38. Load Test

服务：

```text
API
Agent Sessions
Document Jobs
Simulation Jobs
```

---

# 39. Reliability

故障注入：

```text
LLM Timeout
Math Unavailable
Object Storage Error
Simulation Cancel
Network Disconnect
```

---

# 40. Recovery Test

测试：

```text
Agent Resume
Scene Replay
Snapshot Restore
Job Retry
```

---

# 41. Security Test

覆盖：

```text
Authentication
RBAC
Tool Permission
Prompt Injection
Upload Validation
Rate Limit
```

---

# 42. Regression Policy

修复 Bug：

> **先写一个会失败的回归测试，再修改实现。**

---

# 43. CI Gate

普通 PR：

```text
format
typecheck
lint
unit
contract
physics golden
build
```

---

# 44. Core PR

核心架构变更追加：

```text
integration
agent golden
question golden
e2e
visual
```

---

# 45. Skip Policy

禁止：

```text
删除失败测试
修改预期为错误结果
随意 .skip
```

来让 CI 变绿。

---

# 46. Mock Policy

允许：

```text
外部模型
外部网络
第三方存储
```

在单测中 Mock。

禁止：

```text
Physics Engine
Tool Handler
核心业务
```

未实现却用 Mock 冒充完成。

---

# 47. Test Data Version

Golden Dataset 必须版本化。

---

# 48. Model Eval

非确定模型不做纯字符串匹配。

使用：

```text
Structured Output
Tool Trace
Fact Rubric
Score Rubric
```

---

# 49. Human Evaluation

Tutor / 教学解释需要教师人工评测样本。

---

# 50. Release Gate

正式版本前至少：

```text
Physics Golden
Question Golden
Agent Regression
Core E2E
Visual
Security Smoke
Performance Smoke
```

---

# 51. Test Report

记录：

```text
commit
environment
dataset version
test version
result
failures
```

---

# 52. Coverage

Coverage 是辅助指标。

不能因为行覆盖高就认为物理正确。

---

# 53. Test Ownership

每个核心 package 自带测试。

---

# 54. Definition of Done

功能完成必须：

```text
有正确层级测试
核心 Golden 不退化
真实 E2E 可运行
无假 Mock
```

---

# 55. 一句话测试原则

> **PhysicsOS 的测试不是证明“页面能打开”，而是证明物理世界算得对、题目理解得对、Agent 操作得对，并且这些正确性能够在长期迭代中被自动守住。**
