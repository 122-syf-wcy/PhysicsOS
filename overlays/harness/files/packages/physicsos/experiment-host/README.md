# Experiment host

PhysicsOS 的浏览器静态实验文件投稿宿主。当前仅接收 `convex-lens`：schema/protocol v2、optics contract v1、Three.js、`physicsos-warm-lab-v1`，入口固定为 `dist/index.html`。其他实验或不兼容清单会被拒绝。

## 配置与接线

Cordis 插件注入 `webServer`、`storageDomain`；身份服务按请求延迟解析。

| Config | 行为 |
| --- | --- |
| `packagesRoot?` | 持久化 ZIP、已校验 dist 与恢复日志；默认 `dshHomePath('experiment-packages')`，遵循 `DSH_HOME`。 |
| `assetOrigin?` | 可选 HTTP(S) origin，决定资源 URL 与 CSP。配置本身不会创建独立服务器或反代。 |

资源处理器 `experimentAssets({ service })` 可从包入口或 `./assets` 单独导入，用于独立资源域；必须接到同一宿主状态。直接创建 `ExperimentService` 的调用方先 `await service.initialize()`；插件会在注册路由前完成初始化。

## 权限与 API

所有 API 需要登录；写请求要求 JSON 与同源请求检查。错误格式为 `{error:{code,message,issues?}}`，V2 清单/元数据问题包含最多 20 个固定消息的 `{code,file,path,message,suggestion}`，不回显原始输入。前缀为 `/physicsos/experiments`。

| 方法与路径 | 请求 / 响应 |
| --- | --- |
| `GET /convex-lens` | `{active,items,canReview}` |
| `POST /convex-lens/packages` | `{zipBase64,author:{name,bio?,github?,avatarDataUrl?},note?}` → `201 {item}` |
| `GET /packages/:id/preview` | `{entryUrl}` |
| `GET /packages/:id/archive` | 作者或 SUPER_ADMIN 下载原始冻结 ZIP；逐次校验同一 SHA-256，附件 / no-store / nosniff，最多 20 MiB。 |
| `POST /packages/:id/review` | `{action:'approve'|'reject',expectedSha256,reason?}` → `{item}` |
| `POST /convex-lens/rollback` | `{packageId,expectedActiveId}` → `{item}` |

登录账号可投稿，查看自己的待审/退回包与所有已批准版本；预览与冻结 ZIP 下载仅作者或 `SUPER_ADMIN` 可取得，已批准包的 ZIP 仍需要此权限。审核面板为所选版本显示下载链接和完整摘要，源码、参考用例、许可与批准绑定同一份 ZIP。只有 `SUPER_ADMIN` 可全站批准、退回或回滚，并查看所有投稿；学校管理员没有全站发布权限。回滚目标必须曾获批准。公开元数据不包含账号键、学校标识或存储路径。

作者名 1–80 字符、简介最多 300、说明最多 500；GitHub 仅接收规范个人主页 URL。可选头像为 PNG/JPEG/WebP，解码后最多 256 KiB；链接与头像不表示身份认证。

## V2 清单与元数据

新投稿只接受 `schemaVersion:2`、`protocolVersion:2` 与无前导零、无预发布后缀、最多 32 字符的稳定 `X.Y.Z` 版本。`contract-wire.ts` 与 `contract-v2.ts` 是唯一规则源码；`node scripts/developers/generate-contract.mjs` 在项目根目录生成 SDK/UI/工具副本，`--check` 检测漂移。生成器只需 Node >=24.7 内置模块。

四个固定 UTF-8 JSON 文件各最多 256 KiB。参数顺序、单位、读写权限与显示/安全范围固定；教学文本非空且有界；五个必需薄透镜区域案例与额外案例全部通过平台 `@physicsos/engine-optics` 求值。像距以实像为正、虚像为负；像高以倒立为负、正立为正；数值比较使用绝对 1e-7 cm 加相对 1e-9 容差。封面、`dist/assets/` 与 `dist/vendor/` 资源必须有匹配许可声明，声明与通知文件需实际存在；结构检查不表示法律权属认证。

现有 V1 冻结记录继续允许预览、审核与回滚；新 V1 投稿返回 `PACKAGE_UPGRADE_REQUIRED`。公开记录明确返回 `schemaVersion/protocolVersion`。旧记录仅在两字段同时缺失时推断为 1，显式字段必须成对且一致，冻结核对时版本须与 ZIP 一致。

## 文件与隔离规则

ZIP 最多 20 MiB，展开总量最多 40 MiB，单文件最多 20 MiB，最多 1000 条目。接收普通单磁盘 store/deflate ZIP；拒绝 ZIP64、加密、符号链接、重复/不安全路径、损坏、超限与不兼容清单。目录与文件名采用 ASCII 安全路径。服务器不会安装依赖、重建或执行投稿脚本；源码留在冻结 ZIP 中，只有白名单 dist 文件可作为资源输出。

所有 `entryUrl` 指向 `/physicsos/experiment-assets/embed/<raw suffix>` 的平台可信外层。外层的 CSP `frame-src` 仅允许确切原始入口，可信桥接脚本使用 SHA-256 CSP 哈希。投稿代码始终运行在内层 `sandbox="allow-scripts"` iframe 中，保持不透明 origin；外层保留同源能力仅用于平台桥接。

原始 HTML 仅对同源 `Sec-Fetch-Dest=iframe` 请求输出可执行内容；顶层/直接原始文档请求返回惰性 JSON 403。SVG 文档同样受限，SVG 图片加载可用；HTML/SVG 响应按 Fetch Metadata 变化缓存。资源使用包路径 CSP、nosniff、no-referrer 与无凭据 CORS。未批准包需要短期随机路径凭证；批准资源的路径包含不可变包 id 与 ZIP SHA-256。

桥接验证内外窗口 source、origin、协议与 channel，仅转移一次 MessagePort。外层读取主页面 `hostOrigin/channel`，内层接收外层 origin 与同一 channel。

## 存储结果与恢复

`physicsos_experiments` storage-domain 使用一个状态行保存版本、当前默认、发布序号和历史。单个应用进程串行写入；ZIP 与逐资源摘要冻结。私有 `.state-recovery.json` 在元数据写入前记录先前状态，正常故障会尝试补偿恢复；补偿不确定时，进程以 `STATE_UNCERTAIN` 503 阻断后续读写，并保留已冻结文件。重启会处理仍存在的恢复日志。

**拒绝响应不等于“没有发布”。** JSON 后端可能在元数据重命名之后因目录 fsync 失败而拒绝；如果日志删除后的 fsync 也失败，且重建日志又遇到 ENOSPC 等错误，恢复标记可能不存在。此时当前进程仍被封锁、文件仍保留，重启可能采用有效的已写入新版本。初次错误也可能是通用 `INTERNAL`。调用方必须在存储恢复后刷新服务器版本/投稿列表，再决定重试；不能保证每个被拒绝的请求都留下先前默认版本。

备份与恢复需覆盖元数据、`packagesRoot` 中的文件及恢复日志；这是单进程协调，不是跨进程事务协议。

## 消耗与边界

没有模型调用、计费 Token 消耗或模型 KV cache 变化。正常的 storage-domain KV 读写与磁盘 I/O 会发生；“无 KV 模型影响”不代表不写业务存储。

参考案例校验只验证有界元数据与平台引擎的一致性。静态校验不证明源码与 dist 对应，也不证明实际渲染、教学、性能或运行时生成资源正确。当前 importmap 只支持确切 `imports` 映射，最多 16 个；scopes/前缀映射不支持。当前不支持多进程发布、自动源码重建比对或自动物理/性能验收；更完整的事务恢复可后续改进。人工物理/性能审核、反代配置与真实浏览器隔离验收由集成和发布流程负责。测试与构建按项目约定在服务器隔离 Docker 中进行。
