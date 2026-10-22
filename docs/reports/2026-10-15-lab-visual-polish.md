# 原版实验界面视觉打磨

用户反馈：不采用实验流程重构方案，沿用原有界面与交互做美化。

## 改动范围

改动在 `overlays/harness/files/packages/client/ui-physicsos/src/client/` 的四个 CSS Modules：

- `LabWorkspace.module.css`：统一面板边框和轻阴影，增强标题、说明和单位可读性；检查器页签改为分段式选中态，输入区域略作留白；静态实验没有时间轴时补齐画布底部圆角和边框。
- `ExperimentPicker.module.css`：原有实验卡片增加少量内边距，增强标题层级与表面质感。
- `physics/PhysicsCanvas.module.css`：降低网格视觉权重，读数卡采用实色底、轻阴影和更清晰的文字。
- `physics/renderers.module.css`：增强器材标注，收敛光路辉光，调整透镜填充和线宽，以及光屏亮态强度。

原有三栏布局、时间轴、参数编辑、数据页、实验切换、专注模式、物理计算与数据存储均保留。未新增实验流程。未覆盖本地 vendor 子模块已有差异。此前未采用的设计草稿已移除。

## 服务器验证

环境：`38.76.190.3`，从现行 `physicsos-app:global-a25c6ee26583` 镜像创建隔离容器 `physicsos-lab-polish-20261015`；没有生产数据卷或密钥挂载，CPU/内存设上限。正式 app、PostgreSQL、Redis 保持健康。

- 实验 UI 插件 tsdown 构建成功，含 optional-workspace bundle。
- Harness Web Vite 生产构建成功；仍有大于 500 kB chunk 的已有提示。
- 相关组件回归：3 个文件、56 项通过。覆盖 `workspace-presentation`、`workspace-capabilities`、`optics`。
- `git diff --check` 通过。

测试环境处理：运行镜像未复制仓库根 `tsconfig.base.json`，已在隔离容器内补齐；测试使用 `NODE_ENV=test`。原基线运行 48 项通过、8 项因 5 秒时限超时；在资源受限的服务器上改为单 worker、30 秒单测时限后，56 项全部通过。未修改产品测试断言和仓库测试配置，不能把这一结果作为性能提升证明。

整站隔离启动在现有验收程序的 90 秒及 300 秒期限内均未就绪，未据此声称完整登录链路通过。视觉检查使用实际 `PhysicsWorkspace`、模板、运行时、画布与主题样式独立挂载，和全站端到端测试分开记录。

独立组件浏览器验收已通过：凸透镜、串联电路、平抛、机械波四个真实模板均可展开/收起数据与切换专注模式；物距输入从 30 修改为 20 成功；1320、1086、390 像素宽度未出现页面水平溢出，未捕获页面异常。另保存深色主题截图。此项不包含实验中心的浏览器验收，也不替代完整登录与导航回归。

截图与机器结果位于 `docs/reports/screenshots/lab-polish-2026-10-15/`，包括四个实验、窄屏、手机和深色主题，以及 `component-check.json`。

## 发布状态

源代码修改未发布，正式入口仍运行原镜像。发布前需重新核对 main、服务器版本和运行镜像，并按项目约定保存旧镜像与数据恢复点。
