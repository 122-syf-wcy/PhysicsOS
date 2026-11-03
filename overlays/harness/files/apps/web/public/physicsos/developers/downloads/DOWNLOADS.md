# 规范与工具包

把规范、提示词和自动检查一起带回你的编辑器。

## 独立实验模板

优先下载独立实验模板 ZIP。里面有真实 TypeScript 三维入口、本地宿主、消息协议、风格检查、构建与打包工具。它可以离开 PhysicsOS 主仓库开发，不需要修改主站。模板是可运行骨架，直接拖动器材、完整光路等成品功能仍需贡献者完成。

下载项：physicsos-experiment-template-v1.zip、physicsos-code-style-v1.zip、AGENTS.md、experiment.schema.json、experiment.example.json。

## 在自己的目录执行

### 下载、解压、开发、打包

```shell
npm install
npm run dev

# 修改代码后构建并刷新
npm run build

# 提交前
npm run format:write
npm run check
npm run build
npm run pack
```

Node.js ≥24.7。首次安装后保留锁文件；后续使用 npm ci。发布 ZIP 为 release/<experimentId>-<version>.zip，已编译页面的依赖位于包内。

> **工具包和实验模板不要混淆**：代码风格工具包仍可单独下载，用于格式与命名；只有独立实验模板包含 dev/build/pack 和本地预览。不要把主站内部构建命令用于独立实验包。

## 文件协议与上线状态

文档规范 v1.2，文件协议 v1。本版本首先接通凸透镜的上传、审核和默认展示；其他实验逐步适配。开发者在自己的目录制作，在对应实验提交，不需要 GitHub 自动部署或主站发布凭据。
