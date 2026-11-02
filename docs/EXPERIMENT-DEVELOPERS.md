# 实验开发者文档

实验模块采用独立路由、直接进入三维的体验，视觉基准为 Warm Lab。社区贡献首先统一代码规范，物理计算继续来自平台引擎。

## 文档站

站点源文件位于 `overlays/harness/files/apps/web/public/physicsos/developers/`。
随 Web 发布后，入口为 `/physicsos/developers/index.html`；实验中心包含入口链接。
本次交付的候选预览与实际线上发布时间以发布报告为准。

- 代码风格、文件命名、模块职责与 TypeScript 边界。
- 物理状态、拖动 preview/commit/cancel、单位和引擎契约。
- 纯三维交互、资源清理、手机与性能验收。
- Warm Lab 视觉、作者/GitHub 资料、版本发布约定。
- 可按实验 ID 生成、复制或下载的 AGENTS.md。
- 包含格式化、lint、类型与命名检查的工具包。

## 规则与生成资源

`standards.js` 是 AGENTS.md 与基础代码风格的唯一来源。
`content.js` 是页面文档与 Markdown 下载的唯一来源。
`scripts/developers/resources.mjs` 定义独立工具包与候选 JSON Schema。

按项目环境约定执行：

```sh
node scripts/developers/prepare-template.mjs
node scripts/developers/generate.mjs
node --test scripts/developers/standards.test.mjs
```

生成的 `downloads/` 目录与站点一起发布。修改文档后应重新生成，并提交同步的资源。站点不依赖外部字体、CDN、账号或 JavaScript 框架。

## 实际状态

文档、下载、独立实验模板与一致性工具包已实现。模板包含本地预览宿主、参考协议 v1、构建与 ZIP 打包，可直接在独立目录开发。生产站点的上传入口、资源隔离域、正式引擎适配、审核与自动发布尚在建设；不能把本地预览或打包成功当成已上线。正式接入前，实验文件投稿不通过 GitHub PR，也不伪造上传成功。

工具包只负责代码一致性；不能代替物理行为测试、浏览器性能测量或维护者评审。实验模板采用独立配置，不覆盖主站 package.json 或要求贡献者运行主站构建。
