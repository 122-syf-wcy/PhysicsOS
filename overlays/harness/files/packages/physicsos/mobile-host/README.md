# @deepseek-ai/dsh-mobile-host

PhysicsOS 第一方 Android API，挂在 `/physicsos/mobile/v1` 一个前缀上。

这个包不拥有业务规则，也不建新的存储域：设备授权、学习记录、班级作业、已核验题库
和平台公告分别由 `auth-host`、`learning-host`、`class-host`、`paper-host`、
`notice-host` 负责。`mobile-host` 只把它们组合成 Android 客户端使用的
`{data}` / `{error}` 封套，并保证：

- 身份只来自服务端解析的凭据，绝不读请求体里的用户字段；
- 业务失败映射为真实 HTTP 状态，未知异常一律 500，不会伪装成成功；
- 场景和作业同步变更必须带 `Idempotency-Key`；自测记录以不可变记录 ID 去重；
- 未挂载的依赖返回 503，而不是静默给出空列表。

## 路由

| 方法 | 路径 | 归属 |
| --- | --- | --- |
| POST | `auth/login`、`auth/register`、`auth/login/2fa`、`auth/refresh`、`auth/logout`、`auth/password-reset/request`、`auth/password-reset/submit` | auth-host |
| GET | `auth/schools`、`auth/me`、`auth/devices` | auth-host |
| DELETE | `auth/devices/:id`、`auth/account` | auth-host |
| PATCH / POST | `auth/profile`、`auth/password` | auth-host |
| GET | `learning/attempts`、`learning/scenes`、`learning/scenes/:id` | learning-host |
| PUT / DELETE | `learning/attempts/:id`（仅 PUT）、`learning/scenes/:id` | learning-host |
| GET / PUT | `classes`、`classes/:id/assignments`、`classes/:id/assignments/:aid/submission`、`.../target` | class-host / paper-host |
| GET | `library/questions`、`library/sources`、`library/annotations` | paper-host |
| GET / POST | `notices/platform`、`notices/platform/ack`、`notices/announcements` | notice-host |
| POST / DELETE | `devices/push`、`devices/push/:id` | notice-host 的推送终端表 |
| GET | `account/export` | learning-host / class-host / notice-host / personal export provider |

## 数据与传输约束

- 变更只接受原生请求（不带浏览器 `Origin`）、未压缩 UTF-8 JSON 对象；拒绝重复键、非有限数值、过深 JSON、重复查询参数及路径双重编码/穿越。地址由 auth-host 的 `clientAddress(req)` 解析，不自行信任 `X-Forwarded-For`。
- 场景请求整体上限 12 MiB；scene + originScene 独立上限 2 MiB；完整 checkpoint 独立上限 8 MiB。检查点校验全部历史、来源、编辑和播放状态并调用已有 PhysicsScene 校验器，不截断历史、不另建物理算法。
- Android 上传时把 scene、originScene 以及 past/future 的 before/after 场景根 ID 一致绑定到 native sceneId，保留本地原始快照、草稿和历史。重放回执只确认 appliedRevision，不把未查看过的当前 head 当成下一次写入的 CAS 基线。
- 列表 limit 为 1..100 的整数，游标绑定账号实例、路由与筛选条件；学习记录按时间倒序，资料筛选在分页之前执行。JSON 内容页整体限制 16 MiB，文件对象按页逐个授权读取。

## 完整个人数据导出

必需区段为 `learning.attempts`、`learning.scenes`、`learning.canvas.metadata`、`learning.canvas.objects`、`classes.memberships`、`classes.submissions`、`notices.account`，以及 `physicsosMobilePersonalExports.sections()` 提供的 `learning.whiteboards`、`learning.usage`、`account.profile`、`account.sessions`。必需 provider/区段缺失一律 503，不用缺段清单伪装完整成功。

场景区段包含云端 scene、originScene 和完整 checkpoint/history；Canvas 对象区段读取实际私有对象。会话附件引用及单独授权下载通路由会话 provider 明确给出，不把附件引用冒充二进制文件。导出不包含访问/刷新凭据。旧 notice 私有记录若缺不可变 userId，导出明确返回 `NOTICE_MIGRATION_REQUIRED`，需完成服务端归属迁移或受理该账号擦除，不能归给同名的新账号或静默遗漏。此前缺 userId 的 hash-only push 行仅以未归属旧记录重新打开，避免阻止 notice 域启动；不能用于撤销/发送，也不能归给当前同名账号。

## 外部依赖与发布边界

远程推送尚无经过验收的真实厂商 provider/SDK；`POST devices/push` 明确返回 `503 PUSH_UNAVAILABLE`，不会持久化 hash-only token 后宣布可推送。正式启用仍需受保护的厂商配置、原生注册/轮换、后端实际发送、撤销以及后台/离线设备送达验收；本实现没有伪造厂商配置或凭据。

作业题图保持 paper-host 给出的真实授权 URL，仅由 Android 原生下载并检查大小、PNG CRC/尺寸和可解码性，随后通过账号实例绑定的精确本地 AssetLoader 路径展示。WebView 的远程 URL、Cookie、文件与凭据访问规则不放宽；下载失败不替换为演示图。
