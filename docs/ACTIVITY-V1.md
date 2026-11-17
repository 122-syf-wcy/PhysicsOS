# 用户统计与学校榜 v1：口径、持久化及接线合同

本合同只涵盖独立活动统计，不改变 `physicsos_usage` v0 的 schema、旧事件或 `use:view` 含义。统计源码位于 `overlays/harness/files`；不把测试夹具或示例数字用于应用回退展示。

## 口径与隐私

| 指标 | v1 定义 |
| --- | --- |
| 访问 visits | 已登录应用实际显示后，每个账号、每个 Document/pageInstance 一次。不是 UV、登录次数或 React render 次数。 |
| 打开 opens | 功能或资源成功显示，按真实进入的 presentation generation 一次。加载失败、权限拒绝、请求 intent、轮询、重渲染不计。 |
| 有效使用 uses | 白名单业务持久成功回执：实验运行记录、实验画布编辑会话首个有效保存、教学画板编辑会话首个有效保存、课件授课实例创建。同一持久操作 ID 只计一次，恢复课件/后续 autosave 不新计。 |
| 活跃人数 activeUsers | 所选期间至少一次有效使用的账号集合大小。日活不能逐日相加。 |
| 当前头像采用 | 当前有效账号的 catalog 头像快照，与所选活动时间范围无关。精确匹配 12 个受控路径；旧头像、未选头像、外域 URL、带额外 query 的路径均不算 catalog 采用。 |

- 时间统一 `Asia/Shanghai` 自然日；今日、近 7/30/90 天均含今天。可用 `to` 指定最近 90 日内的结束日，但整个窗口不得越出在线保留区间。不补造采集起点之前的历史。
- 不收集题目、对话、笔迹、场景正文、任意点击/激光/聚光灯坐标、IP 或额外网络身份信息。客户端只发送闭集模块及时间编码的随机标识；业务胶囊只包含来源、持久操作 ID、原时间和服务端归属。
- 不把自测 attempts、最近场景 PUT、页面进入、画布对象上传、归档/删除、管理操作、头像选择当成实验运行或有效使用。
- `experiment-run` 需接真实平台引擎运行成功边界及独立服务端运行记录；仅 iframe/引擎 ready 不够。若其持久源未接入，界面明确显示来源缺口，不能宣称所有实验运行已覆盖。
- 如运行记录来源为 `client-observed`，它只证明服务器保存了客户端观察，不代表服务器执行了仿真或完成物理验证。

## 权限与排行对象

1. 每次 HTTP 请求从真实 session 解析 actor；body 不能指定 actor。`x-physicsos-activity-owner` 仅能拒绝旧账号请求，不能赋权。
2. SUPER_ADMIN 可按授权目录查看跨校；SCHOOL_ADMIN 仅本校；教师/学生/匿名均不能调用管理统计。响应前重新验证账号、学校和角色，避免请求期间降权仍收到旧范围结果。
3. `activityRoster(actor)` 一次返回最小安全投影，不能返回原 auth 用户行或密码/邮箱/安全字段。目录版本随用户角色/状态/头像及学校状态/名称变化。无逐学校 `listUsers`、无逐用户 summary 的 N+1。
4. 排行仅计当前有效学校的当前有效非 SUPER_ADMIN 账号；排除停用、alias、merged、archived、待审核学校。**不默认排除 PHYSICSOS-OPEN**，开放学校中真实学生和教师正常统计；不按相似学校名合并，也不按用户名/学校名前缀猜测验收账号。
5. 部署可用 `excludedSchoolIds` 和 `excludedAccountKeys: {schoolId,userKey}[]` 精确排除已确认的运维/验收对象，默认均为空。DTO 的 `rankingExclusions` 及 UI 展开说明显示当前权限范围内的显式名单。该排除只影响学校榜，不删除用户历史；停用用户的已收集期间历史仍可由有权限管理员在详情读取。
6. 默认有效使用降序；相同数值按不可变 `schoolId` 字节序稳定排列。用量名次为 competition rank（1、1、3）；其它列排序不改变用量名次。搜索、分页在一次归组后进行。概览是全部授权学校，不随搜索改变。

安全目录合同（可选属性不写 `undefined`）

```ts
{
  version: string,
  schools: [{ id, name, status, mergedInto?, rosterAliasOf?, archivedAt?, reviewState? }],
  users: [{ schoolId, userKey, username, status, role, avatarUrl? }],
}
```

auth-host 已提供 `service.activityRoster(actor)` / `identity.activityRoster(actor)` 的安全内部接口。统计只调用一次该接口，不再调用第二次头像快照 API。头像来自当前 `users.avatarUrl` 单源，不做换头像事件增减双写。

## 独立持久化与去重

- 单元名 `physicsos_activity_v1`，单元版本 `0`，`layout: per-record`。这是新单元的初版，不是升级旧 usage v0。表为 `buckets`、`receipts`、`state`。
- 日桶键是 `SHA256([schoolId,userKey,上海day,shard])`。固定 4 shard，由稳定事件 hash 选择；满桶不创建额外 shard。
- 新桶先保存全零空桶。随后在**同一次 `KvTable.update`** 内替换计数、功能分项和 `dedup[idHash]=requestHash`。更新失败时计数和去重键均不得只落一半。
- 客户端 ID 是 `13位原始epochMillis_UUID`，重试必须保留整个 ID。访问 ID 等于 pageInstanceId；打开单独 ID。同一 ID 换模块/类型/页面实例产生 hash 冲突，不能重新计数。客户端原时刻只影响 visit/open，不是业务成功的证据。
- 服务端成功胶囊使用 `SHA256([owner,source,operationId])` 的全局稳定键；独立 journal 持久保存原时间及内容 hash。相同 operationId 换原时间/内容为 409 冲突，不能跨日换桶再计一次。
- journal 状态 pending → 日桶原子更新 → applied。第二步成功、第三步失败或丢响应，重启再次投递仍由日桶 hash 去重。
- 后端拒绝 ACK 也可能已完成物理落盘。遇到非业务校验类的存储异常，当前 ActivityService 标记 `ACTIVITY_STORAGE_UNCERTAIN` 并停止后续持久化，避免用尚未更新的内存快照覆盖已落盘计数；业务 sink 仍返回 pending。必须重新打开该统计单元（正常重启/受控重挂载）后重放 durable 胶囊。不要清除标志继续写旧内存。存储不可写时告警通过固定 code 的宿主 logger 输出；不能虚称告警已落盘。
- 七日重放窗口严格绑定**原操作时间**；超过七日返回 `ACTIVITY_REPLAY_EXPIRED`，不改成今天。在线桶与 journal 保留 90 日，以原日清理；每次恢复最多清理 1,000 行。
- `state.sourceCheckpoints` 持久保存各业务源追平边界。超过七日停机/追平中断产生 `ACTIVITY_REPLAY_GAP`，不能仅因最近窗口为空就宣称完整。

### 业务成功合同

独立 leaf `packages/physicsos/learning-host/src/activity-contract.ts` 导出 `activitySuccessCapsuleSchema`、`ActivitySuccessCapsule`、`ActivitySink`、`ActivityReplaySource`。业务与统计必须共用该严格 schema。

```ts
const capsule: ActivitySuccessCapsule = {
  version: 1,
  source: 'canvas-edit', // experiment-run / whiteboard-edit / courseware-session
  operationId: stableBusinessOperationId,
  occurredAt: serverFirstCommitTime,
  owner: { schoolId: actor.schoolId, userKey: actor.userKey },
}
// capsule 必须先与业务成功事实保存在同一次 durable 业务写入。
await saveBusinessFactWithCapsule(capsule)
const delivery = await activitySink.success(capsule)
// delivery: recorded | duplicate | pending | rejected，不抛异常推翻已提交业务成功。
```

编辑操作 ID 应稳定覆盖 `resourceId + editingSessionId`，而不是每次 autosave 的 commitId。课件为稳定 sessionId，实验为稳定 run record ID。时间在首次成功提交固定，重试、恢复、自动保存不能重新取当前时间。

`success` 最多同步等待 3 秒；超时返回 pending，已开始的统计投递继续受队列预算约束。统计写失败、限额、日志 hook 失败不得改变已提交业务 ACK。

仅在统计内做 journal **不足以覆盖业务已提交、success 尚未调用就崩溃**。业务必须提供持久胶囊恢复源

```ts
const source: ActivityReplaySource = {
  source: 'canvas-edit',
  read: async ({ from, to, limit, cursor, signal }) => ({
    capsules: /* 原时间/id稳定排序，最多limit个安全胶囊 */ [],
    nextCursor: /* 还有后续页时返回不重复的有界游标，否则省略 */ undefined,
  }),
}
```

上面仅示意返回结构；实际属性省略而非显式 undefined。源允许其既有 `[from,to)` 或含结束点的时间约定，但必须保留原时刻，不返回未提交/失败业务。恢复按页推进且从近七日重扫，稳定 id 保证重扫不刷量。**这不是跨业务单元的 exactly-once 事务**；原业务胶囊及恢复窗口/完整性告警才覆盖跨域 gap。

## 有界预算与容量门禁

默认预算见 `DEFAULT_ACTIVITY_LIMITS`；部署不得以 UI 分页替代 KV 索引。

| 项 | 默认上限 |
| --- | ---: |
| 总行数 / bucket / journal | 120,000 / 90,000 / 30,000 |
| 整个单元编码字节 | 96 MiB |
| 单桶 / 去重键 | 64 KiB / 256 |
| 请求 / 活跃请求 / 排队写 | 2 KiB / 8 / 128 |
| 每账号客户端事件 / 全局客户端事件 | 60/分钟 / 1,200/分钟 |
| 全部持久化写（包括回执/告警/清理） | 6,000/分钟 |
| 同分钟限流 owner 数 | 4,096 |
| roster 用户 / 学校 / 编码字节 | 10,000 / 2,000 / 8 MiB |
| 聚合缓存 | 8 项、合计 8 MiB、TTL 5 秒 |
| 查询扫描 | 全局 120,000 行 / 96 MiB；归组 2 秒 |
| 初始化预算 | 2 秒（不含 storage facility 已做的 loadAll） |
| 单源单次恢复 / 恢复间隔 | 200 / 30 秒 |

KV `DomainFacility.open` 仍会先整表 `loadAll`，`entries()` 仍会复制整个表的 pair 数组。`initialize` 的检查不能伪称在 loadAll 之前阻止了堆分配。查询先检查全局预算，一次桶扫描归组全部用户/学校、一次回执扫描统计延迟，然后按权限、时间、数据 revision、roster version 缓存。分页不会减少首次加载量。

`queryCapacityVerified` **默认 false**。管理员查询返回 503 `ACTIVITY_CAPACITY_UNVERIFIED`，UI 显示明确阻断文本，不显示假零。必须先在服务器 Docker、明确隔离测试数据库跑完 90 日预估及十倍负载，才可由发布配置开启。以下任一项失败都保持 gate 关闭，先增加可索引存储再开榜：

- 按真实预期 DAU/每日事件数估算 `90 * DAU * 有事件shard数 + 90日成功journal行 + state`，符合全局行/字节/日桶/journal/roster 上限。
- 完整 cold open（含 PostgreSQL loadAll、parse、initialize）≤2秒、增量 JS heap ≤512 MiB。
- 20 次无缓存全范围归组 p95 ≤2秒、增量查询 heap ≤128 MiB；每次仅一次 buckets.entries 和一次 receipts.entries，不能按学校增加扫描次数。
- 缓存项/字节全局不越界，十倍负载不通过时明确失败，不偷偷只测前一页或只提高 timeout。

`activity-capacity.spec.ts` 为显式 opt-in 服务器隔离 PostgreSQL lane：要求 `PHYSICSOS_ACTIVITY_RUN_CAPACITY=1`、仅测试库 `PHYSICSOS_TEST_POSTGRES_URL`、明确 `PHYSICSOS_ACTIVITY_BASE_DAILY_USERS`、`PHYSICSOS_ACTIVITY_EVENTS_PER_USER_DAY`，以及可测 GC 的隔离进程。它不读取通用 DATABASE_URL、不生成线上数字；无显式输入则跳过/拒绝，不据此声称通过。

## 接线（入口由主代理集成）

### learning-host

- 统一 `teachingToolsMode: off | bridge | enabled`，默认 bridge。off 关闭管理查询；bridge 读取/保留新记录但不创事件；enabled 才接收 visit/open、success、恢复和清理写。
- 构造业务服务时传稳定 ActivitySink proxy，之后绑定 ActivityService，避免构造循环。业务的首个有效提交先持久 capsule 再调 proxy。
- `new ActivityService(domain, { mode, roster, replaySources, queryCapacityVerified, onAlert })`；`await initialize()`。
- `replaySources` 接 `canvas.activityReplaySource`、`whiteboard.activityReplaySource`、课件的 `replaySource()`，并在真实运行记录实现后接 experiment-run 源。不要用空源伪装已接入。
- `initialize/open` 失败只停用统计并告警，不阻断其它业务服务；proxy 返回 pending，不抛出。
- `activityRoutes({service,identity})` 同时注册 `/physicsos/activity/v1` 和 `/physicsos/admin/activity/v1` prefix。先 `startRecovery()`，其 stop 在卸载时调用；`dispose()` 必须先于 `domain.close()`。

HTTP

| 方法/路径 | 权限/用途 |
| --- | --- |
| GET `/physicsos/activity/v1/capabilities` | 任意真实登录账号；`{schemaVersion:1,mode,collectionEnabled,queryCapacityVerified}`；private no-store |
| POST `/physicsos/activity/v1/events` | 登录账号；只接受严格 visit/open，无 actor/time/body 附加字段 |
| GET `/physicsos/admin/activity/v1/users?schoolId=...&username=...&days=7` | 管理员，target 从安全 roster 服务端解析到 userKey |
| GET `/physicsos/admin/activity/v1/schools?days=7&q=...&page=1&pageSize=20&sort=uses&order=desc` | 超管跨校、校管本校 |

不存在 HTTP `success` 或 `use` 路由。同源 mutation、请求字节、重复 query、未知 query、expected-owner 和返回前权限复核均在 routes 层执行。

### UI

- `AdminWorkspaceProps.activityApi?: ActivityApi` 是新增的独立注入合同，与 usageApi 平级；**不扩展 auth-api.AdminApi**。主入口给 `createActivityApi({owner: () => currentAuthSchoolAndUsername})`。
- 真实账号 capabilities 明确 `collectionEnabled === true && mode === 'enabled'` 后才启 `startActivityTelemetry(auth,{enabled:true})`；默认/读取失败不采集，不影响 app。
- 成功显示边界放 `<ActivityDisplayed module="canvas" accountKey={schoolId + ':' + username} entryId={presentationId}/>`。app 用 module="app"；资源/功能进入用相应模块。不要围在 loading/error/权限 gate 外。presentationId 为随机进入代际，重渲染稳定，主动重入变更；不得传题目/标题/路径正文。
- capabilities 请求前同步建立 `bufferActivityDisplays(auth)`，只在内存缓冲 ≤128 个已成功显示事件（模块、随机 presentationId、原显示时间、固定账号）；明确 enabled 后按 `startActivityTelemetry` → `buffer.flushInto(telemetry)` → `telemetry.appDisplayed()` 顺序接管。bridge/off/读取失败/账号 epoch 变化就 `buffer.dispose()`，没有采集请求或持久化。不要用 setTimeout 猜成功显示。原显示时间跨午夜仍按原日，不改成能力响应日。
- telemetry 只监听成功显示事件，不订阅 surface-store 的导航意图。ActivityDisplayed 的 accountKey 在本地匹配当前真实账号，迟到旧账号事件被拒；账号 key 不进网络 body。app visit 在同一个 Document 的同一账号最多一次。sessionStorage 仅保存 ≤128 项/64 KiB、七日内的原始 visit/open 队列，并发上报最多 4；账号头固定原归属，账号切换 abort 旧请求。客户端缺失仍是尽力上报，完整性文案不能暗示全量 UV。
- 用户右侧详情提供今日/7/30/90 天访问、打开、有效使用、分功能及所选期间最近使用。切 target 同步隐藏旧数据，AbortController+请求代际拒绝迟到成功/错误；账号变化时整个 AdminPage 按身份重挂载。
- 学校榜为概览数字、可排序表、展开 12 款头像缩略图/人数及旧头像/未选择人数。没有饼图、12 色调色板或 fake fallback。采用现有浅深主题 text/surface tokens。已按 dataviz 技能选择表格/数字，不新增类别颜色。

## 测试范围与未验收项

本次仅编辑测试源码，**未运行本机/服务器测试、构建、浏览器验收、容量压测或部署**。不能把下列文件存在当作测试已通过：

- `activity-service.spec.ts` / `activity-fixture.ts`：真实 DomainImpl + 原子 JSON 落盘；重复 hash、冲突、更新失败、持久后丢 ACK 的写冻结、success 等待超时、重启、独立业务 durable capsule 恢复、超窗及七日追平 gap、跨上海日、active 去重、跨校、稳定并列、开放学校/精确排除、头像总和、预算、bridge/gate。
- `activity-routes.spec.ts`：真实 HTTP、匿名/角色/跨校矩阵、同源、owner/time 伪造、字节/query、响应期间降权。
- `activity-postgres.spec.ts`：显式隔离 PostgreSQL 的完整落盘及新 DomainFacility 重开。
- `activity-capacity.spec.ts`：显式 90 日/10x PostgreSQL loadAll、heap、扫描次数、p95 gate。
- 客户端 `activity-telemetry.client.spec.ts`、`admin-activity.client.spec.tsx`：成功显示、重渲染不重计、固定 owner、重放过期、abort、target 代际、分项 UI、十二头像、gate 不造零。

主入口已接 ActivitySink proxy、四个业务 replay source、safe roster、后台 ActivityApi 和能力门控采集；独立平台运行来源见 [EXPERIMENT-RUN-V1.md](EXPERIMENT-RUN-V1.md)，仅表示服务端保存的客户端平台引擎首步观察，不是物理验证证书。发布前仍需逐成功显示边界核对、服务器测试／容量验收，以及浅深主题与 1440/1280/1024/390/320px 页面、键盘／触屏真实验收。源码接线不等于运行通过；容量未达标或 source 未追平时保留准确的阻断／不完整状态，不宣称统计已完整上线。
