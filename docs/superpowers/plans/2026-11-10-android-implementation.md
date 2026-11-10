# 安卓学生端并行实现与集成约定

本文件落实已批准的 Kotlin/Compose 完整产品架构，不缩减功能。状态必须区分源码完成、构建通过、服务端联调和真机验收。没有测试证据不标记通过。

## 源码与职责

基线为 origin/main `bc9d6fe`，交接工作分支 `codex/android-student-app`（由初始安卓集成分支改名，符合仓库分支规范）。此前未提交改动已经备份在 `tmp/android-pre-main-20261110`，另保留 Git stash；源码整合负责人已解决冲突。任何 agent 不得直接覆盖其他负责人的文件；提交/推送由用户授权的集成负责人执行。用户已改为 Windows 安卓/Mac 网页分工，Windows 允许按安卓 README 本机构建和调试；此前 Mac 并行阶段没有执行构建。

- 主线程：集成、MainActivity/PhysicsApplication、应用导航、Gradle/Manifest/公共资源和主题、服务器构建、端到端与发布验收。接管上轮未完成的构建基础任务。
- 源码整合：仅冲突文件和备份差异核对，不写新移动功能。
- 服务端认证：`auth-host`，移动会话、刷新/撤销、账户流程和原有 API 身份适配。
- 服务端业务：新增 `mobile-host`；class/learning/paper/notice 中只增加所需窄服务门面、学生能力及长任务接力，保留最新功能。
- 安卓核心：`apps/android/app/src/main/java/com/physicsos/student/core/`，网络、凭据、本地库、同步、目录读取及核心接口测试。
- 实验 Web：新增 `apps/mobile-lab/`，独立完整实验与数学文档 bundle、Worker、消息协议、目录资产、测试和构建脚本。必要纯函数抽离须提前通知相关负责人，不改有冲突的文件。
- 安卓学习页面：`feature/auth/`、`feature/home/`、`feature/library/`、`feature/classes/`、`feature/records/`、`feature/account/`。
- 安卓聊天与附件：`feature/chat/`、`feature/files/`；真实 session RPC、mux、文件处理及恢复逻辑，不另建模拟聊天服务。
- 安卓实验桥接：`feature/experiments/`、`feature/document/`，受限 WebView、存档与生命周期、导出/分享、原生实验目录。

每个功能负责人可新增自己的 `res/values/strings_feature_<name>.xml` 及对应 `values-en` 文件，不编辑公共 strings.xml。测试位于相应包名目录，不修改其他模块测试。公共依赖由主线程统一修改。

## 原生公共接口

包名 `com.physicsos.student`。核心负责人提供以下入口，具体实现不得是占位：

- `core.AppGraph(context: Context)`：持有 `api: MobileClient`、`auth: AuthRepository`、`store: LocalStore`、`catalog: CatalogRepository`、`settings: SettingsRepository`、`sync: SyncCoordinator`。
- `MobileClient`：`suspend fun request(method: String, path: String, body: JsonElement? = null, authenticated: Boolean = true): JsonElement`。path 相对于移动 API，自动解开 data 成功封套；失败抛 `ApiException(status, code, message)`。
- `MobileClient.suspend rpc(method: String, request: JsonObject): JsonElement`：访问同源 `/api/<method>`，包裹并验证真实 Harness RPC 封套，返回 result.value。
- `MobileClient.suspend upload(sessionId: String, file: File, name: String, onProgress: (Long, Long) -> Unit): JsonObject`：真实 uploadFileBinary 与业务错误检查。
- `MobileClient.suspend connectMux(listener: okhttp3.WebSocketListener): okhttp3.WebSocket`：获取有效 access token，使用同源 `/api/remote.mux` 和 Authorization；生命周期/重连由调用模块管理。
- `AuthRepository.state: StateFlow<AuthState>`；AuthState 为 `Restoring`、`SignedOut`、`SignedIn(user: MobileUser)`，MobileUser 包含不可变 userId 以及 userKey、schoolId、username、displayName、role。userKey 是学校与账号名组合，可能同名重注册；本地持久化必须以 userId 做账号实例隔离，不能让新账号复活旧缓存。
- `AuthRepository.login(body: JsonObject)`、`register(body)`、`verifyTwoFactor(body)` 返回 `JsonObject`（除认证成功还可能是 challenge/pending）；成功时内部持久化 grant 并更新 state。提供 `restore()`、`logout()`、`refreshUser()`；其余账户操作通过 api。
- `LocalStore.observe(kind: String, owner: String): Flow<List<StoredItem>>`；`get(kind,owner,id)`、`put(kind,owner,id,payload: JsonObject, updatedAt: Long = now)`、`delete(kind,owner,id)` 均挂起；StoredItem 包含 id、payload、updatedAt。用 Room 实现，不以进程内 map 代替持久化。
- `SyncCoordinator.enqueue(method,path,body,idempotencyKey)`：将操作连同当时账号实例记入持久 outbox；`syncNow()`；冲突/失败保留并可观察，不默认覆盖另一账号数据。`observe(owner): Flow<List<OutboxItem>>` 只读摘要，状态为 PENDING/RUNNING/RETRY/ACKNOWLEDGED/CONFLICT/FAILED/AUTH_REQUIRED，包含真实 result/error；成功不立即删掉回执。观察列表不携带大 body，`operationBody(id)` 按需读取单项；retry 不自动重试冲突，resolveConflict 需要用户合并后传新幂等键。
- `CatalogRepository.experiments(): List<ExperimentInfo>`、`library(): JsonObject` 挂起读取 APK 资产。ExperimentInfo：id、title、subtitle、domain、stage、tags。库文件缺失是构建错误，不返回假目录。
- `SettingsRepository.theme: Flow<String>`（system/light/dark）、`setTheme(value)`；字体遵守系统，通知等偏好持久化。

上述方法是模块集成接口；若真实源码要求变更，负责人先通知主线程，更新本约定后通知所有消费者，不让每个模块私自猜测签名。

原生页面统一通过构造参数接收 AppGraph，不使用全局单例查找服务。每个 feature 提供顶层 `@Composable fun <Feature>Screen(graph: AppGraph, ...callbacks)` 并报告精确签名供主线程接导航，不自己创建 Activity。可创建 ViewModel.Factory 管理生命周期。

公共视觉入口 `ui.theme.PhysicsTheme`；公共组件由主线程提供 `ui.components.LoadingState`、`ErrorState(message,onRetry)`、`EmptyState(title,message?)`、`SectionCard(title,content)`。主要页面 testTag 为 home、experiments、chat、records、account；具体操作标签稳定可测。

## 移动 HTTP 契约

公共来源默认为 `https://physics.dongsiwei.com`，移动前缀 `/physicsos/mobile/v1/`。BuildConfig：SERVER_ORIGIN、MOBILE_API_BASE_URL、MOBILE_API_VERSION=1。

成功：`{ "data": T }`；失败使用相应 HTTP 状态及 `{ "error": { "code": string, "message": string, "details"?: object } }`。集合类型在 data 内包含 items、可选 nextCursor。不得把空成功响应当作尚未实现的接口。

### 认证负责人

- GET `auth/schools` → `{items}`。
- POST `auth/login`、`auth/register`、`auth/login/2fa`。登录 DTO 沿用已有 username/password/schoolId；设备上下文以固定 android 平台表示。认证成功 data 为 `{status:"authenticated",user:MobileUser,tokens:{accessToken,expiresAt,refreshToken,refreshExpiresAt}}`，时间为 ISO8601；待审核与二次验证分别为 pending/challenge 状态，不伪造会话。
- POST `auth/refresh` body `{refreshToken}` → 同一认证成功 DTO；原子轮换并支持撤销策略。
- POST `auth/logout`，撤销当前设备 grant；GET `auth/me` → `{user}`。
- POST `auth/password-reset/request`、`auth/password-reset/submit`：沿用既有找回语义与防枚举限制。
- GET `auth/devices` → `{items}`，DELETE `auth/devices/:id` 撤销本人设备。
- PATCH `auth/profile`、POST `auth/password`、DELETE `auth/account`：真实验证、权限及持久化，遵循现有安全策略，不提升学生角色。删除与业务清理由认证/业务负责人协调。

access token 是第一方移动设备会话，不拿 PAT 充当登录。原生 HTTP/RPC/WS 均能使用它；网页原有 Cookie/Origin/CSRF 防线不变。严格限制敏感数据进入响应和日志。

### 业务负责人

以下均为移动前缀内相对路径，输出复用已有业务的安全 DTO 后包 data：

- GET `learning/attempts`、`learning/scenes` → `{items,nextCursor?}`。
- PUT `learning/attempts/:id`、`learning/scenes/:id` → `{item}`；DELETE `learning/scenes/:id`。保留现有载荷并加版本/冲突语义，不能把学生上报 correct 当作权威评分。
- GET `classes` → `{items}`；GET `classes/:classId/assignments` → `{items}`。
- PUT `classes/:classId/assignments/:assignmentId/submission` → 提交回执；GET 同一路径 → 本人回执。
- GET `classes/:classId/assignments/:assignmentId/target` → 经班员、target、学校、发布状态验证的题目/实验。不能透出教师 job 或未发布答案。
- GET `library/sources`、`library/annotations?source=...`、`library/questions` → `{items}`，复用学生 verified/scope 过滤，不授予教师导入/生成权限。
- GET `notices/announcements`、GET `notices/platform`、POST `notices/platform/ack`。
- GET/POST `feedback`，仅本人可读；截图上传必须有受限的真实文件存储与访问控制。
- GET `account/export` 导出本人数据；POST/DELETE `devices/push` 注册/撤销本人推送终端，凭据及厂商发送配置仅在服务器。不能只保存 token 就宣称推送已完成。

学生会话继续复用现有 `/api/session/create|prompt|cancel|page` 和 `/api/remote.mux`。使用请求幂等 ID、快照 cursor、持久 seq 与 assistant revision/index；不发明 session/history 路由。附件上传单独处理 `{ok,value|error}` 封套。

## 本地渲染模块接口

构建输出包含 `lab/index.html`、其依赖/Worker/字体/图像，以及 `lab/catalog.json`、`lab/library.json`；数学文档入口 `lab/document.html`。由集成构建复制进 APK assets，不加载线上整个产品。

catalog：`{version:1,experiments:[{id,title,subtitle,domain,stage,tags}]}`，由全部当前实验目录生成，不能手写少量模板。library 同样从真实共享题目/课程/资料目录生成，保留来源与访问方式。

通过 WebMessageListener 注入 `PhysicsNative`，只允许 `https://appassets.androidplatform.net` 主框架。原生发送 JSON 到同一确切 targetOrigin；网页通过 window message 接收。消息封套：`{version:1,id:string,type:string,payload:object}`。

原生→Web：`load`（templateId 或 scene、可选 originScene，或者完整 checkpoint）、`lifecycle`（active）、`theme`（dark）、`checkpoint`、`export`（format）。每次加载使用 generation UUID；除初始 ready 外所有命令与回包在 payload 中携带该 generation，拒绝旧代际消息。完整 checkpoint 加载不重复发送一份 scene。

Web→原生：`ready`（capabilities 字符串数组，不带 generation）、`state`（sceneId/revision/title/dirty/running/time/duration/canUndo/canRedo，最多4Hz，不发整帧）、`checkpoint`（payload.checkpoint 中含 version:1、scene、originScene、playback、editing、history:{past,future}）、`error`（code/message）、`export`（name/mime/encoding:utf8|base64/content，解码后不超过8MiB、消息不超过12MiB）。新检查点的完整 history 必填；旧场景没有历史只能明确作为旧格式载入，不能伪造恢复。文档入口接收 `document`（generation、markdown/text 或 blocks、fontScale；禁止任意HTML与脚本）。

云场景版本使用独立 item.revision，写入/删除带 baseRevision（新建0）和 Idempotency-Key；不混用 scene.revision。GET learning/scenes/:id 返回完整检查点；列表、写入回执和冲突只返回摘要，完整恢复按需查询。scene+originScene 上限2MiB，checkpoint上限8MiB并单独存储私有不可变blob，整体输入上限12MiB；超限明确拒绝，不截掉历史。

重型计算在 Worker，React 不逐帧协调整个画布，桥不传逐帧坐标。自由搭建/回放/参数/读数/曲线/验证/报告全部在模块中真实实现，格式版本与正确性测试绑定。

## 验证与当前阻塞

- 已按用户授权删除11个未被任何容器使用且无回滚/基线别名的旧候选镜像；由于共享层，仅释放约0.5GB，服务器剩余约1.5GB。用户随后明确选择“只继续编码”：不再扩大清理范围，不安装新构建环境。构建与运行验收维持阻塞，不能宣称完成正式交付。
- 当前分工允许 Windows 本机构建/测试安卓及其独立实验 bundle；网页/服务端正式验证仍在服务器 Docker。本次 Mac 交接没有执行安卓构建或设备测试，不能将源码预检当作这些验证。
- 真实性验收需要可用安卓真机；尚未获得真机性能报告，不能声称60fps/冷启动/内存门槛达成。
- 发布签名和厂商推送需真实受保护配置；缺失时应明确报阻塞，不用演示密钥、假成功或占位功能代替。
