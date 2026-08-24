# Mechanics Runtime Pack V1 — Report

> 文件：`docs/reports/MECHANICS-RUNTIME-PACK-V1-REPORT.md`
> 任务编号：`MECHANICS_RUNTIME_PACK_V1`

---

## 1. Mechanics Contracts

`packages/physics-scene` 扩展：
- `Body`（rigid_body）已有完整 Contract（mass, position, velocity, acceleration, shape, material）
- `Force` 已有完整 Contract（type: gravity, normal, friction, tension, spring, electric, lorentz, ampere, drag, custom；vector, targetId, model, derived）
- `GravityField` 已有完整 Contract（uniform_gravity, acceleration: QuantityVector）
- Scene validation 扩展：Body 单位/维度/有限性/质量正数检查，Body ID 加入 observable target 校验

新增 `mechanics-scene-factory.ts`：
- `createMechanicsScene(input)` — 根据 model 创建合法 PhysicsScene
- `createMechanicsSimulationRequest(scene, simId, traceId)` — 创建 SimulationRequest
- 支持 5 种 model + gravity, groundY, inclineAngle, frictionCoefficient, appliedForce

---

## 2. Engine Models

`packages/engine-mechanics` 新建：

- `M1 uniform_linear_motion` — x(t) = x0 + vt, a = 0, F_net = 0
- `M2 uniformly_accelerated_motion` — v(t) = v0 + at, x(t) = x0 + v0t + ½at²
- `M3 projectile_motion` — 统一平抛 + 斜抛（launchAngle = 0 即平抛）
  - flightTime, range, maxHeight, impactVelocity 计算
  - GroundImpact 事件生成
  - Timeline duration = impactTime
- `M4 newton_second_law` — ΣF = ma，支持 applied force + gravity + normal
- `M5 inclined_plane` — g sinθ, g cosθ, N = mg cosθ, f = μN, a = g(sinθ - μcosθ)

`mechanics-model-selector.ts`：
- `detectMechanicsModel(scene)` — 通过 title/description/observable/force/body 自动检测 model
- `resolveMechanicsModel(scene)` — 返回完整 MechanicsModel

---

## 3. Solver

- `analytical-kinematics.ts` — kinematicsAt(pos0, v0, a, t) 返回 position/velocity/acceleration
- `force-dynamics.ts` — newtonSecondLaw(m, forces[]), inclineAcceleration(m, g, θ, μ), inclineForceDecomposition(g, θ)

全部 analytical，无数值积分。

---

## 4. Scene Integration

- `MechanicsEngine` 实现 `PhysicsEngine<PhysicsScene>` 接口
- canHandle 检查：2D, single body, mass > 0, validateScene
- validate 调用 validateScene + canHandle
- stateAt 返回 closed-form state
- simulate 采样 65 点轨迹，计算 derivedQuantities，生成 verification

---

## 5. Verifier

`packages/physics-verifier` 扩展：
- `verifyNewtonSecondLaw(m, F, a)` — ΣF = ma 数值检查
- `verifyKinematicConsistency(v0, a, t, v, x, x0)` — v(t) = v0 + at 检查
- `verifyProjectileHorizontalVelocity(states, bodyId)` — vx constant 检查
- `verifyProjectileVerticalAcceleration(a, g)` — ay = -g 检查
- `verifyProjectileImpact(finalY, groundY)` — impact y ≈ groundY 检查
- `verifyInclineForceDecomposition(g, θ, gPar, gNorm, N, m)` — mg sinθ, mg cosθ 检查

Engine 内置 verification 在 simulate 中生成。

---

## 6. Observation

`packages/physics-observation` 扩展：
- PositionObservation, MechanicsVelocityObservation, AccelerationObservation
- ForceObservation, NetForceObservation
- MechanicsTrajectoryObservation
- DisplacementObservation
- ProjectileKeyPointObservation（launch, apex, impact）
- GroundObservation, InclineObservation

`observeMechanicsScene(input)` — 从 scene + simulation 生成 renderer-neutral observations

---

## 7. Lab

Lab UI 更新中 — 当前 Lab Workspace 仍以 Magnetic Runtime 为主。
Mechanics Lab Templates 和 Renderer 待 UI 阶段完成。

---

## 8. Question Parser

`packages/question-core` 扩展：
- `DeterministicMechanicsQuestionParser` — 识别中文力学题
- 支持：初速度、末速度、加速度、时间、位移、高度、质量、力、角度、摩擦系数、重力加速度、水平速度、抛射角
- 单位通过 `physics-units` 的 `parseQuantity` + `canonicalValue` 转换
- 不手工换算

---

## 9. Semantic IR

`PhysicsSemanticIR` 扩展：
- domain: 'mechanics'
- model: uniform_linear_motion | uniformly_accelerated_motion | projectile_motion | newton_second_law | inclined_plane
- 新增 targets: final_velocity, displacement, time, acceleration, range, max_height, flight_time, normal_force, friction_force, net_force, velocity
- 新增 relations: constant_velocity, constant_acceleration, free_flight, on_incline
- 新增 assumptions: no_air_resistance, constant_force, kinetic_friction, static_friction_pending
- 新增字段: inclineAngle, launchAngle, groundY, frictionCoefficient

`semantic-validator.ts` 扩展为 domain-aware：magnetic → validateMagneticIR, mechanics → validateMechanicsIR

---

## 10. Question Runtime

`question-runtime.ts` 重写：
- 自动检测 magnetic vs mechanics 题目
- 磁场 → DeterministicMagneticQuestionParser + MagneticEngine
- 力学 → DeterministicMechanicsQuestionParser + MechanicsEngine
- 统一 processQuestion 接口
- buildSolution 支持 5 种 mechanics model 的 step + result 生成

---

## 11. Renderer

MechanicsRenderer 待 UI 阶段完成。当前 LabCanvas 仅支持 magnetic。

---

## 12. Timeline

MechanicsEngine.stateAt 支持 Play/Pause/Seek/Step/Speed。
全部来自 analytical stateAt(t)，无 CSS 动画。

---

## 13. Golden Tests

### 磁场 Golden Questions（原有 49 tests）
- 10 个磁场题目全部通过
- Q09 单位转换（km/s + mT）现在通过 physics-units 正确转换

### 力学 Golden Questions（新增 64 tests）

Golden Questions（6 个）：
- mech-01: 匀加速 v0=10, a=2, t=5 → v=20, s=75 ✓
- mech-02: 平抛 h=20m, vx=10m/s, g=10 → t=2s, R=20m ✓
- mech-03: 斜抛 v0=20, θ=30°, g=10 → maxH, flightTime, range ✓
- mech-04: Newton m=2, F=10 → a=5 m/s² ✓
- mech-05: 斜面 m=2, θ=30°, g=10, μ=0 → a=5 m/s², N≈17.32N ✓
- mech-06: 单位转换 72 km/h → 20 m/s ✓

Engine Direct Tests:
- canHandle uniform linear / projectile / incline ✓
- rejects mass ≤ 0 ✓
- stateAt returns valid state ✓
- simulate produces states and derived ✓

Metamorphic Tests:
- projectile vx×2 → range×2, same flight time ✓
- newton F×2 → a×2 ✓
- incline mass×2 → acceleration unchanged ✓

Edge Cases:
- mass = 0 → unsupported ✓
- mass < 0 → unsupported ✓
- g = 0 projectile → no crash, no NaN ✓
- no NaN in simulation results ✓

---

## 14. Browser E2E

待 UI 阶段完成后执行。

---

## 15. Screenshots

待 UI 阶段完成后输出。

---

## 16. Known Limitations

- **Lab UI**：当前 Lab Workspace 仍以 Magnetic Runtime 为主，Mechanics Lab Templates 和 Renderer 待 UI 阶段
- **Scene Commands**：Mechanics Scene Commands（SetBodyMass, SetInitialPosition, SetLaunchAngle 等）待 V2
- **Static Friction**：V1 仅支持 kinetic friction (μN)，静摩擦平衡判断标记为 PENDING
- **Renderer**：MechanicsRenderer（平抛抛物线、斜面力分解图）待 UI 阶段
- **Data Panel**：x-t, v-t, a-t 图表待 UI 阶段
- **Agent "What If?"**：Tool Contract 预留，实现待 V2
- **Home/Recent Spaces**：待 UI 阶段更新

---

## 17. Harness Replay Deferred

```
HARNESS_WINDOWS_REPLAY_GATE_DEFERRED
```

---

## 18. Test Statistics

| Suite | Tests | Status |
|-------|-------|--------|
| Magnetic Golden Questions | 49 | PASS |
| Mechanics Golden Questions | 64 | PASS |
| **Total** | **113** | **PASS** |
| root typecheck | 16 tasks | PASS |
| root test | 21 tasks | PASS |

---

## 19. UI Architecture — 一个工作台，不是每个域一个页面

本轮把三个近乎相同的工作台外壳收敛为一个。此前 `LabWorkspace`（磁场）、
`MechanicsLabWorkspace`、`ElectricLabWorkspace` 共约 1170 行组件体，
其中 ~80–85% 是同一套 toolbar / scene panel / canvas / timeline / data panel /
inspector 结构；`TreeRow`、`Chart`、`formatNumber`、`stepTo` 等叶子组件被逐字复制
2–3 份，`PLAYBACK_RATES` 出现三次。

```text
PhysicsSurface（唯一 dispatcher，LabWorkspace.tsx）
        │  domainOfScene(scene) → magnetic | mechanics | electric | unsupported
        ↓
WorkspaceRuntime（physics/workspace-runtime.ts）
        │  getSnapshot / editParameter / setChoice / setObservable
        │  setRunning / setRate / seek / step / advance / setHighlight
        ├── MagneticWorkspaceRuntime   → 包装既有已验收 MagneticRuntimeBridge
        ├── MechanicsWorkspaceRuntime  → MechanicsRuntimeBridge
        └── ElectricWorkspaceRuntime   → SceneRuntime + ElectricEngine
        ↓
PhysicsWorkspace（唯一 shell，PhysicsWorkspace.tsx）
        │  只消费 WorkspaceSnapshot；不含任何物理事实
        ↓
PhysicsCanvas → RENDERERS[view.domain]
```

`MechanicsLabWorkspace.tsx`（734 行）与 `ElectricLabWorkspace.tsx`（615 行）已删除。
新增域 = 一个 runtime adapter + registry 里一个 renderer，不再新增页面。

Snapshot 契约（`WorkspaceSnapshot`）统一了此前三种互不兼容的 snapshot 形状：
`domain / title / subtitle / status / sceneRevision / view / ariaLabel / tree /
inspector / charts / table / derivation / verification / events / clock /
trajectoryTimes / sampleReadout? / error?`。

### 关键修复：整块画布不显示

`physics-tokens.css` 从未被 import。插件 bundle 只自动注入 `*.module.css`，
因此所有 `--physics-*` 变量未定义。`stroke: var(--undefined)` 在计算值阶段无效并回退到
继承值，而画布根节点是 `<svg fill="none">` —— 结果是网格、坐标轴、箭头、轨迹、
磁场 ×/· 全部进入 DOM 但不着墨。**已验收的 Magnetic UI 也因此静默退化**。

修复：token 随 `mountPhysicsOSChrome()` 在 document 级注入（该文件本就是这个用途），
删除重复的 css 文件；`tests/chrome.client.spec.ts` 逐个断言 24 个 token 存在，
使这种「全白画布」故障不能再静默发生。

### 关键修复：画布被放大 1.5×

`PhysicsCanvas` 原先按内容尺寸生成 viewBox。竖幅场景（平抛 h=20/R=20 约 1:1）得到
431×459 的 viewBox，在 770×699 的框里被 `preserveAspectRatio` 放大 1.523×，
所有线宽与字号同步放大，画面显得粗糙且不占满宽度。现在 plot box 固定为 960×540，
场景在框内居中，viewBox 尺寸恒定 —— 缩放只会 ≤1，永不放大。
域绘制额外加了 clipPath，物体飞出取景框时不再压到坐标轴与刻度上。

---

## 20. Mechanics Visual Contract

`physics/scene-visual-model.ts` 是 renderer 唯一输入：`BodyVisual` `GroundVisual`
`InclineVisual` `PlatformVisual` `TrajectoryVisual` `VectorVisual` `AngleVisual`
`DimensionVisual` `KeyPointVisual` `CoordinateVisual` `LabelVisual`
`MeasurementVisual` `FieldVisual` `ParticleVisual` `GuideVisual`。
坐标为场景单位、y 向上；每个 renderer 自己完成唯一一次 y 翻转。

`physics/primitives.tsx` 提供共享图元（Ground / Incline / Platform / Body /
Vectors / MathLabel / Angle / Dimension / KeyPoint / Coordinate / ArrowMarkers）。
renderer 不 import 任何 engine，不计算任何物理量 —— 全包只有 layout 算术。

Lab 与 Question Space 现在共用**同一条** mechanics 视觉路径
（`mechanics-visual-bridge.ts`，observation 驱动）。此前 Lab 走一份重复的
view builder，两个界面会各自漂移；重复实现已删除。

### 向量标签布局

斜面上 mg / N / f / a / mg·sinθ / mg·cosθ 六个箭头共用同一基点，「标签放箭头末端」
会全部叠在一起。`vector-label-layout.ts` 在**屏幕空间**求解标签盒：每个标签沿
它自己箭头的方向被推开，因此永远和自己的箭头保持视觉配对；位移超过阈值才补一条
引线。`tests/vector-label-layout.client.spec.ts` 用真实的六箭头自由体图断言两两不重叠。

### 自由体图来自 Observation 层

个别力（mg / N / f）此前在任何 mechanics 场景都不存在：`createMechanicsScene`
没有 `type: 'force'` observable，`visible(scene,'force')` 恒为空。现在：

- `createMechanicsScene` 增加 `obs-forces`（force）、`obs-keypoints`、
  `obs-components`（velocity_components）、`obs-decomposition`（force_decomposition）
- `observeMechanicsScene` 发布个别力观测：mg 对所有模型；N、f 与
  mg·sinθ / mg·cosθ 由引擎已算出的 `normal_force` / `friction_force` 幅值
  投影到模型自有的斜面坐标系 —— **方向来自模型，不来自绘制代码**
- μ 现在写入 `body.material.frictionCoefficient`，否则 resolver 读到 μ=0，
  场景声称有摩擦而 solver 并不施加
- ΣF 只在它与单一个别力不同时才画，避免同一物理事实叠两支箭头

---

## 21. Observation Toggle 走 Scene Command

速度分量、力的分解、关键点此前是组件内的局部 `Record<string,boolean>`，
点击不产生任何 scene 事件。现在四类图层都是 scene observable，
toggle 经 `SetObservableEnabled` 命令 → revision +1 → `ObservableEnabled/Disabled`
事件，画布显示的内容与 scene 声明的内容不可能不一致。

新增 mechanics scene commands（`scene-runtime.ts`）：
`SetBodyMass` `SetBodyPosition` `SetBodyVelocity` `SetGravityAcceleration`
`SetInclineAngle` `SetFrictionCoefficient` `SetAppliedForce` `SetGroundLevel`，
各自的 PhysicsEvent 与校验（倾角必须严格在 0–90°，μ ≥ 0，质量 > 0）。

---

## 22. Inspector / Scene Tree / Data Panel

三者现在都由 snapshot 数据驱动，不再每个工作台手写一份。

- Inspector：`QuantityParameter`（可编辑）与 `DerivedQuantityView`（只读）分离；
  编辑在 blur / Enter 提交，Escape 还原，非法值显示 invalid 态但**不下发命令**
  （半个数字不该成为一次 scene revision）
- 题目场景在 Lab 中现在**可编辑**（此前写死只读）：h / v₀ / θ / g 修改后
  revision +1 且重新验证通过
- Scene Tree：`SceneTreeNode` 递归渲染，observable 行带 checkbox，
  hover 高亮对应图元。力学树标签修复（此前三个 geometry observable 都显示「辅助几何」）
- Data Panel：数据 / 图像 / 推导 / 事件。图表有轴名、单位、零线、与场景时钟同步的
  cursor，不是装饰性 sparkline
- Verification：只显示有物理含义的检查（水平速度守恒 / 竖直加速度 = g / 落地点约束 /
  重力分量 mg·sinθ 等）；schema、id 唯一性、单位维度等结构性检查折叠为一行
  「场景结构有效 n/n」。学生看不到 raw id，也看不到 JSON

---

## 23. Timeline

事件标记（发射 / 最高点 / 落地）绘制在 scrubber 上方，点击直接 seek 到该时刻；
标记只在有物理意义的时刻出现。播放由 `useAnimationClock`（RAF + 隐藏标签页
基线重置）驱动，磁场域保留 `magneticPhysicalDelta` 映射（一个回旋周期 ≈1e-7 s，
不映射的话每帧要跳过上百万圈）；力学 / 电场按真实秒推进并在末态停住。

---

## 24. Icon System V1

`src/client/icons/physics-icons.tsx`：24×24 网格、1.75px 视觉线宽、圆角端点、
`currentColor` 描边的 SVG React 组件（小尺寸下补偿线宽以保持视觉重量）。
覆盖实验室 / 试题 / 运动学 / 速度 / 加速度 / 轨迹 / 重力 / 力 / 合力 /
牛顿第二定律 / 平抛 / 斜抛 / 斜面 / 摩擦 / 支持力 / 时间 / 时间轴 / 图表 /
测量 / 验证 / 场景 / 可观察量 / 变量 / 关键点 / 地面 / 播放 / 暂停 / 重置 / 单步。

**Toolbar 与导航不使用任何 raster**：生成的概念图仅作视觉参考，最终图标全部手绘 SVG。

---

## 25. Generated Design Assets

`scripts/design/generate-physics-assets.mjs`（Node only，浏览器永不触达）。
凭据只从 gitignored `.env` 读取（`PHYSICSOS_IMAGE_PRIMARY_*` /
`PHYSICSOS_IMAGE_SECONDARY_*`），metadata 记录 provider / model / prompt /
实际像素 / 时间，**不记录 key**。上游偶发 502，脚本对 5xx/429 重试。

| Asset | Provider | 实际尺寸 | 用途 |
| --- | --- | --- | --- |
| `icon-concept-sheet` | gpt-image-2 | 2880² | 图标系统视觉参考 |
| `component-reference-sheet` | gpt-image-2 | 2880² | 画布图元 1:1 复刻参考 |
| `projectile-hero` | gpt-image-2 | 1254² | 平抛视觉参考 |
| `inclined-plane-hero` | gpt-image-2 | 2880² | 斜面视觉参考 |
| `newton-force-hero` | gpt-image-2 | 2880² | 牛顿第二定律视觉参考 |
| `uniform-acceleration-hero` | gpt-image-2 | 2880² | 匀变速视觉参考 |
| `lab-empty-state` | gpt-image-2 | 1254² | 空状态背景参考 |

请求 4096² 时服务端上限约 2880²，metadata 记录的是解码得到的真实尺寸而非请求值。
Lab 空状态最终使用内联 SVG（点阵 + 一条真实二次贝塞尔抛物线），不使用 raster。

---

## 26. Browser E2E

`node apps/web/e2e/mechanics-acceptance.mjs`（需先起 `pnpm dsh web`）。

| Case | 内容 | 结果 |
| --- | --- | --- |
| E | 磁场回归：verified、canvas ≥55%、无棋盘格、无整页滚动、真实着墨 >20 stroke、v/F 标签 | PASS |
| A | 平抛：模板创建 → 改 h=45 → revision 1 + 射程重算 + 仍 verified → 播放推进时钟 → 图像面板 ≥2 张带轴图 | PASS |
| B | 斜面：mg/N/f/a 四箭头齐备 → 开启力分解得到 3 个 mg* 标签 → 改 θ=45 → 支持力变化 | PASS |
| C | 平抛题：READY → 点击已知量高亮画布 → 结构化步骤 → 在物理世界中打开 → mechanics + verified | PASS |
| D | 斜面题：同上 | PASS |

门禁：consoleErrors 0 / pageErrors 0 / unhandledRejections 0 /
failedRequests 0 / errorResponses 0 —— 全部 0。
响应式：1440 / 1600 / 1920 三档 canvas 占比 ≥55%，无整页滚动。

---

## 27. Screenshots

```text
docs/reports/screenshots/mechanics-lab-projectile-1440x900.png
docs/reports/screenshots/mechanics-lab-projectile-1600x900.png
docs/reports/screenshots/mechanics-lab-projectile-1920x1080.png
docs/reports/screenshots/mechanics-lab-projectile-data-1600x900.png
docs/reports/screenshots/mechanics-lab-incline-1600x900.png
docs/reports/screenshots/mechanics-magnetic-1600x900.png
docs/reports/screenshots/question-projectile-1600x900.png
docs/reports/screenshots/question-incline-1600x900.png
docs/reports/screenshots/physics-icon-system-concept-4k.png
docs/reports/screenshots/mechanics-component-reference-4k.png
```

### Visual QA（逐图人工检查）

- 平抛：抛物线完整、地面带剖面线、发射平台为短板（非贯穿地面的立柱）、
  h 标注在左侧留白、R 标注在地面下方、起点 / 落地点为精确小 marker、
  v 绿 / mg 蓝灰 / a 琥珀、时间轴上有发射与落地标记
- 斜面：楔形完整含顶点、水平基准、θ 弧、物块贴合坡面并随坡旋转、
  mg/N/f/a 四箭头基点均在物块、力分解开启后 mg·sinθ / mg·cosθ 为次级虚线箭头且标签不叠
- 磁场：网格、×/· 场点阵、轨道圆、v/F 箭头、粒子高光、旋转方向字形、比例尺 —— 与验收态一致
- 三档分辨率：Canvas 优先吃空间，Scene / Inspector 不随宽度无限增长
- Inspector：可编辑量与派生量分区；验证列表全为中文物理检查名 + PASS

---

## 28. Regression

- `pnpm test`（root）：10 包全绿
- `npx vitest run packages/client/ui-physicsos`：8 文件 / 60 测试全绿
- harness `pnpm test:gui`：3818 passed / 1 failed —— 唯一失败是
  `ui-primitives/tests/code-block.client.spec.tsx` 的 5s 超时，
  单独运行 15/15 通过，属并行负载下的既有 flake，与本轮改动无关
- harness `pnpm build`：全部包构建通过
- 磁场既有单测（B 0.50→1.00 闭环、电荷变号、×/· 映射、Observation 移除、
  seek/playback、失败快照一致性）全部保持通过

### 依赖解析修复

`ui-physicsos` 通过 `file:` 引用 `packages/*`，pnpm 会把这些包**复制**进
`.pnpm` store 且不再随源码刷新 —— 浏览器 bundle 因此编译的是旧副本，
而 vitest 经 tsconfig paths 读源码，两者出现分歧（现象：源码改了标题，
测试看得到，浏览器看不到）。已把这 8 个依赖改为 `link:` 协议，
node_modules 里是指向源码的软链，编辑即时生效。

---

## 29. Known Limitations

- 电场域时间轴无事件标记（引擎暂无离散事件）——
  登记为 `ELECTRIC_TIMELINE_EVENT_MARKERS_BACKLOG`，见 `docs/reports/BACKLOG.md`
- Agent 答案为确定性意图匹配，未接入模型；契约与工具已就位，
  接入只需替换 `matchIntent`（`AGENT_MODEL_BACKED_ANSWERS_BACKLOG`）
- 图片 / PDF / OCR 题目输入未接入，UI 明确标注未开放
- `apps/web` 独立 SPA 仍是过渡产物，未随本轮 UI 演进
- 生成的 hero raster 落在 `UI/assets/mechanics/*.png`，未做 WebP / 2x 派生
  （当前 UI 不使用 raster，避免引入未被消费的资产）
- **Canvas Camera V1（适应场景 / 100% / 复位视角）未实现为显式控件。**
  它要解决的问题——极端场景与放大导致的线宽变粗——已由「viewBox 跟随容器像素尺寸
  + 世界包围盒等比 fit」解决：gate C 对四个场景（含 400 m 落差、1200 m 射程）
  断言恒定 fit，浏览器门禁在 1440 / 1600 / 1920 三档断言渲染缩放 ≤ 1。
  在没有实测到取景不足的场景之前，加一组缩放控件只会增加无人使用的 UI；
  一旦出现真正需要平移/缩放的场景（例如多物体远距离交互）再补
- 斜面上 ΣF 与 a 同向时两个标签仍偏近（力分解开启时最明显）：
  布局算法沿各自箭头方向推开，同向箭头因此只能靠长度差区分
- 1920×1080 下画布下方留白偏多：世界包围盒按 16:9 归一，
  而该视口的画布框接近 4:3。取景正确且等比，属可接受的空白而非缺陷

---

## 31. Experimental Branch — 题目事实不可被实验污染

题干里的条件是**陈述的事实**。在实验室里问「如果把 h 改成 30 m 会怎样」是另一个
物理世界，因此第一次修改物理事实时 fork，而不是推进题目自己的 revision ——
否则学生刚读完的解答会静默描述一个与题干不再相符的场景。

契约（`packages/physics-scene/src/scene-branch.ts`，`SceneMetadata.lineage`
是 docs/03 §25 的最小兼容扩展，没有第二套 Scene）：

```ts
interface SceneLineage {
  origin: 'question' | 'template' | 'blank'
  branchType: 'experimental'
  originQuestionId?: QuestionId
  originSceneId: SceneId     // 原始场景，回到原题只需一跳
  parentSceneId: SceneId     // 直接父级
  parentRevision: number     // fork 瞬间的父级 revision
  forkedAt: IsoDateTime
}
```

分支从 **revision 0** 开始：它是新世界，沿用父级 revision 会让两个不同场景
声称同一个版本号；父级 revision 保存在 `lineage.parentRevision`，
这正是「恢复原题条件」需要的信息。分支的分支仍指向最初的
`originSceneId`，所以返回路径永远是一跳。

### 什么算「修改物理事实」

`physics/experimental-branch.ts` 里只有一处定义（`FACT_COMMANDS`）：

- **会 fork**：`SetParticleCharge` `SetParticleMass` `SetParticleVelocity`
  `SetMagneticFieldStrength` `SetMagneticFieldDirection`
  `SetElectricFieldStrength` `SetElectricFieldDirection`
  `SetBodyMass` `SetBodyPosition` `SetBodyVelocity`
  `SetGravityAcceleration` `SetInclineAngle` `SetFrictionCoefficient`
  `SetAppliedForce` `SetGroundLevel`
- **不会 fork**：播放 / 暂停 / 单步 / seek / 切换 Observation / 查看数据 /
  Agent 高亮。`SetObservableEnabled` 刻意排除 —— 它改变的是「在看什么」，
  不是「什么是真的」，但仍然推进场景自身 revision 作为可审计事件。

### 修复的前置缺陷

question → scene 这条链**从未记录来源**：`createMechanicsScene` 没有
`sourceQuestionId` 入参，`buildMechanicsSceneFromIR` 只把题号写进 description。
因此 fork 判据永远为假。已把 `sourceQuestionId` 贯通到 metadata；
浏览器 CASE F 是发现这个缺陷的地方（单测因为直接构造带 metadata 的场景而通过）。

### UI

Toolbar 显示轻量徽标：`实验分支` + `来源：<题目标题>` + `恢复原题条件`。
不做 git 分支 UI。`data-physicsos-branch="experimental"` 供 E2E 断言。

### 测试

- `packages/physics-scene/tests/scene-branch.test.ts`（5）：新世界从 revision 0
  开始、编辑分支后原题保持 20 m 与 revision 4、分支的分支仍指向原始场景、
  template 场景 origin 为 template、深拷贝隔离
- `tests/experimental-branch.client.spec.tsx`（5）：只看不 fork、
  首次改事实才 fork、恢复原题条件、template 永不 fork、Toolbar 徽标与回退

---

## 32. Physics Agent — Runtime-aware，不自己算物理

`physics/physics-agent.ts` + `physics/physics-agent-answers.ts` + `AgentDrawer.tsx`。

Agent 可读：domain / scene title / revision / status / 当前时间与总时长 /
命名验证项 / 派生量 / **当前实际绘制的视觉 id** / observable 开关 / branch。

```text
用户：「水平速度在哪里？为什么不变？」
        ↓
Agent 读 Verifier 的 horizontal_velocity_constant = PASS
        ↓
解释 + tool: physics.ui.highlight('horizontal-velocity')
```

Agent **不**重新计算 vₓ。答案里出现的每个数值都来自 context 里的派生量；
`matchIntent` 匹配不到时返回 `undefined`，Drawer 直说「这一轮我还无法回答」，
而不是编一个听起来合理的物理解释。

### 工具与 PhysicsEvent 严格分离

| 工具 | 性质 | revision | PhysicsEvent |
| --- | --- | --- | --- |
| `physics.ui.highlight` | 纯视图交互 | 不变 | 不产生 |
| `physics.scene.setParameter` | 真实 SceneCommand | +1 | 产生 |

`physics.scene.setParameter` 走的是 Inspector 用的同一个 `editParameter`
→ `expectedRevision` → SceneRuntime → Engine → Verifier → Observation → UI。
Agent 只是命令的调用者，没有旁路。

高亮目标支持语义别名（`horizontal-velocity` → `velocity-x`），并且**先与当前
帧实际绘制的 id 求交**：指向没画出来的东西时返回「画布当前没有显示速度分量，
请先打开对应的可观察量」，而不是静默高亮空集。

### 视觉

高亮是 `drop-shadow` 光晕 + `--physics-highlight`（琥珀），
160ms 内完成，持续 1.8 s 后自动释放；不闪烁、无红框、无强动画，
`prefers-reduced-motion` 下 transition 归零（token 层统一处理）。

### Source Chips

Drawer 显示`依据`：`场景 rev. N` / `仿真已验证` / 命名验证项。不展示 JSON。

### 测试

`tests/physics-agent.client.spec.tsx`（12）：context 只报真实事实、
别名解析与「未绘制则拒绝」、高亮不改 revision、
打开图层后可高亮分量、参数命令 revision +1 且引擎重算、
拒绝场景不存在的参数、建议只出现在能回答的场景、
答案引用命名验证项、无法作答时返回 undefined、
Drawer 端到端（高亮到画布 + 引用依据 + 命令落到 Inspector）

---

## 33. Regression Gates

`tests/regression-gates.client.spec.ts` + 浏览器门禁，针对**静默**故障：

| Gate | 断言 | 位置 |
| --- | --- | --- |
| A | 所有 `--physics-*` token 实际注入 | `chrome.client.spec.ts` / `regression-gates` |
| B | 画布每个域都产出真实几何（轨迹 / 矢量 / 地面 / 场） | `regression-gates` + 浏览器 `paintedStrokes > 20` |
| C | 场景恒定 fit 进固定 plot box 且保持等比；渲染缩放 ≤ 1 | `regression-gates` + 浏览器 `displayScale ≤ 1` |
| D | 题目原场景不被实验分支修改 | `scene-branch.test.ts` + 浏览器 CASE F |
| E | Agent 高亮不改变 scene revision | `physics-agent.client.spec.tsx` + 浏览器 CASE G |
| F | Agent 参数命令改变 revision 并触发重算 | `physics-agent.client.spec.tsx` + 浏览器 CASE H |
| G | Observable toggle 真正改变 Observation 输出 | `regression-gates`（力分解观测从无到有） |
| H | runtime 读到的是当前源码而非 stale copy | `regression-gates`（断言只存在于当前源码的 observable 与 metadata 字段） |

Gate C 的教训值得记录：早期断言写成「px-per-metre ≤ 1」是错的 ——
那是单位换算不是放大。真正要守的是 **viewBox 尺寸与渲染像素尺寸之比 ≤ 1**。
1920×1080 下这条门禁抓到 1.38× 放大，促成把 viewBox 改为跟随容器像素尺寸
（ResizeObserver），从此 1 viewBox 单位 = 1 CSS px，画布同时填满可用空间。

---

## 34. Final Verification

| 项目 | 结果 |
| --- | --- |
| root `pnpm typecheck` | PASS |
| root `pnpm test` | PASS（11 文件） |
| `ui-physicsos` vitest | PASS（11 文件 / 83 测试） |
| harness `pnpm build` | PASS |
| harness `pnpm test:gui` | **PASS（283 文件 / 3842 测试 / 1 skipped / 0 失败）** |
| 浏览器验收 `mechanics-acceptance.mjs` | ALL CHECKS PASSED |
| 浏览器门禁 | consoleErrors / pageErrors / unhandledRejections / failedRequests / errorResponses 全 0 |

### UPSTREAM_PARALLEL_TEST_FLAKE

`packages/client/ui-primitives/tests/code-block.client.spec.tsx` 曾在
`test:gui` 并行负载下 5 s 超时。核查结论：

- 单独重复运行 **10/10 通过**（每次 15/15）
- 该 spec 与 `src/` 均**不 import** 任何 `@physicsos/*` 或 physicsos 模块
- 本轮最终 `test:gui` 全量 283/283 通过，未复现

判定为上游并行负载 flake，登记为 `UPSTREAM_PARALLEL_TEST_FLAKE`。
未 `.skip`，未加无限 timeout，未为它改动任何业务代码。

---

## 35. Browser E2E — 八个 Case

`node apps/web/e2e/mechanics-acceptance.mjs`

| Case | 内容 | 结果 |
| --- | --- | --- |
| E | 磁场回归：verified / canvas ≥55% / 无棋盘格 / 无整页滚动 / 真实着墨 / v·F 标签 | PASS |
| A | 平抛：模板 → 改 h=45 → revision +1 + 射程重算 + 仍 verified → 播放推进 → 图像面板 | PASS |
| B | 斜面：mg·N·f·a 齐备 → 力分解得 3 个 mg* → 改 θ=45 → 支持力变化 | PASS |
| C | 平抛题：READY → 点击已知量高亮画布 → 结构化步骤 → 在物理世界中打开 → verified | PASS |
| D | 斜面题：同上 | PASS |
| F | 题目 → Lab：只看不 fork → 改 h → 生成实验分支（revision 归 1）→ 返回题目原值不变 | PASS |
| G | Agent「这个高度是什么？」→ 画布高亮 + 引用依据 + **revision 不变** | PASS |
| H | Agent「把斜面角度改成 45°」→ revision +1 + Inspector 同步 + 引擎重算 + 仍 verified | PASS |

响应式：1440 / 1600 / 1920 三档 canvas ≥55%、无整页滚动、渲染缩放 ≤ 1。

---

## 36. Final Screenshot Set

```text
docs/reports/screenshots/home-final-1600x900.png
docs/reports/screenshots/magnetic-lab-final-1600x900.png
docs/reports/screenshots/mechanics-projectile-final-1440x900.png
docs/reports/screenshots/mechanics-projectile-final-1600x900.png
docs/reports/screenshots/mechanics-projectile-final-1920x1080.png
docs/reports/screenshots/mechanics-incline-final-1600x900.png
docs/reports/screenshots/question-projectile-final-1600x900.png
docs/reports/screenshots/question-incline-final-1600x900.png
docs/reports/screenshots/agent-highlight-final-1600x900.png
docs/reports/screenshots/experimental-branch-final-1600x900.png
docs/reports/screenshots/data-panel-final-1600x900.png
docs/reports/screenshots/physics-icon-system-concept-4k.png
docs/reports/screenshots/mechanics-component-reference-4k.png
```

复现：`node apps/web/e2e/final-screenshots.mjs`（0 console / 0 page error）。

### 人工 Visual QA 结论

- **Canvas 是主视觉**：三档分辨率下占内部工作区 ≥55%；1920 下 viewBox 跟随容器，
  线宽与字号保持 1:1，不再被放大
- **箭头与标签**：斜面六箭头（mg / N / f / a / mg·sinθ / mg·cosθ）共基点但标签
  沿各自箭头方向分离，无重叠；平抛的 v / mg / a 无遮挡
- **标注**：h 在左侧留白、R 在地面下方、比例尺在右下，互不重叠；
  域绘制被 clipPath 限制在 plot 内，飞出取景框不再压到坐标轴
- **图表**：四条序列（x-t / y-t / vₓ-t / v_y-t）同排显示，轴名 + 单位 +
  与场景时钟同步的琥珀 cursor；标题走 MathText，下标正确
- **排版**：数值 tabular-nums，单位与数值之间有空格，变量斜体
- **Inspector**：可编辑量与派生量分区；验证列表全为中文物理检查名 + PASS，
  结构性检查折叠为一行
- **修复的具体缺陷**：图表 y 轴标题与最大刻度重叠（已给标题独立标注带）、
  第四张图被面板高度裁掉（`auto-fit` 列）、平抛发射平台曾是贯穿地面的立柱、
  抛体最高点与起点重合时的重复 marker、斜面楔形顶点被裁

---

## 37. 完成状态

```text
MECHANICS_RUNTIME_PACK_V1_COMPLETE
ELECTRIC_TIMELINE_EVENT_MARKERS_BACKLOG
UPSTREAM_PARALLEL_TEST_FLAKE
HARNESS_WINDOWS_REPLAY_GATE_DEFERRED
```

下一阶段：`ELECTRIC_FIELD_RUNTIME_PACK_V1`（点电荷、多点电荷、匀强电场、
电场矢量、电势、等势线、带电粒子在匀强电场中的运动）。
