# Electric Field Runtime Pack V2 — 多源点电荷 + 等势线

> 文件：`docs/reports/ELECTRIC-FIELD-RUNTIME-PACK-V2-REPORT.md`
> 验收日期：2026-08-22
> 前置：`ELECTRIC_FIELD_RUNTIME_PACK_V1_COMPLETE`（见 `MILESTONES.md`）

## 1. 目标

V1 已把点电荷静电场从 Domain Core → Scene → Engine → Verifier → Observation →
Question → Lab → Agent 打通，但 Question 入口只能产**单源**。V2 不升级引擎——
多源在 Scene/Engine/core/Observation/Renderer/Verifier 全链路自 V1 已就绪——而是：

1. **多源 Question 解析**：打通「等量同种/异种/电偶极子」文本 → 多源 Scene。
2. **等势线可视化**：marching squares 提取等 V 等高线，作场拓扑示意渲染。
3. **R1 修复 + Agent 多源解释**：probeId 硬编码 `source-1` → `probeParticleOf`；
   Agent 多源 sign、电场线源头、合场叠加意图。

## 2. 关键发现

多源自 V1 day one 就是架构事实：

- `createPointChargeScene` 接受 `charges: PointChargeInput[]`（V1）。
- `fieldAt(charges, at)` 用 `superposeElectricFields` 叠加（V1）。
- `physics-verifier` 有 `electric_field_superposition` 校验（V1）。
- `traceStreamline` 沿**合场**积分 → 多源流线自然弯曲（V1）。
- `pointChargeSources` 是数组、Inspector 按 `sources.map` 展开（V1）。

V1 没暴露多源，只因 Question IR/Parser/Scene Builder 只产单源。V2 只补这层。

## 3. 工作包

### A. 多源 Question 解析与场景构建

| 文件 | 改动 |
|---|---|
| `packages/question-core/src/semantic-ir.ts` | `PhysicsSemanticIR` 增 `sourceCharges`/`samplePosition`；`SemanticRelation` 增 `multi_source_superposition` |
| `packages/question-core/src/semantic-validator.ts` | 多源分支：每源非零有限、需 samplePosition、多源方向 → 歧义「合场流线决定」 |
| `packages/question-core/src/deterministic-electric-parser.ts` | `MULTI_SOURCE_SIGNAL`、`isMultiSourceQuestionText`、`parseMultiSource`（±separation/2、中点场点）、`extractSourceCharges`（matchAll q1/q2、电荷A/B）；多源优先于单源 |
| `packages/question-core/src/electric-scene-builder.ts` | 多源分支：`sourceCharges.map` → source-1/source-2 + probe at samplePosition |
| `packages/question-core/src/golden-questions.ts` | 3 道多源题（electric-06 异种中点、electric-07 同种中点、electric-08 偶极子中点） |
| `packages/question-core/src/question-runtime.ts` | `buildSolution` 多源标题/描述/公式 `E = Σ kqᵢ/rᵢ²`、方向「合场流线决定」 |
| `packages/question-core/tests/electric-questions.test.ts` | 3 道多源题：`sourceCharges.length===2`、verification passed、E 数值、superposition check |

### B. 等势线可视化

| 文件 | 改动 |
|---|---|
| `packages/engine-electric/src/field-solver.ts` | `PotentialGrid` 接口 + `samplePotentialGrid`（Float64Array、NaN 跳过源邻域） |
| `packages/engine-electric/src/index.ts` | 导出 `samplePotentialGrid`、`PotentialGrid` |
| `packages/physics-scene/src/electric/electric-scene-builder.ts` | 多源时 `observableDefinitions` 追加 `annotation: equipotential` |
| `vendor/.../scene-visual-model.ts` | `EquipotentialVisual`；`SceneVisualModel.equipotentials?`；`ObservableKey` 增 `equipotentials` |
| `vendor/.../electric-visual-bridge.ts` | `potentialAt`、`contourAtLevel`（marching squares 16 case + saddle）、`equipotentialsOf`（48×27 网格、自动 level、多源 only）、`visibilityOf` 读 equipotential annotation |
| `vendor/.../renderers.module.css` | `.equipotentials` / `.equipotentialPath`（虚线、measurement 色） |
| `vendor/.../renderer-registry.tsx` | 等势线渲染块（streamlines 后、Vectors 前） |
| `vendor/.../tests/electric-point-charge-visual.client.spec.tsx` | 多源等势线非空/闭合/visible；单源无；DOM 渲染 |
| `packages/engine-electric/tests/point-charge-runtime.test.ts` | `samplePotentialGrid` 中点 V=0（1×1 网格精确采原点）、远点与 solvePotentialAt 一致 |

### C. R1 修复 + Agent 多源解释

| 文件 | 改动 |
|---|---|
| `vendor/.../QuestionWorkspace.tsx` | R1：probeId `find(p=>p.id!=='source-1')` → `probeParticleOf`（排除所有 source）；`ELECTRIC_HIGHLIGHTS` 增 q1/q2/P → source-1/source-2/probe-1 |
| `vendor/.../physics-agent.ts` | `sourceChargeSignsOf`（遍历所有 source parameter）；`chargeSigns` context；`resolveHighlightTarget` 支持 `*` 前缀通配；`field-line` → `source-*` |
| `vendor/.../physics-agent-answers.ts` | `electric-field-direction` 多源处理（不谎称单值方向）；新 `electric-field-line-origin`（chargeSigns + 方向校验）；新 `electric-superposition`（superposition 校验）；matchIntent 规则 |
| `vendor/.../tests/physics-agent.client.spec.tsx` | 7 个多源测试：chargeSigns、suggestions、superposition 校验、field-line-origin 不谎称方向、direction 多源、field-line 高亮 source id、R1 probeId |

## 4. 浏览器验收 Case

| Case | 场景 | 验证点 | 结果 |
|---|---|---|---|
| J | 等量异种点电荷中点求 E（Golden Question） | 题面解析 → 已知量高亮（q1/q2→source-1/source-2）→ 叠加步骤 → verified | PASS |
| K | 多源场景渲染 + Inspector 编辑 | 两个 source sphere + 弯曲流线 + 等势线；Inspector 多 source 可编辑；编辑后 revision+1 仍 verified | PASS |
| L | Agent「电场线为什么从正电荷出来」 | 高亮 stream（source-*）+ 引用 chargeSigns（正、负）+ 不谎称单值方向 + revision 不变 | PASS |
| M | Agent「合场是怎么来的」 | 引用 `electric_field_superposition` 校验 + 叠加公式 + revision 不变 | PASS |

## 5. 门禁计数器

| 门禁 | 计数 |
|---|---|
| console errors | 0 |
| page errors | 0 |
| unhandled rejections | 0 |
| failed requests | 0 |
| error responses | 0 |

## 6. 截图清单

| 文件 | 内容 |
|---|---|
| `question-dipole-field-1600x900.png` | 等量异种中点题（已知量高亮） |
| `electric-equipotential-1600x900.png` | 多源 Lab：两 source + 弯曲流线 + 等势线 |
| `agent-field-line-origin-1600x900.png` | Agent 电场线源头解释（stream 高亮） |
| `agent-superposition-1600x900.png` | Agent 合场叠加解释 |
| `question-dipole-field-final-1600x900.png` | 最终集：偶极子题 |
| `electric-equipotential-final-1600x900.png` | 最终集：等势线 Lab |
| `agent-superposition-final-1600x900.png` | 最终集：叠加 Agent |

## 7. 测试数据

- `test:core`：387 passed（含 question-core 多源题全链路 13 测试、engine-electric
  `samplePotentialGrid` 17 测试、physics-electric-core 多源叠加 13 测试）。
- `test:web`（ui-physicsos）：107 passed（含等势线 visual 9 测试、Agent 多源 27 测试）。
- `typecheck:core` / `typecheck:web`：全绿。
- 浏览器验收：`electric-acceptance-v2.mjs` 4 Case 全 PASS、5 门禁为 0。
- 回归：`electric-acceptance.mjs`（V1）5 Case 全 PASS；`mechanics-acceptance.mjs` 全 PASS。

## 8. 不做（明确边界）

- 匀强电场完善 / 平行板电容器 / 带电粒子轨迹积分（V3，需时间积分，风险大）。
- Timeline 事件标记（backlog，需离散事件建模）。
- Agent 接真实模型（backlog，契约已就位，替换 `matchIntent` 即可）。
- 等势线数值断言（仅拓扑示意，不进 Observation/Verifier 契约）。
- 不改 V1 已验收的流线渲染、charge_sign observation、叠加校验。
- 不在 Lab 新建菜单加多源模板（与 V1 一致，仅 Question → Lab）。
