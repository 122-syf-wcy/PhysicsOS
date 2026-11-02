# 实验包格式

先约定可审阅、可验证的格式，再开放自动上传。

## 格式正在收敛，上传尚未开放

> **明确边界**：本页是实验包 V1 草案。当前提供清单示例与 JSON Schema 供讨论和准备，不是已接通的上传协议。公开 SDK 和服务器包校验发布前，以仓库 PR 为准。

## 建议的提交结构

### 一个实验，一个贡献包

```text
convex-lens/
  experiment.json
  src/
    main.ts
    lens-renderer.ts
    lens-interaction.ts
  assets/
    apparatus.glb
    cover.webp
  teaching.json
  cases.json
  README.md
  MODEL.md
  ASSET-LICENSES.json
  LICENSE
```

main.ts 入口需等待 SDK 契约确定。源码包不包含 node_modules、密钥、会话或预装依赖；平台构建不执行投稿者任意安装脚本。

## 清单中需要表达的内容

### experiment.json · 候选结构

```json
{
  "schemaVersion": 1,
  "experimentId": "convex-lens",
  "version": "1.0.0",
  "entry": "src/main.ts",
  "renderer": "three",
  "theme": "physicsos-warm-lab-v1",
  "engine": {
    "id": "optics",
    "contractVersion": 1
  },
  "cover": "assets/cover.webp",
  "teaching": "teaching.json",
  "referenceCases": "cases.json",
  "assetLicenses": "ASSET-LICENSES.json",
  "license": "Apache-2.0"
}
```

SDK 版本范围待正式发布时加入必填契约，不填写一个不存在的版本。experimentId 必须与投稿入口对应；版本号冻结到具体产物摘要。作者主身份由登录账号绑定，不信任包里自填的用户 ID。

## Schema 只是第一道检查

下载包附带的 JSON Schema 检查字段与基本格式；解压路径、符号链接、资源 MIME、压缩炸弹、依赖与执行隔离必须由服务器单独验证。通过 JSON Schema 不代表物理正确、资源安全或已获审核。
