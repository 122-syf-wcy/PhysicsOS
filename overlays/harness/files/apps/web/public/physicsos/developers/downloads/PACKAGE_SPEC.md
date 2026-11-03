# 实验包格式

一个独立文件包，经过审核后自动展示。

## 平台加载的是已审核的文件包

贡献者在本地编译，交付带源码的浏览器静态包。平台校验后在隔离域提供 dist/index.html，通过消息协议接入参数和快照。贡献者无需修改主仓库，主站也不需要为每次投稿重新构建。

> **首版接收范围**：仅接收 convex-lens、optics contractVersion 1、protocolVersion 2。服务器校验并冻结已编译产物，不执行上传包中的安装或构建脚本。物理、视觉与许可由管理员交互审核；自动校验不表示审核通过。

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

### experiment.json · 参考文件协议 V2

```json
{
  "schemaVersion": 2,
  "protocolVersion": 2,
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
  "cover": "dist/assets/cover.svg",
  "teaching": "teaching.json",
  "referenceCases": "cases.json",
  "assetLicenses": "ASSET-LICENSES.json",
  "license": "Apache-2.0"
}
```

schemaVersion 与 protocolVersion 固定为 2，experimentId 固定 convex-lens，engine 为 optics / contractVersion 1。parameters.json 中三个参数使用 cm，安全范围 [1,200]；生成默认值、显示范围、只读字段不可修改。teaching.json 为有界教学文本。cases.json 保留五个必需薄透镜用例，所有额外用例也由平台光学引擎验证。ASSET-LICENSES.json 覆盖 dist/assets 与 dist/vendor，声明真实 HTTPS 来源或 original；Schema 之外的语义约束由同一 canonical validator 执行。experimentId 必须匹配上传页；作者身份由登录账户绑定。入口和所有资源采用包内相对路径，不引用贡献者磁盘或外部脚本。版本和审核产物冻结；改一个文件就提交新版本。

## 本地检查与服务器审核各自负责

| 本地工具 | 服务器与审核 |
| --- | --- |
| 必需文件、入口、清单基本字段、相对入口资源 | 登录权限、目标实验、清单协议与资源类型 |
| 符号链接、隐藏文件、1000 文件/40 MiB 总量/20 MiB 单文件 | 20 MiB ZIP、解压体积、重复路径、CRC、模块依赖与包内资源 |
| 格式、命名、类型、lint、基础打包测试 | 人工核对源码与产物、物理参考用例、手机操作与素材许可 |

本地检查不是安全认证或审核通过。即便本地工具没有发现问题，服务端也必须重新验证同一份不可变 ZIP。
