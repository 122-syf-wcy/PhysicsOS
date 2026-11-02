# 目录与模块边界

把计算、呈现与交互拆开，给后来接手的人留出空间。

## 先找到真实源码

| 位置 | 用途 |
| --- | --- |
| packages/engine-* | 物理求解与领域模型 |
| packages/physics-scene | 场景结构、命令、修订与来源 |
| overlays/harness/files/packages/client/ui-physicsos/src/client | 平台 UI 与运行时适配源码 |
| vendor/deepseek-harness | 上游源码与 overlay 应用结果；不是自有代码编辑入口 |

## 每个文件只回答一个问题

| 模块 | 允许做 | 不允许做 |
| --- | --- | --- |
| experiment-page.tsx | 组合共享控件、教学内容和实验台 | 另做账号、报告和第二套参数面板 |
| lens-renderer.ts | 把可视快照投影为三维装置 | 导入求解器、自己推算物理量 |
| lens-interaction.ts | 拾取、坐标转换、preview/commit/cancel | 直接改 Scene 字段或数据库 |
| lens-assets.ts | 资源加载、引用计数与释放 | 无归属的全局缓存 |
| 领域引擎 | 计算、可处理条件、校验结果 | 引用 React、DOM 或 Three 对象 |

## 复用现有能力

优先接入现有 WorkspaceRuntime、场景命令、实验指南、报告和学习记录。跨实验都需要的能力放到共享层，并为已有消费者保留兼容；只有某个实验使用的装置留在该实验目录。

> **不要提前依赖尚未发布的 SDK**：当前仓库接口与未来公共 SDK 是两层契约。公开 SDK 仍在设计，文档中的生命周期结构仅表达约定，不代表已经存在的 npm 包。
