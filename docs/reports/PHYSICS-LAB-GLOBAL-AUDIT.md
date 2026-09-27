# PhysicsOS 物理实验室 · 全量审计报告

> 日期：2026-09-28
> 状态：`PHYSICS_LAB_AUDIT_COMPLETE`（只读审计，未改任何代码）
> 审计基线：worktree `codex/harness-sync-ui-plugins`，commit `60bd660b386e41449849b698c84a21c53de71b5c`
> 范围：`overlays/harness/files/packages/client/ui-physicsos/src/client/**`、`packages/physics-scene/**`、
> `packages/engine-*/**`、`packages/physics-{core,verifier,observation,units}/**`、
> `packages/agent-tools/src/{experiment-catalog,physics-tool-runtime}.ts`。
> 方法：全部结论来自文件读取与 grep（file:line 见正文）；未能从代码确认的一律标 `未验证`。
> 触发技能：`code-audit`（审计类 must；按 CLAUDE.md §3「审计/review 不被只读误挡」）。

---

## 0. 扫描范围（读了什么）

| 区域 | 关键文件 |
| --- | --- |
| 实验模板/清单 | `physics/experiment-templates.ts`(1815 行)、`packages/agent-tools/src/experiment-catalog.ts`(502 行) |
| 外壳与播放 | `PhysicsWorkspace.tsx`(1121 行)、`LabWorkspace.tsx`(412 行)、`TimelineScrubber.tsx`、`animation-clock.ts`、`frame-source.ts` |
| 运行时 | `physics/workspace-runtime.ts` + 21 个 `*-workspace-runtime.ts`、`physics-runtime-bridge.ts`、`mechanics-runtime-bridge.ts`、`collision-runtime-bridge.ts` |
| 渲染 | `physics/renderer-registry.tsx`(≈1400 行)、`physics/scene-visual-model.ts`(1890 行)、`physics/PhysicsCanvas.tsx`、24 个 `*-renderer.tsx`、`vector-label-layout.ts` |
| 桥/视图 | 21 个 `*-visual-bridge.ts`、`mechanics-view-builders.ts` |
| 场景层 | `packages/physics-scene/src/**`（scene.ts / scene-runtime.ts / 各 scene-factory） |
| 引擎层 | 15 个 `packages/engine-*`（含 `engine-lever` 全读） |
| 验证/溯源 | `packages/physics-core/src/provenance.ts`、`packages/physics-verifier/src/**`、UI `verified-result.ts`、`verification-presentation.ts`、`VerifiedResult.tsx` |
| 观测层 | `packages/physics-observation/src/**`（7 个 observation 模块） |
| 教学元数据 | `experiment-summaries.ts`(1082 行)、`experiment-self-checks.ts`、`experiment-artwork.tsx`(1728 行) |

未跑测试、未启动应用；本报告为**静态代码审计**（owner 明确要求「先扫描，暂不改」）。

---

## 1. 完整实验清单（76 个，全量枚举）

枚举来源：以 `experiment-templates.ts` 的 `EXPERIMENT_TEMPLATE_GROUPS` 为准（12 域 76 模板），
与 `experiment-catalog.ts`（服务端 agent 侧 33 条）交叉核对。**76 个模板每个都有对应 Scene Factory，
无「有模板无工厂」的情况。** 每个模板 `createScene` 调用的工厂见下表；工厂均返回**真实 `PhysicsScene`**
（`packages/physics-scene/src/scene.ts:1144`）。

| # | id | 域 | 学段 | Scene Factory |
| --- | --- | --- | --- | --- |
| 1 | uniform-linear | mechanics | junior | createMechanicsScene |
| 2 | average-speed | mechanics | junior | createMechanicsScene |
| 3 | uniform-acceleration | mechanics | senior | createMechanicsScene |
| 4 | projectile-horizontal | mechanics | senior | createMechanicsScene |
| 5 | projectile-oblique | mechanics | senior | createMechanicsScene |
| 6 | newton-second-law | mechanics | senior | createMechanicsScene |
| 7 | incline | mechanics | senior | createMechanicsScene |
| 8 | mechanical-energy | mechanics | junior | createMechanicalEnergyScene |
| 9 | ramp-friction | mechanics | junior | createRampFrictionScene |
| 10 | lever-balance | mechanics | junior | createLeverBalanceScene |
| 11 | collision-elastic | mechanics | senior | createCollisionScene |
| 12 | collision-inelastic | mechanics | senior | createCollisionScene |
| 13 | collision-perfectly-inelastic | mechanics | senior | createCollisionScene |
| 14 | vt-area | mechanics | senior | createMechanicsScene |
| 15 | force-composition | mechanics | senior | createMechanicsScene |
| 16 | concurrent-equilibrium | mechanics | senior | createMechanicsScene |
| 17 | apparent-weight | mechanics | senior | createMechanicsScene |
| 18 | chase-meeting | mechanics | senior | createCollisionScene |
| 19 | hooke-law | mechanics | junior | createMechanicsScene |
| 20 | spring-oscillator | mechanics | senior | createMechanicsScene |
| 21 | circular-orbit | mechanics | senior | createMechanicsScene |
| 22 | simple-pendulum | mechanics | senior | createMechanicsScene |
| 23 | friction-static | mechanics | junior | createMechanicsScene |
| 24 | friction-mu | mechanics | junior | createMechanicsScene |
| 25 | point-charge | electric | senior | createPointChargeScene |
| 26 | multi-point-charge | electric | senior | createPointChargeScene |
| 27 | uniform-electric | electric | senior | createElectricScene |
| 28 | parallel-plate | electric | senior | createParallelPlateScene |
| 29 | straight-wire-field | magnetic | junior | createStraightWireFieldScene |
| 30 | solenoid-field | magnetic | junior | createSolenoidFieldScene |
| 31 | electromagnet | magnetic | junior | createElectromagnetScene |
| 32 | motor | magnetic | junior | createMotorScene |
| 33 | magnetic-circular | magnetic | senior | createMagneticScene |
| 34 | series-circuit | circuit | junior | createSeriesCircuitScene |
| 35 | parallel-circuit | circuit | junior | createParallelCircuitScene |
| 36 | mixed-circuit | circuit | junior | createMixedCircuitScene |
| 37 | short-circuit | circuit | junior | createShortCircuitScene |
| 38 | rheostat-circuit | circuit | junior | createRheostatCircuitScene |
| 39 | va-resistance | circuit | junior | createRheostatCircuitScene |
| 40 | bulb-power | circuit | junior | createRheostatCircuitScene |
| 41 | emf-measurement | circuit | senior | createEmfMeasurementScene |
| 42 | pinhole | optics | junior | createPinholeScene |
| 43 | total-reflection | optics | junior | createTotalReflectionScene |
| 44 | plane-mirror | optics | junior | createPlaneMirrorScene |
| 45 | convex-lens | optics | junior | createConvexLensScene |
| 46 | concave-mirror | optics | junior | createConcaveMirrorScene |
| 47 | convex-mirror | optics | junior | createConvexMirrorScene |
| 48 | echo-ranging | acoustics | junior | createEchoRangingScene |
| 49 | buoyancy | fluid | junior | createArchimedesScene |
| 50 | solid-pressure | fluid | junior | createSolidPressureScene |
| 51 | liquid-pressure | fluid | junior | createLiquidPressureScene |
| 52 | atmospheric-pressure | fluid | junior | createAtmosphericPressureScene |
| 53 | thermometer | thermal | junior | createThermometerCalibrationScene |
| 54 | noise | acoustics | junior | createNoiseBarrierScene |
| 55 | crystal-melting | thermal | junior | createCrystalMeltingScene |
| 56 | boiling-water | thermal | junior | createBoilingWaterScene |
| 57 | heat-capacity-comparison | thermal | junior | createHeatCapacityComparisonScene |
| 58 | velocity-selector | composite | senior | createVelocitySelectorScene |
| 59 | mass-spectrometer | composite | senior | createMassSpectrometerScene |
| 60 | composite-eb | composite | senior | createCompositeFieldScene |
| 61 | composite-ebg | composite | senior | createCompositeFieldScene |
| 62 | multi-region-field | composite | senior | createMultiRegionFieldScene |
| 63 | cyclotron | composite | senior | createCyclotronScene |
| 64 | induction-bar-motion | induction | senior | createBarMotionScene |
| 65 | transformer | induction | senior | createTransformerBenchScene |
| 66 | induction-double-bar-momentum | induction | senior | createDoubleBarRailScene |
| 67 | induction-double-bar-force | induction | senior | createDoubleBarRailScene |
| 68 | induction-flux-change | induction | senior | createFluxChangeScene |
| 69 | wave-travelling | wave | junior | createTravellingWaveScene |
| 70 | wave-interference | wave | senior | createWaveInterferenceScene |
| 71 | wave-standing | wave | senior | createStandingWaveScene |
| 72 | wave-longitudinal | wave | senior | createLongitudinalWaveScene |
| 73 | wave-reflection-refraction | wave | senior | createReflectionRefractionScene |
| 74 | wave-diffraction | wave | senior | createDiffractionScene |
| 75 | wave-doppler | wave | senior | createDopplerScene |
| 76 | photoelectric-effect | modern | senior | createPhotoelectricEffectScene |

`comingSoon`：模板接口声明了 `comingSoon?: true`（`experiment-templates.ts:114`），但**当前 76 个模板无一置位**，
`SELECTABLE_TEMPLATE_COUNT` = 76（`experiment-templates.ts:1790`）。**无「即将上线」占位实验。**

---

## 2. 每实验能力矩阵

图例：`E`=走域引擎 · `V`=Verifier（引擎 `simulate()` 内自校验并回传 checks）· `O`=Observation 层参与 ·
`R`=渲染来自注册表 `RENDERERS`（`renderer-registry.tsx:1236`）· `TL`=有场景时间线（`clock.total>0`）·
`Ev`=有物理事件 · `Ed`=参数编辑→重算 · `Sk`=seek 可精确重建 · `Br`=可分支 · `Mo`=模型完备度等级。
所有行 `Scene=✔`（模板均产出真实 PhysicsScene）。

> 说明：`TL=–` 表示该 Runtime 明确以 `total: 0` 关闭时间线（多为稳态/静态模型，见 §3 STATIC 类），
> 不是「参数不更新」——这些实验 `Ed=✔`，改参数会重算并重绘。

### 2.1 mechanics 域（24 个）

| 实验 | E | V | O | R | TL | Ev | Ed | Sk | Br | Mo |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| uniform-linear | ✔ | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| average-speed | ✔ | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| uniform-acceleration | ✔ | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| projectile-horizontal | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ANALYTICAL |
| projectile-oblique | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ANALYTICAL |
| newton-second-law | ✔ | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| incline | ✔ | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| mechanical-energy | ✔ | ✔ | – | ✔ | – | – | ✔ | – | ✔ | QUASI_STATIC（能量账本） |
| ramp-friction | ✔ | ✔ | – | ✔ | – | – | ✔ | – | ✔ | QUASI_STATIC（能量账本） |
| lever-balance | ✔ | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | QUASI_STATIC（见 §5） |
| collision-elastic | ✔ | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔(采样) | ✔ | **FULL_DYNAMIC** |
| collision-inelastic | ✔ | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔(采样) | ✔ | **FULL_DYNAMIC** |
| collision-perfectly-inelastic | ✔ | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔(采样) | ✔ | **FULL_DYNAMIC** |
| vt-area | ✔ | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| force-composition | ✔ | ✔ | ✔ | ✔ | ? | – | ✔ | ✔ | ✔ | ANALYTICAL/STATIC（未验证） |
| concurrent-equilibrium | ✔ | ✔ | ✔ | ✔ | ? | – | ✔ | ✔ | ✔ | STATIC（未验证） |
| apparent-weight | ✔ | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| chase-meeting | ✔ | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔(采样) | ✔ | **FULL_DYNAMIC** |
| hooke-law | ✔ | ✔ | ✔ | ✔ | – | – | ✔ | – | ✔ | STATIC（弹簧静平衡） |
| spring-oscillator | ✔ | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| circular-orbit | ✔ | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| simple-pendulum | ✔ | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| friction-static | ✔ | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| friction-mu | ✔ | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |

mechanics 经 `MechanicsRuntimeBridge`（`mechanics-runtime-bridge.ts`）跑 `engine-mechanics`；
collision 经 `CollisionRuntimeBridge` 跑 `engine-collision`；energy/lever 各自 Runtime。
observation 由 `mechanics-view-builders.ts` + `physics-observation` 提供（本域是 Observation 接线最完整的域）。

### 2.2 electric / magnetic 域（9 个）

| 实验 | E | V | O | R | TL | Ev | Ed | Sk | Br | Mo |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| point-charge | ✔ | ✔ | ✔ | ✔ | – | – | ✔ | – | ✔ | STATIC（库仑场图，引擎拒绝 1/r² 运动） |
| multi-point-charge | ✔ | ✔ | ✔ | ✔ | – | – | ✔ | – | ✔ | STATIC |
| uniform-electric | ✔ | ✔ | ✔ | ✔ | ? | – | ✔ | ? | ✔ | ANALYTICAL/STATIC（未验证） |
| parallel-plate | ✔ | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| straight-wire-field | ✔ | ✔ | – | ✔ | – | – | ✔ | – | ✔ | STATIC（稳恒磁场） |
| solenoid-field | ✔ | ✔ | – | ✔ | – | – | ✔ | – | ✔ | STATIC |
| electromagnet | ✔ | ✔ | – | ✔ | – | – | ✔ | – | ✔ | STATIC |
| motor | ✔ | ✔ | – | ✔ | – | – | ✔ | – | ✔ | STATIC |
| magnetic-circular | ✔ | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ | – | ANALYTICAL（解析圆周） |

electric 经 `electric-workspace-runtime`（`engine-electric` + `engine-electric-region`）；
current 四个经 `current-workspace-runtime`（`engine-magnetic` 的 CurrentFieldEngine，`total:0`）；
magnetic-circular 经 `physics-runtime-bridge.ts`（`engine-magnetic` MagneticEngine）。
`magnetic-circular`**无分支**（`branch=0`，`magnetic-workspace-runtime.ts` 未接 `forkExperimentalScene`）。

### 2.3 circuit / optics / acoustics / fluid（17 个）

| 实验 | E | V | O | R | TL | Ev | Ed | Sk | Br | Mo |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| series-circuit | ✔ | ✔ | – | ✔ | ~ | – | ✔ | ✔ | ✔ | QUASI_STATIC（DC 工作点） |
| parallel-circuit | ✔ | ✔ | – | ✔ | ~ | – | ✔ | ✔ | ✔ | QUASI_STATIC |
| mixed-circuit | ✔ | ✔ | – | ✔ | ~ | – | ✔ | ✔ | ✔ | QUASI_STATIC |
| short-circuit | ✔ | ✔ | – | ✔ | ~ | – | ✔ | ✔ | ✔ | QUASI_STATIC |
| rheostat-circuit | ✔ | ✔ | – | ✔ | ✔ | – | ✔ | ✔ | ✔ | QUASI_STATIC（滑变扫描） |
| va-resistance | ✔ | ✔ | – | ✔ | ✔ | – | ✔ | ✔ | ✔ | QUASI_STATIC |
| bulb-power | ✔ | ✔ | – | ✔ | ✔ | – | ✔ | ✔ | ✔ | QUASI_STATIC |
| emf-measurement | ✔ | ✔ | – | ✔ | ✔ | – | ✔ | ✔ | ✔ | QUASI_STATIC |
| pinhole | ✔ | ✔ | – | ✔ | – | – | ✔ | – | ✔ | STATIC（几何光学） |
| total-reflection | ✔ | ✔ | – | ✔ | – | – | ✔ | – | ✔ | STATIC |
| plane-mirror | ✔ | ✔ | – | ✔ | – | – | ✔ | – | ✔ | STATIC |
| convex-lens | ✔ | ✔ | – | ✔ | – | – | ✔ | – | ✔ | STATIC |
| concave-mirror | ✔ | ✔ | – | ✔ | – | – | ✔ | – | ✔ | STATIC |
| convex-mirror | ✔ | ✔ | – | ✔ | – | – | ✔ | – | ✔ | STATIC |
| echo-ranging | ✔ | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ANALYTICAL（往返运动学） |
| buoyancy | ✔ | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ANALYTICAL（下沉/浮定） |
| noise | ✔ | ✔ | – | ✔ | – | – | ✔ | – | ✔ | STATIC（声级对数式） |

`TL=~`：circuit 的时间线是**滑变电阻扫描**（`circuit-workspace-runtime.ts:10-11,412`），
无滑变电阻的电路 `endTime` 可能为 0 → 传输控件被禁用（未逐电路验证，标 `未验证`）。
circuit/optics/acoustics(noise) 均**未接 Observation** 层。

### 2.4 thermal / composite / induction / wave / modern（26 个）

| 实验 | E | V | O | R | TL | Ev | Ed | Sk | Br | Mo |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| thermometer | ✔ | ✔ | – | ✔ | – | – | ✔ | – | ✔ | STATIC（标定） |
| crystal-melting | ✔ | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ANALYTICAL（分段加热曲线） |
| boiling-water | ✔ | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ANALYTICAL |
| heat-capacity-comparison | ✔ | ✔ | – | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ANALYTICAL |
| velocity-selector | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ANALYTICAL |
| mass-spectrometer | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ANALYTICAL |
| composite-eb | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ANALYTICAL |
| composite-ebg | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ANALYTICAL |
| multi-region-field | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ANALYTICAL（分段运动学） |
| cyclotron | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ANALYTICAL（理想脉冲隙模型） |
| induction-bar-motion | ✔ | ✔ | – | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL（E=BLv） |
| transformer | ✔ | ✔ | – | ✔ | – | – | ✔ | – | ✔ | STATIC（匝比） |
| induction-double-bar-momentum | ✔ | ✔ | – | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL（指数 e^{−t/τ}） |
| induction-double-bar-force | ✔ | ✔ | – | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| induction-flux-change | ✔ | ✔ | – | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL（E=−dΦ/dt） |
| wave-travelling | ✔ | ✔ | – | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL（y=A·sin(2π(x/λ−ft))） |
| wave-interference | ✔ | ✔ | – | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| wave-standing | ✔ | ✔ | – | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| wave-longitudinal | ✔ | ✔ | – | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| wave-reflection-refraction | ✔ | ✔ | – | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| wave-diffraction | ✔ | ✔ | – | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| wave-doppler | ✔ | ✔ | – | ✔ | ✔ | – | ✔ | ✔ | ✔ | ANALYTICAL |
| photoelectric-effect | ✔ | ✔ | – | ✔ | – | – | ✔ | – | – | ANALYTICAL（单光子方程，静态曲线） |

composite 是观测层接线最完整的高阶域；wave/induction/thermal/modern 均未接 Observation。
`photoelectric-effect`**无分支**（`branch=0`）。

### 2.5 能力汇总

- **有场景时间线（`total>0`，Run 可用）**：约 **46** 个（mechanics 运动类 14 + collision 4 + lever 1 +
  parallel-plate 1 + magnetic-circular 1 + circuit 4~8 + echo 1 + buoyancy 1 + thermal 3 + composite 6 +
  induction 4 + wave 7）。
- **无时间线（`total=0`，稳态/静态，Run 禁用）**：约 **25** 个（见 §3 STATIC 列表）。
- **有物理事件**：projectile(2)、collision(1 组)、lever、echo、buoyancy、thermal(3)、composite(6)。其余 `events: []`。
- **观测层参与**：mechanics、electric、composite、magnetic（4/12 域）。circuit/optics/wave/induction/thermal/fluid/acoustics/modern 未接。
- **分支**：除 `magnetic-circular`、`photoelectric-effect` 外，各 Runtime 经 `forkExperimentalScene`（`experimental-branch.ts`）支持。

---

## 3. 缺陷分类（含 file:line）

### 3.1 `STATIC_DEMO`（几何画了，参数不更新）—— **0 个**

全量核对：21 个 Runtime 全部实现 `editParameter → sceneCommand → recompute → getSnapshot`
（`lever-workspace-runtime.ts:420`、`circuit-workspace-runtime.ts:582`、`electric-workspace-runtime.ts:604` …）。
`total=0` 的实验**不是** STATIC_DEMO——改参数会走真实命令重算并重绘，只是模型本身与时间无关。
**未发现「画了不更新」的实验。**

### 3.2 `VISUAL_ONLY_ANIMATION`（CSS/RAF/本地状态驱动、背后无引擎态）—— **1 个（物理冒充）**

- **lever-balance**：倾斜角不是动力学解，而是引擎内的**线性显示斜坡**
  `tilt = sign · MAX_TILT_RADIANS · min(t/TIP_DURATION, 1)`（`packages/engine-lever/src/statics.ts:78-79`），
  文件顶部自述「no moment of inertia and no angular acceleration — junior statics, not a rigid-body integrator」
  （`statics.ts:8-9`）。UI 让「运行」播放这段斜坡，视觉上**冒充**转动动力学。详见 §5。

其余用 `time` 的渲染均为**装饰性**、且相位锁定场景时间，不冒充物理：
- 电流流向虚线动画（`circuit-renderer.tsx:887`、`induction-renderer.tsx:365`）；
- 加热器标签相位闪烁 `(time??0)*7.1`（`thermal-renderer.tsx:45`）。
这三处属可接受的视觉 chrome；建议在报告中单列，不计入缺陷。

### 3.3 `HARDCODED_PHYSICS`—— **0 个「隐藏结果」；3 处需关注**

判据：区分「合法常数 / 模型参数 / UI 偷算物理结果」。全仓 grep（`9.8 / 9.81 / 1.6e-19 / 6.67e-11 / 340 / 343`）结论：

| 位置 | 值 | 判定 |
| --- | --- | --- |
| `packages/engine-modern/src/photoelectric-model.ts:5-7` | h、c、e | **合法 CODATA-2019 精确常数** |
| `packages/engine-magnetic/src/current.ts:23` | μ₀=4π×10⁻⁷ | **合法 SI 定义常数** |
| `packages/engine-mechanics/src/orbit.ts:17` | GM=3.986004418e14 | **合法（地球 GM）** |
| `packages/engine-mechanics/src/models/model-resolvers.ts:26` | `vec3(0,−9.8,0)` 兜底 | **模型参数（静默默认）**：仅当场景缺 `uniform_gravity` 场时生效 |
| `experiment-templates.ts:127` `const g=9.8`；`:919/1411/1440/1467/1489/1515` `charge:1.6e-19` | 9.8 / e | **模型参数/合法常数**（作为场景种子喂给引擎） |
| `physics-runtime-bridge.ts` / `prototype/magnetic-scene.ts` | `1.6e-19 / 1.67e-27` | **合法常数**（电子电荷、质子质量，种子值） |
| `mechanics-view-builders.ts:255` | `: 9.8`（无重力场时的 g 兜底） | **UI 侧模型参数兜底**（次要；仅显示用，改回引擎） |
| `mechanics-view-builders.ts:758` | `const gravity = Math.hypot(m.gravity.x,m.gravity.y) || 9.8; const apexTime = vy0/gravity` | **UI 在算物理**：视图构建器自行推算「最高点」事件时刻，引擎并未输出该事件 |
| `experiment-summaries.ts:332` | 文案内写死「9.8 N 突降为 5.88 N」 | **教学文案里的硬编码结果**（文档常数，需防与默认场景漂移） |

**「UI 偷算物理」命中 1 处**：`mechanics-view-builders.ts:758`（apex 时刻）。
**「隐藏硬编码结果」命中 0 处**——引擎里没有藏结果，验证器会独立重算（如 `lever-engine.ts:152-153,172-177`）。

### 3.4 `FAKE_VERIFIED`—— **未发现可复现的硬编码假徽章；存在 1 条架构风险（P1）**

- **溯源契约真实存在且正确**：`packages/physics-core/src/provenance.ts` 定义 `VerifiedQuantity` + 证据派生
  `deriveVerificationLevel`（`:134-156`，证据为空→`ENGINE_COMPUTED`，**永不默认「已验证」**），
  以及门禁 `assertVerifiedPhysicsOutput`（`:376-386`，默认门槛 `ENGINE_COMPUTED`，未过则抛 `UnverifiedPhysicsOutputError`）。
- **门禁只接在 agent 工具边界，未接渲染路径**：全仓调用点仅
  `packages/agent-tools/src/physics-tool-runtime.ts:305`（经 `:593/:774/:874`）与测试；
  **UI 覆盖层 `ui-physicsos/**` 无任何调用**。
- **UI 的验证判定来自字符串，不回推证据**：`physics/verified-result.ts:67-70` 的 `LEVEL_BY_STATUS` 把
  `'passed'/'passed_with_warnings'` 直接映射为 `'physics-verified'`，**不查 checks / revision / 证据**；
  `PhysicsWorkspace.tsx:377-382` 的状态标签同样取 `snapshot.status`（= `simulation.verification.status` 字符串）。
  该文件自述是 canonical 契约的占位（`verified-result.ts:1-14`）。
- **风险路径**：引擎 `validate()/canHandle` 会返回 `{status:'passed', checks:[]}`
  （如 `engine-acoustics/src/acoustics-engine.ts:269`、`engine-noise:319`、`engine-fluid:329` 等），
  `summarizeVerification`（`packages/physics-core/src/verification.ts:94-97`）会把「空 checks」判成 `'passed'`。
  若该 status 抵达 UI 状态缝，徽章会显示「引擎已验证」而**零条 checks**。
  现状：`simulate()` 会覆盖这些占位（如 `engine-electric.ts:465→477`），**未确认可达**，故列为风险而非确诊。
- **结论**：`FAKE_VERIFIED`（确诊）= **0**；**架构风险 = 1**（P1，见 P0/P1 列表）。
  另：`VerifiedResult.tsx` 仅用于会话 `SceneChatCard`，与 Lab 同一判定模式。

### 3.5 `FAKE_RUNTIME`（新类别）—— **确诊 0；临近 2 类**

判据：Run 可点但只播 CSS/本地状态、Timeline 非场景时间、Seek 不能重建物理态。

- **确诊 0**：外壳对 `clock.total<=0` 的实验把播放/暂停/单步/复位/时间线全部 `disabled`
  （`PhysicsWorkspace.tsx:620,633,643,654,880`），**没有**「可点但空转」的运行器。
- **临近 A（模型冒充动力学，1 个）**：`lever-balance` 的「运行」播放的是显示斜坡而非 `τ=Iα`，见 §3.2/§5。
  归为 `VISUAL_ONLY_ANIMATION`+`MODEL_COMPLETENESS` 缺陷更准确。
- **临近 B（同一工具栏但半数列控件禁用，系统性 ≈25 个）**：外壳**无条件渲染**整套 transport + timeline
  （`PhysicsWorkspace.tsx:616-662` 与 `:875-938`），`total=0` 的实验整行控件可见但灰。
  owner 的「所有实验长着同一个工具栏，一半按钮没用」——**这就是证据**（属 UI 诚实性缺陷，P1）。
- **可 seek 精确重建**：magnetic/mechanics/lever/electric-region/composite/induction/thermal/wave/circuit/acoustics/fluid
  走**闭式重算**（`physics-runtime-bridge.ts:1028,1130`、`lever-workspace-runtime.ts:225`），seek 精确；
  collision 走**采样最近邻**（`trajectoryTimes` + `nearestTimedStateIndex`，`animation-clock.ts:45`），近似重建。
  静态域 `seek` 为 no-op（`optics-workspace-runtime.ts:580`、`modern:178`）。

### 3.6 `MODEL_COMPLETENESS`（新维度）—— 逐实验等级（矩阵 `Mo` 列）

- **FULL_DYNAMIC_MODEL（唯一真积分器）**：`engine-collision` 用半隐式欧拉 `v+=g·dt; x+=v·dt` +
  冲量接触（`collision-solver.ts:171-175,128-152`，`DEFAULT_DT=1/120`）。
  命中 **4** 个：collision-elastic / collision-inelastic / collision-perfectly-inelastic / chase-meeting。
- **ANALYTICAL_MODEL（闭式真物理，按 t 求解）**：mechanics 运动类、parallel-plate、magnetic-circular、
  composite(6)、induction(4)、wave(7)、echo、buoyancy、thermal 加热(3)、photoelectric。**≈ 46**。
- **QUASI_STATIC_MODEL**：lever-balance（力矩平衡 + 显示斜坡）、circuit(8)（DC 工作点 + 滑变扫描）、
  mechanical-energy / ramp-friction（能量账本）。**≈ 11**。
- **STATIC_EQUILIBRIUM_MODEL**（与时间无关的稳态/静态）：point-charge / multi-point-charge、
  current(4)、optics(4)+light(2)、pressure(3)、thermometer、transformer、noise。**≈ 15**。
- **VISUAL_DEMO_ONLY**：**0**（每个实验都至少经一个真实引擎）。

**UI 诚实性**：静/准静态实验大多**诚实地关了时间线并在代码注释里说明原因**
（`current-workspace-runtime.ts:11`、`energy-workspace-runtime.ts:11`、`light:10`、`noise:10`、
`pressure:11`、`thermometer:10`、`transformer:10`）——这点做得对。
**唯一不诚实的是 lever**：模型是 `STATIC_EQUILIBRIUM`，但前端播放一段**冒充转动动力学**的旋转。

---

## 4. 架构结论（逐条作答）

目标链路：`PhysicsScene → Scene Runtime → Engine → Verifier → Observation → SceneVisualModel → Renderer`

1. **统一 `PhysicsWorkspace`/`WorkspaceRuntime`？**
   **外壳统一、运行时 21 份、无共享基类。** 单一外壳 `PhysicsWorkspace.tsx`（自述「the one physics workspace」）
   + 单一画布 `PhysicsCanvas.tsx` + 单一调度器 `LabWorkspace.tsx:337 buildWorkspaceRuntime`。
   但**没有**统一的 `WorkspaceRuntime` 实现：`workspace-runtime.ts:63` 只是**接口**，
   21 个 `*-workspace-runtime.ts` 各自 `implements`、各自重复 `command<T>()` 与 `seek/step/advance`
   （无 `extends`）。`LabWorkspace.tsx:337-412` 用一个大 `switch` 按域+bench 分发。
   → **结论：不是「一个 Runtime」，是「一个接口 + 21 份实现」。** 未发现更细的 per-experiment workspace 页（这点 owner 的担忧不成立）。

2. **Renderer 注册表 + `canRender/buildVisualModel/render` 契约？**
   **有注册表，但契约不是那三个方法。** `RENDERERS`（`renderer-registry.tsx:1236`）以
   `SceneVisualModel['domain']` 为键注册 **11** 个 React 组件；契约是 `RendererProps`
   （`:113`：`{view, projection, time?, ...}`）。`canRender/buildVisualModel/render` 三个名字**全仓不存在**。
   `PhysicsCanvas.tsx:332` 用 `RENDERERS[view.domain]` 取渲染器。多 bench 域在注册表内**再分流**
   （magnetic→current、mechanics→lever/energy、optics→light、thermal→thermometer、induction→transformer 等）。
   → **有注册表，但入口契约是「React 组件消费 IR」，而非 owner 设想的三个方法。**

3. **有 `SceneVisualModel` 中间层？**
   **有，且是真实 IR。** `scene-visual-model.ts`（1890 行）自述「renderer 消费的唯一输入，永不 import 引擎」；
   `SceneVisualModel`（`:1515-1720`）= 域 + 视口 + 共享图元数组（bodies/particles/vectors/trajectories…）
   + ~60 个可选 per-bench 字段（circuitComponents/opticalRays/leverBeam…）。
   **所有 renderer 只吃 `SceneVisualModel`，无一直接吃引擎/运行时输出**（仅 `circuit-renderer.tsx:17`
   import 了纯几何辅助 `circuitTerminalPoint`）。→ **不存在 `PhysicsScene → SVG/JSX` 直连。**

4. **有 `SimulationClock`（play/pause/step/seek/reset/speed）？**
   **无 `SimulationClock` 类。** 时钟 = `PlaybackClock` **数据接口**（`scene-visual-model.ts:1846`：
   time/total/running/rate）+ rAF 驱动 `useAnimationClock`（`animation-clock.ts:69`）+ 各 Runtime 的私有
   `currentTime/running/rate` 字段。传输控件在外壳（play/pause/step±/reset=seek(0)/speed=setRate）。
   **精确 seek**：闭式域**能**（重算 state at t）；collision **近似**（采样最近邻）；静态域 no-op。
   → **无统一时钟抽象、无 `reset()` 方法（reset 即 seek(0)）**。

5. **Observation 是否中介引擎输出？**
   **部分。** `packages/physics-observation` 有 7 个模块（circuit/composite/electric/induction/mechanics/optics/wave），
   但 UI 仅在 **mechanics / electric / composite / magnetic**（经 `physics-runtime-bridge.ts`）使用；
   **circuit/induction/optics/wave 的 observation 模块存在却未被 UI 接线**，thermal/fluid/acoustics/modern 无 observation。
   → **Observation 只在 4/12 域中介，其余 UI 直读运行时的 `SceneVisualModel`。**

6. **单位走 `physics-units`？**
   **场景/引擎层走。** `physics-scene` 全量用 `Quantity<'length'>` 等（`scene.ts:105-107`），
   引擎用 `quantity()`。**但 UI 桥层有重复的展示换算**：`cm = m*100` 在 **7 个 visual-bridge** 各写一份
   （`fluid-visual-bridge.ts:31`、`lever:31`、`current:65`、`thermometer:28`、`pressure:56`、`light:35`、`energy:37`），
   `composite-visual-bridge.ts:492 scaleLength*100`、`electric-visual-bridge.ts:525`、`wave-visual-bridge.ts:372-375`。
   `lever-workspace-runtime.ts:110-111 cmOf/nCmOf` 同型。→ **单位数值本身正确，但换算逻辑未集中，重复 ~10 处（可维护性风险）。**

7. **world→viewport 变换集中？**
   **集中。** `PhysicsCanvas.tsx:192-211` 统一提供 `px/py/sx/sy/scale/path`（自述「唯一 flip y 的地方」），
   renderer 只调 `projection.px/py`。**未发现 `x*100+50` 式散落字面量**（渲染器内 `0.5*scale`、`dialFraction*100`
   是基于 `projection.scale` 的合法用法）。

8. **Timeline 是视频进度条还是物理事件时间轴？**
   **物理事件时间轴（带命名事件）。** `TimelineMarkers`（`workspace-parts.tsx`）读 `snapshot.events`
   （`TimelineEvent{id,time,label,kind}`），如 projectile「发射/最高点/落地」、lever「杠杆平衡/开始倾斜/倾斜到位」、
   composite/echo/buoyancy/thermal 均有具名事件，可点击跳转（`onSeek`）。**事件型实验是事件轴；无事件域退化为纯 scrubber。**

9. **标签/箭头避让？**
   **有。** `vector-label-layout.ts`（142 行）在屏幕空间解碰撞、沿箭头方向推挤、>15px 引出引线，
   经 `primitives.tsx:657`（`Vectors`）调用。

10. **窄宽度响应式？**
    **有 JS 驱动的响应式。** `PhysicsCanvas.tsx:150-184` 用 `ResizeObserver` 设 viewBox、
    对绘图区做 `Math.max(120,…)/Math.max(90,…)` 下限、`scale=min(sx,sy)` 保比；
    `ResponsiveInspector.tsx` 管侧栏抽屉/轨道切换。物理 CSS 里唯一的 `@media` 是 `prefers-reduced-motion`
    （`PhysicsCanvas.module.css:259`、`primitives.module.css:246`）——**无宽度断点**，宽度自适应全走 JS。

---

## 5. 杠杆专项（owner 的截图案例）

**问题：力矩/力臂/平衡是在引擎里算的，还是硬编码画的？答案是——力矩**是**引擎算的；旋转**不是**动力学，是显示斜坡。**

现状（file:line）：

- **力矩/力臂/平衡 = 真引擎算**：`resolveLeverModel`（`engine-lever/src/lever-model.ts:62`，要求支点两侧各一钩码）；
  `momentsOf`（`statics.ts:50-63`）算 `leftWeight=m·g`、`leftMoment=leftWeight·arm`、`netMoment=左−右`、
  `balanced=|netMoment|≤1e-9·scale`，即教科书 `F₁l₁=F₂l₂`。重力 g **从场景读取**（`lever-model.ts:74-78`），非写死。
- **旋转 = 非物理**：`leverStateAt`（`statics.ts:72-83`）是**线性显示斜坡**
  `tilt = sign·MAX_TILT_RADIANS·min(t/TIP_DURATION,1)`；`MAX_TILT_RADIANS=18°`、`TIP_DURATION=0.6`、
  `HOLD_DURATION=0.6` 均为**动画/显示模型参数**。文件自述「无转动惯量、无角加速度」（`statics.ts:8-9`），
  `stateOf` 也把 tilt 注为「力矩差的显示」（`lever-engine.ts:208-210`）。
- **UI↔模型**：`lever-workspace-runtime.ts` 用 `LeverEngine.simulate()`（`:143`），参数编辑走真实命令
  `SetHangerMass/SetHangerArm`（`:427,439`），checks 表见 `:77-92`（含 `weight_from_mass`、`moment_from_force`、
  `moment_balance`）。`chartsOf` 画 θ–t（`:533-552`）。UI 侧有 `cmOf/nCmOf` 展示换算（`:110-111`）。
- **判定**：模型 = `STATIC_EQUILIBRIUM_MODEL`（力矩平衡）+ 一段**冒充转动动力学**的显示旋转。
  即：**数值物理（力矩/平衡）正确且可验证；运动视觉不诚实**——它让「不平衡的杠杆」匀速线性转到 18° 停住，
  而非 `τ=Iα → ω(t) → θ(t)` 收敛。
- **修复方向（非本次实施）**：要么**如实标注**（把「运行」改为「显示倾斜趋势」并在 UI 说明这是显示模型）；
  要么**补真动力学**：引入 `τ=Iα`、`ω(t)`、阻尼与终止条件（θ 到限位/接触面），并提供 `I` 作为模型参数。

---

## 6. 每实验分级

**「Complete」定义（owner 新定义）**：Scene / Engine / Observation / Renderer / 参数可变 / 单位正确 /
运行时同步 / Verifier **全 PASS**，且**其声明的能力**（timeline/seek/measurement/branch）全部真实存在。

按此定义，**没有任何实验达到 `Complete`**——主要缺口是 **Observation 未全接线**与**无 measurement 工具**。
分级结果：

| 等级 | 判定 | 命中 |
| --- | --- | --- |
| **Complete** | 全部 8 项 + 声明能力全真 | **0** |
| **Good** | Scene/Engine/Verifier/Renderer/参数/单位/同步 全 PASS，声明能力真实，仅缺 Observation/measurement | collision(4)、mechanics 运动类、composite(6)、induction(4)、wave(7)、echo、buoyancy、thermal(3)、electric 运动类 |
| **Needs Work** | 真引擎但有诚实性/完整性缺口 | **lever-balance**（模型冒充动力学）、**circuit(8)**（Quasi-static 但时间线像运动）、静态域中「控件禁用但同款工具栏」的实验、`mechanics-view-builders.ts:758` 的 apex 偷算 |
| **Critical** | 假数据/假动画/UI 算物理/假 verified/时间线失步 | **0**（未确诊） |

**八维打分（简）**：物理正确性普遍 **Good**（引擎闭式且被独立验证）；动画来源 **Needs Work→Good**
（除 lever 外均来自引擎态）；交互 **Good**（参数编辑、开关、滑变、拖拽比多数产品好）；
测量 **Critical/缺**（无游标卡尺/量角器类交互测量，只有派生量表）；可视化 **Good**（共享图元 +
标签避让 + 事件标记）；时间线 **Needs Work**（无事件域只有 scrubber，且 `total=0` 域控件禁用）；
验证 **Needs Work**（徽章来自字符串、门禁未接渲染路径）；可访问性 **Good**（aria-label、键盘播放、
`prefers-reduced-motion`、`role=alert`）。

---

## 7. 建议的 `ExperimentCapabilities` 清单（真实能力，非愿景）

对每个实验应产出一份**据实**能力声明，供外壳据此显隐控件（而非一律长着同一工具栏）。示例：

```ts
// 真实能力（此值为审计判定的真实态，不是期望态）
{ id: 'lever-balance',
  model: 'quasi-static',              // 力矩平衡 + 显示斜坡，非 dynamic
  timeline: true, seek: true, replay: true, editable: true,
  measurable: false, branchable: true, verifiable: true,
  observations: ['moments', 'arms'],
  measurements: [] }

{ id: 'series-circuit',
  model: 'static',                    // DC 工作点
  timeline: false, seek: false, replay: false, editable: true,
  measurable: false, branchable: true, verifiable: true,
  observations: [], measurements: [] }

{ id: 'collision-elastic',
  model: 'dynamic',                   // 唯一真积分类
  timeline: true, seek: true /*采样*/, replay: true, editable: true,
  measurable: false, branchable: true, verifiable: true,
  observations: [], measurements: [] }
```

**应显式标注「显示了但背后无真实能力」的控件**（这是 owner 点名要列的「同一工具栏」finding）：
- 所有 `model: 'static'` 的 ≈25 个实验：**播放/暂停/单步/复位 + 时间线整行可见但禁用**
  （`PhysicsWorkspace.tsx:616-662,875-938` 无条件渲染；`:620,633,643,654,880` 依 `clock.total<=0` 禁用）。
  建议：按 `ExperimentCapabilities.timeline` **隐藏**而非禁用，避免「一排没用的按钮」。
- `branchable:false` 的两个（magnetic-circular、photoelectric-effect）：**分支徽章/还原入口**对它们永不可达。
- `measurable:false` 的全部：**无任何交互测量工具**（全仓 `measurementDefinitions` 仅在场景/工厂/测试出现，
  UI 无测量工具组件）——owner 若把「measurement」列为声明能力，则现在**全部实验都声明了假能力**。

---

## 8. P0 / P1 / P2

### P0（错误物理 / 假数据 / 假动画 / UI 算物理 / 时间线失步 / 假 verified）

| # | 项 | 证据 | 说明 |
| --- | --- | --- | --- |
| P0-1 | **lever 用显示斜坡冒充转动动力学** | `engine-lever/src/statics.ts:8-9,72-83`；`lever-workspace-runtime.ts:225` | 模型是静平衡，却让「运行」播放线性旋转，视觉上等于假动力学。**这是唯一确诊的「假动画」**。 |
| P0-2 | **验证门禁未接渲染路径**（假 verified 风险） | `physics-core/src/provenance.ts:376` 只在 `agent-tools/src/physics-tool-runtime.ts:305` 被调；UI `verified-result.ts:67-70` 仅按字符串判级 | 徽章可只凭引擎 status 字符串点亮，不回推证据；空 checks 的 `'passed'` 理论上可达。须把 `assertVerifiedPhysicsOutput`/证据回推接进 UI 判定。 |
| P0-3 | **UI 在算物理（apex 时刻）** | `physics/mechanics-view-builders.ts:758` | 视图构建器自算 `apexTime=vy0/g` 生成时间线事件，越过引擎/事件契约。 |

> P0 计数：**3**。严格意义上「假数据/假动画」确诊仅 P0-1；P0-2 为高风险架构缺口，P0-3 为越权计算。

### P1（真动画 / 测量 / 时间线 / 力矢量 / 场可视化 / inspector）

| # | 项 | 证据 |
| --- | --- | --- |
| P1-1 | **同款工具栏、半数列控件禁用**（诚实性） | `PhysicsWorkspace.tsx:616-662,875-938` 无条件渲染；`total=0` 域禁用 |
| P1-2 | **Observation 层未全接线** | `physics-observation/src/{circuit,induction,optics,wave}-observation.ts` 存在，UI 未用（仅 mechanics/electric/composite/magnetic） |
| P1-3 | **无交互测量工具** | 全仓无测量工具组件；`measurementDefinitions` 未被 UI 消费 |
| P1-4 | **世界换算重复 ~10 处** | 7 个 `*-visual-bridge.ts` 各写 `cm=m*100` 等 |
| P1-5 | **`total=0` 域的 seek no-op 未在 schema 上声明能力** | `optics-workspace-runtime.ts:580`、`modern:178` |
| P1-6 | **UI 侧 g 兜底 9.8** | `mechanics-view-builders.ts:255`（次要） |

### P2（笔记本 / 分支对比 / 挑战 / 分享）

| # | 项 | 证据 |
| --- | --- | --- |
| P2-1 | 教学文案硬编码结果易漂移 | `experiment-summaries.ts:332`（「9.8 N → 5.88 N」） |
| P2-2 | 分支对比（两场景并排）缺失 | 仅 `forkExperimentalScene` 单支还原，无对比 UI |
| P2-3 | 挑战/评分模式缺失 | 自测为题库选题（`experiment-self-checks.ts`），非挑战关卡 |
| P2-4 | 分享/导出仅 CSV | `export-csv.ts`；无分享链接/报告导出 |
| P2-5 | 无 per-experiment `ExperimentCapabilities` manifest |（§7 建议新增） |

---

## 9. 未验证清单（诚实声明）

- `force-composition / concurrent-equilibrium / uniform-electric` 的 `clock.total`：矩阵中 `TL` 标 `?`，**未逐个确认**。
- circuit 各电路（无滑变电阻者）的 `endTime` 是否为 0：**未逐电路确认**。
- 空 checks 的 `'passed'` 是否**真的**能抵达 UI 状态缝：**未确认可达**（列为风险）。
- 各实验 `observations/measurements` 字段的**逐实验**取值：仅按域/桥抽样确认，未逐实验核。
- 未运行应用/测试；未做像素级视觉核对（owner 明确「先扫描」）。

---

## 10. 结论

- owner 的判断**部分成立**：这**不是**「静态图 / 简单动画 / UI 演示」——
  76 个实验**全部**有真实 Scene Factory、走真实引擎、参数编辑走真实命令并可重算，多数还有真验证与事件轴。
- 但它**确实读起来像 UI**，根因是三条：**(1) 唯一真动力学只有 collision，其余多为闭式/准静态/静态模型**；
  **(2) 唯一被冒充的动力学是 lever 的假旋转**；**(3) 外壳对所有实验渲染同一套 transport，`total=0` 的 ≈25 个实验
  控件全灰**——「同一个工具栏、一半按钮没用」正是此处。
- 最高优先级不是「补动画」，而是 **①修 lever 的模型诚实性 ②把 provenance 门禁接进渲染路径
  ③按真实能力显隐控件 ④补齐 Observation/测量**。
