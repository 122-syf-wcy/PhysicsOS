# 从这里开始

用共同的约定，把每个独立实验做成同一个 PhysicsOS。

## 一条清晰的贡献路径

先让代码说同一种语言，再让不同的实验各自精彩。平台统一页面与物理能力，你专注于真实、清楚、可操作的三维装置。

- 阅读代码规范，下载代码风格工具包。
- 复制 AGENTS.md 到实验目录，或把生成的任务提示词交给你的开发助手。
- 找到对应实验的场景工厂、WorkspaceRuntime 和已有行为测试，先复用，再扩展。
- 实现纯三维装置，遵循 Warm Lab 视觉与生命周期标准。
- 完成类型、lint、行为测试和桌面/手机检查，通过 GitHub PR 提交。

> **当前开放范围**：文档、AGENTS.md、格式配置与代码风格工具包可直接使用。公开实验 SDK、ZIP 投稿、审核后自动发布仍在建设；当前贡献通过仓库 PR。

## 先分清谁负责什么

| 平台负责 | 贡献者负责 |
| --- | --- |
| 引擎、单位、场景命令、结果校验 | 三维器材、场景、光照、材质 |
| 页面、参数控件、记录、报告、作者展示 | 器材拖动、选择、高亮、观察视角 |
| 登录、权限、版本与发布流程 | 教学内容、参考用例、素材许可 |

## 在现有仓库中工作

### 克隆与准备 · 不包含生产凭据

```shell
git clone https://github.com/你的用户名/PhysicsOS.git
cd PhysicsOS
git submodule update --init --recursive
node scripts/overlay/harness-overlay.mjs apply
pnpm install
pnpm -C vendor/deepseek-harness install
```

Node.js ≥ 24.7；根工作区使用 packageManager 固定的 pnpm 版本，Harness 使用它自己的版本。项目维护者的构建/测试环境遵循项目 AGENTS.md；社区开发者不需要生产服务器权限。

> **源码位置**：Web 自有代码以 overlays/harness/files 为真值，packages 存放领域包。overlay 应用进 vendor 后再构建；不能在生成结果里修好后忘记同步源码。

## 第一个贡献应该足够小

建议从凸透镜的一种器材或一段交互开始：补全光屏拖动与取消、改进器材材质、修复手机标注遮挡。一个 PR 只解决一个可以验证的问题，不连带重写整个工作台。
