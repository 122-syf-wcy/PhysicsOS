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

### 视觉资产

`UI/generated/` 下的图像由生成模型产出，生成参数保存在同名 `.json` 中，同样按 `LICENSE` 仅限非商业公益用途使用。
