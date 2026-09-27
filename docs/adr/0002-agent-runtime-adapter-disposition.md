# ADR-0002：agent-runtime 与 agent-dsh-adapter 的处置

- 状态：提议
- 日期：2026-09-27
- 决策人：PhysicsOS maintainers
- 相关文档 / PR：`packages/agent-runtime`、`packages/agent-dsh-adapter`、`docs/HARNESS-UPSTREAM.md`、`docs/04-AGENT-ARCHITECTURE.md`

## 背景

`docs/HARNESS-UPSTREAM.md` 与 `docs/04-AGENT-ARCHITECTURE.md` 把 Agent 链路画成
`ui-physicsos → @physicsos/agent-runtime → @physicsos/agent-dsh-adapter → vendor/deepseek-harness`。
核查代码后，这条链在仓库里并不存在：两个 package 都已落盘，但没有任何生产路径使用它们。

已核对的事实（file:line）：

- `packages/agent-runtime`（共 243 行：`src/ids.ts` 10 + `src/runtime.ts` 25 + `src/session.ts` 66 + `src/events.ts` 70 + `src/index.ts` 25 = 196，加 `src/contract.test.ts` 47）是纯类型 + contract test。
  它在全仓的唯一消费者是 `packages/agent-dsh-adapter`——引用点仅
  `packages/agent-dsh-adapter/package.json`、`src/deepseek-harness-adapter.ts`、
  `src/local-sidecar-transport.ts`、`src/local-sidecar-transport.test.ts`。`packages/**`、
  `overlays/**`、`apps/**` 其余位置均不 import `@physicsos/agent-runtime`。
- `packages/agent-dsh-adapter/src/deepseek-harness-adapter.ts:26-48` 的
  `createSession` / `send` / `resume` / `cancel` / `getSession` / `forkSession` 全部
  `return Promise.reject(new UnimplementedError('…'))`；同文件 63-79 行的
  `DeepSeekHarnessTransport` 同理。这是 PHASE-01 骨架。其兄弟文件
  `boundary.ts`（29 行）、`local-sidecar-transport.ts`（271 行）、`tauri-sidecar-rpc.ts`（132 行）是真实实现。
  全仓没有任何生产路径 import `@physicsos/agent-dsh-adapter`：引用仅剩它自己的
  `package.json`、`src/adapter.contract.test.ts`、`src/boundary.ts`。
- 桌面产品走的是另一条路：`apps/desktop/sidecar/bridge.mjs`（1258 行），JSON-RPC stdio 桥接到
  本地 Harness web host，已迁移到 0.1.7 会话流（`remote.mux` + `session/follow`）与斜杠式 remote
  协议，并实现 `session/create`、`session/send`、`run/cancel`、`run/resume`（bridge.mjs:20-23、640-646）。
- 真正在跑的生产 Agent 链是 Harness 自己的循环：Harness Agent Loop → Harness Tool Runtime →
  `overlays/harness/files/packages/physicsos/tool-physicsos`（用 `@deepseek-ai/dsh-tools` 的
  `defineTool` 注册工具）→ `@physicsos/agent-tools`（`src` 2694 行）→ 物理引擎与 verifier。
- 我们自己的状态机是真实存在的，但在别处：
  `overlays/harness/files/packages/physicsos/paper-host/src/domain.ts:277`
  （`spec|drafting|checking|review|approved|exported|failed`，含 `drafting`/`checking` 的恢复）、
  `packages/physics-scene/src/scene-branch.ts`（82 行）与 `scene-runtime.ts`（4839 行）；
  `packages/question-core/src/workflow.ts` 只有 18 行阶段枚举，不是转移机。

约束与代价：项目原则是「DeepSeek Harness 是 Agent 基础设施，不是 PhysicsOS 业务核心」
（`docs/04-AGENT-ARCHITECTURE.md:14`），并明确「PhysicsOS 不重新实现通用 Harness 能力」（同文件:221）。
当前不决策的代价是文档持续过度声明：读者会以为存在一个稳定的 Agent Contract 边界，
并为它未来的接线预留设计空间，而代码里它零消费者、部分方法直接抛错。

## 决定

**推荐方案（b）：退役 `packages/agent-runtime` 与 `packages/agent-dsh-adapter` 两个 package，
把文档链改为描述真实在线的 `tool-physicsos → @physicsos/agent-tools → 物理引擎 / verifier` 路径。**

边界与范围：

- 物理域的稳定契约本就落在 tool 边界——`@physicsos/agent-tools`（2694 行，已在线）
  与 `tool-physicsos` 注册层，而不是一个重复的 `agent-runtime` 抽象。
- `@physicsos/agent-tools` 已是 PhysicsOS 唯一拥有物理语义的 Agent 集成点，退役后它继续承担
  「PhysicsOS owns the physics domain」这一职责。
- 明确不做：不在本轮执行退役（本 ADR 状态为**提议**）。本轮只做零风险、非破坏性的
  包内文档纠偏（见「后果·已执行」）。
- 明确不做：不 fork/修改 Harness，不删除 `vendor/deepseek-harness`，不动
  `apps/desktop/sidecar/bridge.mjs`——bridge 是当前唯一可用的桌面 Agent 通道，继续保留。

单条最强理由：两个 package 的消费者数为 0，它们的存在本身就是文档过度声明的唯一来源；
而物理域契约的真实承载点（`tool-physicsos → agent-tools`）已在线上。退役因此是零生产成本地让
文档变真，并去掉一层与「不重新实现通用 Harness 能力」相冲突的多余抽象。

## 后果

- 正面：文档与代码一致；删除 777 行（243 + 534）无消费者代码与测试；不再有人为一个不存在的
  Contract 边界做设计预留；Agent 边界收敛为唯一真实的那条（Harness 工具运行时 →
  `agent-tools` → 引擎）。
- 负面：失去一个「未来可替换 Agent Runtime」的潜在 seam。若日后确实需要接入非 Harness 的
  runtime，需重新引入契约层——届时按真实需求设计，而不是保留今日的猜想。
- 需要跟进：退役是独立后续动作（本 ADR 被接受后另开 PR），步骤包括移除两个 workspace 包、
  清理 `pnpm-workspace.yaml`/lockfile 引用、跑 `pnpm typecheck`/`test` 确认无破坏
  （因无消费者，预期零破坏）；并同步改文档（见下）。
- 已执行（本轮，非破坏性）：只纠偏包内文档，不改行为、不删包、不接线。

### 文档影响（本 ADR 被接受后需改）

- `docs/HARNESS-UPSTREAM.md`：该文件已被 commit `fec8132` 重写，把这一对明确标为
  「未接线（**不要当作生产链路**）」（现第 85-95 行）——事实口径已正确。但在方案 (b) 下，
  这段「未接线」块（含第 87-92 行的 `@physicsos/agent-runtime → @physicsos/agent-dsh-adapter →
  deepseek-harness-adapter.ts` 三层和「预置的稳定 Contract」表述）应整体删除，而不是保留为
  「预置」；第 138 行升级步骤里「`@physicsos/agent-runtime` / `@physicsos/agent-dsh-adapter`
  目前仍是 PHASE-01 骨架」一句也应删除。
- `docs/04-AGENT-ARCHITECTURE.md`（该文件尚未被重写）：§2.5「Harness 与 PhysicsOS 解耦」
  （标题在 157 行，`agent-dsh-adapter` 字样在 168 行）；§3「Agent 总体架构」ASCII 图里
  「DSH Adapter → DeepSeek Harness」两层（DSH Adapter 在 210 行）；§5「为什么不 Fork Harness
  业务核心」的 `DSH Adapter` 链（279 行）；§6「Harness Adapter Boundary」把
  `packages/agent-dsh-adapter` 列为直接依赖 Harness 的包（305 行）；§7「PhysicsAgentRuntime API」
  被称作统一运行时接口（325 行起）；§152/153/154「Agent Package 结构」里 `agent-runtime/`、
  `agent-dsh-adapter/` 及其职责描述（3501/3520/3537 行）；§160「agent-workflow」的
  「Physics Workflow State Machine」（3626 行）——真实的物理状态机在
  `overlays/harness/files/packages/physicsos/paper-host/src/domain.ts:277` 与
  `packages/physics-scene/src/scene-branch.ts`，不在 `agent-workflow`。
- 次要引用（同样需要回填，非本轮范围）：`docs/00-PRODUCT-OVERVIEW.md:2483-2484`、
  `docs/01-DEVELOPMENT-GUIDE.md:276-277` 与 `:1599`、`docs/02-ENGINEERING-STANDARDS.md:1263`
  与 `:2434`、`docs/reports/PHASE-01-FOUNDATION-REPORT.md:103-104` 与 `:125-126`。

## 替代方案

- **方案（a）接线：把 `agent-dsh-adapter` 接到已验证的 sidecar 协议上。**
  做法：在生产入口构造 `createTauriSidecarRpc` + `createLocalSidecarAgentTransport`，补齐
  `getSession`/`forkSession`，加 contract tests——bridge 已实现四个方法，`LocalSidecarAgentTransport`
  的映射可直接复用。成本：在渲染进程/桌面壳新建 RPC 装配与生命周期；为一个无消费者的抽象加维护面。
  收益：文档链变成真的；UI 与 Harness 之间多一层稳定契约。破坏：生产无破坏，但会新增一条与
  bridge 并行的第二 Agent 路径，两者存在漂移风险。**放弃原因**：它为了「隔离 Harness」而再实现一层
  Session/Run 映射，而 Harness 已通过工具扩展点提供了正确接缝，与「不重新实现通用 Harness 能力」冲突，
  且今天没有需求方。
- **方案（c）保留 `agent-runtime` 作 contract-only 边界，显式标注未接线。**
  成本：仅文档改动，最低；但保留 243 行无消费者类型，长期与真实链路漂移，`agent-dsh-adapter`
  仍是抛错骨架。收益：保住廉价 seam。破坏：无。**放弃原因**：它没有触及「抽象无人使用」这一根因，
  只是把过度声明从「隐式」变成「显式」，仍让读者为一个不存在的边界留位。若 owner 明确要保留未来
  多 runtime 的选项，可将 (c) 作为 (b) 的过渡，但本 ADR 不建议长期停留在此。
