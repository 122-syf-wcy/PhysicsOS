# PhysicsOS Question Pipeline Architecture

> 文件：`docs/08-QUESTION-PIPELINE-ARCHITECTURE.md`

---

# 1. 目标

Question Space 不是 AI 搜题。

目标：

> **把静态题目转换成可以验证、运行、观察和交互的 PhysicsScene。**

---

# 2. 输入

```text
文本
图片
截图
拍照
PDF
扫描 PDF
整套试卷
题库
教师上传
```

---

# 3. 总流程

```text
Input
↓
Document Ingest
↓
Normalization
↓
OCR / VLM
↓
Question Segmentation
↓
Diagram Extraction
↓
Diagram IR
↓
Physics Semantic Parser
↓
Physics IR
↓
IR Validation
↓
Scene Candidate
↓
Scene Validation
↓
PhysicsScene
↓
Simulation
↓
Verification
↓
Visualization
```

---

# 4. Document Ingest

负责：

```text
文件校验
MIME
大小
Hash
页数
元数据
Object Storage
```

---

# 5. Normalization

图片：

```text
方向校正
裁边
去噪
对比度优化
```

PDF：

```text
文本层检测
页面渲染
图片提取
```

---

# 6. OCR

优先：

```text
有文本层 → 提取
无文本层 → OCR
```

保存：

```text
text
bounding boxes
page
confidence
reading order
```

---

# 7. VLM

用于：

```text
复杂版面
题图
符号关系
几何关系
表格
公式
```

不能直接成为领域事实。

---

# 8. Question Segmentation

识别：

```text
题号
题干
选项
子问
题图
答案区
解析区
```

---

# 9. 题图归属

必须关联：

```text
questionId
page
boundingBox
```

---

# 10. Formula Recognition

输出：

```text
LaTeX
+
normalized symbolic form
```

---

# 11. Diagram 分类

```text
受力图
斜面图
磁场区域
电场区域
电路图
光路图
坐标图
v-t
x-t
实验装置
```

---

# 12. Diagram IR

```text
Point
Line
Arc
Arrow
Label
Body
Wire
Component
FieldRegion
Coordinate
Boundary
```

---

# 13. Circuit Diagram

```text
symbol detection
↓
terminal detection
↓
wire tracing
↓
node merge
↓
component classification
↓
CircuitGraph
```

---

# 14. Physics Semantic Parser

输入：

```text
normalized text
formula
Diagram IR
metadata
```

输出：

```text
Physics IR
```

---

# 15. Physics IR

```text
domain
problemType
objects
regions
knownValues
unknownValues
initialConditions
constraints
relations
targets
assumptions
knowledgeTags
confidence
evidence
```

---

# 16. Evidence First

关键条件保留：

```text
text range
page
bounding box
diagram element
```

---

# 17. Confidence

低于阈值：

```text
needs_review
```

UI 要求用户确认。

---

# 18. 禁止静默猜测

关键条件只能：

```text
confirmed
explicit assumption
needs review
```

---

# 19. IR Validation

```text
Schema
Unit
Reference
Dimension
Required Target
Domain Consistency
```

---

# 20. Scene Builder

映射：

```text
IR Object → Scene Object
IR Region → Region
Known Value → Quantity
Initial Condition → State
Constraint → Constraint
Diagram Geometry → Geometry
```

---

# 21. SceneBuildMapping

保留：

```text
IR object ↔ Scene object
```

---

# 22. Scene Validation

```text
引用
单位
模型
边界
电路拓扑
支持能力
```

---

# 23. Scene Repair

路径：

```text
Parser Repair
Scene Builder Repair
User Review
```

---

# 24. Capability Check

Scene Build 前检查：

```text
PhysicsCapabilityRegistry
```

---

# 25. Simulation / Verification

Scene Valid 后才：

```text
Simulation
```

验证：

```text
Dimensional
Numerical
Boundary
Trajectory
Conservation
```

---

# 26. QuestionSolution

基于：

```text
Physics IR
Tool Result
Simulation Result
Formula
Verification
```

组织。

---

# 27. Tutor 联动

解析步骤可以：

```text
Step 1 → show force
Step 2 → show radius
Step 3 → seek exit
```

---

# 28. 整卷并行

```text
Segmentation
↓
Parallel Question Parser
↓
Independent IR
↓
Aggregate
```

---

# 29. Job 状态

```text
queued
running
needs_review
completed
failed
cancelled
```

---

# 30. 进度 UI

```text
正在读取文档
正在识别 8/20
正在解析第 8 题
正在验证
```

---

# 31. 人工校正

允许：

```text
OCR 文本
题图范围
数值
单位
对象
边界
```

---

# 32. Question Revision

解析结果必须版本化。

---

# 33. 持久化

保存：

```text
original document
normalized assets
OCR
Diagram IR
Physics IR
Scene ref
solution
diagnostic
```

---

# 34. Parser Version

记录：

```text
ocrVersion
vlmVersion
parserVersion
diagramParserVersion
sceneBuilderVersion
```

---

# 35. Reprocess

允许新版 Parser 重新处理，保留旧结果。

---

# 36. Evaluation

Ground Truth：

```text
Text
Diagram IR
Physics IR
Scene
Answer
```

指标：

```text
OCR CER
Segmentation Accuracy
Diagram F1
Known Value Accuracy
Constraint Accuracy
Target Accuracy
Scene Accuracy
Physics Accuracy
```

---

# 37. Security

上传文件隔离解析并限制资源。

---

# 38. Trace

```text
documentId
questionId
parserRunId
diagramId
physicsIR version
sceneId
sceneRevision
simulationId
traceId
```

---

# 39. Question → Experiment

按钮：

```text
在物理世界中打开
```

---

# 40. Experiment → Question

通过 Question Engine。

---

# 41. Dynamic Question

基于：

```text
Scene
Question Pattern
Variable Policy
Difficulty
```

生成。

---

# 42. 一句话试题链路

> **PhysicsOS 不让模型“看图猜动画”，而是把题目逐层转换成可追溯、可验证的 Physics IR 与 PhysicsScene，再由真实 Physics Engine 运行。**
