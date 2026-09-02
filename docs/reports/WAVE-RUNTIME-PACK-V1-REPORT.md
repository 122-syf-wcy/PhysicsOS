# Wave Runtime Pack V1 — 机械波：绳波 / 双源干涉 / 弦驻波

> 文件：`docs/reports/WAVE-RUNTIME-PACK-V1-REPORT.md`
> 验收日期：2026-09-02
> 前置：`CIRCUIT_RUNTIME_PACK_V1_COMPLETE`、电磁感应 / 光学 / 电路题库上线（见 `MILESTONES.md`）

## 1. 目标

Roadmap Phase 33「Remaining Physics Domains」的第一个领域。机械波与此前所有领域一样，
走同一条 Scene → Engine → Verifier → Observation → WorkspaceRuntime → Renderer → Lab →
教学层 → Question 链，不另起 Runtime：

1. **实验台契约**：一个 `WaveBench` 承载三种闭式子模型（绳上的简谐横波 / 双源干涉 /
   两端固定的弦驻波），场景只存 A、λ、f 与几何这些可编辑事实。
2. **引擎**：y(x, t) 采样、干涉判定、驻波波节全部由 `@physicsos/engine-wave` 发布，
   渲染器不算一个 sin。
3. **实验室 + 教学层**：三个实验模板、Tutor 三课、自测三套、Agent 高亮。
4. **题库**：6 道黄金题走真实 Question Runtime，Question → Lab 分支一致。

## 2. 关键决策

- **介质定波速、波源定频率**。最初的命令语义是改 f 保 λ（等于让波速跟频率变），与
  自测题「抖得更快波形变密但波不变快」矛盾。改为：绳波 / 干涉台改 f 或 v 都重推
  λ = v/f；驻波台由几何定 λ、改 v / L / n 重推 f_n = n·v/(2L)。
- **纵向放大一次声明**。5 cm 振幅在 1.2 m 绳上 1:1 是一根发丝，visual bridge 按
  「振幅 ≈ 横向长度 12%」从固定档位选一个整数倍率，写进坐标轴标签（`y / cm（×3）`）与
  读数行；所有数字保持真实值，只有墨线被拉伸。
- **不可达几何在命令层拒绝**。|r₂ − r₁| > d 的观察点在平面内不存在，
  `SetWavePathDifference` 直接返回 `WAVE_PATH_DIFFERENCE_UNREACHABLE`，实验室不会闪出
  失败帧；题面同样在 validator 拒识。
- **λ / v 二选一交给契约层**。题面给「v 与 f」或「n 与 f_n」时，scene builder 只透传规格，
  由实验台契约按 v = λf / v = 2L·f/n 折算 —— 与运行时命令维护的是同一恒等式。
- **减弱点合振幅精确归零**。cos(π(n + ½)) 的浮点残余不再以 1e-15 cm 的振幅出现在题解里。

## 3. 工作包

### A. 契约与引擎

| 文件 | 改动 |
|---|---|
| `packages/physics-units/src/unit-definition.ts` | `kilohertz` 注册 |
| `packages/physics-scene/src/scene.ts` | `WaveBench`（travelling / interference / standing）、`waveBenches?` 可选集合 |
| `packages/physics-scene/src/scene-runtime.ts` | 六条命令：`SetWaveAmplitude / Frequency / Speed / PathDifference / StringLength / Harmonic`，子模型守卫、λ / f_n 重推、`WAVE_PATH_DIFFERENCE_UNREACHABLE` |
| `packages/physics-scene/src/scene-validation.ts` | 波动台量纲与取值校验（谐波次数正整数） |
| `packages/physics-scene/src/wave/*` | `createWaveScene` 工厂、三条模板；规格接受 `waveSpeed` 替代 `wavelength`、`frequency` 替代 `waveSpeed` |
| `packages/engine-wave/*` | 三个子模型的 `resolveWaveModel`、`stateAt`（绳形每波长 16 点自适应采样、标记质点、波源 / P 点三角定位、波节 / 波腹）、11 项引擎内置校验、`interference_type` ±1/0 派生 |
| `packages/physics-observation/src/wave-observation.ts` | waveform / wave_speed / wave_superposition / wave_nodes 四类观察量 |

### B. 实验室与教学层（`overlays/harness/files/packages/client/ui-physicsos`）

| 文件 | 改动 |
|---|---|
| `scene-visual-model.ts` | `PhysicsDomainId` 增 `wave`；`waveform / waveSpeed / superposition / nodes` 观察量键；`WaveProfile / Marker / Source / Point / Node / Envelope / Front` 原语 |
| `physics/wave-visual-bridge.ts` | 引擎采样点 → 画布（cm，纵向放大声明）、λ / A / L / λ/2 / r₁ / r₂ / d 走共享 `Dimension`，横向速度箭头走共享 `Vectors` |
| `physics/wave-renderer.tsx` | 平衡线、包络、扩散波前、绳形、波节 / 波腹、波源、标记质点、按判定着色的 P 点 |
| `physics/wave-workspace-runtime.ts` | `WaveWorkspaceRuntime`：A / f / v / Δ / L / n 走真实 SceneCommand，逐帧取 `stateAt`，y–t 图与一行读数表，实验分支语义与其他域一致 |
| `physics/experiment-templates.ts` + `locales.ts` + `icons/*` + `experiment-artwork.tsx` + `chrome.ts` | 「机械波」分类、三个模板、学科色 `--physics-subject-wave`、图标与卡片插画 |
| `ExperimentPicker.tsx` / `.module.css` | 分类 Tab 与学科色列表改由 `EXPERIMENT_TEMPLATE_GROUPS` 派生（浮力 / 热学 / 电磁感应 随之出现 Tab），补齐三者 `subject-*` 类；浮力色与电路去重 |
| `physics/physics-tutor.ts` | 三课：质点只振动不迁移 / 路程差决定加强减弱（判定翻转时换问题）/ 驻波为何不传播 |
| `physics/experiment-self-checks.ts` + `question-core/experiment-self-checks.ts` | `waveTopicOf` 按画布原语（标记质点 / 波源 / 波节）解析主题；三套自测 |
| `physics/physics-agent.ts`、`physics/experimental-branch.ts`、`domain-of-scene.ts`、`LabWorkspace.tsx`、`renderer-registry.tsx` | 高亮目标、六条分支命令、域路由、Runtime 分派、Renderer 注册 |
| `QuestionWorkspace.tsx` | wave 分派：`stateAt(t)` 为当前帧、t = 0 帧为包络 |

### C. 题库（`packages/question-core`）

| 文件 | 改动 |
|---|---|
| `semantic-ir.ts` | `WaveModelId`、绳 / 波源 / 观察点 / 弦实体、`wave_speed_relation` 等关系、波动结构化字段 |
| `deterministic-wave-parser.ts` | 机械波信号 + 排除光的干涉 / 双缝 / 电磁波 / 回声；抽取 A、λ、f（或 T）、v、d、r₁ / r₂（或 Δ）、L、中文数字谐波次数；只从「求 / 判断」之后识别目标 |
| `semantic-validator.ts` | `validateWaveIR`：v = λf 三量定二、Δ 或两段路程且 |r₂ − r₁| ≤ d、驻波 L / n / v（或 f_n） |
| `wave-scene-builder.ts` | 单位换算与规格透传、只给 Δ 时把 P 放在距 S₁ 一个间距处、写入 `sourceQuestionId` |
| `question-runtime.ts` | wave 分派在感应之后、电 / 磁 / 力学之前；解答引用引擎派生量 |
| `golden-questions.ts` / `knowledge-graph.ts` / `self-checks.ts` | 6 道黄金题、「机械波」学科根 + 4 节点、六个共用探针 |

## 4. 浏览器验收 Case（`tests/acceptance/wave-acceptance.mjs`）

| Case | 场景 | 验证点 | 结果 |
|---|---|---|---|
| A | 实验库 | 「机械波」Tab 出现，模板 ≥ 38，分类下 3 个实验；浮力 / 热学 / 电磁感应 Tab 同在 | PASS |
| B | 绳上的简谐横波 | 绳形真实绘制、标记质点、λ / A 标注、`v = λf = 2 m/s · T = 1/f = 0.2 s` 读数、`y / cm（×3）`、三项引擎校验 PASS、画布 ≥ 55%、不滚动 | PASS |
| C | 时间轴 seek 0.05 s | 波形前移、标记质点 cx 不变而 cy 变化、横向速度箭头出现 | PASS |
| D | 编辑 | 改 f → revision +1、λ = 0.2 m、v 不变、T = 0.1 s；改 v → λ = 0.4 m；零振幅被拒且 revision 不变 | PASS |
| E | 双源干涉 | 两源、≥ 8 条波前、P 绿色加强、`Δ = 2 λ → 振动加强`、`A_P = 6 cm`、r₁ / r₂ / d 标注、路程差规则校验；拖 Δ 到 0.1 m → P 红色减弱、`A_P = 0 cm` | PASS |
| F | 弦驻波 | 包络两条、3 波节 2 波腹、`λ = 2L/n = 1 m · f_n = n·v/2L = 40 Hz`、L 与 λ/2 标注、L = nλ/2 与固定端波节校验；切 n = 3 → 4 波节 60 Hz；播放推进时间轴 | PASS |
| G | 试题空间 | 波动题 READY、`Wave Engine · Verified`、题解 2.0000 m/s 与 0.2000 s、题目画布绳形；「在物理世界中打开」→ wave 域 revision 0；改频率 → 实验分支徽标、revision 1、λ = 0.2 m | PASS |
| 响应式 | 绳波 1440 / 1920 | 画布 ≥ 55%、不滚动、不放大 | PASS |

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
| `wave-library-1600x900.png` | 实验库「机械波」分类 |
| `wave-rope-lab-1600x900.png` | 绳波 t = 0 |
| `wave-rope-seek-1600x900.png` | 绳波 t = 0.05 s：波形前移、质点回到平衡位置、v_y 箭头 |
| `wave-interference-lab-1600x900.png` | 双源干涉：加强点 |
| `wave-interference-destructive-1600x900.png` | 拖路程差到 λ/2：减弱点 |
| `wave-standing-lab-1600x900.png` | 弦驻波二次谐波 |
| `wave-question-1600x900.png` | 试题空间绳波题 |
| `wave-question-branch-1600x900.png` | Question → Lab 实验分支（λ = 0.2 m） |
| `wave-rope-lab-1440x900.png` / `-1920x1080.png` | 响应式 |

## 7. 测试数据

- `typecheck`（core + web）零错误。
- `test:core`：physics-scene 80（含 wave-scene-runtime 14）、engine-wave 27、physics-observation
  24（含 wave-observation 10）、question-core 399（含 wave-questions 16、learning-content 波动
  节点覆盖）全绿。
- `test:web`：26 文件 347 用例全绿（含 `wave.client.spec` 20 项：域路由、三个实验台数值与命令
  联动、观察量开关、Tutor / 自测解析、Question Space 两题、Lab 挂载）。
- `lint`：core 全绿；web 侧本切片改动的文件全绿。
- 浏览器验收：`wave-acceptance.mjs` CASE A–G + 响应式 全 PASS、5 门禁为 0。
- 回归：mechanics / electric / electric-v2 / electric-region / composite / circuit / learning /
  library-home 八套 acceptance 全 PASS。两处过时断言随产品演进更新：library-home「五色彩点」→
  十一色（分类 Tab 改由注册表派生），circuit「电路 Tab 5 个实验」→ 7 个（含两个初中测量实验）。
- overlay ↔ vendor 逐文件 0 差异；`upstream-changes.patch` 已 capture（vendor lockfile 补
  engine-induction / engine-wave 链接）。

## 8. 不做（明确边界）

- 纵波、波的反射 / 折射 / 衍射、多普勒效应（需新子模型）。
- 干涉图样的全平面强度分布（当前只判定并绘制一个观察点 P；波前用于示意）。
- 阻尼与能量耗散（理想介质）。
- Agent 波动意图（问答层）—— 与其他新域一致，Tutor 与自测先行，Agent 模型化回答仍在 backlog。
- 波动题的图片 / 波形图识别（backlog `QUESTION_IMAGE_PDF_INGEST_BACKLOG` 不变）。
