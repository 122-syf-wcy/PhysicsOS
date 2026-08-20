# 试题空间 — 磁场垂直切片报告

> 文件：`docs/reports/QUESTION-SPACE-MAGNETIC-VERTICAL-SLICE-REPORT.md`
> 任务编号：`QUESTION_SPACE_VERTICAL_SLICE_V1`

---

## 1. Question Domain

新建 `packages/question-core`，实现全部 Question Domain Contract：

- `QuestionId`、`QuestionDocument`、`QuestionSource`、`QuestionContent`、`QuestionStatus`、`QuestionMetadata`
- `QuestionKnown`、`QuestionUnknown`、`QuestionConstraint`
- `QuestionSemanticCandidate`、`PhysicsSemanticIR`
- `QuestionSolution`、`QuestionSolutionStep`
- `QuestionDiagnostic`、`QuestionParseIssue`、`QuestionAmbiguity`
- `QuestionWorkflowState`（16 个状态：INPUT_RECEIVED → READY + 失败态）
- `QuestionIngestProvider`（Text / Image-Stub / PDF-Stub）

所有类型服从 `docs/03-DOMAIN-CONTRACTS.md` 和 `docs/08-QUESTION-PIPELINE-ARCHITECTURE.md`。

---

## 2. QuestionDocument

- 支持来源：`text`、`image`、`pdf`
- 文本输入完整可用
- 图片/PDF 建立 Provider Boundary，状态显示 `UNAVAILABLE`，不假装识别成功

---

## 3. Parser

- 实现 `DeterministicMagneticQuestionParser`（确定性磁场题解析器）
- 识别：科学计数法（`2.0×10^6`、`2.0e6`）、单位（`C`、`kg`、`m/s`、`T`）、中文方向（垂直纸面向里/外）、电荷正负（质子/电子/正/负）、求解目标（力/半径/周期/方向/轨迹）
- 不依赖公网 LLM

---

## 4. Semantic IR

`PhysicsSemanticIR` 包含：
- `domain: magnetic`
- `model: charged_particle_uniform_magnetic_field`
- `entities: [particle, magnetic_field]`
- `knowns: [charge, mass, velocity, magnetic_field_strength]`
- `relations: [velocity_perpendicular_B]`
- `targets: [force, radius, period, rotation_direction, trajectory]`
- `assumptions: [uniform_magnetic_field, magnetic_force_only, ignore_electric_field, ignore_gravity]`

---

## 5. Validation

`validateSemanticIR` 检查：
- 必要实体是否齐全（charge / mass / velocity / B）
- 电荷正负是否明确 → `AMBIGUOUS`
- B = 0 → `INVALID_SEMANTICS`
- v ∥ B → `UNSUPPORTED_MODEL`

---

## 6. Scene Builder

`buildSceneFromIR` 将 IR 映射为 `PhysicsScene`：
- 直接使用 `@physicsos/physics-scene` 的 `createMagneticScene` 等价构建
- 构建粒子、匀强磁场、Observable 定义
- Scene Builder 不计算 R、T、ω、F — Physics Fact 全部来自 `engine-magnetic`

---

## 7. Engine Selector

`selectEngine` 根据 IR `model` 选择引擎：
- `charged_particle_uniform_magnetic_field` → `engine-magnetic`
- 预留其他领域接口

---

## 8. Magnetic Engine Integration

- 使用现有 `MagneticEngine` 执行 simulation
- `processQuestion` 调用 `engine.simulate(scene, request)`
- 输出 `SimulationResult`，包含 derivedQuantities

---

## 9. Verifier

- 验证由 `MagneticEngine` 内置 verification 和外部 `verifyMagneticScene` 完成
- Question UI 显示验证状态：`passed` / `failed`
- 验证来源为 Physics Verifier，不是 Agent

---

## 10. Observation

- 使用 `observeMagneticScene` 将 SimulationResult 映射为 renderer-neutral observations
- Question Canvas 和 Lab Canvas 共享同一 Observation 模型

---

## 11. Solution

`QuestionSolution` 结构化：
- 5 个推导步骤
- 结果读取自 `SimulationResult.derivedQuantities`（不重新计算）
- 包含 F、R、T、方向

---

## 12. Question UI

在 Harness Shell 内构建 `QuestionWorkspace` 组件：
- 左栏：题目输入 + Golden Question 列表 + 已知条件 + 求解目标
- 中栏：复用 `LabCanvas` 渲染 Physics Visualization + Timeline
- 右栏：解题过程 / 验证详情 Tabs
- AI 助教 Drawer

---

## 13. Open In Physics World

- "在物理世界中打开" 按钮将 Question Scene 传递给 Lab
- `surface-store.ts` 支持 `questionScene` 传递
- Question 和 Lab 共享同一 `PhysicsScene`（同一 sceneId / revision）
- 不重新生成 Scene

---

## 14. Harness Agent

- 当前 Agent Parser Provider 标记为 `AGENT_PARSER_PROVIDER_PENDING`
- Deterministic Pipeline 完整可用，不阻塞

---

## 15. Tests

- 49 个测试全部通过
- 10 个 Golden Question 场景覆盖：基本质子、电子、场方向向外、仅半径、仅周期、缺电荷正负、零场、平行速度、单位转换（预期 INVALID_SEMANTICS）、科学计数法
- 01-proton-basic 完整 Pipeline 断言：IR → Scene → Engine → R ≈ 4.18cm, T ≈ 1.31e-7s, F ≈ 1.6e-13N → Verifier PASS → Solution → Observation
- Question ↔ Lab 一致性测试：同一 sceneId / revision，同一 derivedQuantities

---

## 16. Screenshots

浏览器截图需要起 Harness dev server 后执行，当前代码已完成，截图待浏览器验收。

---

## 17. Known Issues

- Golden Question 09（单位转换 km/s, mT）当前解析器不支持非标准单位，预期 `INVALID_SEMANTICS`
- 图片/PDF Ingest Provider 为 Stub，状态 `UNAVAILABLE`
- Agent Parser Provider 待接入
- Harness Windows Replay Gate 已 DEFERRED

---

## 18. Harness Replay Deferred

```
HARNESS_WINDOWS_REPLAY_GATE_DEFERRED
```

以下工作留到后续 RELEASE GATE 统一处理：
- 串行跑 Baseline / PhysicsOS Replay
- 修 bash/pwsh / PID cleanup
- 逐个排 59 个失败文件
- 为 Replay 修改 Physics Runtime

---

## 完成状态

- 文字题可以真实输入 ✓
- QuestionDocument 创建 ✓
- Semantic IR 创建 ✓
- PhysicsScene 创建 ✓
- Magnetic Engine 求解 ✓
- Verifier PASS ✓
- Solution 生成 ✓
- Physics Canvas 展示 ✓
- Open In Physics World 实现 ✓
- Physics Lab 共享同一 Scene ✓
- root typecheck PASS ✓
- root tests PASS ✓
- Question UI smoke（待浏览器验收）
- browser runtime gate（待浏览器验收）

QUESTION_SPACE_MAGNETIC_VERTICAL_SLICE_COMPLETE
