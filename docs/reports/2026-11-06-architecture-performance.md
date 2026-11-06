# Agent 架构与性能整体优化

## 当前状态（2026-11-06）

**分支 `codex/architecture-performance`，基于 `codex/question-visual-reliability`（`155377c`，含 Codex 线程 01a1ac3e 的全部未发布修复）。尚未发布，正式站未切换。**

- 范围：Codex 线程审查中"已发现但未修改"的四个性能热点（私有产物全局串行队列、试卷轮询重复/过期响应、每帧快照完整复制与校验、学习记录逐条上传），线程末尾正在评估的"重新生成多余一跳"，以及生成链路的结构性重构。
- 正式切换仍以 `docs/reports/2026-11-05-question-visual-reliability.md` 记录的门槛为准：候选镜像构建、12 领域桌面/手机回归、真实生成视觉验收、备份与回滚材料。本次改动在那条流程之前合入，不单独上线。
- 本机为源码编辑环境；最终门槛在服务器 `107.151.246.59` 的 `physicsos-app:local` 一次性检查容器内复核（见"验证"一节）。

## 已定位并修复的问题

### 1. 私有产物创建的全局串行队列（experiment-host）

`QuestionCodeArtifactService.create` 把每个调用挂在同一个 promise 链上（`this.tail`），临界区内包含：完整的包元数据与资源校验、独立绘图分析、`node --check` 子进程（最长 5 s）、约 6 MB 模板文件的哈希与写入，以及一次只为读取 `styleVersion` 却重建完整模板 ZIP 并求 SHA 的 `context()` 调用。一个用户的生成会把其他用户的 `create` 推到 `GENERATION_TIMEOUT`。

修复（`8499504`）：
- 新增 `experiment-host/src/concurrency.ts`：`Semaphore`（有界并发）、`InFlight`（关闭时排空）、`singleFlight`（按键合并同内容写入）。
- `create` 不再串行；只有 CPU/子进程校验阶段受 `validationParallelism`（默认 `min(4, cores-1)`）限制；内容寻址 blob 按摘要合并写入，EEXIST 路径不会读到半写文件；进程内已写入/已校验的摘要不再重复读取哈希（读取路径仍逐字节校验）。
- `styleVersion` 直接读取已发布提示版本，不再重建模板 ZIP。
- `stats()` 暴露 in-flight / validating / queued 计数。
- 回归：`tests/question-code-concurrency.spec.ts`——三个独立 owner 并发 create 时 `validating` 峰值等于配置上限 2（旧实现恒为 1），模板 blob 只落盘一次；被拒绝的 create 不影响邻居；`close()` 排空；同内容并发只写一次。

### 2. 学习记录最多 200 条逐条上传（learning-host + client）

修复（`851d484`）：
- 服务端新增 `POST /physicsos/learning/attempts/batch`，单次最多 50 条，逐条给出 `saved / invalid / conflict / forbidden` 结果，只有信封本身出错才整体失败；请求体 413 时关闭已中断的 keep-alive 连接（原实现会让后续请求挂起，测试中复现）。
- 客户端 `LearningApi.putAttempts`；`learning-record-store` 按 50 条分批，发件箱每批持久化一次（原来每条确认写一次，O(N²)）；被服务端明确拒绝的行从发件箱移除，不再让每次同步都失败；无批量路由的旧主机回退到逐条 PUT。
- 回归：120 条待上传 → 3 次请求 `[50, 50, 20]`、3 次发件箱写入；传输失败整批保留并在下一轮重试；明确拒绝的行不阻塞其余行。

### 3. 试卷任务轮询重复与过期响应覆盖（paper-host + client）

出卷工作台同时存在五个独立轮询（3 s 兜底、AI/导出 runner 2.5 s、退回修改/换题各 3 s），都不检查响应是否属于当前打开的任务、是否比已显示状态更旧；`JobDetail` 不按任务 id 重挂载，切换任务后旧 runner 每 2.5 s 把详情翻回旧任务。

修复（`5b688e6`）：
- 服务端 `GET /jobs/:id` 带 `ETag`，`If-None-Match` 命中返回 304，45 分钟起草期间的轮询变为只传头部。
- 客户端 `PaperApi.pollJob`（条件读取）；所有任务更新经 `applyJob`：丢弃非当前选中任务的响应，丢弃 `updatedAt` 更旧的状态；runner 运行时兜底轮询暂停；轮询保持单请求在途；按 id+status 建定时器，状态更新不再重置周期；`JobDetail` 以任务 id 为 key，runner 与等待随任务结束；退回修改/换题共用一个受保护的 `useJobPoll`。
- 顺带修复 `paper-host/src/draft.ts`：题图 `ref` 非字符串时 `undefined.trim()` 抛错会丢掉整段草稿（以 `noCheck: false` 对该包做严格类型检查时发现）。
- 回归：30 s 起草期内只有 runner 在轮询（11–13 次），`getJob` 仅 runner 首读一次，ETag 命中后不再更新视图；切换任务后迟到响应不覆盖；旧状态不覆盖新状态。三条新测试在旧代码上全部失败。

### 4. 每帧快照完整复制与校验（physics-scene、engines、client runtimes）

所有动画 runtime 每帧通过 `SceneStore.getScene()`（`structuredClone`）读取场景一到两次，再调用引擎 `canHandle`（完整 `validateScene`），并从头重建所有与帧无关的面板；复合场每帧重新模拟整个过程（两次相分解、240+ 状态、校验）。

修复（`56645dd`）：
- `SceneStore.peekScene()`：每个 revision 一份深冻结的共享快照（下一条命令前引用不变）；`getScene()` 仍返回私有副本，原有"读取不可穿透命令门"的测试不变。`memoizeOnFrozenScene()` 只对冻结场景按引用记忆，未冻结场景行为与以前完全相同。
- 引擎：磁场 `resolveModel`、复合场模型与相分解、电场/平行板模型解析对冻结场景记忆化，`stateAt` 不再每帧校验场景。
- 客户端 runtime：帧路径改读 `peekScene()`；`canHandle/simulate` 只在 revision 变化时执行（复合场补上其他领域已有的模拟缓存）；tree/charts/table/derivation/verification/events/trajectoryTimes 按模拟结果记忆化（`frame-memo.ts`），同时让画布的 `useMemo` 能命中。
- 实测每帧 `advance()`（本机 node，同一机器）：复合场 11 → 1.4 ms，碰撞 7.9 → 0.3 ms，平行板 2.9 → 0.14 ms，电路 1.9 → 0.23 ms，匀强电场 1.5 → 0.33 ms，机械波 1.0 → 0.05 ms。力学仍约 2 ms，主要在 `mechanicsSceneVisualAt` 的每帧视图构建，未在本轮改动。
- 回归：`frame-path.client.spec.ts` 对九个动画 runtime 断言 600 帧内 `getScene()` 0 次、`canHandle/simulate` 至多 1 次；复合场加入"600 帧只模拟一次、修改条件后重算"。

### 5. "重新生成"多余的主模型一跳（tool-physicsos + client）

点击"重新生成"原先向主对话发送提示词，等主模型（含推理）决定调用 `physics_generate_experiment`，再进入受限代码子代理；上游 5xx 可以在子代理启动前就终止整个流程（Codex 线程最后阶段的 524 即卡在这一步）。

修复（`73728f9`）：
- `POST /physicsos/question-code/regenerate`：调用者账号须拥有该会话（身份 cookie → `sessionOwnerKey`），会话通过上游 `sessionController.resolveAgent` 解析（冷会话按与聊天提示相同的方式恢复），然后直接运行与工具相同的 `generate()`。同源限制；发布 `generating` 快照后立即返回 202，任务保留 600 s 预算。`force` 只跳过面向模型的"同一轮复用结果"规则；同一 revision 的在途任务直接返回而不重复启动，超过 deadline 的任务视为中断可替换。
- 客户端按钮先走直达路由，主机无此路由（404/503）时回退到原聊天提示。
- 回归：真实 agent loop 下，重新生成在同一轮完成，主模型请求数为 0，场景事实不变；归属/CSRF/请求体检查；在途任务复用。

### 6. 生成链路重构（tool-physicsos）

`code-generation.ts` 与 `code-provider.ts` 把失败分类、提示词组装、子代理工具定义、断点簿记与重试循环揉在两个文件里，错误码以 `Object.assign` 内联构造，规范 JSON 摘要在两个包里各写一份。重构（`172b37c`、`4005042`）后行为不变，120 项生成器测试与 experiment-host 题目代码套件保持通过：

| 模块 | 职责 |
| --- | --- |
| `generation-errors.ts` | `GenerationCode`、`generationError()`、`codeOf()`、可重试/瞬态/续写判定、学生可见失败文案、可信校验提示、`classifyIncompleteRun()` |
| `question-code-prompt.ts` | 作者任务文本（原 `promptFor`） |
| `code-child-tools.ts` | `physics_write_experiment_code`、`physics_generate_experiment_asset` 与 `structured_output` 守卫 |
| `code-checkpoints.ts` | 跨续写的按父会话写入预算断点 |
| `code-generation.ts` | `GenerationClock`（截止时间 + 调用方信号）与扁平的 `runAttempt()` 循环 |
| `code-provider.ts` | 一次 `JobPlan` 规划，只做编排 |
| `solve-publication.ts` | 求解摘要、尝试轨迹、同轮复用判定 |
| `@physicsos/agent-tools` `canonicalJson` | experiment-host 与生成器共用同一个规范 JSON |

### 7. 顺带修正

- `model-pool-host/tests/store.spec.ts` 的合成凭据再次触发仓库 secret-scan（`packages/image-generation` 的 `secret-hygiene` 测试在基线上失败），已改为不匹配 key 模式的字面量（`02ac41c`）。
- `paper-host` 两处严格类型错误（未使用参数、`unknown` 上调用 `.trim()`）。

## 审查发现但未改动

- 力学每帧视图构建（`mechanics-visual-bridge.ts`，约 0.7 ms/帧）把全程轨迹包围盒与当前状态混在一个大函数里，可继续拆分为按模拟记忆的几何与按帧的状态投影。
- `paper-host` 的 `reportProgress` 每次进度上报重写整个任务行，并与 `commitEngineAnswers` 等写入并发；是否存在迟到覆盖取决于上游 storage-domain 的提交顺序，本轮未改。
- `learning-host` 的 `listAttempts` 每页扫描全部用户的行；量化后可按 `userKey` 建索引。
- 各 host tsconfig 为 `noCheck: true`，`pnpm typecheck:agent` 只产出声明不做类型检查；本轮对改动的包临时以 `--noCheck false` 复核并修正了暴露的问题，建议后续把严格检查纳入 CI。

## 验证

本机（高负载，部分 5 s 超时为环境所致，单独重跑通过）：
- 改动包逐包：`physics-scene` 105、`engine-magnetic` 77、`engine-composite` 34、`engine-electric` 19、`engine-electric-region` 20、`agent-tools` 70、`learning-host` 5、`paper-host` 41、`experiment-host` 题目代码 95、`tool-physicsos` 119（另 1 项为 darwin 缺少原生 flock 绑定的既有环境失败）。
- Web 套件：基线 32 失败/1256 通过 → 改动后 32 失败/1273 通过，失败集合与基线逐项一致（既有 jsdom SVG/Three 器材断言），新增 17 项全部通过。
- 新增/改动包的 oxlint 与 eslint 无新增告警；`tsc -b` 对 tool-physicsos 以 `--force` 构建通过。

服务器一次性检查容器（`physicsos-app:local` + 本分支源码）：结果见下文"服务器复核"小节（运行完成后补记）。

## 服务器复核

（待补记）
