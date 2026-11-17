# 教学工具、头像与内容整理：2026-11-17 实施记录

## 基线与授权

用户已批准头像、管理员用户统计／学校榜、HTML 智能课件、最近实验／项目删除、双画板归档删除及导航遮挡修复。继续使用独立 UI clone，功能分支为 `codex/teaching-tools-avatars-20261117`，起点 `e8151f730acb7944e906811234867517f1d1de97`。不操作 Android 工作树、dirty vendor 或无关旧截图，不强推／改写历史。

开始实施前只读复核服务器检出为同一起点；app／validation-worker／PostgreSQL／Redis healthy、restart 0。正式 app 镜像仍为 `sha256:eddf40d1307b644db51edd995c98f731ecec8ee4cb668f7237447bbbba765bdc`，worker 为 `sha256:e888ca49106c262defbe416bbbcc58ab8bd729a00d78ff8fe0a7a800d7d1f940`。本轮没有重发 76 套实验。

## 已写入源码（未运行验收）

- 12 款头像原图和 84 份优化衍生图已生成，逐项提示词、失败重试、文件 SHA／字节数及 32／48／96px 浅深底检查表在 `overlays/harness/files/apps/web/design-assets/avatars-guizhou-v1/`。已目检裁切与小尺寸，不等同真实头像选择器已验收。
- 头像本人闭集选择 API、原子用户字段更新、账号 store 及选择面板；实际运行与并发回归待服务器验证。
- 独立 activity v1 日桶统计、用户详情和学校榜、当前头像采用量；旧 usage schema 不改，统计口径见 [ACTIVITY-V1.md](ACTIVITY-V1.md)。管理查询容量门禁默认未核验，不能展示假零或声称已采全。
- Canvas／教学 Whiteboard 的归档、删除、恢复与 CAS／generation／草稿栅栏；新增数据启用前须先验证桥接镜像。
- 个人最近场景墓碑、项目软删除与未分组、顶部项目视图和导航 safe inset；原生项目、会话日志与画布对象保留。
- 独立 HTML 课件库、原／适配样例、opaque iframe 协议和授课批注工具；原本地 31 页 HTML 及已有教师预览不变。接口、安全与验证范围见 [courseware-protocol.md](courseware-protocol.md)。

上述均表示实现文件已落盘，不表示编译、单测、真实 PostgreSQL、真实浏览器或正式部署通过。主前后端入口、能力开关、本人头像注入、后台统计 API、课件入口与独立实验运行来源已接线；实验运行限定 Lab 平台引擎首次有效时步，标记 client-observed，不把 ready／轮询／场景保存冒充物理验证或有效运行。学校榜仍保留服务器容量核验门禁。

12 款头像素材已分阶段提交为 `db3f2942`，功能源码为 `2afa80f3`，仍留在功能分支而未合入 main。静态解析已检查 189 个当时已改／新增 TypeScript 文件，无语法诊断；这不是类型检查或测试。Python／JSON／发布脚本语法、完整补丁对 98 个 pinned 上游源文件的应用检查、依赖锁图和 12 个插件签名均已静态核对，运行验证仍未执行。静态整合另修正了非目标白板整理中断当前保存、旧课件 ACK 撤销已观测只读、历史撤销覆盖远端与失败消耗栈等竞态，并补相应未运行测试源码。

源码提交前的暂存 whitespace 检查曾报告三份课件的字体许可原文尾空格。该提交已生成，历史不改写；后续仅为原件、适配件和纯文本示例三个精确路径加入检查属性例外，不修改其 SHA 绑定的字节。其它源码的空白检查保留，后续整体复核记录真实结果。

## 补充需求：顶部“我的工作区”弹窗删除

用户于本轮追加截图要求：顶部工作区管理也需支持删除，不能只在项目页操作。已接入同一 `projectState` 持久生命周期，不调用原生 `workspace.delete`，不会删除注册、目录、会话日志或画布对象。

弹窗正常／归档／回收站筛选、逐行删除、当前工作区风险说明、确认／取消、服务器确认后撤销、回收站恢复均已写入源码。确认时固定显示版本、generation 和 operationId，未确认响应重试使用同一操作；恢复保留原归档状态。切账号（包括 A→B→A）、关闭及迟到结果有独立 UI 栅栏；未知状态不按正常展示，桥接只读不会提供新删除／恢复。顶部与项目页共享同一状态并互相刷新。

新增 10 项弹窗回归源码，覆盖取消、当前组删除不级联、回收站恢复、删除／恢复／取消归档丢 ACK 精确重放、归档恢复、CAS 冲突、桥接只读、关闭重开及账号切换。静态核对发现并修正了恢复按钮每次生成新操作 ID 的重试缺陷，未确认的完整 intent 按账号／工作区／操作保留；有界缓存不会通过丢弃旧标识绕过幂等。这些测试尚未运行，不能以源码存在代替验收。

## 生产容量阻断

只读核查截至 2026-11-17 10:55 UTC：

- `/dev/vda` 为 50 GiB；根分区末扇区已等于 GPT 最后可用扇区，没有尾部未分配空间。
- ext4 已占满分区，只有 3,584 B 块对齐尾差，保留块为 0；不存在直接 resize 即可恢复的容量。
- app、containerd、Docker 均在同一根盘，无已挂载的独立数据盘。
- 当时可用 171,122,688 B，约 163.20 MiB。
- 仅三处已证明本任务所属且无使用者的中间副本合计约 27 MiB；即使异机完整归档后全部回收，仍不足 256 MiB 基础保留量，尚未计新构建、WAL、候选和备份。

因此新的服务器测试、构建、候选导入与备份保持暂停。需要云控制台扩大云盘或提供独立构建／数据盘；不能通过删除生产、恢复点、旧镜像、交互候选、未知 cache 或降低门槛绕过。三处中间副本本轮未删除、压缩或移动。

`2026-11-17T15:44:03Z` 再次只读复核：根盘仍为 50 GiB，可用 169,349,120 B，约 161.5 MiB，未见扩容；四项服务仍 healthy、restart 0，正式检出与镜像未变化。安全回执见 [teaching-tools-20261117/preflight.json](teaching-tools-20261117/preflight.json)。新功能仍不是已上线状态。

## 后续验收与发布

1. 完成源码静态整合与精确提交；不将未运行测试写成通过。
2. 容量达标后，在服务器 Docker 物化冻结 overlay，补依赖锁定、出厂插件签名和 source exact 检查。
3. 执行新功能单元／HTTP／真实 PostgreSQL、90 日／10 倍统计容量、真实页面及 31 页课件交互／安全验收。
4. 先发布关闭新状态写入的桥接镜像，验证读写保护与新资源；再启用功能候选。启用后回滚底线是已验收桥接镜像，不是 f6；回退仅切镜像／配置，不回灌旧业务数据。
5. 每次发布前核对最新 main、服务器、运行镜像并获取配对恢复点，串行切换。正式入口、学校权限、76 实验、官网管理、教师预览及 sandbox 保留。

## 教学 mode 的私有候选适配（源码，尚未运行）

`release-candidate.py` 新增可选顶层 `teachingToolsMode`，只接受 `"bridge"` / `"enabled"`。未指定时不注入或改写该 Env，保留旧候选行为；新应用自身默认 `bridge`。显式配置必须是当前操作者拥有的 0400 / 0600 普通文件，并要求 task-owned 独立数据库、数据目录和网络。显式 mode 的未知顶层字段（包括 `environment` / `env`）、`off`、对象、空值均拒绝；没有开放通用 Env、挂载或安全参数覆盖。

主代理应在服务器私有目录分别准备两份完整候选配置，不能把同一数据范围从 bridge 改成 enabled。以下只是无密钥的命名／端口示例，实际端口须先确认空闲，其余必填数据库身份与既有密码文件路径由主代理私有配置，不提交配置文件：

| 字段 | bridge 配置 | enabled 配置 |
| --- | --- | --- |
| `teachingToolsMode` | `bridge` | `enabled` |
| `task` / `databaseOwner` | `teaching-20261117-bridge` | `teaching-20261117-enabled` |
| `schema` | `teaching_20261117_bridge` | `teaching_20261117_enabled` |
| `root`（其 `home` 是 appdata） | `/opt/physicsos/.physicsos-release/teaching-20261117-bridge` | `/opt/physicsos/.physicsos-release/teaching-20261117-enabled` |
| `databaseDataRoot` | 上述 bridge root 的 `database-data` 子目录 | 上述 enabled root 的 `database-data` 子目录 |
| `databaseContainer` | `physicsos-teaching-20261117-bridge-pg` | `physicsos-teaching-20261117-enabled-pg` |
| `network` | `physicsos-teaching-20261117-bridge` | `physicsos-teaching-20261117-enabled` |
| `httpPort` / `modelPoolPort` | `23188` / `23982` | `24188` / `24982` |

两份配置均须 `requireIsolatedNetwork: true`。已有 `validationWorker` / `searchCompanion` 如确需使用，仍走原来的闭集验证与私有资源要求；本适配不改变 worker token、sandbox、seccomp、学校鉴权或生产配置。保留已有 `ui-candidate20261115` 交互候选，不为它追加 mode、刷新、回收或复用其目录／数据库／网络／端口。

适配在继承生产 Env 的过滤、私有路由重写后，仅设置真实 `PHYSICSOS_TEACHING_TOOLS_MODE`。因此即使插件配置来自 PostgreSQL，mode 也由实际进程 Env 优先生效；不是依赖修改 profile 或手写标签。新镜像须通过既有 `release-runtime.py` 的冷校验，绑定实际 revision、source/code digest、两份 runtime manifest 的字节 SHA、纳入代码清单的 capability marker SHA 及插件签名。仅给 f6 或任意镜像手加 capability label 不会通过。

新候选的完整启动 intent（含 Env、mode、资源与镜像来源绑定）进入 SHA256 指纹；随机 instance、指纹与 mode 同时绑定容器标签及私有回执。完整 daemon CID 必须先落盘，再 start；create、guard、check、refresh 与回收均检查真实 `Container.Config.Env`，在内存中完整比较并拒绝 mode 缺失、重复、额外 Env 或其它漂移。错误只返回稳定 code，不打印 Env、Docker argv 或密钥。检查还须通过已认证 `/physicsos/learning/capabilities`，核对真实 mode、生命周期写开关、个人状态开关与回滚能力，而非只看健康或 label。

新候选刷新使用同一脚本的 `refresh --config <私有配置> --image <已验证镜像>`：持有同一生命周期锁，先复核旧 CID / nonce / mode / 指纹／独立资源及新镜像，再按全 CID 删除旧候选容器，复用同一 `start_owned` 创建路径；保留 home、数据库、配置、密钥与恢复点。mode 不同或旧候选无绑定回执会拒绝。仓库未发现独立 `candidate-refresh` helper；服务器私有旧 helper 尚未审阅，不得直接用于这两个新候选。若必须保留外部 helper，必须调用 `guard_teaching_tools` / `candidate_fingerprint` 并保留全 CID 回执协议，不可复制 labels-only ownership 逻辑。

新增 fixture 测试源码覆盖两种 mode、独立 scope、非法值／额外字段、生产目录与端口拒绝、真实 Env 与来源／指纹漂移、创建失败归属回收、同构 refresh、认证前 guard、capability、生产 Env／私有材料保留以及旧配置行为。此次只做源码和 whitespace 静态核对；**未运行本机测试、构建、服务器测试或部署**。主代理在服务器既有 Docker 测试环境运行 `python3 -B scripts/deploy/release-candidate.test.py` 并记录真实结果后，才能提升验收结论。此记录不表示生产已切换，也不替代桥接／启用候选的真实浏览器和安全验收。
