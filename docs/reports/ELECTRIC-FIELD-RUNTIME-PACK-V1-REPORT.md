# Electric Field Runtime Pack V1 — Report

> 文件：`docs/reports/ELECTRIC-FIELD-RUNTIME-PACK-V1-REPORT.md`
> 任务编号：`ELECTRIC_FIELD_RUNTIME_PACK_V1`
> 里程碑：`ELECTRIC_FIELD_RUNTIME_PACK_V1_COMPLETE`（见 `MILESTONES.md`）

点电荷静电场的第一个垂直切片：从域契约到 Agent 高亮的全链路打通。
本报告记录步骤 5–7（Question → Lab → Agent → 浏览器验收），
步骤 1–4（Domain Core / Scene / Engine / Observation / UI Renderer）已在
`MILESTONES.md` 记录并验收。

---

## 1. 范围与边界

**做**：点电荷 → 电场矢量 → 探针粒子受力 → Observation → Question 预览 →
Lab 实验分支 → Agent 高亮。

**不做**（明确边界）：
- 电势面、电容、电磁感应（留待后续切片）。
- Lab 新建菜单加电场模板（用户确认仅走 Question → Lab 路径）。
- 不改已验收的 `ElectricPointChargeRenderer` / `electric-visual-bridge`。
- 不接真实模型（Agent 仍 deterministic）。
- 不做点电荷时间轴事件标记（静态模型无离散事件，
  `ELECTRIC_TIMELINE_EVENT_MARKERS_BACKLOG` 已登记）。

**两项设计取舍**（用户确认）：
1. 仅走 Question → Lab，不在 Lab 新建菜单加电场模板。
2. 三题共享带试探电荷的点电荷场景（E 与 F 向量都被绘制、可高亮，
   无需改已验收的 visual bridge）。

---

## 2. 点电荷 Golden Question（步骤 5）

### 2.1 语义 IR 扩展 — `packages/question-core/src/semantic-ir.ts`

- `ElectricModelId` 增加 `'point_charge_electrostatic_field'`。
- `SemanticTarget` 增加 `'electric_field'`（求 E 大小）、
  `'electric_field_direction'`（方向判断）。
- `SemanticRelation` 增加 `'point_charge_field'`；
  `SemanticAssumption` 增加 `'static_point_charge'`、`'vacuum_permittivity'`。
- `PhysicsSemanticIR` 增加可选 `sourceDistance?: number`（距源电荷的距离 r，米）。

### 2.2 解析器 — `packages/question-core/src/deterministic-electric-parser.ts`

- 新增 `parsePointCharge`：点电荷信号 `/点电荷|距离.{0,6}(\d|r\s*=)|r\s*=\s*\d/`
  且不含「匀强电场」时，`model = 'point_charge_electrostatic_field'`，
  relations `['point_charge_field']`，assumptions
  `['static_point_charge','electric_force_only','vacuum_permittivity',
    'ignore_magnetic_field','ignore_gravity']`。
- 复用现有 charge/mass 模式提取源电荷 q、试探电荷 q'；
  新增 distance 模式 `/距.{0,4}(\d+(?:\.\d+)?)\s*(cm|m)/` 解析 r 写入
  `sourceDistance`。
- `detectTargets` 增加点电荷 targets：电场强度 / 方向 / 电场力。
- 点电荷题不强求匀强电场的 `time` / `electric_field_strength` 已知量。

### 2.3 校验器 — `packages/question-core/src/semantic-validator.ts`

- `validateElectricIR` 按 `ir.model` 分流：
  - `charged_particle_uniform_electric_field` 走原匀强电场校验（不变）。
  - `point_charge_electrostatic_field` 走 `validatePointChargeIR`：
    校验源电荷 `charge` 非零有限、`sourceDistance` 正有限；试探电荷可选
    但若存在须非零；targets 非空。`chargeSign === 'unknown'` 时给 ambiguity
    （方向无法判定）。

### 2.4 Scene Builder — `packages/question-core/src/electric-scene-builder.ts`

- `buildPointChargeSceneFromIR(ir, options)` 调
  `createPointChargeScene`：
  - `charges: [{ id: 'source-1', charge: signedCharge, position: origin }]`。
  - `probe: { charge: q' ?? 1e-9, mass: 1, position: vec3(r, 0, 0) }`。
  - `samplePoint` 取 probe 位置，保证 E 向量被绘制。

### 2.5 运行时路由 — `packages/question-core/src/question-runtime.ts` + `engine-selector.ts`

- `ir.domain === 'electric' && ir.model === 'point_charge_electrostatic_field'`
  调 `buildPointChargeSceneFromIR`；否则维持 `buildElectricSceneFromIR`。
- electric 域 `model === 'point_charge_electrostatic_field'` 返回
  `electricEngine`（与匀强电场共用 `ElectricEngine`，`canHandle` 按
  `isPointChargeScene` 自动路由）。
- `buildSolution` 按 `ir.model` 分流：点电荷走 E = kq/r²、F = qE、
  方向由 q 符号决定，从 `simulation.derivedQuantities` 读取
  `electric_field_magnitude` / `electric_force_magnitude` /
  `electric_field_vector`；匀强电场步骤不变。

### 2.6 三道 Golden Question — `packages/question-core/src/golden-questions.ts`

共享同一场景（源电荷 + 试探电荷），只换 targets/题面：

| 题 | 源电荷 | r | 试探电荷 | 求 | 预期 |
|----|--------|---|----------|----|------|
| Q1 电场强度 | +5 μC | 20 cm | — | E | ≈ 1.123×10⁶ V/m |
| Q2 电场力 | +5 μC | 20 cm | +2 μC | F = qE | ≈ 2.25 N |
| Q3 方向判断 | −3 μC | 10 cm | — | 方向 | 指向电荷（向内） |

### 2.7 测试 — `packages/question-core/tests/electric-point-charge-questions.test.ts`

三题各跑 `processQuestion` 全链路，断言 `ir.model ===
'point_charge_electrostatic_field'`、`scene.fields[0].type === 'point_charge'`、
`simulation.verification.status === 'passed'`、
`electric_field_magnitude` / `electric_force_magnitude` 数值；
Q3 断言 `chargeSign === 'negative'` 与方向。

---

## 3. Agent E/q/F 高亮（步骤 6）

### 3.1 drawnIds 覆盖点电荷 — `physics-agent.ts` 与 `QuestionWorkspace.tsx`

- `drawnVisualIds` 追加 `view.pointChargeSources`、`view.fieldStreamlines`、
  `view.probe` 的 id。
- `QuestionWorkspace.tsx` 的 `drawnIds()` 做相同扩展（已知量点击高亮路径）。
- `HIGHLIGHT_ALIASES` 增加电学别名 `electric-field-vector` /
  `electric-force-vector` / `charge-source`；
  `HIGHLIGHT_LABELS` 增加对应中文名（电场强度 / 电场力 / 点电荷）。

### 3.2 电学 Agent 意图 — `physics-agent-answers.ts`

新增 3 个 Intent（复用现有 `Intent` 接口、`findDerived`、`findCheck`、`chip`
契约）：

| Intent | available 条件 | 引用 | 高亮 |
|--------|----------------|------|------|
| `electric-field-magnitude` | domain=electric 且 drawnIds 含 electric-field-vector | findDerived('电场强度') + findCheck('electric_field_1_over_r2') | electric-field-vector |
| `electric-force-magnitude` | drawnIds 含 electric-force-vector | findDerived('电场力') + findDerived('电场强度') + findCheck('electric_force_qE') | electric-force-vector |
| `electric-field-direction` | domain=electric 且 drawnIds 含 source- | context.chargeSign 决定向外/向内/未知；findCheck('electric_field_direction') | charge-source |

`matchIntent` 规则：
- `electric-field-magnitude`: `/电场强度|场强|求\s*E|\bE\s*多大|\bE\s*是怎么来的/i`
- `electric-force-magnitude`: `/电场力|求\s*F\b|\bF\s*=\s*q\s*E\b|试探电荷.*力/i`
- `electric-field-direction`: `/电场.{0,4}方向|场强.{0,4}方向|指向|向外|向内/i`

### 3.3 chargeSign 上下文 — `physics-agent.ts`

- `PhysicsAgentContext` 增加 `chargeSign?: 'positive' | 'negative' | 'neutral'`。
- `sourceChargeSignOf(snapshot)` 从 Inspector「源电荷」段读取首个参数值，
  返回 positive/negative/neutral，供方向意图使用（替代不可靠的 derived 标签判断）。

### 3.4 测试 — `physics-agent.client.spec.tsx`

新增 8 个用例：点电荷场景下 drawnIds 暴露 source/streamline/probe；
`agentSuggestions` 返回 3 个电学建议；E 意图引用 1/r² 校验 + 高亮 E 向量；
F 意图引用 F = qE 校验 + 高亮 F 向量；负电荷方向说「向内」；正电荷方向说
「向外」；高亮是纯视图（revision 不变）；力学场景无电学意图。

---

## 4. 客户端运行时补齐（计划外发现，步骤 7 前置）

验收走查中发现三个计划未列出的客户端缺口，均为点电荷进入 Question → Lab
闭环所必需，已补齐：

### 4.1 QuestionWorkspace 点电荷渲染分支 — `QuestionWorkspace.tsx`

原 `electricModel` memo 对**所有** electric scene 调
`resolveUniformElectricModel(scene)`，点电荷 scene 会抛错。修复：
- `electricModel` 守卫 `domain === 'electric' && !isPointChargeScene(scene)`。
- 新增点电荷渲染分支：用 `simulation.states[0]`（静态模型单态）调
  `observeElectricScene` + `electricSceneVisualAt`，engineLabel
  `'Electric Engine · Verified'`。

### 4.2 editParameter 点电荷分支 — `electric-workspace-runtime.ts`

原 `editParameter` 只处理匀强电场 id（如 `electric-field-strength`），
点电荷的 `source-1` / `probe-q` / `probe-m` 全部 no-op。修复：新增点电荷分支，
  对 source 调 `SetParticleCharge`、对 `probe-q` 调 `SetParticleCharge`、
  对 `probe-m` 调 `SetParticleMass`，particleId 取自 `sourceChargesOf` /
  `probeParticleOf`。

### 4.3 ElectricWorkspaceRuntime 实验分支支持 — `electric-workspace-runtime.ts`

原 runtime 无 `forkExperimentalScene` / `restoreOrigin`，Case H（Question →
Lab 分支）失败。修复：镜像 `mechanics-runtime-bridge.ts`，
- `command()` 在应用 fact 命令前检查 `requiresExperimentalFork`，需要则
  `forkExperimentalScene`。
- 新增 `origin` 字段（构造时按 `sourceQuestionId` 存储）、`restoreOrigin()`。
- `getSnapshot` 增加 `branch` 字段（`originQuestionTitle` /
  `parentRevision` / `canRestore`）。

### 4.4 Inspector 标签与校验截断 — `electric-workspace-runtime.ts`

- `DERIVED_LABELS` 增加点电荷键（electric_field_vector/magnitude、
  electric_force_vector/magnitude、potential、acceleration_vector），
  避免 findDerived('电场强度'/'电场力') 回落英文键。
- `VERIFICATION_LABELS` 增加约 25 项点电荷校验 id 中文名。
- `verificationOf` 增加 `pointCharge` 参数：点电荷显示**全部**校验，
  匀强电场维持 `slice(0,8)`（点电荷有约 20 项校验，原截断会丢掉
  `electric_field_1_over_r2`）。

---

## 5. 浏览器验收（步骤 7）

### 5.1 验收脚本 — `apps/web/e2e/electric-acceptance.mjs`

仿 `mechanics-acceptance.mjs` 结构（同一 console/pageerror/network 门禁 +
`check()` 逐项断言）。5 项门禁计数器：console / pageerror / rejections /
failedRequests / errorResponses。

| Case | 驱动 | 断言 |
|------|------|------|
| E | 点电荷 Golden Question Q1（求 E）→ 题面 → READY → 已知量点击高亮画布（q / r / E）→ 结构化步骤 | verified |
| F | Q2 求 F = qE → 同上，F 高亮 | verified |
| G | Q3 正负方向 → 方向判断题 | verified |
| H | Question → Lab「在物理世界中打开」→ 生成实验分支 → Lab 渲染点电荷 → Inspector 可编辑 → 仍 verified | revision 归 1、branch 存在 |
| I | Agent 在点电荷 Lab 提「电场强度多大」→ 画布高亮 electric-field-vector + 引用 1/r² 校验 | revision 不变（纯视图） |

结果：**ALL CHECKS PASSED，5 门禁计数器全为 0。**

### 5.2 最终截图集 — `apps/web/e2e/final-screenshots.mjs`

在现有力学帧之后增补三个点电荷帧：

| 截图 | 内容 |
|------|------|
| `question-electric-field-final-1600x900.png` | Q1 题面 + 已知量高亮 + 结构化步骤 |
| `electric-lab-point-charge-final-1600x900.png` | Question → Lab 打开点电荷场景（玻璃球 + 流线 + 探针） |
| `agent-electric-highlight-final-1600x900.png` | Agent 电场强度意图触发，E 向量高亮 |

结果：**0 console / 0 page error**，全部生成。

---

## 6. 验证（端到端）

| 检查 | 命令 | 结果 |
|------|------|------|
| 单元/集成 | `pnpm run test:core` | 全绿（含 question-core 点电荷题全链路、physics-electric-core、verifier） |
| web 测试 | `pnpm run test:web` | 97 测试全绿（含 `physics-agent.client.spec.tsx` 电学意图、`electric.client.spec.tsx`） |
| 类型 | `pnpm run typecheck:core` / `typecheck:web` | 全绿 |
| 浏览器验收 | `node apps/web/e2e/electric-acceptance.mjs` | 5 Case 全 PASS，5 门禁为 0 |
| 截图 | `node apps/web/e2e/final-screenshots.mjs` | 0 console / 0 page error |
| 回归 | `node apps/web/e2e/mechanics-acceptance.mjs` | 未回归 |

---

## 7. 改动文件清单

**question-core**：
- `src/semantic-ir.ts`（IR 扩展）
- `src/deterministic-electric-parser.ts`（点电荷解析分支）
- `src/semantic-validator.ts`（点电荷校验分支）
- `src/electric-scene-builder.ts`（点电荷 scene builder）
- `src/question-runtime.ts`（运行时路由分流）
- `src/engine-selector.ts`（引擎选择）
- `src/golden-questions.ts`（3 道点电荷题）
- `tests/electric-point-charge-questions.test.ts`（新增测试）

**ui-physicsos client**：
- `src/client/physics/physics-agent-answers.ts`（3 个电学意图 + matchIntent 规则）
- `src/client/physics/physics-agent.ts`（chargeSign 上下文 + drawnVisualIds + 别名）
- `src/client/physics/electric-workspace-runtime.ts`（DERIVED/VERIFICATION 标签、
  editParameter 点电荷分支、实验分支支持、verificationOf 截断修复）
- `src/client/QuestionWorkspace.tsx`（点电荷渲染分支 + drawnIds 扩展）
- `tests/physics-agent.client.spec.tsx`（8 个电学用例）

**e2e**：
- `apps/web/e2e/electric-acceptance.mjs`（新增）
- `apps/web/e2e/final-screenshots.mjs`（增补点电荷帧）

**文档**：
- `docs/reports/MILESTONES.md`（里程碑移至已完成）
- `docs/reports/ELECTRIC-FIELD-RUNTIME-PACK-V1-REPORT.md`（本报告）
