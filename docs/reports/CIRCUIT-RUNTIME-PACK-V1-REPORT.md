# Circuit Runtime Pack V1 — 直流动态电路（第三条系统级验收链）

> 文件：`docs/reports/CIRCUIT-RUNTIME-PACK-V1-REPORT.md`
> 验收日期：2026-08-26
> 前置：`EXPERIMENT_LIBRARY_HOME_V1_COMPLETE`（见 `MILESTONES.md`）
> 里程碑：`CIRCUIT_RUNTIME_PACK_V1_COMPLETE`
> 对应 roadmap：Phase 13 — Circuit Engine（§16）与第三条系统级验收链「动态电路」（§47）

## 1. 目标与范围

按 roadmap 顺序推进下一个物理领域：**Circuit 动态电路**。Phase 13 声明的能力
（CircuitGraph / Series / Parallel / Mixed / Switch / Variable Resistor /
Meter / Internal Resistance）本轮全部落地。

这是第一个**非空间坐标系**领域：画布不再是米制世界，而是抽象原理图网格。
既有的 PhysicsScene → Engine → Verifier → WorkspaceRuntime → Renderer
骨架不变，新增的是「电路图」这一渲染范式与「准静态扫描」这一播放范式。

Golden First：`engine-circuit` 的 golden case（串联/并联/混联/断路/EMF 测量）
先于 UI 存在，UI 的每个读数都能对回引擎断言过的工作点。

## 2. Domain Core（commit `f7193b9`）

### 2.1 场景契约（physics-scene）

- `circuit/circuit-scene.ts`：netlist 风格工厂 `createCircuitScene` ——
  每个元件按端子声明所属电气结点（net），拓扑由 net 名重建（同 net 端子
  两两成链，union-find 可精确还原）；`circuit.metadata.layout` 存
  **presentation-only** 原理图布局（元件网格坐标 + 0/90/180/270 旋转 +
  连线 waypoint），引擎只读 netlist、不读布局。
- 符号几何约定单一来源：`CIRCUIT_SYMBOL_HALF_LENGTH = 0.75`（符号长 1.5
  网格单位），模板走线与 renderer 共用，端点永远对得上。
- **时间轴语义**：直流电路本身无时间演化。含滑动变阻器时时间轴 =
  `CIRCUIT_SWEEP_DURATION_SECONDS = 8` 秒的准静态滑片扫描窗口；
  没有滑变则时间轴长度为 0（静态读数，不伪造动画）。
- `circuit/circuit-templates.ts`：五个实验模板工厂
  `createSeriesCircuitScene` / `createParallelCircuitScene` /
  `createMixedCircuitScene` / `createRheostatCircuitScene` /
  `createEmfMeasurementScene`，全部手排矩形回路布局 + 显式拐角 waypoint。
- `scene-validation.ts`：电路结构校验（端子引用、连接完整性）。

### 2.2 冻结命令集扩展（Contract Change）

`scene-runtime.ts` 的 SceneCommand 冻结集新增五条电路命令，语义与其他域
一致（校验负载 → revision +1 → 可审计）：

```ts
SetComponentResistance   { circuitId, componentId, resistance }   // 定值电阻阻值 / 滑变全阻值
SetSourceVoltage         { circuitId, componentId, voltage }      // 电动势
SetSourceInternalResistance { circuitId, componentId, internalResistance }
SetSwitchState           { circuitId, componentId, state: 'open' | 'closed' }
SetSliderPosition        { circuitId, componentId, position: 0..1 }
```

`docs/03 §69` 的锁定清单延续以交付报告记录演进的既有惯例
（Mechanics / Electric 命令见对应报告）。`PhysicsScene.circuits[]` 与
Circuit 元件契约（docs/03 §50–63、§177 不变量）为既有冻结定义，本轮
**无 schema 变更**，属首次投入使用。

### 2.3 MNA 直流引擎（engine-circuit）

- `circuit-model.ts`：场景 → 电气模型解析。理想电压表化为
  `IDEAL_VOLTMETER_RESISTANCE` 高阻支路，滑变接入电阻有
  `MIN_SLIDER_RESISTANCE` 下限（滑到 0 不产生数值奇点）。
- `mna-solver.ts`：修正结点分析。未知量 = 非地结点电位 + 每条源支路
  （理想 EMF / 闭合开关 / 理想电流表）的电流；**每个连通岛各自选地**，
  开关断开后不会留下无参考的悬浮子网；高斯消元带部分主元，奇异系统
  显式抛 `CIRCUIT_SOLVER_SINGULAR`（如理想电源两端接同一结点）。
  解携带 `kclResidual`、`totalSourcePower`、`totalDissipatedPower`。
- `circuit-engine.ts`：与 magnetic / mechanics / electric 同构的
  `PhysicsEngine<PhysicsScene, PhysicsEventLike>`；`canHandle` 与其他引擎
  **互斥**——只接受纯电路场景（恰一个 circuit、无 particles/bodies/
  fields/regions），且当前限定单电源、拒绝电容/电感等 reactive 元件
  （显式 failedConditions，不静默降级）。
- **准静态扫描**：`stateAt(t)` 把 t 映射为滑片位置（从存储位置线性扫到
  100%）并**重解**该位置的直流工作点，图表因此是 U/I/P 对扫描的真实曲线；
  静态电路 `simulate` 只采一个样本。
- 派生量：`emf` / `main_current` / `terminal_voltage` / `total_power` /
  `external_power` / `internal_power` / `external_resistance` /
  `slider_resistance:<id>`，全部带公式。
- 校验五类：`scene_valid`、`kcl_current_conservation`（KCL 残差 < 容差）、
  `power_balance`（P源 = ΣP耗）、`terminal_voltage_law:<sourceId>`
  （U = E − I·r）、`ideal_meters_non_intrusive`（理想表不改变工作点）。

### 2.4 Golden Cases（先于实现锁定行为）

`circuit-engine.test.ts` + `mna-solver.test.ts` 共 24 项：
串联 I = E/(R₁+R₂) 且电压表读 I·R₂；并联按电导分流；混联 R₁ + R₂∥R₃；
断开开关处处无电流且端电压回到 EMF；EMF 测量在扫描两端点满足
U = E − I·r；滑变扫描 `stateAt` 沿滑片重解；P总 = P外 + P内；
`canHandle` 拒识矩阵（无电路 / 双电源 / 电容 / 短路奇异）；
请求 revision 不匹配与负时间显式拒绝；滑片线性扫描与接入电阻下限。

## 3. UI Runtime Pack（commits `e00f8d3` + `2ac24f5`）

### 3.1 实验库：16 → 21 个模板，新「电路」分类

- 五个模板：**串联电路 / 并联电路 / 混联电路 / 滑动变阻器调节电流 /
  测电源电动势与内阻**，每个 `createScene()` 都调用真 Scene Factory
  （`stampId` 唯一 sceneId），各配专属手绘卡片艺术图与符号图标。
- 学科色新增 `--physics-subject-circuit: #0d9488`（+tint），分类 Tab、
  彩点、卡片底色、领域 chip 全部消费同一组变量。

### 3.2 CircuitWorkspaceRuntime（同一 WorkspaceRuntime 契约）

- 持有 SceneRuntime + CircuitEngine，帧以共享 `WorkspaceSnapshot` 形状
  输出——电路域从同一个 `PhysicsWorkspace` 外壳与 `PhysicsCanvas` 渲染，
  没有第二套外壳。
- **参数编辑 = 真实 SceneCommand**：Inspector 的 E / r / R / 滑片位置 /
  开关全部走 §2.2 的冻结命令（revision +1 可审计），不存在本地组件态
  改数字。参数变更使旧扫描位置物理失效 → 时间归零。
- **播放 = 准静态扫描**：扫描窗口以真实秒授时，wall time 1:1 推进
  （不需要粒子域的微观展示窗口 pacing）；每帧都是滑片位置的新 MNA 解。
  静态电路时间轴长 0，运行按钮无从伪造动画。
- Question → Lab 实验分支语义与其他域一致：改物理事实先 fork
  （`requiresExperimentalFork`），播放/seek/观察量开关不 fork，
  `restoreOrigin` 丢弃分支回到题面场景。
- 图表 I-t / U-t / P-t（仅扫描场景）、数据表 t/I/U/P 采样 ≤ 13 行、
  时间轴 hover `sampleReadout`、派生量读**当前帧** state。

### 3.3 原理图渲染（circuit-visual-bridge + circuit-renderer）

- bridge 把 verified 工作点投影到布局：符号放置/旋转、正交 L 型走线 +
  waypoint、共享端子结点圆点、电流方向箭头（`data-testid="current-*"`）、
  表读数文本。**bridge 不解电路**——每个数字来自引擎工作点。
- renderer 真实绘制 SVG 符号：电源（长短极板）、定值电阻/滑动变阻器
  （含滑片箭头 `data-testid="slider-*"`）、开关（`data-closed` 随状态
  开合）、电流表/电压表（圆圈字母 + 实时读数）。
- 读数格式化 `fmtQuantityValue`：|I| < 1e-9 A 显示为 `0` ——
  断路时高斯消元残差 ~1e-16 A 是数值噪声，用指数形式展示会冒充
  求解精度（诚实呈现原则）。
- `scene-visual-model.ts` 新增 circuit visual 类型
  （`CircuitComponentVisual` / `CircuitWireVisual` / `CircuitJunctionVisual` /
  `CircuitSymbolKind`）；`domain-of-scene.ts` 用 `isCircuitScene`
  识别电路域；`renderer-registry.tsx` 注册 `circuit` 渲染器。

### 3.4 门禁清零（`2ac24f5`）

泛型命令收窄（`command<T extends SceneCommandType>`）、oxlint 违规清理、
`time-format.ts` 非空断言移除。typecheck / lint core+web 归零。

## 4. 浏览器验收（tests/acceptance/circuit-acceptance.mjs）

CASE A–F + 响应式 + 浏览器门禁，全部 PASS：

- **A** 实验库出现「电路」分类：模板总数 ≥ 21、「电路」Tab 列 5 个实验。
- **B** 串联电路：原理图真实绘制（导线 ≥ 5、结点 ≥ 2、符号笔画 ≥ 10、
  描边节点 > 20），电流表读引擎电流 0.2 A、电压表读 U₂ = 4 V
  （6 V across 10+20 Ω），电流箭头 ≥ 3，KCL 与功率守恒校验 passed，
  画布 ≥ 55% 无页面滚动。
- **C** 修改电动势 12 V → revision +1、电流表按欧姆定律联动 0.4 A，
  回填 6 V 恢复 0.2 A，全程 verified。
- **D** 断开开关：符号张开（`data-closed="false"`）、读数 0 A、电流箭头
  消失、断路仍是 verified 的物理；闭合恢复 0.2 A。
- **E** 滑动变阻器：起点 0.6 A（滑片 0 → 只剩 10 Ω 保护电阻），时间轴
  跨 8 秒扫描窗，运行 2 秒指针按比例推进，拖到终点 0.2 A、U₀ = 2 V
  （6 V/(10+20) Ω），图像页发布 I-t / U-t / P-t 三曲线。
- **F** 测电动势内阻：E = 4.5 V、r = 0.5 Ω、负载 2 Ω → I = 1.8 A、
  路端电压 3.6 V，`路端电压 U = E − I·r` 校验 passed；断开开关电压表
  直读 EMF 4.5 V。
- **响应式** 1440×900 / 1920×1080：画布 ≥ 55%、无滚动、画布不被放大。
- **门禁**：console errors / page errors / unhandled rejections /
  failed requests / error responses 全为 0。

截图七张：`circuit-library`、`circuit-series-lab`（1440/1600/1920）、
`circuit-series-open`、`circuit-rheostat-lab`、`circuit-emf-lab`。

## 5. 老套件回归（七套全 PASS）

mechanics / electric / electric-v2 / electric-region / composite /
learning / library-home 七套 acceptance 全部 PASS、门禁全 0。

唯一的适配：`library-home-acceptance.mjs` 的「四个领域彩点两两不同」
检查随「电路」分类加入更新为**五个**彩点两两不同（绿/蓝/紫/青/橙）——
这是产品演进而非回归，与 composite V1 更新「快速开始」检查同一性质。
回归重拍的截图（实验库各页现在显示「电路」Tab 与第五色）一并回写。

## 6. Overlay 与工程闭环

- `harness-overlay.mjs capture` 已回写；`upstream-changes.patch` 补录
  vendor lockfile 中 `@physicsos/engine-circuit`、`@physicsos/physics-units`
  两条 workspace link（`e00f8d3` 给 ui-physicsos 加依赖后遗漏的捕获）。
- 调试探针脚本 `probe-circuit-tab.mjs`（CASE A 的临时子集）删除，不入库。

## 7. 验收数据

- `typecheck:core` / `typecheck:web` 零错误；`lint:core` / `lint:web` 零违规。
- `test:core` 全绿：20 包 655 项（新增 engine-circuit 24、
  physics-scene 50 含 circuit-scene-runtime 契约测试）。
- `test:web` 全绿：19 文件 235 项（新增 `circuit.client.spec.tsx` 10 项：
  域路由、串联教科书解、开关断路命令、滑变扫描、EMF 直读、命令重解、
  原理图挂载、EMF 编辑 revision 审计、开关联动、滑变时间轴 + 三图表）。
- `build:web`（bundle）通过。
- 浏览器验收：`circuit-acceptance.mjs` 全 PASS + 七套老 acceptance 回归
  全 PASS，门禁计数器全 0。

## 8. 不做（明确边界）

- **交流 / 瞬态**（RC/RL 充放电、电容器、电感器）：`canHandle` 显式拒识
  reactive 元件，不静默近似。
- **多电源网络**：MNA 本身支持，但高中动态电路以单源为纲，`canHandle`
  当前锁单源；Induction（Phase 14）需要时再解锁。
- **Question Space 电路题**（确定性 parser + golden questions + 题目 →
  Lab）与 **Agent 电路教学意图**：属下一切片，本轮实验室先行。
- **自由搭建电路**（拖拽连线自建拓扑）：模板电路 + 参数/开关/滑片交互
  已覆盖 Phase 13 验收范围；编辑器属独立产品能力。
- **电磁感应导轨**（Phase 14 第四验收链）：依赖本轮 Circuit，下一阶段。

## 9. 风险与已知问题

- 无阻塞问题。lefthook postinstall 卡 pnpm 依赖校验的既有环境问题依旧，
  验证时绕过（直接跑 vitest / 各 gate 脚本），不影响产物。
- 理想电压表以高阻支路建模（非对称消元的数值路径），断路读数靠
  `NO_CURRENT_AMPS` 阈值归零展示；`ideal_meters_non_intrusive` 校验
  钉住「理想表不改变工作点」这一物理事实。
