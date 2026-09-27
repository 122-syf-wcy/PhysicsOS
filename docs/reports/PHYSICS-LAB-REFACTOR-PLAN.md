# PhysicsOS 物理实验室 · 重构计划

> 日期：2026-09-28
> 状态：`PHYSICS_LAB_REFACTOR_PLAN_READY`（待并行实施）
> 输入：`docs/reports/PHYSICS-LAB-GLOBAL-AUDIT.md`（本次审计）
> 审计基线：commit `60bd660b386e41449849b698c84a21c53de71b5c`
> 前置结论：`FAKE_RUNTIME` 确诊 0、`FAKE_VERIFIED` 确诊 0；`STATIC_DEMO` 0；
> `VISUAL_ONLY_ANIMATION`（物理冒充）1；`HARDCODED_PHYSICS`（隐藏结果）0、UI 算物理 1。
> 已获 owner 授权可立即推进（渲染器重构 / 时间线 / 测量基建 / 时钟 / UI 层级 / 图标 / 动画修复）。

---

## 1. 目标

把「能跑的物理引擎 + 统一外壳」补齐为「诚实的物理运行时前端」，核心是三件事：

1. **基础设施共建共享**：时钟、能力清单、验证门禁、单位换算、测量、观测层接线、渲染契约。
2. **模型诚实性**：前端播放的运动必须来自引擎动力学；不是动力学的必须**如实标注**或补真动力学。
3. **UI 按能力显隐**：不再让所有实验长着同一套「半数列控件是灰的」工具栏。

---

## 2. 要建的共享基础设施（按依赖顺序）

### I1. `ExperimentCapabilities` manifest（最先做，其余都依赖它）

- **位置**：新增 `physics/experiment-capabilities.ts`，与 `experiment-templates.ts` 同目录。
- **内容**：为 76 个模板各声明**真实**能力（形状见审计 §7）：
  `model: 'dynamic'|'analytical'|'quasi-static'|'static'`、
  `timeline/seek/replay/editable/measurable/branchable/verifiable`（boolean）、
  `observations: string[]`、`measurements: string[]`。
- **来源**：能力值**从 Runtime/Snapshot 推导**（如 `clock.total>0 ⇒ timeline`），
  再加一个静态覆盖表修正引擎类型（`model` 字段）。避免手抄漂移：建议 derive + 少量显式 override。
- **消费方**：外壳（I2）、能力徽章、审计回归测试。
- **验收**：单测断言 manifest 覆盖全部 76 个 `EXPERIMENT_TEMPLATES` id；`model` 与 Runtime 实测一致。

### I2. 能力驱动的工具栏 / 面板显隐

- **现状**：`PhysicsWorkspace.tsx:616-662` 与 `:875-938` 无条件渲染整套 transport + timeline，
  `clock.total<=0` 时禁用 → 「同一工具栏、一半按钮没用」。
- **改法**：读 I1 的 `capabilities.timeline/seek/replay`，
  `timeline:false` 时**隐藏**整行 timeline 与播放组（而非禁用）；保留「参数编辑/复位」等仍有意义的控件。
- **验收**：`total=0` 域（如 series-circuit、plane-mirror）工具栏不再出现灰按钮；E2E 断言控件数与能力一致。

### I3. `SimulationClock` 抽象 + 精确 seek 契约

- **现状**：无 `SimulationClock` 类；`PlaybackClock` 数据接口 + rAF + 各 Runtime 私有字段；
  闭式域可精确 seek，collision 采样近似，静态域 no-op。
- **改法**：抽出 `SimulationClock`（play/pause/step/seek/reset/speed/advance），
  Runtime 通过 `stateAt(t)` 契约实现**精确重建**；对只能采样重建的（collision）在能力里标 `seek:'sampled'`。
- **验收**：同一场景 `seek(t)` 两次得到字节一致的 `SceneVisualModel`（闭式域）；collision 记录采样容差。

### I4. Provenance 门禁接进渲染路径（修 P0-2）

- **现状**：`assertVerifiedPhysicsOutput`（`packages/physics-core/src/provenance.ts:376`）只接在
  `agent-tools/src/physics-tool-runtime.ts:305`；UI 仅按 `simulation.verification.status` **字符串**判级
  （`physics/verified-result.ts:67-70`、`PhysicsWorkspace.tsx:377-382`）。
- **改法**：Runtime 在产出 `verification` 前调用 `assertVerifiedPhysicsOutput(values, 'RULE_VERIFIED')`
  （或对每个产品数值带 `QuantityProvenance`）；徽章等级由 `deriveVerificationLevel` **从证据回推**，
  空 checks 一律降级 `UNVERIFIED`。删除/收窄 `LEVEL_BY_STATUS` 的字符串映射。
- **验收**：构造「status=passed 但 checks=[]」的伪造结果，UI **不得**显示已验证（新增回归门禁测试，
  参考 `packages/agent-tools/tests/product-provenance-invariants.test.ts`）。

### I5. Observation 层全接线（修 P1-2）

- **现状**：`packages/physics-observation` 有 7 模块，UI 只用 4 域（mechanics/electric/composite/magnetic）。
- **改法**：为 circuit/induction/optics/wave 的 Runtime 接入对应 `*-observation.ts`；
  thermal/fluid/acoustics/modern 视需要补模块或明确「不适用」并写进能力清单。
- **验收**：每个域的 `observations` 来自 observation 层而非桥内联计算。

### I6. 单位换算集中化（修 P1-4）

- **现状**：`cm=m*100` 等散落在 7 个 visual-bridge + 2 个 runtime（约 10 处）。
- **改法**：在 `packages/physics-units` 或 UI `physics/units-display.ts` 提供
  `toDisplayValue(q, displayUnit)`；桥只声明展示单位，不做裸乘。
- **验收**：grep 断言 physics 目录不再出现 `* 100`/`*100` 的裸换算（白名单例外注明）。

### I7. 测量工具基建（修 P1-3）

- **现状**：`measurementDefinitions` 在场景里，UI **无**任何交互测量工具。
- **改法**：新增测量工具层（游标卡尺/量角器/停表/伏安表读数），消费 `measurementDefinitions` +
  `SceneVisualModel`，产出可读数值（走 I6 单位）；先在 2~3 个实验试点再铺开。
- **验收**：试点实验能拖拽测量并读出带单位的验证值。

### I8. 渲染契约显式化（可选，收敛 I1/I3 后）

- **现状**：`RENDERERS`（`renderer-registry.tsx:1236`）是 11 个 React 组件的域级映射，
  契约是 `RendererProps`。审计确认无 `canRender/buildVisualModel/render`。
- **改法**：**不必**强行改成三方法；建议保留但**形式化**为
  `{ canRender(view): boolean; buildVisualModel(sceneOutput): SceneVisualModel; Component }`，
  把当前「注册表内再分流 per-bench」的逻辑收敛到 `canRender`，便于测试与新增域。
- **验收**：新增一个 bench 无需改 `PhysicsWorkspace`；`canRender` 单测覆盖所有 bench。

---

## 3. 模型诚实性修复（P0）

### R1. lever：如实标注 or 补真动力学（P0-1）

- **现状**：力矩平衡是真引擎（`engine-lever/src/statics.ts:50-63`），旋转是显示斜坡（`statics.ts:72-83`），
  冒充转动动力学。
- **方案 A（诚实标注，快）**：`model='quasi-static'`；UI 把「运行」改为「显示倾斜趋势」，
  能力清单标 `model:'quasi-static'`，文案说明「本模型为静力学，倾角为力矩差的示意」。
- **方案 B（补真动力学，慢）**：引入 `τ=Iα`、`ω(t)`、`θ(t)`，`I` 与阻尼作为模型参数，加终止条件
  （θ 到限位/接触）。Verifier 增加角动量/能量守恒检查。
- **推荐**：先 A 落地，再评估 B（教材初中杠杆普遍是静力学，A 已足够诚实）。

### R2. apex 事件移回引擎（P0-3）

- **现状**：`mechanics-view-builders.ts:758` 视图构建器自算 `apexTime=vy0/g`。
- **改法**：由 `engine-mechanics` 在 `simulate()` 里输出 `apex` 事件；视图层只映射，不再计算。

### R3. UI g 兜底收敛（P1-6）

- `mechanics-view-builders.ts:255` 的 `: 9.8` 改为从场景重力场**必取**（缺失即视为场景错误），
  或统一走 `model-resolvers` 的同一默认值，避免「UI 与引擎两处默认」。

---

## 4. 按域迁移顺序（每域一小步，可并行）

排序原则：**先修共享链路（I1–I4），再按「引擎成熟度 × Observation 就绪度 × 教学权重」推进。**

| 批次 | 域 | 实验数 | 做什么 | 依赖 |
| --- | --- | --- | --- | --- |
| **B0** | 全量 | 76 | I1 能力清单 + I2 工具栏显隐 + I4 provenance 门禁（横向，先落地） | — |
| **B1** | mechanics | 24 | R1(lever) + R2(apex) + I3 seek 精确化(不含 collision) + 测量试点 | I1–I4 |
| **B2** | composite | 6 | Observation 已就绪；补测量 + 能力清单校准 | B0 |
| **B3** | circuit | 8 | Quasi-static 时间线诚实化（滑变扫描标注）+ Observation 接线 + 开关/滑变测量 | I5 |
| **B4** | electric | 4 | Observation 接线（已有）+ point-charge 静态标注 + 测量 | I5 |
| **B5** | induction | 5 | Observation 接线 + transformer 静态标注 | I5 |
| **B6** | wave | 7 | Observation 接线 + 测量（波长/频率） | I5 |
| **B7** | optics / light | 6 | 静态标注 + 几何光学测量（焦距/物距） | I6 |
| **B8** | fluid / pressure | 4 | 静态标注 + 压强测量 | I6 |
| **B9** | thermal / thermometer | 4 | 加热曲线事件轴 + 温度测量 | I5 |
| **B10** | acoustics / noise | 2 | echo 事件轴 + 声级测量 | — |
| **B11** | magnetic / current | 5 | current 静态标注 + 磁场测量；magnetic-circular 分支接线 | I5 |
| **B12** | modern | 1 | photoelectric 静态曲线标注 + 阈值频率测量 | I6 |

---

## 5. 验收与回归门禁

1. **能力一致性测试**：`ExperimentCapabilities` 覆盖 76 个 id；对每个模板，manifest 声明与实际
   `WorkspaceSnapshot`（timeline/events/charts/branch）逐项断言。
2. **provenance 反例门禁**：伪造 `status=passed, checks=[]` 不得点亮已验证（I4）。
3. **时间线契约测试**：声明 `timeline:true` 的实验，`clock.total>0`；`seek(t)` 幂等（闭式域字节一致）。
4. **工具栏契约测试**：控件数量与 `capabilities` 一致（无「可见但禁用」的整组控件）。
5. **单位测试**：`toDisplayValue` 覆盖各展示单位；grep 禁止裸 `*100` 换算。
6. **模型标注测试**：`model!=='dynamic'` 的实验，UI 不得出现暗示动力学的文案/动画（重点 lever）。

---

## 6. 风险与不可逆项

- **不触碰**：`PhysicsScene` schema 的破坏性变更（owner 视为不可逆项）；生产部署（另有旧提交在跑）。
- **本计划不包含**：删除用户数据、DB 迁移、破坏公共 API、下线生产功能。
- **注意**：`packages/exam-standard/**`、`tool-physicsos/**`、`ui-physicsos/**` 有其他 agent 并行编辑，
  本计划实施时需按文件分工，避免同文件并发写。
