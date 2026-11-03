# 实验开发包 V2：验收与交接

状态：V2 候选开发者流程与真实浏览器验收完成；未部署、未推送 main。本文随 Task 4 源码提交，最终范围审查由控制器完成。

## 环境与边界

本机仅编辑源码、整合 Git。全部安装、检查、构建和浏览器验收在 `root@107.151.246.59` 的 Docker `physicsos-experiments-build` 中执行：源码 `/app`，应用 Harness `/app/vendor/deepseek-harness`，Node 24.7.0、pnpm 11.7。验收使用该容器内的独立候选进程、私有 JSON 数据目录和本地模型夹具，未创建候选发布镜像。没有访问生产账号或修改生产数据库、检出目录和运行容器。

只读核对：远端 `main` 与服务器 `/opt/physicsos` 检出均为 `33023a2c8d708c84fdf14210e7be9fcc7c8c363c`；生产 `physicsos-app-1` 仍运行 `sha256:45c40254bef05b8218c586a538c45f246a653da2a8ebdbe210c31455271b95b8`。正式入口为 https://physics.dongsiwei.com。此任务没有上线、清理生产数据、切换镜像或推送 main；正式环境不会因候选验收而获得 V2 投稿功能。

Task 4 基线 `07c61f8`，依次继承已审查的契约、运行时和发布工具变更：`d5e51b3`、`3d5cdd4`、`26a46cf`、`1fddc55`、`bc5c0c1`。源码真源仍是 overlays；未提交 vendor 子模块指针。

## 实际开发者流程

从重新构建后的候选站真实开发者入口 `/physicsos/developers/index.html` 下载描述符与不可变 V2 模板，而非直接复制仓库模板。选定 `convex-lens`，在独立任务字段输入修改底板材质的要求。显示、浏览器剪贴板和下载的 AGENTS.md 全文一致，含当前候选源站、实际模板 URL 和实际 SHA；桌面、390×844 手机布局均无横向溢出。

实际模板为 63 个文件、232146 字节，SHA-256 `f9165baa152c62ad73c1d51f9e62e68abe53e480d642bd5a655393f25061b936`。每次验收动态读取描述符并比较真实响应字节，未硬编码模板摘要。安全解压到独立私有目录后，正常 `npm ci --include=dev` 成功；从下载源码改变底板颜色与内容版本，运行 `npm run format:write`、`npm run release`。release 的 check（格式、命名、lint、类型、19 个测试）→ clean build → metadata/resources validation → pack 全部成功，每个产物报告与 ZIP 实际字节一致。

| 源码产物 | ZIP 字节数 | SHA-256 |
| --- | ---: | --- |
| 1.0.0：蓝紫底板、first 标记 | 2199811 | `14f496bddc3321a934299e44ee2e66889273f0cfc04fcd8c3d92a7b45b4e6fe7` |
| 1.1.0：蓝色底板、second 标记 | 2199813 | `c9bf449b1bc7f8e75ca20a2f444805abd119a4a9409012491ac859dac5810b29` |
| 1.2.0：上传页独立源码版本 | 2199811 | `2ea464046607b3c2fb6c757b990281c9388d6614cb6a1e7d9a331de90dbb94d6` |

提交给平台的是 release 生成的 ZIP。只有故意无效的拒绝样本通过 ZIP 字节改写生成；有效投稿没有直接 pack 绕过 release。为处理验收中断，`--resume-releases` 重新核对站内描述符和已完成产物 SHA 后复用这三个真实发布包，未重复 npm ci 或既有模板套件。

## 浏览器业务证据

学生通过原生文件选择器在统一上传页提交 1.0.0；独立上传入口验收再次使用真实源码产物 1.2.0，覆盖键盘选择、移除后重选、头像选择、错误单位的具体建议、刷新/历史、延迟场景同步后的路由保持和手机布局，并审核成为候选当前默认。服务器返回 201，存储版本为 schema/protocol 2。管理员获得精确冻结 ZIP，下载字节逐字节等于 release 产物，SHA 与审核展示一致；匿名、其他贡献者不能获取待审私有材料，也不能审核。

V2 正常预览有真实 WebGL canvas、`platform-engine` 来源和 `experiment/rendered` 回执。另一个浏览器上下文将 WebGL getContext 置为不可用，在 12 秒内观察到真实 V2 `experiment/error`、`RENDER_FAILED`，显示失败并禁用发布；该证据不是 15 秒普通超时，也不是 Node 的 GPU mock。

管理员通过第一版后，新实验采用第一版；此前保存的官方实验仍使用官方视图和原记录。通过第二版后，仍打开的第一版 iframe 与源码标记保持第一版；保存后的第一版实验地址重新打开，仍显示第一版并保留一条记录；新实验显示 second。回滚后，新实验恢复 first，第二版仍为 approved 历史，未删除较新版本。

真实平台快照验证：物距 u=15 cm、焦距 f=10 cm 时像距为 30 cm；物高改为 9 cm 后有符号像高为 -18 cm，canvas 像素发生变化。显示像、主光线开关改变画面而不改变引擎结果；Escape 取消输入不改变参数或修订号。390×844 实验页无横向溢出，正常流程没有未捕获异常或 error console。

| 实际无效 ZIP | 服务器结果 | 可操作提示 |
| --- | --- | --- |
| 参数单位 cm 改为 m | 400 `INVALID_METADATA` | 固定文件、字段路径、恢复 V2 固定单位的建议 |
| 未注册 experimentId | 400 `UNSUPPORTED_EXPERIMENT` | 明确只支持 convex-lens |
| 清单 2 / 协议 1 | 400 `INCOMPATIBLE_PROTOCOL` | 清单与协议必须一致 |
| 删除被引用 JS 资源 | 400 `INVALID_ARCHIVE` | 格式、文件、资源或协议不符合要求；资源错误仍是通用提示 |

冻结资产导航的原有负例改为在真实渲染状态出现后尝试外站与同站越界导航：两个请求计数均为 0，直接打开原始 capability 入口被拒绝，候选负例退回而不发布。

## 验收发现与修复

初始正常候选预览位于弹窗下方、视区之外。浏览器消息探针证明 wrapper 与 SDK 均为协议 2、原始 canvas 已挂载、平台首快照已发送，但 SDK 状态仍是“等待宿主连接”，15 秒后失败，console 干净。只将 iframe 滚入视区，同一 ZIP 即变为“已连接平台物理快照”并收到渲染回执，证明浏览器暂停了不可见 opaque iframe 的 requestAnimationFrame。

修复只在新选择的 CandidatePreview 挂载时把该预览滚入视区；不会随每次参数、状态或结果更新重新滚动。首帧必须实际绘制的要求、超时、SHA 审核、权限和液态玻璃样式都保留。既有正常预览断言由真实浏览器 RED 转为 GREEN；面板测试验证每次候选选择滚动一次并保留失败/选择重置门槛。

自然选择后的实测几何：待审画布 top=197.375 px，sticky header bottom=165 px；已审画布 top=461.375 px，header bottom=165 px，均未被遮挡。早期 region 截图会为捕获元素另行滚动，造成标题/冻结 ZIP 链接被 sticky header 遮盖；这是截图动作的滚动效果。正向审核截图改用 embedded 上传页，未为截图另改 CSS。

另一次全链命令在全部业务断言完成、正常 console 检查通过后，因旧 hostile 夹具要求 100 ms 破坏性导航前已经 ready 而失败。V2 的真实绘制不能沿用 V1 connected 即 ready 的假设。保留全部越界断言，将此负例隔离重放并在真实绘制后触发，重放命令 exit 0；没有重复已经完成的审批、旧记录或回滚操作。启动等待、文档目录 URL 和新增测试上下文语言设置的早期错误只是夹具设置问题，不计作产品 RED。

## 检查与可复查记录

以下命令均在服务器 Docker 内执行，运行凭据从候选私有文件读取；发布报告和截图不携带凭据、Cookie 或 capability URL。这里只列私有日志位置和安全检查结果。

| 检查 | 结果与来源 |
| --- | --- |
| UI、tool-cordis 类型 | exit 0，`/tmp/physicsos-task4-types.log`；修复后 UI 类型也 exit 0 |
| UI full bundle、Vite | exit 0；包含 optional-workspace 4.42 MB；当前 public docs 在 Vite 前复制；`/tmp/physicsos-task4-final-{ui,vite}-build.log` |
| tool-cordis catalogue owner bundle | tsc 后根 tsdown 对实际 owner 构建 exit 0，`/tmp/physicsos-task4-catalog-final-build.log` |
| 面板受影响套件 | 2/2；最后检查日志 `/tmp/physicsos-task4-panel-final.log` |
| 源码/面板测试 scoped oxlint | 0 warning / 0 error；同文件原有 JSX 缩进与测试方法保存方式一并规范，`/tmp/physicsos-task4-lint-fix.log` |
| 三个真实下载源码发布 | 每个 release 含 19/19 测试；`downloaded-release.log`、`release-evidence.jsonl` 保存于候选私有目录 |
| 主浏览器业务断言 | 全部经过至旧 hostile 负例 ready 断言；`/tmp/physicsos-task4-contribution-fixed.log`；私有业务恢复点再次核对回滚 SHA 和较新 approved 历史 |
| 修正后的越界负例 | exit 0，`node tests/acceptance/experiment-contribution.mjs --check-containment`，`/tmp/physicsos-task4-containment-final.log` |
| 候选重启持久化 | exit 0，`node tests/acceptance/experiment-contribution.mjs --check-persistence`，`/tmp/physicsos-task4-persistence.log` |
| 完整上传入口、错误建议、历史与手机 | exit 0，`node tests/acceptance/experiment-upload-entry.mjs`，`/tmp/physicsos-task4-upload-entry-green.log` |

本轮追加的上传入口重试只修正已选择文件后原生按钮的 aria label（“更换实验文件”），未修改产品按钮行为；错误单位提示在首次尝试已通过。

Task 1–3 已完成并审查，未重跑其不受本次修复影响的套件。继承 Task 3 最终证据：host 7 文件/114 pass；storage-domain 35 pass 加实际 host 1（联合 36 pass）；开发者文档真实浏览器 7/7；根 tooling 65 pass、4 个原有 Postgres skip；生成检查 9 个契约文件、18 个文档、28 个样式文件；锁文件 frozen 验证和窄 upstream patch apply check 成功。

限制：完整 Cordis catalogue 生成仍受预先存在的 PhysicsOS shared-state-host 缺失 JSDoc 阻塞；只用相同 TypeScript printer 更新并校验受影响的三个声明，不能宣称全生成器通过。11 个 moderate 开发工具依赖 advisory 未变化；新增高危 Zod advisory 已在 Task 3 升级至 4.6.7 解决。4 个原有 Postgres 集成 skip 保留，候选用独立 JSON 存储，不能替代生产数据库或上线切换验收。legacy V1 的冻结包、旧 pending 审批、加载和回滚由已审查的 Node/host 集成夹具覆盖；本次没有重复真实浏览器 V1 smoke。真实 Chromium 使用 SwiftShader WebGL，因此不代表所有真实移动 GPU。

## 截图

截图来自候选真实浏览器；不包含密码表单、地址栏、Cookie 或 capability URL。见 `screenshots/experiment-package-contract/` 的 bound-prompt、student-source-release-upload、v2-render-failure-approval-disabled、review、published 和 entry 文件。控制器已查看提示词、学生上传、错误/正常预览，以及最终 embedded 审核、手机上传页和字段建议截图：标题、冻结 ZIP/SHA、画布、发布门槛均清楚可见，玻璃样式和手机布局保留。

## 决策记录与实际成本

以下按当前计划 ledger 的 Ruling 顺序保留全部决定（包括 Ruling A），加本次验收决定，避免 scratch 清理后丢失理由。

| 决定 | 原因及错误时的实际成本 |
| --- | --- |
| 按已授权范围继续实现，不再次请求计划确认 | 用户已要求继续；若理解错误，成本为可逆源码返工，仍不自动部署或推送。 |
| 以 canonical TypeScript/Zod 为契约源，生成 JSON Schema | 消除手写校验器漂移；成本是必须保持可执行复制/生成一致性检查。 |
| 模板内 AGENTS 指向外部 release 描述符 | ZIP 不能包含自身 SHA；外部提示词绑定真实摘要，成本是信任外部描述符来源，而非自签名档案。 |
| 使用已有 thinLensOutcome 并生成剥离的工具副本 | 避免第二套物理公式；成本是生成器必须检查引擎出处与副本。 |
| 像高采用有符号值 -2/-4/-8/null/8 | 与平台倒立负、正立正的快照一致；若误用绝对值，会误判案例或渲染方向。 |
| wire 默认只接受 platform-engine；SDK/工具显式允许 fixture | 生产不得把教学夹具当引擎结果；成本是离线预览必须明确 opt in。 |
| 提示词绑定 digest 命名的不可变 ZIP，v2.zip 只作便利别名 | 重生成不会悄悄改变旧提示词目标；成本是需保留被引用的历史下载文件。 |
| V2 发布 UI 等待当前预览 ready，并随候选/实例重置 | 辅助审核可用性；不是服务器物理或安全证书，API 权限/SHA 仍是服务器门槛，误解会高估审核保证。 |
| 只允许精确 ESLint/Prettier 根配置，将命名工具放入 tools | 冻结源码仍可重建，且不扩大根文件 allowlist；误配会漏打包工具或增加可携带文件。 |
| 提取已有 host 资源校验供模板生成复用 | 防止本地 CSS/JS 资源通过而上传失败；成本是 parse5/lexer 工具依赖与生成检查。 |
| Task 2 renderer 必须等待既有调度绘制完成 | queue RAF 不等于绘制成功；成本是隐藏/阻塞时不能抢先 ready，也需安全处理 dispose。 |
| SDK 保持一个正在处理和一个最新待处理完整快照；删除 V2 模板额外 V1 模式 | 防止隐藏渲染时队列无限增长，保留真实第一帧；成本是中间完整状态会合并，冻结 V1 继续由平台旧路径处理。 |
| Zod 4.4.3 升为 4.6.7，限于契约与相关 locks | 修复 GHSA-mrhx-c7xc-m3w5 高危内存耗尽；成本是与旧 storage schema 名义类型互操作需要处理。 |
| Ruling A：storage-domain 使用 parse/safeParse 的结构接口 | 保持原 schema 对象及运行调用、不做 casts/全图升级；成本是公开类型只承诺实际消费的方法，不能冒充完整 Zod 专有接口。 |
| 完整 catalogue 被基线 JSDoc 阻塞时，仅用相同 printer 更新三个受影响声明 | 保留其他字节并增加 source parity；成本是全生成器仍阻塞，报告必须明确不能声称通过。 |
| 最终广审范围为本计划 27b32ad 至 Task 4，含集成边界 | 旧 V1 工作已经审查，不重复付费；若判断错误，可能遗漏旧无关回归，审查仍可为具体边界风险读取未改代码。 |
| 下载验收复用声明过的 host yauzl，有效包走正常 release | 没有第二条发布流水线；成本是解压和多次真实源码 release 需额外服务器时间，ZIP 改写只用于拒绝负例。 |
| 新选择的候选自动滚入视区，保留实际首帧绘制条件 | 修复 offscreen opaque iframe RAF 暂停；成本是用户选择预览时会移动视区，每次渲染/参数变化不会滚动。 |
| 恢复验收时仅复用已完成且 SHA 再核对的真实 release 包 | 避免 transport/夹具失败重跑安装与套件；成本是需要私有完成证据，不能把普通直接 pack 称为真实发布。 |
| 越界夹具在真实渲染后才破坏自身 frame | 原 100 ms ready 假设只适合 V1；成本是负例执行稍晚，越界请求与 raw-entry 拒绝断言保留。 |
| 截图遮挡先测量自然选择几何，再以 embedded 页重拍 | 避免为定位截图的滚动副作用改产品样式；成本是截图版号/页面不同，报告需标明证据来自真实同一流程。 |
