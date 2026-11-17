# 实验运行记录 v1：真实首步来源与入口接线

本文对应新增的独立 `experiment-run-*` leaf，不改变 `physicsos_usage`、`saved_scenes`、`attempts`、activity 合同或旧 schema。源码真值是 `overlays/harness/files`；没有同步或改动 dirty vendor。

## 统计含义与明确范围

此来源只证明 **服务端保存了客户端观察到的平台实验运行**。固定 `provenance: 'client-observed'`，不是服务器执行仿真、可信执行证明、隔离验证通过或物理正确性证书。

当前边界为 `boundary: 'platform-engine-first-step'`、`scope: 'lab-workspace'`：

1. 正常实验中心的 `PhysicsWorkspace` 为已识别的批准 catalog 实验附加 tracker。
2. 官方平台 Canvas 已实际挂载，或社区 renderer 完成既有 exact-version/frameId/revision 握手，才打开显示 gate。loading/error 不发 prepare/record，ready 本身不计运行。
3. 工具栏、键盘及既有 V3 `playback/running` MessagePort 意图统一调用 `ExperimentSession.setRunning`。平台实际从 paused 进入 running 后产生一个 `started` 意图，客户端为该意图生成稳定 UUID 并请求 prepare。
4. 只有 `ExperimentSession.advance` 实际调用可信 `WorkspaceRuntime.advance`，并返回同一 sceneRevision、非 failed/error、无 failed verification check、有限有效物理时钟且时间前进（或仍 running 的同长度循环窗口发生合法回绕），才产生 `first-step`。有 `getPhysicalClock()` 的波动引擎读物理钟，不把周期显示钟当真实时间。
5. 同一意图取得 permit 且观察到首步后才 record。先到首步则仅在内存等待对应 permit；最终 prepare 失败、仅 ready、首步前暂停/取消、切账号/实验/显示代际、过期都不计。

**有意不覆盖**：静态/无播放时间维度的实验（例如凸透镜参数预览）、自由搭建、QuestionCode 私有/独立仿真、候选投稿预览、聊天内嵌卡片，以及 Canvas/教学画板内的 workbench 实例。后两者并未附加 run tracker，因此同一个引擎不会因画布/画板展示切换重复计为实验运行；它们已有的编辑会话 use 仍按各自业务源定义。不能把本来源说成“所有实验交互已完整统计”。如将来扩大范围，应在 instance owner 的真实命令/时钟边界设计一个共享稳定意图 owner，而不是再给每个 presentation 加监听。

不会监听 DOM 按钮来推断成功，不接纳第三方 iframe 的 `run-success` 自报消息，不修改 sandbox、CORS、端口绑定校验或几何/CTM 断言。社区 ready/rendered 只作显示 gate，真正的运行事实在宿主引擎中观察。

## 独立持久化和安全性

- 新单元：`physicsos_experiment_run_v1`，初版 `version: 0`，`layout: 'per-record'`，仅 `runs` 表。新单元名的 v1 与存储 facility 初版 version 0 不矛盾。
- `runId` 是全局 UUID 键；owner 只能来自 cookie actor。必需的 `x-physicsos-experiment-run-owner` 为 `{schoolId,username}` URL 编码 JSON，仅用于拒绝旧账号，不能赋权。
- GET 能力及两个 POST 都验证 cookie 和 expected-owner，并显式拒绝任何 Authorization（包括 Cookie+Bearer，避免 identity provider 优先使用 bearer）；POST 还要求完整 canonical HTTP(S) Origin、JSON、能力头。Origin.host 必须完全匹配既有可信反代提供的 Host；`sec-fetch-site: same-site/cross-site` 均拒绝，实际 TLS 不允许 HTTP Origin 降级。HTTPS 可能在代理终止，因此不从后端 HTTP socket 推断外部协议，**不读取/信任 x-forwarded-proto**。可注入 `publicOrigin` 进一步精确固定整个外部 origin；未配置时沿用既有 trusted reverse-Host gate，允许正式 HTTPS 和候选 loopback 各自使用其准确 Host，不改变 CORS 或反代信任配置。
- body 为严格闭集；不收 owner、客户端时间、题目、对话、sceneJSON、sceneId、坐标、展示标题。来源和 scope 由服务器固定，不允许客户端升级 provenance。
- `resolveExperiment(id)` 是**必需的服务端批准目录注入点**。未注入时 `recordingEnabled:false`，prepare/record 503。不能传 `() => true`、正则匹配任意 slug、客户端传来的 catalog 或基于 saved_scenes 的猜测。现有批准身份真值为 `experiment-host/src/contract-v3.ts` 的 `experimentProfile` / `experiment-registry.json`（官方模板和批准社区 renderer 共用模板 ID，不是投稿 package UUID）。
- prepare 将 runId、experimentId、真实 owner、当前 capabilityGeneration、prepareHash、permitHash 和原 preparedAt/expiresAt 保存为 `state:'prepared'`。无 recordedAt、无 activity 胶囊，因此不产生 use。
- opaque permit 由进程私有随机 PRF key 派生，可在不保存明文 permit 的前提下对同内容 prepare 返回同一短期 permit。数据库、诊断、日志不得存明文 permit。每个 service 实例的新 UUID capabilityGeneration 会拒绝上一个实例/重启前的 permit；没有重启后重新签发旧运行或延长 TTL 的路径。
- record 必须匹配 runId、实验、owner、generation、未过期 permit。以常时 hash 比较校验 permit。
- **一次原子 row update** 同时写入 `state:'recorded'`、服务端 ISO `recordedAt`、owner、stableHash、固定 provenance/boundary/scope，以及严格 `ActivitySuccessCapsule`。其 operationId = runId，occurredAt = 原 recordedAt。胶囊与原运行事实不能拆成两次写入。
- 同 hash 重试在同一 capability/permit 有效期内返回原 recordedAt 和 `replayed:true`，不另写行；不同实验/准备内容 409，错误 permit 403、跨 owner 403、旧 generation 409、过期 410。过期/重启后的 HTTP 重试不会把旧观察重新定时为今天；已提交事实由内部七日 replay 恢复统计。
- 业务落盘后才 best-effort 调用 `activitySink.success`，默认最多等 1.5 秒（可配但不超过 3 秒），不抛出推翻业务 ACK。诊断钩子也可失败而不影响实验。最多 8 个统计投递在途，永不无限堆积超时 promise；丢失投递由 durable replay 覆盖。
- 后端 ACK 失败可能发生在真实落盘之后；遇到非业务存储异常，当前服务冻结后续写入并报固定 `EXPERIMENT_RUN_STORAGE_UNCERTAIN`，需要重新打开 domain/service。不能用旧内存覆盖不确定的持久行，也不能宣称测试或诊断已证明其落盘。

## HTTP 与主入口接线

没有修改 `learning-host/src/index.ts`、`canvas-config.ts`、`client/index.ts`、surface/auth/admin/activity-contract；以下由主代理集成。

### 服务端 leaf API

```ts
import { openExperimentRunDomain } from './experiment-run-domain.ts'
import { ExperimentRunService } from './experiment-run-service.ts'
import { experimentRunRoutes, EXPERIMENT_RUN_PREFIX } from './experiment-run-routes.ts'
// types leaf 还导出 EXPERIMENT_RUN_SERVICE = 'physicsosExperimentRuns'（可选的内部服务名）。

// experiment-host 已提供内部 physicsosExperimentCatalog，避免 learning-host 反向 import 客户端/其它宿主 src。
const catalog = () => ctx.get('physicsosExperimentCatalog') as
  { readonly schemaVersion: 1; has(id: string): boolean } | undefined
const domain = await openExperimentRunDomain(ctx)
const runs = new ExperimentRunService(domain, {
  mode: teachingToolsMode, // 不提供时为 bridge；只有 enabled 接受 prepare/record
  catalogAvailable: () => catalog()?.schemaVersion === 1,
  resolveExperiment: id => catalog()?.has(id) === true, // 服务端批准 catalog，不是任意 slug
  activitySink: stableActivitySinkProxy, // 先构造稳定 proxy，再绑定 ActivityService，避免构造循环
  onIssue: code => logger.warn(code), // 只输出固定 code，不能附 request/body/token
})
await runs.initialize()
const runHttp = experimentRunRoutes({
  service: runs,
  identity: () => identityOf(ctx),
  publicOrigin: 'https://physics.dongsiwei.com',
})
// 用现有 webserver prefix 注册方式将 EXPERIMENT_RUN_PREFIX -> runHttp。
// replaySources 加 runs.activityReplaySource；不是空源、不是 usage 适配器。
// 在模块卸载时 await runs.dispose()，之后 await domain.close()。
```

新增 `experiment-host/src/catalog-service.ts` 提供 `EXPERIMENT_CATALOG_SERVICE = 'physicsosExperimentCatalog'`、`PhysicsosExperimentCatalog`（`{schemaVersion:1,has(id):boolean}`）。其闭集 Set 直接来自同一 `experiment-registry.json`。`experiment-host/index.ts` 仅增加在 `await service.initialize()` 后的 `ctx.provide` 和常量/type export；未改插件物理逻辑或注册目录的 HTTP 表达。learning-host 用上面惰性结构接口读取即可，无须新增跨宿主包依赖，也不碰脏 vendor。启动顺序中 seam 尚未挂载时 recordingEnabled false，enabled replay 同样返回 `RUN_CATALOG_UNAVAILABLE`，**不会把未配置源的空扫描报告为完整覆盖**。初始化/打开失败只报告该来源不可用，不能阻止真实实验运行，也不能使用空 replay source 伪装已接入。

`ExperimentRunService` 的公开方法：

- `initialize(): Promise<void>`：只读校验并建立有限预算/重放索引，bridge 不写空行。
- `capabilities(): ExperimentRunCapabilities`：路由层负责 cookie actor。
- `prepare(actor, unknownBody, {signal?,assertOwner?}?): Promise<ExperimentRunPermit>`。
- `record(actor, unknownBody, {signal?,assertOwner?}?): Promise<ExperimentRunReceipt>`。
- `activityReplaySource: ActivityReplaySource` getter，source 固定 experiment-run。
- `dispose(): Promise<void>`，不关闭 domain；主入口负责后续关闭。

HTTP 所有响应 private no-store；不接受任何 query：

| 方法 | 路径 | 输入/结果 |
| --- | --- | --- |
| GET | `/physicsos/experiment-runs/v1/capabilities` | `{schemaVersion:1,capability:'experiment-run-v1',mode,recordingEnabled,capabilityGeneration,provenance,boundary,scope,permitTtlMs}` |
| POST | `/physicsos/experiment-runs/v1/prepare` | `{runId,experimentId,expectedCapabilityGeneration}` → 同三字段 + `{permit,expiresAt}`；不计 use |
| POST | `/physicsos/experiment-runs/v1/record` | 同三字段 + `{permit}`（**不上传 expiresAt**）→ `{runId,experimentId,recordedAt,provenance,boundary,scope,replayed}` |

POST 能力头 `x-physicsos-experiment-run-capability: experiment-run-v1`。所有请求必需 `x-physicsos-experiment-run-owner`；HTTP 层在 body 等待/队列等待后、写前和响应前复核真实 cookie actor。已进入原子存储写入后不能回滚一个已完成的原 owner 事实；账号变化仍不向新账号返回旧响应。

### 客户端入口

```ts
import { installExperimentRunTracking } from './experiments/experiment-run-tracking.ts'
const stopRunTracking = installExperimentRunTracking(auth.store)
// 同现有 client ctx 卸载过程调用 stopRunTracking。
```

安装函数自行按真实 authenticated AuthStore 读取独立运行能力；**不要用 activity 能力或 teachingTools UI 开关替代运行能力**。未安装、auth loading/guest、能力读取失败或 bridge/off 时没有 prepare/record，也不影响播放。客户端不需要给 `LabWorkspace`/`surface-store` 加字段。`PhysicsWorkspace`、`CommunityExperimentFrame` 的局部接入已在源码内，主入口只安装一次。

客户端按 account id + schoolId + username + auth epoch 固定 API owner；auth 改变同步 abort 所有旧 tracker，旧展示 token 也绑定原 account epoch，不会因新账号能力加载完成而重新启用。旧 MessagePort 的迟到 play/重复 ready 无法让新账号记运行；新账号需新的成功显示 presentation。实验切换在 render 时即通过 ref 拒绝旧 callback，cleanup 再 abort。一个 session 最多一个 tracker；一个意图固定 UUID，prepare/record 传输错误各最多重试两次，不轮询刷量，不存 localStorage/sessionStorage permit 或离线运行队列。

## 七日重放、容量与保留

`activityReplaySource.read({from,to,limit,cursor?,signal})` 只返回 recorded 行中原封不动的紧凑胶囊；原时间升序、runId 字节序稳定排序，采用 `[from,to)`，最多 limit 项，游标绑定同一数值时间窗口并小于 512 字节。持久事实在新 DomainFacility/service 初始化时重建索引，不依赖进程未丢失的临时队列。

- 只恢复当前时刻之前七日内的原记录，窗口长度 ≤7日。已知原记录在分页期间老化出窗时明确 `RUN_REPLAY_EXPIRED`，不悄悄跳过后声称追平；activity 自己的 checkpoint/gap 机制负责完整性告警。
- 每页最多 200 胶囊（可配，上限 500），使用紧凑索引二分定位后读取最多 limit+1 项；有 AbortSignal 检查，不返回正文或 prepared 行。
- 默认保留 8 日（不少于 7 日），过期完整行在 enabled 的 prepare admission 中每分钟最多删 128 行。bridge 初始化、读取、重放不清理也不新写。不为了腾空间删掉七日可恢复行。

默认硬上限来自 `DEFAULT_EXPERIMENT_RUN_LIMITS`：

| 资源 | 默认值 |
| --- | ---: |
| 完整请求 / 完整行 | 1 KiB / 4 KiB |
| 全局行 / 每账号行 | 20,000 / 2,000 |
| 全局编码预算 / 每账号 | 32 MiB / 2 MiB |
| 每账号 / 全局请求 | 60 / 1,200 每分钟 |
| 限流 owner / 写队列 / HTTP 在途 | 4,096 / 64 / 8 |
| 请求时限 / permit TTL | 10秒 / 120秒（TTL 最多5分钟） |
| 客户端未完成意图 / tracker attachment | 8 / 32 |
| 统计投递等待 / 在途 | 1.5秒 / 8 |

prepare 按完整成功行上限预留容量，不能发出本来就装不下 success 的 permit。额度包含未完成准备行；不会因 ready/取消悄悄产生 use 或无限占用内存。达到上限明确拒绝统计记录，但播放继续。

**容量现实限制**：storage facility 依然在 open 阶段 loadAll，`runs.entries()` 依然会复制这一有限 unit 的 entries；initialize 的检查不是 loadAll 之前的容量门禁。默认 20,000 行/8日也不是生产容量证明，尤其高 DAU 可能更早达到字节额度。主代理的真实服务器隔离容量验证、activity queryCapacityVerified gate 仍必须保留；本次没有扩大或绕过它们。

## 测试源码与未验证项

**本次未执行任何本机或服务器测试、构建、浏览器验收、容量测试或部署，也未向生产发送任何写请求。** 下列仅为已编写的验证源码，不代表通过：

- `learning-host/tests/experiment-run-fixture.ts`：真实 DomainFacility + JSON backend，支持写前/落盘后 ACK 故障。
- `experiment-run-service.spec.ts`：prepare 不计、闭集/隐私、同 hash 并发去重、异内容/跨 owner/旧 generation/过期拒绝、原子胶囊、写不确定冻结/冷重开、best-effort 超时/诊断失败、七日原时间游标、行/字节/账号/全局频率/队列、取消和写前 owner 复核。
- `experiment-run-http.spec.ts`：真实 HTTP、cookie/owner/same-origin/能力头、重复头/路径/query/字节、跨 owner/响应账号复核，以及完整 `prepare -> 实际 MechanicsEngine 首步 -> record -> durable capsule` 链（真实客户端 API/controller 经 HTTP handler）。
- `experiment-run-activity.spec.ts`：真实业务记录 → sink pending → 全新业务/统计 domain → 原时间恢复且不重计。
- `experiment-run-postgres.spec.ts`：显式 `PHYSICSOS_TEST_POSTGRES_URL` 和随机独立 schema；原子事实/胶囊查询及冷重开。绝不读取 DATABASE_URL 或生产连接。只能由用户另行允许的服务器隔离测试运行。
- `experiment-host/tests/catalog-service.spec.ts`：内部 ctx seam 与现有服务端发布目录同闭集，不接受任意 slug、大小写漂移或投稿 package UUID。
- `ui-physicsos/tests/experiment-run-tracking.client.spec.ts`：实际 MechanicsWorkspaceRuntime、V3 意图、prepare/首步先后、取消/迟到、稳定 ID 重试、静态/失败/NaN/no-op、bridge/off、账号/展示代际、同 session 去重、最小网络体。
- `experiment-run-boundary.client.spec.tsx`：真实 PhysicsWorkspace 工具栏/键盘/RAF 首步及 CommunityExperimentFrame MessagePort 的 ready≠run、旧 port/error、引擎首步、sandbox 保持不变。

入口接线由主代理负责并独立核对（其已通知接入批准目录 resolver、服务/路由、稳定 ActivitySink proxy、replaySource 和 client 安装/卸载）；本分工未改 learning/client 入口文件，也未对其运行验收。真实剩余交付是服务器 Docker 显式隔离环境中另行获准的测试、容量与实际浏览器验收，以及正式发布前的清单重签/overlay 集成检查。当前没有构建、切换或部署，本来源不能宣称已上线。
