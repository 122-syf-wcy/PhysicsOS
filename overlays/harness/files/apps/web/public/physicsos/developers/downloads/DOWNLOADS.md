# 规范与工具包

把规范、提示词和自动检查一起带回你的编辑器。

## 代码风格工具包

ZIP 包含可执行的 Prettier、ESLint、TypeScript 和命名检查配置，附最小类型示例、全部 Markdown 文档和 AGENTS.md。它是代码一致性工具包，不包含完整实验 SDK、Three.js 样板或上传客户端。

下载项：physicsos-code-style-v1.zip、AGENTS.md、experiment.schema.json、experiment.example.json。

## 在独立工具包里验证

### 解压后运行 · 首次安装需联网

```shell
npm install
npm run format:write
npm run check
```

Node.js ≥ 24.7。依赖使用精确版本；首次安装后保留生成的锁文件，之后使用 npm ci。工具包里的 check = 格式 + 文件命名 + ESLint + TypeScript；不等于完成物理测试或视觉验收。

> **接入已有仓库时**：不要覆盖仓库现有 package.json、ESLint、TypeScript 配置。将新实验代码和必要规则按现有机制接入，继续执行项目 required checks。

## 规范版本跟随贡献记录

本页代码风格规范为 v1.0，包格式与公开 SDK 仍属候选设计。每次修改规范应更新版本和变更记录；旧投稿按其兼容版本复验，不静默改写已审核产物。
