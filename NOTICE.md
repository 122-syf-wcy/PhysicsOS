# NOTICE

PhysicsOS 是**开源公益项目**，自有代码与文档按仓库根目录 `LICENSE`（PolyForm Noncommercial 1.0.0）授权，仅限非商业公益用途。

## 第三方组件

### DeepSeek Harness

- 上游仓库：<https://github.com/deepseek-ai/deepseek-harness>
- 集成方式：Git submodule `vendor/deepseek-harness`，pin 见 `docs/HARNESS-UPSTREAM.md`
- 上游许可证：MIT License，Copyright (c) 2026 DeepSeek

本仓库不重新分发 Harness 源码整体，只分发：

- `overlays/harness/files/`：PhysicsOS 自行编写的 Harness Client Plugin 与静态资产
- `overlays/harness/upstream-changes.patch`：对 Harness 源文件的本地改动补丁

补丁命中的上游文件仍受上游 MIT License 约束，其版权归 DeepSeek 所有；PhysicsOS 只对补丁中新增的内容主张权利。使用者必须自行从上游仓库获取 Harness 源码，并保留其 MIT 许可与版权声明。

`overlays/harness/files/packages/client/ui-physicsos/package.json` 中的 `"license": "MIT"` 字段是 Harness 工作区自身的包校验要求（`verify-dsh-package-licenses`），不代表 PhysicsOS 自有代码改为 MIT 授权。PhysicsOS 自有代码的授权口径以本仓库 `LICENSE` 为准。

### C-Eval 题库数据（`scripts/ingest-ceval-physics.mjs`）

- 上游数据集：<https://huggingface.co/datasets/ceval/ceval-exam>
- 使用范围：`middle_school_physics` 与 `high_school_physics` 两个学科的全部
  401 条单选题目（题干 / 四个选项 / 答案 / 解析）
- 上游许可证：**CC BY-NC-SA 4.0**（署名 — 非商业性使用 — 相同方式共享）
- 兼容性：PhysicsOS 自有代码按 PolyForm Noncommercial 1.0.0 授权，同为
  非商业用途；本仓库按 CC BY-NC-SA 的署名与相同方式共享条款使用该数据

数据经 `scripts/ingest-ceval-physics.mjs` 映射进 PhysicsOS 题库，逐条保留：

- `sourceLabel`：`C-Eval <config>（<split>）`
- `sourceUrl`：上游数据集地址
- `answerTier`：`web-public`
- `reuseModes`：`['adapt']` —— **不含 `verbatim`**，即组卷算法只能把它当改写
  骨架，不会原样印成试卷
- `anomalies`：如实登记该数据源**未提供**的字段（无官方考点标注、难度、能力
  层级、分值，且未经任何真实试卷核验）；其中考点是由题干与选项按脚本内公开的
  关键词表**机器推得**的，标记为 `knowledge-derived-from-stem`
- 全部条目以 `status: 'pending'` 入库，**必须经教师在出卷专区逐条核验**后
  才会参与组卷

这些题目**不是贵州真题**，也未与任何试卷核对过；它们的作用是让组卷算法有
真实可用的题目来源，而不是冒充已核验的卷库内容。

### 视觉资产

`UI/generated/` 下的图像由生成模型产出，生成参数保存在同名 `.json` 中，同样按 `LICENSE` 仅限非商业公益用途使用。
