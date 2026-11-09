# 高中实验反馈 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or superpowers:subagent-driven-development. Record verification in the task ledger and continue the already authorized implementation.

**Goal:** 完成反馈中 12 条实验改进，并与未发布的对话审核及学生体验修复一起验证上线。

**Architecture:** 修正平台 runtime 和物理视图，再由现有独立三维包呈现；公共布局和播放器保持同一套状态。

**Tech Stack:** TypeScript、React、Three.js、Vitest、Node test、服务器 Docker。

**Spec:** docs/superpowers/specs/2026-11-09-lab-feedback-design.md

## Global Constraints

- 构建/测试/发布在 107.151.246.59 Docker；本机只编辑、Git 和审阅。
- 不改变当前生产数据，测试账号只写候选；密钥沿用 FILE，不输出明文。
- 物理数据由平台提供；对比轨迹调用同一引擎，渲染器只做几何呈现。
- 保留旧审核验证真实来源和所有失败记录；不重复与新输入无关的测试。

## Review Focus

- 高度较小与手机屏幕仍能操作播放、参数与图像。
- 参数变化/拖动时间/循环结束不产生旧状态、假圆轨道或跳过暂停。
- 负电荷箭头、波的有限传播前沿、动量符号与物理关系正确。
- 比较与新图像不改变当前实验求解状态。
- 修改后的 V3 ZIP 与最终镜像、发布指针一致；旧版本可恢复。

### Task 1: 公共视角、布局和慢放

**Files:** lab-collection/src/renderer.js；PhysicsWorkspace.tsx/.module.css；SceneChatCard.tsx/.module.css；animation-clock.ts；contribution-protocol.ts；相应测试。
**Interfaces:** 保留 WorkspaceRuntime.setRate/setRunning/advance；统一慢速档位至少含 0.05、0.1、0.25、0.5、1、2。其他领域仍可以暂停。
- [ ] 在服务器复现视角方向、低高度同时展示和播放时钟行为。
- [ ] 修复公共交互，针对行为运行测试与浏览器验证。

### Task 2: 力学实验与动量图

**Files:** mechanics-runtime-bridge.ts、mechanics-workspace-runtime.ts、collision-workspace-runtime.ts、energy-workspace-runtime.ts、相关 visual bridge/inspectors/模板与测试；必要物理引擎文件。
**Interfaces:** 使用现有 inspector parameters/choices、view trajectories/vectors 和 charts；避免扩展 V3 契约。比较计算不修改原运行状态。
- [ ] 复现圆轨道与能量播放、速度/分力编辑问题；写能识别问题的回归。
- [ ] 实现反馈第 3、5、6、7、11、12 条及简谐周期播放，验证变化与守恒关系。

### Task 3: 波动形成过程与衍射

**Files:** engine-wave、wave-workspace-runtime.ts、wave-visual-bridge.ts、lab-collection/src/waves.js 和相应测试。
**Interfaces:** 复用现有 trajectories、waveProfile、clock 和 choices；平台生成传播/强度数据。若必须新增契约字段，先与 Root 协调。
- [ ] 写有限传播前沿、叠加、循环暂停及单缝强度测试并观察失败。
- [ ] 补形成/稳定模式与清楚的图示；真实浏览器查看慢速、参数响应和连续播放。

### Task 4: 点电荷空间电场

**Files:** lab-collection/src/fields.js 及 field renderer 测试；必要 electric visual bridge。
**Interfaces:** 单点电荷旋转对称的空间几何沿用实际平台场线及方向；多电荷不作错误轴对称展开。
- [ ] 验证当前场线箭头与单点几何，加入正/负电荷方向检查。
- [ ] 呈现三维场线并检查各视角下箭头可辨识。

### Task 5: 合并验证与发布

- [ ] 检查全部 diff 与 12 条覆盖，完成一次独立审查。
- [ ] 服务器执行受影响测试、严格类型检查、bundle/Vite，并构建新版实验 ZIP；保留未受影响后端证据。
- [ ] 候选中完成 12 条浏览器验收及原任务模型、人工封禁、重启/回滚检查。
- [ ] 核对 main/server/image，保留恢复点，推送并部署；检查正式 HTTPS、官网和新实验发布指针。
