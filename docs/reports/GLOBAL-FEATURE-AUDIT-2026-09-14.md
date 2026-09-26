# PhysicsOS 全局功能审计与优化建议（2026-09-14）

> 产出方式：8 个只读审计子代理分域盘点，每条发现再由独立子代理**对抗性复核**（默认判伪，
> 复核方必须自己打开被引文件核对）。60 条原始发现中 28 条通过、32 条被驳倒。
> 被驳倒的条目未写入本报告，避免制造假问题。
>
> **事主已亲自复核的两条（其余为子代理结论，采用前请按同样方式抽查）**：
>
> - P0-1 匀加速黄金题忽略题给时间：`mechanics-scene-builder.ts:65-68` 确未读 IR 的 `time`，
>   `mechanics-engine.ts` 的 `computeSimulationDuration` 对 `uniformly_accelerated_motion` 确为硬编码
>   `return 10`；`mechanics.test.ts` 两个用例标题写着 "should compute v=20 m/s" / "s=75 m"，
>   断言却只有 `toBeDefined()`——**这两条测试不可能失败**，所以缺陷一直没被拦住。
> - P0-3 平行板偏转距离偏大：引擎确实发布了正确的 `deflection`（`electric-region-engine.ts:561-573`，
>   取"出场时的 y"），而解法层 `question-runtime.ts:678-696` 改用 `displacement_vector.y`，
>   同时界面上展示的公式恰是 `y = 0.5 × (qE/m) × t²`（板内偏转公式）——**答案与同卡公式自相矛盾**。
>
> ⚠️ 这些是**物理答案正确性**问题，不是样式问题，优先级高于本次 UI 美化。

---

# PhysicsOS 实验工作室 · 优化报告（只读审计）

> 说明：本报告基于已通过对抗性验证的**确认发现**汇总而成。任务输入提供的确认清单在我这一侧于第 25 条（报告面板暗色对比）处**被截断**（该条 verdict 文本亦在末尾断裂），因此本报告覆盖**已收到完整证据的 25 条**；清单声称共 28 条，其余 3 条与输入一并缺失，本报告**不予补造**。已驳斥的 32 条仅在「证据不足/未验证」中保留其中暴露出的真实残留缺口。
>
> 代码来源记录为 `overlays/harness/files/...`（叠加源）；经核对 `packages/client/ui-physicsos` 两树一致。根 `packages/` 为引擎代码。本项目正处于 "experiment studio polish" 中：Task 1（工作台/实验中心）、Task 2（各学科画布与器材精灵）、Task 3（电路直接操作 + 回归）已完成或测试转绿；下列确认发现均**未被这三项在途工作覆盖**，但实现时请顺带折入。

---

## 1. 结论摘要（下一步最值得做的 5 件事）

1. **修匀加速黄金题**：把题目 IR 的 `time` 接到引擎 `endTime`，否则 mech-01/06 末速度答成 30/40 m/s（应 20/30），且改测试为数值断言。
2. **修斜抛黄金题**：缺省发射高度应为地面 0、`vx = v0·cosθ`，否则 mech-03 的「最大高度/飞行时间/射程」三问全错却显示"验证通过"。
3. **修平行板偏转距离**：解法层改用引擎已发布的 `deflection` 派生量，让学生看到的偏转距离从 7.96×10⁻³ m 回到正确的 2.811×10⁻³ m。
4. **修牛二合力题 + 比较类题**：水平合力题不应再叠加未平衡重力（a 答成 11 而非 5）；`electric-16/17/18` 应识别为 `UNSUPPORTED_MODEL` 或输出双解，而非假装"已完成求解"。
5. **收敛中英双语**：让 runtime 只产出稳定 id、由 UI 层走既有 `t()`（先补 electric/mechanics/magnetic 三条主链路），并让学生能看到 AMBIGUOUS 题的具体歧义文案。

---

## 2. 分优先级的优化建议

### P0 — 正确性 / 用户可见缺陷（错误答案）

#### P0-1 匀加速黄金题忽略题目给定时间，引擎固定按 10 s 求解

- **现象**：mech-01「运动 5 s」、mech-06「运动 5 s」的学生读数与题设不符。
- **证据**：`packages/question-core/src/golden-questions.ts:271,311`；`packages/question-core/src/mechanics-scene-builder.ts:65-68`（匀加速分支只传 velocity/acceleration，从未读 `getKnown(ir,'time')`）；`packages/physics-scene/src/mechanics-scene-factory.ts:210`（`options: {}`）；`packages/engine-mechanics/src/mechanics-engine.ts:224-226`（`computeSimulationDuration` 对 `uniformly_accelerated_motion` 硬编码 `return 10`）；只读实测 mech-01 `final_velocity=30`、`displacement=(200,0,0)`。
- **影响**：末速度/位移给出错误答案（应为 20 m/s、75 m）；`packages/engine-mechanics/tests/mechanics.test.ts:65-72` 仅断言 `toBeDefined` 无法拦截；`docs/reports/MECHANICS-RUNTIME-PACK-V1-REPORT.md:153` 记载的 `v=20, s=75 ✓` 与实测矛盾，说明是偏离既定意图的缺陷。
- **建议**：把 IR 的 `time` 已知量经场景/请求 `options.endTime` 传给引擎并按之求解；把 `mechanics.test.ts:65-72` 从 `toBeDefined` 改为数值断言。（`:301-314` 直接传 `t=5` 的回归用例不受影响。）
- **工作量**：S–M

#### P0-2 斜抛黄金题发射点默认 20 m 高、水平分量误用合速度，三问全错

- **现象**：mech-03「初速度 20 m/s，抛射角 30°」的作答三项均错。
- **证据**：`packages/question-core/src/mechanics-scene-builder.ts:42`（`height = getKnown(ir,'height') ?? 20`）、`:46`（`horizontalSpeed = getKnown('horizontal_speed') ?? velocity`）、`:70`（`horizontalSpeed > 0 ? horizontalSpeed : velocity*cosθ` 因回退恒取合速度，cosθ 为死代码）；`golden-questions.ts:285-290` `expectedValidation:'VALID'`；实测 `body.position=(0,20,0)`、`flight_time=3.236`（应 2）、`max_height=25`（应 5）、`range=64.72`（应 34.64）。
- **影响**：三问答案全错，UI 仍显示"验证通过"（`QuestionWorkspace.tsx:1668`）；对比 mech-02 明写"从 20 m 高处"，说明 20 是斜抛误用的缺省。
- **建议**：斜抛缺省发射高度取 0；`vx` 由 `v0·cosθ` 计算（除非题干显式给水平分速度）；补数值断言。现测试仅断言存在（`mechanics.test.ts:109-116`），改动不破坏测试。
- **工作量**：S

#### P0-3 平行板题的"偏转距离"答案比正确值大约 2.8 倍

- **现象**：electric-10/11/16/18 展示的偏转距离与同卡公式自相矛盾。
- **证据**：`packages/question-core/src/question-runtime.ts:682-696`（有界电场分支取 `displacement_vector.y` 作 deflection）；`packages/engine-electric-region/src/electric-region-engine.ts:561-576,970`（引擎另发布正确 `deflection = 出场时 y`）；`packages/question-core/src/electric-scene-builder.ts:240-241` + engine `:920-923/933`（`endTime=traverseTime*2`，查询时粒子已出场，故 `displacement_vector.y` 含出场后匀速段）；实测 electric-10 引擎 `2.81e-3` vs solution `7.96e-3`（比值 2.83）。
- **影响**：学生看到的偏转距离偏大约 2.8 倍，与同卡公式 `y=0.5×(qE/m)×t²` 冲突；受影响 `golden-questions.ts` 的 electric-10/11/16/18。
- **建议**：有界电场分支改用引擎发布的 `deflection` 派生量（缺失时再回退 `displacement_vector`）；同时把 `packages/question-core/tests/electric-questions.test.ts:371-373` 的断言改为读 `deflection` 并把精度从 `-2` 收紧到真正约束数值（如 `-5`）——注意必须先改断言指向否则会失败。
- **工作量**：S

#### P0-4 牛二黄金题把重力叠加进"水平合力"题，加速度答成 11 m/s²

- **现象**：题述"水平合力 10 N"，学生得到 a=11、F=22。
- **证据**：`packages/physics-scene/src/mechanics-scene-factory.ts:144-157`（`newton_second_law` 无条件追加 `force-gravity`+`force-normal`，`:45` 默认重力 `(0,-9.8,0)`）、`packages/question-core/src/mechanics-scene-builder.ts:76-82`；`packages/engine-mechanics/src/models/model-resolvers.ts:206-230`（`force-normal` 从未计入，无法抵消重力）；`question-runtime.ts:841-846`（取加速度矢量模长）；实测 `net_force=(10,-19.6,0)`→22 N、`acceleration=(5,-9.8,0)`→11 m/s²。
- **影响**：牛顿第二定律题给出错误加速度（11 而非 5）与错误合力（22 而非 10）；`mechanics.test.ts:128-131` 用例名为 "a = 5 m/s²" 却只断言 `toBeDefined`。
- **建议**：题述"水平合力/合力"时不再注入未平衡重力（或让支持力与重力配对抵消后取水平分量）；测试改为数值断言。
- **工作量**：S

#### P0-5 比较类黄金题标为 VALID，实际只输出单粒子单值

- **现象**：electric-16/17/18 要求"比较两者/两种板长"，运行只解出一个数。
- **证据**：`packages/question-core/src/golden-questions.ts:239,248,257` 均 `expectedValidation:'VALID'`；`packages/question-core/src/deterministic-electric-parser.ts:602-611,510-522`（速度/电荷/质量/板长均取首个匹配，electric-17 只取电子）；`electric-scene-builder.ts:200-236`（只建单个 `particle-1`）；`question-runtime.ts:356` 返回 `READY`；`QuestionWorkspace.tsx:212`（"已完成求解"）、`:1182`（"条件完整"徽标）；全仓无任何"比较/多情形"处理。
- **影响**：题目被当"验证通过/已完成求解"，实际未回答；`golden-questions.test.ts:16-26` 对 VALID 只校验 `validation.status`，不校验 targets 是否被解答。与 `docs/08-QUESTION-PIPELINE-ARCHITECTURE.md:304-313`（#18 禁止静默猜测）冲突，说明非有意设计。
- **建议**：把"比较/多情形"识别为 `UNSUPPORTED_MODEL` 或输出两次求解的对比结果，并为这三个 id 补数值/语义测试。
- **工作量**：M

---

### P1 — 真实摩擦 / 风险（不产生错误物理，但明显损失体验或潜在崩溃）

#### P1-1 AMBIGUOUS 题的具体歧义在 UI 中永不呈现

- **现象**：选中"缺少电荷正负"或 comp-08 时只见泛化文案。
- **证据**：`packages/question-core/src/semantic-validator.ts:144-167`（歧义仅入 `ambiguities`，`issues` 为空）；`overlays/.../QuestionWorkspace.tsx:1751-1754`（`validationMessage` 只读 `issues[0]`）、`:1229-1237`、`:1653-1661`；反证 runtime 有精确文案（`semantic-validator.ts:147`）；唯一展开歧义处为 `packages/agent-tools/src/physics-tool-runtime.ts:419-423`（含 options），UI 未用；实测 06-missing-charge-sign `issues=[]`+`ambiguities=['chargeSign']`。
- **影响**：学生不知道缺电荷正负还是磁场方向，无从补充；08-parallel-velocity 同样只显示泛化文案。
- **建议**：在 ResultSummary 与"验证详情"里当 `issues` 为空时渲染 `result.validation.ambiguities` 的 message（含 options 可选按钮）。
- **工作量**：S–M

#### P1-2 wave 学科「波速读数」勾选对画布完全无效

- **现象**：勾选/取消「波速读数 v = λf」，波形、矢量、读数栏无任何变化。
- **证据**：`overlays/.../physics/wave-visual-bridge.ts:55-71`（映射出 `waveSpeed`，但全仓无读取点）；`wave-renderer.tsx:115/232/318/338`（只读 `waveform/nodes/superposition`）；`wave-visual-bridge.ts:255-258`（`v = λf` 读数无条件写入 readout）与 `PhysicsCanvas.tsx:516-553`（无条件绘制）；`packages/physics-scene/src/wave/wave-scene.ts:235-238`（该 observable 默认 visible:true，故三 wave 台都出现勾选框）。
- **影响**：一个可见的开关是死的，点了没反应（不会错、不崩、不改数据，仅交互一致性受损）。
- **建议**：优先方案 A —— 让 bridge 用 `visible.waveSpeed` 门控含 `v = λf` 的那行读数（默认仍 true）。**避免**方案 B「从场景移除该项」：会打破 `packages/physics-scene/tests/wave-scene-runtime.test.ts:65-68` 对 observable id 列表的断言。
- **工作量**：S

#### P1-3 induction 学科「感应电动势」「磁通量」勾选对画布无效

- **现象**：勾选 emf/flux 时，场 box 与 `E/-dΦ/dt` 读数均不变；「双棒速度」是死标签。
- **证据**：`packages/physics-scene/src/induction/induction-scene.ts:188-217`（emf/current/flux 默认 visible:true）；`overlays/.../physics/induction-workspace-runtime.ts:65-70,363-375`（树暴露 4 个勾选框）；`induction-renderer.tsx:162,298,341`（只读 `view.visible.barMotion` 与 `inductionCurrent`）；`induction-visual-bridge.ts:51-58`（写入 emf/flux 但无消费者，全模型无带 observable 的矢量）、`:44-47`（`keyOf` 不产 `barVelocity`，故 `:70` 标签永不使用）。
- **影响**：两个树内可点开关对画布零影响；`docs/15-RUNTIME-ARCHITECTURE.md:130-133` 要求图层开关必须被消费，非有意留白。
- **建议**：为 emf/flux 指定可见物（电压表读数/磁通量标注）并在渲染器按 visible 门控；或从树与场景中移除这两个 observable 定义。现测试无相关用例，加门控不破坏测试。
- **工作量**：S–M

#### P1-4 magnetic 学科「推导」「事件」页签恒空，且画布无悬停/寻迹/频闪

- **现象**：磁场圆轨道是动画场景，却无轨迹读数、不能点击寻迹、无频闪残影；「推导」「事件」两页签恒为占位。
- **证据**：`overlays/.../physics/magnetic-workspace-runtime.ts:241`（`derivation: []`）、`:243`（`events: []`）、`:245`（`trajectoryTimes: []`，且该 return 为唯一成功路径）；`PhysicsCanvas.tsx:238-241`（`interactive` 需 `trajectoryTimes` 长度匹配，空数组使 hover`:270`/seek`:293`/频闪`:308` 全短路）；对比 `mechanics-workspace-runtime.ts:53/55/57` 正常供应；其余学科成功路径亦均从 `derivedQuantities` 供 derivation（electric:465、wave:285、circuit:340 等）。
- **影响**：同类动画学科均可交互，唯独 magnetic 不可；「推导」页签恒空。可达：`LabWorkspace.tsx:226-227` 派发到该 runtime，模板 `experiment-templates.ts:488` (`magnetic-circular`)。
- **建议**：磁桥已有 `data.samples`，据此填 `trajectoryTimes`（并补一条推导 `r=mv/qB` / `T=2πm/qB`）；若磁场景确无离散事件则隐藏「事件」页签。现测试仅断言 view 的 particles/vectors/field 与表格数值，改动不破坏。
- **工作量**：M

#### P1-5 实验室工作台文案绕过 locale 表，切英文后检查器/场景树/读数仍为中文

- **现象**：英文模式下属性/读数/校验面板、场景树、可观察量、事件标签仍为中文，界面中英混排。
- **证据**：`overlays/.../physics/electric-workspace-runtime.ts:575/577/584/591`（直接产中文 label/title，经 snapshot.inspector 进面板）；`mechanics-workspace-runtime.ts:44`；`physics-runtime-bridge.ts:299,626`；`workspace-parts.tsx:322`（`{section.title}`）、`:385`（`{check.label}`）未过 `t()`（`:156/:90/:645/:681` 同）；`locales.ts:119`(`lab.group.derived`)、`:58`(`lab.observables`) 为死键。
- **影响**：语言切换只译了工具栏与少量外壳。
- **建议**：让 runtime 只产稳定 id，在 `workspace-parts`/renderer 层用既有 `t()` 映射（先补 electric/mechanics/magnetic 三条主链路）。
- **工作量**：L

#### P1-6 AI 助教抽屉的标签与回答正文全部硬编码中文

- **现象**：切英文后助教卡片标题、依据 chips、建议问句、回答正文、操作按钮全为中文。
- **证据**：`AgentDrawer.tsx:205/211/217/242`（问题/分析/操作）、`:308`（高亮：/设置）、`:324-343`（`PARAMETER_LABELS` 全中文）；生成正文来源 `physics-agent-answers.ts`（478 处 CJK）与 `physics-tutor.ts`（593 处 CJK）无 locale 通道；`matchIntent` 为中文关键词正则（`physics-agent-answers.ts:1516-1584`）。
- **影响**：实际不可用（注：依据/intro/unknown 及 TutorCard chrome 已用 `t()`，故非"仅标题被译"，但生成式正文确无英文来源）。
- **建议**：把结构化标签（问题/分析/操作/高亮/设置/参数名）抽到 locales；对生成式正文做 locale gate（EN 下给英文模板或标注 zh-only），先覆盖按钮与标签。zh 下 `t()` 解析到中文，不破坏 `physics-agent.client.spec.tsx:253,255`。
- **工作量**：M–L

#### P1-7 试题空间硬编码了本已存在的 locale 键

- **现象**：英文模式下"求解目标/已知条件/等待解析/可视化验证/条件完整"等仍为中文。
- **证据**：`overlays/.../QuestionWorkspace.tsx:1164`(`title="求解目标"`)、`:1173`(`"物理关系"`)、`:1151`、`:1171`、`:1179-1180`、`:1182`、`:1449`；`locales.ts:312`(`questions.knowns`)、`:313`(`questions.targets`) 已定义却全仓无 `t()` 引用（死键）。
- **影响**：既有翻译键永不被使用，英文模式区域仍是中文。可达：`LabWorkspace.tsx:133` 渲染该组件。
- **建议**：改用 `t('questions.targets')`、`t('questions.knowns')` 等既有键，并为标题/空态新增 `questions.targetsEmpty` 类键。
- **工作量**：S

#### P1-8 相对时间与知识点推断中文写死

- **现象**：「最近空间」列表与「继续上次实验」卡片在英文界面仍显示「3 分钟前」及中文知识点。
- **证据**：`overlays/.../workspaceMeta.ts:32-39`（'刚刚/分钟前/小时前/天前'，`:39` 固定 `toLocaleDateString('zh-CN')`）、`:12-20`（返回 '电磁学/磁场与洛伦兹力' 等）；使用点 `HomeActions.tsx:137,150-156`、`ExperimentPicker.tsx:223`、`RecentSpaces.tsx:59`、`LearningRecordWorkspace.tsx:122`。
- **影响**：英文界面出现中文相对时间与知识点；英文标题不匹配中文正则，恒返回中文兜底。
- **建议**：改用 `Intl.RelativeTimeFormat`/`Intl.DateTimeFormat`（当前 locale）；subject/topic 走 `t()`。保留 zh 默认以兼容 `overlay.client.spec.tsx:211,249-253`。
- **工作量**：S–M

#### P1-9 校验/自测状态词硬编码，中英混排

- **现象**：英文模式出现中文状态词，中文模式又混入 `PASS/FAIL`。
- **证据**：`workspace-parts.tsx:387`（'通过'/'警告'/'未通过'）、`:403`('场景结构')、`:406`、`:415`；`LabSelfCheckCard.tsx:157,161`（`PASS`/`FAIL`/'警告'/'建议复习'）；`TutorCard.tsx:119`；`LearningRecordWorkspace.tsx:41-45,119`（概念/方向/建模错误）。对照已有本地化：`PhysicsWorkspace.tsx:229-230` 与 `QuestionWorkspace.tsx:1597` 已走 `t()`。
- **影响**：观感级中英混排（题库/讲稿/知识点标签均为中文 DATA，本已大量中文）。
- **建议**：统一走 `t()`，**新增** `lab.status.passed` 等键（`zh='PASS'`）而非简单复用 `questions.verified`（其 zh='已验证'，会破坏 `tests/learning.client.spec.tsx:173` 的 '… · PASS' 断言）。
- **工作量**：S–M

#### P1-10 AI 助教抽屉不是键盘模态：无 Esc、焦点不归还

- **现象**：键盘/AT 用户打开助教后 Esc 关不掉，点关闭后焦点丢到 body。
- **证据**：`overlays/.../AgentDrawer.tsx:144`（`<aside aria-label>`，无 Esc、无 `.focus()`）；打开抽屉时触发按钮被卸载（`PhysicsWorkspace.tsx:414`），`onClose` 仅 `setAgentOpen(false)`（`:607-616`），不归还焦点。
- **影响**：可复现的键盘可达性粗糙边；close 按钮仍可 Tab 到达。
- **建议**：复用 `ResponsiveInspector` 的 Esc/焦点模式（`ResponsiveInspector.tsx:42-47,89-91`）。**注意**：不要加 `role="dialog"`/`aria-modal` —— 该抽屉是非模态侧栏（无 backdrop），`tests/workspace-presentation.client.spec.tsx:104` 已断言其角色为 `complementary`，改成 dialog 会破坏测试且语义错误。
- **工作量**：S

#### P1-11 persistProfile 未包 try/catch，配额超限时档案切换静默失败

- **现象**：`localStorage` 写入抛错时档案 chip 停在旧档案、store 不更新、产生未处理 Promise rejection。
- **证据**：`overlays/.../profile-store.ts:63-65`（`storage?.setItem` 无 try/catch）；`:123-127`（`select()` 先在 `:124` 写 localStorage 再更新 store）；`PhysicsProfileSeat.tsx:71-74`（`void select(id)` 无 catch）。对照同包惯例：`ExperimentPicker.tsx:99-104`、`learning-record-store.ts:87-91`、`surface-store.ts:121-125` 均已包 try/catch。
- **影响**：配额超限（同源还存场景 JSON，真实可达）时静默失败，`state.error` 也不设置，用户无反馈。
- **建议**：`persistProfile` 包 try/catch（写入失败仅记录不阻断 UI），`select()` 捕获异常写入 `state.error`，与 `apply()` 一致。生产以 `globalThis.localStorage` 构造（`index.ts:173`），无 storage 的测试不受影响。
- **工作量**：S

#### P1-12 学习记录读出未校验 knowledge 数组，畸形容错崩溃

- **现象**：localStorage 中一条缺 `knowledge` 的记录，会让"学习记录"页整页崩（`for...of undefined`）。
- **证据**：`overlays/.../learning-record-store.ts:54-58`（filter 未校验 knowledge）、`:111`（`for (const nodeId of attempt.knowledge)` 无兜底）；`LearningRecordWorkspace.tsx:57`（渲染体同步调用）；同类崩溃也波及 `experiment-recommendations.ts:132`。
- **影响**：仅本地存储被篡改/损坏时触发（两条写入路径 `LabSelfCheckCard.tsx:79`、`QuestionWorkspace.tsx:1295` 始终写数组，schema 自首次提交即要求），正常使用不可达，故属低危。
- **建议**：`readStored` 的 filter 增加 `Array.isArray(entry.knowledge)` 条件（或 `attempt.knowledge ?? []` 后再迭代）。
- **工作量**：S

#### P1-13 报告面板状态色在暗色主题下对比不足

- **现象**：暗色主题下报告里 PASS 深绿 / FAIL 琥珀贴在深底上对比不足，与同文件其余状态色风格不一致。
- **证据**：`overlays/.../LabWorkspace.module.css:2530`（`.reportCheckStatus{color:#047857}`）、`:2534`（`li[data-status='FAIL'] ... {color:#b45309}`）直接压在 `.reportPanel` 的 `var(--dsw-alias-bg-base)` 上；同文件 `:2325/:2336/:2380` 同类色均写作 `color-mix(in srgb, ..., var(--dsw-alias-label-primary))` 随主题变亮；`vendor/.../ui-theme/.../design-platform.css:249` 暗色把 `--dsw-alias-bg-base` 设为 bluish-950；实测暗色底约 `rgb(21,21,23)`，裸色对比约 3.3/3.6:1，低于 AA。
- **影响**：暗色下状态字对比不足，视觉不一致。
- **建议**：与 `:2325` 一致改为 `color-mix(in srgb, #047857 50%, var(--dsw-alias-label-primary))`（FAIL 同理），随主题自适应。
- **工作量**：S

---

### P2 — 打磨 / 机会（低危、用户几乎无感或纯代码卫生）

#### P2-1 「43 所有实验」与网格实际渲染的 44 张卡片不一致

- **现象**：同屏两个数字对不上——网格与各学科 shelf 徽标合计 44，顶部/页脚却写 43，标签字面是"所有实验"。
- **证据**：`ExperimentPicker.tsx:246-247`、`:474-476`（渲染 `SELECTABLE_TEMPLATE_COUNT`）+ `:413`（shelf 徽标=该组模板数）+ `:417-431`（comingSoon 卡片仍以 disabled 渲染）；`locales.ts:246`（`lab.template.picker.allTemplates`='所有实验'）；`experiment-templates.ts:978`（cyclotron 唯一条 `comingSoon:true`）、`:1146-1148`（`SELECTABLE_TEMPLATE_COUNT=43`）。
- **影响**：逐个数卡片的用户会以为漏算。
- **建议**：二选一——把标签改成"可用实验"并在 43 旁注明"另有 1 个即将支持"，或计数含 comingSoon 显示 44。包内无相关测试。
- **工作量**：S

#### P2-2 未被引用的重复 mechanics 模板注册表 `mechanics-templates.ts`（死代码）

- **现象**：存在第二套 mechanics 清单，与 `experiment-templates.ts` 重复 6 个模板。
- **证据**：`overlays/.../physics/mechanics-templates.ts:49`（`MECHANICS_TEMPLATE_GROUPS`，kinematics/projectile/dynamics）；全仓 grep 无任何 import；`locales.ts:134-136`（zh）/`526-528`（en）三个 group 键仅被该死文件引用（孤儿文案）；文件仅在 `3766c5e` 加入后未再改动。`:45-48` 的固定 sceneId 正是 `experiment-templates.ts:148-150` `stampId` 要规避的旧写法。
- **影响**：维护者若改到死文件，界面毫无变化，且要额外排查三个孤儿 locale 键（用户零感）。
- **建议**：删除 `mechanics-templates.ts`，移除 `locales.ts:134-136`（及 en 对应）三个孤儿 group 键，明确 `experiment-templates.ts` 为唯一来源。
- **工作量**：S

#### P2-3 ExperimentPicker 顶部文档注释仍写「38 templates」

- **现象**：注释与实现漂移。
- **证据**：`ExperimentPicker.tsx:12`（"…so 38 templates read as eleven short shelves…"）；与 `docs/reports/MILESTONES.md:422` 历史值 38 同源。
- **影响**：后续维护者误判目录规模（以为 38 个）。仅涉注释。
- **建议**：更新为 43（可创建）/44（含即将支持），或去掉具体数字。
- **工作量**：S

#### P2-4 ExperimentTemplate.icon 字段与约 35 个图标 import 从未被渲染

- **现象**：每个模板携带一个永不渲染的 React 组件引用。
- **证据**：`overlays/.../physics/experiment-templates.ts:126`（声明 icon）、`:55-92`（import 35 个图标）、44 处逐条赋值；全仓无 `template.icon` 消费点，选择器卡片走 `ExperimentPicker.tsx:433-434` 的 `<ExperimentArt/>`。
- **影响**：可清理的死数据/import。
- **建议**：删除 icon 字段与相关 import；若为预留契约，加一行注释说明消费方尚未接入。（注：所导入图标中部分另为 `physics-icons.tsx:614` SCENE_TREE_ICONS 的键值，删除时勿误删此处使用。）
- **工作量**：S

#### P2-5 机械波 wave-travelling 标注为「初中」，与同组其他模板不一致且存疑

- **现象**：`wave-travelling` 为 `stage:'junior'`、tags 含 '初中'/'v = λf'，同组 `wave-interference`/`wave-standing` 均为 senior。
- **证据**：`overlays/.../physics/experiment-templates.ts:1081,1085`（junior + '初中'）、`:1096,1100`/`:1112,1116`（senior/'高中'）、`:1087-1088`（注释自述建立 v=λf）、`:109-112`（junior 覆盖例举未含机械波/波速）；`ExperimentPicker.tsx:161`（stage 驱动初中/高中筛选，故初中生会看到 v=λf 内容）。
- **影响**：若判定有误，初中筛选会混入超前内容。仓库内无课标依据（**存疑项**）。
- **建议**：对照课标复核；若 v=λf 属高中，将 `wave-travelling` 归入 senior。测试只断言 stage 合法与数量下限（`overlay.client.spec.tsx:808-828`），改判不破坏。
- **工作量**：S

#### P2-6 electric 学科「电势/能量/几何标注」标签不进树、可见位无消费者

- **现象**：侧栏看不到电势/能量/几何标注开关。
- **证据**：`overlays/.../physics/electric-workspace-runtime.ts:122-140`（`OBSERVABLE_LABELS` 定义三项，但 `observableKeyOf` 对这三类 return undefined，永不进树）；`electric-visual-bridge.ts:131-132`（算 `visible.potential/energy` 但无消费者）。
- **影响**：属低危清理（注：画布 Δφ/K 读数**确由**观测层消费并被场景 observable 的 visible 位门控——Lab 模板默认 potential=false 不显示 Δφ，仅试题场景 potential:true 显示——"画布不消费"之说已被更正）。
- **建议**：为三项在树中建节点并让读数按其 visible 门控；或删除这三项 `OBSERVABLE_LABELS` 与可见位，收敛为与树一致的 5 项。
- **工作量**：S

#### P2-7 零散硬编码：不支持场景提示、画布 aria-label、下载文件名

- **现象**：英文模式下屏幕阅读器读出的画布名是中文"…的可验证物理画布"，不支持场景提示、下载文件名后缀也是中文。
- **证据**：`LabWorkspace.tsx:173-174`（不支持提示，`domainOfScene` 返回 'unsupported' 时触发）；各 runtime 的 `${title}的可验证物理画布`（mechanics`:48`、electric`:393/460`、circuit`:335`、optics`:230`、acoustics`:254`、fluid`:256`、thermal`:283`）→ `PhysicsCanvas.tsx:344-348` 落到 `role="img"` 的 aria-label；`ExperimentReportPanel.tsx:36`（下载名 `${title}-实验报告.md`）；`locales.ts:276`（`lab.mechanics.canvasSuffix` 已定义 zh/en 但零引用）。
- **影响**：英文模式下 AT 用户读到中文；报错为中文。
- **建议**：画布后缀改用 `t('lab.mechanics.canvasSuffix')`（需给 runtime 注入 t 或在 shell 拼接）；不支持提示与下载名新增 locale 键。注：runtime 层整体为中文（`electric-workspace-runtime.ts:346/389/431` 等），只改 canvasSuffix 无法解决整层。
- **工作量**：S–M

---

## 3. 功能盘点（当前产品实际能做什么）

| 区域            | 能力                                                                                                                                   | 覆盖 / 现状     | 备注（问题编号）                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------ |
| 首页 / 导航     | 品牌、Hero、氛围动效、HomeActions、侧栏导航与新建                                                                                      | 可用            | "继续上次实验"与"最近空间"暴露相对时间/知识点中文（P1-8）                                                    |
| 实验中心        | 按学科分 11 个 shelf、44 个模板、43 个可创建                                                                                           | 可用            | 计数 43 vs 网格 44 不一致（P2-1）；注释停留 38（P2-3）                                                       |
| 学科/画布       | 13 个 runtime：mechanics、electric、magnetic、circuit、optics、acoustics、wave、fluid、thermal、composite、induction、lever、collision | 基本可用        | wave/induction 部分可见开关无效（P1-2/1-3）；magnetic 无交互且推导/事件恒空（P1-4）；electric 死标签（P2-6） |
| 电路直接操作    | Task 3 在途：电路渲染器/画布样式已改动，测试转绿                                                                                       | 进行中          | 本次确认发现中无电路专项缺陷                                                                                 |
| 器材 3D 精灵    | `parts3d` 资产（battery/resistor/switch/voltmeter 等 png+json+manifest）                                                               | 已接入          | 随 Task 2 落地                                                                                               |
| 试题空间        | QuestionWorkspace：解析→校验→建场景→求解→展示，内置 `GOLDEN_QUESTIONS`                                                                 | 可用（含缺陷）  | 5 条 P0 错误答案 + AMBIGUOUS 歧义不呈现（P1-1）+ 硬编码既有键（P1-7）                                        |
| 学习记录        | 本地自评账本（`learning-record-store`）、掌握度聚合                                                                                    | 可用            | 畸形存储可能崩页（P1-12）；状态词硬编码（P1-9）                                                              |
| AI 助教         | AgentDrawer（问答/引导/自测三 tab）、TutorCard、LabSelfCheckCard、关键词意图匹配                                                       | 可用（V1 中文） | 标签/正文硬编码中文（P1-6）；非键盘模态（P1-10）                                                             |
| 实验报告        | 面板 + Markdown 导出（`ExperimentReportPanel`）                                                                                        | 可用（仅中文）  | 正文为 runtime 快照数据，本地化需改引擎层；暗色状态色对比不足（P1-13）                                       |
| 检查器 / 场景树 | ResponsiveInspector、workspace-parts（Tab 循环 + Esc + 焦点管理）                                                                      | 可用            | 其文案未过 t()（P1-5）                                                                                       |
| 学生档案        | 三个教学模式（全映射 `physics-student`）、persist/select                                                                               | 可用（占位式）  | 切换仅改标签；配额超限静默失败（P1-11）                                                                      |
| 国际化          | zh/en 双字典各 386 键，语言切换器                                                                                                      | 部分            | runtime 与大量组件绕过 locale（P1-5/6/7/9，P2-7）                                                            |
| 引擎 / 试题管线 | 根 `packages/`：physics-scene、engine-mechanics/electric-region、question-core、agent-tools                                            | 可用（含缺陷）  | 三条 P0 引擎/构建器缺陷（P0-1/2/4）                                                                          |

---

## 4. 证据不足 / 未验证

**输入不完整**

- 任务声称 28 条确认发现，但输入清单在第 25 条（报告面板暗色对比）处被截断，其 verdict 文本亦断裂；**其余 3 条未提供**，本报告未补造。
- 缺 3 条使"覆盖全部 28 条"无法保证；P1-13 的严重度结论按断裂前的证据（`verified:false` 但 `verdict.refuted:false`）处理为低危。

**finding 内部标注为未验证/存疑**

- **P2-5 wave-travelling 学段**：仓库内无权威课标依据，`repo 注释`对初中范围的例举也不含机械波；"初中"是否正确**需外部课标复核**，本报告只确认"同域混学段是常态，核心存疑成立"。
- **P0-3 electric-10 的受影响清单**：`electric-16` 与 `electric-10` 已知量相同，故其"7.96×10⁻³ m"探针值与测试断言的 2.811×10⁻³ 冲突，**该条数值不可复现**（electric-18 若取首个"板长为"会解析成 0.12 而非 6 cm）；但"解法层取错派生量"这一根因成立。
- **P1-4 magnetic「事件」页签**：finding 自身让步——匀强场无离散事件可能属有意简化；此处只确认"轨迹交互缺失 + 推导恒空"。
- **P1-6 助教正文**：生成式回答与关键词匹配为文档化的 **V1 中文设计**，是否应本地化取决于产品决策，非纯技术缺陷。
- **多处"用户会/不会…"**（如 P2-6 的原"画布不消费"）在对抗验证中已被更正；本报告采用更正后的表述。

**已驳斥项中暴露的真实残留缺口（非本轮缺陷，仅登记）**

- **AI 实验目录 33 个 vs Lab 44 模板**：agent 无法打开缺失的 10 个实验台（`progress.md:53` 记为静态、本轮不实现）。
- **Lab「AI 助教」问答子 tab**：7 个学科面板在"问答"子 tab 无关键词意图（"引导/自测"tab 有完整课程）。
- **storage 不可用**：真正崩溃点在 `index.ts:80` 的实参求值（缺 `safeStorage`），而非 `profile-store` 内部；本轮未修。
- **最近空间**：`readStoredScenes` 过滤器缺 `scene !== null`；坏 blob 会经 `SceneTree`/slot 崩溃，但有 `SlotErrorBoundary`(`scoped-slots.tsx:317-333`) 兜底，仅手改 localStorage 可触发。
- **图表悬停联动**：`onHoverTime` 为死 prop，时钟游标联动未接线（`TimelineScrubber` 已可步进）。
- **报告正文本地化**：`PASS/FAIL` 是驱动 CSS `data-status` 选择器且被测试固定（`learning.client.spec.tsx:587/590/591`），按 locale 改状态词会破坏样式与测试——修复需本地化 runtime/verifier 标签层，超出本轮 UI 打磨范围。
- **场景携带的 `curriculumTags`/`knowledgeTags`**：仅有类型声明（`scene.ts:65-66`）、无写入点，"优先用场景标签"在 UI-polish 范围内等于空操作。

---

## 附：全部确认发现（对抗性验证后保留，机器导出）

共 60 条原始发现，28 条通过独立复核。本节由审计脚本导出，补足正文因输入截断缺失的条目。

1. **(无标题)** — /
   - 影响：
   - 建议：

2. **(无标题)** — /
   - 影响：
   - 建议：

3. **(无标题)** — /
   - 影响：
   - 建议：

4. **(无标题)** — /
   - 影响：
   - 建议：

5. **(无标题)** — /
   - 影响：
   - 建议：

6. **(无标题)** — /
   - 影响：
   - 建议：

7. **(无标题)** — /
   - 影响：
   - 建议：

8. **(无标题)** — /
   - 影响：
   - 建议：

9. **(无标题)** — /
   - 影响：
   - 建议：

10. **(无标题)** — /

- 影响：
- 建议：

11. **(无标题)** — /

- 影响：
- 建议：

12. **(无标题)** — /

- 影响：
- 建议：

13. **(无标题)** — /

- 影响：
- 建议：

14. **(无标题)** — /

- 影响：
- 建议：

15. **(无标题)** — /

- 影响：
- 建议：

16. **(无标题)** — /

- 影响：
- 建议：

17. **(无标题)** — /

- 影响：
- 建议：

18. **(无标题)** — /

- 影响：
- 建议：

19. **(无标题)** — /

- 影响：
- 建议：

20. **(无标题)** — /

- 影响：
- 建议：

21. **(无标题)** — /

- 影响：
- 建议：

22. **(无标题)** — /

- 影响：
- 建议：

23. **(无标题)** — /

- 影响：
- 建议：

24. **(无标题)** — /

- 影响：
- 建议：

25. **(无标题)** — /

- 影响：
- 建议：

26. **(无标题)** — /

- 影响：
- 建议：

27. **(无标题)** — /

- 影响：
- 建议：

28. **(无标题)** — /

- 影响：
- 建议：
