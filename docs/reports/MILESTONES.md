# PhysicsOS Milestones

> 文件：`docs/reports/MILESTONES.md`
> 只记录已验收的里程碑与当前进行中的阶段。每条给出验收依据的位置。

---

## 已完成

### MAGNETIC_RUNTIME_VERTICAL_SLICE_COMPLETE

匀强磁场中带电粒子圆周运动：Scene → SceneCommand/revision → MagneticEngine →
Verifier → Observation → Canvas 全链路打通，Inspector 可编辑 `q / m / v₀ / B` 与
磁场方向，派生量（R / T / ω / F）由引擎给出。

依据：`docs/reports/PHASE-01-FOUNDATION-REPORT.md`、
`vendor/deepseek-harness/packages/client/ui-physicsos/tests/physics-runtime-bridge.client.spec.tsx`

### QUESTION_SPACE_MAGNETIC_VERTICAL_SLICE_COMPLETE

题面文本 → Semantic IR → Scene → Engine → Verifier → 结构化解答，
并支持「在物理世界中打开」把同一个 Scene revision 交给实验室。

依据：`docs/reports/QUESTION-SPACE-MAGNETIC-VERTICAL-SLICE-REPORT.md`

### MECHANICS_RUNTIME_PACK_V1_COMPLETE

5 个力学模型（匀速 / 匀变速 / 抛体 / 牛顿第二定律 / 斜面）+ 统一
`PhysicsWorkspace` 外壳 + Renderer Registry + 可编辑 Inspector +
自由体图（mg / N / f / ΣF / a 与力的分解）+ 时间轴事件标记 + 数据面板 +
Question 力学 UI（已知量点击高亮、结构化推导、具名验证）+
**Question → Lab 实验分支**（题目事实不可被实验污染）+
**Runtime-aware Agent**（视图工具与域命令严格分离）。

依据：`docs/reports/MECHANICS-RUNTIME-PACK-V1-REPORT.md`
（§19–§37，含 8 个浏览器 Case、regression gates A–H、最终截图集）

验收数据：root typecheck / root tests / harness build 通过；
`ui-physicsos` 11 文件 83 测试通过；harness `test:gui` 283 文件 3842 测试通过；
浏览器验收 52 项全通过，五项门禁计数器全为 0。

### ELECTRIC_FIELD_RUNTIME_PACK_V1_COMPLETE

点电荷静电场的第一个垂直切片：Domain Core → Scene → Engine → Verifier →
Observation → Question 预览 → Lab → Agent 高亮全链路打通。
点电荷域契约 `physics-electric-core`（E = kq/r²、F = qE、方向、叠加、
牛顿第三定律、r = 0 显式失败）；`createPointChargeScene` +
`PointChargeField` + probe particle；`point-charge-model` 的 `canHandle` /
`simulate` / derivedQuantities（E 向量与大小、F = qE、方向）；
`observeElectricScene` 扩展 `electric_field_vector` 与 `charge_sign`；
`ElectricPointChargeRenderer`（+q / −q 红蓝玻璃球 + 等距蓝色电场线箭头 +
探针 + E / F 向量）；3 道 Golden Question（求 E、求 F = qE、正负方向判断）
共享带试探电荷的场景；**Question → Lab 实验分支**同样覆盖点电荷
（`ElectricWorkspaceRuntime` 支持 `forkExperimentalScene` / `restoreOrigin`）；
**Agent 电学意图**（电场强度引用 1/r² 校验、电场力引用 F = qE 校验、
正负方向判断），高亮 E / F 向量为纯视图操作。
**不做**：电势面、电容、电磁感应（留待后续切片）；Lab 新建菜单加电场模板
（仅走 Question → Lab）。

依据：`docs/reports/ELECTRIC-FIELD-RUNTIME-PACK-V1-REPORT.md`
（含 5 个浏览器 Case E–I、5 项门禁计数器、最终截图集）

验收数据：root typecheck 通过；`test:core` 全绿（含 question-core 点电荷题
全链路、physics-electric-core、verifier）；`test:web` 97 测试全绿（含
`physics-agent.client.spec.tsx` 电学意图与 `electric.client.spec.tsx`）；
浏览器验收 `electric-acceptance.mjs` 5 Case 全 PASS、5 门禁计数器为 0；
回归 `mechanics-acceptance.mjs` 未回归。

### ELECTRIC_FIELD_RUNTIME_PACK_V2_COMPLETE

多源点电荷纵深 + 等势线可视化 + R1 修复 + Agent 多源解释。
多源在 Scene/Engine/Verifier/Observation/Renderer 全链路自 V1 已就绪
（`createPointChargeScene` 接受 `charges[]`、`fieldAt` 叠加、
`electric_field_superposition` 校验、`traceStreamline` 沿合场积分、
`pointChargeSources` 数组、Inspector 按 `sources.map` 展开）——V2 只打通
多源 Question 解析、补齐等势线、扩展 Agent。

**A. 多源 Question 解析**：`PhysicsSemanticIR` 增 `sourceCharges`/`samplePosition`；
parser 新增 `MULTI_SOURCE_SIGNAL`（q1/q2、等量同种/异种、电偶极子）、
`parseMultiSource`（两源 ±separation/2、中点为场点）、`extractSourceCharges`
（matchAll 提取 q1/q2 与 电荷A/B）；scene builder 多源分支；3 道 Golden
Question（等量异种中点 E≈3.6e6、等量同种中点 E=0、电偶极子中点 E≈7.19e6）；
`buildSolution` 多源叠加公式与方向说明。

**B. 等势线可视化**：`samplePotentialGrid`（Float64Array 网格 V、NaN 跳过奇点）；
`EquipotentialVisual`（level + 多边形 + closed）；marching squares 提取等高线
（16 case + saddle、贪心链接为 polyline）；多源场景默认显示等势线（annotation
observable），单源默认关；renderer 渲染虚线等势路径。等势线作场拓扑示意，
不进 Observation/Verifier 契约（精确 V 在 derived `potential`）。

**C. R1 修复 + Agent 多源解释**：`QuestionWorkspace` probeId 从硬编码 `source-1`
改为 `probeParticleOf`（排除所有声明 source，多源纯场题返回 undefined）；
`PhysicsAgentContext` 增 `chargeSigns`（多源 sign 数组）；新 Intent
`electric-field-line-origin`（电场线从正电荷出来，引用 `chargeSigns` + 方向
校验，多源不谎称单值方向）与 `electric-superposition`（合场叠加，引用
`electric_field_superposition` 校验）；`matchIntent` 规则；`resolveHighlightTarget`
支持 `*` 前缀通配（`field-line` → `source-*`，renderer 按 sourceId 高亮 stream）。

依据：`docs/reports/ELECTRIC-FIELD-RUNTIME-PACK-V2-REPORT.md`
（含 4 个浏览器 Case J–M、5 项门禁计数器、最终截图集）

验收数据：`test:core` 387 全绿（含 question-core 多源题全链路、engine-electric
`samplePotentialGrid`）；`test:web` ui-physicsos 107 全绿（含等势线 visual、
Agent 多源意图 27 测试）；typecheck:core/web 全绿；浏览器验收
`electric-acceptance-v2.mjs` 4 Case 全 PASS、5 门禁为 0；回归
`electric-acceptance.mjs` 与 `mechanics-acceptance.mjs` 未回归。

**不做**（明确边界）：匀强电场完善 / 平行板电容器 / 带电粒子轨迹积分（V3）；
Timeline 事件标记（backlog）；Agent 接真实模型（backlog）；等势线数值断言
（仅拓扑示意）；Lab 新建菜单加多源模板（仅 Question → Lab）。

### ELECTRIC_AGENT_DYNAMIC_INTENTS_COMPLETE

匀强电场动力学（自 V1 已完整实现）补 Agent 动力学意图 + 复杂空间解析 +
浏览器验收。纯增量、低风险，不扩展引擎 / 题型。

**A. 修复 Agent 匀强场文案**：`isUniformElectricField(context)` helper（基于
`electric_kinematic_consistency` check 判别）；`electric-field-magnitude` 按场景
分支（匀强场说"E 是给定恒定值"引用 `electric_force_consistency`，不再谎称库仑
定律）；`electric-force-magnitude` 用 `electric_force_qE ??
electric_force_consistency` 回退。

**B. 4 个动力学意图**：`electric-acceleration-constant`、
`electric-trajectory-shape`、`electric-work-energy`、`electric-velocity-evolution`，
各引用对应匀强场 check + derived，`available` 用 `isUniformElectricField` 闸门。
`matchIntent` 规则置于宽泛规则前。`DERIVED_LABELS` 补齐匀强场动力学中文
label（位移/电势变化/电势能变化/电场力做功/动能变化）。

**C. 复杂空间解析**：`PhysicsSemanticIR` 增 `sampleOffset`；parser 新增
`directionalDistance` 模式（"距其左侧 15 cm"），优先于裸距离；scene builder
单源 probe 按 axis/sign 放置；Golden Question `electric-09-off-axis-field`。

**D. 验收**：Case N（匀强场类平抛试题→Lab 轨迹）、Case O（Agent 抛物线轨迹
解释，引用 `electric_kinematic_consistency`、不引库仑、revision 不变）。

**关键 bug 修复**：`verificationOf` 对匀强场 `checks.slice(0, 8)` 截断了四个
动力学 check（V1 遗留，此前无动力学意图故未触发）→ 改为两模型都显示全部。

依据：`docs/reports/ELECTRIC-AGENT-DYNAMIC-INTENTS-REPORT.md`
（含 Case J–O、5 项门禁计数器、最终截图集）

验收数据：`test:core` 全绿（question-core 108）；`test:web` ui-physicsos 117
全绿（含匀强场动力学 intent 10 测试）；typecheck:core/web 全绿；bundle 重建；
浏览器验收 `electric-acceptance-v2.mjs` Case J–O 全 PASS、5 门禁为 0；回归
`electric-acceptance.mjs` 与 `mechanics-acceptance.mjs` 未回归。

**不做**（明确边界）：平行板有界电场（引擎分段解析，风险中等，留待后续）；
点电荷 1/r² 动力学（自适应步长积分，backlog）；Timeline 事件标记（backlog）；
Lab 新建菜单加匀强电场模板（与 V1 一致，仅 Question → Lab）；复杂空间解析只
支持点电荷单源方向性距离（多源已有 `samplePosition`）。

---

## ELECTRIC_BOUNDARY_RUNTIME_COMPLETE / PHYSICSOS_PHASE4_COMPLETE

**日期**：2026-08-23

**范围**：平行板电容器中带电粒子的偏转 —— 高中电场部分的核心考点，此前完全缺失。
V1/V2/Phase 3 覆盖的是无界匀强场与点电荷静电场，都没有"场只存在于某区域内"的
概念，因此也没有进出场区、打到极板这些离散事件。

**A. 新引擎**：`@physicsos/engine-electric-region`，实现同一个
`PhysicsEngine<PhysicsScene, PhysicsEventLike>` 接口（与 magnetic/mechanics 同构，
**不是第二套 Runtime**）。分段解析：场外 a = 0 匀速直线，场内 a = qE/m 类平抛，
出场恢复匀速或打板停止。产出 `EnterField` / `ExitField` / `HitPlate` 三类
`PhysicsEventLike`、14 个派生量（含 `deflection` / `exit_velocity` / `hit_velocity`）、
5 项校验。与 `engine-electric` 通过 `canHandle` **互斥**（前者要求 region 绑定，
后者拒绝任何 regions/boundaries）。

**B. 全链路**：Scene factory（`createParallelPlateScene`）→ IR
（`charged_particle_bounded_electric_field` + 板几何字段）→ Parser
（`parseParallelPlate` + 10 道 Golden Question）→ Runtime（events 映射 + 平行板
tree/inspector/editParameter）→ Renderer（`ElectricRegionRenderer`：金属极板 +
clipPath 裁剪的有界场格）→ Agent（10 个有界场教学意图）。

**C. 验收**：`electric-region-acceptance.mjs` Case A–F 全 PASS、5 门禁为 0。
回归保护写进断言 —— Case A 断言点电荷帧 `plates === 0`，Case B 断言无界场帧
既无极板也无区域事件。

**关闭 backlog**：`ELECTRIC_TIMELINE_EVENT_MARKERS_BACKLOG`。其"UI 侧零改动"的
预判成立 —— `TimelineMarkers` 的 class 是动态拼的，新 kind 自动生效，只补了三条
CSS 与 runtime 的 `eventsOf`。

**浏览器验收暴露的五个单元测试无法捕获的缺陷**（详见报告）：
1. 试题空间白屏 —— `useQuestionFrames` 仍调旧引擎，render 期间抛
   `EngineUnsupportedError`，React 卸载整棵树。core/lab/bridge 三处都改对了，
   唯独试题预览漏了。
2. 极板不可见 —— `extentOf` 的米级硬编码下限（12/7 场景单位）把厘米级装置放大
   113 倍。`plates === 2` 断言当时是通过的（DOM 存在、视觉不可见），只能靠截图发现。
3. 场方向画错 —— 方向取自当前帧观察量，而板外 E 严格为零，退化到水平 fallback，
   极板极性也标反。改为从场景的场定义取。
4. Inspector 与画布矛盾 —— 引擎在 `endTime` 算派生量（粒子已出场，E/F/a 全零），
   学生 seek 进板间时画布显示 2000 V/m 而 Inspector 显示 0.00。改读当前帧。
5. 事件时间读作「0.00 秒」—— `toFixed(2)` 对纳秒级时间四舍五入成零，屏幕阅读器
   报错时刻。测试断言把实现的格式化复制了进去，因此镜像实现、捕获不到。

**回归**：`electric-acceptance.mjs`、`electric-acceptance-v2.mjs`、
`mechanics-acceptance.mjs` 三份旧 acceptance 全部 PASS、门禁为 0。
`HitPlate` 路径另在浏览器验过 `electric-13`（进入电场 1.00e-9 秒 + 打到极板
5.77e-9 秒，无「离开电场」）。

依据：`docs/reports/ELECTRIC-BOUNDARY-RUNTIME-REPORT.md`

验收数据：`test:core` 445 全绿、`test:web` 163 全绿、`typecheck:core/web` 零错误、
bundle 重建、浏览器验收 Case A–F 全 PASS + 5 门禁为 0。

**不做**（明确边界）：电容/充放电电路（属电路域）；极板几何的 PhysicsEvent
（需往冻结命令集加 `SetPlateSeparation`/`SetPlateLength`，spec 变更）；
Question Space 视觉打磨（无设计需求，无视觉验证手段时改 CSS 是投机）；
不改共用的 `extentOf`（region 用独立 frame，避免影响已验收的旧场景取景）。

---

## COMPOSITE_FIELD_RUNTIME_V1_COMPLETE

**日期**：2026-08-24

**范围**：实验中心 + 复合场产品集成。解决 UI / Product Exposure Gap ——
五套 Runtime 已就绪，但实验室几乎只暴露磁场一个实验。本轮不扩引擎，把
Scene → WorkspaceRuntime → Observation → Renderer → Lab → Question → Agent
对 composite 域接完整，并建立正式的实验入口。

**A. Experiment Library**：`ExperimentTemplateRegistry`（16 个可创建模板，
力学 6 / 电场 4 / 磁场 1 / 复合场 5，每个 `createScene()` 都是真 Scene Factory，
SceneId 时间戳 + 序号唯一）+ 统一 `ExperimentPicker`（搜索 / 分类 Tabs /
快速开始 / 最近使用）。Sidebar 新建、首页快捷入口、实验室空态三个入口共用一份
模板列表；「物理实验室」无 active scene 时进实验库，不再自动加载磁场 demo；
工具栏场景名可切换实验且当前实验可恢复；最近空间记录真实 PhysicsScene
（类型徽标 实验/题目，点击恢复）。回旋加速器因无时变场诚实标记「即将支持」。

**B. Composite 全链路**：`CompositeWorkspaceRuntime`（同一 WorkspaceRuntime
契约、真实 SceneCommand、当前帧派生量、实验分支、EnterRegion/ExitRegion →
Timeline markers）+ `CompositeRenderer` 进 RENDERERS（复用 primitive：区域
矩形 + clipPath 场格、⊙/× glyph、Vectors、轨迹、粒子光晕）+ 速度选择器 /
质谱仪三区 / E+B / E+B+g / 多场区五个实验；21 道 Composite Golden Questions
（8 选择器 + 6 质谱仪 + 3 E+B + 3 E+B+g + 1 回旋加速器拒识）+ 五步结构化
Solution（数值全部来自 Runtime）；Agent 13 个复合场意图，引用
`velocity_selection_condition` 具名校验，一次回答多目标高亮取并集。

**C. 收口修复**（浏览器/门禁暴露）：① 三个复合场模板显式 `into_page` 覆盖
工厂正确默认，qE 与 qv×B 同向、选择器筛掉一切粒子 → 改 out_of_page；
② Agent 逐个 setHighlight 相互覆盖 → Drawer 聚合并集；③ `trajectory` 别名
缺 `composite-trajectory`；④ AgentDrawer 高亮标签表副本缺 composite 条目 →
改用共享 `highlightLabel`；⑤ electric-visual-bridge `?? 0 < 0` 优先级隐性
bug（fallback 把任何非零电荷判负）→ lint 门禁抓出加括号；⑥ 旧 E2E 适配
实验库入口 + 题目点击收敛到 questions 面板作用域（最近空间出现同名按钮）。

依据：`docs/reports/COMPOSITE-FIELD-RUNTIME-V1-REPORT.md`

验收数据：`test:core` 全绿（engine-composite 26、physics-composite-core 48、
question-core 220 含 21 道 composite golden）；`test:web` 190 全绿；
`typecheck` 与 `lint`（core+web）零错误（顺带清掉 24+ 处历史 oxlint 违规）；
Harness build 通过；`test:gui` 3948/3950（1 个上游 code-block flake 单跑
15/15）；浏览器验收 `composite-acceptance.mjs` CASE A–I + E+B+g + 响应式全
PASS、5 门禁为 0；回归 mechanics / electric / electric-v2 / electric-region
四份 acceptance 与 home/lab 截图脚本全 PASS；overlay 已回写。

**不做**（明确边界）：回旋加速器（需时变场）；最近空间恢复运行时编辑
（revision 归 Runtime 所有，恢复=初始条件）；磁偏转区 D 形盒外观；
Agent 模型化回答（backlog 不变）。

---

## PHYSICSOS_LEARNING_RUNTIME_V1_COMPLETE

**日期**：2026-08-24

**范围**：智能教学层（Learning Experience V1）。复合场 V1 之后物理能力已完整，
本轮不扩物理（不加实验/引擎/公式），把「可验证的物理模拟器」变成「学生
使用闭环」：Tutor Mode、错误诊断自测、学习记录、知识图谱、实验报告。

**A. 教学内容层（question-core）**：知识图谱 20 节点（力学/电磁学课程树）+
56 道 Golden Questions 的手工审计映射 `QUESTION_KNOWLEDGE`；自测题库
`QUESTION_SELF_CHECKS` 19 个概念探针 / 55 选项 / 36 个已分类错误选项
（概念/方向/建模三类，每个错误选项必须带解释 + 建议复习 + 可选 Verifier
证据 check id）。全部是显式数据表，`learning-content.test.ts` 断言 56 题
全覆盖且只引用已声明节点——题目不会静默漂移到错误知识点。

**B. Tutor Mode**：AI 助教抽屉新增 问答/引导 双 tab；`physics-tutor.ts`
10 种课程（选择器平衡/偏转、质谱仪、三场、E+B、磁场圆周、平抛、斜面、
电场力、力与运动），结构固定为 观察（当前帧派生量真实数字）→ 引导问题 →
提示阶梯（逐级揭示，揭示即通过共享工具路径高亮画布，revision 不变）→
答案（引用 Verifier 具名校验 chips）。课程按 runtime 事实分派并在事实
变化时自动重置（v ≠ E/B 时课程实时翻为「为什么偏转」）。

**C. 错误诊断 + 学习记录**：Question Space 新增「错误诊断 · 自测」
（答错 → 错误类型徽标 + 解释 + `magnetic_force_does_no_work` 一类活证据 +
建议复习；答对 → takeaway）与「知识总结」chips；每次作答写入
localStorage 学习记录。学习记录成为正式 surface（Sidebar 入口激活）：
自测次数/正确率/错题数、三类错误分布、最近错题（含你的回答）、按知识
节点的掌握度进度条，每条错题「重新练习」深链回同一道题。store 只计数，
不算物理。

**D. 实验报告**：工具栏「报告」→ `buildExperimentReport(snapshot)` 投影
当前帧为 参数/引擎派生量/区域事件/物理验证/结论，对话框展示 +
Markdown 导出；时间用自适应 `formatClock`（纳秒级指数格式），结论由
验证通过率生成。

依据：`docs/reports/LEARNING-RUNTIME-V1-REPORT.md`

验收数据：`typecheck` 与 `lint`（core+web）零错误；`test:core` 全绿
（question-core 228 含 learning-content 8 项）；`test:web` 205/16 文件全绿
（含 `learning.client.spec.tsx` 15 项）；bundle 重建；浏览器验收
`learning-acceptance.mjs` CASE A–F 全 PASS、5 门禁为 0；回归 mechanics /
electric / electric-v2 / electric-region / composite 五份 acceptance 全
PASS；overlay 已回写；截图 QA 五张人工读图确认。

**不做**（明确边界）：模型驱动的 Tutor/Agent 答案（backlog 不变，接入时只
替换意图匹配层）；图片/PDF 识别（backlog 不变）；跨设备学习记录（仅
localStorage，账号与服务端存储属 Data Storage 阶段）；主观题语义批改；
3D Renderer。

### EXPERIMENT_LIBRARY_HOME_V1_COMPLETE

实验库首页精修（Apple 学习中心风格），规划中「UI/UX 打磨」的第一项。
同一个 `ExperimentPicker`（Sidebar 新建 / 首页快捷入口 / 实验室空态共用）
升格为学习中心式首页，数据全部来自既有真实 store，不新增任何伪状态：

**A. 大标题**：hero 区「实验中心」30px/700 紧字距 + 一句话副标题；
面板加宽至 1000px。

**B. 继续上次实验**：单张全宽 continue 卡，两种来源一个优先级——
chooser 盖在运行中实验上（切换实验）时显示「返回当前实验 · 正在运行」，
点击原地恢复（revision 不变）；否则读取持久化 `recent-scenes` 的最新一条
显示「继续上次实验」，元数据为 学科 · 实验/题目 · 相对时间，点击把存储的
PhysicsScene 原样交还实验室（同 sceneId，整页刷新后依然可还原）。

**C. 为你推荐**：新纯函数模块 `experiment-recommendations.ts`——
`recommendExperiments({attempts, excludeClassicIds, limit=3})`：
先按学习记录聚合薄弱知识点（错次多 → 正确率低排序），经手工审核的
`KNOWLEDGE_EXPERIMENT` 表（知识节点 → 训练该节点的实验，无诚实映射的
节点如「单位与数量级」刻意缺席）产出「针对薄弱点 · 节点名」卡；
经典池（力/电/磁/复合各一）补足，经典补位排除最近使用，薄弱点复练
不排除。卡片理由即选中它的规则，无模型调用。取代原「快速开始」。

**D. 学科颜色**：`chrome.ts` 新增 subjects 语义组
`--physics-subject-{mechanics,electric,magnetic,composite}`（绿/蓝/紫/橙）
+ 同名 `-tint` 浅底色，注释明确「只着色 UI chrome，不着色画布物理」；
CSS Modules 用 `subject-*` 修饰类注入 `--subject/--subject-tint` 两个
自定义属性，推荐卡底色、continue 卡图标块与 CTA、分类 Tab 彩点、
网格图标块、领域标签 chip 全部消费同一组变量。

依据：`apps/web/e2e/library-home-acceptance.mjs`（CASE A–D + 5 门禁）、
截图 `experiment-library-home / -continue / -weakness -1600x900.png`

验收数据：`typecheck` 与 `lint`（core+web）零错误；`test:web` 214/17 文件
全绿（新增 `experiment-recommendations.spec.ts` 7 项 + picker 继续/推荐
组件用例 2 项）；`test:core` 全绿；bundle 重建；浏览器验收
`library-home-acceptance.mjs` 26 项全 PASS、5 门禁为 0（含大标题 ≥28px、
三学科浅底色两两不同、四 Tab 彩点两两不同、刷新后精确还原、错题 →
薄弱点推荐深链）；回归 mechanics / electric / electric-v2 /
electric-region / composite / learning 六份 acceptance 全 PASS
（composite CASE A 的「快速开始」检查更新为推荐栏检查）；overlay 已回写；
截图 QA 三张人工读图确认。

**不做**（明确边界）：首页 Hero（`conversation.hero`）与 Canvas 氛围精修
（规划中的独立条目）；推荐算法不引入模型/遥测（规则即理由）；
不新增实验模板。

---

## 进行中

（暂无）

---

## 明确延后

见 `docs/reports/BACKLOG.md`：

- `AGENT_MODEL_BACKED_ANSWERS_BACKLOG`（契约已就位，替换 `matchIntent` 即可）
- `QUESTION_IMAGE_PDF_INGEST_BACKLOG`
- `APPS_WEB_STANDALONE_RETIREMENT_BACKLOG`
- `HARNESS_WINDOWS_REPLAY_GATE_DEFERRED`
- `UPSTREAM_PARALLEL_TEST_FLAKE`（上游并行负载 flake，10/10 单独通过）
- Canvas Camera V1：暂不做。viewBox 跟随容器 + 等比 fit 已解决线宽放大与极端场景取景；
  真正需要平移/缩放的是星体运动、大范围电磁场区域、复杂电路拓扑
