# 独立可视化渠道与素材库

## 目标与边界

2026-11-19：为知识点/题目的代码可视化独立配置文本模型与账号池、图片模型与账号池，改进作者教学/视觉 brief，并将配套图片持久保存、检索及复用。

本次使用独立 Web clone 的 `codex/visualization-channels-material-library-20261118` 分支，不修改 Android 交接树。服务器 `107.151.246.59` 与 Docker 是正式构建、测试和部署环境；正式入口仍是 `https://physics.dongsiwei.com`。

用户指定文本渠道 `https://ai.apizn.com`、模型 `gpt-6.2-sol`。凭据只从受保护的操作文件读取、通过已有密钥加密机制入库，不进入源码、提示词、公开包、日志或浏览器存储。此前最小 Node Chat/Responses 连通性探测返回 200；这不等于新执行器、完整子代理或视觉质量验收。

## 已接入的源码

### 文本渠道与主模型回退

- 新版本 0 域 `physicsos_generation_channels` 独立于普通聊天账号池；用途分别为 `text`、`image`，用途不可通过 PATCH 迁移。
- 后台接口前缀 `/physicsos/model-pool/generation`，只有现有 SUPER_ADMIN 身份可以管理。支持模型声明/选择、渠道优先级、多 key 加权轮转、冷却与重置、模型发现及独立策略。
- 私有 provider `physicsos-generation-text` 复用已有 PiAiAdapter，显式支持 Completions/Responses。每个生成任务有不可透明转用的路由 lease，避免把模型名称修改误当成真正隔离。
- 主模型在任务入场时冻结：完整有效的服务端 pending 模型选择优先，否则使用最新主请求配置；不能拼接两份配置的半个 provider/model。
- 只有未配置，或同一配置与凭据版本下所有相关账号具有明确 HTTP 429/有效 429 冷却证据，才使用该任务冻结的主对话模型继续。
- 401/403、超时、5xx、未知冷却、未尝试完的账号、部分或无效输出不冒充全部限流。SDK/独立 provider 不额外重试已经接受的部分文本结果。
- 回退不重置最多两轮作者、同一个十分钟截止时间、代码写入次数、输出与图片限制。

### 图片与素材复用

- 正式可视化图片入口走独立 image executor，不借用文本 key。既有题图/其他任务的图片配置不变；正式发布前将现有可视化图片配置明确迁入独立加密渠道。
- 作者先判断是否需要位图，需要时检索匹配素材、使用授权候选；缺失时才生图。公式、矢量、光线、轨迹、读数与物理状态不得烘焙到图片中。
- 生成结果严格验证 PNG、尺寸、CRC、解压大小和摘要，随后自动入库，再绑定为当前 job 的合法资源路径。成功生成但未被最终 renderer 选择的候选也保留；保存失败不伪报已保存。
- 素材库使用 PostgreSQL 独立表与 B-tree/GIN 索引、规范化词/n-gram、有界候选和认证游标，不使用整库 `loadAll` 冒充检索。
- 元数据含主题、用途、标签、风格、尺寸、MIME、摘要和实际图片模型。原始提示词、来源 job、渠道/配置版本和数值 token 用量留在私有服务端字段。
- 默认 private，可显式共享至当前学校。SUPER_ADMIN 身份本身不授予任意私有素材读取权限。
- 使用时再次校验权限、摘要、当前账号/学校和当前任务，再复制 bytes 到本 job。禁止直接引用旧 job URL、图库内容 URL或外部地址。
- 配额覆盖 pending、取消、失败保留、软删除等实际占用；保留原子发布、fsync、no-follow、幂等 operationId、取消栅栏与重启恢复。
- 软删除/恢复影响图库检索，不改已经冻结的可视化包。每任务最多两次生图请求，失败也计数；复用不调用图片模型。

### 后台与绘制质量

- 现有“模型通道”页新增“主对话通道 / 可视化与生图”分区；新组件分别管理文本/图片，不覆盖原池配置。
- 管理后台增加“素材库”，沿用当前账号/学校权限，支持 authenticated blob 预览、真实游标分页、标签、学校共享、软删除、恢复和配额。
- Secret 表单提交/失败/取消后清空，不进 localStorage。通知使用原生 shell overlay Toast，按实际页面账号绑定，切换账号清理并重挂载。
- 新教学 brief 有版本与独立上下文边界，只读取有界已发布视觉指导和当前注册参数，不回灌完整旧上传文档、私有对话或原始求解对象。
- 无位图需求时允许严格 native-only 代码；原生资源、封闭模块、源/owner/job/hash、真实绘制和物理门禁不取消。
- 新静态验收只覆盖 `engine-optics` 1.0.0 / `thin_lens_imaging` 的有限实像。要求同一时刻冻结重放、独立轴线标定的 Canvas 线段/箭头/原生文字、真实 object-height V3 参数提交和移动端重绘。
- 原动态力学 motion/changed-frame 门禁保留。未知域、虚像/焦点、镜面、电路、混合装置及 SVG-only 静态候选不冒充验证通过；私有预览 ready 不等于独立验收通过。

## 验证状态

当前为实施源码冻结准备，不能据此宣称正式构建、完整生成、真实 PostgreSQL/浏览器验收或发布已经完成。

子任务的离线/源级结果只作为诊断：生成后台早期 138 mocked/offline cases、素材库早期离线用例、prompt 与 UI parse、worker 纯 verdict/source checks 均不能替代最后一次服务器 Docker 的同源验收；后续源码清理后必须重新执行。

待正式验证：

1. 新锁图真实 offline/frozen 安装、ABI/入口探针、全部 159 包的完整 batch 构建及新的源/代码/签名摘要。
2. 新渠道、原池回归、冻结主模型回退矩阵、取消/partial/并发配置与凭据变更、真实 Responses streaming/function calling/代码写入。
3. 独立 disposable PostgreSQL 的索引/并发配额/权限/版本升级/重启恢复；PG opt-in skip 不算通过。
4. 首次真实生图、自动入库、下一次匹配复用且无新图片 API 调用、不匹配再生成、图库删除不破坏原冻结包。
5. 固定知识点/题目场景的真实截图、控制、文字/数据/素材与 mobile 布局；重建 worker，并运行原 mechanics + 新 optics Docker browser gates。
6. 旧教学功能与统计容量、客户端入口、完整 host 回归、签名冷验证、独立候选及配对发布/回滚证据。

## 发布准备与容量

- 发布前重新核对远端 main、服务器 checkout、实际运行 app/worker 镜像，保留切换前镜像和配对数据恢复点。
- 正式 app 通过 Compose 明确 `PHYSICSOS_PUBLIC_URL`；独立候选由已校验 httpPort 派生自己的 loopback origin，不继承生产域名，不开放任意 Env 覆盖，也不改 worker 内部来源地址。
- 使用已验收的聚合 tsc + 每批最多八个 exact tsdown packages 的完整构建路径，不删 scopes。
- 2026-11-19 已按活跃引用、挂载、冻结 Git/manifest 与链接校验，移除 22 个旧展开/生成子树：根盘实增约 91.5 MiB，tmpfs 实增约 363.5 MiB。生产、当前 4a 候选、全部回滚/配对数据点、Git对象和清单保留。
- 当前根盘仍仅约 1.3 GiB，不能由这次清理推定 full-runtime fallback 容量充足。继续实际水位守卫，不降低原发布门槛；正式发布状态以后续同源验收记录为准。
