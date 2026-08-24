# Electric Agent Dynamic Intents — Agent 匀强电场动力学意图 + 复杂空间解析

> 文件：`docs/reports/ELECTRIC-AGENT-DYNAMIC-INTENTS-REPORT.md`
> 验收日期：2026-08-22
> 前置：`ELECTRIC_FIELD_RUNTIME_PACK_V2_COMPLETE`（见 `MILESTONES.md`）

## 1. 目标

V2 完成多源点电荷 + 等势线后，确认匀强电场动力学（类平抛 / 类匀减速）自 V1
已在八层完整实现（解析解 121 状态 → 逐状态验证 → 轨迹观测 → 动画时钟 →
轨迹+向量渲染 → 结构化解答），但存在四处盲区：

1. **Agent 在匀强场说错话**：`electric-field-magnitude` 硬编码"库仑定律 E=kq/r²"
   + 引用点电荷专属的 `electric_field_1_over_r2` check——匀强场无源电荷。
2. **Agent 缺动力学意图**：无法解释轨迹为何是抛物线、加速度为何恒定、
   电场力做功与动能定理、末速度怎么来的。
3. **Parser 缺复杂空间解析**：只支持"距 r=20cm"，不支持"距其左侧 15cm"。
4. **匀强场动力学从未浏览器验收**：electric-01/02 从未进 Case。

本阶段纯增量、低风险：不扩展引擎 / 题型，只补 Agent 意图、Parser 空间解析、
验收与暴露。

## 2. 关键发现（verificationOf cap 截断 bug）

`electric-workspace-runtime.ts` 的 `verificationOf(simulation, pointCharge)` 对
匀强场取 `checks.slice(0, 8)`——前 8 个全是 scene 前置校验
（schema/revision/ids/units），`electric_kinematic_consistency`、
`electric_force_consistency`、`electric_acceleration_consistency`、
`electric_energy_consistency` 四个动力学 check 排在第 8 之后，**被截断**。

后果：匀强场 snapshot 的 `verification` 从不含动力学 check → Agent 无法引用 →
`isUniformElectricField` 无法判别。这是 V1 遗留的隐藏 bug，此前因没有 Agent
动力学意图而未被触发。

修复：两个模型都显示全部 checks（Inspector 列表本就简短）。点电荷取全部
（V2 已是），匀强场改为取全部。`isUniformElectricField` 基于
`electric_kinematic_consistency` 判别，稳态可靠。

## 3. 工作包

### A. 修复 Agent 匀强场文案

| 文件 | 改动 |
|---|---|
| `vendor/.../physics-agent-answers.ts` | A.1 `isUniformElectricField(context)` helper（基于 `electric_kinematic_consistency` check 判别，非 drawnIds 推断）；A.2 `electric-field-magnitude` 按场景分支（匀强场说"E 是给定恒定值"、引用 `electric_force_consistency`；点电荷维持库仑定律 + 1/r²）；A.3 `electric-force-magnitude` 用 `electric_force_qE ?? electric_force_consistency` 回退 + 文案分支 |

### B. 新增 4 个匀强场动力学意图

| Intent | 引用 check | 引用 derived | highlight |
|---|---|---|---|
| `electric-acceleration-constant` | `electric_acceleration_consistency` | 加速度 | `electric-acceleration-vector` |
| `electric-trajectory-shape` | `electric_kinematic_consistency` | 位移 | `electric-trajectory` |
| `electric-work-energy` | `electric_energy_consistency` | 电场力做功 / 动能变化 | `electric-force-vector` |
| `electric-velocity-evolution` | `electric_kinematic_consistency` | 速率 | `electric-velocity-vector` |

- 所有 `available` 用 `isUniformElectricField(context)` 闸门（排除点电荷误触发）。
- `acceleration-vector` 的 observable 默认关，B.1 的 `available` 仍用
  `drawnIds.includes('electric-acceleration-vector')`——学生需先开 acceleration
  可观察量，intent 才出现（与 mechanics 一致：drawnIds 闸门）。
- `matchIntent` 4 条新规则置于 `electric-field-magnitude` / `electric-force-magnitude`
  宽泛规则之前，避免"电场力做功"被 `electric-force-magnitude` 吞掉。
- `DERIVED_LABELS` 补齐匀强场动力学 key 的中文 label
  （`displacement_vector`→位移、`electric_potential_change`→电势变化、
  `electric_potential_energy_change`→电势能变化、`work_by_electric_field`→
  电场力做功、`kinetic_energy_change`→动能变化），让 Inspector 与
  `findDerived` 用中文引用。

### C. 复杂空间解析

| 文件 | 改动 |
|---|---|
| `packages/question-core/src/semantic-ir.ts` | `PhysicsSemanticIR` 增 `sampleOffset?: { axis: 'x'\|'y'; sign: 1\|-1; distance: number }` |
| `packages/question-core/src/deterministic-electric-parser.ts` | `ELECTRIC_PATTERNS.directionalDistance` 正则（匹配 距其/在 + 左侧/右侧/上方/下方 + 数值 + 单位）；`parsePointCharge` 优先提取方向性距离，按方向词填 `sampleOffset`（group 1=方向、2=值、3=单位，inline 单位转换避免与 `extractValueWithUnit` 的 group 约定冲突）；IR 构建条件展开 `sampleOffset` |
| `packages/question-core/src/electric-scene-builder.ts` | 单源 probe 位置：`sampleOffset` 存在时按 axis/sign 放置（x 轴 `vec3(sign·d, 0, 0)`、y 轴 `vec3(0, sign·d, 0)`），否则维持 `vec3(d, 0, 0)`；多源不受影响 |
| `packages/question-core/src/golden-questions.ts` | `electric-09-off-axis-field`：q=+4μC，距其左侧 15cm，求 E 大小与方向 |
| `packages/question-core/tests/electric-questions.test.ts` | 方向性距离题测试：`sampleOffset.axis==='x' && sign===-1`、probe `position.vector.x===-0.15`、E≈1.598×10⁶、E 指向 -x |

### D. 匀强场动力学验收与暴露

| 文件 | 改动 |
|---|---|
| `apps/web/e2e/electric-acceptance-v2.mjs` | Case N（electric-01 类平抛：试题→已知量→结构化步骤→verified→Lab 轨迹渲染）；Case O（Agent"轨迹为什么是抛物线"→引用 `electric_kinematic_consistency`→不引库仑→revision 不变） |
| `apps/web/e2e/final-screenshots.mjs` | 匀强场动力学 3 张截图：`question-electric-dynamics-final`、`electric-dynamics-trajectory-final`、`agent-trajectory-shape-final` |

**D.3 不做**：Lab 新建菜单加匀强电场模板。与 V1"不在 Lab 新建菜单加电场
模板"决策一致——匀强场仍走 Question → Lab。

## 4. 浏览器验收 Case

| Case | 场景 | 验证点 | 结果 |
|---|---|---|---|
| J | 等量异种点电荷中点求 E（Golden Question） | 题面→已知量高亮→叠加步骤→verified | PASS |
| K | 多源渲染 + Inspector 编辑 | 两 source + 弯曲流线 + 等势线；Inspector 多 source 可编辑；编辑后 verified | PASS |
| L | Agent「电场线为什么从正电荷出来」 | 高亮 stream + 引用 chargeSigns + 不谎称方向 + revision 不变 | PASS |
| M | Agent「合场是怎么来的」 | 引用 `electric_field_superposition` + revision 不变 | PASS |
| N | 匀强电场动力学题（类平抛） | 试题→结构化步骤→Lab verified→轨迹渲染 | PASS |
| O | Agent「轨迹为什么是抛物线」 | 引用 `electric_kinematic_consistency` + 不引库仑 + revision 不变 | PASS |

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
| `electric-dynamics-trajectory-1600x900.png` | 匀强场类平抛 Lab：轨迹线 + E/F/v 向量 |
| `agent-trajectory-shape-1600x900.png` | Agent 解释抛物线轨迹 |
| `question-electric-dynamics-final-1600x900.png` | 最终集：匀强场动力学题 |
| `electric-dynamics-trajectory-final-1600x900.png` | 最终集：轨迹 Lab |
| `agent-trajectory-shape-final-1600x900.png` | 最终集：Agent 抛物线解释 |

## 7. 测试数据

- `test:core`：全绿（question-core 108 测试含方向性距离题；全 core 包无回归）。
- `test:web`（ui-physicsos）：117 passed（含新增匀强场动力学 intent 10 测试、
  修复的 `electric-field/force-magnitude` 匀强场文案测试）。
- `typecheck:core` / `typecheck:web`：全绿（注意 Web
  `exactOptionalPropertyTypes`：`sampleOffset` 用条件展开，不传 `undefined`）。
- 客户端 bundle 重建完成。
- 浏览器验收：`electric-acceptance-v2.mjs` Case J-O 全 PASS、5 门禁为 0。
- 回归：`electric-acceptance.mjs`（V1）5 Case 全 PASS；
  `mechanics-acceptance.mjs` 全 PASS。

## 8. 不做（明确边界）

- **不新建平行板有界电场**（用户未选；引擎分段解析 + 新 Scene 形状风险中等，留待后续）。
- **不新建点电荷 1/r² 动力学**（需自适应步长积分，风险高，backlog）。
- **不新增匀强电场引擎能力**（已完整，不碰 Engine / Scene factory / Verifier / Observation / Visual）。
- **不改 V1/V2 已验收的点电荷 Agent 意图**（`electric-field-direction`、
  `electric-field-line-origin`、`electric-superposition` 维持多源逻辑）。
- **不做 Timeline 事件标记**（匀强电场全局场无离散事件；backlog
  `ELECTRIC_TIMELINE_EVENT_MARKERS_BACKLOG` 开始条件未满足）。
- **Lab 新建菜单不加匀强电场模板**（与 V1 决策一致，仅 Question → Lab）。
- **复杂空间解析只支持点电荷单源方向性距离**（"左侧 5cm"），多源场景已有
  `samplePosition` 不扩展。
