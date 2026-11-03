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
`scripts/developers/resources.mjs` 定义独立工具包与实验包 JSON Schema。

按项目环境约定执行：

```sh
node scripts/developers/prepare-template.mjs
node scripts/developers/generate.mjs
node --test scripts/developers/standards.test.mjs
```

生成的 `downloads/` 目录与站点一起发布。修改文档后应重新生成，并提交同步的资源。站点不依赖外部字体、CDN、账号或 JavaScript 框架。

## 实际状态

本分支已实现凸透镜的独立文件投稿闭环：登录后在实验页点击“贡献实验”，上传构建后的 ZIP 与作者资料，平台管理员预览、审核并发布；新开的实验使用最新通过的版本，已有记录固定原展示，历史版本可回滚。官方样板、社区版本、作者头像与 GitHub 展示均接入页面。其他实验尚待协议适配。

服务代码位于 `overlays/harness/files/packages/physicsos/experiment-host/`；数据包括 storage-domain 元数据与 `DSH_HOME/experiment-packages` 文件，备份必须同时覆盖。实验代码由可信外层加不透明内层 iframe 隔离，服务器不执行上传者脚本。生产是否已切换以本次发布报告为准；本地模板预览成功仍不表示审核通过。


工具包只负责代码一致性；不能代替物理行为测试、浏览器性能测量或维护者评审。实验模板采用独立配置，不覆盖主站 package.json 或要求贡献者运行主站构建。
