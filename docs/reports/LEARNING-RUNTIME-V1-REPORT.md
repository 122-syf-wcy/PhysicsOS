# PhysicsOS Learning Runtime V1 — 智能教学层

> 文件：`docs/reports/LEARNING-RUNTIME-V1-REPORT.md`
> 验收日期：2026-08-24
> 前置：`COMPOSITE_FIELD_RUNTIME_V1_COMPLETE`（见 `MILESTONES.md`）
> 里程碑：`PHYSICSOS_LEARNING_RUNTIME_V1_COMPLETE`

## 1. 目标与问题

复合场 V1 之后，物理能力（Scene → Engine → Verifier → Observation → Canvas →
Agent）已经完整，但产品仍然只是「可验证的物理模拟器」：学生看得到 PASS，
看不到**为什么**；答错了没有人告诉他错在哪一类；学过什么、掌握到什么程度
没有任何记录。本轮**不扩物理**（不加实验模板、不加引擎、不加公式），只做
**学生使用闭环**：

1. **Tutor Mode（引导式教学）**——不是聊天框，是观察 → 引导问题 → 提示阶梯 → 答案。
2. **错误诊断 · 自测**——概念/方向/建模三类错误的分类诊断，引用 Verifier 证据。
3. **学习记录**——错题、错误类型、知识点掌握度，全部由真实作答聚合。
4. **知识图谱**——课程树 + 题目↔知识点的手工审计映射。
5. **实验报告**——当前帧的参数/派生量/区域事件/验证/结论，一键导出 Markdown。

## 2. 架构铁律（延续，未破例）

- **下游永不重算上游已断言的事实**：Tutor 的每一个数字来自
  `PhysicsAgentContext`（引擎派生量 + Verifier 结果）；报告的每一行来自
  `WorkspaceSnapshot` 当前帧；学习记录只做计数，不做物理。
- **教学内容是数据，不是启发式**：知识图谱与自测题库是手工审计的显式表，
  测试断言 56 道内置题每道都被映射且只引用已声明的节点/题目——
  题目永远不会静默漂移到错误的知识点上。
- **纯视图与事实修改严格分离**：Tutor 揭示提示时的画布高亮走与 Q&A Agent
  同一条 `physics.ui.highlight` 工具路径，revision 不变（浏览器 CASE A 断言）。

## 3. Question Space：错误诊断 · 自测 + 知识总结

### 3.1 自测题库（`packages/question-core/src/self-checks.ts`）

- `SelfCheckItem { id, prompt, options[], takeaway }`；每个错误选项携带
  `mistake { type, explanation, evidenceCheckId?, review[] }`。
- **19 个自测探针、55 个选项、36 个已分类错误选项**，覆盖全部 56 道
  Golden Questions（磁场 10 / 电场 19 / 力学 6 / 复合场 21）。
- 错误分类固定为三类：**概念错误**（如「磁场力做功 → 速度增加」）、
  **方向错误**（左/右手定则、场方向判断）、**建模错误**（如忽略重力前不比较
  数量级）。每个错误选项必须给出可读解释与至少一个「建议复习」指引，
  测试逐项断言。
- `learning-content.test.ts`：节点 id 唯一且父节点先声明；56 题全部有映射与
  自测；映射表不允许引用不存在的题；每题恰好一个正确选项，错误选项全部
  分类齐全。

### 3.2 Question Space 集成（`QuestionWorkspace.tsx`）

- 解题结果下方新增「**错误诊断 · 自测**」区（`data-physicsos-selfcheck`）：
  点错 → 诊断卡（错误类型徽标 + 解释 + `Verifier：check_id PASS/FAIL` 活证据 +
  建议复习 chips）；点对 → takeaway 强化卡。选项作答后锁定并揭示正确项。
- 诊断卡引用的 Verifier 证据来自**当前解出的 Simulation checks**
  （`resolveEvidence`），不是静态文案——例如「磁场力不做功」引用
  `magnetic_force_does_no_work` 的实时状态。
- 新增「**知识总结**」区（`data-physicsos-knowledge`）：当前题的知识点 chips，
  来自知识图谱映射（例如质子题 → 洛伦兹力、磁场中的圆周运动）。
- 每次作答通过 `recordAttempt` 写入学习记录（题目、自测项、选项、对错、
  错误类型、知识点），Question Space 自身不存储任何状态。

## 4. 知识图谱（`packages/question-core/src/knowledge-graph.ts`）

- **20 个节点**：力学（匀变速、抛体、牛顿第二定律、受力分析、斜面、
  单位与数量级）+ 电磁学（场强、叠加、电场力、类平抛偏转、有界场、做功与
  动能、洛伦兹力、圆周运动、E+B、速度选择器、质谱仪、三场平衡）。
- `QUESTION_KNOWLEDGE`：56 道题的手工映射表；`knowledgeNodesOfQuestion`
  按表序返回节点。一切是数据，无关键词启发式。

## 5. Tutor Mode（AI 助教 → 引导）

### 5.1 课程脚本（`physics/physics-tutor.ts`）

- `TutorScript { topic, observation[], question, hints[], answer, evidence[] }`；
  **10 种课程**：速度选择器（平衡/偏转两个变体）、质谱仪圆弧、三场合力、
  E+B 合力、磁场圆周、平抛分解、斜面受力分解、电场与电场力、力与运动通式。
- 课程选择按**事实**分派：复合场按 runtime 已发布的事实区分装置
  （质谱仪的偏转区 id、重力派生量非零、`velocity_selection_condition` 的存在），
  力学按场景标题；`context.status === 'failed'` 时不给课程。
- 观察区引用当前帧派生量（`|F_E| = 3.20e-15 N` 一类真实数字）；答案区把
  Verifier 具名校验作为证据 chips（`速度选择条件 · PASS/FAIL`）。缺失的事实
  就少说，任何 rung 都不计算物理。

### 5.2 卡片（`TutorCard.tsx` + `AgentDrawer.tsx` 引导 tab）

- AI 助教抽屉新增 `问答 / 引导` 两个 tab（role=tablist）。
- 阶梯逐级揭示：提示 n 按钮显示进度（`提示 1/3`）；揭示某一级时通过共享
  `runTools` 触发它声明的画布高亮（合并、超时熄灭规则与 Q&A 一致）。
- 课程 id 变化（换装置，或学生把 v 改离 E/B 使平衡翻面）自动重置阶梯——
  半揭示的旧课程提示是谎言。
- 答案揭示后提供「重新开始」。

## 6. 学习记录（`learning-record-store.ts` + `LearningRecordWorkspace.tsx`）

- `createLearningRecordController(storage)`：localStorage 持久化（cap 200，
  最新在前），损坏数据静默丢弃；`knowledgeMasteryOf` / `mistakeCountsOf` /
  `recentMistakesOf` 三个纯聚合函数，**只计数**。
- 学习记录是正式 surface（`data-physicsos-surface="record"`），Sidebar footer
  「学习记录」入口从灰置占位变为真实导航。
- 页面：自测次数 / 正确率 / 错题数指标卡；概念/方向/建模错误分布；最近错题
  列表（题目、你的回答、错误类型徽标、相对时间）；知识点掌握（按课程节点
  的 correct/total 进度条，标注所属学科）。
- 每条错题带「**重新练习**」：深链回试题空间并打开同一道 Golden Question
  （`openQuestion` → `consumeQuestion`，浏览器 CASE D 断言 heading）。

## 7. 实验报告（`physics/experiment-report.ts` + `ExperimentReportPanel.tsx`）

- `buildExperimentReport(snapshot)`：把当前帧投影为
  `{ title, goal, parameters, derived, events, verification, conclusion, markdown }`。
  参数来自 Inspector 树的可编辑字段；派生量与区域事件来自引擎；验证来自
  Verifier；结论按验证通过率生成（全过 →「验证通过」+ 失败列表为空；
  有失败 → 点名失败项）。时间一律走自适应 `formatClock`（纳秒级用指数格式）。
- 工具栏新增「报告」按钮（verification failed 时禁用）→ 对话框展示 +
  「下载 Markdown」导出 `实验名-实验报告.md`。
- 报告显示的是**当前帧**的事实：粒子已离开选择器区时电场力/洛伦兹力为
  0.00 N 是物理事实，不是缺陷（截图 QA 确认过）。

## 8. 浏览器验收（`apps/web/e2e/learning-acceptance.mjs`）

CASE A–F 全 PASS，门禁 5 项全 0：

- **A Tutor Mode**：观察引用真实数字；提示 1 揭示后画布出现高亮组；
  提示 2 教左手定则；答案含「合力为零 / v = E/B」并引用
  「速度选择条件 · PASS」；整个阶梯 revision 不变；重新开始复位。
- **B Tutor 读活的 Runtime**：v₀ → 1.5e5 后课程翻为 `selector-deflecting`
  （「为什么这个粒子发生了偏转？」），答案引用 FAIL；恢复 v = E/B 翻回平衡课。
- **C 自测诊断**：质子题 READY；知识总结 chips 来自图谱；点错「做正功」→
  概念错误徽标 + 「洛伦兹力方向始终垂直于速度方向」解释 +
  `magnetic_force_does_no_work` 证据 + 建议复习；选项锁定且揭示正确项。
- **D 学习记录**：1 次自测 / 0% 正确率 / 1 错题聚合正确；错题带原题与
  「你的回答」；知识点掌握出现洛伦兹力进度条；无页面滚动；
  「重新练习」深链回同一道题。
- **E 实验报告**：报告命名实验、实验参数（电场强度…）、引擎派生量（洛伦兹力…）、
  物理验证（速度选择条件）、实验结论（验证通过）；提供 Markdown 下载；关闭返回。
- **F 持久化**：整页刷新后错题与错误类型仍在（localStorage）。

**回归**：`mechanics` / `electric` / `electric-v2` / `electric-region` /
`composite` 五份旧 acceptance 全部 ALL CHECKS PASSED。

**截图 QA**（人工读图确认）：`tutor-mode-1600x900`、`tutor-deflecting-1600x900`、
`selfcheck-diagnosis-1600x900`、`learning-record-1600x900`、
`experiment-report-1600x900`。

## 9. 验收数据

- `typecheck`（core + web）零错误；`lint`（eslint core + oxlint web）零错误。
- `test:core` 全绿：question-core **228**（含 learning-content 8 项）、
  engine-composite 26、physics-composite-core 48、其余包不变。
- `test:web` ui-physicsos **205 / 16 文件** 全绿（含 `learning.client.spec.tsx`
  15 项：tutor 脚本、抽屉阶梯与高亮、记录 store 聚合与持久化、record surface、
  sidebar 入口、自测诊断与知识 chips、重新练习深链、报告构建与面板）。
- ui-physicsos bundle 重建；overlay `capture` 已回写 `overlays/harness/files/`。

## 10. 不做（明确边界）

- **模型驱动的 Tutor / Agent 答案**：`AGENT_MODEL_BACKED_ANSWERS_BACKLOG`
  不变——课程与答案仍是确定性脚本；接入真实模型时替换的是意图匹配层，
  Tutor 的证据与工具契约不动。
- **图片 / PDF 题目识别**：`QUESTION_IMAGE_PDF_INGEST_BACKLOG` 不变。
- **跨设备学习记录**：仅 localStorage；账号体系与服务端存储属后续
  Data Storage 阶段（`docs/10-DATA-STORAGE-ARCHITECTURE.md`）。
- **自由输入答案的语义批改**：自测是选择式概念探针，不是主观题批改。
- **3D Renderer**：架构已预留（Renderer 注册表），本阶段不做。
