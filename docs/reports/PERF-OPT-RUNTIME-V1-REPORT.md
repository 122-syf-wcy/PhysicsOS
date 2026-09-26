# PhysicsOS 性能优化 V1 收口报告（PERF-OPT）

> 日期：2026-09-08
> 状态：`PHYSICSOS_PERF_OPT_V1_COMPLETE`（已完成）
> 范围：按 `docs/01-DEVELOPMENT-GUIDE.md` §84–86 与 `docs/02-ENGINEERING-STANDARDS.md` §26 / #123 / #124 / #125 / #150
> 的性能约束，对高频渲染路径、轨迹存储、计算复杂度与 Worker 化边界做全局优化。物理数值结果与公共契约不变。

---

## 1. 目标

四条性能约束对应的现状缺口：

| 约束                                        | 现状                                                                  | 缺口                                                |
| ------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| #123 Canvas 性能（禁止每帧 React 全树更新） | 动画时钟每帧 `setSnapshot`                                            | 每帧触发整棵 React 树重渲染                         |
| #85 / #124 采样率分离 + 大数据轨迹有界      | 引擎硬编码轨迹分段，`SimulationOptions.outputSampleRate` 声明但零消费 | 存储随仿真无限增长、渲染点数无上界                  |
| #150 / #26 主线程长任务与 O(n²)             | 部分路径线性/二次扫描                                                 | `phaseAt` 线性扫描、验证汇总 O(E×C)、场采样反复分配 |
| #125 Worker 消息必须明确 Contract           | 无可 Worker 化的消息信封                                              | 未来 Worker 化无契约可依                            |

本轮不引入 Worker 生产实现、不触发懒加载改造（§86 属 web 层后续事项），只把「契约、上界、解耦、复杂度」四件事落地并用既有门禁证明数值未变。

## 2. 交付物

| 路径                                                                        | 内容                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/physics-scene/src/trajectory-sampling.ts`（新）                   | 采样/抽稀/分块契约：#124 有界存储 `MAX_TRAJECTORY_STORAGE_SAMPLES = 1024`、渲染预算 `MAX_TRAJECTORY_RENDER_POINTS = 512`；`trajectoryStorageSampleCount`（读 `outputSampleRate`，钳制 [2,1024]）、`trajectorySampleTimes`（等距含端点）、`decimateTrajectoryPoints`（保首尾 + `protect` 索引集）、`chunkTrajectoryPoints` |
| `packages/physics-scene/tests/trajectory-sampling.test.ts`（新）            | 14 个用例：钳制 / 等距 / 抽稀保首尾 / protect / 分块                                                                                                                                                                                                                                                                      |
| 6 个引擎（mechanics / magnetic / electric / wave / induction / composite）  | `simulate()` 尊重 `request.options.outputSampleRate`；缺省 fallback 与原分段常量完全一致（默认行为零变化）                                                                                                                                                                                                                |
| 4 个观察层轨迹构建器（magnetic / electric / mechanics / composite）         | 以 512 点为界抽稀；composite 额外把 phase 边界时刻收集进 `protect`，抽稀后区域穿越拐点不丢                                                                                                                                                                                                                                |
| `packages/physics-core/src/simulation.ts`                                   | 新增 Worker 消息契约：`SimulationProgress` / `SimulationError` / `SimulationWorkerMessage` 判别联合 + `parseSimulationWorkerMessage` 结构校验器（schema `simulation-worker/1.0`）                                                                                                                                         |
| `packages/physics-core/src/verification.ts`                                 | `summarizeVerification` O(E×C) → O(E+C)（error-code Set 去重）                                                                                                                                                                                                                                                            |
| `packages/engine-composite/src/composite-engine.ts`                         | `phaseAt` 线性扫描 → 二分查找，语义与原实现逐分支等价（注释保留原「首个 endTime ≥ time」判定）                                                                                                                                                                                                                            |
| `packages/physics-electric-core/src/field.ts`                               | `fieldAt` 融合单遍累加，消除每次采样 n 次中间分配与双遍历                                                                                                                                                                                                                                                                 |
| `packages/physics-verifier/src/electric-verifier.ts`                        | 每状态派生量一次 Map 索引替代多次线性扫描（文件同时被 prettier 重排，语义 diff 为该项）                                                                                                                                                                                                                                   |
| `packages/physics-verifier/src/magnetic-verifier.ts`                        | `assumptionsFromResult` O(A²) → O(A)                                                                                                                                                                                                                                                                                      |
| `overlays/.../ui-physicsos/src/client/physics/frame-source.ts`（新）        | #123 渲染通道：`createFrameSource` / `useFrameSource`（`useSyncExternalStore`），画布专属订阅                                                                                                                                                                                                                             |
| `overlays/.../ui-physicsos/src/client/PhysicsWorkspace.tsx`                 | 动画时钟每帧发布到 FrameSource（画布独立更新）；React 壳按 250ms 摘要节流刷新，Status / revision / running 变化即时刷新                                                                                                                                                                                                   |
| `overlays/.../ui-physicsos/src/client/QuestionWorkspace.tsx`                | 播放时钟与逐帧视觉计算下沉到画布子树；drawn-id Selection 以 set 相等守卫向上汇报，父级 rails 不随帧重渲染                                                                                                                                                                                                                 |
| `overlays/.../ui-physicsos/tests/frame-source.client.spec.ts`（新）         | FrameSource 语义 4 用例                                                                                                                                                                                                                                                                                                   |
| `overlays/.../ui-physicsos/tests/renderer-decoupling.client.spec.tsx`（新） | #123 浏览器级验证 2 用例：逐帧只更新画布读数、React 壳停留在节流摘要，250ms 后追平；离散交互即时                                                                                                                                                                                                                          |
| `packages/physics-core/tests/contracts.test.ts`                             | +5 Worker 契约用例（round-trip / 拒非 schema / 未知 kind / 非对象 / progress 越界）                                                                                                                                                                                                                                       |
| `packages/physics-core/src/index.ts`、`packages/physics-scene/src/index.ts` | 新导出                                                                                                                                                                                                                                                                                                                    |

改动合计：20 个源文件改 + 5 个文件新增（989 插入 / 256 删除，不含 vendor 子模块指针），全部在 `packages/` 与 `overlays/`（不触 `apps/`、`vendor/` 上游历史、`services/`）。

## 3. 设计决策

1. **四层采样率从契约落到实现，缺省零变化。** solver timestep（引擎内部）、storage（`outputSampleRate`，缺省 fallback = 原分段数 + 1）、render（观察层抽稀到 512）、chart（暂无独立消费者，F1 记录）四层分离；任何调用方不传 `outputSampleRate` 时存储密度与优化前逐点相同，物理数值不变。
2. **抽稀绝不发明数值、绝不丢物理意义点。** `decimateTrajectoryPoints` 只按索引等距选取（不动数值）；首尾（发射/落地/边界）强制保留；`protect` 让调用方声明必须存活的索引（composite 的区域穿越时刻），超出预算时对 protect 集自身均匀抽稀，上界永不被突破。
3. **渲染通道与 React 状态解耦。** `FrameSource` 是极小外部 store，动画循环写它不碰 React state；只有画布订阅 → 每帧只重渲染画布。React 壳订阅「低频摘要」（250ms 墙钟节流）+ 显著变化（Status / sceneRevision / running）即时刷新，交互动作（seek / highlight / 切场景）走 `commit` 双写保证画布与面板立即一致。
4. **Worker 边界先立契约。** `SimulationWorkerMessage` 只允许四类消息、`schemaVersion` 打标、载荷为进程内同一批不可变契约（same payload in/out-of-worker 字节一致）；`parseSimulationWorkerMessage` 在边界做结构校验（progress ∈ [0,1]、retryable 布尔…），畸形载荷返回 `undefined` 不驱动任何计算。生产 Worker 实现是登记跟进项（见 §7）。
5. **复杂度修复保持语义等价。** `summarizeVerification` 用 Set 保首现顺序去重；`phaseAt` 二分查找显式复刻线性扫描的「首个 endTime ≥ time，越界回落末相位」语义；`fieldAt` 逐分量累加与原 map→reduce 算术序列一致。全部由既有 golden / 契约测试证明数值未变。

## 4. 收口修复

性能改动落盘后，web lint 在新增文件上暴露 7 处问题，本收口修复后 lint 归零：

- `frame-source.ts` / `frame-source.client.spec.ts` / `renderer-decoupling.client.spec.tsx` 缺文件尾换行（eol-last ×3）。
- `frame-source.ts` `useSyncExternalStore(source.subscribe, source.get, source.get)` 触发 unbound-method ×3：`FrameSource` 接口方法加 `this: void` 声明（工厂实现为闭包箭头，不依赖 `this`）。
- `renderer-decoupling.client.spec.tsx` 的 `t` 助手 `key => zh[key] ?? key` 触发 `no-unsafe-return`（oxc 对复杂 locale-key 映射类型解析出 `error` 类型）：改走中间变量 `translations: Readonly<Record<string, string>>`，与 `overlay.client.spec` / `wave.client.spec` 既有写法一致。

## 5. 验收数据

- `pnpm typecheck`（core 28 包 + web + agent）：零错误。
- `pnpm lint`（core + web + agent）：零错误。
- `pnpm test:core`：27 包 **1090 用例全绿**（physics-scene 99 含新 14、physics-core 33 含新 5 契约用例、question-core 402、engine-composite 26、physics-verifier 30、physics-electric-core 13 等）。
- `pnpm test:web`：30 文件 **366 用例全绿**（含 frame-source 4、renderer-decoupling 2；基线 28 文件 360 用例，新增恰为这两个文件）。
- `pnpm test:agent`：22 用例全绿；`agent-tools` 32 用例全绿。
- 端到端 `tests/agent/headless-physics-acceptance.mjs`：16 项门禁全 PASS（R = 7.83 cm、T = 1.64×10⁻⁷ s 与优化前基线一致，63/63 项引擎校验通过）——记录于专项执行日志。
- 浏览器验收回归（mechanics / electric / electric-v2 / electric-region / composite / learning / circuit / wave 八份 acceptance）不受影响——本轮未触碰画布绘制与引擎数值路径之外的领域行为。

## 6. 评审 findings 处置

| ID      | 严重度 | 内容                                                   | 处置                                                                                   |
| ------- | ------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| F1      | low    | 无独立 chart 采样率预算                                | 记录：chart 消费者出现时实现独立预算（§7）                                             |
| F2      | medium | composite 索引式抽稀可能丢 phase-boundary              | **已落实**：观察层把边界时刻索引收集进 `protect` 再抽稀                                |
| F3      | low    | `chunkTrajectoryPoints` 无生产消费者                   | 记录：1024/512 上界下分块原语备懒加载轨迹消费者使用                                    |
| F4      | low    | `outputSampleRate` 语义缺文档                          | **已落实**：`trajectory-sampling.ts` 头部契约注释说明为「存储采样总数，钳制 [2,1024]」 |
| F5      | low    | magnetic 合并 verification times 后 states 可略超 1024 | 记录：上界为近似；verification times 从 states 分离属后续                              |
| F6      | low    | 部分有界引擎未接 `outputSampleRate` 钩子               | 记录：electric-region / fluid / thermal / acoustics / lever 均为有界分段，非无限增长   |
| F1 (t9) | low    | `parseSimulationWorkerMessage` 浅层校验、doc 措辞过强  | 记录：Worker 实现落地时补深度校验或收敛 doc                                            |
| F2 (t9) | medium | composite phase 分解极端场景为有界长任务，未 Worker 化 | 记录：`simulation-worker/1.0` 契约已备，生产 Worker 为登记跟进项（§7）                 |
| F3 (t9) | low    | electric-verifier diff 混入 prettier 重排噪音          | 已接受：重排随本轮提交，语义 diff 为 Map 索引一项                                      |
| F1 (t5) | low    | WeakMap 缓存数组无防御性拷贝                           | 记录：当前无写消费者，出现时改 frozen/拷贝并注明只读契约                               |

## 7. 明确不做 / 后续

- **生产 Worker 实现**：`simulation-worker/1.0` 契约已就绪，composite phase 分解与点电荷格点采样是首选候选；落地需把 `decomposePhases` 等长任务迁移出主线程或加分片/可取消机制（#26）。
- **#86 Lazy Loading**（Three.js / 大型 Skill / 高级图表 / Teacher Studio 按需加载）：web 层首屏体积优化，独立阶段。
- **Chart 独立采样率**、**chunk 懒加载消费**、**剩余引擎 `outputSampleRate` 统一**：均非本轮阻塞。
- 不改动：物理数值、公共契约与 API 签名（本轮新增导出均为纯增量）；`apps/web` 旧版独立界面（`APPS_WEB_STANDALONE_RETIREMENT_BACKLOG` 不变）。
