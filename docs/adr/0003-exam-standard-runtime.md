# ADR-0003：Exam Standard Runtime（考试规范运行时）

- 状态：已采纳 / 实现进行中（ExamProfile、OfficialSourceRegistry 等契约与验证器并行开发中；本文不宣称该运行时已上线或可用）
- 日期：2026-09-27
- 决策人：PhysicsOS maintainers
- 相关文档 / PR：`docs/ROADMAP.md`、`docs/02-ENGINEERING-STANDARDS.md`、`docs/04-AGENT-ARCHITECTURE.md`、`packages/physics-verifier`

## 背景

出卷流水线当前面临一个误解风险：它会被当成「一个会写考题的 AI」。owner 的目标省份与学段是**贵州中考与高考物理**。一篇生成的试卷、题目、答案、解题过程与评分标准，必须由**版本化的官方标准**治理，而不是由模型对「风格」的感觉决定。

为此 owner 为出卷系统设定两条硬规则，二者同等分量：

1. **物理正确性由 PhysicsOS Engine / Verifier 决定，不由语言模型决定。**
2. **考试规范由版本化 Official Exam Profile 决定，不由语言模型记忆决定。**

这两条规则把「考试可信」从模型的软性能力，提升为与「物理可信」并列的运行时职责。当前不决策的代价是：出卷会被读成「AI 写题」，任何一篇卷子的合法性都只依赖模型的记忆与风格，既不可审计、也不可版本化，更无法向教师与监管方说明「这份卷子依据的是哪一年的哪一份官方标准」。

本决策把 **Exam Standard Runtime** 确立为继 Physics World Runtime、Physics Compiler 之后的**第三道护城河**：

- **Physics World Runtime**：物理世界的状态与仿真（Scene → Engine）。
- **Physics Compiler**：物理问题的结构化编译与验证（Engine → Verifier）。
- **Exam Standard Runtime**：考试规范本身成为可版本化、可审计、可扩展的运行时数据，而不是模型的记忆。

## 决定

引入 **Exam Standard Runtime**，把考试规范表达为版本化数据 + 双验证器，出卷产物一律以「教师可核验的模拟卷」为终点。

- **版本化 Profile**：层级为 `CN → Guizhou → {Zhongkao | Gaokao} → {2024 | 2025 | 2026 …}`。明确**拒绝**单一 `guizhou: true` 布尔开关，因为考试制度、试卷结构与命题政策逐年在变。
- **`ExamProfile`**（jurisdiction `CN-GZ` / stage / subject `PHYSICS` / year）携带：`curriculumStandard`、`paperBlueprint`、`contentScope`、`questionTaxonomy`、`competencyModel`、`answerStandard`、`scoringStandard`、`officialSources`。
- **中考与高考是两套独立 profile，课程根不同**：中考锚定《义务教育物理课程标准（2022 年版）》；高考锚定《国家普通高中物理课程标准》并叠加贵州 **3+1+2** 选择性考试安排（物理为**首选科目**，2024 年起省内自主命题）。二者不得建模为「同一模板 + 难度开关」。
- **术语决定**：使用「**考试范围 / Curriculum Scope**」，**不使用「中考大纲」**——教育部已取消考试大纲式命题依据，并禁止超标命题；术语沿用「大纲」会重现已被政策废弃的表述。
- **`OfficialSourceRegistry` / `OfficialSourceRef`**：每条规则都带权威来源（`MOE` / `GZ_EDUCATION_DEPARTMENT` / `GZ_EXAMINATION_AUTHORITY`）、标题、日期、url 与适用范围，使管理员面能显示已加载与缺失的官方材料（缺失显示 `⚠ 未确认`）。**系统不得假装自己知道未加载的内容。**
- **`PaperBlueprint`**（总分、时长、题型分区、覆盖约束、难度分布、最大同模型重复比）来自 profile，**绝不来自模型**。本文不硬编码任何题目数量或分值——这些只在该年度官方标准被读入后才填入。
- **正式 `QuestionTaxonomy`**：`Choice {Single, Multiple}`；`Experiment {InstrumentReading, ExperimentalDesign, DataProcessing, ErrorAnalysis, InquiryExperiment}`；`Calculation {SingleModel, MultiProcess, Comprehensive}`；`ContextualProblem`。配合 `CompetencyModel`，同时携带课程核心素养（物理观念 / 科学思维 / 科学探究 / 科学态度与责任）与知识点标签。
- **三级作答严格区分**：`FinalAnswer` / `ExamSolution`（按考试评分习惯：公式 → 代入 → 结果 → 单位，以「答：」收束）/ `LearningExplanation`（教学解析）。**混用三者即为缺陷。**
- **结构化 `ScoringPoint { id, score, criterion, evidence ∈ EQUATION | SUBSTITUTION | RESULT | UNIT | DIRECTION | REASONING }`**，分值拆分来自已确认的评分标准 profile。
- **双验证器，职责不同**：`PhysicsVerifier` 管「物理对不对」；`ExamComplianceVerifier` 管「在范围内 / 题型合法 / 分值合法 / 作答格式合法 / 难度在目标区间 / 蓝图覆盖成立」。输出 `ExamComplianceReport`，覆盖上述维度并附带生效的 source-profile id，终点为 `READY_FOR_TEACHER_REVIEW`。
- **反伪官方原则（显著记录）**：生成的产物必须标注 **PhysicsOS 模拟试卷 / 非官方试卷**；系统**不得**把自己的输出呈现为官方试卷，也**不得自我认证**。教师核验始终保留在环内。
- **以数据扩展**：新增省份或全国新高考，只是新增一个版本化 **Exam Standard Pack**；引擎内**不出现贵州专属分支**。
- **永不臆造官方数据**：任何未加载的官方标准、蓝图数值或来源元数据，一律标记为未确认（`⚠ 未确认` / `待核验`），等待 owner 提供；不得用模型记忆补全。

### owner 引用的官方依据（逐条照录，元数据未确认者标 `待核验`）

> 以下条目为 owner 提供的引用原文。**本仓库尚未核验其 url、文号与生效日期**；owner 未提供可核验的 url，故不作臆造，一律标 `待核验`。

| 引用（原文）                                                                           | 层级                                | 元数据                    |
| -------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------- |
| 教育部《义务教育物理课程标准（2022 年版）》作为初中命题根依据                          | MOE / 初中命题根依据                | 待核验（url、文号未提供） |
| 教育部《普通高中物理课程标准》（2020 年修订）作为高中内容依据                          | MOE / 高中内容依据                  | 待核验（url、文号未提供） |
| 教育部关于初中学业水平考试依据课程标准命题、不得超标命题、取消考试大纲式命题依据的要求 | MOE / 命题政策                      | 待核验（url、文号未提供） |
| 贵州省 2024 年起实行 3+1+2，物理为首选科目，选择性考试省内自主命题                     | GZ_EDUCATION_DEPARTMENT / 高考制度  | 待核验（url、文号未提供） |
| 贵州省中考省级统一命题（2024 年为第二年，科目含理科综合物理）                          | GZ_EXAMINATION_AUTHORITY / 中考制度 | 待核验（url、文号未提供） |

## 后果

- 正面：考试规范从模型记忆变为可版本化、可审计的数据；物理正确性与考试合规性由两个独立验证器分别担保；中考 / 高考分治避免课程根被混用；新增省份或新高考只是新增数据包；教师核验位置明确（`READY_FOR_TEACHER_REVIEW`）。
- 负面：需要维护整套 Exam Standard Pack 数据与 `OfficialSourceRegistry` 元数据，且它必须随年度官方标准持续更新；未加载来源必须长期显示 `⚠ 未确认`，在补全前相关能力不能宣称可用；两个验证器增加了一道独立的检查成本。
- 需要跟进：`ExamProfile` / `OfficialSourceRegistry` / `PaperBlueprint` / `QuestionTaxonomy` / `AnswerStandard` / `ScoringRubric` 契约与 `ExamComplianceVerifier` 并行落地；管理员面需要能显示已加载与缺失的官方来源；在读到当年官方标准前，蓝图数值保持未确认。
- 已执行：无。本 ADR 只记录决策，不宣称 Exam Standard Runtime 已上线。

## 待决问题（Open Questions）

以下问题在本 ADR 中**列出而非解决**：

1. **官方真题语料（official-exam-corpus）**：该步骤需要真实获授权的历届真题，涉及版权与许可问题。**语料被有意地暂不摄入**，须先解决授权 / 许可，再谈采集。
2. **2026 年贵州蓝图数值缺失**：仓库内没有任何 2026 年贵州 blueprint 数值。在 owner 提供之前，运行时必须对相关字段报告**未确认**，不得以模型记忆或往年数据填充。

## 替代方案

- **单一 `guizhou: true` 布尔开关 + 难度参数**：已放弃。它把逐年变化的考试制度、试卷结构与命题政策压成一个静态标记，且会迫使中考与高考共用同一课程根，与「两套独立 profile、不同课程根」直接冲突。
- **只给模型一段「贵州命题风格」提示词**：已放弃。它把合法性寄托在模型记忆与风格上，违反两条硬规则的第 2 条，产物不可审计、不可版本化，也无法说明依据的是哪一年的哪一份官方标准。
- **用一个大而全的 ExamProfile，靠运行时分支适配各省**：已放弃。它会在引擎内引入省份专属分支（如贵州特判），与「以数据扩展、引擎无省份分支」的目标冲突；新增省份应只是新增一份 Exam Standard Pack。
- **暂不引入 Exam Standard Runtime，先做出卷功能**：暂不采用。它会让「AI 写题」的误解风险持续存在，并把规范治理成本推迟到产物已经对外之后；本题的成本主要是一次性的数据建模与来源登记，早做比返工便宜。
