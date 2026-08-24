# Composite Field Runtime V1 — 实验中心 + 复合场产品集成

> 文件：`docs/reports/COMPOSITE-FIELD-RUNTIME-V1-REPORT.md`
> 验收日期：2026-08-24
> 前置：`ELECTRIC_BOUNDARY_RUNTIME_COMPLETE`（见 `MILESTONES.md`）
> 里程碑：`COMPOSITE_FIELD_RUNTIME_V1_COMPLETE`

## 1. 目标与问题

本轮解决的是 **UI / Product Exposure Gap**：底层已有 Mechanics / Electric /
Electric-Region / Magnetic / Composite 五套 Runtime（engine-composite 26 项
测试全绿），但学生进入物理实验室仍几乎只能看到「磁场中的带电粒子运动」。
本轮**不扩引擎**，把既有 Runtime 真正暴露为可创建、可操作、可观察的实验：

1. 实验室不再只有一个实验 —— 正式的 **Experiment Template Registry + 实验选择器**。
2. **速度选择器**、**质谱仪 V1**、**E+B**、**E+B+g**、**多场区** 五个复合场实验全链路接通。
3. Question Space 增加 **21 道 Composite Golden Questions** 与结构化 Solution。
4. Agent 增加 **13 个复合场教学意图**，全部引用 Composite Verifier。

## 2. Experiment Library（实验中心）

### 2.1 模板注册表

`vendor/.../ui-physicsos/src/client/physics/experiment-templates.ts`：

- `ExperimentTemplate { id, domain, label, hint, icon, tags, createScene, comingSoon? }`，
  按 `mechanics / electric / magnetic / composite` 分组。
- **16 个可创建模板**：力学 6（匀速直线、匀变速、平抛、斜抛、牛顿第二定律、斜面）、
  电场 4（单点电荷、多点电荷、匀强电场粒子、平行板偏转）、磁场 1（磁场圆周运动）、
  复合场 5（速度选择器、质谱仪、E+B、E+B+g、多场区）。
- 每个模板的 `createScene()` 都是**真 Scene Factory**
  （`createMechanicsScene` / `createPointChargeScene` / `createParallelPlateScene` /
  `createMagneticScene` / `createVelocitySelectorScene` / `createMassSpectrometerScene` /
  `createCompositeFieldScene` / `createMultiRegionFieldScene`），
  没有任何 `if (type === ...)` 分发和假 Canvas。
- **SceneId 唯一**：`stampId = base + Date.now().toString(36) + 自增序号`，
  同一毫秒双击也不会撞 id；`magnetic-demo-scene` 一类固定 fixture id 不再出现。
- **回旋加速器不造假**：engine-composite 只支持分段静态 uniform region，没有
  时变电场，故模板标记 `comingSoon: true`，选择器里灰置显示「即将支持」，
  `createScene()` 直接 throw。

### 2.2 实验选择器（Experiment Picker）

`ExperimentPicker.tsx`：搜索框 + 分类 Tabs（全部/力学/电场/磁场/复合场）+
紧凑 2–3 列实验行（SVG 图标 + 名称 + 一句说明 + 领域标签）。Harness 玻璃面板
风格，非 SaaS 大卡片；选择器中不显示公式。

- **快速开始**：首次使用（无最近记录）显示 4 个代表实验（平抛、平行板、
  磁场粒子、速度选择器）；有记录后同一行变为「最近使用」（localStorage，cap 3）。
- **三个入口统一**：Sidebar「新建 → 新建物理实验」、首页「新建物理实验」、
  物理实验室空态，全部打开同一个 Picker，模板列表只有一份。
- **导航行为（修复截图问题）**：点击「物理实验室」且无 active scene → 进入实验库
  空态，**不再自动塞 Magnetic Scene**；有 active scene → 恢复该场景。
- **切换实验**：工具栏场景名称可点击（名称 + 下拉箭头按钮），打开选择器且当前
  实验**可恢复**（选择器头部出现「返回当前实验 · 场景名」按钮）。
- **最近空间记真实 Scene**：`surface-store` 把每个打开过的场景（模板创建、题目
  打开、恢复）序列化进 localStorage（cap 8），Sidebar 与首页的「最近空间」显示
  名称 + 类型徽标（实验/题目）+ 更新时间，点击恢复整个 PhysicsScene。

## 3. Composite Scene / Engine（复用，未重写）

物理层全部复用本轮之前已验收的实现：

- `physics-composite-core`：F = qE + qv×B + mg 闭式解（48 测试）。
- `physics-scene/composite/composite-scene-factory.ts`：
  `createVelocitySelectorScene`（单区 E⊥B）、`createMassSpectrometerScene`
  （选择器区 → 无场过渡区 → 磁偏转区三区连续世界）、`createCompositeFieldScene`
  （E+B、可选重力）、`createMultiRegionFieldScene`。
- `engine-composite`：phase decomposition、EnterRegion/ExitRegion/SwitchField
  精确边界事件、派生量（选择速度/回旋半径/回旋周期/动能…）、法则校验
  （合力叠加、洛伦兹力不做功、能量一致、周期与速度无关），26 测试。
- `physics-verifier/composite-verifier.ts`：装置级校验
  `velocity_selection_condition`、电场力/洛伦兹力大小、磁偏转半径。

**本轮修的一个装置朝向错误**：速度选择器/E+B/E+B+g 三个模板原先显式传
`magneticFieldOrientation: 'into_page'`，对 q>0、v∥+x、E 竖直向上的布局，
qE 与 qv×B **同向**（都向上），选择器"筛掉所有粒子"。改为 `out_of_page`
后两力等大反向，v = E/B 时直线通过 —— 与工厂默认、Golden Questions 一致。
浏览器验收 CASE B/D 直接断言了这一点。

## 4. 速度选择器（Composite V1 第一个 UI 实验）

- 默认参数：q = 1.6×10⁻¹⁹ C，m = 1.67×10⁻²⁷ kg，E = 2.0×10⁴ V/m（向上），
  B = 0.20 T（向外），v₀ = 1.0×10⁵ m/s = E/B，区域 0.4 m × 0.2 m。
- Canvas 真实显示：粒子（q⁺ 光晕球）、E 场格（区域内裁剪）、B 场 ⊙/×
  glyph、F_E / F_B / F_net / v 矢量、轨迹、选择器区域矩形 + 标签、比例尺、
  实时 readout（|v|、|E|、|B|、|F_E|、|F_B|、|F_net|）。
- Inspector 可编辑 q / m / v₀ / E / B / 电场方向；派生量（电场力、洛伦兹力、
  重力、合力、加速度、速度、选择速度…）从**当前帧** state 读取（Phase 4 教训：
  不读 endTime derived）。
- 修改 v₀ 走真实链路：SceneCommand → revision +1 → Composite Engine 重算 →
  Verifier → Observation → Canvas 轨迹改变；v₀ = E/B 时「速度选择条件」PASS
  且直线，v₀ ≠ E/B 时 FAIL 且偏转（**物理仍 verified** —— 装置校验是读数，
  不是法则失败）。
- 开场播放头落在场区内首个"场生效"时间段的中点（`openingPlayheadTime`），
  学生打开就能看到两个力在平衡，而不是场外一支孤零零的速度箭头。

## 5. 质谱仪 V1

- 三区连续 Physics World（不是三张卡片）：选择器区 E+B（0.3×0.2 m）→
  无场过渡区 → 磁偏转区 B（1.2×1.2 m）。默认 E = 200 V/m、B = 2.0×10⁻³ T、
  v = E/B = 1.0×10⁵ m/s，偏转半径 r = mv/(qB) ≈ 0.52 m 与偏转区同量级，
  圆弧肉眼可辨（截图 QA 确认）。
- Scene Tree 显示三个区域（选择器区 E+B / 无场过渡区 / 磁偏转区 B，各带尺寸），
  点击区域 → Canvas 高亮对应矩形。
- 派生量含 `选择速度`、`回旋半径`、`回旋周期`；荷质比在 Question 侧由
  Runtime/派生量给出，Parser 不计算。

## 6. Question Space（Parser / Solution）

- `deterministic-composite-parser.ts`：识别 速度选择器/质谱仪/荷质比/同位素/
  互相垂直/不偏转/直线通过/回旋加速器 等信号；抽取 q/m/v/E/B/r 与方向词；
  产出 IR `domain: composite`，`model: velocity_selector | mass_spectrometer |
  charged_particle_composite_field`。缺磁场方向 → AMBIGUOUS（comp-08），
  回旋加速器 → 显式 UNSUPPORTED（comp-21），不硬解。
- `composite-scene-builder.ts`：IR → 复用同一批 Scene Factory，写
  `sourceQuestionId`。
- **21 道 Golden Questions**：8 速度选择器（含 1 道歧义样本）+ 6 质谱仪 +
  3 E+B + 3 E+B+g + 1 回旋加速器拒识样本，全部在 `question-core` 测试断言
  域路由、验证状态与数值（220 项测试全绿）。
- Solution 结构化五步：判断电场力方向 → 判断洛伦兹力方向 → 写出平衡条件 →
  读取已验证的引擎结果 → Verifier 检查。公式（v = E/B、r = mv/(|q|B)、
  T = 2πm/(|q|B)）作为推理展示，数值 Fact 全部来自 Runtime 派生量。
- **在物理世界中打开**：composite 题与力学/电场题走同一 `openSurface('lab',
  sceneRef)`，Lab 由 `domainOfScene` 自动路由到 CompositeWorkspaceRuntime。

## 7. Workspace Runtime / Renderer / Observation

- `CompositeWorkspaceRuntime` 与 Magnetic/Mechanics/Electric Runtime 遵守同一
  `WorkspaceRuntime` 契约；`LabWorkspace.buildRuntime` 的 composite 分支返回真
  Runtime（此前显式 `return null`）。**没有** `CompositeLabWorkspace.tsx`，
  PhysicsWorkspace 仍是唯一 shell。
- `CompositeRenderer` 进入 `RENDERERS` 注册表，复用既有 primitive：粒子光晕、
  `Vectors`、轨迹 path、区域矩形 + clipPath 裁剪场格（仿 ElectricRegionRenderer）、
  ⊙/× 磁场 glyph、区域标签。未复制 Magnetic/Electric Renderer 代码。
- 颜色沿用全局语义 token（chrome.ts 既有）：velocity 绿、E 场青蓝、电场力蓝、
  磁场低饱和 indigo、洛伦兹力钴蓝、重力 slate、合力橙、轨迹 Physics Blue。
- `observeCompositeScene` 提供 velocity/electric_force/magnetic_force/
  gravity_force/net_force/electric_field/magnetic_field/trajectory 观察量，
  Scene Tree 可观察量复选框与 Canvas 可见性全部接真实 Observation
  （E2E 断言勾选/取消会增减 SVG 矢量）。

## 8. Timeline

- Composite Engine 的 EnterRegion / ExitRegion / SwitchField 事件正式映射为
  Timeline markers（`compositeEventsOf`），标签为「进入/离开 + 区域角色名」，
  时间为引擎相位分解的精确穿越时刻。点击 marker → seek。
- 时间显示复用既有自适应格式（`formatClock` / `eventTimeText`）：微秒级显示
  `5.00e-7 s`，浏览器验收断言"没有任何 marker 读作 0.00 秒"。

## 9. Agent Composite Tutor

- `physics-agent-answers.ts` 新增 13 个复合场意图：velocity-selector-balance、
  velocity-too-fast、velocity-too-slow、electric/magnetic-force-direction、
  magnetic-no-work、enter-magnetic-region、why-circular、spectrometer-radius、
  charge-to-mass、gravity-balance、net-force、region-transition。
- 「为什么这个粒子没有偏转？」的回答引用 Composite Verifier 的
  `velocity_selection_condition` 具名检查 + Runtime 力数值（|F_E|、|F_B|、|ΣF|），
  依据 chips 显示【场景 rev.】【仿真已验证】【速度选择条件】；Agent 不自算 v = E/B。
- 工具仍是 `physics.ui.highlight`（没有 highlightComposite）；alias 增加
  electric-force / magnetic-force / gravity-force / net-force / selector-region /
  magnetic-region / drift-region / trajectory（含 `composite-trajectory` 视觉 id）。
- **一次回答多目标高亮取并集**：原实现逐个 `setHighlight` 替换，三个高亮只剩
  最后一个；现在 Drawer 聚合 `highlightIds` 后一次应用，电场力与洛伦兹力同屏
  高亮。合力为零未绘制时高亮**诚实拒绝**（"画布当前没有显示合力"），E2E 断言
  平衡帧 net-force 解析为空、破坏平衡后可解析。

## 10. Experimental Branch

Composite 题目场景在 Lab 中改 E / B / v₀ 时先 fork（`forkExperimentalScene`），
工具栏出现「实验分支 · 来源：题名」徽标与「恢复原题条件」；播放/seek/观察量
开关不 fork。E2E CASE G 断言：打开不 fork → 改 E fork（分支 revision 从 1 重新
计数、仍 verified）→ 恢复后回到原题条件；原题已知量与解不被污染。

## 11. 浏览器验收（composite-acceptance.mjs，最终构建全绿）

| CASE | 内容 | 结果 |
|---|---|---|
| A | 物理实验室 → 实验库（非自动磁场）；≥16 模板；5 个分类 Tab；快速开始；搜索过滤；回旋加速器灰置 | PASS |
| B | 创建速度选择器：composite verified；区域/粒子/轨迹/E/F_E/F_B/v 全部绘制；选择条件 PASS | PASS |
| C | v₀ → 1.5×10⁵：revision +1、轨迹改变、选择条件 FAIL、物理仍 verified | PASS |
| D | v₀ → 1.0×10⁵：选择条件恢复 PASS、直线轨迹恢复 | PASS |
| E | 质谱仪：3 场区绘制、场景树三区命名、回旋半径来自引擎 | PASS |
| F | Timeline：≥4 个进入/离开 marker、指数时间格式、点击 seek、事件列表 | PASS |
| G | 速度选择器题 → READY → 结构化步骤 → 在物理世界中打开 → 实验分支 fork/恢复 | PASS |
| H | 质谱仪题 → READY → Lab 复用同一场景、3 区完整 | PASS |
| I | Agent「为什么不偏转」：引用速度选择条件 + Runtime 数值、≥2 力同屏高亮、revision 不变 | PASS |
| + | E+B+g：mg 与 F_net 绘制、verified；1440/1920 响应式（canvas ≥55%、无放大） | PASS |
| 门禁 | consoleErrors / pageErrors / unhandledRejections / failedRequests / errorResponses 全 0；整页无滚动条；Canvas 可见 | PASS |

回归（同一最终构建连跑）：`mechanics-acceptance.mjs`（含磁场回归，改为经
实验库创建）、`electric-acceptance.mjs`、`electric-acceptance-v2.mjs`、
`electric-region-acceptance.mjs` —— **全部 ALL CHECKS PASSED**，门禁全 0。
`harness-home-semantics.mjs`、`harness-home-shot.mjs`、`harness-lab-shot.mjs`
（改为经实验库创建磁场实验）、`harness-lab-zoom.mjs`、`final-screenshots.mjs`
全部通过。

**旧 E2E 的两处必要适配**：① 物理实验室不再自动加载磁场 demo，磁场回归改为
经选择器创建（产品行为变更，非测试放水）；② 最近空间开始记录真实场景后，
出现与题目同名的侧栏按钮，所有题目点击收敛到 `questions()` 面板作用域内，
避免点到侧栏。

## 12. Screenshot QA（人工逐张检查）

`docs/reports/screenshots/`（全部在最终构建重拍）：

| 截图 | 人工检查结论 |
|---|---|
| `experiment-library-1600x900.png` | 16 模板 + 灰置回旋加速器；图标/领域标签/快速开始/Tabs 清晰；无滚动条 |
| `velocity-selector-lab-1600x900.png` | F_E↑ 与 F_B↓ 等大反向、readout 两力同为 3.20e-15 N、合力 0、直线轨迹、区域可辨、比例尺 20 cm |
| `velocity-selector-lab-1440x900 / 1920x1080` | 三视口布局一致、矢量与标签不遮挡、canvas 未被放大 |
| `mass-spectrometer-lab-1600x900.png` | 三区可辨、选择器内直线、偏转区内清晰圆弧（r≈0.52 m 与 1.2 m 区域同量级） |
| `composite-timeline-1600x900.png` | 事件面板四行进入/离开 + 指数时刻；marker 点击后播放头 5.00e-7 s |
| `composite-ebg-lab-1600x900.png` | mg 与 F_net 可见；readout \|F_net\| = 1.64e-26 N 恰等于 mg（E/B 力抵消） |
| `velocity-selector-question-1600x900.png` | 已知量/求解目标/物理关系/五步解析/验证 4/4；数值与 Lab 一致 |
| `mass-spectrometer-question-1600x900.png` | 轨道半径 0.5219 m 来自引擎；21 道 composite 题在列表可见 |
| `composite-agent-1600x900.png` | 依据 chips + 中文高亮操作按钮 + 「合力未绘制」诚实拒绝提示 |

厘米级场景无米级 min-extent 放大（composite-visual-bridge 用内容比例 padding，
质谱仪 1.2 m 与选择器 0.4 m 装置取景都正常）。

## 13. 测试与构建门禁（最终状态）

| 门禁 | 结果 |
|---|---|
| engine-composite | 26/26 |
| physics-composite-core | 48/48 |
| physics-scene | 39/39 |
| physics-observation | 14/14 |
| physics-verifier | 30/30 |
| question-core（含 21 道 composite golden） | 220/220 |
| 其余 core 包（mechanics/electric/electric-region/magnetic/units/core…） | 全绿 |
| ui-physicsos（`test:web`） | 190/190（15 文件） |
| `typecheck`（core + web） | 零错误 |
| `lint`（core + web） | 零错误（本轮顺带清掉了历史遗留的 24+ 处 oxlint 违规） |
| Harness build（ui-physicsos bundle + web-frontend） | 通过 |
| Harness GUI（`test:gui`，packages/client + packages/host） | 3948/3950 通过、1 跳过、1 个上游 `code-block` shiki 懒加载测试在并行负载下超时，**单独重跑 15/15 通过**（与既有 `UPSTREAM_PARALLEL_TEST_FLAKE` 同类） |
| overlay capture | 已回写 `overlays/harness/files/` |

Harness Full Replay 按 `HARNESS_WINDOWS_REPLAY_GATE_DEFERRED` 继续豁免。

## 14. 本轮收口修复清单（浏览器/门禁暴露，单元测试未捕获）

1. **选择器装置朝向**（模板显式 into_page 覆盖了工厂正确默认）：两力同向，
   v = E/B 也偏转 —— CASE B 的 verifier 断言直接抓出，改 out_of_page。
2. **Agent 多目标高亮互相覆盖**：三个 highlight 调用只剩最后一个 ——
   CASE I 的"≥2 力同屏"断言抓出，Drawer 聚合并集后一次应用。
3. **`trajectory` 高亮别名未含 `composite-trajectory`**：composite spec 抓出。
4. **AgentDrawer 复制了一份高亮标签表**：缺 composite 条目导致按钮显示
   `magnetic-force` 英文 id —— 截图 QA 抓出，删除副本改用共享 `highlightLabel`。
5. **`?? 0 < 0` 优先级隐性 bug**（electric-visual-bridge 电荷符号 fallback）：
   解析为 `?? (0<0)`，任何非零电荷都会被判为负 —— lint 门禁抓出，加括号修正。
   正常路径由 charge_sign 观察量覆盖，故此前未显形。
6. **旧 E2E 与截图脚本的入口适配**（见 §11）与 `harness-home-semantics.mjs`
   一处陈旧断言（「新建物理世界」在任何版本文案中都不存在，改为与产品一致的
   「新建物理实验」）。

## 15. Known Limitations

- **回旋加速器**：engine-composite 无时变场，模板仅作「即将支持」展示。
- **最近空间恢复的是初始场景**：Runtime 内的参数编辑不回写 store（架构如此，
  revision 归运行时所有）；恢复 = 回到该场景创建时的条件。
- **E+B+g 模板用质子演示**：mg（1.64×10⁻²⁶ N）与电磁力（3.2×10⁻¹⁵ N）相差
  11 个量级，"重力对微观粒子可忽略"本身是教学点；宏观带电小球的三力平衡
  已由 comp-18/19/20 三道 E+B+g Golden Questions 覆盖（qE = mg 平衡由引擎解）。
- **磁偏转区为矩形**：粒子圆弧可能从区域下缘离开（物理正确），V1 不做
  半圆形 D 盒外观。
- **Agent 仍是确定性意图匹配**：`AGENT_MODEL_BACKED_ANSWERS_BACKLOG` 未变。
- **GUI 套件的 `code-block` 上游测试**在高并行负载下偶发超时（单跑全绿），
  归入 `UPSTREAM_PARALLEL_TEST_FLAKE`。

## 16. 里程碑判定

四十九条完成标准逐项核对：实验室不再只有一个实验（16+ 模板）✅、速度选择器
完整 ✅、质谱仪 V1 完整 ✅、Composite E+B 完整 ✅、E+B+g 完整 ✅、Question
Composite 完整（21 golden + 五步 Solution）✅、Agent Composite 完整（13 意图 +
Verifier 引用）✅、Timeline Regions 完整 ✅、Experimental Branch 完整 ✅、
UI Visual QA 完整（§12）✅、Tests 全绿（§13）✅、Browser Gates 全绿（§11）✅。

**判定：`COMPOSITE_FIELD_RUNTIME_V1_COMPLETE`。**
