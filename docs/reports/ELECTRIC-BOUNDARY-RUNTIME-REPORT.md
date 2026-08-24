# PhysicsOS Phase 4 — 有界电场 / 平行板电场 Runtime 报告

> 里程碑：`ELECTRIC_BOUNDARY_RUNTIME_COMPLETE` → `PHYSICSOS_PHASE4_COMPLETE`
> 日期：2026-08-23
> 文件：`docs/reports/ELECTRIC-BOUNDARY-RUNTIME-REPORT.md`

---

## 1. 交付的能力

高中物理电场部分的核心考点 —— **平行板电容器中带电粒子的偏转** —— 此前完全缺失。
V1/V2/Phase 3 覆盖的是无界匀强电场与点电荷静电场，两者都没有"场只存在于某个
区域内"的概念，因此也没有进入场区、离开场区、打到极板这些离散事件。

本阶段补齐的是一条完整的垂直切片：

| 层 | 交付物 |
|---|---|
| Scene | `createParallelPlateScene` —— 1 粒子 + 1 区域绑定匀强场 + 1 矩形场区 + 2 极板边界 |
| IR | `charged_particle_bounded_electric_field` 模型 + `plateSeparation` / `plateLength` / `enterPosition` 字段 |
| Engine | `@physicsos/engine-electric-region` —— 分段解析（场外 a=0、场内 a=qE/m）+ 三类离散事件 + 14 个派生量 + 5 项校验 |
| Parser | `parseParallelPlate` + 10 道 Golden Question（electric-10 ~ electric-19） |
| Runtime | 平行板分支 + `SimulationResult.events` → `TimelineEvent` 映射 + 平行板专属 tree/inspector/editParameter |
| Renderer | `ElectricRegionRenderer` —— 金属质感极板 + clipPath 裁剪的有界场格 + 轨迹 + 向量 |
| Agent | 10 个有界场教学意图，全部引用引擎已断言的 check 与派生量 |

物理正确性的关键点：**场只存在于板间矩形区域**。粒子在场外做匀速直线运动
（a = 0，F = 0），进入场区后做类平抛（a = qE/m 恒定），离开后恢复匀速直线，
或在偏转距离达到 d/2 时打到极板并停止。这不是把无界场裁一段来画 —— 引擎对每
一相分别求解，区域外的 E、F、a 都严格为零。

---

## 2. 架构遵循

沿用 `docs/15-RUNTIME-ARCHITECTURE.md` 的链路，未新增第二套 Runtime：

```
Question → IR → Scene → PhysicsEngine → Verifier → Observation → Visual Bridge → UI → Agent
```

新引擎实现的是同一个 `PhysicsEngine<PhysicsScene, PhysicsEventLike>` 接口，与
`engine-magnetic` / `engine-mechanics` 同构。它与既有 `engine-electric` 通过
`canHandle` **互斥**：

- `engine-electric-region` 只接受 `regions.length > 0` 且 `fields[].regionId`
  指向有效矩形区域的场景
- `engine-electric` 明确拒绝任何带 `regions` / `boundaries` 的场景

因此不存在两个引擎同时声称能处理同一场景的情况，路由由 `engine-selector.ts`
按 IR model 决定。

离散事件走 `PhysicsEventLike`（`physics-core/simulation.ts`，开放 `type: string`），
与 `scene-runtime.ts` 的 `PhysicsEvent`（SceneCommand 产生的命令事件）是两回事，
后者未改动。

Renderer 不 import 任何 engine，只消费 `SceneVisualModel`；极板几何、场方向、
轨迹全部由 Visual Bridge 从场景与已验证的观察量产出。

---

## 3. 浏览器验收

`apps/web/e2e/electric-region-acceptance.mjs` —— 6 个 Case，全部 PASS：

| Case | 验收内容 | 结果 |
|---|---|---|
| A | 点电荷回归：`electric-03` 仍 verified、源电荷仍绘制、**极板不泄漏到点电荷帧** | ✓ 6/6 |
| B | 匀强场回归：`electric-01` 仍 verified、轨迹仍绘制、**无界场无极板无区域事件** | ✓ 6/6 |
| C | 平行板全链路：`electric-10` READY → 解答步骤 → 实验室 verified → **两块极板** → 轨迹 | ✓ 9/9 |
| D | 事件时间轴：标记数 ≥ 2、点击标记 seek 时钟生效 | ✓ 2/2 |
| E | Agent 解释偏转：引用依据、**不引库仑 1/r²**、高亮命中、**revision 不变** | ✓ 6/6 |
| F | Scene Branch：改参数 revision +1 且仍 verified、题目场景未被污染 | ✓ 4/4 |

5 项门禁全部为 0：console errors、page errors、unhandled rejections、
failed requests、error responses。

回归保护写进了断言本身 —— Case A 断言点电荷帧里 `plates === 0`，Case B 断言
无界场帧里既无极板也无区域事件。新渲染分支若误劫持旧场景，验收会直接失败。

**打板路径单独验证**：Case C/D 走的是 `electric-10`（穿过场区，产出
enter + exit）。`HitPlate` 这条路径另外在浏览器里验过 `electric-13`（电子打到极板
的时间）：workflow READY、verified、两块极板、事件标记为「进入电场 1.00e-9 秒」+
「打到极板 5.77e-9 秒」、**没有「离开电场」**（粒子打板停止，物理正确）、0 错误。
截图 `lab-plate-impact-1600x900.png`。

**旧 acceptance 回归**：`electric-acceptance.mjs`（V1 匀强场 + 点电荷）、
`electric-acceptance-v2.mjs`（多源点电荷 + 等势线）、`mechanics-acceptance.mjs`
三份全部 ALL CHECKS PASSED、门禁为 0。

---

## 4. 单元测试

| 范围 | 数量 |
|---|---|
| `test:core`（17 个包） | 445 全绿 |
| `test:web`（ui-physicsos） | 163 全绿 |
| 其中 `engine-electric-region` | 16 |
| 其中 `question-core`（含 10 道平行板题） | 146 |
| 其中 region runtime / visual / agent | 23 / 8 / 52 |

`typecheck:core` 与 `typecheck:web` 均零错误。bundle 已重建。

---

## 5. 浏览器验收暴露的五个真实缺陷

单元测试 608 项全绿，但浏览器一开就白屏 —— 这些缺陷没有任何单元测试能捕获，
记录在此作为"未跑不报"的实证。其中 5.2 和 5.5 尤其说明问题：两者的相关断言当时
都是**通过**的（DOM 元素存在、aria-label 与实现一致），只有看截图、读实际输出才
发现功能不可用。

### 5.1 试题空间白屏（致命）

`QuestionWorkspace.tsx` 的 `useQuestionFrames` 用 `resolveUniformElectricModel`
（旧引擎）为试题预览求解轨迹。平行板场景带 `regions`，旧引擎 `canHandle` 拒绝并
抛 `EngineUnsupportedError: electric_force_only` —— 在 render 期间抛出，React 卸载
整棵树，页面白屏。

core runtime、实验室 runtime、visual bridge 三处都正确路由了新引擎，唯独试题空间
的预览路径漏了。修复：加平行板分支，用 `electricRegionEngine.stateAtSeconds`。

### 5.2 极板在画布上不可见

`extentOf` 有硬编码下限 `Math.max(12, …)` / `Math.max(7, …)` 与 2 单位最小内边距 ——
为米级场景（无界场、点电荷场）调的。平行板装置是厘米级（0.12 m × 0.04 m），被强行
放大到 17.92 × 10.08 场景单位，极板压成不可见的一点；`vectorBase` 随之变成 7，
E 与 v 箭头长到 1.3 m，飞出画布。

值得注意的是 Case C 的 `plates === 2` 断言当时是**通过**的 —— DOM 元素确实存在，
只是视觉上看不见。这类"测试过了但功能不可用"只能靠看截图发现。

修复：给 region 分支写独立的 `regionVisualFrame`，内边距按内容比例而非绝对值；
tick 步长、粒子半径、比例尺都改为从 frame 推导（`niceStep` 选 1/2/5×10ⁿ），
所以从毫米到米都能正确取景。未改共用的 `extentOf`，Case A/B 零风险。

### 5.3 场方向画错 + 极板极性标错

`fieldDirection` 取自当前帧的 `electric_field` 观察量。有界场里粒子在板外时观察到
的 E 严格为零，包括开场帧 —— 于是方向退化到 fallback `{x:1, y:0}`，场线画成水平
向右（实际竖直向下），极板极性也跟着标反。

修复：方向改从 **场景的场定义**取（电容器的恒定物理事实），而非某一瞬间的观察量。

### 5.4 Inspector 与画布数值矛盾

引擎在 `endTime` 计算 `derivedQuantities`，那时粒子已离开场区，E / F / a 全为零。
Inspector 读的是这份终态，画布读的是当前帧 —— 学生 seek 进板间时，画布显示
|E| = 2000 V/m，右侧 Inspector 却显示 0.00。

修复：region Inspector 改读当前帧的 `state.derived`。其他域的场都是无界的，粒子
始终在场中，所以这个矛盾只在有界场暴露。

### 5.5 事件时间读作「0.00 秒」

`TimelineMarkers` 与事件列表都用 `event.time.toFixed(2)` 格式化。力学场景是秒级
（落地 2.02 s）没问题，但粒子穿过电容器只需纳秒 —— 每个电场事件都被四舍五入成
「0.00 秒」，屏幕阅读器会报出错误的时刻。

Agent 7 的测试断言 `aria-label` 等于 `` `${event.label} ${event.time.toFixed(2)} 秒` ``，
把实现的格式化逻辑复制进了断言，所以测试镜像了实现、捕获不到这个错误。

修复：`eventTimeText()` 在 10 ms 以下切换到指数形式（1.00e-9 秒），秒级行为不变；
测试断言改为检查学生真正听到的内容 —— 非零事件不得读作 0.00 秒，且解析出的数值
必须大于零。

---

## 6. Agent 教学闭环的一处设计修正

10 个有界场意图中，`bounded-field-enter` / `plate-deflection-direction` /
`plate-energy` 原本要求 `electric-force-vector` 出现在 `drawnIds` 里。但开场帧
粒子在板外，F = 0，bridge 跳过零长箭头 —— 于是学生刚打开场景时，这三个问题**不
出现在建议里**，而"为什么会偏转"恰恰是打开场景最想问的第一个问题。

修正：

- 闸门改为要求 `electric-trajectory`（轨迹来自整段仿真，任何时刻都在画）
- `forceHighlightTarget()` 动态选择高亮目标：场区内高亮力向量，场区外回退到轨迹 ——
  高亮永远指向画布上真实存在的元素，不会弹"画布当前没有显示电场力"
- `outsideFieldRegion()` 从已发布的派生量判断（不重算几何），场区外时回答补一句
  "当前时刻粒子还在板外……板外无场因此不受力"，避免出现"为什么偏转"却答"F = 0"
  的自相矛盾

3 个测试锁定这个行为：t=0 时 10 个意图全部可用、每个高亮都能 resolve、回答解释了
零力的原因。

---

## 7. 关闭的 backlog

`ELECTRIC_TIMELINE_EVENT_MARKERS_BACKLOG` —— 开始条件（引擎产出进入/离开场区、
打到极板的离散事件）已满足。BACKLOG 当初的预判也成立：**UI 侧零改动**。
`TimelineMarkers` 的 class 是动态拼的（`css[\`eventMark_${event.kind}\`]`），
新增三种 kind 自动生效，只补了三条 CSS 与 runtime 侧的 `eventsOf` 映射。

无界匀强场与点电荷场景的 `events` 仍为空数组，没有伪造 marker。

---

## 8. 不做（明确边界）

- **不做电容/充放电电路**：那属于电路域。本阶段覆盖平行板几何 + 板间电场 + 偏转
  物理，即电容器的力学部分。
- **不做极板几何的 PhysicsEvent**：`setPlateGeometry` 走了 fork、revision +1、
  `validateScene`、重新 simulate + verify，但场景自身的事件日志没记录这次改动。
  完整审计链需要往 `scene-runtime.ts` 的冻结命令集加
  `SetPlateSeparation` / `SetPlateLength`，那是 spec 变更，留待后续。
- **不做 Question Space 视觉打磨**：无具体设计需求，且该表面已有 acceptance 覆盖，
  在没有视觉验证手段的情况下改 CSS 是投机。
- **不改共用的 `extentOf`**：region 用独立 frame 函数，避免影响已验收通过的
  点电荷与无界场取景。

---

## 9. 截图

- `docs/reports/screenshots/question-parallel-plate-1600x900.png` —— 试题空间
- `docs/reports/screenshots/lab-parallel-plate-1600x900.png` —— 实验室开场帧
  （极板 + 有界场格 + 轨迹在场区内弯曲、出场后直线）
- `docs/reports/screenshots/lab-parallel-plate-events-1600x900.png` —— seek 到板间
  （E 向下、F 与 a 向上、Inspector 与画布数值一致）
- `docs/reports/screenshots/agent-plate-deflection-1600x900.png` —— Agent 解释偏转方向
- `docs/reports/screenshots/lab-plate-impact-1600x900.png` —— 打到极板路径
  （`electric-13`，事件标记为进入电场 + 打到极板，无离开电场）
