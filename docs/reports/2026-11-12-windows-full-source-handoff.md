# Windows 全量源码交接

本次按用户要求核查主目录和其余 10 个工作树，把最新网页／服务端源码同步到安卓交接分支，并保存尚未入库的本地源码变体。

## 使用哪个分支

Windows 开发继续使用 `codex/android-student-app`。它已包含网页正式源码基线 `7b0a1ab0ecabd29dee832073ad08eb7faacd30ef`、原安卓交接提交 `7301ca8`／`997ff40`，以及本次全量源码归档。合并提交为 `9941c02ef1e84c393063289fd0a60c49b5eb7afb`。

`main` 仍表示经过服务器发布验证的网页基线。安卓分支包含此前已说明的未完成 App／移动后端源码，不将这个开发快照当作新的服务器发布版本。

已有 Windows 仓库先提交自己的修改，再在当前安卓开发分支执行：

```powershell
git fetch origin
git merge origin/codex/android-student-app
git submodule update --init --recursive
git lfs pull
```

正常 merge 保留 Windows 自己的提交；不要强推或使用 reset 覆盖本机开发。若尚未建立本地安卓分支，使用 `git switch --track origin/codex/android-student-app`。Git LFS 只负责仓库中的图片等资产，已提交的源码不依赖 LFS。

共享源码在 `packages/`、`experiment-packages/`、`apps/mobile-lab/` 及 `overlays/harness/files/`；上游固定版本与 `overlays/harness/upstream-changes.patch` 一起重现宿主。首次干净 submodule 可按安卓 README 执行 Overlay；已有物化改动时先保护差异，不直接覆盖或 capture 旧副本。

## 全量审计结果

- 主目录 vendor 的 1,056 个脏／未跟踪文件全部在已提交 overlay、补丁或当前分支可达历史中有恢复来源，其中 251 项是旧版本，不反向覆盖最新源真值。
- 其余工作树的已保存源码按 Git blob 和所有历史补丁目标摘要去重。发现的 12 份独有源码、配置或测试变体原样存入 [`archives/local-source-20261112`](../../archives/local-source-20261112/README.md)，每份附源工作树、分支、HEAD、字节数、SHA-256 和 Git blob ID。
- 归档只保存原件，不把旧 demo、调试探针或未验证测试变体替换成产品代码。两份依赖锁变体及一个生成模板未作为独有功能源码重复归档，原因在清单中。
- 23 个旧本地分支已被 `main` 历史包含；另 11 个有独有提交的历史分支保留到远端对应分支，供 Windows 查询，不重新合入生产源码。
- 唯一历史 stash 也已完整保存到远端 `codex/archive-android-pre-main-20261110`，提交 `90d618ba819f80fa657a591d4f15023606abf340`。其中 35 个变更文件有 32 个原已保存，另外 3 个旧源码变体共 110,386 字节通过该分支保留；working／index 两个原快照均保留。原本地 stash 未应用、弹出或删除，不用旧快照覆盖当前代码。
- `vendor/deepseek-harness` 固定 gitlink 保持 `477b4f420553e8a52c2fbccc464d7561b239c443`，没有向第三方上游提交或推送子模块生成内容。
- 依赖、SDK、构建缓存、设备配置、Cookie、密钥及环境文件按跨平台约定不提交。

## 合并与检查范围

网页主线合入安卓分支时仅两个入口冲突。学习服务同时保留移动检查点和移动 facade、用量统计及白板；出卷服务同时保留用量收据／请求归属、移动 facade 和持久化 pipeline，恢复逻辑由 pipeline 负责，避免旧全量失败处理覆盖已提交的可恢复任务。

服务器既有 Docker 对本次相对网页基线的 119 个 TypeScript 文件完成语法解析，对 121 个输入文件逐项校验 SHA-256，`package.json` 和 `pnpm-lock.yaml` 解析通过；合并冲突标记及 Git whitespace 检查通过。审查未发现必须阻止开发交接的合并遗漏。

这些检查不等于完整类型检查、安卓编译或移动端到端验证。此前记录的安卓缺失页面、资源与移动 API 接线仍按[原交接状态](2026-11-10-android-windows-handoff.md)处理；本次没有为源码同步扩展产品实现或重新部署开发分支。
