# 实验包格式

先约定可审阅、可验证的格式，再开放自动上传。

## 平台加载的是已审核的文件包

贡献者在本地编译，交付带源码的浏览器静态包。平台校验后在隔离域提供 dist/index.html，通过消息协议接入参数和快照。贡献者无需修改主仓库，主站也不需要为每次投稿重新构建。

> **尚未开放生产投稿**：模板可以构建、校验、打包与本地预览。服务器上传、重建比对、审核与默认版本切换仍需实现。

## ZIP 根目录固定

### 提交产物 · 工具自动收集

```text
experiment.json
dist/
  index.html
  runtime/main.js
  runtime/protocol.js
  runtime/lens-renderer.js
  vendor/three.module.js
  vendor/three.core.js
  assets/
src/
  main.ts
  protocol.ts
  lens-renderer.ts
parameters.json
teaching.json
cases.json
README.md
MODEL.md
ASSET-LICENSES.json
LICENSE
```

ZIP 不要再套一层随机目录。src 用于审核，dist 用于实际运行，二者必须对应。node_modules、preview、.env 和本机数据不会进入 pack 的白名单；dist 内的隐藏文件、符号链接和超限资源会被拒绝。

## 实验包清单

### experiment.json · 参考文件协议 v1

```json
{
  "schemaVersion": 1,
  "protocolVersion": 1,
  "packageType": "browser-static",
  "experimentId": "convex-lens",
  "version": "1.0.0",
  "entry": "dist/index.html",
  "renderer": "three",
  "theme": "physicsos-warm-lab-v1",
  "engine": {
    "id": "optics",
    "contractVersion": 1
  },
  "parameters": "parameters.json",
  "cover": "dist/assets/cover.jpg",
  "teaching": "teaching.json",
  "referenceCases": "cases.json",
  "assetLicenses": "ASSET-LICENSES.json",
  "license": "Apache-2.0"
}
```

experimentId 必须匹配上传页；作者身份由登录账户绑定。入口和所有资源采用包内相对路径，不引用贡献者磁盘或外部脚本。版本和审核产物冻结；改一个文件就提交新版本。

## 本地检查与服务器审核各自负责

| 本地工具已检查 | 平台仍须检查 |
| --- | --- |
| 必需文件、入口、清单基本字段、相对入口资源 | 目标实验权限、完整 Schema、协议兼容与资源实际类型 |
| 符号链接、隐藏文件、1000 文件/40 MiB 总量/20 MiB 单文件 | 上传压缩体积、解压炸弹、路径冲突、隔离执行与完整依赖图 |
| 格式、命名、类型、lint、基础打包测试 | 源码与 dist 重建比对、物理参考用例、手机与性能验收 |

本地检查不是安全认证或审核通过。即便本地工具没有发现问题，服务端也必须重新验证同一份不可变 ZIP。
