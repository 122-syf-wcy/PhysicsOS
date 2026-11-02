# PhysicsOS 独立实验模板

在自己的目录制作实验，生成 ZIP，上传到对应实验页面。无需克隆 PhysicsOS 主仓库、改主站源码或提交 PR。

## 快速开始

Node.js >=24.7；第一次安装需联网：

```sh
npm install
npm run dev
```

打开 http://127.0.0.1:4175。预览器不使用生产账号；滑杆/数值由本地宿主提供，iframe 内为独立三维实验文件。

这个模板不是完整的凸透镜成品：已演示装置、相机旋转、类型校验、MessageChannel 和快照更新。需要贡献者继续完善器材拖动、光线、标注、手机和键盘体验。

修改 src 后运行 `npm run build`，再刷新预览页。dev 没有自动热更新。

## 交付实验文件

```sh
npm run format:write
npm run check
npm run build
npm run pack
```

产物为 `release/convex-lens-1.0.0.zip`。入口 `dist/index.html`，全部运行资源在包内；ZIP 同时带源码、清单和审核资料。pack 不收集 node_modules、preview 或环境变量文件。

不要修改 dist 后跳过 build；源码与产物必须对应。第一次 npm install 后保留 package-lock.json，后续使用 npm ci。生产服务应重新校验并重建比对上传内容。

## 与平台的关系

`src/protocol.ts` 和 HOST_PROTOCOL.md 是参考文件协议 v1。实验只接收宿主快照，发出参数预览/提交/取消意图，不访问主站内部模块或 parent.document。

预览器使用明示 preview-fixture 的开发快照，不是正式平台引擎。平台上传、审核与自动发布服务尚未接通；不要把本地预览成功标为已上线。最终规则是最新审核通过版本成为该实验默认效果，正在运行的实例固定原版本，历史可回滚。

## 作者

在网站上传时填写公开署名、简介、GitHub 个人主页/源码仓库及共同作者；有 GitHub 主页优先显示 GitHub 头像。身份由账号绑定，不通过修改包内 userId 冒用他人。

## 文件

- experiment.json：目标实验、入口、协议与版本。
- src：独立三维实现、宿主通信与类型边界。
- public：静态入口和素材，构建时进入 dist。
- preview：仅本地开发宿主，不进入上传 ZIP。
- parameters.json / teaching.json / cases.json：参数、教学、参考用例。
- MODEL.md / ASSET-LICENSES.json / LICENSE：模型边界与授权。
- AGENTS.md：给开发助手的标准提示词。
