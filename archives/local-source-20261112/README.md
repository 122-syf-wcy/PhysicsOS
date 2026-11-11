# 本地未入库源码变体存档（2026-11-12）

本目录按原始字节保存本地工作树中尚未作为独立 Git blob 入库的源码变体，供 Windows 安卓开发交接、研究与后续人工整合。它们不是当前构建真值，也不代表已经验证或批准上线。当前有效网页/服务端源码仍以仓库现行目录及服务器正式集成验证结果为准。不要直接用本目录覆盖现行代码。

- `experiment-contribution/`：包含三个测试文件和一份未完成的阶段报告。`chat-code-experiment.mjs` 与 `chat-code-optics-checks.mjs` 成套保存，前者新增 `--optics-smoke` 并依赖后者；`bridge.live.test.mjs` 是隔离测试环境的独立变体。报告中的历史运行结果是原作者记录，本次只做存档，没有重跑或新增通过声明。
- `experiment-pages-3d/`：两个旧视觉稿变体（README 和静态预览服务器）。现行 demo 入口/路由已经继续发展，这两个旧文件不应回填覆盖现行实现。旧 `index.html` 字节已以现行 `visual-studies.html` 保存，其他视觉稿源码与功能素材也已有相同 Git blob，因此未重复复制。
- `main-harness/tmp/probe/`：本地主 Harness 中遗留的 `sm-test.ts` 探针，仅用于保留调试源码，不属于产品入口或正式测试套件。

`manifest.json` 记录每份原文件的源工作树、分支、HEAD、字节数、SHA-256 和 Git blob SHA-1。源工作树内容未更改。复制前的秘密模式扫描已通过；两处固定测试密码仅作为已审阅的测试夹具保留，没有复制 `.env`、Cookie、真实密钥、依赖目录、缓存或临时截图。

本次没有运行这些历史变体；归档不影响现行产品、测试入口或生产部署。

## 附属 Harness 工作副本

另保存五份无法由任何可达 Git blob 或已提交 `upstream-changes.patch` 的 postimage 恢复的配置、源码与测试变体，位于对应工作树名称下的 `vendor/deepseek-harness/` 原路径：conversation-moderation 的旧 web-app 配置；experiment-contribution 的管理员 mock 测试变体、旧内联包限制源码及私有题目图片集成测试；experiment-pages-3d 的旧可选属性传递变体。保留它们是为了避免丢失未完成源码，不判断其可直接合入现行产品。

附属工作树其余 Harness 文本源码逐字节已存在于可达 Git 历史、已保存 patch postimage，或与主目录 Harness 副本一致。两个依赖锁变体和一个生成的模板数据文件未复制，原因见 manifest。私有题目图片测试中的固定测试键及用于拒绝凭据 URL 的负向夹具已人工复核，无真实凭据。
