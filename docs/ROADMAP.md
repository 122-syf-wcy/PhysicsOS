# PhysicsOS 路线图

本路线图按“已发布 / 进行中 / 计划中”维护。进行中的条目不视为已经可用；具体功能状态以代码、测试和发布记录为准。

## 已发布

| 能力           | 当前状态                                                                                            | 优先级 |
| -------------- | --------------------------------------------------------------------------------------------------- | ------ |
| 生产部署       | Docker Compose 运行 `app + postgres + redis`，支持 secret 文件、`/healthz`、`/readyz` 与 HTTPS 反代 | P0     |
| 账户体系       | 学校租户、学生 / 教师 / 管理员权限、会话与一次性密码重置队列                                        | P0     |
| 学习记录同步   | 个人学习记录、错题与场景状态跨设备同步                                                              | P0     |
| 出卷专区       | 智能组卷、教师核验、A4 导出，以及图片 / PDF 转入                                                    | P1     |
| 实验中心       | 12 个物理领域，包含时变场回旋加速器和近代物理光电效应模型                                           | P0     |
| 跨端体验       | 响应式桌面与手机布局；桌面壳支持本地 Harness 服务器模式                                             | P1     |
| 运行时基础设施 | PostgreSQL 持久化、Redis 共享限流与一次性账本                                                       | P0     |
| 开源治理       | Apache-2.0 许可证、贡献指南、行为准则、安全政策、Issue / PR 模板与 CI 门禁                          | P1     |
| 邀请码注册     | `open / invite / closed` 三态注册策略、租户范围邀请码、原子消费与管理员管理页                       | P0     |
| TOTP 双因子    | 管理员 / 教师 TOTP 注册、登录挑战与恢复码；生产账号是否启用由管理员决定                             | P0     |
| 个人 API Token | 哈希存储、`read / write` scope、创建时只返回一次原文、可撤销                                        | P1     |
| 审计与运维面   | 管理员审计列表 / 导出 API、模型号池审计、磁盘与运行状态控制面板、15 秒缓存                          | P1     |
| 账号会话存储   | 账号私有 workspace、按 `<schoolId>/<userKey>/<sessionId>` 分层会话、所有权过滤与旧布局迁移          | P0     |

## 进行中

| 能力             | 状态                                                                                                                                                    | 优先级 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 公测题库采样     | 用真实初高中题目覆盖第三方模型网关的敏感词过滤、工具调用与拒答路径                                                                                      | P0     |
| 完整灾备恢复     | PostgreSQL 备份已有；Redis + `app_data` 异地备份、恢复和 RPO/RTO 演练仍需完成                                                                           | P0     |
| 桌面签名分发     | Web 已公测；macOS/Windows 签名、公证、商店和自动更新闭环按需推进（可选形态）                                                                            | P2     |
| Harness 事件迁移 | `tool-physicsos` 两处已弃用的同步 `session.snapshotEvents()`（`src/index.ts`、`src/invariant.ts`）暂以 oxlint-disable 抑制，待迁移到 0.1.7 异步事件 API | P2     |

## 计划中

| 能力             | 目标                                                                                                      | 优先级 |
| ---------------- | --------------------------------------------------------------------------------------------------------- | ------ |
| SSO / OIDC       | 接入学校身份提供商，减少独立账号维护                                                                      | P1     |
| 学校白名单       | 在邀请码之外增加域名、名单或管理员审批准入                                                                | P1     |
| 通知推送         | 补齐站内未读、Web 推送或邮件中的一条明确主路径                                                            | P1     |
| 移动端           | 面向手机和平板的原生或经过完整验证的移动体验                                                              | P1     |
| 题库继续扩充     | 增加经过核验的真题、练习和解析，并保持待核验边界                                                          | P1     |
| 英文 i18n        | 完成界面、报告和错误信息的中英文覆盖                                                                      | P2     |
| 插件化实验       | 为第三方实验模型提供受控扩展边界                                                                          | P2     |
| 告警外送         | 在控制面板阈值之外补齐邮件 / Webhook 告警与值班交接                                                       | P2     |
| Harness 人工升级 | 不自动跟踪上游 `master`；仅在有新版本时提示，人工在隔离 worktree 内升级、全量门禁与浏览器验收通过后再发布 | P2     |

## P0 收口：可信溯源（Provenance）

> Verified is a property of evidence, not a presentation state.
> 「已验证」是证据的属性，不是 UI 的显示状态。

因此 UI、Agent、Paper 与 Question 都不得自行声明「已验证」，只有 PhysicsOS 的验证链路（Verifier → Provenance）可以。P0 以五条标准收口：

1. **Provenance 是事实，不是标签**：`verificationLevel` 只能由真实 Verifier 检查推导；缺少 `engineId`、`sceneRevision` 或 Verifier 证据时，取值降级为 `UNVERIFIED`。禁止 `default: VERIFIED`，UI 不得自行判断。
2. **已验证 UI 只消费事实**：不得基于「结果看起来没问题」而显示绿色徽标；无 provenance 即显示 `Unverified`；UI 应绑定一个统一的标准 DTO，而不是逐页拼装字段。
3. **CI 门禁必须能红**：至少三个 fixture —— 模型直接产出的裸数字、缺少 `sceneRevision` 的取值，以及**伪造**的 `verificationLevel: STRONGLY_VERIFIED`（支撑检查不足）—— 门禁必须对三者都真实报红。
4. **空壳 Agent 包退场可执行**：先确认零生产消费方，再删除；ADR 由 Proposed 转为 Accepted/Executed；文档须写明 **Harness 是 Agent host**，不得暗示 PhysicsOS 维护自己的 Agent runtime。
5. **链路未跑通前不改宣传文案**：等 `Paper → Engine → Verifier → Provenance → Verified UI → CI Gate` 端到端真正可用之后再动，使「可验证」成为可运行的事实而非口号。

**P0 验收（定义完成）**：

> 任何用户可见的物理结论，只要声称 "Verified"，就必须能够追溯到具体 Scene Revision、Engine、Verifier 和真实检查证据；否则一律视为 Unverified。

该验收须落地为**代码级不变量**，而不仅是一句政策。三个 P0 工作流并行开发不受限，合并顺序固定为 `Provenance → Gate → UI`：UI 不得先落地，再对着仍在变动的类型反复返工。完整记录见 `docs/superpowers/plans/2026-09-27-p0-provenance-program.md`。

## P0.5 考试可信（Exam Trust）

> 物理正确性由 PhysicsOS Engine / Verifier 决定，不由语言模型决定。
> 考试规范由版本化 Official Exam Profile 决定，不由语言模型记忆决定。

考试可信（P0.5）位于物理可信（P0）之后、实验闭环（P1）之前：出卷要产出「可被教师直接核验」的试卷、答案、解题过程与评分标准，其规范必须来自版本化官方标准，而不是模型的记忆或风格。它把 Exam Standard Runtime 确立为继物理世界运行时、物理编译器之后的第三道护城河，完整决策见 `docs/adr/0003-exam-standard-runtime.md`。

分层顺序为 **P0 物理可信 → P0.5 考试可信 → P1 实验闭环（Physics Lab）→ P2 学习与成长（Learning / Growth）**。

**状态：设计已定 / 实现进行中**（下列契约与验证器并行开发中，尚未发布）。

| 组件                   | 职责                                                                                                                                                                                                     | 状态       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| OfficialSourceRegistry | 登记每一条规则对应的官方来源（`MOE` / `GZ_EDUCATION_DEPARTMENT` / `GZ_EXAMINATION_AUTHORITY`、标题、日期、url、适用范围），显示已加载与缺失的来源；缺失显示 `⚠ 未确认`，系统不得假装自己知道未加载的内容 | 设计已定   |
| ExamProfile            | `CN → Guizhou → {Zhongkao \| Gaokao} → {2024 \| 2025 \| 2026 …}` 的版本化考试画像，携带课程标准、试卷蓝图、考试范围、题型分类、素养模型、作答标准、评分标准与官方来源                                    | 设计已定   |
| Guizhou Zhongkao Pack  | 贵州中考 Exam Standard Pack，锚定《义务教育物理课程标准（2022 年版）》                                                                                                                                   | 设计已定   |
| Guizhou Gaokao Pack    | 贵州高考 Exam Standard Pack，锚定国家普通高中物理课程标准与贵州 3+1+2 选择考安排（物理为首选科目，省内自主命题）                                                                                         | 设计已定   |
| PaperBlueprint         | 总分、时长、题型分区、覆盖约束、难度分布、最大同模型重复比；只来自 profile，绝不来自模型                                                                                                                 | 设计已定   |
| QuestionTaxonomy       | 正式题型分类：选择{单选,多选}、实验{仪器读数,实验设计,数据处理,误差分析,探究实验}、计算{单模型,多过程,综合}、情境题                                                                                      | 设计已定   |
| AnswerStandard         | 三级作答严格区分：FinalAnswer / ExamSolution（公式→代入→结果→单位，以「答：」收束）/ LearningExplanation；混用即为缺陷                                                                                   | 设计已定   |
| ScoringRubric          | 结构化 `ScoringPoint { id, score, criterion, evidence ∈ EQUATION\|SUBSTITUTION\|RESULT\|UNIT\|DIRECTION\|REASONING }`，分值拆分来自已确认的评分标准                                                      | 设计已定   |
| ExamComplianceVerifier | 与 PhysicsVerifier 分工：在范围内 / 题型合法 / 分值合法 / 作答格式合法 / 难度在目标区间 / 蓝图覆盖成立                                                                                                   | 实现进行中 |
| ExamComplianceReport   | 汇总上述维度与生效的 source-profile id，终点为 `READY_FOR_TEACHER_REVIEW`                                                                                                                                | 设计已定   |

**反伪官方与「不臆造官方数据」原则**：生成的产物必须标注 **PhysicsOS 模拟试卷 / 非官方试卷**，系统不得把输出冒充官方试卷，也不得自我认证，教师核验始终在环；任何未加载的官方标准、蓝图数值或来源元数据一律标记未确认，禁止以模型记忆补全。蓝图中的题目数量与分值不硬编码，只在该年度官方标准读入后才填入。官方真题语料因版权 / 许可未决而**有意暂不摄入**；2026 年贵州蓝图数值缺失，运行时须报告未确认。

## P1 实验闭环排序

依据：打开实验 30 秒内，用户应能测量、探针、查看物理事件时间线并回放——这比再加一个 AI 面板更能证明存在真实的物理运行时。

`Measurement Tools → Physics Timeline → Experiment Notebook → Branch Compare → Question → World 可视化 → Challenge`

其中 Experiment Notebook 是上述行为的沉淀处，Challenge 是后续的增长入口。

## 维护规则

- 已发布能力必须在 `main` 上有可复现的测试或浏览器验收证据。
- 进行中的能力不得用占位成功状态冒充已完成。
- 计划中能力进入开发前，先补 issue、验收标准和回滚边界。
- 安全、许可证与数据合规变化必须经过维护者评审。

## 产品边界

PhysicsOS 是个人物理实验与学习平台，不是学校 LMS。班级管理、作业发布、学生提交、教师批改、完成率看板等教学管理能力不属于产品范围，已从客户端和运行时 composition 移除。
