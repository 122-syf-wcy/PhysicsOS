# @deepseek-ai/dsh-paper-host

PhysicsOS 出卷专区 host plugin — the paper domain (blueprints, spec tables, bank-driven drafting, per-question review, hash-bound approval, DOCX/PDF export) and the `/physicsos/paper` REST surface over the `webServer` service and a `physicsos_paper` storage-domain unit.

只出卷 + 答案解析：本插件产出标准可打印 A4 试卷与解析，不做作业、批改或班级管理。

## Model

```
source_paper ──< annotations        # 真题原卷 + 逐题考点标注（录入面）
                                      卷库浏览读的也是这两张表
bank_items ──< bank_usage           # verified 题库 + 上卷台账（新鲜度闸依据）
blueprints                          # 已核实结构模板（中考物理90 / 理综150 / 高考100）
jobs ──< exports                    # 出卷任务 —— 一次组卷到交付的完整状态机
```

`jobs` 是唯一的写权威：组卷计划、草稿文档、逐题审核记录、独立解题报告、批准哈希、导出清单都挂在它上面。

### 任务状态机

```
spec → drafting → checking → review → approved → exported
                     ↘ failed
```

`review` 之后每一次 `commitDocument`（换题、修订、改文档）都会作废当前 approval —— 批准绑定的是内容哈希，任何改动都无法绕过。

## REST surface (`/physicsos/paper`)

### 真题原卷与考点

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/sources` | 原卷列表（可按 `status` 过滤） |
| POST | `/sources` | 录入原卷（region / school / kind / featured） |
| GET | `/annotations?source=` | 考点标注列表 |
| POST | `/sources/:id/annotations` | 逐题标注（题号 / 题型 / 分值 / 考点 / 能力 / 完整题干） |
| POST | `/sources/:id/verify` | 原卷核验（`pending → verified`） |
| POST | `/sources/:id/import/csv` | 批量标注导入（朴素逗号切分，装不下含逗号的题面） |
| POST | `/annotations/:id/review` | 标注核验 |
| GET | `/stats` | 录入面统计 |

> 卷库浏览端只显示 `verified` 的原卷与标注；`pending` 在出卷专区的管理台账里可见。

### 题库

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/bank/items?status=&level=&kind=` | 题库列表；`status` 只接受 `pending\|verified\|rejected`，非法值 400 |
| POST | `/bank/items` | 直接入库（严格 wire） |
| PUT | `/bank/items/:id` | 修订条目；`id` / `enteredBy` 被 `omit` 剥掉，不可注入 |
| POST | `/bank/ingest` | 粘贴导入：模型结构化抽取 + 异常识别 |
| POST | `/bank/items/:id/review` | `pending → verified / rejected` |
| GET | `/bank/items/:id/usage` | 该题的上卷台账 |

### 组卷与交付

| Method | Path | 说明 |
| --- | --- | --- |
| GET/POST | `/blueprints` | 结构模板列表 / 新建 |
| POST | `/blueprints/:id/verify` | 模板核验 |
| GET | `/jobs` | 任务列表 |
| POST | `/jobs` | 建任务（`{blueprintId, request}`）→ 生成双向细目表 |
| PUT | `/jobs/:id/spec` | 教师确认/调整细目表 |
| GET | `/jobs/:id/bank-plan` | 组卷计划预览（每题 supply 模式与得分，不上卷） |
| POST | `/jobs/:id/draft` | 起草（异步，202） |
| POST | `/jobs/:id/check` | 自动检查 + 独立解题（异步，202） |
| POST | `/jobs/:id/questions/:no/repair` | 按教师意见单题修订 |
| POST | `/jobs/:id/questions/:no/replace` | 换题（同步校验先于 202，无候选即 404） |
| POST | `/jobs/:id/questions/:no/review` | 逐题批准 / 退回 |
| PUT | `/jobs/:id/document` | 直接改文档（改动作废 approval） |
| POST | `/jobs/:id/approve` | 整卷批准（绑定当前哈希） |
| POST | `/jobs/:id/export` | 导出四件套（学生卷/解析卷 × PDF/DOCX） |
| GET | `/jobs/:id/files/:name` | 下载；文件名走白名单，路径 `normalize` 后不得越出导出根 |

失败一律 `{error:{code,message}}`，携带对应 HTTP 状态。

## 组卷算法（纯函数，在 `@physicsos/question-paper`）

细目表每行独立决策，四档供给：

| 模式 | 触发 | 行为 |
| --- | --- | --- |
| `verbatim` | 候选得分 ≥ 0.85 | 原题直落，不改一字 |
| `adapt` | 得分 ∈ [0.55, 0.85) | 以原题为骨架改写情境与数值，答案重算 |
| `generate` | 有行无候选过线 | 让模型新出（可带题库范例） |
| `gap` | 题型/考点无解 | 诚实留空，不硬凑 |

候选得分 = 知识点 0.45 + 难度 0.25 + 能力 0.15 + 来源 0.15，来源按「已核验真题 > 精选校卷/联考 > 其他已复核 > 公开/回忆版」递减。`freshnessPapers` 道新鲜度闸把近几卷用过的题压下去（只计 approved/exported 卷，failed 卷不占额度）。

**provenance 不可伪造**：`generated` 题在 `draftSection` 统一盖 `{mode:'generated'}`，会刷掉模型可能自带的假 `bankItemId`；台账按**实际上卷题目的 provenance** 记账，而不是按计划——降级成 generate 的题不会被误记成 adapted。

## 校验与证据

- `checks.ts`（纯函数）：总分 / 分值 / 题号连续性 / 缺答案 / 缺图 / 超纲 / 重复题
- 独立解题轮：不给候选答案，重解一遍再比对，产出 `SolveResult` 进 `solveReport`
- 每次导出前 `approval` 必须与当前版本哈希一致

## 依赖的外部工具

| 工具 | 用途 | 缺失时 |
| --- | --- | --- |
| `pandoc` | Markdown → DOCX（`$LaTeX$` → OMML 可编辑公式） | 导出失败并报错 |
| `soffice` (LibreOffice) | DOCX → PDF | 导出失败并报错 |
| `unzip` | 取出参考模板的 `reference.docx` | 导出失败并报错 |

三者都以 `spawn` 隔离调用（不经 shell），带超时与 `cwd` 隔离。

## 构建注意

`tsdown` 的入口是 `lib/types/index.js`（`tsc` 产物），**必须先 `tsc -b` 再 `tsdown`**——直接跑 `tsdown` 打的是上一次的旧产物，表现是「路由在源码里却 404」。用包内的 `pnpm run bundle`，它按正确顺序跑两步。

## Model Experience

None, as the package serves browser REST surfaces for papers and the question bank and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- CSV 导入是朴素逗号/制表符切分，含逗号的题面装不下——题干走逐题表单录入
- 浏览端只显示 `verified` 的原卷与考点
- 题目题型列显示原始枚举（如 `choice-single`），要中文标签属后续小改
- 无 REAL-composition 测试（`routes.spec.ts` 走 Map-backed domain），真实链路由 `auth-host` 之外的手工 e2e 与浏览器验收承载
